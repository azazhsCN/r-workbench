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

/**
 * 从原始 R 输出里捡出 `*_WARN` / `*_NOTE` 行（v0.3.5 修复 I-9 的 Prompt 侧兜底）。
 *
 * 为什么 Prompt 层还要再扫一遍：解析器已改用通用收集器把它们收进 `diagnostics`，
 * 但 `buildInterpretPrompt()` 也可能被**手工拼出来的 ParsedAnalysis** 调用
 * （测试、回放历史结果、以及未来任何没走 parseROutput 的调用方）。
 * 一旦 diagnostics 为空而 rawOutput 里其实有警告，旧实现会把 `{diagnostics}`
 * 渲染成「（无）」——那等于用"没有诊断"给 AI 背书，让它在**明明有自我限制
 * 声明**的情况下写出确定口吻的结论。
 *
 * 两处都扫是刻意的冗余：代价是几行正则，收益是"警告不可能在任何一条
 * 调用路径上静默消失"。
 */
export function extractWarningLines(rawOutput: string): string[] {
  const out: string[] = []
  const RE = /^([A-Z][A-Z0-9_]*_(?:WARN|NOTE))\|(.*)$/
  for (const raw of rawOutput.split('\n')) {
    const line = raw.trim()
    const m = RE.exec(line)
    if (!m) continue
    const text = m[2].trim()
    if (text === '') continue
    out.push(`${m[1]}: ${text}`)
  }
  return out
}

/**
 * 按行截取原始输出，但**优先保留关键行**（v0.3.5 修复截断隐患）。
 *
 * 旧实现是 `rawOutput.substring(0, 2000)` —— 按**字符**截断。第三方实测当前
 * 36 个场景最长 1852 字符（尚未触发），但真实多题量表（20 题信度、6 因子 CFA）
 * 会轻易超过 2000，届时被切掉的正是**尾部**的 `CONCL` 结论行与
 * `*_WARN` / `*_NOTE` 限制声明——也就是最不能丢的那部分。
 *
 * 现在的策略：
 *   1. 总是保留所有 `CONCL` / `*_WARN` / `*_NOTE` 行（不看长度）；
 *   2. 其余行按原始顺序填充，直到接近字符预算；
 *   3. 预算内放不下的普通行丢弃，并在结尾标注省略了多少行。
 *
 * 这样即使输出极长，"结论 + 全部限制声明"也一定完整到达 AI。
 */
export function truncateRawOutput(rawOutput: string, budget = 2000): string {
  const lines = rawOutput.split('\n')
  const KEY_RE = /^([A-Z][A-Z0-9_]*_(?:WARN|NOTE))\|/
  const isKey = (line: string): boolean => {
    const t = line.trim()
    return KEY_RE.test(t) || t.startsWith('CONCL|')
  }

  const keyLines = lines.filter(isKey)
  const keyText = keyLines.join('\n')
  // 极端情况：光关键行就超预算。此时牺牲普通行已不够，只能截关键行本身，
  // 但保留首尾（首部通常是横幅，尾部通常是最后一条声明）。
  if (keyText.length > budget) {
    return keyText.slice(0, budget) + '\n…（关键行仍超出预算，已截断）'
  }

  const kept: string[] = []
  let used = keyText.length
  let dropped = 0
  for (const line of lines) {
    if (isKey(line)) continue // 关键行统一放到末尾，避免顺序被打乱后难以阅读
    const cost = line.length + 1
    if (used + cost > budget) {
      dropped++
      continue
    }
    kept.push(line)
    used += cost
  }

  const parts = [...kept]
  if (dropped > 0) parts.push(`…（为控制长度省略 ${dropped} 行普通输出；关键行已全部保留）`)
  if (keyLines.length > 0) parts.push('', ...keyLines)
  return parts.join('\n')
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
  //
  // v0.3.5 / I-9：解析器已用通用收集器接管全部 `*_WARN` / `*_NOTE`，
  // 正常路径下 diagnostics 里就有它们。但为防"没走 parseROutput 的调用方"
  // 把警告丢成「（无）」，这里再做一次兜底扫描。
  const fromDiagnostics =
    analysis.diagnostics && analysis.diagnostics.length > 0
      ? analysis.diagnostics.map((d) => `${d.label}: ${d.value}`).join('\n')
      : ''

  const fromRaw = extractWarningLines(analysis.rawOutput)
  const diagnosticsText =
    fromDiagnostics || (fromRaw.length > 0 ? fromRaw.join('\n') : tr('ai.interpretPrompt.none'))

  const prompt = tr('ai.interpretPrompt', {
    method: methodLabel(analysis.type),
    keyValues: kvText || tr('ai.interpretPrompt.none'),
    diagnostics: diagnosticsText,
    tables: tableText || tr('ai.interpretPrompt.none'),
    rawOutput: truncateRawOutput(analysis.rawOutput)
  })

  // 追加一条硬性要求（v0.3.5 / I-9）。
  //
  // 为什么放在代码里而不是改 i18n 模板：locale 文件由 Lead 统一维护，
  // 本任务无权改动。这里用 `defaultValue` 提供按语言区分的兜底文案，
  // 于是**今天就能生效**；等 `ai.interpretPrompt.requireWarnings`
  // 两个语言包都补上后，会自动切到正式文案，无需再动本文件。
  const requireWarnings = tr('ai.interpretPrompt.requireWarnings', {
    defaultValue: i18n.language && i18n.language.startsWith('zh')
      ? '8. 若「假设检验诊断」中存在软件警告或限制声明（如离群值、缺失值处理方式、' +
        '模型设定边界、方法学局限），必须在解读文字中如实转述，不得省略；' +
        '这些声明不是套话，它们限定了结论的适用范围。'
      : '8. If the "diagnostics" section contains software warnings or limitation ' +
        'statements (e.g. outliers, missing-data handling, model specification ' +
        'boundaries, methodological limitations), you must relay them in the ' +
        'interpretation. They are not boilerplate — they bound the validity of the conclusion.'
  })

  return `${prompt}\n${requireWarnings}`
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
