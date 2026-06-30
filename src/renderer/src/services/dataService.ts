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

