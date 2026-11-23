/**
 * 智能方法推荐：规则层判别力验收（v0.3.5 / T71）
 *
 * ── 本测试要守住的硬指标 ──
 *
 * | 验收项 | 标准 | 本文件的断言 |
 * |---|---|---|
 * | 规则层判别力 | 3 套典型数据上可行集合 **≤ 8 个方法** | 见「3 套典型数据」describe |
 * | 绝不误荐 | `cvi` 在非专家评分数据上**必须**被排除 | 见「cvi 绝不误荐」 |
 * | 每条规则可单测 | 每条规则都要有"该排除 / 该保留"的正反用例 | 见「逐方法正反用例」 |
 *
 * ── 为什么判别力是硬指标 ──
 * v0.3.3 原型实测：只用「类型 + 数量 + 缺失率」推荐出 **21/22 个方法**，
 * 补上列画像后仍是 **19/22**。一份"推荐了 19 个方法"的清单对用户毫无价值——
 * 用户点「智能推荐」的目的是"缩小选择范围"，不是"再看一遍完整方法列表"。
 *
 * 所以这里**不写 `expect(x.length).toBeGreaterThan(0)` 这种存在性断言**：
 * 那正是本项目吃过亏的地方（D1/D2 在 158 个测试全绿下存活一整个版本）。
 * 每个断言都指向"具体哪一条规则没生效"。
 */

import { describe, it, expect } from 'vitest'
import { profileDataset, type DatasetProfile } from '../columnProfile'
import {
  assessMethods,
  summarizeRecommendation,
  countConstructs,
  detectPrePostPair,
  MIN_N_CFA,
  MIN_N_EFA
} from '../recommendRules'
import { METHODS } from '../../data/methodRegistry'

// ── 测试数据构造 ────────────────────────────────────────────

/**
 * 确定性伪随机数（LCG）——**不用 Math.random**。
 * 测试必须逐次可复现：一次偶发的"恰好 2 个缺失"就会让断言飘。
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** 生成 1–5 的整数李克特作答 */
function likert(rng: () => number): number {
  return 1 + Math.floor(rng() * 5)
}

interface BuildOptions {
  rows: number
  /** 量表题项数（q1..qN） */
  scaleItems: number
  /** 额外连续变量（年龄等），值为 [name, 最小值, 跨度] */
  continuous?: [string, number, number][]
  /** 分类变量（取值集合） */
  categorical?: [string, string[]][]
  /** 缺失注入：列名 → 缺失比例（0–1） */
  missingRate?: Record<string, number>
  seed?: number
}

function buildRows(opts: BuildOptions): Record<string, unknown>[] {
  const rng = makeRng(opts.seed ?? 20260101)
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < opts.rows; i++) {
    const row: Record<string, unknown> = {}
    for (let q = 1; q <= opts.scaleItems; q++) {
      row[`q${q}`] = likert(rng)
    }
    for (const [name, min, span] of opts.continuous ?? []) {
      // 取 2 位小数，保证是真正的连续值（不是整数 → 不会被判 likely_categorical）
      row[name] = Math.round((min + rng() * span) * 100) / 100
    }
    for (const [name, levels] of opts.categorical ?? []) {
      row[name] = levels[Math.floor(rng() * levels.length)]
    }
    rows.push(row)
  }
  // 缺失注入：按固定步长置空，保证确定性
  for (const [column, rate] of Object.entries(opts.missingRate ?? {})) {
    const step = Math.max(1, Math.round(1 / rate))
    for (let i = 0; i < rows.length; i += step) rows[i][column] = ''
  }
  return rows
}

function buildProfile(headers: string[], rows: Record<string, unknown>[]): DatasetProfile {
  // 与 dataService.analyzeColumns 同口径：≥80% 可解析为数值 → numeric
  const columnInfo = headers.map((name) => {
    let numeric = 0
    let nonMissing = 0
    for (const row of rows) {
      const v = row[name]
      if (v === '' || v === null || v === undefined) continue
      nonMissing++
      if (typeof v === 'number' || (typeof v === 'string' && /^[+-]?\d*\.?\d+$/.test(v.trim()))) {
        numeric++
      }
    }
    const type: 'numeric' | 'string' | 'unknown' =
      nonMissing === 0 ? 'unknown' : numeric / nonMissing >= 0.8 ? 'numeric' : 'string'
    return { name, type }
  })
  return profileDataset(headers, rows, columnInfo)
}

/**
 * 数据集 1：**典型问卷**（原型里 19/22 的那份）。
 * 6 个量表题项 + 2 个连续变量 + 1 个 3 水平分类变量，n=300。
 */
function typicalSurvey(): DatasetProfile {
  const scaleItems = 6
  const headers = [
    ...Array.from({ length: scaleItems }, (_, i) => `q${i + 1}`),
    'age',
    'income',
    'grade'
  ]
  const rows = buildRows({
    rows: 300,
    scaleItems,
    continuous: [
      ['age', 18, 40],
      ['income', 2000, 18000]
    ],
    categorical: [['grade', ['高一', '高二', '高三']]]
  })
  return buildProfile(headers, rows)
}

/**
 * 数据集 2：**专家评分数据**（CVI 唯一合法形态）。
 * 12 位专家 × 8 个题项，1–4 相关性评分。
 */
function expertRating(): DatasetProfile {
  const headers = ['expert_id', ...Array.from({ length: 8 }, (_, i) => `item${i + 1}`)]
  const rng = makeRng(777)
  const rows: Record<string, unknown>[] = []
  for (let e = 0; e < 12; e++) {
    const row: Record<string, unknown> = { expert_id: `E${e + 1}` }
    for (let i = 1; i <= 8; i++) row[`item${i}`] = 1 + Math.floor(rng() * 4)
    rows.push(row)
  }
  const columnInfo = headers.map((name) => ({
    name,
    type: (name === 'expert_id' ? 'string' : 'numeric') as 'numeric' | 'string'
  }))
  return profileDataset(headers, rows, columnInfo)
}

/**
 * 数据集 3：**前后测临床数据**。
 * 60 名被试，前测/后测两个成对变量 + 2 水平分组 + 1 个连续协变量。
 * 这是配对 t 检验唯一合法的形态。
 */
function prePostClinical(): DatasetProfile {
  const headers = ['score_pre', 'score_post', 'sex', 'age']
  const rows = buildRows({
    rows: 60,
    scaleItems: 0,
    continuous: [
      ['score_pre', 20, 30],
      ['score_post', 25, 30],
      ['age', 20, 45]
    ],
    categorical: [['sex', ['男', '女']]],
    seed: 424242
  })
  return buildProfile(headers, rows)
}

// ── 验收 1：可行集合 ≤ 8 ────────────────────────────────────

const FEASIBLE_LIMIT = 8

describe('规则层判别力：3 套典型数据上可行集合 ≤ 8 个方法', () => {
  const cases: Array<[string, () => DatasetProfile]> = [
    ['典型问卷（6 题项 + 2 连续 + 1 三水平分组, n=300）', typicalSurvey],
    ['专家评分（12 专家 × 8 题项, 1–4 分）', expertRating],
    ['前后测临床（pre/post + 性别 + 年龄, n=60）', prePostClinical]
  ]

  for (const [label, build] of cases) {
    it(`${label} → 可行集合不超过 ${FEASIBLE_LIMIT} 个`, () => {
      const summary = summarizeRecommendation(build())
      const ids = summary.recommendable.map((a) => a.methodId)
      // 失败信息要能直接看出"是哪几个方法溢出了上限"，而不是只有一个数字
      expect(
        ids.length,
        `可行集合 ${ids.length} 个 > 上限 ${FEASIBLE_LIMIT}：\n  ${ids.join(', ')}\n` +
          `请检查是否有必要条件太松（原型教训：条件太松会推荐出 19/22 个方法）`
      ).toBeLessThanOrEqual(FEASIBLE_LIMIT)
    })
  }

  it('三套数据都不是"什么都不推荐"（避免用过度排除换取低数量）', () => {
    // 反方向的失败模式：把所有方法都排除，数量当然 ≤ 8，但那毫无用处。
    // 每套数据都必须至少推荐 2 个方法，否则说明规则过严。
    for (const [label, build] of cases) {
      const ids = summarizeRecommendation(build()).recommendable.map((a) => a.methodId)
      expect(ids.length, `${label} 只推荐了 ${ids.length} 个方法，规则过严`).toBeGreaterThanOrEqual(2)
    }
  })

  it('典型问卷数据推荐的是"测量质量 + 结构"类方法（合理性，不只是数量）', () => {
    const ids = summarizeRecommendation(typicalSurvey()).recommendable.map((a) => a.methodId)
    // 6 个量表题项 + n=300：信度 / EFA / CFA 都该在
    expect(ids).toContain('reliability')
    expect(ids).toContain('efa')
    expect(ids).toContain('cfa')
    // 有 3 水平分组 + 连续变量 → ANOVA 该在
    expect(ids).toContain('anova')
    // 反方向：Harman 是"配套诊断"，有主分析时降级（不应出现在推荐集合里）
    expect(ids).not.toContain('harman')
    // 体检工具在有主分析时降级
    expect(ids).not.toContain('descriptive')
    expect(ids).not.toContain('normality')
  })

  it('前后测数据必须推荐配对 t 检验（判别力证据：别的数据不会有）', () => {
    expect(summarizeRecommendation(prePostClinical()).recommendable.map((a) => a.methodId)).toContain(
      'ttest_paired'
    )
    // 反方向：典型问卷没有前后测命名 → 不该推荐配对 t
    expect(summarizeRecommendation(typicalSurvey()).recommendable.map((a) => a.methodId)).not.toContain(
      'ttest_paired'
    )
  })
})

// ── 验收 2：cvi 绝不误荐 ────────────────────────────────────

describe('cvi 绝不误荐（原型验证的最易误荐方法）', () => {
  it('典型问卷数据上 cvi 必须被排除，且理由是"需要专家评分结构"', () => {
    const assessment = assessMethods(typicalSurvey()).find((a) => a.methodId === 'cvi')!
    expect(assessment.applicable, 'cvi 在普通问卷数据上被判定为可行——这是最危险的误荐').toBe(false)
    expect(assessment.reasonKey).toBe('recommend.reason.expertDataOnly')
  })

  it('前后测临床数据上 cvi 同样必须被排除', () => {
    const assessment = assessMethods(prePostClinical()).find((a) => a.methodId === 'cvi')!
    expect(assessment.applicable).toBe(false)
  })

  it('专家评分数据上 cvi 必须被保留（证明排除不是"永远排除"）', () => {
    // 这条是上面两条的**反向用例**。只断言"永远排除"的实现也能让上面两条通过，
    // 但那样 cvi 就彻底不可用了——正反用例缺一不可。
    const assessment = assessMethods(expertRating()).find((a) => a.methodId === 'cvi')!
    expect(assessment.applicable, 'cvi 在真正的专家评分数据上被排除了，规则过严').toBe(true)
  })

  it('样本量大的普通问卷不会被误判为专家评分（n>20 一律不是）', () => {
    // 专家通常 3–20 人；n=300 的问卷无论取值多像 1–4 分都不可能是专家评分
    const profile = buildProfile(
      ['q1', 'q2', 'q3', 'q4'],
      buildRows({ rows: 300, scaleItems: 4, seed: 9 })
    )
    expect(profile.looksLikeExpertRating).toBe(false)
  })
})

// ── 验收 3：逐方法正反用例 ──────────────────────────────────

/**
 * 每条规则至少一正一反。
 *
 * 组织方式：对每个方法提供 `{ applicable, dataset }` 的期望，
 * 用同一张表驱动断言——新增规则时必须给出两行，否则测试会漏。
 */
describe('逐方法正反用例（每条必要条件都有该保留 / 该排除的证据）', () => {
  const survey = () => typicalSurvey()
  const clinical = () => prePostClinical()

  /** 小样本（n=8）用于验证样本量门槛 */
  const tiny = () =>
    buildProfile(['x', 'y'], buildRows({ rows: 8, scaleItems: 0, continuous: [['x', 1, 10], ['y', 1, 10]] }))

  /** 纯分类数据（无任何数值变量） */
  const allCategorical = () =>
    buildProfile(
      ['a', 'b', 'c'],
      buildRows({ rows: 50, scaleItems: 0, categorical: [['a', ['x', 'y']], ['b', ['p', 'q', 'r']], ['c', ['u', 'v']]] })
    )

  /** 单维度量表 6 题，n=300 —— 够 3 个数值变量但只有 1 个构念 */
  const singleConstructScale = () =>
    buildProfile(
      Array.from({ length: 6 }, (_, i) => `q${i + 1}`),
      buildRows({ rows: 300, scaleItems: 6 })
    )

  it('ttest_independent：有二水平分组 + 数值 → 保留；无二水平分组 → 排除', () => {
    // 正例：临床数据有 sex（恰好 2 水平）
    expect(assess(clinical(), 'ttest_independent').applicable).toBe(true)
    // 反例 1：问卷数据只有 grade（3 水平），没有二水平分组 → 应排除（ANOVA 才对）
    const surveyAssessment = assess(survey(), 'ttest_independent')
    expect(surveyAssessment.applicable).toBe(false)
    expect(surveyAssessment.reasonKey).toBe('recommend.reason.needBinaryGroup')
    // 反例 2：纯分类数据（无数值变量）同样排除
    expect(assess(allCategorical(), 'ttest_independent').applicable).toBe(false)
  })

  it('量表题项不能被当作分组变量（5 点李克特 ≠ 5 个人群）', () => {
    // 这是开发中实测到的真实缺陷：q1 的 cardinality = 5（≥3），
    // 若不排除量表题项，问卷数据会被推荐"按 q1 分组做 ANOVA"——
    // 把定序量表题项当名义分组变量，算得出来但含义荒谬。
    const s = survey()
    const groupingNames = s.groupingColumns.map((c) => c.name)
    expect(groupingNames, '量表题项出现在分组变量里').not.toContain('q1')
    expect(groupingNames).toContain('grade')
    // 正例：字符串分组变量仍被识别
    expect(s.multiGroups.map((c) => c.name)).toEqual(['grade'])
  })

  it('anova：有三水平分组 → 保留；只有二水平 → 排除（t 检验更合适）', () => {
    expect(assess(survey(), 'anova').applicable).toBe(true)
    // 临床数据只有 sex（2 水平），没有 ≥3 水平的分组 → anova 应被排除
    const a = assess(clinical(), 'anova')
    expect(a.applicable).toBe(false)
    expect(a.reasonKey).toBe('recommend.reason.needMultiGroup')
  })

  it('anova 不会因为"数值列有 5 个唯一值"就当它是 5 水平分组', () => {
    // 开发中实测到的真实缺陷：q1..q6 的 cardinality=5，曾被判成 multiGroups，
    // 于是问卷数据被推荐"按 q1 分组做 ANOVA"。这里钉死修复。
    const s = survey()
    expect(s.multiGroups.map((c) => c.name)).not.toContain('q1')
    // 反例：加入真正 3 水平的字符串分组后 anova 才可行
    const noGroup = buildProfile(
      Array.from({ length: 6 }, (_, i) => `q${i + 1}`),
      buildRows({ rows: 300, scaleItems: 6 })
    )
    expect(assess(noGroup, 'anova').applicable, '没有真正的分组变量时 anova 仍可行').toBe(false)
  })

  it('chisquare：≥2 个分类变量 → 保留；只有 1 个 → 排除', () => {
    const twoNominal = buildProfile(
      ['a', 'b', 'num'],
      buildRows({
        rows: 80,
        scaleItems: 0,
        continuous: [['num', 1, 20]],
        categorical: [['a', ['x', 'y']], ['b', ['p', 'q', 'r']]]
      })
    )
    expect(assess(twoNominal, 'chisquare').applicable).toBe(true)

    const oneNominal = buildProfile(
      ['a', 'num'],
      buildRows({
        rows: 80,
        scaleItems: 0,
        continuous: [['num', 1, 20]],
        categorical: [['a', ['x', 'y']]]
      })
    )
    expect(assess(oneNominal, 'chisquare').applicable).toBe(false)
    expect(assess(oneNominal, 'chisquare').reasonKey).toBe('recommend.reason.needTwoNominal')
  })

  it('reliability / efa / harman：有 3 个量表题项 → 保留；只有 2 个 → 排除', () => {
    expect(assess(survey(), 'reliability').applicable).toBe(true)
    expect(assess(survey(), 'efa').applicable).toBe(true)
    expect(assess(survey(), 'harman').applicable).toBe(true)

    // 只有 2 个连续变量（非量表题项）→ 三者全部排除
    const twoNumeric = buildProfile(
      ['x', 'y'],
      buildRows({ rows: 100, scaleItems: 0, continuous: [['x', 1, 10], ['y', 1, 10]] })
    )
    for (const id of ['reliability', 'efa', 'harman']) {
      expect(assess(twoNumeric, id).applicable, `${id} 在只有 2 个连续变量时仍可行`).toBe(false)
      expect(assess(twoNumeric, id).reasonKey).toBe('recommend.reason.needScaleItems')
    }
  })

  it('cfa：需 ≥4 题项 + n≥100 —— 3 题项或小样本都要排除', () => {
    // 3 个题项：不足以构成"2 因子各 ≥2 指标"
    const threeItems = buildProfile(
      ['q1', 'q2', 'q3'],
      buildRows({ rows: 300, scaleItems: 3 })
    )
    const a3 = assess(threeItems, 'cfa')
    expect(a3.applicable).toBe(false)
    expect(a3.reasonKey).toBe('recommend.reason.needScaleItems')

    // 6 个题项但 n=50 < 100 → 样本量不足
    const smallSample = buildProfile(
      Array.from({ length: 6 }, (_, i) => `q${i + 1}`),
      buildRows({ rows: 50, scaleItems: 6 })
    )
    const aSmall = assess(smallSample, 'cfa')
    expect(aSmall.applicable).toBe(false)
    expect(aSmall.reasonKey).toBe('recommend.reason.sampleTooSmall')

    // 正例：6 题项 + n=300
    expect(assess(survey(), 'cfa').applicable).toBe(true)
    expect(MIN_N_CFA).toBe(100)
  })

  it('efa：n≥30 即可，n=20 要排除（门槛比 cfa 低，证明两者不是同一个数）', () => {
    const n20 = buildProfile(
      Array.from({ length: 6 }, (_, i) => `q${i + 1}`),
      buildRows({ rows: 20, scaleItems: 6 })
    )
    expect(assess(n20, 'efa').applicable).toBe(false)
    expect(assess(n20, 'efa').reasonKey).toBe('recommend.reason.sampleTooSmall')
    expect(assess(n20, 'cfa').applicable).toBe(false)
    // 关键：同一个 n=20 数据集上，efa 的门槛是 30、cfa 是 100，两者理由都应命中样本量
    expect(MIN_N_EFA).toBe(30)
  })

  it('correlation：2–5 个数值变量 → 保留；超过 5 个 → 排除（需用户指定目标）', () => {
    expect(assess(clinical(), 'correlation').applicable).toBe(true)

    // 典型问卷有 8 个数值变量（6 题项 + 年龄 + 收入）→ 超过上限
    const a = assess(survey(), 'correlation')
    expect(a.applicable).toBe(false)
    expect(a.reasonKey).toBe('recommend.reason.tooManyNumericForCorrelation')
  })

  it('regression：≥3 个数值变量 → 保留；只有 2 个 → 排除', () => {
    expect(assess(clinical(), 'regression').applicable).toBe(true)
    const twoNumeric = buildProfile(
      ['x', 'y'],
      buildRows({ rows: 100, scaleItems: 0, continuous: [['x', 1, 10], ['y', 1, 10]] })
    )
    expect(assess(twoNumeric, 'regression').applicable).toBe(false)
    expect(assess(twoNumeric, 'regression').reasonKey).toBe('recommend.reason.notEnoughNumeric')
  })

  it('logistic_regression：有真正的二分类结局 → 保留；二分类变量是性别时 → 排除', () => {
    // 结局变量 outcome（0/1 编码，无数值语义） + 连续预测变量
    const withOutcome = buildProfile(
      ['outcome', 'x1', 'x2'],
      buildRows({
        rows: 200,
        scaleItems: 0,
        continuous: [['x1', 1, 10], ['x2', 1, 10]],
        categorical: [['outcome', ['是', '否']]]
      })
    )
    expect(assess(withOutcome, 'logistic_regression').applicable).toBe(true)

    // 只有性别这一个二分类变量 → 不应把"预测性别"当作推荐
    const onlySex = buildProfile(
      ['sex', 'x1', 'x2'],
      buildRows({
        rows: 200,
        scaleItems: 0,
        continuous: [['x1', 1, 10], ['x2', 1, 10]],
        categorical: [['sex', ['男', '女']]]
      })
    )
    const a = assess(onlySex, 'logistic_regression')
    expect(a.applicable).toBe(false)
    expect(a.reasonKey).toBe('recommend.reason.noBinaryOutcome')
  })

  it('中介 / 调节：需 ≥3 个不同构念 —— 单维度量表的 6 个题项不够', () => {
    // 这是原型最主要的误荐来源：6 个题项 = 6 个数值变量，但只是 1 个构念
    const single = singleConstructScale()
    expect(countConstructs(single), '单维度 6 题项被算成了多个构念').toBe(1)

    for (const id of ['mediation', 'moderation']) {
      const a = assess(single, id)
      expect(a.applicable, `${id} 在单维度量表数据上被判定可行（同一构念的题项不能当 X/M/Y）`).toBe(
        false
      )
      expect(a.reasonKey).toBe('recommend.reason.needDistinctConstructs')
    }

    // 正例：量表题项（1 个构念）+ 年龄 + 收入 = 3 个构念
    expect(countConstructs(survey())).toBeGreaterThanOrEqual(3)
    expect(assess(survey(), 'mediation').applicable).toBe(true)
    expect(assess(survey(), 'moderation').applicable).toBe(true)
  })

  it('有调节的中介：需 ≥4 个构念（比中介严格一档）', () => {
    // 3 构念数据：中介可行、有调节的中介不可行
    const threeConstructs = buildProfile(
      ['q1', 'q2', 'q3', 'age', 'income'],
      buildRows({
        rows: 300,
        scaleItems: 3,
        continuous: [
          ['age', 18, 40],
          ['income', 2000, 18000]
        ]
      })
    )
    expect(countConstructs(threeConstructs)).toBe(3)
    expect(assess(threeConstructs, 'mediation').applicable).toBe(true)
    expect(assess(threeConstructs, 'moderated_mediation').applicable).toBe(false)
  })

  it('需要数据外信息的方法一律不进入数据驱动推荐（但标记 requiresUserInput）', () => {
    // 这些方法不是"不可行"，而是"数据本身没有这个信息"。
    // 把它们混进"针对这份数据的推荐"里，用户会以为数据能自动决定 μ₀ / 路径 / 因子结构。
    for (const id of ['ttest_one', 'path_analysis', 'sem', 'hierarchical_regression']) {
      const a = assess(survey(), id)
      expect(a.applicable, `${id} 不应在数据驱动推荐中可行`).toBe(false)
      expect(a.requiresUserInput, `${id} 未标记 requiresUserInput，AI 层拿不到这条信息`).toBe(true)
    }
  })

  it('样本量门槛：n=8 时只剩不需要样本量的方法', () => {
    const t = tiny()
    const applicable = assessMethods(t)
      .filter((a) => a.applicable)
      .map((a) => a.methodId)
    // n=8 时 descriptive / normality 仍可行（它们不依赖推断），
    // 但任何需要估计与检验的方法（相关/回归/检验类）都必须被样本量门槛拦下。
    expect(applicable, `n=8 时仍可行：${applicable.join(', ')}`).not.toContain('correlation')
    expect(applicable).not.toContain('regression')
    expect(applicable).not.toContain('ttest_independent')
    expect(applicable).not.toContain('anova')
    // 兜底上限：只剩 1–2 个体检工具
    expect(applicable.length).toBeLessThanOrEqual(2)
  })

  it('id 列被排除出数值分析（学号不能进相关/回归）', () => {
    const withId = buildProfile(
      ['student_id', 'x', 'y', 'z'],
      [
        { student_id: '2021001', x: 1.5, y: 2.5, z: 3.5 },
        { student_id: '2021002', x: 2.5, y: 3.5, z: 4.5 },
        { student_id: '2021003', x: 3.5, y: 4.5, z: 5.5 },
        { student_id: '2021004', x: 4.5, y: 5.5, z: 6.5 },
        { student_id: '2021005', x: 5.5, y: 6.5, z: 7.5 }
      ]
    )
    expect(withId.idColumns).toContain('student_id')
    expect(withId.numericColumns.map((c) => c.name)).not.toContain('student_id')
  })
})

/** 取某方法的评估结果；方法不存在时抛错（而不是返回 undefined 让断言静默通过） */
function assess(profile: DatasetProfile, methodId: string) {
  const found = assessMethods(profile).find((a) => a.methodId === methodId)
  if (!found) throw new Error(`注册表里没有方法 "${methodId}"`)
  return found
}

// ── 规则表完整性 ────────────────────────────────────────────

describe('规则表与注册表一一对应', () => {
  it('每个注册方法都有一条真实规则（不是走 default 兜底）', () => {
    const profile = typicalSurvey()
    const missing: string[] = []
    for (const m of METHODS) {
      const a = assessMethods(profile).find((x) => x.methodId === m.id)!
      // default 分支的 reason 里会带 "尚未编写推荐规则"
      if (a.reason.includes('尚未编写推荐规则')) missing.push(m.id)
    }
    expect(missing, `以下方法没有推荐规则（会走 default 兜底）：\n${missing.join('\n')}`).toEqual([])
  })

  it('方法数量与注册表一致，无重复无遗漏', () => {
    const ids = assessMethods(typicalSurvey()).map((a) => a.methodId)
    expect(ids.length).toBe(METHODS.length)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([...METHODS.map((m) => m.id)].sort())
  })

  it('评估结果是纯函数：同一份画像两次调用结果相同', () => {
    const p = typicalSurvey()
    const a = assessMethods(p).map((x) => `${x.methodId}:${x.applicable}`)
    const b = assessMethods(p).map((x) => `${x.methodId}:${x.applicable}`)
    expect(a).toEqual(b)
  })
})

// ── 配对设计识别 ────────────────────────────────────────────

describe('配对设计识别（决定配对 t vs 独立 t）', () => {
  it('识别 pre/post 命名', () => {
    const pair = detectPrePostPair(prePostClinical())
    expect(pair).not.toBeNull()
    expect(pair!.pre).toBe('score_pre')
    expect(pair!.post).toBe('score_post')
  })

  it('无前后测命名时不臆测配对关系', () => {
    expect(detectPrePostPair(typicalSurvey())).toBeNull()
  })

  it('中文前测/后测命名同样能识别', () => {
    const zh = buildProfile(
      ['成绩前测', '成绩后测', 'age'],
      buildRows({
        rows: 60,
        scaleItems: 0,
        continuous: [
          ['成绩前测', 40, 40],
          ['成绩后测', 45, 40],
          ['age', 18, 20]
        ]
      })
    )
    const pair = detectPrePostPair(zh)
    expect(pair, '中文「前测/后测」未被识别').not.toBeNull()
  })
})
