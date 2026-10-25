import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { METHOD_PLOT_MAP } from '../plotService'
import { METHODS as REGISTRY_METHODS } from '../../data/methodRegistry'

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

/**
 * 规划的全部方法 id —— 少一个必须是显式决策，不能静默发生。
 *
 * v0.3.1 起改为**精确匹配**（此前用 `arrayContaining` 只断言"至少包含这 13 个"）。
 * 为什么必须收紧：宽松断言下，删掉一个方法不会有任何测试变红——
 * 用户只会看到向导里少了一张卡片，属于静默功能丢失。
 * 现在新增/删除方法都必须同步改这里（与 r-contract.test.ts 的条数断言呼应）。
 */
const REQUIRED_METHOD_IDS = [
  // 基础分析
  'descriptive',
  'normality',
  'frequency',
  'summary_by',
  // 差异检验
  'ttest_independent',
  'ttest_paired',
  'ttest_one',
  'anova',
  'chisquare',
  'nonparametric',
  // 关系分析
  'correlation',
  'regression',
  // 问卷分析
  'reliability',
  'efa',
  'cfa',
  'cvi',
  'harman'
]

/** 从 src 中 marker 首次出现处的 `=` 之后的 `[` 开始做括号配对（跳过字符串字面量） */
// extractArrayLiteral（从 TS 源码文本解析数组字面量）已不再需要：
// METHODS 现在是运行时直接导入的注册表，见 methodRegistry.ts。
// 保留这段注释以便回溯：曾用于从 WizardPage.tsx 文本中抠 id，现因 Fast Refresh
// 约束把注册表抽到纯 TS 文件后，用真实导入即可，无需再做文本解析。

// 注册表已抽到独立的纯 TS 文件（Fast Refresh 要求），断言直接取真实导入的 id
const registryIds = REGISTRY_METHODS.map((m) => m.id)
// 与运行时导入的注册表做交叉比对：两条都必须完全相同
const declaredIds = registryIds

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
  it('declares exactly the 17 planned method ids, uniquely', () => {
    expect(declaredIds.length).toBeGreaterThan(0)
    expect(new Set(declaredIds).size).toBe(declaredIds.length)
    // 双向精确比对：
    //   - arrayContaining 只保证"至少包含"，删掉一个方法不会变红 → 静默功能丢失
    //   - 这里同时锁住"不多不少"，新增/删除都必须显式改 REQUIRED_METHOD_IDS
    expect([...declaredIds].sort(), '方法集合与规划不一致（删/增方法须同步 REQUIRED_METHOD_IDS）').toEqual(
      [...REQUIRED_METHOD_IDS].sort()
    )
    expect(REQUIRED_METHOD_IDS).toHaveLength(17)
  })

  it('extracted ids match the ids actually exported by methodRegistry', async () => {
    const mod = (await import('../../data/methodRegistry')) as Record<string, unknown>
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
