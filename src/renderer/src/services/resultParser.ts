/**
 * R 输出解析器
 *
 * v0.2.6 重写要点：
 * 1. 类型判定改为基于生成器输出的唯一横幅 `=== <方法名> ===`，
 *    不再使用 `output.includes('片段')` 启发式 —— 旧实现把 `' N='` 放在第一条，
 *    而所有分组统计行都是 `组1 (0): N=19`，导致 t 检验/ANOVA/单样本 t/非参数检验
 *    全被判为 descriptive，进而 tables 为空、三线表与 AI 解读都不显示。
 * 2. 补齐此前完全缺失的 parseNormality / parseFrequency / parseSummaryBy。
 * 3. 所有数值捕获组支持负号与科学计数（旧实现 `[\d.]` 会把含负值的变量静默丢弃）。
 * 4. p 值解析支持 `p = .026` / `p < 0.001` / `p = 1.2e-15`，同时保留显示串 pDisplay。
 * 5. 不再用 `||` 处理可能为 0 的数值（旧实现把合法的 p=0 变成 1 送进 AI Prompt）。
 */

/** 解析后的分析结果 */
export interface ParsedAnalysis {
  /** 分析类型 */
  type: string
  /** 三线表数据 */
  tables: TableData[]
  /** 关键数值（用于 AI 解读） */
  keyValues: Record<string, string | number>
  /** 原始文本输出 */
  rawOutput: string
  /** 诊断信息（假设检验、效应量、反向计分、警告），v0.2.6 新增 */
  diagnostics: Diagnostic[]
}

export interface Diagnostic {
  kind: 'assumption' | 'effect' | 'warning' | 'note' | 'method'
  label: string
  value: string
}

export interface TableData {
  title: string
  headers: string[]
  rows: (string | number)[][]
  note?: string
}

/**
 * 从 `key|field|field` 行中取字段。
 *
 * 注意：数值一律通过 toNum() 解析，而不是在正则里做数值捕获。
 * v0.2.5 用 /[\d.]+/ 之类的字符类捕获数值，既不含负号也不含科学计数，
 * 导致含负值的变量被整行静默丢弃（实测 4 个变量只出 1 行）。
 * 现在分隔符是 `|`，字段边界明确，不再依赖数值正则。
 */
function fields(line: string): string[] {
  return line.split('|')
}

/** 找到以 `TAG|` 开头的所有行 */
function tagged(output: string, tag: string): string[] {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith(tag + '|'))
}

function firstTagged(output: string, tag: string): string | null {
  const all = tagged(output, tag)
  return all.length > 0 ? all[0] : null
}

/** 数值解析：返回数字，NA/空返回 null */
function toNum(s: string | undefined): number | null {
  if (s === undefined) return null
  const t = s.trim()
  if (t === '' || t === 'NA' || t === 'NaN' || t === '—') return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/**
 * 解析 APA 风格 p 值行。
 * 支持：`p = 0.026` / `p < 0.001` / `p = 1.2e-15` / `p = NA`
 * 返回 { value, display }：value 为数值（`<` 时取边界值），display 为展示串。
 */
export function parsePValue(text: string): { value: number | null; display: string } {
  const m = text.match(/p\s*([=<>])\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/)
  if (!m) return { value: null, display: '' }
  const op = m[1]
  const v = Number(m[2])
  if (!Number.isFinite(v)) return { value: null, display: '' }
  if (op === '<') {
    return { value: v, display: `p < ${m[2]}` }
  }
  if (op === '>') {
    return { value: v, display: `p > ${m[2]}` }
  }
  // 常规等号：按 APA 习惯保留 3 位小数显示
  const isIntegerish = Math.abs(v - Math.round(v)) < 1e-12 && v > 0.999
  const display = isIntegerish ? `p = ${v.toFixed(3)}` : `p = ${v.toFixed(3)}`
  return { value: v, display }
}

/**
 * 从字段中提取 p 值。
 * 兼容三种形态：`p = 0.42` / `p < 0.001`（APA 展示串）与裸数值 `0.42`。
 * 旧实现直接把裸数值交给 parsePValue，因其缺少 `p =` 前缀而永远返回 null，
 * 导致相关分析等方法的 p 值列显示为「—」。
 */
function pFromField(s: string | undefined): { value: number | null; display: string } {
  if (!s) return { value: null, display: '' }
  const t = s.trim()
  if (t === '' || t === 'NA') return { value: null, display: '' }
  if (/^p\s*[=<>]/i.test(t)) return parsePValue(t)
  if (/^[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?$/.test(t)) return parsePValue(`p = ${t}`)
  return parsePValue(t)
}

/**
 * 取一行中的 (display, raw) 两个 p 字段。
 * v0.2.6 起所有含 p 值的行都同时输出「APA 展示串」与「原始数值」：
 * 展示串会把 1e-31 变成 "p < 0.001"（丢失精度），原始数值才可用于判断与 AI 解读。
 * 缺失 raw 字段时回退到展示串，兼容旧输出。
 */
function pPair(display: string | undefined, raw: string | undefined): {
  value: number | null
  display: string
} {
  const parsed = pFromField(display)
  const rawNum = toNum(raw)
  // 原始数值优先（展示串在 p < 0.001 时只有边界值 0.001，会丢失如 1e-31 的真实精度）
  const value = rawNum !== null ? rawNum : parsed.value
  const shown = parsed.display || (raw ? `p = ${raw}` : '')
  return { value, display: shown }
}

/**
 * 检测分析类型。
 *
 * **只认生成器输出的唯一横幅**（`=== <方法名> ===`）。
 *
 * 为什么不做字符子串回退：v0.2.5 的 `output.includes(' N=')` 放在第一条，
 * 而分组统计行恰好都是 `组1 (0): N=19` / `组 4: N=11` / `样本: N=32`，
 * 于是 t 检验、ANOVA、单样本 t、非参数检验全被判成 descriptive，
 * 解析器又匹配不到任何字段 → tables 为空 → 三线表与 AI 解读双双消失。
 *
 * 现在无法识别时一律返回 'unknown'（渲染为"无法识别该输出格式"），
 * 而不是猜一个类型再产出错误结果——猜错比不猜更危险。
 */
export function detectAnalysisType(output: string): string {
  // 生成器横幅形如 `=== 相关分析 (pearson) ===`
  const banner = output.match(/^===\s*(.+?)\s*===\s*$/m)
  const name = banner ? banner[1] : ''
  if (name) {
    if (name.startsWith('描述性统计')) return 'descriptive'
    if (name.startsWith('独立样本 t 检验')) return 'ttest_independent'
    if (name.startsWith('配对样本 t 检验')) return 'ttest_paired'
    if (name.startsWith('单样本 t 检验')) return 'ttest_one'
    if (name.startsWith('单因素方差分析')) return 'anova'
    if (name.startsWith('卡方检验')) return 'chisquare'
    if (name.startsWith('相关分析')) return 'correlation'
    if (name.startsWith('线性回归分析')) return 'regression'
    if (name.startsWith('信度分析')) return 'reliability'
    if (name.startsWith('正态性检验')) return 'normality'
    if (name.startsWith('非参数检验')) return 'nonparametric'
    if (name.startsWith('频数统计')) return 'frequency'
    if (name.startsWith('分类汇总')) return 'summary_by'
    if (name.startsWith('探索性因子分析')) return 'efa'
    // v0.3.1 效度线。三者仍然只做**横幅前缀**的确定性匹配：
    //   `=== 验证性因子分析 (CFA) ===` / `=== 内容效度指数 (CVI) ===` /
    //   `=== Harman 单因子检验 ===`
    // 注意「探索性因子分析」与「验证性因子分析」是不同方法，前缀不可互相包含，
    // 故必须并列写死两个分支，不能靠子串（`includes('因子分析')`）区分。
    // Harman 的横幅中间是半角空格；R 端若因排版改动多打了空格，
    // 允许 `\s+` 容忍，但仍要求出现在横幅开头。
    if (name.startsWith('验证性因子分析')) return 'cfa'
    if (name.startsWith('内容效度指数')) return 'cvi'
    if (/^Harman\s+单因子检验/.test(name)) return 'harman'
  }
  return 'unknown'
}

/** 收集诊断信息（假设检验 / 效应量 / 警告 / 备注 / 检验方法） */
function collectDiagnostics(output: string): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const line of tagged(output, 'ASSUMPTION')) {
    const f = fields(line)
    const p = pPair(f[2], f[3])
    out.push({
      kind: 'assumption',
      label: `${f[1]} 方差齐性检验`,
      value: p.value === null ? '无法计算' : p.display
    })
  }
  for (const line of tagged(output, 'EFFECT')) {
    const f = fields(line)
    const labelMap: Record<string, string> = { eta2: 'η²', omega2: 'ω²', cohen_d: "Cohen's d" }
    out.push({ kind: 'effect', label: labelMap[f[1]] ?? f[1], value: f[2] ?? '' })
  }
  for (const line of tagged(output, 'METHOD')) {
    out.push({ kind: 'method', label: '检验方法', value: fields(line)[1] ?? '' })
  }
  for (const line of tagged(output, 'REVERSED')) {
    out.push({ kind: 'note', label: '已反向计分的项目', value: fields(line)[1] ?? '' })
  }
  for (const line of tagged(output, 'RESID_NORMAL')) {
    const f = fields(line)
    out.push({ kind: 'assumption', label: '残差正态性 (Shapiro-Wilk)', value: f[1] ?? '' })
  }
  for (const line of tagged(output, 'MU_IN_CI')) {
    out.push({ kind: 'note', label: '检验值落在 95% CI 内', value: fields(line)[1] ?? '' })
  }
  for (const line of tagged(output, 'WARN_EXPECTED')) {
    out.push({ kind: 'warning', label: '卡方适用性', value: fields(line)[1] ?? '' })
  }
  for (const line of tagged(output, 'NOTE_DROPPED')) {
    out.push({ kind: 'warning', label: '缺失值处理', value: fields(line)[1] ?? '' })
  }
  // EFA 的前提诊断：KMO 与 Bartlett 决定"能不能做因子分析"
  for (const line of tagged(output, 'KMO')) {
    const v = fields(line)[1] ?? ''
    out.push({ kind: 'assumption', label: 'KMO 取样适切性', value: v })
  }
  for (const line of tagged(output, 'BARTLETT')) {
    const f = fields(line)
    const p = pPair(f[3], f[4])
    out.push({
      kind: 'assumption',
      label: 'Bartlett 球形检验',
      value: p.display || (f[3] ?? '')
    })
  }
  for (const line of tagged(output, 'NFACTOR')) {
    out.push({ kind: 'note', label: '抽取因子数', value: fields(line)[1] ?? '' })
  }
  // 以下为 v0.3.1 效度线专有诊断。
  // CFA 的 CFA_NOTE 与 CVI 的 CVI_NOTE 都是自由文本（Heywood 案例、样本量提示、
  // 专家数偏少等），直接透传为 warning：它们本身就代表"结果需谨慎对待"。
  for (const line of tagged(output, 'CFA_NOTE')) {
    out.push({ kind: 'warning', label: 'CFA 提示', value: fields(line).slice(1).join('|') })
  }
  for (const line of tagged(output, 'CVI_NOTE')) {
    out.push({ kind: 'warning', label: 'CVI 提示', value: fields(line).slice(1).join('|') })
  }
  for (const line of tagged(output, 'HARMAN_NOTE')) {
    out.push({ kind: 'note', label: 'Harman 检验提示', value: fields(line).slice(1).join('|') })
  }
  return out
}

/** 解析 R 输出 */
export function parseROutput(output: string): ParsedAnalysis {
  const type = detectAnalysisType(output)
  const tables: TableData[] = []
  const keyValues: Record<string, string | number> = {}

  switch (type) {
    case 'descriptive':
      parseDescriptive(output, tables, keyValues)
      break
    case 'ttest_independent':
      parseTTestIndependent(output, tables, keyValues)
      break
    case 'ttest_paired':
      parseTTestPaired(output, tables, keyValues)
      break
    case 'ttest_one':
      parseTTestOneSample(output, tables, keyValues)
      break
    case 'correlation':
      parseCorrelation(output, tables, keyValues)
      break
    case 'regression':
      parseRegression(output, tables, keyValues)
      break
    case 'reliability':
      parseReliability(output, tables, keyValues)
      break
    case 'anova':
      parseAnova(output, tables, keyValues)
      break
    case 'chisquare':
      parseChiSquare(output, tables, keyValues)
      break
    case 'normality':
      parseNormality(output, tables, keyValues)
      break
    case 'nonparametric':
      parseNonparametric(output, tables, keyValues)
      break
    case 'frequency':
      parseFrequency(output, tables, keyValues)
      break
    case 'summary_by':
      parseSummaryBy(output, tables, keyValues)
      break
    case 'efa':
      parseEfa(output, tables, keyValues)
      break
    case 'cfa':
      parseCfa(output, tables, keyValues)
      break
    case 'cvi':
      parseCvi(output, tables, keyValues)
      break
    case 'harman':
      parseHarman(output, tables, keyValues)
      break
    default:
      break
  }

  return { type, tables, keyValues, rawOutput: output, diagnostics: collectDiagnostics(output) }
}

/** 结论行 */
function conclusionOf(output: string): string {
  const c = firstTagged(output, 'CONCL')
  return c ? fields(c)[1] ?? '' : ''
}

/** 解析描述性统计 */
function parseDescriptive(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const rows: (string | number)[][] = []
  let totalN = 0
  const info = new Map<string, { missing: number; total: number }>()
  for (const line of tagged(output, '__INFO__')) {
    const f = fields(line)
    const varName = (f[1] ?? '').replace(/^__INFO__:/, '')
    const missing = toNum((f[2] ?? '').replace('缺失=', ''))
    const total = toNum((f[3] ?? '').replace('总计=', ''))
    if (varName) info.set(varName, { missing: missing ?? 0, total: total ?? 0 })
  }

  for (const line of output.split('\n')) {
    const t = line.trim()
    // 数据行：name|N|M|SD|Min|Max|Median （跳过 __INFO__ 与横幅）
    if (t.startsWith('===') || t.startsWith('__') || t.startsWith('WARN') || t.startsWith('NOTE')) continue
    const f = fields(t)
    if (f.length !== 7) continue
    const n = toNum(f[1])
    if (n === null) continue
    const rec = info.get(f[0])
    rows.push([
      f[0],
      n,
      toNum(f[2]) ?? '—',
      toNum(f[3]) ?? '—',
      toNum(f[4]) ?? '—',
      toNum(f[5]) ?? '—',
      toNum(f[6]) ?? '—',
      rec ? rec.missing : '—'
    ])
    if (n > totalN) totalN = n
  }

  if (rows.length > 0) {
    tables.push({
      title: '表1  描述性统计结果',
      headers: ['变量', 'N', 'M', 'SD', 'Min', 'Max', 'Median', '缺失'],
      rows,
      note: '注：M = 均值，SD = 标准差，N = 有效样本量，缺失 = 缺失值个数。'
    })
    kv['变量数'] = rows.length
    kv['样本量'] = totalN
  }
}

/** 解析独立样本 t 检验 */
function parseTTestIndependent(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const groupRows: (string | number)[][] = []
  for (const line of tagged(output, 'GRP')) {
    const f = fields(line)
    groupRows.push([f[1], toNum(f[2]) ?? '—', toNum(f[3]) ?? '—', toNum(f[4]) ?? '—'])
  }
  if (groupRows.length > 0) {
    tables.push({
      title: '表1  各组描述统计',
      headers: ['组别', 'N', 'M', 'SD'],
      rows: groupRows,
      note: '注：M = 均值，SD = 标准差。'
    })
  }

  const res = firstTagged(output, 'RESULT_IND')
  if (res) {
    const f = fields(res)
    const p = pPair(f[3], f[4])
    // 字段契约（与 rService.tTestIndependentCode 的 sprintf 一一对应）：
    //   f[0]=TAG f[1]=t f[2]=df f[3]=p展示串 f[4]=p原始值
    //   f[5]=均值差 f[6]=CI下限 f[7]=CI上限 f[8]=Cohen's d f[9]=合并方差p
    // v0.2.7 修复：均值差曾误取 f[6]（=CI下限），导致表里显示 "-11.2805"
    // 而 keyValues['均值差'] 用的是正确的 f[5]（-7.2449）——表与值互相矛盾。
    tables.push({
      title: `表${tables.length + 1}  独立样本 t 检验结果`,
      headers: ['t', 'df', 'p', '均值差', '95% CI 下限', '95% CI 上限', "Cohen's d"],
      rows: [[
        toNum(f[1]) ?? '—',
        toNum(f[2]) ?? '—',
        p.display || '—',
        toNum(f[5]) ?? '—',
        toNum(f[6]) ?? '—',
        toNum(f[7]) ?? '—',
        toNum(f[8]) ?? '—'
      ]],
      note: `注：${p.value !== null && p.value < 0.05 ? 'p < 0.05，差异显著。' : 'p ≥ 0.05，差异不显著。'}`
    })
    kv['t'] = toNum(f[1]) ?? 0
    kv['df'] = toNum(f[2]) ?? 0
    if (p.value !== null) kv['p'] = p.value
    if (p.display) kv['pDisplay'] = p.display
    kv['cohen_d'] = toNum(f[8]) ?? 'NA'
    kv['均值差'] = toNum(f[5]) ?? 0
  }

  const pooled = firstTagged(output, 'RESULT_POOLED')
  if (pooled) {
    const f = fields(pooled)
    const p = pPair(f[3], f[4])
    kv['t_pooled'] = toNum(f[1]) ?? 0
    kv['p_pooled'] = p.value ?? 0
  }
  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/** 解析配对样本 t 检验 */
function parseTTestPaired(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const pairs = firstTagged(output, 'PAIRS')
  if (pairs) {
    const f = fields(pairs)
    tables.push({
      title: '表1  配对描述统计',
      headers: ['变量1', '变量2', '配对 N', '差值均值', '差值 SD'],
      rows: [[f[1], f[2], toNum(f[3]) ?? '—', toNum(f[4]) ?? '—', toNum(f[5]) ?? '—']],
      note: '注：差值为「变量1 − 变量2」。'
    })
    kv['配对N'] = toNum(f[3]) ?? 0
    kv['差值均值'] = toNum(f[4]) ?? 0
  }

  const res = firstTagged(output, 'RESULT_PAIRED')
  if (res) {
    const f = fields(res)
    const p = pPair(f[3], f[4])
    tables.push({
      title: `表${tables.length + 1}  配对样本 t 检验结果`,
      headers: ['t', 'df', 'p', '均值差', '95% CI 下限', '95% CI 上限', "Cohen's dz"],
      rows: [[
        toNum(f[1]) ?? '—',
        toNum(f[2]) ?? '—',
        p.display || '—',
        toNum(f[5]) ?? '—',
        toNum(f[6]) ?? '—',
        toNum(f[7]) ?? '—',
        toNum(f[8]) ?? '—'
      ]],
      note: `注：${p.value !== null && p.value < 0.05 ? 'p < 0.05，两次测量差异显著。' : 'p ≥ 0.05，两次测量差异不显著。'}`
    })
    kv['t'] = toNum(f[1]) ?? 0
    kv['df'] = toNum(f[2]) ?? 0
    if (p.value !== null) kv['p'] = p.value
    if (p.display) kv['pDisplay'] = p.display
    kv['cohen_dz'] = toNum(f[8]) ?? 'NA'
  }
  const cor = firstTagged(output, 'PAIR_COR')
  if (cor) kv['配对相关'] = toNum(fields(cor)[1]) ?? 'NA'
  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/** 解析单样本 t 检验 */
function parseTTestOneSample(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const desc = firstTagged(output, 'DESC_ONE')
  if (desc) {
    const f = fields(desc)
    tables.push({
      title: '表1  描述统计',
      headers: ['变量', 'N', 'M', 'SD', '检验值 μ₀'],
      rows: [[f[1], toNum(f[2]) ?? '—', toNum(f[3]) ?? '—', toNum(f[4]) ?? '—', toNum(f[5]) ?? '—']],
      note: '注：M = 均值，SD = 标准差，μ₀ = 检验值。'
    })
    kv['N'] = toNum(f[2]) ?? 0
    kv['M'] = toNum(f[3]) ?? 0
    kv['mu'] = toNum(f[5]) ?? 0
  }

  const res = firstTagged(output, 'RESULT_ONE')
  if (res) {
    const f = fields(res)
    const p = pPair(f[3], f[4])
    // 字段契约（与 rService.tTestOneSampleCode 的 sprintf 一一对应）：
    //   f[0]=TAG f[1]=t f[2]=df f[3]=p展示串 f[4]=p原始值
    //   f[5]=CI下限 f[6]=CI上限 f[7]=Cohen's d
    // v0.2.7 修复：CI下限曾误取 f[4]（=p原始值，显示成 0.9328），
    // Cohen's d 曾误取 f[6]（=CI上限，显示成 2.2636）。
    tables.push({
      title: `表${tables.length + 1}  单样本 t 检验结果`,
      headers: ['t', 'df', 'p', '95% CI 下限', '95% CI 上限', "Cohen's d"],
      rows: [[
        toNum(f[1]) ?? '—',
        toNum(f[2]) ?? '—',
        p.display || '—',
        toNum(f[5]) ?? '—',
        toNum(f[6]) ?? '—',
        toNum(f[7]) ?? '—'
      ]],
      note: `注：${p.value !== null && p.value < 0.05 ? 'p < 0.05，差异显著。' : 'p ≥ 0.05，差异不显著。'}`
    })
    kv['t'] = toNum(f[1]) ?? 0
    kv['df'] = toNum(f[2]) ?? 0
    if (p.value !== null) kv['p'] = p.value
    if (p.display) kv['pDisplay'] = p.display
    kv['cohen_d'] = toNum(f[7]) ?? 'NA'
  }
  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/** 解析单因素方差分析 */
function parseAnova(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const groupRows: (string | number)[][] = []
  for (const line of tagged(output, 'GRP')) {
    const f = fields(line)
    groupRows.push([f[1], toNum(f[2]) ?? '—', toNum(f[3]) ?? '—', toNum(f[4]) ?? '—'])
  }
  if (groupRows.length > 0) {
    tables.push({
      title: '表1  各组描述统计',
      headers: ['组别', 'N', 'M', 'SD'],
      rows: groupRows,
      note: '注：M = 均值，SD = 标准差。'
    })
  }

  const anovaRows: (string | number)[][] = []
  for (const line of tagged(output, 'ANOVA_ROW')) {
    const f = fields(line)
    // ANOVA_ROW|source|df|ss|ms|F|p_display|p_raw
    anovaRows.push([
      f[1],
      toNum(f[2]) ?? '—',
      toNum(f[3]) ?? '—',
      toNum(f[4]) ?? '—',
      toNum(f[5]) ?? '—',
      f[6] || '—'
    ])
  }
  if (anovaRows.length > 0) {
    // 主效应行：(tag,source,df,ss,ms,F,p_display,p_raw) -> p_raw 在索引 7
    const f = fields(tagged(output, 'ANOVA_ROW')[0])
    // 优先使用原始数值（fmt_p 的 "< 0.001" 只有边界值，会丢失真实精度如 1e-31）
    const p = pPair(f[6], f[7])
    tables.push({
      title: `表${tables.length + 1}  单因素方差分析结果`,
      headers: ['变异来源', 'Df', 'SS', 'MS', 'F', 'p'],
      rows: anovaRows,
      note: `注：η² 为效应量；${p.value !== null && p.value < 0.05 ? 'p < 0.05，组间差异显著。' : 'p ≥ 0.05，组间差异不显著。'}`
    })
    kv['F'] = toNum(f[5]) ?? 0
    if (p.value !== null) kv['p'] = p.value
    if (p.display) kv['pDisplay'] = p.display
    kv['df1'] = toNum(f[2]) ?? 0
  }

  for (const line of tagged(output, 'EFFECT')) {
    const f = fields(line)
    if (f[1] === 'eta2') kv['eta2'] = toNum(f[2]) ?? 'NA'
    if (f[1] === 'omega2') kv['omega2'] = toNum(f[2]) ?? 'NA'
  }

  const posthoc: (string | number)[][] = []
  for (const line of tagged(output, 'POSTHOC')) {
    const f = fields(line)
    const p = pPair(f[5], f[6])
    posthoc.push([f[1], toNum(f[2]) ?? '—', toNum(f[3]) ?? '—', toNum(f[4]) ?? '—', p.display || '—'])
  }
  if (posthoc.length > 0) {
    tables.push({
      title: `表${tables.length + 1}  事后多重比较 (Tukey HSD)`,
      headers: ['比较组', '差值', 'CI 下限', 'CI 上限', 'p'],
      rows: posthoc,
      note: '注：Tukey HSD 已校正多重比较。'
    })
  }

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/** 解析卡方检验 */
function parseChiSquare(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const res = firstTagged(output, 'RESULT_CHISQ')
  if (res) {
    const f = fields(res)
    const p = pPair(f[3], f[4])
    tables.push({
      title: '表1  卡方检验结果',
      headers: ['χ²', 'df', 'p', "Cramér's V"],
      rows: [[toNum(f[1]) ?? '—', toNum(f[2]) ?? '—', p.display || '—', toNum(f[4]) ?? '—']],
      note: `注：${p.value !== null && p.value < 0.05 ? 'p < 0.05，关联显著。' : 'p ≥ 0.05，关联不显著。'}`
    })
    kv['chi2'] = toNum(f[1]) ?? 0
    kv['df'] = toNum(f[2]) ?? 0
    if (p.value !== null) kv['p'] = p.value
    if (p.display) kv['pDisplay'] = p.display
    kv['cramer_v'] = toNum(f[5]) ?? 'NA'
  }
  const meth = firstTagged(output, 'METHOD')
  if (meth) kv['检验方法'] = fields(meth)[1] ?? ''
  const fisher = firstTagged(output, 'FISHER')
  if (fisher) kv['Fisher精确检验'] = fields(fisher)[1] ?? ''
  const dim = firstTagged(output, 'TABLE_DIM')
  if (dim) {
    const f = fields(dim)
    kv['列联表'] = `${f[1]}×${f[2]}`
  }
  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/** 解析正态性检验 */
function parseNormality(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const rows: (string | number)[][] = []
  let nonNormal = 0
  for (const line of tagged(output, 'NORM')) {
    const f = fields(line)
    // NORM|var|n|W|p|skew|kurt|conclusion
    const p = pPair(f[4], f[5])
    rows.push([
      f[1],
      toNum(f[2]) ?? '—',
      toNum(f[3]) ?? '—',
      p.value !== null ? p.display : f[4] || '—',
      toNum(f[6]) ?? '—',
      toNum(f[7]) ?? '—',
      f[8] ?? ''
    ])
    if ((f[8] ?? '').includes('拒绝')) nonNormal++
  }
  if (rows.length > 0) {
    tables.push({
      title: '表1  正态性检验结果 (Shapiro-Wilk)',
      headers: ['变量', 'N', 'W', 'p', '偏度', '峰度', '结论'],
      rows,
      note: '注：p ≥ 0.05 表示未拒绝正态性假设（不等于「数据正态」）；小样本时检验功效较低，大样本时对微小偏离敏感。'
    })
    kv['变量数'] = rows.length
    kv['非正态变量数'] = nonNormal
  }
}

/** 解析非参数检验（Mann-Whitney U） */
function parseNonparametric(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const groupRows: (string | number)[][] = []
  for (const line of tagged(output, 'GRP')) {
    const f = fields(line)
    groupRows.push([
      f[1],
      toNum(f[2]) ?? '—',
      toNum(f[3]) ?? '—',
      toNum(f[4]) ?? '—',
      toNum(f[5]) ?? '—'
    ])
  }
  if (groupRows.length > 0) {
    tables.push({
      title: '表1  各组描述统计（中位数与四分位）',
      headers: ['组别', 'N', '中位数', 'Q1', 'Q3'],
      rows: groupRows,
      note: '注：非参数检验报告中位数与四分位数，而非均值与标准差。'
    })
  }

  const res = firstTagged(output, 'RESULT_MW')
  if (res) {
    const f = fields(res)
    const p = pPair(f[3], f[4])
    tables.push({
      title: `表${tables.length + 1}  Mann-Whitney U 检验结果`,
      headers: ['U', 'p', '秩二列相关 r'],
      rows: [[toNum(f[1]) ?? '—', p.display || '—', toNum(f[3]) ?? '—']],
      note: `注：${p.value !== null && p.value < 0.05 ? 'p < 0.05，差异显著。' : 'p ≥ 0.05，差异不显著。'}`
    })
    kv['U'] = toNum(f[1]) ?? 0
    if (p.value !== null) kv['p'] = p.value
    if (p.display) kv['pDisplay'] = p.display
    kv['rank_biserial'] = toNum(f[4]) ?? 'NA'
  }
  const meth = firstTagged(output, 'METHOD')
  if (meth) kv['检验方法'] = fields(meth)[1] ?? ''
  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/** 解析频数统计 */
function parseFrequency(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const heads: Record<string, { valid: number; missing: number }> = {}
  for (const line of tagged(output, 'FREQ_HEAD')) {
    const f = fields(line)
    heads[f[1]] = { valid: toNum(f[2]) ?? 0, missing: toNum(f[3]) ?? 0 }
  }

  const byVar = new Map<string, (string | number)[][]>()
  for (const line of tagged(output, 'FREQ')) {
    const f = fields(line)
    // FREQ|var|level|count|pct_valid|pct_total
    if (!byVar.has(f[1])) byVar.set(f[1], [])
    byVar.get(f[1])!.push([
      f[2],
      toNum(f[3]) ?? '—',
      toNum(f[4]) ?? '—',
      toNum(f[5]) ?? '—'
    ])
  }

  let idx = 0
  for (const [varName, rows] of byVar) {
    idx++
    const h = heads[varName]
    tables.push({
      title: `表${idx}  频数统计：${varName}`,
      headers: ['类别', '频数', '占有效值 %', '占总数 %'],
      rows,
      note: `注：有效值 N = ${h?.valid ?? '—'}，缺失 = ${h?.missing ?? '—'}。`
    })
    kv[`${varName}_有效N`] = h?.valid ?? 0
    kv[`${varName}_缺失`] = h?.missing ?? 0
  }
}

/** 解析分类汇总 */
function parseSummaryBy(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const vars = firstTagged(output, 'VARS')
  const rows: (string | number)[][] = []
  for (const line of tagged(output, 'SUM')) {
    const f = fields(line)
    // SUM|level|n|mean|[sd]|median|min|max  或  SUM|level|n|mean|NA|NA|min|max
    const n = fields(line).length
    if (n >= 8) {
      rows.push([
        f[1], toNum(f[2]) ?? '—', toNum(f[3]) ?? '—', toNum(f[4]) ?? '—',
        toNum(f[6]) ?? '—', toNum(f[6]) ?? '—', toNum(f[7]) ?? '—'
      ])
    } else {
      rows.push([f[1], toNum(f[2]) ?? '—', toNum(f[3]) ?? '—', '—', '—', toNum(f[5]) ?? '—', toNum(f[6]) ?? '—'])
    }
  }
  if (rows.length > 0) {
    tables.push({
      title: '表1  分组描述统计',
      headers: ['组别', 'N', 'M', 'SD', 'Median', 'Min', 'Max'],
      rows,
      note: '注：M = 均值，SD = 标准差。'
    })
  }
  const total = firstTagged(output, 'TOTAL')
  if (total) {
    const f = fields(total)
    kv['总N'] = toNum(f[1]) ?? 0
    kv['总均值'] = toNum(f[2]) ?? 0
    kv['总SD'] = toNum(f[3]) ?? 0
  }
  if (vars) {
    const f = fields(vars)
    kv['分组变量'] = f[1] ?? ''
    kv['汇总变量'] = f[2] ?? ''
  }
}

/** 解析相关分析 */
function parseCorrelation(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const res = firstTagged(output, 'RESULT_COR')
  const varsLine = firstTagged(output, 'VARS')
  const method = varsLine ? fields(varsLine)[3] ?? 'pearson' : 'pearson'
  const estimateName = method === 'spearman' ? 'ρ' : 'r'
  if (res) {
    const f = fields(res)
    const p = pPair(f[2], f[3])
    const ci = firstTagged(output, 'CI_COR')
    const ciF = ci ? fields(ci) : null
    tables.push({
      title: '表1  相关分析结果',
      headers: [estimateName, 'p', 'N', '95% CI 下限', '95% CI 上限'],
      rows: [[
        toNum(f[1]) ?? '—',
        p.display || '—',
        toNum(f[4]) ?? '—',
        ciF ? toNum(ciF[1]) ?? '—' : '—',
        ciF ? toNum(ciF[2]) ?? '—' : '—'
      ]],
      note: `注：${estimateName} 为 ${method === 'spearman' ? 'Spearman 等级' : 'Pearson 积差'}相关系数。${p.value !== null && p.value < 0.05 ? 'p < 0.05，相关显著。' : 'p ≥ 0.05，相关不显著。'}`
    })
    kv[estimateName] = toNum(f[1]) ?? 0
    if (p.value !== null) kv['p'] = p.value
    if (p.display) kv['pDisplay'] = p.display
    kv['N'] = toNum(f[4]) ?? 0
    kv['相关系数类型'] = method
  }
  const desc = firstTagged(output, 'DESC_COR')
  if (desc) {
    const f = fields(desc)
    kv['X均值'] = toNum(f[2]) ?? 0
    kv['Y均值'] = toNum(f[4]) ?? 0
  }
  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/** 解析回归分析 */
function parseRegression(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const model = firstTagged(output, 'MODEL')
  if (model) {
    const f = fields(model)
    const p = pPair(f[4], f[5])
    tables.push({
      title: '表1  回归模型摘要',
      headers: ['R²', '调整 R²', 'F', 'p', '残差标准误'],
      rows: [[
        toNum(f[1]) ?? '—',
        toNum(f[2]) ?? '—',
        toNum(f[4]) ?? '—',
        p.display || '—',
        toNum(f[6]) ?? '—'
      ]],
      note: '注：R² = 决定系数，调整 R² 校正了自变量个数。'
    })
    kv['R2'] = toNum(f[1]) ?? 0
    kv['adjR2'] = toNum(f[2]) ?? 0
    kv['F'] = toNum(f[3]) ?? 0
    if (p.value !== null) kv['p'] = p.value
    if (p.display) kv['pDisplay'] = p.display
  }

  const dfLine = firstTagged(output, 'MODEL_DF')
  if (dfLine) {
    const f = fields(dfLine)
    kv['N'] = toNum(f[1]) ?? 0
    kv['df1'] = toNum(f[2]) ?? 0
    kv['df2'] = toNum(f[3]) ?? 0
  }

  // 系数表：支持含空格与非 ASCII 的变量名（旧实现用 ^(\S+) 会整行丢弃）
  const betas = new Map<string, number>()
  for (const line of tagged(output, 'BETA')) {
    const f = fields(line)
    const v = toNum(f[2])
    if (v !== null) betas.set(f[1], v)
  }
  const vifs = new Map<string, number>()
  for (const line of tagged(output, 'VIF')) {
    const f = fields(line)
    const v = toNum(f[2])
    if (v !== null) vifs.set(f[1], v)
  }

  const coefRows: (string | number)[][] = []
  for (const line of tagged(output, 'COEF')) {
    const f = fields(line)
    const beta = betas.get(f[1])
    const vif = vifs.get(f[1])
    coefRows.push([
      f[1],
      toNum(f[2]) ?? '—',
      toNum(f[3]) ?? '—',
      toNum(f[4]) ?? '—',
      toNum(f[5]) ?? '—',
      beta === undefined ? '—' : beta,
      vif === undefined ? '—' : vif
    ])
  }
  if (coefRows.length > 0) {
    tables.push({
      title: '表2  回归系数',
      headers: ['变量', 'B', 'SE', 't', 'p', 'β', 'VIF'],
      rows: coefRows,
      note: '注：B = 非标准化回归系数，β = 标准化回归系数，VIF > 10 提示存在严重共线性。'
    })
    kv['系数项数'] = coefRows.length
  }

  const resid = firstTagged(output, 'RESID_NORMAL')
  if (resid) kv['残差正态性'] = fields(resid)[1] ?? ''
  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/** 解析信度分析 */
function parseReliability(output: string, tables: TableData[], kv: Record<string, string | number>) {
  const alphaLine = firstTagged(output, 'ALPHA')
  const items = firstTagged(output, 'ITEMS')
  const ci = firstTagged(output, 'ALPHA_CI')
  const reversed = firstTagged(output, 'REVERSED')

  if (alphaLine) {
    const f = fields(alphaLine)
    const alpha = toNum(f[1])
    const alphaStd = toNum(f[2])
    const ciF = ci ? fields(ci) : null
    const itemF = items ? fields(items) : null
    tables.push({
      title: "表1  信度分析结果 (Cronbach's α)",
      headers: ['α', '标准化 α', '项目数', '有效样本', '95% CI 下限', '95% CI 上限'],
      rows: [[
        alpha === null ? '—' : alpha,
        alphaStd === null ? '—' : alphaStd,
        itemF ? toNum(itemF[1]) ?? '—' : '—',
        itemF ? toNum(itemF[2]) ?? '—' : '—',
        ciF ? toNum(ciF[1]) ?? '—' : '—',
        ciF ? toNum(ciF[2]) ?? '—' : '—'
      ]],
      note: `注：α ≥ 0.7 为可接受水平。${reversed ? `检测到需反向计分的项目（${fields(reversed)[1]}），已自动反向计分。` : ''}`
    })
    if (alpha !== null) kv['alpha'] = alpha
    if (alphaStd !== null) kv['alpha_standardized'] = alphaStd
    if (itemF) kv['项目数'] = toNum(itemF[1]) ?? 0
    if (reversed) kv['反向计分项目'] = fields(reversed)[1] ?? ''
  }

  const itemRows: (string | number)[][] = []
  for (const line of tagged(output, 'ITEM')) {
    const f = fields(line)
    itemRows.push([
      f[1],
      toNum(f[2]) ?? '—',
      toNum(f[3]) ?? '—',
      toNum(f[4]) ?? '—',
      toNum(f[5]) ?? '—'
    ])
  }
  if (itemRows.length > 0) {
    tables.push({
      title: `表${tables.length + 1}  项目分析（逐项删除）`,
      headers: ['项目', 'M', 'SD', '校正后项总相关', '删除后 α'],
      rows: itemRows,
      note: '注：项总相关 < 0.3 或删除后 α 明显上升的项目建议复核。'
    })
  }

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/**
 * 解析探索性因子分析（EFA）。
 *
 * 与其他解析器不同，这里的表结构是**动态的**：因子数由数据决定（Kaiser 准则或
 * 用户指定），所以列数不能写死。R 端先输出 `LOAD_HEAD|item|F1|F2|...|communality`
 * 声明列，再逐行输出 `LOAD|item|v1|v2|...|comm`。
 *
 * v0.3.0 的教训：解析器必须**以 R 端声明的表头为准**，而不是硬编码列名——
 * 这正是 v0.2.6 两处列错位（t 检验取错下标）的同类风险。动态表头让"加一个因子"
 * 不需要改解析器。
 */
function parseEfa(output: string, tables: TableData[], kv: Record<string, string | number>) {
  // ── 样本量与因子数 ──
  const nfacLine = firstTagged(output, 'NFACTOR')
  const nFactors = nfacLine ? (toNum(fields(nfacLine)[1]) ?? 0) : 0
  if (nFactors > 0) kv['因子数'] = nFactors

  // ── KMO ──
  const kmoLine = firstTagged(output, 'KMO')
  const kmo = kmoLine ? toNum(fields(kmoLine)[1]) : null
  if (kmo !== null) kv['KMO'] = kmo

  // ── Bartlett 球形检验 ──
  const bart = firstTagged(output, 'BARTLETT')
  if (bart) {
    const f = fields(bart)
    const p = pPair(f[3], f[4])
    kv['Bartlett χ²'] = toNum(f[1]) ?? 0
    kv['Bartlett df'] = toNum(f[2]) ?? 0
    if (p.value !== null) kv['Bartlett p'] = p.value
  }

  // ── 表1：KMO 与 Bartlett 检验 ──
  {
    const rows: (string | number)[][] = []
    if (kmo !== null) {
      const kmoDesc =
        kmo >= 0.9 ? '极佳' : kmo >= 0.8 ? '适合' : kmo >= 0.7 ? '尚可' : kmo >= 0.6 ? '勉强' : '不适合'
      rows.push(['KMO 取样适切性度量', fmtNum(kmo, 4), kmoDesc])
    }
    if (bart) {
      const f = fields(bart)
      const p = pPair(f[3], f[4])
      rows.push(['Bartlett 球形检验 χ²', toNum(f[1]) ?? '—', p.display || '—'])
      rows.push(['Bartlett 自由度 df', toNum(f[2]) ?? '—', ''])
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  KMO 与 Bartlett 球形检验`,
        headers: ['检验', '统计量', '判定/p'],
        rows,
        note: '注：KMO > 0.8 适合做因子分析；Bartlett 检验 p < 0.05 表示变量间存在相关，适合降维。'
      })
    }
  }

  // ── 表2：方差解释 ──
  {
    const eigenLines = tagged(output, 'EIGEN')
    if (eigenLines.length > 0) {
      const rows = eigenLines.map((line) => {
        const f = fields(line)
        return [`因子 ${f[1]}`, toNum(f[2]) ?? '—', `${f[3] ?? '—'}%`, `${f[4] ?? '—'}%`] as (
          | string
          | number
        )[]
      })
      const last = fields(eigenLines[eigenLines.length - 1])
      kv['累计方差解释'] = `${last[4]}%`
      tables.push({
        title: `表${tables.length + 1}  方差解释`,
        headers: ['因子', '特征值', '方差解释率', '累计方差解释率'],
        rows,
        note: '注：按主成分法抽取，因子数依 Kaiser 准则（特征值 > 1）。'
      })
    }
  }

  // ── 表3：旋转后因子载荷矩阵（动态列） ──
  {
    const head = firstTagged(output, 'LOAD_HEAD')
    if (head) {
      const cols = fields(head).slice(1)
      const loadLines = tagged(output, 'LOAD')
      const rows = loadLines.map((line) => {
        const f = fields(line)
        const out: (string | number)[] = [f[1] ?? '—']
        for (let i = 2; i < f.length; i++) {
          const v = toNum(f[i])
          out.push(v === null ? '—' : fmtNum(v, 4))
        }
        return out
      })
      if (rows.length > 0) {
        tables.push({
          title: `表${tables.length + 1}  旋转后因子载荷矩阵`,
          headers: cols,
          rows,
          note:
            '注：采用主成分法抽取、最大方差法（varimax）旋转。' +
            '载荷绝对值 ≥ 0.4 视为有效载荷。「共同度」为该题项被共同因子解释的方差比例。'
        })

        // 主因子归属：归并题目，供 AI 解读与用户命名因子
        const primary = tagged(output, 'PRIMARY')
        if (primary.length > 0) {
          const groups: Record<string, string[]> = {}
          for (const line of primary) {
            const f = fields(line)
            const factor = `F${f[2]}`
            if (!groups[factor]) groups[factor] = []
            groups[factor].push(f[1] ?? '')
          }
          const parts = Object.keys(groups)
            .sort()
            .map((k) => `${k}: ${groups[k].join(', ')}`)
          kv['因子归属'] = parts.join(' | ')
        }
      }
    }
  }

  // ── 缺失值剔除说明 ──
  const dropped = firstTagged(output, 'NOTE_DROPPED')
  if (dropped) kv['缺失值处理'] = fields(dropped)[1] ?? ''

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/** 数值格式化：保留指定小数位；null 输出占位符 */
function fmtNum(v: number | null, digits: number): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

/**
 * 把 R 端输出的「是 / 否」判定透传为布尔值。
 *
 * 只做**表示法归一**（是/否、TRUE/FALSE、1/0），**不做判定**。
 * 阈值口径只有一处（R 端），TS 侧重复实现会漂移——这正是 v0.2.x 四次事故的同类根源。
 */
function toBoolCN(s: string | undefined): boolean | null {
  const t = (s ?? '').trim().toLowerCase()
  if (t === '是' || t === 'true' || t === 't' || t === 'yes' || t === '1') return true
  if (t === '否' || t === 'false' || t === 'f' || t === 'no' || t === '0') return false
  return null
}

/**
 * p 值的展示串，缺失时给占位符。
 *
 * pPair() 在 raw 字段为 "NA" 时会拼出字面量 "p = NA"（它是 `raw ? ... : ...`，
 * 而字符串 "NA" 是真值）。对三线表来说 "p = NA" 是一个会被直接印进论文的
 * 假句子——缺失就应该是「—」。v0.3.1 的三个新方法都在这里统一收口。
 */
function pText(p: { value: number | null; display: string }): string {
  if (p.value === null && /^p\s*=\s*NA$/i.test(p.display)) return '—'
  return p.display || '—'
}

/**
 * 因子标签归一化：`"F1"` / `"f1"` / `"1"` → `"F1"`；无法识别时原样返回。
 *
 * 为什么需要它：契约把 `CFA_FACTOR` 的 f1/f2 与 `CFA_RELIAB` 的 factor 描述为因子标识，
 * 而 R 端实际输出的是 **`sprintf("F%d")`**（即 `CFA_FACTOR|F1|F2|...`），
 * 但同一份输出里 `CFA_ITEM` 的 factor 是**裸整数**（`CFA_ITEM|q1|1`）。
 * 解析器若对两处一律加 `F` 前缀，会得到 `FF1`——一个永远不会报错、
 * 只会让"区分效度"整块表标签错乱的缺陷。这里统一收敛为 `F<n>`，
 * 两种形态都接受，因此 R 端将来改用裸整数也不会破。
 */
function factorLabel(raw: string | undefined): string {
  const t = (raw ?? '').trim()
  if (t === '') return '—'
  const m = t.match(/^[Ff]?\s*(\d+)$/)
  return m ? `F${m[1]}` : t
}

/**
 * 解析验证性因子分析（CFA）。
 *
 * 行契约见 V031_CONTRACT.md 第一节。与 EFA 的"动态列"不同，CFA 的列是**固定语义**的
 * 长表：每条 `CFA_ESTIMATE` 一行，字段位置由契约钉死。这里刻意把每个下标都
 * 写成「f[7] // p_raw」形式并保留契约注释——v0.2.6 的两处事故（把 CI 下限当均值差、
 * 把 p 值当 CI 下限）就是因为下标含义只存在于某个人的记忆里。
 *
 * 题项所属因子**从 `CFA_ITEM` 查表得到**，不是按 `CFA_ESTIMATE` 的行序推断：
 * R 端在一次输出里可能先给模型设定、再给估计值，两者的顺序没有契约保证。
 */
function parseCfa(output: string, tables: TableData[], kv: Record<string, string | number>) {
  // ── CFA_SPEC|nfac|p|n ──
  const spec = firstTagged(output, 'CFA_SPEC')
  const nFactors = spec ? (toNum(fields(spec)[1]) ?? 0) : 0
  const nItems = spec ? (toNum(fields(spec)[2]) ?? 0) : 0
  const nObs = spec ? (toNum(fields(spec)[3]) ?? 0) : 0
  if (nFactors > 0) kv['因子数'] = nFactors
  if (nItems > 0) kv['题项数'] = nItems
  if (nObs > 0) kv['样本量'] = nObs

  // ── CFA_MODEL|syntax ──
  // 契约里 syntax 是单个字段，但 R 端通常**每个因子一行**（F1 =~ ... / F2 =~ ...）。
  // 因此这里把全部 CFA_MODEL 行合并成一条完整语法串：只有一行时行为不变，
  // 多行时不会静默丢掉第 2 个因子（旧式 `firstTagged` 会丢掉 F2 =~ ...）。
  const modelLines = tagged(output, 'CFA_MODEL')
  if (modelLines.length > 0) {
    kv['模型语法'] = modelLines.map((l) => fields(l).slice(1).join('|')).join(' | ')
  }

  // ── 题项 → 因子（1-based）映射，来自 CFA_ITEM ──
  const itemFactor = new Map<string, number>()
  for (const line of tagged(output, 'CFA_ITEM')) {
    const f = fields(line)
    const fac = toNum(f[2])
    if (f[1] && fac !== null) itemFactor.set(f[1], fac)
  }

  // ── CFA_FIT|chisq|df|p_display|p_raw ──
  const fit = firstTagged(output, 'CFA_FIT')
  const fitF = fit ? fields(fit) : null
  const fitP = fitF ? pPair(fitF[3], fitF[4]) : { value: null, display: '' }
  const chisq = fitF ? toNum(fitF[1]) : null
  const df = fitF ? toNum(fitF[2]) : null

  // ── CFA_FITIDX|cfi|tli|rmsea|srmr ──
  const fitIdx = firstTagged(output, 'CFA_FITIDX')
  const idxF = fitIdx ? fields(fitIdx) : null
  const cfi = idxF ? toNum(idxF[1]) : null
  const tli = idxF ? toNum(idxF[2]) : null
  const rmsea = idxF ? toNum(idxF[3]) : null
  const srmr = idxF ? toNum(idxF[4]) : null

  // ── CFA_NULLMODEL|chisq_null|df_null ──
  const nullModel = firstTagged(output, 'CFA_NULLMODEL')
  const nullF = nullModel ? fields(nullModel) : null
  const chisqNull = nullF ? toNum(nullF[1]) : null
  const dfNull = nullF ? toNum(nullF[2]) : null

  // ── 表1：模型拟合指标 ──
  if (fitF) {
    // χ²/df 是常见报告量；df = 0（恰好识别）时不可除，必须给占位而不是 Infinity。
    const chisqDf = chisq !== null && df !== null && df > 0 ? chisq / df : null
    tables.push({
      title: `表${tables.length + 1}  模型拟合指标`,
      headers: ['指标', '数值', '参考标准'],
      rows: [
        ['χ²', chisq === null ? '—' : fmtNum(chisq, 4), '越小越好'],
        ['df', df === null ? '—' : df, 'df = p(p+1)/2 − (2p + k(k−1)/2)'],
        ['p', pText(fitP), 'p > .05 表示模型与数据无显著失配'],
        ['χ²/df', fmtNum(chisqDf, 4), '< 3 可接受，< 2 良好'],
        ['CFI', fmtNum(cfi, 4), '≥ .90 可接受，≥ .95 良好'],
        ['TLI', fmtNum(tli, 4), '≥ .90 可接受，≥ .95 良好'],
        ['RMSEA', fmtNum(rmsea, 4), '≤ .08 可接受，≤ .06 良好'],
        ['SRMR', fmtNum(srmr, 4), '≤ .08 良好'],
        ['零模型 χ²', chisqNull === null ? '—' : fmtNum(chisqNull, 4), 'CFI / TLI 的分母来源'],
        ['零模型 df', dfNull === null ? '—' : dfNull, 'df_null = p(p−1)/2']
      ],
      note:
        '注：χ² 检验对样本量敏感，大样本下几乎必然显著，应结合 CFI / TLI / RMSEA / SRMR 综合判断。' +
        'CFI、TLI 由零模型（独立模型）卡方推导；df ≤ 0 时（恰好识别或不可识别）CFI = TLI = 1、RMSEA = 0。'
    })
    if (chisq !== null) kv['chi2'] = chisq
    if (df !== null) kv['df'] = df
    if (fitP.value !== null) kv['p'] = fitP.value
    if (fitP.display) kv['pDisplay'] = fitP.display
    if (chisqDf !== null) kv['chi2_df'] = chisqDf
    if (cfi !== null) kv['CFI'] = cfi
    if (tli !== null) kv['TLI'] = tli
    if (rmsea !== null) kv['RMSEA'] = rmsea
    if (srmr !== null) kv['SRMR'] = srmr
    if (chisqNull !== null) kv['chi2_null'] = chisqNull
    if (dfNull !== null) kv['df_null'] = dfNull
  }

  // ── 表2：标准化载荷 ──
  // CFA_ESTIMATE|item|std_load|unstd_load|se|z|p_display|p_raw|r2
  //   f[1]=item f[2]=std_load f[3]=unstd_load f[4]=se f[5]=z f[6]=p展示串 f[7]=p原始值 f[8]=r2
  {
    const estLines = tagged(output, 'CFA_ESTIMATE')
    const rows: (string | number)[][] = []
    for (const line of estLines) {
      const f = fields(line)
      const item = f[1] ?? ''
      const fac = itemFactor.get(item)
      rows.push([
        item,
        fac === undefined ? '—' : fac,
        toNum(f[2]) ?? '—',
        toNum(f[3]) ?? '—',
        toNum(f[4]) ?? '—',
        toNum(f[5]) ?? '—',
        pPair(f[6], f[7]).display || '—',
        toNum(f[8]) ?? '—'
      ])
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  标准化因子载荷`,
        headers: ['题项', '因子', '标准化载荷', '非标准化载荷', 'SE', 'z', 'p', 'R²'],
        rows,
        note:
          '注：标准化载荷 = λ / √σ_jj；R² = 标准化载荷²，表示该题项被因子解释的方差比例。' +
          'SE / z / p 为标准化载荷的 delta 法标准误与 Wald 检验。' +
          // 契约硬性要求：表注必须说明结构来源，否则用户会把"同源"当成"独立验证"
          '因子结构由同一数据集上的 EFA 导出（探索 → 验证同源），理想做法是在独立样本上复核后再报告。'
      })

      // 载荷汇总（供 AI 解读）：范围与最小值比单点更稳
      const loads = estLines
        .map((l) => toNum(fields(l)[2]))
        .filter((v): v is number => v !== null)
      if (loads.length > 0) {
        const minLoad = Math.min(...loads)
        const maxLoad = Math.max(...loads)
        kv['标准化载荷范围'] = `${fmtNum(minLoad, 4)} ~ ${fmtNum(maxLoad, 4)}`
        kv['最小标准化载荷'] = minLoad
        if (loads.some((v) => Math.abs(v) > 1)) kv['存在超界载荷'] = '是'
      }
      kv['载荷项数'] = rows.length

      // 题项归属（与表2的「因子」列同源，绝不允许两处各算一遍）
      const groups: Record<string, string[]> = {}
      for (const [item, fac] of itemFactor) {
        const key = `F${fac}`
        if (!groups[key]) groups[key] = []
        groups[key].push(item)
      }
      const parts = Object.keys(groups)
        .sort()
        .map((k) => `${k}: ${groups[k].join(', ')}`)
      if (parts.length > 0) kv['因子归属'] = parts.join(' | ')
    }
  }

  // ── 表3：因子间相关（nfac < 2 时不出表） ──
  // CFA_FACTOR|f1|f2|cor|se|z|p_display|p_raw
  //   f[1]=f1 f[2]=f2 f[3]=cor f[4]=se f[5]=z f[6]=p展示串 f[7]=p原始值
  {
    const lines = tagged(output, 'CFA_FACTOR')
    const rows: (string | number)[][] = []
    for (const line of lines) {
      const f = fields(line)
      const cor = toNum(f[3])
      // 区分效度：√AVE 应大于该因子与其他因子的相关。这里只做**展示性**比较，
      // 判定口径仍以 R 端 CFA_RELIAB 的 sqrt_ave 为准，不在 TS 侧另立标准。
      rows.push([
        `${factorLabel(f[1])} ↔ ${factorLabel(f[2])}`,
        cor ?? '—',
        toNum(f[4]) ?? '—',
        toNum(f[5]) ?? '—',
        pPair(f[6], f[7]).display || '—'
      ])
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  因子间相关`,
        headers: ['因子对', '相关系数', 'SE', 'z', 'p'],
        rows,
        note:
          '注：因子间相关过高（如 > .85）提示区分效度不足，两个因子可能在测量同一构念。' +
          '区分效度判据为 √AVE > 该因子与其他因子的相关系数，见下表。'
      })
      kv['因子相关'] = lines
        .map((l) => {
          const f = fields(l)
          return `r(${factorLabel(f[1])},${factorLabel(f[2])}) = ${fmtNum(toNum(f[3]), 4)}`
        })
        .join('; ')
    }
  }

  // ── 表4：组合信度与平均方差抽取量 ──
  // CFA_RELIAB|factor|cr|ave|sqrt_ave
  {
    const lines = tagged(output, 'CFA_RELIAB')
    const rows: (string | number)[][] = []
    for (const line of lines) {
      const f = fields(line)
      const label = factorLabel(f[1])
      rows.push([
        label,
        toNum(f[2]) ?? '—',
        toNum(f[3]) ?? '—',
        toNum(f[4]) ?? '—'
      ])
      const cr = toNum(f[2])
      const ave = toNum(f[3])
      const sq = toNum(f[4])
      if (cr !== null) kv[`${label}_CR`] = cr
      if (ave !== null) kv[`${label}_AVE`] = ave
      if (sq !== null) kv[`${label}_sqrtAVE`] = sq
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  组合信度与平均方差抽取量`,
        headers: ['因子', 'CR', 'AVE', '√AVE'],
        rows,
        note:
          '注：CR = (Σλ)² / ((Σλ)² + Σθ)，AVE = Σλ² / (Σλ² + Σθ)，λ 为标准化载荷。' +
          'CR ≥ .70、AVE ≥ .50 为常用标准；√AVE 大于该因子与其他因子的相关时支持区分效度。'
      })
    }
  }

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/**
 * 解析内容效度指数（CVI）。
 *
 * **判定口径唯一来源原则**：`verdict`（优秀/良好/尚可/需修改）与 `threshold_ok`
 * 一律**原样透传 R 端输出的字段**。解析器绝不根据 `i_cvi` 与专家数重新判定——
 * 阈值表（n ≤ 5 → 1.00；6–8 → 0.83；n ≥ 9 → 0.78）只允许存在于 R 端一处。
 * 若 TS 侧再实现一遍，两处迟早漂移，而漂移的结果是一条会被写进论文的效度结论。
 */
function parseCvi(output: string, tables: TableData[], kv: Record<string, string | number>) {
  // ── CVI_SPEC|n_items|n_experts ──
  const spec = firstTagged(output, 'CVI_SPEC')
  const nItems = spec ? toNum(fields(spec)[1]) : null
  const nExperts = spec ? toNum(fields(spec)[2]) : null
  if (nItems !== null) kv['题项数'] = nItems
  if (nExperts !== null) kv['专家数'] = nExperts

  // ── 表1：逐题 I-CVI 与修正 Kappa ──
  // CVI_ITEM|item|n_relevant|n_experts|i_cvi|kappa|p_c|verdict
  //   f[1]=item f[2]=n_relevant f[3]=n_experts f[4]=i_cvi f[5]=kappa f[6]=p_c f[7]=verdict
  {
    const lines = tagged(output, 'CVI_ITEM')
    const rows: (string | number)[][] = []
    let belowThreshold = 0
    for (const line of lines) {
      const f = fields(line)
      const iCvi = toNum(f[4])
      const verdict = (f[7] ?? '').trim()
      // verdict 只透传、不重算；「需修改」计数也只是对透传值的统计。
      if (verdict === '需修改') belowThreshold++
      rows.push([
        f[1] ?? '—',
        toNum(f[2]) ?? '—',
        toNum(f[3]) ?? '—',
        fmtNum(iCvi, 4),
        fmtNum(toNum(f[5]), 4),
        fmtNum(toNum(f[6]), 4),
        verdict || '—'
      ])
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  逐题内容效度指数与修正 Kappa`,
        headers: ['题项', '认同专家数', '专家总数', 'I-CVI', '修正 Kappa', 'Pc', '判定'],
        rows,
        note:
          '注：I-CVI = 评 ≥ 3 分的专家数 / 专家总数；Pc = C(n, A)/2^n（A = ceiling(阈值 × n)）；' +
          '修正 Kappa k* = (I-CVI − Pc)/(1 − Pc)。' +
          'I-CVI 的可接受下限随专家数变化：n ≤ 5 为 1.00，6 ≤ n ≤ 8 为 0.83，n ≥ 9 为 0.78。' +
          '判定按 Cicchetti & Sparrow 口径：优秀(k* > .74)、良好(.60 ~ .74)、尚可(.40 ~ .60)、需修改(< .40)。'
      })
      kv['题项数'] = rows.length
      kv['需修改题项数'] = belowThreshold
    }
  }

  // ── 表2：量表级汇总 ──
  // CVI_SUMMARY|s_cvi_ave|s_cvi_ua|n_ua|threshold_ok
  //   f[1]=s_cvi_ave f[2]=s_cvi_ua f[3]=n_ua f[4]=threshold_ok（是/否）
  const summary = firstTagged(output, 'CVI_SUMMARY')
  if (summary) {
    const f = fields(summary)
    const ave = toNum(f[1])
    const ua = toNum(f[2])
    const nUa = toNum(f[3])
    const thresholdOk = (f[4] ?? '').trim()
    tables.push({
      title: `表${tables.length + 1}  量表级内容效度汇总`,
      headers: ['指标', '数值', '建议标准'],
      rows: [
        ['S-CVI/Ave（平均 I-CVI）', fmtNum(ave, 4), '≥ .90'],
        ['S-CVI/UA（全体一致题项比例）', fmtNum(ua, 4), '≥ .80'],
        ['全体一致题项数', nUa === null ? '—' : nUa, `题项总数 ${nItems === null ? '—' : nItems}`],
        // 透传 R 端判定，不在 TS 侧重算阈值
        ['全部题项 I-CVI 是否达标', thresholdOk || '—', '按专家数取对应阈值（n≤5: 1.00 / 6–8: 0.83 / n≥9: 0.78）']
      ],
      note:
        '注：S-CVI/Ave 为各题项 I-CVI 的均值，S-CVI/UA 为「全部专家均评为相关」的题项所占比例。' +
        '「是否达标」由 R 端按专家数对应的阈值表判定后透传，界面与导出不应另作解释。'
    })
    if (ave !== null) kv['S-CVI/Ave'] = ave
    if (ua !== null) kv['S-CVI/UA'] = ua
    if (nUa !== null) kv['一致题项数'] = nUa
    if (thresholdOk) kv['I-CVI 达标'] = thresholdOk
    const okBool = toBoolCN(thresholdOk)
    if (okBool !== null) kv['I-CVI 达标码'] = okBool ? 1 : 0
  }

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/**
 * 解析 Harman 单因子检验（共同方法偏差初步筛查）。
 *
 * 判据（契约第三节）：`first_pct < 40` **且** `n_factors_gt1 > 1` → 未发现严重偏差。
 * 但 `ok` 字段同样**透传 R 端**——TS 侧只用它做展示，不重算。
 * 阈值 `threshold` 也来自 R 端（`HARMAN_SUMMARY` 第 3 字段），不在代码里写死 40，
 * 这样将来方法学标准变化时不需要改解析器。
 */
function parseHarman(output: string, tables: TableData[], kv: Record<string, string | number>) {
  // ── HARMAN_SPEC|p|n ──
  const spec = firstTagged(output, 'HARMAN_SPEC')
  const p = spec ? toNum(fields(spec)[1]) : null
  const nObs = spec ? toNum(fields(spec)[2]) : null
  if (p !== null) kv['题项数'] = p
  if (nObs !== null) kv['样本量'] = nObs

  // ── 表1：特征值与方差解释 ──
  // HARMAN_EIGEN|k|eigenvalue|variance_pct|cumulative_pct
  {
    const lines = tagged(output, 'HARMAN_EIGEN')
    const rows: (string | number)[][] = []
    for (const line of lines) {
      const f = fields(line)
      rows.push([
        toNum(f[1]) ?? '—',
        toNum(f[2]) ?? '—',
        `${f[3] ?? '—'}%`,
        `${f[4] ?? '—'}%`
      ])
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  特征值与方差解释（未旋转主成分）`,
        headers: ['成分', '特征值', '方差解释率', '累计方差解释率'],
        rows,
        note: '注：未旋转主成分分析，仅列出特征值 > 1 的成分（Kaiser 准则）。'
      })
      // 累计方差解释只在最后一个成分上有意义（与 EFA 解析器同一教训：
      // 不能取第一行，否则 user 看到的"累计"其实等于"首个成分的方差解释率"）
      const lastRow = rows[rows.length - 1]
      kv['累计方差解释'] = String(lastRow[3])
    }
  }

  // ── 表2：判定结论 ──
  // HARMAN_SUMMARY|n_factors_gt1|first_pct|threshold|ok
  //   f[1]=n_factors_gt1 f[2]=first_pct f[3]=threshold f[4]=ok（是/否）
  const summary = firstTagged(output, 'HARMAN_SUMMARY')
  if (summary) {
    const f = fields(summary)
    const nGt1 = toNum(f[1])
    const firstPct = toNum(f[2])
    const threshold = toNum(f[3])
    const okRaw = (f[4] ?? '').trim()
    tables.push({
      title: `表${tables.length + 1}  共同方法偏差判定`,
      headers: ['指标', '数值', '判据'],
      rows: [
        ['题项数', p === null ? '—' : p, ''],
        ['有效样本', nObs === null ? '—' : nObs, ''],
        ['特征值 > 1 的成分数', nGt1 === null ? '—' : nGt1, '> 1'],
        [
          '首成分方差解释率',
          firstPct === null ? '—' : `${fmtNum(firstPct, 2)}%`,
          `< ${threshold === null ? '—' : fmtNum(threshold, 2)}%`
        ],
        [
          '判定阈值',
          threshold === null ? '—' : `${fmtNum(threshold, 2)}%`,
          '契约固定值，由 R 端输出'
        ],
        // 透传 R 端判定
        ['是否未发现严重共同方法偏差', okRaw || '—', '首成分低于阈值 且 特征值 > 1 的成分多于 1 个']
      ],
      note:
        '注：Harman 单因子检验的灵敏度较低，只能作为初步筛查，不能据此证明不存在共同方法偏差；' +
        '确证性结论建议结合标记变量法或 CFA 单因子/多因子模型比较。'
    })
    if (nGt1 !== null) kv['特征值大于1的因子数'] = nGt1
    if (firstPct !== null) kv['首成分方差解释率'] = firstPct
    if (threshold !== null) kv['判定阈值'] = threshold
    if (okRaw) kv['未发现严重偏差'] = okRaw
    const okBool = toBoolCN(okRaw)
    if (okBool !== null) kv['未发现严重偏差码'] = okBool ? 1 : 0
  }

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}
