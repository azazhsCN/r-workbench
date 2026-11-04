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
 * 横幅核心名：剥掉**尾部**的括号限定词（`结构方程模型 (SEM)` → `结构方程模型`）。
 *
 * 只剥尾部、且要求括号在末尾收尾，因此 `A (B) C` 这类中间带括号的横幅原样返回。
 * v0.3.2 的五个方法用它做**全等**匹配，见 detectAnalysisType。
 */
function bannerCore(name: string): string {
  const t = name.trim()
  const m = t.match(/^(.*?)\s*[（(][^（()）]*[)）]\s*$/)
  return (m ? m[1] : t).trim()
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
    // ── v0.3.2 因果链五方法：**横幅核心名全等**匹配，放在所有前缀匹配之前 ──
    //
    // 为什么必须全等而不是 `startsWith`：`有调节的中介分析` 与 `中介效应分析`
    // 只差一个前导的「有调节的」，两者是**不同方法、不同行格式、不同结论口径**。
    // 任何"取前 N 个字符"或"包含即算"的写法都会把前者吸进后者：
    //   - `startsWith('中介')`            → 有调节的中介 → mediation（错）
    //   - `name.includes('中介效应分析')` → 有调节的中介 → mediation（错，且违反铁律）
    // 全等比较没有这种可能：两个字符串不相等就是不相等，将来再加
    // `调节的中介分析` / `中介的调节分析` 之类的新方法也不会被旧分支吞掉。
    // 横幅可能带括号限定词（`结构方程模型 (SEM)`），故先剥掉**尾部**括号再全等，
    // 只剥尾部、不剥中间，避免把 `有调节的中介分析（前半段）` 的语义剥没了。
    const core = bannerCore(name)
    if (core === '中介效应分析') return 'mediation'
    if (core === '调节效应分析') return 'moderation'
    if (core === '有调节的中介分析') return 'moderated_mediation'
    if (core === '路径分析') return 'path_analysis'
    if (core === '结构方程模型') return 'sem'
    // v0.3.4 新增两方法。同样用**全等**匹配而非前缀：
    // `层次回归分析` 与 `线性回归分析` 只差前两个字，是不同方法、不同行格式；
    // `Logistic 回归分析` 与 `线性回归分析` 同理。用 startsWith 会被后者吞掉。
    if (core === '层次回归分析') return 'hierarchical_regression'
    if (core === 'Logistic 回归分析') return 'logistic_regression'

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
  // ── 数据质量警告（v0.3.3 / D02+D03）──
  // R 端 r_quality_check_all 输出的 DQ_WARN|变量|类型|计数|详情 行。
  // 这类警告必须**到达用户**：实测单点极端值能让 ANOVA 从 p=5.6e-28 变成 0.374，
  // 而此前项目**没有任何**离群值检测，用户完全无从察觉结果已被录入错误摧毁。
  for (const line of tagged(output, 'DQ_WARN')) {
    const f = fields(line)
    const col = f[1] ?? ''
    const kind = f[2] ?? ''
    const count = f[3] ?? ''
    const detail = f.slice(4).join('|')
    const kindLabel: Record<string, string> = {
      outlier: '极端值',
      out_of_range: '值域越界',
      high_missing: '高缺失',
      constant: '常量列'
    }
    out.push({
      kind: 'warning',
      label: `数据质量${kindLabel[kind] ? `（${kindLabel[kind]}）` : ''}：${col}`,
      value: `${count} 处${detail ? ` — ${detail}` : ''}`
    })
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
    case 'mediation':
      parseMediation(output, tables, keyValues)
      break
    case 'moderation':
      parseModeration(output, tables, keyValues)
      break
    case 'moderated_mediation':
      parseModeratedMediation(output, tables, keyValues)
      break
    case 'path_analysis':
      parsePathAnalysis(output, tables, keyValues)
      break
    case 'sem':
      parseSem(output, tables, keyValues)
      break
    case 'hierarchical_regression':
      parseHierarchicalRegression(output, tables, keyValues)
      break
    case 'logistic_regression':
      parseLogisticRegression(output, tables, keyValues)
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

/* ═══════════════════════════════════════════════════════════════════════
 * v0.3.2 因果链五方法：中介 / 调节 / 有调节的中介 / 路径分析 / SEM
 *
 * 行格式的唯一依据是 `V032_CONTRACT.md` 第一至第五节。与 v0.3.1 的
 * CFA / CVI / Harman 一样，这里刻意把每个下标都写成「f[n] // 字段名」并保留
 * 契约注释，因为 v0.2.x 的四次事故全部是"下标含义只存在于某个人的记忆里"。
 *
 * 新方法比旧方法多一层风险：这些量**互相之间有代数约束**。
 *   - 中介：`c = c′ + a·b`，`indirect = a·b`，`total = direct + indirect`
 *   - 调节：`slope(w0) = b1 + b3·w0`，交互项 p 与 ΔR²/ΔF 的 p 必须同向
 *   - 有调节的中介：`index = a4·b`，`条件间接 = (a2 + a4·W)·b`
 *   - 路径分析：`total = direct + indirect`
 * 约束的存在既是**便利**（错位几乎必然破坏某个恒等式）也是**陷阱**：
 * 一个半吊子实现完全可以在 TS 侧"重算一遍"来让恒等式看起来成立，
 * 从而把 R 端的值悄悄换掉。因此本组解析器守两条纪律：
 *
 * 1. **不重算**任何推断量。显著与否、是否达标、模型是否可接受，全部来自
 *    R 端的 `CONCL` 与各 `*_NOTE`。TS 侧只做两件纯算术的事：
 *      (a) `CI 是否含 0` —— 纯区间包含判断。它不替代 R 端结论，
 *          只是防止用户拿**点估计**去读显著性（Bootstrap 区间跨 0 时点估计
 *          几乎总是非 0 的，这是中介分析最常见的误读）；
 *      (b) 契约明文要求的恒等式自检。自检失败只产出 warning 级别的展示，
 *          绝不回写/修正 R 端给的值——改写会让"错在哪"永久消失。
 *
 * 2. **表与 keyValues 同源**：每个进表的数字与进 kv 的数字都是同一个局部常量，
 *    不允许"表里算一遍、kv 里再算一遍"（v0.2.7 红线）。
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 恒等式自检容差。
 *
 * 契约要求 R 端内部容差 1e-10，但**解析器看到的是 `num(x, 4)` 之后的文本**：
 * 三个被舍入的量再相加减，误差上界约 1e-4 量级。取 1e-3 既能容忍打印舍入，
 * 又能抓住真正的下标错位——错位造成的偏差是 0.1 ~ 1 量级，
 * 比容差大两到三个数量级。
 */
const IDENTITY_TOL = 1e-3

/**
 * CI 是否排除 0（纯区间包含判断）。
 *
 * 这不是"重新做显著性判定"：显著性结论只来自 R 端 `CONCL`。这里回答的只是
 * "R 端报告的这条区间有没有盖住 0"，因为效应分解表若只印端点不印这一列，
 * 用户会拿点估计去读显著与否。
 */
function ciExcludesZero(lower: number | null, upper: number | null): boolean | null {
  if (lower === null || upper === null) return null
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null
  return lower > 0 || upper < 0
}

/** CI 是否含 0 的展示串：`不含 0` / `含 0` / `—`（端点缺失） */
function ciZeroText(lower: number | null, upper: number | null): string {
  const excludes = ciExcludesZero(lower, upper)
  if (excludes === null) return '—'
  return excludes ? '不含 0' : '含 0'
}

/** Bootstrap 配置行（MED_BOOT / MM_BOOT 同一格式）：`B|seed|ci_level|method` */
interface BootConfig {
  b: number | null
  seed: number | null
  ci_level: number | null
  method: string
}

function parseBootLine(line: string | null): BootConfig | null {
  if (!line) return null
  const f = fields(line)
  return {
    b: toNum(f[1]), // f[1] = B（重复次数）
    seed: toNum(f[2]), // f[2] = seed（固定种子，保证可复现）
    ci_level: toNum(f[3]), // f[3] = ci_level（0.95）
    method: (f[4] ?? '').trim() // f[4] = percentile / bca（必须与实际用法一致）
  }
}

/** Bootstrap 配置的展示串（缺失时给占位，不拼 `B = NA` 这种假句子） */
function bootText(boot: BootConfig | null): string {
  if (!boot) return '—'
  const bits: string[] = []
  if (boot.b !== null) bits.push(`B = ${boot.b}`)
  if (boot.seed !== null) bits.push(`seed = ${boot.seed}`)
  if (boot.ci_level !== null) bits.push(`${fmtNum(boot.ci_level * 100, 1)}% CI`)
  if (boot.method) bits.push(boot.method)
  return bits.length > 0 ? bits.join('，') : '—'
}

/** 把 `TAG|自由文本` 行收成字符串数组（NOTE 类行可能有多个） */
function textLines(output: string, tag: string): string[] {
  return tagged(output, tag)
    .map((l) => fields(l).slice(1).join('|').trim())
    .filter((s) => s !== '')
}

/**
 * 恒等式自检的三态收口：`一致` / `不一致` / `无法判断`。
 *
 * 为什么必须区分第三态：自检最危险的退化不是"漏报不一致"，而是**空转通过**。
 * 一旦某个必要字段因下标错位或键名拼接错误而取不到，`if (a !== null && …)`
 * 就整段静默跳过，自检报告"一致"——用户因此得到一句「恒等式自检：一致」的
 * 安全背书，而实际上**什么都没检查**。
 *
 * 这与 v0.2.x 的四次事故同源：静默跳过比报错更危险。所以这里强制三态：
 *   - `一致`     ：所有需要的量都取到了，且恒等式成立
 *   - `不一致`   ：所有需要的量都取到了，但恒等式不成立
 *   - `无法判断` ：有量没取到（或 R 端未输出），自检**没有**发生
 *
 * 第三态由注入实验发现：把 MM_COEF 的复合键改成裸 term 后，恒等式检查
 * 因为取不到 a2 而空转通过，测试仍绿——那是一次真实的设计缺陷。
 */
function selfCheckVerdict(broken: string[], missing: string[]): string {
  if (broken.length > 0) return '不一致'
  if (missing.length > 0) return '无法判断'
  return '一致'
}

/**
 * 登记一条"自检所需的量没取到"。
 *
 * 只在**契约里 R 端一定会输出**的字段上使用；可选字段（如 Johnson-Neyman、
 * 失败的 BCa）缺失不算缺失，不得让自检降级为"无法判断"。
 */
function requireForCheck<T>(value: T | null | undefined, name: string, missing: string[]): T | null {
  if (value === null || value === undefined) {
    missing.push(name)
    return null
  }
  return value
}

/**
 * 解析中介效应（Mediation）。
 *
 * 行契约（V032_CONTRACT.md 第一节）：
 *   MED_SPEC  |n|x|m|y
 *   MED_PATH  |path|coef|se|t|p_display|p_raw             path ∈ a / b / c_prime / c_total
 *   MED_EFFECT|effect|value|se|ci_lower|ci_upper|ci_method
 *                                                         effect ∈ indirect / direct / total / prop_mediated
 *   MED_SOBEL |z|p_display|p_raw
 *   MED_BOOT  |B|seed|ci_level|method
 *   MED_STD   |path|std_coef                              path ∈ a_std / b_std / c_prime_std / indirect_std
 *   MED_NOTE  |text
 *   CONCL     |text
 *
 * 为什么必须逐格断言：indirect、direct、total 三个量全是回归系数级的小数，
 * 彼此量级相近、符号都可能为正。把 indirect 读成 direct 不会有任何类型或范围
 * 检查报警，表仍然"有数据、看着像研究结果"，只有恒等式能发现。
 */
function parseMediation(output: string, tables: TableData[], kv: Record<string, string | number>) {
  // ── MED_SPEC|n|x|m|y ──
  const spec = firstTagged(output, 'MED_SPEC')
  const nObs = spec ? toNum(fields(spec)[1]) : null
  const varX = spec ? (fields(spec)[2] ?? '').trim() : ''
  const varM = spec ? (fields(spec)[3] ?? '').trim() : ''
  const varY = spec ? (fields(spec)[4] ?? '').trim() : ''
  if (nObs !== null) kv['样本量'] = nObs
  if (varX) kv['自变量X'] = varX
  if (varM) kv['中介变量M'] = varM
  if (varY) kv['因变量Y'] = varY

  // ── 表1：逐条路径 ──
  // MED_PATH|path|coef|se|t|p_display|p_raw
  //   f[1]=path f[2]=coef f[3]=se f[4]=t f[5]=p展示串 f[6]=p原始值
  const pathLabel: Record<string, string> = {
    a: 'a：X → M',
    b: 'b：M → Y（控制 X）',
    c_prime: 'c′：X → Y（控制 M）',
    c_total: 'c：X → Y（总效应）'
  }
  const pathRows: (string | number)[][] = []
  const coefOf = new Map<string, number>()
  for (const line of tagged(output, 'MED_PATH')) {
    const f = fields(line)
    const key = (f[1] ?? '').trim()
    const coef = toNum(f[2])
    const se = toNum(f[3])
    const t = toNum(f[4])
    const p = pPair(f[5], f[6])
    if (coef !== null) coefOf.set(key, coef)
    pathRows.push([pathLabel[key] ?? key, coef ?? '—', se ?? '—', t ?? '—', pText(p)])
    if (coef !== null) kv[`path_${key}_coef`] = coef
    if (se !== null) kv[`path_${key}_se`] = se
    if (t !== null) kv[`path_${key}_t`] = t
    if (p.value !== null) kv[`path_${key}_p`] = p.value
    if (p.display) kv[`path_${key}_pDisplay`] = p.display
  }
  if (pathRows.length > 0) {
    tables.push({
      title: `表${tables.length + 1}  中介模型路径系数`,
      headers: ['路径', '系数', 'SE', 't', 'p'],
      rows: pathRows,
      note:
        '注：a 为 X → M 的回归系数；b 为控制 X 后 M → Y 的系数；c′ 为控制 M 后 X → Y 的系数；' +
        'c 为 X → Y 的简单回归系数。四者必须满足 c = c′ + a·b（容差 1e-10），' +
        '该恒等式不成立即说明模型设定或输出有误。'
    })
  }

  // ── 表2：效应分解 + Bootstrap 分位数 CI ──
  // MED_EFFECT|effect|value|se|ci_lower|ci_upper|ci_method
  //   f[1]=effect f[2]=value f[3]=se f[4]=ci_lower f[5]=ci_upper f[6]=ci_method
  const effectLabel: Record<string, string> = {
    indirect: '间接效应 a×b',
    direct: '直接效应 c′',
    total: '总效应 c',
    prop_mediated: '中介效应占比'
  }
  const effectRows: (string | number)[][] = []
  const valueOf = new Map<string, number | null>()
  /** 实际用到的 CI 方法（契约要求如实标注 percentile / bca） */
  const ciMethods = new Set<string>()
  for (const line of tagged(output, 'MED_EFFECT')) {
    const f = fields(line)
    const key = (f[1] ?? '').trim()
    const value = toNum(f[2])
    const se = toNum(f[3])
    const lo = toNum(f[4])
    const hi = toNum(f[5])
    const method = (f[6] ?? '').trim()
    if (method) ciMethods.add(method)
    valueOf.set(key, value)
    effectRows.push([
      effectLabel[key] ?? key,
      value ?? '—',
      se ?? '—',
      lo ?? '—',
      hi ?? '—',
      method || '—',
      ciZeroText(lo, hi)
    ])
    // 表与 kv 同源：同一个局部常量写两处，绝不各算一遍
    if (value !== null) kv[key] = value
    if (se !== null) kv[`${key}_se`] = se
    if (lo !== null) kv[`${key}_ci_lower`] = lo
    if (hi !== null) kv[`${key}_ci_upper`] = hi
    const excludes = ciExcludesZero(lo, hi)
    if (excludes !== null) kv[`${key}_ci_excludes_zero`] = excludes ? '是' : '否'
  }
  const boot = parseBootLine(firstTagged(output, 'MED_BOOT'))
  const bootLine = bootText(boot)
  if (effectRows.length > 0) {
    tables.push({
      title: `表${tables.length + 1}  效应分解与 Bootstrap 置信区间`,
      headers: ['效应', '效应值', 'SE', 'CI 下限', 'CI 上限', 'CI 方法', 'CI 是否含 0'],
      rows: effectRows,
      note:
        '注：间接效应 = a×b，直接效应 = c′，总效应 = c = c′ + a·b。' +
        'CI 为 Bootstrap 分位数区间（主推断依据），Sobel 检验仅为正态近似对照。' +
        `Bootstrap 配置：${bootLine}。` +
        '「CI 是否含 0」为区间端点是否覆盖 0 的直读结果：含 0 表示该效应在该置信水平下' +
        '不可区分于 0；中介效应占比在总效应接近 0 时不可解释（契约要求输出 NA 而非 Inf）。'
    })
    if (ciMethods.size > 0) kv['ci_method'] = Array.from(ciMethods).join(',')
  }

  // ── MED_SOBEL|z|p_display|p_raw ──
  const sobel = firstTagged(output, 'MED_SOBEL')
  if (sobel) {
    const f = fields(sobel)
    const z = toNum(f[1])
    const p = pPair(f[2], f[3])
    if (z !== null) kv['sobel_z'] = z
    if (p.value !== null) kv['sobel_p'] = p.value
    if (p.display) kv['sobel_pDisplay'] = p.display
  }

  // ── MED_BOOT 的四个字段 ──
  if (boot) {
    if (boot.b !== null) kv['boot_B'] = boot.b
    if (boot.seed !== null) kv['boot_seed'] = boot.seed
    if (boot.ci_level !== null) kv['boot_ci_level'] = boot.ci_level
    if (boot.method) kv['boot_method'] = boot.method
  }

  // ── 表3：标准化系数 ──
  // MED_STD|path|std_coef
  {
    const stdLabel: Record<string, string> = {
      a_std: 'a（标准化）',
      b_std: 'b（标准化）',
      c_prime_std: 'c′（标准化）',
      indirect_std: '间接效应（标准化）'
    }
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'MED_STD')) {
      const f = fields(line)
      const key = (f[1] ?? '').trim()
      const v = toNum(f[2])
      rows.push([stdLabel[key] ?? key, v ?? '—'])
      if (v !== null) kv[`std_${key}`] = v
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  标准化路径系数`,
        headers: ['路径', '标准化系数'],
        rows,
        note:
          '注：X / M / Y 分别做 z 分数标准化后重跑两个回归得到，用于跨变量比较相对效应大小；' +
          '标准化间接效应 = a_std × b_std。'
      })
    }
  }

  // ── 契约恒等式自检：只报警，绝不改写 R 端给的值 ──
  //
  // 三态输出（见 selfCheckVerdict）：
  //   一致 / 不一致 / 无法判断。**「无法判断」不是冗余**——
  //   注入实验证明：把 MED_PATH 的键名拼错后，所有 `if (x !== null && ...)`
  //   会整段跳过，自检变成"永远一致"的空转，测试全绿。
  //   现在缺任何一个契约保证会输出的量，都会显式降级为「无法判断」。
  if (tagged(output, 'MED_PATH').length > 0 && tagged(output, 'MED_EFFECT').length > 0) {
    const missing: string[] = []
    const a = requireForCheck(coefOf.get('a') ?? null, 'a', missing)
    const b = requireForCheck(coefOf.get('b') ?? null, 'b', missing)
    const cP = requireForCheck(coefOf.get('c_prime') ?? null, 'c_prime', missing)
    const cT = requireForCheck(coefOf.get('c_total') ?? null, 'c_total', missing)
    const indirect = requireForCheck(valueOf.get('indirect') ?? null, 'indirect', missing)
    const direct = requireForCheck(valueOf.get('direct') ?? null, 'direct', missing)
    const total = requireForCheck(valueOf.get('total') ?? null, 'total', missing)
    const broken: string[] = []
    if (a !== null && b !== null && cP !== null && cT !== null) {
      const dev = Math.abs(cT - (cP + a * b))
      if (dev > IDENTITY_TOL) broken.push(`c ≠ c′ + a·b（偏差 ${fmtNum(dev, 6)}）`)
    }
    if (a !== null && b !== null && indirect !== null) {
      const dev = Math.abs(indirect - a * b)
      if (dev > IDENTITY_TOL) broken.push(`indirect ≠ a×b（偏差 ${fmtNum(dev, 6)}）`)
    }
    if (cP !== null && direct !== null && Math.abs(direct - cP) > IDENTITY_TOL) {
      broken.push(`direct ≠ c′（偏差 ${fmtNum(Math.abs(direct - cP), 6)}）`)
    }
    if (cT !== null && total !== null && Math.abs(total - cT) > IDENTITY_TOL) {
      broken.push(`total ≠ c（偏差 ${fmtNum(Math.abs(total - cT), 6)}）`)
    }
    if (direct !== null && indirect !== null && total !== null) {
      const dev = Math.abs(total - (direct + indirect))
      if (dev > IDENTITY_TOL) broken.push(`total ≠ direct + indirect（偏差 ${fmtNum(dev, 6)}）`)
    }
    kv['恒等式自检'] = selfCheckVerdict(broken, missing)
    if (broken.length > 0) kv['恒等式偏差'] = broken.join('；')
    if (missing.length > 0) kv['恒等式缺失字段'] = missing.join('、')
  }

  const notes = textLines(output, 'MED_NOTE')
  if (notes.length > 0) kv['提示'] = notes.join('；')

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/**
 * 解析调节效应（Moderation）。
 *
 * 行契约（V032_CONTRACT.md 第二节）：
 *   MOD_SPEC  |n|x|w|y|centered                      centered ∈ 是 / 否
 *   MOD_COEF  |term|coef|se|t|p_display|p_raw        term ∈ x / w / x_w / intercept
 *   MOD_MODEL |r2|adj_r2|f|p_display|p_raw|df1|df2
 *   MOD_DELTA |r2_change|f_change|df1|df2|p_display|p_raw
 *   MOD_SLOPE |w_level|w_value|slope|se|t|p_display|p_raw   w_level ∈ -1SD / mean / +1SD
 *   MOD_JOHNSON|region|lower|upper
 *   MOD_NOTE  |text
 *   CONCL     |text
 *
 * 三处最容易被"顺手重算"的地方，本解析器一律只透传：
 *   1. **简单斜率的 slope 字段**。契约要求 `se = sqrt(L'VL)`（线性组合法），
 *      而 `slope` 本身由 R 端用 `b1 + b3·w0` 算出。若 TS 侧再算一遍 slope，
 *      两条实现迟早漂移，且会让"R 端算错的 slope"永远无法被发现——
 *      所以这里**透传** slope，只在末尾做契约恒等式自检（差异只报警，不改值）。
 *   2. **center 声明**。`centered` 决定表注写「已中心化」还是「未中心化」。
 *      硬编码任一句都会让另一半输出说谎（v0.3.1 的"半吊子重复实现"教训）。
 *   3. **显著性口径**。交互项是否显著只来自 R 端的 p；TS 不做判定，
 *      只交叉核对 `MOD_COEF` 的 x_w 与 `MOD_DELTA` 的 p 是否同向
 *      （契约要求的"同一模型的两种呈现"），不一致时打 warning。
 */
function parseModeration(output: string, tables: TableData[], kv: Record<string, string | number>) {
  // ── MOD_SPEC|n|x|w|y|centered ──
  const spec = firstTagged(output, 'MOD_SPEC')
  const nObs = spec ? toNum(fields(spec)[1]) : null
  const varX = spec ? (fields(spec)[2] ?? '').trim() : ''
  const varW = spec ? (fields(spec)[3] ?? '').trim() : ''
  const varY = spec ? (fields(spec)[4] ?? '').trim() : ''
  const centeredRaw = spec ? (fields(spec)[5] ?? '').trim() : ''
  const centered = toBoolCN(centeredRaw)
  if (nObs !== null) kv['n'] = nObs
  if (varX) kv['x'] = varX
  if (varW) kv['w'] = varW
  if (varY) kv['y'] = varY
  // 原样透传，同时给一个布尔码便于程序分支；不根据其它字段反推
  if (centeredRaw) kv['centered'] = centeredRaw
  if (centered !== null) kv['centered_code'] = centered ? 1 : 0

  /** 中心化声明的人话（表注用）。只翻译，不判定。 */
  const centeredText =
    centered === null
      ? 'R 端未声明是否中心化'
      : centered
        ? `已对 ${varX || 'X'} 与 ${varW || 'W'} 做均值中心化（mean-centering）`
        : `未做中心化（${varX || 'X'} 与 ${varW || 'W'} 均为原始尺度）`

  // ── 表1：回归系数（含交互项）──
  // MOD_COEF|term|coef|se|t|p_display|p_raw
  //   f[1]=term f[2]=coef f[3]=se f[4]=t f[5]=p展示串 f[6]=p原始值
  const termLabel: Record<string, string> = {
    x: `${varX || 'X'}（自变量）`,
    w: `${varW || 'W'}（调节变量）`,
    x_w: `${varX || 'X'} × ${varW || 'W'}（交互项）`,
    intercept: '截距'
  }
  const coefOf = new Map<string, number>()
  const pOf = new Map<string, number | null>()
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'MOD_COEF')) {
      const f = fields(line)
      const key = (f[1] ?? '').trim()
      const coef = toNum(f[2])
      const se = toNum(f[3])
      const t = toNum(f[4])
      const p = pPair(f[5], f[6])
      if (coef !== null) coefOf.set(key, coef)
      pOf.set(key, p.value)
      rows.push([termLabel[key] ?? key, coef ?? '—', se ?? '—', t ?? '—', pText(p)])
      // 表与 kv 同源
      if (coef !== null) kv[`coef_${key}`] = coef
      if (se !== null) kv[`se_${key}`] = se
      if (t !== null) kv[`t_${key}`] = t
      if (p.value !== null) kv[`p_${key}`] = p.value
      if (p.display) kv[`p_${key}_display`] = p.display
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  调节效应回归系数`,
        headers: ['项', '系数', 'SE', 't', 'p'],
        rows,
        note:
          `注：模型为 ${varY || 'Y'} = b0 + b1·${varX || 'X'} + b2·${varW || 'W'} + b3·(${varX || 'X'}·${varW || 'W'})。` +
          '交互项（x × w）的系数即 b3，其显著性表示调节效应是否存在。' +
          `${centeredText}。`
      })
    }
  }

  // ── 表2：模型整体解释力与交互项增量检验 ──
  // MOD_MODEL|r2|adj_r2|f|p_display|p_raw|df1|df2
  //   f[1]=r2 f[2]=adj_r2 f[3]=f f[4]=p展示串 f[5]=p原始值 f[6]=df1 f[7]=df2
  // MOD_DELTA|r2_change|f_change|df1|df2|p_display|p_raw
  //   f[1]=r2_change f[2]=f_change f[3]=df1 f[4]=df2 f[5]=p展示串 f[6]=p原始值
  const model = firstTagged(output, 'MOD_MODEL')
  const delta = firstTagged(output, 'MOD_DELTA')
  {
    const rows: (string | number)[][] = []
    let modelP: { value: number | null; display: string } = { value: null, display: '' }
    let deltaP: { value: number | null; display: string } = { value: null, display: '' }
    if (model) {
      const f = fields(model)
      const r2 = toNum(f[1])
      const adjR2 = toNum(f[2])
      const fStat = toNum(f[3])
      modelP = pPair(f[4], f[5])
      const df1 = toNum(f[6])
      const df2 = toNum(f[7])
      rows.push(['R²', r2 ?? '—', '含交互项模型的解释率', pText(modelP)])
      rows.push(['调整 R²', adjR2 ?? '—', '按参数个数校正', ''])
      rows.push(['F', fStat ?? '—', `df = (${df1 ?? '—'}, ${df2 ?? '—'})`, pText(modelP)])
      if (r2 !== null) kv['r2'] = r2
      if (adjR2 !== null) kv['adj_r2'] = adjR2
      if (fStat !== null) kv['F'] = fStat
      if (modelP.value !== null) kv['p'] = modelP.value
      if (modelP.display) kv['pDisplay'] = modelP.display
      if (df1 !== null) kv['df1'] = df1
      if (df2 !== null) kv['df2'] = df2
    }
    if (delta) {
      const f = fields(delta)
      const r2Change = toNum(f[1])
      const fChange = toNum(f[2])
      const ddf1 = toNum(f[3])
      const ddf2 = toNum(f[4])
      deltaP = pPair(f[5], f[6])
      rows.push(['ΔR²（加入交互项）', r2Change ?? '—', '对照模型：仅主效应 Y ~ X + W', ''])
      rows.push([
        'ΔF',
        fChange ?? '—',
        `df = (${ddf1 ?? '—'}, ${ddf2 ?? '—'})`,
        pText(deltaP)
      ])
      if (r2Change !== null) kv['r2_change'] = r2Change
      if (fChange !== null) kv['f_change'] = fChange
      if (ddf1 !== null) kv['delta_df1'] = ddf1
      if (ddf2 !== null) kv['delta_df2'] = ddf2
      if (deltaP.value !== null) kv['delta_p'] = deltaP.value
      if (deltaP.display) kv['delta_pDisplay'] = deltaP.display
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  模型解释力与交互项增量检验`,
        headers: ['指标', '数值', '说明', 'p'],
        rows,
        note:
          '注：ΔR² / ΔF 的对照模型是只含主效应的 Y ~ X + W，当前模型为 Y ~ X * W，' +
          '因此 ΔR² 就是交互项带来的那部分解释力。' +
          'ΔF 的 p 与交互项系数的 p 是同一模型的两种呈现，二者必须同向。' +
          `${centeredText}。`
      })
    }
  }

  // ── 表3：简单斜率 ──
  // MOD_SLOPE|w_level|w_value|slope|se|t|p_display|p_raw
  //   f[1]=w_level f[2]=w_value f[3]=slope f[4]=se f[5]=t f[6]=p展示串 f[7]=p原始值
  const slopeOf = new Map<string, number>()
  const slopeWValue = new Map<string, number | null>()
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'MOD_SLOPE')) {
      const f = fields(line)
      const level = (f[1] ?? '').trim()
      const wValue = toNum(f[2])
      const slope = toNum(f[3])
      const se = toNum(f[4])
      const t = toNum(f[5])
      const p = pPair(f[6], f[7])
      if (slope !== null) slopeOf.set(level, slope)
      slopeWValue.set(level, wValue)
      rows.push([
        level || '—',
        wValue ?? '—',
        slope ?? '—',
        se ?? '—',
        t ?? '—',
        pText(p)
      ])
      if (slope !== null) kv[`slope_${level}`] = slope
      if (se !== null) kv[`slope_se_${level}`] = se
      if (t !== null) kv[`slope_t_${level}`] = t
      if (p.value !== null) kv[`slope_p_${level}`] = p.value
      if (p.display) kv[`slope_pDisplay_${level}`] = p.display
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  简单斜率分析`,
        headers: ['W 水平', 'W 取值', '简单斜率', 'SE', 't', 'p'],
        rows,
        note:
          `注：简单斜率 = b1 + b3·w0，w0 为 ${varW || 'W'} 在 mean−1SD / mean / mean+1SD 处的取值。` +
          'SE 由线性组合法求得（se = √(L′VL)，L = [0, 1, 0, w0]，V = vcov(fit)），' +
          '不是"在 w0 附近取子集重新回归"——后者会给出虚假的置信区间。' +
          `R² 变化可结合上表解读；${centeredText}。`
      })
    }
  }

  // ── 表4：Johnson-Neyman 区间（可选，失败不中断）──
  // MOD_JOHNSON|region|lower|upper
  {
    const rows: (string | number)[][] = []
    let idx = 0
    for (const line of tagged(output, 'MOD_JOHNSON')) {
      const f = fields(line)
      const region = (f[1] ?? '').trim()
      const lo = toNum(f[2])
      const hi = toNum(f[3])
      idx++
      rows.push([region || '—', lo ?? '—', hi ?? '—'])
      kv[`jn_region_${idx}`] = region
      if (lo !== null) kv[`jn_lower_${idx}`] = lo
      if (hi !== null) kv[`jn_upper_${idx}`] = hi
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  Johnson-Neyman 显著性区间`,
        headers: ['区间', '下限', '上限'],
        rows,
        note:
          `注：Johnson-Neyman 法给出 ${varW || 'W'} 取值范围内简单斜率显著的区间；` +
          '区间外表示该取值处调节效应不显著。计算失败时 R 端会跳过本表，不作为错误。'
      })
    }
  }

  // ── 契约一致性自检：只报警，不改值 ──
  const checks: string[] = []
  const b1 = coefOf.get('x') ?? null
  const b3 = coefOf.get('x_w') ?? null
  if (b1 !== null && b3 !== null) {
    for (const [level, slope] of slopeOf) {
      const w0 = slopeWValue.get(level) ?? null
      if (w0 === null) continue
      const dev = Math.abs(slope - (b1 + b3 * w0))
      if (dev > IDENTITY_TOL) {
        checks.push(`simple slope(${level}) ≠ b1 + b3·w0（偏差 ${fmtNum(dev, 6)}）`)
      }
    }
  }
  // 交互项 p 与 ΔF 的 p 必须同向（契约要求"同一模型的两种呈现"）。
  // 这里只比较两个 R 端给出的 p，不引入新的推断。
  const pXW = pOf.get('x_w') ?? null
  const deltaLine = firstTagged(output, 'MOD_DELTA')
  const deltaPVal = deltaLine ? pPair(fields(deltaLine)[5], fields(deltaLine)[6]).value : null
  let significantAgree: '一致' | '不一致' | '无法判断' = '无法判断'
  if (pXW !== null && deltaPVal !== null) {
    const same = (pXW < 0.05) === (deltaPVal < 0.05)
    significantAgree = same ? '一致' : '不一致'
    if (!same) {
      checks.push(
        `交互项 p（${fmtNum(pXW, 4)}）与 ΔF 的 p（${fmtNum(deltaPVal, 4)}）显著性不同向`
      )
    }
  }
  kv['交互项显著性自检'] = significantAgree
  // 三态收口：拿不到 b1/b3 或拿不到任何简单斜率时，自检并未发生，
  // 必须报「无法判断」而不是"一致"（空转通过是本项目最危险的失败形态）。
  const modMissing: string[] = []
  if (b1 === null) modMissing.push('x（b1）')
  if (b3 === null) modMissing.push('x_w（b3）')
  if (slopeOf.size === 0) modMissing.push('简单斜率')
  if (slopeOf.size > 0 && Array.from(slopeOf.keys()).every((k) => slopeWValue.get(k) == null)) {
    modMissing.push('简单斜率的 W 取值')
  }
  kv['一致性自检'] = selfCheckVerdict(checks, tagged(output, 'MOD_COEF').length > 0 ? modMissing : [])
  if (checks.length > 0) kv['一致性偏差'] = checks.join('；')
  if (modMissing.length > 0) kv['一致性缺失字段'] = modMissing.join('、')

  const notes = textLines(output, 'MOD_NOTE')
  if (notes.length > 0) kv['提示'] = notes.join('；')

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/**
 * 解析有调节的中介（Moderated Mediation）。
 *
 * 行契约（V032_CONTRACT.md 第三节）：
 *   MM_SPEC |n|x|m|y|w
 *   MM_COEF |model|term|coef|se|t|p_display|p_raw      model ∈ m / y；term 如 x / w / x_w / m
 *   MM_INDEX|index|se|ci_lower|ci_upper
 *   MM_COND |w_level|w_value|a_cond|indirect|ci_lower|ci_upper
 *   MM_BOOT |B|seed|ci_level|method
 *   MM_NOTE |text
 *   CONCL   |text
 *
 * 这个方法的独特风险：`MM_COEF` 是**两个方程混在一条长表里**，
 * 用 `model` 列区分（m 方程 / y 方程）。两个方程里都有名为 `x` 的项，
 * 但含义完全不同（m 方程里是 a2，y 方程里是 c）。如果解析器只按 term 建索引
 * 而不按 (model, term) 建索引，后者会静默覆盖前者——表里仍然有两个 `x` 行，
 * 值也是合法小数，但条件间接效应的自检从此失去意义。
 * 所以这里一律用 `model:term` 复合键。
 */
function parseModeratedMediation(
  output: string,
  tables: TableData[],
  kv: Record<string, string | number>
) {
  // ── MM_SPEC|n|x|m|y|w ──
  const spec = firstTagged(output, 'MM_SPEC')
  const nObs = spec ? toNum(fields(spec)[1]) : null
  const varX = spec ? (fields(spec)[2] ?? '').trim() : ''
  const varM = spec ? (fields(spec)[3] ?? '').trim() : ''
  const varY = spec ? (fields(spec)[4] ?? '').trim() : ''
  const varW = spec ? (fields(spec)[5] ?? '').trim() : ''
  if (nObs !== null) kv['n'] = nObs
  if (varX) kv['x'] = varX
  if (varM) kv['m'] = varM
  if (varY) kv['y'] = varY
  if (varW) kv['w'] = varW

  // ── 表1：两个方程的系数（长表，按 model 分节展示）──
  // MM_COEF|model|term|coef|se|t|p_display|p_raw
  //   f[1]=model f[2]=term f[3]=coef f[4]=se f[5]=t f[6]=p展示串 f[7]=p原始值
  const modelLabel: Record<string, string> = {
    m: `${varM || 'M'} 方程（中介变量）`,
    y: `${varY || 'Y'} 方程（结果变量）`
  }
  const termLabel: Record<string, string> = {
    x: `${varX || 'X'}（自变量）`,
    w: `${varW || 'W'}（调节变量）`,
    x_w: `${varX || 'X'} × ${varW || 'W'}（交互项 a4）`,
    m: `${varM || 'M'}（中介变量 b）`,
    intercept: '截距'
  }
  /** 复合键 `model:term` → 系数。两个方程里都有 term=x，必须分开存 */
  const coefOf = new Map<string, number>()
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'MM_COEF')) {
      const f = fields(line)
      const model = (f[1] ?? '').trim()
      const term = (f[2] ?? '').trim()
      const coef = toNum(f[3])
      const se = toNum(f[4])
      const t = toNum(f[5])
      const p = pPair(f[6], f[7])
      if (coef !== null) coefOf.set(`${model}:${term}`, coef)
      rows.push([
        modelLabel[model] ?? model,
        termLabel[term] ?? term,
        coef ?? '—',
        se ?? '—',
        t ?? '—',
        pText(p)
      ])
      if (coef !== null) kv[`coef_${model}_${term}`] = coef
      if (se !== null) kv[`se_${model}_${term}`] = se
      if (t !== null) kv[`t_${model}_${term}`] = t
      if (p.value !== null) kv[`p_${model}_${term}`] = p.value
      if (p.display) kv[`p_${model}_${term}_display`] = p.display
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  两个回归方程的系数`,
        headers: ['方程', '项', '系数', 'SE', 't', 'p'],
        rows,
        note:
          `注：中介方程 ${varM || 'M'} = a1 + a2·${varX || 'X'} + a3·${varW || 'W'} + a4·(${varX || 'X'}·${varW || 'W'})；` +
          `结果方程 ${varY || 'Y'} = c′ + b·${varM || 'M'} + c·${varX || 'X'}。` +
          `a4 是 ${varW || 'W'} 对 ${varX || 'X'} → ${varM || 'M'} 这条路径的调节系数，b 是 ${varM || 'M'} → ${varY || 'Y'} 的系数。`
      })
    }
  }

  // ── 表2：index of moderated mediation ──
  // MM_INDEX|index|se|ci_lower|ci_upper
  //   f[1]=index f[2]=se f[3]=ci_lower f[4]=ci_upper
  const indexLine = firstTagged(output, 'MM_INDEX')
  if (indexLine) {
    const f = fields(indexLine)
    const idxVal = toNum(f[1])
    const idxSe = toNum(f[2])
    const idxLo = toNum(f[3])
    const idxHi = toNum(f[4])
    tables.push({
      title: `表${tables.length + 1}  有调节的中介效应指数 (index of moderated mediation)`,
      headers: ['指标', '数值', 'CI 下限', 'CI 上限', 'CI 是否含 0'],
      rows: [
        [
          'index = a4 × b',
          idxVal ?? '—',
          idxLo ?? '—',
          idxHi ?? '—',
          ciZeroText(idxLo, idxHi)
        ],
        ['SE（Bootstrap）', idxSe ?? '—', '', '', '']
      ],
      note:
        '注：index of moderated mediation = a4 × b，衡量调节变量每变动一个单位、间接效应随之变化多少。' +
        '其置信区间必须来自 Bootstrap 分位数（不能只用 Sobel 正态近似）。' +
        'index 是否显著回答的是「调节是否作用于中介链路」，' +
        '**不等于**每个 W 水平下的条件间接效应都显著——两者必须分开报告。'
    })
    // 表与 kv 同源
    if (idxVal !== null) kv['index'] = idxVal
    if (idxSe !== null) kv['index_se'] = idxSe
    if (idxLo !== null) kv['index_ci_lower'] = idxLo
    if (idxHi !== null) kv['index_ci_upper'] = idxHi
    const excludes = ciExcludesZero(idxLo, idxHi)
    if (excludes !== null) kv['index_ci_excludes_zero'] = excludes ? '是' : '否'
  }

  // ── 表3：条件间接效应 ──
  // MM_COND|w_level|w_value|a_cond|indirect|ci_lower|ci_upper
  //   f[1]=w_level f[2]=w_value f[3]=a_cond f[4]=indirect f[5]=ci_lower f[6]=ci_upper
  const condIndirect = new Map<string, number>()
  const condWValue = new Map<string, number | null>()
  const condA = new Map<string, number>()
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'MM_COND')) {
      const f = fields(line)
      const level = (f[1] ?? '').trim()
      const wValue = toNum(f[2])
      const aCond = toNum(f[3])
      const indirect = toNum(f[4])
      const lo = toNum(f[5])
      const hi = toNum(f[6])
      if (indirect !== null) condIndirect.set(level, indirect)
      condWValue.set(level, wValue)
      if (aCond !== null) condA.set(level, aCond)
      rows.push([
        level || '—',
        wValue ?? '—',
        aCond ?? '—',
        indirect ?? '—',
        lo ?? '—',
        hi ?? '—',
        ciZeroText(lo, hi)
      ])
      // key 里带上 level，避免不同水平互相覆盖
      kv[`cond_${level}_a`] = aCond ?? 'NA'
      kv[`cond_${level}_indirect`] = indirect ?? 'NA'
      if (lo !== null) kv[`cond_${level}_ci_lower`] = lo
      if (hi !== null) kv[`cond_${level}_ci_upper`] = hi
      const excludes = ciExcludesZero(lo, hi)
      if (excludes !== null) kv[`cond_${level}_ci_excludes_zero`] = excludes ? '是' : '否'
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  各 ${varW || 'W'} 水平下的条件间接效应`,
        headers: ['W 水平', 'W 取值', '条件 a', '条件间接效应', 'CI 下限', 'CI 上限', 'CI 是否含 0'],
        rows,
        note:
          '注：条件间接效应 = (a2 + a4·W)·b；W 取 mean−1SD / mean / mean+1SD 三个水平。' +
          '「CI 是否含 0」为区间端点是否覆盖 0 的直读结果。' +
          'index 显著 ≠ 每个水平都显著：可能存在「index 显著、其中某个水平不显著」的情形，' +
          '必须逐水平报告区间，不能只报 index。'
      })
    }
  }

  // ── MM_BOOT ──
  const boot = parseBootLine(firstTagged(output, 'MM_BOOT'))
  if (boot) {
    if (boot.b !== null) kv['boot_B'] = boot.b
    if (boot.seed !== null) kv['boot_seed'] = boot.seed
    if (boot.ci_level !== null) kv['boot_ci_level'] = boot.ci_level
    if (boot.method) kv['boot_method'] = boot.method
  }
  // Bootstrap 配置补进 index 表的表注（表注本来就必须声明推断来源）
  const idxTable = tables.find((t) => t.title.includes('有调节的中介效应指数'))
  if (idxTable) {
    idxTable.note = `${idxTable.note}Bootstrap 配置：${bootText(boot)}。`
  }

  // ── 契约恒等式自检：index = a4·b；条件间接 = (a2 + a4·W)·b ──
  // MM_COEF 是**两个方程混在一条长表**里，必须按 `model:term` 复合键取量。
  // 注入实验证明：若只按 term 建索引，y:m 之类会覆盖同名的行，a2/a4/b 取不到，
  // 整段自检静默空转并报"一致"——因此这里对每个契约保证输出的量做缺失登记。
  if (tagged(output, 'MM_COEF').length > 0) {
    const missing: string[] = []
    const a2 = requireForCheck(coefOf.get('m:x') ?? null, 'm:x（a2）', missing)
    const a4 = requireForCheck(coefOf.get('m:x_w') ?? null, 'm:x_w（a4）', missing)
    const bCoef = requireForCheck(coefOf.get('y:m') ?? null, 'y:m（b）', missing)
    const broken: string[] = []
    if (a4 !== null && bCoef !== null && indexLine) {
      const idxVal = toNum(fields(indexLine)[1])
      if (idxVal !== null) {
        const dev = Math.abs(idxVal - a4 * bCoef)
        if (dev > IDENTITY_TOL) {
          broken.push(`index ≠ a4×b（偏差 ${fmtNum(dev, 6)}）`)
        }
      }
    }
    if (a2 !== null && a4 !== null && bCoef !== null) {
      for (const [level, indirect] of condIndirect) {
        const w0 = condWValue.get(level) ?? null
        if (w0 === null) continue
        const expected = (a2 + a4 * w0) * bCoef
        const dev = Math.abs(indirect - expected)
        if (dev > IDENTITY_TOL) {
          broken.push(`条件间接效应(${level}) ≠ (a2 + a4·W)·b（偏差 ${fmtNum(dev, 6)}）`)
        }
        // a_cond 与 (a2 + a4·W) 也必须对上，否则表里「条件 a」列是装饰品
        const aC = condA.get(level) ?? null
        if (aC !== null) {
          const devA = Math.abs(aC - (a2 + a4 * w0))
          if (devA > IDENTITY_TOL) {
            broken.push(`条件 a(${level}) ≠ a2 + a4·W（偏差 ${fmtNum(devA, 6)}）`)
          }
        }
      }
    }
    kv['恒等式自检'] = selfCheckVerdict(broken, missing)
    if (broken.length > 0) kv['恒等式偏差'] = broken.join('；')
    if (missing.length > 0) kv['恒等式缺失字段'] = missing.join('、')
  }

  const notes = textLines(output, 'MM_NOTE')
  if (notes.length > 0) kv['提示'] = notes.join('；')

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/**
 * 解析路径分析（Path Analysis）。
 *
 * 行契约（V032_CONTRACT.md 第四节）：
 *   PATH_SPEC  |n|nodes|n_edges
 *   PATH_EDGE  |from|to|coef|se|t|p_display|p_raw|std_coef
 *   PATH_EQ    |dv|r2|adj_r2|f|p_display|p_raw
 *   PATH_EFFECT|from|to|direct|indirect|total
 *   PATH_NOTE  |text
 *   CONCL      |text
 *
 * 本方法最容易"看起来对"的错位是 total 取成 direct（漏掉 indirect）。
 * 二者只差一个 indirect，而 indirect 在样本量不大时常常只有 0.0x 量级，
 * 肉眼看表根本发现不了。所以除了逐格断言，解析器还要在**展示层**做两件事：
 *   1. 效应分解表里把 direct / indirect / total 三列并排，并单列一列
 *      「total − direct」——它必须等于 indirect，用户一眼能核对；
 *   2. 契约自检 `total == direct + indirect`，不一致时给出偏差值。
 * 注意 `PATH_EFFECT` 是多行（每个 from→to 对一行），必须按 from/to 建复合键，
 * 不能只取第一行（旧式 `firstTagged` 会静默丢掉第 2 条及以后的所有效应）。
 */
function parsePathAnalysis(
  output: string,
  tables: TableData[],
  kv: Record<string, string | number>
) {
  // ── PATH_SPEC|n|nodes|n_edges ──
  const spec = firstTagged(output, 'PATH_SPEC')
  const nObs = spec ? toNum(fields(spec)[1]) : null
  const nNodes = spec ? toNum(fields(spec)[2]) : null
  const nEdges = spec ? toNum(fields(spec)[3]) : null
  if (nObs !== null) kv['n'] = nObs
  if (nNodes !== null) kv['节点数'] = nNodes
  if (nEdges !== null) kv['边数'] = nEdges

  // ── 表1：逐条路径 ──
  // PATH_EDGE|from|to|coef|se|t|p_display|p_raw|std_coef
  //   f[1]=from f[2]=to f[3]=coef f[4]=se f[5]=t f[6]=p展示串 f[7]=p原始值 f[8]=std_coef
  {
    const rows: (string | number)[][] = []
    const edgeCoef = new Map<string, number>()
    for (const line of tagged(output, 'PATH_EDGE')) {
      const f = fields(line)
      const from = (f[1] ?? '').trim()
      const to = (f[2] ?? '').trim()
      const coef = toNum(f[3])
      const se = toNum(f[4])
      const t = toNum(f[5])
      const p = pPair(f[6], f[7])
      const std = toNum(f[8])
      if (coef !== null) edgeCoef.set(`${from}->${to}`, coef)
      rows.push([
        `${from} → ${to}`,
        coef ?? '—',
        se ?? '—',
        t ?? '—',
        pText(p),
        std ?? '—'
      ])
      if (coef !== null) kv[`edge_${from}_${to}_coef`] = coef
      if (std !== null) kv[`edge_${from}_${to}_std`] = std
      if (p.value !== null) kv[`edge_${from}_${to}_p`] = p.value
      if (p.display) kv[`edge_${from}_${to}_display`] = p.display
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  路径系数`,
        headers: ['路径', '非标准化系数', 'SE', 't', 'p', '标准化系数'],
        rows,
        note:
          '注：每条路径由 OLS 逐方程估计得到（首版不做 ML-SEM）；' +
          '标准化系数为对全部变量 z 标准化后重估的系数，可用于比较不同路径的相对强度。'
      })
    }
  }

  // ── 表2：逐方程拟合 ──
  // PATH_EQ|dv|r2|adj_r2|f|p_display|p_raw
  //   f[1]=dv f[2]=r2 f[3]=adj_r2 f[4]=f f[5]=p展示串 f[6]=p原始值
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'PATH_EQ')) {
      const f = fields(line)
      const dv = (f[1] ?? '').trim()
      const r2 = toNum(f[2])
      const adjR2 = toNum(f[3])
      const fStat = toNum(f[4])
      const p = pPair(f[5], f[6])
      rows.push([dv || '—', r2 ?? '—', adjR2 ?? '—', fStat ?? '—', pText(p)])
      if (r2 !== null) kv[`eq_${dv}_r2`] = r2
      if (adjR2 !== null) kv[`eq_${dv}_adj_r2`] = adjR2
      if (fStat !== null) kv[`eq_${dv}_f`] = fStat
      if (p.value !== null) kv[`eq_${dv}_p`] = p.value
      if (p.display) kv[`eq_${dv}_pDisplay`] = p.display
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  各内生变量方程拟合`,
        headers: ['内生变量', 'R²', '调整 R²', 'F', 'p'],
        rows,
        note:
          '注：每个有入边的内生变量各跑一个 OLS：dv ~ 所有指向它的节点。' +
          '首版采用 OLS 逐方程估计，不是联合 ML 估计——两者在**恰好识别**时等价，' +
          '在过度识别时不等价，报告时须说明本结果来自逐方程 OLS。'
      })
    }
  }

  // ── 表3：效应分解 ──
  // PATH_EFFECT|from|to|direct|indirect|total
  //   f[1]=from f[2]=to f[3]=direct f[4]=indirect f[5]=total
  {
    const rows: (string | number)[][] = []
    const broken: string[] = []
    const missing: string[] = []
    for (const line of tagged(output, 'PATH_EFFECT')) {
      const f = fields(line)
      const from = (f[1] ?? '').trim()
      const to = (f[2] ?? '').trim()
      const direct = toNum(f[3])
      const indirect = toNum(f[4])
      const total = toNum(f[5])
      // 契约要求「无中介通路时 indirect 输出 0 而不是 NA」，
      // 所以 indirect 为 0 是合法值、不是缺失；只有字段真的取不到才登记缺失。
      if (direct === null) missing.push(`${from}→${to} 的 direct`)
      if (indirect === null) missing.push(`${from}→${to} 的 indirect`)
      if (total === null) missing.push(`${from}→${to} 的 total`)
      // 「total − direct」独立成列：它必须等于 indirect。
      // 这一列存在的唯一目的是让"total 漏掉 indirect"这类错位肉眼可见。
      const diff = total !== null && direct !== null ? total - direct : null
      rows.push([
        `${from} → ${to}`,
        direct ?? '—',
        indirect ?? '—',
        total ?? '—',
        diff === null ? '—' : fmtNum(diff, 4)
      ])
      if (direct !== null) kv[`effect_${from}_${to}_direct`] = direct
      if (indirect !== null) kv[`effect_${from}_${to}_indirect`] = indirect
      if (total !== null) kv[`effect_${from}_${to}_total`] = total
      if (direct !== null && indirect !== null && total !== null) {
        const dev = Math.abs(total - (direct + indirect))
        if (dev > IDENTITY_TOL) {
          broken.push(`${from} → ${to}：total ≠ direct + indirect（偏差 ${fmtNum(dev, 6)}）`)
        }
      }
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  效应分解（直接 / 间接 / 总效应）`,
        headers: ['路径', '直接效应', '间接效应', '总效应', '总效应 − 直接效应'],
        rows,
        note:
          '注：direct 为直接路径系数（无直接路径时为 0）；indirect 为所有中介通路乘积之和；' +
          'total = direct + indirect。「总效应 − 直接效应」必须等于「间接效应」列，可据此自查；' +
          '若图中不存在任何中介通路，间接效应输出 0 而非 NA。'
      })
    }
    if (broken.length > 0) {
      kv['恒等式自检'] = '不一致'
      kv['恒等式偏差'] = broken.join('；')
    } else if (rows.length > 0) {
      kv['恒等式自检'] = selfCheckVerdict(broken, missing)
    }
    if (missing.length > 0) kv['恒等式缺失字段'] = missing.join('、')
  }

  const notes = textLines(output, 'PATH_NOTE')
  if (notes.length > 0) kv['提示'] = notes.join('；')

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/**
 * 解析结构方程模型（SEM）。
 *
 * 行契约（V032_CONTRACT.md 第五节）：
 *   SEM_SPEC   |n|n_latent|n_obs
 *   SEM_MEASURE|latent|indicator|std_load|unstd_load|se|z|p_display|p_raw|r2
 *   SEM_STRUCT |from|to|coef|se|z|p_display|p_raw
 *   SEM_LATENT |latent|r2
 *   SEM_FIT    |chisq|df|p_display|p_raw|cfi|tli|rmsea|srmr
 *   SEM_NOTE   |text
 *   CONCL      |text
 *
 * 契约硬性要求「拟合指标公式与 v0.3.1 的 CFA 完全一致」——那不是一句说明，
 * 而是一条**可断言的结构约束**：两边表题、表头、指标顺序、参考标准列
 * 都必须是同一套（见 parser-fields-v032.test.ts 里的跨方法比对）。
 * 本解析器因此刻意复用 CFA 的指标清单与参考标准文案，只把 χ²/df 之外
 * 的来源标签换成 SEM 的口径（无零模型行——契约的 SEM_FIT 不含零模型）。
 *
 * CFI / TLI / RMSEA / SRMR 四个 0.9x / 0.0x 的小数并排躺在同一行，
 * 互换后「拟合良好」依然成立，只是报告了错的指标——这正是 v0.3.1 CFA
 * 那节的同类风险，故一并逐格断言。
 */
function parseSem(output: string, tables: TableData[], kv: Record<string, string | number>) {
  // ── SEM_SPEC|n|n_latent|n_obs ──
  const spec = firstTagged(output, 'SEM_SPEC')
  const nObs = spec ? toNum(fields(spec)[1]) : null
  const nLatent = spec ? toNum(fields(spec)[2]) : null
  const nIndicators = spec ? toNum(fields(spec)[3]) : null
  if (nObs !== null) kv['n'] = nObs
  if (nLatent !== null) kv['潜变量数'] = nLatent
  if (nIndicators !== null) kv['观测变量数'] = nIndicators

  // ── 表1：测量模型 ──
  // SEM_MEASURE|latent|indicator|std_load|unstd_load|se|z|p_display|p_raw|r2
  //   f[1]=latent f[2]=indicator f[3]=std_load f[4]=unstd_load
  //   f[5]=se f[6]=z f[7]=p展示串 f[8]=p原始值 f[9]=r2
  {
    const rows: (string | number)[][] = []
    const loadRows: Array<{ latent: string; indicator: string; std: number; r2: number | null }> = []
    for (const line of tagged(output, 'SEM_MEASURE')) {
      const f = fields(line)
      const latent = (f[1] ?? '').trim()
      const indicator = (f[2] ?? '').trim()
      const std = toNum(f[3])
      const unstd = toNum(f[4])
      const se = toNum(f[5])
      const z = toNum(f[6])
      const p = pPair(f[7], f[8])
      const r2 = toNum(f[9])
      rows.push([
        latent || '—',
        indicator || '—',
        std ?? '—',
        unstd ?? '—',
        se ?? '—',
        z ?? '—',
        pText(p),
        r2 ?? '—'
      ])
      if (std !== null) {
        loadRows.push({ latent, indicator, std, r2 })
        kv[`载荷_${latent}_${indicator}`] = std
      }
      if (unstd !== null) kv[`非标准化载荷_${latent}_${indicator}`] = unstd
      if (r2 !== null) kv[`载荷R2_${latent}_${indicator}`] = r2
      if (z !== null) kv[`载荷z_${latent}_${indicator}`] = z
      if (p.value !== null) kv[`载荷p_${latent}_${indicator}`] = p.value
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  测量模型（标准化载荷）`,
        headers: ['潜变量', '指标', '标准化载荷', '非标准化载荷', 'SE', 'z', 'p', 'R²'],
        rows,
        note:
          '注：标准化载荷 = λ / √σ_jj；R² = 标准化载荷²，表示该指标被潜变量解释的方差比例。' +
          '每潜变量的第一个指标为 marker 指标（非标准化载荷固定为 1），因此其 SE / z / p 不可解释。' +
          'SE / z / p 由数值 Hessian 得到的近似信息矩阵计算（V = 2/(n−1)·H⁻¹）。'
      })
      // 载荷汇总（供 AI 解读；与表同源）
      const loads = loadRows.map((r) => r.std)
      if (loads.length > 0) {
        const minLoad = Math.min(...loads)
        const maxLoad = Math.max(...loads)
        kv['标准化载荷范围'] = `${fmtNum(minLoad, 4)} ~ ${fmtNum(maxLoad, 4)}`
        kv['最小标准化载荷'] = minLoad
        // Heywood 案例的展示性提示；判定口径仍以 R 端 SEM_NOTE 为准
        if (loads.some((v) => Math.abs(v) > 1)) kv['存在超界载荷'] = '是'
      }
      kv['载荷项数'] = rows.length
    }
  }

  // ── 表2：结构模型 ──
  // SEM_STRUCT|from|to|coef|se|z|p_display|p_raw
  //   f[1]=from f[2]=to f[3]=coef f[4]=se f[5]=z f[6]=p展示串 f[7]=p原始值
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'SEM_STRUCT')) {
      const f = fields(line)
      const from = (f[1] ?? '').trim()
      const to = (f[2] ?? '').trim()
      const coef = toNum(f[3])
      const se = toNum(f[4])
      const z = toNum(f[5])
      const p = pPair(f[6], f[7])
      rows.push([`${from} → ${to}`, coef ?? '—', se ?? '—', z ?? '—', pText(p)])
      if (coef !== null) kv[`结构_${from}_${to}_coef`] = coef
      if (se !== null) kv[`结构_${from}_${to}_se`] = se
      if (z !== null) kv[`结构_${from}_${to}_z`] = z
      if (p.value !== null) kv[`结构_${from}_${to}_p`] = p.value
      if (p.display) kv[`结构_${from}_${to}_pDisplay`] = p.display
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  结构模型（潜变量间的路径）`,
        headers: ['路径', '系数', 'SE', 'z', 'p'],
        rows,
        note:
          '注：结构模型为 η = Bη + ζ，Φ = (I−B)⁻¹Ψ(I−B)⁻ᵀ，潜变量方差固定为 1 识别。' +
          '系数为潜变量尺度上的直接效应；z 为 Wald 检验统计量（系数 / 数值 Hessian 标准误）。'
      })
    }
  }

  // ── 表3：内生潜变量 R² + 拟合指标（同一张表，避免"表在但只有标题"）──
  // SEM_LATENT|latent|r2
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'SEM_LATENT')) {
      const f = fields(line)
      const latent = (f[1] ?? '').trim()
      const r2 = toNum(f[2])
      rows.push([latent || '—', r2 ?? '—'])
      if (r2 !== null) kv[`潜变量R2_${latent}`] = r2
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  内生潜变量解释率 R²`,
        headers: ['潜变量', 'R²'],
        rows,
        note:
          '注：R² = 1 − ζ 方差 / 潜变量方差，表示该内生潜变量被上游潜变量解释的比例；' +
          '外生潜变量没有 R²，故不出现在本表。'
      })
    }
  }

  // ── 表4：拟合指标（指标清单与参考标准与 CFA 完全一致）──
  // SEM_FIT|chisq|df|p_display|p_raw|cfi|tli|rmsea|srmr
  //   f[1]=chisq f[2]=df f[3]=p展示串 f[4]=p原始值
  //   f[5]=cfi f[6]=tli f[7]=rmsea f[8]=srmr
  const fit = firstTagged(output, 'SEM_FIT')
  if (fit) {
    const f = fields(fit)
    const chisq = toNum(f[1])
    const df = toNum(f[2])
    const p = pPair(f[3], f[4])
    const cfi = toNum(f[5])
    const tli = toNum(f[6])
    const rmsea = toNum(f[7])
    const srmr = toNum(f[8])
    // χ²/df 是常见报告量；df = 0（恰好识别）时不可除，必须给占位而不是 Infinity
    const chisqDf = chisq !== null && df !== null && df > 0 ? chisq / df : null
    tables.push({
      title: `表${tables.length + 1}  模型拟合指标`,
      headers: ['指标', '数值', '参考标准'],
      rows: [
        ['χ²', chisq === null ? '—' : fmtNum(chisq, 4), '越小越好'],
        ['df', df === null ? '—' : df, 'df = p(p+1)/2 − npar'],
        ['p', pText(p), 'p > .05 表示模型与数据无显著失配'],
        ['χ²/df', fmtNum(chisqDf, 4), '< 3 可接受，< 2 良好'],
        ['CFI', fmtNum(cfi, 4), '≥ .90 可接受，≥ .95 良好'],
        ['TLI', fmtNum(tli, 4), '≥ .90 可接受，≥ .95 良好'],
        ['RMSEA', fmtNum(rmsea, 4), '≤ .08 可接受，≤ .06 良好'],
        ['SRMR', fmtNum(srmr, 4), '≤ .08 良好']
      ],
      note:
        '注：χ² 检验对样本量敏感，大样本下几乎必然显著，应结合 CFI / TLI / RMSEA / SRMR 综合判断。' +
        '拟合指标公式与验证性因子分析（CFA）完全一致：CFI、TLI 由零模型卡方推导，' +
        'df ≤ 0 时（恰好识别或不可识别）CFI = TLI = 1、RMSEA = 0。' +
        '本表数值来自 ML 拟合（F_ML = ln|Σ| + tr(RΣ⁻¹) − ln|R| − p），' +
        '与 CFA 同一套框架、同一套起点策略（optim BFGS，5 个起点取 F 最小者）。'
    })
    if (chisq !== null) kv['chi2'] = chisq
    if (df !== null) kv['df'] = df
    if (p.value !== null) kv['p'] = p.value
    if (p.display) kv['pDisplay'] = p.display
    if (chisqDf !== null) kv['chi2_df'] = chisqDf
    if (cfi !== null) kv['CFI'] = cfi
    if (tli !== null) kv['TLI'] = tli
    if (rmsea !== null) kv['RMSEA'] = rmsea
    if (srmr !== null) kv['SRMR'] = srmr
  }

  const notes = textLines(output, 'SEM_NOTE')
  if (notes.length > 0) kv['提示'] = notes.join('；')

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/**
 * 层次回归解析（v0.3.4 / T75）
 *
 * 输出契约：
 *   HIER_SPEC|<区块数>|<总变量数>|<每块大小逗号分隔>
 *   HIER_MODEL|<块号>|<变量列表>|<R²>|<adjR²>|<ΔR²>|<ΔF>|<df1>|<df2>|<p>|<p_raw>
 *   HIER_COEF|<块号>|<变量>|<b>|<se>|<t>|<p>|<p_raw>
 *   HIER_NOTE|...
 */
function parseHierarchicalRegression(
  output: string,
  tables: TableData[],
  kv: Record<string, string | number>
) {
  const spec = firstTagged(output, 'HIER_SPEC')
  const nBlocks = spec ? toNum(fields(spec)[1]) : null
  const nVars = spec ? toNum(fields(spec)[2]) : null
  if (nBlocks !== null) kv['区块数'] = nBlocks
  if (nVars !== null) kv['自变量数'] = nVars

  // ── 表1：逐区块模型比较 ──
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'HIER_MODEL')) {
      const f = fields(line)
      const idx = toNum(f[1])
      const vars = (f[2] ?? '').trim()
      const r2 = toNum(f[3])
      const adj = toNum(f[4])
      const dr2 = toNum(f[5])
      const dfVal = toNum(f[6])
      const df1 = toNum(f[7])
      const df2 = toNum(f[8])
      const p = pPair(f[9], f[10])
      rows.push([
        `第 ${idx ?? '?'} 块`,
        vars,
        r2 ?? '—',
        adj ?? '—',
        dr2 ?? '—',
        dfVal ?? '—',
        df1 !== null && df2 !== null ? `(${df1}, ${df2})` : '—',
        pText(p)
      ])
      if (idx !== null) {
        if (r2 !== null) kv[`block${idx}_r2`] = r2
        if (dr2 !== null) kv[`block${idx}_delta_r2`] = dr2
        if (dfVal !== null) kv[`block${idx}_delta_f`] = dfVal
        if (p.value !== null) kv[`block${idx}_p`] = p.value
      }
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  层次回归：逐区块模型比较`,
        headers: ['区块', '进入的变量', 'R²', '调整 R²', 'ΔR²', 'ΔF', 'Δdf', 'p'],
        rows,
        note:
          '注：ΔR² 是该区块相对「上一区块模型」的增量解释力，ΔF 检验其显著性。' +
          '所有区块在同一批样本上拟合，ΣΔR² 与最终模型 R² 相等（R 端有自检）。' +
          '区块的进入顺序由用户指定，不同顺序会改变各块的 ΔR²，这是层次回归的定义使然，不是错误。'
      })
    }
  }

  // ── 表2：新增变量的系数 ──
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'HIER_COEF')) {
      const f = fields(line)
      const block = toNum(f[1])
      const v = (f[2] ?? '').trim()
      const b = toNum(f[3])
      const se = toNum(f[4])
      const t = toNum(f[5])
      const p = pPair(f[6], f[7])
      rows.push([`第 ${block ?? '?'} 块`, v, b ?? '—', se ?? '—', t ?? '—', pText(p)])
      if (v) {
        if (b !== null) kv[`coef_${v}`] = b
        if (p.value !== null) kv[`p_${v}`] = p.value
      }
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  各区块新增变量的回归系数`,
        headers: ['所属区块', '变量', 'b', 'SE', 't', 'p'],
        rows,
        note:
          '注：系数取自「该变量首次进入模型」的那一步，与最终模型的系数相同' +
          '（回归系数不随后续变量加入而改变其点估计的含义，但 SE 会变）。'
      })
    }
  }

  const notes = textLines(output, 'HIER_NOTE')
  if (notes.length > 0) kv['提示'] = notes.join('；')
  const warns = textLines(output, 'HIER_WARN')
  if (warns.length > 0) kv['警告'] = warns.join('；')

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}

/**
 * Logistic 回归解析（v0.3.4 / T76）
 *
 * 输出契约：
 *   LOGIT_SPEC|<binary|ordinal>|<dv>|<K>|<N>
 *   LOGIT_LEVEL|<序号>|<水平名>|<计数>
 *   LOGIT_FIT|<N>|<null_dev>|<resid_dev>|<AIC>|<McFadden>|<CoxSnell>|<Nagelkerke>
 *   LOGIT_LR|<chi2>|<df>|<p>|<p_raw>
 *   LOGIT_COEF|<变量>|<b>|<se>|<z>|<p>|<p_raw>|<OR>|<OR_lo>|<OR_hi>
 *   LOGIT_THRESH|<序号>|<阈值>|<se>
 *   LOGIT_PO_CHECK|<变量>|<斜率1>|<斜率2>|...
 *   LOGIT_ACC|<acc>|<base_acc>|<N>
 */
function parseLogisticRegression(
  output: string,
  tables: TableData[],
  kv: Record<string, string | number>
) {
  const spec = firstTagged(output, 'LOGIT_SPEC')
  if (spec) {
    const f = fields(spec)
    kv['模型类型'] = f[1] === 'ordinal' ? '有序 Logistic（比例优势模型）' : '二元 Logistic'
    kv['因变量'] = (f[2] ?? '').trim()
    const k = toNum(f[3])
    if (k !== null) kv['类别数'] = k
    const n = toNum(f[4])
    if (n !== null) kv['n'] = n
  }

  // ── 表1：样本分布 ──
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'LOGIT_LEVEL')) {
      const f = fields(line)
      const idx = toNum(f[1])
      const lvl = (f[2] ?? '').trim()
      const cnt = toNum(f[3])
      rows.push([idx ?? '—', lvl, cnt ?? '—'])
      if (lvl && cnt !== null) kv[`level_${lvl}_n`] = cnt
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  因变量各水平分布`,
        headers: ['序号', '类别', '频数'],
        rows,
        note:
          '注：最小类别观测数少于 5 时，Logistic 回归的估计极不稳定（标准误很大），' +
          '结果不宜作为结论依据。'
      })
    }
  }

  // ── 表2：模型拟合与检验 ──
  {
    const fit = firstTagged(output, 'LOGIT_FIT')
    const lr = firstTagged(output, 'LOGIT_LR')
    const rows: (string | number)[][] = []
    if (fit) {
      const f = fields(fit)
      const aic = toNum(f[4])
      const mcf = toNum(f[5])
      const cs = toNum(f[6])
      const ng = toNum(f[7])
      if (aic !== null) kv['AIC'] = aic
      if (mcf !== null) kv['McFadden R2'] = mcf
      if (cs !== null) kv['Cox-Snell R2'] = cs
      if (ng !== null) kv['Nagelkerke R2'] = ng
      rows.push(['AIC', aic ?? '—'], ['McFadden 伪 R²', mcf ?? '—'])
      rows.push(['Cox-Snell 伪 R²', cs ?? '—'], ['Nagelkerke 伪 R²', ng ?? '—'])
    }
    if (lr) {
      const f = fields(lr)
      const chi2 = toNum(f[1])
      const df = toNum(f[2])
      const p = pPair(f[3], f[4])
      if (chi2 !== null) kv['LR chi2'] = chi2
      if (p.value !== null) kv['LR p'] = p.value
      if (p.display) kv['LR pDisplay'] = p.display
      rows.push(['似然比检验 χ²', chi2 ?? '—'], ['自由度', df ?? '—'])
      rows.push(['似然比检验 p', pText(p)])
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  模型拟合与整体检验`,
        headers: ['指标', '值'],
        rows,
        note:
          '注：Logistic 回归的伪 R²（McFadden / Cox-Snell / Nagelkerke）不能像线性回归的 R² 那样' +
          '解释为「解释了多少比例的方差」，只用于模型间相对比较。'
      })
    }
  }

  // ── 表3：系数与优势比 ──
  {
    const rows: (string | number)[][] = []
    const isOrdinal = (kv['模型类型'] as string || '').includes('有序')
    for (const line of tagged(output, 'LOGIT_COEF')) {
      const f = fields(line)
      const v = (f[1] ?? '').trim()
      const b = toNum(f[2])
      const se = toNum(f[3])
      const z = toNum(f[4])
      const p = pPair(f[5], f[6])
      const OR = toNum(f[7])
      const lo = toNum(f[8])
      const hi = toNum(f[9])
      rows.push([
        v,
        b ?? '—',
        se ?? '—',
        z ?? '—',
        pText(p),
        OR ?? '—',
        lo !== null && hi !== null ? `[${lo}, ${hi}]` : '—'
      ])
      if (v) {
        if (b !== null) kv[`coef_${v}`] = b
        if (OR !== null) kv[`OR_${v}`] = OR
        if (p.value !== null) kv[`p_${v}`] = p.value
        if (p.display) kv[`p_${v}_display`] = p.display
      }
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  回归系数与优势比`,
        headers: ['变量', 'b', 'SE', 'z', 'p', 'OR = exp(b)', 'OR 95% CI'],
        rows,
        note: isOrdinal
          ? '注：有序 Logistic 采用比例优势模型（假定各阈值下自变量斜率相同），' +
            '因此不报告截距（截距被吸收进阈值，与阈值不可同时识别）。' +
            'b > 0 表示该变量越大越倾向更高的类别。OR 为累积优势比。'
          : '注：OR > 1 表示该变量增加时事件发生优势上升；OR 的 95% CI 跨 1 等价于 p > .05。'
      })
    }
  }

  // ── 表4：阈值（仅有序） ──
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'LOGIT_THRESH')) {
      const f = fields(line)
      const idx = toNum(f[1])
      const th = toNum(f[2])
      const se = toNum(f[3])
      rows.push([`阈值 ${idx ?? '?'}`, th ?? '—', se ?? '—'])
    }
    if (rows.length > 0) {
      tables.push({
        title: `表${tables.length + 1}  类别阈值估计`,
        headers: ['阈值', '估计值', 'SE'],
        rows,
        note: '注：阈值为累计 logit 尺度上的切点，用于把连续潜变量切成有序类别；通常不直接解释其数值大小。'
      })
    }
  }

  // ── 表5：比例优势假设检查（仅有序） ──
  {
    const rows: (string | number)[][] = []
    for (const line of tagged(output, 'LOGIT_PO_CHECK')) {
      const f = fields(line)
      const v = (f[1] ?? '').trim()
      const slopes = (f[2] ?? '').split('|').map((s) => s.trim())
      rows.push([v, ...slopes])
    }
    if (rows.length > 0) {
      const maxSlope = Math.max(...rows.map((r) => r.length))
      const headers = ['变量']
      for (let i = 1; i < maxSlope; i++) headers.push(`阈值 ${i} 的斜率`)
      tables.push({
        title: `表${tables.length + 1}  比例优势假设检查`,
        headers,
        rows,
        note:
          '注：比例优势模型假定「各阈值下自变量的斜率相同」。本表把每个阈值拆成二元 logit 分别估计，' +
          '若同一变量在不同阈值下的斜率差异较大，说明该假设可能不成立，此时模型的结论不可靠，' +
          '建议改用多项 Logistic 或把因变量合并为二分类。这是描述性检查，不是正式的统计检验。'
      })
    }
  }

  // ── 分类准确率 ──
  const acc = firstTagged(output, 'LOGIT_ACC')
  if (acc) {
    const f = fields(acc)
    const a = toNum(f[1])
    const base = toNum(f[2])
    if (a !== null) kv['分类准确率'] = a
    if (base !== null) kv['基线准确率'] = base
    if (a !== null && base !== null) kv['相对基线提升'] = Number((a - base).toFixed(4))
  }

  const notes = textLines(output, 'LOGIT_NOTE')
  if (notes.length > 0) kv['提示'] = notes.join('；')
  const warns = textLines(output, 'LOGIT_WARN')
  if (warns.length > 0) kv['警告'] = warns.join('；')

  const concl = conclusionOf(output)
  if (concl) kv['结论'] = concl
}
