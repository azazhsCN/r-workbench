/**
 * 分析报告导出服务
 * 生成可直接粘贴到论文的结果章节
 */

/** 分析记录 */
export interface AnalysisRecord {
  id: string
  method: string
  methodName: string
  variables: string[]
  groupVar?: string
  output: string
  timestamp: number
}

/** 生成 HTML 报告 */
export function generateHTMLReport(records: AnalysisRecord[]): string {
  const now = new Date()
  const dateStr = now.toLocaleDateString('zh-CN')

  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>数据分析报告 - R Workbench</title>
  <style>
    body { font-family: "SimSun", "宋体", serif; font-size: 12pt; line-height: 1.8; max-width: 210mm; margin: 20mm auto; padding: 0 20px; }
    h1 { font-size: 18pt; text-align: center; margin-bottom: 24pt; }
    h2 { font-size: 14pt; margin-top: 18pt; margin-bottom: 6pt; border-bottom: 1px solid #ccc; padding-bottom: 4pt; }
    h3 { font-size: 12pt; margin-top: 12pt; margin-bottom: 4pt; }
    .meta { text-align: center; color: #666; font-size: 10pt; margin-bottom: 36pt; }
    pre { background: #f5f5f5; padding: 12px; border-radius: 4px; font-size: 10pt; white-space: pre-wrap; font-family: "SimSun", "宋体", monospace; }
    table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
    th, td { border: 1px solid #999; padding: 4pt 8pt; text-align: left; font-size: 11pt; }
    th { background: #f0f0f0; font-weight: bold; }
    .note { font-size: 10pt; color: #666; margin-top: 4pt; }
  </style>
</head>
<body>
  <h1>数据分析报告</h1>
  <div class="meta">
    <p>生成日期: ${dateStr}</p>
    <p>由 R Workbench 自动生成</p>
  </div>
`

  records.forEach((record, index) => {
    html += `
  <h2>分析 ${index + 1}: ${record.methodName}</h2>
  <h3>变量</h3>
  <p>${record.variables.join('、')}${record.groupVar ? ` (分组: ${record.groupVar})` : ''}</p>
  <h3>分析结果</h3>
  <pre>${escapeHTML(record.output)}</pre>
`
  })

  html += `
  <div class="meta" style="margin-top: 48pt;">
    <p>— 报告结束 —</p>
  </div>
</body>
</html>`

  return html
}

/** 生成纯文本报告（用于粘贴到论文） */
export function generateTextReport(records: AnalysisRecord[]): string {
  let text = '数据分析报告\n'
  text += `生成日期: ${new Date().toLocaleDateString('zh-CN')}\n`
  text += `${'='.repeat(50)}\n\n`

  records.forEach((record, index) => {
    text += `${index + 1}. ${record.methodName}\n`
    text += `变量: ${record.variables.join('、')}`
    if (record.groupVar) text += ` (分组: ${record.groupVar})`
    text += '\n\n'
    text += record.output + '\n\n'
    text += '-'.repeat(40) + '\n\n'
  })

  return text
}

/** 生成 APA 格式统计结果模板 */
export function generateAPATemplate(
  method: string,
  params: Record<string, string | number>
): string {
  switch (method) {
    case 'ttest_independent':
      return `独立样本 t 检验结果: t(${params.df}) = ${params.t}, p = ${params.p}. ${Number(params.p) < 0.05 ? '两组之间存在显著差异' : '两组之间不存在显著差异'}.`

    case 'correlation':
      return `相关分析结果: r = ${params.r}, p = ${params.p}, N = ${params.n}. ${Number(params.p) < 0.05 ? '两变量之间存在显著相关' : '两变量之间不存在显著相关'}.`

    case 'regression':
      return `回归分析结果: R² = ${params.r2}, F(${params.df1}, ${params.df2}) = ${params.f}, p = ${params.p}.`

    case 'reliability':
      return `信度分析结果: Cronbach's α = ${params.alpha}. ` +
        (Number(params.alpha) >= 0.7
          ? '量表信度良好'
          : '量表信度有待提高')

    default:
      return ''
  }
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
