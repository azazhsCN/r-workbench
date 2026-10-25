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
import { parseROutput, detectAnalysisType } from '../resultParser'

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

/* ═══════════════════════════════════════════════════════════════════════
 * v0.3.1 效度线：CFA / CVI / Harman 的字段级断言
 *
 * 为什么这三组仍然必须逐格断言：
 *   - CFA 一张表里并排 5 个 4 位小数（CFI / TLI / RMSEA / SRMR / χ²/df）。
 *     `CFA_FITIDX|cfi|tli|rmsea|srmr` 若整体错一位，表仍然"有数据、看着像小数"，
 *     但"拟合良好"会变成"拟合不佳"——而这张表是论文方法章节的直接来源。
 *   - CVI 的 `CVI_ITEM|item|n_relevant|n_experts|i_cvi|kappa|p_c|verdict` 里
 *     i_cvi / kappa / p_c 三个都是 0–1 小数，错位后每个值**依然落在合法区间**，
 *     没有任何类型或范围检查会报警（这与 v0.2.6「CI 下限被当成 p 值」同构）。
 *   - Harman 的 eigenvalue（2.7412）与 first_pct（45.69）量纲差一个数量级，
 *     错位后 45.69 会被当成"特征值"，结论直接反转。
 * 断言方式：取具体单元格的具体数值 + 强制表与 keyValues 一致。
 * ═══════════════════════════════════════════════════════════════════════ */

/** 取表中第一列等于给定标签的行（表为「指标 / 数值 / …」形态时用它） */
function rowOf(t: { rows: (string | number)[][] }, label: string): (string | number)[] {
  const row = t.rows.find((r) => String(r[0]) === label)
  if (!row) throw new Error(`未找到标签为 "${label}" 的行，实际：${t.rows.map((r) => r[0]).join(' / ')}`)
  return row
}

describe('v0.3.1 类型判定：仍然只认横幅（禁止 output.includes）', () => {
  it('三个新横幅各自映射到 cfa / cvi / harman', () => {
    expect(detectAnalysisType('=== 验证性因子分析 (CFA) ===\nCFA_SPEC|2|6|300')).toBe('cfa')
    expect(detectAnalysisType('=== 内容效度指数 (CVI) ===\nCVI_SPEC|5|6')).toBe('cvi')
    expect(detectAnalysisType('=== Harman 单因子检验 ===\nHARMAN_SPEC|6|300')).toBe('harman')
  })

  it('「探索性因子分析」与「验证性因子分析」不互相误判（前缀不可互换）', () => {
    expect(detectAnalysisType('=== 探索性因子分析 (EFA) ===\nNFACTOR|2')).toBe('efa')
    expect(detectAnalysisType('=== 验证性因子分析 (CFA) ===\nCFA_SPEC|1|3|100')).toBe('cfa')
  })

  it('正文里出现方法名但没有横幅 → unknown（证明判定不是子串匹配）', () => {
    // 若有人把实现退回 `output.includes('验证性因子分析')`，这三条会立刻变红。
    expect(detectAnalysisType('本次做了验证性因子分析，结果见附件')).toBe('unknown')
    expect(detectAnalysisType('CVI_SPEC|5|6\n专家数 6，内容效度指数尚可')).toBe('unknown')
    expect(detectAnalysisType('HARMAN_SPEC|6|300\nHarman 单因子检验结果')).toBe('unknown')
  })

  it('Harman 横幅容忍多余空格（R 端排版风险），但仍须位于横幅开头', () => {
    expect(detectAnalysisType('===  Harman  单因子检验 ===')).toBe('harman')
    expect(detectAnalysisType('=== 前言 | Harman 单因子检验 ===')).toBe('unknown')
  })
})

describe('字段级断言：CFA 验证性因子分析', () => {
  // 真实 R 输出形态（纯 base R 实现，见 V031_CONTRACT.md 第一节）
  //   2 因子 / 6 题项 / n = 300
  const OUT = [
    '=== 验证性因子分析 (CFA) ===',
    'CFA_SPEC|2|6|300',
    'CFA_ITEM|q1|1',
    'CFA_ITEM|q2|1',
    'CFA_ITEM|q3|1',
    'CFA_ITEM|q4|2',
    'CFA_ITEM|q5|2',
    'CFA_ITEM|q6|2',
    'CFA_MODEL|F1 =~ q1 + q2 + q3',
    'CFA_MODEL|F2 =~ q4 + q5 + q6',
    'CFA_FIT|12.4831|8|p = 0.131|0.1306',
    'CFA_FITIDX|0.9912|0.9835|0.0432|0.0271',
    'CFA_NULLMODEL|742.1908|15',
    'CFA_ESTIMATE|q1|0.8123|0.9987|0.0412|19.7151|p < 0.001|1.2e-60|0.6598',
    'CFA_ESTIMATE|q2|0.8451|1.1204|0.0387|21.8360|p < 0.001|4.5e-70|0.7142',
    'CFA_ESTIMATE|q3|0.7889|0.9502|0.0428|18.4322|p < 0.001|2.8e-58|0.6224',
    'CFA_ESTIMATE|q4|0.8027|1.0031|0.0419|19.1575|p < 0.001|6.1e-62|0.6443',
    'CFA_ESTIMATE|q5|0.7694|0.9188|0.0441|17.4490|p < 0.001|1.7e-53|0.5920',
    'CFA_ESTIMATE|q6|0.8316|1.0745|0.0395|21.0570|p < 0.001|9.3e-68|0.6916',
    'CFA_FACTOR|F1|F2|0.4137|0.0612|6.7598|p < 0.001|3.1e-11',
    'CFA_RELIAB|F1|0.8421|0.6412|0.8007',
    'CFA_RELIAB|F2|0.8310|0.6218|0.7886',
    'CFA_NOTE|样本量充足（n = 300），未检出 Heywood 案例',
    'CONCL|2 因子模型拟合良好（CFI = 0.9912，RMSEA = 0.0432）'
  ].join('\n')

  it('CFA_SPEC / CFA_MODEL 的四个字段各就各位', () => {
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['因子数'])).toBe(2)
    expect(Number(kv['题项数'])).toBe(6)
    expect(Number(kv['样本量'])).toBe(300)
    expect(String(kv['模型语法'])).toBe('F1 =~ q1 + q2 + q3 | F2 =~ q4 + q5 + q6')
  })

  it('表1 模型拟合指标：χ²/df/p/CFI/TLI/RMSEA/SRMR 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '模型拟合指标')
    expect(t.headers).toEqual(['指标', '数值', '参考标准'])
    // χ² 与 df 是两个不同字段，不能相等（错位时最常见的表现就是两者相等）
    expect(Number(rowOf(t, 'χ²')[1])).toBeCloseTo(12.4831, 4)
    expect(Number(rowOf(t, 'df')[1])).toBe(8)
    expect(String(rowOf(t, 'p')[1])).toBe('p = 0.131') // p_display，不是 raw 0.1306
    expect(Number(rowOf(t, 'χ²/df')[1])).toBeCloseTo(1.5604, 4)
    expect(Number(rowOf(t, 'CFI')[1])).toBeCloseTo(0.9912, 4)
    expect(Number(rowOf(t, 'TLI')[1])).toBeCloseTo(0.9835, 4)
    expect(Number(rowOf(t, 'RMSEA')[1])).toBeCloseTo(0.0432, 4)
    expect(Number(rowOf(t, 'SRMR')[1])).toBeCloseTo(0.0271, 4)
    // 零模型：CFI/TLI 的分母来源，错位会让 CFI 变成 null 或荒谬值
    expect(Number(rowOf(t, '零模型 χ²')[1])).toBeCloseTo(742.1908, 4)
    expect(Number(rowOf(t, '零模型 df')[1])).toBe(15)
  })

  it('CFI ≠ TLI ≠ RMSEA ≠ SRMR（四个指标互不相同，错位必然被抓住）', () => {
    const t = tableOf(parseROutput(OUT).tables, '模型拟合指标')
    const v = ['CFI', 'TLI', 'RMSEA', 'SRMR'].map((k) => Number(rowOf(t, k)[1]))
    expect(new Set(v).size).toBe(4)
  })

  it('表2 标准化载荷：题项 / 因子 / 载荷 / SE / z / p / R² 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '标准化因子载荷')
    expect(t.headers).toEqual(['题项', '因子', '标准化载荷', '非标准化载荷', 'SE', 'z', 'p', 'R²'])
    expect(t.rows).toHaveLength(6)

    const q1 = t.rows.find((r) => r[0] === 'q1')!
    expect(q1[1]).toBe(1) // 所属因子（来自 CFA_ITEM，不是行序推断）
    expect(q1[2]).toBeCloseTo(0.8123, 4) // std_load ← f[2]
    expect(q1[3]).toBeCloseTo(0.9987, 4) // unstd_load ← f[3]
    expect(q1[4]).toBeCloseTo(0.0412, 4) // SE ← f[4]
    expect(q1[5]).toBeCloseTo(19.7151, 4) // z ← f[5]
    expect(String(q1[6])).toBe('p < 0.001') // p_display ← f[6]（不是 raw 1.2e-60）
    expect(q1[7]).toBeCloseTo(0.6598, 4) // R² ← f[8]

    const q6 = t.rows.find((r) => r[0] === 'q6')!
    expect(q6[1]).toBe(2)
    expect(q6[2]).toBeCloseTo(0.8316, 4)
    expect(q6[7]).toBeCloseTo(0.6916, 4)

    // 因子归属：q1..q3 → 1、q4..q6 → 2（CFA_ITEM 决定，与 CFA_ESTIMATE 顺序无关）
    expect(t.rows.filter((r) => r[1] === 1).map((r) => r[0])).toEqual(['q1', 'q2', 'q3'])
    expect(t.rows.filter((r) => r[1] === 2).map((r) => r[0])).toEqual(['q4', 'q5', 'q6'])
  })

  it('R² 与标准化载荷²一致（内部一致性：两个字段不得各算一遍）', () => {
    const t = tableOf(parseROutput(OUT).tables, '标准化因子载荷')
    for (const r of t.rows) {
      const load = Number(r[2])
      const r2 = Number(r[7])
      expect(r2).toBeCloseTo(load * load, 4)
    }
  })

  it('表3 因子间相关：相关系数 / SE / z / p 各取正确下标', () => {
    const t = tableOf(parseROutput(OUT).tables, '因子间相关')
    expect(t.headers).toEqual(['因子对', '相关系数', 'SE', 'z', 'p'])
    expect(t.rows).toHaveLength(1)
    expect(String(t.rows[0][0])).toBe('F1 ↔ F2')
    expect(Number(t.rows[0][1])).toBeCloseTo(0.4137, 4) // cor ← f[3]（不是 f[4] 的 SE 0.0612）
    expect(Number(t.rows[0][2])).toBeCloseTo(0.0612, 4) // se  ← f[4]
    expect(Number(t.rows[0][3])).toBeCloseTo(6.7598, 4) // z   ← f[5]
    expect(String(t.rows[0][4])).toBe('p < 0.001') // p   ← f[6]
  })

  it('表4 组合信度：CR / AVE / √AVE 各取正确下标', () => {
    const t = tableOf(parseROutput(OUT).tables, '组合信度')
    expect(t.headers).toEqual(['因子', 'CR', 'AVE', '√AVE'])
    expect(t.rows).toHaveLength(2)
    const f1 = t.rows.find((r) => r[0] === 'F1')!
    expect(Number(f1[1])).toBeCloseTo(0.8421, 4) // cr       ← f[2]
    expect(Number(f1[2])).toBeCloseTo(0.6412, 4) // ave      ← f[3]
    expect(Number(f1[3])).toBeCloseTo(0.8007, 4) // sqrt_ave ← f[4]
    const f2 = t.rows.find((r) => r[0] === 'F2')!
    expect(Number(f2[1])).toBeCloseTo(0.831, 4)
    expect(Number(f2[2])).toBeCloseTo(0.6218, 4)
    expect(Number(f2[3])).toBeCloseTo(0.7886, 4)
  })

  it('表与 keyValues 一致（表1 拟合指标）', () => {
    const parsed = parseROutput(OUT)
    const t = tableOf(parsed.tables, '模型拟合指标')
    expect(Number(parsed.keyValues['chi2'])).toBeCloseTo(Number(rowOf(t, 'χ²')[1]), 6)
    expect(Number(parsed.keyValues['df'])).toBe(Number(rowOf(t, 'df')[1]))
    expect(Number(parsed.keyValues['CFI'])).toBeCloseTo(Number(rowOf(t, 'CFI')[1]), 6)
    expect(Number(parsed.keyValues['TLI'])).toBeCloseTo(Number(rowOf(t, 'TLI')[1]), 6)
    expect(Number(parsed.keyValues['RMSEA'])).toBeCloseTo(Number(rowOf(t, 'RMSEA')[1]), 6)
    expect(Number(parsed.keyValues['SRMR'])).toBeCloseTo(Number(rowOf(t, 'SRMR')[1]), 6)
    // keyValues 的 p 用原始数值（0.1306），表用展示串（p = 0.131）——两者必须指同一件事
    expect(Number(parsed.keyValues['p'])).toBeCloseTo(0.1306, 6)
  })

  it('表与 keyValues 一致（表2 载荷 + 因子归属）', () => {
    const parsed = parseROutput(OUT)
    const t = tableOf(parsed.tables, '标准化因子载荷')
    const loads = t.rows.map((r) => Number(r[2]))
    expect(Number(parsed.keyValues['最小标准化载荷'])).toBeCloseTo(Math.min(...loads), 6)
    // 因子归属串必须与表2「因子」列逐题对应
    const groups = String(parsed.keyValues['因子归属'])
    expect(groups).toContain('F1: q1, q2, q3')
    expect(groups).toContain('F2: q4, q5, q6')
    for (const r of t.rows) {
      expect(groups).toContain(String(r[0]))
    }
  })

  it('因子标签兼容 R 端的 "F1" 形态与裸整数形态（不得拼出 "FF1"）', () => {
    // 真实 R 端输出 `sprintf("CFA_FACTOR|F%d|F%d|...")` 与 `CFA_RELIAB|F%d|...`，
    // 即带 F 前缀；而 CFA_ITEM 的 factor 是裸整数。解析器若对两者一律加 "F"，
    // 会得到 "FF1"——不报错、只让整张区分效度表的标签错乱。
    const withPrefix = parseROutput(OUT)
    const cor = tableOf(withPrefix.tables, '因子间相关')
    expect(String(cor.rows[0][0])).toBe('F1 ↔ F2')
    expect(String(withPrefix.keyValues['因子相关'])).toBe('r(F1,F2) = 0.4137')
    const rel = tableOf(withPrefix.tables, '组合信度')
    expect(rel.rows.map((r) => r[0])).toEqual(['F1', 'F2'])
    expect(withPrefix.keyValues['F1_CR']).toBeDefined()
    expect(withPrefix.keyValues['FF1_CR']).toBeUndefined()

    // 裸整数形态也必须被同样归一化（契约只写了 "f1"，R 端可能会变）
    const bare = [
      '=== 验证性因子分析 (CFA) ===',
      'CFA_SPEC|2|6|300',
      'CFA_FIT|12.4831|8|p = 0.131|0.1306',
      'CFA_FITIDX|0.9912|0.9835|0.0432|0.0271',
      'CFA_FACTOR|1|2|0.4137|0.0612|6.7598|p < 0.001|3.1e-11',
      'CFA_RELIAB|1|0.8421|0.6412|0.8007'
    ].join('\n')
    const bareParsed = parseROutput(bare)
    expect(String(tableOf(bareParsed.tables, '因子间相关').rows[0][0])).toBe('F1 ↔ F2')
    expect(tableOf(bareParsed.tables, '组合信度').rows[0][0]).toBe('F1')
  })

  it('表与 keyValues 一致（表3 / 表4）', () => {
    const parsed = parseROutput(OUT)
    const cor = tableOf(parsed.tables, '因子间相关')
    expect(String(parsed.keyValues['因子相关'])).toBe(`r(F1,F2) = ${Number(cor.rows[0][1]).toFixed(4)}`)
    const rel = tableOf(parsed.tables, '组合信度')
    const f1 = rel.rows.find((r) => r[0] === 'F1')!
    expect(Number(parsed.keyValues['F1_CR'])).toBeCloseTo(Number(f1[1]), 6)
    expect(Number(parsed.keyValues['F1_AVE'])).toBeCloseTo(Number(f1[2]), 6)
    expect(Number(parsed.keyValues['F1_sqrtAVE'])).toBeCloseTo(Number(f1[3]), 6)
  })

  it('恰好识别（df = 0）时 χ²/df 给占位而非 Infinity', () => {
    const out = [
      '=== 验证性因子分析 (CFA) ===',
      'CFA_SPEC|1|3|100',
      'CFA_FIT|0.0000|0|p = NA|NA',
      'CFA_FITIDX|1.0000|1.0000|0.0000|0.0000',
      'CFA_NULLMODEL|50.0000|3'
    ].join('\n')
    const t = tableOf(parseROutput(out).tables, '模型拟合指标')
    expect(String(rowOf(t, 'χ²/df')[1])).toBe('—')
    expect(String(rowOf(t, 'p')[1])).toBe('—')
  })

  it('CFA_NOTE 进入 diagnostics（Heywood / 样本量提示不得静默吞掉）', () => {
    const d = parseROutput(OUT).diagnostics
    const note = d.find((x) => x.label === 'CFA 提示')
    expect(note).toBeDefined()
    expect(note!.value).toContain('未检出 Heywood')
  })
})

describe('字段级断言：CVI 内容效度指数', () => {
  // 6 位专家 / 5 个题项。n = 6 的 I-CVI 阈值 = 0.83，A = ceiling(0.83×6) = 5，
  // Pc = C(6,5)/2^6 = 6/64 = 0.0938（单点二项系数，不是尾概率和）
  //   q1: 6/6 = 1.0000 → k* = 1.0000  → 优秀
  //   q2: 5/6 = 0.8333 → k* = 0.8161  → 优秀（恰好达到 0.83 阈值）
  //   q3: 4/6 = 0.6667 → k* = 0.6322  → 良好
  //   q4: 3/6 = 0.5000 → k* = 0.4483  → 尚可
  //   q5: 2/6 = 0.3333 → k* = 0.2644  → 需修改
  const OUT = [
    '=== 内容效度指数 (CVI) ===',
    'CVI_SPEC|5|6',
    'CVI_ITEM|q1|6|6|1.0000|1.0000|0.0156|优秀',
    'CVI_ITEM|q2|5|6|0.8333|0.8161|0.0938|优秀',
    'CVI_ITEM|q3|4|6|0.6667|0.6322|0.0938|良好',
    'CVI_ITEM|q4|3|6|0.5000|0.4483|0.0938|尚可',
    'CVI_ITEM|q5|2|6|0.3333|0.2644|0.0938|需修改',
    'CVI_SUMMARY|0.6667|0.2000|1|否',
    'CVI_NOTE|专家数 6，I-CVI 判定阈值为 0.83',
    'CONCL|部分题项内容效度不足，建议修改 q5'
  ].join('\n')

  it('CVI_SPEC 的两个字段各就各位', () => {
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['题项数'])).toBe(5)
    expect(Number(kv['专家数'])).toBe(6)
  })

  it('表1 逐题：认同数 / 专家数 / I-CVI / Kappa / Pc / 判定 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '逐题内容效度指数')
    expect(t.headers).toEqual(['题项', '认同专家数', '专家总数', 'I-CVI', '修正 Kappa', 'Pc', '判定'])
    expect(t.rows).toHaveLength(5)

    const q2 = t.rows.find((r) => r[0] === 'q2')!
    expect(q2[1]).toBe(5) // n_relevant ← f[2]（不是 n_experts 6）
    expect(q2[2]).toBe(6) // n_experts  ← f[3]
    expect(String(q2[3])).toBe('0.8333') // i_cvi ← f[4]
    expect(String(q2[4])).toBe('0.8161') // kappa ← f[5]（不是 i_cvi）
    expect(String(q2[5])).toBe('0.0938') // p_c   ← f[6]（不是 kappa）
    expect(String(q2[6])).toBe('优秀') // verdict ← f[7]（透传）

    const q5 = t.rows.find((r) => r[0] === 'q5')!
    expect(q5[1]).toBe(2)
    expect(String(q5[3])).toBe('0.3333')
    expect(String(q5[4])).toBe('0.2644')
    expect(String(q5[6])).toBe('需修改')
  })

  it('I-CVI / Kappa / Pc 各自取对下标（满分题项 k* 恒等于 1，故只对非满分题项比较）', () => {
    const t = tableOf(parseROutput(OUT).tables, '逐题内容效度指数')
    // n_relevant / n_experts 两列不得整体错位：只有满分的 q1 允许两者相等
    for (const r of t.rows.filter((x) => Number(x[3]) < 1)) {
      expect(Number(r[1])).toBeLessThan(Number(r[2])) // 认同数 < 专家总数
    }
    expect(Number(t.rows.find((r) => r[0] === 'q1')![1])).toBe(6)
    expect(Number(t.rows.find((r) => r[0] === 'q1')![2])).toBe(6)
    // q1 满分时 k* = (1 − Pc)/(1 − Pc) = 1.0000 与 I-CVI 恒等（数学必然，不是错位），
    // 因此只在 I-CVI < 1 的题项上断言 Kappa 严格小于 I-CVI；
    // 同时断言 Pc 落在 (0, 1) 内，且 k* 不等于 Pc（把 f[5] / f[6] 张冠李戴会立刻红）。
    const partial = t.rows.filter((r) => Number(r[3]) < 1)
    expect(partial.length).toBeGreaterThanOrEqual(3)
    for (const r of partial) {
      expect(Number(r[4])).toBeLessThan(Number(r[3])) // Kappa < I-CVI
      expect(Number(r[5])).toBeGreaterThan(0) // Pc > 0
      expect(Number(r[5])).toBeLessThan(1) // Pc < 1
      expect(Number(r[4])).not.toBeCloseTo(Number(r[5]), 4) // Kappa ≠ Pc
    }
  })

  it('判定取值落在 Cicchetti & Sparrow 四级集合内（不是旧的三级）', () => {
    const t = tableOf(parseROutput(OUT).tables, '逐题内容效度指数')
    const allowed = new Set(['优秀', '良好', '尚可', '需修改'])
    for (const r of t.rows) expect(allowed.has(String(r[6]))).toBe(true)
    // 本 fixture 刻意覆盖四级，证明「尚可」这一档确实会被展示出来
    expect(new Set(t.rows.map((r) => String(r[6])))).toEqual(allowed)
  })

  it('表2 量表级汇总：S-CVI/Ave、S-CVI/UA、一致题项数、达标判定', () => {
    const t = tableOf(parseROutput(OUT).tables, '量表级内容效度汇总')
    expect(t.headers).toEqual(['指标', '数值', '建议标准'])
    expect(Number(rowOf(t, 'S-CVI/Ave（平均 I-CVI）')[1])).toBeCloseTo(0.6667, 4)
    expect(Number(rowOf(t, 'S-CVI/UA（全体一致题项比例）')[1])).toBeCloseTo(0.2, 4)
    expect(Number(rowOf(t, '全体一致题项数')[1])).toBe(1)
    expect(String(rowOf(t, '全部题项 I-CVI 是否达标')[1])).toBe('否')
  })

  it('表与 keyValues 一致（CVI）', () => {
    const parsed = parseROutput(OUT)
    const t1 = tableOf(parsed.tables, '逐题内容效度指数')
    const t2 = tableOf(parsed.tables, '量表级内容效度汇总')
    expect(Number(parsed.keyValues['题项数'])).toBe(t1.rows.length)
    // 「需修改」计数必须等于表里判定为需修改的行数（同一口径，不得各算一遍）
    const needFix = t1.rows.filter((r) => String(r[6]) === '需修改').length
    expect(Number(parsed.keyValues['需修改题项数'])).toBe(needFix)
    expect(Number(parsed.keyValues['S-CVI/Ave'])).toBeCloseTo(
      Number(rowOf(t2, 'S-CVI/Ave（平均 I-CVI）')[1]),
      6
    )
    expect(Number(parsed.keyValues['S-CVI/UA'])).toBeCloseTo(
      Number(rowOf(t2, 'S-CVI/UA（全体一致题项比例）')[1]),
      6
    )
    expect(Number(parsed.keyValues['一致题项数'])).toBe(Number(rowOf(t2, '全体一致题项数')[1]))
    expect(String(parsed.keyValues['I-CVI 达标'])).toBe('否')
    expect(Number(parsed.keyValues['I-CVI 达标码'])).toBe(0)
  })

  it('CVI_NOTE 进入 diagnostics（专家数偏少等提示不得静默吞掉）', () => {
    const d = parseROutput(OUT).diagnostics
    const note = d.find((x) => x.label === 'CVI 提示')
    expect(note).toBeDefined()
    expect(note!.value).toContain('0.83')
  })

  it('表注携带正确的阈值口径（阈值表被改回宽松值时会变红）', () => {
    const t = tableOf(parseROutput(OUT).tables, '逐题内容效度指数')
    // 契约第二节修正后的阈值：n ≤ 5 → 1.00；6–8 → 0.83；n ≥ 9 → 0.78
    expect(t.note).toContain('n ≤ 5 为 1.00')
    expect(t.note).toContain('6 ≤ n ≤ 8 为 0.83')
    expect(t.note).toContain('n ≥ 9 为 0.78')
    // 初稿把 6–8 写成 0.78 / n=8 写成 0.75，是「偏宽松」的错误，不得复发
    expect(t.note).not.toContain('6 ≤ n ≤ 8 为 0.78')
    expect(t.note).not.toContain('0.75')
    // 四级判定口径也必须写清楚
    expect(t.note).toContain('尚可')
  })
})

describe('CVI 阈值边界：n=6（0.83）/ n=9（0.78）—— 判定口径只透传 R 端', () => {
  /** 造一份只有 1 个题项的 CVI 输出，便于把边界值钉死 */
  function cviOne(nExperts: number, nRelevant: number, iCvi: string, verdict: string, ok: string): string {
    return [
      '=== 内容效度指数 (CVI) ===',
      `CVI_SPEC|1|${nExperts}`,
      `CVI_ITEM|q1|${nRelevant}|${nExperts}|${iCvi}|0.7000|0.0938|${verdict}`,
      `CVI_SUMMARY|${iCvi}|${iCvi}|1|${ok}`
    ].join('\n')
  }

  it('n=6、5 人认同（5/6 = 0.8333）→ 达到 0.83 阈值，判为达标', () => {
    const parsed = parseROutput(cviOne(6, 5, '0.8333', '优秀', '是'))
    const t = tableOf(parsed.tables, '逐题内容效度指数')
    expect(t.rows[0][1]).toBe(5)
    expect(t.rows[0][2]).toBe(6)
    expect(String(t.rows[0][3])).toBe('0.8333')
    // 0.8333 ≥ 0.83 → 达标。若有人把阈值表改回 0.78，这条断言仍绿，
    // 但下表「不改口径」的断言与 R 端 oracle 会红——这正是"口径唯一"的好处。
    expect(Number(t.rows[0][3])).toBeGreaterThanOrEqual(0.83)
    expect(String(parsed.keyValues['I-CVI 达标'])).toBe('是')
    expect(Number(parsed.keyValues['I-CVI 达标码'])).toBe(1)
  })

  it('n=9、7 人认同（7/9 = 0.7778）→ 未达 0.78 阈值，判为不达标', () => {
    const parsed = parseROutput(cviOne(9, 7, '0.7778', '优秀', '否'))
    const t = tableOf(parsed.tables, '逐题内容效度指数')
    expect(t.rows[0][1]).toBe(7)
    expect(t.rows[0][2]).toBe(9)
    expect(String(t.rows[0][3])).toBe('0.7778')
    // 0.7778 < 0.78 → 不达标。这两个断言合起来把"6–8 用 0.83、≥9 用 0.78"
    // 的分界钉在测试里：把 0.83 改成 0.78 会让上一条的 ≥ 0.83 变红。
    expect(Number(t.rows[0][3])).toBeLessThan(0.78)
    expect(String(parsed.keyValues['I-CVI 达标'])).toBe('否')
    expect(Number(parsed.keyValues['I-CVI 达标码'])).toBe(0)
  })

  it('verdict 一律透传 R 端，解析器绝不按 i_cvi 重新判定', () => {
    // 故意造"自相矛盾"的输入，且**两个方向都测**——只测一个方向是不够的：
    // 若解析器写成 `i_cvi >= .74 ? '优秀' : f[7]`（半吊子重复实现），
    // 只有「I-CVI 低但 verdict 说优秀」那一侧会被兜底到 f[7] 而侥幸通过；
    // 「I-CVI 高但 verdict 说需修改」那一侧才会暴露它其实在自行判定。
    //   方向 A：i_cvi = 0.50（按口径应为「尚可」）→ R 端说「优秀」→ 必须显示「优秀」
    //   方向 B：i_cvi = 1.00（按口径应为「优秀」）→ R 端说「需修改」→ 必须显示「需修改」
    const dirA = cviOne(6, 3, '0.5000', '优秀', '是')
    expect(String(tableOf(parseROutput(dirA).tables, '逐题内容效度指数').rows[0][6])).toBe('优秀')

    const dirB = cviOne(6, 6, '1.0000', '需修改', '是')
    expect(String(tableOf(parseROutput(dirB).tables, '逐题内容效度指数').rows[0][6])).toBe('需修改')

    // 同样的两个方向也压到一条「多题项」输出上：把 q1 的 verdict 改成与 I-CVI 相反的档位
    const flipped = [
      '=== 内容效度指数 (CVI) ===',
      'CVI_SPEC|2|6',
      'CVI_ITEM|q1|6|6|1.0000|1.0000|0.0156|需修改',
      'CVI_ITEM|q2|2|6|0.3333|0.2644|0.0938|优秀',
      'CVI_SUMMARY|0.6667|0.0000|0|否'
    ].join('\n')
    const t = tableOf(parseROutput(flipped).tables, '逐题内容效度指数')
    // q1 满分但 R 端说「需修改」；q2 很低但 R 端说「优秀」——两处都必须照转，
    // 任何基于 i_cvi 的自行判定都会在这两个题项中的至少一个上露馅。
    expect(String(t.rows.find((r) => r[0] === 'q1')![6])).toBe('需修改')
    expect(String(t.rows.find((r) => r[0] === 'q2')![6])).toBe('优秀')
  })

  it('threshold_ok 一律透传 R 端，解析器不重算「是否达标」', () => {
    // I-CVI 全部为 1.00（按任何阈值表都该达标），但 R 端说「否」——必须照转。
    const inconsistent = cviOne(6, 6, '1.0000', '优秀', '否')
    const parsed = parseROutput(inconsistent)
    const t = tableOf(parsed.tables, '量表级内容效度汇总')
    expect(String(rowOf(t, '全部题项 I-CVI 是否达标')[1])).toBe('否')
    expect(String(parsed.keyValues['I-CVI 达标'])).toBe('否')
  })
})

describe('字段级断言：Harman 单因子检验', () => {
  // 首成分 45.69% > 40% → 存在共同方法偏差风险（ok = 否）
  const OUT = [
    '=== Harman 单因子检验 ===',
    'HARMAN_SPEC|6|300',
    'HARMAN_EIGEN|1|2.7412|45.69|45.69',
    'HARMAN_EIGEN|2|1.0233|17.06|62.75',
    'HARMAN_SUMMARY|2|45.69|40|否',
    'HARMAN_NOTE|Harman 检验灵敏度低，仅作初步筛查',
    'CONCL|首成分解释率超过 40%，提示存在共同方法偏差风险'
  ].join('\n')

  it('HARMAN_SPEC 的两个字段各就各位', () => {
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['题项数'])).toBe(6)
    expect(Number(kv['样本量'])).toBe(300)
  })

  it('表1 特征值与方差解释：成分 / 特征值 / 方差% / 累计% 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '特征值与方差解释')
    expect(t.headers).toEqual(['成分', '特征值', '方差解释率', '累计方差解释率'])
    expect(t.rows).toHaveLength(2)
    const r1 = t.rows[0]
    expect(Number(r1[0])).toBe(1) // k     ← f[1]
    expect(Number(r1[1])).toBeCloseTo(2.7412, 4) // eigenvalue ← f[2]
    expect(String(r1[2])).toBe('45.69%') // variance_pct    ← f[3]
    expect(String(r1[3])).toBe('45.69%') // cumulative_pct  ← f[4]
    const r2 = t.rows[1]
    expect(Number(r2[1])).toBeCloseTo(1.0233, 4)
    expect(String(r2[2])).toBe('17.06%')
    expect(String(r2[3])).toBe('62.75%')
  })

  it('特征值 ≠ 方差解释率（量纲不同，错位必被抓）', () => {
    const t = tableOf(parseROutput(OUT).tables, '特征值与方差解释')
    for (const r of t.rows) {
      expect(Number(r[1])).not.toBeCloseTo(parseFloat(String(r[2])), 2)
    }
  })

  it('表2 判定结论：因子数 / 首成分% / 阈值 / 判定 各取正确下标', () => {
    const t = tableOf(parseROutput(OUT).tables, '共同方法偏差判定')
    expect(t.headers).toEqual(['指标', '数值', '判据'])
    expect(Number(rowOf(t, '特征值 > 1 的成分数')[1])).toBe(2)
    expect(String(rowOf(t, '首成分方差解释率')[1])).toBe('45.69%') // first_pct ← f[2]
    expect(String(rowOf(t, '判定阈值')[1])).toBe('40.00%') // threshold ← f[3]
    expect(String(rowOf(t, '是否未发现严重共同方法偏差')[1])).toBe('否') // ok ← f[4]
  })

  it('表与 keyValues 一致（Harman）', () => {
    const parsed = parseROutput(OUT)
    const t = tableOf(parsed.tables, '共同方法偏差判定')
    expect(Number(parsed.keyValues['特征值大于1的因子数'])).toBe(
      Number(rowOf(t, '特征值 > 1 的成分数')[1])
    )
    expect(Number(parsed.keyValues['首成分方差解释率'])).toBeCloseTo(45.69, 2)
    expect(Number(parsed.keyValues['判定阈值'])).toBe(40)
    expect(String(parsed.keyValues['未发现严重偏差'])).toBe('否')
    expect(Number(parsed.keyValues['未发现严重偏差码'])).toBe(0)
    // 累计方差解释取最后一个成分（取第一行会得到 45.69% —— 首个成分而已）
    expect(String(parsed.keyValues['累计方差解释'])).toBe('62.75%')
  })

  it('首成分 < 40% 且因子数 > 1 → 判定为「是」', () => {
    const out = [
      '=== Harman 单因子检验 ===',
      'HARMAN_SPEC|6|300',
      'HARMAN_EIGEN|1|1.9308|32.18|32.18',
      'HARMAN_EIGEN|2|1.4115|23.53|55.71',
      'HARMAN_SUMMARY|2|32.18|40|是',
      'CONCL|未发现严重的共同方法偏差'
    ].join('\n')
    const parsed = parseROutput(out)
    const t = tableOf(parsed.tables, '共同方法偏差判定')
    expect(String(rowOf(t, '首成分方差解释率')[1])).toBe('32.18%')
    expect(String(rowOf(t, '是否未发现严重共同方法偏差')[1])).toBe('是')
    expect(Number(parsed.keyValues['未发现严重偏差码'])).toBe(1)
    expect(String(parsed.keyValues['累计方差解释'])).toBe('55.71%')
  })

  it('ok 一律透传 R 端，解析器不重算判据（首成分与因子数的组合不自洽时也照转）', () => {
    // first_pct = 55 且因子数 3，按契约判据必须是「否」；故意给「是」，
    // 若解析器自己实现了一遍判据，这条会变红。
    const out = [
      '=== Harman 单因子检验 ===',
      'HARMAN_SPEC|6|300',
      'HARMAN_EIGEN|1|3.3000|55.00|55.00',
      'HARMAN_SUMMARY|3|55.00|40|是'
    ].join('\n')
    const t = tableOf(parseROutput(out).tables, '共同方法偏差判定')
    expect(String(rowOf(t, '是否未发现严重共同方法偏差')[1])).toBe('是')
  })

  it('阈值来自 R 端输出，不在解析器里写死 40', () => {
    const out = [
      '=== Harman 单因子检验 ===',
      'HARMAN_SPEC|6|300',
      'HARMAN_EIGEN|1|2.1000|35.00|35.00',
      'HARMAN_SUMMARY|2|35.00|30|是'
    ].join('\n')
    const t = tableOf(parseROutput(out).tables, '共同方法偏差判定')
    expect(String(rowOf(t, '判定阈值')[1])).toBe('30.00%')
  })

  it('HARMAN_NOTE 进入 diagnostics 且表注写明「不能证明无偏差」', () => {
    const parsed = parseROutput(OUT)
    const note = parsed.diagnostics.find((x) => x.label === 'Harman 检验提示')
    expect(note).toBeDefined()
    expect(note!.value).toContain('灵敏度低')
    const t = tableOf(parsed.tables, '共同方法偏差判定')
    expect(t.note).toContain('只能作为初步筛查')
    expect(t.note).toContain('不能据此证明不存在共同方法偏差')
  })
})

describe('v0.3.1 三个方法的三线表行数下限（防止"表在但只有标题"）', () => {
  const FIXTURES: Record<string, number> = {
    cfa: 4, // 拟合指标 / 标准化载荷 / 因子间相关 / 组合信度
    cvi: 2, // 逐题 / 量表级汇总
    harman: 2 // 特征值 / 判定
  }

  it('CFA / CVI / Harman 的表数与契约要求一致', () => {
    const cfa = [
      '=== 验证性因子分析 (CFA) ===',
      'CFA_SPEC|2|6|300',
      'CFA_FIT|12.4831|8|p = 0.131|0.1306',
      'CFA_FITIDX|0.9912|0.9835|0.0432|0.0271',
      'CFA_NULLMODEL|742.1908|15',
      'CFA_ITEM|q1|1',
      'CFA_ESTIMATE|q1|0.8123|0.9987|0.0412|19.7151|p < 0.001|1.2e-60|0.6598',
      'CFA_FACTOR|F1|F2|0.4137|0.0612|6.7598|p < 0.001|3.1e-11',
      'CFA_RELIAB|F1|0.8421|0.6412|0.8007'
    ].join('\n')
    const cvi = [
      '=== 内容效度指数 (CVI) ===',
      'CVI_SPEC|1|6',
      'CVI_ITEM|q1|6|6|1.0000|1.0000|0.0156|优秀',
      'CVI_SUMMARY|1.0000|1.0000|1|是'
    ].join('\n')
    const harman = [
      '=== Harman 单因子检验 ===',
      'HARMAN_SPEC|6|300',
      'HARMAN_EIGEN|1|2.7412|45.69|45.69',
      'HARMAN_SUMMARY|2|45.69|40|否'
    ].join('\n')

    const counts = {
      cfa: parseROutput(cfa).tables.length,
      cvi: parseROutput(cvi).tables.length,
      harman: parseROutput(harman).tables.length
    }
    expect(counts).toEqual(FIXTURES)
    // 且每张表都必须真的有数据行（"有表无行"是 v0.2.5 的另一类静默失败）
    for (const [name, out] of [
      ['cfa', cfa],
      ['cvi', cvi],
      ['harman', harman]
    ] as const) {
      for (const t of parseROutput(out).tables) {
        expect(t.rows.length, `${name} 的表「${t.title}」没有数据行`).toBeGreaterThan(0)
      }
    }
  })
})

