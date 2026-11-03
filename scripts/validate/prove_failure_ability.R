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
run_validator <- function(file, gen_dir = GEN_DIR) {
  log <- suppressWarnings(system2(
    rscript,
    c(shQuote(file), "--no-regenerate", "--generated", shQuote(gen_dir)),
    stdout = TRUE, stderr = TRUE
  ))
  status <- attr(log, "status")
  if (is.null(status)) status <- 0L
  list(log = log, status = status,
       fails = log[grepl("FAIL$", log)],
       summ = grep("断言总数", log, value = TRUE))
}

# 对"篡改过的 fixture 目录"跑一次验证（用于第 10 处注入：绕过统一入口）
run_validator_dir <- function(gen_dir) run_validator(VALIDATOR, gen_dir)

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
# ⚠️ v0.3.3：路径分析的**生成器**实现已改为「矩阵幂级数 + 逐通路枚举」双算法互校，
#    旧的 oracle 侧注入点（indirect_ref <- sum(unlist(path_products))）已不存在。
#    本 harness 注入的是 **oracle 侧**（run_validation.R），所以这里要改 oracle 的
#    间接效应复算，而不是生成器。inject() 是 fixed=TRUE 的逐行匹配。
src <- inject(src, "  indirect_ref <- if (length(indirect_paths) > 0) sum(vapply(indirect_paths, path_product, numeric(1))) else 0",
              "  indirect_ref <- 0  # INJECTED: 漏掉中介通路", "path_indirect")
# (8) SEM：CFI 与 TLI 互换（模拟字段错位）
src <- inject(src, "  chk_num(method, dataset, \"SEM_FIT.cfi\", cfi_ref, gfn(kv, \"SEM_FIT\", 1, 5), TOL_LOOSE)",
              "  chk_num(method, dataset, \"SEM_FIT.cfi\", tli_ref, gfn(kv, \"SEM_FIT\", 1, 5), TOL_LOOSE)  # INJECTED",
              "sem_cfi_tli")
# (9) v0.3.3 / D01：CFA 组合信度 CR 的 oracle 退回带符号求和
#     这正是第三方审查发现的严重缺陷：含反向计分题（负载荷）时 CR 低估约 0.38，
#     且违反 CR >= AVE 不变式。oracle 若也退回带符号求和，两边会"一起错"而假绿——
#     所以这条注入专门验证「oracle 侧的口径独立于被测实现」，一旦 oracle 自己也
#     用错口径，`cr_ge_ave` 全局不变式断言必须变红。
# ⚠️ 注意：inject() 是**逐行**替换（fixed=TRUE），所以一条注入只能替换**一行**。
#    若需要替换成两行，必须用 paste0(..., "\n", ...) 显式插入换行 ——
#    写成 `n 是字面反引号+n，会让整个脚本语法错误、静默失败，
#    表现为"所有注入点都未变红"（连原本有效的注入点也会一起失效）。
src <- inject(src, "      cr_ref <- s_abs^2 / (s_abs^2 + th_f)",
              paste0("      s_abs <- sum(lam_f)  # INJECTED: 退回带符号求和\n",
                     "      cr_ref <- s_abs^2 / (s_abs^2 + th_f)"),
              "cfa_cr_signed_sum")

# (10) v0.3.3 补强 / 第三方 issue「data_quality.hooked 恒为真」：
#      模拟"生成器绕过统一读表入口"。
#
#      这条注入的特殊性：它**不注入 oracle**，而是篡改生成的 fixture 脚本
#      （把 `data <- rwb_read(dataFile)` 换成裸 read.csv），然后验证
#      run_validation.R 的结构断言能否抓到。
#
#      为什么必须由 harness 守：上一版这条断言是**假的**——判据用
#      grepl("rwb_read(dataFile)", 整个脚本) 去搜，而 R_COMMON 里有一句注释
#      恰好包含该字符串，于是恒命中、恒为真。实测绕过读表入口后 989 断言全绿、
#      exit 0，门禁完全没有拦截能力。
#
#      现在 run_validation.R 用 4 层防线（剔注释判代码行 / 计数 read.csv /
#      运行时 DQ 断言 / TS 源码层测试）。这里验证第 1、2 层真的能失败。

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

# ── (10) 独立实验：绕过统一读表入口，验证结构断言能失败 ──────────────────
#
# 这条与上面 9 处机制不同：前 9 处篡改 **oracle**（run_validation.R 的副本），
# 这一条篡改 **生成的 fixture 脚本**（模拟某个生成器不再走 rwb_read）。
#
# 为什么要单独做：上一版这条结构断言是假的（被 R_COMMON 里的一句注释击穿），
# 而它保护的正是"数据质量检查只接了 1/22 个方法"那次事故的复发路径。
# 一条不可失败的断言比没有断言更糟——它让人以为有保护。
cat("\n== (10) 绕过统一读表入口，验证结构断言可失败 ==\n")
bake_dir <- file.path(SCRIPT_DIR, "_hooked_demo")
unlink(bake_dir, recursive = TRUE, force = TRUE)
dir.create(bake_dir, showWarnings = FALSE)
# 复制一份**完整** fixture 目录（含 .R / .csv / manifest.txt），
# 再把其中一个脚本的 rwb_read 调用换成裸 read.csv。
# ⚠️ 必须复制全部文件类型：只复制 .R 会让验证器找不到 manifest 与数据文件，
#    表现为"退出码 1 但一条 FAIL 都没有"（脚本早退），看起来像门禁失效。
fixture_files <- list.files(GEN_DIR, full.names = TRUE)
invisible(file.copy(fixture_files, bake_dir, overwrite = TRUE))
target <- file.path(bake_dir, "mediation.R")
target_base <- file.path(bake_dir, "mediation.r")
if (!file.exists(target) && file.exists(target_base)) target <- target_base

hooked_probe <- FALSE
if (file.exists(target)) {
  tl <- readLines(target, warn = FALSE)
  hit <- grep("^\\s*data\\s*<-\\s*rwb_read\\(dataFile\\)\\s*$", tl)
  if (length(hit) == 1) {
    tl[hit] <- paste0(
      "data <- read.csv(dataFile, stringsAsFactors = FALSE, check.names = FALSE, ",
      "fileEncoding = \"UTF-8-BOM\")  # INJECTED: 绕过统一入口"
    )
    writeLines(tl, target)
    dem <- run_validator_dir(bake_dir)
    hooked_probe <- any(grepl("data_quality\\.hooked", dem$fails)) ||
      any(grepl("data_quality\\.no_bare_read", dem$fails))
    cat("   绕过 mediation 的读表入口后，变红断言数 =", length(dem$fails), "\n")
    cat("   其中 data_quality.* 相关：",
        sum(grepl("data_quality", dem$fails)), "条\n", sep = "")
    cat("   退出码 =", dem$status, "\n")
  } else {
    cat("   !! 未在 mediation.R 中找到唯一的 rwb_read 调用行，跳过该实验\n")
  }
} else {
  cat("   !! 未找到 mediation 的 fixture 脚本，跳过该实验\n")
}
unlink(bake_dir, recursive = TRUE, force = TRUE)

# ── 防护：注入副本自身跑不起来时，必须明确报出来 ──────────────────────────
# 症状：退出码非 0，但一条 FAIL 都没有，且汇总行缺失。
# 原因：注入把脚本改出了语法错误（最常见是把换行写成字面 `n），
#       R 直接解析失败、不产出任何断言 —— 于是**所有**注入点都显示"未变红"。
#       这看起来像"验证全线失守"，实际是"注入脚本本身坏了"。
#       不加这道防护，就会把一个注入失误误判成"整套验证没有判别力"，
#       那是极其危险的误判（会让人以为可以放心改验证脚本）。
if (run$status != 0L && length(run$fails) == 0 && length(run$summ) == 0) {
  cat("\n!!! 注入副本未能产生任何断言 —— 脚本本身很可能有语法错误\n")
  cat("    请检查各 inject() 的替换串：inject() 是**逐行**替换，\n")
  cat("    需要多行时必须用 paste0(..., \"\\n\", ...)，不能写成字面 `n。\n")
  cat("    注入副本输出（前 20 行）：\n")
  cat(head(run$log, 20), sep = "\n")
  quit(status = 2L)
}

# 十处注入必须各自造成至少一条断言变红 —— 逐一核对，
# 避免"只有一处生效"却整体 exit 1 的假象。
probe <- c(
  Harman         = any(grepl("HARMAN_SUMMARY.first_pct", run$fails)),
  CFA            = any(grepl("CFA_NULLMODEL.chisq", run$fails)),
  CVI            = any(grepl("CVI_ITEM.*p_c", run$fails)),
  Mediation      = any(grepl("MED_EFFECT.indirect", run$fails)),
  Moderation     = any(grepl("MOD_COEF.x_w.coef", run$fails)),
  ModMediation   = any(grepl("MM_INDEX.index", run$fails)),
  PathAnalysis   = any(grepl("PATH_EFFECT.x>y.indirect", run$fails)),
  SEM            = any(grepl("SEM_FIT.cfi", run$fails)),
  # v0.3.3 / D01：CR 退回带符号求和 → cfa_reverse 场景的 CR 断言 + 全局
  # cr_ge_ave 不变式必须同时变红。
  CfaCR          = any(grepl("CFA_RELIAB.*\\.cr", run$fails)) ||
                    any(grepl("CFA_RELIAB.*cr_ge_ave", run$fails)),
  # v0.3.3 补强：绕过统一读表入口 → 结构断言必须变红（第 10 处，独立实验）
  DataQualityHook = hooked_probe
)
cat("\n== 每个注入点的判别力 ==\n")
for (nm in names(probe)) {
  cat(sprintf("  %-16s %s\n", nm,
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
