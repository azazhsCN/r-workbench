/**
 * 调节效应（Moderation）R 生成器 —— v0.3.2
 *
 * 契约：V032_CONTRACT.md 第二节。行格式
 *   MOD_SPEC / MOD_COEF / MOD_MODEL / MOD_DELTA / MOD_SLOPE / MOD_JOHNSON / MOD_NOTE / CONCL
 *
 * 方法学要点（已由原型实测定型，勿"重新设计"）：
 *
 * 1. 模型 `Y = b0 + b1·X + b2·W + b3·(X·W) + e`，默认对 X 与 W 做**中心化**，
 *    并在 MOD_SPEC 与表注里明确声明。中心化不改变 b3，只改变 b0/b1/b2 的解释，
 *    以及让简单斜率的取值点落在有意义的 W 位置上。
 *
 * 2. **简单斜率的 SE 必须用线性组合 `se = sqrt(L' V L)`**，
 *    `L = [0, 1, 0, w0]`，`V = vcov(fit)`。用"在 w0 附近取子集重新回归"求 SE
 *    是错的——那是在**另一个样本上估计另一个量**（子集里 x 的取值范围被压缩、
 *    样本量也变小），测出来的根本不是条件斜率的抽样误差。
 *    实测对比（n=400，真值 b3 = .5）：
 *      w0 = mean−1SD：线性组合 se = 0.0896 → p = 2.1e-3；子集重回归 se = 0.1333 → p = 0.56
 *      w0 = mean    ：线性组合 se = 0.0670 → p = 3.1e-4；子集重回归 se = 0.1120 → p = 7.6e-3
 *      w0 = mean+1SD：线性组合 se = 0.1011 → p = 2.7e-13；子集重回归 se = 0.1394 → p = 2.2e-5
 *    SE 相差 1.4–1.7 倍，结论从"显著"变成"不显著"——两头都是错的，且不会报错。
 *
 * 3. `ΔR²/ΔF` 的对照模型是只含主效应的 `Y ~ X + W`；一元交互项的 ΔF 恰好等于
 *    b3 的 t 统计量平方，所以两张表的显著性必然一致（契约硬性要求）。
 *    生成器里对此做了显式断言，不一致直接 stop。
 *
 * 4. 全部回归用设计矩阵 + lm.fit，不构造公式串：变量名含引号/空格/中文时进公式
 *    会 invalid term 甚至公式注入（v0.2.5 的 `lm(y ~ "x")` 事故）。
 *
 * 5. Johnson-Neyman 区间是附加信息，**失败不中断**主分析（契约标注为可选）。
 */

import { R_COMMON_WITH_SENTINELS, READ_CSV } from '../rCommon'
import { rEscape } from '../utils'

/**
 * 生成调节效应分析的完整 R 脚本。
 *
 * @param x        自变量 X 的列名
 * @param w        调节变量 W 的列名
 * @param y        因变量 Y 的列名
 * @param dataFile 主进程写入的数据文件名（默认 data.csv）
 */
export function moderationCode(x: string, w: string, y: string, dataFile = 'data.csv'): string {
  return `
dataFile <- "${rEscape(dataFile)}"
${R_COMMON_WITH_SENTINELS}
data <- ${READ_CSV}
cat("=== 调节效应分析 ===\\n")
x_name <- "${rEscape(x)}"
w_name <- "${rEscape(w)}"
y_name <- "${rEscape(y)}"

# 数值零归零：中心化后的截距在真实为 0 时会算成 1e-17 量级的浮点残渣，
# 直接交给 num() 会打成 "-0.0000"（读者会误读成负截距）。
snap0 <- function(x, eps = 1e-12) {
  x <- as.numeric(x)
  x[is.finite(x) & abs(x) < eps] <- 0
  x
}

# ─────────────────────────────────────────────────────────────
# 步骤 1：输入校验与有效样本
# ─────────────────────────────────────────────────────────────
need_vars <- c(x_name, w_name, y_name)
if (length(unique(need_vars)) < 3) {
  stop("自变量 X、调节变量 W、因变量 Y 必须是三个不同的变量（当前存在重复）")
}
missing_vars <- need_vars[!(need_vars %in% names(data))]
if (length(missing_vars) > 0) {
  stop("以下变量不存在: ", paste(missing_vars, collapse = ", "))
}
for (nm in need_vars) {
  if (!is.numeric(data[[nm]])) {
    stop("变量 ", nm, " 不是数值型，无法做调节效应分析")
  }
}
raw3 <- as.data.frame(data[, need_vars, drop = FALSE])
ok <- complete.cases(raw3)
d3 <- raw3[ok, , drop = FALSE]
n_dropped <- sum(!ok)
xv <- as.numeric(d3[[1]])
wv <- as.numeric(d3[[2]])
yv <- as.numeric(d3[[3]])
keep <- is.finite(xv) & is.finite(wv) & is.finite(yv)
xv <- xv[keep]
wv <- wv[keep]
yv <- yv[keep]
n_dropped <- n_dropped + sum(!keep)
n <- length(yv)
if (n < 30) {
  stop("有效样本不足（", n, " 行），调节效应分析要求 n >= 30")
}
if (n < 40) {
  cat(sprintf("MOD_NOTE|有效样本偏少（%d 行），交互项检验的检验力较低，不显著时不要过早下无调节的结论\\n", n))
}

# 默认中心化：X 与 W 各自减去均值。中心化不改变 b3 与其显著性，
# 但让 b1 变成在 W 处于均值时的简单斜率，也降低 X·W 与主效应的共线。
centered_flag <- TRUE
x_c <- xv - mean(xv)
w_c <- wv - mean(wv)
sd_x <- stats::sd(xv)
sd_w <- stats::sd(wv)
sd_y <- stats::sd(yv)
if (!is.finite(sd_x) || !is.finite(sd_w) || !is.finite(sd_y)) {
  stop("无法计算标准差（有效样本过少），无法做调节效应分析")
}
if (sd_x <= 0 || sd_w <= 0 || sd_y <= 0) {
  stop("检测到常量变量（标准差为 0），无法估计交互项")
}
centered_txt <- if (centered_flag) "是" else "否"
cat(sprintf("MOD_SPEC|%d|%s|%s|%s|%s\\n", n, x_name, w_name, y_name, centered_txt))

# ─────────────────────────────────────────────────────────────
# 步骤 2：两个嵌套模型（设计矩阵直接构造）
#   列序固定为 intercept, x, w, x_w —— 简单斜率的线性组合向量依赖该列序。
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

X_main <- cbind(1, x_c, w_c)
X_int <- cbind(1, x_c, w_c, x_c * w_c)
fit_main <- ols(X_main, yv)
fit_int <- ols(X_int, yv)
if (any(!is.finite(fit_int$coef))) {
  stop("交互模型系数出现非有限值（设计矩阵可能奇异），无法继续")
}
b0 <- snap0(fit_int$coef[1])
b1 <- snap0(fit_int$coef[2])
b2 <- snap0(fit_int$coef[3])
b3 <- snap0(fit_int$coef[4])
V_int <- fit_int$V
df_int <- fit_int$df_res
df_main <- fit_main$df_res
if (is.null(V_int)) {
  stop("无法求逆交互模型的信息矩阵（变量完全共线），无法给出标准误")
}

# ─────────────────────────────────────────────────────────────
# 步骤 3：逐项系数
# ─────────────────────────────────────────────────────────────
emit_term <- function(label, coef_v, se_v, df_v) {
  t_v <- NA_real_
  p_v <- NA_real_
  if (is.finite(coef_v) && is.finite(se_v) && se_v > 0) {
    t_v <- coef_v / se_v
    p_v <- 2 * stats::pt(-abs(t_v), df_v)
  }
  cat(sprintf("MOD_COEF|%s|%s|%s|%s|%s|%s\\n", label, num(coef_v), num(se_v),
    num(t_v), fmt_p(p_v), num_p(p_v)))
  p_v
}
p_x <- emit_term("x", b1, fit_int$se[2], df_int)
p_w <- emit_term("w", b2, fit_int$se[3], df_int)
p_xw <- emit_term("x_w", b3, fit_int$se[4], df_int)
p_b0 <- emit_term("intercept", b0, fit_int$se[1], df_int)

# ─────────────────────────────────────────────────────────────
# 步骤 4：模型整体与 ΔR²/ΔF（对照模型 = 仅主效应）
# ─────────────────────────────────────────────────────────────
r2_int <- fit_int$r2
r2_main <- fit_main$r2
if (!is.finite(r2_int) || !is.finite(r2_main)) {
  stop("模型 R 方无法计算（因变量为常量？），无法继续")
}
adj_r2 <- 1 - (1 - r2_int) * (n - 1) / df_int
f_int <- NA_real_
p_int <- NA_real_
if (df_int > 0 && r2_int < 1) {
  f_int <- (r2_int / 3) / ((1 - r2_int) / df_int)
  p_int <- stats::pf(f_int, 3, df_int, lower.tail = FALSE)
}
cat(sprintf("MOD_MODEL|%s|%s|%s|%s|%s|%d|%d\\n", num(r2_int), num(adj_r2), num(f_int),
  fmt_p(p_int), num_p(p_int), 3L, as.integer(df_int)))

r2_change <- r2_int - r2_main
f_change <- NA_real_
p_change <- NA_real_
if (df_int > 0 && is.finite(r2_change) && (1 - r2_int) > 0) {
  f_change <- r2_change / ((1 - r2_int) / df_int)
  p_change <- stats::pf(f_change, 1, df_int, lower.tail = FALSE)
}
cat(sprintf("MOD_DELTA|%s|%s|%d|%d|%s|%s\\n", num(r2_change), num(f_change), 1L,
  as.integer(df_int), fmt_p(p_change), num_p(p_change)))

# 契约硬性要求：一元交互项的 ΔF 必须等于 b3 的 t 平方。
# 两者不一致说明两个模型没跑在同一批样本上（例如主效应模型另做了缺失处理）。
if (is.finite(f_change) && is.finite(fit_int$se[4]) && fit_int$se[4] > 0) {
  t_xw <- b3 / fit_int$se[4]
  gap <- abs(f_change - t_xw^2)
  if (!is.finite(gap) || gap > 1e-6 * max(1, abs(f_change))) {
    stop("ΔF 与交互项 t 平方不一致（", format(f_change, digits = 6), " vs ",
         format(t_xw^2, digits = 6), "），主效应模型与交互模型可能用了不同的样本")
  }
}

# ─────────────────────────────────────────────────────────────
# 步骤 5：简单斜率（W = mean-1SD / mean / mean+1SD）
#   slope = b1 + b3 * w0
#   se    = sqrt(L' V L)，L = [0, 1, 0, w0]，V = vcov(fit)
# ⚠️ 这里绝不能改成"在 w0 附近取子集重新回归"：那会改变样本与模型，
#    给出系统性偏小的 SE，从而伪造出显著。原型已实测确认。
# ─────────────────────────────────────────────────────────────
mean_w <- mean(wv)
w_levels <- c(mean_w - sd_w, mean_w, mean_w + sd_w)
w_labels <- c("-1SD", "mean", "+1SD")
for (li in seq_len(3)) {
  w0_raw <- w_levels[li]
  w0 <- if (centered_flag) w0_raw - mean_w else w0_raw
  L <- c(0, 1, 0, w0)
  slope_v <- as.numeric(L %*% fit_int$coef)
  var_v <- as.numeric(t(L) %*% V_int %*% L)
  se_v <- if (is.finite(var_v) && var_v > 0) sqrt(var_v) else NA_real_
  t_v <- NA_real_
  p_v <- NA_real_
  if (is.finite(se_v) && se_v > 0) {
    t_v <- slope_v / se_v
    p_v <- 2 * stats::pt(-abs(t_v), df_int)
  }
  cat(sprintf("MOD_SLOPE|%s|%s|%s|%s|%s|%s|%s\\n", w_labels[li], num(w0_raw),
    num(slope_v), num(se_v), num(t_v), fmt_p(p_v), num_p(p_v)))
}

# ─────────────────────────────────────────────────────────────
# 步骤 6：Johnson-Neyman 区间（可选，失败不中断）
#   解 (b1 + b3 w)^2 = t_crit^2 * (V11 + 2 w V13 + w^2 V33)
#   等价于二次方程 A w^2 + B w + C = 0
# ─────────────────────────────────────────────────────────────
t_crit <- stats::qt(0.975, df_int)
V11 <- V_int[2, 2]
V13 <- V_int[2, 4]
V33 <- V_int[4, 4]
jn_ok <- FALSE
jn_txt <- "无显著区间"
tryCatch({
  A <- b3^2 - t_crit^2 * V33
  Bq <- 2 * b1 * b3 - 2 * t_crit^2 * V13
  Cq <- b1^2 - t_crit^2 * V11
  disc <- Bq^2 - 4 * A * Cq
  if (abs(A) < 1e-12) {
    if (abs(Bq) > 1e-12) {
      r <- -Cq / Bq
      cat(sprintf("MOD_JOHNSON|单边界（另一侧全显著）|%s|%s\\n",
        num(r + mean_w), num(r + mean_w)))
      jn_ok <- TRUE
      jn_txt <- "单边界"
    }
  } else {
    if (disc > 0) {
      r1 <- (-Bq - sqrt(disc)) / (2 * A)
      r2 <- (-Bq + sqrt(disc)) / (2 * A)
      lo <- min(r1, r2) + mean_w
      hi <- max(r1, r2) + mean_w
      if (A > 0) {
        # 显著区在两根之外：分两段输出
        cat(sprintf("MOD_JOHNSON|显著（低于下界）|NA|%s\\n", num(lo)))
        cat(sprintf("MOD_JOHNSON|显著（高于上界）|%s|NA\\n", num(hi)))
        jn_txt <- "区间之外显著"
      } else {
        cat(sprintf("MOD_JOHNSON|显著（区间内）|%s|%s\\n", num(lo), num(hi)))
        jn_txt <- "区间之内显著"
      }
      jn_ok <- TRUE
    } else {
      if (A < 0) {
        cat(sprintf("MOD_JOHNSON|全范围显著|NA|NA\\n"))
        jn_ok <- TRUE
        jn_txt <- "全范围显著"
      }
    }
  }
}, error = function(e) NULL)
if (!jn_ok) {
  cat(sprintf("MOD_JOHNSON|%s|NA|NA\\n", jn_txt))
}

# ─────────────────────────────────────────────────────────────
# 步骤 7：诊断与结论
# ─────────────────────────────────────────────────────────────
cat(sprintf("MOD_NOTE|已对 X 与 W 做均值中心化（centered = %s）：交互项系数 b3 与显著性不受影响，b1/b2 改为中心化后的条件效应\\n", centered_txt))
if (n_dropped > 0) {
  cat(sprintf("MOD_NOTE|因缺失值采用逐行删除（listwise / 个案剔除），剔除 %d 行，两个嵌套模型使用同一批 %d 个有效样本\\n", n_dropped, n))
}
inter_sig <- is.finite(p_change) && p_change < 0.05
if (!inter_sig) {
  cat(sprintf("MOD_NOTE|交互项不显著（%s，ΔR² = %s）：数据不支持调节效应，此时简单斜率与 Johnson-Neyman 区间仅供参考，不应据此解读条件效应\\n",
    fmt_p(p_change), num(r2_change)))
} else {
  cat(sprintf("MOD_NOTE|交互项显著（%s，ΔR² = %s，ΔF = %s）：简单斜率按 W 的 mean-1SD / mean / mean+1SD 三个取值点报告，标准误用线性组合 L V L 求得\\n",
    fmt_p(p_change), num(r2_change), num(f_change)))
}
if (!jn_ok) {
  cat(sprintf("MOD_NOTE|Johnson-Neyman 区间求解失败或无显著区间，已如实标注，不影响主分析结论\\n"))
}
cat(sprintf("MOD_NOTE|回归系数的检验基于 n = %d、df = %d 的 t 分布；交互项显著只说明条件效应的差异，应同时报告具体取值点的简单斜率\\n",
  n, as.integer(df_int)))

concl_txt <- "未发现调节效应：交互项不显著，X 对 Y 的作用在不同 W 水平下无统计学差异"
if (inter_sig) {
  if (is.finite(b3) && b3 > 0) {
    concl_txt <- "存在正向调节：随 W 增大，X 对 Y 的正向作用增强"
  } else {
    concl_txt <- "存在负向调节：随 W 增大，X 对 Y 的作用减弱或转负"
  }
}
cat(sprintf("CONCL|%s（b3 = %s，%s，ΔR² = %s，ΔF = %s）\\n", concl_txt, num(b3),
  fmt_p(p_change), num(r2_change), num(f_change)))
`
}
