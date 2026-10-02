## Independent parser cross-check for the v0.2.6 .sav slice (foreign::read.spss)
##
## 用 R 自己的 SPSS 读取器（foreign）读出 fixtures，作为 sav-reader / savImport.ts 的
## **独立参照实现**（不同解析器、不同语言生态）。
##
## 用法:
##   Rscript scripts/validate/crosscheck.R
## 环境变量:
##   RWB_FIXTURES  fixtures 目录（默认 <script dir>/fixtures）
##
## 前置条件: foreign 包（R 推荐包）+ fixtures。任一缺失时打印 SKIP 并以退出码 0 结束。

args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)
SCRIPT_DIR <- if (length(file_arg) > 0) {
  normalizePath(dirname(sub("^--file=", "", file_arg[1])), mustWork = FALSE)
} else {
  normalizePath(getwd(), mustWork = TRUE)
}

FIX <- Sys.getenv("RWB_FIXTURES")
if (!nzchar(FIX)) FIX <- file.path(SCRIPT_DIR, "fixtures")

if (!requireNamespace("foreign", quietly = TRUE)) {
  cat("SKIP  crosscheck.R — 未安装 foreign 包。\n")
  cat("      安装: install.packages(\"foreign\")（R 推荐包，通常随 R 一起安装）。\n")
  quit(status = 0)
}
if (!file.exists(file.path(FIX, "small.sav"))) {
  cat("SKIP  crosscheck.R — 缺少 fixtures:", FIX, "\n")
  cat("      生成方式: Rscript scripts/validate/gen_sav.R（需要 haven）。\n")
  quit(status = 0)
}

b <- foreign::read.spss(file.path(FIX, "big.sav"), to.data.frame = TRUE)
h <- b[1:200000, ]
cat(sprintf("R|%d|%.10f|%.10f|%.10f\n", nrow(h), sum(h$id), sum(h$x, na.rm = TRUE), sum(h$y)))
cat(sprintf("R_TOTALROWS=%d\n", nrow(b)))

s <- foreign::read.spss(file.path(FIX, "small.sav"), to.data.frame = TRUE)
cat("R_SMALL:\n")
print(s)

if (file.exists(file.path(FIX, "exact.sav"))) {
  e <- foreign::read.spss(file.path(FIX, "exact.sav"), to.data.frame = TRUE)
  cat(sprintf("R_EXACT_ROWS=%d\n", nrow(e)))
}
