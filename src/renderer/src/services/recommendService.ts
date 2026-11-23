/**
 * 智能方法推荐：AI 排序层（v0.3.5 / T72）
 *
 * ── 本模块在双层架构里的位置 ──
 *
 * ```
 *   数据 → columnProfile（事实） → recommendRules（**排除不可能的**）
 *                                        ↓ 可行集合（≤8 个）
 *                                  本模块：AI 排序 + 解释
 * ```
 *
 * 规则层只回答"哪些方法**不可能**"，本模块回答"**哪几个最贴切**"。
 * 原型（DEVELOPMENT_PLAN §5.5.1）已证明后半段做不了规则化：
 * 相关 vs 回归、EFA vs CFA、X/M/Y/W 指派、配对 vs 独立，
 * 全部取决于**研究假设**与**数据结构之外的信息**。
 *
 * ── 三条设计红线 ──
 *
 * 1. **AI 只能在可行集合里排序，不能引入集合外的方法**。
 *    模型对方法适用性的判断并不可靠（例如它很可能"觉得"SEM 更高级就推荐 SEM）。
 *    因此返回结果要经过 `validateAiSelection` 过滤——凡是规则层判定不可行的，
 *    一律丢弃。这是"绝不误荐"这条验收指标在 AI 层的兜底。
 *
 * 2. **AI 失败/未配置时必须降级，不能报错**。
 *    未配置 API Key、网络超时、返回格式错误——全部回落到规则层的可行集合 + 静态介绍。
 *    验收标准明确要求"未配置 API Key 时规则层仍可用"。降级不是错误态。
 *
 * 3. **方法介绍复用现有 i18n 文案**（`wizard.method.<id>.desc`，24 个中英双语已齐备），
 *    AI 只负责补"为什么适合这份数据"，不重写方法介绍。这既省 token，
 *    也避免 AI 把方法学描述写错（介绍文案是随生成器一起维护、有测试守护的）。
 */

import type { AnalysisMethod } from '../data/methodRegistry'
import { METHODS } from '../data/methodRegistry'
import type { DatasetProfile } from './columnProfile'
import { summarizeProfile } from './columnProfile'
import {
  summarizeRecommendation,
  type MethodAssessment,
  type ReasonKey
} from './recommendRules'

/** 一条推荐结果 */
export interface Recommendation {
  methodId: string
  /** 方法名（本地化，由 UI 传入的翻译函数给出） */
  name: string
  /** 方法简介（复用 `wizard.method.<id>.desc`，不是 AI 生成的） */
  description: string
  /** "为什么适合这份数据"——AI 生成；降级模式下为空 */
  whyFits?: string
  /** 建议预填的变量（变量名 → 列名） */
  suggestedVariables: string[]
  /** 具名角色建议（中介/调节等方法的 X/M/Y/W） */
  suggestedRoles?: Record<string, string>
  /**
   * 需要用户填写的 textInputs 建议值（路径规格 / 因子结构 / 区块划分）。
   * AI 只在用户明确描述了结构时才给；否则留空，由用户在向导页自己填。
   */
  suggestedTexts?: Record<string, string>
  /** 是否 AI 生成（false = 规则层降级结果） */
  fromAI: boolean
}

/** 推荐结果集 */
export interface RecommendationResult {
  recommendations: Recommendation[]
  /** 降级原因（未配置 AI / 调用失败 / 返回格式错误）；正常时为 undefined */
  degradedReason?: 'noAi' | 'aiError' | 'aiInvalid'
  /** 规则层判定需要用户补充信息的方法（供 UI 提示"若你的研究问题是…"） */
  requiresUserInput: string[]
  /** 被规则层排除的方法数（供 UI 显示"已排除 N 个不适用方法"） */
  excludedCount: number
  /**
   * 被排除方法的明细（供 UI 展开显示"为什么不适合"）。
   * v0.3.5：组件需要展示排除原因，因此把规则层结果带出来。
   */
  excluded: {
    methodId: string
    reasonKey: string
    params?: Record<string, string | number>
  }[]
}

/** 本地化函数签名（与 i18next 的 `t(key, options)` 兼容的最小接口） */
export type TranslateFn = (key: string, options?: Record<string, unknown>) => string

/** AI 返回的原始条目结构（JSON 契约） */
interface AiRecommendationItem {
  methodId?: unknown
  why?: unknown
  variables?: unknown
  roles?: unknown
}

/** AI 单次请求的接口（由调用方注入 `aiService.chat`，便于单测） */
export interface AiChatFn {
  (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, dataContext?: string): Promise<{
    content: string
    error?: string
  }>
}

/** 推荐条目上限：UI 上列太多等于没推荐，与规则层 ≤8 的验收口径一致 */
export const MAX_RECOMMENDATIONS = 8

/**
 * 构造给 AI 的 Prompt。
 *
 * 三个刻意的取舍：
 * 1. **把可行集合连同"为什么可行"一起给**，模型才知道每个方法是在什么条件下被留下的；
 * 2. **明确禁止引入集合外方法**，并说明后果（用户看到不可行的方法会白试一次）；
 * 3. **要求输出 JSON**，而不是自由文本——自由文本还要再写一套解析器，
 *    且模型稍有措辞变化就解析失败。JSON 契约是可校验的。
 */
export function buildRecommendPrompt(
  profile: DatasetProfile,
  candidates: MethodAssessment[],
  t: TranslateFn
): string {
  const available = candidates
    .map((c) => {
      const m = METHODS.find((x) => x.id === c.methodId)
      const label = m ? t(m.nameKey ?? `wizard.method.${m.id}`, { defaultValue: m.name }) : c.methodId
      const desc = m ? t(m.descKey ?? `wizard.method.${m.id}.desc`, { defaultValue: m.description }) : ''
      return `- ${c.methodId}（${label}）：${desc}`
    })
    .join('\n')

  const varLines = profile.numericColumns
    .concat(profile.categoricalColumns)
    .slice(0, 12)
    .map((c) => `${c.name}(${c.type === 'numeric' ? '数值' : '分类'})`)
    .join(', ')

  return [
    t('recommend.prompt.intro'),
    '',
    `## ${t('recommend.prompt.dataSection')}`,
    summarizeProfile(profile),
    '',
    `## ${t('recommend.prompt.candidatesSection')}`,
    available,
    '',
    t('recommend.prompt.rules', {
      max: MAX_RECOMMENDATIONS,
      variables: varLines
    }),
    '',
    t('recommend.prompt.outputFormat')
  ].join('\n')
}

/**
 * 解析 AI 返回的 JSON。
 *
 * 宽容处理常见的模型输出瑕疵：
 * - ```json 代码围栏
 * - 前后多余说明文字（只取第一个 `[` 到最后一个 `]`）
 * - 单个对象而非数组（包成数组）
 *
 * 解析失败返回 `null`，由调用方降级——**不抛异常**：推荐失败不该让界面崩。
 */
export function parseAiRecommendations(content: string): AiRecommendationItem[] | null {
  if (!content || !content.trim()) return null
  const withoutFence = content.replace(/```(?:json)?/gi, '').trim()

  const tryParse = (text: string): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  let parsed = tryParse(withoutFence)
  if (parsed === undefined) {
    // 退一步：抠出最外层的 [...] 再试
    const start = withoutFence.indexOf('[')
    const end = withoutFence.lastIndexOf(']')
    if (start >= 0 && end > start) parsed = tryParse(withoutFence.slice(start, end + 1))
  }
  if (parsed === undefined) {
    // 再退一步：可能是单个对象
    const start = withoutFence.indexOf('{')
    const end = withoutFence.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const obj = tryParse(withoutFence.slice(start, end + 1))
      if (obj && typeof obj === 'object') parsed = [obj]
    }
  }
  if (parsed === undefined) return null

  if (Array.isArray(parsed)) return parsed.filter((x): x is AiRecommendationItem => !!x && typeof x === 'object')
  if (parsed && typeof parsed === 'object') return [parsed as AiRecommendationItem]
  return null
}

/**
 * 校验并收窄 AI 的选择 —— **"绝不误荐"在 AI 层的兜底**。
 *
 * 只保留同时满足以下条件的条目：
 *   1. `methodId` 是字符串，且**在规则层的可行集合里**（不是注册表全集）；
 *   2. 未重复出现。
 *
 * 实测动机：模型在"排序"任务里很容易顺带"建议"一个更高级的方法
 * （例如在只有 6 个题项时推荐 SEM），而它并不知道规则层已经因为
 * 缺因子结构把 SEM 排除掉了。这里直接丢弃，并把丢弃数量回报给调用方，
 * 便于在开发期观察"AI 是否频繁越界"。
 */
export function validateAiSelection(
  items: AiRecommendationItem[],
  candidates: MethodAssessment[]
): { valid: AiRecommendationItem[]; rejected: number } {
  const allowed = new Set(candidates.map((c) => c.methodId))
  const seen = new Set<string>()
  const valid: AiRecommendationItem[] = []
  let rejected = 0

  for (const item of items) {
    const id = typeof item.methodId === 'string' ? item.methodId.trim() : ''
    if (!id || !allowed.has(id) || seen.has(id)) {
      rejected++
      continue
    }
    seen.add(id)
    valid.push(item)
  }
  return { valid, rejected }
}

/** 从 AI 条目里安全提取字符串数组 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

/** 从 AI 条目里安全提取 `Record<string,string>` */
function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 规则层降级结果：可行集合 + 静态介绍，**没有任何 AI 内容**。
 *
 * 这是"未配置 API Key 时仍可用"的实现。排序沿用注册表顺序——
 * 刻意不做规则排序（原型已证伪纯规则排序），保持诚实：
 * 没有 AI 时就不假装知道哪个"更贴切"。
 */
export function buildFallbackRecommendations(
  candidates: MethodAssessment[],
  t: TranslateFn
): Recommendation[] {
  return candidates.slice(0, MAX_RECOMMENDATIONS).map((c) => {
    const m = METHODS.find((x) => x.id === c.methodId)
    return {
      methodId: c.methodId,
      name: m ? t(m.nameKey ?? `wizard.method.${m.id}`, { defaultValue: m.name }) : c.methodId,
      description: m
        ? t(m.descKey ?? `wizard.method.${m.id}.desc`, { defaultValue: m.description })
        : '',
      suggestedVariables: defaultSuggestedVariables(m, c),
      fromAI: false
    }
  })
}

/**
 * 无 AI 时的变量预填建议（只用画像事实，不猜研究假设）。
 *
 * 这里只填**确定无误**的那些：量表题项、分组变量。
 * 不填 X/M/Y/W（那是研究假设）、不填 μ₀、不填路径规格。
 */
function defaultSuggestedVariables(
  method: AnalysisMethod | undefined,
  assessment: MethodAssessment
): string[] {
  if (!method) return []
  const params = assessment.params ?? {}
  switch (method.id) {
    case 'ttest_paired':
      return typeof params.pre === 'string' && typeof params.post === 'string'
        ? [params.pre, params.post]
        : []
    default:
      return []
  }
}

/**
 * 主流程：规则层收窄 → （可选）AI 排序 → 结果。
 *
 * @param profile 数据画像
 * @param t 本地化函数
 * @param options.ai 已配置时传入 `aiService.chat`；未配置传 undefined → 直接降级
 *
 * 任何一步失败都**不抛异常**，而是返回降级结果并标注 `degradedReason`：
 * 推荐是辅助功能，不该因为它不可用而阻断用户做分析。
 */
export async function recommendMethods(
  profile: DatasetProfile,
  t: TranslateFn,
  options: { ai?: AiChatFn } = {}
): Promise<RecommendationResult> {
  const summary = summarizeRecommendation(profile)
  const candidates = summary.recommendable
  const requiresUserInput = summary.requiresUserInput.map((a) => a.methodId)
  const excludedCount = summary.all.filter((a) => !a.applicable).length

  const base = {
    requiresUserInput,
    excludedCount,
    excluded: summary.all
      .filter((a) => !a.applicable)
      .map((a) => ({ methodId: a.methodId, reasonKey: a.reasonKey, params: a.params }))
  }

  // 规则层一个都不剩 → 说明数据过于特殊（例如空表），直接返回空并说明
  if (candidates.length === 0) {
    return { recommendations: [], degradedReason: 'noAi', ...base }
  }

  // 未配置 AI → 降级（这是正常路径，不是错误）
  if (!options.ai) {
    return {
      recommendations: buildFallbackRecommendations(candidates, t),
      degradedReason: 'noAi',
      ...base
    }
  }

  const prompt = buildRecommendPrompt(profile, candidates, t)
  let content = ''
  try {
    const res = await options.ai([
      { role: 'system', content: t('recommend.prompt.system') },
      { role: 'user', content: prompt }
    ])
    if (res.error) {
      return {
        recommendations: buildFallbackRecommendations(candidates, t),
        degradedReason: 'aiError',
        ...base
      }
    }
    content = res.content
  } catch {
    return {
      recommendations: buildFallbackRecommendations(candidates, t),
      degradedReason: 'aiError',
      ...base
    }
  }

  const parsed = parseAiRecommendations(content)
  if (!parsed) {
    return {
      recommendations: buildFallbackRecommendations(candidates, t),
      degradedReason: 'aiInvalid',
      ...base
    }
  }

  const { valid } = validateAiSelection(parsed, candidates)
  if (valid.length === 0) {
    // AI 返回的全是不在可行集合里的方法 → 整批丢弃并降级，
    // 而不是"至少给点什么"。给错的方法比不给更糟。
    return {
      recommendations: buildFallbackRecommendations(candidates, t),
      degradedReason: 'aiInvalid',
      ...base
    }
  }

  const recommendations: Recommendation[] = valid.map((item) => {
    const methodId = String(item.methodId)
    const m = METHODS.find((x) => x.id === methodId)
    const variables = toStringArray(item.variables)
    // 只保留画像里真实存在的变量：AI 可能拼错列名或引用被排除的 id 列
    const known = new Set(profile.columns.map((c) => c.name))
    const filteredVariables = variables.filter((v) => known.has(v))

    return {
      methodId,
      name: m ? t(m.nameKey ?? `wizard.method.${m.id}`, { defaultValue: m.name }) : methodId,
      description: m
        ? t(m.descKey ?? `wizard.method.${m.id}.desc`, { defaultValue: m.description })
        : '',
      whyFits: typeof item.why === 'string' && item.why.trim() ? item.why.trim() : undefined,
      suggestedVariables: filteredVariables,
      suggestedRoles: toStringRecord(item.roles),
      fromAI: true
    }
  })

  // 补齐：AI 只排了一部分可行方法时，把剩下的按注册表顺序附在后面。
  // 为什么补：可行集合本身是规则层担保的"都可行"，用户理应看到全部选项；
  // 只呈现 AI 提到的那几个会让"某方法消失"看起来像是不可行。
  const chosen = new Set(recommendations.map((r) => r.methodId))
  for (const c of candidates) {
    if (recommendations.length >= MAX_RECOMMENDATIONS) break
    if (chosen.has(c.methodId)) continue
    const m = METHODS.find((x) => x.id === c.methodId)
    recommendations.push({
      methodId: c.methodId,
      name: m ? t(m.nameKey ?? `wizard.method.${m.id}`, { defaultValue: m.name }) : c.methodId,
      description: m
        ? t(m.descKey ?? `wizard.method.${m.id}.desc`, { defaultValue: m.description })
        : '',
      suggestedVariables: defaultSuggestedVariables(m, c),
      fromAI: false
    })
  }

  return { recommendations: recommendations.slice(0, MAX_RECOMMENDATIONS), ...base }
}

/**
 * 把排除理由本地化（UI 展示"为什么没推荐某方法"）。
 *
 * 单列一个函数而不是在组件里内联，是因为 `reasonKey` → `t()` 的映射
 * 需要 `params` 一起带过去，内联容易漏参数导致界面出现 `{min}` 字面量。
 */
export function localizeReason(
  reasonKey: ReasonKey,
  params: Record<string, string | number> | undefined,
  t: TranslateFn
): string {
  return t(reasonKey, params ?? {})
}
