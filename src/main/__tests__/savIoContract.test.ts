import { describe, it, expect } from 'vitest'
import {
  peekNextSavDataByte,
  readNextSavRow,
  createSavRowReader,
  SAV_COMPRESSED_EOF_CODE,
  SAV_TYPE_NUMERIC,
  SAV_TYPE_STRING,
  parseRScriptStdout,
  compareRVersionDesc,
  validateDocxPayload,
  buildDocxBatchCommands,
  planDocxExport,
  parseOfficecliEnvelope,
  MAX_DOCX_TABLES,
  type SavReaderLike
} from '../savImport'

/**
 * 主进程 IO 契约回归测试。
 *
 * 覆盖三处「静默失败」类缺陷：
 *  - F3-c：`peekNextSavDataByte` 在上游实现里可能返回 `undefined`，导致
 *    `SavReader.readNextRow()` 在第 1 行就认为文件结束（.sav 只导入 1 行）；
 *  - R 错误哨兵：JS 的 `.` 不匹配换行，多行 R 报错被截断成第一行；
 *  - Word 导出：`tables: undefined` 抛 TypeError；参差行按 headers 建表后越界访问 tc[]。
 *
 * 全部为纯函数注入式测试：不需要真实 .sav、不需要 officecli、不需要 Electron。
 */

/** 构造一个可注入的 .sav reader（只实现 savImport 用到的公开原语） */
function fakeSav(opts: {
  peek: () => Promise<Uint8Array>
  sysvars?: Array<{ name: string; type: number }>
  double?: number | null
  str?: string | null
}): SavReaderLike {
  return {
    meta: {
      header: { compression: null },
      sysvars: (opts.sysvars ?? [{ name: 'v1', type: SAV_TYPE_NUMERIC }]) as SavReaderLike['meta']['sysvars']
    },
    reader: {
      commandPointer: 0,
      commandBuffer: null,
      reader: { peek: opts.peek },
      readDouble2: async () => (opts.double === undefined ? 42 : opts.double),
      read8CharString: async () => (opts.str === undefined ? 'abc' : opts.str)
    }
  }
}

describe('peekNextSavDataByte（F3-c 回归：绝不能返回 undefined）', () => {
  it('skips zero padding and returns the next data byte from the stream', async () => {
    // 上游 bug：命令块剩余字节全为 0 时，commandBuffer[8] === undefined，
    // 而 `undefined !== 0` 成立 → 返回 undefined → readNextRow 误判 EOF（只读到第 1 行）。
    const byte = await peekNextSavDataByte({
      commandPointer: 4,
      commandBuffer: Uint8Array.from([0x65, 0xfd, 0xfd, 0x65, 0x00, 0x00, 0x00, 0x00]),
      reader: { peek: async () => Uint8Array.from([1]) },
      readDouble2: async () => null,
      read8CharString: async () => null
    })
    expect(byte).toBe(1)
    expect(byte).not.toBeUndefined()
  })

  it('returns the remaining non-zero byte inside the command block', async () => {
    const byte = await peekNextSavDataByte({
      commandPointer: 2,
      commandBuffer: Uint8Array.from([0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00]),
      reader: { peek: async () => Uint8Array.from([9]) },
      readDouble2: async () => null,
      read8CharString: async () => null
    })
    expect(byte).toBe(7)
  })

  it('returns null (not undefined) at real EOF, including when peek throws', async () => {
    const byte = await peekNextSavDataByte({
      commandPointer: 0,
      commandBuffer: null,
      reader: {
        peek: async () => {
          throw new Error('stream exhausted')
        }
      },
      readDouble2: async () => null,
      read8CharString: async () => null
    })
    expect(byte).toBeNull()
  })

  it('returns null when peek yields an empty buffer', async () => {
    const byte = await peekNextSavDataByte({
      commandPointer: 0,
      commandBuffer: null,
      reader: { peek: async () => new Uint8Array(0) },
      readDouble2: async () => null,
      read8CharString: async () => null
    })
    expect(byte).toBeNull()
  })
})

describe('readNextSavRow / createSavRowReader', () => {
  it('reads a numeric row', async () => {
    const reader = createSavRowReader(fakeSav({ peek: async () => Uint8Array.from([1]) }))
    expect(await reader.readNextRow()).toEqual({ v1: 42 })
  })

  it('reads a string row and trims the padding', async () => {
    const reader = createSavRowReader(
      fakeSav({
        peek: async () => Uint8Array.from([1]),
        sysvars: [{ name: 'name', type: SAV_TYPE_STRING }],
        str: 'abc   '
      })
    )
    expect(await reader.readNextRow()).toEqual({ name: 'abc' })
  })

  it('treats the SPSS EOF code 252 as end of file', async () => {
    const reader = createSavRowReader(fakeSav({ peek: async () => Uint8Array.from([SAV_COMPRESSED_EOF_CODE]) }))
    expect(await reader.readNextRow()).toBeNull()
  })

  it('never turns a null string head into the literal "null" (F3-c regression)', async () => {
    const reader = createSavRowReader(
      fakeSav({
        peek: async () => Uint8Array.from([1]),
        sysvars: [{ name: 'name', type: SAV_TYPE_STRING }],
        str: null
      })
    )
    const row = await reader.readNextRow()
    expect(row).not.toBeNull()
    expect(row?.name).toBeUndefined() // includeNulls=false 时空字符串应被省略
    expect(JSON.stringify(row)).not.toContain('null')
  })

  it('includes empty cells when includeNulls is true', async () => {
    const reader = createSavRowReader(
      fakeSav({
        peek: async () => Uint8Array.from([1]),
        sysvars: [{ name: 'name', type: SAV_TYPE_STRING }],
        str: null
      })
    )
    expect(await reader.readNextRow(true)).toEqual({ name: '' })
  })

  it('drops null numerics unless includeNulls is set', async () => {
    const reader = createSavRowReader(fakeSav({ peek: async () => Uint8Array.from([1]), double: null }))
    expect(await reader.readNextRow()).toEqual({})
    expect(await reader.readNextRow(true)).toEqual({ v1: null })
  })
})

describe('parseRScriptStdout（多行 R 报错不能被截断）', () => {
  it('keeps the whole multi-line error and strips both sentinels', () => {
    const r = parseRScriptStdout('out\n__RWB_ERROR__:l1\nl2\nl3\n__RWB_DONE__\n')
    expect(r.errors[0]).toBe('l1\nl2\nl3')
    expect(r.error).toBe('l1\nl2\nl3')
    expect(r.output).toBe('out')
    expect(r.completed).toBe(true)
  })

  it('reports completed=false when the DONE sentinel is missing (timeout / killed)', () => {
    const r = parseRScriptStdout('partial output\n__RWB_ERROR__:boom\n')
    expect(r.completed).toBe(false)
    expect(r.error).toBe('boom')
    expect(r.output).toBe('partial output')
  })

  it('returns the raw output when there is no error sentinel', () => {
    const r = parseRScriptStdout('hello\n__RWB_DONE__\n')
    expect(r.error).toBeNull()
    expect(r.errors).toEqual([])
    expect(r.output).toBe('hello')
    expect(r.completed).toBe(true)
  })

  it('handles non-string input without throwing', () => {
    const r = parseRScriptStdout(undefined)
    expect(r.output).toBe('')
    expect(r.error).toBeNull()
    expect(r.completed).toBe(false)
  })

  it('falls back to a placeholder when R reports an empty error', () => {
    const r = parseRScriptStdout('__RWB_ERROR__:__RWB_DONE__')
    expect(r.error).toBe('（R 未提供错误信息）')
  })
})

describe('compareRVersionDesc（数值降序，不是字典序）', () => {
  it('sorts 4.10.0 before 4.6.0', () => {
    expect(['R-4.6.0', 'R-4.10.0'].sort(compareRVersionDesc)).toEqual(['R-4.10.0', 'R-4.6.0'])
  })

  it('is stable for equal versions and tolerates non-prefixed inputs', () => {
    expect(compareRVersionDesc('4.6.0', '4.6.0')).toBe(0)
    expect(compareRVersionDesc('R-4.6.0', '4.6.0')).toBe(0)
    expect(compareRVersionDesc('R-4.6.1', 'R-4.6.0')).toBeLessThan(0)
  })
})

describe('validateDocxPayload / buildDocxBatchCommands（Word 导出批量重写）', () => {
  const base = { title: '报告', savePath: 'C:/tmp/report.docx' }

  it('rejects a missing tables array with a readable message (not a TypeError)', () => {
    expect(() => validateDocxPayload({ ...base, tables: undefined })).toThrow('tables 必须是数组')
  })

  it('rejects malformed input with actionable messages', () => {
    expect(() => validateDocxPayload(null)).toThrow('导出请求必须是对象')
    expect(() => validateDocxPayload({ ...base, title: 42, tables: [] })).toThrow('title 必须是字符串')
    expect(() => validateDocxPayload({ title: '', savePath: 'x', tables: [] })).toThrow('title 不能为空')
    expect(() => validateDocxPayload({ title: 't', savePath: '', tables: [] })).toThrow('savePath 必须是字符串')
    expect(() => validateDocxPayload({ ...base, tables: 'nope' })).toThrow('tables 必须是数组')
    expect(() =>
      validateDocxPayload({ ...base, tables: Array.from({ length: MAX_DOCX_TABLES + 1 }, () => ({ headers: ['a'], rows: [['1']] })) })
    ).toThrow('表格数量超限')
  })

  it('sizes the table by the widest row so no tc[] path can go out of range', () => {
    const payload = validateDocxPayload({
      ...base,
      tables: [{ headers: ['a', 'b'], rows: [['1'], ['1', '2', '3']] }]
    })
    expect(payload.tables[0].cols).toBe(3)
    expect(payload.tables[0].tableRows).toBe(3)

    const cmds = buildDocxBatchCommands(payload)
    const cellPaths = cmds
      .map((c) => String(c.path ?? ''))
      .filter((p) => p.includes('/tc['))
    expect(cellPaths.length).toBeGreaterThan(0)
    for (const p of cellPaths) {
      const n = Number(/\/tc\[(\d+)\]/.exec(p)?.[1])
      expect(n).toBeLessThanOrEqual(3)
      expect(n).toBeGreaterThanOrEqual(1)
    }
  })

  it('plans a constant number of subprocesses regardless of table size', () => {
    const payload = validateDocxPayload({
      ...base,
      tables: [{ headers: ['a', 'b', 'c'], rows: Array.from({ length: 20 }, () => ['1', '2', '3']) }]
    })
    const plan = planDocxExport(payload)
    expect(plan.processCount).toBe(3)
    // 20 行 × 3 列：命令数远多于进程数（旧实现是每单元格一次进程）
    expect(plan.commandCount).toBeGreaterThan(20)
  })

  it('renders multi-line interpretation as one paragraph per non-empty line', () => {
    const payload = validateDocxPayload({
      ...base,
      tables: [{ headers: ['h'], rows: [['1']] }],
      interpretation: '第一行\n\n第二行'
    })
    const cmds = buildDocxBatchCommands(payload)
    const texts = cmds.filter((c) => c.command === 'add' && c.type === 'paragraph').map((c) => (c.props as { text: string }).text)
    expect(texts).toContain('第一行')
    expect(texts).toContain('第二行')
  })
})

describe('parseOfficecliEnvelope', () => {
  it('parses a success envelope with warnings', () => {
    expect(parseOfficecliEnvelope(JSON.stringify({ success: true, warnings: ['w1'] }))).toEqual({
      success: true,
      error: null,
      warnings: ['w1']
    })
  })

  it('parses a failure envelope and stringifies object errors', () => {
    const r = parseOfficecliEnvelope(JSON.stringify({ success: false, error: { code: 7, msg: 'bad' } }))
    expect(r.success).toBe(false)
    expect(r.error).toContain('"code"')
  })

  it('treats empty output as failure and non-JSON output as success', () => {
    expect(parseOfficecliEnvelope('').success).toBe(false)
    expect(parseOfficecliEnvelope('not json').success).toBe(true)
  })
})
