/**
 * R 执行服务
 * 提供 R 环境检测、代码执行、结果解析功能
 *
 * 设计约定（v0.2.6 起）：
 * 1. 每个生成器的第一行必须是唯一横幅 `cat("=== <方法名> ===\n")`，
 *    resultParser.detectAnalysisType 依赖该横幅做确定性类型判定，
 *    禁止再使用 output.includes('片段') 之类的模糊启发式。
 * 2. 所有 if/else 一律用 `{ }` 包裹 —— R 语法要求 else 与 if 体同行，
 *    换行的 `else` 会导致整个脚本解析失败（v0.2.5 中 6 个方法因此从未运行）。
 * 3. p 值统一用 APA 风格输出（p < .001 / p = .026），禁止 sprintf("%.4f")。
 * 4. 所有数值一律以 sprintf 输出、以 `|` 分隔，便于解析器精确切分。
 * 5. 代码中不嵌入数据，数据通过 IPC dataCsv 参数传递并写入 data.csv。
 */

import type { RExecuteResult, RStatus } from '@shared/types'
import { rEscape } from './utils'

/** 分析结果 */
export interface AnalysisResult {
  success: boolean
  output: string
  tables: ParsedTable[]
  plots: string[]
  errors: string[]
  /** R 运行期间产生的 warning（v0.2.6 起上浮，不再丢弃） */
  warnings?: string[]
}

export interface ParsedTable {
  title: string
  headers: string[]
  rows: string[][]
}

/** 统一的 read.csv 头（数据由主进程以 UTF-8 写入） */
const READ_CSV =
  'read.csv(dataFile, stringsAsFactors = FALSE, check.names = FALSE, fileEncoding = "UTF-8-BOM")'

/**
 * R 侧公共前置代码。
 * 定义 fmt_p / num 两个助手，供各生成器复用。
 *   fmt_p(p) -> "p < 0.001" 或 "p = 0.026"
 *   num(x, d) -> 定长数值字符串，NA 输出 "NA"
 */
const R_COMMON = `
# APA 风格 p 值：p < .001 时输出 "p < 0.001"，否则保留 3 位小数。
# 注意：formatC 宽度为 0 时不会补前导空格，避免出现 "p =        0" 这种
# 让解析器与用户都困惑的输出。
fmt_p <- function(p, digits = 3L, eps = 0.001) {
  if (is.null(p) || length(p) == 0 || is.na(p)) return("p = NA")
  if (p < eps) return(sprintf("p < %s", format(eps, scientific = FALSE)))
  sprintf("p = %s", formatC(p, format = "f", digits = digits))
}
num <- function(x, d = 4L) {
  if (length(x) == 0 || is.na(x) || !is.finite(x)) return("NA")
  formatC(as.numeric(x), format = "f", digits = d)
}
# 期望频数/卡方等极小统计量需要保留精度，固定 4 位小数会把 9.1e-31 打成 0
num_sig <- function(x, d = 6L) {
  if (length(x) == 0 || is.na(x) || !is.finite(x)) return("NA")
  formatC(as.numeric(x), format = "g", digits = d)
}
# p 值建议用科学计数输出，固定 6 位小数会把 1e-31 打成 0.000000 而丢失全部精度
num_p <- function(x) {
  if (length(x) == 0 || is.na(x) || !is.finite(x)) return("NA")
  formatC(as.numeric(x), format = "g", digits = 8)
}
# 方差齐性检验：leveneTest 返回 Pr(>F)，fligner.test 返回 p.value。
# 直接取 lev[["Pr(>F)"]] 对 fligner 会得到 numeric(0)，
# 而 is.na(numeric(0)) 长度为 0，作为 if 条件会报 "argument is of length zero"。
p_of_test <- function(t) {
  if (is.null(t)) return(NA_real_)
  v <- t[["Pr(>F)"]]
  if (is.null(v) || length(v) == 0) v <- t[["p.value"]]
  if (is.null(v) || length(v) == 0) return(NA_real_)
  suppressWarnings(as.numeric(v[1]))
}
# 所有模型假设诊断统一用 tryCatch 兜底，任何诊断失败都不得中断主分析
try_num <- function(expr) {
  tryCatch(suppressWarnings(as.numeric(expr)), error = function(e) NA_real_)
}
`

/** APA 风格 p 值行：`p < 0.001` / `p = 0.026` */
export class RService {
  private static instance: RStatus | null = null

  static async detect(): Promise<RStatus> {
    if (!window.api) return { found: false, path: '', version: '' }
    const result = await window.api.r.detect()
    RService.instance = result
    return result
  }

  static async execute(code: string, dataCsv?: string): Promise<AnalysisResult> {
    if (!window.api) {
      return { success: false, output: '', tables: [], plots: [], errors: ['API 未就绪'] }
    }
    const result: RExecuteResult = await window.api.r.execute(code, dataCsv)
    if (!result.success) {
      return {
        success: false,
        output: result.output || '',
        tables: [],
        plots: [],
        errors: result.errors && result.errors.length > 0 ? result.errors : [result.stderr || '执行失败'],
        warnings: result.warnings ?? []
      }
    }
    return {
      success: true,
      output: result.output || '',
      tables: [],
      plots: [],
      errors: [],
      warnings: result.warnings ?? []
    }
  }

  /**
   * 描述性统计
   * 输出：`<变量>|N|M|SD|Min|Max|Median`（非数值列输出样本量提示）
   */
  static descriptiveCode(vars: string[], dataFile = 'data.csv'): string {
    const varList = vars.map((v) => `"${rEscape(v)}"`).join(', ')
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
vars <- c(${varList})
cat("=== 描述性统计 ===\\n")
for (v in vars) {
  if (!(v %in% names(data))) {
    cat(sprintf("%s|NA|NA|NA|NA|NA|NA\\n", v))
    next
  }
  raw <- data[[v]]
  x <- suppressWarnings(as.numeric(as.character(raw)))
  n_total <- length(x)
  n_missing <- sum(is.na(x))
  valid <- x[!is.na(x)]
  if (length(valid) == 0) {
    cat(sprintf("%s|0|NA|NA|NA|NA|NA\\n", v))
  } else {
    cat(sprintf("%s|%d|%s|%s|%s|%s|%s\\n", v, length(valid), num(mean(valid)),
      num(if (length(valid) > 1) sd(valid) else NA), num(min(valid)), num(max(valid)), num(median(valid))))
    cat(sprintf("__INFO__:%s|缺失=%d|总计=%d\\n", v, n_missing, n_total))
  }
}
`
  }

  /**
   * 独立样本 t 检验
   * 报告分组描述统计、Welch/Student 检验方法、效应量 Cohen's d、方差齐性。
   */
  static tTestIndependentCode(dv: string, groupVar: string, dataFile = 'data.csv'): string {
    const safeDv = rEscape(dv)
    const safeGroup = rEscape(groupVar)
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 独立样本 t 检验 ===\\n")
g_raw <- data[["${safeGroup}"]]
y_raw <- suppressWarnings(as.numeric(as.character(data[["${safeDv}"]])))
keep <- !is.na(g_raw) & !is.na(y_raw)
g_raw <- g_raw[keep]; y_raw <- y_raw[keep]
groups <- sort(unique(g_raw))
if (length(groups) != 2) stop("分组变量必须恰好有2个水平，当前为 ", length(groups), " 个")
g1 <- y_raw[g_raw == groups[1]]
g2 <- y_raw[g_raw == groups[2]]
if (length(g1) < 2 || length(g2) < 2) stop("每组至少需要 2 个有效样本")
n1 <- length(g1); n2 <- length(g2)
m1 <- mean(g1); m2 <- mean(g2); s1 <- sd(g1); s2 <- sd(g2)
cat(sprintf("GRP|%s|%d|%s|%s\\n", groups[1], n1, num(m1), num(s1)))
cat(sprintf("GRP|%s|%d|%s|%s\\n", groups[2], n2, num(m2), num(s2)))
sp <- sqrt(((n1 - 1) * s1^2 + (n2 - 1) * s2^2) / (n1 + n2 - 2))
cohen_d <- if (sp > 0) (m1 - m2) / sp else NA
lev_p <- try_num(p_of_test(car::leveneTest(y_raw ~ factor(g_raw))))
lev_name <- "Levene"
if (is.na(lev_p)) {
  lev_p <- try_num(p_of_test(fligner.test(y_raw ~ factor(g_raw))))
  lev_name <- "Fligner"
}
if (!is.na(lev_p)) {
  cat(sprintf("ASSUMPTION|%s|%s|%s\\n", lev_name, fmt_p(lev_p), num_p(lev_p)))
}
res <- t.test(g1, g2)
res_w <- t.test(g1, g2, var.equal = TRUE)
cat(sprintf("METHOD|%s\\n", res$method))
cat(sprintf("RESULT_IND|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n",
  num(res$statistic), num(res$parameter, 2), fmt_p(res$p.value), num_p(res$p.value),
  num(m1 - m2), num(res$conf.int[1]), num(res$conf.int[2]), num(cohen_d),
  num_p(res_w$p.value)))
cat(sprintf("RESULT_POOLED|%s|%s|%s|%s\\n", num(res_w$statistic), num(res_w$parameter, 2), fmt_p(res_w$p.value), num_p(res_w$p.value)))
cat(sprintf("CONCL|%s\\n", if (res$p.value < 0.05) "两组差异具有统计学意义" else "两组差异无统计学意义"))
`
  }

  /** 配对样本 t 检验 */
  static tTestPairedCode(var1: string, var2: string, dataFile = 'data.csv'): string {
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 配对样本 t 检验 ===\\n")
x <- suppressWarnings(as.numeric(as.character(data[["${rEscape(var1)}"]])))
y <- suppressWarnings(as.numeric(as.character(data[["${rEscape(var2)}"]])))
ok <- is.finite(x) & is.finite(y)
x <- x[ok]; y <- y[ok]
if (length(x) < 2) stop("有效配对样本不足（至少需要 2 对）")
n <- length(x)
d <- x - y
cat(sprintf("PAIRS|%s|%s|%d|%s|%s\\n", "${rEscape(var1)}", "${rEscape(var2)}", n, num(mean(d)), num(sd(d))))
r_pair <- if (n > 2 && sd(x) > 0 && sd(y) > 0) cor(x, y) else NA
cat(sprintf("PAIR_COR|%s\\n", num(r_pair)))
res <- t.test(x, y, paired = TRUE)
cat(sprintf("METHOD|%s\\n", res$method))
d_z <- if (sd(d) > 0) mean(d) / sd(d) else NA
cat(sprintf("RESULT_PAIRED|%s|%s|%s|%s|%s|%s|%s|%s\\n",
  num(res$statistic), num(res$parameter, 2), fmt_p(res$p.value), num_p(res$p.value), num(mean(d)),
  num(res$conf.int[1]), num(res$conf.int[2]), num(d_z)))
cat(sprintf("CONCL|%s\\n", if (res$p.value < 0.05) "两次测量差异具有统计学意义" else "两次测量差异无统计学意义"))
`
  }

  /** 单样本 t 检验 */
  static tTestOneSampleCode(varName: string, mu: number, dataFile = 'data.csv'): string {
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 单样本 t 检验 ===\\n")
x <- suppressWarnings(as.numeric(as.character(data[["${rEscape(varName)}"]])))
x <- x[is.finite(x)]
if (length(x) < 2) stop("有效样本不足（至少需要 2 个）")
n <- length(x); m <- mean(x); s <- sd(x)
cat(sprintf("DESC_ONE|%s|%d|%s|%s|%s\\n", "${rEscape(varName)}", n, num(m), num(s), num(${mu})))
res <- t.test(x, mu = ${mu})
d_one <- if (s > 0) (m - ${mu}) / s else NA
cat(sprintf("RESULT_ONE|%s|%s|%s|%s|%s|%s|%s\\n",
  num(res$statistic), num(res$parameter, 2), fmt_p(res$p.value), num_p(res$p.value),
  num(res$conf.int[1]), num(res$conf.int[2]), num(d_one)))
in_ci <- (${mu} >= res$conf.int[1]) && (${mu} <= res$conf.int[2])
cat(sprintf("MU_IN_CI|%s\\n", if (in_ci) "是" else "否"))
cat(sprintf("CONCL|%s\\n", if (res$p.value < 0.05) "样本均值与检验值差异具有统计学意义" else "样本均值与检验值差异无统计学意义"))
`
  }

  /**
   * 单因素方差分析
   * 补齐 Df / SS / MS 列、效应量 η²/ω²、事后检验（Tukey HSD）。
   */
  static anovaCode(dv: string, groupVar: string, dataFile = 'data.csv'): string {
    const safeDv = rEscape(dv)
    const safeGroup = rEscape(groupVar)
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 单因素方差分析 ===\\n")
# 用独立 data.frame 避免污染用户列名（不再写 data$.dv / data$.grp）
dv_vec <- suppressWarnings(as.numeric(as.character(data[["${safeDv}"]])))
grp_vec <- factor(data[["${safeGroup}"]])
keep <- !is.na(dv_vec) & !is.na(grp_vec)
d <- data.frame(dv = dv_vec[keep], grp = grp_vec[keep])
if (nlevels(d$grp) < 2) stop("分组变量至少需要 2 个水平")
if (nrow(d) < 3) stop("有效样本量不足")
cat(sprintf("LEVELS|%d|%s\\n", nlevels(d$grp), paste(levels(d$grp), collapse = ",")))
agg <- aggregate(dv ~ grp, data = d, FUN = function(z) c(n = length(z), m = mean(z), s = sd(z)))
for (i in seq_len(nrow(agg))) {
  cat(sprintf("GRP|%s|%d|%s|%s\\n", agg$grp[i], agg$dv[i, "n"], num(agg$dv[i, "m"]), num(agg$dv[i, "s"])))
}
model <- aov(dv ~ grp, data = d)
s <- summary(model)[[1]]
ss_between <- s[["Sum Sq"]][1]; ss_within <- s[["Sum Sq"]][2]; ss_total <- ss_between + ss_within
df_between <- s[["Df"]][1]; df_within <- s[["Df"]][2]
ms_between <- s[["Mean Sq"]][1]; ms_within <- s[["Mean Sq"]][2]
f_val <- s[["F value"]][1]; p_val <- s[["Pr(>F)"]][1]
cat(sprintf("ANOVA_ROW|组间|%d|%s|%s|%s|%s|%s\\n", df_between, num(ss_between), num(ms_between), num(f_val), fmt_p(p_val), num_p(p_val)))
cat(sprintf("ANOVA_ROW|组内|%d|%s|%s|NA|NA|NA\\n", df_within, num(ss_within), num(ms_within)))
cat(sprintf("ANOVA_ROW|总计|%d|%s|NA|NA|NA|NA\\n", df_between + df_within, num(ss_total)))
eta2 <- ss_between / ss_total
omega2 <- (ss_between - df_between * ms_within) / (ss_total + ms_within)
cat(sprintf("EFFECT|eta2|%s\\n", num(eta2)))
cat(sprintf("EFFECT|omega2|%s\\n", num(omega2)))
lev_p <- try_num(p_of_test(car::leveneTest(dv ~ grp, data = d)))
lev_name <- "Levene"
if (is.na(lev_p)) {
  lev_p <- try_num(p_of_test(fligner.test(dv ~ grp, data = d)))
  lev_name <- "Fligner"
}
if (!is.na(lev_p)) {
  cat(sprintf("ASSUMPTION|%s|%s|%s\\n", lev_name, fmt_p(lev_p), num_p(lev_p)))
}
if (!is.na(p_val) && p_val < 0.05 && nlevels(d$grp) > 2) {
  th <- tryCatch({ TukeyHSD(model) }, error = function(e) NULL)
  if (!is.null(th)) {
    for (i in seq_len(nrow(th$grp))) {
      cat(sprintf("POSTHOC|%s|%s|%s|%s|%s|%s\\n", rownames(th$grp)[i], num(th$grp[i, 1]),
        num(th$grp[i, 2]), num(th$grp[i, 3]), fmt_p(th$grp[i, 4]), num_p(th$grp[i, 4])))
    }
  }
}
cat(sprintf("CONCL|%s\\n", if (!is.na(p_val) && p_val < 0.05) "各组均值差异具有统计学意义" else "各组均值差异无统计学意义"))
`
  }

  /** 卡方检验（含期望频数检查、Fisher 备选、Cramér's V） */
  static chiSquareCode(var1: string, var2: string, dataFile = 'data.csv'): string {
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 卡方检验 ===\\n")
a <- data[["${rEscape(var1)}"]]
b <- data[["${rEscape(var2)}"]]
ok <- !is.na(a) & !is.na(b)
a <- factor(a[ok]); b <- factor(b[ok])
if (nlevels(a) < 2 || nlevels(b) < 2) stop("两个变量都需要至少 2 个类别")
tbl <- table(a, b)
cat(sprintf("TABLE_DIM|%d|%d\\n", nrow(tbl), ncol(tbl)))
res <- suppressWarnings(chisq.test(tbl))
exp_min <- min(res$expected)
n_exp_lt5 <- sum(res$expected < 5)
cat(sprintf("EXPECTED|%s|%d\\n", num(exp_min, 3), n_exp_lt5))
cat(sprintf("METHOD|%s\\n", res$method))
cramer_v <- sqrt(as.numeric(res$statistic) / (sum(tbl) * min(nrow(tbl) - 1, ncol(tbl) - 1)))
cat(sprintf("RESULT_CHISQ|%s|%d|%s|%s|%s\\n", num_sig(res$statistic, 6), as.integer(res$parameter),
  fmt_p(res$p.value), num_p(res$p.value), num(cramer_v, 4)))
if (nrow(tbl) == 2 && ncol(tbl) == 2) {
  ft <- tryCatch({ fisher.test(tbl) }, error = function(e) NULL)
  if (!is.null(ft)) {
    cat(sprintf("FISHER|%s|%s\\n", fmt_p(ft$p.value), num_p(ft$p.value)))
  }
}
if (exp_min < 5) {
  cat(sprintf("WARN_EXPECTED|存在期望频数小于 5 的单元格（%d 个，最小 %.2f），卡方近似可能不可靠\\n", n_exp_lt5, exp_min))
}
cat(sprintf("CONCL|%s\\n", if (res$p.value < 0.05) "两变量存在统计学关联" else "两变量无统计学关联"))
`
  }

  /** 相关分析（Pearson / Spearman，含置信区间与 p 值） */
  static correlationCode(
    var1: string,
    var2: string,
    method: 'pearson' | 'spearman' = 'pearson',
    dataFile = 'data.csv'
  ): string {
    const m = method === 'spearman' ? 'spearman' : 'pearson'
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 相关分析 (${m}) ===\\n")
x <- suppressWarnings(as.numeric(as.character(data[["${rEscape(var1)}"]])))
y <- suppressWarnings(as.numeric(as.character(data[["${rEscape(var2)}"]])))
keep <- is.finite(x) & is.finite(y)
x <- x[keep]; y <- y[keep]
if (length(x) < 3) stop("有效样本不足（至少需要 3 对）")
res <- suppressWarnings(cor.test(x, y, method = "${m}"))
cat(sprintf("VARS|%s|%s|%s\\n", "${rEscape(var1)}", "${rEscape(var2)}", "${m}"))
cat(sprintf("DESC_COR|%d|%s|%s|%s|%s\\n", length(x), num(mean(x)), num(sd(x)), num(mean(y)), num(sd(y))))
cat(sprintf("RESULT_COR|%s|%s|%s|%s\\n", num(as.numeric(res$estimate), 4), fmt_p(res$p.value), num_p(res$p.value), length(x)))
if (!is.null(res$conf.int)) {
  cat(sprintf("CI_COR|%s|%s\\n", num(res$conf.int[1], 4), num(res$conf.int[2], 4)))
}
cat(sprintf("CONCL|%s\\n", if (res$p.value < 0.01) "存在极显著相关" else if (res$p.value < 0.05) "存在显著相关" else "不存在显著相关"))
`
  }

  /**
   * 线性回归
   * 用 reformulate() 构造公式 —— v0.2.5 生成 `lm("y" ~ "x")`，R 报
   * "invalid term in model formula"，导致线性回归从未成功执行过。
   */
  static regressionCode(dv: string, ivs: string[], dataFile = 'data.csv'): string {
    if (ivs.length === 0) {
      return `cat("__RWB_ERROR__: 线性回归至少需要 1 个自变量\\n")\n`
    }
    const resp = `"${rEscape(dv)}"`
    const terms = ivs.map((v) => `"${rEscape(v)}"`).join(', ')
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 线性回归分析 ===\\n")
fml <- reformulate(c(${terms}), response = ${resp})
model <- lm(fml, data = data)
s <- summary(model)
fstat <- s$fstatistic
f_val <- as.numeric(fstat[1]); df1 <- as.numeric(fstat[2]); df2 <- as.numeric(fstat[3])
p_val <- pf(f_val, df1, df2, lower.tail = FALSE)
cat(sprintf("MODEL|%s|%s|%s|%s|%s|%s\\n", num(s$r.squared), num(s$adj.r.squared),
  num(f_val, 4), fmt_p(p_val), num_p(p_val), num(s$sigma, 4)))
cat(sprintf("MODEL_DF|%d|%d|%d\\n", nrow(model$model), as.integer(df1), as.integer(df2)))
cat(sprintf("RESPONSE|%s\\n", ${resp}))
coefs <- s$coefficients
for (i in seq_len(nrow(coefs))) {
  nm <- rownames(coefs)[i]
  cat(sprintf("COEF|%s|%s|%s|%s|%s\\n", nm, num(coefs[i, 1]), num(coefs[i, 2]),
    num(coefs[i, 3]), num(coefs[i, 4], 6)))
}
# 标准化回归系数（beta）
# 必须把整个设计矩阵一起标准化后做多元回归 —— 逐个变量做简单回归得到的是
# 零阶相关系数 cor(x_j, y)，不是标准化偏回归系数，符号都可能相反。
X <- model.matrix(model)[, -1, drop = FALSE]
yv <- model.response(model.frame(model))
if (ncol(X) > 0 && sd(yv) > 0) {
  beta_vals <- tryCatch({
    Xs <- scale(X)
    ys <- as.numeric(scale(yv))
    cf <- coef(lm(ys ~ Xs))
    cf[-1]
  }, error = function(e) NULL)
  if (!is.null(beta_vals)) {
    for (j in seq_along(beta_vals)) {
      cat(sprintf("BETA|%s|%s\\n", colnames(X)[j], num(beta_vals[j], 4)))
    }
  }
}
# 共线性诊断
if (ncol(X) >= 2) {
  vif_vals <- tryCatch({
    sapply(seq_len(ncol(X)), function(j) {
      r2 <- summary(lm(X[, j] ~ X[, -j, drop = FALSE]))$r.squared
      if (r2 >= 1) Inf else 1 / (1 - r2)
    })
  }, error = function(e) NULL)
  if (!is.null(vif_vals)) {
    for (j in seq_along(vif_vals)) {
      cat(sprintf("VIF|%s|%s\\n", colnames(X)[j], num(vif_vals[j], 3)))
    }
  }
}
# 残差正态性
sw <- tryCatch({ shapiro.test(residuals(model)) }, error = function(e) NULL)
if (!is.null(sw)) {
  cat(sprintf("RESID_NORMAL|%s|%s\\n", fmt_p(sw$p.value), num_p(sw$p.value)))
}
cat(sprintf("CONCL|%s\\n", if (p_val < 0.05) "回归模型整体显著" else "回归模型整体不显著"))
`
  }

  /**
   * 信度分析（Cronbach's α）
   * v0.2.6 起支持反向计分自动识别、标准化 α、逐项删除分析、α 置信区间。
   */
  static reliabilityCode(items: string[], dataFile = 'data.csv'): string {
    const itemList = items.map((v) => `"${rEscape(v)}"`).join(', ')
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 信度分析 (Cronbach's α) ===\\n")
item_names <- c(${itemList})
missing_items <- item_names[!(item_names %in% names(data))]
if (length(missing_items) > 0) stop("以下变量不存在: ", paste(missing_items, collapse = ", "))
item_data <- as.data.frame(lapply(data[, item_names, drop = FALSE], function(x) suppressWarnings(as.numeric(as.character(x)))))
n_before <- nrow(item_data)
item_data <- item_data[complete.cases(item_data), , drop = FALSE]
k <- ncol(item_data)
if (k < 2) stop("信度分析至少需要 2 个项目")
if (nrow(item_data) < 2) stop("有效样本量不足（至少需要 2 行）")
dropped <- n_before - nrow(item_data)
if (dropped > 0) {
  cat(sprintf("NOTE_DROPPED|因缺失值采用整列删除，有效样本从 %d 减少到 %d（剔除 %d 行）\\n", n_before, nrow(item_data), dropped))
}
# 反向计分自动识别：与总分负相关的项目
total_raw <- rowSums(item_data)
reversed <- character(0)
for (nm in names(item_data)) {
  r_it <- suppressWarnings(cor(item_data[[nm]], total_raw))
  if (!is.na(r_it) && r_it < 0) {
    rg <- range(item_data[[nm]], na.rm = TRUE)
    item_data[[nm]] <- (rg[1] + rg[2]) - item_data[[nm]]
    reversed <- c(reversed, nm)
  }
}
if (length(reversed) > 0) {
  cat(sprintf("REVERSED|%s\\n", paste(reversed, collapse = ",")))
}
cat(sprintf("ITEMS|%d|%d\\n", k, nrow(item_data)))
item_vars <- apply(item_data, 2, var)
total_var <- var(rowSums(item_data))
if (any(item_vars == 0) || total_var == 0) stop("项目方差为 0，无法计算信度（检查是否有常量列）")
alpha <- (k / (k - 1)) * (1 - sum(item_vars) / total_var)
# 标准化 α
cors <- cor(item_data)
mean_r <- mean(cors[lower.tri(cors)])
alpha_std <- if (!is.na(mean_r) && mean_r > -1 / (k - 1)) (k * mean_r) / (1 + (k - 1) * mean_r) else NA
cat(sprintf("ALPHA|%s|%s\\n", num(alpha, 4), num(alpha_std, 4)))
# α 的 95% 置信区间（F 分布法）
ci_lo <- NA; ci_hi <- NA
try({
  f_lo <- qf(0.975, nrow(item_data) - 1, (nrow(item_data) - 1) * (k - 1))
  f_hi <- qf(0.025, nrow(item_data) - 1, (nrow(item_data) - 1) * (k - 1))
  ci_lo <- 1 - (1 - alpha) * f_lo
  ci_hi <- 1 - (1 - alpha) * f_hi
}, silent = TRUE)
if (!is.na(ci_lo) && !is.na(ci_hi)) {
  cat(sprintf("ALPHA_CI|%s|%s\\n", num(ci_lo, 4), num(ci_hi, 4)))
}
# 逐项统计分析
for (nm in names(item_data)) {
  rest <- rowSums(item_data[, setdiff(names(item_data), nm), drop = FALSE])
  r_it <- suppressWarnings(cor(item_data[[nm]], rest))
  a_drop <- (k - 1) / (k - 2) * (1 - sum(item_vars[setdiff(names(item_vars), nm)]) / var(rest))
  cat(sprintf("ITEM|%s|%s|%s|%s|%s\\n", nm, num(mean(item_data[[nm]])), num(sd(item_data[[nm]])), num(r_it, 4), num(a_drop, 4)))
}
cat(sprintf("CONCL|%s\\n", if (alpha >= 0.9) "信度非常好" else if (alpha >= 0.8) "信度好" else if (alpha >= 0.7) "信度可接受" else if (alpha >= 0.6) "信度尚可" else "信度不佳"))
`
  }

  /** 正态性检验（Shapiro-Wilk，含偏度/峰度补充） */
  static normalityTestCode(vars: string[], dataFile = 'data.csv'): string {
    const varList = vars.map((v) => `"${rEscape(v)}"`).join(', ')
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 正态性检验 (Shapiro-Wilk) ===\\n")
vars <- c(${varList})
for (v in vars) {
  x <- suppressWarnings(as.numeric(as.character(data[[v]])))
  x <- x[is.finite(x)]
  n <- length(x)
  if (n < 3) {
    cat(sprintf("NORM|%s|%d|NA|NA|NA|NA|NA|样本量不足\\n", v, n))
    next
  }
  if (n > 5000) {
    cat(sprintf("NORM|%s|%d|NA|NA|NA|%s|%s|样本量超过 5000，Shapiro-Wilk 不适用\\n", v, n,
      num(mean(x)), num(sd(x))))
    next
  }
  r <- shapiro.test(x)
  sk <- if (n > 2 && sd(x) > 0) mean(((x - mean(x)) / sd(x))^3) else NA
  ku <- if (n > 3 && sd(x) > 0) mean(((x - mean(x)) / sd(x))^4) - 3 else NA
  cat(sprintf("NORM|%s|%d|%s|%s|%s|%s|%s|%s\\n", v, n, num(r$statistic, 4), fmt_p(r$p.value), num_p(r$p.value),
    num(sk, 3), num(ku, 3), if (r$p.value < 0.05) "拒绝正态性假设" else "未拒绝正态性假设"))
}
`
  }

  /** 非参数检验（Mann-Whitney U，含效应量 rank-biserial） */
  static nonparametricCode(dv: string, groupVar: string, dataFile = 'data.csv'): string {
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 非参数检验 (Mann-Whitney U) ===\\n")
g_raw <- data[["${rEscape(groupVar)}"]]
y_raw <- suppressWarnings(as.numeric(as.character(data[["${rEscape(dv)}"]])))
keep <- !is.na(g_raw) & !is.na(y_raw)
g_raw <- g_raw[keep]; y_raw <- y_raw[keep]
groups <- sort(unique(g_raw))
if (length(groups) != 2) stop("分组变量必须恰好有2个水平，当前为 ", length(groups), " 个")
g1 <- y_raw[g_raw == groups[1]]
g2 <- y_raw[g_raw == groups[2]]
if (length(g1) < 2 || length(g2) < 2) stop("每组至少需要 2 个有效样本")
q1 <- quantile(g1, c(0.25, 0.75)); q2 <- quantile(g2, c(0.25, 0.75))
cat(sprintf("GRP|%s|%d|%s|%s|%s\\n", groups[1], length(g1), num(median(g1)), num(q1[1]), num(q1[2])))
cat(sprintf("GRP|%s|%d|%s|%s|%s\\n", groups[2], length(g2), num(median(g2)), num(q2[1]), num(q2[2])))
res <- suppressWarnings(wilcox.test(g1, g2))
cat(sprintf("METHOD|%s\\n", res$method))
u <- as.numeric(res$statistic)
n1 <- length(g1); n2 <- length(g2)
rank_biserial <- (2 * u) / (n1 * n2) - 1
cat(sprintf("RESULT_MW|%s|%s|%s|%s\\n", num(u, 1), fmt_p(res$p.value), num_p(res$p.value), num(rank_biserial, 4)))
cat(sprintf("CONCL|%s\\n", if (res$p.value < 0.05) "两组差异具有统计学意义" else "两组差异无统计学意义"))
`
  }

  /** 频数统计（区分占总数与占有效值百分比） */
  static frequencyCode(vars: string[], dataFile = 'data.csv'): string {
    const varList = vars.map((v) => `"${rEscape(v)}"`).join(', ')
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
vars <- c(${varList})
cat("=== 频数统计 ===\\n")
for (v in vars) {
  x <- data[[v]]
  x_chr <- as.character(x)
  x_chr[x_chr %in% c("NA", "")] <- NA
  tbl <- table(x_chr, useNA = "no")
  n_valid <- sum(tbl)
  n_missing <- sum(is.na(x_chr))
  cat(sprintf("FREQ_HEAD|%s|%d|%d\\n", v, n_valid, n_missing))
  if (length(tbl) == 0) next
  pct_valid <- prop.table(tbl) * 100
  for (i in seq_along(tbl)) {
    cat(sprintf("FREQ|%s|%s|%d|%s|%s\\n", v, names(tbl)[i], tbl[i],
      num(pct_valid[i], 1), num(tbl[i] / (n_valid + n_missing) * 100, 1)))
  }
}
`
  }

  /** 分类汇总（按分组变量计算统计量，含中位数与四分位） */
  static summaryByCode(groupVar: string, valueVar: string, dataFile = 'data.csv'): string {
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 分类汇总 ===\\n")
g <- data[["${rEscape(groupVar)}"]]
v <- suppressWarnings(as.numeric(as.character(data[["${rEscape(valueVar)}"]])))
keep <- !is.na(g) & is.finite(v)
g <- g[keep]; v <- v[keep]
if (length(g) == 0) stop("分组变量没有有效值")
cat(sprintf("VARS|%s|%s\\n", "${rEscape(groupVar)}", "${rEscape(valueVar)}"))
levels_g <- sort(unique(g))
for (lv in levels_g) {
  z <- v[g == lv]
  if (length(z) == 0) next
  if (length(z) < 2) {
    cat(sprintf("SUM|%s|%d|%s|NA|NA|%s|%s\\n", lv, length(z), num(mean(z)), num(min(z)), num(max(z))))
  } else {
    cat(sprintf("SUM|%s|%d|%s|%s|%s|%s|%s\\n", lv, length(z), num(mean(z)), num(sd(z)), num(median(z)),
      num(min(z)), num(max(z))))
  }
}
cat(sprintf("TOTAL|%d|%s|%s\\n", length(v), num(mean(v)), num(sd(v))))
`
  }
}
