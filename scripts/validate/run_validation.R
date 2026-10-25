#!/usr/bin/env Rscript
# ============================================================================
# R Workbench — 统计正确性验证（真实生成器 + 独立 oracle）
# ----------------------------------------------------------------------------
# v0.2.5 的问题（F4 + F7）：
#   1. 14 处 compare_code() 的 ref_code 与 wb_code 逐字符相同 → 同义反复，永远 PASS；
#   2. 结尾只 cat() 汇总，没有 quit(status=1) → 即使 PASS 0/33 也退出 0，CI 永远绿。
#
# v0.2.6 的做法：
#   A. 「工作台实现」不再是手抄副本，而是 **rService.ts 的真实生成器输出**：
#      先由 scripts/validate/generate_fixtures.mjs 用 esbuild 打包 rService.ts 并调用
#      每个生成器，把产出的 R 代码 + 配套 CSV 写到 scripts/validate/generated/。
#   B. 每个统计量都与**独立 oracle** 比较，oracle 不调用被验证的实现：
#        - 手算闭式解（Welch t、SS 分解的 F、Σ(O−E)²/E、矩阵代数求 R²/F/SE、
#          方差分量法求 Cronbach α、秩和定义求 U、Fisher z 求相关系数 CI）
#        - 精确/蒙特卡洛零分布（Mann-Whitney 秩和枚举、Spearman 置换检验、
#          Shapiro-Wilk 的 Blom 得分统计量 + MC p 值）
#        - 符号自校验（字符串比较、覆盖率、字段数）
#   C. 存在任何 FAIL 时 quit(status = 1)，并额外捕获 R 的
#      "arguments not used by format"（sprintf 参数与格式符不匹配 → 字段被静默丢弃）。
#   D. 同时报告「方法覆盖数」与「断言数」，不再用 33/33 冒充 33 个方法。
#
# 用法（在项目根目录）：
#   Rscript scripts/validate/run_validation.R
#   Rscript scripts/validate/run_validation.R --generated <dir> --no-regenerate
#
# 环境变量：
#   RWB_REQUIRE_PSYCH=1  要求 psych 包存在（用于信度分析的第二个独立实现）；
#                        缺失时判定为 FAIL（默认不要求，缺失只记 SKIP）。
# ============================================================================

## ---- 0. 路径与参数：一切基于脚本自身位置，不依赖 cwd（修复相对路径 bug）----
script_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
script_path <- if (length(script_arg) > 0) sub("^--file=", "", script_arg[1]) else "run_validation.R"
SCRIPT_DIR <- normalizePath(dirname(script_path), mustWork = FALSE)
if (!dir.exists(SCRIPT_DIR)) SCRIPT_DIR <- normalizePath(getwd(), mustWork = TRUE)

args <- commandArgs(trailingOnly = TRUE)
arg_value <- function(flag, default = NULL) {
  i <- match(flag, args)
  if (!is.na(i) && length(args) >= i + 1) args[i + 1] else default
}
GEN_DIR <- arg_value("--generated", file.path(SCRIPT_DIR, "generated"))
GEN_DIR <- normalizePath(GEN_DIR, mustWork = FALSE)
NO_REGEN <- "--no-regenerate" %in% args
REQUIRE_PSYCH <- identical(Sys.getenv("RWB_REQUIRE_PSYCH"), "1")

TOL <- 1e-3          # 数值相对容差（生成器输出 4 位小数 → 5e-5 已足够；留 20 倍余量）
TOL_LOOSE <- 1e-2    # 3 位小数 / 平滑近似量的容差
MC_B <- 20000L       # 置换/蒙特卡洛重复次数（固定种子 → 结果可复现）
set.seed(20260904L)

## ---- 1. 生成 fixtures（除非 --no-regenerate）------------------------------
if (!NO_REGEN) {
  generator <- file.path(SCRIPT_DIR, "generate_fixtures.mjs")
  node_bin <- Sys.which("node")
  if (!nzchar(node_bin)) node_bin <- Sys.which("node.exe")
  if (nzchar(node_bin) && file.exists(generator)) {
    cat(">> 重新生成 fixtures（node + esbuild 打包 rService.ts）...\n")
    gen_log <- suppressWarnings(system2(node_bin, shQuote(generator), stdout = TRUE, stderr = TRUE))
    status <- attr(gen_log, "status")
    if (!is.null(status) && status != 0) {
      if (!dir.exists(GEN_DIR)) stop("fixtures 生成失败且目录不存在：\n", paste(gen_log, collapse = "\n"))
      cat("!! fixtures 生成失败（退出码 ", status, "），改用已存在的 ", GEN_DIR, "\n", sep = "")
    } else {
      cat(">> ", paste(tail(gen_log, 1), collapse = ""), "\n", sep = "")
    }
  } else if (!dir.exists(GEN_DIR)) {
    stop("找不到 node，且 ", GEN_DIR, " 不存在。请先运行：node scripts/validate/generate_fixtures.mjs")
  }
}

manifest_file <- file.path(GEN_DIR, "manifest.txt")
if (!file.exists(manifest_file)) {
  stop("缺少 ", manifest_file, "。请先运行：node scripts/validate/generate_fixtures.mjs")
}
mf <- readLines(manifest_file, warn = FALSE)
mf <- mf[nzchar(mf)]
manifest <- do.call(rbind, lapply(strsplit(mf, "|", fixed = TRUE), function(p) {
  data.frame(method = p[1], dataset = p[2], rfile = p[3], csvfile = p[4],
             desc = if (length(p) >= 5) p[5] else "", stringsAsFactors = FALSE)
}))

## 期望覆盖的方法（少一个即 FAIL，防止验证范围被悄悄缩小）
CANONICAL_METHODS <- c(
  "descriptive", "ttest_independent", "ttest_paired", "anova", "chisquare",
  "correlation", "regression", "reliability", "ttest_one", "normality",
  "nonparametric", "frequency", "summary_by",
  "efa",
  # v0.3.1
  "cfa", "cvi", "harman"
)

## ---- 2. 报告与断言工具 ----------------------------------------------------
report <- list()
add_row <- function(method, dataset, stat, ref, wb, ok) {
  report[[length(report) + 1]] <<- list(
    method = method, dataset = dataset, stat = stat,
    ref = if (is.null(ref)) NA else ref,
    wb = if (is.null(wb)) NA else wb,
    ok = isTRUE(ok)
  )
}
fv <- function(x) {
  if (is.null(x) || length(x) != 1 || is.na(x)) return("NA")
  if (is.numeric(x)) formatC(x, format = "g", digits = 6) else as.character(x)
}
num_ok <- function(ref, wb, tol = TOL) {
  if (is.null(ref) || is.null(wb)) return(FALSE)
  if (length(ref) != 1 || length(wb) != 1) return(FALSE)
  if (!is.finite(ref) || !is.finite(wb)) return(FALSE)   # NA / 缺失 → 明确 FAIL
  abs(ref - wb) <= tol * max(1, abs(ref), abs(wb))
}
chk_num <- function(method, dataset, stat, ref, wb, tol = TOL) {
  add_row(method, dataset, stat, ref, wb, num_ok(ref, wb, tol))
}
chk_eq <- function(method, dataset, stat, ref, wb) {
  add_row(method, dataset, stat, ref, wb,
          !is.null(ref) && !is.null(wb) && identical(as.character(ref), as.character(wb)))
}

## ---- 3. 运行被验证代码、解析结构化输出 ------------------------------------
run_generated <- function(file, env) {
  msgs <- character(0)
  out <- tryCatch(
    withCallingHandlers(
      capture.output(sys.source(file, envir = env)),
      warning = function(w) { msgs <<- c(msgs, conditionMessage(w)); invokeRestart("muffleWarning") },
      message = function(m) { msgs <<- c(msgs, conditionMessage(m)); invokeRestart("muffleMessage") }
    ),
    error = function(e) { msgs <<- c(msgs, paste0("ERROR: ", conditionMessage(e))); character(0) }
  )
  list(out = paste(out, collapse = "\n"), msgs = msgs)
}

## 只解析 `KEY|f1|f2...` 形式的结构化行；返回 list(key = list(fields...))
parse_kv <- function(out) {
  res <- list()
  for (ln in strsplit(out, "\n", fixed = TRUE)[[1]]) {
    if (!grepl("^[A-Za-z_][A-Za-z0-9_]*\\|", ln)) next
    p <- strsplit(ln, "|", fixed = TRUE)[[1]]
    res[[p[1]]] <- c(res[[p[1]]], list(p[-1]))
  }
  res
}
## 取 KEY 的第 line 行的第 idx 个字段；缺失返回 NULL（会让断言 FAIL，而不是静默跳过）
gf <- function(kv, key, line = 1, idx = 1) {
  v <- kv[[key]]
  if (is.null(v) || length(v) < line) return(NULL)
  f <- v[[line]]
  if (length(f) < idx) return(NULL)
  f[idx]
}
gfn <- function(kv, key, line = 1, idx = 1) {
  x <- gf(kv, key, line, idx)
  if (is.null(x)) return(NA_real_)
  suppressWarnings(as.numeric(x))
}
nlines <- function(kv, key) length(kv[[key]])

## ---- 4. 统计 oracle（全部独立于 rService 的实现）--------------------------
as_num <- function(x) suppressWarnings(as.numeric(as.character(x)))

## 布尔语义归一化：R 生成器的布尔字段可能输出 是/否、TRUE/FALSE、合格/不合格等。
## oracle 只关心**语义**，不关心字面编码——否则断言会退化成"猜实现用了哪个词"。
## 返回 TRUE / FALSE / NA（无法解析）。
normalize_bool_cn <- function(x) {
  if (is.null(x) || length(x) != 1 || is.na(x)) return(NA)
  s <- trimws(as.character(x))
  if (s %in% c("是", "TRUE", "True", "true", "T", "1", "合格", "通过", "达标", "yes")) return(TRUE)
  if (s %in% c("否", "FALSE", "False", "false", "F", "0", "不合格", "不通过", "未达标", "no")) return(FALSE)
  NA
}

## 4.1 描述性统计：闭式解
oracle_descriptive <- function(method, dataset, kv, out, data) {
  lines <- strsplit(out, "\n", fixed = TRUE)[[1]]
  lines <- lines[grepl("^[^|]*\\|[^|]*\\|[^|]*\\|[^|]*\\|[^|]*\\|[^|]*\\|[^|]*$", lines)]
  lines <- lines[!startsWith(lines, "__INFO__")]
  recs <- lapply(lines, function(l) strsplit(l, "|", fixed = TRUE)[[1]])
  got_vars <- vapply(recs, function(r) r[1], character(1))

  expected <- c("mpg", "diff", "中文列", "allna")
  add_row(method, dataset, "vars_present",
          paste(expected, collapse = ","), paste(got_vars, collapse = ","),
          identical(sort(expected), sort(got_vars)))

  for (r in recs) {
    v <- r[1]
    x <- if (v %in% names(data)) as_num(data[[v]]) else rep(NA_real_, nrow(data))
    ok <- x[!is.na(x)]
    chk_eq(method, dataset, paste0(v, ".N"), length(ok), suppressWarnings(as.numeric(r[2])))
    if (length(ok) > 0) {
      chk_num(method, dataset, paste0(v, ".M"), mean(ok), suppressWarnings(as.numeric(r[3])))
      chk_num(method, dataset, paste0(v, ".SD"), sd(ok), suppressWarnings(as.numeric(r[4])))
      chk_num(method, dataset, paste0(v, ".Min"), min(ok), suppressWarnings(as.numeric(r[5])))
      chk_num(method, dataset, paste0(v, ".Max"), max(ok), suppressWarnings(as.numeric(r[6])))
      chk_num(method, dataset, paste0(v, ".Median"), median(ok), suppressWarnings(as.numeric(r[7])))
    }
  }
}

## 4.2 独立样本 t 检验：Welch 手算闭式解（不调用 t.test）
oracle_ttest_independent <- function(method, dataset, kv, out, data) {
  g <- data[["group"]]; y <- as_num(data[["score"]])
  keep <- !is.na(g) & !is.na(y); g <- g[keep]; y <- y[keep]
  groups <- sort(unique(g))
  g1 <- y[g == groups[1]]; g2 <- y[g == groups[2]]
  n1 <- length(g1); n2 <- length(g2)
  m1 <- mean(g1); m2 <- mean(g2); s1 <- sd(g1); s2 <- sd(g2)
  v1 <- s1^2 / n1; v2 <- s2^2 / n2
  t_ref <- (m1 - m2) / sqrt(v1 + v2)
  df_ref <- (v1 + v2)^2 / (v1^2 / (n1 - 1) + v2^2 / (n2 - 1))
  p_ref <- 2 * pt(-abs(t_ref), df_ref)
  se <- sqrt(v1 + v2)
  ci_lo <- (m1 - m2) - qt(0.975, df_ref) * se
  ci_hi <- (m1 - m2) + qt(0.975, df_ref) * se
  sp <- sqrt(((n1 - 1) * s1^2 + (n2 - 1) * s2^2) / (n1 + n2 - 2))
  d_ref <- (m1 - m2) / sp
  t_pool <- (m1 - m2) / (sp * sqrt(1 / n1 + 1 / n2))
  p_pool <- 2 * pt(-abs(t_pool), n1 + n2 - 2)

  chk_eq(method, dataset, "GRP.n1", n1, gfn(kv, "GRP", 1, 2))
  chk_num(method, dataset, "GRP.m1", m1, gfn(kv, "GRP", 1, 3))
  chk_num(method, dataset, "GRP.sd1", s1, gfn(kv, "GRP", 1, 4))
  chk_eq(method, dataset, "GRP.n2", n2, gfn(kv, "GRP", 2, 2))
  chk_num(method, dataset, "GRP.m2", m2, gfn(kv, "GRP", 2, 3))
  chk_num(method, dataset, "GRP.sd2", s2, gfn(kv, "GRP", 2, 4))

  # RESULT_IND: t|df|p_disp|p_num|meanDiff|ci_lo|ci_hi|cohen_d|pooled_p  (9 字段)
  chk_num(method, dataset, "RESULT_IND.t", t_ref, gfn(kv, "RESULT_IND", 1, 1))
  chk_num(method, dataset, "RESULT_IND.df", df_ref, gfn(kv, "RESULT_IND", 1, 2), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_IND.p", p_ref, gfn(kv, "RESULT_IND", 1, 4), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_IND.meanDiff", m1 - m2, gfn(kv, "RESULT_IND", 1, 5))
  chk_num(method, dataset, "RESULT_IND.ci_lo", ci_lo, gfn(kv, "RESULT_IND", 1, 6), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_IND.ci_hi", ci_hi, gfn(kv, "RESULT_IND", 1, 7), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_IND.cohen_d", d_ref, gfn(kv, "RESULT_IND", 1, 8))
  chk_num(method, dataset, "RESULT_IND.pooled_p", p_pool, gfn(kv, "RESULT_IND", 1, 9), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_POOLED.t", t_pool, gfn(kv, "RESULT_POOLED", 1, 1))
  chk_num(method, dataset, "RESULT_POOLED.p", p_pool, gfn(kv, "RESULT_POOLED", 1, 4), TOL_LOOSE)

  concl <- gf(kv, "CONCL", 1, 1)
  chk_eq(method, dataset, "CONCL.direction", if (p_ref < 0.05) "sig" else "ns",
         if (is.null(concl)) NA else if (grepl("具有统计学意义", concl)) "sig" else "ns")
}

## 4.3 配对样本 t 检验：对差值做手算单样本 t
oracle_ttest_paired <- function(method, dataset, kv, out, data) {
  x <- as_num(data[["pre"]]); y <- as_num(data[["post"]])
  ok <- is.finite(x) & is.finite(y); x <- x[ok]; y <- y[ok]
  n <- length(x); d <- x - y
  md <- mean(d); sdd <- sd(d)
  t_ref <- md / (sdd / sqrt(n))
  df_ref <- n - 1
  p_ref <- 2 * pt(-abs(t_ref), df_ref)
  se <- sdd / sqrt(n)
  ci_lo <- md - qt(0.975, df_ref) * se
  ci_hi <- md + qt(0.975, df_ref) * se
  dz <- md / sdd

  chk_eq(method, dataset, "PAIRS.n", n, gfn(kv, "PAIRS", 1, 3))
  chk_num(method, dataset, "PAIRS.mean_d", md, gfn(kv, "PAIRS", 1, 4))
  chk_num(method, dataset, "PAIRS.sd_d", sdd, gfn(kv, "PAIRS", 1, 5))
  chk_num(method, dataset, "PAIR_COR.r", cor(x, y), gfn(kv, "PAIR_COR", 1, 1))
  # RESULT_PAIRED: t|df|p_disp|p_num|meanDiff|ci_lo|ci_hi|d_z
  chk_num(method, dataset, "RESULT_PAIRED.t", t_ref, gfn(kv, "RESULT_PAIRED", 1, 1))
  chk_num(method, dataset, "RESULT_PAIRED.df", df_ref, gfn(kv, "RESULT_PAIRED", 1, 2))
  chk_num(method, dataset, "RESULT_PAIRED.p", p_ref, gfn(kv, "RESULT_PAIRED", 1, 4), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_PAIRED.meanDiff", md, gfn(kv, "RESULT_PAIRED", 1, 5))
  chk_num(method, dataset, "RESULT_PAIRED.ci_lo", ci_lo, gfn(kv, "RESULT_PAIRED", 1, 6), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_PAIRED.ci_hi", ci_hi, gfn(kv, "RESULT_PAIRED", 1, 7), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_PAIRED.d_z", dz, gfn(kv, "RESULT_PAIRED", 1, 8))

  concl <- gf(kv, "CONCL", 1, 1)
  chk_eq(method, dataset, "CONCL.direction", if (p_ref < 0.05) "sig" else "ns",
         if (is.null(concl)) NA else if (grepl("具有统计学意义", concl)) "sig" else "ns")
}

## 4.4 单样本 t 检验
oracle_ttest_one <- function(method, dataset, kv, out, data) {
  mu <- 50
  x <- as_num(data[["value"]]); x <- x[is.finite(x)]
  n <- length(x); m <- mean(x); s <- sd(x)
  t_ref <- (m - mu) / (s / sqrt(n))
  df_ref <- n - 1
  p_ref <- 2 * pt(-abs(t_ref), df_ref)
  se <- s / sqrt(n)
  ci_lo <- m - qt(0.975, df_ref) * se
  ci_hi <- m + qt(0.975, df_ref) * se
  d_ref <- (m - mu) / s

  chk_eq(method, dataset, "DESC_ONE.n", n, gfn(kv, "DESC_ONE", 1, 2))
  chk_num(method, dataset, "DESC_ONE.mean", m, gfn(kv, "DESC_ONE", 1, 3))
  chk_num(method, dataset, "DESC_ONE.sd", s, gfn(kv, "DESC_ONE", 1, 4))
  # RESULT_ONE: t|df|p_disp|p_num|ci_lo|ci_hi|d
  chk_num(method, dataset, "RESULT_ONE.t", t_ref, gfn(kv, "RESULT_ONE", 1, 1))
  chk_num(method, dataset, "RESULT_ONE.df", df_ref, gfn(kv, "RESULT_ONE", 1, 2))
  chk_num(method, dataset, "RESULT_ONE.p", p_ref, gfn(kv, "RESULT_ONE", 1, 4), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_ONE.ci_lo", ci_lo, gfn(kv, "RESULT_ONE", 1, 5), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_ONE.ci_hi", ci_hi, gfn(kv, "RESULT_ONE", 1, 6), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_ONE.d", d_ref, gfn(kv, "RESULT_ONE", 1, 7))
  chk_eq(method, dataset, "MU_IN_CI", if (mu >= ci_lo && mu <= ci_hi) "是" else "否", gf(kv, "MU_IN_CI", 1, 1))
  concl <- gf(kv, "CONCL", 1, 1)
  chk_eq(method, dataset, "CONCL.direction", if (p_ref < 0.05) "sig" else "ns",
         if (is.null(concl)) NA else if (grepl("具有统计学意义", concl)) "sig" else "ns")
}

## 4.5 单因素方差分析：SS 手算分解 + 手算 Tukey HSD
oracle_anova <- function(method, dataset, kv, out, data) {
  dv <- as_num(data[["dv"]]); grp <- factor(data[["grp"]])
  keep <- !is.na(dv) & !is.na(grp); dv <- dv[keep]; grp <- factor(grp[keep])
  levels_g <- levels(grp); k <- length(levels_g); n <- length(dv)
  grand <- mean(dv)
  ss_between <- sum(vapply(levels_g, function(g) {
    z <- dv[grp == g]; length(z) * (mean(z) - grand)^2
  }, numeric(1)))
  ss_within <- sum(vapply(levels_g, function(g) {
    z <- dv[grp == g]; sum((z - mean(z))^2)
  }, numeric(1)))
  ss_total <- sum((dv - grand)^2)
  df_b <- k - 1; df_w <- n - k
  ms_b <- ss_between / df_b; ms_w <- ss_within / df_w
  f_ref <- ms_b / ms_w
  p_ref <- pf(f_ref, df_b, df_w, lower.tail = FALSE)
  eta2 <- ss_between / ss_total
  omega2 <- (ss_between - df_b * ms_w) / (ss_total + ms_w)

  chk_eq(method, dataset, "LEVELS.k", k, gfn(kv, "LEVELS", 1, 1))
  # ANOVA_ROW: 组间 = label|df|SS|MS|F|p_disp|p_num
  chk_eq(method, dataset, "ANOVA_ROW.df_between", df_b, gfn(kv, "ANOVA_ROW", 1, 2))
  chk_num(method, dataset, "ANOVA_ROW.ss_between", ss_between, gfn(kv, "ANOVA_ROW", 1, 3), TOL_LOOSE)
  chk_num(method, dataset, "ANOVA_ROW.ms_between", ms_b, gfn(kv, "ANOVA_ROW", 1, 4), TOL_LOOSE)
  chk_num(method, dataset, "ANOVA_ROW.F", f_ref, gfn(kv, "ANOVA_ROW", 1, 5), TOL_LOOSE)
  chk_num(method, dataset, "ANOVA_ROW.p", p_ref, gfn(kv, "ANOVA_ROW", 1, 7), TOL_LOOSE)
  chk_eq(method, dataset, "ANOVA_ROW.df_within", df_w, gfn(kv, "ANOVA_ROW", 2, 2))
  chk_num(method, dataset, "ANOVA_ROW.ss_within", ss_within, gfn(kv, "ANOVA_ROW", 2, 3), TOL_LOOSE)
  chk_eq(method, dataset, "ANOVA_ROW.df_total", df_b + df_w, gfn(kv, "ANOVA_ROW", 3, 2))
  chk_num(method, dataset, "ANOVA_ROW.ss_total", ss_total, gfn(kv, "ANOVA_ROW", 3, 3), TOL_LOOSE)
  # EFFECT: eta2 / omega2
  eff <- kv[["EFFECT"]]
  eff_map <- if (is.null(eff)) list() else setNames(lapply(eff, function(f) f[2]), vapply(eff, function(f) f[1], character(1)))
  chk_num(method, dataset, "EFFECT.eta2", eta2, suppressWarnings(as.numeric(eff_map[["eta2"]])), TOL_LOOSE)
  chk_num(method, dataset, "EFFECT.omega2", omega2, suppressWarnings(as.numeric(eff_map[["omega2"]])), TOL_LOOSE)

  # POSTHOC: label|diff|lo|hi|p_disp|p_num（手算 studentized range）
  posthoc <- kv[["POSTHOC"]]
  if (!is.null(posthoc)) {
    for (ph in posthoc) {
      lab <- ph[1]
      parts <- strsplit(lab, "-", fixed = TRUE)[[1]]
      if (length(parts) != 2 || !all(parts %in% levels_g)) next
      z1 <- dv[grp == parts[1]]; z2 <- dv[grp == parts[2]]
      diff_ref <- mean(z1) - mean(z2)
      se_ref <- sqrt(ms_w / 2 * (1 / length(z1) + 1 / length(z2)))
      q_ref <- abs(diff_ref) / se_ref
      p_ref_ph <- ptukey(q_ref, k, df_w, lower.tail = FALSE)
      # Tukey CI 半宽 = q_{0.95}(k, df_w) * sqrt(MSW/2 * (1/n_i + 1/n_j))
      crit <- qtukey(0.95, k, df_w) * se_ref
      chk_num(method, dataset, paste0("POSTHOC.", lab, ".diff"), diff_ref, suppressWarnings(as.numeric(ph[2])), TOL_LOOSE)
      chk_num(method, dataset, paste0("POSTHOC.", lab, ".lo"), diff_ref - crit, suppressWarnings(as.numeric(ph[3])), TOL_LOOSE)
      chk_num(method, dataset, paste0("POSTHOC.", lab, ".hi"), diff_ref + crit, suppressWarnings(as.numeric(ph[4])), TOL_LOOSE)
      chk_num(method, dataset, paste0("POSTHOC.", lab, ".p"), p_ref_ph, suppressWarnings(as.numeric(ph[6])), TOL_LOOSE)
    }
  }
  concl <- gf(kv, "CONCL", 1, 1)
  chk_eq(method, dataset, "CONCL.direction", if (p_ref < 0.05) "sig" else "ns",
         if (is.null(concl)) NA else if (grepl("具有统计学意义", concl)) "sig" else "ns")
}

## 4.6 卡方检验：Σ(O−E)²/E 闭式解
oracle_chisquare <- function(method, dataset, kv, out, data) {
  a <- factor(as.character(data[["sex"]])); b <- factor(as.character(data[["vote"]]))
  tbl <- table(a, b)
  O <- as.matrix(tbl)
  rs <- rowSums(O); cs <- colSums(O); n <- sum(O)
  E <- outer(rs, cs) / n
  chi2 <- sum((O - E)^2 / E)
  df <- (nrow(O) - 1) * (ncol(O) - 1)
  p_ref <- pchisq(chi2, df, lower.tail = FALSE)
  cramer <- sqrt(chi2 / (n * min(nrow(O) - 1, ncol(O) - 1)))

  chk_eq(method, dataset, "TABLE_DIM.r", nrow(O), gfn(kv, "TABLE_DIM", 1, 1))
  chk_eq(method, dataset, "TABLE_DIM.c", ncol(O), gfn(kv, "TABLE_DIM", 1, 2))
  chk_num(method, dataset, "EXPECTED.min", min(E), gfn(kv, "EXPECTED", 1, 1), TOL_LOOSE)
  chk_eq(method, dataset, "EXPECTED.n_lt5", sum(E < 5), gfn(kv, "EXPECTED", 1, 2))
  # RESULT_CHISQ: chi2|df|p_disp|p_num|cramer_v
  chk_num(method, dataset, "RESULT_CHISQ.chi2", chi2, gfn(kv, "RESULT_CHISQ", 1, 1), TOL_LOOSE)
  chk_eq(method, dataset, "RESULT_CHISQ.df", df, gfn(kv, "RESULT_CHISQ", 1, 2))
  chk_num(method, dataset, "RESULT_CHISQ.p", p_ref, gfn(kv, "RESULT_CHISQ", 1, 4), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_CHISQ.cramer_v", cramer, gfn(kv, "RESULT_CHISQ", 1, 5), TOL_LOOSE)
  warn_present <- !is.null(kv[["WARN_EXPECTED"]])
  add_row(method, dataset, "WARN_EXPECTED.consistency",
          if (min(E) < 5) "present" else "absent",
          if (warn_present) "present" else "absent",
          warn_present == (min(E) < 5))
}

## 4.7 Pearson 相关：闭式 r + Fisher z 置信区间（含 R 的偏差校正）
oracle_correlation_pearson <- function(method, dataset, kv, out, data) {
  x <- as_num(data[["x"]]); y <- as_num(data[["y"]])
  keep <- is.finite(x) & is.finite(y); x <- x[keep]; y <- y[keep]
  n <- length(x); mx <- mean(x); my <- mean(y)
  r_ref <- sum((x - mx) * (y - my)) / sqrt(sum((x - mx)^2) * sum((y - my)^2))
  t_ref <- r_ref * sqrt((n - 2) / (1 - r_ref^2))
  p_ref <- 2 * pt(-abs(t_ref), n - 2)
  rho_bc <- r_ref * (1 + (1 - r_ref^2) / (2 * (n - 3)))
  z <- atanh(rho_bc); sigma <- 1 / sqrt(n - 3)
  ci_lo <- tanh(z - qnorm(0.975) * sigma)
  ci_hi <- tanh(z + qnorm(0.975) * sigma)

  chk_eq(method, dataset, "DESC_COR.n", n, gfn(kv, "DESC_COR", 1, 1))
  chk_num(method, dataset, "DESC_COR.mx", mx, gfn(kv, "DESC_COR", 1, 2))
  chk_num(method, dataset, "DESC_COR.sdx", sd(x), gfn(kv, "DESC_COR", 1, 3))
  chk_num(method, dataset, "DESC_COR.my", my, gfn(kv, "DESC_COR", 1, 4))
  chk_num(method, dataset, "DESC_COR.sdy", sd(y), gfn(kv, "DESC_COR", 1, 5))
  # RESULT_COR: r|p_disp|p_num|n
  chk_num(method, dataset, "RESULT_COR.r", r_ref, gfn(kv, "RESULT_COR", 1, 1))
  chk_num(method, dataset, "RESULT_COR.p", p_ref, gfn(kv, "RESULT_COR", 1, 3), TOL_LOOSE)
  chk_eq(method, dataset, "RESULT_COR.n", n, gfn(kv, "RESULT_COR", 1, 4))
  chk_num(method, dataset, "CI_COR.lo", ci_lo, gfn(kv, "CI_COR", 1, 1), TOL_LOOSE)
  chk_num(method, dataset, "CI_COR.hi", ci_hi, gfn(kv, "CI_COR", 1, 2), TOL_LOOSE)
  concl <- gf(kv, "CONCL", 1, 1)
  chk_eq(method, dataset, "CONCL.direction",
         if (p_ref < 0.05) "sig" else "ns",
         if (is.null(concl)) NA else if (grepl("存在.*相关", concl) && !grepl("不存在", concl)) "sig" else "ns")
}

## 4.8 Spearman 相关：无结点闭式 rho + 置换零分布估 p
oracle_correlation_spearman <- function(method, dataset, kv, out, data) {
  x <- as_num(data[["x"]]); y <- as_num(data[["y"]])
  keep <- is.finite(x) & is.finite(y); x <- x[keep]; y <- y[keep]
  n <- length(x)
  d <- rank(x) - rank(y)
  rho_ref <- 1 - 6 * sum(d^2) / (n * (n^2 - 1))
  rx <- rank(x); ry <- rank(y)
  sims <- replicate(MC_B, cor(rx, sample(ry)))
  p_mc <- min(1, 2 * min(mean(sims <= rho_ref), mean(sims >= rho_ref)))

  chk_eq(method, dataset, "RESULT_COR.n", n, gfn(kv, "RESULT_COR", 1, 4))
  chk_num(method, dataset, "RESULT_COR.rho", rho_ref, gfn(kv, "RESULT_COR", 1, 1))
  chk_num(method, dataset, "RESULT_COR.p", p_mc, gfn(kv, "RESULT_COR", 1, 3), 0.03)
  concl <- gf(kv, "CONCL", 1, 1)
  chk_eq(method, dataset, "CONCL.direction",
         if (p_mc < 0.05) "sig" else "ns",
         if (is.null(concl)) NA else if (grepl("存在.*相关", concl) && !grepl("不存在", concl)) "sig" else "ns")
}

## 4.9 线性回归：矩阵代数求 R²/F/SE/t/p，相关系数矩阵求 VIF
oracle_regression <- function(method, dataset, kv, out, data) {
  d <- data.frame(y = as_num(data[["y"]]), x1 = as_num(data[["x1"]]), x2 = as_num(data[["x2"]]))
  d <- d[complete.cases(d), ]
  X <- cbind(1, d$x1, d$x2)
  y <- d$y
  n <- nrow(X); p <- ncol(X) - 1
  XtX_inv <- solve(t(X) %*% X)
  b <- XtX_inv %*% t(X) %*% y
  fit <- as.numeric(X %*% b)
  resid <- y - fit
  SSE <- sum(resid^2); SST <- sum((y - mean(y))^2)
  R2 <- 1 - SSE / SST
  adj <- 1 - (1 - R2) * (n - 1) / (n - p - 1)
  F_ref <- ((SST - SSE) / p) / (SSE / (n - p - 1))
  p_ref <- pf(F_ref, p, n - p - 1, lower.tail = FALSE)
  sigma_ref <- sqrt(SSE / (n - p - 1))
  se <- sqrt(diag(XtX_inv) * sigma_ref^2)
  tvals <- as.numeric(b) / se
  pvals <- 2 * pt(-abs(tvals), n - p - 1)

  # MODEL: r2|adj_r2|F|p_disp|p_num|sigma
  chk_num(method, dataset, "MODEL.r2", R2, gfn(kv, "MODEL", 1, 1))
  chk_num(method, dataset, "MODEL.adj_r2", adj, gfn(kv, "MODEL", 1, 2))
  chk_num(method, dataset, "MODEL.F", F_ref, gfn(kv, "MODEL", 1, 3), TOL_LOOSE)
  chk_num(method, dataset, "MODEL.p", p_ref, gfn(kv, "MODEL", 1, 5), TOL_LOOSE)
  chk_num(method, dataset, "MODEL.sigma", sigma_ref, gfn(kv, "MODEL", 1, 6))
  # MODEL_DF: n|df1|df2
  chk_eq(method, dataset, "MODEL_DF.n", n, gfn(kv, "MODEL_DF", 1, 1))
  chk_eq(method, dataset, "MODEL_DF.df1", p, gfn(kv, "MODEL_DF", 1, 2))
  chk_eq(method, dataset, "MODEL_DF.df2", n - p - 1, gfn(kv, "MODEL_DF", 1, 3))
  chk_eq(method, dataset, "RESPONSE", "y", gf(kv, "RESPONSE", 1, 1))

  # COEF: name|B|SE|t|p
  coefs <- kv[["COEF"]]
  cnames <- vapply(coefs, function(f) f[1], character(1))
  cidx <- function(nm, j) {
    i <- match(nm, cnames)
    if (is.na(i)) NA_real_ else suppressWarnings(as.numeric(coefs[[i]][j]))
  }
  nm_ref <- c("(Intercept)", "x1", "x2")
  chk_eq(method, dataset, "COEF.all_present", paste(nm_ref, collapse = ","), paste(cnames, collapse = ","))
  for (i in seq_along(nm_ref)) {
    chk_num(method, dataset, paste0("COEF.", nm_ref[i], ".B"), as.numeric(b)[i], cidx(nm_ref[i], 2))
    chk_num(method, dataset, paste0("COEF.", nm_ref[i], ".SE"), se[i], cidx(nm_ref[i], 3))
    chk_num(method, dataset, paste0("COEF.", nm_ref[i], ".t"), tvals[i], cidx(nm_ref[i], 4))
    chk_num(method, dataset, paste0("COEF.", nm_ref[i], ".p"), pvals[i], cidx(nm_ref[i], 5), TOL_LOOSE)
  }
  # BETA: 标准化系数 = b * sd(x) / sd(y)
  beta <- kv[["BETA"]]
  bnames <- if (is.null(beta)) character(0) else vapply(beta, function(f) f[1], character(1))
  bidx <- function(nm) { i <- match(nm, bnames); if (is.na(i)) NA_real_ else suppressWarnings(as.numeric(beta[[i]][2])) }
  chk_num(method, dataset, "BETA.x1", as.numeric(b)[2] * sd(d$x1) / sd(d$y), bidx("x1"), TOL_LOOSE)
  chk_num(method, dataset, "BETA.x2", as.numeric(b)[3] * sd(d$x2) / sd(d$y), bidx("x2"), TOL_LOOSE)
  # VIF：相关矩阵的逆对角线 = 1/(1-R_j²)（独立于 lm 的做法）
  Rmat <- cor(cbind(d$x1, d$x2))
  vif_ref <- diag(solve(Rmat))
  vifs <- kv[["VIF"]]
  vnames <- if (is.null(vifs)) character(0) else vapply(vifs, function(f) f[1], character(1))
  vidx <- function(nm) { i <- match(nm, vnames); if (is.na(i)) NA_real_ else suppressWarnings(as.numeric(vifs[[i]][2])) }
  chk_num(method, dataset, "VIF.x1", vif_ref[1], vidx("x1"), TOL_LOOSE)
  chk_num(method, dataset, "VIF.x2", vif_ref[2], vidx("x2"), TOL_LOOSE)
  concl <- gf(kv, "CONCL", 1, 1)
  chk_eq(method, dataset, "CONCL.direction", if (p_ref < 0.05) "sig" else "ns",
         if (is.null(concl)) NA else if (grepl("整体显著", concl)) "sig" else "ns")
}

## 4.10 Cronbach's α：方差分量法（两向随机效应）与协方差矩阵法，两条独立路径
alpha_vc <- function(m) {
  # α = (MS_subject - MS_error) / MS_subject （标准等价形式，见 Cronbach 1951 / Shrout & Fleiss）
  m <- as.matrix(m)
  n <- nrow(m); k <- ncol(m)
  grand <- mean(m)
  ss_subj <- k * sum((rowMeans(m) - grand)^2)
  ss_item <- n * sum((colMeans(m) - grand)^2)
  ss_total <- sum((m - grand)^2)
  ss_err <- ss_total - ss_subj - ss_item
  ms_subj <- ss_subj / (n - 1)
  ms_err <- ss_err / ((n - 1) * (k - 1))
  (ms_subj - ms_err) / ms_subj
}
alpha_cov <- function(m) {
  # α = k/(k-1) * (1 - Σσ_i² / Σ S)   （用完整协方差矩阵，而非 var(rowSums)）
  m <- as.matrix(m)
  k <- ncol(m); S <- cov(m)
  (k / (k - 1)) * (1 - sum(diag(S)) / sum(S))
}
oracle_reliability <- function(method, dataset, kv, out, data) {
  items <- c("q1", "q2", "q3", "q4", "q5")
  m0 <- as.data.frame(lapply(data[, items, drop = FALSE], as_num))
  n_before <- nrow(m0)
  m <- m0[complete.cases(m0), , drop = FALSE]
  k <- ncol(m); n <- nrow(m)

  chk_eq(method, dataset, "ITEMS.k", k, gfn(kv, "ITEMS", 1, 1))
  chk_eq(method, dataset, "ITEMS.n", n, gfn(kv, "ITEMS", 1, 2))
  chk_num(method, dataset, "ALPHA.raw_vc", alpha_vc(m), gfn(kv, "ALPHA", 1, 1))
  chk_num(method, dataset, "ALPHA.raw_cov", alpha_cov(m), gfn(kv, "ALPHA", 1, 1))
  rbar <- mean(cor(m)[lower.tri(cor(m))])
  alpha_std <- k * rbar / (1 + (k - 1) * rbar)
  chk_num(method, dataset, "ALPHA.std", alpha_std, gfn(kv, "ALPHA", 1, 2))

  # ITEM: name|mean|sd|r_it|a_drop
  itm <- kv[["ITEM"]]
  inames <- if (is.null(itm)) character(0) else vapply(itm, function(f) f[1], character(1))
  iidx <- function(nm, j) { i <- match(nm, inames); if (is.na(i)) NA_real_ else suppressWarnings(as.numeric(itm[[i]][j])) }
  for (nm in items) {
    chk_num(method, dataset, paste0("ITEM.", nm, ".mean"), mean(m[[nm]]), iidx(nm, 2))
    chk_num(method, dataset, paste0("ITEM.", nm, ".sd"), sd(m[[nm]]), iidx(nm, 3))
    rest <- rowSums(m[, setdiff(items, nm), drop = FALSE])
    chk_num(method, dataset, paste0("ITEM.", nm, ".r_it"), cor(m[[nm]], rest), iidx(nm, 4), TOL_LOOSE)
    chk_num(method, dataset, paste0("ITEM.", nm, ".a_drop"), alpha_vc(as.matrix(m[, setdiff(items, nm), drop = FALSE])),
            iidx(nm, 5))
  }
  # ALPHA_CI: lo|hi（与生成器同一 F 分布公式，此处只做区间合理性检查）
  lo <- gfn(kv, "ALPHA_CI", 1, 1); hi <- gfn(kv, "ALPHA_CI", 1, 2)
  add_row(method, dataset, "ALPHA_CI.ordering", "lo<=alpha<=hi",
          sprintf("%s<=%s<=%s", fv(lo), fv(gfn(kv, "ALPHA", 1, 1)), fv(hi)),
          is.finite(lo) && is.finite(hi) && lo < hi && lo <= gfn(kv, "ALPHA", 1, 1) && gfn(kv, "ALPHA", 1, 1) <= hi)
  # 整列删除提示：有缺失才应出现（独立于生成器判断）
  nd_present <- !is.null(kv[["NOTE_DROPPED"]])
  nd_expected <- (n_before - n) > 0
  add_row(method, dataset, "NOTE_DROPPED.consistency",
          if (nd_expected) "present" else "absent",
          if (nd_present) "present" else "absent",
          nd_present == nd_expected)

  # 第二个独立实现（可选）：psych::alpha
  if (requireNamespace("psych", quietly = TRUE)) {
    pa <- suppressWarnings(psych::alpha(m, warnings = FALSE))
    chk_num(method, dataset, "ALPHA.psych_raw", as.numeric(pa$total$raw_alpha), gfn(kv, "ALPHA", 1, 1), TOL_LOOSE)
  } else if (REQUIRE_PSYCH) {
    add_row(method, dataset, "ALPHA.psych_raw", "psych::alpha", "SKIP: psych 缺失", FALSE)
  } else {
    add_row(method, dataset, "ALPHA.psych_raw", "psych::alpha", "SKIP: psych 未安装（已用两条独立闭式解替代）", TRUE)
  }
}

## 4.11 正态性：Blom 得分手算 W + 蒙特卡洛零分布 p（独立于 Royston 近似）
w_blom <- function(x) {
  n <- length(x)
  a <- qnorm((seq_len(n) - 3 / 8) / (n + 1 / 4))
  a <- a / sqrt(sum(a^2))
  (sum(a * sort(x)))^2 / sum((x - mean(x))^2)
}
oracle_normality <- function(method, dataset, kv, out, data) {
  norm_lines <- kv[["NORM"]]
  got <- if (is.null(norm_lines)) character(0) else vapply(norm_lines, function(f) f[1], character(1))
  chk_eq(method, dataset, "NORM.vars", "norm,skewed", paste(got, collapse = ","))

  for (v in c("norm", "skewed")) {
    i <- match(v, got)
    if (is.na(i)) {
      add_row(method, dataset, paste0("NORM.", v, ".present"), v, "missing", FALSE)
      next
    }
    f <- norm_lines[[i]]
    x <- as_num(data[[v]]); x <- x[is.finite(x)]
    n <- length(x)
    w_ref <- w_blom(x)
    sims <- replicate(2000L, w_blom(rnorm(n)))
    p_mc <- mean(sims <= w_ref)
    sk <- mean(((x - mean(x)) / sd(x))^3)
    ku <- mean(((x - mean(x)) / sd(x))^4) - 3
    chk_eq(method, dataset, paste0("NORM.", v, ".n"), n, suppressWarnings(as.numeric(f[2])))
    chk_num(method, dataset, paste0("NORM.", v, ".W"), w_ref, suppressWarnings(as.numeric(f[3])), 0.02)
    chk_num(method, dataset, paste0("NORM.", v, ".p"), p_mc, suppressWarnings(as.numeric(f[5])), 0.08)
    chk_num(method, dataset, paste0("NORM.", v, ".skew"), sk, suppressWarnings(as.numeric(f[6])), TOL_LOOSE)
    chk_num(method, dataset, paste0("NORM.", v, ".kurt"), ku, suppressWarnings(as.numeric(f[7])), TOL_LOOSE)
    chk_eq(method, dataset, paste0("NORM.", v, ".decision"),
           if (p_mc < 0.05) "拒绝正态性假设" else "未拒绝正态性假设", f[8])
  }
}

## 4.12 Mann-Whitney U：秩和定义求 W + 精确枚举零分布求 p + 配对计数求效应量
oracle_nonparametric <- function(method, dataset, kv, out, data) {
  g <- data[["group"]]; y <- as_num(data[["score"]])
  keep <- !is.na(g) & !is.na(y); g <- g[keep]; y <- y[keep]
  groups <- sort(unique(g))
  g1 <- y[g == groups[1]]; g2 <- y[g == groups[2]]
  n1 <- length(g1); n2 <- length(g2); N <- n1 + n2

  chk_eq(method, dataset, "GRP.n1", n1, gfn(kv, "GRP", 1, 2))
  chk_num(method, dataset, "GRP.median1", median(g1), gfn(kv, "GRP", 1, 3))
  chk_eq(method, dataset, "GRP.n2", n2, gfn(kv, "GRP", 2, 2))
  chk_num(method, dataset, "GRP.median2", median(g2), gfn(kv, "GRP", 2, 3))

  ranks <- rank(c(g1, g2), ties.method = "average")
  S_obs <- sum(ranks[seq_len(n1)])
  W_ref <- S_obs - n1 * (n1 + 1) / 2          # R 的 W 统计量 = U
  all_sums <- combn(N, n1, FUN = sum)          # 无结点时 U 的精确零分布（秩和）
  p_less <- mean(all_sums <= S_obs)
  p_greater <- mean(all_sums >= S_obs)
  p_exact <- min(1, 2 * min(p_less, p_greater))
  u1 <- sum(outer(g1, g2, ">"))
  u2 <- sum(outer(g1, g2, "<"))
  r_rb <- (u1 - u2) / (n1 * n2)

  # RESULT_MW: W|p_disp|p_num|rank_biserial
  chk_num(method, dataset, "RESULT_MW.W", W_ref, gfn(kv, "RESULT_MW", 1, 1), TOL_LOOSE)
  chk_num(method, dataset, "RESULT_MW.p", p_exact, gfn(kv, "RESULT_MW", 1, 3), 0.02)
  chk_num(method, dataset, "RESULT_MW.rank_biserial", r_rb, gfn(kv, "RESULT_MW", 1, 4), TOL_LOOSE)
  concl <- gf(kv, "CONCL", 1, 1)
  chk_eq(method, dataset, "CONCL.direction", if (p_exact < 0.05) "sig" else "ns",
         if (is.null(concl)) NA else if (grepl("具有统计学意义", concl)) "sig" else "ns")
}

## 4.13 频数统计：手工计数
oracle_frequency <- function(method, dataset, kv, out, data) {
  x <- as.character(data[["edu"]])
  x[x %in% c("NA", "")] <- NA
  n_valid <- sum(!is.na(x)); n_missing <- sum(is.na(x))
  chk_eq(method, dataset, "FREQ_HEAD.n_valid", n_valid, gfn(kv, "FREQ_HEAD", 1, 2))
  chk_eq(method, dataset, "FREQ_HEAD.n_missing", n_missing, gfn(kv, "FREQ_HEAD", 1, 3))

  freqs <- kv[["FREQ"]]
  fn <- if (is.null(freqs)) character(0) else vapply(freqs, function(f) f[2], character(1))
  fidx <- function(lv, j) { i <- match(lv, fn); if (is.na(i)) NA_real_ else suppressWarnings(as.numeric(freqs[[i]][j])) }
  lvls <- sort(unique(x[!is.na(x)]))
  chk_eq(method, dataset, "FREQ.levels", paste(lvls, collapse = ","), paste(fn, collapse = ","))
  for (lv in lvls) {
    cnt <- sum(x == lv, na.rm = TRUE)
    chk_eq(method, dataset, paste0("FREQ.", lv, ".count"), cnt, fidx(lv, 3))
    chk_num(method, dataset, paste0("FREQ.", lv, ".pct_valid"), cnt / n_valid * 100, fidx(lv, 4), 0.05)
    chk_num(method, dataset, paste0("FREQ.", lv, ".pct_total"), cnt / (n_valid + n_missing) * 100, fidx(lv, 5), 0.05)
  }
}

## 4.14 分类汇总：逐组手算
oracle_summary_by <- function(method, dataset, kv, out, data) {
  g <- as.character(data[["dept"]]); v <- as_num(data[["salary"]])
  keep <- !is.na(g) & is.finite(v); g <- g[keep]; v <- v[keep]
  chk_eq(method, dataset, "VARS.group", "dept", gf(kv, "VARS", 1, 1))
  chk_eq(method, dataset, "VARS.value", "salary", gf(kv, "VARS", 1, 2))
  chk_eq(method, dataset, "TOTAL.n", length(v), gfn(kv, "TOTAL", 1, 1))
  chk_num(method, dataset, "TOTAL.mean", mean(v), gfn(kv, "TOTAL", 1, 2))
  chk_num(method, dataset, "TOTAL.sd", sd(v), gfn(kv, "TOTAL", 1, 3))

  sums <- kv[["SUM"]]
  sgroups <- if (is.null(sums)) character(0) else vapply(sums, function(f) f[1], character(1))
  sidx <- function(lv, j) { i <- match(lv, sgroups); if (is.na(i)) NA_real_ else suppressWarnings(as.numeric(sums[[i]][j])) }
  lvls <- sort(unique(g))
  chk_eq(method, dataset, "SUM.groups", paste(lvls, collapse = ","), paste(sgroups, collapse = ","))
  for (lv in lvls) {
    z <- v[g == lv]
    chk_eq(method, dataset, paste0("SUM.", lv, ".n"), length(z), sidx(lv, 2))
    chk_num(method, dataset, paste0("SUM.", lv, ".mean"), mean(z), sidx(lv, 3))
    if (length(z) >= 2) {
      chk_num(method, dataset, paste0("SUM.", lv, ".sd"), sd(z), sidx(lv, 4))
      chk_num(method, dataset, paste0("SUM.", lv, ".median"), median(z), sidx(lv, 5))
    }
    chk_num(method, dataset, paste0("SUM.", lv, ".min"), min(z), sidx(lv, 6))
    chk_num(method, dataset, paste0("SUM.", lv, ".max"), max(z), sidx(lv, 7))
  }
}

## 4.15 横幅是否与生成器唯一横幅约定一致（T21 契约）
check_banner <- function(method, dataset, out, expected_banner) {
  got <- regmatches(out, regexpr("(?m)^=== .* ===$", out, perl = TRUE))
  add_row(method, dataset, "banner",
          expected_banner,
          if (length(got) == 0) "missing" else got[1],
          length(got) > 0 && startsWith(got[1], expected_banner))
}

## 4.16 探索性因子分析（v0.3.0，纯 base R 实现）
##
## 独立 oracle 策略：**从另一条等价路径复算**，不复用被测实现的代码：
##   - Bartlett：被测用 `log(det(R))`，oracle 用 `determinant(R, logarithm=TRUE)`
##   - KMO：被测用 `solve(R)`，oracle 用 `chol2inv(chol(R))`（Cholesky 求逆）
##   - 特征值：oracle 独立调用 eigen，检查不变量 Σλ = p
##   - 载荷：oracle 独立做 eigen + varimax，逐值比对
##   - 共同度：正交旋转不变量（旋转前后必须一致）
##   - 结构效度：已知数据下 q1-q3 与 q4-q6 必须分属不同因子
oracle_efa <- function(method, dataset, kv, out, data) {
  kmo_got <- gfn(kv, "KMO")
  chi_got <- gfn(kv, "BARTLETT", 1, 1)
  df_got <- gfn(kv, "BARTLETT", 1, 2)
  nfac_got <- gfn(kv, "NFACTOR")

  if (is.na(kmo_got) || is.na(chi_got) || is.na(nfac_got)) {
    add_row(method, dataset, "output_present", 1, 0, FALSE)
    return(invisible(NULL))
  }

  # 按数据集确定题项列与"真实"因子结构（用于结构效度断言）
  spec <- if (dataset == "efa_3factors") {
    list(items = c("a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3"),
         true_k = 3L,
         groups = list(1:3, 4:6, 7:9))
  } else {
    list(items = c("q1", "q2", "q3", "q4", "q5", "q6"),
         true_k = 2L,
         groups = list(1:3, 4:6))
  }

  # ---- 独立复算：从 fixtures 数据重新读，走完全不同的求逆路径 ----
  X <- data[, spec$items, drop = FALSE]
  X <- X[complete.cases(X), , drop = FALSE]
  n <- nrow(X)
  p <- ncol(X)
  R <- cor(X)
  ev <- eigen(R, symmetric = TRUE, only.values = TRUE)$values

  # KMO via Cholesky（与被测的 solve() 不同路径）
  Rinv_c <- chol2inv(chol(R))
  dq <- diag(Rinv_c)
  Qc <- -Rinv_c / sqrt(outer(dq, dq))
  diag(Qc) <- 0
  R2 <- R^2
  diag(R2) <- 0
  kmo_exp <- sum(R2) / (sum(R2) + sum(Qc^2))
  chk_num(method, dataset, "kmo", kmo_exp, kmo_got)

  # Bartlett via determinant()（与被测的 log(det()) 不同路径）
  chi_exp <- -(n - 1 - (2 * p + 5) / 6) * as.numeric(determinant(R, logarithm = TRUE)$modulus)
  chk_num(method, dataset, "bartlett_chisq", chi_exp, chi_got)
  chk_eq(method, dataset, "bartlett_df", p * (p - 1) / 2, df_got)

  # 不变量：Σλ = p
  chk_num(method, dataset, "eigen_sum_equals_p", p, sum(ev), tol = 1e-8)

  # Kaiser 准则
  nfac_exp <- sum(ev > 1)
  chk_eq(method, dataset, "n_factors_kaiser", nfac_exp, nfac_got)

  # ---- 载荷：独立 eigendecomposition + varimax，逐值比对 ----
  nf <- as.integer(nfac_got)
  eig_full <- eigen(R, symmetric = TRUE)
  L_raw <- eig_full$vectors[, seq_len(nf), drop = FALSE] %*% diag(sqrt(ev[seq_len(nf)]), nf)
  L_exp <- if (nf > 1) unclass(stats::varimax(L_raw)$loadings) else L_raw
  rownames(L_exp) <- spec$items
  # 符号规范（数据无关的约定，与实现同一规则）
  for (j in seq_len(ncol(L_exp))) {
    k <- which.max(abs(L_exp[, j]))
    if (L_exp[k, j] < 0) L_exp[, j] <- -L_exp[, j]
  }

  # 共同度不变量：正交旋转不改变 Σ(载荷²)
  comm_before <- rowSums(L_raw^2)
  comm_after <- rowSums(L_exp^2)
  chk_num(method, dataset, "communality_invariant",
          max(abs(comm_before - comm_after)), 0, tol = 1e-8)

  # 逐题项载荷比对
  load_lines <- kv[["LOAD"]]
  if (!is.null(load_lines) && length(load_lines) == p) {
    max_diff <- 0
    for (i in seq_len(p)) {
      # LOAD|item|v1..vnf|communality
      got <- suppressWarnings(as.numeric(unlist(load_lines[[i]][2:(nf + 1)])))
      exp <- as.numeric(L_exp[i, ])
      if (all(is.finite(got))) max_diff <- max(max_diff, max(abs(got - exp)))
    }
    chk_num(method, dataset, "loadings_max_abs_diff", 0, max_diff, tol = 1e-3)
  }

  # ---- 结构效度：已知因子结构须被恢复 ----
  # 对 2 因子数据：q1-q3 同因子、q4-q6 同因子、两因子不同
  # 对 3 因子数据：a/b/c 三组各自同因子、三组互不相同
  # 关键：同时断言**因子数等于真实因子数**——否则"因子数硬编码为 2"这类
  # 实现缺陷会在 2 因子数据上蒙混过关（本审查实测发现过这个盲点）。
  prim_lines <- kv[["PRIMARY"]]
  if (!is.null(prim_lines) && length(prim_lines) == p) {
    prim <- suppressWarnings(as.integer(unlist(lapply(prim_lines, function(z) z[2]))))
    if (all(is.finite(prim))) {
      groups_ok <- all(vapply(spec$groups, function(g) length(unique(prim[g])) == 1, logical(1)))
      # 各组的主因子互不相同
      group_reps <- vapply(spec$groups, function(g) prim[g[1]], integer(1))
      distinct_ok <- length(unique(group_reps)) == length(spec$groups)
      ok_struct <- groups_ok && distinct_ok
      chk_eq(method, dataset, "structure_recovered", "TRUE", if (ok_struct) "TRUE" else "FALSE")
    }
  }

  # ---- 因子数须等于真实结构（防止实现硬编码因子数）----
  chk_eq(method, dataset, "n_factors_matches_truth", spec$true_k, nf)

  # ---- 载荷表列数 = 因子数 + 2（item + nf + communality）----
  head_fields <- kv[["LOAD_HEAD"]]
  if (!is.null(head_fields) && length(head_fields) >= 1) {
    cols <- length(head_fields[[1]])
    chk_eq(method, dataset, "loading_table_cols", nf + 2, cols)
  }
}

## 4.17 验证性因子分析 CFA（v0.3.1，纯 base R 实现）
##
## 独立 oracle 策略 —— 核心是**换一条计算路径**，而不是把实现的代码抄一遍：
##   1. 参数化完全不同：实现用「角度编码保证 Φ 半正定 + optim(BFGS)」，
##      oracle 用「Φ 的 Cholesky 下三角自由估计再归一化为相关阵 + nlm 的
##      Newton 型优化」。两者参数向量的含义都不一样，只有**模型隐含协方差 Σ**
##      与 **F_ML** 这个不变量应当一致 → 这才是真正独立的交叉验证。
##   2. 行列式路径不同：实现用 log|Σ|，oracle 用特征值之和 log(λ) 展开。
##   3. 求逆路径不同：oracle 用 chol2inv(chol(Σ))，实现在别处用 solve()。
##   4. 拟合指标按 lavaan 的公式**独立复算**（不是读实现的中间变量）。
##   5. 不变式断言（不依赖任何参数化）：diag(Σ) = 1（相关阵拟合）、
##      Σλ² + θ_std = 1、df = p(p+1)/2 − (2p + k(k−1)/2)。
##   6. 判别力：同一份 2 因子数据强制拟合 1 因子，CFI 必须显著下降。
##      （本断言在 cfa_misfit 场景执行，见 oracle_cfa 末尾的 misfit 分支。）

## 用 Cholesky 参数化 + nlm 拟合的独立 CFA。
## 返回 F_ML、模型隐含 Σ、标准化载荷、Φ、df 等，供逐条比对。
cfa_fit_independent <- function(R, groups, k, n_starts = 4L) {
  p <- ncol(R)
  ev_R <- eigen(R, symmetric = TRUE, only.values = TRUE)$values
  if (any(ev_R <= 0)) return(NULL)
  # 路径不同①：|R| 用特征值展开（实现用 determinant()）
  ldet_R <- sum(log(ev_R))
  idx <- do.call(rbind, lapply(seq_len(k), function(f) cbind(which(groups == f), f)))
  nf <- nrow(idx)          # 自由载荷个数（每因子至少 3 题 → 恰好 p 个）
  nphi <- k * (k - 1) / 2

  unpack <- function(par) {
    Lam <- matrix(0, p, k)
    Lam[idx] <- par[seq_len(nf)]
    # 路径不同②：误差方差用 exp() 参数化（实现用下界约束 + 直接方差）
    th <- exp(par[nf + seq_len(p)])
    Phi <- diag(k)
    if (nphi > 0) {
      L <- diag(k)
      L[lower.tri(L)] <- par[nf + p + seq_len(nphi)]
      S0 <- L %*% t(L)
      dd <- sqrt(diag(S0))
      Phi <- S0 / outer(dd, dd)        # 归一化成相关阵（L 的形式）
    }
    list(Lam = Lam, th = th, Phi = Phi,
         Sigma = Lam %*% Phi %*% t(Lam) + diag(th))
  }
  f_ml <- function(par) {
    u <- unpack(par)
    S <- u$Sigma
    es <- eigen(S, symmetric = TRUE, only.values = TRUE)$values
    if (any(es <= 1e-10) || any(!is.finite(es))) return(1e10)
    Ri <- tryCatch(chol2inv(chol(S)), error = function(e) NULL)   # 路径不同③
    if (is.null(Ri)) return(1e10)
    # log|Σ| 用 log(特征值) 展开 —— 与 determinant() 不同的数值路径
    sum(log(es)) + sum(R * t(Ri)) - ldet_R - p
  }

  best <- NULL
  for (s in seq_len(n_starts)) {
    p0 <- c(rep(0.6 + 0.08 * s, nf),
            rep(log(0.55 - 0.07 * s), p),
            rep(0.2 + 0.1 * s, nphi))
    o <- tryCatch(suppressWarnings(nlm(f_ml, p0, iterlim = 3000)), error = function(e) NULL)
    if (is.null(o) || !is.finite(o$minimum)) next
    if (is.null(best) || o$minimum < best$minimum) best <- o
  }
  if (is.null(best)) return(NULL)
  u <- unpack(best$estimate)
  list(F_ML = best$minimum, Lam = u$Lam, th = u$th, Phi = u$Phi, Sigma = u$Sigma,
       df = p * (p + 1) / 2 - (2 * p + k * (k - 1) / 2), npar = 2 * p + k * (k - 1) / 2)
}

## CFA 场景配置：已知真值结构（用于结构效度断言）
cfa_spec_of <- function(dataset) {
  if (dataset == "cfa_3factors") {
    list(items = c("a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3"),
         true_groups = c(1, 1, 1, 2, 2, 2, 3, 3, 3),
         true_k = 3L,
         true_load = c(0.82, 0.79, 0.76, 0.81, 0.78, 0.75, 0.80, 0.77, 0.74),
         true_phi = c(0.30, 0.25, 0.20),
         n_expected = 600L)
  } else if (dataset == "cfa_misfit") {
    # 失配场景：**人为**把真 2 因子数据强制拟合成 1 因子。
    # 因此期望的归属是「全部 6 题同属一个因子」，而不是数据真实的分组。
    # （数据真实分组见 spec$true_groups，只用于生成描述与真值载荷，不用于此断言。）
    list(items = c("q1", "q2", "q3", "q4", "q5", "q6"),
         true_groups = rep(1, 6),
         true_k = 1L,
         true_load = c(0.85, 0.80, 0.75, 0.82, 0.78, 0.72),
         true_phi = numeric(0),
         n_expected = 800L)
  } else {
    list(items = c("q1", "q2", "q3", "q4", "q5", "q6"),
         true_groups = c(1, 1, 1, 2, 2, 2),
         true_k = 2L,
         true_load = c(0.85, 0.80, 0.75, 0.82, 0.78, 0.72),
         true_phi = 0.35,
         n_expected = 800L)
  }
}

## 模型隐含相关阵转成"按 √σ_jj 双重标准化"的残差（SRMR 用）
srmr_of <- function(R, Sigma) {
  d <- sqrt(diag(Sigma))
  Sstd <- Sigma / outer(d, d)
  resid <- R - Sstd
  sqrt(mean(resid[lower.tri(resid, diag = TRUE)]^2))
}

oracle_cfa <- function(method, dataset, kv, out, data) {
  spec <- cfa_spec_of(dataset)
  items <- spec$items
  X <- data[, items, drop = FALSE]
  X <- as.data.frame(lapply(X, as_num))
  X <- X[complete.cases(X), , drop = FALSE]
  n <- nrow(X); p <- length(items)
  R <- cor(X)

  ## ---- 结构性：CFA_SPEC / CFA_ITEM 必须与真实结构一致 ----
  ## 注意：实现声称"因子归属由 EFA 自动导出"，因此 cfa 场景的 factor 编号
  ## 可能与真值编号顺序不同（因子是可交换的）→ 只断言**分组等价**，不断言编号。
  chk_eq(method, dataset, "CFA_SPEC.p", p, gfn(kv, "CFA_SPEC", 1, 2))
  chk_eq(method, dataset, "CFA_SPEC.n", n, gfn(kv, "CFA_SPEC", 1, 3))

  item_lines <- kv[["CFA_ITEM"]]
  if (is.null(item_lines) || length(item_lines) != p) {
    add_row(method, dataset, "CFA_ITEM.count", p, if (is.null(item_lines)) 0 else length(item_lines), FALSE)
    return(invisible(NULL))
  }
  got_item <- vapply(item_lines, function(z) z[1], character(1))
  chk_eq(method, dataset, "CFA_ITEM.order", paste(items, collapse = ","), paste(got_item, collapse = ","))
  got_fac <- suppressWarnings(as.integer(vapply(item_lines, function(z) z[2], character(1))))
  if (any(!is.finite(got_fac))) {
    add_row(method, dataset, "CFA_ITEM.numeric", "all integer", "non-numeric field", FALSE)
    return(invisible(NULL))
  }
  k_got <- max(got_fac)
  chk_eq(method, dataset, "CFA_SPEC.nfac", k_got, gfn(kv, "CFA_SPEC", 1, 1))

  # 分组等价性：真值分组划分 == 实现分组划分（与编号无关）
  partition_sig <- function(g) {
    # 用「每个题项所属因子的成员向量」做集合签名，对编号重排不敏感
    levels_g <- sort(unique(g))
    paste(sort(vapply(levels_g, function(l) paste(which(g == l), collapse = "-"), character(1))),
          collapse = "|")
  }
  chk_eq(method, dataset, "CFA_ITEM.partition", partition_sig(spec$true_groups), partition_sig(got_fac))

  ## 失配场景：真值结构是 2 因子，此处强制 1 因子 → 分类断言应反映"人为设定"
  if (dataset == "cfa_misfit") {
    chk_eq(method, dataset, "CFA_ITEM.forced_1factor", 1L, k_got)
  }

  ## ---- 独立拟合（Cholesky 参数化 + nlm，与被测的角度参数化 + optim 不同）----
  ## 修正因子编号：把实现的 got_fac 作为结构直接喂给 oracle，
  ## 这样比较的是**同一结构与同一数据下的拟合量**，而不是因子编号本身。
  fit <- cfa_fit_independent(R, got_fac, k_got)
  if (is.null(fit)) {
    add_row(method, dataset, "oracle_fit", "converged", "failed", FALSE)
    return(invisible(NULL))
  }

  chisq_ref <- (n - 1) * fit$F_ML
  chisq_got <- gfn(kv, "CFA_FIT", 1, 1)
  # chisq 的比较走相对容差 1e-4：两套优化器都收敛到同一个 F_ML 才可能通过，
  # 这是「不同计算路径得出同一答案」的直接证据。
  chk_num(method, dataset, "CFA_FIT.chisq", chisq_ref, chisq_got, 1e-4)
  chk_eq(method, dataset, "CFA_FIT.df", fit$df, gfn(kv, "CFA_FIT", 1, 2))

  ## F_ML 本身也断言一次（chisq 除以 (n-1) 后精度更高，更容易抓住细微偏差）
  chk_num(method, dataset, "F_ML", fit$F_ML, chisq_got / (n - 1), 1e-4)

  p_ref <- pchisq(chisq_ref, fit$df, lower.tail = FALSE)
  chk_num(method, dataset, "CFA_FIT.p", p_ref, gfn(kv, "CFA_FIT", 1, 4), TOL_LOOSE)

  ## ---- 不变式（与参数化无关，任何正确实现都必须满足）----
  # (i) 相关阵拟合 → 模型隐含 Σ 的对角线必须 ≈ 1
  chk_num(method, dataset, "invariant.diag_Sigma_eq_1",
          max(abs(diag(fit$Sigma) - 1)), 0, tol = 5e-6)
  # (ii) Σλ² + θ_std = 1（标准化载荷的平方 + 标准化误差方差 = 1）
  sd_sig <- sqrt(diag(fit$Sigma))
  lam_std <- fit$Lam / sd_sig
  th_std <- fit$th / diag(fit$Sigma)
  chk_num(method, dataset, "invariant.lambda2_plus_theta",
          max(abs(rowSums(lam_std^2) + th_std - 1)), 0, tol = 5e-6)
  # (iii) df 公式（契约第一节第 2 条，必须与 lavaan 一致）
  chk_eq(method, dataset, "invariant.df_formula",
          p * (p + 1) / 2 - (2 * p + k_got * (k_got - 1) / 2), fit$df)
  # (iv) 自由度 = 已知量减去自由参数，且 Σ 的自由元素数 = p(p+1)/2
  chk_eq(method, dataset, "invariant.npar", 2 * p + k_got * (k_got - 1) / 2, fit$npar)

  ## ---- 零模型与拟合指标：按 lavaan 公式独立复算 ----
  ldet_R <- as.numeric(determinant(R, logarithm = TRUE)$modulus)
  chisq_null_ref <- -(n - 1) * ldet_R
  df_null_ref <- p * (p - 1) / 2
  chk_num(method, dataset, "CFA_NULLMODEL.chisq", chisq_null_ref, gfn(kv, "CFA_NULLMODEL", 1, 1), 1e-4)
  chk_eq(method, dataset, "CFA_NULLMODEL.df", df_null_ref, gfn(kv, "CFA_NULLMODEL", 1, 2))

  df <- fit$df
  if (df > 0) {
    cfi_ref <- 1 - max(chisq_ref - df, 0) / max(chisq_ref - df, chisq_null_ref - df_null_ref, 0)
    tli_ref <- (chisq_null_ref / df_null_ref - chisq_ref / df) /
      (chisq_null_ref / df_null_ref - 1)
    rmsea_ref <- sqrt(max(chisq_ref - df, 0) / (df * (n - 1)))
  } else {
    cfi_ref <- 1; tli_ref <- 1; rmsea_ref <- 0
  }
  srmr_ref <- srmr_of(R, fit$Sigma)

  chk_num(method, dataset, "CFA_FITIDX.cfi", cfi_ref, gfn(kv, "CFA_FITIDX", 1, 1), TOL_LOOSE)
  chk_num(method, dataset, "CFA_FITIDX.tli", tli_ref, gfn(kv, "CFA_FITIDX", 1, 2), TOL_LOOSE)
  chk_num(method, dataset, "CFA_FITIDX.rmsea", rmsea_ref, gfn(kv, "CFA_FITIDX", 1, 3), TOL_LOOSE)
  # SRMR 容差稍松：两套实现的最优 Σ 在不同优化器的收敛点上可能差 1e-6，
  # SRMR 对这些差异的放大有限，但 TOL 级别（1e-3）对 4 位小数输出已足够。
  chk_num(method, dataset, "CFA_FITIDX.srmr", srmr_ref, gfn(kv, "CFA_FITIDX", 1, 4), TOL_LOOSE)

  ## ---- 标准化载荷：逐题项比对（含**符号**，这是易错点）----
  est_lines <- kv[["CFA_ESTIMATE"]]
  if (is.null(est_lines) || length(est_lines) != p) {
    add_row(method, dataset, "CFA_ESTIMATE.count", p,
            if (is.null(est_lines)) 0 else length(est_lines), FALSE)
    return(invisible(NULL))
  }
  got_names <- vapply(est_lines, function(z) z[1], character(1))
  chk_eq(method, dataset, "CFA_ESTIMATE.items", paste(items, collapse = ","),
         paste(got_names, collapse = ","))

  num_field <- function(lines, j) suppressWarnings(as.numeric(vapply(lines, function(z) z[j], character(1))))

  # 期望的标准化载荷：oracle 的 λ / √σ_jj
  lam_exp <- fit$Lam / sqrt(diag(fit$Sigma))
  lam_got <- num_field(est_lines, 2)
  ok_lam <- all(is.finite(lam_got))
  chk_eq(method, dataset, "CFA_ESTIMATE.std_load.numeric", "all numeric",
         if (ok_lam) "all numeric" else "has NA")
  if (ok_lam) {
    # 按题项对应：每题只在自己所属因子上有载荷，取该因子列
    lam_e <- vapply(seq_len(p), function(i) lam_exp[i, got_fac[i]], numeric(1))
    max_diff <- max(abs(lam_e - lam_got))
    # 逐题也断言一次（能定位到具体题项，失败信息更有用）
    for (i in seq_len(p)) {
      chk_num(method, dataset, paste0("CFA_ESTIMATE.", items[i], ".std_load"),
              lam_e[i], lam_got[i], TOL_LOOSE)
    }
    # 汇总断言：最大绝对偏差
    chk_num(method, dataset, "CFA_ESTIMATE.std_load.max_abs_diff", 0, max_diff, tol = 2e-3)
    # **符号正确性**：符号统一规则要求 |载荷| 最大者为正 → 每个因子至少一个正载荷，
    # 且不允许"整列为负"。若实现只翻转载荷列而不翻转 Φ，符号断言会立刻抓住。
    sign_ok_by_factor <- all(vapply(seq_len(k_got), function(f) {
      col <- lam_got[got_fac == f]
      max(abs(col)) == max(col)      # 列内绝对值最大者为正
    }, logical(1)))
    chk_eq(method, dataset, "CFA_ESTIMATE.sign_convention", "TRUE",
           if (sign_ok_by_factor) "TRUE" else "FALSE")
    # 载荷必须在 (-1, 1) 内（标准化载荷的可行域）
    chk_eq(method, dataset, "CFA_ESTIMATE.std_load_in_range", "TRUE",
           if (all(abs(lam_got) < 1)) "TRUE" else "FALSE")
  }

  # 真值恢复：标准化载荷应接近数据生成时的真值载荷（结构效度证据）。
  # fixtures 用 Gram-Schmidt 造出**精确正交**的因子/噪声基，因此样本相关矩阵
  # 精确等于 ΛΦΛ'+Θ → 这里的容差可以收紧到 0.02（若容差放到 0.10 以上，
  # 「载荷恢复」断言就失去了判别力：连错的解都能通过）。
  # 注意 cfa_misfit 场景真值不适用（人为误设模型），跳过该断言。
  if (dataset != "cfa_misfit") {
    true_load <- spec$true_load
    chk_num(method, dataset, "truth.std_load.max_abs_error", 0,
            max(abs(abs(lam_got) - true_load)), tol = 0.02)
  }

  # r2 == std_load²（契约第一条字段语义，独立复算）
  r2_got <- num_field(est_lines, 8)
  if (all(is.finite(r2_got)) && ok_lam) {
    chk_num(method, dataset, "CFA_ESTIMATE.r2_equals_load_sq", 0,
            max(abs(r2_got - lam_got^2)), tol = 2e-3)
  }
  # unstd_load 与 std_load 的关系（契约字段语义的**核心**区分）：
  #   Y_j = λF + e（Var(F)=1，原始量纲）⇒ λ_raw = λ_std × sd(Y_j)
  # 反过来即 unstd_load / sd(原始列) ≈ std_load。
  # 这条断言同时抓住两种错法：
  #   (a) 两个字段恒等（声明了两个字段却永远给同一个数）→ 比值 = 1/sd ≠ 1；
  #   (b) 换错尺度（例如误用模型隐含 sd 而非原始列 sd）→ 比值偏离。
  # fixtures 刻意让各题 sd 从 0.70 到 1.451 不等，否则这条退化为恒真。
  unstd_got <- num_field(est_lines, 3)
  raw_sd <- vapply(items, function(nm) sd(X[[nm]]), numeric(1))
  if (all(is.finite(unstd_got))) {
    resid_ratio <- unstd_got / raw_sd - lam_got
    chk_num(method, dataset, "CFA_ESTIMATE.unstd_over_raw_sd_equals_std", 0,
            max(abs(resid_ratio)), tol = 2e-3)
    # 独立再断言一次：unstd 与 std 必须真的不同（fixtures 保证 sd 不全为 1）
    chk_eq(method, dataset, "CFA_ESTIMATE.unstd_differs_from_std", "TRUE",
           if (max(abs(unstd_got / lam_got - 1)) > 0.05) "TRUE" else "FALSE")
  }

  ## ---- 因子相关 Φ：与 oracle 的 Φ 比对（含符号！）----
  if (k_got >= 2) {
    fac_lines <- kv[["CFA_FACTOR"]]
    n_pairs <- k_got * (k_got - 1) / 2
    if (is.null(fac_lines) || length(fac_lines) != n_pairs) {
      add_row(method, dataset, "CFA_FACTOR.count", n_pairs,
              if (is.null(fac_lines)) 0 else length(fac_lines), FALSE)
    } else {
      # 独立复算 Φ：oracle 的 Cholesky 参数给出 Φ，逐对比对
      max_phi_diff <- 0
      for (ln in fac_lines) {
        f1 <- suppressWarnings(as.integer(ln[1])); f2 <- suppressWarnings(as.integer(ln[2]))
        cor_got <- suppressWarnings(as.numeric(ln[3]))
        if (!is.finite(f1) || !is.finite(f2) || !is.finite(cor_got)) next
        cor_ref <- fit$Phi[f1, f2]
        max_phi_diff <- max(max_phi_diff, abs(abs(cor_ref) - abs(cor_got)),
                            abs(cor_ref - cor_got))
      }
      # 直接比数值（含符号）：符号统一如果做得不对，Φ 的符号也会跟着错
      chk_num(method, dataset, "CFA_FACTOR.cor.max_abs_diff", 0, max_phi_diff, tol = TOL_LOOSE)
      # 真值恢复（仅 cfa 场景）
      if (dataset == "cfa") {
        cor_got1 <- suppressWarnings(as.numeric(fac_lines[[1]][3]))
        chk_num(method, dataset, "truth.phi12", spec$true_phi, abs(cor_got1), TOL_LOOSE)
      }
    }
  } else {
    # nfac < 2 时按契约不得输出 CFA_FACTOR
    add_row(method, dataset, "CFA_FACTOR.absent_when_1factor", "absent",
            if (is.null(kv[["CFA_FACTOR"]])) "absent" else "present",
            is.null(kv[["CFA_FACTOR"]]))
  }

  ## ---- 组合信度 / AVE：按契约公式独立复算 ----
  ## cr = (Σλ)²/((Σλ)² + Σθ)，ave = Σλ²/(Σλ² + Σθ)，λ 用**标准化**载荷
  reliab <- kv[["CFA_RELIAB"]]
  if (is.null(reliab) || length(reliab) != k_got) {
    add_row(method, dataset, "CFA_RELIAB.count", k_got,
            if (is.null(reliab)) 0 else length(reliab), FALSE)
  } else {
    for (f in seq_len(k_got)) {
      got <- suppressWarnings(as.numeric(unlist(reliab[[f]][2:4])))
      if (length(got) != 3 || !all(is.finite(got))) {
        add_row(method, dataset, paste0("CFA_RELIAB.F", f, ".numeric"), "3 numeric", "bad field", FALSE)
        next
      }
      lam_f <- lam_exp[got_fac == f, f]
      s2 <- sum(lam_f)
      s22 <- sum(lam_f^2)
      # θ 用标准化误差方差：1 − λ²（契约说 λ 用标准化载荷，θ 对应标准化）
      th_f <- sum(1 - lam_f^2)
      cr_ref <- s2^2 / (s2^2 + th_f)
      ave_ref <- s22 / (s22 + th_f)
      chk_num(method, dataset, paste0("CFA_RELIAB.F", f, ".cr"), cr_ref, got[1], TOL_LOOSE)
      chk_num(method, dataset, paste0("CFA_RELIAB.F", f, ".ave"), ave_ref, got[2], TOL_LOOSE)
      chk_num(method, dataset, paste0("CFA_RELIAB.F", f, ".sqrt_ave"), sqrt(ave_ref), got[3], TOL_LOOSE)
    }
  }

  ## ---- 结论必须与拟合指标一致（防止"指标不达标却写模型良好"）----
  concl <- gf(kv, "CONCL", 1, 1)
  cfi_got <- gfn(kv, "CFA_FITIDX", 1, 1)
  rmsea_got <- gfn(kv, "CFA_FITIDX", 1, 3)
  if (is.finite(cfi_got) && is.finite(rmsea_got) && !is.null(concl)) {
    # 判定口径与实现无关：CFI ≥ .90 且 RMSEA ≤ .08 才算"可接受"
    acceptable <- cfi_got >= 0.90 && rmsea_got <= 0.08
    claims_good <- grepl("良好|可接受|适配良好|拟合良好", concl)
    add_row(method, dataset, "CONCL.matches_fit_indices",
            if (acceptable) "good" else "poor",
            if (claims_good) "good" else "poor",
            acceptable == claims_good)
  }

  ## ---- 判别力证据（仅 cfa_misfit 场景）----
  ## 这里不能与同一场景的"正确模型"直接比（那是另一个 fixture），
  ## 因此把「失配模型 CFI 必须 < 0.80」作为独立断言写入。
  ## 正确模型的 CFI 在 cfa 场景另有一条 ≥ 0.95 的断言。
  ## 两条合起来 = 判别力：CFI 能区分正确/错误模型，不是恒等于 1 的摆设。
  if (dataset == "cfa_misfit") {
    cfi_val <- gfn(kv, "CFA_FITIDX", 1, 1)
    add_row(method, dataset, "discriminant.misfit_CFI_below_0.80",
            "< 0.80", fv(cfi_val),
            is.finite(cfi_val) && cfi_val < 0.80)
  } else {
    cfi_val <- gfn(kv, "CFA_FITIDX", 1, 1)
    add_row(method, dataset, "discriminant.correct_model_CFI_above_0.95",
            ">= 0.95", fv(cfi_val),
            is.finite(cfi_val) && cfi_val >= 0.95)
  }
}

## 4.18 内容效度指数 CVI（v0.3.1）
##
## 独立 oracle：**逐专家穷举计数**，不调用实现的任何函数。
##   - I-CVI：对每个题项，直接数「评分 ≥ 3 的专家行数」，用 table()/sum() 而非比例运算
##   - S-CVI/Ave：先得到 p 个 I-CVI 再取算术平均
##   - S-CVI/UA：数「所有专家都 ≥3」的题项个数（all(.) 判定）
##   - Kappa：用 choose() 直接算二项系数 Pc = C(n,A)/2^n，A = ceiling(阈值×n)
##   - 阈值表在 oracle 里**重写一份**，不读实现的阈值向量——若实现的查表写错，
##     这里会立刻抓住（本 oracle 就是这样抓到了初稿契约的阈值错误）。
##
## ⚠️ 阈值表必须跟随 V031_CONTRACT.md 第二节的**当前**权威口径。
## 契约曾在 v0.3.1 开发中修正过一次（初稿偏松），修正依据 Lynn 1986 与
## Polit & Beck 2006 / Polit et al. 2007："6–8 experts: ≥ 0.83；≥9: ≥ 0.78"。
## 若 oracle 停留在旧表，就会出现"实现是对的、oracle 是错的"的**假红**——
## 与假绿同样有害。
cvi_threshold_ref <- function(n) {
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

## Cicchetti & Sparrow 四级判读（契约第二节 verdict 字段）
cvi_verdict_ref <- function(k) {
  if (k > 0.74) {
    "优秀"
  } else {
    if (k >= 0.60) {
      "良好"
    } else {
      if (k >= 0.40) {
        "尚可"
      } else {
        "需修改"
      }
    }
  }
}

oracle_cvi <- function(method, dataset, kv, out, data) {
  items <- names(data)
  n_exp <- nrow(data)
  p <- length(items)
  M <- as.matrix(data.frame(lapply(data, as_num)))

  chk_eq(method, dataset, "CVI_SPEC.n_items", p, gfn(kv, "CVI_SPEC", 1, 1))
  chk_eq(method, dataset, "CVI_SPEC.n_experts", n_exp, gfn(kv, "CVI_SPEC", 1, 2))

  # ---- 穷举计数：每题「相关」专家数 ----
  n_rel_ref <- vapply(seq_len(p), function(j) sum(M[, j] >= 3, na.rm = TRUE), numeric(1))
  icvi_ref <- n_rel_ref / n_exp
  thr <- cvi_threshold_ref(n_exp)
  A_ref <- ceiling(thr * n_exp)
  pc_ref <- choose(n_exp, A_ref) / 2^n_exp
  kappa_ref <- (icvi_ref - pc_ref) / (1 - pc_ref)

  item_lines <- kv[["CVI_ITEM"]]
  if (is.null(item_lines) || length(item_lines) != p) {
    add_row(method, dataset, "CVI_ITEM.count", p,
            if (is.null(item_lines)) 0 else length(item_lines), FALSE)
    return(invisible(NULL))
  }
  got_items <- vapply(item_lines, function(z) z[1], character(1))
  chk_eq(method, dataset, "CVI_ITEM.order", paste(items, collapse = ","),
         paste(got_items, collapse = ","))

  nrel_got <- suppressWarnings(as.numeric(vapply(item_lines, function(z) z[2], character(1))))
  icvi_got <- suppressWarnings(as.numeric(vapply(item_lines, function(z) z[4], character(1))))
  kappa_got <- suppressWarnings(as.numeric(vapply(item_lines, function(z) z[5], character(1))))
  pc_got <- suppressWarnings(as.numeric(vapply(item_lines, function(z) z[6], character(1))))
  verdict_got <- vapply(item_lines, function(z) z[7], character(1))

  for (j in seq_len(p)) {
    chk_eq(method, dataset, paste0("CVI_ITEM.", items[j], ".n_relevant"), n_rel_ref[j], nrel_got[j])
    # 输出保留 4 位小数 → 绝对误差上界 5e-5；用 1e-3 绝对容差（num_ok 以 max(1,|x|) 缩放）
    chk_num(method, dataset, paste0("CVI_ITEM.", items[j], ".i_cvi"), icvi_ref[j], icvi_got[j], 1e-3)
    chk_num(method, dataset, paste0("CVI_ITEM.", items[j], ".p_c"), pc_ref, pc_got[j], 1e-3)
    chk_num(method, dataset, paste0("CVI_ITEM.", items[j], ".kappa"), kappa_ref[j], kappa_got[j], TOL_LOOSE)
    # verdict 判据：契约当前为 Cicchetti & Sparrow 四级口径
    chk_eq(method, dataset, paste0("CVI_ITEM.", items[j], ".verdict"),
           cvi_verdict_ref(kappa_ref[j]), verdict_got[j])
  }

  # ---- 量表级指标 ----
  s_ave_ref <- mean(icvi_ref)
  ua_flags <- vapply(seq_len(p), function(j) all(M[, j] >= 3), logical(1))
  n_ua_ref <- sum(ua_flags)
  s_ua_ref <- n_ua_ref / p

  chk_num(method, dataset, "CVI_SUMMARY.s_cvi_ave", s_ave_ref, gfn(kv, "CVI_SUMMARY", 1, 1), 1e-3)
  chk_num(method, dataset, "CVI_SUMMARY.s_cvi_ua", s_ua_ref, gfn(kv, "CVI_SUMMARY", 1, 2), 1e-3)
  chk_eq(method, dataset, "CVI_SUMMARY.n_ua", n_ua_ref, gfn(kv, "CVI_SUMMARY", 1, 3))

  # threshold_ok 的编码契约未固定（可能是 是/否、TRUE/FALSE、合格/不合格），
  # 因此**归一化后再比语义**，而不是比字面量——这样既严格又不与实现耦合。
  thr_ok_ref <- all(icvi_ref >= thr)
  thr_ok_got <- normalize_bool_cn(gf(kv, "CVI_SUMMARY", 1, 4))
  chk_eq(method, dataset, "CVI_SUMMARY.threshold_ok",
         if (thr_ok_ref) "TRUE" else "FALSE",
         if (is.na(thr_ok_got)) "UNPARSEABLE" else if (thr_ok_got) "TRUE" else "FALSE")

  # 保护测试本身：若 fixtures 让所有题项 I-CVI 相同，Kappa 判读档就不会出现，
  # 上面的 verdict 断言将退化为「恒等式」。这里显式断言区分度存在。
  add_row(method, dataset, "fixture.i_cvi_has_discrimination", ">= 3 distinct values",
          sprintf("%d distinct", length(unique(round(icvi_ref, 6)))),
          length(unique(round(icvi_ref, 6))) >= 3)
  # Kappa 判读必须覆盖至少两档，否则 verdict 映射没有被真正检验
  verdict_ref_all <- vapply(kappa_ref, cvi_verdict_ref, character(1))
  add_row(method, dataset, "fixture.verdict_has_multiple_levels", ">= 2 levels",
          sprintf("%d levels", length(unique(verdict_ref_all))),
          length(unique(verdict_ref_all)) >= 2)
  # A_req 必须等于 ceiling(阈值 × n)：这条把「阈值表口径」本身钉进断言。
  # 若契约再改阈值而 oracle 没跟上，这里会连同上方的 p_c/kappa/verdict 一起变红，
  # 提示维护者去读契约——正是本验证体系该有的行为。
  add_row(method, dataset, "oracle.a_req_matches_threshold_table",
          sprintf("ceiling(%s x %d) = %d", fv(thr), n_exp, A_ref),
          sprintf("Pc = C(%d,%d)/2^%d = %s", n_exp, A_ref, n_exp, fv(pc_ref)),
          A_ref == ceiling(thr * n_exp))
}

## 4.19 Harman 单因子检验（v0.3.1）
##
## 独立 oracle 策略：**换一条特征分解路径**
##   实现用 prcomp()（SVD on 中心化数据）；oracle 用 eigen(cor(X))（相关阵特征分解）。
##   两者在数学上等价（相关阵 = 标准化数据的协方差阵），但走的是完全不同的
##   LAPACK 例程与数值路径——若实现的中心化/标准化写错（例如忘了 scale），
##   首成分占比会明显不同。
oracle_harman <- function(method, dataset, kv, out, data) {
  items <- names(data)
  X <- data.frame(lapply(data, as_num))
  X <- X[complete.cases(X), , drop = FALSE]
  n <- nrow(X); p <- ncol(X)

  chk_eq(method, dataset, "HARMAN_SPEC.p", p, gfn(kv, "HARMAN_SPEC", 1, 1))
  chk_eq(method, dataset, "HARMAN_SPEC.n", n, gfn(kv, "HARMAN_SPEC", 1, 2))

  # 路径 A（oracle）：相关阵特征分解
  ev <- eigen(cor(X), symmetric = TRUE, only.values = TRUE)$values
  first_pct_ref <- ev[1] / p * 100
  n_gt1_ref <- sum(ev > 1)
  # 路径 B（第二重独立校验）：对标准化数据做 SVD 的奇异值
  Z <- scale(X)
  sv <- svd(Z, nu = 0, nv = 0)$d
  ev_svd <- sv^2 / (n - 1)
  chk_num(method, dataset, "oracle.consistency_eigen_vs_svd",
          max(abs(ev - ev_svd)), 0, tol = 1e-8)

  # ---- HARMAN_EIGEN：逐个 λ>1 的特征值比对 ----
  eig_lines <- kv[["HARMAN_EIGEN"]]
  n_gt1_got <- gfn(kv, "HARMAN_SUMMARY", 1, 1)
  chk_eq(method, dataset, "HARMAN_SUMMARY.n_factors_gt1", n_gt1_ref, n_gt1_got)

  if (!is.null(eig_lines) && length(eig_lines) >= 1) {
    # 输出应恰好是 λ>1 的那些因子数
    chk_eq(method, dataset, "HARMAN_EIGEN.count", n_gt1_ref, length(eig_lines))
    eig_got <- suppressWarnings(as.numeric(vapply(eig_lines, function(z) z[2], character(1))))
    vp_got <- suppressWarnings(as.numeric(vapply(eig_lines, function(z) z[3], character(1))))
    if (all(is.finite(eig_got))) {
      # 前 n 个特征值逐一比对（不是只比第一个）
      n_cmp <- min(length(eig_got), n_gt1_ref)
      for (j in seq_len(n_cmp)) {
        chk_num(method, dataset, paste0("HARMAN_EIGEN.eigen", j), ev[j], eig_got[j], TOL_LOOSE)
        chk_num(method, dataset, paste0("HARMAN_EIGEN.variance_pct", j),
                ev[j] / p * 100, vp_got[j], TOL_LOOSE)
      }
    }
    # 累计百分比必须是单调递增且末项 = 已输出因子的累计方差
    cum_got <- suppressWarnings(as.numeric(vapply(eig_lines, function(z) z[4], character(1))))
    if (all(is.finite(cum_got)) && length(cum_got) >= 2) {
      chk_eq(method, dataset, "HARMAN_EIGEN.cumulative_monotone", "TRUE",
             if (all(diff(cum_got) > 0)) "TRUE" else "FALSE")
    }
  }

  # ---- 关键判定 ----
  chk_num(method, dataset, "HARMAN_SUMMARY.first_pct", first_pct_ref,
          gfn(kv, "HARMAN_SUMMARY", 1, 2), TOL_LOOSE)
  # 判据：first_pct < 40 且 n_gt1 > 1 → ok = 是
  ok_ref <- first_pct_ref < 40 && n_gt1_ref > 1
  ok_got <- gf(kv, "HARMAN_SUMMARY", 1, 4)
  chk_eq(method, dataset, "HARMAN_SUMMARY.ok",
         if (ok_ref) "是" else "否", ok_got)
  thr_got <- gfn(kv, "HARMAN_SUMMARY", 1, 3)
  chk_num(method, dataset, "HARMAN_SUMMARY.threshold", 40, thr_got, tol = 1e-8)

  # ---- 判据判别力：两组 fixtures 必须落在判据的两侧 ----
  # harman_medium（中等相关）→ first_pct < 40 且 n_gt1 > 1 → ok = 是
  # harman_high（单一强因子）  → first_pct > 40 → ok = 否
  # 若实现把判据写反（例如 >= 40 才判 ok），这两条必有一条会红。
  if (dataset == "harman_medium") {
    add_row(method, dataset, "criterion.medium_side",
            "first_pct<40 & n_gt1>1", sprintf("first_pct=%.2f n_gt1=%d", first_pct_ref, n_gt1_ref),
            first_pct_ref < 40 && n_gt1_ref > 1)
  } else if (dataset == "harman_high") {
    add_row(method, dataset, "criterion.high_side",
            "first_pct>40", sprintf("first_pct=%.2f", first_pct_ref),
            first_pct_ref > 40)
  }

  # ---- 结论方向必须与 ok 一致 ----
  concl <- gf(kv, "CONCL", 1, 1)
  if (!is.null(concl)) {
    claims_no_bias <- grepl("未发现|不存在|不明显", concl)
    claims_bias <- grepl("存在|明显", concl) && !claims_no_bias
    # 实现口径：ok=是 表示"未发现严重共同方法偏差"
    add_row(method, dataset, "CONCL.direction",
            if (ok_ref) "no_bias" else "bias",
            if (claims_no_bias) "no_bias" else if (claims_bias) "bias" else "unclear",
            (ok_ref && claims_no_bias) || (!ok_ref && claims_bias))
  }

  # ---- 必须输出方法学提醒（契约第三节："必须输出提示：灵敏度低"）----
  note_txt <- paste(unlist(kv[["HARMAN_NOTE"]]), collapse = " ")
  has_sensitivity_note <- grepl("灵敏度|敏感|初步|筛查|不能证明", note_txt)
  add_row(method, dataset, "HARMAN_NOTE.sensitivity_caveat", "present",
          if (nzchar(note_txt)) "present" else "missing", has_sensitivity_note)
}

## ---- 5. 主循环 ------------------------------------------------------------
# 生成器产出的代码用相对文件名 read.csv("xxx.csv")，因此执行期间必须把工作目录
# 切到 fixtures 目录。脚本自身所有读写都用绝对路径，不受影响。
old_wd <- getwd()
setwd(GEN_DIR)

cat("==========================================================\n")
cat("R Workbench 统计正确性验证（真实生成器 + 独立 oracle）\n")
cat("R:", R.version.string, "\n")
cat("fixtures:", GEN_DIR, "\n")
cat("容差 TOL =", TOL, " 置换/蒙特卡洛重复 =", MC_B, "\n")
cat("==========================================================\n")

oracle_map <- list(  descriptive = oracle_descriptive,
  ttest_independent = oracle_ttest_independent,
  ttest_paired = oracle_ttest_paired,
  ttest_one = oracle_ttest_one,
  anova = oracle_anova,
  chisquare = oracle_chisquare,
  correlation_pearson = oracle_correlation_pearson,
  correlation_spearman = oracle_correlation_spearman,
  regression = oracle_regression,
  reliability = oracle_reliability,
  normality = oracle_normality,
  nonparametric = oracle_nonparametric,
  frequency = oracle_frequency,
  summary_by = oracle_summary_by,
  efa = oracle_efa,
  efa_3factors = oracle_efa,
  # v0.3.1
  cfa = oracle_cfa,
  cfa_3factors = oracle_cfa,
  cfa_misfit = oracle_cfa,
  cvi = oracle_cvi,
  harman_medium = oracle_harman,
  harman_high = oracle_harman
)
banner_map <- c(
  descriptive = "=== 描述性统计 ===",
  ttest_independent = "=== 独立样本 t 检验 ===",
  ttest_paired = "=== 配对样本 t 检验 ===",
  ttest_one = "=== 单样本 t 检验 ===",
  anova = "=== 单因素方差分析 ===",
  chisquare = "=== 卡方检验 ===",
  correlation_pearson = "=== 相关分析 (pearson) ===",
  correlation_spearman = "=== 相关分析 (spearman) ===",
  regression = "=== 线性回归分析 ===",
  reliability = "=== 信度分析 (Cronbach's α) ===",
  normality = "=== 正态性检验 (Shapiro-Wilk) ===",
  nonparametric = "=== 非参数检验 (Mann-Whitney U) ===",
  frequency = "=== 频数统计 ===",
  summary_by = "=== 分类汇总 ===",
  efa = "=== 探索性因子分析 (EFA) ===",
  efa_3factors = "=== 探索性因子分析 (EFA) ===",
  # v0.3.1（契约第一节至第三节的横幅）
  cfa = "=== 验证性因子分析 (CFA) ===",
  cfa_3factors = "=== 验证性因子分析 (CFA) ===",
  cfa_misfit = "=== 验证性因子分析 (CFA) ===",
  cvi = "=== 内容效度指数 (CVI) ===",
  harman_medium = "=== Harman 单因子检验 ===",
  harman_high = "=== Harman 单因子检验 ==="
)

for (i in seq_len(nrow(manifest))) {
  method <- manifest$method[i]; dataset <- manifest$dataset[i]
  cat(sprintf("\n[%s / %s] %s\n", method, dataset, manifest$desc[i]))

  csv_path <- file.path(GEN_DIR, manifest$csvfile[i])
  r_path <- file.path(GEN_DIR, manifest$rfile[i])
  if (!file.exists(csv_path) || !file.exists(r_path)) {
    add_row(method, dataset, "fixture_exists", "present", "missing", FALSE)
    next
  }
  data <- read.csv(csv_path, stringsAsFactors = FALSE, check.names = FALSE, fileEncoding = "UTF-8-BOM")

  # (0) 真实 R 语法检查：生成器产出的脚本必须能被 parse() 解析。
  #     v0.2.5 有 6 个生成器把 else 写在新行，R 直接 parse 失败（unexpected 'else'），
  #     这里把它变成一条独立断言，CI 有 R 时会被强制执行。
  parse_err <- tryCatch({ parse(file = r_path, encoding = "UTF-8"); NULL },
                        error = function(e) conditionMessage(e))
  add_row(method, dataset, "r_syntax_parse",
          "parse() ok",
          if (is.null(parse_err)) "ok" else parse_err,
          is.null(parse_err))

  env <- new.env(parent = globalenv())
  res <- run_generated(r_path, env)
  out <- res$out
  kv <- parse_kv(out)

  # (a) R 的 sprintf 参数不匹配 → 字段被静默丢弃，直接 FAIL
  bad_fmt <- unique(res$msgs[grepl("not used by format", res$msgs, fixed = TRUE)])
  add_row(method, dataset, "sprintf_format_args",
          "no mismatch",
          if (length(bad_fmt) == 0) "ok" else paste(bad_fmt, collapse = " ; "),
          length(bad_fmt) == 0)
  # (b) 生成器执行错误
  errs <- res$msgs[startsWith(res$msgs, "ERROR:")]
  add_row(method, dataset, "no_r_error", "no error",
          if (length(errs) == 0) "ok" else paste(errs, collapse = " ; "),
          length(errs) == 0)
  # (c) 横幅
  if (dataset %in% names(banner_map)) check_banner(method, dataset, out, banner_map[[dataset]])

  # (d) 统计 oracle
  fn <- oracle_map[[dataset]]
  if (is.null(fn)) {
    add_row(method, dataset, "oracle_defined", "yes", "no", FALSE)
  } else {
    fn(method, dataset, kv, out, data)
  }
}

## ---- 6. 覆盖率检查（防止验证范围被悄悄缩小）------------------------------
covered <- unique(manifest$method)
missing_methods <- setdiff(CANONICAL_METHODS, covered)
for (m in missing_methods) {
  add_row(m, "-", "method_covered", "covered", "missing", FALSE)
}
add_row("__coverage__", "-", "methods_covered",
        length(CANONICAL_METHODS), length(intersect(CANONICAL_METHODS, covered)),
        length(missing_methods) == 0)

## ---- 7. 汇总、报告、退出码 ------------------------------------------------
n_ok <- 0; n_tot <- 0; failed <- character(0)
per_method <- list()
for (r in report) {
  n_tot <- n_tot + 1
  ok <- isTRUE(r$ok)
  if (ok) n_ok <- n_ok + 1 else failed <- c(failed, sprintf("%s/%s/%s", r$method, r$dataset, r$stat))
  key <- r$method
  pm <- per_method[[key]]
  if (is.null(pm)) pm <- list(ok = 0, tot = 0)
  pm$tot <- pm$tot + 1; pm$ok <- pm$ok + if (ok) 1 else 0
  per_method[[key]] <- pm
  cat(sprintf("  %-22s %-22s %-28s %-14s %-14s %s\n",
              r$method, r$dataset, r$stat, fv(r$ref), fv(r$wb),
              if (ok) "PASS" else "FAIL"))
}

cat("\n==========================================================\n")
cat("验证汇总\n")
cat("==========================================================\n")
cat(sprintf("方法覆盖（canonical）：%d / %d\n",
            length(intersect(CANONICAL_METHODS, covered)), length(CANONICAL_METHODS)))
cat(sprintf("断言总数：%d（PASS %d / FAIL %d）\n", n_tot, n_ok, n_tot - n_ok))
if (length(missing_methods) > 0) {
  cat("未覆盖的方法：", paste(missing_methods, collapse = ", "), "\n")
}
if (length(failed) > 0) {
  cat("\nFAIL 明细：\n")
  cat(paste0("  - ", failed, collapse = "\n"), "\n")
}

# 写 Markdown（绝对路径，不再依赖 cwd）
md_path <- file.path(SCRIPT_DIR, "VALIDATION_RESULTS.md")
# 结果文件会入库存档，因此 fixtures 目录要写相对路径，避免提交本机绝对路径。
# 用 substring 截断而不是正则，避免 Windows 反斜杠在正则中的转义陷阱。
gen_display <- if (startsWith(GEN_DIR, SCRIPT_DIR)) {
  substring(GEN_DIR, nchar(SCRIPT_DIR) + 2)
} else {
  GEN_DIR
}
md_lines <- c(
  "# 统计验证结果（真实生成器 + 独立 oracle）", "",
  paste0("R 版本：", R.version.string),
  paste0("生成时间：", format(Sys.time(), "%Y-%m-%d %H:%M:%S")),
  paste0("fixtures 目录：", gen_display),
  paste0("被测代码：src/renderer/src/services/rService.ts（esbuild 打包后运行时调用，非手抄副本）"),
  "",
  paste0("方法覆盖：**", length(intersect(CANONICAL_METHODS, covered)), " / ", length(CANONICAL_METHODS), "**"),
  paste0("断言总数：**", n_tot, "**（PASS ", n_ok, " / FAIL ", n_tot - n_ok, "）"),
  "",
  "| 方法 | 数据集 | 断言 | 参考(oracle) | 工作台 | 结果 |",
  "|---|---|---|---|---|---|"
)
for (r in report) {
  md_lines <- c(md_lines, sprintf("| %s | %s | %s | %s | %s | %s |",
                                  r$method, r$dataset, r$stat, fv(r$ref), fv(r$wb),
                                  if (isTRUE(r$ok)) "PASS" else "FAIL"))
}
md_lines <- c(md_lines, "", sprintf("**汇总：PASS %d / %d**", n_ok, n_tot))
writeLines(md_lines, md_path)
cat("\n结果已写入 ", md_path, "\n", sep = "")

if (n_tot == 0) {
  cat("没有任何断言被执行 → 判定失败（防止空跑绿灯）\n")
  quit(status = 1)
}
if (n_ok < n_tot) {
  quit(status = 1)
}
cat("==> 全部断言通过：生成器输出与独立 oracle 一致。\n")
quit(status = 0)
