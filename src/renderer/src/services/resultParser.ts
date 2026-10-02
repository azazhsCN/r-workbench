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
    tables.push({
      title: `表${tables.length + 1}  独立样本 t 检验结果`,
      headers: ['t', 'df', 'p', '均值差', '95% CI 下限', '95% CI 上限', "Cohen's d"],
      rows: [[
        toNum(f[1]) ?? '—',
        toNum(f[2]) ?? '—',
        p.display || '—',
        toNum(f[6]) ?? '—',
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
    tables.push({
      title: `表${tables.length + 1}  单样本 t 检验结果`,
      headers: ['t', 'df', 'p', '95% CI 下限', '95% CI 上限', "Cohen's d"],
      rows: [[
        toNum(f[1]) ?? '—',
        toNum(f[2]) ?? '—',
        p.display || '—',
        toNum(f[4]) ?? '—',
        toNum(f[6]) ?? '—',
        toNum(f[6]) ?? '—'
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
