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

## 期望覆盖的 13 个方法（少一个即 FAIL，防止验证范围被悄悄缩小）
CANONICAL_METHODS <- c(
  "descriptive", "ttest_independent", "ttest_paired", "anova", "chisquare",
  "correlation", "regression", "reliability", "ttest_one", "normality",
  "nonparametric", "frequency", "summary_by"
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
  summary_by = oracle_summary_by
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
  summary_by = "=== 分类汇总 ==="
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
cat(sprintf("方法覆盖（canonical 13 个）：%d / %d\n",
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
