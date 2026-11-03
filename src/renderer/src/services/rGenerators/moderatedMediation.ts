/**
 * 有调节的中介（Moderated Mediation）—— v0.3.2
 *
 * 契约：`V032_CONTRACT.md` 第三节（唯一接口依据）。
 * 横幅唯一：`=== 有调节的中介分析 ===`
 *
 * ## 模型（前半段调节，最常见形态）
 *   中介模型：`M = a1 + a2 X + a3 W + a4 (X*W) + e`
 *   结果模型：`Y = c' + b M + c X + e`
 *   条件间接效应：`(a2 + a4 W) b`
 *   index of moderated mediation = `a4 b`
 *
 * ## 为什么 index 的 CI 必须来自 Bootstrap
 * `a4 * b` 是两个估计量之积，其抽样分布显著偏态且**不服从正态分布**
 * （Sobel / delta 法在 a4 或 b 接近 0 时会给出明显偏窄的 CI）。
 * 契约明确要求 `MM_INDEX` 的 CI 必须来自 Bootstrap，不能只用 Sobel 近似。
 * 本实现用 **percentile bootstrap**（B = 5000，固定种子），
 * `MM_BOOT.method` 如实标 `percentile`，绝不标 bca 却给 percentile。
 *
 * ## index 显著不等于每个水平都显著
 * 这是有调节的中介里最常被写错的结论。index 只说明"条件间接效应随 W 变化"，
 * 完全可能在某些 W 水平上间接效应的 CI 跨 0。因此本生成器**强制**输出
 * 一条 MM_NOTE 说明两者要分开报告，并且在 CONCL 里按实际结果给出判断。
 *
 * ## 中心化
 * 与调节效应（MOD）保持一致：X 与 W 都做**均数中心化**后再构造交互项，
 * 这样 a2 才是"W 处于均值时的条件前段效应"，简单斜率与条件间接效应
 * 才有可解释的锚点。中心化的声明写进 MM_SPEC 与 MM_NOTE。
 *
 * ## p 值的坑（契约通用规则）
 * 一律 `fmt_p()` + `num_p()` 成对输出；**不得**用 `sprintf("%.4f")` 输出 p，
 * 否则 p < 1e-4 全被压成 0.0000，AI 与用户都会读错。
 */

import { rEscape } from '../utils'
import { R_COMMON_WITH_SENTINELS, READ_CSV } from '../rCommon'

/**
 * 生成有调节的中介的 R 代码。
 *
 * @param x        自变量 X
 * @param m        中介变量 M
 * @param y        因变量 Y
 * @param w        调节变量 W（调节 X→M 这一段）
 * @param dataFile 数据文件名
 */
export function moderatedMediationCode(
  x: string,
  m: string,
  y: string,
  w: string,
  dataFile = 'data.csv'
): string {
  return `
dataFile <- "${rEscape(dataFile)}"
${R_COMMON_WITH_SENTINELS}
data <- ${READ_CSV}
cat("=== 有调节的中介分析 ===\\n")
x_var <- "${rEscape(x)}"
m_var <- "${rEscape(m)}"
y_var <- "${rEscape(y)}"
w_var <- "${rEscape(w)}"

# ─────────────────────────────────────────────────────────────
# 步骤 1：输入校验
# ─────────────────────────────────────────────────────────────
vars4 <- c(x_var, m_var, y_var, w_var)
miss_vars <- vars4[!(vars4 %in% names(data))]
if (length(miss_vars) > 0) {
  stop("以下变量不存在: ", paste(miss_vars, collapse = ", "))
}
if (anyDuplicated(vars4)) {
  stop("X / M / Y / W 必须是四个不同的变量，当前有重复: ",
       paste(unique(vars4[duplicated(vars4)]), collapse = ", "))
}

X_raw <- data[, vars4, drop = FALSE]
ok <- complete.cases(X_raw)
D <- X_raw[ok, , drop = FALSE]
n_dropped <- sum(!ok)
n <- nrow(D)
if (n < 50) {
  stop("有效样本不足（", n, " 行），有调节的中介至少需要 50 个完整样本")
}
for (nm in vars4) {
  if (!is.numeric(D[[nm]])) {
    stop("变量 ", nm, " 不是数值型，无法做有调节的中介分析")
  }
}
for (nm in vars4) {
  if (sd(D[[nm]]) <= 0) {
    stop("变量 ", nm, " 为常量（标准差为 0），无法做有调节的中介分析")
  }
}

x_v <- as.numeric(D[[x_var]])
m_v <- as.numeric(D[[m_var]])
y_v <- as.numeric(D[[y_var]])
w_v <- as.numeric(D[[w_var]])

# 均数中心化：a2 才能解释为 W 处于均值时的条件前段效应；
# 同时避免 X 与 X*W 的高共线（未中心化时 X*W 与 X 的相关常达 0.9 以上）
x_c <- x_v - mean(x_v)
w_c <- w_v - mean(w_v)
sd_w <- sd(w_c)
if (sd_w <= 0) {
  stop("调节变量 ", w_var, " 的标准差为 0，无法构造交互项")
}
xw <- x_c * w_c

# ─────────────────────────────────────────────────────────────
# 步骤 2：两个方程的 OLS
# ─────────────────────────────────────────────────────────────
fit_m <- lm(m_v ~ x_c + w_c + xw)
fit_y <- lm(y_v ~ m_v + x_c)
sm_m <- summary(fit_m)
sm_y <- summary(fit_y)
cm <- sm_m$coefficients
cy <- sm_y$coefficients

# 设计矩阵奇异（例如 W 与 X 完全共线）会让系数变 NA，
# 这时继续算 a4*b 只会得到 NA，不如直接给出可操作的提示
if (any(!is.finite(cm[, 1])) || any(!is.finite(cy[, 1]))) {
  stop("回归系数不可估计（设计矩阵奇异）：请检查 ", x_var, " 与 ", w_var,
       " 是否高度共线，或交互项方差是否为 0")
}

a2 <- as.numeric(cm["x_c", 1])
a3 <- as.numeric(cm["w_c", 1])
a4 <- as.numeric(cm["xw", 1])
b_coef <- as.numeric(cy["m_v", 1])
c_prime <- as.numeric(cy["x_c", 1])

cat(sprintf("MM_SPEC|%d|%s|%s|%s|%s\\n", n, x_var, m_var, y_var, w_var))
for (tm in rownames(cm)) {
  cat(sprintf("MM_COEF|m|%s|%s|%s|%s|%s|%s\\n", tm, num(as.numeric(cm[tm, 1])),
    num(as.numeric(cm[tm, 2])), num(as.numeric(cm[tm, 3])),
    fmt_p(as.numeric(cm[tm, 4])), num_p(as.numeric(cm[tm, 4]))))
}
for (tm in rownames(cy)) {
  cat(sprintf("MM_COEF|y|%s|%s|%s|%s|%s|%s\\n", tm, num(as.numeric(cy[tm, 1])),
    num(as.numeric(cy[tm, 2])), num(as.numeric(cy[tm, 3])),
    fmt_p(as.numeric(cy[tm, 4])), num_p(as.numeric(cy[tm, 4]))))
}

# ─────────────────────────────────────────────────────────────
# 步骤 3：Bootstrap（percentile，B = 5000，固定种子）
# ─────────────────────────────────────────────────────────────
n_boot <- 5000L
boot_seed <- 20260101L
ci_level <- 0.95
set.seed(boot_seed)
idx_all <- seq_len(n)
boot_index <- rep(NA_real_, n_boot)
boot_ind_m1 <- rep(NA_real_, n_boot)
boot_ind_0 <- rep(NA_real_, n_boot)
boot_ind_p1 <- rep(NA_real_, n_boot)
boot_a2 <- rep(NA_real_, n_boot)
boot_a4 <- rep(NA_real_, n_boot)
boot_b <- rep(NA_real_, n_boot)
m1_w <- mean(w_v) - sd_w
p1_w <- mean(w_v) + sd_w
n_boot_ok <- 0L
for (bt in seq_len(n_boot)) {
  bi <- sample(idx_all, n, replace = TRUE)
  xb <- x_c[bi]
  mb <- m_v[bi]
  yb <- y_v[bi]
  wb <- w_c[bi]
  fmb <- try(stats::lm.fit(cbind(1, xb, wb, xb * wb), mb), silent = TRUE)
  if (inherits(fmb, "try-error") || any(!is.finite(fmb$coefficients))) {
    next
  }
  fyb <- try(stats::lm.fit(cbind(1, mb, xb), yb), silent = TRUE)
  if (inherits(fyb, "try-error") || any(!is.finite(fyb$coefficients))) {
    next
  }
  a2b <- fmb$coefficients[2]
  a4b <- fmb$coefficients[4]
  bb <- fyb$coefficients[2]
  n_boot_ok <- n_boot_ok + 1L
  boot_a2[bt] <- a2b
  boot_a4[bt] <- a4b
  boot_b[bt] <- bb
  boot_index[bt] <- a4b * bb
  boot_ind_m1[bt] <- (a2b + a4b * (m1_w - mean(w_v))) * bb
  boot_ind_0[bt] <- a2b * bb
  boot_ind_p1[bt] <- (a2b + a4b * (p1_w - mean(w_v))) * bb
}
if (n_boot_ok < 0.9 * n_boot) {
  stop("Bootstrap 有效重抽样仅 ", n_boot_ok, "/", n_boot,
       " 次（低于 90%）：数据可能存在严重共线或极端值，无法给出可靠的经验分布 CI")
}
alpha2 <- (1 - ci_level) / 2
boot_trim <- function(v) {
  vv <- v[is.finite(v)]
  if (length(vv) < 2) {
    return(c(NA_real_, NA_real_))
  }
  as.numeric(stats::quantile(vv, probs = c(alpha2, 1 - alpha2), type = 7, na.rm = TRUE))
}

index_val <- a4 * b_coef
ci_index <- boot_trim(boot_index)
ci_m1 <- boot_trim(boot_ind_m1)
ci_0 <- boot_trim(boot_ind_0)
ci_p1 <- boot_trim(boot_ind_p1)

cat(sprintf("MM_INDEX|%s|%s|%s|%s\\n", num(index_val),
  num(sd(boot_index[is.finite(boot_index)])), num(ci_index[1]), num(ci_index[2])))
cat(sprintf("MM_BOOT|%d|%d|%s|percentile\\n", n_boot, boot_seed, num(ci_level, 2)))

# 条件间接效应：W 取 mean-SD / mean / mean+SD 三个水平
lvl_name <- c("-1SD", "mean", "+1SD")
lvl_val <- c(m1_w, mean(w_v), p1_w)
a_cond <- a2 + a4 * (lvl_val - mean(w_v))
ind_cond <- a_cond * b_coef
ci_cond <- list(ci_m1, ci_0, ci_p1)
for (q in seq_len(3)) {
  cat(sprintf("MM_COND|%s|%s|%s|%s|%s|%s\\n", lvl_name[q], num(lvl_val[q]),
    num(a_cond[q]), num(ind_cond[q]), num(ci_cond[[q]][1]), num(ci_cond[[q]][2])))
}

# ─────────────────────────────────────────────────────────────
# 步骤 4：提示
# ─────────────────────────────────────────────────────────────
if (n_dropped > 0) {
  cat(sprintf("MM_NOTE|因缺失值采用逐行删除（listwise / 个案剔除），剔除 %d 行，有效样本 %d\\n", n_dropped, n))
}
cat(sprintf("MM_NOTE|X 与 W 均已做均数中心化（X 均值 %s，W 均值 %s），因此 a2 表示 W 处于均值时的条件前段效应\\n",
  num(mean(x_v)), num(mean(w_v))))
# ── 模型设定声明（v0.3.3 / D04）──
# 结局方程用的是 Y ~ M + X_c，**未纳入 W 的主效应**。
# 这是 Hayes Model 7 的一种常见设定取舍（不同文献与实现并不一致），
# 不是计算错误；但当 W 在理论上直接影响 Y（年龄、性别、负性情感、社会赞许性等
# 背景/人格变量都属此类）时，b 路径与 index 会偏离「含 W」的设定（实测 0.7%~7.2%）。
# 用户看不到这个取舍，就可能把设定差异误当成数据结论，因此必须显式声明。
cat(sprintf("MM_NOTE|模型设定：中介方程 M ~ X_c + W_c + X_c:W_c；结局方程 Y ~ M + X_c。结局方程未纳入 W 的主效应（也未纳入 X_c:W_c），这是本工具的固定设定。若理论上 W 直接影响 Y，请改用含 W 主效应的设定或自行复核\\n"))
cat(sprintf("MM_NOTE|能力边界：本工具仅支持调节前半段路径（X -> M）。第二阶段的调节（M x W -> Y，Process Model 14）、双阶段调节（Model 15）与多重中介链均不支持\\n"))
cat(sprintf("MM_NOTE|index of moderated mediation = a4 x b = %s；CI 来自 %d 次 percentile Bootstrap（种子 %d，95%% 水平）\\n",
  num(index_val), n_boot, boot_seed))
cat(sprintf("MM_NOTE|重要：index 显著只说明条件间接效应随 W 变化，不等于每个 W 水平上的间接效应都显著；两者必须分开报告\\n"))

index_ci_excl0 <- is.finite(ci_index[1]) && is.finite(ci_index[2]) &&
  ((ci_index[1] > 0 && ci_index[2] > 0) || (ci_index[1] < 0 && ci_index[2] < 0))
cond_ci_excl0 <- vapply(seq_len(3), function(q) {
  is.finite(ci_cond[[q]][1]) && is.finite(ci_cond[[q]][2]) &&
    ((ci_cond[[q]][1] > 0 && ci_cond[[q]][2] > 0) ||
     (ci_cond[[q]][1] < 0 && ci_cond[[q]][2] < 0))
}, logical(1))
n_cond_sig <- sum(cond_ci_excl0)

if (index_ci_excl0) {
  cat(sprintf("MM_NOTE|index 的 95%% CI 不含 0（%s, %s），支持「有调节的中介」的存在\\n",
    num(ci_index[1]), num(ci_index[2])))
} else {
  cat(sprintf("MM_NOTE|index 的 95%% CI 包含 0（%s, %s），没有证据支持条件间接效应随 W 变化\\n",
    num(ci_index[1]), num(ci_index[2])))
}
if (index_ci_excl0 && n_cond_sig < 3) {
  cat(sprintf("MM_NOTE|注意：index 显著但只有 %d/3 个 W 水平上的条件间接效应 CI 不含 0 —— 这是完全正常的组合，report 时应如实说明「调节存在于整体趋势，而非每个水平都显著」\\n",
    n_cond_sig))
}
if (!index_ci_excl0 && n_cond_sig > 0) {
  cat(sprintf("MM_NOTE|注意：index 的 CI 包含 0，但有 %d/3 个水平上的条件间接效应 CI 不含 0；这种不一致通常说明样本量不足或效应较弱，不宜据此宣称有调节的中介\\n",
    n_cond_sig))
}
if (!is.finite(index_ci_excl0)) {
  cat(sprintf("MM_NOTE|index 的 Bootstrap CI 含非有限值，结果不可靠\\n"))
}
med_check <- abs(index_val - (a4 * b_coef))
if (!is.finite(med_check) || med_check > 1e-10) {
  stop("内部自检失败：index != a4 x b（偏差 ", num_sig(med_check), "）")
}
ind_check <- abs(ind_cond[2] - a2 * b_coef)
if (!is.finite(ind_check) || ind_check > 1e-10) {
  stop("内部自检失败：W 均值处的条件间接效应 != a2 x b（偏差 ", num_sig(ind_check), "）")
}

concl_txt <- "没有证据支持有调节的中介：index 的 Bootstrap CI 包含 0"
if (index_ci_excl0) {
  if (n_cond_sig == 3) {
    concl_txt <- "支持有调节的中介：index 的 Bootstrap CI 不含 0，且三个 W 水平上的条件间接效应均显著"
  } else {
    if (n_cond_sig >= 1) {
      concl_txt <- "支持有调节的中介：index 的 Bootstrap CI 不含 0，但仅在部分 W 水平上条件间接效应显著"
    } else {
      concl_txt <- "index 的 Bootstrap CI 不含 0，但三个 W 水平上的条件间接效应均不显著：调节体现在整体趋势上，逐水平证据不足"
    }
  }
}
cat(sprintf("CONCL|%s（index = %s，95%% CI [%s, %s]；条件间接效应显著的 W 水平 %d/3）\\n",
  concl_txt, num(index_val), num(ci_index[1]), num(ci_index[2]), n_cond_sig))
`
}
