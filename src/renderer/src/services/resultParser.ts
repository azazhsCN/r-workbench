/**
 * R 输出解析器
 * 将 R 的文本输出解析为结构化数据，用于三线表展示
 */

/** 解析后的分析结果 */
export interface ParsedAnalysis {
  /** 分析类型 */
  type: string
  /** 三线表数据 */
  tables: TableData[]
  /** 关键数值（用于 AI 解读） */
  keyValues: Record<string, string | number>
  /** 原始文本输出 */
  rawOutput: string
}

export interface TableData {
  title: string
  headers: string[]
  rows: (string | number)[][]
  note?: string
}

/** 从 R 输出中提取数值 */
function extractNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern)
  if (!match) return null
  const val = parseFloat(match[1])
  return isNaN(val) ? null : val
}

/** 解析 R 输出 */
export function parseROutput(output: string): ParsedAnalysis {
  const type = detectAnalysisType(output)
  const tables: TableData[] = []
  const keyValues: Record<string, string | number> = {}

  switch (type) {
    case 'descriptive':
      parseDescriptive(output, tables, keyValues)
      break
    case 'ttest':
      parseTTest(output, tables, keyValues)
      break
    case 'correlation':
      parseCorrelation(output, tables, keyValues)
      break
    case 'regression':
      parseRegression(output, tables, keyValues)
      break
    case 'reliability':
      parseReliability(output, tables, keyValues)
      break
    case 'anova':
      parseAnova(output, tables, keyValues)
      break
    case 'chisquare':
      parseChiSquare(output, tables, keyValues)
      break
    default:
      // 未知类型，只返回原始文本
      break
  }

  return { type, tables, keyValues, rawOutput: output }
}

function detectAnalysisType(output: string): string {
  if (output.includes('描述性统计') || output.includes(' N=') || output.includes(' N=')) return 'descriptive'
  if (output.includes('t 检验') || output.includes('t = ') || output.includes('t=')) return 'ttest'
  if (output.includes('相关分析') || output.includes('r = ') || output.includes('r=')) return 'correlation'
  if (output.includes('线性回归') || output.includes('R²') || output.includes('R2')) return 'regression'
  if (output.includes("Cronbach") || output.includes('信度分析')) return 'reliability'
  if (output.includes('方差分析') || output.includes('aov')) return 'anova'
  if (output.includes('卡方') || output.includes('chisq')) return 'chisquare'
  return 'unknown'
}

/** 解析描述性统计 */
function parseDescriptive(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const lines = output.split('\n').filter((l) => l.trim() && !l.startsWith('==='))
  const rows: (string | number)[][] = []

  for (const line of lines) {
    // 格式: "变量名  N=100  M=3.500  SD=1.200  Min=1.000  Max=5.000  Med=3.500"
    const match = line.match(
      /(.+?)\s+N=(\d+)\s+M=([\d.]+)\s+SD=([\d.]+)\s+Min=([\d.]+)\s+Max=([\d.]+)\s+Med=([\d.]+)/
    )
    if (match) {
      rows.push([
        match[1].trim(),
        parseInt(match[2]),
        parseFloat(match[3]),
        parseFloat(match[4]),
        parseFloat(match[5]),
        parseFloat(match[6]),
        parseFloat(match[7])
      ])
    } else {
      // 无数值数据的行
      const noDataMatch = line.match(/(.+?)\s+N=0/)
      if (noDataMatch) {
        rows.push([noDataMatch[1].trim(), 0, '—', '—', '—', '—', '—'])
      }
    }
  }

  if (rows.length > 0) {
    tables.push({
      title: '表1  描述性统计结果',
      headers: ['变量', 'N', 'M', 'SD', 'Min', 'Max', 'Median'],
      rows,
      note: '注：M = 均值，SD = 标准差，Min = 最小值，Max = 最大值，Median = 中位数。'
    })
    kv['变量数'] = rows.length
    kv['样本量'] = typeof rows[0][1] === 'number' ? rows[0][1] : 0
  }
}

/** 解析 t 检验 */
function parseTTest(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const tVal = extractNumber(output, /t\s*=\s*([\d.-]+)/)
  const df = extractNumber(output, /df\s*=\s*([\d.-]+)/)
  const pVal = extractNumber(output, /p\s*=\s*([\d.]+)/)
  const ciMatch = output.match(/95%\s*CI:\s*\[([\d.-]+),\s*([\d.-]+)\]/)
  const meanDiff = extractNumber(output, /均值差:\s*([\d.-]+)/)

  if (tVal !== null) {
    const conclusion = output.match(/结论:\s*(.+)/)?.[1] || ''

    // 提取分组描述统计
    const groupRows: (string | number)[][] = []
    const groupPattern = /组[12]?\s*\(([^)]+)\):\s*N=(\d+),\s*M=([\d.]+),\s*SD=([\d.]+)/g
    let groupMatch
    while ((groupMatch = groupPattern.exec(output)) !== null) {
      groupRows.push([
        groupMatch[1],
        parseInt(groupMatch[2]),
        parseFloat(groupMatch[3]),
        parseFloat(groupMatch[4])
      ])
    }

    if (groupRows.length > 0) {
      tables.push({
        title: '表1  分组描述统计',
        headers: ['组别', 'N', 'M', 'SD'],
        rows: groupRows,
        note: '注：M = 均值，SD = 标准差。'
      })
    }

    tables.push({
      title: `表${tables.length + 1}  独立样本 t 检验结果`,
      headers: ['t', 'df', 'p', '均值差', '95% CI 下限', '95% CI 上限'],
      rows: [[
        tVal,
        df || '—',
        pVal || '—',
        meanDiff || '—',
        ciMatch ? parseFloat(ciMatch[1]) : '—',
        ciMatch ? parseFloat(ciMatch[2]) : '—'
      ]],
      note: `注：${pVal !== null && pVal < 0.05 ? 'p < 0.05，差异显著。' : 'p ≥ 0.05，差异不显著。'}${conclusion ? ' ' + conclusion : ''}`
    })

    kv['t'] = tVal
    kv['df'] = df || 0
    kv['p'] = pVal || 1
    kv['结论'] = conclusion
  }
}

/** 解析相关分析 */
function parseCorrelation(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const rVal = extractNumber(output, /r\s*=\s*([\d.-]+)/)
  const pVal = extractNumber(output, /p\s*=\s*([\d.]+)/)
  const nVal = extractNumber(output, /N\s*=\s*(\d+)/)
  const conclusion = output.match(/结论:\s*(.+)/)?.[1] || ''

  if (rVal !== null) {
    tables.push({
      title: '表1  相关分析结果',
      headers: ['r', 'p', 'N'],
      rows: [[rVal, pVal || '—', nVal || '—']],
      note: `注：r = Pearson 相关系数。${pVal !== null && pVal < 0.05 ? 'p < 0.05，相关显著。' : 'p ≥ 0.05，相关不显著。'}${conclusion ? ' ' + conclusion : ''}`
    })

    kv['r'] = rVal
    kv['p'] = pVal || 1
    kv['N'] = nVal || 0
    kv['结论'] = conclusion
  }
}

/** 解析回归分析 */
function parseRegression(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const r2 = extractNumber(output, /R²\s*=\s*([\d.]+)/) || extractNumber(output, /R2\s*=\s*([\d.]+)/)
  const adjR2 = extractNumber(output, /调整R²\s*=\s*([\d.]+)/) || extractNumber(output, /调整R2\s*=\s*([\d.]+)/)
  const fVal = extractNumber(output, /F\s*=\s*([\d.]+)/)
  const pVal = extractNumber(output, /p\s*=\s*([\d.]+)/)

  // 解析回归系数表
  const coefRows: (string | number)[][] = []
  const coefPattern = /^(\S+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*$/gm
  let coefMatch
  while ((coefMatch = coefPattern.exec(output)) !== null) {
    coefRows.push([
      coefMatch[1],
      parseFloat(coefMatch[2]),
      parseFloat(coefMatch[3]),
      parseFloat(coefMatch[4]),
      parseFloat(coefMatch[5])
    ])
  }

  if (r2 !== null) {
    tables.push({
      title: '表1  回归模型摘要',
      headers: ['R²', '调整R²', 'F', 'p'],
      rows: [[r2, adjR2 || '—', fVal || '—', pVal || '—']],
      note: '注：R² = 决定系数。'
    })

    if (coefRows.length > 0) {
      tables.push({
        title: '表2  回归系数',
        headers: ['变量', 'B', 'SE', 't', 'p'],
        rows: coefRows,
        note: '注：B = 非标准化回归系数，SE = 标准误。'
      })
    }

    kv['R2'] = r2
    kv['adjR2'] = adjR2 || r2
    kv['F'] = fVal || 0
    kv['p'] = pVal || 1
  }
}

/** 解析信度分析 */
function parseReliability(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const alpha = extractNumber(output, /Cronbach's α\s*=\s*([\d.]+)/) || extractNumber(output, /alpha\s*=\s*([\d.]+)/)
  const itemCount = extractNumber(output, /项目数:\s*(\d+)/)
  const n = extractNumber(output, /有效样本:\s*(\d+)/)
  const conclusion = output.match(/(信度.+)/)?.[1] || ''

  if (alpha !== null) {
    tables.push({
      title: "表1  信度分析结果 (Cronbach's α)",
      headers: ['Cronbach\'s α', '项目数', '有效样本'],
      rows: [[alpha, itemCount || '—', n || '—']],
      note: `注：α ≥ 0.7 为可接受水平。${conclusion}`
    })

    kv['alpha'] = alpha
    kv['项目数'] = itemCount || 0
    kv['结论'] = conclusion
  }
}

/** 解析方差分析 */
function parseAnova(output: string, tables: TableData[], kv: Record<string, string | number>) {
  // 提取 ANOVA 表
  const fVal = extractNumber(output, /F value[^\d]*([\d.]+)/) || extractNumber(output, /F\s*=\s*([\d.]+)/)
  const pVal = extractNumber(output, /Pr\(>F\)[^\d]*([\d.e-]+)/) || extractNumber(output, /p\s*=\s*([\d.]+)/)

  // 提取分组统计
  const groupRows: (string | number)[][] = []
  const groupPattern = /组\s*(\S+):\s*N=(\d+),\s*M=([\d.]+),\s*SD=([\d.]+)/g
  let match
  while ((match = groupPattern.exec(output)) !== null) {
    groupRows.push([match[1], parseInt(match[2]), parseFloat(match[3]), parseFloat(match[4])])
  }

  if (groupRows.length > 0) {
    tables.push({
      title: '表1  分组描述统计',
      headers: ['组别', 'N', 'M', 'SD'],
      rows: groupRows,
      note: '注：M = 均值，SD = 标准差。'
    })
  }

  if (fVal !== null) {
    tables.push({
      title: `表${tables.length + 1}  单因素方差分析结果`,
      headers: ['F', 'p'],
      rows: [[fVal, pVal || '—']],
      note: pVal !== null && pVal < 0.05
        ? '注：p < 0.05，组间差异显著。'
        : '注：p ≥ 0.05，组间差异不显著。'
    })

    kv['F'] = fVal
    kv['p'] = pVal || 1
  }
}

/** 解析卡方检验 */
function parseChiSquare(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const chi2 = extractNumber(output, /X-squared\s*=\s*([\d.]+)/) || extractNumber(output, /chi2\s*=\s*([\d.]+)/)
  const df = extractNumber(output, /df\s*=\s*(\d+)/)
  const pVal = extractNumber(output, /p-value\s*=\s*([\d.]+)/) || extractNumber(output, /p\s*=\s*([\d.]+)/)
  const conclusion = output.match(/结论:\s*(.+)/)?.[1] || ''

  if (chi2 !== null) {
    tables.push({
      title: '表1  卡方检验结果',
      headers: ['χ²', 'df', 'p'],
      rows: [[chi2, df || '—', pVal || '—']],
      note: `注：${pVal !== null && pVal < 0.05 ? 'p < 0.05，关联显著。' : 'p ≥ 0.05，关联不显著。'}${conclusion ? ' ' + conclusion : ''}`
    })

    kv['chi2'] = chi2
    kv['df'] = df || 0
    kv['p'] = pVal || 1
    kv['结论'] = conclusion
  }
}
