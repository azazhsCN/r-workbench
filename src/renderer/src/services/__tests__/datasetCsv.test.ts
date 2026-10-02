import { describe, it, expect } from 'vitest'
import { datasetToCSV, parseCSV } from '../dataService'

/**
 * datasetToCSV → parseCSV 往返测试。
 *
 * 断言“列顺序 + 单元格值”在 CSV 序列化/反序列化后逐格不变，
 * 特别是含逗号、双引号、换行、中文、空单元格的值（历史上 CSV 转义丢失的正是这一类）。
 */
describe('datasetToCSV — CSV 往返', () => {
  const headers = ['id', 'name', 'note', 'score']

  const rows: Record<string, unknown>[] = [
    { id: '1', name: '张三', note: 'a,b', score: '1.5' },
    { id: '2', name: 'say "hi"', note: 'line1\nline2', score: '2' },
    { id: '3', name: "O'Brien", note: '', score: '3.25' },
    { id: '4', name: 'tab\there', note: 'semi;colon', score: '-0.5' }
  ]

  it('emits a header row in the requested column order', () => {
    const csv = datasetToCSV(headers, rows)
    const firstLine = csv.split(/\r?\n/)[0]
    expect(firstLine).toBe('id,name,note,score')
  })

  it('survives a round trip with headers and every cell value intact', () => {
    const csv = datasetToCSV(headers, rows)
    const parsed = parseCSV(csv, 'data.csv')

    expect(parsed.headers).toEqual(headers)
    expect(parsed.rows).toHaveLength(rows.length)

    for (let i = 0; i < rows.length; i++) {
      for (const h of headers) {
        expect(String(parsed.rows[i][h] ?? '')).toBe(String(rows[i][h]))
      }
    }
  })

  it('keeps the declared header order even when row objects use a different key order', () => {
    const scrambled: Record<string, unknown>[] = [
      { score: '4', note: 'n', name: '李四', id: '9' },
      { note: 'm', id: '10', score: '5', name: '王五' }
    ]
    const csv = datasetToCSV(headers, scrambled)
    expect(csv.split(/\r?\n/)[0]).toBe('id,name,note,score')

    const parsed = parseCSV(csv, 'data.csv')
    expect(parsed.headers).toEqual(headers)
    expect(String(parsed.rows[0].id)).toBe('9')
    expect(String(parsed.rows[1].name)).toBe('王五')
  })

  it('quotes values containing the delimiter or a quote so they cannot shift columns', () => {
    const tricky: Record<string, unknown>[] = [
      { a: 'x,y', b: 'p"q', c: 'r\ns' },
      { a: '1', b: '2', c: '3' }
    ]
    const csv = datasetToCSV(['a', 'b', 'c'], tricky)
    const parsed = parseCSV(csv, 'data.csv')

    expect(parsed.headers).toEqual(['a', 'b', 'c'])
    expect(parsed.rows).toHaveLength(2)
    expect(String(parsed.rows[0].a)).toBe('x,y')
    expect(String(parsed.rows[0].b)).toBe('p"q')
    expect(String(parsed.rows[0].c)).toBe('r\ns')
    expect(String(parsed.rows[1].a)).toBe('1')
    expect(String(parsed.rows[1].b)).toBe('2')
    expect(String(parsed.rows[1].c)).toBe('3')
  })

  it('preserves non-ASCII column names', () => {
    const zhHeaders = ['编号', '性别', '得分']
    const csv = datasetToCSV(zhHeaders, [{ 编号: '1', 性别: '男', 得分: '88' }])
    const parsed = parseCSV(csv, 'data.csv')
    expect(parsed.headers).toEqual(zhHeaders)
    expect(String(parsed.rows[0]['性别'])).toBe('男')
    expect(String(parsed.rows[0]['得分'])).toBe('88')
  })

  it('round-trips a numeric value that R will read back identically', () => {
    const csv = datasetToCSV(['x'], [{ x: 0.1 }, { x: -2.5 }, { x: 1e-7 }])
    const parsed = parseCSV(csv, 'data.csv')
    expect(Number(parsed.rows[0].x)).toBe(0.1)
    expect(Number(parsed.rows[1].x)).toBe(-2.5)
    expect(Number(parsed.rows[2].x)).toBeCloseTo(1e-7, 15)
  })
})
