/**
 * 推荐预选的**应用逻辑**（v0.3.5 / T73）
 *
 * ── 为什么要把这段抽成纯函数 ──
 *
 * Lead 转述了另一个队友踩到的真实坑：**"纯函数测了、调用点没测，等于没测"**
 * ——把调用点改回去，29 个测试照样全绿。
 *
 * 推荐功能的跳转闭环正是这种高风险部位：`MethodRecommend` 里"点一下就跳转"
 * 看起来毫无逻辑，真正的判断全在"把 selection 变成向导页的 state"这一步：
 *
 *   - 方法 id 不存在怎么办？
 *   - 建议的变量里有列名拼错了怎么办？
 *   - 具名角色方法（中介）给了 roles，但 roles 里有不存在的列？
 *   - 位置式方法（相关/回归）给了 variables，但数量不够 minVars？
 *   - selection 是给 A 数据集的，但用户中途换了 B 数据集？
 *
 * 这些分支如果写在组件里，就只能靠渲染 DOM 才能测（本项目没有 DOM 测试环境）。
 * 抽成纯函数后可以逐条断言，而且 **WizardPage 必须调用它**——事件处理器
 * 里只做 `setState(applySelectionToWizard(...))`，没有第二处逻辑。
 *
 * ── 设计原则：绝不静默错配 ──
 *
 * 与 v0.3.2「变量角色」改造同一立场：变量填错不报错、只给出含义相反的结果，
 * 是这类功能最危险的失败模式。因此这里的所有"不吻合"都返回**显式的 warnings**，
 * 由 UI 展示给用户，而不是悄悄丢掉或悄悄填一个错的。
 */

import { METHODS, type AnalysisMethod } from '../data/methodRegistry'
import type { WizardSelection } from '../contexts/DataContext'

/** 应用结果：向导页需要设置的完整 state */
export interface WizardStatePatch {
  /** 选中的方法；无效 selection 时为 null */
  method: AnalysisMethod | null
  /** 位置式变量 */
  depVars: string[]
  /** 具名角色变量 */
  roleVars: Record<string, string>
  /** 文本参数 */
  textValues: Record<string, string>
  /** 分组变量 */
  groupVar: string
  /** 应当进入的步骤；无效时为 'select' */
  step: 'select' | 'configure'
  /** 应用过程中的提示（列不存在、角色缺失等），供 UI 告知用户 */
  warnings: SelectionWarning[]
}

/** 预选过程中的问题（不阻断，但必须让用户知道） */
export type SelectionWarning =
  | { kind: 'unknown_method'; methodId: string }
  | { kind: 'dropped_variable'; variable: string }
  | { kind: 'dropped_role'; roleId: string; variable: string }
  | { kind: 'unknown_role'; roleId: string }
  | { kind: 'missing_roles'; roleIds: string[] }
  | { kind: 'insufficient_variables'; min: number; actual: number }

/**
 * 把推荐结果转成向导页的 state。
 *
 * @param selection 推荐面板给出的预选内容
 * @param availableColumns 当前数据集里**真实存在**的列名（用于剔除拼错的列）
 *
 * 关键行为：
 * 1. **剔除不存在的列**。这是最重要的一条：`pendingSelection` 可能来自
 *    上一个数据集（虽然 DataContext 换数据时会清空，但调用方也可能传错）。
 *    把不存在的列名塞进 `depVars`，R 端会报 "object 'xxx' not found"，
 *    或者更糟——分析静默跑在错误的列上。
 * 2. **具名角色只填有效角色 id**。AI 可能给出 `{x, m, y, mediator}` 这种
 *    带幻觉的角色名；注册表里没有的角色必须丢弃并告警。
 * 3. **方法无效时返回 step='select'**，不选中任何方法——而不是随便选一个。
 */
export function applySelectionToWizard(
  selection: WizardSelection | null | undefined,
  availableColumns: string[]
): WizardStatePatch {
  const empty: WizardStatePatch = {
    method: null,
    depVars: [],
    roleVars: {},
    textValues: {},
    groupVar: '',
    step: 'select',
    warnings: []
  }
  if (!selection) return empty

  const method = METHODS.find((m) => m.id === selection.methodId)
  if (!method) {
    return { ...empty, warnings: [{ kind: 'unknown_method', methodId: selection.methodId }] }
  }

  const known = new Set(availableColumns)
  const warnings: SelectionWarning[] = []

  // ── 位置式变量 ──
  const depVars: string[] = []
  for (const v of selection.variables ?? []) {
    if (!known.has(v)) {
      warnings.push({ kind: 'dropped_variable', variable: v })
      continue
    }
    // 去重：AI 偶尔重复列同一个变量
    if (!depVars.includes(v)) depVars.push(v)
  }

  // ── 具名角色 ──
  const roleVars: Record<string, string> = {}
  const declaredRoles = new Set((method.roles ?? []).map((r) => r.id))
  for (const [roleId, variable] of Object.entries(selection.roles ?? {})) {
    if (!declaredRoles.has(roleId)) {
      // AI 幻觉出的角色名：丢弃
      warnings.push({ kind: 'unknown_role', roleId })
      continue
    }
    if (!known.has(variable)) {
      warnings.push({ kind: 'dropped_role', roleId, variable })
      continue
    }
    roleVars[roleId] = variable
  }

  // 具名角色方法缺角色 → 告警（仍进入 configure，让用户在界面上补）
  if (declaredRoles.size > 0) {
    const missing = [...declaredRoles].filter((id) => !roleVars[id])
    if (missing.length > 0) warnings.push({ kind: 'missing_roles', roleIds: missing })
  }

  // ── 位置式方法的变量数不足 → 告警（不猜、不补）──
  // 只在方法没有 roles 时检查：有 roles 的方法由角色数决定变量数。
  if (declaredRoles.size === 0 && depVars.length > 0 && depVars.length < method.minVars) {
    warnings.push({
      kind: 'insufficient_variables',
      min: method.minVars,
      actual: depVars.length
    })
  }

  // ── 文本参数 ──
  const textValues: Record<string, string> = {}
  for (const [id, value] of Object.entries(selection.texts ?? {})) {
    if (typeof value !== 'string' || !value.trim()) continue
    // 只保留该方法的合法 textInput id
    const declared = new Set((method.textInputs ?? []).map((t) => t.id))
    if (declared.size > 0 && !declared.has(id)) continue
    textValues[id] = value
  }

  // ── 分组变量 ──
  const groupVar =
    selection.groupVar && known.has(selection.groupVar) ? selection.groupVar : ''
  if (selection.groupVar && !groupVar) {
    warnings.push({ kind: 'dropped_variable', variable: selection.groupVar })
  }

  return {
    method,
    depVars,
    roleVars,
    textValues,
    groupVar,
    step: 'configure',
    warnings
  }
}

/** 警告 → i18n 键与参数（UI 负责渲染文案） */
export function describeWarning(w: SelectionWarning): {
  key: string
  params: Record<string, string | number>
} {
  switch (w.kind) {
    case 'unknown_method':
      return { key: 'recommend.apply.warn.unknownMethod', params: { method: w.methodId } }
    case 'dropped_variable':
      return { key: 'recommend.apply.warn.droppedVariable', params: { variable: w.variable } }
    case 'dropped_role':
      return {
        key: 'recommend.apply.warn.droppedRole',
        params: { role: w.roleId, variable: w.variable }
      }
    case 'unknown_role':
      return { key: 'recommend.apply.warn.unknownRole', params: { role: w.roleId } }
    case 'missing_roles':
      return { key: 'recommend.apply.warn.missingRoles', params: { roles: w.roleIds.join(', ') } }
    case 'insufficient_variables':
      return {
        key: 'recommend.apply.warn.insufficientVariables',
        params: { min: w.min, actual: w.actual }
      }
  }
}
