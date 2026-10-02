import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { METHOD_PLOT_MAP } from '../plotService'

/**
 * METHODS（向导方法注册表）↔ METHOD_PLOT_MAP（推荐图表）↔ 分发分支（RService 调用）一致性测试。
 *
 * 历史缺陷：向导新增/删除方法时，13 分支 if-else 链（WizardPage.tsx:273-299）与
 * METHOD_PLOT_MAP 极易漏改，表现为“方法能选但没有任何图表/没有生成器”。
 * 本测试从源码静态提取注册表，与运行时导入的 METHOD_PLOT_MAP 交叉比对。
 */

const here = dirname(fileURLToPath(import.meta.url))
const WIZARD = resolve(here, '../../pages/WizardPage.tsx')
const RSERVICE = resolve(here, '../rService.ts')

const wizardSrc = readFileSync(WIZARD, 'utf8')
const rServiceSrc = readFileSync(RSERVICE, 'utf8')

/** 规划的 13 个方法 id —— 少一个或多一个都必须是显式决策，不能静默发生 */
const REQUIRED_METHOD_IDS = [
  'descriptive',
  'ttest_independent',
  'ttest_paired',
  'anova',
  'chisquare',
  'correlation',
  'regression',
  'reliability',
  'ttest_one',
  'normality',
  'nonparametric',
  'frequency',
  'summary_by'
]

/** 从 src 中 marker 首次出现处的 `=` 之后的 `[` 开始做括号配对（跳过字符串字面量） */
function extractArrayLiteral(src: string, marker: RegExp): string {
  const m = marker.exec(src)
  if (!m) throw new Error(`未找到数组起始标记 ${marker}`)
  // 必须从 `=` 之后找 `[`：类型注解 `AnalysisMethod[]` 里也有方括号
  const start = src.indexOf('[', m.index + m[0].length)
  if (start < 0) throw new Error('未找到数组起始括号')
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('数组字面量未闭合')
}

const methodsBlock = extractArrayLiteral(wizardSrc, /(?:export\s+)?const\s+METHODS\s*:\s*AnalysisMethod\[\]\s*=/)
const declaredIds = [...methodsBlock.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1])

/**
 * 分发分支：支持两种等价写法
 *   A. `if (method === 'x') { code = RService.yCode(...) }`（v0.2.5 的 13 分支 if-else 链）
 *   B. 分发映射 `{ x: () => RService.yCode(...) }`（v0.2.6 T14 技术债 #1 的重构形式）
 * 两种都必须覆盖全部 METHODS，且调用的生成器真实存在。
 */
const dispatch = [
  ...wizardSrc.matchAll(/method\s*===\s*'([^']+)'\)\s*\{\s*code\s*=\s*RService\.(\w+)\(/g),
  ...wizardSrc.matchAll(/^\s*'?([A-Za-z_]\w*)'?\s*:\s*\(\s*\)\s*=>\s*RService\.(\w+)\(/gm)
].map((m) => ({ id: m[1], generator: m[2] }))
const dispatchedIds = dispatch.map((d) => d.id)
const generatorsCalled = new Set(dispatch.map((d) => d.generator))

/** rService.ts 中真实存在的 static 生成器 */
const staticMethods = new Set([...rServiceSrc.matchAll(/\bstatic\s+(?:async\s+)?(\w+)\s*\(/g)].map((m) => m[1]))

/** plotService.generatePlotCode 实际支持的图表类型 */
function supportedPlotTypes(): Set<string> {
  const src = readFileSync(resolve(here, '../plotService.ts'), 'utf8')
  const idx = src.indexOf('export function generatePlotCode')
  if (idx < 0) throw new Error('plotService.ts 中未找到 generatePlotCode')
  const nextFn = src.indexOf('\nfunction ', idx)
  const body = src.slice(idx, nextFn < 0 ? src.length : nextFn)
  return new Set([...body.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]))
}

describe('METHODS / METHOD_PLOT_MAP 一致性', () => {
  it('declares the 13 required method ids, uniquely', () => {
    expect(declaredIds.length).toBeGreaterThan(0)
    expect(new Set(declaredIds).size).toBe(declaredIds.length)
    expect(declaredIds).toEqual(expect.arrayContaining(REQUIRED_METHOD_IDS))
  })

  it('extracted ids match the ids actually exported by WizardPage (when exported)', async () => {
    if (!/export\s+const\s+METHODS\b/.test(wizardSrc)) {
      // 尚未导出时退化为源码静态提取，但仍要求提取结果与分发分支一致（见下一个用例）
      expect(declaredIds.length).toBe(REQUIRED_METHOD_IDS.length)
      return
    }
    const mod = (await import('../../pages/WizardPage')) as Record<string, unknown>
    const exported = mod.METHODS as Array<{ id: string }>
    expect(Array.isArray(exported)).toBe(true)
    expect(exported.map((m) => m.id)).toEqual(declaredIds)
  })

  it('every declared method id has a METHOD_PLOT_MAP entry with usable chart types', () => {
    for (const id of declaredIds) {
      const plots = METHOD_PLOT_MAP[id]
      expect(plots, `METHOD_PLOT_MAP 缺少方法 "${id}"`).toBeDefined()
      expect(Array.isArray(plots)).toBe(true)
      expect(plots.length, `方法 "${id}" 没有任何推荐图表`).toBeGreaterThan(0)
      for (const p of plots) {
        expect(typeof p.type).toBe('string')
        expect(p.type.length).toBeGreaterThan(0)
        expect(typeof p.label).toBe('string')
        expect(p.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('every METHOD_PLOT_MAP chart type is handled by generatePlotCode', () => {
    const supported = supportedPlotTypes()
    for (const [id, plots] of Object.entries(METHOD_PLOT_MAP)) {
      for (const p of plots) {
        expect(supported.has(p.type), `方法 "${id}" 推荐的图表类型 "${p.type}" 在 generatePlotCode 中没有分支`).toBe(true)
      }
    }
  })

  it('the set of declared ids equals the set of dispatch branches (no orphan, no missing)', () => {
    expect(dispatch.length).toBeGreaterThan(0)
    const declared = [...declaredIds].sort()
    const dispatched = [...new Set(dispatchedIds)].sort()
    expect(dispatched).toEqual(declared)
  })

  it('every dispatch branch calls a generator that exists in RService', () => {
    for (const { id, generator } of dispatch) {
      expect(
        staticMethods.has(generator),
        `方法 "${id}" 调用 RService.${generator}()，但 rService.ts 中没有该 static 方法`
      ).toBe(true)
    }
    expect(generatorsCalled.size).toBe(new Set(dispatchedIds).size)
  })

  it('no METHOD_PLOT_MAP entry exists for a method that is not in METHODS', () => {
    const declared = new Set(declaredIds)
    for (const key of Object.keys(METHOD_PLOT_MAP)) {
      expect(declared.has(key), `METHOD_PLOT_MAP 包含未注册的方法 "${key}"`).toBe(true)
    }
  })
})
