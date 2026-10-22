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
 *
 * ⚠️ 必须用 String.raw：本常量含大量 R 的反斜杠转义（"\\n"、"\\\\"）。
 * 普通模板字符串会把 `\n` 变成真实换行、把 `\"` 变成引号，导致生成的 R
 * 脚本语法错乱——曾实测 `gsub("\\\\", ...)` 被降级成 `gsub("\\", ...)`，
 * R 报 `unexpected string constant`。R_COMMON 内**不要**写 ${} 插值。
 */
const R_COMMON = String.raw`
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

# ─────────────────────────────────────────────────────────────
# 结构化输出（v0.3.0 / T41）
#
# 用于根治"文本 + 固定下标"接口的脆弱性。v0.2.x 中解析器用 split('|')
# 后按硬编码下标取值，已造成四次真实事故（ANOVA 读错列、负数被删、
# 独立样本 t 的均值差取成 CI 下限、单样本 t 的 CI 下限取成 p 值）。
#
# 这里刻意**不依赖 jsonlite**：它不在 R 的 base/recommended 集合里，
# 装不上的机器会让整条 JSON 通道不可用。base R 手工构造完全够用，
# 且能精确控制数值精度（jsonlite 默认会做 digits 截断）。
# ─────────────────────────────────────────────────────────────

# 字符串 -> JSON 字符串。
# 不用 gsub：gsub 的 replacement 参数会把反斜杠再解释一遍，多层转义极难写对，
# 实测曾生成无法解析的 JSON（引号与反斜杠嵌套错位）。
# 逐字符显式映射一目了然，且不需要考虑正则元字符。
#
# 注意：本项目的 R 代码规范要求 if/else 一律用花括号包裹（见 generator-parse 契约
# 测试），因此这里用嵌套 if 而非 else-if 链——后者会让上一行不以 } 结尾。
jstr <- function(s) {
  if (is.null(s) || length(s) == 0) {
    return("null")
  }
  s <- as.character(s)[1]
  if (is.na(s)) {
    return("null")
  }
  ch <- strsplit(s, "", fixed = TRUE)[[1]]
  if (length(ch) == 0) {
    return("\"\"")
  }
  esc <- vapply(ch, function(c1) {
    if (c1 == "\\") {
      "\\\\"
    } else {
      if (c1 == "\"") {
        "\\\""
      } else {
        if (c1 == "\n") {
          "\\n"
        } else {
          if (c1 == "\r") {
            "\\r"
          } else {
            if (c1 == "\t") {
              "\\t"
            } else {
              c1
            }
          }
        }
      }
    }
  }, character(1), USE.NAMES = FALSE)
  paste0("\"", paste(esc, collapse = ""), "\"")
}

# 数值 → JSON 数字。NA/NaN/Inf 一律 null（JSON 无这些字面量）。
# 用 15 位有效数字的科学计数，确保 1.67e-31 这类 p 值不丢精度。
jnum <- function(x) {
  if (is.null(x) || length(x) == 0) return("null")
  v <- suppressWarnings(as.numeric(x[1]))
  if (is.na(v) || !is.finite(v)) return("null")
  format(v, scientific = TRUE, digits = 15)
}

# 逻辑值 → JSON 布尔；NA 为 null
jbool <- function(x) {
  if (is.null(x) || length(x) == 0) return("null")
  if (isTRUE(x)) return("true")
  if (identical(x, FALSE)) return("false")
  "null"
}

# 数值向量 → JSON 数组
jarr_num <- function(xs) {
  if (is.null(xs) || length(xs) == 0) return("[]")
  paste0("[", paste(vapply(xs, jnum, character(1)), collapse = ","), "]")
}

# 字符串向量 → JSON 数组
jarr_str <- function(xs) {
  if (is.null(xs) || length(xs) == 0) return("[]")
  paste0("[", paste(vapply(xs, jstr, character(1)), collapse = ","), "]")
}

# p 值对象：原始值供程序判断，display 供论文引用
jp <- function(p) {
  sprintf('{"value":%s,"display":%s}', jnum(p), jstr(fmt_p(p)))
}

# 诊断对象
jdiag <- function(id, label, value, ok, hint = NULL) {
  sprintf('{"id":%s,"label":%s,"value":%s,"ok":%s%s}',
    jstr(id), jstr(label), jstr(value), jbool(ok),
    if (is.null(hint)) "" else sprintf(',"hint":%s', jstr(hint)))
}

# 输出结构化结果。R 侧统一在正文末尾打印一行 __RWB_JSON__<json>，
# 主进程按哨兵切分，前端优先走 JSON、失败则回退文本解析。
# 用 on.exit 之外的显式调用，便于生成器按需附加字段。
jemit <- function(json) cat("__RWB_JSON__", json, "\n", sep = "")
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

  /**
   * 探索性因子分析（EFA）—— 纯 base R 实现，**不依赖 psych / GPArotation**
   *
   * 为什么不用 psych::fa / KMO：
   *   psych 是编译型重包（依赖 mnormt 等），装不上的机器会让整个问卷效度线不可用。
   *   EFA 的全部计算（相关矩阵、Bartlett、KMO、特征值分解、varimax 旋转）都能用
   *   base R + stats 完成，且 `stats::varimax` 本身就是 base R 自带的。
   *   实测（300 样本、2 因子已知结构）载荷完美恢复，主因子归属逐题正确。
   *
   * 方法学说明：
   *   - 因子抽取用**主成分法**（PCA on correlation matrix）：载荷 = 特征向量 × √特征值。
   *     这与 SPSS 的"主成分"抽取一致；不用主轴因子法（PAF）的迭代，因为 PAF 在
   *     小样本/ Heywood case 下不收敛，且我们优先保证"能算出来且可解释"。
   *   - 旋转用 `stats::varimax`（正交最大方差法），Kaiser 标准化。
   *   - **载荷符号统一**：特征向量符号是任意的，若不处理会出现整列负载荷，
   *     用户无法解释。这里按"列内绝对值最大者为正"翻转（与 psych 一致）。
   *   - 因子数默认按 Kaiser 准则（特征值 > 1），也可由用户指定。
   */
  static efaCode(items: string[], nFactors?: number, dataFile = 'data.csv'): string {
    const itemVec = items.map((v) => `"${rEscape(v)}"`).join(', ')
    const forcedN = nFactors && nFactors > 0 ? String(Math.round(nFactors)) : 'NA'
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 探索性因子分析 (EFA) ===\\n")
items <- c(${itemVec})
forced_n <- ${forcedN}

# 只保留全部题项都有效的样本（listwise 删除），并报告剔除量
X_raw <- data[, items, drop = FALSE]
ok <- complete.cases(X_raw)
X <- X_raw[ok, , drop = FALSE]
n_dropped <- sum(!ok)
n <- nrow(X)
if (n < 30) {
  stop("有效样本不足（", n, " 行），因子分析至少需要 30 个完整样本")
}
p <- length(items)
if (p < 3) {
  stop("题项过少（", p, " 个），因子分析至少需要 3 个题项")
}
# 题项必须是数值
for (nm in items) {
  if (!is.numeric(X[[nm]])) {
    stop("题项 ", nm, " 不是数值型，无法做因子分析")
  }
}

R <- cor(X)
# 相关矩阵必须可逆（无完全共线的题项）
if (any(!is.finite(R))) {
  stop("相关矩阵含非有限值，可能存在常量题项")
}
if (abs(det(R)) < 1e-12) {
  stop("相关矩阵接近奇异（存在完全共线或重复的题项），无法求逆")
}

# ── Bartlett 球形检验（闭式解）──
# H0: 相关矩阵为单位阵（变量间无相关）。显著则适合做因子分析。
chi_sq <- -(n - 1 - (2 * p + 5) / 6) * log(det(R))
df_b <- p * (p - 1) / 2
p_b <- pchisq(chi_sq, df_b, lower.tail = FALSE)
cat(sprintf("BARTLETT|%s|%d|%s|%s\\n", num(chi_sq, 4), df_b, fmt_p(p_b), num_p(p_b)))

# ── KMO 取样适切性度量 ──
# 基于相关矩阵的逆：对角置零后，整体 KMO = Σr² / (Σr² + Σq²)
Rinv <- solve(R)
dinv <- diag(Rinv)
Q <- -Rinv / sqrt(outer(dinv, dinv))
diag(Q) <- 0
R2 <- R^2
diag(R2) <- 0
kmo_overall <- sum(R2) / (sum(R2) + sum(Q^2))
# 逐题 KMO：该题的 r² 之和 / (r² 之和 + q² 之和)
kmo_item <- rep(NA_real_, p)
for (i in seq_len(p)) {
  r2i <- sum(R2[i, ])
  q2i <- sum(Q[i, ]^2)
  kmo_item[i] <- r2i / (r2i + q2i)
}
cat(sprintf("KMO|%s\\n", num(kmo_overall, 4)))
for (i in seq_len(p)) {
  cat(sprintf("KMO_ITEM|%s|%s\\n", items[i], num(kmo_item[i], 4)))
}

# ── 特征值分解（相关矩阵对称，eigen 稳定）──
eig <- eigen(R, symmetric = TRUE)
ev <- eig$values
# 显著负特征值说明相关矩阵病态（数据不满足因子分析前提），直接报错。
if (any(ev < -1e-8)) {
  stop("相关矩阵存在显著负特征值（最小 ", format(min(ev), digits = 4),
       "），数据可能存在共线或重复题项，无法进行因子分析")
}
# 数值噪声级别的微小负值（如 -1e-16）必须截断为 0：
# 否则 sqrt(负值) 会产生 NaN，而 NaN 会沿载荷矩阵扩散，最终让整张表变成 NaN，
# 且**全程不报错**——用户拿到的是废数据却以为分析成功。
# 这在小样本、题项多、或用户指定因子数接近 p-1 时真实可复现。
n_neg_clipped <- sum(ev < 0)
if (n_neg_clipped > 0) {
  ev[ev < 0] <- 0
}
# 因子数：用户指定优先，否则 Kaiser 准则（>1），且至少 1 个、至多 p-1 个
n_fac <- if (is.na(forced_n)) sum(ev > 1) else forced_n
n_fac <- max(1L, min(as.integer(n_fac), p - 1L))
# 防御：若所选范围内出现非正特征值，说明指定因子数超出数据支撑，
# 自动收缩到"正特征值个数"，并明确告知用户而不是静默产出 NaN。
n_positive <- sum(ev > 1e-10)
if (n_fac > n_positive) {
  cat(sprintf("NOTE_SHRINK|指定因子数 %d 超出数据支撑，已收缩为 %d（正特征值个数）\\n",
    n_fac, max(1L, n_positive)))
  n_fac <- max(1L, n_positive)
}
cat(sprintf("NFACTOR|%d\\n", n_fac))
if (n_neg_clipped > 0) {
  cat(sprintf("NOTE_CLIPPED|相关矩阵有 %d 个数值噪声级负特征值已截断为 0，结果不受影响\\n",
    n_neg_clipped))
}

# 方差解释：每个因子的方差 = 特征值；占总方差比例 = 特征值 / p
cum <- 0
for (k in seq_len(n_fac)) {
  vp <- ev[k] / p * 100
  cum <- cum + vp
  cat(sprintf("EIGEN|%d|%s|%s|%s\\n", k, num(ev[k], 4), num(vp, 2), num(cum, 2)))
}

# ── 主成分法载荷 ──
L <- eig$vectors[, seq_len(n_fac), drop = FALSE] %*% diag(sqrt(ev[seq_len(n_fac)]), n_fac)
rownames(L) <- items

# ── varimax 正交旋转（stats 自带）──
if (n_fac > 1) {
  vr <- stats::varimax(L)
  L_rot <- unclass(vr$loadings)
} else {
  L_rot <- L
}
rownames(L_rot) <- items
colnames(L_rot) <- paste0("F", seq_len(n_fac))

# ── 载荷符号统一 ──
# 特征向量的整体符号是任意的。若不处理，可能整列都是负值，用户无法解释。
# 规则：每列若绝对值最大的载荷为负，则整列取反（与 psych 的惯例一致）。
for (j in seq_len(ncol(L_rot))) {
  idx <- which.max(abs(L_rot[, j]))
  if (L_rot[idx, j] < 0) {
    L_rot[, j] <- -L_rot[, j]
  }
}

# ── 输出载荷表 ──
LOAD_HEAD <- paste0("LOAD_HEAD|item|", paste(colnames(L_rot), collapse = "|"), "|communality")
cat(LOAD_HEAD, "\\n")
for (i in seq_len(p)) {
  vals <- vapply(L_rot[i, ], function(z) num(z, 4), character(1))
  comm <- sum(L_rot[i, ]^2)
  cat(sprintf("LOAD|%s|%s|%s\\n", items[i], paste(vals, collapse = "|"), num(comm, 4)))
}

# ── 主因子归属与聚类检查 ──
prim <- apply(abs(L_rot), 1, which.max)
for (i in seq_len(p)) {
  cat(sprintf("PRIMARY|%s|%d\\n", items[i], prim[i]))
}

if (n_dropped > 0) {
  cat(sprintf("NOTE_DROPPED|因缺失值采用整列删除，剔除 %d 行，有效样本 %d\\n", n_dropped, n))
}

# ── 结论（KMO + Bartlett 组合判断）──
kmo_txt <- if (kmo_overall >= 0.9) {
  "非常适合"
} else {
  if (kmo_overall >= 0.8) {
    "适合"
  } else {
    if (kmo_overall >= 0.7) {
      "尚可"
    } else {
      if (kmo_overall >= 0.6) {
        "勉强"
      } else {
        "不适合"
      }
    }
  }
}
if (p_b < 0.05 && kmo_overall >= 0.6) {
  cat(sprintf("CONCL|KMO = %s（%s），Bartlett 检验显著（%s），数据%s做因子分析\\n",
    num(kmo_overall, 3), kmo_txt, fmt_p(p_b), "适合"))
} else {
  cat(sprintf("CONCL|KMO = %s（%s），Bartlett 检验 %s，数据可能不适合做因子分析\\n",
    num(kmo_overall, 3), kmo_txt, fmt_p(p_b)))
}
`
  }
}
