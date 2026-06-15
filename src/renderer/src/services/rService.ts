import type { RExecuteResult } from '../../shared/types'

/** R 环境状态 */
export interface RStatus {
  found: boolean
  path: string
  version: string
}

/** 分析结果 */
export interface AnalysisResult {
  success: boolean
  output: string
  tables: ParsedTable[]
  plots: string[] // base64 encoded images
  errors: string[]
}

/** 解析后的表格 */
export interface ParsedTable {
  title: string
  headers: string[]
  rows: string[][]
}

/**
 * R 执行服务
 * 提供 R 环境检测、代码执行、结果解析功能
 */
export class RService {
  private static instance: RStatus | null = null

  /** 检测 R 环境 */
  static async detect(): Promise<RStatus> {
    if (!window.api) {
      return { found: false, path: '', version: '' }
    }
    const result = await window.api.r.detect()
    RService.instance = result
    return result
  }

  /** 获取缓存的 R 状态 */
  static getStatus(): RStatus | null {
    return RService.instance
  }

  /** 执行 R 代码并返回结构化结果 */
  static async execute(code: string): Promise<AnalysisResult> {
    if (!window.api) {
      return {
        success: false,
        output: '',
        tables: [],
        plots: [],
        errors: ['API 未就绪（非 Electron 环境）']
      }
    }

    // 包装 R 代码：添加 JSON 结果输出
    const wrappedCode = RService.wrapCode(code)

    const result: RExecuteResult = await window.api.r.execute(wrappedCode)

    if (!result.success) {
      return {
        success: false,
        output: result.stdout || '',
        tables: [],
        plots: [],
        errors: [result.stderr || '执行失败']
      }
    }

    return RService.parseOutput(result)
  }

  /** 包装 R 代码，添加结构化输出 */
  private static wrapCode(code: string): string {
    return `
# 结果收集器
.rwb_results <- list(tables = list(), plots = list(), messages = list())

.rwb_capture <- function(expr, title = "") {
  result <- tryCatch({
    output <- capture.output(expr)
    list(success = TRUE, output = paste(output, collapse = "\\n"))
  }, error = function(e) {
    list(success = FALSE, output = conditionMessage(e))
  })
  return(result)
}

# 执行用户代码
tryCatch({
  ${code}
}, error = function(e) {
  cat("ERROR:", conditionMessage(e), "\\n")
})

cat("__RWORKBENCH_END__\\n")
`
  }

  /** 解析 R 输出 */
  private static parseOutput(result: RExecuteResult): AnalysisResult {
    const output = result.stdout || ''
    const errors: string[] = []

    // 提取错误信息
    const errorMatch = output.match(/ERROR:(.*)/g)
    if (errorMatch) {
      errors.push(...errorMatch.map((e) => e.replace('ERROR:', '').trim()))
    }

    // 尝试解析 JSON 结果
    const tables: ParsedTable[] = []
    const plots: string[] = []

    return {
      success: errors.length === 0,
      output: output.replace(/__RWORKBENCH_END__\n?$/, '').trim(),
      tables,
      plots,
      errors
    }
  }

  /** 生成描述性统计 R 代码 */
  static descriptiveCode(vars: string[], dataFile: string): string {
    const varList = vars.map((v) => `"${v}"`).join(', ')
    return `
data <- read.csv("${dataFile}", stringsAsFactors = FALSE)
vars <- c(${varList})
for(v in vars) {
  x <- as.numeric(data[[v]])
  cat(sprintf("%-20s N=%-5d M=%.3f SD=%.3f Min=%.3f Max=%.3f Med=%.3f\\n",
    v, sum(!is.na(x)), mean(x, na.rm=TRUE), sd(x, na.rm=TRUE),
    min(x, na.rm=TRUE), max(x, na.rm=TRUE), median(x, na.rm=TRUE)))
}
`
  }

  /** 生成独立样本 t 检验 R 代码 */
  static tTestIndependentCode(
    dv: string,
    groupVar: string,
    dataFile: string
  ): string {
    return `
data <- read.csv("${dataFile}", stringsAsFactors = FALSE)
groups <- unique(data[["${groupVar}"]])
if(length(groups) != 2) stop("分组变量必须恰好有2个水平")

g1_data <- data[data[["${groupVar}"]] == groups[1], "${dv}"]
g2_data <- data[data[["${groupVar}"]] == groups[2], "${dv}"]

g1 <- as.numeric(g1_data[!is.na(g1_data)])
g2 <- as.numeric(g2_data[!is.na(g2_data)])

cat("=== 独立样本 t 检验 ===\\n")
cat("因变量: ${dv}\\n")
cat("分组变量: ${groupVar}\\n\\n")

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

  /** 生成相关分析 R 代码 */
  static correlationCode(
    var1: string,
    var2: string,
    method: 'pearson' | 'spearman',
    dataFile: string
  ): string {
    return `
data <- read.csv("${dataFile}", stringsAsFactors = FALSE)
x <- as.numeric(data[["${var1}"]])
y <- as.numeric(data[["${var2}"]])

cat("=== 相关分析 ===\\n")
cat("变量1: ${var1}\\n")
cat("变量2: ${var2}\\n")
cat("方法: ${method}\\n\\n")

result <- cor.test(x, y, method = "${method}")
cat(sprintf("r = %.4f\\n", result$estimate))
cat(sprintf("p = %.4f\\n", result$p.value))
cat(sprintf("N = %d\\n\\n", sum(complete.cases(x, y))))

if(result$p.value < 0.01) {
  cat("结论: 两变量之间存在极显著相关 (p < 0.01)\\n")
} else if(result$p.value < 0.05) {
  cat("结论: 两变量之间存在显著相关 (p < 0.05)\\n")
} else {
  cat("结论: 两变量之间不存在显著相关 (p >= 0.05)\\n")
}

# 相关强度解读
r_abs <- abs(result$estimate)
strength <- ifelse(r_abs >= 0.7, "强", ifelse(r_abs >= 0.4, "中等", ifelse(r_abs >= 0.2, "弱", "极弱")))
direction <- ifelse(result$estimate > 0, "正", "负")
cat(sprintf("\\n相关强度: %s%s相关\\n", strength, direction))
`
  }

  /** 生成线性回归 R 代码 */
  static regressionCode(
    dv: string,
    ivs: string[],
    dataFile: string
  ): string {
    const formula = `"${dv}" ~ ${ivs.map((v) => `"${v}"`).join(' + ')}`
    return `
data <- read.csv("${dataFile}", stringsAsFactors = FALSE)

cat("=== 线性回归分析 ===\\n")
cat("因变量: ${dv}\\n")
cat("自变量: ${ivs.join(', ')}\\n\\n")

model <- lm(${formula}, data = data)
summary_output <- summary(model)

cat("模型摘要:\\n")
cat(sprintf("R² = %.4f\\n", summary_output$r.squared))
cat(sprintf("调整R² = %.4f\\n", summary_output$adj.r.squared))
cat(sprintf("F = %.4f, p = %.4f\\n\\n",
  summary_output$fstatistic[1],
  pf(summary_output$fstatistic[1],
     summary_output$fstatistic[2],
     summary_output$fstatistic[3],
     lower.tail = FALSE)))

cat("回归系数:\\n")
coefs <- summary_output$coefficients
cat(sprintf("%-15s %10s %10s %10s %10s\\n", "变量", "B", "SE", "t", "p"))
for(i in 1:nrow(coefs)) {
  cat(sprintf("%-15s %10.4f %10.4f %10.4f %10.4f\\n",
    rownames(coefs)[i], coefs[i,1], coefs[i,2], coefs[i,3], coefs[i,4]))
}
`
  }

  /** 生成信度分析 R 代码 */
  static reliabilityCode(items: string[], dataFile: string): string {
    const itemList = items.map((v) => `"${v}"`).join(', ')
    return `
data <- read.csv("${dataFile}", stringsAsFactors = FALSE)
items <- c(${itemList})
item_data <- data[, items]

cat("=== 信度分析 (Cronbach's α) ===\\n")
cat("分析项目:", paste(items, collapse = ", "), "\\n\\n")

# 计算每个项目的描述统计
cat("项目描述统计:\\n")
cat(sprintf("%-20s %8s %8s %8s\\n", "项目", "N", "M", "SD"))
for(item in items) {
  x <- as.numeric(item_data[[item]])
  cat(sprintf("%-20s %8d %8.3f %8.3f\\n", item, sum(!is.na(x)), mean(x, na.rm=TRUE), sd(x, na.rm=TRUE)))
}

# Cronbach's α
k <- ncol(item_data)
item_vars <- apply(item_data, 2, var, na.rm = TRUE)
total_var <- var(rowSums(item_data, na.rm = TRUE), na.rm = TRUE)
alpha <- (k / (k - 1)) * (1 - sum(item_vars) / total_var)

cat(sprintf("\\nCronbach's α = %.4f\\n", alpha))
cat(sprintf("项目数: %d\\n", k))
cat(sprintf("有效样本: %d\\n\\n", sum(complete.cases(item_data))))

if(alpha >= 0.9) {
  cat("信度非常好 (α ≥ 0.9)\\n")
} else if(alpha >= 0.8) {
  cat("信度好 (α ≥ 0.8)\\n")
} else if(alpha >= 0.7) {
  cat("信度可接受 (α ≥ 0.7)\\n")
} else if(alpha >= 0.6) {
  cat("信度尚可 (α ≥ 0.6)\\n")
} else {
  cat("信度不佳 (α < 0.6)，建议修订量表\\n")
}
`
  }
}
