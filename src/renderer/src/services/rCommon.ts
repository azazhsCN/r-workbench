/**
 * R 侧公共基础设施（v0.3.2 从 rService.ts 抽出）
 *
 * 为什么单独成文件：
 *   v0.3.2 起新增方法走 `rGenerators/<method>.ts`（见 DEVELOPMENT_PLAN.md 9.1）。
 *   这些生成器都需要 R_COMMON（fmt_p / num / JSON 序列化等）与 READ_CSV，
 *   若继续留在 rService.ts 会让它超过 2500 行且无法并行编辑。
 *
 * ⚠️ 迁移约定：本文件内容是从 rService.ts **逐字节搬移**而来，未做任何改写。
 *   `r-source-hygiene.test.ts` 会直接读本文件源码检查 R_COMMON 卫生。
 */
/** 统一的 read.csv 头（数据由主进程以 UTF-8 写入） */
export const READ_CSV =
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
export const R_COMMON = String.raw`
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
