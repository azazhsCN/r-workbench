## v0.2.6 task-3 verification fixture generator (mainprocess; persisted into the repo by engineer-gates)
## Writes real .sav files via haven so the SPSS import path can be tested end-to-end by
## verify.cjs / verify_ipc.cjs / packaged_app_check.cjs.
##
## 用法:
##   Rscript scripts/validate/gen_sav.R
## 环境变量:
##   RWB_OUT   输出目录（默认 <script dir>/fixtures）
##   RWB_LIBS  额外库路径（可选；未设置时不改动 .libPaths）
##
## 前置条件: haven 包。**缺失时打印 SKIP 并以退出码 0 结束** —— fixtures 是可选产物，
## 不能因为某台机器没装 haven 就让流程变红。

args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)
SCRIPT_DIR <- if (length(file_arg) > 0) {
  normalizePath(dirname(sub("^--file=", "", file_arg[1])), mustWork = FALSE)
} else {
  normalizePath(getwd(), mustWork = TRUE)
}

rlibs <- Sys.getenv("RWB_LIBS")
if (nzchar(rlibs)) .libPaths(rlibs)

if (!requireNamespace("haven", quietly = TRUE)) {
  cat("SKIP  gen_sav.R — 未安装 haven 包，无法生成 .sav fixtures。\n")
  cat("      安装: install.packages(\"haven\")   或   设置 RWB_LIBS 指向已有库目录。\n")
  cat("      未生成任何文件，退出码 0（fixtures 缺失时各 verify harness 会自行 SKIP）。\n")
  quit(status = 0)
}
suppressPackageStartupMessages(library(haven))

out_dir <- Sys.getenv("RWB_OUT")
if (!nzchar(out_dir)) out_dir <- file.path(SCRIPT_DIR, "fixtures")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

## ── 1. small.sav: numeric + string + value labels + one NA ──────────────
small <- data.frame(
  id    = c(1, 2, 3, 4, 5, 6),
  score = c(88.5, 92, NA, 75.25, 60, 99),
  name  = c("张三", "李四", "王五", "赵六", "钱七", "孙八"),
  group = c(1, 2, 1, 2, 1, 2),
  stringsAsFactors = FALSE
)
small$group <- labelled(small$group, c("实验组" = 1, "对照组" = 2))
haven::write_sav(small, file.path(out_dir, "small.sav"))

## ── 2. big.sav: 300,000 rows x 3 numeric（用于 20 万行截断/OOM 验收）──────
n <- 300000L
big <- data.frame(
  id = seq_len(n),
  x  = rep(c(1.5, 2.25, 3.75, NA), length.out = n),
  y  = rep(c(10, 20, 30), length.out = n)
)
haven::write_sav(big, file.path(out_dir, "big.sav"))

## ── 3. exact.sav: exactly 200,000 rows（边界：不应报告截断）─────────────
m <- 200000L
exact <- data.frame(id = seq_len(m), v = rep(c(1, 2), length.out = m))
haven::write_sav(exact, file.path(out_dir, "exact.sav"))

cat("WROTE:\n")
for (f in c("small.sav", "big.sav", "exact.sav")) {
  p <- file.path(out_dir, f)
  cat(sprintf("  %s  %d bytes\n", p, file.info(p)$size))
}

## independent cross-check with R's own SPSS reader (foreign), a different parser
if (requireNamespace("foreign", quietly = TRUE)) {
  cat("\nforeign::read.spss cross-check (small.sav):\n")
  w <- foreign::read.spss(file.path(out_dir, "small.sav"), to.data.frame = TRUE)
  print(w)
  cat("\nbig.sav nrow via foreign:\n")
  b <- foreign::read.spss(file.path(out_dir, "big.sav"), to.data.frame = TRUE)
  cat(sprintf("  nrow = %d\n", nrow(b)))
} else {
  cat("\nSKIP  foreign 包不可用，跳过独立交叉校验（fixtures 已生成，不影响后续 harness）。\n")
}
