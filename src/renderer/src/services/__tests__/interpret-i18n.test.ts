/**
 * 解读服务的「分析类型」本地化契约（v0.3.1 回归防线）
 *
 * ── 为什么需要这个测试 ──
 *
 * v0.3.0 之前，`interpretService.ts` 用一个手写的 `KNOWN_METHODS` 集合判断
 * "这个方法有没有本地化名字"。这个集合与 `detectAnalysisType` 的实际返回值
 * **长期不一致**：
 *
 *   | KNOWN_METHODS 里写的 | detectAnalysisType 实际返回 |
 *   |---------------------|----------------------------|
 *   | `chi_square`        | `chisquare`                |
 *   | `summary`           | `summary_by`               |
 *   | （完全没有）          | `efa` / `cfa` / `cvi` / `harman` |
 *
 * 后果：这些方法的 AI 解读 Prompt 里「分析类型」直接显示英文 id，而不是
 * 界面语言对应的名称。而且它是**静默**的——本地化失败不会报错，只是名字难看，
 * 所以测试不覆盖就永远发现不了。
 *
 * v0.3.1 把「白名单查表」改成「直接按 wizard.method.<type> 取，defaultValue 兜底」，
 * 从根上去掉了第二份名单。本测试锁定两件事：
 *   1. `detectAnalysisType` 的**每一个**返回值都能在两种语言里取到名字；
 *   2. `METHODS` 注册表里的**每一个** id 同样都能取到名字。
 *
 * 这样未来新增方法若漏配语言包，这里会红——而不是等用户看到英文 id。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectAnalysisType } from '../resultParser'
import { METHODS } from '../../data/methodRegistry'

const here = dirname(fileURLToPath(import.meta.url))
const LOCALES = resolve(here, '../../i18n/locales')

/** 扁平化嵌套 JSON 为 `a.b.c` 形式的键集合（与 i18next 的点号查找语义一致） */
function flatten(obj: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k
      out.add(key)
      flatten(v, key, out)
    }
  }
  return out
}

const zhKeys = flatten(JSON.parse(readFileSync(resolve(LOCALES, 'zh-CN.json'), 'utf8')))
const enKeys = flatten(JSON.parse(readFileSync(resolve(LOCALES, 'en-US.json'), 'utf8')))

/**
 * `detectAnalysisType` 的全部可能返回值。
 *
 * 用真实横幅驱动（而不是手抄一份 id 列表），这样返回值集合本身也被验证：
 * 见下方 `it('每个横幅都能被识别')`。
 */
const BANNERS: Array<[string, string]> = [
  ['=== 描述性统计 ===', 'descriptive'],
  ['=== 独立样本 t 检验 ===', 'ttest_independent'],
  ['=== 配对样本 t 检验 ===', 'ttest_paired'],
  ['=== 单样本 t 检验 ===', 'ttest_one'],
  ['=== 单因素方差分析 ===', 'anova'],
  ['=== 卡方检验 ===', 'chisquare'],
  ['=== 相关分析 (pearson) ===', 'correlation'],
  ['=== 线性回归分析 ===', 'regression'],
  ['=== 信度分析 (Cronbach\'s α) ===', 'reliability'],
  ['=== 正态性检验 (Shapiro-Wilk) ===', 'normality'],
  ['=== 非参数检验 (Mann-Whitney U) ===', 'nonparametric'],
  ['=== 频数统计 ===', 'frequency'],
  ['=== 分类汇总 ===', 'summary_by'],
  ['=== 探索性因子分析 (EFA) ===', 'efa'],
  ['=== 验证性因子分析 (CFA) ===', 'cfa'],
  ['=== 内容效度指数 (CVI) ===', 'cvi'],
  ['=== Harman 单因子检验 ===', 'harman']
]

describe('解读服务：分析类型名称本地化', () => {
  it('每个横幅都能被 detectAnalysisType 识别（类型集合本身正确）', () => {
    const actual = BANNERS.map(([banner]) => detectAnalysisType(banner))
    const expected = BANNERS.map(([, id]) => id)
    expect(actual).toEqual(expected)
  })

  it('detectAnalysisType 的每个返回值都有 wizard.method.* 文案（中英双语）', () => {
    const missing: string[] = []
    for (const [, id] of BANNERS) {
      const key = `wizard.method.${id}`
      if (!zhKeys.has(key)) missing.push(`zh-CN 缺 ${key}`)
      if (!enKeys.has(key)) missing.push(`en-US 缺 ${key}`)
    }
    expect(missing, `分析方法缺少本地化名称（AI 解读 Prompt 会显示英文 id）：\n${missing.join('\n')}`).toEqual([])
  })

  it('METHODS 注册表里每个 id 也都有 wizard.method.* 文案（中英双语）', () => {
    const missing: string[] = []
    for (const m of METHODS) {
      const key = `wizard.method.${m.id}`
      // summary_by 的 i18n 键沿用了短名 wizard.method.summary，属既有的历史命名；
      // 注册表通过 nameKey 显式指过去，这里按同样的口径兼容。
      const candidates = [key, m.nameKey].filter(Boolean) as string[]
      const zhOk = candidates.some((k) => zhKeys.has(k))
      const enOk = candidates.some((k) => enKeys.has(k))
      if (!zhOk) missing.push(`zh-CN 缺 ${key}`)
      if (!enOk) missing.push(`en-US 缺 ${key}`)
    }
    expect(missing).toEqual([])
  })

  it('不再依赖手写白名单查表（防止第二份名单回流）', () => {
    // 先剥掉注释再检查，否则本文件/源码里"提到"这个标识符的说明文字会造成假红。
    const src = readFileSync(resolve(here, '../interpretService.ts'), 'utf8')
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

    // 白名单与 detectAnalysisType 的返回值漂移，正是本测试存在的理由。
    // 若有人重新引入一个"先查集合再翻译"的名单，这里会红。
    expect(codeOnly, 'interpretService.ts 不应再维护已知方法白名单').not.toMatch(
      /KNOWN_METHODS|new Set\(/
    )
    // 必须走 defaultValue 兜底，保证未知类型也能优雅降级为原始 id
    expect(src).toMatch(/defaultValue/)
  })
})
