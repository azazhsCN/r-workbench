/**
 * 方法推荐规则层（v0.3.5 / T71）—— **只做"排除"，不做排序**
 *
 * ── 为什么必须是双层，为什么规则层不能排序 ──
 *
 * v0.3.3 原型实测（见 DEVELOPMENT_PLAN.md §5.5.1）：
 *   - 只用「变量类型 / 数量 / 缺失率」→ 在典型问卷数据上推荐出 **21/22 个方法**，等于没推荐。
 *   - 补上列画像（唯一值、水平数、偏度、量表题项识别）后仍是 **19/22**。
 *   - 以下判断**规则化做不了**，只能交给 AI 或用户的研究假设：
 *       · 相关 vs 回归（都"有 ≥2 个数值变量"）
 *       · EFA vs CFA（都"有量表题项"，取决于**是否有先验理论结构**）
 *       · 中介 / 调节的 X/M/Y/W 指派（**研究假设**，数据里没有这个信息）
 *       · 配对 t vs 独立 t（取决于是否同一被试前后测）
 *
 * 所以本模块的定位是**硬约束**：保证"不推荐错的方法"。至于"哪几个更贴切"，
 * 是 AI 层在可行集合里排序的事（`recommendService.ts`）。**反过来做（纯规则排序）
 * 已被原型证伪**，不要在这里加"偏好打分的排序逻辑"。
 *
 * ── 三层判定（收窄的关键在第 3 层）──
 *
 * 原型之所以只到 19/22，是因为它只做了前两层：
 *   1. **类型与数量**：变量类型对不对、个数够不够（"能不能算"）
 *   2. **样本量**：算出来的估计可不可信（"算出来有没有意义"）
 *   3. **结构是否存在**：方法要估计的那个东西，在这份数据里**到底有没有**
 *
 * 第 3 层是本次真正的收窄手段，也是最能拿得出手的几条判断：
 *   · `reliability/efa/cfa/harman` 需要**量表题项**（不是"有 3 个数值变量"就行）；
 *   · `cfa` 需要 ≥4 个题项（2 个因子各 ≥2 指标才谈得上验证性结构）；
 *   · **中介/调节需要 ≥3 个「不同的构念」**——这一点尤其重要：一份 6 题单维度量表的
 *     6 个题项只是同一个构念的 6 个指标，把其中三个当成 X/M/Y 得到的路径系数
 *     是同一份测量噪声的三次切分，**统计上算得出来、实质上毫无意义**。
 *     这也是原型最典型的误荐来源；
 *   · `cvi` 需要「行 = 专家」的评分结构，普通问卷数据一律排除；
 *   · **需要用户提供数据里没有的信息**的方法（单样本 t 的 μ₀、配对 t 的配对关系、
 *     路径分析的路径、层次回归的区块、SEM 的因子结构）不由数据驱动推荐——
 *     它们不是"不可行"，而是"数据本身没有这个信息"，由 AI 在用户说明研究问题后给出。
 *
 * ── 可单测性 ──
 * 每条规则都同时给出 `reasonKey`（语言无关）与 `reason`（英文兜底），
 * 测试直接断言 reasonKey：一旦某条规则被改坏，断言会指出**是哪一条**不成立，
 * 而不是笼统的"数量不对"。本项目吃过"断言只检查存在性"的亏（D1/D2 在 158 个
 * 测试全绿下存活一整个版本），所以这里每条规则都配有"该排除 / 该保留"的正反用例。
 */

import type { ColumnProfile, DatasetProfile } from './columnProfile'
import { METHODS } from '../data/methodRegistry'

/** 推荐理由 / 排除理由的 i18n 键（UI 用 `t(key, params)` 渲染） */
export type ReasonKey =
  | 'recommend.reason.ok'
  | 'recommend.reason.noVariables'
  | 'recommend.reason.noNumeric'
  | 'recommend.reason.notEnoughNumeric'
  | 'recommend.reason.needBinaryGroup'
  | 'recommend.reason.needMultiGroup'
  | 'recommend.reason.needTwoNominal'
  | 'recommend.reason.needScaleItems'
  | 'recommend.reason.needDistinctConstructs'
  | 'recommend.reason.sampleTooSmall'
  | 'recommend.reason.tooManyNumericForCorrelation'
  | 'recommend.reason.noBinaryOutcome'
  | 'recommend.reason.expertDataOnly'
  | 'recommend.reason.needPrePostPair'
  | 'recommend.reason.needsUserInput'
  | 'recommend.reason.nonparametricNotNeeded'
  | 'recommend.reason.inspectionFallback'

/**
 * 方法分层。
 *
 * - `primary`：回答研究问题的分析，**推荐的主体**。
 * - `inspection`：数据体检工具（描述统计 / 正态性 / 频数 / 分组汇总）。
 *   任何数据都能做，所以它不是"针对这份数据的推荐"。当存在 primary 方法时降级——
 *   否则用户会看到"描述性统计"和"验证性因子分析"并列第一，等于没有推荐。
 * - `diagnostic`：针对特定偏差的专项诊断（Harman 共同方法偏差）。
 *   同样是"配套检查"而非主分析。
 */
export type MethodTier = 'primary' | 'inspection' | 'diagnostic'

/** 单个方法的评估结果 */
export interface MethodAssessment {
  methodId: string
  /** 硬必要条件是否全部满足（= 统计上可行） */
  applicable: boolean
  /** 理由键（语言无关，UI 负责本地化） */
  reasonKey: ReasonKey
  /** 理由参数（如 `{ min: 3, actual: 2 }`） */
  params?: Record<string, string | number>
  /** 英文兜底说明（语言包缺键时显示，也便于阅读测试失败信息） */
  reason: string
  /**
   * 适用度分数（0–100）。
   *
   * ⚠️ **不用于排序**。规则层不做排序（原型已证伪）。它只用来在 UI 上
   * 表达"必要条件满足得有多充分"（例如缺失率 >30% 会扣分），
   * 排序由 AI 层依据研究问题完成。
   */
  score: number
  tier: MethodTier
  /**
   * 该方法是否需要**数据里不存在的信息**（μ₀、配对关系、路径规格、区块划分、因子结构）。
   * 这类方法不进入数据驱动的推荐集合，但会被列进 AI Prompt 的"可补充"清单。
   */
  requiresUserInput: boolean
  /** 被更具体 / 更基础的方法取代时填原因（例如有 primary 时 inspection 被降级） */
  demoteReasonKey?: ReasonKey
}

/** 样本量门槛 */
export const MIN_N_DEFAULT = 10
export const MIN_N_EFA = 30
export const MIN_N_CFA = 100
/** 可做 SEM 的样本量门槛（与 CFA 同档：都是一般化潜变量模型） */
export const MIN_N_SEM = 100

/** 量表题项数门槛 */
export const MIN_SCALE_ITEMS = 3
/** CFA 至少 4 题（2 因子 × ≥2 指标），否则"验证性"无从谈起 */
export const MIN_SCALE_ITEMS_CFA = 4
/** 一个潜变量至少几个指标才算"可以估计" */
export const MIN_ITEMS_PER_CONSTRUCT = 2

/**
 * 相关分析的目标变量数上限。
 *
 * 相关分析（向导里 `minVars === maxVars === 2`）针对**少数目标变量**。
 * 当数据有 6–8 个数值变量时，"该拿哪两个来做相关"本身取决于研究问题，
 * 而且此时更贴切的推荐是回归 / 因子分析。所以超过该上限时不推荐相关分析，
 * 理由标注为"需要用户指定两个目标变量"。
 */
export const MAX_NUMERIC_FOR_CORRELATION = 5

/**
 * 中介 / 调节类方法所需的**不同构念**数。
 *
 * 为什么是构念数而不是数值变量数：单维度量表的 6 个题项可以轻松凑够
 * "≥3 个数值变量"，但它们是同一个构念的 6 个指标。把其中三个当 X/M/Y，
 * 得到的是同一份测量噪声被切成三段后的路径系数——算得出来，但**没有意义**。
 * 这是原型最主要的误荐来源之一。
 */
export const MIN_CONSTRUCTS_CAUSAL = 3
/** 有调节的中介需要 4 个不同构念（X / M / Y / W） */
export const MIN_CONSTRUCTS_MODERATED_MEDIATION = 4

// ── 构念识别 ────────────────────────────────────────────────

/**
 * 量表题项的"构念前缀"：`q1`→`q`、`item12`→`item`、`题3`→`题`。
 * 前缀相同的一组题项视为同一个构念的多个指标。
 */
function constructKey(name: string): string {
  return name
    .trim()
    // `-` 放在字符类末尾无需转义（转义会触发 no-useless-escape）
    .replace(/[\s_-]*\d+$/, '')
    .toLowerCase()
}

/**
 * 估算数据里有多少个**不同的构念**。
 *
 * = 量表题项按前缀聚成的组数 + 非量表数值列（各自是独立测量）的数量。
 *
 * 这是一个**下界估计**：真实构念数可能更多（同一前缀也可能是两个构念），
 * 但用来做"够不够 3 个"的门槛判断足够了——宁可少算也不多算，
 * 因为多算会误荐中介分析。
 */
export function countConstructs(profile: DatasetProfile): number {
  const scalePrefixes = new Set(profile.scaleItems.map((c) => constructKey(c.name)))
  // 只算"有足够指标"的前缀组：1 个孤立的 q7 不成其为构念
  const prefixCounts = new Map<string, number>()
  for (const c of profile.scaleItems) {
    const k = constructKey(c.name)
    prefixCounts.set(k, (prefixCounts.get(k) ?? 0) + 1)
  }
  let groups = 0
  for (const count of prefixCounts.values()) {
    if (count >= MIN_ITEMS_PER_CONSTRUCT) groups++
  }
  // 非量表数值列：每一列是一个独立测量（年龄、收入、总分……）
  const standalone = profile.numericColumns.filter((c) => !c.is_scale_item)
  void scalePrefixes
  return groups + standalone.length
}

// ── 配对设计识别 ────────────────────────────────────────────

/** 前测 / 后测命名模式（用于判断是否能做配对 t 检验） */
const PRE_PATTERN = /(^|[^a-z])(pre|t1|baseline|前测|干预前|测前)([^a-z]|$)/i
const POST_PATTERN = /(^|[^a-z])(post|t2|followup|follow_up|后测|干预后|测后)([^a-z]|$)/i

/**
 * 是否检测到配对设计（前后测成对出现）。
 *
 * 为什么必须靠命名：配对 t 检验的合法性来自**研究设计**（同一被试测两次），
 * 而不是数据分布。数据结构上"两列数值变量"既可以配对也可以独立，
 * 规则层无法从数值本身判断——这正是 DEVELOPMENT_PLAN §5.5.1 列的
 * "配对 t vs 独立 t 取决于是否同一被试前后测"。
 *
 * 因此：只有列名明显是前后测时才推荐配对 t；否则标记为"需要用户确认设计"。
 */
export function detectPrePostPair(profile: DatasetProfile): { pre: string; post: string } | null {
  const numeric = profile.numericColumns
  const prese = numeric.filter((c) => PRE_PATTERN.test(c.name))
  const poste = numeric.filter((c) => POST_PATTERN.test(c.name))
  if (prese.length === 0 || poste.length === 0) return null

  // 同前缀配对（score_pre ↔ score_post）；找不到同前缀时退化为第一对
  for (const pre of prese) {
    const base = constructKey(pre.name.replace(PRE_PATTERN, ''))
    const match = poste.find((c) => constructKey(c.name.replace(POST_PATTERN, '')) === base)
    if (match) return { pre: pre.name, post: match.name }
  }
  return { pre: prese[0].name, post: poste[0].name }
}

/**
 * 是否存在"真正的二分类结局变量"（Logistic 回归的前提）。
 *
 * 排除人口学变量：把性别当因变量做 Logistic 回归在数学上可行，
 * 但那是"用其它变量预测性别"，几乎不可能是用户的研究问题。
 * 这类"算得出但没意义"的推荐正是规则层要拦的。
 */
function findBinaryOutcome(profile: DatasetProfile): ColumnProfile | null {
  const excluded = new Set(['gender', 'group', 'id'])
  return (
    profile.binaryGroups.find(
      (c) => !c.semantic_hint || !excluded.has(c.semantic_hint)
    ) ?? null
  )
}

/** 某列缺失率是否过高（>30% 时扣分，但不排除——缺失是可以处理的） */
function hasHighMissing(columns: ColumnProfile[]): boolean {
  return columns.some((c) => c.total > 0 && c.missing / c.total > 0.3)
}

// ── 评估结果构造助手 ────────────────────────────────────────

function ok(
  methodId: string,
  reasonKey: ReasonKey,
  score: number,
  tier: MethodTier,
  params?: Record<string, string | number>
): MethodAssessment {
  return {
    methodId,
    applicable: true,
    reasonKey,
    reason: 'Meets all necessary conditions for this data',
    params,
    score,
    tier,
    requiresUserInput: false
  }
}

function no(
  methodId: string,
  reasonKey: ReasonKey,
  reason: string,
  tier: MethodTier,
  opts: { params?: Record<string, string | number>; requiresUserInput?: boolean } = {}
): MethodAssessment {
  return {
    methodId,
    applicable: false,
    reasonKey,
    reason,
    params: opts.params,
    score: 0,
    tier,
    requiresUserInput: opts.requiresUserInput === true
  }
}

/** 各方法的分层（决定"降级"行为；与注册表 id 一一对应） */
const METHOD_TIERS: Record<string, MethodTier> = {
  descriptive: 'inspection',
  normality: 'inspection',
  frequency: 'inspection',
  summary_by: 'inspection',
  harman: 'diagnostic',
  cvi: 'diagnostic'
}

/** 分级查询（默认 primary） */
function tierOf(methodId: string): MethodTier {
  return METHOD_TIERS[methodId] ?? 'primary'
}

// ── 主规则表 ────────────────────────────────────────────────

/**
 * 评估全部注册方法。
 *
 * 未知方法（注册表里新增但这里没写规则）**默认判定为不可行**，
 * 并给出 `noVariables` 之外的显式理由：宁可少推荐，也不能因为"忘了写规则"
 * 而把一个未经验证的方法推给用户。同时下方测试会断言"每个注册方法都有一条规则"。
 */
export function assessMethods(profile: DatasetProfile): MethodAssessment[] {
  return METHODS.map((m) => assessOne(m.id, profile))
}

/** 单个方法的规则。返回 `null` 表示"注册表里有、但规则表没覆盖" */
function assessOne(methodId: string, p: DatasetProfile): MethodAssessment {
  const tier = tierOf(methodId)
  const n = p.rowCount
  const numeric = p.numericColumns
  const numericCount = numeric.length
  const scaleCount = p.scaleItems.length
  const constructs = countConstructs(p)

  switch (methodId) {
    // ── 数据体检工具 ──────────────────────────────────────
    case 'descriptive':
      if (p.columns.length === 0) {
        return no(methodId, 'recommend.reason.noVariables', '数据集没有任何变量', tier)
      }
      return ok(methodId, 'recommend.reason.ok', n >= MIN_N_DEFAULT ? 40 : 20, tier)

    case 'normality':
      if (numericCount === 0) {
        return no(methodId, 'recommend.reason.noNumeric', '没有数值变量可做正态性检验', tier)
      }
      return ok(methodId, 'recommend.reason.ok', 35, tier)

    case 'frequency':
      if (p.categoricalColumns.length === 0) {
        return no(methodId, 'recommend.reason.noVariables', '没有分类变量可统计频数', tier)
      }
      return ok(methodId, 'recommend.reason.ok', 35, tier)

    case 'summary_by':
      if (p.multiGroups.length === 0) {
        return no(
          methodId,
          'recommend.reason.needMultiGroup',
          '需要至少 1 个 ≥3 水平的分类变量做分组汇总',
          tier
        )
      }
      return ok(methodId, 'recommend.reason.ok', 40, tier)

    // ── 组间差异 ──────────────────────────────────────────
    case 'ttest_independent':
      if (p.binaryGroups.length === 0) {
        return no(
          methodId,
          'recommend.reason.needBinaryGroup',
          '需要恰好 2 个水平的分类变量作为分组依据',
          tier
        )
      }
      if (numericCount === 0) {
        return no(methodId, 'recommend.reason.noNumeric', '没有数值变量可比较', tier)
      }
      if (n < MIN_N_DEFAULT) {
        return no(methodId, 'recommend.reason.sampleTooSmall', `样本量 ${n} < ${MIN_N_DEFAULT}`, tier, {
          params: { min: MIN_N_DEFAULT, actual: n }
        })
      }
      // 明显偏态时 t 检验不是首选：把推荐让给非参数检验（正态性门槛，见 §5.5.6 风险条款）
      if (p.hasNonNormalNumeric) {
        return {
          ...no(
            methodId,
            'recommend.reason.nonparametricNotNeeded',
            '数值变量存在明显偏态（|偏度| > 1），非参数检验更合适',
            tier
          ),
          applicable: true,
          score: 45,
          demoteReasonKey: 'recommend.reason.nonparametricNotNeeded'
        }
      }
      return ok(methodId, 'recommend.reason.ok', 80, tier)

    case 'nonparametric':
      if (p.binaryGroups.length === 0) {
        return no(
          methodId,
          'recommend.reason.needBinaryGroup',
          '需要恰好 2 个水平的分类变量',
          tier
        )
      }
      if (numericCount === 0) {
        return no(methodId, 'recommend.reason.noNumeric', '没有数值变量可比较', tier)
      }
      if (n < MIN_N_DEFAULT) {
        return no(methodId, 'recommend.reason.sampleTooSmall', `样本量 ${n} < ${MIN_N_DEFAULT}`, tier, {
          params: { min: MIN_N_DEFAULT, actual: n }
        })
      }
      if (!p.hasNonNormalNumeric) {
        // 数据近似正态时非参数检验是**不必要的替代方案**：不排除，但明确降级，
        // 避免用户以为"该用非参数"。这是"宁可少推荐一个方法"的取舍。
        return {
          ...no(
            methodId,
            'recommend.reason.nonparametricNotNeeded',
            '数值变量未明显偏离正态，参数检验（t 检验）更合适',
            tier
          ),
          applicable: true,
          score: 30,
          demoteReasonKey: 'recommend.reason.nonparametricNotNeeded'
        }
      }
      return ok(methodId, 'recommend.reason.ok', 70, tier)

    case 'anova':
      if (p.multiGroups.length === 0) {
        return no(
          methodId,
          'recommend.reason.needMultiGroup',
          '需要至少 1 个 ≥3 水平的分类变量；只有 2 水平时 t 检验更合适',
          tier
        )
      }
      if (numericCount === 0) {
        return no(methodId, 'recommend.reason.noNumeric', '没有数值因变量', tier)
      }
      if (n < MIN_N_DEFAULT) {
        return no(methodId, 'recommend.reason.sampleTooSmall', `样本量 ${n} < ${MIN_N_DEFAULT}`, tier, {
          params: { min: MIN_N_DEFAULT, actual: n }
        })
      }
      return ok(methodId, 'recommend.reason.ok', 80, tier)

    case 'chisquare':
      if (p.nominalColumns.length < 2) {
        return no(
          methodId,
          'recommend.reason.needTwoNominal',
          `需要 ≥2 个分类变量（当前 ${p.nominalColumns.length} 个）`,
          tier,
          { params: { actual: p.nominalColumns.length } }
        )
      }
      return ok(methodId, 'recommend.reason.ok', 70, tier)

    // ── 关联与回归 ────────────────────────────────────────
    case 'correlation':
      if (numericCount < 2) {
        return no(
          methodId,
          'recommend.reason.notEnoughNumeric',
          `需要 ≥2 个数值变量（当前 ${numericCount} 个）`,
          tier,
          { params: { min: 2, actual: numericCount } }
        )
      }
      if (n < MIN_N_DEFAULT) {
        return no(methodId, 'recommend.reason.sampleTooSmall', `样本量 ${n} < ${MIN_N_DEFAULT}`, tier, {
          params: { min: MIN_N_DEFAULT, actual: n }
        })
      }
      if (numericCount > MAX_NUMERIC_FOR_CORRELATION) {
        return no(
          methodId,
          'recommend.reason.tooManyNumericForCorrelation',
          `数值变量过多（${numericCount} 个），相关分析针对少数目标变量；此时回归 / 因子分析更贴切，且"选哪两个"取决于研究问题`,
          tier,
          { params: { max: MAX_NUMERIC_FOR_CORRELATION, actual: numericCount } }
        )
      }
      return ok(methodId, 'recommend.reason.ok', 75, tier)

    case 'regression':
      if (numericCount < 3) {
        return no(
          methodId,
          'recommend.reason.notEnoughNumeric',
          `需要 ≥3 个数值变量（1 个因变量 + ≥2 个自变量），当前 ${numericCount} 个`,
          tier,
          { params: { min: 3, actual: numericCount } }
        )
      }
      return ok(methodId, 'recommend.reason.ok', hasHighMissing(numeric) ? 55 : 75, tier)

    case 'logistic_regression':
      if (!findBinaryOutcome(p)) {
        return no(
          methodId,
          'recommend.reason.noBinaryOutcome',
          '需要 1 个真正的二分类结局变量（人口学变量如性别/分组不算结局）',
          tier
        )
      }
      if (numericCount < 1) {
        return no(methodId, 'recommend.reason.noNumeric', '没有数值自变量', tier)
      }
      return ok(methodId, 'recommend.reason.ok', 70, tier)

    case 'hierarchical_regression':
      // 需要用户指定"变量按什么顺序分区块进入"——这是理论假设，数据里没有
      return no(
        methodId,
        'recommend.reason.needsUserInput',
        '需要用户按理论指定变量进入模型的区块顺序（数据里没有这个信息）',
        tier,
        { requiresUserInput: true }
      )

    // ── 测量质量（问卷）──────────────────────────────────
    case 'reliability':
      if (scaleCount < MIN_SCALE_ITEMS) {
        return no(
          methodId,
          'recommend.reason.needScaleItems',
          `需要 ≥${MIN_SCALE_ITEMS} 个量表题项（当前 ${scaleCount} 个）`,
          tier,
          { params: { min: MIN_SCALE_ITEMS, actual: scaleCount } }
        )
      }
      return ok(methodId, 'recommend.reason.ok', 85, tier)

    case 'efa':
      if (scaleCount < MIN_SCALE_ITEMS) {
        return no(
          methodId,
          'recommend.reason.needScaleItems',
          `需要 ≥${MIN_SCALE_ITEMS} 个量表题项（当前 ${scaleCount} 个）`,
          tier,
          { params: { min: MIN_SCALE_ITEMS, actual: scaleCount } }
        )
      }
      if (n < MIN_N_EFA) {
        return no(methodId, 'recommend.reason.sampleTooSmall', `样本量 ${n} < ${MIN_N_EFA}`, tier, {
          params: { min: MIN_N_EFA, actual: n }
        })
      }
      return ok(methodId, 'recommend.reason.ok', 80, tier)

    case 'cfa':
      if (scaleCount < MIN_SCALE_ITEMS_CFA) {
        return no(
          methodId,
          'recommend.reason.needScaleItems',
          `需要 ≥${MIN_SCALE_ITEMS_CFA} 个题项（2 个因子各 ≥2 指标）才能做验证性分析，当前 ${scaleCount} 个`,
          tier,
          { params: { min: MIN_SCALE_ITEMS_CFA, actual: scaleCount } }
        )
      }
      if (n < MIN_N_CFA) {
        return no(methodId, 'recommend.reason.sampleTooSmall', `样本量 ${n} < ${MIN_N_CFA}`, tier, {
          params: { min: MIN_N_CFA, actual: n }
        })
      }
      return ok(methodId, 'recommend.reason.ok', 80, tier)

    case 'harman':
      if (scaleCount < MIN_SCALE_ITEMS) {
        return no(
          methodId,
          'recommend.reason.needScaleItems',
          `需要 ≥${MIN_SCALE_ITEMS} 个量表题项（当前 ${scaleCount} 个）`,
          tier,
          { params: { min: MIN_SCALE_ITEMS, actual: scaleCount } }
        )
      }
      return ok(methodId, 'recommend.reason.ok', 60, tier)

    case 'cvi':
      // ⚠️ 原型验证的最易误荐方法：它要求「行 = 专家、列 = 题项」的评分数据
      if (!p.looksLikeExpertRating) {
        return no(
          methodId,
          'recommend.reason.expertDataOnly',
          'CVI 需要「行 = 专家、列 = 题项」的内容效度评分数据；普通问卷（行 = 被试）一律排除',
          tier
        )
      }
      return ok(methodId, 'recommend.reason.ok', 80, tier)

    // ── 因果链 ────────────────────────────────────────────
    case 'mediation':
    case 'moderation':
      if (numericCount < 3) {
        return no(
          methodId,
          'recommend.reason.notEnoughNumeric',
          `需要 ≥3 个数值变量（当前 ${numericCount} 个）`,
          tier,
          { params: { min: 3, actual: numericCount } }
        )
      }
      if (constructs < MIN_CONSTRUCTS_CAUSAL) {
        return no(
          methodId,
          'recommend.reason.needDistinctConstructs',
          `需要 ≥${MIN_CONSTRUCTS_CAUSAL} 个不同的构念，当前约 ${constructs} 个；同一份量表的多个题项是同一构念的指标，不能当作 X/M/Y`,
          tier,
          { params: { min: MIN_CONSTRUCTS_CAUSAL, actual: constructs } }
        )
      }
      return ok(methodId, 'recommend.reason.ok', 70, tier)

    case 'moderated_mediation':
      if (numericCount < 4) {
        return no(
          methodId,
          'recommend.reason.notEnoughNumeric',
          `需要 ≥4 个数值变量（X / M / Y / W），当前 ${numericCount} 个`,
          tier,
          { params: { min: 4, actual: numericCount } }
        )
      }
      if (constructs < MIN_CONSTRUCTS_MODERATED_MEDIATION) {
        return no(
          methodId,
          'recommend.reason.needDistinctConstructs',
          `需要 ≥${MIN_CONSTRUCTS_MODERATED_MEDIATION} 个不同的构念，当前约 ${constructs} 个`,
          tier,
          { params: { min: MIN_CONSTRUCTS_MODERATED_MEDIATION, actual: constructs } }
        )
      }
      return ok(methodId, 'recommend.reason.ok', 65, tier)

    case 'path_analysis':
      return no(
        methodId,
        'recommend.reason.needsUserInput',
        '需要用户提供路径列表（谁指向谁），数据里没有这个信息',
        tier,
        { requiresUserInput: true }
      )

    case 'sem':
      return no(
        methodId,
        'recommend.reason.needsUserInput',
        '需要用户提供潜变量与指标的对应关系（因子结构），数据无法自动确定',
        tier,
        { requiresUserInput: true }
      )

    // ── 需要数据外信息 ────────────────────────────────────
    case 'ttest_one':
      return no(
        methodId,
        'recommend.reason.needsUserInput',
        '需要外部参照值 μ₀（如理论均值、常模分数），数据本身不含该信息',
        tier,
        { requiresUserInput: true }
      )

    case 'ttest_paired': {
      const pair = detectPrePostPair(p)
      if (!pair) {
        return no(
          methodId,
          'recommend.reason.needPrePostPair',
          '未检测到前后测配对变量；配对设计的合法性来自研究设计，无法从数据分布推断',
          tier,
          { requiresUserInput: true }
        )
      }
      if (n < MIN_N_DEFAULT) {
        return no(methodId, 'recommend.reason.sampleTooSmall', `样本量 ${n} < ${MIN_N_DEFAULT}`, tier, {
          params: { min: MIN_N_DEFAULT, actual: n }
        })
      }
      return ok(methodId, 'recommend.reason.ok', 80, tier, {
        pre: pair.pre,
        post: pair.post
      })
    }

    default:
      // 注册表新增但规则未覆盖 → 一律不推荐，并在 reason 里点明
      return no(
        methodId,
        'recommend.reason.noVariables',
        `方法 "${methodId}" 尚未编写推荐规则（宁可少推荐，也不推未经验证的方法）`,
        tier
      )
  }
}

// ── 降级与筛选 ──────────────────────────────────────────────

/**
 * 应用降级规则，得到**可推荐**的方法集合。
 *
 * 降级 ≠ 排除。被降级的方法统计上可行、用户仍可手动选择，
 * 只是不作为"针对这份数据的推荐"呈现：
 *
 *   1. **体检工具**（descriptive / normality / frequency / summary_by）：
 *      存在任何 primary 方法时降级。理由——任何数据都能做描述统计，
 *      把它和"验证性因子分析"并列推荐等于没有推荐。
 *   2. **专项诊断**（harman / cvi 之外的诊断类）：存在 ≥2 个 primary 时降级，
 *      它们是配套检查而不是主分析。
 *
 * 注意：这里**不做排序**（原型已证伪纯规则排序）。返回顺序沿用注册表顺序，
 * 真正的排序交给 AI 层。
 */
export function recommendableMethods(profile: DatasetProfile): MethodAssessment[] {
  const all = assessMethods(profile)
  const primaryCount = all.filter((a) => a.applicable && a.tier === 'primary').length

  return all.filter((a) => {
    if (!a.applicable) return false
    if (a.demoteReasonKey) return false
    if (a.tier === 'inspection' && primaryCount > 0) return false
    if (a.tier === 'diagnostic' && primaryCount > 0) return false
    return true
  })
}

/**
 * 需要用户补充信息的方法（不进入数据驱动推荐，但要告诉 AI"这些方法存在，
 * 若用户的研究问题涉及，请给出建议的变量/路由"）。
 */
export function userInputRequiredMethods(profile: DatasetProfile): MethodAssessment[] {
  return assessMethods(profile).filter((a) => a.requiresUserInput)
}

/** 评估汇总，供 UI 与测试直接使用 */
export interface RecommendationSummary {
  recommendable: MethodAssessment[]
  requiresUserInput: MethodAssessment[]
  /** 全部评估（含被排除的），便于 UI 解释"为什么没推荐某个方法" */
  all: MethodAssessment[]
  constructCount: number
}

/** 一次性算出推荐所需的全部信息 */
export function summarizeRecommendation(profile: DatasetProfile): RecommendationSummary {
  const all = assessMethods(profile)
  const primaryCount = all.filter((a) => a.applicable && a.tier === 'primary').length
  const recommendable = all.filter((a) => {
    if (!a.applicable) return false
    if (a.demoteReasonKey) return false
    if (a.tier === 'inspection' && primaryCount > 0) return false
    if (a.tier === 'diagnostic' && primaryCount > 0) return false
    return true
  })
  return {
    recommendable,
    requiresUserInput: all.filter((a) => a.requiresUserInput),
    all,
    constructCount: countConstructs(profile)
  }
}
