import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { ColumnInfo, DatasetInfo } from '../shared/types'

/** 解析结果 */
export interface ParseResult {
  headers: string[]
  rows: Record<string, unknown>[]
  columnInfo: ColumnInfo[]
  dataset: DatasetInfo
}

/** 解析 CSV 文本 */
export function parseCSV(text: string, fileName?: string): ParseResult {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true
  })

  const headers = result.meta.fields || []
  const rows = result.data as Record<string, unknown>[]
  const columnInfo = analyzeColumns(headers, rows)

  return {
    headers,
    rows,
    columnInfo,
    dataset: {
      name: fileName || 'data.csv',
      columns: columnInfo,
      rowCount: rows.length
    }
  }
}

/** 解析 Excel 文件（Buffer） */
export function parseExcel(buffer: ArrayBuffer, fileName?: string): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]

  const data = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  const headers = data.length > 0 ? Object.keys(data[0]) : []
  const rows = data as Record<string, unknown>[]
  const columnInfo = analyzeColumns(headers, rows)

  return {
    headers,
    rows,
    columnInfo,
    dataset: {
      name: fileName || sheetName,
      columns: columnInfo,
      rowCount: rows.length
    }
  }
}

/** 分析列的类型和缺失值 */
function analyzeColumns(
  headers: string[],
  rows: Record<string, unknown>[]
): ColumnInfo[] {
  return headers.map((name) => {
    let numericCount = 0
    let stringCount = 0
    let missingCount = 0

    for (const row of rows) {
      const val = row[name]
      if (val === null || val === undefined || val === '') {
        missingCount++
      } else if (typeof val === 'number' || !isNaN(Number(val))) {
        numericCount++
      } else {
        stringCount++
      }
    }

    let type: ColumnInfo['type'] = 'unknown'
    const nonMissing = rows.length - missingCount
    if (nonMissing > 0) {
      if (numericCount / nonMissing > 0.8) type = 'numeric'
      else if (stringCount / nonMissing > 0.5) type = 'string'
    }

    return {
      name,
      type,
      missing: missingCount,
      total: rows.length
    }
  })
}

/** 将数据集转换为 CSV 字符串（用于传给 R） */
export function datasetToCSV(
  headers: string[],
  rows: Record<string, unknown>[]
): string {
  return Papa.unparse(rows, { columns: headers })
}

/** 生成描述性统计的 R 代码 */
export function generateDescriptiveRCode(
  numericColumns: string[],
  dataFileName: string
): string {
  const cols = numericColumns.map((c) => `"${c}"`).join(', ')
  return `
data <- read.csv("${dataFileName}", stringsAsFactors = FALSE)
cols <- c(${cols})
desc_stats <- data.frame(
  Variable = cols,
  N = sapply(cols, function(x) sum(!is.na(data[[x]]))),
  Mean = sapply(cols, function(x) mean(as.numeric(data[[x]]), na.rm = TRUE)),
  SD = sapply(cols, function(x) sd(as.numeric(data[[x]]), na.rm = TRUE)),
  Min = sapply(cols, function(x) min(as.numeric(data[[x]]), na.rm = TRUE)),
  Max = sapply(cols, function(x) max(as.numeric(data[[x]]), na.rm = TRUE)),
  Median = sapply(cols, function(x) median(as.numeric(data[[x]]), na.rm = TRUE))
)
print(desc_stats)
`
}

/** 生成 t 检验 R 代码 */
export function generateTTestRCode(
  dependentVar: string,
  groupingVar: string,
  dataFileName: string,
  paired: boolean = false
): string {
  if (paired) {
    return `
data <- read.csv("${dataFileName}", stringsAsFactors = FALSE)
result <- t.test(data[[${dependentVar}]], paired = TRUE)
print(result)
`
  }
  return `
data <- read.csv("${dataFileName}", stringsAsFactors = FALSE)
groups <- unique(data[[${groupingVar}]])
g1 <- data[data[[${groupingVar}]] == groups[1], ${dependentVar}]
g2 <- data[data[[${groupingVar}]] == groups[2], ${dependentVar}]
result <- t.test(g1, g2)
print(result)
cat("\\n--- 分组描述统计 ---\\n")
cat("组1 (", groups[1], "): n=", length(g1), ", M=", round(mean(g1), 3), ", SD=", round(sd(g1), 3), "\\n")
cat("组2 (", groups[2], "): n=", length(g2), ", M=", round(mean(g2), 3), ", SD=", round(sd(g2), 3), "\\n")
`
}
