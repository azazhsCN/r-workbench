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
# ⚠️ "g" 格式必须 trimws：formatC 在未指定 width 时会把字段右对齐补到
# digits+1 个字符宽（实测 formatC(0, format = "g", digits = 8) 返回 8 个空格
# + "0"）。p 值接近 1 或统计量落在 0-999 时会产出带前导空格的字段，违反
# 契约"字段以 | 分隔、不加空格"。formatC 的 width = 0 参数**无效**（仍补位），
# 只有 trimws 能真正去掉。
# 期望频数/卡方等极小统计量需要保留精度，固定 4 位小数会把 9.1e-31 打成 0
num_sig <- function(x, d = 6L) {
  if (length(x) == 0 || is.na(x) || !is.finite(x)) return("NA")
  trimws(formatC(as.numeric(x), format = "g", digits = d))
}
# p 值建议用科学计数输出，固定 6 位小数会把 1e-31 打成 0.000000 而丢失全部精度
num_p <- function(x) {
  if (length(x) == 0 || is.na(x) || !is.finite(x)) return("NA")
  trimws(formatC(as.numeric(x), format = "g", digits = 8))
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

  /* ═══════════════════════════════════════════════════════════════════════
   * v0.3.1 问卷效度进阶：CFA / CVI / Harman
   *
   * 三个方法全部走**纯 base R**（stats + base 之外一律不碰），理由与
   * EFA（见下方 efaCode）相同：lavaan / psych 是编译型重包，实测
   * `requireNamespace('lavaan')` 在本机为 FALSE，装不上的机器会让整条
   * 问卷效度线不可用。项目红线是"装了 R 就能用"。
   *
   * 行格式一律以 V031_CONTRACT.md 为准（唯一权威），本段只负责产出。
   * ═══════════════════════════════════════════════════════════════════════ */

  /**
   * 验证性因子分析（CFA）—— 纯 base R 实现的极大似然 CFA（不依赖 lavaan）。
   * 行格式见 V031_CONTRACT.md 第一节。
   *
   * 方法学要点（已由原型实测定型，勿"重新设计"）：
   *
   * 1. **因子归属来自同一脚本内的 EFA**（主成分 + varimax），即 EFA→CFA 串联。
   *    归属必须显式输出（CFA_ITEM）并在表注里声明"探索—验证同源"。
   * 2. **角度参数化保证 Φ 合法**：Φ = C C'，C 由 k(k−1)/2 个角度按 Givens
   *    累积构造，任意实数参数都映射到合法相关矩阵 → optim 不会走进非正定区域。
   * 3. **符号统一必须同步翻转 Φ**：因子方向不定，整列取反不改变拟合。按
   *    "列内 |载荷| 最大者为正"翻转时，**必须同时翻转 Φ 的第 j 行与第 j 列**。
   *    原型第一版漏了这一步，结果整列负载荷且 φ 符号相反（真值 +0.35 估成
   *    −0.37）——这是实测到的真实缺陷，不是理论洁癖。
   * 4. **参数向量** = c(p 个载荷, k(k−1)/2 个角度, p 个 log 误差方差)；
   *    `npar = 2p + k(k−1)/2`，`df = p(p+1)/2 − npar`，与 lavaan 口径一致。
   * 5. 求解用 `optim(method="BFGS")` + 3 个起点（固定种子，结果可复现），取 F 最小者。
   * 6. 标准化载荷的 se/z/p 用 delta 法：V = 2/(n−1) · H⁻¹（H 为 F_ML 的数值
   *    Hessian），J 为 std_load 对参数的数值 Jacobian。符号翻转不改变方差
   *    （D J V J' D 的对角元素与 D 无关），故 se 可先算后配符号。
   */
  static cfaCode(items: string[], nFactors?: number, dataFile = 'data.csv'): string {
    const itemVec = items.map((v) => `"${rEscape(v)}"`).join(', ')
    const forcedN = nFactors && nFactors > 0 ? String(Math.round(nFactors)) : 'NA'
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 验证性因子分析 (CFA) ===\\n")
items <- c(${itemVec})
forced_n <- ${forcedN}

missing_items <- items[!(items %in% names(data))]
if (length(missing_items) > 0) {
  stop("以下变量不存在: ", paste(missing_items, collapse = ", "))
}

# 只保留全部题项都有效的样本（listwise 删除），并报告剔除量
X_raw <- data[, items, drop = FALSE]
ok <- complete.cases(X_raw)
X <- X_raw[ok, , drop = FALSE]
n_dropped <- sum(!ok)
n <- nrow(X)
if (n < 100) {
  stop("有效样本不足（", n, " 行），验证性因子分析要求 n >= 100")
}
p <- length(items)
# 3 题 1 因子是恰好识别模型（df = 0），契约明确要求支持并把 CFI/TLI/RMSEA
# 置为 1/1/0，因此下限取 3 而不是 4；p < 3 时连 df = 0 都不可能。
if (p < 3) {
  stop("题项过少（", p, " 个），CFA 至少需要 3 个题项")
}
for (nm in items) {
  if (!is.numeric(X[[nm]])) {
    stop("题项 ", nm, " 不是数值型，无法做 CFA")
  }
}
R <- cor(X)
if (any(!is.finite(R))) {
  stop("相关矩阵含非有限值，可能存在常量题项")
}
if (abs(det(R)) < 1e-12) {
  stop("相关矩阵接近奇异（存在完全共线或重复的题项），无法做 CFA")
}
logdetR <- as.numeric(determinant(R, logarithm = TRUE)$modulus)

# ─────────────────────────────────────────────────────────────
# 步骤 1：EFA（主成分法 + varimax）导出因子归属 —— EFA -> CFA 串联
# ─────────────────────────────────────────────────────────────
eig <- eigen(R, symmetric = TRUE)
ev <- eig$values
if (any(ev < -1e-8)) {
  stop("相关矩阵存在显著负特征值（最小 ", num(min(ev), 4),
       "），数据可能存在共线或重复题项，无法做 CFA")
}
# 数值噪声级负值必须截断：sqrt(负值) 产生 NaN 会沿载荷矩阵静默扩散
ev[ev < 0] <- 0
n_fac <- if (is.na(forced_n)) sum(ev > 1) else as.integer(forced_n)
n_fac <- as.integer(max(1L, min(n_fac, p - 1L)))
n_positive <- sum(ev > 1e-10)
if (n_fac > n_positive) {
  n_fac <- as.integer(max(1L, n_positive))
}
L0 <- eig$vectors[, seq_len(n_fac), drop = FALSE] %*%
  diag(sqrt(ev[seq_len(n_fac)]), n_fac)
if (n_fac > 1) {
  L_rot <- unclass(stats::varimax(L0)$loadings)
} else {
  L_rot <- L0
}
# 载荷符号统一（与 EFA 完全一致的处理）
for (j in seq_len(ncol(L_rot))) {
  idx_j <- which.max(abs(L_rot[, j]))
  if (L_rot[idx_j, j] < 0) {
    L_rot[, j] <- -L_rot[, j]
  }
}
fac_of <- as.integer(apply(abs(L_rot), 1, which.max))

# 每个因子至少 2 个题项：只有 1 个题项时"载荷"与"误差方差"不可分，
# 模型不可识别。修法：从题项最多的因子中，把它在该因子上次级载荷最高
# 的题项划过来（只从 count >= 3 的因子取，避免把别的因子拆空）。
counts <- tabulate(fac_of, nbins = n_fac)
guard <- 0L
while (any(counts < 2) && guard < 100L) {
  guard <- guard + 1L
  j_need <- which(counts < 2)[1]
  donors <- which(counts >= 3)
  if (length(donors) == 0) {
    stop("按当前因子数无法形成「每个因子 >= 2 个题项」的结构，请减少因子数或调整题项")
  }
  d <- donors[which.max(counts[donors])]
  cand <- which(fac_of == d)
  pick <- cand[which.max(abs(L_rot[cand, j_need]))]
  fac_of[pick] <- j_need
  counts[d] <- counts[d] - 1L
  counts[j_need] <- counts[j_need] + 1L
}
if (any(counts < 2)) {
  stop("按当前因子数无法形成「每个因子 >= 2 个题项」的结构，请减少因子数或调整题项")
}

n_par <- 2 * p + n_fac * (n_fac - 1) / 2
df_model <- p * (p + 1) / 2 - n_par
if (df_model < 0) {
  stop("模型不可识别：p = ", p, "、因子数 = ", n_fac, " 时 df = ", df_model,
       " < 0（参数 ", n_par, " 个 > 协方差元素 ", p * (p + 1) / 2, " 个）")
}

cat(sprintf("CFA_SPEC|%d|%d|%d\\n", n_fac, p, n))
for (i in seq_len(p)) {
  cat(sprintf("CFA_ITEM|%s|%d\\n", items[i], fac_of[i]))
}
syntax <- character(0)
for (j in seq_len(n_fac)) {
  syntax <- c(syntax, paste0("F", j, " =~ ", paste(items[fac_of == j], collapse = " + ")))
}
cat(sprintf("CFA_MODEL|%s\\n", paste(syntax, collapse = "; ")))

# ─────────────────────────────────────────────────────────────
# 步骤 2：ML 拟合（角度参数化 + BFGS 多起点）
# ─────────────────────────────────────────────────────────────
# 任意实数角度 -> 合法相关矩阵。C 的列按单位向量累积构造，Phi = C C'。
cor_from_angles <- function(th, k) {
  if (k == 1) {
    return(matrix(1, 1, 1))
  }
  C <- matrix(0, k, k)
  C[1, 1] <- 1
  pos <- 1
  for (i in 2:k) {
    ang <- th[pos:(pos + i - 2)]
    pos <- pos + i - 1
    s <- 1
    for (j in 1:(i - 1)) {
      C[i, j] <- cos(ang[j]) * s
      s <- s * sin(ang[j])
    }
    C[i, i] <- s
  }
  Phi <- C %*% t(C)
  (Phi + t(Phi)) / 2
}
na_free <- n_fac * (n_fac - 1) / 2
build <- function(par) {
  lam_v <- par[1:p]
  th_a <- if (na_free > 0) par[(p + 1):(p + na_free)] else numeric(0)
  lt_v <- par[(p + na_free + 1):(p + na_free + p)]
  Phi_m <- cor_from_angles(th_a, n_fac)
  Lam <- matrix(0, p, n_fac)
  for (i in seq_len(p)) {
    Lam[i, fac_of[i]] <- lam_v[i]
  }
  Sigma <- Lam %*% Phi_m %*% t(Lam) + diag(exp(lt_v), p)
  list(Sigma = Sigma, lam = lam_v, Phi = Phi_m)
}
F_of <- function(par) {
  S <- build(par)$Sigma
  d <- determinant(S, logarithm = TRUE)
  if (!is.finite(d$modulus)) {
    return(1e10)
  }
  v <- tryCatch(
    as.numeric(d$modulus) + sum(diag(R %*% solve(S))) - logdetR - p,
    error = function(e) 1e10
  )
  if (!is.finite(v)) {
    return(1e10)
  }
  v
}

# 起点：把 EFA 载荷放到各自的因子上；3 个起点中后两个加扰动
lam0 <- as.numeric(L_rot[cbind(seq_len(p), fac_of)])
lam0 <- pmax(pmin(lam0, 0.95), -0.95)
lam0[abs(lam0) < 0.1] <- 0.5
# 固定种子：多起点必须可复现，否则同一份数据两次运行可能给出不同小数位
set.seed(20260101L)
best <- NULL
for (st in seq_len(3)) {
  lam_s <- if (st == 1) lam0 else lam0 + rnorm(p, 0, 0.15)
  par0 <- c(lam_s, rep(pi / 2, na_free), log(pmax(1 - lam_s^2, 0.05)))
  o <- try(optim(par0, F_of, method = "BFGS",
                 control = list(maxit = 2000, reltol = 1e-12)), silent = TRUE)
  if (inherits(o, "try-error") || !is.finite(o$value)) {
    next
  }
  if (is.null(best) || o$value < best$value) {
    best <- o
  }
}
if (is.null(best)) {
  stop("CFA 极大似然估计未收敛（3 个起点全部失败）")
}
par_hat <- best$par
F_ml <- as.numeric(best$value)

# ─────────────────────────────────────────────────────────────
# 步骤 3：符号统一（翻转 Λ 的列 + 同步翻转 Φ 的行与列）
# ─────────────────────────────────────────────────────────────
ms_hat <- build(par_hat)
lam <- ms_hat$lam
Phi_raw <- ms_hat$Phi
theta <- exp(par_hat[(p + na_free + 1):(p + na_free + p)])
flip <- rep(1, n_fac)
for (j in seq_len(n_fac)) {
  idx <- which(fac_of == j)
  big <- idx[which.max(abs(lam[idx]))]
  if (lam[big] < 0) {
    lam[idx] <- -lam[idx]
    flip[j] <- -1
  }
}
# 关键一步：翻转载荷列必须同步翻转 Φ 的第 j 行与第 j 列，
# 否则 Φ 与 Λ 不再对应同一个模型（原型实测：φ 真值 +0.35 被估成 −0.37）
Phi <- diag(flip, n_fac) %*% Phi_raw %*% diag(flip, n_fac)
Lam <- matrix(0, p, n_fac)
for (i in seq_len(p)) {
  Lam[i, fac_of[i]] <- lam[i]
}
Sigma <- Lam %*% Phi %*% t(Lam) + diag(theta, p)
sd_jj <- sqrt(diag(Sigma))
std_lam <- lam / sd_jj
r2_std <- std_lam^2

# 未标准化载荷（原始量纲）。
# 拟合对象是**相关矩阵**，模型隐含 Σ 的对角线恒为 1，因此
# std_lam = lam / sqrt(diag(Sigma)) 数值上就等于 lam —— 若直接把 lam 当成
# unstd_load 输出，两列会一模一样，用户以为在看两个口径实为同一个数。
# 正确换算式：原始量纲下 Y_j = lam_raw * F + e 且 Var(F) = 1，
# 则 lam_raw = lam_std * sd(Y_j)，等价于对原始协方差矩阵（而非相关矩阵）
# 拟合得到的未标准化载荷，可直接用于原始数据的评分与应用。
# ⚠️ sd 必须用 listwise 删除后的同一批有效样本（即 X），否则与模型样本不一致。
raw_sd <- vapply(seq_len(p), function(i) sd(X[[i]]), numeric(1))
unstd_lam <- std_lam * raw_sd

# ─────────────────────────────────────────────────────────────
# 步骤 4：拟合指标（公式逐条对应契约）
# ─────────────────────────────────────────────────────────────
chisq <- (n - 1) * F_ml
chisq_null <- -(n - 1) * logdetR
df_null <- p * (p - 1) / 2
p_fit <- if (df_model > 0) pchisq(chisq, df_model, lower.tail = FALSE) else NA_real_
cfi <- 1
tli <- 1
rmsea <- 0
if (df_model > 0) {
  num_cfi <- max(chisq - df_model, 0)
  den_cfi <- max(chisq - df_model, chisq_null - df_null, 0)
  cfi <- if (den_cfi > 0) 1 - num_cfi / den_cfi else 1
  d1 <- chisq_null / df_null
  d2 <- chisq / df_model
  tli <- if (abs(d1 - 1) > 1e-12) (d1 - d2) / (d1 - 1) else 1
  rmsea <- sqrt(max(chisq - df_model, 0) / (df_model * (n - 1)))
}
std_res <- (R - Sigma) / outer(sd_jj, sd_jj)
srmr <- sqrt(mean(std_res[lower.tri(std_res, diag = TRUE)]^2))
cat(sprintf("CFA_FIT|%s|%d|%s|%s\\n", num(chisq), df_model, fmt_p(p_fit), num_p(p_fit)))
cat(sprintf("CFA_FITIDX|%s|%s|%s|%s\\n", num(cfi), num(tli), num(rmsea), num(srmr)))
cat(sprintf("CFA_NULLMODEL|%s|%d\\n", num(chisq_null), df_null))

# ─────────────────────────────────────────────────────────────
# 步骤 5：标准化载荷的 delta 法标准误
#   V = 2/(n-1) * H^-1（H 为 F_ML 的数值 Hessian）
#   符号翻转不改变方差（D J V J' D 的对角元与 D 无关），故先算后配符号
# ─────────────────────────────────────────────────────────────
num_hess <- function(fun, par, h) {
  m <- length(par)
  f0 <- fun(par)
  H <- matrix(0, m, m)
  for (i in seq_len(m)) {
    ei <- rep(0, m)
    ei[i] <- h
    H[i, i] <- (fun(par + ei) - 2 * f0 + fun(par - ei)) / (h * h)
    if (i < m) {
      for (j in (i + 1):m) {
        ej <- rep(0, m)
        ej[j] <- h
        v <- (fun(par + ei + ej) - fun(par + ei - ej) -
              fun(par - ei + ej) + fun(par - ei - ej)) / (4 * h * h)
        H[i, j] <- v
        H[j, i] <- v
      }
    }
  }
  H
}
se_std <- rep(NA_real_, p)
se_phi <- rep(NA_real_, max(na_free, 1L))
H_hat <- tryCatch(num_hess(F_of, par_hat, 1e-4), error = function(e) NULL)
V_hat <- NULL
if (!is.null(H_hat)) {
  Hinv <- tryCatch(solve(H_hat), error = function(e) NULL)
  if (!is.null(Hinv) && all(is.finite(Hinv)) && all(diag(Hinv) > 0)) {
    V_hat <- Hinv * 2 / (n - 1)
  }
}
if (!is.null(V_hat)) {
  # 标准化载荷对全部参数的数值 Jacobian
  J_std <- matrix(0, p, length(par_hat))
  for (i in seq_along(par_hat)) {
    hi <- 1e-6 * max(1, abs(par_hat[i]))
    a <- par_hat
    a[i] <- a[i] + hi
    b <- par_hat
    b[i] <- b[i] - hi
    sa <- build(a)
    sb <- build(b)
    J_std[, i] <- (sa$lam / sqrt(diag(sa$Sigma)) - sb$lam / sqrt(diag(sb$Sigma))) / (2 * hi)
  }
  se_std <- sqrt(pmax(diag(J_std %*% V_hat %*% t(J_std)), 0))
  if (na_free > 0) {
    J_phi <- matrix(0, na_free, length(par_hat))
    for (i in seq_along(par_hat)) {
      hi <- 1e-6 * max(1, abs(par_hat[i]))
      a <- par_hat
      a[i] <- a[i] + hi
      b <- par_hat
      b[i] <- b[i] - hi
      pa <- cor_from_angles(a[(p + 1):(p + na_free)], n_fac)
      pb <- cor_from_angles(b[(p + 1):(p + na_free)], n_fac)
      J_phi[, i] <- (pa[lower.tri(pa)] - pb[lower.tri(pb)]) / (2 * hi)
    }
    se_phi <- sqrt(pmax(diag(J_phi %*% V_hat %*% t(J_phi)), 0))
  }
}

# 字段顺序：item | std_load | unstd_load | se | z | p_display | p_raw | r2
# 口径说明：se / z / p 是针对**标准化载荷**的 Wald 检验（契约第 45-48 行），
# 不是未标准化载荷的检验；unstd_load 只作为原始量纲的报告值（带 sd(Y) 缩放）。
for (i in seq_len(p)) {
  se_i <- se_std[i]
  z_i <- NA_real_
  p_i <- NA_real_
  if (length(se_i) == 1 && is.finite(se_i) && se_i > 0) {
    z_i <- std_lam[i] / se_i
    p_i <- 2 * pnorm(-abs(z_i))
  }
  cat(sprintf("CFA_ESTIMATE|%s|%s|%s|%s|%s|%s|%s|%s\\n", items[i], num(std_lam[i]),
    num(unstd_lam[i]), num(se_i), num(z_i), fmt_p(p_i), num_p(p_i), num(r2_std[i])))
}

if (n_fac >= 2) {
  # 下三角按行优先排布，与 cor_from_angles 里角度的顺序一致：
  # (2,1) (3,1) (3,2) (4,1) (4,2) (4,3) ...
  phi_idx <- matrix(0L, n_fac, n_fac)
  phi_idx[lower.tri(phi_idx)] <- seq_len(na_free)
  for (a in seq_len(n_fac - 1)) {
    for (b in (a + 1):n_fac) {
      cor_ab <- Phi[a, b]
      # 注意取 phi_idx[b, a]（下三角）；取 [a, b] 会拿到 0 号下标 →
      # numeric(0)，随后 is.finite() 返回 logical(0)，if 条件报
      # "missing value where TRUE/FALSE needed"
      se_ab <- se_phi[phi_idx[b, a]]
      z_ab <- NA_real_
      p_ab <- NA_real_
      if (length(se_ab) == 1 && is.finite(se_ab) && se_ab > 0) {
        z_ab <- cor_ab / se_ab
        p_ab <- 2 * pnorm(-abs(z_ab))
      }
      cat(sprintf("CFA_FACTOR|F%d|F%d|%s|%s|%s|%s|%s\\n", a, b, num(cor_ab),
        num(se_ab), num(z_ab), fmt_p(p_ab), num_p(p_ab)))
    }
  }
}

# 组合信度 / 平均方差抽取量（λ 用标准化载荷，θ 用 1 − λ*² 的标准化误差）
for (j in seq_len(n_fac)) {
  idx <- which(fac_of == j)
  lam_j <- std_lam[idx]
  err_j <- pmax(1 - lam_j^2, 0)
  sum_lam <- sum(lam_j)
  sum_err <- sum(err_j)
  cr_j <- if ((sum_lam^2 + sum_err) > 0) (sum_lam^2) / (sum_lam^2 + sum_err) else NA_real_
  ave_j <- if ((sum(lam_j^2) + sum_err) > 0) sum(lam_j^2) / (sum(lam_j^2) + sum_err) else NA_real_
  cat(sprintf("CFA_RELIAB|F%d|%s|%s|%s\\n", j, num(cr_j), num(ave_j),
    num(if (is.na(ave_j)) NA_real_ else sqrt(max(ave_j, 0)))))
}

# ─────────────────────────────────────────────────────────────
# 步骤 6：诊断与结论
# ─────────────────────────────────────────────────────────────
heywood <- any(theta <= 1e-6) || any(abs(std_lam) > 1)
if (n_dropped > 0) {
  cat(sprintf("CFA_NOTE|因缺失值采用整列删除，剔除 %d 行，有效样本 %d\\n", n_dropped, n))
}
cat(sprintf("CFA_NOTE|估计方法：极大似然 ML（相关矩阵，纯 base R 实现，未使用 lavaan）\\n"))
cat(sprintf("CFA_NOTE|因子结构由同一数据集的 EFA（主成分 + varimax）导出，属探索—验证同源，理想做法是在独立样本上复核\\n"))
if (heywood) {
  cat(sprintf("CFA_NOTE|检测到 Heywood 案例（误差方差 <= 1e-6 或 |标准化载荷| > 1），解落在边界，载荷与信度指标需谨慎解读\\n"))
}
if (df_model == 0) {
  cat(sprintf("CFA_NOTE|模型恰好识别（df = 0），CFI/TLI/RMSEA 无判别力，仅 SRMR 可作参考\\n"))
}
if (is.na(p_fit)) {
  cat(sprintf("CFA_NOTE|卡方检验的 p 值不可用（df = 0 的恰好识别模型）\\n"))
}
fit_txt <- "模型拟合不佳"
if (cfi >= 0.90 && rmsea <= 0.08 && srmr <= 0.08) {
  fit_txt <- "模型拟合可接受"
}
if (cfi >= 0.95 && tli >= 0.95 && rmsea <= 0.06 && srmr <= 0.08) {
  fit_txt <- "模型拟合良好"
}
cat(sprintf("CONCL|CFI = %s，TLI = %s，RMSEA = %s，SRMR = %s，%s\\n",
  num(cfi), num(tli), num(rmsea), num(srmr), fit_txt))
`
  }

  /**
   * 内容效度指数（CVI）—— 行=专家、列=题项，1–4 相关性评分。
   * 行格式见 V031_CONTRACT.md 第二节。
   *
   * ⚠️ 数据形态与其余方法**相反**：这里每一行是一位专家，每一列是一个题项。
   * 题项名即列名，专家数 = 行数。
   *
   * 阈值表（Lynn 1986；Polit & Beck 2006；Polit, Beck & Owen 2007）：
   *   n <= 5      -> 1.00
   *   6 <= n <= 8 -> 0.83
   *   n >= 9      -> 0.78
   * 阈值必须与离散取值的可达性一致：n=6 时 5/6 = 0.8333 恰好达标；
   * n=9 时 7/9 = 0.7778 **不达标**（0.78 > 7/9），必须 8/9 = 0.8889。
   * 修正 Kappa 的 Pc = C(n, A)/2^n 是**单点**二项系数（不是尾概率和），
   * A = ceiling(阈值 × n)；A < n 时两者不同（n=6,A=5：单点 6/64，尾和 7/64）。
   */
  static cviCode(items: string[], dataFile = 'data.csv'): string {
    const itemVec = items.map((v) => `"${rEscape(v)}"`).join(', ')
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 内容效度指数 (CVI) ===\\n")
items <- c(${itemVec})

missing_items <- items[!(items %in% names(data))]
if (length(missing_items) > 0) {
  stop("以下变量不存在: ", paste(missing_items, collapse = ", "))
}
if (length(items) < 1) {
  stop("至少需要 1 个题项")
}

# 行 = 专家，列 = 题项
X_raw <- data[, items, drop = FALSE]
n_experts <- nrow(X_raw)
n_items <- ncol(X_raw)
if (n_experts < 2) {
  stop("专家数不足（", n_experts, " 行），CVI 至少需要 2 位专家的评分")
}
Xm <- matrix(NA_real_, n_experts, n_items)
for (j in seq_len(n_items)) {
  Xm[, j] <- suppressWarnings(as.numeric(as.character(X_raw[[j]])))
}
if (any(is.na(Xm))) {
  r_bad <- which(rowSums(is.na(Xm)) > 0)[1]
  c_bad <- which(is.na(Xm[r_bad, ]))[1]
  stop("缺少专家评分：第 ", r_bad, " 行（专家）的题项 ", items[c_bad],
       " 为空或非数值；CVI 要求每位专家对全部题项评分")
}
if (any(Xm != round(Xm))) {
  stop("评分必须为整数（发现非整数评分）")
}
if (any(Xm < 1) || any(Xm > 4)) {
  stop("评分必须落在 1-4 之间（1 不相关 ... 4 高度相关），当前范围 ",
       num(min(Xm), 2), "-", num(max(Xm), 2))
}

# I-CVI 的判定阈值随专家数变化（Lynn 1986；Polit & Beck 2006）
cvi_threshold <- function(n) {
  if (n <= 5) {
    1.00
  } else {
    if (n <= 8) {
      0.83
    } else {
      0.78
    }
  }
}
thr <- cvi_threshold(n_experts)
# A = 达到可接受一致所需的最少认同专家数
A_req <- ceiling(thr * n_experts)
# Pc = C(n, A)/2^n —— 单点二项系数，不是尾概率和
Pc <- choose(n_experts, A_req) / 2^n_experts
# 浮点比较留 1e-9 容差：阈值是"下限"，恰好等于阈值应判为达标
thr_eps <- thr - 1e-9

cat(sprintf("CVI_SPEC|%d|%d\\n", n_items, n_experts))
relevant <- as.integer(colSums(Xm >= 3))
i_cvi <- relevant / n_experts
verdict <- character(n_items)
kappa_v <- numeric(n_items)
for (j in seq_len(n_items)) {
  k_star <- (i_cvi[j] - Pc) / (1 - Pc)
  kappa_v[j] <- k_star
  verdict_j <- "需修改"
  if (k_star > 0.74) {
    verdict_j <- "优秀"
  } else {
    if (k_star >= 0.60) {
      verdict_j <- "良好"
    } else {
      if (k_star >= 0.40) {
        verdict_j <- "尚可"
      }
    }
  }
  verdict[j] <- verdict_j
  cat(sprintf("CVI_ITEM|%s|%d|%d|%s|%s|%s|%s\\n", items[j], relevant[j], n_experts,
    num(i_cvi[j]), num(k_star), num(Pc, 6), verdict_j))
}

s_cvi_ave <- mean(i_cvi)
# S-CVI/UA：全部专家均评 >= 3 的题项数 / 题项总数
n_ua <- sum(relevant == n_experts)
s_cvi_ua <- n_ua / n_items
threshold_ok <- all(i_cvi >= thr_eps)
cat(sprintf("CVI_SUMMARY|%s|%s|%d|%s\\n", num(s_cvi_ave), num(s_cvi_ua), n_ua,
  if (threshold_ok) "是" else "否"))

if (n_experts < 5) {
  cat(sprintf("CVI_NOTE|专家数偏少（%d 位），I-CVI 阈值取 1.00，结论稳定性有限，建议扩充专家组\\n", n_experts))
}
cat(sprintf("CVI_NOTE|I-CVI 阈值按专家数查表（n <= 5 取 1.00；6-8 取 0.83；>= 9 取 0.78）：本次 n = %d，阈值 %s，即至少 %d/%d 位专家评 >= 3 才算达标\\n",
  n_experts, num(thr, 2), A_req, n_experts))
if (min(Xm) >= 3) {
  cat(sprintf("CVI_NOTE|全部评分均 >= 3（评分范围受限，无 1-2 分的分歧），请复核是否真实反映专家意见\\n"))
}
cat(sprintf("CVI_NOTE|Pc 由单点二项系数 C(n, A)/2^n 计算（A = %d），修正 Kappa 判定采用 Cicchetti & Sparrow 四级口径\\n", A_req))

n_pass <- sum(i_cvi >= thr_eps)
# 结论文案必须与真实判定一致：全部题项达标但仍判"有题项未达标"会让用户
# 拿着自相矛盾的结论去写论文（实测 4/4 达标却输出"仍有题项未达标"）。
concl_txt <- "内容效度不佳，建议修订或删除未达标题项"
if (n_pass == n_items && s_cvi_ave >= 0.90 && s_cvi_ua >= 0.80) {
  concl_txt <- "内容效度良好：全部题项 I-CVI 达标，S-CVI/Ave 与 S-CVI/UA 均达到建议标准"
} else {
  if (n_pass == n_items) {
    concl_txt <- "全部题项 I-CVI 均达标，但 S-CVI/Ave 或 S-CVI/UA 未达建议标准，量表层面一致性仍需改善"
  } else {
    if (n_pass >= 1 && s_cvi_ave >= 0.80) {
      concl_txt <- "内容效度基本可接受，但仍有题项未达 I-CVI 阈值，建议修订"
    }
  }
}
cat(sprintf("CONCL|%s（I-CVI 达标 %d/%d 题；S-CVI/Ave = %s，建议 >= 0.90；S-CVI/UA = %s，建议 >= 0.80）\\n",
  concl_txt, n_pass, n_items, num(s_cvi_ave), num(s_cvi_ua)))
`
  }

  /**
   * Harman 单因子检验 —— 未旋转主成分分析，判断共同方法偏差。
   * 行格式见 V031_CONTRACT.md 第三节。
   *
   * 判据：首成分解释率 < 40% 且特征值 > 1 的成分多于 1 个 -> 未发现严重
   * 共同方法偏差。必须提示灵敏度低、只能作为初步筛查。
   */
  static harmanCode(items: string[], dataFile = 'data.csv'): string {
    const itemVec = items.map((v) => `"${rEscape(v)}"`).join(', ')
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== Harman 单因子检验 ===\\n")
items <- c(${itemVec})

missing_items <- items[!(items %in% names(data))]
if (length(missing_items) > 0) {
  stop("以下变量不存在: ", paste(missing_items, collapse = ", "))
}

X_raw <- data[, items, drop = FALSE]
ok <- complete.cases(X_raw)
X <- X_raw[ok, , drop = FALSE]
n_dropped <- sum(!ok)
n <- nrow(X)
p <- length(items)
if (p < 3) {
  stop("题项过少（", p, " 个），Harman 检验至少需要 3 个题项")
}
if (n < 30) {
  stop("有效样本不足（", n, " 行），Harman 检验至少需要 30 个完整样本")
}
for (nm in items) {
  if (!is.numeric(X[[nm]])) {
    stop("题项 ", nm, " 不是数值型，无法做 Harman 检验")
  }
}
R <- cor(X)
if (any(!is.finite(R))) {
  stop("相关矩阵含非有限值，可能存在常量题项")
}

# 未旋转主成分分析：相关矩阵的特征值（Kaiser 准则：特征值 > 1 保留）
eig <- eigen(R, symmetric = TRUE)
ev <- eig$values
if (any(ev < -1e-8)) {
  stop("相关矩阵存在显著负特征值，数据可能存在共线或重复题项，无法做 Harman 检验")
}
ev[ev < 0] <- 0
pct <- ev / p * 100

cat(sprintf("HARMAN_SPEC|%d|%d\\n", p, n))
n_gt1 <- sum(ev > 1)
cum_pct <- 0
if (n_gt1 > 0) {
  for (k in seq_len(n_gt1)) {
    cum_pct <- cum_pct + pct[k]
    cat(sprintf("HARMAN_EIGEN|%d|%s|%s|%s\\n", k, num(ev[k]), num(pct[k], 2), num(cum_pct, 2)))
  }
}
first_pct <- pct[1]
thr_pct <- 40
ok_flag <- first_pct < thr_pct && n_gt1 > 1
cat(sprintf("HARMAN_SUMMARY|%d|%s|%s|%s\\n", n_gt1, num(first_pct, 2), num(thr_pct, 2),
  if (ok_flag) "是" else "否"))

if (n_dropped > 0) {
  cat(sprintf("HARMAN_NOTE|因缺失值采用整列删除，剔除 %d 行，有效样本 %d\\n", n_dropped, n))
}
cat(sprintf("HARMAN_NOTE|方法：未旋转主成分分析（相关矩阵，按特征值 > 1 提取成分），未做任何旋转\\n"))
cat(sprintf("HARMAN_NOTE|判据：首成分解释率 < 40%% 且特征值 > 1 的成分多于 1 个，视为未发现严重共同方法偏差\\n"))
cat(sprintf("HARMAN_NOTE|Harman 单因子检验灵敏度低，只能作为初步筛查，不能证明不存在共同方法偏差\\n"))

if (ok_flag) {
  cat(sprintf("CONCL|首成分解释率 %s%%（< 40%%）且抽出 %d 个特征值 > 1 的成分，未发现严重共同方法偏差\\n",
    num(first_pct, 2), n_gt1))
} else {
  cat(sprintf("CONCL|首成分解释率 %s%%、特征值 > 1 的成分 %d 个，提示可能存在共同方法偏差，建议结合方法学设计进一步排查\\n",
    num(first_pct, 2), n_gt1))
}
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
