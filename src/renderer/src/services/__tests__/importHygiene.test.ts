import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  parseCSV,
  parseCSVBytes,
  parseExcel,
  listExcelSheets,
  normalizeHeaders,
  isNumericLike,
  sentinelsFor,
  type ParseResult
} from '../dataService'
import {
  decodeBytes,
  detectEncoding,
  sniffBom,
  stripBom,
  countReplacements,
  toUint8Array
} from '../decode'

/**
 * T6 导入卫生回归测试：编码探测 / CSV 分隔符 / 缺失值哨兵 / Excel 日期与公式。
 *
 * 这些是 v0.2.5 中会在**用户毫无察觉**的情况下污染统计量的缺陷：
 *  - GBK CSV 用 UTF-8 解码 → 列名变成 U+FFFD，R 端取不到列；
 *  - `dynamicTyping` 把学号 007 变成 7（不同 ID 合并成同一组）；
 *  - `-999` 被当作有效观测参与均值/标准差；
 *  - Excel 日期不传 `cellDates` → `2024-01-14` 变成 45306.000497685185 送进回归；
 *  - 字段数不匹配的行被静默错位（多余字段进 `__parsed_extra` 后被下游忽略）。
 *
 * 断言全部针对**可观察输出**（headers / rows / columnInfo / warnings），而不是"没抛异常"。
 */

/** 真实 GBK 字节：姓名,年龄,成绩\n张三,20,85\n */
const GBK_BYTES = Uint8Array.from([
  0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xc4, 0xea, 0xc1, 0xe4, 0x2c, 0xb3, 0xc9, 0xbc, 0xa8, 0x0a,
  0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0x32, 0x30, 0x2c, 0x38, 0x35, 0x0a
])

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

/** 解析结果的警告码列表（warnings 是可选字段） */
const warnCodes = (r: ParseResult): string[] => (r.warnings ?? []).map((w) => w.code)

describe('decode.ts — 编码探测（T6 缺陷 1）', () => {
  it('decodes a real GBK byte stream to correct Chinese headers', () => {
    const r = decodeBytes(GBK_BYTES)
    expect(r.text).toBe('姓名,年龄,成绩\n张三,20,85\n')
    expect(r.encoding).toBe('gb18030')
    expect(r.source).toBe('detected')
    expect(r.replacements).toBe(0)
  })

  it('strips a UTF-8 BOM and reports source bom', () => {
    const r = decodeBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('姓名,age\n张三,20\n')]))
    expect(r.encoding).toBe('utf-8')
    expect(r.source).toBe('bom')
    expect(r.text.startsWith('姓名')).toBe(true)
    expect(r.text).not.toContain('\uFEFF')
  })

  it('detects UTF-16LE from its BOM', () => {
    const r = decodeBytes(Uint8Array.from([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]))
    expect(r.encoding).toBe('utf-16le')
    expect(r.text).toBe('你好')
  })

  it('reports a source of override when the user forces the wrong encoding', () => {
    const r = decodeBytes(GBK_BYTES, 'utf-8')
    expect(r.source).toBe('override')
    expect(r.encoding).toBe('utf-8')
    // 强制 UTF-8 读 GBK 必然产生替换字符；必须能报出数量（否则用户看不到乱码风险）
    expect(r.replacements).toBeGreaterThan(0)
    expect(r.text).toContain('\uFFFD')
  })

  it('handles empty input without throwing', () => {
    const r = decodeBytes(new Uint8Array(0))
    expect(r.text).toBe('')
    expect(r.encoding).toBe('utf-8')
    expect(r.replacements).toBe(0)
  })

  it('keeps the byteOffset of a typed-array view (no silent offset loss)', () => {
    const view = new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4)
    expect(Array.from(toUint8Array(view) ?? [])).toEqual([1, 2, 3])
    expect(toUint8Array(null)).toBeNull()
  })

  it('exposes small primitives consistently', () => {
    expect(sniffBom(Uint8Array.from([0xef, 0xbb, 0xbf]))?.encoding).toBe('utf-8')
    expect(sniffBom(Uint8Array.from([1, 2, 3]))).toBeNull()
    expect(stripBom('\uFEFFabc')).toBe('abc')
    expect(countReplacements('a\uFFFDb\uFFFD')).toBe(2)
    expect(detectEncoding(utf8('abc')).encoding).toBe('utf-8')
  })
})

describe('parseCSV — CSV 解析卫生（T6 缺陷 2）', () => {
  it('auto-detects a semicolon delimiter (Chinese Excel export)', () => {
    const r = parseCSV('a;b;c\n1;2;3\n')
    expect(r.headers).toEqual(['a', 'b', 'c'])
    expect(r.rows[0]).toEqual({ a: '1', b: '2', c: '3' })
  })

  it('does NOT coerce leading-zero ids (007 must stay 007)', () => {
    const r = parseCSV('id\n007\n7\n')
    expect(r.rows.map((row) => row.id)).toEqual(['007', '7'])
  })

  it('keeps CSV cells as strings — the Excel path keeps numbers (deliberate asymmetry)', () => {
    // CSV：不做 dynamicTyping，数值列在 rows 里是字符串 '5'。
    // Excel：保留 JS number 5（见 parseExcel 用例）。
    // 这个差异是刻意的；若有人再给 parseCSV 加 dynamicTyping，本断言会立刻变红。
    expect(parseCSV('a\n5\n').rows[0]['a']).toBe('5')
    expect(typeof parseCSV('a\n5\n').rows[0]['a']).toBe('string')
  })

  it('does NOT treat true/false columns as numeric', () => {
    const r = parseCSV('f\ntrue\nfalse\n')
    expect(r.columnInfo[0].type).toBe('string')
  })

  it('surfaces field-count mismatches as warnings instead of silent misalignment', () => {
    const r = parseCSV('a,b,c\n1,2,3,4\n5,6\n')
    const byCode = new Map((r.warnings ?? []).map((w) => [w.code, w]))
    expect(byCode.has('csv.TooManyFields')).toBe(true)
    expect(byCode.has('csv.TooFewFields')).toBe(true)
    expect(byCode.get('csv.TooManyFields')?.row).toBe(2)
    expect(byCode.get('csv.TooFewFields')?.row).toBe(3)
  })

  it('never leaks papaparse __parsed_extra into rows', () => {
    const r = parseCSV('a,b\n1,2,3\n')
    expect(Object.keys(r.rows[0])).toEqual(['a', 'b'])
    expect('__parsed_extra' in r.rows[0]).toBe(false)
  })

  it('counts NA and . as missing but keeps the column numeric', () => {
    const r = parseCSV('x\n1\n2\n3\n4\n5\n6\n7\n8\nNA\n.\n')
    expect(r.columnInfo[0]).toMatchObject({ type: 'numeric', missing: 2, total: 10 })
  })

  it('treats -999 as missing by default and reports it as a sentinel hit', () => {
    const r = parseCSV('v\n10\n20\n-999\n30\n')
    expect(r.columnInfo[0]).toMatchObject({ type: 'numeric', missing: 1, total: 4 })
    expect(r.sentinelHits).toEqual([{ column: 'v', sentinel: '-999', count: 1 }])
  })

  it('does NOT treat 99 as missing unless SPSS sentinels are enabled', () => {
    expect(parseCSV('v\n99\n50\n').columnInfo[0].missing).toBe(0)
    expect(parseCSV('v\n99\n50\n', undefined, { spssSentinels: true }).columnInfo[0].missing).toBe(1)
  })

  it('renames blank and duplicate headers so R never sees "" or a duplicate column', () => {
    expect(normalizeHeaders(['', 'b', '', 'b']).headers).toEqual(['V1', 'b', 'V3', 'b_2'])
  })

  it('does not warn about an undetectable delimiter for a single-column file', () => {
    expect(parseCSV('only\n1\n2\n').warnings).toEqual([])
  })

  it('keeps isNumericLike strict enough to avoid false numeric columns', () => {
    expect(isNumericLike('true')).toBe(false)
    expect(isNumericLike('0x10')).toBe(false)
    expect(isNumericLike('1e5')).toBe(true)
    expect(isNumericLike('007')).toBe(true)
  })

  it('parses GBK bytes end-to-end with the right headers', () => {
    const r = parseCSVBytes(GBK_BYTES, 'gbk.csv')
    expect(r.headers).toEqual(['姓名', '年龄', '成绩'])
    expect(r.rows[0]['姓名']).toBe('张三')
    expect(r.encodingInfo?.encoding).toBe('gb18030')
  })

  it('warns when the user forces an encoding that produces replacement chars', () => {
    const r = parseCSVBytes(GBK_BYTES, 'g.csv', { encoding: 'utf-8' })
    expect(warnCodes(r)).toContain('csv.encodingLossy')
  })
})

/** 用 SheetJS 造一个含日期、空表头、无缓存值公式与多 sheet 的工作簿 */
function buildWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(
    [
      ['name', '报名日期', '', 'gender'],
      ['张三', new Date(2024, 0, 14), 'x', '男'],
      ['李四', new Date(2024, 5, 1, 9, 30), 'y', '女']
    ],
    { cellDates: true }
  )
  // 有 <f> 无 <v>：Excel 打开时能算，导入时必须被显式警告而不是静默变空
  ws['D4'] = { t: 'n', f: 'COUNTA(A2:A3)' } as XLSX.CellObject
  ws['!ref'] = 'A1:D4'
  XLSX.utils.book_append_sheet(wb, ws, '第一表')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['q'], [1], [2]]), '第二表')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('parseExcel — Excel 日期、空表头、公式与 sheet 选择（T6 缺陷 3）', () => {
  const bytes = buildWorkbook()

  it('lists all sheets', async () => {
    expect(await listExcelSheets(bytes)).toEqual(['第一表', '第二表'])
  })

  it('keeps dates as dates instead of Excel serial numbers', async () => {
    const r = await parseExcel(bytes, 't.xlsx')
    expect(r.rows[0]['报名日期']).toBe('2024-01-14')
    expect(r.rows[1]['报名日期']).toBe('2024-06-01 09:30:00')
    expect(String(r.rows[0]['报名日期'])).not.toContain('45306')
    expect(r.columnInfo[1].type).not.toBe('numeric')
  })

  it('renames blank headers and warns', async () => {
    const r = await parseExcel(bytes, 't.xlsx')
    expect(r.headers).toEqual(['name', '报名日期', 'V3', 'gender'])
    expect(warnCodes(r)).toContain('excel.blankHeader')
  })

  it('warns about formula cells without a cached value', async () => {
    const r = await parseExcel(bytes, 't.xlsx')
    const w = (r.warnings ?? []).find((x) => x.code === 'excel.formulaNoCache')
    expect(w, 'excel.formulaNoCache 警告缺失 → 无缓存公式会静默变空').toBeDefined()
    expect(w?.count).toBe(1)
  })

  it('exposes sheet names on the dataset and honours an explicit sheetName', async () => {
    const r = await parseExcel(bytes, 't.xlsx')
    expect(r.sheets).toEqual(['第一表', '第二表'])
    expect(r.sheetName).toBe('第一表')

    const second = await parseExcel(bytes, 't.xlsx', { sheetName: '第二表' })
    expect(second.headers).toEqual(['q'])
  })

  it('warns when the requested sheet does not exist (and falls back to the first)', async () => {
    const r = await parseExcel(bytes, 't.xlsx', { sheetName: '不存在' })
    expect(warnCodes(r)).toContain('excel.sheetNotFound')
    expect(r.headers).toEqual(['name', '报名日期', 'V3', 'gender'])
  })

  it('skips truly blank rows but keeps row alignment, and blanks error cells', async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2], [], [5, 6]])
    ws['B4'] = { t: 'e', v: 0x07, w: '#DIV/0!' } as XLSX.CellObject
    ws['!ref'] = 'A1:B4'
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const r = await parseExcel(buf, 'err.xlsx')
    expect(r.rows).toHaveLength(2)
    expect(r.rows[1]['a']).toBe(5)
    expect(r.rows[1]['b']).toBe('')
    expect(warnCodes(r)).toContain('excel.errorCells')
  })

  it('treats the sentinel set consistently between CSV and Excel', () => {
    expect(sentinelsFor(false)).toContain('NA')
    expect(sentinelsFor(true)).toContain('99')
    expect(sentinelsFor(false)).not.toContain('99')
  })
})
