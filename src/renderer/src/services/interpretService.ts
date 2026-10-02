/**
 * AI 结果解读服务
 * 将统计分析结果发送给 LLM，生成符合学术论文风格的文字解读
 *
 * v0.2.6：Prompt 改为语言感知。旧实现把"撰写一段符合**中文**学术期刊风格的
 * 结果解读"硬编码在 Prompt 里，英文界面下用户提问英文、AI 解读卡片仍输出中文。
 */

import i18n from '../i18n'
import { aiService } from './aiService'
import type { ParsedAnalysis } from './resultParser'

/** 已知分析方法 id（与 resultParser.detectAnalysisType 的返回值对齐） */
const KNOWN_METHODS = new Set([
  'descriptive',
  'ttest_independent',
  'ttest_paired',
  'ttest_one',
  'anova',
  'chi_square',
  'correlation',
  'regression',
  'reliability',
  'normality',
  'nonparametric',
  'frequency',
  'summary'
])

/** 取当前语言的文案 */
function tr(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, options))
}

/** 分析方法显示名（复用向导页已有的 wizard.method.* 文案） */
function methodLabel(type: string): string {
  return KNOWN_METHODS.has(type) ? tr(`wizard.method.${type}`) : type
}

/** 生成解读 Prompt */
export function buildInterpretPrompt(analysis: ParsedAnalysis): string {
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

  // 假设检验诊断（正态性、方差齐性、效应量等）——v0.2.6 由解析器带内提供，
  // 送进 Prompt 能让解读明确写出"是否满足 t 检验前提"这类关键判断。
  const diagnosticsText =
    analysis.diagnostics && analysis.diagnostics.length > 0
      ? analysis.diagnostics.map((d) => `${d.label}: ${d.value}`).join('\n')
      : tr('ai.interpretPrompt.none')

  return tr('ai.interpretPrompt', {
    method: methodLabel(analysis.type),
    keyValues: kvText || tr('ai.interpretPrompt.none'),
    diagnostics: diagnosticsText,
    tables: tableText || tr('ai.interpretPrompt.none'),
    rawOutput: analysis.rawOutput.substring(0, 2000)
  })
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
