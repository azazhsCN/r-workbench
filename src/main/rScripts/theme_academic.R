# R Workbench 学术图表主题模板
# 符合 APA 第七版 + 中文期刊规范
#
# 设计约束（不要退化）：
#   1. 本文件必须能被 `source()` 且**绝不因字体/包缺失而报错**——任何字体问题都降级为
#      base_family = "" + 系统设备字体，绝不中断绘图。
#   2. 所有 ggplot2 函数一律 `ggplot2::` 限定，使本文件可脱离 `library(ggplot2)` 独立使用。
#   3. 调色板按真实分组数动态生成，组数 > 6 时不得因颜色不足报错。
#   4. 每个函数都可能被生成的绘图脚本调用，故必须容忍 NA / 空数据 / 未安装的可选包。

# ---------------------------------------------------------------------------
# 0. ggplot2 版本能力探测（after_stat() 需要 ggplot2 >= 3.4.0，2022-11 发布）
# ---------------------------------------------------------------------------
rwb_ggplot_version <- function() {
  v <- tryCatch(as.character(utils::packageVersion("ggplot2")), error = function(e) NA_character_)
  if (is.na(v)) NA_character_ else v
}

#' 是否支持 after_stat()（ggplot2 >= 3.4.0）；否则调用方需回退到 ..density.. / ..count..
rwb_has_after_stat <- function() {
  tryCatch(utils::packageVersion("ggplot2") >= "3.4.0", error = function(e) FALSE)
}

# ---------------------------------------------------------------------------
# 1. 中文字体解析：绝不硬编码裸文件名，任何失败都必须降级而不是报错
# ---------------------------------------------------------------------------

#' 各平台候选字体（按优先级）。Windows 上 simhei 的真实文件名是 simhei.ttf，
#' 而旧代码写死 simhei.ttc —— 该文件在本机并不存在，正是"所有图表全灭"的根因。
rwb_font_candidates <- function(os = .Platform$OS.type,
                                sysname = Sys.info()[["sysname"]]) {
  if (identical(os, "windows")) {
    c("simhei.ttf", "simsun.ttc", "msyh.ttc", "msyhbd.ttc",
      "simkai.ttf", "simfang.ttf", "Deng.ttf", "msyhl.ttc")
  } else if (identical(sysname, "Darwin")) {
    c("/System/Library/Fonts/PingFang.ttc", "PingFang.ttc",
      "/System/Library/Fonts/STHeiti Light.ttc", "STHeiti Light.ttc",
      "/System/Library/Fonts/Hiragino Sans GB.ttc", "Hiragino Sans GB.ttc",
      "/System/Library/Fonts/Supplemental/Songti.ttc", "Songti.ttc",
      "/Library/Fonts/Arial Unicode.ttf", "Arial Unicode.ttf")
  } else {
    c("NotoSansCJK-Regular.ttc", "NotoSansCJKsc-Regular.otf",
      "NotoSansCJK-VF.otf.ttc", "NotoSansSC-Regular.otf",
      "SourceHanSansSC-Regular.otf", "wqy-zenhei.ttc", "wqy-microhei.ttc",
      "DroidSansFallbackFull.ttf", "DejaVuSans.ttf")
  }
}

#' 各平台可能的字体目录
rwb_font_dirs <- function(os = .Platform$OS.type,
                          sysname = Sys.info()[["sysname"]]) {
  home <- Sys.getenv("HOME", "")
  p <- if (identical(os, "windows")) {
    c(file.path(Sys.getenv("WINDIR", "C:/Windows"), "Fonts"),
      file.path(Sys.getenv("LOCALAPPDATA", ""), "Microsoft", "Windows", "Fonts"))
  } else if (identical(sysname, "Darwin")) {
    c("/System/Library/Fonts", "/System/Library/Fonts/Supplemental",
      "/Library/Fonts", file.path(home, "Library/Fonts"))
  } else {
    c("/usr/share/fonts", "/usr/local/share/fonts", "/usr/share/fonts/truetype",
      file.path(home, ".fonts"), file.path(home, ".local/share/fonts"))
  }
  p[nzchar(p) & dir.exists(p)]
}

#' 解析出真实存在的字体文件路径；找不到返回 NULL（**绝不 stop**）
rwb_resolve_font_file <- function(candidates = rwb_font_candidates(),
                                  dirs = rwb_font_dirs()) {
  if (!length(candidates)) return(NULL)
  candidates <- candidates[!is.na(candidates) & nzchar(candidates)]
  if (!length(candidates)) return(NULL)

  # (a) 候选本身是存在的路径（绝对路径 / 相对当前目录）
  for (f in candidates) {
    if (file.exists(f)) return(normalizePath(f, mustWork = FALSE))
  }

  # (b) sysfonts::font_files() 报告的系统字体表（跨平台）
  if (requireNamespace("sysfonts", quietly = TRUE)) {
    ff <- try(suppressMessages(sysfonts::font_files()), silent = TRUE)
    if (!inherits(ff, "try-error") && is.data.frame(ff) && nrow(ff) > 0L &&
        all(c("file", "path") %in% names(ff))) {
      want <- tolower(basename(candidates))
      hit <- which(tolower(ff$file) %in% want)
      if (!length(hit) && "family" %in% names(ff)) {
        want_fam <- gsub("[^a-z0-9]", "", tolower(sub("\\.[A-Za-z0-9]+$", "", basename(candidates))))
        hit <- which(gsub("[^a-z0-9]", "", tolower(ff$family)) %in% want_fam)
      }
      for (i in hit) {
        p <- file.path(ff$path[i], ff$file[i])
        if (file.exists(p)) return(normalizePath(p, mustWork = FALSE))
      }
    }
  }

  # (c) 直接在系统字体目录里按文件名（不区分大小写）查找
  want <- tolower(basename(candidates))
  for (recursive in c(FALSE, TRUE)) {
    for (d in dirs) {
      listing <- try(list.files(d, full.names = TRUE, recursive = recursive), silent = TRUE)
      if (inherits(listing, "try-error") || !length(listing)) next
      base <- tolower(basename(listing))
      m <- which(base %in% want)
      if (length(m)) return(normalizePath(listing[m[1]], mustWork = FALSE))
    }
  }
  NULL
}

#' 注册中文字体；任何一步失败都返回 registered = FALSE 而不是抛错。
#' 只有真正注册成功才启用 showtext —— 否则宁可让图形设备用原生字体，
#' 也不要用未注册字族把中文渲染成方框。
rwb_setup_fonts <- function(candidates = rwb_font_candidates(), family = "rwb-cjk") {
  res <- list(family = "", registered = FALSE, file = NA_character_, reason = "")
  if (!requireNamespace("showtext", quietly = TRUE) ||
      !requireNamespace("sysfonts", quietly = TRUE)) {
    res$reason <- "showtext/sysfonts 未安装：使用系统默认字体"
    return(res)
  }
  path <- try(rwb_resolve_font_file(candidates), silent = TRUE)
  if (inherits(path, "try-error")) path <- NULL
  if (is.null(path) || !nzchar(path) || !file.exists(path)) {
    res$reason <- "未找到可用的中文字体文件：回退 base_family = \"\""
    return(res)
  }
  ok <- tryCatch({
    suppressWarnings(sysfonts::font_add(family, regular = path))
    TRUE
  }, error = function(e) {
    res$reason <<- paste0("font_add 失败：", conditionMessage(e))
    FALSE
  })
  if (!isTRUE(ok)) return(res)
  fams <- tryCatch(sysfonts::font_families(), error = function(e) character())
  if (!(family %in% fams)) {
    res$reason <- "font_add 未真正注册该字体"
    return(res)
  }
  try(showtext::showtext_auto(), silent = TRUE)
  res$family <- family
  res$registered <- TRUE
  res$file <- path
  res
}

#' 源文件加载时解析一次；失败即静默降级
rwb_font <- rwb_setup_fonts()

#' 当前应使用的 base_family（""=系统默认，永不报错）
rwb_base_family <- function() if (isTRUE(rwb_font$registered)) rwb_font$family else ""

# ---------------------------------------------------------------------------
# 2. 学术主题（全部 ggplot2:: 限定）
# ---------------------------------------------------------------------------
theme_academic <- function(base_size = 12) {
  ggplot2::theme_minimal(base_size = base_size, base_family = rwb_base_family()) +
    ggplot2::theme(
      # 坐标轴
      axis.line = ggplot2::element_line(color = "black", linewidth = 0.5),
      axis.ticks = ggplot2::element_line(color = "black", linewidth = 0.3),
      axis.ticks.length = ggplot2::unit(0.15, "cm"),
      axis.text = ggplot2::element_text(color = "black", size = base_size - 2),
      axis.title = ggplot2::element_text(color = "black", size = base_size, face = "bold"),
      # 网格线
      panel.grid.major = ggplot2::element_line(color = "#f0f0f0", linewidth = 0.3),
      panel.grid.minor = ggplot2::element_blank(),
      panel.border = ggplot2::element_blank(),
      # 图例
      legend.position = "bottom",
      legend.text = ggplot2::element_text(size = base_size - 2),
      legend.title = ggplot2::element_text(size = base_size - 1, face = "bold"),
      legend.key = ggplot2::element_blank(),
      # 标题 / 副标题 / 脚注
      plot.title = ggplot2::element_text(hjust = 0.5, face = "bold", size = base_size + 1),
      plot.subtitle = ggplot2::element_text(hjust = 0.5, color = "#666666", size = base_size - 1),
      plot.caption = ggplot2::element_text(hjust = 0, color = "#666666", size = base_size - 3),
      # 背景
      plot.background = ggplot2::element_blank(),
      panel.background = ggplot2::element_blank(),
      # 边距
      plot.margin = ggplot2::margin(10, 15, 10, 15)
    )
}

# ---------------------------------------------------------------------------
# 3. 调色板：按真实分组数动态生成，组数 > 6 时不得报错
# ---------------------------------------------------------------------------
# 色盲友好色板（学术配色，<= 6 组时优先使用）
colors_academic <- c("#2166AC", "#B2182B", "#4DAF4A", "#FF7F00", "#984EA3", "#A65628")

#' 生成 n 个可区分的颜色；任何依赖缺失都有兜底，绝不因"颜色不足"报错
rwb_palette <- function(n, base = colors_academic) {
  n <- suppressWarnings(as.integer(n))
  if (length(n) != 1L || is.na(n) || n < 0L) n <- length(base)
  if (n == 0L) return(character(0))
  if (n <= length(base)) return(as.character(base[seq_len(n)]))

  pal <- NULL
  if (requireNamespace("scales", quietly = TRUE)) {
    pal <- try(scales::hue_pal()(n), silent = TRUE)
    if (inherits(pal, "try-error") || length(pal) < n) pal <- NULL
  }
  if (is.null(pal) && requireNamespace("viridisLite", quietly = TRUE)) {
    pal <- try(viridisLite::viridis(n), silent = TRUE)
    if (inherits(pal, "try-error") || length(pal) < n) pal <- NULL
  }
  if (is.null(pal)) {
    pal <- tryCatch(grDevices::hcl.colors(n, "Dark 3"), error = function(e) NULL)
  }
  if (is.null(pal) || length(pal) < n) pal <- grDevices::rainbow(n)
  as.character(pal)[seq_len(n)]
}

# ---------------------------------------------------------------------------
# 4. 数据准备助手（显式处理缺失值 / 因子顺序 / 绘制说明）
# ---------------------------------------------------------------------------

#' 显式剔除 NA，并返回被剔除的数量。
#' 不再依赖 ggplot 静默丢点（"Removed N rows" 只写 stderr，应用侧看不到）。
rwb_drop_na <- function(data, cols) {
  keep <- rep(TRUE, nrow(data))
  for (cn in cols) if (cn %in% names(data)) keep <- keep & !is.na(data[[cn]])
  list(data = data[keep, , drop = FALSE], dropped = as.integer(sum(!keep)), n = as.integer(sum(keep)))
}

#' 生成图表脚注：把被剔除的缺失值数量与有效样本量写在图上（用户可见）
rwb_caption <- function(dropped = 0L, n = NULL, extra = NULL) {
  parts <- character(0)
  if (!is.null(dropped) && length(dropped) == 1L && !is.na(dropped) && dropped > 0) {
    parts <- c(parts, sprintf("已剔除 %d 个缺失值", as.integer(dropped)))
  }
  if (!is.null(n) && length(n) == 1L && !is.na(n)) {
    parts <- c(parts, sprintf("有效样本 n = %d", as.integer(n)))
  }
  if (!is.null(extra) && length(extra) && any(nzchar(extra))) parts <- c(parts, extra[nzchar(extra)])
  if (!length(parts)) return(NULL)
  paste(parts, collapse = "；")
}

#' 保序因子：CSV 读入的字符列按"数据声明顺序"（首次出现）建 levels，
#' 避免 as.factor() 的字典序把中文问卷选项顺序打乱；数值分组按数值排序。
rwb_factor <- function(x) {
  if (is.factor(x)) return(x)
  if (is.numeric(x)) {
    lv <- sort(unique(x[!is.na(x)]))
    return(factor(x, levels = lv))
  }
  xc <- as.character(x)
  lv <- unique(xc[!is.na(xc)])
  factor(xc, levels = lv)
}

# ---------------------------------------------------------------------------
# 5. 显著性 / 统计量格式化（被散点图注释与配对图调用，不再是死代码）
# ---------------------------------------------------------------------------

#' p 值 → 显著性星号；NA 安全
add_sig_label <- function(p_value) {
  if (is.null(p_value) || length(p_value) != 1L || is.na(p_value)) return("")
  if (p_value < 0.001) return("***")
  if (p_value < 0.01) return("**")
  if (p_value < 0.05) return("*")
  "ns"
}

#' APA 格式统计量；df 可为长度 1 或 2 的向量，p 值 NA 安全
apa_format <- function(stat_name, stat_value, df = NULL, p_value = NA_real_) {
  p_str <- if (is.null(p_value) || length(p_value) != 1L || is.na(p_value)) "" else
    if (p_value < 0.001) "p < .001" else sprintf("p = %.3f", p_value)
  df_str <- if (is.null(df) || !length(df)) "" else
    sprintf("(%s)", paste(format(df, trim = TRUE), collapse = ", "))
  val_str <- if (is.null(stat_value) || length(stat_value) != 1L || is.na(stat_value)) "NA" else
    sprintf("%.3f", stat_value)
  out <- sprintf("%s%s = %s", stat_name, df_str, val_str)
  if (nzchar(p_str)) out <- paste0(out, ", ", p_str)
  out
}

# ---------------------------------------------------------------------------
# 6. 保存：绝不留半成品/空白文件，失败时抛出可被上层捕获的中文错误
# ---------------------------------------------------------------------------
save_plot <- function(p, filename, width = 6, height = 4, dpi = 300) {
  written <- function() file.exists(filename) && isTRUE(file.info(filename)$size > 0)

  try_ggsave <- function() tryCatch({
    ggplot2::ggsave(filename, plot = p, width = width, height = height,
                    dpi = dpi, units = "in", bg = "white")
    written()
  }, error = function(e) {
    cat("__RWB_WARN__: ggsave 失败:", conditionMessage(e), "\n")
    FALSE
  })

  try_device <- function(type = NULL) tryCatch({
    if (is.null(type)) {
      grDevices::png(filename, width = width, height = height, units = "in", res = dpi, bg = "white")
    } else {
      grDevices::png(filename, width = width, height = height, units = "in", res = dpi,
                     bg = "white", type = type)
    }
    print(p)
    grDevices::dev.off()
    written()
  }, error = function(e) {
    if (grDevices::dev.cur() > 1L) try(grDevices::dev.off(), silent = TRUE)
    cat("__RWB_WARN__: 图形设备保存失败:", conditionMessage(e), "\n")
    FALSE
  })

  ok <- try_ggsave()
  # 回退 1：显式 cairo 设备（对中文渲染最友好）
  if (!ok) ok <- try_device("cairo")
  # 回退 2：设备默认参数
  if (!ok) ok <- try_device(NULL)
  if (!ok) stop("无法写出图表文件: ", filename, "（图形设备与 ggsave 均失败）")
  cat(paste0("PLOT_SAVED:", filename, "\n"))
}
