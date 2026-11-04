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
  // v0.3.4 关系分析扩展
  'hierarchical_regression',
  'logistic_regression',
  // 问卷分析
  'reliability',
  'efa',
  'cfa',
  'cvi',
  'harman',
  // 因果分析（v0.3.2）
  'mediation',
  'moderation',
  'moderated_mediation',
  'path_analysis',
  'sem'
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
  it('declares exactly the 24 planned method ids, uniquely', () => {
    expect(declaredIds.length).toBeGreaterThan(0)
    expect(new Set(declaredIds).size).toBe(declaredIds.length)
    // 双向精确比对：
    //   - arrayContaining 只保证"至少包含"，删掉一个方法不会变红 → 静默功能丢失
    //   - 这里同时锁住"不多不少"，新增/删除都必须显式改 REQUIRED_METHOD_IDS
    expect([...declaredIds].sort(), '方法集合与规划不一致（删/增方法须同步 REQUIRED_METHOD_IDS）').toEqual(
      [...REQUIRED_METHOD_IDS].sort()
    )
    // v0.3.0：14；v0.3.1：17（CFA / CVI / Harman）；v0.3.2：22（因果链五方法）；
    // v0.3.4：24（层次回归 / Logistic 回归）
    expect(REQUIRED_METHOD_IDS).toHaveLength(24)
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

/**
 * v0.3.2 具名变量角色（`roles` / `textInputs`）的一致性。
 *
 * ── 为什么必须单独锁一遍 ──
 * v0.3.1 及之前，向导用**位置**表达变量含义（`depVars[0]` 是因变量）。
 * 这对中介/调节完全不成立：`M = aX + e ; Y = c'X + bM + e` 里 X 与 M 谁在前，
 * 得到的是**完全不同的模型**，而且错了不会报错——只会静默输出一个
 * 看起来正常、含义相反的结论。
 *
 * 所以本节的测试要守住三件事：
 *   1. 需要具名角色的方法**确实声明了** roles（漏声明就会退回位置语义，静默错配）；
 *   2. 角色 id 在方法内唯一且只由 `[a-z]` 构成（生成器按这些字面量取值）；
 *   3. 每个 `labelKey` / `descKey` 在**两种语言**里都有文案（否则界面直接漏出 key）。
 * 第 3 条尤其重要：缺 key 不会报错，用户只会看到 `wizard.role.x` 这种字面量。
 */
const ROLE_REQUIRED_METHODS = ['mediation', 'moderation', 'moderated_mediation']
const TEXT_INPUT_REQUIRED_METHODS = ['path_analysis', 'sem']

/** 扁平化语言包的键集合（与 i18next 的点号查找语义一致） */
function localeKeys(file: string): Set<string> {
  const LOCALES = resolve(here, '../../i18n/locales')
  const raw = JSON.parse(readFileSync(resolve(LOCALES, file), 'utf8')) as Record<string, unknown>
  const out = new Set<string>()
  const walk = (node: unknown, prefix: string): void => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const key = prefix ? `${prefix}.${k}` : k
        out.add(key)
        walk(v, key)
      }
    }
  }
  walk(raw, '')
  return out
}

describe('v0.3.2 具名变量角色 / 文本参数一致性', () => {
  const byId = new Map(REGISTRY_METHODS.map((m) => [m.id, m]))

  it('中介 / 调节 / 有调节的中介都声明了 roles（否则退回位置语义，静默错配）', () => {
    for (const id of ROLE_REQUIRED_METHODS) {
      const m = byId.get(id)
      expect(m, `注册表缺少方法 "${id}"`).toBeDefined()
      const roles = m!.roles ?? []
      expect(roles.length, `方法 "${id}" 未声明 roles：变量含义只能靠位置表达，极易静默错配`).toBeGreaterThan(0)
    }
  })

  it('三个具名方法的角色 id 与契约一致，且方法内唯一', () => {
    // 顺序也是契约的一部分：生成器按 x/m/y(/w) 的语义取值，注释与文档同此口径
    const expected: Record<string, string[]> = {
      mediation: ['x', 'm', 'y'],
      moderation: ['x', 'w', 'y'],
      moderated_mediation: ['x', 'm', 'y', 'w']
    }
    for (const [id, want] of Object.entries(expected)) {
      const roles = byId.get(id)?.roles ?? []
      const got = roles.map((r) => r.id)
      expect(got, `方法 "${id}" 的角色集合/顺序与契约不符`).toEqual(want)
      expect(new Set(got).size, `方法 "${id}" 的角色 id 有重复`).toBe(got.length)
    }
  })

  it('每个角色都是数值型（这些方法目前只接受连续变量）', () => {
    for (const m of REGISTRY_METHODS) {
      for (const r of m.roles ?? []) {
        expect(r.varType, `方法 "${m.id}" 的角色 "${r.id}" 必须是 numeric`).toBe('numeric')
      }
    }
  })

  it('路径分析与 SEM 声明了 textInputs（结构无法用枚举表达）', () => {
    for (const id of TEXT_INPUT_REQUIRED_METHODS) {
      const m = byId.get(id)
      expect(m, `注册表缺少方法 "${id}"`).toBeDefined()
      const inputs = m!.textInputs ?? []
      expect(inputs.length, `方法 "${id}" 必须提供 textInputs`).toBeGreaterThan(0)
      for (const ti of inputs) {
        expect(ti.placeholder.trim().length, `"${id}" 的 textInput "${ti.id}" 缺少 placeholder`).toBeGreaterThan(0)
      }
    }
    // SEM 需要两段：测量模型（因子结构）+ 结构模型（结构路径）
    expect((byId.get('sem')?.textInputs ?? []).map((t) => t.id)).toEqual(['itemsByFactor', 'structure'])
    expect((byId.get('path_analysis')?.textInputs ?? []).map((t) => t.id)).toEqual(['pathSpec'])
  })

  it('角色与文本参数的 labelKey / descKey 在中英两种语言里都有文案', () => {
    const zh = localeKeys('zh-CN.json')
    const en = localeKeys('en-US.json')
    const missing: string[] = []
    for (const m of REGISTRY_METHODS) {
      for (const r of m.roles ?? []) {
        for (const key of [r.labelKey, r.descKey].filter(Boolean) as string[]) {
          if (!zh.has(key)) missing.push(`zh-CN 缺 ${key}（${m.id}/${r.id}）`)
          if (!en.has(key)) missing.push(`en-US 缺 ${key}（${m.id}/${r.id}）`)
        }
      }
      for (const ti of m.textInputs ?? []) {
        for (const key of [ti.labelKey, ti.descKey].filter(Boolean) as string[]) {
          if (!zh.has(key)) missing.push(`zh-CN 缺 ${key}（${m.id}/${ti.id}）`)
          if (!en.has(key)) missing.push(`en-US 缺 ${key}（${m.id}/${ti.id}）`)
        }
      }
    }
    expect(missing, `角色/文本参数缺少本地化文案（界面会直接显示 key）：\n${missing.join('\n')}`).toEqual([])
  })

  it('五个因果链方法的 nameKey / descKey / categoryKey 在两语言里都有文案', () => {
    const zh = localeKeys('zh-CN.json')
    const en = localeKeys('en-US.json')
    const missing: string[] = []
    for (const id of [...ROLE_REQUIRED_METHODS, ...TEXT_INPUT_REQUIRED_METHODS]) {
      const m = byId.get(id)!
      for (const key of [m.nameKey, m.descKey, m.categoryKey].filter(Boolean) as string[]) {
        if (!zh.has(key)) missing.push(`zh-CN 缺 ${key}（${id}）`)
        if (!en.has(key)) missing.push(`en-US 缺 ${key}（${id}）`)
      }
    }
    expect(missing).toEqual([])
  })

  it('声明了 roles 的方法不再依赖 needsGroup（角色数即变量数）', () => {
    // 具名角色方法与"位置 + 分组变量"那套语义互斥：
    // 两者同时生效时，UI 会同时渲染角色区和分组变量区，等于给用户两套互相矛盾的变量语义。
    for (const m of REGISTRY_METHODS) {
      if ((m.roles ?? []).length === 0) continue
      expect(m.needsGroup, `方法 "${m.id}" 声明了 roles 又要求分组变量，UI 会渲染两套矛盾语义`).toBe(false)
    }
  })

  /**
   * 分发分支必须**按角色**取值，不能退回 depVars 的位置下标。
   *
   * 这是本组测试里最要紧的一条：`roleVars` 渲染出来、`canProceed()` 校验了，
   * 但生成器那一行如果还写 `depVars[0]`，界面看起来一切正常，实际传进去的
   * 仍是"按点击顺序排列的变量"——中介的 M 与 Y 一旦调换，输出含义完全相反且不报错。
   * 所以这里直接对分发表的**源码行**做断言，而不是只看角色是否渲染。
   */
  it('三个具名方法的分发分支按 roleValue(角色) 取值，不用 depVars 下标', () => {
    const lines = wizardSrc.split('\n')
    const expectedRoles: Record<string, string[]> = {
      mediation: ['x', 'm', 'y'],
      moderation: ['x', 'w', 'y'],
      moderated_mediation: ['x', 'm', 'y', 'w']
    }
    for (const [id, roles] of Object.entries(expectedRoles)) {
      const line = lines.find((l) => new RegExp(`^\\s*'?${id}'?\\s*:\\s*\\(\\)\\s*=>`).test(l))
      expect(line, `分发表缺少方法 "${id}" 的行`).toBeTruthy()
      for (const role of roles) {
        expect(
          line!,
          `方法 "${id}" 的生成器没有读角色 "${role}"（roleValue('${role}')）——退回位置语义会静默错配`
        ).toContain(`roleValue('${role}')`)
      }
      // 反向断言：这三行不得再出现 depVars 下标（混用两套语义最容易埋错）
      expect(line!, `方法 "${id}" 的分发行仍在用 depVars 下标`).not.toMatch(/depVars\[\d\]/)
    }
  })

  it('canProceed 同时覆盖 roles 与 textInputs（不能只判变量个数）', () => {
    // 从 canProceed 函数体里取文本，确认两条校验都在
    const start = wizardSrc.indexOf('const canProceed = ')
    expect(start, 'WizardPage.tsx 未找到 canProceed').toBeGreaterThan(-1)
    const end = wizardSrc.indexOf('\n  const handleExecute', start)
    const body = wizardSrc.slice(start, end < 0 ? undefined : end)
    expect(body, 'canProceed 未校验 roles：具名方法可被"选够 N 个变量"放行').toMatch(/roles/)
    expect(body, 'canProceed 未校验 textInputs：路径/结构为空也能开始').toMatch(/textInputs/)
    // 角色校验必须是 every —— some 会让"只选了一个角色"也放行
    expect(body, 'canProceed 的 roles 校验必须是 every（每个角色都必选）').toMatch(/\.every\(/)
  })
})
