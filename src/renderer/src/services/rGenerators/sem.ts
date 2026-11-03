/**
 * 结构方程模型（SEM）—— v0.3.2
 *
 * 契约：`V032_CONTRACT.md` 第五节（唯一接口依据）。
 * 横幅唯一：`=== 结构方程模型 (SEM) ===`
 *
 * ## 算法（Lead 已用原型验证，此处直接采用，未重新设计）
 * 纯 base R 的 ML 拟合（lavaan 未安装，不允许依赖它）：
 *   `F_ML = ln|Sigma| + tr(R Sigma^-1) - ln|R| - p`
 * 参数：载荷（全自由）+ 误差方差（log 参数化）+ 结构路径；
 * 潜变量方差固定为 1（marker 之外的另一种识别法，因而 SEM_STRUCT 的 coef
 * 本身就已经是标准化系数）。
 *   `Phi = (I - B)^-1 Psi (I - B)^-T`，`Psi = diag(1 - R2_j)`
 *
 * ## ⚠️ 实测陷阱：B 的填充方向
 * 结构模型 `eta = B eta + zeta`，`B` 必须按 **`B[被解释行, 解释列]`** 填充：
 *   `B[2, 1] <- g`  即 eta2 <- eta1
 * 原型第一版写成 `matrix(c(1, g, 0, 1), 2, 2, byrow = TRUE)`（把 1 放在
 * 被解释变量那一列），导致 `I - B` 奇异、`solve()` 报
 *   `Lapack routine dgesv: system is exactly singular: U[1,1] = 0`
 * 整个 SEM 完全不可用。本文件用 `B[e_to[e], e_from[e]] <- gam_v[e]` 显式
 * 写成"行 = to、列 = from"，并在生成代码里再做一次
 * `max(abs(diag(Phi) - 1))` 自检（见下）。
 *
 * ## 为什么需要 diag(Phi) == 1 自检
 * `Psi_j = 1 - R2_j` 是按拓扑序递推出来的（R2_j 依赖前驱的 Phi 子块）。
 * 递推一旦写错，Phi 就不会满足"潜变量方差 = 1"，但**不会报错**，只会让
 * 所有标准化结果整体偏差。因此拟合完成后显式验证 `diag(Phi) = 1`，
 * 不满足直接 `stop()`，绝不输出看似正常的废数据。
 *
 * ## 拟合指标
 * 公式与 v0.3.1 的 CFA **逐行一致**（chisq / CFI / TLI / RMSEA / SRMR），
 * 契约明确要求复用而不是另写一套。CFI 的基线模型是"独立性模型"
 * （`chisq_null = -(n-1) ln|R|`），与 CFA 口径相同。
 *
 * ## 符号统一
 * 与 CFA 同一套：每个潜变量按其 |载荷| 最大的指标决定是否翻转。
 * **翻转 Λ 的第 j 列时必须同步翻转 Φ 的第 j 行与第 j 列**
 * （v0.3.1 踩过：只翻 Λ 不翻 Φ 会让 phi 符号相反，真值 +0.35 估成 -0.37）。
 * SEM 多一层：结构路径 `g[j <- i]` 也要乘 `flip[i] * flip[j]`，
 * 否则结构系数的符号与 Φ 不一致。
 */

import { rEscape } from '../utils'
import { R_COMMON, READ_CSV } from '../rCommon'

/** 把每个潜变量的指标列表序列化成 R 的 list 构造语句 */
function itemsListCode(itemsByFactor: Record<string, string[]>): string {
  const lines: string[] = ['items_by_factor <- list()']
  for (const [factor, its] of Object.entries(itemsByFactor)) {
    const vec = its.map((v) => `"${rEscape(v)}"`).join(', ')
    lines.push(`items_by_factor[["${rEscape(factor)}"]] <- c(${vec})`)
  }
  return lines.join('\n')
}

/**
 * 生成 SEM 的 R 代码。
 *
 * @param itemsByFactor 测量模型：潜变量名 -> 指标名数组（2–4 个潜变量，每个 2–6 个指标）
 * @param structure     结构模型，形如 `"F1 > F2, F2 > F3"`（`>` 表示"指向"）
 * @param dataFile      数据文件名
 */
export function semCode(
  itemsByFactor: Record<string, string[]>,
  structure: string,
  dataFile = 'data.csv'
): string {
  return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 结构方程模型 (SEM) ===\\n")
${itemsListCode(itemsByFactor)}
structure_spec <- "${rEscape(structure)}"

# 向量化的数值格式化：R_COMMON 的 num() 只接受标量（内部用 if 判长度），
# 直接 num(c(1, 2)) 会报 length > 1 in coercion to logical。批量输出必须走这里。
numv <- function(x, d = 4L) {
  if (length(x) == 0) {
    return("")
  }
  paste(vapply(x, num, character(1), d = d), collapse = " ")
}

# ─────────────────────────────────────────────────────────────
# 步骤 1：输入校验
# ─────────────────────────────────────────────────────────────
latent_names <- names(items_by_factor)
k <- length(latent_names)
if (is.null(latent_names) || any(!nzchar(latent_names))) {
  stop("测量模型缺少潜变量名：请为每个潜变量命名（如 F1、F2）")
}
if (k < 2) {
  stop("SEM 至少需要 2 个潜变量，当前只有 ", k, " 个；单因子模型请使用 CFA")
}
if (k > 4) {
  stop("首版 SEM 最多支持 4 个潜变量，当前 ", k,
       " 个；请合并概念相近的潜变量后重试")
}
n_ind <- vapply(items_by_factor, length, integer(1))
if (any(n_ind < 2)) {
  stop("潜变量 ", latent_names[which(n_ind < 2)[1]],
       " 只有 ", n_ind[which(n_ind < 2)[1]],
       " 个指标：每个潜变量至少需要 2 个指标，否则载荷与误差方差不可分（模型不可识别）")
}
if (any(n_ind > 6)) {
  stop("潜变量 ", latent_names[which(n_ind > 6)[1]],
       " 有 ", n_ind[which(n_ind > 6)[1]], " 个指标：每个潜变量最多 6 个指标")
}
items <- unlist(items_by_factor, use.names = FALSE)
fac_of <- rep(seq_len(k), times = n_ind)
p <- length(items)
if (anyDuplicated(items)) {
  dup_i <- unique(items[duplicated(items)])
  stop("同一指标被指定给了多个潜变量: ", paste(dup_i, collapse = ", "),
       "；每个指标只能加载在一个潜变量上")
}
miss_items <- items[!(items %in% names(data))]
if (length(miss_items) > 0) {
  stop("以下变量不存在: ", paste(miss_items, collapse = ", "))
}

# 结构模型解析：与路径分析同一套解析器（都按 A > B = A 指向 B）
spec_trim <- trimws(structure_spec)
if (is.na(spec_trim) || !nzchar(spec_trim)) {
  stop("结构模型为空：请至少给出一条潜变量路径（形如 F1 > F2），多条用逗号分隔；",
       "若只想检验测量模型，请使用 CFA")
}
parts <- trimws(strsplit(spec_trim, ",", fixed = TRUE)[[1]])
parts <- parts[nzchar(parts)]
n_path <- length(parts)
if (n_path == 0) {
  stop("结构模型为空：请至少给出一条潜变量路径（形如 F1 > F2）")
}
e_from <- integer(n_path)
e_to <- integer(n_path)
for (i in seq_len(n_path)) {
  seg <- trimws(strsplit(parts[i], ">", fixed = TRUE)[[1]])
  if (length(seg) != 2 || !nzchar(seg[1]) || !nzchar(seg[2])) {
    stop("结构路径「", parts[i], "」格式无法解析：应为 A > B 形式（多条用逗号分隔）")
  }
  jf <- match(seg[1], latent_names)
  jt <- match(seg[2], latent_names)
  if (is.na(jf)) {
    stop("结构路径中的潜变量「", seg[1], "」未在测量模型中定义；已定义的潜变量: ",
         paste(latent_names, collapse = ", "))
  }
  if (is.na(jt)) {
    stop("结构路径中的潜变量「", seg[2], "」未在测量模型中定义；已定义的潜变量: ",
         paste(latent_names, collapse = ", "))
  }
  e_from[i] <- jf
  e_to[i] <- jt
}
if (any(e_from == e_to)) {
  stop("检测到自环路径（", latent_names[e_from[e_from == e_to][1]],
       " 指向自身）；请删除这条边")
}
dup_key <- paste(e_from, e_to, sep = "->")
if (anyDuplicated(dup_key)) {
  stop("同一条结构路径被重复指定: ", paste(unique(dup_key[duplicated(dup_key)]), collapse = ", "))
}

# 环路检测：结构模型必须是递归的（本版不支持非递归/反馈模型）。
# 必须在这里拦住，否则后面 (I - B) 奇异会报出一句用户无法理解的
# "system is computationally singular"。
indeg <- tabulate(e_to, nbins = k)
done <- rep(FALSE, k)
ord <- integer(0)
for (step in seq_len(k)) {
  cand <- which(indeg == 0 & !done)
  if (length(cand) == 0) {
    stop("潜变量结构模型存在环路（非递归模型），首版仅支持单向因果的递归结构；",
         "环路涉及的潜变量: ", paste(latent_names[!done], collapse = ", "),
         "。请删除构成环路的那条路径（例如 F1 > F2 与 F2 > F1 只能留一条）")
  }
  j <- cand[1]
  done[j] <- TRUE
  ord <- c(ord, j)
  for (e in which(e_from == j)) {
    indeg[e_to[e]] <- indeg[e_to[e]] - 1L
  }
}

# 参数与自由度：npar = 载荷 p + 误差方差 p + 结构路径 n_path
npar <- p + p + n_path
df_model <- p * (p + 1) / 2 - npar
if (df_model < 0) {
  stop("模型不可识别：观测变量 ", p, " 个（协方差元素 ", p * (p + 1) / 2,
       " 个）而自由参数 ", npar, " 个（载荷 ", p, " + 误差方差 ", p,
       " + 结构路径 ", n_path, "），df = ", df_model,
       " < 0；请减少潜变量或结构路径，或为每个潜变量增加指标")
}

# ─────────────────────────────────────────────────────────────
# 步骤 2：数据准备（listwise 删除）
# ─────────────────────────────────────────────────────────────
X_raw <- data[, items, drop = FALSE]
ok <- complete.cases(X_raw)
X <- X_raw[ok, , drop = FALSE]
n_dropped <- sum(!ok)
n <- nrow(X)
if (n < 100) {
  stop("有效样本不足（", n, " 行），SEM 要求 n >= 100；请增加样本或改用更简单的模型")
}
for (nm in items) {
  if (!is.numeric(X[[nm]])) {
    stop("指标 ", nm, " 不是数值型，无法做 SEM")
  }
}
raw_sd <- vapply(seq_len(p), function(i) sd(X[[i]]), numeric(1))
if (any(!is.finite(raw_sd)) || any(raw_sd <= 0)) {
  stop("指标 ", items[which(raw_sd <= 0)[1]], " 为常量（标准差为 0），无法做 SEM")
}
R <- cor(X)
if (any(!is.finite(R))) {
  stop("相关矩阵含非有限值，可能存在常量指标")
}
if (abs(det(R)) < 1e-12) {
  stop("相关矩阵接近奇异（存在完全共线或重复的指标），无法做 SEM")
}
logdetR <- as.numeric(determinant(R, logarithm = TRUE)$modulus)

# ─────────────────────────────────────────────────────────────
# 步骤 3：ML 拟合（BFGS，5 个起点，固定种子）
# ─────────────────────────────────────────────────────────────
# Psi 按拓扑序递推：Psi_j = 1 - R2_j，其中 R2_j = b_j Phi_pred b_j
# （潜变量方差固定为 1，因此这正是"标准化"的 R2）
psi_from_B <- function(B) {
  psi <- rep(NA_real_, k)
  Phi <- matrix(0, k, k)
  for (j in ord) {
    preds <- which(B[j, ] != 0)
    Phi[j, j] <- 1
    if (length(preds) == 0) {
      psi[j] <- 1
    } else {
      bj <- B[j, preds]
      r2 <- as.numeric(t(bj) %*% Phi[preds, preds, drop = FALSE] %*% bj)
      psi[j] <- 1 - r2
      for (m2 in which(!is.na(psi))) {
        if (m2 == j) {
          next
        }
        v <- sum(bj * Phi[preds, m2])
        Phi[j, m2] <- v
        Phi[m2, j] <- v
      }
    }
  }
  list(psi = psi, Phi = Phi)
}

build_sem <- function(par) {
  lam_v <- par[1:p]
  lt_v <- par[(p + 1):(2 * p)]
  gam_v <- if (n_path > 0) par[(2 * p + 1):(2 * p + n_path)] else numeric(0)
  Lam <- matrix(0, p, k)
  for (i in seq_len(p)) {
    Lam[i, fac_of[i]] <- lam_v[i]
  }
  # ⚠️ B[被解释行, 解释列] —— 行是 to、列是 from。
  # 写成 B[from, to] 会让 (I - B) 奇异（原型第一版就是这样挂的）。
  B <- matrix(0, k, k)
  for (e in seq_len(n_path)) {
    B[e_to[e], e_from[e]] <- gam_v[e]
  }
  pp <- psi_from_B(B)
  return(list(Lam = Lam, B = B, psi = pp$psi, Phi_rec = pp$Phi,
              gam = gam_v, lam = lam_v, theta = exp(lt_v)))
}

# 残差方差必须为正（否则 Φ 不再正定、Sigma 可能非正定，
# 而 determinant() 只返回模长，负特征值会让 F 假性偏小）。
# 这里给一个**连续**的惩罚墙，让 BFGS 能从越界区域走回来，
# 而不是像返回 1e10 那样给出零梯度把优化器困住。
#
# ⚠️ 惩罚必须**先钳位再加**，不能直接 1e6 + 1e7 * sum(viol)：
#    BFGS 会把 gamma 推到 1e14 量级，此时 psi 约 -1e29 ~ -1e45，
#    1e7 * sum(viol) 溢出成 -2.2e52（负的巨额惩罚），优化器于是
#    "发现"一个 F = -2.9e67 的伪最优解并宣布收敛。
#    实测：3 潜变量模型 5 个起点全部被这样带偏，
#    最终 (I−B) 不可逆、整个 SEM 报 "结构模型不可逆" 而完全不可用。
#    钳位到 1e3 后惩罚始终是正的大数，F 的下界被牢牢守住。
psi_penalty <- function(viol) {
  if (any(viol > 0)) {
    s <- sum(pmin(viol, 1e3))
    return(1e6 + 1e7 * s)
  }
  0
}
F_of <- function(par) {
  ms <- build_sem(par)
  pen <- psi_penalty(1e-6 - ms$psi)
  if (pen > 0) {
    return(pen)
  }
  # 契约要求 Phi = (I - B)^-1 Psi (I - B)^-T，这里就用这个式子算，
  # 不依赖上面递推出来的 Phi_rec（它的对角线应当恰好为 1，见拟合后自检）。
  ImB <- diag(k) - ms$B
  Phi <- tryCatch(solve(ImB) %*% diag(ms$psi, k) %*% t(solve(ImB)),
                  error = function(e) NULL)
  if (is.null(Phi) || any(!is.finite(Phi))) {
    return(1e20)
  }
  Sigma <- ms$Lam %*% Phi %*% t(ms$Lam) + diag(ms$theta, p)
  S <- (Sigma + t(Sigma)) / 2
  d <- determinant(S, logarithm = TRUE)
  if (!is.finite(d$modulus) || d$sign <= 0) {
    return(1e20)
  }
  v <- tryCatch(
    as.numeric(d$modulus) + sum(diag(R %*% solve(S))) - logdetR - p,
    error = function(e) 1e20
  )
  if (!is.finite(v)) {
    1e20
  } else {
    v
  }
}

# 多起点：起点 1 为中性初值（载荷 0.7、结构路径 0），其余 4 个加扰动。
# 固定种子保证同一份数据两次运行给出完全相同的估计值。
n_start <- 5L
set.seed(20260101L)
start_par <- vector("list", n_start)
start_val <- rep(NA_real_, n_start)
start_conv <- rep(NA_integer_, n_start)
best <- NULL
for (st in seq_len(n_start)) {
  lam_s <- rep(0.7, p)
  gam_s <- rep(0, n_path)
  if (st > 1) {
    lam_s <- pmin(pmax(lam_s + rnorm(p, 0, 0.12), 0.2), 0.95)
    gam_s <- pmin(pmax(gam_s + rnorm(n_path, 0, 0.20), -0.9), 0.9)
  }
  par0 <- c(lam_s, log(pmax(1 - lam_s^2, 0.05)), gam_s)
  o <- try(suppressWarnings(optim(par0, F_of, method = "BFGS",
          control = list(maxit = 2000, reltol = 1e-12))), silent = TRUE)
  if (inherits(o, "try-error")) {
    next
  }
  start_par[[st]] <- o$par
  start_val[st] <- as.numeric(o$value)
  start_conv[st] <- as.integer(o$convergence)
  if (is.finite(o$value) && o$value < 1e5 && o$convergence == 0) {
    if (is.null(best) || o$value < best$value) {
      best <- o
    }
  }
}
if (is.null(best)) {
  stop("SEM 极大似然估计未收敛（", n_start, " 个起点全部失败）。",
       "可尝试：增加样本量（n >= 200 更稳）、减少结构路径数、检查指标是否高度共线（|r| > 0.95）")
}
# F_ML 是拟合函数值，**理论上不可能为负**（在 Sigma = R 处取 0，且 0 是全局
# 下界）。若优化器报出负值，说明它跑到了 Sigma 非正定的区域，
# determinant() 返回的 |det| 让 F 假性偏小。这种解是彻头彻尾的废数据，
# 必须拒绝输出，而不是"取 F 最小者"把它当成最优解。
if (!is.finite(best$value) || best$value < -1e-6) {
  stop("SEM 估计失败：优化器给出负的 F_ML（", num_sig(as.numeric(best$value)),
       "），说明解落在 Sigma 非正定的非法区域，结果不可用。",
       "请检查指标是否高度共线、是否有常量指标；若模型复杂，请减少结构路径后重试")
}
if (as.numeric(best$value) > 1e5) {
  stop("SEM 估计失败：最优 F_ML = ", num_sig(as.numeric(best$value)),
       " 过大，模型与数据严重不符，或优化器未真正收敛。请检查模型设定")
}

par_hat <- best$par
F_ml <- as.numeric(best$value)
ok_starts <- is.finite(start_val) & start_val < 1e5 & start_conv == 0
n_conv <- sum(ok_starts)
f_lo <- min(start_val[ok_starts])
f_hi <- max(start_val[ok_starts])
f_spread <- f_hi - f_lo

# ─────────────────────────────────────────────────────────────
# 多起点一致性判据（v0.3.2 修正）
#
# ⚠️ **不能用相对极差**。原实现用 [f_spread / abs(f_lo) > 1e-4] 判"多解"，
#    在 F_ML 已收敛到接近 0（近乎完美拟合 / 恰好识别）时必然误报：
#    实测某次 F_ML 在 4.814e-11 与 4.826e-11 之间，绝对差仅 1.2e-13（纯浮点噪声），
#    相对极差却是 0.0024 —— 于是给用户弹"多解风险，请复核模型设定"的警告。
#    这是拿噪声吓人，而且会让人怀疑一个其实完美的拟合。
#
# 正确判据：以**绝对差**为主（F_ML 量纲本身无上界，绝对值可比），
# 并同时报告绝对差以便用户自己判断量级。
# 阈值 1e-6：远大于 double 在 F_ML ~ 1e-11 上的求和噪声（~1e-13），
# 又远小于任何有统计意义的拟合差异（chisq 差 1 对应 F 差 1/(n-1)）。
f_tol_abs <- 1e-6
inconsistent <- f_spread > f_tol_abs
if (inconsistent) {
  cat(sprintf("SEM_NOTE|警告：%d 个收敛起点给出不一致的解（F_ML 从 %s 到 %s，绝对极差 %s，超过容差 %s），已取 F 最小者；多解风险下请复核模型设定\\n",
    n_conv, num_sig(f_lo), num_sig(f_hi), num_sig(f_spread), num_sig(f_tol_abs)))
}

# ─────────────────────────────────────────────────────────────
# 步骤 4：重建最终解 + 自检 diag(Phi) = 1
# ─────────────────────────────────────────────────────────────
ms_hat <- build_sem(par_hat)
ImB <- diag(k) - ms_hat$B
Phi_solve <- tryCatch(solve(ImB), error = function(e) NULL)
if (is.null(Phi_solve) || any(!is.finite(Phi_solve))) {
  stop("结构模型 (I - B) 不可逆：请检查结构路径是否构成环路，或路径系数是否恰好互相抵消")
}
Phi_raw <- Phi_solve %*% diag(ms_hat$psi, k) %*% t(Phi_solve)
Phi_raw <- (Phi_raw + t(Phi_raw)) / 2
# 这一步是"Psi 递推写对了"的充分证据：潜变量方差被标准化为 1 时，
# diag(Phi) 必须恒为 1。递推一旦有错这里立刻红。
diag_err <- max(abs(diag(Phi_raw) - 1))
if (!is.finite(diag_err) || diag_err > 1e-6) {
  stop("潜变量标准化自检失败：diag(Phi) 与 1 的最大偏差为 ", num_sig(diag_err),
       "（应 < 1e-6）。这说明残差方差 Psi 的递推与结构模型不一致，",
       "请把本输出反馈给开发者")
}
# 与按拓扑序递推出来的 Phi_rec 交叉核对（两条独立算法必须一致）
rec_err <- max(abs(Phi_raw - ms_hat$Phi_rec))
if (!is.finite(rec_err) || rec_err > 1e-6) {
  stop("Phi 自检失败：(I-B)^-1 Psi (I-B)^-T 与按拓扑序递推的结果最大偏差 ",
       num_sig(rec_err), "（应 < 1e-6）；请把本输出反馈给开发者")
}

# ─────────────────────────────────────────────────────────────
# 步骤 5：符号统一（翻转载荷列 + 同步翻转 Phi 的行列 + 翻转结构路径）
# ─────────────────────────────────────────────────────────────
lam <- ms_hat$lam
flip <- rep(1, k)
for (j in seq_len(k)) {
  idx <- which(fac_of == j)
  big <- idx[which.max(abs(lam[idx]))]
  if (lam[big] < 0) {
    flip[j] <- -1
  }
}
lam <- lam * flip[fac_of]
# 关键一步：翻转载荷列必须同步翻转 Phi 的第 j 行与第 j 列，
# 否则 Phi 与 Lambda 不再对应同一个模型（CFA 原型实测：phi 真值 +0.35 估成 -0.37）
Phi <- diag(flip, k) %*% Phi_raw %*% diag(flip, k)
gam_hat <- ms_hat$gam
for (e in seq_len(n_path)) {
  # 潜变量 i 与 j 各翻一次号，结构系数就要翻两次（偶数次即不变），
  # 因此这里必须同时乘 flip[from] 与 flip[to]
  gam_hat[e] <- gam_hat[e] * flip[e_from[e]] * flip[e_to[e]]
}
Lam <- matrix(0, p, k)
for (i in seq_len(p)) {
  Lam[i, fac_of[i]] <- lam[i]
}
Sigma <- Lam %*% Phi %*% t(Lam) + diag(ms_hat$theta, p)
sd_jj <- sqrt(diag(Sigma))
std_lam <- lam / sd_jj
r2_ind <- std_lam^2
# 原始量纲载荷：拟合对象是相关矩阵，模型隐含 Sigma 的对角线恒为 1，
# 直接拿 lam 当 unstd_load 会让两列一模一样（CFA 已踩过）。
# 正确换算：Var(eta) = 1 时 lam_raw = lam_std * sd(Y_j)。
unstd_lam <- std_lam * raw_sd
r2_lat <- 1 - ms_hat$psi
endog <- which(tabulate(e_to, nbins = k) > 0)

# ─────────────────────────────────────────────────────────────
# 步骤 6：标准误（数值 Hessian：V = 2/(n-1) H^-1）
# ─────────────────────────────────────────────────────────────
num_hess <- function(fun, par, h) {
  m2 <- length(par)
  f0 <- fun(par)
  H <- matrix(0, m2, m2)
  for (i in seq_len(m2)) {
    ei <- rep(0, m2)
    ei[i] <- h
    H[i, i] <- (fun(par + ei) - 2 * f0 + fun(par - ei)) / (h * h)
    if (i < m2) {
      for (j in (i + 1):m2) {
        ej <- rep(0, m2)
        ej[j] <- h
        v <- (fun(par + ei + ej) - fun(par + ei - ej) -
              fun(par - ei + ej) + fun(par - ei - ej)) / (4 * h * h)
        H[i, j] <- v
        H[j, i] <- v
      }
    }
  }
  H
}
se_lam <- rep(NA_real_, p)
se_gam <- rep(NA_real_, n_path)
se_theta <- rep(NA_real_, p)
V_hat <- NULL
H_hat <- tryCatch(num_hess(F_of, par_hat, 1e-4), error = function(e) NULL)
if (!is.null(H_hat)) {
  Hinv <- tryCatch(solve(H_hat), error = function(e) NULL)
  if (!is.null(Hinv) && all(is.finite(Hinv))) {
    Vc <- Hinv * 2 / (n - 1)
    if (all(diag(Vc) > 0)) {
      V_hat <- Vc
    }
  }
}
if (!is.null(V_hat)) {
  if (n_path > 0) {
    se_gam <- sqrt(pmax(diag(V_hat)[(2 * p + 1):(2 * p + n_path)], 0))
  }
  se_theta <- sqrt(pmax(diag(V_hat)[(p + 1):(2 * p)], 0))
  # 标准化载荷对全部参数的数值 Jacobian（delta 法，与 CFA 同一做法）
  J_std <- matrix(0, p, length(par_hat))
  for (i in seq_along(par_hat)) {
    hi <- 1e-6 * max(1, abs(par_hat[i]))
    a <- par_hat
    a[i] <- a[i] + hi
    b <- par_hat
    b[i] <- b[i] - hi
    sa <- build_sem(a)
    sb <- build_sem(b)
    if (any(sa$psi <= 1e-6) || any(sb$psi <= 1e-6)) {
      next
    }
    Ia <- diag(k) - sa$B
    Ib <- diag(k) - sb$B
    Pa <- tryCatch(solve(Ia) %*% diag(sa$psi, k) %*% t(solve(Ia)), error = function(e) NULL)
    Pb <- tryCatch(solve(Ib) %*% diag(sb$psi, k) %*% t(solve(Ib)), error = function(e) NULL)
    if (is.null(Pa) || is.null(Pb)) {
      next
    }
    Sa <- sa$Lam %*% Pa %*% t(sa$Lam) + diag(sa$theta, p)
    Sb <- sb$Lam %*% Pb %*% t(sb$Lam) + diag(sb$theta, p)
    J_std[, i] <- (sa$lam / sqrt(diag(Sa)) - sb$lam / sqrt(diag(Sb))) / (2 * hi)
  }
  se_lam <- sqrt(pmax(diag(J_std %*% V_hat %*% t(J_std)), 0))
}

# ─────────────────────────────────────────────────────────────
# 步骤 7：输出（行格式见 V032_CONTRACT.md 第五节）
# ─────────────────────────────────────────────────────────────
cat(sprintf("SEM_SPEC|%d|%d|%d\\n", n, k, p))
for (i in seq_len(p)) {
  z_i <- NA_real_
  p_i <- NA_real_
  if (is.finite(se_lam[i]) && se_lam[i] > 0) {
    z_i <- std_lam[i] / se_lam[i]
    p_i <- 2 * pnorm(-abs(z_i))
  }
  cat(sprintf("SEM_MEASURE|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n", latent_names[fac_of[i]],
    items[i], num(std_lam[i]), num(unstd_lam[i]), num(se_lam[i]), num(z_i),
    fmt_p(p_i), num_p(p_i), num(r2_ind[i])))
}
if (n_path > 0) {
  for (e in seq_len(n_path)) {
    z_e <- NA_real_
    p_e <- NA_real_
    if (is.finite(se_gam[e]) && se_gam[e] > 0) {
      z_e <- gam_hat[e] / se_gam[e]
      p_e <- 2 * pnorm(-abs(z_e))
    }
    cat(sprintf("SEM_STRUCT|%s|%s|%s|%s|%s|%s|%s\\n", latent_names[e_from[e]],
      latent_names[e_to[e]], num(gam_hat[e]), num(se_gam[e]), num(z_e),
      fmt_p(p_e), num_p(p_e)))
  }
}
for (j in endog) {
  cat(sprintf("SEM_LATENT|%s|%s\\n", latent_names[j], num(r2_lat[j])))
}

# 拟合指标：公式与 v0.3.1 CFA 完全一致（契约第五节硬性要求）
chisq <- (n - 1) * F_ml
chisq_null <- -(n - 1) * logdetR
df_null <- p * (p - 1) / 2
p_fit <- if (df_model > 0) pchisq(chisq, df_model, lower.tail = FALSE) else NA_real_
cfi <- 1
tli <- 1
rmsea <- 0
if (df_model > 0) {
  num_cfi <- max(chisq - df_model, 0)
  den_cfi <- max(chisq - df_model, chisq_null - df_null, 0)
  cfi <- if (den_cfi > 0) 1 - num_cfi / den_cfi else 1
  d1 <- chisq_null / df_null
  d2 <- chisq / df_model
  tli <- if (abs(d1 - 1) > 1e-12) (d1 - d2) / (d1 - 1) else 1
  rmsea <- sqrt(max(chisq - df_model, 0) / (df_model * (n - 1)))
}
std_res <- (R - Sigma) / outer(sd_jj, sd_jj)
srmr <- sqrt(mean(std_res[lower.tri(std_res, diag = TRUE)]^2))
cat(sprintf("SEM_FIT|%s|%d|%s|%s|%s|%s|%s|%s\\n", num(chisq), df_model, fmt_p(p_fit),
  num_p(p_fit), num(cfi), num(tli), num(rmsea), num(srmr)))

# ─────────────────────────────────────────────────────────────
# 步骤 7.5：判别力检验（嵌套模型 LR）
#   H0：全部结构路径 = 0（潜变量之间没有方向性关系）
#   这是 SEM 相对 CFA 的唯一增量信息，必须能被检验出来：
#   若数据里真的有结构关系，约束模型会显著变差。
#   ⚠️ 必须**重新优化**约束模型，不能只把 gamma 钉在 0 后复用备择解 ——
#   那样得到的是备择解处的 F，不是约束 MLE，delta 卡方会偏小（等于只在
#   一个点上做 Wald 近似），既不满足 LR 的定义也低估判别力。
# ─────────────────────────────────────────────────────────────
F_null_of <- function(par_short) {
  F_of(c(par_short, rep(0, n_path)))
}
lr_ok <- FALSE
chisq_0 <- NA_real_
delta_chisq <- NA_real_
p_lr <- NA_real_
o_null <- try(suppressWarnings(optim(par_hat[1:(2 * p)], F_null_of, method = "BFGS",
  control = list(maxit = 2000, reltol = 1e-12))), silent = TRUE)
if (inherits(o_null, "try-error")) {
  lr_ok <- FALSE
} else {
  if (!is.finite(o_null$value) || o_null$value >= 1e5 || o_null$convergence != 0) {
    lr_ok <- FALSE
  } else {
    chisq_0 <- (n - 1) * as.numeric(o_null$value)
    delta_chisq <- max(chisq_0 - chisq, 0)
    p_lr <- pchisq(delta_chisq, n_path, lower.tail = FALSE)
    lr_ok <- TRUE
  }
}

# ─────────────────────────────────────────────────────────────
# 步骤 8：提示与结论
# ─────────────────────────────────────────────────────────────
if (n_dropped > 0) {
  cat(sprintf("SEM_NOTE|因缺失值采用逐行删除（listwise / 个案剔除），剔除 %d 行，有效样本 %d\\n", n_dropped, n))
}
cat(sprintf("SEM_NOTE|估计方法：极大似然 ML（相关矩阵，纯 base R 实现，未使用 lavaan）；潜变量方差固定为 1 识别，因此结构系数已是标准化系数\\n"))
cat(sprintf("SEM_NOTE|多起点一致性：%d/%d 个起点收敛，F_ML 绝对极差 %s（容差 %s，%s）；全部取 F 最小者，固定种子可复现\\n",
  n_conv, n_start, num_sig(f_spread), num_sig(f_tol_abs),
  if (inconsistent) "不一致，见上方警告" else "一致"))
exo <- setdiff(seq_len(k), endog)
if (length(exo) >= 2) {
  cat(sprintf("SEM_NOTE|外生潜变量 %s 之间按模型设定假定不相关（本版不支持外生潜变量间的残差相关）；若理论上应当相关，请为它们增设路径或改用其他方法\\n",
    paste(latent_names[exo], collapse = "、")))
}
heywood <- any(ms_hat$theta <= 1e-6) || any(abs(std_lam) > 1)
if (heywood) {
  cat(sprintf("SEM_NOTE|检测到 Heywood 案例（误差方差 <= 1e-6 或 |标准化载荷| > 1），解落在边界，载荷与 R2 需谨慎解读\\n"))
}
if (df_model == 0) {
  cat(sprintf("SEM_NOTE|模型恰好识别（df = 0），CFI/TLI/RMSEA 无判别力，仅 SRMR 可作参考\\n"))
}
if (is.null(V_hat)) {
  cat(sprintf("SEM_NOTE|数值 Hessian 非正定，标准误不可用（输出 NA）；模型可能过度参数化或样本不足\\n"))
}
under_id <- items[fac_of %in% which(n_ind == 2)]
if (length(under_id) > 0) {
  cat(sprintf("SEM_NOTE|以下潜变量只有 2 个指标（%s），对应模型是恰好识别或弱识别，估计稳定性低于 3 指标以上的潜变量\\n",
    paste(latent_names[which(n_ind == 2)], collapse = "、")))
}
cat(sprintf("SEM_NOTE|样本量与参数量之比：n = %d，自由参数 %d 个，每个参数约 %s 个样本（建议 >= 10）\\n",
  n, npar, num(n / npar, 1)))
# 判别力：结构路径的联合 LR 检验。这是 SEM 相对 CFA 的增量证据，
# 必须让用户看到（否则"SEM 显著"这种结论毫无支撑）。
if (lr_ok) {
  lr_sig <- is.finite(p_lr) && p_lr < 0.05
  cat(sprintf("SEM_NOTE|结构路径联合检验：强制全部结构路径为 0 时 chisq = %s（df = %d），delta chisq = %s（df = %d，%s），%s\\n",
    num(chisq_0), df_model + n_path, num(delta_chisq), n_path, fmt_p(p_lr),
    if (lr_sig) {
      "说明模型中的结构路径具有联合判别力"
    } else {
      "未发现结构路径的联合作用，请核实潜变量之间的关系是否真实存在"
    }))
} else {
  cat(sprintf("SEM_NOTE|嵌套模型 LR 检验不可用（约束模型未收敛），无法判断结构路径的联合判别力\\n"))
}

fit_txt <- "模型拟合不佳"
if (cfi >= 0.90 && rmsea <= 0.08 && srmr <= 0.08) {
  fit_txt <- "模型拟合可接受"
}
if (cfi >= 0.95 && tli >= 0.95 && rmsea <= 0.06 && srmr <= 0.08) {
  fit_txt <- "模型拟合良好"
}
sig_path <- 0
if (n_path > 0) {
  for (e in seq_len(n_path)) {
    if (is.finite(se_gam[e]) && se_gam[e] > 0) {
      z_e <- gam_hat[e] / se_gam[e]
      if (2 * pnorm(-abs(z_e)) < 0.05) {
        sig_path <- sig_path + 1
      }
    }
  }
}
lr_txt <- "结构路径联合检验不可用"
if (lr_ok) {
  if (is.finite(p_lr) && p_lr < 0.05) {
    lr_txt <- sprintf("结构路径联合检验显著（delta chisq = %s，df = %d，%s）",
      num(delta_chisq), n_path, fmt_p(p_lr))
  } else {
    lr_txt <- sprintf("结构路径联合检验不显著（delta chisq = %s，df = %d，%s）",
      num(delta_chisq), n_path, fmt_p(p_lr))
  }
}
cat(sprintf("CONCL|%s：chisq = %s（df = %d，%s），CFI = %s，TLI = %s，RMSEA = %s，SRMR = %s；结构路径 %d/%d 条显著；%s\\n",
  fit_txt, num(chisq), df_model, fmt_p(p_fit), num(cfi), num(tli), num(rmsea),
  num(srmr), sig_path, n_path, lr_txt))
`
}
