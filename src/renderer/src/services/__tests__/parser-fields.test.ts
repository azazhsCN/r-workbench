/**
 * 字段级解析断言（v0.2.7 / T32）
 *
 * 为什么需要这一层：`r-contract.test.ts` 对 t 检验的表格断言只有
 *   expect(parseROutput(out).tables.length).toBeGreaterThan(0)
 * —— 只断言"有表"，不断言"数对不对"。于是 v0.2.6 中两处列错位
 * （独立样本 t 把 CI 下限当均值差、单样本 t 把 p 值当 CI 下限、
 * 把 CI 上限当 Cohen's d）在 158 个测试全绿的情况下存在了一整个版本。
 *
 * 而 282 项 R 验证校验的是"R 算得对不对"，不校验"TS 解析器读得对不对"。
 * 两层都真，中间的翻译过程无人看守。本文件补的正是这条缝隙。
 *
 * 原则：**断言具体数值，并强制表与 keyValues 一致**。
 */

import { describe, it, expect } from 'vitest'
import { parseROutput } from '../resultParser'

/** 取标题包含指定片段的表 */
function tableOf(tables: ReturnType<typeof parseROutput>['tables'], keyword: string) {
  const t = tables.find((x) => x.title.includes(keyword))
  if (!t) throw new Error(`未找到包含 "${keyword}" 的表，实际表：${tables.map((x) => x.title).join(' / ')}`)
  return t
}

describe('字段级断言：独立样本 t 检验（D1 回归防护）', () => {
  // 与 rService.tTestIndependentCode 的 sprintf 契约一致：
  //   RESULT_IND|t|df|p展示|p原始|均值差|CI下限|CI上限|Cohen's d|合并方差p
  const OUT = [
    '=== 独立样本 t 检验 ===',
    'GRP|0|19|17.1474|3.8340',
    'GRP|1|19|20.6633|2.9097',
    'RESULT_IND|-3.7671|18.33|p = 0.001|0.0014|-7.2449|-11.2805|-3.2093|1.2|0.0606',
    'RESULT_POOLED|-3.7671|58.00|p < 0.001|0.0000',
    'CONCL|两组差异具有统计学意义'
  ].join('\n')

  it('每个统计量的数值都正确（不是"有值"而是"值对"）', () => {
    const t = tableOf(parseROutput(OUT).tables, '独立样本 t 检验结果')
    expect(t.rows).toHaveLength(1)
    const row = t.rows[0]
    expect(row[0]).toBeCloseTo(-3.7671, 4) // t
    expect(row[1]).toBeCloseTo(18.33, 2) // df（Welch，保留小数）
    expect(String(row[2])).toBe('p = 0.001') // p 展示串
    expect(row[3]).toBeCloseTo(-7.2449, 4) // 均值差 ← D1 曾误取 f[6]
    expect(row[4]).toBeCloseTo(-11.2805, 4) // CI 下限
    expect(row[5]).toBeCloseTo(-3.2093, 4) // CI 上限
    expect(row[6]).toBeCloseTo(1.2, 4) // Cohen's d
  })

  it('均值差 与 CI 下限 是两个不同的值（D1 的直接回归断言）', () => {
    const t = tableOf(parseROutput(OUT).tables, '独立样本 t 检验结果')
    // v0.2.6 的 bug 让两者都等于 -11.2805
    expect(t.rows[0][3]).not.toBe(t.rows[0][4])
  })

  it('表与 keyValues 必须一致（同一统计量不得出现两个值）', () => {
    const parsed = parseROutput(OUT)
    const t = tableOf(parsed.tables, '独立样本 t 检验结果')
    expect(t.rows[0][3]).toBeCloseTo(Number(parsed.keyValues['均值差']), 6)
    expect(t.rows[0][6]).toBeCloseTo(Number(parsed.keyValues['cohen_d']), 6)
    expect(parsed.keyValues['t']).toBeCloseTo(-3.7671, 4)
    expect(parsed.keyValues['p']).toBeCloseTo(0.0014, 6)
  })
})

describe('字段级断言：单样本 t 检验（D2 回归防护）', () => {
  // RESULT_ONE|t|df|p展示|p原始|CI下限|CI上限|Cohen's d
  const OUT = [
    '=== 单样本 t 检验 ===',
    'DESC_ONE|score|32|20.0906|6.0269|20.0',
    'RESULT_ONE|0.0851|31.00|p = 0.933|0.9328|-2.0827|2.2636|0.0150',
    'MU_IN_CI|是',
    'CONCL|样本均值与检验值差异无统计学意义'
  ].join('\n')

  it('每个统计量的数值都正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '单样本 t 检验结果')
    const row = t.rows[0]
    expect(row[0]).toBeCloseTo(0.0851, 4) // t
    expect(row[1]).toBeCloseTo(31, 2) // df
    expect(String(row[2])).toBe('p = 0.933')
    expect(row[3]).toBeCloseTo(-2.0827, 4) // CI 下限 ← D2 曾取成 p 值 0.9328
    expect(row[4]).toBeCloseTo(2.2636, 4) // CI 上限
    expect(row[5]).toBeCloseTo(0.015, 4) // Cohen's d ← D2 曾取成 CI 上限 2.2636
  })

  it('CI 下限 不等于 p 值（D2 的直接回归断言）', () => {
    const parsed = parseROutput(OUT)
    const t = tableOf(parsed.tables, '单样本 t 检验结果')
    expect(Number(t.rows[0][3])).not.toBeCloseTo(Number(parsed.keyValues['p']), 6)
  })

  it('Cohen\'s d 不等于 CI 上限（D2 的直接回归断言）', () => {
    const t = tableOf(parseROutput(OUT).tables, '单样本 t 检验结果')
    expect(Number(t.rows[0][5])).not.toBeCloseTo(Number(t.rows[0][4]), 6)
  })

  it('表与 keyValues 必须一致', () => {
    const parsed = parseROutput(OUT)
    const t = tableOf(parsed.tables, '单样本 t 检验结果')
    expect(t.rows[0][5]).toBeCloseTo(Number(parsed.keyValues['cohen_d']), 6)
  })
})

describe('字段级断言：配对样本 t 检验', () => {
  // RESULT_PAIRED|t|df|p展示|p原始|均值差|CI下限|CI上限|Cohen's dz
  const OUT = [
    '=== 配对样本 t 检验 ===',
    'PAIRS|pre|post|10|2.0|1.5',
    'PAIR_COR|0.9105',
    'RESULT_PAIRED|-4.0621|9.00|p = 0.003|0.0028|2.0000|0.8861|3.1139|1.2847',
    'CONCL|两次测量差异具有统计学意义'
  ].join('\n')

  it('均值差 / CI / 效应量 均取正确字段', () => {
    const t = tableOf(parseROutput(OUT).tables, '配对样本 t 检验结果')
    const row = t.rows[0]
    expect(row[0]).toBeCloseTo(-4.0621, 4)
    expect(row[1]).toBeCloseTo(9, 2)
    expect(row[3]).toBeCloseTo(2.0, 4) // 均值差
    expect(row[4]).toBeCloseTo(0.8861, 4) // CI 下限
    expect(row[5]).toBeCloseTo(3.1139, 4) // CI 上限
  })

  it('表与 keyValues 的均值差一致', () => {
    const parsed = parseROutput(OUT)
    const t = tableOf(parsed.tables, '配对样本 t 检验结果')
    // 配对检验里该统计量的键名是「差值均值」（差值的均值），不是「均值差」
    expect(t.rows[0][3]).toBeCloseTo(Number(parsed.keyValues['差值均值']), 6)
  })
})

describe('字段级断言：ANOVA', () => {
  const OUT = [
    '=== 单因素方差分析 ===',
    'LEVELS|3|L1,L2,L3',
    'ANOVA_ROW|组间|2|63.2121|31.6061|119.2645|p < 0.001|1.6696692e-31',
    'ANOVA_ROW|组内|147|38.9562|0.2650|NA|NA|NA',
    'EFFECT|eta2|0.6187',
    'EFFECT|omega2|0.6139',
    'CONCL|各组均值差异具有统计学意义'
  ].join('\n')

  it('F 与 p 从正确列读取（不是从 Df 列）', () => {
    const parsed = parseROutput(OUT)
    expect(parsed.keyValues['F']).toBeCloseTo(119.2645, 3)
    expect(Number(parsed.keyValues['p'])).toBeLessThan(1e-20)
  })

  it('表格 Df/SS/MS/F/p 各列数值正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '方差分析')
    const row = t.rows.find((r) => String(r[0]).includes('组间'))!
    expect(row[1]).toBeCloseTo(2, 0) // Df
    expect(row[2]).toBeCloseTo(63.2121, 3) // SS
    expect(row[3]).toBeCloseTo(31.6061, 3) // MS
    expect(row[4]).toBeCloseTo(119.2645, 3) // F
  })
})

describe('字段级断言：描述性统计不丢含负值/科学计数的变量', () => {
  const OUT = [
    '=== 描述性统计 ===',
    'neg|5|-4.5000|1.5811|-6.5000|-2.5000|-4.5000',
    '__INFO__:neg|缺失=0|总计=5',
    'sci|5|0.0000|0.0000|1.2e-05|1.2e-05|1.2e-05'
  ].join('\n')

  it('所有变量都在，且数值符号正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '描述性统计结果')
    expect(t.rows).toHaveLength(2)
    expect(t.rows[0][2]).toBeCloseTo(-4.5, 4) // 均值（负值不得丢失）
    expect(t.rows[0][4]).toBeCloseTo(-6.5, 4) // 最小值
    expect(t.rows[1][4]).toBeCloseTo(1.2e-5, 10) // 科学计数
  })
})

describe('字段级断言：EFA 探索性因子分析', () => {
  // 真实 R 输出形态（base R 实现，非 psych）
  const OUT = [
    '=== 探索性因子分析 (EFA) ===',
    'BARTLETT|549.4197|28|p < 0.001|2.0876321e-309',
    'KMO|0.8475',
    'KMO_ITEM|q1|0.8202',
    'KMO_ITEM|q2|0.8271',
    'NFACTOR|2',
    'EIGEN|1|3.2651|40.81|40.81',
    'EIGEN|2|2.9818|37.27|78.09',
    'LOAD_HEAD|item|F1|F2|communality',
    'LOAD|q1|0.0454|0.8822|0.7803',
    'LOAD|q2|0.0322|0.8739|0.7647',
    'LOAD|q5|0.9137|-0.0156|0.8350',
    'LOAD|q6|0.9112|-0.0057|0.8303',
    'PRIMARY|q1|2',
    'PRIMARY|q2|2',
    'PRIMARY|q5|1',
    'PRIMARY|q6|1',
    'CONCL|KMO = 0.848（适合），Bartlett 检验显著'
  ].join('\n')

  it('KMO 与 Bartlett 的数值正确', () => {
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['KMO'])).toBeCloseTo(0.8475, 4)
    expect(Number(kv['Bartlett χ²'])).toBeCloseTo(549.4197, 3)
    expect(Number(kv['Bartlett df'])).toBe(28)
    expect(Number(kv['Bartlett p'])).toBeLessThan(1e-300)
    expect(Number(kv['因子数'])).toBe(2)
  })

  it('生成三张表：KMO/Bartlett、方差解释、载荷矩阵', () => {
    const t = parseROutput(OUT).tables
    expect(t.length).toBe(3)
    expect(t[0].title).toContain('KMO')
    expect(t[1].title).toContain('方差解释')
    expect(t[2].title).toContain('载荷')
  })

  it('载荷表列数由 R 声明的表头决定（动态因子数）', () => {
    const loadTable = tableOf(parseROutput(OUT).tables, '载荷')
    // LOAD_HEAD|item|F1|F2|communality → 4 列
    expect(loadTable.headers).toEqual(['item', 'F1', 'F2', 'communality'])
    expect(loadTable.rows).toHaveLength(4)
  })

  it('载荷数值逐格正确（含负载荷不被丢弃）', () => {
    const loadTable = tableOf(parseROutput(OUT).tables, '载荷')
    const q1 = loadTable.rows.find((r) => r[0] === 'q1')!
    expect(Number(q1[1])).toBeCloseTo(0.0454, 4) // F1
    expect(Number(q1[2])).toBeCloseTo(0.8822, 4) // F2
    expect(Number(q1[3])).toBeCloseTo(0.7803, 4) // 共同度

    const q5 = loadTable.rows.find((r) => r[0] === 'q5')!
    expect(Number(q5[1])).toBeCloseTo(0.9137, 4)
    expect(Number(q5[2])).toBeCloseTo(-0.0156, 4) // 负载荷必须保留
  })

  it('因子归属正确归并题目', () => {
    const kv = parseROutput(OUT).keyValues
    expect(String(kv['因子归属'])).toContain('F1: q5, q6')
    expect(String(kv['因子归属'])).toContain('F2: q1, q2')
  })

  it('累计方差解释从最后一行 EIGEN 取（不是第一行）', () => {
    expect(String(parseROutput(OUT).keyValues['累计方差解释'])).toBe('78.09%')
  })

  it('KMO 与 Bartlett 进入 diagnostics（供统计前提校验使用）', () => {
    const d = parseROutput(OUT).diagnostics
    expect(d.some((x) => x.label.includes('KMO'))).toBe(true)
    expect(d.some((x) => x.label.includes('Bartlett'))).toBe(true)
  })
})
