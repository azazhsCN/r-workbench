/**
 * 结构化结果协议（v0.3.0 / T40）
 *
 * ── 为什么需要这一层 ──
 *
 * v0.2.x 的 R 生成器用 `cat()` 输出**给人看的文本**，TS 解析器再用
 * `split('|')` + **固定下标**去读。这个结构有一个致命特性：
 * **字段个数与下标含义之间没有任何强制约束**。
 *
 * 它已经造成的真实事故：
 *   - v0.2.5：ANOVA 的 F/p 从 Df 列读出（实测 F=2, p=2，真值 F=119.26）
 *   - v0.2.5：数值捕获组不含负号 → 含负值的变量被静默整行删除
 *   - v0.2.6：独立样本 t 的"均值差"取成"CI 下限"（表与 keyValues 互相矛盾）
 *   - v0.2.6：单样本 t 的"CI 下限"取成 p 值、"Cohen's d"取成 CI 上限
 *
 * 四项事故中，三个是"下标错位"，一个"字段丢失"。而 158 个测试 + 282 项
 * 统计断言都没抓到它们——因为测试只断言"有表"，R 验证只校验"R 算得对"，
 * 中间的"文本 → 结构化"翻译过程无人看守。
 *
 * ── 本协议的作用 ──
 *
 * 让 R 端直接输出 JSON，字段名与 TS 类型**一一对应、不得二次映射**。
 * 于是：
 *   1. 下标错位不再可能（没有下标）
 *   2. 字段改名会立即被 typecheck 拒绝
 *   3. 解析器退化为"JSON → 视图模型"的纯映射，逻辑量骤减
 *
 * ── 设计约束 ──
 *
 * - 所有字段名与 R 端 `jsonlite::toJSON` 的 key 完全一致（snake_case）
 * - `p` 同时保留原始数值与展示串：原始值供程序判断，展示串供论文引用
 *   （v0.2.5 曾把 `p = 0.0000` 读成 0 再被 `||` 变成 1）
 * - 缺失值统一用 `null`，不用 `"NA"` 字符串，避免字符串/数值混用
 * - `diagnostics` 结构化并提供 `ok` 标志，作为"统计前提校验"的数据基础
 */

/** 统计显著性展示串，如 "p < 0.001" / "p = .026" */
export interface PValue {
  /** 原始数值（供程序判断，永不为展示而丢精度） */
  value: number | null
  /** 论文可直接引用的 APA 风格字符串 */
  display: string
}

/** 一条统计前提诊断 */
export interface Diagnostic {
  /** 唯一键，便于前端与 AI 引用，如 "levene" / "expected_count" */
  id: string
  /** 人类可读标签，如 "方差齐性（Levene）" */
  label: string
  /** 展示值，如 "p = .123" / "最小期望频数 = 3.2" */
  value: string
  /** 该前提是否满足；null 表示无法判断 */
  ok: boolean | null
  /** 不满足时的建议，如 "建议改用 Welch t 检验" */
  hint?: string
}

/** 一张三线表（协议内的表格，与 UI 的 TableData 区分开） */
export interface ResultTable {
  title: string
  headers: string[]
  rows: (string | number | null)[][]
  note?: string
}

/** 所有结果的公共头 */
export interface ResultBase {
  /** 方法标识，与 METHOD_REGISTRY 的 id 一致 */
  method: string
  /** 协议版本，便于未来演进时做兼容分支 */
  schema_version: 1
  /** 有效样本量（各方法取自身口径，如 t 检验为各组 n 之和） */
  n?: number
  /** 生成的 R 代码（可追溯性的核心，v0.3.4 的工具卡片依赖它） */
  r_code?: string
  /** R 版本，便于复现 */
  r_version?: string
  /** 分析时数据集的指纹（v0.3.4 用于判断结果是否过期） */
  data_fingerprint?: string
}

/* ═══════════════════════════════════════════════════════════════
 * 一、通用分析（13 项）—— 与现有生成器一一对应
 * ═══════════════════════════════════════════════════════════════ */

export interface DescriptiveResult extends ResultBase {
  kind: 'descriptive'
  items: Array<{
    variable: string
    n: number
    mean: number | null
    sd: number | null
    min: number | null
    max: number | null
    median: number | null
    missing: number
  }>
}

export interface TTestIndependentResult extends ResultBase {
  kind: 'ttest_independent'
  groups: Array<{ label: string; n: number; mean: number; sd: number }>
  /** Welch t 统计量（默认不假定方差齐） */
  t: number
  df: number
  p: PValue
  /** 均值差（组1 − 组2）；v0.2.6 此处曾错取成 CI 下限 */
  mean_diff: number | null
  ci: { lower: number | null; upper: number | null; level: number }
  /** Cohen's d（合并标准差口径） */
  cohen_d: number | null
  /** 合并方差假设下的 t 检验（供对照，用户可能要求 Student t） */
  pooled?: { t: number; df: number; p: PValue }
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface TTestPairedResult extends ResultBase {
  kind: 'ttest_paired'
  variables: { var1: string; var2: string }
  n_pairs: number
  mean_diff: number
  sd_diff: number
  t: number
  df: number
  p: PValue
  ci: { lower: number | null; upper: number | null; level: number }
  /** Cohen's dz（差值标准化） */
  cohen_dz: number | null
  pair_correlation: number | null
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface TTestOneResult extends ResultBase {
  kind: 'ttest_one'
  variable: string
  n: number
  mean: number
  sd: number
  /** 检验值 μ₀ */
  mu: number
  t: number
  df: number
  p: PValue
  /** v0.2.6 此处曾错取成 p 原始值 */
  ci: { lower: number | null; upper: number | null; level: number }
  /** v0.2.6 此处曾错取成 CI 上限 */
  cohen_d: number | null
  /** μ₀ 是否落在 CI 内 */
  mu_in_ci: boolean | null
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface AnovaResult extends ResultBase {
  kind: 'anova'
  /** 分组水平，按出现顺序排序 */
  levels: string[]
  groups: Array<{ label: string; n: number; mean: number; sd: number }>
  /** 变异来源分解；v0.2.5 曾从 Df 列读 F/p */
  rows: Array<{
    source: string
    df: number | null
    ss: number | null
    ms: number | null
    f: number | null
    p: PValue | null
  }>
  eta2: number | null
  omega2: number | null
  /** Tukey HSD 等事后检验 */
  posthoc: Array<{
    contrast: string
    diff: number
    lower: number
    upper: number
    p: PValue
  }>
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface ChiSquareResult extends ResultBase {
  kind: 'chi_square'
  /** 列联表维度 [行, 列] */
  table_dim: [number, number]
  /** 最小期望频数（<5 时卡方近似不可靠） */
  min_expected: number | null
  chi_sq: number
  df: number
  p: PValue
  /** Cramér's V 效应量 */
  cramers_v: number | null
  method: string
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface CorrelationResult extends ResultBase {
  kind: 'correlation'
  variables: { var1: string; var2: string }
  /** pearson 或 spearman */
  method: 'pearson' | 'spearman'
  n: number
  /** r 或 ρ */
  estimate: number
  p: PValue
  ci: { lower: number | null; upper: number | null; level: number } | null
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface RegressionResult extends ResultBase {
  kind: 'regression'
  response: string
  predictors: string[]
  n: number
  r2: number
  adj_r2: number
  f: number
  p: PValue
  residual_se: number | null
  coefficients: Array<{
    term: string
    estimate: number
    std_error: number | null
    t: number | null
    p: PValue
    /** 标准化回归系数 β（对整个设计矩阵标准化后求得，非零阶相关） */
    beta?: number | null
    vif?: number | null
  }>
  /** 残差正态性诊断 */
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface ReliabilityResult extends ResultBase {
  kind: 'reliability'
  n_items: number
  n: number
  /** Cronbach's α */
  alpha: number | null
  /** 标准化 α */
  alpha_std: number | null
  alpha_ci: { lower: number | null; upper: number | null; level: number } | null
  /** 被自动反向计分的题项 */
  reversed_items: string[]
  /** 逐项删除分析 */
  items: Array<{
    name: string
    mean: number | null
    sd: number | null
    item_total_r: number | null
    alpha_if_deleted: number | null
  }>
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface NormalityResult extends ResultBase {
  kind: 'normality'
  items: Array<{
    variable: string
    n: number
    statistic: number
    p: PValue
    skewness: number | null
    kurtosis: number | null
    /** Shapiro-Wilk 的判定结论 */
    verdict: string
  }>
}

export interface NonparametricResult extends ResultBase {
  kind: 'nonparametric'
  groups: Array<{ label: string; n: number; median: number; q1: number; q3: number }>
  /** Mann-Whitney U / Wilcoxon W */
  statistic: number
  p: PValue
  /** 秩二列相关效应量 */
  effect_size: number | null
  method: string
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface FrequencyResult extends ResultBase {
  kind: 'frequency'
  items: Array<{
    variable: string
    total: number
    missing: number
    categories: Array<{
      label: string
      count: number
      /** 百分比（分母含缺失） */
      percent: number
      /** 有效百分比（分母不含缺失） */
      valid_percent: number
    }>
  }>
}

export interface SummaryByResult extends ResultBase {
  kind: 'summary_by'
  group_var: string
  value_var: string
  rows: Array<{
    group: string
    n: number
    mean: number | null
    sd: number | null
    median: number | null
    min: number | null
    max: number | null
  }>
}

/* ═══════════════════════════════════════════════════════════════
 * 二、问卷研究（v0.3.x 新增）
 * ═══════════════════════════════════════════════════════════════ */

export interface EfaResult extends ResultBase {
  kind: 'efa'
  n: number
  n_items: number
  /** 抽取的因子数 */
  n_factors: number
  /** 旋转方法，如 "varimax" */
  rotation: string
  /** Kaiser-Meyer-Olkin 取样适切性度量 */
  kmo: { overall: number; per_item: Array<{ name: string; value: number }> }
  /** Bartlett 球形检验 */
  bartlett: { chi_sq: number; df: number; p: PValue }
  /** 特征值与方差解释 */
  eigenvalues: Array<{
    factor: number
    eigenvalue: number
    variance_pct: number
    cumulative_pct: number
  }>
  /** 旋转后因子载荷矩阵 */
  loadings: Array<{
    item: string
    /** 各因子上的载荷，索引 0 对应因子 1 */
    values: number[]
    /** 主载荷所属因子（1-based），用于归并题目 */
    primary_factor: number
    /** 共同度 */
    communality: number
  }>
  diagnostics: Diagnostic[]
  conclusion?: string
}

/* ═══════════════════════════════════════════════════════════════
 * 三、联合类型与类型守卫
 * ═══════════════════════════════════════════════════════════════ */

export type StructuredResult =
  | DescriptiveResult
  | TTestIndependentResult
  | TTestPairedResult
  | TTestOneResult
  | AnovaResult
  | ChiSquareResult
  | CorrelationResult
  | RegressionResult
  | ReliabilityResult
  | NormalityResult
  | NonparametricResult
  | FrequencyResult
  | SummaryByResult
  | EfaResult

/** kind → 类型 的映射，供类型守卫与穷尽性检查使用 */
export interface ResultKindMap {
  descriptive: DescriptiveResult
  ttest_independent: TTestIndependentResult
  ttest_paired: TTestPairedResult
  ttest_one: TTestOneResult
  anova: AnovaResult
  chi_square: ChiSquareResult
  correlation: CorrelationResult
  regression: RegressionResult
  reliability: ReliabilityResult
  normality: NormalityResult
  nonparametric: NonparametricResult
  frequency: FrequencyResult
  summary_by: SummaryByResult
  efa: EfaResult
}

export type ResultKind = keyof ResultKindMap

/** 全部合法的 kind（运行时也可用，测试中用来做穷尽性断言） */
export const RESULT_KINDS = [
  'descriptive',
  'ttest_independent',
  'ttest_paired',
  'ttest_one',
  'anova',
  'chi_square',
  'correlation',
  'regression',
  'reliability',
  'normality',
  'nonparametric',
  'frequency',
  'summary_by',
  'efa'
] as const satisfies readonly ResultKind[]

/** 协议版本；升级字段含义时递增，解析器据此走兼容分支 */
export const RESULT_SCHEMA_VERSION = 1 as const

/**
 * 运行时类型守卫。
 *
 * 只校验最小必要形状（kind + schema_version），不逐字段深校验——
 * 后者应由 R 端的 `stopifnot` 与 TS 的类型系统共同保证。
 * 这里的目标是：**遇到未知/畸形 JSON 时能安全退回文本解析，而不是崩溃**。
 */
export function isStructuredResult(value: unknown): value is StructuredResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (typeof v.kind !== 'string') return false
  if (v.schema_version !== RESULT_SCHEMA_VERSION) return false
  return (RESULT_KINDS as readonly string[]).includes(v.kind)
}
