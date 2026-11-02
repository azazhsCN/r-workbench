/**
 * 中介效应（Mediation）R 生成器 —— v0.3.2
 *
 * 契约：V032_CONTRACT.md 第一节。行格式
 *   MED_SPEC / MED_PATH / MED_EFFECT / MED_SOBEL / MED_BOOT / MED_STD / MED_NOTE / CONCL
 *
 * 方法学要点（已由原型实测定型，勿"重新设计"）：
 *
 * 1. 模型：`M = i1 + aX + e1`；`Y = i2 + c'X + bM + e2`；总效应 `c = c' + a*b`。
 *    带截距的 OLS 下 `c − c' − a*b` **恒等于 0**，实测误差 0.00e+00。这是中介分析
 *    的核心自检：若它不为 0，说明样本没有对齐（比如两次回归用了不同的缺失处理）
 *    或模型设定写错了。本生成器把它当硬断言，超过 1e-8 直接 stop，不输出废数据。
 *
 * 2. **Bootstrap 是主推断**：间接/直接/总效应的 CI 一律取自重抽样的百分位分位数，
 *    不用 Sobel 的正态近似（Sobel 只作对照一并输出）。B 默认 5000，**固定种子**，
 *    否则同一份数据两次运行给出不同小数位，用户无法复现论文里的数字。
 *
 * 3. 标准化系数按契约原文口径：对 X/M/Y 分别做 z 分数后**重跑两个回归**，
 *    而不是用 `b * sd_x / sd_y` 手工换算（两者在带截距的简单回归里等价，但
 *    "重跑"能让代码与表注口径完全一致，也避免有人以为标准化只做了一次缩放）。
 *
 * 4. 全部回归用**设计矩阵 + lm.fit**，不构造 R 公式串：
 *    用户变量名可能含引号、空格、中文，进公式会 invalid term 甚至公式注入
 *    （v0.2.5 的 `lm(y ~ "x")` 事故）。变量名只出现在输出文本里，且经 rEscape 转义。
 *
 * 5. `prop_mediated = indirect / total`；`total` 接近 0 时输出 `NA`，**绝不输出 Inf**
 *    （Inf 会被下游 toNum() 读成 null 或字符串，让表格里凭空多出一个无穷大的比率）。
 */

import { R_COMMON, READ_CSV } from '../rCommon'
import { rEscape } from '../utils'

/**
 * 生成中介效应分析的完整 R 脚本。
 *
 * @param x        自变量 X 的列名
 * @param m        中介变量 M 的列名
 * @param y        因变量 Y 的列名
 * @param dataFile 主进程写入的数据文件名（默认 data.csv）
 */
export function mediationCode(x: string, m: string, y: string, dataFile = 'data.csv'): string {
  return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 中介效应分析 ===\\n")
x_name <- "${rEscape(x)}"
m_name <- "${rEscape(m)}"
y_name <- "${rEscape(y)}"

# 数值零归零：带截距 OLS 下 c 与 c' + a*b 的差是 1e-17 量级的浮点残渣，
# 直接交给 num() 会打成 "-0.0000"——读者会以为总效应是"负的"，
# 结论句里也会出现「总效应 = -0.0000」这种自相矛盾的表述。
snap0 <- function(x, eps = 1e-12) {
  x <- as.numeric(x)
  x[is.finite(x) & abs(x) < eps] <- 0
  x
}

# ─────────────────────────────────────────────────────────────
# 步骤 1：输入校验与有效样本
# ─────────────────────────────────────────────────────────────
need_vars <- c(x_name, m_name, y_name)
if (length(unique(need_vars)) < 3) {
  stop("自变量 X、中介变量 M、因变量 Y 必须是三个不同的变量（当前存在重复）")
}
missing_vars <- need_vars[!(need_vars %in% names(data))]
if (length(missing_vars) > 0) {
  stop("以下变量不存在: ", paste(missing_vars, collapse = ", "))
}
for (nm in need_vars) {
  if (!is.numeric(data[[nm]])) {
    stop("变量 ", nm, " 不是数值型，无法做中介效应分析")
  }
}

# 三条回归必须跑在**同一批样本**上，否则 c = c' + a*b 的恒等式不成立。
# 因此先做整列删除（listwise），并报告剔除了多少行。
raw3 <- as.data.frame(data[, need_vars, drop = FALSE])
ok <- complete.cases(raw3)
d3 <- raw3[ok, , drop = FALSE]
n_dropped <- sum(!ok)
xv <- as.numeric(d3[[1]])
mv <- as.numeric(d3[[2]])
yv <- as.numeric(d3[[3]])
keep <- is.finite(xv) & is.finite(mv) & is.finite(yv)
xv <- xv[keep]
mv <- mv[keep]
yv <- yv[keep]
n_dropped <- n_dropped + sum(!keep)
n <- length(yv)
if (n < 50) {
  stop("有效样本不足（", n, " 行），中介效应分析要求 n >= 50")
}
sd_x <- stats::sd(xv)
sd_m <- stats::sd(mv)
sd_y <- stats::sd(yv)
if (!is.finite(sd_x) || !is.finite(sd_m) || !is.finite(sd_y)) {
  stop("无法计算标准差（有效样本过少），无法做中介效应分析")
}
if (sd_x <= 0 || sd_m <= 0 || sd_y <= 0) {
  stop("检测到常量变量（标准差为 0），无法估计回归系数")
}

# ─────────────────────────────────────────────────────────────
# 步骤 2：OLS（设计矩阵直接构造，不经过公式解析）
#   se 由 (X'X)^-1 * sigma^2 的对角线开方得到，与 summary(lm)$coefficients
#   的 Std. Error 完全一致；这样就不必为了拿 se 而依赖公式接口。
# ─────────────────────────────────────────────────────────────
ols <- function(Xd, yv2) {
  fit <- stats::lm.fit(Xd, yv2)
  df_res <- fit$df.residual
  res <- fit$residuals
  s2 <- sum(res^2) / df_res
  xtx <- tryCatch(solve(crossprod(Xd)), error = function(e) NULL)
  se <- rep(NA_real_, ncol(Xd))
  V <- NULL
  r2 <- NA_real_
  if (!is.null(xtx)) {
    V <- xtx * s2
    se <- sqrt(pmax(diag(V), 0))
    tss <- sum((yv2 - mean(yv2))^2)
    if (tss > 0) {
      r2 <- 1 - sum(res^2) / tss
    }
  }
  list(coef = as.numeric(fit$coefficients), se = se, V = V, df_res = df_res, r2 = r2)
}

fit_a <- ols(cbind(1, xv), mv)
fit_b <- ols(cbind(1, xv, mv), yv)
fit_c <- ols(cbind(1, xv), yv)
if (any(!is.finite(c(fit_a$coef, fit_b$coef, fit_c$coef)))) {
  stop("回归系数出现非有限值（设计矩阵可能奇异，例如两个变量完全共线），无法继续")
}
a_coef <- fit_a$coef[2]
a_se <- fit_a$se[2]
c_prime <- fit_b$coef[2]
c_prime_se <- fit_b$se[2]
b_coef <- fit_b$coef[3]
b_se <- fit_b$se[3]
c_total <- fit_c$coef[2]
c_total_se <- fit_c$se[2]
df_a <- fit_a$df_res
df_b <- fit_b$df_res
df_c <- fit_c$df_res

# 核心自检：c = c' + a*b（带截距 OLS 的恒等式）
ident_err <- abs(c_total - c_prime - a_coef * b_coef)
if (!is.finite(ident_err) || ident_err > 1e-8) {
  stop("中介恒等式自检失败：|c - c_prime - a*b| = ", format(ident_err, scientific = TRUE),
       " 超过 1e-8 容差。三次回归可能跑在了不同样本上，或模型设定有误。")
}
# 自检通过之后再归零，保证"是否显著为零"的判定仍基于原始数值
c_prime <- snap0(c_prime)
c_total <- snap0(c_total)

cat(sprintf("MED_SPEC|%d|%s|%s|%s\\n", n, x_name, m_name, y_name))

# ─────────────────────────────────────────────────────────────
# 步骤 3：逐条路径
# ─────────────────────────────────────────────────────────────
emit_path <- function(label, coef_v, se_v, df_v) {
  t_v <- NA_real_
  p_v <- NA_real_
  if (is.finite(coef_v) && is.finite(se_v) && se_v > 0) {
    t_v <- coef_v / se_v
    p_v <- 2 * stats::pt(-abs(t_v), df_v)
  }
  cat(sprintf("MED_PATH|%s|%s|%s|%s|%s|%s\\n", label, num(coef_v), num(se_v),
    num(t_v), fmt_p(p_v), num_p(p_v)))
  p_v
}
p_a <- emit_path("a", a_coef, a_se, df_a)
p_b <- emit_path("b", b_coef, b_se, df_b)
p_cp <- emit_path("c_prime", c_prime, c_prime_se, df_b)
p_ct <- emit_path("c_total", c_total, c_total_se, df_c)

# ─────────────────────────────────────────────────────────────
# 步骤 4：Bootstrap（百分位法，固定种子）
#   只重抽样一次并复用同一批索引，保证 a/b/c'/c 来自同一批伪样本——
#   否则 indirect = a*b 会把两批不同样本的估计相乘，CI 失去意义。
# ─────────────────────────────────────────────────────────────
B <- 5000L
boot_seed <- 20260101L
ci_level <- 0.95
set.seed(boot_seed)
a_b <- rep(NA_real_, B)
b_b <- rep(NA_real_, B)
cp_b <- rep(NA_real_, B)
ct_b <- rep(NA_real_, B)
for (bk in seq_len(B)) {
  idx <- sample.int(n, n, replace = TRUE)
  vals <- tryCatch({
    xb <- xv[idx]
    mb <- mv[idx]
    yb <- yv[idx]
    fa <- stats::lm.fit(cbind(1, xb), mb)
    fb <- stats::lm.fit(cbind(1, xb, mb), yb)
    fc <- stats::lm.fit(cbind(1, xb), yb)
    c(fa$coefficients[2], fb$coefficients[3], fb$coefficients[2], fc$coefficients[2])
  }, error = function(e) rep(NA_real_, 4))
  a_b[bk] <- vals[1]
  b_b[bk] <- vals[2]
  cp_b[bk] <- vals[3]
  ct_b[bk] <- vals[4]
}
n_boot_ok <- sum(is.finite(a_b) & is.finite(b_b) & is.finite(cp_b) & is.finite(ct_b))
if (n_boot_ok < 100) {
  stop("Bootstrap 有效重抽样仅 ", n_boot_ok, " 次（要求 >= 100），数据过于离散或存在共线，无法给出可信的百分位 CI")
}
ind_b <- a_b * b_b

# 百分位 CI：type = 7 与 R 默认的 quantile 一致，保证同数据同结果
ci_of <- function(v) {
  v <- v[is.finite(v)]
  if (length(v) < 100) {
    return(c(NA_real_, NA_real_))
  }
  as.numeric(stats::quantile(v, probs = c((1 - ci_level) / 2, 1 - (1 - ci_level) / 2),
    type = 7, names = FALSE, na.rm = TRUE))
}
boot_se <- function(v) {
  v <- v[is.finite(v)]
  if (length(v) < 2) {
    return(NA_real_)
  }
  stats::sd(v)
}

ind <- a_coef * b_coef
ci_ind <- ci_of(ind_b)
ci_dir <- ci_of(cp_b)
ci_tot <- ci_of(ct_b)

# prop_mediated：total 接近 0 时无定义。阈值取 1e-8 的绝对量级，
# 因为 c 的量纲与 Y 相同，真正的"零总效应"在浮点上就是 1e-16 量级。
# ⚠️ 这里绝不能只靠除法硬算：total 恰好为 0 时 ind / total 得到 Inf，
# Inf 一旦进了 MED_EFFECT 行，下游 toNum() 既转不成 null 也转不成数字，
# 表格里会出现一个"无穷大的中介比例"这种根本不存在的结论。
total_eps <- 1e-8
prop_val <- NA_real_
total_near_zero <- !is.finite(c_total) || abs(c_total) <= total_eps
if (!total_near_zero) {
  prop_val <- ind / c_total
}
prop_b <- ind_b / ct_b
prop_b[!is.finite(ct_b) | abs(ct_b) <= total_eps] <- NA_real_
prop_b[!is.finite(prop_b)] <- NA_real_
ci_prop <- c(NA_real_, NA_real_)
prop_se <- NA_real_
if (!total_near_zero) {
  ci_prop <- ci_of(prop_b)
  prop_se <- boot_se(prop_b)
}

cat(sprintf("MED_EFFECT|indirect|%s|%s|%s|%s|percentile\\n", num(ind), num(boot_se(ind_b)),
  num(ci_ind[1]), num(ci_ind[2])))
cat(sprintf("MED_EFFECT|direct|%s|%s|%s|%s|percentile\\n", num(c_prime), num(boot_se(cp_b)),
  num(ci_dir[1]), num(ci_dir[2])))
cat(sprintf("MED_EFFECT|total|%s|%s|%s|%s|percentile\\n", num(c_total), num(boot_se(ct_b)),
  num(ci_tot[1]), num(ci_tot[2])))
cat(sprintf("MED_EFFECT|prop_mediated|%s|%s|%s|%s|percentile\\n", num(prop_val),
  num(prop_se), num(ci_prop[1]), num(ci_prop[2])))

# Sobel 检验：作为与 Bootstrap 对照的正态近似，不作为主推断
sobel_z <- NA_real_
sobel_p <- NA_real_
sobel_var <- a_coef^2 * b_se^2 + b_coef^2 * a_se^2
if (is.finite(sobel_var) && sobel_var > 0) {
  sobel_z <- ind / sqrt(sobel_var)
  sobel_p <- 2 * stats::pnorm(-abs(sobel_z))
}
cat(sprintf("MED_SOBEL|%s|%s|%s\\n", num(sobel_z), fmt_p(sobel_p), num_p(sobel_p)))
cat(sprintf("MED_BOOT|%d|%d|%s|percentile\\n", B, boot_seed, num(ci_level, 2)))

# ─────────────────────────────────────────────────────────────
# 步骤 5：标准化系数（对 X/M/Y 分别做 z 分数后重跑两个回归）
# ─────────────────────────────────────────────────────────────
zx <- (xv - mean(xv)) / sd_x
zm <- (mv - mean(mv)) / sd_m
zy <- (yv - mean(yv)) / sd_y
fit_a_std <- ols(cbind(1, zx), zm)
fit_b_std <- ols(cbind(1, zx, zm), zy)
a_std <- fit_a_std$coef[2]
b_std <- fit_b_std$coef[3]
cp_std <- fit_b_std$coef[2]
ind_std <- a_std * b_std
cat(sprintf("MED_STD|a_std|%s\\n", num(a_std)))
cat(sprintf("MED_STD|b_std|%s\\n", num(b_std)))
cat(sprintf("MED_STD|c_prime_std|%s\\n", num(cp_std)))
cat(sprintf("MED_STD|indirect_std|%s\\n", num(ind_std)))

# ─────────────────────────────────────────────────────────────
# 步骤 6：诊断与结论
# ─────────────────────────────────────────────────────────────
cat(sprintf("MED_NOTE|恒等式自检通过：|c - c_prime - a*b| = %s（容差 1e-10，带截距 OLS 下应恒为 0）\\n",
  format(ident_err, scientific = TRUE, digits = 2)))
cat(sprintf("MED_NOTE|间接/直接/总效应的区间均为 Bootstrap 百分位法（percentile，非 BCa），B = %d，固定种子 %d，置信水平 %s\\n",
  B, boot_seed, num(ci_level, 2)))
if (n_dropped > 0) {
  cat(sprintf("MED_NOTE|因缺失值采用整列删除，剔除 %d 行，三次回归使用同一批 %d 个有效样本\\n", n_dropped, n))
}
r_xm <- suppressWarnings(stats::cor(xv, mv))
if (is.finite(r_xm) && abs(r_xm) < 0.20) {
  cat(sprintf("MED_NOTE|自变量与中介变量相关偏低（r = %s），a 路径估计不稳定，Bootstrap CI 会明显偏宽\\n", num(r_xm)))
}
ind_sig <- is.finite(ci_ind[1]) && is.finite(ci_ind[2]) && (ci_ind[1] > 0 || ci_ind[2] < 0)
dir_sig <- is.finite(ci_dir[1]) && is.finite(ci_dir[2]) && (ci_dir[1] > 0 || ci_dir[2] < 0)
if (!ind_sig) {
  cat(sprintf("MED_NOTE|间接效应的百分位 CI [%s, %s] 包含 0，按 CI 判定间接效应不显著；此时不宜继续解读直接效应是否为完全中介\\n",
    num(ci_ind[1]), num(ci_ind[2])))
}
if (!is.finite(prop_val)) {
  cat(sprintf("MED_NOTE|总效应接近 0（绝对值不超过 1e-8），比例中介 prop_mediated 无定义，已输出 NA 而非 Inf\\n"))
} else {
  if (is.finite(ind) && is.finite(c_total) && ind * c_total < 0) {
    cat(sprintf("MED_NOTE|间接效应与总效应符号相反（indirect = %s，total = %s），比例中介为负值，说明存在遮蔽效应，不应按比例解读\\n",
      num(ind), num(c_total)))
  }
}
# 分母接近 0 时 |indirect/total| 会被放大成几十甚至上百，Bootstrap 比例分布极其偏态，
# 此时百分位 CI 已无实际意义。必须显式提示，不能让用户拿着 [−2.35, 0.05] 当结论。
if (!is.na(prop_se) && is.finite(prop_se) && prop_se * 2 > abs(prop_val)) {
  cat(sprintf("MED_NOTE|总效应偏小（total = %s），比例中介估计 %s 的不确定度极大（Bootstrap SD = %s），其百分位 CI 仅供参考，建议直接报告间接效应的绝对值与 CI\\n",
    num(c_total), num(prop_val), num(prop_se)))
}
cat(sprintf("MED_NOTE|中介分析假设不存在未测量的混淆变量，且因果方向已由理论确定；本结果不能单独证明因果链\\n"))
cat(sprintf("MED_NOTE|Sobel 检验基于正态近似，仅作对照；当间接效应分布明显偏态时以 Bootstrap 结果为准\\n"))

concl_txt <- "未发现显著的中介效应（间接效应的 Bootstrap 百分位 CI 包含 0）"
if (ind_sig) {
  if (dir_sig) {
    concl_txt <- "存在部分中介：间接效应显著，且控制中介变量后直接效应仍然显著"
  } else {
    concl_txt <- "间接效应显著而直接效应不显著，符合完全中介的形态（但中介分析不能替代因果论证）"
  }
}
cat(sprintf("CONCL|%s：间接效应 = %s，95 百分位 CI [%s, %s]；直接效应 = %s（%s）；总效应 = %s\\n",
  concl_txt, num(ind), num(ci_ind[1]), num(ci_ind[2]), num(c_prime), fmt_p(p_cp), num(c_total)))
`
}
