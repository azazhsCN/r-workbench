import { describe, it, expect } from 'vitest'
import {
  SAV_TYPE_NUMERIC,
  SAV_TYPE_STRING,
  MAX_SAV_ROWS,
  mapSavColumnType,
  declaredCaseCount,
  normalizeSavRow,
  isMissingCell,
  computeColumnInfo,
  clampMaxRows,
  readSavRowsIncremental,
  buildTruncationNotice,
  type MinimalSavReader
} from '../savImport'

/**
 * SPSS 导入回归测试（T2 / T3）。
 *
 * 这两条缺陷在 v0.2.5 中被 typecheck 掩盖、在运行期静默破坏数据：
 *  - T2：`v.type === 'numeric'` 与 0|1 枚举比较恒为 false → 每个 .sav 列都被标成 string
 *        → 向导页所有数值方法选不到变量；
 *  - T3：`sav.meta.nrows ?? MAX_SAFE_INTEGER` 使 20 万行上限恒真，而 readAllRows() 会先把
 *        全部行读进内存 → 内存峰值由文件总行数决定（200MB 文件可 OOM）。
 *
 * 因此这里不仅断言取值，还断言**内存上界契约**：reader.readNextRow 的调用次数必须被
 * maxRows 限制，绝不随文件总行数增长。
 */

/** 可记录调用次数的假 reader（不读文件、不依赖 sav-reader） */
function fakeReader(totalRows: number): MinimalSavReader & { calls: number } {
  let i = 0
  const r = {
    calls: 0,
    async readNextRow(): Promise<unknown> {
      r.calls++
      if (i >= totalRows) return null
      const row = { id: i + 1, score: (i + 1) * 10 }
      i++
      return row
    }
  }
  return r
}

describe('mapSavColumnType（T2 回归）', () => {
  it('pins the upstream enum values (0 = numeric, 1 = string)', () => {
    expect(SAV_TYPE_NUMERIC).toBe(0)
    expect(SAV_TYPE_STRING).toBe(1)
  })

  it('maps the numeric enum to numeric columns', () => {
    expect(mapSavColumnType(SAV_TYPE_NUMERIC)).toBe('numeric')
    expect(mapSavColumnType(0)).toBe('numeric')
  })

  it('maps the string enum and anything unknown to string', () => {
    expect(mapSavColumnType(SAV_TYPE_STRING)).toBe('string')
    expect(mapSavColumnType(1)).toBe('string')
    expect(mapSavColumnType(undefined)).toBe('string')
    expect(mapSavColumnType(null)).toBe('string')
    expect(mapSavColumnType(99)).toBe('string')
  })

  it('does NOT treat the literal string "numeric" as numeric (the v0.2.5 bug)', () => {
    // 旧代码是 `v.type === 'numeric' ? 'numeric' : 'string'`：v.type 的类型是 0|1，
    // 与字符串比较永远为 false，于是所有列都变成 string。这里把该语义钉死。
    expect(mapSavColumnType('numeric')).toBe('string')
  })
})

describe('readSavRowsIncremental（T3 回归：内存上界 + 截断检测）', () => {
  it('reads everything when the file is smaller than maxRows', async () => {
    const reader = fakeReader(5)
    const res = await readSavRowsIncremental(reader, ['id', 'score'], { maxRows: 10 })
    expect(res.rows).toHaveLength(5)
    expect(res.readRows).toBe(5)
    expect(res.truncated).toBe(false)
    expect(res.declaredRows).toBeNull()
    expect(res.totalRows).toBe(5)
    // 5 行数据 + 1 次 EOF 探测（读满与否都要确认结束）
    expect(reader.calls).toBe(6)
  })

  it('stops at maxRows and NEVER reads the rest of the file (memory bound)', async () => {
    const total = 1_000_000
    const reader = fakeReader(total)
    const res = await readSavRowsIncremental(reader, ['id', 'score'], { maxRows: 100 })

    expect(res.readRows).toBe(100)
    expect(res.truncated).toBe(true)
    expect(res.totalRows).toBeNull() // 未声明总数且被截断 → 真实总数未知
    // 关键断言：调用次数是常数级（maxRows + 1 次探测），而不是 1,000,000
    expect(reader.calls).toBe(101)
    expect(reader.calls).toBeLessThan(total / 1000)
  })

  it('uses the header-declared case count to flag truncation without probing', async () => {
    const reader = fakeReader(50)
    const res = await readSavRowsIncremental(reader, ['id'], { maxRows: 10, declaredRows: 50 })
    expect(res.readRows).toBe(10)
    expect(res.truncated).toBe(true)
    expect(res.declaredRows).toBe(50)
    expect(res.totalRows).toBe(50)
    expect(reader.calls).toBe(10) // 无需额外探测：声明数已经说明被截断
  })

  it('does not probe when the declared count is fully consumed', async () => {
    const reader = fakeReader(4)
    const res = await readSavRowsIncremental(reader, ['id'], { maxRows: 4, declaredRows: 4 })
    expect(res.readRows).toBe(4)
    expect(res.truncated).toBe(false)
    expect(res.totalRows).toBe(4)
    expect(reader.calls).toBe(5) // 第 4 行后仍会读一次以确认 EOF
  })

  it('honours probeTruncation = false', async () => {
    const reader = fakeReader(1000)
    const res = await readSavRowsIncremental(reader, ['id'], { maxRows: 10, probeTruncation: false })
    expect(res.readRows).toBe(10)
    expect(res.truncated).toBe(false)
    expect(reader.calls).toBe(10)
  })

  it('treats undefined as end-of-file as well as null', async () => {
    let i = 0
    const reader: MinimalSavReader = {
      async readNextRow() {
        i++
        return i <= 3 ? { id: i } : undefined
      }
    }
    const res = await readSavRowsIncremental(reader, ['id'], { maxRows: 10 })
    expect(res.rows).toHaveLength(3)
    expect(res.truncated).toBe(false)
  })

  it('normalizes rows so every header exists (missing → "")', async () => {
    let done = false
    const reader: MinimalSavReader = {
      async readNextRow() {
        if (done) return null
        done = true
        return { id: 1 }
      }
    }
    const res = await readSavRowsIncremental(reader, ['id', 'score'], { maxRows: 10 })
    expect(res.rows[0]).toEqual({ id: 1, score: '' })
  })
})

describe('clampMaxRows', () => {
  it('defaults to MAX_SAV_ROWS for junk input', () => {
    expect(clampMaxRows(undefined)).toBe(MAX_SAV_ROWS)
    expect(clampMaxRows(NaN)).toBe(MAX_SAV_ROWS)
    expect(clampMaxRows('abc')).toBe(MAX_SAV_ROWS)
    expect(clampMaxRows(0)).toBe(MAX_SAV_ROWS)
    expect(clampMaxRows(-5)).toBe(MAX_SAV_ROWS)
  })

  it('never allows a value above MAX_SAV_ROWS', () => {
    expect(clampMaxRows(MAX_SAV_ROWS * 10)).toBe(MAX_SAV_ROWS)
    expect(clampMaxRows(123)).toBe(123)
  })
})

describe('declaredCaseCount', () => {
  it('reads meta.header.n_cases', () => {
    expect(declaredCaseCount({ header: { n_cases: 1234 } })).toBe(1234)
  })

  it('returns null for unknown (-1), non-integers and missing fields', () => {
    expect(declaredCaseCount({ header: { n_cases: -1 } })).toBeNull()
    expect(declaredCaseCount({ header: { n_cases: 3.5 } })).toBeNull()
    expect(declaredCaseCount({ header: {} })).toBeNull()
    expect(declaredCaseCount({})).toBeNull()
    expect(declaredCaseCount(null)).toBeNull()
    expect(declaredCaseCount(undefined)).toBeNull()
    expect(declaredCaseCount({ header: { n_cases: '100' } })).toBeNull()
  })
})

describe('isMissingCell / computeColumnInfo', () => {
  it('treats null/undefined/empty and string sentinels as missing', () => {
    expect(isMissingCell('')).toBe(true)
    expect(isMissingCell(null)).toBe(true)
    expect(isMissingCell(undefined)).toBe(true)
    expect(isMissingCell('.')).toBe(true)
    expect(isMissingCell('NA')).toBe(true)
    expect(isMissingCell(' na ')).toBe(true)
    expect(isMissingCell(0)).toBe(false)
    expect(isMissingCell('0')).toBe(false)
    expect(isMissingCell('x')).toBe(false)
  })

  it('treats declared numeric and array missing codes as missing', () => {
    expect(isMissingCell(-999, -999)).toBe(true)
    expect(isMissingCell(-998, -999)).toBe(false)
    expect(isMissingCell(99, [99, 999])).toBe(true)
    expect(isMissingCell(999, [99, 999])).toBe(true)
    expect(isMissingCell(50, [99, 999])).toBe(false)
  })

  it('maps column types and counts missing values per column (T2 end-to-end)', () => {
    const info = computeColumnInfo(
      [
        { name: 'age', type: SAV_TYPE_NUMERIC },
        { name: 'sex', type: SAV_TYPE_STRING },
        { name: 'income', type: SAV_TYPE_NUMERIC, missing: -999 }
      ],
      [
        { age: 20, sex: '男', income: 1000 },
        { age: 30, sex: '女', income: -999 },
        { age: '', sex: 'NA', income: 2000 }
      ]
    )

    expect(info.map((c) => c.type)).toEqual(['numeric', 'string', 'numeric'])
    expect(info.map((c) => c.missing)).toEqual([1, 1, 1])
    expect(info.every((c) => c.total === 3)).toBe(true)
    // 回归：若 mapSavColumnType 退化为字符串比较，数值列会变成 string → 向导页选不到变量
    expect(info.filter((c) => c.type === 'numeric').map((c) => c.name)).toEqual(['age', 'income'])
  })
})

describe('normalizeSavRow', () => {
  it('fills every header and converts null/undefined to empty string', () => {
    expect(normalizeSavRow({ a: 1 }, ['a', 'b'])).toEqual({ a: 1, b: '' })
    expect(normalizeSavRow({ a: null, b: undefined }, ['a', 'b'])).toEqual({ a: '', b: '' })
    expect(normalizeSavRow(null, ['a'])).toEqual({ a: '' })
  })
})

describe('buildTruncationNotice', () => {
  it('is null when nothing was truncated', () => {
    expect(buildTruncationNotice({ truncated: false, readRows: 10, totalRows: 10 })).toBeNull()
  })

  it('mentions the declared total when known', () => {
    const msg = buildTruncationNotice({ truncated: true, readRows: 200_000, totalRows: 1_500_000 })
    // 容忍千分位分隔符的两种写法
    expect(msg).toMatch(/1[,.]?500[,.]?000/)
    expect(msg).toContain('200,000')
  })

  it('falls back to a vague total when the true count is unknown', () => {
    const msg = buildTruncationNotice({ truncated: true, readRows: 200_000, totalRows: null })
    expect(msg).toContain('超过')
  })
})
