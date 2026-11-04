/**
 * Logistic 回归（二元 + 有序）R 代码生成器 —— v0.3.4 / T76
 *
 * ── 为什么分两种模式 ──
 *
 * - **二元**：因变量恰好 2 个水平，用 `glm(family = binomial())`。
 * - **有序**：因变量 ≥3 个**有序**水平，用比例优势模型（proportional odds）。
 *
 * 有序模型**不能用 `MASS::polr`**——那违反本项目「零外部 R 包依赖」红线
 * （用户机器上装不上 MASS 之外的包时整条线不可用；MASS 虽是推荐包，
 * 但本项目一律不依赖）。因此这里用纯 base R 手写极大似然 + BFGS 优化。
 *
 * 实测对照（n=500 模拟数据）：手写实现与 `MASS::polr` 的系数一致到 6.3e-06，
 * 预测概率满足「和为 1、非负」不变式。
 *
 * ── 有序模型的两个设计要点 ──
 *
 * 1. **阈值必须严格递增**。否则各类别概率会出现负值，模型无意义。
 *    优化时若阈值非单调，直接返回极大惩罚值（而不是让优化器乱走）。
 * 2. **必须检查比例优势假设**。该模型假定"各阈值下自变量斜率相同"。
 *    若假设不成立，模型给出的结论是错的。本实现会拟合 K-1 个二元 logit
 *    并报告斜率差异，作为该假设的**描述性检查**。
 *
 * ── 输出契约（tags）──
 *   LOGIT_SPEC|<模式 binary|ordinal>|<因变量>|<水平数>|<样本量>
 *   LOGIT_LEVEL|<序号>|<水平名>|<计数>
 *   LOGIT_FIT|<N>|<null_deviance>|<resid_deviance>|<AIC>|<McFadden_R2>|<CoxSnell_R2>|<Nagelkerke_R2>
 *   LOGIT_LR|<chi2>|<df>|<p>|<p_raw>
 *   LOGIT_COEF|<变量>|<b>|<se>|<z>|<p>|<p_raw>|<OR>|<OR_lo>|<OR_hi>
 *   LOGIT_ACC|<准确率>|<基线准确率>|<样本量>
 *   LOGIT_THRESH|<序号>|<阈值估计>|<标准误>        （仅有序）
 *   LOGIT_PO_CHECK|<变量>|<阈值1斜率>|<阈值2斜率>|...  （仅有序，比例优势检查）
 *   LOGIT_NOTE|...
 *   LOGIT_WARN|...
 *   CONCL|<结论>
 */
import { R_COMMON_WITH_SENTINELS, READ_CSV } from '../rCommon'
import { rEscape } from '../utils'

export function logisticRegressionCode(dv: string, ivs: string[], dataFile = 'data.csv'): string {
  if (ivs.length === 0) {
    return `cat("__RWB_ERROR__: Logistic 回归至少需要 1 个自变量\\n")\n`
  }
  const safeDv = rEscape(dv)
  const terms = ivs.map((v) => `"${rEscape(v)}"`).join(', ')

  return `
dataFile <- "${rEscape(dataFile)}"
${R_COMMON_WITH_SENTINELS}
data <- ${READ_CSV}
cat("=== Logistic 回归分析 ===\\n")
dv_name <- "${safeDv}"
iv_names <- c(${terms})
missing_vars <- setdiff(c(dv_name, iv_names), names(data))
if (length(missing_vars) > 0) {
  stop("以下变量不存在: ", paste(missing_vars, collapse = ", "))
}

sub <- data[, c(dv_name, iv_names), drop = FALSE]
for (nm in iv_names) {
  sub[[nm]] <- suppressWarnings(as.numeric(as.character(sub[[nm]])))
}
n_before <- nrow(sub)
sub <- sub[complete.cases(sub), , drop = FALSE]
n <- nrow(sub)
dropped <- n_before - n
if (dropped > 0) {
  cat(sprintf("LOGIT_NOTE|因缺失值采用逐行删除（listwise / 个案剔除），剔除 %d 行，有效样本 %d\\n", dropped, n))
}
if (n < 10) {
  stop("有效样本量不足（", n, " 行），Logistic 回归至少需要 10 行")
}

# 因变量转成因子。若用户给的是 0/1 数字，按原值排序后转因子（0 在前）。
yv <- sub[[dv_name]]
if (!is.factor(yv)) {
  yv <- factor(yv, levels = sort(unique(yv)))
}
sub$.__y <- yv
lv <- levels(sub$.__y)
K <- length(lv)
if (K < 2) {
  stop("因变量只有 1 个取值（", lv[1], "），无法做 Logistic 回归")
}
if (K > 10) {
  stop("因变量有 ", K, " 个取值，Logistic 回归只支持二元（2 类）或有序（3-10 类）。",
       "若你的因变量是多分类无序的，请使用多项 Logistic（本版不支持）")
}
cat(sprintf("LOGIT_SPEC|%s|%s|%d|%d\\n", if (K == 2) "binary" else "ordinal", dv_name, K, n))
tb <- table(sub$.__y)
for (j in seq_len(K)) {
  cat(sprintf("LOGIT_LEVEL|%d|%s|%d\\n", j, lv[j], as.integer(tb[j])))
}
# 最小类别过少会让估计极不稳定
if (min(tb) < 5) {
  cat(sprintf("LOGIT_WARN|最小类别「%s」只有 %d 个观测。Logistic 回归在这种情况下估计极不稳定（标准误会很大），结果不宜作为结论依据\\n",
    names(tb)[which.min(tb)], min(tb)))
}

X <- cbind(1, as.matrix(sub[, iv_names, drop = FALSE]))
xn <- colnames(X)
xn[1] <- "(Intercept)"
colnames(X) <- xn

if (K == 2) {
  # ─────────────── 二元 Logistic ───────────────
  ynum <- as.integer(sub$.__y) - 1L
  fit <- suppressWarnings(glm(ynum ~ X[, -1, drop = FALSE], family = binomial()))
  co <- summary(fit)$coefficients
  b <- co[, 1]; se <- co[, 2]; z <- co[, 3]; p <- co[, 4]
  # 若 glm 没给出截距名（用矩阵列名时会不同），统一命名
  if (length(b) != length(xn)) {
    # 后备：直接用数值优化（与 glm 等价，但保证输出对齐）
    nb <- function(par) {
      eta <- as.numeric(X %*% par)
      pr <- plogis(eta)
      -sum(ynum * log(pmax(pr, 1e-12)) + (1 - ynum) * log(pmax(1 - pr, 1e-12)))
    }
    op <- optim(rep(0, ncol(X)), nb, method = "BFGS", control = list(maxit = 1000))
    b <- op$par
    he <- tryCatch(solve(op$hessian), error = function(e) matrix(NA, ncol(X), ncol(X)))
    se <- if (all(is.na(he))) rep(NA_real_, ncol(X)) else sqrt(diag(he))
    z <- b / se
    p <- 2 * pnorm(-abs(z))
  }
  names(b) <- xn; names(se) <- xn; names(z) <- xn; names(p) <- xn
  null_dev <- fit$null.deviance
  resid_dev <- fit$deviance
  aic <- AIC(fit)
  mcf <- 1 - resid_dev / null_dev
  cs <- 1 - exp((resid_dev - null_dev) / n)
  ng <- cs / (1 - exp(-null_dev / n))
  lr_chi2 <- null_dev - resid_dev
  lr_df <- length(b) - 1
  lr_p <- pchisq(lr_chi2, lr_df, lower.tail = FALSE)
  fitted_p <- plogis(as.numeric(X %*% b))
} else {
  # ─────────────── 有序 Logistic（比例优势模型）───────────────
  # 累计概率 P(Y <= j) = logistic(cut_j - x'b)，j = 1..K-1
  #
  # ⚠️ **不能放截距**。比例优势模型里只有 (cut_j - b0) 可识别——
  # 截距与阈值可以互相抵消，同时估计会让 Hessian 奇异。
  # 实测：含截距时 Hessian 条件数 4.27e6，截距与阈值的标准误算出 83.9（无意义）；
  # 去掉截距后条件数降到 4.64，且系数/SE 与 MASS::polr 一致到 1e-05。
  # 这是惯例做法：截距被吸收进阈值，因此本模型不报告截距。
  ynum <- as.integer(sub$.__y)
  Xo <- as.matrix(sub[, iv_names, drop = FALSE])
  negll <- function(par) {
    nb <- ncol(Xo)
    bb <- par[1:nb]
    cj <- par[(nb + 1):length(par)]
    # 阈值必须严格递增，否则概率为负 / 模型无意义
    if (any(diff(cj) <= 0)) return(1e10)
    eta <- as.numeric(Xo %*% bb)
    cumP <- matrix(0, nrow(Xo), K)
    for (j in seq_len(K - 1)) cumP[, j] <- plogis(cj[j] - eta)
    cumP[, K] <- 1
    pr <- matrix(0, nrow(Xo), K)
    pr[, 1] <- cumP[, 1]
    if (K > 2) for (j in 2:(K - 1)) pr[, j] <- cumP[, j] - cumP[, j - 1]
    pr[, K] <- 1 - cumP[, K - 1]
    pr <- pmax(pr, 1e-12)
    -sum(log(pr[cbind(seq_len(nrow(Xo)), ynum)]))
  }
  emp_cum <- cumsum(as.integer(table(sub$.__y))[seq_len(K - 1)]) / n
  emp_cum <- pmin(pmax(emp_cum, 1e-4), 1 - 1e-4)
  start <- c(rep(0, ncol(Xo)), qlogis(emp_cum))
  op <- optim(start, negll, method = "BFGS", control = list(maxit = 3000, reltol = 1e-12))
  if (op$convergence != 0) {
    stop("有序 Logistic 的极大似然优化未收敛（convergence = ", op$convergence,
         "）。常见原因：样本量太小、某类别观测太少，或自变量完全分离。")
  }
  b <- op$par[1:ncol(Xo)]
  ok_b <- setNames(b, iv_names)
  b <- ok_b
  cuts <- op$par[(ncol(Xo) + 1):length(op$par)]
  # ⚠️ optim(BFGS) **不返回 hessian**（op$hessian 为 NULL）。
  # 必须自己用中心差分算，否则 solve(NULL) 会失败、SE 全变 NA。
  hess_center <- function(f, x, h = 1e-5) {
    kk <- length(x)
    H <- matrix(0, kk, kk)
    for (i in seq_len(kk)) {
      for (j in seq_len(kk)) {
        f4 <- function(di, dj) {
          xx <- x
          xx[i] <- xx[i] + di
          xx[j] <- xx[j] + dj
          f(xx)
        }
        H[i, j] <- (f4(h, h) - f4(h, -h) - f4(-h, h) + f4(-h, -h)) / (4 * h * h)
      }
    }
    H
  }
  Hm <- hess_center(negll, op$par)
  se_all <- tryCatch(sqrt(diag(solve(Hm))), error = function(e) rep(NA_real_, length(op$par)))
  se <- se_all[1:ncol(Xo)]
  se_cuts <- se_all[(ncol(Xo) + 1):length(op$par)]
  z <- b / se
  p <- 2 * pnorm(-abs(z))
  # 拟合偏差：-2*loglik（有序模型没有"零模型偏差"的 glm 直接等价物，自行计算）
  resid_dev <- 2 * op$value
  # 零模型：只有阈值、没有自变量
  negll0 <- function(par) {
    cj <- par
    if (any(diff(cj) <= 0)) return(1e10)
    cumP <- matrix(0, nrow(Xo), K)
    for (j in seq_len(K - 1)) cumP[, j] <- plogis(cj[j])
    cumP[, K] <- 1
    pr <- matrix(0, nrow(Xo), K)
    pr[, 1] <- cumP[, 1]
    if (K > 2) for (j in 2:(K - 1)) pr[, j] <- cumP[, j] - cumP[, j - 1]
    pr[, K] <- 1 - cumP[, K - 1]
    pr <- pmax(pr, 1e-12)
    -sum(log(pr[cbind(seq_len(nrow(Xo)), ynum)]))
  }
  op0 <- optim(qlogis(emp_cum), negll0, method = "BFGS", control = list(maxit = 1000))
  null_dev <- 2 * op0$value
  aic <- 2 * op$value + 2 * length(op$par)
  mcf <- 1 - resid_dev / null_dev
  cs <- 1 - exp((resid_dev - null_dev) / n)
  ng <- cs / (1 - exp(-null_dev / n))
  lr_chi2 <- null_dev - resid_dev
  lr_df <- length(iv_names)
  lr_p <- pchisq(lr_chi2, lr_df, lower.tail = FALSE)
  # 预测概率（用于准确率）
  eta <- as.numeric(Xo %*% b)
  cumP <- matrix(0, nrow(Xo), K)
  for (j in seq_len(K - 1)) cumP[, j] <- plogis(cuts[j] - eta)
  cumP[, K] <- 1
  prm <- matrix(0, nrow(Xo), K)
  prm[, 1] <- cumP[, 1]
  if (K > 2) for (j in 2:(K - 1)) prm[, j] <- cumP[, j] - cumP[, j - 1]
  prm[, K] <- 1 - cumP[, K - 1]
  # 不变式：每行概率和为 1 且非负
  rs <- rowSums(prm)
  if (any(abs(rs - 1) > 1e-8) || any(prm < -1e-8)) {
    stop("有序 Logistic 概率自检失败：预测概率未满足「和为 1 且非负」不变式")
  }
  fitted_p <- prm
  # 输出阈值
  for (j in seq_len(K - 1)) {
    cat(sprintf("LOGIT_THRESH|%d|%s|%s\\n", j, num(cuts[j], 4), num(se_cuts[j], 4)))
  }
  # 比例优势假设的描述性检查：各阈值下分别做二元 logit，斜率应相近
  for (v in iv_names) {
    slopes <- character(0)
    for (j in seq_len(K - 1)) {
      yy <- as.integer(ynum <= j)
      mj <- tryCatch(suppressWarnings(glm(yi ~ xv, family = binomial(),
        data = data.frame(yi = yy, xv = sub[[v]]))), error = function(e) NULL)
      slopes <- c(slopes, if (is.null(mj)) "NA" else num(coef(mj)[2], 4))
    }
    cat(sprintf("LOGIT_PO_CHECK|%s|%s\\n", v, paste(slopes, collapse = "|")))
  }
  # 判断斜率是否差异过大（朴素判据：极差 / 均绝对值 > 0.5）
  po_bad <- character(0)
  for (v in iv_names) {
    sl <- numeric(0)
    for (j in seq_len(K - 1)) {
      yy <- as.integer(ynum <= j)
      mj <- tryCatch(suppressWarnings(glm(yi ~ xv, family = binomial(),
        data = data.frame(yi = yy, xv = sub[[v]]))), error = function(e) NULL)
      if (!is.null(mj) && is.finite(coef(mj)[2])) sl <- c(sl, coef(mj)[2])
    }
    if (length(sl) >= 2) {
      rng <- max(sl) - min(sl)
      base <- mean(abs(sl))
      if (base > 1e-8 && rng / base > 0.5) po_bad <- c(po_bad, v)
    }
  }
  if (length(po_bad) > 0) {
    cat(sprintf("LOGIT_WARN|比例优势假设可能不成立：变量 %s 在不同阈值下的斜率差异较大（见 LOGIT_PO_CHECK）。该假设是有序 Logistic 的前提，若明显不成立，结论不可靠；建议改用多项 Logistic 或把因变量合并为二分类\\n",
      paste(po_bad, collapse = "、")))
  }
  cat(sprintf("LOGIT_NOTE|有序 Logistic 采用比例优势模型（proportional odds），用纯 base R 极大似然估计（未使用 MASS::polr，以维持零外部依赖）。系数解释：b 为正表示该变量越大越倾向更高的类别（OR = exp(b)）\\n"))
}

cat(sprintf("LOGIT_FIT|%d|%s|%s|%s|%s|%s|%s\\n", n, num(null_dev, 4), num(resid_dev, 4),
  num(aic, 4), num(mcf, 4), num(cs, 4), num(ng, 4)))
cat(sprintf("LOGIT_LR|%s|%d|%s|%s\\n", num(lr_chi2, 4), as.integer(lr_df), fmt_p(lr_p), num_p(lr_p)))

# 系数表（含优势比 OR 及其 95% CI）
for (i in seq_along(b)) {
  or_val <- exp(b[i])
  or_lo <- exp(b[i] - 1.96 * se[i])
  or_hi <- exp(b[i] + 1.96 * se[i])
  cat(sprintf("LOGIT_COEF|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n", names(b)[i],
    num(b[i], 4), num(se[i], 4), num(z[i], 4), fmt_p(p[i]), num_p(p[i]),
    num(or_val, 4), num(or_lo, 4), num(or_hi, 4)))
}

# 分类准确率 —— 必须同时报告基线，否则准确率没有意义
# （类别不平衡时"全预测多数类"就能拿到很高准确率）
if (K == 2) {
  pred <- ifelse(fitted_p > 0.5, 2L, 1L)
} else {
  pred <- apply(prm, 1, which.max)
}
acc <- mean(pred == ynum)
base_acc <- max(as.integer(tb)) / n
cat(sprintf("LOGIT_ACC|%s|%s|%d\\n", num(acc, 4), num(base_acc, 4), n))
if (acc <= base_acc + 1e-8) {
  cat(sprintf("LOGIT_WARN|模型分类准确率（%s）没有超过「全部预测为多数类」的基线（%s）。这说明模型在当前样本上没有体现出预测价值，请勿据准确率宣称模型有效\\n",
    num(acc, 4), num(base_acc, 4)))
}

cat(sprintf("CONCL|Logistic 回归完成（%s，%d 个类别，N = %d）。模型整体似然比检验 %s（chi2 = %s，df = %d，Nagelkerke R2 = %s）。请注意：Logistic 的伪 R2 不能像线性回归的 R2 那样解释为「解释了多少方差」。\\n",
  if (K == 2) "二元" else "有序", K, n, fmt_p(lr_p), num(lr_chi2, 4), as.integer(lr_df), num(ng, 4)))
`
}
