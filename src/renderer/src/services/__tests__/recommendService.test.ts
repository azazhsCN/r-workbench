/**
 * 智能方法推荐：AI 层测试（v0.3.5 / T72）
 *
 * ── 本文件要证明的三件事 ──
 *
 * 1. **AI 越界会被丢弃**（"绝不误荐"在 AI 层的兜底）。
 *    模型在"排序"任务里很容易顺带推荐一个规则层已排除的方法
 *    （例如只有 6 个题项时推荐 SEM）。必须验证这类条目被过滤。
 *
 * 2. **无 AI 时降级可用**（验收硬指标）。
 *    未配置 Key、请求抛异常、返回非 JSON、返回全越界——四种失败路径
 *    都必须回落到规则层结果，且**不抛异常**。
 *
 * 3. **方法介绍来自 i18n 而非 AI**（避免 AI 写错方法学描述）。
 *    用真实语言包断言"description 与 wizard.method.<id>.desc 完全一致"。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { profileDataset } from '../columnProfile'
import { summarizeRecommendation } from '../recommendRules'
import {
  buildRecommendPrompt,
  parseAiRecommendations,
  validateAiSelection,
  buildFallbackRecommendations,
  recommendMethods,
  MAX_RECOMMENDATIONS,
  type AiChatFn,
  type TranslateFn
} from '../recommendService'
import { METHODS } from '../../data/methodRegistry'

const here = dirname(fileURLToPath(import.meta.url))
const LOCALES = resolve(here, '../../i18n/locales')

/** 扁平化语言包 */
function loadLocale(file: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(resolve(LOCALES, file), 'utf8')) as Record<string, unknown>
  const out: Record<string, string> = {}
  const walk = (node: unknown, prefix: string): void => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const key = prefix ? `${prefix}.${k}` : k
        if (typeof v === 'string') out[key] = v
        else walk(v, key)
      }
    }
  }
  walk(raw, '')
  return out
}

const zh = loadLocale('zh-CN.json')
const en = loadLocale('en-US.json')

/**
 * 测试用 `t()`：**真实**读取语言包，不做近似。
 * 这样 "description 必须等于 i18n 文案" 这条断言才有意义——
 * 如果用一个假 `t()`（直接返回 key），就无法发现"代码去 AI 里取介绍"的回归。
 */
function makeT(locale: Record<string, string>): TranslateFn {
  return (key, options) => {
    const fallback = options?.defaultValue
    const value = locale[key]
    if (typeof value === 'string') {
      // 简单插值，够本测试的文案用
      let out = value
      for (const [k, v] of Object.entries(options ?? {})) {
        if (k === 'defaultValue') continue
        out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
      return out
    }
    return typeof fallback === 'string' ? fallback : key
  }
}

const tZh = makeT(zh)

// ── 测试数据 ────────────────────────────────────────────────

function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** 典型问卷：6 量表题项 + 年龄 + 收入 + 3 水平分组，n=300 */
function surveyProfile() {
  const rng = makeRng(20260101)
  const headers = [...Array.from({ length: 6 }, (_, i) => `q${i + 1}`), 'age', 'income', 'grade']
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < 300; i++) {
    const r: Record<string, unknown> = {}
    for (let q = 1; q <= 6; q++) r[`q${q}`] = 1 + Math.floor(rng() * 5)
    r.age = Math.round((18 + rng() * 40) * 100) / 100
    r.income = Math.round((2000 + rng() * 18000) * 100) / 100
    r.grade = ['高一', '高二', '高三'][Math.floor(rng() * 3)]
    rows.push(r)
  }
  const columnInfo = headers.map((name) => ({
    name,
    type: (name === 'grade' ? 'string' : 'numeric') as 'numeric' | 'string'
  }))
  return profileDataset(headers, rows, columnInfo)
}

// ── 1. AI 越界过滤 ──────────────────────────────────────────

describe('AI 越界过滤：只能从可行集合里选', () => {
  it('规则层排除的方法（sem / cvi / ttest_one）即使 AI 推荐也必须被丢弃', () => {
    const summary = summarizeRecommendation(surveyProfile())
    const candidates = summary.recommendable
    const allowedIds = candidates.map((c) => c.methodId)

    // 先确认这几个方法确实不在可行集合里（否则本用例失去意义）
    expect(allowedIds, 'sem 在可行集合里，本用例前提不成立').not.toContain('sem')
    expect(allowedIds, 'cvi 在可行集合里，本用例前提不成立').not.toContain('cvi')
    expect(allowedIds, 'ttest_one 在可行集合里，本用例前提不成立').not.toContain('ttest_one')

    // 模拟模型"顺带推荐了更高级的方法"
    const aiOutput = [
      { methodId: 'efa', why: '你有 6 个题项，适合探索因子结构' },
      { methodId: 'sem', why: 'SEM 更强大，能同时建模测量与结构' },
      { methodId: 'cvi', why: '可以算内容效度' },
      { methodId: 'ttest_one', why: '可以检验均值' },
      { methodId: 'reliability', why: '6 个题项可算 α' }
    ]

    const { valid, rejected } = validateAiSelection(aiOutput, candidates)
    const keptIds = valid.map((v) => v.methodId)

    expect(keptIds).toEqual(['efa', 'reliability'])
    expect(rejected, '被丢弃的条目数不对').toBe(3)
  })

  it('重复条目只保留第一次出现', () => {
    const candidates = summarizeRecommendation(surveyProfile()).recommendable
    const { valid } = validateAiSelection(
      [
        { methodId: 'efa', why: '第一次' },
        { methodId: 'efa', why: '第二次' }
      ],
      candidates
    )
    expect(valid).toHaveLength(1)
    expect(valid[0].why).toBe('第一次')
  })

  it('非字符串 / 空 methodId 被丢弃', () => {
    const candidates = summarizeRecommendation(surveyProfile()).recommendable
    const { valid, rejected } = validateAiSelection(
      [{ methodId: 123 }, { methodId: '' }, { methodId: null }, { methodId: 'efa' }],
      candidates
    )
    expect(valid.map((v) => v.methodId)).toEqual(['efa'])
    expect(rejected).toBe(3)
  })

  it('AI 返回全越界 → recommendMethods 整体降级（不给"至少一个"）', async () => {
    const ai: AiChatFn = async () => ({
      content: JSON.stringify([
        { methodId: 'sem', why: 'x' },
        { methodId: 'cvi', why: 'y' }
      ])
    })
    const result = await recommendMethods(surveyProfile(), tZh, { ai })
    expect(result.degradedReason).toBe('aiInvalid')
    // 降级后必须是规则层结果，且**不含** sem/cvi
    expect(result.recommendations.map((r) => r.methodId)).not.toContain('sem')
    expect(result.recommendations.map((r) => r.methodId)).not.toContain('cvi')
    expect(result.recommendations.length).toBeGreaterThan(0)
    expect(result.recommendations.every((r) => r.fromAI === false)).toBe(true)
  })
})

// ── 2. 无 AI 降级（验收硬指标）──────────────────────────────

describe('无 AI 降级：规则层仍然可用', () => {
  it('未传 ai 时返回规则层结果，degradedReason = noAi', async () => {
    const result = await recommendMethods(surveyProfile(), tZh)
    expect(result.degradedReason).toBe('noAi')
    expect(result.recommendations.length).toBeGreaterThan(0)
    expect(result.recommendations.every((r) => r.fromAI === false)).toBe(true)
    // 静态介绍必须有内容（不能因为降级就只给个方法名）
    for (const r of result.recommendations) {
      expect(r.name.length, `${r.methodId} 缺少本地化名称`).toBeGreaterThan(0)
      expect(r.description.length, `${r.methodId} 缺少方法介绍`).toBeGreaterThan(0)
    }
  })

  it('AI 请求抛异常 → 降级为 aiError，不抛给调用方', async () => {
    const ai: AiChatFn = async () => {
      throw new Error('network down')
    }
    const result = await recommendMethods(surveyProfile(), tZh, { ai })
    expect(result.degradedReason).toBe('aiError')
    expect(result.recommendations.length).toBeGreaterThan(0)
  })

  it('AI 返回 error 字段 → 降级为 aiError', async () => {
    const ai: AiChatFn = async () => ({ content: '', error: '401 unauthorized' })
    const result = await recommendMethods(surveyProfile(), tZh, { ai })
    expect(result.degradedReason).toBe('aiError')
    expect(result.recommendations.length).toBeGreaterThan(0)
  })

  it('AI 返回非 JSON → 降级为 aiInvalid', async () => {
    const ai: AiChatFn = async () => ({ content: '我认为你应该先做描述性统计，然后...' })
    const result = await recommendMethods(surveyProfile(), tZh, { ai })
    expect(result.degradedReason).toBe('aiInvalid')
    expect(result.recommendations.length).toBeGreaterThan(0)
  })

  it('降级结果的可行性由规则层担保（每个都不是被排除的方法）', async () => {
    const profile = surveyProfile()
    const summary = summarizeRecommendation(profile)
    const allowed = new Set(summary.recommendable.map((c) => c.methodId))
    const result = await recommendMethods(profile, tZh)
    for (const r of result.recommendations) {
      expect(allowed.has(r.methodId), `降级结果里出现不可行方法 ${r.methodId}`).toBe(true)
    }
  })
})

// ── 3. 介绍复用 i18n（不重写方法学描述）───────────────────────

describe('方法介绍复用现有 i18n 文案', () => {
  it('降级结果里的 description 与 wizard.method.<id>.desc 完全一致（中英两种语言）', () => {
    const profile = surveyProfile()
    const candidates = summarizeRecommendation(profile).recommendable

    for (const locale of [zh, en]) {
      const t = makeT(locale)
      const fallback = buildFallbackRecommendations(candidates, t)
      for (const r of fallback) {
        const expected = locale[`wizard.method.${r.methodId}.desc`]
        expect(expected, `语言包缺少 wizard.method.${r.methodId}.desc`).toBeTruthy()
        expect(r.description, `${r.methodId} 的 description 不是来自 i18n`).toBe(expected)
      }
    }
  })

  it('24 个注册方法的 name/desc 键在中英语言包里都存在（推荐不会漏出 key）', () => {
    const missing: string[] = []
    for (const m of METHODS) {
      for (const [label, locale] of [
        ['zh-CN', zh],
        ['en-US', en]
      ] as const) {
        for (const key of [`wizard.method.${m.id}`, `wizard.method.${m.id}.desc`]) {
          if (typeof locale[key] !== 'string') missing.push(`${label} 缺 ${key}`)
        }
      }
    }
    expect(missing, `推荐会显示原始键名：\n${missing.join('\n')}`).toEqual([])
  })
})

// ── 4. Prompt 构造 ─────────────────────────────────────────

describe('Prompt 构造', () => {
  it('包含全部可行方法，且不含被排除的方法', () => {
    const profile = surveyProfile()
    const candidates = summarizeRecommendation(profile).recommendable
    const prompt = buildRecommendPrompt(profile, candidates, tZh)

    for (const c of candidates) {
      expect(prompt, `Prompt 里没有可行方法 ${c.methodId}`).toContain(c.methodId)
    }
    // 反方向：被排除的方法不该出现在候选清单里（否则模型会去选它）
    expect(prompt).not.toContain('结构方程模型')
  })

  it('包含数据画像的实质内容（样本量、变量名），不是空洞模板', () => {
    const profile = surveyProfile()
    const candidates = summarizeRecommendation(profile).recommendable
    const prompt = buildRecommendPrompt(profile, candidates, tZh)

    expect(prompt).toContain('300') // 样本量
    expect(prompt).toContain('q1') // 变量名
    expect(prompt).toContain('量表题项')
    // 必须要求 JSON，否则解析不可靠
    expect(prompt.toLowerCase()).toContain('json')
  })

  it('要求模型不得引入候选之外的方法（Prompt 层的第一道防线）', () => {
    const profile = surveyProfile()
    const candidates = summarizeRecommendation(profile).recommendable
    const prompt = buildRecommendPrompt(profile, candidates, tZh)
    // 具体措辞会随语言变，断言"存在约束性表述"即可
    const hasConstraint =
      /只能从|不得|不要推荐|must be chosen|only choose|do not recommend/i.test(prompt)
    expect(hasConstraint, 'Prompt 未约束模型只能在候选集合内选择').toBe(true)
  })
})

// ── 5. JSON 解析宽容性 ──────────────────────────────────────

describe('AI 返回解析：宽容处理模型输出瑕疵', () => {
  it('纯 JSON 数组', () => {
    const r = parseAiRecommendations('[{"methodId":"efa","why":"a"}]')
    expect(r).toHaveLength(1)
    expect(r![0].methodId).toBe('efa')
  })

  it('带 ```json 代码围栏', () => {
    const r = parseAiRecommendations('```json\n[{"methodId":"efa"}]\n```')
    expect(r).toHaveLength(1)
  })

  it('前后有多余说明文字', () => {
    const r = parseAiRecommendations('好的，以下是推荐：\n[{"methodId":"efa"}]\n希望有帮助。')
    expect(r).toHaveLength(1)
  })

  it('单个对象而非数组', () => {
    const r = parseAiRecommendations('{"methodId":"efa"}')
    expect(r).toHaveLength(1)
  })

  it('完全无法解析时返回 null（由调用方降级）', () => {
    expect(parseAiRecommendations('完全不是 JSON')).toBeNull()
    expect(parseAiRecommendations('')).toBeNull()
  })
})

// ── 6. 完整 AI 路径 ────────────────────────────────────────

describe('完整 AI 路径：合法输出被正确采纳', () => {
  it('AI 给出的 why 与变量建议进入结果，且顺序被保留', async () => {
    const ai: AiChatFn = async () =>
      ({
        content: JSON.stringify([
          { methodId: 'efa', why: '有 6 个题项，适合看因子结构', variables: ['q1', 'q2', 'q3'] },
          { methodId: 'reliability', why: '同一组题项可算内部一致性' }
        ])
      })

    const result = await recommendMethods(surveyProfile(), tZh, { ai })
    expect(result.degradedReason).toBeUndefined()
    // AI 排在前两位，顺序保留
    expect(result.recommendations[0].methodId).toBe('efa')
    expect(result.recommendations[0].fromAI).toBe(true)
    expect(result.recommendations[0].whyFits).toBe('有 6 个题项，适合看因子结构')
    expect(result.recommendations[0].suggestedVariables).toEqual(['q1', 'q2', 'q3'])
    expect(result.recommendations[1].methodId).toBe('reliability')
  })

  it('AI 建议的变量若不存在于数据中会被剔除（防止预填不存在的列）', async () => {
    const ai: AiChatFn = async () =>
      ({
        content: JSON.stringify([
          { methodId: 'efa', why: 'x', variables: ['q1', '不存在的列', 'q2'] }
        ])
      })
    const result = await recommendMethods(surveyProfile(), tZh, { ai })
    expect(result.recommendations[0].suggestedVariables).toEqual(['q1', 'q2'])
  })

  it('AI 只排了部分方法时，剩下的可行方法被补在末尾（不让选项凭空消失）', async () => {
    const profile = surveyProfile()
    const candidates = summarizeRecommendation(profile).recommendable
    const ai: AiChatFn = async () => ({ content: JSON.stringify([{ methodId: 'efa', why: 'x' }]) })
    const result = await recommendMethods(profile, tZh, { ai })

    const ids = result.recommendations.map((r) => r.methodId)
    // 全部可行方法都应出现（上限内）
    expect(ids.length).toBe(Math.min(candidates.length, MAX_RECOMMENDATIONS))
    for (const c of candidates.slice(0, MAX_RECOMMENDATIONS)) {
      expect(ids, `可行方法 ${c.methodId} 在结果里消失了`).toContain(c.methodId)
    }
  })

  it('结果数量不超过上限（列太多等于没推荐）', async () => {
    const result = await recommendMethods(surveyProfile(), tZh)
    expect(result.recommendations.length).toBeLessThanOrEqual(MAX_RECOMMENDATIONS)
  })
})

// ── 7. 排除信息透明 ────────────────────────────────────────

describe('排除信息透明（用户可查"为什么没推荐某方法"）', () => {
  it('返回被排除的方法数量，且与规则层一致', () => {
    const profile = surveyProfile()
    const summary = summarizeRecommendation(profile)
    const expected = summary.all.filter((a) => !a.applicable).length
    return recommendMethods(profile, tZh).then((result) => {
      expect(result.excludedCount).toBe(expected)
      expect(result.excludedCount).toBeGreaterThan(0)
    })
  })

  it('列出需要用户补充信息的方法（供 UI 提示研究假设）', async () => {
    const result = await recommendMethods(surveyProfile(), tZh)
    // 路径分析 / SEM / 单样本 t / 层次回归 都需要数据外的信息
    expect(result.requiresUserInput).toContain('path_analysis')
    expect(result.requiresUserInput).toContain('sem')
    expect(result.requiresUserInput).toContain('ttest_one')
    expect(result.requiresUserInput).toContain('hierarchical_regression')
  })
})
