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
import { DEFAULT_MISSING_SENTINELS } from './dataService'
/**
 * 统一的 read.csv 头（数据由主进程以 UTF-8 写入）。
 *
 * ── v0.3.3 / D03：缺失哨兵纵深防御 ──
 *
 * 此前这里**没有 `na.strings`**：JS 侧 `dataService.normalizeMissingValuesWithReport()`
 * 确实把 `-999`/`NA` 之类归一成了缺失，所以产品路径上没有现网 bug；但一旦有人
 * 绕过 JS 层直接往 CSV 里写 `-999`（手工准备的数据、外部脚本、将来的 IPC 入口），
 * R 会把它当有效观测——实测 ANOVA F 从 67.65 变 0.52，全程 rc=0 零警告。
 *
 * 这一层是**纵深防御**：哨兵集合从 `DEFAULT_MISSING_SENTINELS` 经
 * `naStringsLiteral()` 生成，与 JS 端**同源**（单一真相，不得两处各写一份）。
 *
 * 🚫 **绝不包含 `99`/`999`**：现有判断「默认当缺失会静默污染统计量
 * （百分制 99 分、年龄 99 岁可能是有效观测）」是对的。为补 D03 而把
 * 99/999 加进默认哨兵，会引入比它更严重的新缺陷。
 *
 * ⚠️ `na.strings` 是 `read.csv` 的**只影响读取**参数：它把命中的文本单元格
 * 变成 `NA`，不会改动磁盘上的文件。因此"软件改了用户数据"的红线不被触碰。
 */
export const READ_CSV = `read.csv(dataFile, stringsAsFactors = FALSE, check.names = FALSE, fileEncoding = "UTF-8-BOM", na.strings = ${naStringsLiteral()})`

/**
 * 把缺失哨兵数组拼成 R 的 `c("NA", "N/A", ...)` 字面量。
 *
 * 为什么从 `dataService` 导入而不是在 rCommon 里再写一份数组：
 * 两处各写一份就是两个真相，迟早漂移；而漂移的后果是"JS 层归一了某种哨兵、
 * R 层没归一"——统计量里混进一个 `-999`，没有任何报错。
 *
 * 转义只需处理双引号与反斜杠（哨兵都是短 ASCII 文本），但仍按通用规则做，
 * 避免有人往数组里加 `X"Y` 这类值后生成非法 R 字面量。
 */
function naStringsLiteral(): string {
  const items = DEFAULT_MISSING_SENTINELS.map(
    (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  )
  return `c(${items.join(', ')})`
}

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

# ─────────────────────────────────────────────────────────────
# 数据质量检查（v0.3.3 / T82，对应 TECH_DEBT.md D02 与 D03）
#
# 为什么必须有：实测三组各 20 观测、只把一个单元格改成 1e6，
#   ANOVA F 从 229.13 (p=5.6e-28) 变成 0.9998 (p=0.374)，
#   Cronbach alpha 从 0.8434 变成 -0.0000，全程 rc=0、零警告。
# 数值层面完全正确，错的是"该不该这么算"——这类失败用户永远发现不了。
#
# 输出走 **stdout 的结构化行**（DQ_WARN|变量|类型|计数|详情），
# 不走 stderr 的 parseRWarnings 通道：两条通道语义不同，
# stderr 是 R 运行期警告，这里是分析前的数据体检，混在一起会让
# "哪些是数据问题、哪些是方法问题"变得无法区分。
# ─────────────────────────────────────────────────────────────

# 分位数（type-7，即 R 的默认口径，与 TS 侧 quantileType7 逐位一致）。
# 两处必须同口径：否则同一条数据在界面显示 N 个离群值、在 R 输出显示 M 个，
# 用户同时看到两个互相矛盾的"事实"。
rq_quantile <- function(x, p) {
  as.numeric(stats::quantile(x, probs = p, type = 7, names = FALSE, na.rm = TRUE))
}

# 对单个数值变量做质量体检，命中即 cat 一行 DQ_WARN。
# 判定顺序固定为 outlier / out_of_range / high_missing / constant，
# 与 TS 侧 checkDataQuality 的 KIND_ORDER 一致（便于两处输出对齐）。
r_quality_check <- function(x, name, likert_max = NA_real_) {
  x <- suppressWarnings(as.numeric(x))
  n_total <- length(x)
  if (n_total == 0) {
    return(invisible(NULL))
  }
  n_missing <- sum(is.na(x))
  v <- x[!is.na(x)]
  n <- length(v)

  # 极端值：|z| > 3 或超出 IQR 1.5 倍围栏（与 TS 侧同为并集，任一命中即报）
  if (n >= 4) {
    s <- stats::sd(v)
    if (is.finite(s) && s > 0) {
      z <- abs((v - mean(v)) / s)
      q1 <- rq_quantile(v, 0.25)
      q3 <- rq_quantile(v, 0.75)
      iqr <- q3 - q1
      if (is.finite(iqr) && iqr > 0) {
        lo <- q1 - 1.5 * iqr
        hi <- q3 + 1.5 * iqr
        hit <- (z > 3) | (v < lo) | (v > hi)
      } else {
        # IQR = 0（>=50% 观测同值，李克特数据极常见）时围栏无意义，
        # 只保留 z 规则。与 TS 侧刻意一致：此时无法区分录入错误与真实少数派。
        hit <- z > 3
      }
      n_out <- sum(hit)
      if (n_out > 0) {
        cat(sprintf("DQ_WARN|%s|outlier|%d|detected %d extreme value(s), |z| > 3 or outside IQR fence, may change significance\n",
          name, n_out, n_out))
      }
    }
  }

  # 值域越界：仅在调用方声明了量表上限时判定
  if (is.finite(likert_max) && n > 0) {
    n_bad <- sum(v < 1 | v > likert_max)
    if (n_bad > 0) {
      cat(sprintf("DQ_WARN|%s|out_of_range|%d|%d value(s) outside 1..%s, checked as Likert scale\n",
        name, n_bad, n_bad, num(likert_max, 0)))
    }
  }

  # 高缺失（> 30%）
  if (n_total > 0) {
    rate <- n_missing / n_total
    if (rate > 0.3) {
      cat(sprintf("DQ_WARN|%s|high_missing|%d|%.1f%% missing (%d/%d), listwise deletion will shrink sample\n",
        name, n_missing, rate * 100, n_missing, n_total))
    }
  }

  # 常量列（唯一值 = 1）
  if (n > 0 && length(unique(v)) == 1) {
    cat(sprintf("DQ_WARN|%s|constant|%d|only one distinct value (%s), provides no variance\n",
      name, n, num(v[1])))
  }

  invisible(NULL)
}

# 对一组变量批量体检。items 为列名向量；likert_max 可为：
#   - 单个数值（所有列共用同一量表上限），或
#   - 命名向量（按列名各取上限），或
#   - NA（不做值域检查）
r_quality_check_all <- function(data, items, likert_max = NA_real_) {
  for (nm in items) {
    if (!(nm %in% names(data))) {
      next
    }
    if (!is.numeric(data[[nm]])) {
      next
    }
    # ⚠️ 必须先判命名向量、再判单值广播。
    # 若把两个分支的顺序反过来，命名长度 1 向量（如只给 q1 设 5）会走
    # "length 1 就所有列共用" 的分支，于是取值 9..1e6 的 score 列
    # 会被误报"11 个值超出 1..5"——实测踩过。
    # 长度 1 的**命名**向量语义是"只对 q1 用 5"，不是"所有列都用 5"。
    if (length(likert_max) == 0) {
      cap <- NA_real_
    } else {
      if (!is.null(names(likert_max)) && (nm %in% names(likert_max))) {
        cap <- as.numeric(likert_max[[nm]])
      } else {
        if (length(likert_max) == 1 && is.null(names(likert_max))) {
          cap <- as.numeric(likert_max)
        } else {
          cap <- NA_real_
        }
      }
    }
    r_quality_check(data[[nm]], nm, cap)
  }
  invisible(NULL)
}
`
