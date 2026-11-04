/**
 * 层次回归（Hierarchical Regression）R 代码生成器 —— v0.3.4 / T75
 *
 * 用途：把自变量按理论顺序分成若干区块，逐块加入模型，
 * 考察**每块带来的增量解释力**（ΔR²）及其显著性（ΔF）。
 *
 * 典型场景：
 *   - 控制变量先进入（年龄、性别），核心预测变量后进入
 *   - 检验"在控制 XXX 之后，YYY 是否还有独立解释力"
 *
 * ── 两个容易算错的地方（本实现刻意避开）──
 *
 * 1. **ΔF 的分子自由度是「本块新增的参数个数」，不是「区块序号」**。
 *    我第一版原型写成按区块计数，结果第 2 块（含 2 个变量）算出 ΔF = 9.95，
 *    而 `anova(m1, m2)` 给出 4.97 —— 差了一倍。修正为 `length(本块变量)` 后
 *    与 anova() 逐位一致。
 *
 * 2. **所有区块必须在同一批样本上拟合**。
 *    若各块独立 `lm()` 且各自做缺失剔除，样本集不同，R² 不可比，ΔR² 会失去意义。
 *    因此先对全部变量做一次 listwise 删除，再在同一个 data.frame 上拟合。
 *
 * ── 输出契约（tags）──
 *   HIER_SPEC|<区块数>|<总变量数>|<每块大小逗号分隔>
 *   HIER_MODEL|<块号>|<变量列表逗号分隔>|<R²>|<adjR²>|<ΔR²>|<ΔF>|<df1>|<df2>|<p>|<p_raw>
 *   HIER_COEF|<块号>|<变量>|<b>|<se>|<t>|<p>|<p_raw>
 *   HIER_NOTE|...
 *   HIER_WARN|...
 *   CONCL|<结论>
 */
import { R_COMMON_WITH_SENTINELS, READ_CSV } from '../rCommon'
import { rEscape } from '../utils'

/** 解析区块规格：`x1,x2 | x3,x4` → [['x1','x2'], ['x3','x4']] */
export function parseBlocks(spec: string): string[][] {
  return spec
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) =>
      s
        .split(/[,，]/)
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
    )
    .filter((b) => b.length > 0)
}

export function hierarchicalRegressionCode(
  dv: string,
  blockSpec: string,
  dataFile = 'data.csv'
): string {
  const blocks = parseBlocks(blockSpec)
  const safeDv = rEscape(dv)

  if (blocks.length < 2) {
    return `cat("__RWB_ERROR__: 层次回归至少需要 2 个区块（用 | 分隔，例如 x1,x2 | x3,x4）\\n")\n`
  }

  const blockCount = blocks.length
  const totalVars = blocks.reduce((a, b) => a + b.length, 0)
  const blockSizes = blocks.map((b) => b.length).join(',')
  // 每块的变量名以 R 的 list 形式嵌入
  const blocksR = blocks
    .map((b) => `c(${b.map((v) => `"${rEscape(v)}"`).join(', ')})`)
    .join(', ')
  const allVars = blocks
    .flat()
    .map((v) => `"${rEscape(v)}"`)
    .join(', ')

  return `
dataFile <- "${rEscape(dataFile)}"
${R_COMMON_WITH_SENTINELS}
data <- ${READ_CSV}
cat("=== 层次回归分析 ===\\n")
dv_name <- "${safeDv}"
blocks <- list(${blocksR})
all_vars <- c(${allVars})
missing_vars <- setdiff(c(dv_name, all_vars), names(data))
if (length(missing_vars) > 0) {
  stop("以下变量不存在: ", paste(missing_vars, collapse = ", "))
}
# ── 关键：所有区块必须在**同一批样本**上拟合 ──
# 若各块各自做缺失剔除，样本集不同，R² 不可比，ΔR² 就没有意义。
use_cols <- c(dv_name, all_vars)
sub <- data[, use_cols, drop = FALSE]
for (nm in use_cols) {
  sub[[nm]] <- suppressWarnings(as.numeric(as.character(sub[[nm]])))
}
n_before <- nrow(sub)
sub <- sub[complete.cases(sub), , drop = FALSE]
n <- nrow(sub)
dropped <- n_before - n
if (n < 10) {
  stop("有效样本量不足（", n, " 行），层次回归至少需要 10 行")
}
if (dropped > 0) {
  cat(sprintf("HIER_NOTE|因缺失值采用逐行删除（listwise / 个案剔除），剔除 %d 行，所有区块在同一批 %d 个样本上拟合\\n", dropped, n))
}
cat(sprintf("HIER_SPEC|%d|%d|%s\\n", ${blockCount}, ${totalVars}, "${blockSizes}"))

# 变量方差为 0 时回归无意义，提前报错（否则 R 给的是难懂的报错）
for (nm in all_vars) {
  if (var(sub[[nm]]) == 0) {
    stop("变量 ", nm, " 的方差为 0（常数列），无法进入回归")
  }
}

prev_r2 <- 0
prev_p <- 0
r2_seq <- numeric(0)
for (i in seq_along(blocks)) {
  cur_vars <- unlist(blocks[1:i])
  fml <- reformulate(cur_vars, response = dv_name)
  m <- lm(fml, data = sub)
  s <- summary(m)
  r2 <- s$r.squared
  adj <- s$adj.r.squared
  df_res <- m$df.residual
  # ⚠️ 累计参数个数必须是「变量个数」，不是区块序号 i。
  # 写成 i 会让含多个变量的区块自由度算错，ΔF 与 anova() 不一致（实测差一倍）。
  p_cnt <- length(cur_vars)
  dr2 <- r2 - prev_r2
  ddf <- p_cnt - prev_p
  if (ddf <= 0) {
    df_val <- NA_real_
    p_val <- NA_real_
  } else {
    df_val <- (dr2 / ddf) / ((1 - r2) / df_res)
    p_val <- pf(df_val, ddf, df_res, lower.tail = FALSE)
  }
  r2_seq <- c(r2_seq, r2)
  cat(sprintf("HIER_MODEL|%d|%s|%s|%s|%s|%s|%d|%d|%s|%s\\n", i,
    paste(cur_vars, collapse = ","), num(r2, 4), num(adj, 4), num(dr2, 4),
    num(df_val, 4), as.integer(ddf), as.integer(df_res),
    fmt_p(p_val), num_p(p_val)))
  # 本块新增变量的系数
  cf <- s$coefficients
  for (v in blocks[[i]]) {
    if (v %in% rownames(cf)) {
      cat(sprintf("HIER_COEF|%d|%s|%s|%s|%s|%s|%s\\n", i, v,
        num(cf[v, 1]), num(cf[v, 2]), num(cf[v, 3]),
        fmt_p(cf[v, 4]), num_p(cf[v, 4])))
    }
  }
  prev_r2 <- r2
  prev_p <- p_cnt
}

# ── 自检：ΣΔR² 必须等于最终模型 R²（浮点容差 1e-10）──
sum_dr2 <- sum(diff(c(0, r2_seq)))
final_r2 <- r2_seq[length(r2_seq)]
gap <- abs(sum_dr2 - final_r2)
if (!is.finite(gap) || gap > 1e-10) {
  stop("层次回归自检失败：ΣΔR² = ", num_sig(sum_dr2), " 与最终 R² = ",
       num_sig(final_r2), " 不一致（差 ", num_sig(gap), "）")
}

cat(sprintf("HIER_NOTE|共 %d 个区块，%d 个自变量，全部区块在同一批 %d 个样本上拟合；ΣΔR² = %s 与最终 R² 一致（差 %s）\\n",
  ${blockCount}, ${totalVars}, n, num(sum_dr2, 4), num_sig(gap)))

# 结论：只陈述事实，不替用户判定"哪个区块更重要"——
# 那取决于研究假设，不是数据能决定的（与本项目「AI 只解读、不替用户下统计结论」一致）。
last_dr2 <- if (length(r2_seq) >= 2) r2_seq[length(r2_seq)] - r2_seq[length(r2_seq) - 1] else NA_real_
cat(sprintf("CONCL|层次回归完成：最终模型 R² = %s（%d 个自变量）。最后加入的区块带来 ΔR² = %s，请在表中核对该区块的 ΔF 与 p 值后再判断其增量解释力是否有统计学意义。\\n",
  num(final_r2, 4), ${totalVars}, num(last_dr2, 4)))
`
}
