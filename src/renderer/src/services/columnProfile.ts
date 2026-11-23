/**
 * 列画像（v0.3.5 / T70）—— 智能方法推荐的地基
 *
 * ── 为什么需要它 ──
 * 现有 `ColumnInfo` 只有 `name / type / missing / total`，这四个字段**不足以判断
 * 一个方法是否适用**：
 *
 *   | 需要判断的事 | 只看 ColumnInfo 的后果 |
 *   |---|---|
 *   | 这列是性别（2 水平）还是成绩（连续） | 两者都是 `numeric`，t 检验与回归无法区分 |
 *   | 这组题项是否构成量表 | 无法识别 → 信度/EFA/CFA 全部误荐 |
 *   | 学号列要不要参与分析 | 会被当连续变量送进相关/回归，产出无意义的 r |
 *
 * v0.3.3 的原型实测：只用「类型 + 数量 + 缺失率」做规则推荐，在典型问卷数据上
 * 推荐出 **21/22 个方法**——等于没推荐。补上唯一值数、水平数、偏度、量表题项识别
 * 后仍是 **19/22**。本模块提供的就是"补上之后"的基础事实。
 *
 * ── 设计约束 ──
 * 1. **纯函数**：不读文件、不碰 React、不调用 R，便于单测。
 * 2. **不重复定义"缺失"**：复用 `dataService.isMissingValue()` / `isNumericLike()`
 *    与导入、R 端共用同一套哨兵常量（单一真相）。这与 `dataQuality.ts` 的做法一致。
 * 3. **只画像、不下结论**："这列像量表题项"是可判定事实；
 *    "该用 EFA 还是 CFA"是研究假设，本模块**不做**该判断（见 recommendRules 说明）。
 *
 * ── 顺带解决 D20 ──
 * `ChatPage.getDataContext()` 此前只传变量名/类型/样本数，AI 不知道数据分布。
 * 这份画像正是它缺的东西：一份画像，两处受益（推荐 + AI 上下文）。
 */

import { isMissingValue, isNumericLike } from './dataService'

/** 单列画像 */
export interface ColumnProfile {
  name: string
  type: 'numeric' | 'string'
  missing: number
  total: number
  /** 唯一值数（缺失值不计入） */
  cardinality: number
  /** 唯一值 / 有效样本；越小越"像分类变量" */
  ratio: number
  /** 以下仅数值列有值 */
  mean?: number
  sd?: number
  /** 偏度（总体式 m3 / sd^3，与 R 的 `e1071::skewness(type=1)` 同口径） */
  skew?: number
  /** 峰度（超额峰度，正态 = 0） */
  kurtosis?: number
  /** 数值列但唯一值很少、且全为整数 → 实质是分类变量（Likert 5 点等） */
  likely_categorical: boolean
  /** 匹配到的语义线索 */
  semantic_hint?: SemanticHint
  /** 是否像量表题项（信度/因子分析的前提） */
  is_scale_item: boolean
}

/**
 * 语义线索。
 *
 * ⚠️ 只覆盖**常见命名模式**，覆盖不到的交给 AI 理解——这正是双层设计里
 * AI 层不可省略的原因。规则层的 `semantic_hint` 只是"能确定的部分"。
 */
export type SemanticHint =
  /** 主键 / 学号 / 编号：**不得参与任何统计分析** */
  | 'id'
  | 'age'
  | 'gender'
  /** 量表题项（q1 / item3 / 题2） */
  | 'likert_item'
  /** 得分 / 总分 / 成绩 */
  | 'score'
  /** 分组变量（group / 组别 / 班级 / 条件） */
  | 'group'

/** 数据集级画像：规则层的直接输入 */
export interface DatasetProfile {
  rowCount: number
  columns: ColumnProfile[]
  /** 可参与数值分析的列（已剔除 id 列） */
  numericColumns: ColumnProfile[]
  /** 分类列（字符串列 + 数值但实质分类的列），已剔除 id 列 */
  categoricalColumns: ColumnProfile[]
  /** 像量表题项的数值列 */
  scaleItems: ColumnProfile[]
  /**
   * 可作分组变量的列（t / ANOVA / 非参数检验的前提）。
   * **已排除量表题项**——5 点李克特题项不能被当作 5 个"人群"。
   */
  groupingColumns: ColumnProfile[]
  /** 恰好 2 个水平的分类变量（t 检验 / 非参数检验的前提） */
  binaryGroups: ColumnProfile[]
  /** ≥3 个水平的分类变量（ANOVA 的前提） */
  multiGroups: ColumnProfile[]
  /** 名义上的分类变量数（字符串列；用于卡方检验的"≥2 个分类变量"判定） */
  nominalColumns: ColumnProfile[]
  /** 是否存在明显偏态的数值列（非参数检验的适用前提） */
  hasNonNormalNumeric: boolean
  /** 被判为 id/主键而排除的列名 */
  idColumns: string[]
  /** 是否检测到"行=专家"的评分结构（CVI 的唯一合法前提） */
  looksLikeExpertRating: boolean
}

// ── 判定阈值 ────────────────────────────────────────────────

/**
 * 数值列被认定为"实质分类变量"的最大唯一值数。
 *
 * 5 点李克特只有 5 个取值；而年龄即使取整也会有几十个不同值。
 * 取 10 是为了容纳 1–10 分制量表，同时不会把"考试分数"（通常 40+ 个不同值）算进来。
 */
const CATEGORICAL_MAX_CARDINALITY = 10

/** 唯一值/有效样本 低于该比例时才可能是分类变量（避免小样本误判） */
const CATEGORICAL_MAX_RATIO = 0.2

/** 量表题项要求的最小/最大水平数（1–10 分制） */
const SCALE_MIN_LEVELS = 2
const SCALE_MAX_LEVELS = 10

/**
 * "明显偏态"的判据：|偏度| > 1。
 *
 * 这是一个**保守**的阈值（保守 = 宁可判定为"正态），因为它的唯一用途是
 * 决定要不要推荐非参数检验。数据其实偏态却推荐了参数检验，损失是统计功效；
 * 数据其实正态却推荐非参数检验，损失是**用户被告知要用一个并非必要的替代方法**。
 * 后者的困惑成本更高，所以阈值取宽。
 */
const SKEW_LIMIT = 1

// ── 语义识别 ────────────────────────────────────────────────

/** id / 学号 / 编号 / 序号 这类主键列 */
const ID_PATTERN =
  /^(id|no\.?|num|index|idx|rowid|uuid|guid|key)$|(^|[_\s])(id|编号|序号|学号|工号)$|编号$|序号$|学号$|工号$/i
const AGE_PATTERN = /^(age|年龄|年纪|岁数)$|年龄|岁数/i
const GENDER_PATTERN = /^(gender|sex|性别)$|^性别|性别$/i
const LIKERT_PATTERN = /^(q|item|t|v|题|题项)\s*\d+$/i
const SCORE_PATTERN = /score|得分|成绩|总分|total/i
const GROUP_PATTERN = /^(group|grp|cond|condition|class|班级|组别|分组|组)$|组别|分组|班级/i

/**
 * 按列名猜语义。
 *
 * 顺序有意义：`id` 必须最先判定，否则 `student_id` 会先被 `age`/`score` 之类
 * 不匹配、最后落到"什么都不像"——而 id 列必须被排除，不能靠"什么都不像"来兜。
 */
function detectSemanticHint(name: string): SemanticHint | undefined {
  const raw = name.trim()
  if (!raw) return undefined
  if (ID_PATTERN.test(raw) && !LIKERT_PATTERN.test(raw)) return 'id'
  if (AGE_PATTERN.test(raw)) return 'age'
  if (GENDER_PATTERN.test(raw)) return 'gender'
  if (LIKERT_PATTERN.test(raw)) return 'likert_item'
  if (GROUP_PATTERN.test(raw)) return 'group'
  if (SCORE_PATTERN.test(raw)) return 'score'
  return undefined
}

// ── 统计量 ──────────────────────────────────────────────────

/** 样本标准差（n−1），与 R 的 `sd()` 一致 */
function sampleSd(values: number[], mean: number): number {
  const n = values.length
  if (n < 2) return Number.NaN
  const ss = values.reduce((a, v) => a + (v - mean) ** 2, 0)
  return Math.sqrt(ss / (n - 1))
}

/**
 * 偏度与超额峰度。
 *
 * 用**总体式矩**（除以 n 而非 n−1），与 `e1071::skewness(type = 1)` /
 * `kurtosis(type = 1)` 同口径；这样这里判定的"偏态"与 R 端后续正态性检验
 * 不会互相矛盾。样本量 < 3 时矩无意义，返回 NaN。
 */
function skewKurtosis(values: number[], mean: number, sd: number): { skew: number; kurtosis: number } {
  const n = values.length
  if (n < 3 || !Number.isFinite(sd) || sd === 0) {
    return { skew: Number.NaN, kurtosis: Number.NaN }
  }
  let m3 = 0
  let m4 = 0
  for (const v of values) {
    const d = (v - mean) / sd
    m3 += d ** 3
    m4 += d ** 4
  }
  return { skew: m3 / n, kurtosis: m4 / n - 3 }
}

// ── 单列画像 ────────────────────────────────────────────────

/**
 * 画像单列。
 *
 * @param name 列名
 * @param rows 数据行（顺序无关）
 * @param declaredType `analyzeColumns()` 已判定的类型。**必须传入**，
 *   不在这里重新推断——两处若用不同门槛，会出现"向导里是数值变量、
 *   推荐时却当字符串"的裂缝（`dataQuality.ts` 的注释记录了同类教训）。
 */
export function profileColumn(
  name: string,
  rows: Record<string, unknown>[],
  declaredType: 'numeric' | 'string' | 'unknown'
): ColumnProfile {
  const total = rows.length
  const values: number[] = []
  const rawTexts: string[] = []
  let missing = 0
  for (const row of rows) {
    const value = row[name]
    if (isMissingValue(value)) {
      missing++
      continue
    }
    rawTexts.push(typeof value === 'number' ? String(value) : String(value).trim())
    if (isNumericLike(value)) {
      values.push(Number(typeof value === 'string' ? value.trim() : value))
    }
  }
  // 注意：这里不重算"数值占比"。类型判定统一取 `analyzeColumns()` 的结论
  // （由调用方通过 declaredType 传入），两处若各用一套门槛会产生裂缝——
  // `dataQuality.ts` 的注释记录了同类教训。

  const nonMissing = rawTexts.length
  const cardinality = new Set(rawTexts).size
  const ratio = nonMissing > 0 ? cardinality / nonMissing : 0
  const semanticHint = detectSemanticHint(name)

  // 类型判定与 analyzeColumns 保持一致：unknown 列（全缺失）按 string 处理，
  // 因为它在向导里既不进数值列表也不进分类列表，画像里也不该假装它有分布。
  const type: 'numeric' | 'string' = declaredType === 'numeric' ? 'numeric' : 'string'

  const profile: ColumnProfile = {
    name,
    type,
    missing,
    total,
    cardinality,
    ratio,
    likely_categorical: false,
    semantic_hint: semanticHint,
    is_scale_item: false
  }

  // 实质为分类变量的数值列：小幅整数取值 + 唯一值少 + 占有效样本比例低。
  // 三个条件必须同时成立——只看唯一值数会把"考试分数 5 个档位"误判；
  // 只看 ratio 会把小样本的连续变量误判。
  const allIntegers = values.length > 0 && values.every((v) => Math.abs(v - Math.round(v)) < 1e-8)
  if (type === 'numeric') {
    profile.likely_categorical =
      allIntegers &&
      cardinality >= SCALE_MIN_LEVELS &&
      cardinality <= CATEGORICAL_MAX_CARDINALITY &&
      ratio <= CATEGORICAL_MAX_RATIO

    // 量表题项：实质分类 + 最小值为非负整数（1–10 分制的题项）
    profile.is_scale_item =
      allIntegers &&
      cardinality >= SCALE_MIN_LEVELS &&
      cardinality <= SCALE_MAX_LEVELS &&
      values.length >= 3 &&
      Math.min(...values) >= 0

    if (values.length > 0) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const sd = sampleSd(values, mean)
      const { skew, kurtosis } = skewKurtosis(values, mean, sd)
      profile.mean = mean
      profile.sd = sd
      profile.skew = skew
      profile.kurtosis = kurtosis
    }
  }

  // id 列即使看起来像数值/分类，也永远不是量表题项
  if (semanticHint === 'id') {
    profile.is_scale_item = false
    profile.likely_categorical = false
  }

  return profile
}

/**
 * 判定"行=专家"的评分结构（CVI 的唯一合法前提）。
 *
 * ── 为什么这条必须写死 ──
 * v0.3.3 原型实测：**CVI 是最容易误荐的方法**。它要求数据形态是
 * 「行 = 专家、列 = 题项、取值 1–4 相关性评分」；普通被试问卷结构与之完全不同。
 * 把普通问卷塞进 CVI 会算出一堆看起来正常的 I-CVI 数字，而它们毫无意义。
 *
 * 判定策略（保守，宁可不推荐）：
 *   1. 行数极少（专家通常 3–20 人）；且
 *   2. 至少 2 个列名带专家/评分语义（expert / rater / judge / 专家 / 评分）；或
 *      全部数值列都是 1–4 的小整数且行数 ≤ 20
 *
 * 只要不满足就返回 false —— 普通问卷 n 通常 ≥ 30，直接排除。
 */
function looksLikeExpertRating(columns: ColumnProfile[], rowCount: number): boolean {
  if (rowCount === 0 || rowCount > 20) return false
  const expertNameHits = columns.filter((c) =>
    /expert|rater|judge|专家|评分/i.test(c.name)
  ).length
  if (expertNameHits >= 2) return true
  const numeric = columns.filter((c) => c.type === 'numeric')
  if (numeric.length < 2) return false
  return numeric.every(
    (c) =>
      c.cardinality >= 2 &&
      c.cardinality <= 4 &&
      typeof c.mean === 'number' &&
      c.mean >= 1 &&
      c.mean <= 4
  )
}

// ── 数据集画像 ──────────────────────────────────────────────

/**
 * 画像整个数据集。
 *
 * @param headers 列名（顺序即输出顺序）
 * @param rows 数据行
 * @param columnInfo `analyzeColumns()` 的结果；省略时按数值/字符串比例就地推断
 *   （仅供单测与无 columnInfo 的调用路径使用，正式导入路径应传入）
 */
export function profileDataset(
  headers: string[],
  rows: Record<string, unknown>[],
  columnInfo?: { name: string; type: 'numeric' | 'string' | 'unknown' }[]
): DatasetProfile {
  const typeMap = new Map(columnInfo?.map((c) => [c.name, c.type]) ?? [])
  const columns = headers.map((name) => {
    const declared = typeMap.get(name)
    if (declared) return profileColumn(name, rows, declared)
    // 无 columnInfo 时：用与 analyzeColumns 相同的规则就地推断，保证口径一致
    return profileColumn(name, rows, 'unknown')
  })

  const analyzable = columns.filter((c) => c.semantic_hint !== 'id')
  const idColumns = columns.filter((c) => c.semantic_hint === 'id').map((c) => c.name)

  const numericColumns = analyzable.filter((c) => c.type === 'numeric')
  // 分类列 = 字符串列 + 数值但实质分类的列（如 1–5 编码的性别）
  const categoricalColumns = analyzable.filter(
    (c) => c.type === 'string' || c.likely_categorical
  )
  // 名义分类（卡方检验需要真正的类别标签，连续变量离散化不算）
  const nominalColumns = analyzable.filter((c) => c.type === 'string')

  const scaleItems = numericColumns.filter((c) => c.is_scale_item)

  /**
   * 可作**分组变量**的列（t 检验 / ANOVA / 非参数检验的前提）。
   *
   * ⚠️ 必须把**量表题项**排除出去，这是一个真实的判定缺陷（开发中实测发现）：
   * 5 点李克特题项 `q1` 的 cardinality = 5（≥3），若不排除，它会被当成
   * "3 水平以上的分组变量"，于是推荐"按 q1 分组做 ANOVA"。
   * 这在数学上算得出来，但含义是"把一道题的 1–5 分当作 5 个不同人群"——
   * 把定序量表题项当名义分组变量，是原型里最典型的"算得出但没意义"的误荐。
   *
   * 但**不能一刀切排除所有 `is_scale_item`**：0/1 编码的处理组 / 结局变量
   * （`treated`、`outcome`）同样满足 is_scale_item 的"整数 + 小基数"判据，
   * 而二分类恰恰是 t 检验与 Logistic 回归最标准的用法。一刀切会把它们误杀。
   *
   * 因此分三种情况：
   *   1. 列名明确是组别（group / 组别 / 班级…）→ 一定是分组变量
   *   2. 列名明确是量表题项（q1 / item3 / 题2）→ 一定不是
   *   3. 其余：**只有 ≥3 水平的整数小值列**才按量表题项排除；
   *      2 水平（0/1 编码）保留为合法的分组变量
   */
  const groupingColumns = categoricalColumns.filter((c) => {
    if (c.semantic_hint === 'group') return true
    if (c.semantic_hint === 'likert_item') return false
    return !(c.is_scale_item && c.cardinality >= 3)
  })

  const binaryGroups = groupingColumns.filter((c) => c.cardinality === 2)
  const multiGroups = groupingColumns.filter((c) => c.cardinality >= 3)

  const hasNonNormalNumeric = numericColumns.some(
    (c) => typeof c.skew === 'number' && Number.isFinite(c.skew) && Math.abs(c.skew) > SKEW_LIMIT
  )

  return {
    rowCount: rows.length,
    columns,
    numericColumns,
    categoricalColumns,
    scaleItems,
    groupingColumns,
    binaryGroups,
    multiGroups,
    nominalColumns,
    hasNonNormalNumeric,
    idColumns,
    looksLikeExpertRating: looksLikeExpertRating(columns, rows.length)
  }
}

/**
 * 把画像压缩成给 AI 的纯文本摘要。
 *
 * 只放**判断方法适用性真正需要**的事实（变量名、类型、水平数、缺失率、偏态），
 * 不放均值/标准差等与"选方法"无关的数字——Prompt 越短，模型越不会把
 * 精力花在复述统计量上而不是做判断。
 *
 * @param limit 每类最多列出多少个变量（真实问卷可能 100+ 题项，全列会撑爆上下文）
 */
export function summarizeProfile(profile: DatasetProfile, limit = 30): string {
  const lines: string[] = []
  lines.push(`行数（样本量）: ${profile.rowCount}`)

  const fmtRate = (c: ColumnProfile): string =>
    c.total > 0 ? `${((c.missing / c.total) * 100).toFixed(1)}%` : '0%'

  const numericShown = profile.numericColumns.slice(0, limit)
  if (numericShown.length > 0) {
    lines.push(`数值变量 (${profile.numericColumns.length} 个):`)
    for (const c of numericShown) {
      const parts = [`唯一值=${c.cardinality}`, `缺失=${fmtRate(c)}`]
      if (typeof c.skew === 'number' && Number.isFinite(c.skew)) {
        parts.push(`偏度=${c.skew.toFixed(2)}`)
      }
      if (c.is_scale_item) parts.push('量表题项')
      if (c.semantic_hint === 'age') parts.push('年龄')
      lines.push(`  - ${c.name}: ${parts.join(', ')}`)
    }
    if (profile.numericColumns.length > numericShown.length) {
      lines.push(`  …另有 ${profile.numericColumns.length - numericShown.length} 个未列出`)
    }
  }

  const categoricalShown = profile.categoricalColumns.slice(0, limit)
  if (categoricalShown.length > 0) {
    lines.push(`分类变量 (${profile.categoricalColumns.length} 个):`)
    for (const c of categoricalShown) {
      lines.push(`  - ${c.name}: 水平数=${c.cardinality}, 缺失=${fmtRate(c)}`)
    }
  }

  if (profile.scaleItems.length > 0) {
    lines.push(
      `量表题项: ${profile.scaleItems.length} 个 (${profile.scaleItems
        .slice(0, 8)
        .map((c) => c.name)
        .join(', ')}${profile.scaleItems.length > 8 ? ' …' : ''})`
    )
  }
  if (profile.binaryGroups.length > 0) {
    lines.push(`二水平分组变量: ${profile.binaryGroups.map((c) => c.name).join(', ')}`)
  }
  if (profile.multiGroups.length > 0) {
    lines.push(`多水平分组变量: ${profile.multiGroups.map((c) => c.name).join(', ')}`)
  }
  if (profile.idColumns.length > 0) {
    lines.push(`已排除的主键/编号列（不参与分析）: ${profile.idColumns.join(', ')}`)
  }
  if (profile.hasNonNormalNumeric) {
    lines.push('注意: 存在明显偏态（|偏度| > 1）的数值变量')
  }

  return lines.join('\n')
}
