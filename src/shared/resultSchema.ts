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
 * 三、效度线（v0.3.1 新增）
 *
 * 三者与 v0.3.0 的 EFA 同属"问卷效度线"，但风险点各不相同：
 *   - CFA 一张表里并排躺着 χ²/df、CFI、TLI、RMSEA、SRMR 五个 4 位小数，
 *     任何一个下标错位都不会报错，只会把"拟合良好"显示成"拟合不佳"；
 *   - CVI 的 I-CVI、Pc、Kappa 三个量都是 0–1 的小数，且 Kappa 由 I-CVI 与 Pc
 *     算出，错位后会得到"看起来也像 0–1 概率"的错误值；
 *   - Harman 的 first_pct 与 eigenvalue 量纲不同（56.88 vs 3.41），错位会直接
 *     颠倒"是否存在共同方法偏差"的结论。
 * 因此这里的字段名严格对着 V031_CONTRACT.md 的行格式，一个下标都不留。
 * ═══════════════════════════════════════════════════════════════ */

export interface CfaResult extends ResultBase {
  kind: 'cfa'
  /** 因子数 k */
  n_factors: number
  /** 题项数 p */
  n_items: number
  n: number
  /** lavaan 语法串，供复现（如 `F1 =~ q1 + q2 + q3`） */
  model_syntax: string
  /** 题项归属；factor 为 1-based 因子编号，来自同一数据集上的 EFA */
  items: Array<{ item: string; factor: number }>
  fit: {
    chisq: number
    /** df = p(p+1)/2 − (2p + k(k−1)/2)；df < 0 时模型不可识别（R 端已 stop） */
    df: number
    p: PValue
    cfi: number | null
    tli: number | null
    rmsea: number | null
    srmr: number | null
    /** 零模型（独立模型）卡方，CFI/TLI 的分母来源 */
    null_model: { chisq: number | null; df: number | null }
  }
  /** 完全标准化载荷（标准化解）；unstd_load 为原始尺度载荷 */
  estimates: Array<{
    item: string
    /** 所属因子（1-based） */
    factor: number | null
    std_load: number | null
    unstd_load: number | null
    /** 标准化载荷的 delta 法标准误 */
    se: number | null
    /** 标准化载荷的 Wald 检验统计量 */
    z: number | null
    p: PValue
    /** 题项 R² = std_load² */
    r2: number | null
  }>
  /** 因子间相关，每对一行（n_factors < 2 时为空数组） */
  factor_correlations: Array<{
    f1: number
    f2: number
    cor: number
    se: number | null
    z: number | null
    p: PValue
  }>
  /** 组合信度 / 平均方差抽取量 / √AVE（区分效度：√AVE 与 cor 比较） */
  reliability: Array<{
    factor: number
    cr: number | null
    ave: number | null
    sqrt_ave: number | null
  }>
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface CviResult extends ResultBase {
  kind: 'cvi'
  n_items: number
  /** 行 = 专家，列 = 题项；1–4 相关性评分 */
  n_experts: number
  items: Array<{
    item: string
    /** 评 ≥ 3 分的专家数（即"相关"） */
    n_relevant: number
    n_experts: number
    /** I-CVI = n_relevant / n_experts */
    i_cvi: number
    /** 随机一致概率 Pc = C(n, A)/2^n，A = ceiling(I-CVI 判定阈值 × n) */
    p_c: number | null
    /** 修正 Kappa：k* = (I-CVI − Pc)/(1 − Pc) */
    kappa: number | null
    /** 优秀 / 良好 / 需修改 */
    verdict: string
  }>
  /** S-CVI/Ave = 各 I-CVI 的均值 */
  s_cvi_ave: number | null
  /** S-CVI/UA = 全部专家均评 ≥ 3 的题项比例 */
  s_cvi_ua: number | null
  /** S-CVI/UA 对应的题项数 */
  n_ua: number | null
  /** 是否全部题项的 I-CVI 达到判定阈值 */
  threshold_ok: boolean | null
  diagnostics: Diagnostic[]
  conclusion?: string
}

export interface HarmanResult extends ResultBase {
  kind: 'harman'
  /** 参与分析的题项数 */
  n_items: number
  n: number
  /** 未旋转主成分分析中特征值 > 1 的成分（逐行） */
  eigenvalues: Array<{
    /** 成分序号（1-based） */
    factor: number
    eigenvalue: number
    variance_pct: number
    cumulative_pct: number
  }>
  /** 特征值 > 1 的成分个数 */
  n_factors_gt1: number
  /** 第一成分（未旋转）解释的方差百分比；< 40 且因子数 > 1 视为未发现严重偏差 */
  first_pct: number
  /** 判定阈值（百分比，契约固定为 40） */
  threshold: number
  /** 判据是否满足（首成分 < 阈值 且 特征值 > 1 的因子数 > 1） */
  ok: boolean | null
  diagnostics: Diagnostic[]
  conclusion?: string
}

/* ═══════════════════════════════════════════════════════════════
 * 四、因果链（v0.3.2 新增）
 *
 * 五个方法的风险点与 v0.2.x 的四次事故同构：一批量纲各异的 4 位小数
 * （回归系数、CI 端点、R²、ΔR²、Bootstrap 分位数）并排躺在同一条 `TAG|...` 行里，
 * 任何一个 `|` 字段错位都会得到一个"看起来完全合法"的数字：
 *   - 中介的 indirect / direct / total 都是回归量级的系数，错位后
 *     `c = c′ + a·b` 这条恒等式仍然"差不多成立"，不会被任何范围检查拦下；
 *   - 有调节的中介的 index（a4·b）与条件间接效应（(a2+a4·W)·b）同为小数量级，
 *     错位后正负号依旧合理；
 *   - SEM 的 CFI 与 TLI 都是 0.9x，互换后"拟合良好"依然成立（只是报告了错的指标）；
 *   - 路径分析的 total 与 direct 只差一个 indirect，取错后差异小到肉眼不可见。
 * 此外还有一条 v0.3.1 留下的教训：**只写单方向的透传断言会漏掉半吊子重复实现**，
 * 所以这批类型的字段一律只作映射，判定口径（显著与否、是否达标）留在 R 端。
 * 字段名严格对着 V032_CONTRACT.md 的行格式，一个下标都不留。
 * ═══════════════════════════════════════════════════════════════ */

/** 中介效应：`M = i1 + aX`；`Y = i2 + c′X + bM`；`c = c′ + a·b` */
export interface MediationResult extends ResultBase {
  kind: 'mediation'
  n: number
  variables: { x: string; m: string; y: string }
  /** 逐条路径（MED_PATH）；`c_prime` 为控制 M 后的 X → Y，`c_total` 为简单回归的 X → Y */
  paths: Array<{
    path: 'a' | 'b' | 'c_prime' | 'c_total'
    coef: number
    se: number | null
    t: number | null
    p: PValue
  }>
  /** 效应分解（MED_EFFECT）；indirect = a·b，direct = c′，total = c，prop_mediated = indirect/total */
  effects: Array<{
    effect: 'indirect' | 'direct' | 'total' | 'prop_mediated'
    value: number | null
    se: number | null
    /** Bootstrap 分位数下限（主推断，不是正态近似） */
    ci_lower: number | null
    ci_upper: number | null
    /** 实际使用的方法：percentile 或 bca；不得标 bca 却给 percentile */
    ci_method: string
  }>
  /** Sobel 检验（正态近似，仅作对照） */
  sobel: { z: number | null; p: PValue } | null
  /** Bootstrap 配置（MED_BOOT）；`b` 为重复次数 B */
  bootstrap: { b: number | null; seed: number | null; ci_level: number | null; method: string } | null
  /** 标准化系数（MED_STD） */
  std_paths: Array<{
    path: 'a_std' | 'b_std' | 'c_prime_std' | 'indirect_std'
    std_coef: number | null
  }>
  notes: string[]
  diagnostics: Diagnostic[]
  conclusion?: string
}

/** 调节效应：`Y = b0 + b1·X + b2·W + b3·(X·W)`，默认对 X / W 中心化 */
export interface ModerationResult extends ResultBase {
  kind: 'moderation'
  n: number
  variables: { x: string; w: string; y: string }
  /** MOD_SPEC.centered 的透传值；null 表示 R 端未声明 */
  centered: boolean | null
  /** 系数表（MOD_COEF）；x_w 即交互项 b3，必须与 delta 的显著性一致 */
  coefficients: Array<{
    term: 'x' | 'w' | 'x_w' | 'intercept'
    coef: number
    se: number | null
    t: number | null
    p: PValue
  }>
  /** 含交互项模型的整体拟合（MOD_MODEL） */
  model: {
    r2: number | null
    adj_r2: number | null
    f: number | null
    p: PValue
    df1: number | null
    df2: number | null
  }
  /** 相对「仅主效应模型 Y ~ X + W」的 ΔR²/ΔF（MOD_DELTA） */
  delta: {
    r2_change: number | null
    f_change: number | null
    df1: number | null
    df2: number | null
    p: PValue
  }
  /** 简单斜率（MOD_SLOPE）；slope = b1 + b3·w0，w_level 为 -1SD / mean / +1SD */
  simple_slopes: Array<{
    w_level: string
    w_value: number | null
    slope: number
    se: number | null
    t: number | null
    p: PValue
  }>
  /** Johnson-Neyman 区间（可选；失败不中断） */
  johnson_neyman: Array<{ region: string; lower: number | null; upper: number | null }>
  notes: string[]
  diagnostics: Diagnostic[]
  conclusion?: string
}

/** 有调节的中介：W 调节 X → M（前半段）；条件间接效应 = (a2 + a4·W)·b */
export interface ModeratedMediationResult extends ResultBase {
  kind: 'moderated_mediation'
  n: number
  variables: { x: string; m: string; y: string; w: string }
  /** 两个回归方程的系数（MM_COEF）；model 为 `m`（X→M）或 `y`（结果方程） */
  coefficients: Array<{
    model: 'm' | 'y'
    term: string
    coef: number
    se: number | null
    t: number | null
    p: PValue
  }>
  /** index of moderated mediation = a4·b（MM_INDEX），CI 必须来自 Bootstrap */
  index: {
    index: number | null
    se: number | null
    ci_lower: number | null
    ci_upper: number | null
  }
  /** 条件间接效应（MM_COND），W 取 mean−1SD / mean / mean+1SD 三个水平 */
  conditional: Array<{
    w_level: string
    w_value: number | null
    a_cond: number | null
    indirect: number | null
    ci_lower: number | null
    ci_upper: number | null
  }>
  /** Bootstrap 配置（MM_BOOT） */
  bootstrap: { b: number | null; seed: number | null; ci_level: number | null; method: string } | null
  notes: string[]
  diagnostics: Diagnostic[]
  conclusion?: string
}

/** 路径分析：观测变量、路径图给定；首版 OLS 逐方程估计（非 ML-SEM） */
export interface PathAnalysisResult extends ResultBase {
  kind: 'path_analysis'
  n: number
  nodes: string[]
  n_edges: number
  /** 逐条边（PATH_EDGE） */
  edges: Array<{
    from: string
    to: string
    coef: number
    se: number | null
    t: number | null
    p: PValue
    std_coef: number | null
  }>
  /** 逐方程 OLS 拟合（PATH_EQ） */
  equations: Array<{
    dv: string
    r2: number | null
    adj_r2: number | null
    f: number | null
    p: PValue
  }>
  /** 效应分解（PATH_EFFECT）；必须满足 total = direct + indirect */
  effects: Array<{
    from: string
    to: string
    direct: number | null
    indirect: number | null
    total: number | null
  }>
  notes: string[]
  diagnostics: Diagnostic[]
  conclusion?: string
}

/** 结构方程模型：测量模型 + 结构模型，ML 拟合，与 CFA 同一套指标公式 */
export interface SemResult extends ResultBase {
  kind: 'sem'
  n: number
  n_latent: number
  n_obs: number
  /** 测量模型（SEM_MEASURE）；unstd_load 为原始尺度载荷（marker 指标固定为 1） */
  measure: Array<{
    latent: string
    indicator: string
    std_load: number | null
    unstd_load: number | null
    se: number | null
    z: number | null
    p: PValue
    /** 指标 R² */
    r2: number | null
  }>
  /** 结构路径（SEM_STRUCT），潜变量之间 */
  structure: Array<{
    from: string
    to: string
    coef: number
    se: number | null
    z: number | null
    p: PValue
  }>
  /** 内生潜变量 R²（SEM_LATENT） */
  latent_r2: Array<{ latent: string; r2: number | null }>
  /** 拟合指标（SEM_FIT），公式与 CFA 完全一致 */
  fit: {
    chisq: number | null
    /** df = p(p+1)/2 − npar；df < 0 时模型不可识别（R 端已 stop） */
    df: number | null
    p: PValue
    cfi: number | null
    tli: number | null
    rmsea: number | null
    srmr: number | null
  }
  notes: string[]
  diagnostics: Diagnostic[]
  conclusion?: string
}

/* ═══════════════════════════════════════════════════════════════
 * 五、联合类型与类型守卫
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
  | CfaResult
  | CviResult
  | HarmanResult
  | MediationResult
  | ModerationResult
  | ModeratedMediationResult
  | PathAnalysisResult
  | SemResult

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
  cfa: CfaResult
  cvi: CviResult
  harman: HarmanResult
  mediation: MediationResult
  moderation: ModerationResult
  moderated_mediation: ModeratedMediationResult
  path_analysis: PathAnalysisResult
  sem: SemResult
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
  'efa',
  'cfa',
  'cvi',
  'harman',
  'mediation',
  'moderation',
  'moderated_mediation',
  'path_analysis',
  'sem'
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
