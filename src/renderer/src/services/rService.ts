/**
 * R 执行服务
 * 提供 R 环境检测、代码执行、结果解析功能
 *
 * - rEscape(): 转义变量名防注入
 * - 数据通过 IPC dataCsv 参数传递，不嵌入代码
 * - 代码不额外包装，主进程统一处理
 */

import type { RExecuteResult, RStatus } from '../../shared/types'

/** 分析结果 */
export interface AnalysisResult {
  success: boolean
  output: string
  tables: ParsedTable[]
  plots: string[]
  errors: string[]
}

export interface ParsedTable {
  title: string
  headers: string[]
  rows: string[][]
}

/** 统一的 read.csv 头 */
const READ_CSV = 'read.csv(dataFile, stringsAsFactors = FALSE, check.names = FALSE, fileEncoding = "UTF-8-BOM")'

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

export class RService {
  private static instance: RStatus | null = null

  static async detect(): Promise<RStatus> {
    if (!window.api) return { found: false, path: '', version: '' }
    const result = await window.api.r.detect()
    RService.instance = result
    return result
  }

  static getStatus(): RStatus | null {
    return RService.instance
  }

  static async execute(code: string, dataCsv?: string): Promise<AnalysisResult> {
    if (!window.api) {
      return { success: false, output: '', tables: [], plots: [], errors: ['API 未就绪'] }
    }
    const result: RExecuteResult = await window.api.r.execute(code, dataCsv)
    if (!result.success) {
      return {
        success: false,
        output: result.output || '',
        tables: [],
        plots: [],
        errors: result.errors || [result.stderr || '执行失败']
      }
    }
    return { success: true, output: result.output || '', tables: [], plots: [], errors: [] }
  }

  /** 描述性统计 */
  static descriptiveCode(vars: string[], dataFile = 'data.csv'): string {
    const varList = vars.map((v) => `"${rEscape(v)}"`).join(', ')
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
vars <- c(${varList})
for(v in vars) {
  x <- suppressWarnings(as.numeric(data[[v]]))
  valid <- x[!is.na(x)]
  if(length(valid) > 0) {
    cat(sprintf("%-50s N=%-5d M=%.3f SD=%.3f Min=%.3f Max=%.3f Med=%.3f\\n",
      substr(v, 1, 50), length(valid), mean(valid), sd(valid),
      min(valid), max(valid), median(valid)))
  } else {
    cat(sprintf("%-50s N=0 (无数值数据)\\n", substr(v, 1, 50)))
  }
}
`
  }

  /** 独立样本 t 检验 */
  static tTestIndependentCode(dv: string, groupVar: string, dataFile = 'data.csv'): string {
    const safeDv = rEscape(dv)
    const safeGroup = rEscape(groupVar)
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
groups <- unique(data[["${safeGroup}"]])
if(length(groups) != 2) stop("分组变量必须恰好有2个水平")
g1 <- suppressWarnings(as.numeric(data[data[["${safeGroup}"]] == groups[1], "${safeDv}"]))
g2 <- suppressWarnings(as.numeric(data[data[["${safeGroup}"]] == groups[2], "${safeDv}"]))
g1 <- g1[!is.na(g1)]
g2 <- g2[!is.na(g2)]
cat("=== 独立样本 t 检验 ===\\n")
cat(sprintf("组1 (%s): N=%d, M=%.4f, SD=%.4f\\n", groups[1], length(g1), mean(g1), sd(g1)))
cat(sprintf("组2 (%s): N=%d, M=%.4f, SD=%.4f\\n\\n", groups[2], length(g2), mean(g2), sd(g2)))
result <- t.test(g1, g2)
cat(sprintf("t = %.4f, df = %.2f, p = %.4f\\n", result$statistic, result$parameter, result$p.value))
cat(sprintf("95%% CI: [%.4f, %.4f]\\n", result$conf.int[1], result$conf.int[2]))
cat(sprintf("均值差: %.4f\\n", result$estimate[1] - result$estimate[2]))
if(result$p.value < 0.05) {
  cat("\\n结论: 两组之间存在显著差异 (p < 0.05)\\n")
} else {
  cat("\\n结论: 两组之间不存在显著差异 (p >= 0.05)\\n")
}
`
  }

  /** 相关分析 */
  static correlationCode(
    var1: string,
    var2: string,
    method: 'pearson' | 'spearman',
    dataFile = 'data.csv'
  ): string {
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
x <- suppressWarnings(as.numeric(data[["${rEscape(var1)}"]]))
y <- suppressWarnings(as.numeric(data[["${rEscape(var2)}"]]))
cat("=== 相关分析 (${method}) ===\\n")
result <- cor.test(x, y, method = "${method}")
cat(sprintf("r = %.4f\\n", result$estimate))
cat(sprintf("p = %.4f\\n", result$p.value))
cat(sprintf("N = %d\\n\\n", sum(complete.cases(x, y))))
if(result$p.value < 0.01) cat("结论: 存在极显著相关 (p < 0.01)\\n")
else if(result$p.value < 0.05) cat("结论: 存在显著相关 (p < 0.05)\\n")
else cat("结论: 不存在显著相关 (p >= 0.05)\\n")
`
  }

  /** 线性回归 */
  static regressionCode(dv: string, ivs: string[], dataFile = 'data.csv'): string {
    const safeDv = rEscape(dv)
    const formula = `"${safeDv}" ~ ${ivs.map((v) => `"${rEscape(v)}"`).join(' + ')}`
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
model <- lm(${formula}, data = data)
s <- summary(model)
cat("=== 线性回归分析 ===\\n")
cat(sprintf("R² = %.4f, 调整R² = %.4f\\n", s$r.squared, s$adj.r.squared))
cat(sprintf("F = %.4f, p = %.4f\\n\\n", s$fstatistic[1],
  pf(s$fstatistic[1], s$fstatistic[2], s$fstatistic[3], lower.tail = FALSE)))
cat("回归系数:\\n")
coefs <- s$coefficients
cat(sprintf("%-15s %10s %10s %10s %10s\\n", "变量", "B", "SE", "t", "p"))
for(i in 1:nrow(coefs)) {
  cat(sprintf("%-15s %10.4f %10.4f %10.4f %10.4f\\n",
    rownames(coefs)[i], coefs[i,1], coefs[i,2], coefs[i,3], coefs[i,4]))
}
`
  }

  /** 信度分析 */
  static reliabilityCode(items: string[], dataFile = 'data.csv'): string {
    const itemList = items.map((v) => `"${rEscape(v)}"`).join(', ')
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
items <- c(${itemList})
item_data <- data[, items]
item_data <- as.data.frame(lapply(item_data, function(x) suppressWarnings(as.numeric(x))))
item_data <- item_data[complete.cases(item_data), ]
k <- ncol(item_data)
item_vars <- apply(item_data, 2, var)
total_var <- var(rowSums(item_data))
alpha <- (k / (k - 1)) * (1 - sum(item_vars) / total_var)
cat("=== 信度分析 (Cronbach's α) ===\\n")
cat(sprintf("项目数: %d, 有效样本: %d\\n", k, nrow(item_data)))
cat(sprintf("Cronbach's α = %.4f\\n\\n", alpha))
if(alpha >= 0.9) cat("信度非常好 (α ≥ 0.9)\\n")
else if(alpha >= 0.8) cat("信度好 (α ≥ 0.8)\\n")
else if(alpha >= 0.7) cat("信度可接受 (α ≥ 0.7)\\n")
else if(alpha >= 0.6) cat("信度尚可 (α ≥ 0.6)\\n")
else cat("信度不佳 (α < 0.6)\\n")
`
  }

  /** 配对样本 t 检验 */
  static tTestPairedCode(var1: string, var2: string, dataFile = 'data.csv'): string {
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
x1 <- suppressWarnings(as.numeric(data[["${rEscape(var1)}"]]))
x2 <- suppressWarnings(as.numeric(data[["${rEscape(var2)}"]]))
cat("=== 配对样本 t 检验 ===\\n")
result <- t.test(x1, x2, paired = TRUE)
cat(sprintf("t = %.4f, df = %.2f, p = %.4f\\n", result$statistic, result$parameter, result$p.value))
cat(sprintf("均值差: %.4f\\n", mean(x1 - x2, na.rm = TRUE)))
cat(sprintf("95%% CI: [%.4f, %.4f]\\n", result$conf.int[1], result$conf.int[2]))
if(result$p.value < 0.05) cat("\\n结论: 两个配对变量之间存在显著差异 (p < 0.05)\\n")
else cat("\\n结论: 两个配对变量之间不存在显著差异 (p >= 0.05)\\n")
`
  }

  /** 卡方检验 */
  static chiSquareCode(var1: string, var2: string, dataFile = 'data.csv'): string {
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
cat("=== 卡方检验 ===\\n")
tbl <- table(data[["${rEscape(var1)}"]], data[["${rEscape(var2)}"]])
cat("列联表:\\n")
print(tbl)
result <- chisq.test(tbl)
print(result)
if(result$p.value < 0.05) cat("\\n结论: 两个变量之间存在显著关联 (p < 0.05)\\n")
else cat("\\n结论: 两个变量之间不存在显著关联 (p >= 0.05)\\n")
`
  }

  /** 单因素方差分析 */
  static anovaCode(dv: string, groupVar: string, dataFile = 'data.csv'): string {
    const safeDv = rEscape(dv)
    const safeGroup = rEscape(groupVar)
    return `
dataFile <- "${rEscape(dataFile)}"
data <- ${READ_CSV}
dv_col <- make.names("${safeDv}")
grp_col <- make.names("${safeGroup}")
if (!dv_col %in% names(data)) { dv_col <- "${safeDv}" }
if (!grp_col %in% names(data)) { grp_col <- "${safeGroup}" }
data[[dv_col]] <- suppressWarnings(as.numeric(data[[dv_col]]))
cat("=== 单因素方差分析 ===\\n")
fml <- as.formula(paste0(dv_col, " ~ factor(", grp_col, ")"))
model <- aov(fml, data = data)
print(summary(model))
groups <- unique(data[[grp_col]])
for(g in groups) {
  x <- data[data[[grp_col]] == g, dv_col]
  cat(sprintf("组 %s: N=%d, M=%.4f, SD=%.4f\\n", g, length(x), mean(x, na.rm=TRUE), sd(x, na.rm=TRUE)))
}
`
  }
}
