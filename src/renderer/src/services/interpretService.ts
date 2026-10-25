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

/** 取当前语言的文案（i18n 可能在初始化完成前被调用，故统一 String() 兜底） */
function tr(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, options))
}

/**
 * 分析方法显示名（复用向导页已有的 wizard.method.* 文案）。
 *
 * ⚠️ 这里**不能**用「先查白名单再翻译」的写法。旧实现维护了一个 `KNOWN_METHODS`
 * 集合，里面的 id 与 `detectAnalysisType` 的返回值并不一致：
 *   - 集合里写 `chi_square`，实际返回 `chisquare`
 *   - 集合里写 `summary`，实际返回 `summary_by`
 *   - 后来新增的 efa / cfa / cvi / harman 则完全没进集合
 * 后果是这些方法的 AI 解读 Prompt 里「分析类型」字段直接显示英文 id，
 * 而不是本地化名称——用户看到的 Prompt 与界面语言不一致。
 *
 * 现在改为**直接按 `wizard.method.<type>` 取文案并用 `defaultValue` 兜底**：
 * 有文案就本地化，没有就退回原始 id。这样新增方法只要补语言包即可，
 * 不需要再同步维护第二份名单（名单与真实返回值漂移正是本类缺陷的根源）。
 */
function methodLabel(type: string): string {
  return tr(`wizard.method.${type}`, { defaultValue: type })
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
