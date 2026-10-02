/**
 * 绘图服务
 * 生成 ggplot2 R 代码，返回图片路径
 *
 * 修复要点（v0.2.6）：
 *  - 「均值柱状图 / 条目均值图」不再画计数：新增 mean_bar / item_mean 真实均值图（含 ±1 SE 误差线）
 *  - 调色板按真实分组数动态生成（组数 > 6 不再报 Insufficient values 并留下全白 PNG）
 *  - 折线图按 x 排序（分组时组内排序），不再沿数据框行序画锯齿
 *  - 散点图补 R² / F / p 注释；直方图补真正拟合的正态曲线（KDE 另以虚线区分）
 *  - 显式剔除 as.numeric 产生的 NA，并把剔除数量写进图表脚注
 *  - 配对 t 检验用真正的配对斜率图（paired），而不是行序连线
 */

import { rEscape } from './utils'

export interface PlotResult {
  success: boolean
  plotPath: string
  error?: string
}

export interface PlotConfig {
  /** 分析类型 */
  type: string
  /** 变量名 */
  variables: string[]
  /** 分组变量 */
  groupVar?: string
  /** 图表标题 */
  title?: string
  /** 输出宽度（英寸） */
  width?: number
  /** 输出高度（英寸） */
  height?: number
}

/** 生成图表 R 代码 */
export function generatePlotCode(config: PlotConfig, dataFile = 'data.csv'): string {
  const { type, variables, groupVar, title, width = 6, height = 4 } = config
  const w = width
  const h = height

  switch (type) {
    case 'scatter':
      return scatterCode(variables, groupVar, title, w, h, dataFile)
    case 'histogram':
      return histogramCode(variables, title, w, h, dataFile)
    case 'boxplot':
      return boxplotCode(variables, groupVar, title, w, h, dataFile)
    case 'bar':
      return barCode(variables, groupVar, title, w, h, dataFile)
    case 'mean_bar':
      return meanBarCode(variables, groupVar, title, w, h, dataFile)
    case 'item_mean':
      return itemMeanCode(variables, title, w, h, dataFile)
    case 'line':
      return lineCode(variables, groupVar, title, w, h, dataFile)
    case 'paired':
      return pairedCode(variables, title, w, h, dataFile)
    case 'density':
      return densityCode(variables, groupVar, title, w, h, dataFile)
    default:
      return `stop("未知的图表类型: ${rEscape(type)}")\n`
  }
}

// ---------------------------------------------------------------------------
// 代码片段助手
// ---------------------------------------------------------------------------

/** 读取 CSV（与 ipc.ts 写入 data.csv 的编码一致） */
function readData(df: string): string {
  return `data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")`
}

/**
 * 每个脚本的公共前言。
 * 主题模板未正常加载时给出可操作的中文错误，而不是 "could not find function ..."。
 * （ipc.ts 在找不到 rScripts/theme_academic.R 时会写入一个最小备用主题，
 *   该备用主题必须同步提供这些 rwb_* 助手，见给 mainprocess 的需求说明。）
 */
function prologue(df: string): string {
  return `library(ggplot2)
if (!exists("rwb_palette", mode = "function")) stop("绘图主题模板未正确加载（缺少 rwb_palette）：请确认 src/main/rScripts/theme_academic.R 随应用一起打包")
${readData(df)}`
}

/** 变量存在性校验：给出中文错误，而不是 ggplot / [[ 的英文报错 */
function requireColumns(cols: string[]): string {
  const list = cols.map((c) => `"${rEscape(c)}"`).join(', ')
  return `missing_cols <- setdiff(c(${list}), names(data))
if (length(missing_cols) > 0) stop(paste0("数据中找不到变量: ", paste(missing_cols, collapse = ", ")))`
}

/** 生成 `data$<alias> <- as.numeric(data[["<col>"]])`（非数值 → NA，警告被抑制） */
function toNumeric(col: string, alias: string): string {
  return `data[["${alias}"]] <- suppressWarnings(as.numeric(data[["${col}"]]))`
}

/** 显式剔除 NA（替代 ggplot 的静默丢点），并生成脚注片段 cap 与有效样本量 */
function dropNa(aliases: string[]): string {
  const list = aliases.map((a) => `"${a}"`).join(', ')
  return `.na <- rwb_drop_na(data, c(${list}))
data <- .na$data
cap <- rwb_caption(.na$dropped, .na$n)`
}

/** 组合脚注：cap 由 dropNa 生成，可能为 NULL */
function captionExpr(extra: string[] = []): string {
  if (extra.length === 0) return 'cap'
  const items = ['cap', ...extra.map((e) => `"${rEscape(e)}"`)].join(', ')
  return `paste(c(${items}), collapse = "；")`
}

/** 空数据保护，避免生成空白 PNG */
function requireRows(minRows: number, message: string, expr = 'nrow(data)'): string {
  return `if (${expr} < ${minRows}) stop("${rEscape(message)}")`
}

/** 动态填充色板：按真实 level 数生成颜色，组数 > 6 不再报错 */
function dynamicFill(factorExpr: string): string {
  return `scale_fill_manual(values = rwb_palette(nlevels(${factorExpr})))`
}

/** 动态描边色板 */
function dynamicColor(factorExpr: string): string {
  return `scale_color_manual(values = rwb_palette(nlevels(${factorExpr})))`
}

/** after_stat() 版本守卫（ggplot2 >= 3.4.0 才有；旧版本回退 ..density.. / ..count..） */
function densityAes(): string {
  return `density_aes <- if (rwb_has_after_stat()) aes(y = after_stat(density)) else aes(y = ..density..)`
}
function countAes(alias = 'count_aes'): string {
  return `${alias} <- if (rwb_has_after_stat()) aes(label = after_stat(count)) else aes(label = ..count..)`
}

// ---------------------------------------------------------------------------
// 各图表生成器
// ---------------------------------------------------------------------------

function scatterCode(vars: string[], _groupVar: string | undefined, title: string | undefined, w: number, h: number, df: string): string {
  if (vars.length < 2) return `stop("散点图需要 2 个变量")\n`
  const x = rEscape(vars[0])
  const y = rEscape(vars[1])
  const t = title ? `"${rEscape(title)}"` : `"${x} vs ${y} 散点图"`
  return `
${prologue(df)}
${requireColumns([vars[0], vars[1]])}
n_raw <- nrow(data)
${toNumeric(vars[0], 'plot_x')}
${toNumeric(vars[1], 'plot_y')}
${dropNa(['plot_x', 'plot_y'])}
${requireRows(3, '有效配对观测不足 3 个，无法拟合回归线并计算 R²')}
fit <- stats::lm(plot_y ~ plot_x, data = data)
sfit <- summary(fit)
r2 <- sfit$r.squared
fp <- if (is.null(sfit$fstatistic)) NA_real_ else stats::pf(sfit$fstatistic[1], sfit$fstatistic[2], sfit$fstatistic[3], lower.tail = FALSE)
label_stat <- if (is.null(sfit$fstatistic)) "" else apa_format("F", sfit$fstatistic[1], df = sfit$fstatistic[2:3], p_value = fp)
fit_label <- if (nzchar(label_stat)) {
  sprintf("R\\u00B2 = %.3f %s\\n%s", r2, add_sig_label(fp), label_stat)
} else {
  sprintf("R\\u00B2 = %.3f %s", r2, add_sig_label(fp))
}
p <- ggplot(data, aes(x = plot_x, y = plot_y)) +
  geom_point(alpha = 0.6, size = 2, color = colors_academic[1], na.rm = TRUE) +
  geom_smooth(method = "lm", formula = y ~ x, se = TRUE, color = colors_academic[2], linewidth = 0.8, na.rm = TRUE) +
  annotate("text", x = -Inf, y = Inf, hjust = -0.08, vjust = 1.3, size = 3.4,
           color = "grey20", lineheight = 1.1, label = fit_label) +
  labs(title = ${t}, x = "${x}", y = "${y}",
       caption = ${captionExpr(['实线 = 最小二乘回归线（阴影 = 95% 置信带）'])}) +
  theme_academic()
save_plot(p, "plot_scatter.png", width = ${w}, height = ${h})
`
}

function histogramCode(vars: string[], title: string | undefined, w: number, h: number, df: string): string {
  const v = rEscape(vars[0])
  const t = title ? `"${rEscape(title)}"` : `"${v} 分布直方图"`
  return `
${prologue(df)}
${requireColumns([vars[0]])}
n_raw <- nrow(data)
${toNumeric(vars[0], 'plot_var')}
${dropNa(['plot_var'])}
${requireRows(2, '有效观测不足 2 个，无法绘制直方图')}
m <- mean(data$plot_var)
s <- stats::sd(data$plot_var)
${densityAes()}
p <- ggplot(data, aes(x = plot_var)) +
  geom_histogram(mapping = density_aes, bins = 30, fill = colors_academic[1],
                 color = "white", alpha = 0.7, na.rm = TRUE) +
  geom_density(linewidth = 0.8, color = colors_academic[3], linetype = "dashed", na.rm = TRUE)
if (is.finite(s) && s > 0) {
  p <- p + stat_function(fun = stats::dnorm, args = list(mean = m, sd = s),
                         color = colors_academic[2], linewidth = 1, na.rm = TRUE)
}
p <- p + labs(title = ${t}, x = "${v}", y = "密度",
              subtitle = if (is.finite(s) && s > 0)
                sprintf("拟合正态分布 N(%.2f, %.2f\\u00B2)", m, s^2)
              else "标准差为 0 或不可用，未绘制正态曲线",
              caption = ${captionExpr(['实线 = 拟合正态曲线；虚线 = 核密度估计 (KDE)'])}) +
  theme_academic()
save_plot(p, "plot_histogram.png", width = ${w}, height = ${h})
`
}

function boxplotCode(vars: string[], groupVar: string | undefined, title: string | undefined, w: number, h: number, df: string): string {
  const v = rEscape(vars[0])
  const g = groupVar ? rEscape(groupVar) : null
  const t = title ? `"${rEscape(title)}"` : g ? `"${v} 分组箱线图"` : `"${v} 箱线图"`
  if (g) {
    return `
${prologue(df)}
${requireColumns([vars[0], groupVar as string])}
n_raw <- nrow(data)
${toNumeric(vars[0], 'plot_var')}
data$plot_grp <- rwb_factor(data[["${g}"]])
${dropNa(['plot_var', 'plot_grp'])}
${requireRows(1, '有效观测为 0，无法绘制箱线图')}
p <- ggplot(data, aes(x = plot_grp, y = plot_var, fill = plot_grp)) +
  geom_boxplot(outlier.shape = 21, alpha = 0.7, na.rm = TRUE) +
  ${dynamicFill('data$plot_grp')} +
  labs(title = ${t}, x = "${g}", y = "${v}", caption = ${captionExpr()}) +
  theme_academic() +
  theme(legend.position = "none")
save_plot(p, "plot_boxplot.png", width = ${w}, height = ${h})
`
  }
  return `
${prologue(df)}
${requireColumns([vars[0]])}
n_raw <- nrow(data)
${toNumeric(vars[0], 'plot_var')}
${dropNa(['plot_var'])}
${requireRows(1, '有效观测为 0，无法绘制箱线图')}
p <- ggplot(data, aes(y = plot_var)) +
  geom_boxplot(fill = colors_academic[1], outlier.shape = 21, alpha = 0.7, na.rm = TRUE) +
  labs(title = ${t}, y = "${v}", caption = ${captionExpr()}) +
  theme_academic()
save_plot(p, "plot_boxplot.png", width = ${w}, height = ${h})
`
}

/**
 * 频数柱状图（计数）。
 * y 轴明确标注"频数（计数）"；chisquare 同时传入两个分类变量时按第二个变量聚类，
 * 不再静默忽略第二个变量。
 */
function barCode(vars: string[], groupVar: string | undefined, title: string | undefined, w: number, h: number, df: string): string {
  const v = rEscape(vars[0])
  // 恰好两个变量时按第二个变量聚类（卡方检验的两变量交叉频数图）；
  // 只选一个变量时画单序列频数图，不做任何静默丢弃
  const fillVar = groupVar ? groupVar : vars.length === 2 ? vars[1] : null
  const fill = fillVar ? rEscape(fillVar) : null
  const t = title ? `"${rEscape(title)}"` : fill ? `"${v} × ${fill} 频数柱状图"` : `"${v} 频数柱状图"`

  if (fill) {
    return `
${prologue(df)}
${requireColumns([vars[0], fillVar as string])}
n_raw <- nrow(data)
data$plot_var <- rwb_factor(data[["${v}"]])
data$plot_grp <- rwb_factor(data[["${fill}"]])
${dropNa(['plot_var', 'plot_grp'])}
${requireRows(1, '有效观测为 0，无法绘制频数柱状图')}
${countAes()}
p <- ggplot(data, aes(x = plot_var, fill = plot_grp)) +
  geom_bar(position = position_dodge(), alpha = 0.8, na.rm = TRUE) +
  geom_text(stat = "count", mapping = count_aes, position = position_dodge(width = 0.9),
            vjust = -0.4, size = 2.8, na.rm = TRUE) +
  ${dynamicFill('data$plot_grp')} +
  labs(title = ${t}, x = "${v}", y = "频数（计数）", fill = "${fill}",
       caption = ${captionExpr(['柱高 = 该类别出现次数（计数），不是均值'])} ) +
  theme_academic()
save_plot(p, "plot_bar.png", width = ${w}, height = ${h})
`
  }
  return `
${prologue(df)}
${requireColumns([vars[0]])}
n_raw <- nrow(data)
data$plot_var <- rwb_factor(data[["${v}"]])
${dropNa(['plot_var'])}
${requireRows(1, '有效观测为 0，无法绘制频数柱状图')}
${countAes()}
p <- ggplot(data, aes(x = plot_var, fill = plot_var)) +
  geom_bar(alpha = 0.8, na.rm = TRUE) +
  geom_text(stat = "count", mapping = count_aes, vjust = -0.4, size = 2.8, na.rm = TRUE) +
  ${dynamicFill('data$plot_var')} +
  labs(title = ${t}, x = "${v}", y = "频数（计数）",
       caption = ${captionExpr(['柱高 = 该类别出现次数（计数），不是均值'])}) +
  theme_academic() +
  theme(legend.position = "none")
save_plot(p, "plot_bar.png", width = ${w}, height = ${h})
`
}

/**
 * 均值柱状图：x = 分组因子，y = 数值因变量的均值，误差线 = 均值 ± 1 标准误 (SE)。
 * 用于 anova / summary_by（原实现只画计数，与"均值柱状图"标签矛盾）。
 * 未提供分组变量时退化为"总体均值"单柱，仍然画均值而不是计数。
 */
function meanBarCode(vars: string[], groupVar: string | undefined, title: string | undefined, w: number, h: number, df: string): string {
  const v = rEscape(vars[0])
  const g = groupVar ? rEscape(groupVar) : null
  const t = title ? `"${rEscape(title)}"` : g ? `"${v} 分组均值柱状图"` : `"${v} 均值柱状图"`
  return `
${prologue(df)}
${requireColumns(g ? [vars[0], groupVar as string] : [vars[0]])}
n_raw <- nrow(data)
${toNumeric(vars[0], 'plot_var')}
${g ? `data$plot_grp <- rwb_factor(data[["${g}"]])` : `data$plot_grp <- factor("全部样本")`}
${dropNa(['plot_var', 'plot_grp'])}
${requireRows(1, '有效观测为 0，无法计算均值')}
grp_n <- table(data$plot_grp)
n_sub <- paste0("各组 n: ", paste(paste0(names(grp_n), "=", as.integer(grp_n)), collapse = ", "))
p <- ggplot(data, aes(x = plot_grp, y = plot_var, fill = plot_grp)) +
  stat_summary(fun = mean, geom = "bar", width = 0.65, alpha = 0.85, na.rm = TRUE) +
  stat_summary(fun.data = ggplot2::mean_se, geom = "errorbar", width = 0.2, linewidth = 0.6, na.rm = TRUE) +
  ${dynamicFill('data$plot_grp')} +
  labs(title = ${t}, subtitle = n_sub, x = "${g ?? '分组'}",
       y = "均值（误差线: ±1 标准误 SE）", fill = "${g ?? '分组'}",
       caption = ${captionExpr(['柱高 = 各组均值；误差线 = 均值 ± 1 标准误 (SE)'])}) +
  theme_academic() +
  theme(legend.position = "none")
save_plot(p, "plot_bar.png", width = ${w}, height = ${h})
`
}

/**
 * 条目均值图：对选中的 N 个条目做按样本列删除（listwise），
 * 画每个条目的均值与 ±1 标准误误差线（原实现把第一个条目转因子画计数）。
 */
function itemMeanCode(vars: string[], title: string | undefined, w: number, h: number, df: string): string {
  if (vars.length < 1) return `stop("条目均值图至少需要 1 个条目变量")\n`
  const items = vars.map((v) => `"${rEscape(v)}"`).join(', ')
  const t = title ? `"${rEscape(title)}"` : '"条目均值图"'
  return `
${prologue(df)}
${requireColumns(vars)}
n_raw <- nrow(data)
items <- c(${items})
mat <- vapply(items, function(cn) suppressWarnings(as.numeric(data[[cn]])), numeric(nrow(data)))
if (is.null(dim(mat))) mat <- matrix(mat, ncol = length(items), dimnames = list(NULL, items))
mat <- mat[rowSums(is.na(mat)) == 0, , drop = FALSE]
dropped <- as.integer(n_raw - nrow(mat))
cap <- rwb_caption(dropped, nrow(mat))
${requireRows(2, '有效作答样本不足 2 份，无法计算条目均值', 'nrow(mat)')}
means <- colMeans(mat)
ses <- apply(mat, 2, function(z) stats::sd(z) / sqrt(length(z)))
agg <- data.frame(plot_item = factor(items, levels = items),
                  plot_mean = as.numeric(means), plot_se = as.numeric(ses))
agg$plot_se[!is.finite(agg$plot_se)] <- 0
p <- ggplot(agg, aes(x = plot_item, y = plot_mean, fill = plot_item)) +
  geom_col(width = 0.65, alpha = 0.85, na.rm = TRUE) +
  geom_errorbar(aes(ymin = plot_mean - plot_se, ymax = plot_mean + plot_se),
                width = 0.2, linewidth = 0.6, na.rm = TRUE) +
  ${dynamicFill('agg$plot_item')} +
  labs(title = ${t}, x = "条目", y = "条目均值（误差线: ±1 标准误 SE）",
       caption = ${captionExpr(['缺失值按样本列删除 (listwise)'])}) +
  theme_academic() +
  theme(legend.position = "none")
save_plot(p, "plot_bar.png", width = ${w}, height = ${h})
`
}

function lineCode(vars: string[], groupVar: string | undefined, title: string | undefined, w: number, h: number, df: string): string {
  if (vars.length < 2) return `stop("折线图需要 2 个变量")\n`
  const x = rEscape(vars[0])
  const y = rEscape(vars[1])
  const g = groupVar ? rEscape(groupVar) : null
  const t = title ? `"${rEscape(title)}"` : `"${x} 趋势图"`
  if (g) {
    return `
${prologue(df)}
${requireColumns([vars[0], vars[1], groupVar as string])}
n_raw <- nrow(data)
${toNumeric(vars[0], 'plot_x')}
${toNumeric(vars[1], 'plot_y')}
data$plot_grp <- rwb_factor(data[["${g}"]])
${dropNa(['plot_x', 'plot_y', 'plot_grp'])}
${requireRows(2, '有效观测不足 2 个，无法绘制折线图')}
# 关键：按 x 排序（分组时组内排序），否则 geom_line 沿数据框行序连线成锯齿
data <- data[order(data$plot_grp, data$plot_x), , drop = FALSE]
p <- ggplot(data, aes(x = plot_x, y = plot_y, color = plot_grp, group = plot_grp)) +
  geom_line(linewidth = 0.8, na.rm = TRUE) +
  geom_point(size = 2, na.rm = TRUE) +
  ${dynamicColor('data$plot_grp')} +
  labs(title = ${t}, x = "${x}", y = "${y}", color = "${g}",
       caption = ${captionExpr(['散点按 x 升序连线（组内排序）'])}) +
  theme_academic()
save_plot(p, "plot_line.png", width = ${w}, height = ${h})
`
  }
  return `
${prologue(df)}
${requireColumns([vars[0], vars[1]])}
n_raw <- nrow(data)
${toNumeric(vars[0], 'plot_x')}
${toNumeric(vars[1], 'plot_y')}
${dropNa(['plot_x', 'plot_y'])}
${requireRows(2, '有效观测不足 2 个，无法绘制折线图')}
# 关键：按 x 排序，否则 geom_line 沿数据框行序连线成锯齿
data <- data[order(data$plot_x), , drop = FALSE]
p <- ggplot(data, aes(x = plot_x, y = plot_y)) +
  geom_line(linewidth = 0.8, color = colors_academic[1], na.rm = TRUE) +
  geom_point(size = 2, color = colors_academic[1], na.rm = TRUE) +
  labs(title = ${t}, x = "${x}", y = "${y}",
       caption = ${captionExpr(['散点按 x 升序连线'])}) +
  theme_academic()
save_plot(p, "plot_line.png", width = ${w}, height = ${h})
`
}

/**
 * 配对趋势图（配对斜率图）：每对观测一条细线，菱形=各时点均值，误差线=均值 ± 1 SE。
 * 原实现是"沿行序连接两列"的折线，对 pre/post 数据只会画出锯齿，与"配对趋势图"不符。
 */
function pairedCode(vars: string[], title: string | undefined, w: number, h: number, df: string): string {
  if (vars.length < 2) return `stop("配对趋势图需要 2 个变量（例如 前测、后测）")\n`
  const a = rEscape(vars[0])
  const b = rEscape(vars[1])
  const t = title ? `"${rEscape(title)}"` : `"${a} → ${b} 配对趋势图"`
  return `
${prologue(df)}
${requireColumns([vars[0], vars[1]])}
n_raw <- nrow(data)
${toNumeric(vars[0], 'plot_pre')}
${toNumeric(vars[1], 'plot_post')}
${dropNa(['plot_pre', 'plot_post'])}
${requireRows(2, '有效配对样本不足 2 对，无法绘制配对趋势图')}
data <- data.frame(
  plot_id = factor(rep(seq_len(nrow(data)), times = 2)),
  plot_item = factor(rep(c("${a}", "${b}"), each = nrow(data)), levels = c("${a}", "${b}")),
  plot_value = c(data$plot_pre, data$plot_post)
)
p <- ggplot(data, aes(x = plot_item, y = plot_value)) +
  geom_line(aes(group = plot_id), color = "grey55", alpha = 0.55, linewidth = 0.4, na.rm = TRUE) +
  geom_point(aes(group = plot_id), color = colors_academic[1], alpha = 0.55, size = 1.4, na.rm = TRUE) +
  stat_summary(fun = mean, geom = "line", mapping = aes(group = 1),
               color = colors_academic[2], linewidth = 1, na.rm = TRUE) +
  stat_summary(fun = mean, geom = "point", shape = 18, size = 4,
               color = colors_academic[2], na.rm = TRUE) +
  stat_summary(fun.data = ggplot2::mean_se, geom = "errorbar", width = 0.08,
               linewidth = 0.7, color = colors_academic[2], na.rm = TRUE) +
  labs(title = ${t}, x = "", y = "数值（误差线: 均值 ± 1 标准误 SE）",
       caption = ${captionExpr(['每条细线 = 一对观测；菱形与误差线 = 各时点均值 ± 1 SE'])}) +
  theme_academic()
save_plot(p, "plot_line.png", width = ${w}, height = ${h})
`
}

function densityCode(vars: string[], groupVar: string | undefined, title: string | undefined, w: number, h: number, df: string): string {
  const v = rEscape(vars[0])
  const g = groupVar ? rEscape(groupVar) : null
  const t = title ? `"${rEscape(title)}"` : `"${v} 核密度图"`
  if (g) {
    return `
${prologue(df)}
${requireColumns([vars[0], groupVar as string])}
n_raw <- nrow(data)
${toNumeric(vars[0], 'plot_var')}
data$plot_grp <- rwb_factor(data[["${g}"]])
${dropNa(['plot_var', 'plot_grp'])}
${requireRows(2, '有效观测不足 2 个，无法估计核密度')}
p <- ggplot(data, aes(x = plot_var, fill = plot_grp)) +
  geom_density(alpha = 0.4, na.rm = TRUE) +
  ${dynamicFill('data$plot_grp')} +
  labs(title = ${t}, x = "${v}", y = "密度", fill = "${g}",
       caption = ${captionExpr(['曲线为核密度估计 (KDE)'])}) +
  theme_academic()
save_plot(p, "plot_density.png", width = ${w}, height = ${h})
`
  }
  return `
${prologue(df)}
${requireColumns([vars[0]])}
n_raw <- nrow(data)
${toNumeric(vars[0], 'plot_var')}
${dropNa(['plot_var'])}
${requireRows(2, '有效观测不足 2 个，无法估计核密度')}
p <- ggplot(data, aes(x = plot_var)) +
  geom_density(fill = colors_academic[1], alpha = 0.4, linewidth = 0.8, na.rm = TRUE) +
  labs(title = ${t}, x = "${v}", y = "密度",
       caption = ${captionExpr(['曲线为核密度估计 (KDE)'])}) +
  theme_academic()
save_plot(p, "plot_density.png", width = ${w}, height = ${h})
`
}

/**
 * 分析方法推荐图表类型
 *  - mean_bar：真正的均值柱状图（±1 SE 误差线），供 anova / summary_by 使用
 *  - item_mean：条目均值图（逐条目均值），供 reliability 使用
 *  - paired：配对斜率图，供 ttest_paired 使用
 *  - bar：频数柱状图（计数），供 frequency / chisquare 使用
 * label 必须与 PlotViewer 的 plotLabelKey / i18n 保持一致，不要改文案。
 */
export const METHOD_PLOT_MAP: Record<string, { type: string; label: string }[]> = {
  descriptive: [{ type: 'histogram', label: '直方图' }, { type: 'boxplot', label: '箱线图' }],
  ttest_independent: [{ type: 'boxplot', label: '分组箱线图' }],
  ttest_paired: [{ type: 'paired', label: '配对趋势图' }],
  ttest_one: [{ type: 'histogram', label: '直方图' }],
  anova: [{ type: 'boxplot', label: '分组箱线图' }, { type: 'mean_bar', label: '均值柱状图' }],
  chisquare: [{ type: 'bar', label: '频数柱状图' }],
  correlation: [{ type: 'scatter', label: '散点图' }],
  regression: [{ type: 'scatter', label: '散点图+回归线' }],
  reliability: [{ type: 'item_mean', label: '条目均值图' }],
  normality: [{ type: 'histogram', label: '直方图' }, { type: 'density', label: '核密度图' }],
  nonparametric: [{ type: 'boxplot', label: '分组箱线图' }],
  frequency: [{ type: 'bar', label: '频数柱状图' }],
  summary_by: [{ type: 'mean_bar', label: '均值柱状图' }, { type: 'boxplot', label: '箱线图' }]
}
