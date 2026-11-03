import { describe, it, expect } from 'vitest'
import { parseCSV } from '../dataService'
import { checkDataQuality, inferLikertMax } from '../dataQuality'

/**
 * F3 / F2 / F4 的接线测试（v0.3.3 跟进）
 *
 * 背景：第三方跟进验证发现 `checkDataQuality()` 有实现、有 36 个单测，
 * 但**没有任何调用点**——纯函数正确、用户完全看不到，等于没做。
 *
 * 这组用例钉住"真的接上了"这件事，而不只是纯函数能算对。
 */
describe('导入路径接线数据质量检查（F3）', () => {
  const csvOf = (header: string, rows: string[][]): string =>
    [header, ...rows.map((r) => r.join(','))].join('\n') + '\n'

  it('注入 1 个极端值 → ParseResult.qualityIssues 含该列的 outlier', () => {
    const rows: string[][] = []
    for (let i = 0; i < 90; i++) rows.push([`G${(i % 3) + 1}`, String(10 + (i % 3) * 4 + (i % 7) * 0.1)])
    rows[0][1] = '1000000'
    const r = parseCSV(csvOf('grp,score', rows), 'dirty.csv')
    expect(r.qualityIssues, 'qualityIssues 字段应存在（这就是接线本身）').toBeDefined()
    const hit = (r.qualityIssues ?? []).find((x) => x.kind === 'outlier' && x.column === 'score')
    expect(hit, '注入的 1e6 未被检出').toBeDefined()
    expect(hit!.rows).toContain(1)
    expect(hit!.level).toBe('warn')
  })

  it('干净的大样本数据 → qualityIssues 为空（防误报，与检出同等重要）', () => {
    const rows: string[][] = []
    for (let i = 0; i < 60; i++) rows.push([String(1 + (i % 5)), String(1 + ((i * 3) % 5))])
    const r = parseCSV(csvOf('q1,q2', rows), 'clean.csv')
    expect(r.qualityIssues ?? []).toHaveLength(0)
  })

  it('干净的小样本数据（n=12）→ 也为空（F4：原实现在此有 4 条误报）', () => {
    const rows: string[][] = []
    let s = 999
    const rnd = (): number => {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0
      return s / 4294967296
    }
    for (let i = 0; i < 12; i++) {
      rows.push([0, 1, 2, 3, 4].map(() => String(1 + Math.floor(rnd() * 5))))
    }
    const r = parseCSV(csvOf('q1,q2,q3,q4,q5', rows), 'small.csv')
    expect(r.qualityIssues ?? [], '小样本干净数据不应报极端值（误报会让真警报失效）').toHaveLength(0)
  })

  it('缺失 40% 的列 → 检出 high_missing', () => {
    // ⚠️ 不能用空字符串造缺失：PapaParse 会把只含一列且值为空的行当成空行跳过，
    // 结果行数从 10 变 6，测试数据本身就不成立（实测踩过）。
    // 用显式哨兵 "NA" 才可靠——它会被 normalizeMissingValues 归一成缺失。
    const rows: string[][] = []
    for (let i = 0; i < 10; i++) rows.push([i < 4 ? 'NA' : String(i + 1)])
    const r = parseCSV(csvOf('score', rows), 'missing.csv')
    expect(r.rows, '10 行数据应完整保留').toHaveLength(10)
    const hit = (r.qualityIssues ?? []).find((x) => x.kind === 'high_missing' && x.column === 'score')
    expect(hit).toBeDefined()
    expect(hit!.count).toBe(4)
  })

  it('5 点量表里出现 7 / 0 → 检出 out_of_range（F2 量表上限推断）', () => {
    const rows: string[][] = []
    for (let i = 0; i < 40; i++) rows.push([0, 1, 2, 3, 4].map((j) => String(1 + ((i + j) % 5))))
    rows[0][4] = '7'
    rows[1][4] = '0'
    const r = parseCSV(csvOf('q1,q2,q3,q4,q5', rows), 'range.csv')
    const hit = (r.qualityIssues ?? []).find((x) => x.kind === 'out_of_range' && x.column === 'q5')
    expect(hit, 'q5 的 7/0 未被检出——说明量表上限没能推断出来').toBeDefined()
    expect(hit!.count).toBe(2)
  })
})

describe('量表上限推断 inferLikertMax（F2）', () => {
  const rowsOf = (cols: Record<string, number[]>): Record<string, unknown>[] => {
    const n = Math.max(...Object.values(cols).map((v) => v.length))
    return Array.from({ length: n }, (_, i) => {
      const r: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(cols)) r[k] = v[i] ?? null
      return r
    })
  }

  it('多个 1–5 题项 → 推断出上限 5', () => {
    const rows = rowsOf({
      q1: [1, 2, 3, 4, 5, 5, 4, 3],
      q2: [1, 2, 3, 4, 5, 5, 3, 2],
      q3: [2, 3, 4, 5, 5, 4, 3, 2],
      q4: [1, 1, 2, 3, 4, 5, 5, 4]
    })
    const m = inferLikertMax(['q1', 'q2', 'q3', 'q4'], rows)
    expect(m.q1).toBe(5)
    expect(m.q4).toBe(5)
  })

  it('连续变量（非整数）不参与推断，也不被套上限', () => {
    const rows = rowsOf({
      age: [20.5, 31.2, 45.7, 52.1, 33.3, 61.8, 28.9, 44.4],
      income: [3000.5, 5200.1, 7800.9, 12000.2, 4500.7, 9000.3, 6100.4, 3300.8]
    })
    const m = inferLikertMax(['age', 'income'], rows)
    expect(m.age).toBeUndefined()
    expect(m.income).toBeUndefined()
  })

  it('题项太少（<3 个）时不推断 —— 宁可不报，不可误报', () => {
    const rows = rowsOf({ q1: [1, 2, 3, 4, 5], q2: [1, 2, 3, 4, 5] })
    expect(inferLikertMax(['q1', 'q2'], rows)).toEqual({})
  })

  it('各题上限分歧过大（无 ≥60% 共识）→ 不推断', () => {
    const rows = rowsOf({
      a: [1, 2, 3, 4, 5, 5, 4],
      b: [1, 2, 3, 4, 7, 7, 6],
      c: [1, 2, 3, 4, 9, 9, 8],
      d: [1, 2, 3, 4, 10, 10, 9]
    })
    const m = inferLikertMax(['a', 'b', 'c', 'd'], rows)
    expect(m.a).toBeUndefined()
  })
})

describe('分级与样本量自适应（F4）', () => {
  it('严重极端值标 warn，轻微标 note', () => {
    // 构造：绝大部分在 10 附近，一个 1e6（严重），一个略远（轻微）
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 60; i++) rows.push({ x: 10 + (i % 5) * 0.1 })
    rows[0].x = 1e6
    const issues = checkDataQuality(['x'], rows)
    const out = issues.find((i) => i.kind === 'outlier')
    expect(out).toBeDefined()
    expect(out!.level).toBe('warn')
  })

  it('小样本（n<20）即便有轻微微极端值也不报 note', () => {
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 12; i++) rows.push({ x: i + 1 })
    const issues = checkDataQuality(['x'], rows)
    expect(issues.filter((i) => i.kind === 'outlier' && i.level === 'note')).toHaveLength(0)
  })
})
