#!/usr/bin/env Rscript
# ============================================================================
# 失败能力实证（mutation test）—— run_validation.R 的"反向"自证
# ----------------------------------------------------------------------------
# 为什么需要这个脚本：
#   一个永远 PASS 的验证脚本和没有验证脚本一样危险（v0.2.5 的反向事故：
#   把「参考实现」与「被测实现」写成同一段字符串逐字符比较，永远 PASS）。
#   本脚本把 run_validation.R 复制一份、注入**语义错误**（不是语法错误 ——
#   语法错误只会让 parse 失败，证明不了断言有判别力），再运行，
#   确认断言真的变红且退出码为 1。
#
# ⚠️ 使用顺序很重要：**必须先在未注入的基线上跑出全 PASS**，再做注入。
#    基线本身有 FAIL 时，"注入后 exit 1" 证明不了任何事 —— 那个 exit 1
#    可能是原有 FAIL 造成的，与注入无关。本脚本会先检查基线。
#
# v0.3.1 的三处注入（保持）：
#   1) Harman：首成分占比 × 2        → HARMAN_SUMMARY.first_pct / ok 变红
#   2) CFA   ：零模型卡方符号取反    → CFA_NULLMODEL.chisq / CFI / TLI 变红
#   3) CVI   ：阈值表 0.83 → 0.75    → p_c / kappa / verdict 变红
#
# v0.3.2 新增的五处注入（每方法一处）：
#   4) 中介      ：间接效应改成 a + b（应为 a × b）→ MED_EFFECT.indirect 变红
#   5) 调节      ：交互项系数 b3 放大 1.5 倍      → MOD_COEF.x_w 变红
#   6) 有调节中介：index 改成 a2 × b（应为 a4 × b）→ MM_INDEX 变红
#   7) 路径分析  ：indirect 置 0（漏掉中介通路）  → PATH_EFFECT.indirect 变红
#   8) SEM       ：CFI 与 TLI 互换                → SEM_FIT.cfi / tli 变红
#
# 用法（项目根目录）：
#   Rscript scripts/validate/prove_failure_ability.R
#   退出码 0 = 八处注入都成功让断言变红（即验证脚本确实有判别力）
#   退出码 1 = 基线不干净，或注入未被捕获（验证脚本存在盲区）
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

rscript <- file.path(R.home("bin"), "Rscript")
run_validator <- function(file) {
  log <- suppressWarnings(system2(
    rscript,
    c(shQuote(file), "--no-regenerate", "--generated", shQuote(GEN_DIR)),
    stdout = TRUE, stderr = TRUE
  ))
  status <- attr(log, "status")
  if (is.null(status)) status <- 0L
  list(log = log, status = status,
       fails = log[grepl("FAIL$", log)],
       summ = grep("断言总数", log, value = TRUE))
}

# ── 第 0 步：基线必须全 PASS ────────────────────────────────────────────────
# 这是本 harness 最重要的一步。基线有 FAIL 时后续注入毫无证明力。
cat("== 第 0 步：检查基线是否全 PASS ==\n")
base <- run_validator(VALIDATOR)
cat("   基线：", if (length(base$summ) > 0) base$summ[1] else "(未能读取汇总)", "\n", sep = "")
cat("   基线退出码 =", base$status, "  基线 FAIL 数 =", length(base$fails), "\n")
if (base$status != 0L || length(base$fails) > 0) {
  cat("\n>>> 基线不干净，注入实验无意义。先修好基线再跑本 harness。\n")
  cat("    基线 FAIL 明细（最多 10 条）：\n")
  cat(head(base$fails, 10), sep = "\n")
  quit(status = 1)
}
cat("   >>> 基线全 PASS，可以开始注入。\n")

# ── 注入 ────────────────────────────────────────────────────────────────────
src <- readLines(VALIDATOR, warn = FALSE)

inject <- function(lines, pattern, replacement, label) {
  i <- grep(pattern, lines, fixed = TRUE)
  if (length(i) != 1) {
    stop(sprintf("注入点 %s 未唯一匹配（命中 %d 处），脚本结构已变，请更新本 harness", label, length(i)))
  }
  lines[i] <- replacement
  lines
}

cat("\n== 注入语义错误 ==\n")
# v0.3.1
src <- inject(src, "first_pct_ref <- ev[1] / p * 100",
              "  first_pct_ref <- ev[1] / p * 100 * 2  # INJECTED", "harman_first_pct")
src <- inject(src, "chisq_null_ref <- -",
              "  chisq_null_ref <- (n - 1) * ldet_R  # INJECTED", "cfa_null_chisq")
src <- inject(src, "      0.83",
              "      0.75  # INJECTED", "cvi_threshold")

# v0.3.2 —— 五处，每方法一处
# (4) 中介：间接效应 = a*b，注入成 a+b（量纲错误，也是最常见的实现笔误）
src <- inject(src, "  ind_ref <- a_ref * b_ref",
              "  ind_ref <- a_ref + b_ref  # INJECTED: 应为 a*b", "mediation_indirect")
# (5) 调节：交互项系数放大 1.5 倍（模拟"下标错位拿到了别的系数"）
#     注入点必须落在**真正驱动 MOD_COEF.x_w 断言的那个变量**上。
#     第一版注入改的是 `b3_centered`（只喂给 centering 不变式断言），
#     结果 MOD_COEF.x_w 仍然 PASS ——本 harness 自己抓到了这个"注入点选错"的盲区，
#     改成注入 `list(term = "x_w", b = f_cn$coef[4]` 里的系数来源。
src <- inject(src, "    list(term = \"x_w\", b = f_cn$coef[4], se = f_cn$se[4], t = f_cn$t[4], p = f_cn$p[4]),",
              "    list(term = \"x_w\", b = f_cn$coef[4] * 1.5, se = f_cn$se[4], t = f_cn$t[4], p = f_cn$p[4]),  # INJECTED",
              "moderation_b3")
# (6) 有调节的中介：index = a4*b，注入成 a2*b（拿错系数）
src <- inject(src, "  index_ref <- a4 * b_ref",
              "  index_ref <- a2 * b_ref  # INJECTED: 应为 a4*b", "mm_index")
# (7) 路径分析：indirect 置 0（模拟"漏掉中介通路"，total 退化成 direct）
src <- inject(src, "  indirect_ref <- sum(unlist(path_products))",
              "  indirect_ref <- 0  # INJECTED: 漏掉中介通路", "path_indirect")
# (8) SEM：CFI 与 TLI 互换（模拟字段错位）
src <- inject(src, "  chk_num(method, dataset, \"SEM_FIT.cfi\", cfi_ref, gfn(kv, \"SEM_FIT\", 1, 5), TOL_LOOSE)",
              "  chk_num(method, dataset, \"SEM_FIT.cfi\", tli_ref, gfn(kv, \"SEM_FIT\", 1, 5), TOL_LOOSE)  # INJECTED",
              "sem_cfi_tli")

tmp <- file.path(SCRIPT_DIR, "_failure_demo.R")
writeLines(src, tmp)
# 注意：on.exit() 只在函数内绑定到函数退出；脚本顶层不会触发，
# 因此这里必须显式清理（否则会留下 _failure_demo.R 污染下一次运行）。
cleanup <- function() unlink(tmp, force = TRUE)
cat("   已写入临时副本：", tmp, "\n", sep = "")

run <- run_validator(tmp)
cleanup()

# ⚠️ 注入副本运行时会把 VALIDATION_RESULTS.md 覆盖成"带注入 FAIL"的版本。
# 那是一个**故意制造的失败**，绝不能留在仓库里冒充真实验证结果
# （否则下次有人看这个文件会以为基线是红的）。
# 因此注入实验结束后立刻重跑一次干净版本，把结果文件恢复成真实基线。
cat("\n== 恢复 VALIDATION_RESULTS.md 为真实基线结果 ==\n")
restore <- run_validator(VALIDATOR)
if (restore$status == 0L && length(restore$fails) == 0) {
  cat("   已重跑干净版本：", if (length(restore$summ) > 0) restore$summ[1] else "(ok)", "\n", sep = "")
} else {
  cat("   !! 警告：恢复运行时基线未全 PASS，VALIDATION_RESULTS.md 可能不可信\n")
}

cat("\n== 注入后变红的断言（最多列 40 条）==\n")
cat(head(run$fails, 40), sep = "\n")
cat("\n== 汇总 ==\n")
cat(run$summ, "\n")
cat("退出码 =", run$status, "  变红断言数 =", length(run$fails), "\n")

# 八处注入必须各自造成至少一条断言变红 —— 逐一核对，
# 避免"只有一处生效"却整体 exit 1 的假象。
probe <- c(
  Harman         = any(grepl("HARMAN_SUMMARY.first_pct", run$fails)),
  CFA            = any(grepl("CFA_NULLMODEL.chisq", run$fails)),
  CVI            = any(grepl("CVI_ITEM.*p_c", run$fails)),
  Mediation      = any(grepl("MED_EFFECT.indirect", run$fails)),
  Moderation     = any(grepl("MOD_COEF.x_w.coef", run$fails)),
  ModMediation   = any(grepl("MM_INDEX.index", run$fails)),
  PathAnalysis   = any(grepl("PATH_EFFECT.x>y.indirect", run$fails)),
  SEM            = any(grepl("SEM_FIT.cfi", run$fails))
)
cat("\n== 每个注入点的判别力 ==\n")
for (nm in names(probe)) {
  cat(sprintf("  %-14s %s\n", nm,
              if (probe[[nm]]) "变红（有判别力）" else "未变红（盲区！）"))
}

ok <- run$status == 1L && length(run$fails) > 0 && all(probe)
cat("\n")
if (ok) {
  cat("==> 通过：", length(probe), "处注入均使对应断言变红且退出码为 1，验证脚本具备失败能力。\n", sep = "")
  cat("    （基线 = 全 PASS，注入后 = ", length(run$fails), " 条 FAIL，对比明确。）\n", sep = "")
  quit(status = 0)
} else {
  cat("==> 失败：存在未被捕获的注入，验证脚本有盲区。\n")
  quit(status = 1)
}
