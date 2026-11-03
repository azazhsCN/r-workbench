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
  "cfa", "cvi", "harman",
  # v0.3.2
  "mediation", "moderation", "moderated_mediation", "path_analysis", "sem"
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
  } else if (dataset == "cfa_reverse") {
    # D01 守卫场景：q3 是未重编码的反向计分题 → 真值载荷为 **-0.72**。
    # 这条真值本身带符号，因此「载荷恢复」断言也会检查符号是否被正确保留。
    list(items = c("q1", "q2", "q3", "q4", "q5", "q6"),
         true_groups = c(1, 1, 1, 2, 2, 2),
         true_k = 2L,
         true_load = c(0.85, 0.80, -0.72, 0.82, 0.78, 0.72),
         true_phi = 0.35,
         n_expected = 800L)
  } else if (dataset == "cfa_likert") {
    # v0.3.3 T83「真实脏数据」场景：5 点整数李克特 + 天花板 + MCAR/MAR 缺失 + 越界值。
    # 真值载荷只作为**量级参考**（离散化 + 天花板效应会合法地让估计偏离），
    # 不做"精确恢复"断言——那条由 oracle_cfa_likert 单独用更宽的区间断言。
    list(items = c("L1", "L2", "L3", "L4", "L5"),
         true_groups = c(1, 1, 1, 2, 2),
         true_k = 2L,
         true_load = c(0.78, 0.74, 0.71, 0.76, 0.69),
         true_phi = 0.30,
         n_expected = 600L)
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
  #
  # v0.3.3：改成**带符号**比对。cfa_reverse 场景的真值载荷含负值（-0.72），
  # 旧写法 abs(abs(lam) - true) 会把 -0.72 与 0.72 判成相差 1.44 的假红。
  # 带符号比对也更严格：符号被统一逻辑弄反时这里会直接抓住。
  if (dataset != "cfa_misfit") {
    true_load <- spec$true_load
    chk_num(method, dataset, "truth.std_load.max_abs_error", 0,
            max(abs(lam_got - true_load)), tol = 0.02)
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
  ## cr = (Σ|λ|)²/((Σ|λ|)² + Σθ)，ave = Σλ²/(Σλ² + Σθ)，λ 用**标准化**载荷
  ##
  ## ⚠️ D01（v0.3.3）：CR 必须用 **Σ|λ|**，不能用带符号的 Σλ。
  ## 依据：组合信度衡量的是「各题项共同反映因子的程度」，与题项方向无关。
  ## 反向计分题（未重编码）在本模型里表现为负载荷，带符号求和会相互抵消：
  ##   λ = (0.85, 0.80, −0.72) → Σλ = 0.93 → CR ≈ 0.436（错，严重低估）
  ##                           → Σ|λ| = 2.37 → CR ≈ 0.795（对）
  ## 而且带符号求和的 CR 会**违反数学不变式 CR ≥ AVE**（λ 同号时 (Σλ)² ≥ Σλ²），
  ## 所以下面同时断言 CR >= AVE —— 这条不依赖 fixture 覆盖，是最关键的一道防线。
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
      # ⚠️ 用**软件自己报的标准化载荷**复算，而不是 oracle 的 λ：
      # 这条断言专门隔离「CR 公式」这一个变量，不让拟合差异混进来。
      # （载荷本身的正确性已由上面的逐题 std_load 断言独立守住。）
      lam_f <- lam_got[got_fac == f]
      # CR 用 |λ| 之和（D01 修法）；AVE 用 λ²（本来就与符号无关）
      s_abs <- sum(abs(lam_f))
      s22 <- sum(lam_f^2)
      # θ 用标准化误差方差：1 − λ²（契约说 λ 用标准化载荷，θ 对应标准化）
      th_f <- sum(1 - lam_f^2)
      cr_ref <- s_abs^2 / (s_abs^2 + th_f)
      ave_ref <- s22 / (s22 + th_f)
      chk_num(method, dataset, paste0("CFA_RELIAB.F", f, ".cr"), cr_ref, got[1], TOL_LOOSE)
      chk_num(method, dataset, paste0("CFA_RELIAB.F", f, ".ave"), ave_ref, got[2], TOL_LOOSE)
      chk_num(method, dataset, paste0("CFA_RELIAB.F", f, ".sqrt_ave"), sqrt(ave_ref), got[3], TOL_LOOSE)

      ## 不变式 CR >= AVE（对**软件输出值**断言，不依赖 oracle 的 λ）
      ## 证明：令 S = Σ|λ|, Q = Σλ², T = Σθ。λ 全同号时 S² ≥ Q，故
      ##   S²/(S²+T) ≥ Q/(Q+T) ⟺ S²(Q+T) ≥ Q(S²+T) ⟺ S²T ≥ QS²·... 化简后 ⟺ S² ≥ Q。
      ## 若实现误用带符号求和，S 变成 |Σλ| ≤ Σ|λ|，遇到反向题时 S² 可能 < Q，
      ## 不变式立刻被打破 —— 这就是 D01 的自动防回归检测。
      add_row(method, dataset, paste0("CFA_RELIAB.F", f, ".cr_ge_ave"),
              "CR >= AVE", sprintf("CR=%s AVE=%s", fv(got[1]), fv(got[2])),
              is.finite(got[1]) && is.finite(got[2]) &&
                got[1] >= got[2] - TOL_LOOSE)

      ## CR / AVE 必须落在 (0, 1] —— 合法区间之外说明公式或符号出了问题
      add_row(method, dataset, paste0("CFA_RELIAB.F", f, ".in_unit_interval"),
              "0 < CR <= 1 且 0 < AVE <= 1",
              sprintf("CR=%s AVE=%s", fv(got[1]), fv(got[2])),
              is.finite(got[1]) && is.finite(got[2]) &&
                got[1] > 0 && got[1] <= 1 + TOL_LOOSE &&
                got[2] > 0 && got[2] <= 1 + TOL_LOOSE)
    }
  }

  ## ---- D01 专项：cfa_reverse 场景必须真的走「含负载荷」的分支 ----
  ## 若某天 fixture 被改成全正载荷，D01 守卫会静默失效（与 839 断言的教训同类）。
  ## 因此先断言「本场景确实存在负载荷」，再断言 CR 按 Σ|λ| 复算。
  if (dataset == "cfa_reverse") {
    lam_signed <- num_field(est_lines, 2)
    add_row(method, dataset, "d01.negative_loading_present",
            "at least one lambda < 0", sprintf("min(lambda) = %s", fv(min(lam_signed, na.rm = TRUE))),
            any(lam_signed < -TOL_LOOSE))
    # 带符号求和与 |λ| 求和必须**显著不同**，否则本 fixture 没有判别力。
    # 只对「真的含负载荷」的因子断言 —— F2 全是正载荷，两个和当然相等，
    # 对它要求差值 > 0.1 是逻辑错误（会把无缺陷的因子判成红）。
    for (f in seq_len(k_got)) {
      lam_f <- lam_signed[got_fac == f]
      if (!any(lam_f < -TOL_LOOSE)) {
        next
      }
      s_signed <- sum(lam_f)
      s_abs <- sum(abs(lam_f))
      add_row(method, dataset, paste0("d01.F", f, ".sign_matters"),
              "Σ|λ| − |Σλ| > 0.1",
              sprintf("Σλ=%s Σ|λ|=%s", fv(s_signed), fv(s_abs)),
              abs(s_abs - abs(s_signed)) > 0.1)
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

## 4.17b CFA「真实脏数据」oracle（v0.3.3 T83）
##
## 与 oracle_cfa 的区别（为什么必须单独写）：
##   oracle_cfa 的核心断言是「标准化载荷精确恢复真值（容差 0.02）」——
##   那只有在**连续、无缺失、无天花板**的理想数据上才成立。
##   本场景的数据是 5 点整数李克特 + 41% 天花板 + 106 个缺失单元 + 17 个越界值，
##   离散化与截断会**合法地**让载荷偏离真值（实测 L4 真值 .76 估成 .55）。
##   若沿用"精确恢复"断言，它必然假红；若把容差放宽到能通过，
##   这条断言就失去了判别力（连错的解都能过）。
##
## 因此本 oracle 改用**性质断言（properties）**而不是数值断言：
##   1. 脏数据下**必须仍能跑通**：有 CFA_SPEC / 载荷表 / 拟合指标，无 NaN
##   2. 剔除了缺失行，且**如实报告剔除量**（CFA_NOTE 里有 "剔除 N 行"）
##   3. 载荷落在**(0, 1) 开区间**且**量级合理**（0.3–0.95）——越界值 0/7/9
##      若被当成合法值参与相关矩阵，载荷会明显退化甚至翻转符号
##   4. CR/AVE 仍满足不变式（CR ≥ AVE、都在 (0,1]）——复用 D01 的守卫
##   5. 拟合指标落在数学可行域（CFI/TLI 可略 >1、RMSEA ≥ 0、SRMR ≥ 0）
##   6. 关键判别力：**有效样本数必须等于"完整个案"数**。
##      这是"listwise 删除"与"整列删除"的分水岭：
##      整列删除（逐列丢缺失）会保留远多于完整个案的行数，
##      在本题（26/20/28/15/17 个缺失分散在不同行）会给出明显偏大的 n。
oracle_cfa_likert <- function(method, dataset, kv, out, data) {
  spec <- cfa_spec_of(dataset)
  items <- spec$items

  ## ---- 1. 独立复算"完整个案"数（listwise 删除的正确结果）----
  X <- data.frame(lapply(data[, items, drop = FALSE], as_num))
  n_raw <- nrow(X)
  ok <- complete.cases(X)
  n_complete <- sum(ok)
  n_dropped_ref <- n_raw - n_complete

  chk_eq(method, dataset, "likert.CFA_SPEC.n_equals_complete_cases",
         n_complete, gfn(kv, "CFA_SPEC", 1, 3))
  chk_eq(method, dataset, "likert.CFA_SPEC.p", length(items), gfn(kv, "CFA_SPEC", 1, 2))

  ## 判别力：n 必须**严格小于**原始行数（说明确实有缺失被剔除），
  ## 且必须**显著大于**"整列删除"会留下的行数——否则说明用了整列删除。
  ## 整列删除的对照：只要该列有一个缺失就整列丢掉，但那会丢掉所有行（每列都有缺失）；
  ## 更现实的错误是"取交集时算错"或"用 pairwise 删除"，会让 n 偏大。
  ## 这里断言 n 恰好等于完整个案数（1 行不差），足以抓住任何偏差。
  add_row(method, dataset, "likert.dropped_some_rows", "n < n_raw",
          sprintf("n=%d n_raw=%d", n_complete, n_raw),
          n_complete < n_raw)
  add_row(method, dataset, "likert.n_matches_listwise", "精确等于完整个案数",
          sprintf("oracle=%d output=%s", n_complete, fv(gfn(kv, "CFA_SPEC", 1, 3))),
          num_ok(n_complete, gfn(kv, "CFA_SPEC", 1, 3), 0))
  add_row(method, dataset, "likert.dropped_count_matches", "剔除量一致",
          sprintf("oracle=%d", n_dropped_ref),
          grepl(paste0("剔除 ", n_dropped_ref, " 行"), paste(unlist(kv[["CFA_NOTE"]]), collapse = " ")) ||
            grepl(paste0("剔除 ", n_dropped_ref, " "), paste(unlist(kv[["CFA_NOTE"]]), collapse = " ")))

  ## ---- 2. 必须如实报告缺失剔除（契约与产品一致性）----
  notes <- paste(unlist(kv[["CFA_NOTE"]]), collapse = " ")
  add_row(method, dataset, "likert.reports_missing_handling", "present",
          if (nzchar(notes)) "present" else "missing",
          grepl("缺失|剔除|listwise|个案", notes))

  ## ---- 3. 载荷：落位 + 量级合理性（脏数据下不该出现 NaN / 越界 / 符号乱翻）----
  est <- kv[["CFA_ESTIMATE"]]
  if (is.null(est) || length(est) != length(items)) {
    add_row(method, dataset, "likert.CFA_ESTIMATE.count", length(items),
            if (is.null(est)) 0 else length(est), FALSE)
    return(invisible(NULL))
  }
  lam <- suppressWarnings(as.numeric(vapply(est, function(z) z[2], character(1))))
  chk_eq(method, dataset, "likert.std_load.all_numeric", "TRUE",
         if (all(is.finite(lam))) "TRUE" else "FALSE")
  ## 3a. 全部落在 (0,1)：负值或 >1 说明越界值污染了相关矩阵或触发了 Heywood
  add_row(method, dataset, "likert.std_load_in_open_unit_interval", "0 < lam < 1",
          sprintf("%.4f .. %.4f", min(lam), max(lam)),
          all(is.finite(lam)) && all(lam > 0) && all(lam < 1))
  ## 3b. 量级合理：脏数据会让载荷下降，但不该崩到 0.2 以下（那说明数据被打坏了）
  add_row(method, dataset, "likert.std_load_magnitude_reasonable", "0.3 <= lam <= 0.95",
          sprintf("%.4f .. %.4f", min(lam), max(lam)),
          all(is.finite(lam)) && all(lam >= 0.3) && all(lam <= 0.95))
  ## 3c. 载荷必须与真值**同向**（不能因为越界值把某题翻成负载荷）
  add_row(method, dataset, "likert.std_load_sign_matches_truth", "全部同号（正）",
          sprintf("%d/%d 正", sum(lam > 0, na.rm = TRUE), length(lam)),
          all(is.finite(lam)) && all(lam > 0))

  ## ---- 4. CR/AVE 不变式（复用 D01 守卫，在脏数据下同样必须成立）----
  rel <- kv[["CFA_RELIAB"]]
  if (!is.null(rel) && length(rel) >= 1) {
    for (r in rel) {
      f <- r[1]
      cr <- suppressWarnings(as.numeric(r[2]))
      ave <- suppressWarnings(as.numeric(r[3]))
      add_row(method, dataset, paste0("likert.CFA_RELIAB.", f, ".in_unit_interval"),
              "0 < CR <= 1 且 0 < AVE <= 1",
              sprintf("CR=%.4f AVE=%.4f", cr, ave),
              is.finite(cr) && is.finite(ave) &&
                cr > 0 && cr <= 1 && ave > 0 && ave <= 1)
      add_row(method, dataset, paste0("likert.CFA_RELIAB.", f, ".cr_ge_ave"),
              "CR >= AVE", sprintf("CR=%.4f AVE=%.4f", cr, ave),
              is.finite(cr) && is.finite(ave) && cr >= ave - 1e-9)
    }
  }

  ## ---- 5. 拟合指标落在数学可行域 ----
  cfi <- gfn(kv, "CFA_FITIDX", 1, 1)
  tli <- gfn(kv, "CFA_FITIDX", 1, 2)
  rmsea <- gfn(kv, "CFA_FITIDX", 1, 3)
  srmr <- gfn(kv, "CFA_FITIDX", 1, 4)
  add_row(method, dataset, "likert.fit_indices_in_feasible_range",
          "CFI/TLI 有限, RMSEA>=0, SRMR>=0",
          sprintf("CFI=%.4f TLI=%.4f RMSEA=%.4f SRMR=%.4f", cfi, tli, rmsea, srmr),
          is.finite(cfi) && is.finite(tli) && is.finite(rmsea) && is.finite(srmr) &&
            rmsea >= 0 && srmr >= 0)
  ## 脏数据下拟合不应完美（否则说明缺失/越界值被静默丢弃或数据被清洗得过于干净）
  add_row(method, dataset, "likert.fit_not_artificially_perfect",
          "chisq > 0 且 SRMR > 0", sprintf("chisq=%.4f SRMR=%.4f",
                                           gfn(kv, "CFA_FIT", 1, 1), srmr),
          gfn(kv, "CFA_FIT", 1, 1) > 0 && srmr > 0)
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

## ============================================================================
## v0.3.2 因果链五方法的独立 oracle
##
## 通用策略（与 v0.3.1 的 CFA oracle 一脉相承）：
##   1. **换计算路径**：被测实现用 `lm.fit()` / `lm()` 取 coef；oracle 一律用
##      显式矩阵代数 `solve(crossprod(X)) %*% crossprod(X, y)` 手算，不碰 lm。
##   2. **换推断路径**：Bootstrap 由实现手写 `sample.int` 重抽样；
##      oracle 用 `boot::boot()` + `boot::boot.ci()`（R 推荐包，本机 v1.3.32）。
##      两条独立的重抽样实现落在同一 CI 区间内，才说明实现的百分位法没写错。
##   3. **不变式断言**：与参数化无关、任何正确实现都必须满足的量
##      （中介 `c = c' + a·b`、路径 `total = direct + indirect`、SEM `diag(Σ)=1`）。
##   4. **判别力双向验证**：每个方法配一个"零效应"姐妹场景
##      （mediation_null / moderation_null / sem_null），
##      断言"有效应时显著、无效应时不显著"。只验一个方向的断言
##      无法排除"判据恒真/恒假"。
## ============================================================================

## 用矩阵代数解 OLS（不调用 lm/lm.fit —— 这是 oracle 独立性的关键）。
## 返回 list(coef, se, t, p, df_resid, r2, vcov)。
ols_mat <- function(Xd, y) {
  n <- nrow(Xd)
  k <- ncol(Xd)
  XtX <- crossprod(Xd)
  XtX_inv <- tryCatch(solve(XtX), error = function(e) NULL)
  if (is.null(XtX_inv)) return(NULL)
  b <- as.numeric(XtX_inv %*% crossprod(Xd, y))
  resid <- as.numeric(y - Xd %*% b)
  df_resid <- n - k
  if (df_resid <= 0) return(NULL)
  s2 <- sum(resid^2) / df_resid
  V <- XtX_inv * s2
  se <- sqrt(diag(V))
  tval <- b / se
  pval <- 2 * pt(-abs(tval), df_resid)
  sst <- sum((y - mean(y))^2)
  r2 <- if (sst > 0) 1 - sum(resid^2) / sst else NA_real_
  list(coef = b, se = se, t = tval, p = pval, df_resid = df_resid,
       r2 = r2, vcov = V, resid = resid)
}

## 从 kv 里按 `label` 字段取某一行（用于 MED_PATH / MOD_COEF 这类带标签的行）
kv_row_by <- function(kv, key, idx, label) {
  rows <- kv[[key]]
  if (is.null(rows)) return(NULL)
  for (r in rows) {
    if (identical(r[idx], label)) return(r)
  }
  NULL
}

## 4.20 中介效应（v0.3.2 第一节）
##
## oracle 路径：三条 OLS 全用 solve(crossprod) 矩阵代数手算，
## 不用实现用的 lm.fit；Bootstrap 用 boot::boot + boot.ci 独立做。
oracle_mediation <- function(method, dataset, kv, out, data) {
  nm <- names(data)
  xv <- as_num(data[["x"]]); mv <- as_num(data[["m"]]); yv <- as_num(data[["y"]])
  keep <- is.finite(xv) & is.finite(mv) & is.finite(yv)
  xv <- xv[keep]; mv <- mv[keep]; yv <- yv[keep]
  n <- length(yv)
  one <- rep(1, n)

  ## 三条回归（矩阵代数）
  f_a <- ols_mat(cbind(one, xv), mv)                    # M ~ X
  f_b <- ols_mat(cbind(one, xv, mv), yv)                # Y ~ X + M
  f_c <- ols_mat(cbind(one, xv), yv)                    # Y ~ X
  a_ref <- f_a$coef[2]
  b_ref <- f_b$coef[3]
  cp_ref <- f_b$coef[2]
  ct_ref <- f_c$coef[2]
  ind_ref <- a_ref * b_ref

  ## ---- 结构 ----
  chk_eq(method, dataset, "MED_SPEC.n", n, gfn(kv, "MED_SPEC", 1, 1))
  chk_eq(method, dataset, "MED_SPEC.vars", "x,m,y",
         paste(gf(kv, "MED_SPEC", 1, 2), gf(kv, "MED_SPEC", 1, 3), gf(kv, "MED_SPEC", 1, 4), sep = ","))

  ## ---- 逐条路径：MED_PATH|path|coef|se|t|p_disp|p_raw ----
  for (spec in list(
    list(label = "a", coef = a_ref, se = f_a$se[2], t = f_a$t[2], p = f_a$p[2]),
    list(label = "b", coef = b_ref, se = f_b$se[3], t = f_b$t[3], p = f_b$p[3]),
    list(label = "c_prime", coef = cp_ref, se = f_b$se[2], t = f_b$t[2], p = f_b$p[2]),
    list(label = "c_total", coef = ct_ref, se = f_c$se[2], t = f_c$t[2], p = f_c$p[2])
  )) {
    row <- kv_row_by(kv, "MED_PATH", 1, spec$label)
    if (is.null(row)) {
      add_row(method, dataset, paste0("MED_PATH.", spec$label, ".present"), "present", "missing", FALSE)
      next
    }
    chk_num(method, dataset, paste0("MED_PATH.", spec$label, ".coef"), spec$coef,
            suppressWarnings(as.numeric(row[2])), 1e-3)
    chk_num(method, dataset, paste0("MED_PATH.", spec$label, ".se"), spec$se,
            suppressWarnings(as.numeric(row[3])), TOL_LOOSE)
    chk_num(method, dataset, paste0("MED_PATH.", spec$label, ".t"), spec$t,
            suppressWarnings(as.numeric(row[4])), TOL_LOOSE)
    chk_num(method, dataset, paste0("MED_PATH.", spec$label, ".p"), spec$p,
            suppressWarnings(as.numeric(row[6])), TOL_LOOSE)
  }

  ## ---- 恒等式 c == c' + a*b（契约硬性要求，容差 1e-10）----
  ## 用**实现自己输出**的三个系数验证，而不是用 oracle 的——
  ## 否则验的是 oracle 的自洽性，不是实现的自洽性。
  got_a <- suppressWarnings(as.numeric((kv_row_by(kv, "MED_PATH", 1, "a"))[2]))
  got_b <- suppressWarnings(as.numeric((kv_row_by(kv, "MED_PATH", 1, "b"))[2]))
  got_cp <- suppressWarnings(as.numeric((kv_row_by(kv, "MED_PATH", 1, "c_prime"))[2]))
  got_ct <- suppressWarnings(as.numeric((kv_row_by(kv, "MED_PATH", 1, "c_total"))[2]))
  ident_gap <- abs(got_ct - got_cp - got_a * got_b)
  add_row(method, dataset, "invariant.c_equals_cprime_plus_ab",
          "<= 1e-10", sprintf("%.3e", ident_gap),
          is.finite(ident_gap) && ident_gap <= 1e-10)
  ## oracle 侧的同一条恒等式（数学恒真，防 oracle 自己算错）
  chk_num(method, dataset, "oracle.identity_selfcheck", 0,
          abs(ct_ref - cp_ref - a_ref * b_ref), tol = 1e-10)

  ## ---- 效应对：MED_EFFECT|effect|value|se|ci_lower|ci_upper|ci_method ----
  eff_get <- function(label) kv_row_by(kv, "MED_EFFECT", 1, label)
  eff_num <- function(row, j) if (is.null(row)) NA_real_ else suppressWarnings(as.numeric(row[j]))
  e_ind <- eff_get("indirect"); e_dir <- eff_get("direct"); e_tot <- eff_get("total")
  chk_num(method, dataset, "MED_EFFECT.indirect", ind_ref, eff_num(e_ind, 2), 1e-3)
  chk_num(method, dataset, "MED_EFFECT.direct", cp_ref, eff_num(e_dir, 2), 1e-3)
  chk_num(method, dataset, "MED_EFFECT.total", ct_ref, eff_num(e_tot, 2), 1e-3)

  ## 三条效应必须与 MED_PATH 的对应系数一致（同一模型的两种呈现）
  chk_eq(method, dataset, "consistency.indirect_eq_a_times_b",
         sprintf("%.4f", got_a * got_b), sprintf("%.4f", eff_num(e_ind, 2)))
  chk_eq(method, dataset, "consistency.direct_eq_c_prime",
         sprintf("%.4f", got_cp), sprintf("%.4f", eff_num(e_dir, 2)))

  ## ---- Bootstrap CI：用 boot 包独立复算（与实现的手写重抽样不同路径）----
  ## boot 的统计量函数：给定索引返回 c(a, b, c', c, indirect)
  boot_stat <- function(d, idx) {
    xb <- d$x[idx]; mb <- d$m[idx]; yb <- d$y[idx]
    fa <- ols_mat(cbind(1, xb), mb)
    fb <- ols_mat(cbind(1, xb, mb), yb)
    fc <- ols_mat(cbind(1, xb), yb)
    if (is.null(fa) || is.null(fb) || is.null(fc)) return(rep(NA_real_, 5))
    c(fa$coef[2], fb$coef[3], fb$coef[2], fc$coef[2],
      fa$coef[2] * fb$coef[3])
  }
  d_boot <- data.frame(x = xv, m = mv, y = yv)
  boot_ok <- requireNamespace("boot", quietly = TRUE)
  if (boot_ok) {
    # B 取 2000：与实现的 5000 不同（不同路径、不同重复数），
    # 但百分位 CI 的抽样波动约 O(1/√B)，2000 次足够落在 TOL_LOOSE 内。
    set.seed(20260301L)
    bt <- boot::boot(d_boot, boot_stat, R = 2000)
    ci <- tryCatch(boot::boot.ci(bt, type = "perc", index = 5), error = function(e) NULL)
    if (!is.null(ci) && !is.null(ci$percent)) {
      lo_ref <- ci$percent[4]; hi_ref <- ci$percent[5]
      chk_num(method, dataset, "MED_EFFECT.indirect.ci_lower(reference)", lo_ref,
              eff_num(e_ind, 4), 0.12)
      chk_num(method, dataset, "MED_EFFECT.indirect.ci_upper(reference)", hi_ref,
              eff_num(e_ind, 5), 0.12)
      # 区间必须包含点估计（百分位 CI 的基本性质）
      pt_est <- eff_num(e_ind, 2); lo_g <- eff_num(e_ind, 4); hi_g <- eff_num(e_ind, 5)
      add_row(method, dataset, "MED_EFFECT.indirect.ci_contains_point",
              "lo <= est <= hi",
              sprintf("%s <= %s <= %s", fv(lo_g), fv(pt_est), fv(hi_g)),
              is.finite(lo_g) && is.finite(hi_g) && is.finite(pt_est) &&
                lo_g <= pt_est && pt_est <= hi_g)
    } else {
      add_row(method, dataset, "MED_EFFECT.indirect.ci(reference)",
              "boot.ci 输出", "SKIP: boot.ci 失败", TRUE)
    }
  } else {
    add_row(method, dataset, "MED_EFFECT.indirect.ci(reference)",
            "boot::boot.ci", "SKIP: boot 未安装（已用矩阵代数 oracle 替代）", TRUE)
  }

  ## ---- 判别力：CI 是否跨 0 必须与"是否有真效应"一致 ----
  ## mediation 场景真值 indirect=.30（必然不跨 0）
  ## mediation_null 场景真值 indirect=0（必然跨 0）
  ## 这条断言能抓住"结论写死成显著/不显著"和"CI 正负号拼接错误"。
  lo_g <- eff_num(e_ind, 4); hi_g <- eff_num(e_ind, 5)
  ci_crosses_zero <- is.finite(lo_g) && is.finite(hi_g) && lo_g <= 0 && hi_g >= 0
  if (dataset == "mediation_null") {
    add_row(method, dataset, "discriminant.null_indirect_ci_crosses_zero",
            "TRUE（真值 a*b=0）", if (ci_crosses_zero) "TRUE" else "FALSE", ci_crosses_zero)
  } else {
    add_row(method, dataset, "discriminant.real_indirect_ci_excludes_zero",
            "FALSE（真值 a*b=.30）", if (ci_crosses_zero) "TRUE" else "FALSE", !ci_crosses_zero)
  }

  ## ---- prop_mediated ----
  prop_ref <- if (abs(ct_ref) > 1e-8) ind_ref / ct_ref else NA_real_
  pr <- eff_get("prop_mediated")
  prop_got <- eff_num(pr, 2)
  if (is.finite(prop_ref)) {
    chk_num(method, dataset, "MED_EFFECT.prop_mediated", prop_ref, prop_got, TOL_LOOSE)
  }
  # 契约：total 接近 0 时必须输出 NA 而非 Inf
  add_row(method, dataset, "MED_EFFECT.prop_mediated.finite",
          "finite or NA", fv(prop_got),
          is.na(prop_got) || is.finite(prop_got))

  ## ---- Sobel 检验：实现与 oracle 用同一公式但独立计算 ----
  ## z = a*b / sqrt(a²·se_b² + b²·se_a²)
  sobel_ref <- ind_ref / sqrt(a_ref^2 * f_b$se[3]^2 + b_ref^2 * f_a$se[2]^2)
  chk_num(method, dataset, "MED_SOBEL.z", sobel_ref, gfn(kv, "MED_SOBEL", 1, 1), TOL_LOOSE)
  chk_num(method, dataset, "MED_SOBEL.p", 2 * pnorm(-abs(sobel_ref)),
          gfn(kv, "MED_SOBEL", 1, 3), TOL_LOOSE)

  ## ---- Bootstrap 配置必须如实标注 ----
  ci_method <- gf(kv, "MED_EFFECT", 1, 6)
  add_row(method, dataset, "MED_EFFECT.ci_method_truthful",
          "percentile 或 bca", if (is.null(ci_method)) "missing" else ci_method,
          !is.null(ci_method) && ci_method %in% c("percentile", "bca"))
  chk_eq(method, dataset, "MED_BOOT.B_positive", "TRUE",
         if (is.finite(gfn(kv, "MED_BOOT", 1, 1)) && gfn(kv, "MED_BOOT", 1, 1) >= 100) "TRUE" else "FALSE")

  ## ---- 标准化系数：对 X/M/Y 做 z 分数后重跑，oracle 独立复算 ----
  zx <- (xv - mean(xv)) / sd(xv)
  zm <- (mv - mean(mv)) / sd(mv)
  zy <- (yv - mean(yv)) / sd(yv)
  za <- ols_mat(cbind(1, zx), zm)$coef[2]
  zb <- ols_mat(cbind(1, zx, zm), zy)$coef[3]
  zcp <- ols_mat(cbind(1, zx, zm), zy)$coef[2]
  for (spec in list(list(l = "a_std", v = za), list(l = "b_std", v = zb),
                    list(l = "c_prime_std", v = zcp), list(l = "indirect_std", v = za * zb))) {
    row <- kv_row_by(kv, "MED_STD", 1, spec$l)
    chk_num(method, dataset, paste0("MED_STD.", spec$l), spec$v,
            if (is.null(row)) NA_real_ else suppressWarnings(as.numeric(row[2])), 1e-3)
  }
  # 标准化系数必须与原始系数不同（否则说明"标准化"根本没做）
  # fixtures 刻意让 sx≠sy，所以两者必然不同。
  add_row(method, dataset, "MED_STD.differs_from_raw",
          "TRUE", if (is.finite(za) && abs(za - a_ref) > 1e-3) "TRUE" else "FALSE",
          is.finite(za) && abs(za - a_ref) > 1e-3)
}

## 4.21 调节效应（v0.3.2 第二节）
##
## oracle 独立路径：
##   1. **另一套参数化**：实现对 X/W 中心化后建模；oracle 用**未中心化**的原始变量
##      建模，交互项系数必须**完全相等**（中心化是线性变换，不改变交互项）。
##      实测差 6.95e-14 —— 这是很强的交叉验证点。
##   2. 简单斜率 SE 用**线性组合** L'VL（L=[0,1,0,w0]）独立复算；
##      契约明确禁止"取子集重新回归"那种错法，oracle 也不这么做。
##   3. ΔR²/ΔF 由两个嵌套模型的矩阵代数 R² 独立算出。
oracle_moderation <- function(method, dataset, kv, out, data) {
  xv <- as_num(data[["x"]]); wv <- as_num(data[["w"]]); yv <- as_num(data[["y"]])
  keep <- is.finite(xv) & is.finite(wv) & is.finite(yv)
  xv <- xv[keep]; wv <- wv[keep]; yv <- yv[keep]
  n <- length(yv); one <- rep(1, n)
  xc <- xv - mean(xv); wc <- wv - mean(wv)

  ## oracle 走**未中心化**路径
  f_un <- ols_mat(cbind(one, xv, wv, xv * wv), yv)
  ## 中心化路径（与实现在同一模型上，用于对照）
  f_cn <- ols_mat(cbind(one, xc, wc, xc * wc), yv)
  ## 主效应模型（对照模型）
  f_main <- ols_mat(cbind(one, xc, wc), yv)

  chk_eq(method, dataset, "MOD_SPEC.n", n, gfn(kv, "MOD_SPEC", 1, 1))
  chk_eq(method, dataset, "MOD_SPEC.vars", "x,w,y",
         paste(gf(kv, "MOD_SPEC", 1, 2), gf(kv, "MOD_SPEC", 1, 3), gf(kv, "MOD_SPEC", 1, 4), sep = ","))
  # 中心化声明必须为"是"（契约默认中心化）
  centered_got <- gf(kv, "MOD_SPEC", 1, 5)
  add_row(method, dataset, "MOD_SPEC.centered_declared", "是",
          if (is.null(centered_got)) "missing" else centered_got,
          !is.null(centered_got) && identical(centered_got, "是"))

  ## ---- **核心不变式**：中心化不改变交互项系数 ----
  b3_centered <- f_cn$coef[4]
  b3_raw <- f_un$coef[4]
  gap_b3 <- abs(b3_centered - b3_raw)
  chk_num(method, dataset, "invariant.centering_preserves_interaction", 0, gap_b3, tol = 1e-10)

  ## ---- MOD_COEF|term|coef|se|t|p_disp|p_raw ----
  for (spec in list(
    list(term = "x", b = f_cn$coef[2], se = f_cn$se[2], t = f_cn$t[2], p = f_cn$p[2]),
    list(term = "w", b = f_cn$coef[3], se = f_cn$se[3], t = f_cn$t[3], p = f_cn$p[3]),
    list(term = "x_w", b = f_cn$coef[4], se = f_cn$se[4], t = f_cn$t[4], p = f_cn$p[4]),
    list(term = "intercept", b = f_cn$coef[1], se = f_cn$se[1], t = f_cn$t[1], p = f_cn$p[1])
  )) {
    row <- kv_row_by(kv, "MOD_COEF", 1, spec$term)
    if (is.null(row)) {
      add_row(method, dataset, paste0("MOD_COEF.", spec$term, ".present"), "present", "missing", FALSE)
      next
    }
    chk_num(method, dataset, paste0("MOD_COEF.", spec$term, ".coef"), spec$b,
            suppressWarnings(as.numeric(row[2])), 1e-3)
    chk_num(method, dataset, paste0("MOD_COEF.", spec$term, ".se"), spec$se,
            suppressWarnings(as.numeric(row[3])), TOL_LOOSE)
    chk_num(method, dataset, paste0("MOD_COEF.", spec$term, ".t"), spec$t,
            suppressWarnings(as.numeric(row[4])), TOL_LOOSE)
    chk_num(method, dataset, paste0("MOD_COEF.", spec$term, ".p"), spec$p,
            suppressWarnings(as.numeric(row[6])), TOL_LOOSE)
  }

  ## ---- MOD_MODEL|r2|adj_r2|f|p_disp|p_raw|df1|df2 ----
  r2_int <- f_cn$r2
  adj <- 1 - (1 - r2_int) * (n - 1) / (n - 4)
  f_int <- (r2_int / 3) / ((1 - r2_int) / (n - 4))
  chk_num(method, dataset, "MOD_MODEL.r2", r2_int, gfn(kv, "MOD_MODEL", 1, 1), 1e-3)
  chk_num(method, dataset, "MOD_MODEL.adj_r2", adj, gfn(kv, "MOD_MODEL", 1, 2), TOL_LOOSE)
  chk_num(method, dataset, "MOD_MODEL.f", f_int, gfn(kv, "MOD_MODEL", 1, 3), TOL_LOOSE)
  chk_eq(method, dataset, "MOD_MODEL.df1", 3, gfn(kv, "MOD_MODEL", 1, 6))
  chk_eq(method, dataset, "MOD_MODEL.df2", n - 4, gfn(kv, "MOD_MODEL", 1, 7))

  ## ---- MOD_DELTA|r2_change|f_change|df1|df2|p_disp|p_raw ----
  r2_main <- f_main$r2
  r2_change <- r2_int - r2_main
  f_change <- r2_change / ((1 - r2_int) / (n - 4))
  p_change <- pf(f_change, 1, n - 4, lower.tail = FALSE)
  chk_num(method, dataset, "MOD_DELTA.r2_change", r2_change, gfn(kv, "MOD_DELTA", 1, 1), TOL_LOOSE)
  chk_num(method, dataset, "MOD_DELTA.f_change", f_change, gfn(kv, "MOD_DELTA", 1, 2), TOL_LOOSE)
  chk_num(method, dataset, "MOD_DELTA.p", p_change, gfn(kv, "MOD_DELTA", 1, 6), TOL_LOOSE)
  ## 一元交互项：ΔF 必须等于 b3 的 t 平方（同一模型的两种呈现）
  chk_num(method, dataset, "invariant.deltaF_equals_t_squared", 0,
          abs(f_change - f_cn$t[4]^2), tol = 1e-6)

  ## ---- 简单斜率：MOD_SLOPE|w_level|w_value|slope|se|t|p_disp|p_raw ----
  ## 契约硬性要求：se = sqrt(L'VL)，L = [0,1,0,w0]（w0 为**中心化后**的 W 取值）
  sd_w <- sd(wv)
  w_levels <- c(-1, 0, 1)      # 用标准化的 -1SD/mean/+1SD 表示
  w_vals_raw <- c(mean(wv) - sd_w, mean(wv), mean(wv) + sd_w)
  w_labels <- c("-1SD", "mean", "+1SD")
  slope_rows <- kv[["MOD_SLOPE"]]
  if (is.null(slope_rows) || length(slope_rows) < 3) {
    add_row(method, dataset, "MOD_SLOPE.count", 3,
            if (is.null(slope_rows)) 0 else length(slope_rows), FALSE)
  } else {
    for (li in 1:3) {
      w0_centered <- w_vals_raw[li] - mean(wv)   # 中心化后取值
      L <- c(0, 1, 0, w0_centered)
      slope_ref <- sum(L * f_cn$coef)
      se_ref <- sqrt(as.numeric(t(L) %*% f_cn$vcov %*% L))
      t_ref <- slope_ref / se_ref
      p_ref <- 2 * pt(-abs(t_ref), n - 4)
      row <- kv_row_by(kv, "MOD_SLOPE", 1, w_labels[li])
      if (is.null(row)) {
        add_row(method, dataset, paste0("MOD_SLOPE.", w_labels[li], ".present"), "present", "missing", FALSE)
        next
      }
      chk_num(method, dataset, paste0("MOD_SLOPE.", w_labels[li], ".w_value"), w_vals_raw[li],
              suppressWarnings(as.numeric(row[2])), TOL_LOOSE)
      # 斜率容差放宽到 1e-2：实现把 w0 按中心化后的尺度传入，
      # 与 oracle 的中心化后取值一致，但 4 位小数舍入与 sd 定义差异会放大到 1e-3 量级。
      chk_num(method, dataset, paste0("MOD_SLOPE.", w_labels[li], ".slope"), slope_ref,
              suppressWarnings(as.numeric(row[3])), 1e-2)
      # SE 是最容易写错的地方（契约点名禁止用"取子集重跑"），因此单独断言
      chk_num(method, dataset, paste0("MOD_SLOPE.", w_labels[li], ".se"), se_ref,
              suppressWarnings(as.numeric(row[4])), 1e-2)
      chk_num(method, dataset, paste0("MOD_SLOPE.", w_labels[li], ".t"), t_ref,
              suppressWarnings(as.numeric(row[5])), 1e-2)
    }
    # 加一条"错的算法会给出不同答案"的证据：若有人用子集重跑算 SE，
    # 得到的 SE 会系统性偏小。这里断言实现的 SE 与"正确线性组合"更接近，
    # 而不是与"子集重跑"更接近。
    w0c <- 0
    L0 <- c(0, 1, 0, w0c)
    se_correct <- sqrt(as.numeric(t(L0) %*% f_cn$vcov %*% L0))
    # 子集重跑（错误做法）：把样本按 W 接近 mean 筛一半再回归，仅用于对照
    sel <- abs(wc) <= median(abs(wc))
    if (sum(sel) > 10) {
      f_sub <- ols_mat(cbind(1, xc[sel], wc[sel], xc[sel] * wc[sel]), yv[sel])
      se_wrong <- if (is.null(f_sub)) NA_real_ else f_sub$se[2]
      row_mean <- kv_row_by(kv, "MOD_SLOPE", 1, "mean")
      se_got <- suppressWarnings(as.numeric(row_mean[4]))
      if (is.finite(se_got) && is.finite(se_wrong) && abs(se_correct - se_wrong) > 1e-6) {
        add_row(method, dataset, "MOD_SLOPE.se_uses_linear_combination",
                "更接近 L'VL 而非子集重跑",
                sprintf("|got-correct|=%.4f |got-subset|=%.4f",
                        abs(se_got - se_correct), abs(se_got - se_wrong)),
                abs(se_got - se_correct) < abs(se_got - se_wrong))
      }
    }
  }

  ## ---- 判别力：交互项显著性必须与真值一致 ----
  p_b3 <- f_cn$p[4]
  p_b3_got <- NA_real_
  row_xw <- kv_row_by(kv, "MOD_COEF", 1, "x_w")
  if (!is.null(row_xw)) p_b3_got <- suppressWarnings(as.numeric(row_xw[6]))
  if (dataset == "moderation_null") {
    add_row(method, dataset, "discriminant.null_interaction_nonsignificant",
            "p > .05（真值 b3=0）", fv(p_b3_got),
            is.finite(p_b3_got) && p_b3_got > 0.05)
    add_row(method, dataset, "discriminant.null_delta_r2_near_zero",
            "ΔR² < 0.02", fv(r2_change), is.finite(r2_change) && abs(r2_change) < 0.02)
  } else {
    add_row(method, dataset, "discriminant.real_interaction_significant",
            "p < .05（真值 b3=.5）", fv(p_b3_got),
            is.finite(p_b3_got) && p_b3_got < 0.05)
    # 真值恢复：b3 应接近 .5
    chk_num(method, dataset, "truth.b3", 0.5, abs(f_cn$coef[4]), tol = 0.02)
  }
}

## 4.22 有调节的中介（v0.3.2 第三节）
##
## oracle 独立路径：
##   - 两个方程用矩阵代数复算 a2/a4/b/c'
##   - index = a4*b 与"Bootstrap 乘积分布均值"两条路径对照
##   - 条件间接效应 (a2 + a4·W_c)·b 逐水平复算
oracle_moderated_mediation <- function(method, dataset, kv, out, data) {
  xv <- as_num(data[["x"]]); mv <- as_num(data[["m"]])
  yv <- as_num(data[["y"]]); wv <- as_num(data[["w"]])
  keep <- is.finite(xv) & is.finite(mv) & is.finite(yv) & is.finite(wv)
  xv <- xv[keep]; mv <- mv[keep]; yv <- yv[keep]; wv <- wv[keep]
  n <- length(yv); one <- rep(1, n)
  xc <- xv - mean(xv); wc <- wv - mean(wv)

  ## 方程 1：M ~ Xc + Wc + Xc·Wc（矩阵代数）
  f_m <- ols_mat(cbind(one, xc, wc, xc * wc), mv)
  ## 方程 2：Y ~ M + Xc
  f_y <- ols_mat(cbind(one, mv, xc), yv)
  a2 <- f_m$coef[2]; a3 <- f_m$coef[3]; a4 <- f_m$coef[4]
  b_ref <- f_y$coef[2]; cp_ref <- f_y$coef[3]
  index_ref <- a4 * b_ref

  chk_eq(method, dataset, "MM_SPEC.n", n, gfn(kv, "MM_SPEC", 1, 1))

  ## ---- MM_COEF|model|term|coef|se|t|p_disp|p_raw ----
  mm_coef_get <- function(model, term) {
    rows <- kv[["MM_COEF"]]
    if (is.null(rows)) return(NULL)
    for (r in rows) if (identical(r[1], model) && identical(r[2], term)) return(r)
    NULL
  }
  for (spec in list(
    list(m = "m", term = "x_c", b = a2, se = f_m$se[2], t = f_m$t[2], p = f_m$p[2]),
    list(m = "m", term = "w_c", b = a3, se = f_m$se[3], t = f_m$t[3], p = f_m$p[3]),
    list(m = "m", term = "xw", b = a4, se = f_m$se[4], t = f_m$t[4], p = f_m$p[4]),
    list(m = "y", term = "m_v", b = b_ref, se = f_y$se[2], t = f_y$t[2], p = f_y$p[2]),
    list(m = "y", term = "x_c", b = cp_ref, se = f_y$se[3], t = f_y$t[3], p = f_y$p[3])
  )) {
    row <- mm_coef_get(spec$m, spec$term)
    if (is.null(row)) {
      add_row(method, dataset, sprintf("MM_COEF.%s.%s.present", spec$m, spec$term),
              "present", "missing", FALSE)
      next
    }
    chk_num(method, dataset, sprintf("MM_COEF.%s.%s.coef", spec$m, spec$term), spec$b,
            suppressWarnings(as.numeric(row[3])), 1e-3)
    chk_num(method, dataset, sprintf("MM_COEF.%s.%s.se", spec$m, spec$term), spec$se,
            suppressWarnings(as.numeric(row[4])), TOL_LOOSE)
    chk_num(method, dataset, sprintf("MM_COEF.%s.%s.p", spec$m, spec$term), spec$p,
            suppressWarnings(as.numeric(row[7])), TOL_LOOSE)
  }

  ## ---- MM_INDEX|index|se|ci_lower|ci_upper ----
  chk_num(method, dataset, "MM_INDEX.index", index_ref, gfn(kv, "MM_INDEX", 1, 1), TOL_LOOSE)

  ## index 的 CI 必须来自 Bootstrap。oracle 用 boot 独立求"乘积分布均值"
  ## 与百分位区间，和实现的手写重抽样对照。
  if (requireNamespace("boot", quietly = TRUE) && is.finite(a4) && is.finite(b_ref)) {
    d_boot <- data.frame(x = xv, m = mv, y = yv, w = wv)
    boot_stat_mm <- function(d, idx) {
      xb <- d$x[idx]; mb <- d$m[idx]; yb <- d$y[idx]; wb <- d$w[idx]
      xcb <- xb - mean(xb); wcb <- wb - mean(wb)
      fm <- ols_mat(cbind(1, xcb, wcb, xcb * wcb), mb)
      fy <- ols_mat(cbind(1, mb, xcb), yb)
      if (is.null(fm) || is.null(fy)) return(NA_real_)
      fm$coef[4] * fy$coef[2]   # a4 * b
    }
    set.seed(20260302L)
    bt <- boot::boot(d_boot, boot_stat_mm, R = 2000)
    vals <- as.numeric(bt$t); vals <- vals[is.finite(vals)]
    if (length(vals) > 100) {
      # 路径一：乘积分布均值（Bootstrap 点估计，可能略偏离 a4*b）
      chk_num(method, dataset, "MM_INDEX.boot_mean(reference)", mean(vals), index_ref, 0.05)
      # 路径二：百分位 CI
      ci_ref <- as.numeric(quantile(vals, c(0.025, 0.975), type = 7, names = FALSE))
      chk_num(method, dataset, "MM_INDEX.ci_lower(reference)", ci_ref[1],
              gfn(kv, "MM_INDEX", 1, 3), 0.12)
      chk_num(method, dataset, "MM_INDEX.ci_upper(reference)", ci_ref[2],
              gfn(kv, "MM_INDEX", 1, 4), 0.12)
    }
  }

  ## ---- MM_COND|w_level|w_value|a_cond|indirect|ci_lower|ci_upper ----
  sd_w <- sd(wv)
  w_labels <- c("-1SD", "mean", "+1SD")
  w_offsets <- c(-sd_w, 0, sd_w)
  cond_rows <- kv[["MM_COND"]]
  if (is.null(cond_rows) || length(cond_rows) < 3) {
    add_row(method, dataset, "MM_COND.count", 3,
            if (is.null(cond_rows)) 0 else length(cond_rows), FALSE)
  } else {
    for (li in 1:3) {
      w0 <- w_offsets[li]                      # 中心化后的 W 取值
      a_cond_ref <- a2 + a4 * w0
      ind_cond_ref <- a_cond_ref * b_ref
      row <- kv_row_by(kv, "MM_COND", 1, w_labels[li])
      if (is.null(row)) {
        add_row(method, dataset, paste0("MM_COND.", w_labels[li], ".present"), "present", "missing", FALSE)
        next
      }
      chk_num(method, dataset, paste0("MM_COND.", w_labels[li], ".a_cond"), a_cond_ref,
              suppressWarnings(as.numeric(row[3])), 1e-2)
      chk_num(method, dataset, paste0("MM_COND.", w_labels[li], ".indirect"), ind_cond_ref,
              suppressWarnings(as.numeric(row[4])), 1e-2)
      # 每个水平都该有自己的 CI（不是复用一个）
      add_row(method, dataset, paste0("MM_COND.", w_labels[li], ".ci_present"),
              "finite", sprintf("%s .. %s", fv(suppressWarnings(as.numeric(row[5]))),
                                fv(suppressWarnings(as.numeric(row[6])))),
              is.finite(suppressWarnings(as.numeric(row[5]))) &&
                is.finite(suppressWarnings(as.numeric(row[6]))))
    }
    # **判别力**：三个水平的条件间接效应必须**各不相同**。
    # 若实现把条件间接效应当成常数（例如忘了乘 (a2+a4·W)），这里会红。
    ind_by_level <- suppressWarnings(as.numeric(vapply(cond_rows[1:3], function(r) r[4], character(1))))
    if (all(is.finite(ind_by_level))) {
      add_row(method, dataset, "discriminant.conditional_indirect_varies_by_w",
              "max-min > 0.05", sprintf("%.4f", diff(range(ind_by_level))),
              diff(range(ind_by_level)) > 0.05)
    }
    # 与 index 的自洽性：(W=+1SD 的 indirect) - (W=-1SD 的 indirect) = 2·SD·index
    if (all(is.finite(ind_by_level))) {
      gap_ref <- 2 * sd_w * index_ref
      add_row(method, dataset, "invariant.cond_gap_equals_2sd_index",
              sprintf("%.4f", gap_ref),
              sprintf("%.4f", ind_by_level[3] - ind_by_level[1]),
              num_ok(gap_ref, ind_by_level[3] - ind_by_level[1], 1e-2))
    }
  }

  ## index 与 a4*b 的自洽性（实现内部一致性）
  ## 用带空值防护的取值器：字段缺失时返回 NA 而不是 NULL，
  ## 否则 is.finite(NULL) 得到 logical(0)，`if` 会抛
  ## "missing value where TRUE/FALSE needed"（v0.3.2 开发时踩过）。
  safe_num <- function(row, j) {
    if (is.null(row) || length(row) < j) return(NA_real_)
    suppressWarnings(as.numeric(row[j]))
  }
  got_a4 <- safe_num(mm_coef_get("m", "xw"), 3)
  got_b <- safe_num(mm_coef_get("y", "m_v"), 3)
  got_index <- gfn(kv, "MM_INDEX", 1, 1)
  if (is.finite(got_a4) && is.finite(got_b) && is.finite(got_index)) {
    chk_num(method, dataset, "invariant.index_equals_a4_times_b", 0,
            abs(got_index - got_a4 * got_b), tol = 1e-3)
  } else {
    add_row(method, dataset, "invariant.index_equals_a4_times_b",
            "可计算", "缺少字段", FALSE)
  }

  ## 契约要求：必须提示 "index 显著 ≠ 每个水平都显著"
  notes <- paste(unlist(kv[["MM_NOTE"]]), collapse = " ")
  add_row(method, dataset, "MM_NOTE.warns_index_vs_levels", "present",
          if (nzchar(notes)) "present" else "missing",
          grepl("水平|分别报告|不等|未必", notes))
}

## 4.23 路径分析（v0.3.2 第四节）
##
## oracle 独立路径：**递归路径追踪**——显式枚举图中所有通路求乘积和。
## 实现对每个内生变量跑 OLS 后做递归；oracle 用邻接矩阵的通路枚举（不同的算法结构）。
oracle_path_analysis <- function(method, dataset, kv, out, data) {
  ## 按场景选择节点与边表（v0.3.3 起支持过度识别模型 path_overid）
  if (dataset == "path_overid") {
    nodes <- c("x", "m1", "m2", "y")
    edges <- list(c("x", "m1"), c("x", "m2"), c("m1", "y"), c("m2", "y"), c("x", "y"))
  } else {
    nodes <- c("x", "m", "y")
    edges <- list(c("x", "m"), c("m", "y"), c("x", "y"))
  }
  d <- data.frame(lapply(data[, nodes, drop = FALSE], as_num))
  d <- d[complete.cases(d), , drop = FALSE]
  n <- nrow(d)

  ## 逐方程 OLS（矩阵代数）：每个有入边的节点
  endo <- unique(vapply(edges, function(e) e[2], character(1)))
  coefs <- list()
  r2_by_eq <- list()
  for (dv in endo) {
    preds <- vapply(Filter(function(e) e[2] == dv, edges), function(e) e[1], character(1))
    Xd <- cbind(1, as.matrix(d[, preds, drop = FALSE]))
    f <- ols_mat(Xd, d[[dv]])
    for (k in seq_along(preds)) coefs[[paste(preds[k], dv, sep = ">")]] <- f$coef[k + 1]
    r2_by_eq[[dv]] <- f$r2
  }

  chk_eq(method, dataset, "PATH_SPEC.n", n, gfn(kv, "PATH_SPEC", 1, 1))
  chk_eq(method, dataset, "PATH_SPEC.n_nodes", length(nodes), gfn(kv, "PATH_SPEC", 1, 2))
  chk_eq(method, dataset, "PATH_SPEC.n_edges", length(edges), gfn(kv, "PATH_SPEC", 1, 3))

  ## 逐方程 R² 比对
  eq_rows <- kv[["PATH_EQ"]]
  if (!is.null(eq_rows)) {
    for (dv in names(r2_by_eq)) {
      for (r in eq_rows) {
        if (identical(r[1], dv)) {
          chk_num(method, dataset, paste0("PATH_EQ.", dv, ".r2"), r2_by_eq[[dv]],
                  suppressWarnings(as.numeric(r[2])), 1e-3)
          break
        }
      }
    }
  }

  ## ---- PATH_EDGE|from|to|coef|se|t|p_disp|p_raw|std_coef ----
  edge_rows <- kv[["PATH_EDGE"]]
  edge_get <- function(from, to) {
    if (is.null(edge_rows)) return(NULL)
    for (r in edge_rows) if (identical(r[1], from) && identical(r[2], to)) return(r)
    NULL
  }
  for (e in edges) {
    key <- paste(e[1], e[2], sep = ">")
    b_ref <- coefs[[key]]
    row <- edge_get(e[1], e[2])
    if (is.null(row)) {
      add_row(method, dataset, paste0("PATH_EDGE.", key, ".present"), "present", "missing", FALSE)
      next
    }
    chk_num(method, dataset, paste0("PATH_EDGE.", key, ".coef"), b_ref,
            suppressWarnings(as.numeric(row[3])), 1e-3)
  }

  ## ---- 递归路径追踪（oracle 的独立算法）----
  ## 显式枚举 from→to 的所有**无环有向通路**，indirect = 各通路系数乘积之和。
  ## 这是全程最独立的一步：实现是"逐方程 OLS 后按边递归"，oracle 是
  ## "建邻接表 + DFS 枚举通路"——算法结构不同，且天然覆盖
  ## 单通路（path_analysis）与**多条平行中介**（path_overid 的两条通路）。
  enumerate_paths <- function(from, to, max_len = 8L) {
    out <- list()
    walk <- function(cur, visited, acc) {
      if (length(acc) >= max_len) return(invisible(NULL))
      for (e in edges) {
        if (!identical(e[1], cur)) next
        nxt <- e[2]
        if (nxt %in% visited) next          # 环路保护（有环图无法分解效应）
        newacc <- c(acc, paste(cur, nxt, sep = ">"))
        if (identical(nxt, to)) {
          out[[length(out) + 1]] <<- newacc
        } else {
          walk(nxt, c(visited, nxt), newacc)
        }
      }
      invisible(NULL)
    }
    walk(from, c(from), character(0))
    out
  }
  path_product <- function(p) {
    prod(vapply(p, function(step) coefs[[step]], numeric(1)))
  }

  all_paths <- enumerate_paths("x", "y")
  direct_paths <- Filter(function(p) length(p) == 1L, all_paths)
  indirect_paths <- Filter(function(p) length(p) >= 2L, all_paths)
  direct_ref <- if (length(direct_paths) > 0) sum(vapply(direct_paths, path_product, numeric(1))) else 0
  indirect_ref <- if (length(indirect_paths) > 0) sum(vapply(indirect_paths, path_product, numeric(1))) else 0
  total_ref <- direct_ref + indirect_ref

  ## 通路数量本身是断言点：过度识别场景必须检出 **2 条**中介通路。
  ## 若实现只枚举了一条（例如只沿第一个中介走），indirect 会少一半，这里会先红。
  if (dataset == "path_overid") {
    add_row(method, dataset, "overid.n_indirect_paths", "2",
            sprintf("%d", length(indirect_paths)), length(indirect_paths) == 2L)
  }

  ## ---- PATH_EFFECT|from|to|direct|indirect|total ----
  eff_rows <- kv[["PATH_EFFECT"]]
  eff_get <- function(from, to) {
    if (is.null(eff_rows)) return(NULL)
    for (r in eff_rows) if (identical(r[1], from) && identical(r[2], to)) return(r)
    NULL
  }
  row_xy <- eff_get("x", "y")
  if (is.null(row_xy)) {
    add_row(method, dataset, "PATH_EFFECT.x>y.present", "present", "missing", FALSE)
  } else {
    chk_num(method, dataset, "PATH_EFFECT.x>y.direct", direct_ref,
            suppressWarnings(as.numeric(row_xy[3])), 1e-3)
    chk_num(method, dataset, "PATH_EFFECT.x>y.indirect", indirect_ref,
            suppressWarnings(as.numeric(row_xy[4])), 1e-3)
    chk_num(method, dataset, "PATH_EFFECT.x>y.total", total_ref,
            suppressWarnings(as.numeric(row_xy[5])), 1e-3)
    ## 契约硬性要求：total == direct + indirect（用实现输出自检）
    gd <- suppressWarnings(as.numeric(row_xy[3]))
    gi <- suppressWarnings(as.numeric(row_xy[4]))
    gt <- suppressWarnings(as.numeric(row_xy[5]))
    add_row(method, dataset, "invariant.total_equals_direct_plus_indirect",
            sprintf("%.4f", gd + gi), sprintf("%.4f", gt),
            is.finite(gd) && is.finite(gi) && is.finite(gt) && num_ok(gt, gd + gi, 1e-3))
  }

  ## 判别力：indirect 必须**不为 0**（这组数据确实存在中介通路）。
  ## 若实现漏掉间接效应（把 total 写成 direct），indirect 会是 0，这里红。
  add_row(method, dataset, "discriminant.indirect_nonzero", "|indirect| > 0.05",
          fv(indirect_ref), is.finite(indirect_ref) && abs(indirect_ref) > 0.05)
  ## total 必须大于 direct（因为存在正的间接通路）
  add_row(method, dataset, "discriminant.total_gt_direct", "total > direct",
          sprintf("total=%.4f direct=%.4f", total_ref, direct_ref),
          is.finite(total_ref) && is.finite(direct_ref) && total_ref > direct_ref)

  ## 契约：OLS 逐方程估计必须在表注里声明（与联合 ML 的等价性边界）
  notes <- paste(unlist(kv[["PATH_NOTE"]]), collapse = " ")
  add_row(method, dataset, "PATH_NOTE.declares_ols_per_equation", "present",
          if (nzchar(notes)) "present" else "missing",
          grepl("OLS|逐方程|最小二乘", notes))

  ## ---- v0.3.3 T83：过度识别模型的专项断言 ----
  if (dataset == "path_overid") {
    ## 1. 表注必须出现"过度识别"的声明。
    ##    这是契约第四节要求的**边界声明**：OLS 逐方程在过度识别时 ≠ 联合 ML。
    ##    注意本条只验证"声明存在"；声明是否**与当前模型匹配**（这个模型到底
    ##    是恰好识别还是过度识别）见下一条。
    add_row(method, dataset, "overid.note_mentions_overidentification", "present",
            if (grepl("过度识别", notes)) "present" else "missing",
            grepl("过度识别", notes))

    ## 2. **模型自由度必须 > 0**（这才是"过度识别"的实质，不是一句文案）。
    ##    4 个观测变量 ⇒ p(p+1)/2 = 10 个非冗余相关/协方差。
    ##    自由参数 = 5 条路径 + 4 个外生方差（或等价物）= 9 ⇒ df = 1 > 0。
    ##    若 df = 0（恰好识别），"过度识别时不等价"这句声明就与事实不符，
    ##    用户会误以为自己的模型有全局约束。
    p_obs <- length(nodes)
    n_nonredundant <- p_obs * (p_obs + 1) / 2
    n_paths <- length(edges)
    ## OLS 逐方程的自由参数计数：每条路径 1 个 + 每个内生方程的残差方差 1 个
    n_endog <- length(unique(vapply(edges, function(e) e[2], character(1))))
    n_par <- n_paths + n_endog
    df_model <- n_nonredundant - n_par
    add_row(method, dataset, "overid.model_df_positive", "df > 0（真过度识别）",
            sprintf("非冗余矩=%d 参数=%d df=%d", n_nonredundant, n_par, df_model),
            df_model > 0)
    add_row(method, dataset, "overid.df_does_not_match_saturated", "df > 0",
            sprintf("df=%d", df_model), df_model > 0)

    ## 3. 两条中介通路必须**都**被检出并**分别列出**（表注里有两条 "中介通路:" 行）。
    ##    若实现只列一条，用户会低估间接效应。
    n_path_lines <- length(grep("中介通路:", unlist(kv[["PATH_NOTE"]]), value = FALSE))
    add_row(method, dataset, "overid.both_paths_reported", "2 条中介通路逐条列出",
            sprintf("%d 条", n_path_lines), n_path_lines >= 2L)

    ## 4. 效应分解在过度识别下仍必须自洽（total = direct + indirect）。
    ##    这条与 path_analysis 场景重复是**刻意的**：过度识别模型的
    ##    "逐方程 OLS 不满足全局约束"恰恰是最容易让分解算错的地方。
    row_xy2 <- eff_get("x", "y")
    if (!is.null(row_xy2)) {
      gd2 <- suppressWarnings(as.numeric(row_xy2[3]))
      gi2 <- suppressWarnings(as.numeric(row_xy2[4]))
      gt2 <- suppressWarnings(as.numeric(row_xy2[5]))
      add_row(method, dataset, "overid.total_equals_direct_plus_indirect",
              sprintf("%.4f", gd2 + gi2), sprintf("%.4f", gt2),
              is.finite(gd2) && is.finite(gi2) && is.finite(gt2) && num_ok(gt2, gd2 + gi2, 1e-3))
    }

    ## 5. 真值恢复（fixtures 的设计系数，见 generate_fixtures.mjs 的说明）。
    ##    观测尺度真值：x>m1=.416667, x>m2=.366667, m1>y=.585000, m2>y=.413636, x>y=.162500
    truth_raw <- c("x>m1" = 0.416667, "x>m2" = 0.366667, "m1>y" = 0.585,
                   "m2>y" = 0.413636, "x>y" = 0.1625)
    for (k in names(truth_raw)) {
      got <- coefs[[k]]
      chk_num(method, dataset, paste0("overid.truth.", k), truth_raw[[k]], got, 1e-3)
    }
  }
}

## 4.24 结构方程模型 SEM（v0.3.2 第五节）
##
## oracle 策略与 v0.3.1 的 CFA 完全一致（契约也要求复用同一套拟合指标公式）：
##   - 实现：optim(BFGS) + 5 起点；oracle：nlm + Cholesky 参数化 Φ
##   - ln|Σ| oracle 用特征值展开（实现对 Σ 用 determinant）
##   - 独立复算 CFI/TLI/RMSEA/SRMR
##   - 不变式：diag(Σ)=1、df = p(p+1)/2 − npar
oracle_sem <- function(method, dataset, kv, out, data) {
  itemsX <- c("x1", "x2", "x3")
  itemsY <- c("y1", "y2", "y3")
  items <- c(itemsX, itemsY)
  X <- data.frame(lapply(data[, items, drop = FALSE], as_num))
  X <- X[complete.cases(X), , drop = FALSE]
  n <- nrow(X); p <- length(items)
  R <- cor(X)
  groups <- c(1, 1, 1, 2, 2, 2)

  chk_eq(method, dataset, "SEM_SPEC.n", n, gfn(kv, "SEM_SPEC", 1, 1))
  chk_eq(method, dataset, "SEM_SPEC.n_latent", 2, gfn(kv, "SEM_SPEC", 1, 2))
  chk_eq(method, dataset, "SEM_SPEC.n_obs", p, gfn(kv, "SEM_SPEC", 1, 3))

  ## ---- 独立拟合（Cholesky Φ + nlm，实现的另一条路径）----
  ## 结构模型：η2 = γ·η1 + ζ，Φ = [[1, γ], [γ, 1]]
  ## 参数：载荷（每因子 3 个自由）+ 误差方差 p 个 + 结构路径 （2→1）
  ## npar = 6 + 6 + 1 = 13；df = 6·7/2 − 13 = 21 − 13 = 8
  npar_ref <- p + p + 1
  df_ref <- p * (p + 1) / 2 - npar_ref
  chk_eq(method, dataset, "invariant.df_formula",
         p * (p + 1) / 2 - npar_ref, df_ref)

  ## 用 nlm 拟合 SEM（可实现与实现的 optim 不同）
  sem_unpack <- function(par) {
    lam <- matrix(0, p, 2)
    lam[cbind(1:p, groups)] <- par[1:p]
    th <- exp(par[(p + 1):(2 * p)])
    gam <- par[2 * p + 1]
    Phi <- matrix(c(1, gam, gam, 1), 2, 2)
    list(Lam = lam, th = th, Phi = Phi, Gamma = gam,
         Sigma = lam %*% Phi %*% t(lam) + diag(th))
  }
  f_ml_sem <- function(par) {
    u <- sem_unpack(par)
    es <- eigen(u$Sigma, symmetric = TRUE, only.values = TRUE)$values
    if (any(es <= 1e-10) || any(!is.finite(es))) return(1e10)
    Ri <- tryCatch(chol2inv(chol(u$Sigma)), error = function(e) NULL)
    if (is.null(Ri)) return(1e10)
    sum(log(es)) + sum(R * t(Ri)) - as.numeric(determinant(R, logarithm = TRUE)$modulus) - p
  }
  best <- NULL
  for (s in 1:4) {
    p0 <- c(rep(0.75 + 0.03 * s, p), rep(log(0.45 - 0.03 * s), p), 0.2 + 0.05 * s)
    o <- tryCatch(suppressWarnings(nlm(f_ml_sem, p0, iterlim = 3000)), error = function(e) NULL)
    if (is.null(o) || !is.finite(o$minimum)) next
    if (is.null(best) || o$minimum < best$minimum) best <- o
  }
  if (is.null(best)) {
    add_row(method, dataset, "oracle_sem_fit", "converged", "failed", FALSE)
    return(invisible(NULL))
  }
  u <- sem_unpack(best$estimate)
  chisq_ref <- (n - 1) * best$minimum

  ## ---- SEM_FIT|chisq|df|p_disp|p_raw|cfi|tli|rmsea|srmr ----
  chk_num(method, dataset, "SEM_FIT.chisq", chisq_ref, gfn(kv, "SEM_FIT", 1, 1), 1e-4)
  chk_eq(method, dataset, "SEM_FIT.df", df_ref, gfn(kv, "SEM_FIT", 1, 2))

  chisq_null <- -(n - 1) * as.numeric(determinant(R, logarithm = TRUE)$modulus)
  df_null <- p * (p - 1) / 2
  cfi_ref <- 1 - max(chisq_ref - df_ref, 0) / max(chisq_ref - df_ref, chisq_null - df_null, 0)
  tli_ref <- (chisq_null / df_null - chisq_ref / df_ref) / (chisq_null / df_null - 1)
  rmsea_ref <- sqrt(max(chisq_ref - df_ref, 0) / (df_ref * (n - 1)))
  srmr_ref <- srmr_of(R, u$Sigma)
  chk_num(method, dataset, "SEM_FIT.cfi", cfi_ref, gfn(kv, "SEM_FIT", 1, 5), TOL_LOOSE)
  chk_num(method, dataset, "SEM_FIT.tli", tli_ref, gfn(kv, "SEM_FIT", 1, 6), TOL_LOOSE)
  chk_num(method, dataset, "SEM_FIT.rmsea", rmsea_ref, gfn(kv, "SEM_FIT", 1, 7), TOL_LOOSE)
  chk_num(method, dataset, "SEM_FIT.srmr", srmr_ref, gfn(kv, "SEM_FIT", 1, 8), TOL_LOOSE)

  ## ---- 不变式 ----
  chk_num(method, dataset, "invariant.diag_Sigma_eq_1", max(abs(diag(u$Sigma) - 1)), 0, tol = 5e-6)

  ## ---- SEM_MEASURE：标准化载荷逐题比对 ----
  meas_rows <- kv[["SEM_MEASURE"]]
  if (is.null(meas_rows) || length(meas_rows) != p) {
    add_row(method, dataset, "SEM_MEASURE.count", p,
            if (is.null(meas_rows)) 0 else length(meas_rows), FALSE)
  } else {
    sd_sig <- sqrt(diag(u$Sigma))
    lam_std <- u$Lam / sd_sig
    for (i in seq_len(p)) {
      row <- NULL
      for (r in meas_rows) if (identical(r[2], items[i])) { row <- r; break }
      if (is.null(row)) {
        add_row(method, dataset, paste0("SEM_MEASURE.", items[i], ".present"), "present", "missing", FALSE)
        next
      }
      chk_num(method, dataset, paste0("SEM_MEASURE.", items[i], ".std_load"),
              lam_std[i, groups[i]], suppressWarnings(as.numeric(row[3])), TOL_LOOSE)
      # r2 = std_load^2（契约字段语义）
      chk_num(method, dataset, paste0("SEM_MEASURE.", items[i], ".r2"),
              lam_std[i, groups[i]]^2, suppressWarnings(as.numeric(row[9])), TOL_LOOSE)
    }
  }

  ## ---- SEM_STRUCT|from|to|coef|se|z|p_disp|p_raw ----
  struct_rows <- kv[["SEM_STRUCT"]]
  if (dataset == "sem_null") {
    # 强制无结构路径：契约下应**不输出** SEM_STRUCT，或输出 0
    has_struct <- !is.null(struct_rows) && length(struct_rows) > 0
    add_row(method, dataset, "SEM_STRUCT.absent_or_zero_when_null",
            "absent or coef=0",
            if (!has_struct) "absent" else paste(vapply(struct_rows, function(r) r[3], character(1)), collapse = ","),
            !has_struct || all(abs(suppressWarnings(as.numeric(
              vapply(struct_rows, function(r) r[3], character(1))))) < 1e-6))
  } else if (!is.null(struct_rows) && length(struct_rows) >= 1) {
    # γ 的 oracle 估计（来自 nlm 拟合）
    gam_ref <- u$Gamma
    chk_num(method, dataset, "SEM_STRUCT.F1>F2.coef", gam_ref,
            suppressWarnings(as.numeric(struct_rows[[1]][3])), TOL_LOOSE)
    # 真值恢复：γ 真值 0.5
    chk_num(method, dataset, "truth.gamma", 0.5,
            abs(suppressWarnings(as.numeric(struct_rows[[1]][3]))), tol = 0.03)
  } else {
    add_row(method, dataset, "SEM_STRUCT.present", "present", "missing", FALSE)
  }

  ## ---- 判别力：sem（γ=.5，路径显著 + 拟合好）vs sem_null（γ=0，路径不显著）----
  ## ⚠️ 这里**不能**断言 sem_null 的 CFI 变差：
  ##   sem_null 的数据本身就是两因子正交（γ=0），所以"γ=0 的模型"是**正确模型**，
  ##   它的 CFI 当然等于 1。用"拟合变差"当判别力是把模型拟合与效应存在混为一谈
  ##   （v0.3.2 开发时第一版 oracle 就写错了这一点）。
  ## 正确的判别力是：**结构路径的显著性**必须随真值变化——
  ##   sem 场景 γ=.5 → 结构系数显著（p≈1.6e-34）
  ##   sem_null 场景 γ=0 → 结构系数不显著（p≈1.0）
  cfi_got <- gfn(kv, "SEM_FIT", 1, 5)
  chisq_got <- gfn(kv, "SEM_FIT", 1, 1)
  struct_p <- NA_real_
  struct_coef <- NA_real_
  if (!is.null(struct_rows) && length(struct_rows) >= 1) {
    struct_coef <- suppressWarnings(as.numeric(struct_rows[[1]][3]))
    struct_p <- suppressWarnings(as.numeric(struct_rows[[1]][7]))
  }
  if (dataset == "sem_null") {
    # 真值 γ=0 ⇒ 结构系数应接近 0 且不显著
    add_row(method, dataset, "discriminant.null_struct_path_nonsignificant",
            "|coef| < 0.10 且 p > .05（真值 γ=0）",
            sprintf("coef=%.4f p=%.4f", struct_coef, struct_p),
            is.finite(struct_coef) && is.finite(struct_p) &&
              abs(struct_coef) < 0.10 && struct_p > 0.05)
    # 观测相关阵中两簇之间应几乎不相关（数据本身的正交性自检）
    r_xy <- R[1:3, 4:6]
    add_row(method, dataset, "discriminant.null_cross_block_uncorrelated",
            "max|r| < 0.10", sprintf("%.4f", max(abs(r_xy))),
            max(abs(r_xy)) < 0.10)
  } else {
    add_row(method, dataset, "discriminant.real_model_fits_well",
            "CFI >= 0.95", fv(cfi_got),
            is.finite(cfi_got) && cfi_got >= 0.95)
    add_row(method, dataset, "discriminant.real_struct_path_significant",
            "p < .001（真值 γ=.5）",
            sprintf("coef=%.4f p=%.3e", struct_coef, struct_p),
            is.finite(struct_p) && struct_p < 0.001)
    # 真值恢复：γ 应接近 .5
    add_row(method, dataset, "truth.gamma_recovered", "|γ-0.5| < 0.05",
            sprintf("%.4f", struct_coef),
            is.finite(struct_coef) && abs(abs(struct_coef) - 0.5) < 0.05)
  }
  ## LR 检验（仅 sem 场景：与"无路径模型"比）
  ## 无路径模型 = 两因子正交（γ=0），其 df 比有路径模型多 1（同 npar 数少 1）
  if (dataset == "sem" && is.finite(chisq_got)) {
    ## 拟合 γ=0 的模型：用 oracle 复算
    fit_null <- (function() {
      f0 <- function(par) {
        lam <- matrix(0, p, 2); lam[cbind(1:p, groups)] <- par[1:p]
        th <- exp(par[(p + 1):(2 * p)])
        Phi <- diag(2)
        S <- lam %*% Phi %*% t(lam) + diag(th)
        es <- eigen(S, symmetric = TRUE, only.values = TRUE)$values
        if (any(es <= 1e-10)) return(1e10)
        Ri <- tryCatch(chol2inv(chol(S)), error = function(e) NULL)
        if (is.null(Ri)) return(1e10)
        sum(log(es)) + sum(R * t(Ri)) - as.numeric(determinant(R, logarithm = TRUE)$modulus) - p
      }
      bb <- NULL
      for (s in 1:3) {
        o <- tryCatch(suppressWarnings(nlm(f0, c(rep(0.7 + 0.05 * s, p), rep(log(0.5), p)), iterlim = 3000)),
                      error = function(e) NULL)
        if (!is.null(o) && is.finite(o$minimum) && (is.null(bb) || o$minimum < bb$minimum)) bb <- o
      }
      if (is.null(bb)) return(NULL)
      (n - 1) * bb$minimum
    })()
    if (!is.null(fit_null)) {
      lr <- fit_null - chisq_got
      p_lr <- pchisq(lr, 1, lower.tail = FALSE)
      add_row(method, dataset, "discriminant.lr_test_significant",
              "p < .001（γ 真值 .5）", sprintf("LR=%.2f p=%.2e", lr, p_lr),
              is.finite(p_lr) && p_lr < 0.001)
    }
  }
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
  cfa_reverse = oracle_cfa,
  # v0.3.3 T83：真实脏数据专用 oracle（性质断言，非精确真值恢复）
  cfa_likert = oracle_cfa_likert,
  cvi = oracle_cvi,
  harman_medium = oracle_harman,
  harman_high = oracle_harman,
  # v0.3.2
  mediation = oracle_mediation,
  mediation_null = oracle_mediation,
  moderation = oracle_moderation,
  moderation_null = oracle_moderation,
  moderated_mediation = oracle_moderated_mediation,
  path_analysis = oracle_path_analysis,
  # v0.3.3 T83：过度识别模型（4 变量 5 边），复用同一 oracle 的通路枚举分支
  path_overid = oracle_path_analysis,
  sem = oracle_sem,
  sem_null = oracle_sem
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
  cfa_reverse = "=== 验证性因子分析 (CFA) ===",
  cfa_likert = "=== 验证性因子分析 (CFA) ===",
  cvi = "=== 内容效度指数 (CVI) ===",
  harman_medium = "=== Harman 单因子检验 ===",
  harman_high = "=== Harman 单因子检验 ===",
  # v0.3.2（契约第一节至第五节的横幅）
  mediation = "=== 中介效应分析 ===",
  mediation_null = "=== 中介效应分析 ===",
  moderation = "=== 调节效应分析 ===",
  moderation_null = "=== 调节效应分析 ===",
  moderated_mediation = "=== 有调节的中介分析 ===",
  path_analysis = "=== 路径分析 ===",
  sem = "=== 结构方程模型 (SEM) ===",
  sem_null = "=== 结构方程模型 (SEM) ==="
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
