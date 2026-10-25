#!/usr/bin/env Rscript
# ============================================================================
# 失败能力实证（mutation test）—— run_validation.R 的"反向"自证
# ----------------------------------------------------------------------------
# 为什么需要这个脚本：
#   一个永远 PASS 的验证脚本和没有验证脚本一样危险（v0.2.5 的同义反复事故）。
#   本脚本把 run_validation.R 复制一份、注入**语义错误**（不是语法错误，
#   语法错误只会让 parse 失败，证明不了断言有判别力），再运行，
#   确认断言真的变红且退出码为 1。
#
# 注入的三处错误分别落在三个新方法的 oracle 上：
#   1) Harman：首成分占比 × 2        → HARMAN_SUMMARY.first_pct / ok 应变红
#   2) CFA   ：零模型卡方符号取反    → CFA_NULLMODEL.chisq / CFI / TLI 应变红
#   3) CVI   ：阈值表 0.83 → 0.75    → p_c / kappa / verdict 应变红
#
# 用法（项目根目录）：
#   Rscript scripts/validate/prove_failure_ability.R
#   退出码 0 = 三处注入都成功让断言变红（即验证脚本确实有判别力）
#   退出码 1 = 注入后断言没有变红 → 验证脚本存在盲区，必须修
# ============================================================================

script_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
script_path <- if (length(script_arg) > 0) sub("^--file=", "", script_arg[1]) else "prove_failure_ability.R"
SCRIPT_DIR <- normalizePath(dirname(script_path), mustWork = FALSE)
if (!dir.exists(SCRIPT_DIR)) SCRIPT_DIR <- normalizePath(getwd(), mustWork = TRUE)

VALIDATOR <- file.path(SCRIPT_DIR, "run_validation.R")
GEN_DIR <- file.path(SCRIPT_DIR, "generated")
if (!file.exists(VALIDATOR)) stop("找不到 ", VALIDATOR)
if (!file.exists(file.path(GEN_DIR, "manifest.txt"))) {
  stop("缺少 fixtures。请先运行：node scripts/validate/generate_fixtures.mjs")
}

src <- readLines(VALIDATOR, warn = FALSE)

inject <- function(lines, pattern, replacement, label) {
  i <- grep(pattern, lines, fixed = TRUE)
  if (length(i) != 1) {
    stop(sprintf("注入点 %s 未唯一匹配（命中 %d 处），脚本结构已变，请更新本 harness", label, length(i)))
  }
  lines[i] <- replacement
  lines
}

cat("== 失败能力实证：向 oracle 注入语义错误 ==\n")
src <- inject(src, "first_pct_ref <- ev[1] / p * 100",
              "  first_pct_ref <- ev[1] / p * 100 * 2  # INJECTED", "harman_first_pct")
src <- inject(src, "chisq_null_ref <- -",
              "  chisq_null_ref <- (n - 1) * ldet_R  # INJECTED", "cfa_null_chisq")
src <- inject(src, "      0.83",
              "      0.75  # INJECTED", "cvi_threshold")

tmp <- file.path(SCRIPT_DIR, "_failure_demo.R")
writeLines(src, tmp)
# 注意：on.exit() 只在函数内绑定到函数退出；脚本顶层不会触发，
# 因此这里必须显式清理（否则会留下 _failure_demo.R 污染下一次运行）。
cleanup <- function() unlink(tmp, force = TRUE)
cat("   已写入临时副本：", tmp, "\n", sep = "")

rscript <- file.path(R.home("bin"), "Rscript")
log <- suppressWarnings(system2(
  rscript,
  c(shQuote(tmp), "--no-regenerate", "--generated", shQuote(GEN_DIR)),
  stdout = TRUE, stderr = TRUE
))
status <- attr(log, "status")
if (is.null(status)) status <- 0L

fails <- log[grepl("FAIL$", log)]
summ <- grep("断言总数", log, value = TRUE)

cat("\n== 注入后变红的断言（最多列 30 条）==\n")
cat(head(fails, 30), sep = "\n")
cat("\n== 汇总 ==\n")
cat(summ, "\n")
cat("退出码 =", status, "  变红断言数 =", length(fails), "\n")

# 三处注入必须各自造成至少一条断言变红 —— 逐一核对，避免"只有一处生效"的假象。
probe <- c(
  Harman  = any(grepl("HARMAN_SUMMARY.first_pct", fails)),
  CFA     = any(grepl("CFA_NULLMODEL.chisq", fails)),
  CVI     = any(grepl("CVI_ITEM.*p_c", fails))
)
cat("\n== 每个注入点的判别力 ==\n")
for (nm in names(probe)) cat(sprintf("  %-8s %s\n", nm, if (probe[[nm]]) "变红（有判别力）" else "未变红（盲区！）"))

ok <- status == 1L && length(fails) > 0 && all(probe)
cat("\n")
cleanup()
if (ok) {
  cat("==> 通过：三处注入均使断言变红且退出码为 1，验证脚本具备失败能力。\n")
  quit(status = 0)
} else {
  cat("==> 失败：注入未被捕获，验证脚本存在盲区。\n")
  quit(status = 1)
}
