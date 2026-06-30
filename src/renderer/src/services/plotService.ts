/**
 * 绘图服务
 * 生成 ggplot2 R 代码，返回图片路径
 */

import type { RStatus } from '../../shared/types'

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

/** 转义 R 字符串 */
function rEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\0/g, '')
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
    case 'line':
      return lineCode(variables, groupVar, title, w, h, dataFile)
    case 'density':
      return densityCode(variables, groupVar, title, w, h, dataFile)
    default:
      return `cat("ERROR: Unknown plot type: ${type}")\n`
  }
}

function scatterCode(vars: string[], groupVar: string | undefined, title: string | undefined, w: number, h: number, df: string): string {
  const x = rEscape(vars[0])
  const y = rEscape(vars[1])
  const t = title ? `"${rEscape(title)}"` : `"${x} vs ${y}"`
  return `
library(ggplot2)
data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")
data$plot_x <- suppressWarnings(as.numeric(data[["${x}"]]))
data$plot_y <- suppressWarnings(as.numeric(data[["${y}"]]))
p <- ggplot(data, aes(x = plot_x, y = plot_y)) +
  geom_point(alpha = 0.6, size = 2, color = colors_academic[1]) +
  geom_smooth(method = "lm", se = TRUE, color = colors_academic[2], linewidth = 0.8) +
  labs(title = ${t}, x = "${x}", y = "${y}") +
  theme_academic()
save_plot(p, "plot_scatter.png", width = ${w}, height = ${h})
`
}

function histogramCode(vars: string[], title: string | undefined, w: number, h: number, df: string): string {
  const v = rEscape(vars[0])
  const t = title ? `"${rEscape(title)}"` : `"${v} 分布直方图"`
  return `
library(ggplot2)
data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")
data$plot_var <- suppressWarnings(as.numeric(data[["${v}"]]))
p <- ggplot(data, aes(x = plot_var)) +
  geom_histogram(aes(y = after_stat(density)), bins = 30, fill = colors_academic[1],
                 color = "white", alpha = 0.7) +
  geom_density(linewidth = 0.8, color = colors_academic[2]) +
  labs(title = ${t}, x = "${v}", y = "密度") +
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
library(ggplot2)
data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")
data$plot_var <- suppressWarnings(as.numeric(data[["${v}"]]))
data$plot_grp <- as.factor(data[["${g}"]])
p <- ggplot(data, aes(x = plot_grp, y = plot_var, fill = plot_grp)) +
  geom_boxplot(outlier.shape = 21, alpha = 0.7) +
  scale_fill_manual(values = colors_academic) +
  labs(title = ${t}, x = "${g}", y = "${v}") +
  theme_academic() +
  theme(legend.position = "none")
save_plot(p, "plot_boxplot.png", width = ${w}, height = ${h})
`
  }
  return `
library(ggplot2)
data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")
data$plot_var <- suppressWarnings(as.numeric(data[["${v}"]]))
p <- ggplot(data, aes(y = plot_var)) +
  geom_boxplot(fill = colors_academic[1], outlier.shape = 21, alpha = 0.7) +
  labs(title = ${t}, y = "${v}") +
  theme_academic()
save_plot(p, "plot_boxplot.png", width = ${w}, height = ${h})
`
}

function barCode(vars: string[], groupVar: string | undefined, title: string | undefined, w: number, h: number, df: string): string {
  const v = rEscape(vars[0])
  const g = groupVar ? rEscape(groupVar) : null
  const t = title ? `"${rEscape(title)}"` : `"${v} 柱状图"`
  if (g) {
    return `
library(ggplot2)
data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")
data$plot_var <- as.factor(data[["${v}"]])
data$plot_grp <- as.factor(data[["${g}"]])
p <- ggplot(data, aes(x = plot_var, fill = plot_grp)) +
  geom_bar(position = position_dodge(), alpha = 0.8) +
  scale_fill_manual(values = colors_academic) +
  labs(title = ${t}, x = "${v}", y = "频数", fill = "${g}") +
  theme_academic()
save_plot(p, "plot_bar.png", width = ${w}, height = ${h})
`
  }
  return `
library(ggplot2)
data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")
data$plot_var <- as.factor(data[["${v}"]])
p <- ggplot(data, aes(x = plot_var, fill = plot_var)) +
  geom_bar(alpha = 0.8) +
  scale_fill_manual(values = colors_academic) +
  labs(title = ${t}, x = "${v}", y = "频数") +
  theme_academic() +
  theme(legend.position = "none")
save_plot(p, "plot_bar.png", width = ${w}, height = ${h})
`
}

function lineCode(vars: string[], groupVar: string | undefined, title: string | undefined, w: number, h: number, df: string): string {
  const x = rEscape(vars[0])
  const y = rEscape(vars[1])
  const g = groupVar ? rEscape(groupVar) : null
  const t = title ? `"${rEscape(title)}"` : `"${x} 趋势图"`
  if (g) {
    return `
library(ggplot2)
data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")
data$plot_x <- suppressWarnings(as.numeric(data[["${x}"]]))
data$plot_y <- suppressWarnings(as.numeric(data[["${y}"]]))
data$plot_grp <- as.factor(data[["${g}"]])
p <- ggplot(data, aes(x = plot_x, y = plot_y, color = plot_grp, group = plot_grp)) +
  geom_line(linewidth = 0.8) + geom_point(size = 2) +
  scale_color_manual(values = colors_academic) +
  labs(title = ${t}, x = "${x}", y = "${y}", color = "${g}") +
  theme_academic()
save_plot(p, "plot_line.png", width = ${w}, height = ${h})
`
  }
  return `
library(ggplot2)
data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")
data$plot_x <- suppressWarnings(as.numeric(data[["${x}"]]))
data$plot_y <- suppressWarnings(as.numeric(data[["${y}"]]))
p <- ggplot(data, aes(x = plot_x, y = plot_y)) +
  geom_line(linewidth = 0.8, color = colors_academic[1]) +
  geom_point(size = 2, color = colors_academic[1]) +
  labs(title = ${t}, x = "${x}", y = "${y}") +
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
library(ggplot2)
data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")
data$plot_var <- suppressWarnings(as.numeric(data[["${v}"]]))
data$plot_grp <- as.factor(data[["${g}"]])
p <- ggplot(data, aes(x = plot_var, fill = plot_grp)) +
  geom_density(alpha = 0.4) +
  scale_fill_manual(values = colors_academic) +
  labs(title = ${t}, x = "${v}", y = "密度", fill = "${g}") +
  theme_academic()
save_plot(p, "plot_density.png", width = ${w}, height = ${h})
`
  }
  return `
library(ggplot2)
data <- read.csv("${rEscape(df)}", check.names = FALSE, fileEncoding = "UTF-8-BOM")
data$plot_var <- suppressWarnings(as.numeric(data[["${v}"]]))
p <- ggplot(data, aes(x = plot_var)) +
  geom_density(fill = colors_academic[1], alpha = 0.4, linewidth = 0.8) +
  labs(title = ${t}, x = "${v}", y = "密度") +
  theme_academic()
save_plot(p, "plot_density.png", width = ${w}, height = ${h})
`
}

/** 分析方法推荐图表类型 */
export const METHOD_PLOT_MAP: Record<string, { type: string; label: string }[]> = {
  descriptive: [{ type: 'histogram', label: '直方图' }, { type: 'boxplot', label: '箱线图' }],
  ttest_independent: [{ type: 'boxplot', label: '分组箱线图' }],
  ttest_paired: [{ type: 'line', label: '配对趋势图' }],
  ttest_one: [{ type: 'histogram', label: '直方图' }],
  anova: [{ type: 'boxplot', label: '分组箱线图' }, { type: 'bar', label: '均值柱状图' }],
  chisquare: [{ type: 'bar', label: '频数柱状图' }],
  correlation: [{ type: 'scatter', label: '散点图' }],
  regression: [{ type: 'scatter', label: '散点图+回归线' }],
  reliability: [{ type: 'bar', label: '条目均值图' }],
  normality: [{ type: 'histogram', label: '直方图' }, { type: 'density', label: '核密度图' }],
  nonparametric: [{ type: 'boxplot', label: '分组箱线图' }],
  frequency: [{ type: 'bar', label: '频数柱状图' }],
  summary_by: [{ type: 'bar', label: '均值柱状图' }, { type: 'boxplot', label: '箱线图' }]
}
