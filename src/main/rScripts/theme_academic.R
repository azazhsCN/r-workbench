# R Workbench 学术图表主题模板
# 符合 APA 第七版 + 中文期刊规范

# 自动检测并加载中文字体
suppressPackageStartupMessages({
  if (requireNamespace("showtext", quietly = TRUE)) {
    library(showtext)
    showtext_auto()
    # Windows 中文字体
    if (.Platform$OS.type == "windows") {
      font_add("simsun", "simsun.ttc")
      font_add("simhei", "simhei.ttc")
    }
  }
})

# 学术主题函数
theme_academic <- function(base_size = 12) {
  # 尝试使用中文字体，失败则用默认
  base_family <- ""
  if (requireNamespace("showtext", quietly = TRUE) && .Platform$OS.type == "windows") {
    base_family <- "simhei"
  }

  theme_minimal(base_size = base_size, base_family = base_family) +
  theme(
    # 坐标轴
    axis.line = element_line(color = "black", linewidth = 0.5),
    axis.ticks = element_line(color = "black", linewidth = 0.3),
    axis.ticks.length = unit(0.15, "cm"),
    axis.text = element_text(color = "black", size = base_size - 2),
    axis.title = element_text(color = "black", size = base_size, face = "bold"),
    # 网格线
    panel.grid.major = element_line(color = "#f0f0f0", linewidth = 0.3),
    panel.grid.minor = element_blank(),
    panel.border = element_blank(),
    # 图例
    legend.position = "bottom",
    legend.text = element_text(size = base_size - 2),
    legend.title = element_text(size = base_size - 1, face = "bold"),
    legend.key = element_blank(),
    # 标题
    plot.title = element_text(hjust = 0.5, face = "bold", size = base_size + 1),
    plot.subtitle = element_text(hjust = 0.5, color = "#666666", size = base_size - 1),
    # 背景
    plot.background = element_blank(),
    panel.background = element_blank(),
    # 边距
    plot.margin = margin(10, 15, 10, 15)
  )
}

# 色盲友好色板（学术配色）
colors_academic <- c("#2166AC", "#B2182B", "#4DAF4A", "#FF7F00", "#984EA3", "#A65628")

# 显著性标注函数
add_sig_label <- function(p_value) {
  if (is.na(p_value)) return("")
  if (p_value < 0.001) return("***")
  if (p_value < 0.01) return("**")
  if (p_value < 0.05) return("*")
  return("ns")
}

# 格式化统计量为 APA 格式
apa_format <- function(stat_name, stat_value, df = NULL, p_value) {
  p_str <- if (p_value < 0.001) "p < .001" else sprintf("p = %.3f", p_value)
  if (!is.null(df)) {
    sprintf("%s(%.2f) = %.3f, %s", stat_name, df, stat_value, p_str)
  } else {
    sprintf("%s = %.3f, %s", stat_name, stat_value, p_str)
  }
}

# 统一保存函数
save_plot <- function(p, filename, width = 6, height = 4, dpi = 300) {
  ggplot2::ggsave(filename, plot = p, width = width, height = height,
                  dpi = dpi, units = "in", bg = "white")
  cat(paste0("PLOT_SAVED:", filename))
}
