/**
 * 路径分析（Path Analysis）—— v0.3.2
 *
 * 契约：`V032_CONTRACT.md` 第四节（唯一接口依据）。
 * 横幅唯一：`=== 路径分析 ===`
 *
 * ## 为什么是 OLS 逐方程而不是 ML-SEM
 * 首版刻意用 OLS 逐方程估计（每个内生变量跑一个 `dv ~ 所有指向它的节点`）。
 * 必须把这一点写进 PATH_NOTE：OLS 逐方程与联合 ML 在**恰好识别**时等价，
 * 在**过度识别**时不等价 —— 用户拿它写论文时必须知道这里的系数不是 ML 解。
 *
 * ## 效应分解的正确做法（这里踩过坑）
 * 直接效应只是系数矩阵 B 的对应元素，但间接效应**不能**只找一条链。
 * 正确的间接效应 = 所有中介通路（长度 >= 2 的有向路径）的乘积和
 * = `B^2 + B^3 + ...`（DAG 下高于 m−1 次的幂恒为 0）。
 *
 * 为了防"公式写错但看起来正常"，本生成器做了**两条独立路径的交叉校验**：
 *   1. 矩阵幂级数：`indirect = sum(B^k, k >= 2)`
 *   2. 显式路径枚举：DFS 枚举每条通路并累乘
 * 两者必须一致（容差 1e-8），否则 `stop()`。
 * 同时验证 `total == direct + indirect`，其中 total 来自
 * `(I − B)^-1 − I`（与上面两条都无关的第三种算法）。这正是契约
 * "**必须验证** total == direct + indirect" 的落地方式。
 *
 * ## 环路
 * 有环的路径图无法做效应分解（`(I − B)^-1` 不收敛/不唯一），必须在估计前
 * 用拓扑排序检测并 `stop()`，而不是等到 `solve()` 报一个用户看不懂的
 * "system is computationally singular"。
 *
 * ## 无中介通路时
 * `indirect` 输出 `0`（`num(0)` = `0.0000`），**不得**输出 `NA` ——
 * 契约明确要求，"没有中介"是一个确定的事实，不是缺失。
 */

import { rEscape } from '../utils'
import { R_COMMON, READ_CSV } from '../rCommon'

/**
 * 生成路径分析 R 代码。
 *
 * @param nodes    参与路径模型的全部节点（观测变量名）
 * @param pathSpec 路径列表，形如 `"X > M, M > Y, X > Y"`（`>` 表示"指向"）
 * @param dataFile 数据文件名（主进程写入的 CSV）
 */
export function pathAnalysisCode(nodes: string[], pathSpec: string, dataFile = 'data.csv'): string {
  const nodeVec = nodes.map((v) => `"${rEscape(v)}"`).join(', ')
  return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
${R_COMMON}
cat("=== 路径分析 ===\\n")
nodes <- c(${nodeVec})
path_spec <- "${rEscape(pathSpec)}"

# ─────────────────────────────────────────────────────────────
# 步骤 1：输入校验
# ─────────────────────────────────────────────────────────────
if (length(nodes) < 2) {
  stop("路径分析至少需要 2 个变量，当前只有 ", length(nodes), " 个")
}
dup_nodes <- unique(nodes[duplicated(nodes)])
if (length(dup_nodes) > 0) {
  stop("变量列表中重复出现: ", paste(dup_nodes, collapse = ", "))
}
miss_nodes <- nodes[!(nodes %in% names(data))]
if (length(miss_nodes) > 0) {
  stop("以下变量不存在: ", paste(miss_nodes, collapse = ", "))
}

# 路径列表解析：逗号分隔多条边，每条边形如 A > B（A 指向 B）。
# 用 fixed = TRUE 的 strsplit 而不是正则：变量名里的 . 与 ( ) 在正则里是
# 元字符，走正则会让 "q1.2 > q3" 这类合法列名解析错位。
spec_trim <- trimws(path_spec)
if (is.na(spec_trim) || !nzchar(spec_trim)) {
  stop("路径列表为空：请至少给出一条有向路径（形如 X > M），多条用逗号分隔")
}
parts <- trimws(strsplit(spec_trim, ",", fixed = TRUE)[[1]])
parts <- parts[nzchar(parts)]
n_edges <- length(parts)
if (n_edges == 0) {
  stop("路径列表为空：请至少给出一条有向路径（形如 X > M），多条用逗号分隔")
}
edge_from <- character(n_edges)
edge_to <- character(n_edges)
for (i in seq_len(n_edges)) {
  seg <- trimws(strsplit(parts[i], ">", fixed = TRUE)[[1]])
  if (length(seg) != 2 || !nzchar(seg[1]) || !nzchar(seg[2])) {
    stop("路径「", parts[i], "」格式无法解析：应为 A > B 形式（多条路径用逗号分隔）")
  }
  edge_from[i] <- seg[1]
  edge_to[i] <- seg[2]
}
bad_edge <- unique(c(edge_from[!(edge_from %in% nodes)], edge_to[!(edge_to %in% nodes)]))
if (length(bad_edge) > 0) {
  stop("路径中出现了未声明的节点: ", paste(bad_edge, collapse = ", "),
       "；请把它们加入变量列表，或修正路径写法")
}
if (any(edge_from == edge_to)) {
  stop("检测到自环路径（", edge_from[edge_from == edge_to][1],
       " 指向自身）；路径分析不支持自环，请删除这条边")
}
edge_key <- paste(edge_from, edge_to, sep = "->")
dup_edge <- unique(edge_key[duplicated(edge_key)])
if (length(dup_edge) > 0) {
  stop("同一条路径被重复指定: ", paste(gsub("->", " > ", dup_edge, fixed = TRUE), collapse = "; "))
}

# ─────────────────────────────────────────────────────────────
# 步骤 2：数据准备（listwise 删除）
# ─────────────────────────────────────────────────────────────
X_raw <- data[, nodes, drop = FALSE]
ok <- complete.cases(X_raw)
X <- X_raw[ok, , drop = FALSE]
n_dropped <- sum(!ok)
n <- nrow(X)
if (n < 30) {
  stop("有效样本不足（", n, " 行），路径分析至少需要 30 个完整样本")
}
for (nm in nodes) {
  if (!is.numeric(X[[nm]])) {
    stop("变量 ", nm, " 不是数值型，无法做路径分析")
  }
}
for (nm in nodes) {
  if (sd(X[[nm]]) <= 0) {
    stop("变量 ", nm, " 为常量（标准差为 0），无法做路径分析")
  }
}
m <- length(nodes)
edge_from_i <- match(edge_from, nodes)
edge_to_i <- match(edge_to, nodes)

# ─────────────────────────────────────────────────────────────
# 步骤 3：环路检测（拓扑排序）—— 必须在估计之前拦住
# ─────────────────────────────────────────────────────────────
indeg <- tabulate(edge_to_i, nbins = m)
done <- rep(FALSE, m)
topo <- integer(0)
for (step in seq_len(m)) {
  cand <- which(indeg == 0 & !done)
  if (length(cand) == 0) {
    remaining <- nodes[!done]
    stop("检测到环路，无法进行效应分解。环路涉及的节点包括: ",
         paste(remaining, collapse = ", "),
         "。请检查路径方向（A > B 表示 A 指向 B），删掉构成环路的那条边后重试")
  }
  j <- cand[1]
  done[j] <- TRUE
  topo <- c(topo, j)
  for (e in which(edge_from_i == j)) {
    indeg[edge_to_i[e]] <- indeg[edge_to_i[e]] - 1L
  }
}

# ─────────────────────────────────────────────────────────────
# 步骤 4：逐方程 OLS
# ─────────────────────────────────────────────────────────────
# B[被解释行, 解释列]：与 SEM 同一个约定。注意这里是 B[to, from] ——
# 写反会让 (I - B) 变成错误的矩阵，效应分解整体错位（而且不会报错）。
B <- matrix(0, m, m)
edge_p <- rep(NA_real_, n_edges)
edge_b <- rep(NA_real_, n_edges)
edge_se <- rep(NA_real_, n_edges)
edge_t <- rep(NA_real_, n_edges)
edge_std <- rep(NA_real_, n_edges)
edge_present <- rep(FALSE, n_edges)

cat(sprintf("PATH_SPEC|%d|%d|%d\\n", n, m, n_edges))

for (dv in topo) {
  preds <- edge_from_i[edge_to_i == dv]
  if (length(preds) == 0) {
    next
  }
  dv_name <- nodes[dv]
  # 用规范化列名拟合：用户列名可能含空格、括号、中文标点甚至 backtick，
  # 直接拼进公式会让 R 解析失败或把名字当成表达式。
  eq_df <- data.frame(y_obs = X[[dv_name]])
  for (k2 in seq_along(preds)) {
    eq_df[[paste0("p", k2)]] <- X[[nodes[preds[k2]]]]
  }
  term_labels <- paste0("p", seq_along(preds))
  fit <- lm(reformulate(term_labels, response = "y_obs"), data = eq_df)
  sm <- summary(fit)
  cf <- sm$coefficients
  r2_eq <- sm$r.squared
  adj_eq <- sm$adj.r.squared
  fstat <- sm$fstatistic
  p_f <- NA_real_
  f_val <- NA_real_
  if (!is.null(fstat)) {
    f_val <- as.numeric(fstat[1])
    p_f <- pf(f_val, fstat[2], fstat[3], lower.tail = FALSE)
    p_f <- as.numeric(p_f)
  }
  cat(sprintf("PATH_EQ|%s|%s|%s|%s|%s|%s\\n", dv_name, num(r2_eq), num(adj_eq),
    num(f_val), fmt_p(p_f), num_p(p_f)))
  sd_y <- sd(eq_df$y_obs)
  for (k2 in seq_along(preds)) {
    rn <- paste0("p", k2)
    b_k <- as.numeric(cf[rn, 1])
    se_k <- as.numeric(cf[rn, 2])
    t_k <- as.numeric(cf[rn, 3])
    p_k <- as.numeric(cf[rn, 4])
    sd_x <- sd(eq_df[[rn]])
    std_k <- b_k * sd_x / sd_y
    B[dv, preds[k2]] <- b_k
    e_idx <- which(edge_from_i == preds[k2] & edge_to_i == dv)[1]
    if (!is.na(e_idx)) {
      edge_b[e_idx] <- b_k
      edge_se[e_idx] <- se_k
      edge_t[e_idx] <- t_k
      edge_p[e_idx] <- p_k
      edge_std[e_idx] <- std_k
      edge_present[e_idx] <- TRUE
    }
    cat(sprintf("PATH_EDGE|%s|%s|%s|%s|%s|%s|%s|%s\\n", nodes[preds[k2]], dv_name,
      num(b_k), num(se_k), num(t_k), fmt_p(p_k), num_p(p_k), num(std_k)))
  }
}

# ─────────────────────────────────────────────────────────────
# 步骤 5：效应分解 + 三重交叉校验
# ─────────────────────────────────────────────────────────────
I_m <- diag(m)
IB <- I_m - B
# 拓扑排序已排除环路，此处 (I - B) 必然可逆；仍显式检查一次：
# det 接近 0 说明路径系数恰好互相抵消，分解结果无意义，宁可 stop 也不输出。
if (!is.finite(det(IB)) || abs(det(IB)) < 1e-12) {
  stop("路径系数矩阵 (I - B) 数值奇异（det 接近 0），效应分解不可靠；",
       "请检查是否存在近似完全抵消的路径组合")
}
total_mat <- solve(IB) - I_m
# 这条恒等式与下面的幂级数/枚举无关，是最强的一道自检：
#   (I - B)^-1 - I = B + B^2 + B^3 + ...
# 左边用 solve()，右边用逐次矩阵乘。两者必然一致，不一致说明 B 填充方向错了。
indirect_mat <- matrix(0, m, m)
Bk <- B
for (k2 in seq_len(m)) {
  Bk <- Bk %*% B
  indirect_mat <- indirect_mat + Bk
}
max_gap <- max(abs(total_mat - B - indirect_mat))
if (!is.finite(max_gap) || max_gap > 1e-8) {
  stop("效应分解自检失败：(I - B)^-1 - I 与 B + B^2 + ... 的最大偏差为 ",
       num_sig(max_gap), "（应 < 1e-8）。这通常意味着路径矩阵的填充方向错误，",
       "请把本输出反馈给开发者")
}

# 显式枚举全部有向通路：用于 NOTE 展示，也作为间接效应的第二条独立算法。
# ⚠️ B 是 B[被解释, 解释]，所以 cur 的**后继**（cur 指向谁）在**列**上：
#    nxt 满足 B[nxt, cur] != 0，系数就是 B[nxt, cur]。
#    写成 B[cur, ] 会遍历"谁指向 cur"（即前驱），枚举出的通路全是反的，
#    在 X -> M -> Y 这类三节点图上会直接变成空集（实测踩到）。
# ⚠️ min_len = 2：间接效应只算**中介通路**（长度 >= 2 的路径）。
#    只判 nxt == target 会把长度为 1 的**直接边**也当成一段"通路"，
#    结果 indirect 里混进了直接的 B[target, source]（实测：X -> M 的
#    indirect 被打成 0.4444，与幂级数的 0 不符，自检直接报错）。
collect_paths <- function(cur, target, Bm, visited, pnodes, pcoefs, min_len) {
  rn <- list()
  rc <- list()
  succ <- which(Bm[, cur] != 0)
  for (nxt in succ) {
    n_nodes <- c(pnodes, nxt)
    n_coefs <- c(pcoefs, Bm[nxt, cur])
    if (nxt == target) {
      if (length(n_coefs) >= min_len) {
        rn[[length(rn) + 1]] <- n_nodes
        rc[[length(rc) + 1]] <- n_coefs
      }
    } else {
      if (!(nxt %in% visited)) {
        sub <- collect_paths(nxt, target, Bm, c(visited, nxt), n_nodes, n_coefs, min_len)
        rn <- c(rn, sub$nodes)
        rc <- c(rc, sub$coefs)
      }
    }
  }
  list(nodes = rn, coefs = rc)
}

med_label <- character(0)
med_val <- numeric(0)
med_from <- character(0)
med_to <- character(0)
n_effect_rows <- 0

for (j in seq_len(m)) {
  for (i in seq_len(m)) {
    if (i == j) {
      next
    }
    total_ij <- as.numeric(total_mat[i, j])
    direct_ij <- as.numeric(B[i, j])
    ind_ij <- as.numeric(indirect_mat[i, j])
    # 三者全为 0 = 不可达（DAG 下不可达就恒为精确 0）
    if (abs(total_ij) < 1e-12 && abs(direct_ij) < 1e-12 && abs(ind_ij) < 1e-12) {
      next
    }
    # 校验 1：total == direct + indirect（契约硬性要求）
    gap1 <- abs(total_ij - (direct_ij + ind_ij))
    if (!is.finite(gap1) || gap1 > 1e-8 * max(1, abs(total_ij))) {
      stop("效应分解自检失败（", nodes[j], " -> ", nodes[i], "）：总效应 ",
           num(total_ij, 8), " 不等于 直接效应 ", num(direct_ij, 8),
           " 加 间接效应 ", num(ind_ij, 8), "；请把本输出反馈给开发者")
    }
    # 校验 2：间接效应 = 通路乘积和（与上面的矩阵幂级数相互独立）
    sub <- collect_paths(j, i, B, c(j), c(j), numeric(0), 2L)
    ind_enum <- 0
    for (p_i in seq_along(sub$coefs)) {
      ind_enum <- ind_enum + prod(sub$coefs[[p_i]])
    }
    gap2 <- abs(ind_enum - ind_ij)
    if (!is.finite(gap2) || gap2 > 1e-8 * max(1, abs(ind_ij))) {
      stop("间接效应自检失败（", nodes[j], " -> ", nodes[i], "）：矩阵幂级数 ",
           num(ind_ij, 8), " 与逐通路累乘 ", num(ind_enum, 8),
           " 不一致；请把本输出反馈给开发者")
    }
    for (p_i in seq_along(sub$nodes)) {
      pn <- sub$nodes[[p_i]]
      if (length(pn) >= 3) {
        med_label <- c(med_label, paste(nodes[pn], collapse = " -> "))
        med_val <- c(med_val, prod(sub$coefs[[p_i]]))
        med_from <- c(med_from, nodes[j])
        med_to <- c(med_to, nodes[i])
      }
    }
    cat(sprintf("PATH_EFFECT|%s|%s|%s|%s|%s\\n", nodes[j], nodes[i],
      num(direct_ij), num(ind_ij), num(total_ij)))
    n_effect_rows <- n_effect_rows + 1
  }
}

# ─────────────────────────────────────────────────────────────
# 步骤 6：提示与结论
# ─────────────────────────────────────────────────────────────
if (n_dropped > 0) {
  cat(sprintf("PATH_NOTE|因缺失值采用逐行删除（listwise / 个案剔除），剔除 %d 行，有效样本 %d\\n", n_dropped, n))
}
# 契约第四节明确要求声明估计口径，否则用户会把它当成 ML-SEM 解
cat(sprintf("PATH_NOTE|估计方法：OLS 逐方程（每个内生变量一个回归），不是联合 ML；恰好识别时二者等价，过度识别时不等价\\n"))
n_endog <- sum(tabulate(edge_to_i, nbins = m) > 0)
cat(sprintf("PATH_NOTE|内生变量 %d 个（有入边），外生变量 %d 个；共 %d 个方程、%d 条路径、%d 组效应分解\\n",
  n_endog, m - n_endog, n_endog, n_edges, n_effect_rows))
isolated <- nodes[!(seq_len(m) %in% c(edge_from_i, edge_to_i))]
if (length(isolated) > 0) {
  cat(sprintf("PATH_NOTE|以下变量未出现在任何路径中，对模型无贡献: %s\\n",
    paste(isolated, collapse = ", ")))
}
n_med <- length(med_label)
if (n_med > 0) {
  cat(sprintf("PATH_NOTE|共检出 %d 条中介通路（长度 >= 2 的有向路径），间接效应为各通路系数之积的和\\n", n_med))
  show_n <- min(n_med, 20L)
  for (q in seq_len(show_n)) {
    cat(sprintf("PATH_NOTE|中介通路: %s，乘积 = %s\\n", med_label[q], num(med_val[q])))
  }
  if (n_med > show_n) {
    cat(sprintf("PATH_NOTE|另有 %d 条中介通路未逐条列出（数量过多）\\n", n_med - show_n))
  }
} else {
  cat(sprintf("PATH_NOTE|模型中没有中介通路（不存在长度 >= 2 的有向路径），所有间接效应均为 0\\n"))
}
cat(sprintf("PATH_NOTE|本版不提供间接效应的标准误与置信区间（未做 Bootstrap / delta 法），请勿据此宣称中介效应显著\\n"))
n_sig_edge <- sum(!is.na(edge_p) & edge_p < 0.05)
cat(sprintf("PATH_NOTE|%d/%d 条路径达到 p < 0.05\\n", n_sig_edge, n_edges))

concl_txt <- "路径模型未发现显著的直接路径或中介通路"
if (n_sig_edge == n_edges && n_edges > 0 && n_med > 0) {
  concl_txt <- "全部直接路径均显著，且存在可分解的中介通路"
} else {
  if (n_sig_edge > 0 && n_med > 0) {
    concl_txt <- "部分直接路径显著，并存在可分解的中介通路"
  } else {
    if (n_sig_edge > 0) {
      concl_txt <- "部分直接路径显著，但模型中没有中介通路"
    } else {
      if (n_sig_edge == n_edges && n_edges > 0) {
        concl_txt <- "全部直接路径均显著，但模型中没有中介通路"
      }
    }
  }
}
cat(sprintf("CONCL|%s（%d 条路径中 %d 条显著；%d 条中介通路；估计口径为 OLS 逐方程）\\n",
  concl_txt, n_edges, n_sig_edge, n_med))
`
}
