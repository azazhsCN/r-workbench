/**
 * AI 结果解读服务
 * 将统计分析结果发送给 LLM，生成符合学术论文风格的文字解读
 */

import { aiService } from './aiService'
import type { ParsedAnalysis } from './resultParser'

/** 生成解读 Prompt */
function buildInterpretPrompt(analysis: ParsedAnalysis): string {
  const tableText = analysis.tables
    .map((t) => {
      const header = t.headers.join('\t')
      const rows = t.rows.map((r) => r.join('\t')).join('\n')
      return `${t.title}\n${header}\n${rows}\n${t.note || ''}`
    })
    .join('\n\n')

  const kvText = Object.entries(analysis.keyValues)
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ')

  return `你是一位学术论文写作专家。请根据以下统计分析结果，撰写一段符合中文学术期刊风格的结果解读文字。

要求：
1. 使用第三人称、过去时态（如"结果显示"、"数据分析表明"）
2. 按照 APA 格式报告统计量（如 t(28) = 2.45, p = 0.021）
3. 先报告统计结果，再给出结论性解读
4. 如果 p < 0.05，明确指出差异/关联"显著"；如果 p ≥ 0.05，指出"不显著"
5. 语言简洁专业，适合直接粘贴到毕业论文的"结果"章节
6. 不要添加主观臆测，只基于数据说话
7. 输出纯文本，不要 Markdown 格式

分析类型：${analysis.type}

关键数值：${kvText}

三线表数据：
${tableText}

原始 R 输出：
${analysis.rawOutput.substring(0, 2000)}`
}

/** 调用 AI 生成解读 */
export async function generateInterpretation(analysis: ParsedAnalysis): Promise<string> {
  if (!aiService.isConfigured()) {
    return ''
  }

  const prompt = buildInterpretPrompt(analysis)

  try {
    const response = await aiService.chat([
      { role: 'user', content: prompt }
    ])

    if (response.error) {
      return ''
    }

    return response.content || ''
  } catch {
    return ''
  }
}
