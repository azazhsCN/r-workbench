/**
 * 数据质量检查（v0.3.3 / T82，对应 TECH_DEBT.md 的 D02 + D03）
 *
 * ── 为什么需要它 ──
 *
 * D02「离群值零防御」：全项目此前**没有任何**离群值检测（grep `outlier|zscore|IQR|离群`
 * 零命中）。实测三组各 20 观测，只把一个单元格改成 `1e6`：
 *   正常:            ANOVA F=229.13, p=5.6e-28（极显著）；α=0.8434
 *   注入 1 个 1e6:   ANOVA F=0.9998,  p=0.374 （不显著）；  α=-0.0000
 * **结论完全翻转，全程 rc=0、零警告。** 用户不会知道结果已被一个录入错误摧毁。
 * 这类失败模式比"算错一个数"危险得多：数值层面完全正确，错的是"该不该算"。
 *
 * D03「值域校验缺失」：5 点量表里填 7 会被当有效观测全流程接受，零提示。
 *
 * ── 设计约束 ──
 *
 * 1. **纯函数**：不读文件、不碰 React、不依赖 R 进程，便于单测与直接调用。
 * 2. **误报与漏报同等重要**：clean 数据必须返回空数组。为此刻意放宽了两处
 *    （见 `iqrFenceRows` 与 `OUTLIER_LOW_TAIL_GUARD` 的注释），并在测试里
 *    用真实李克特形状的数据钉死"不该报的不报"。
 * 3. **不重复定义"缺失"**：缺失判定复用 `dataService.isMissingValue()`，
 *    与导入、R 端共用同一套哨兵常量（单一真相）。
 * 4. **只报告、不修改**：本模块返回 issue 列表，绝不改数据。
 *    与 D05「自动反向计分静默改数据」的教训一致——软件只能告知，不能替用户动手。
 */

import { isMissingValue, isNumericLike } from './dataService'

/** 一条数据质量问题 */
export interface QualityIssue {
  column: string
  kind: 'outlier' | 'out_of_range' | 'high_missing' | 'constant'
  /** 命中的单元格/观测个数 */
  count: number
  /** 1 基数据行号（**不含表头**，即 `rows[0]` 对应 1），用于定位单元格 */
  rows?: number[]
  /** 人类可读说明（含判定依据与原始数值） */
  detail: string
  /**
   * 严重程度（v0.3.3 跟进 / F4，与 R 侧 DQ_NOTE / DQ_WARN 两级对应）：
   * - `warn`：很可能改变结论，需要用户处理（值域越界、常量列、严重极端值）
   * - `note`：轻微，值得看一眼（近围栏的极端值）
   *
   * 为什么要分级：对所有极值都报警且文案一律写"可能改变结论"，
   * 会让用户习惯性忽略——真出事时也就不看了。**误报的代价是让真警报失效。**
   *
   * 可选字段：旧的调用方（未升级的测试）不需要它，缺失时按 `warn` 处理。
   */
  level?: 'warn' | 'note'
}

/** 检查选项 */
export interface DataQualityOptions {
  /**
   * 已知量表的**理论最大值**，按列名给出（如 5 点李克特 `{ q1: 5, q2: 5 }`）。
   * 只对给出的列做值域检查——没给就说明我们不知道它的合法范围，不该猜。
   */
  likertMax?: Record<string, number>
  /** 高缺失阈值（默认 0.30，即 >30% 才报） */
  missingRateThreshold?: number
}

/**
 * 极端值判定的 z 阈值。
 *
 * 单独提为常量而不是内联字面量，是为了让"阈值被改坏"这件事可被测试直接攻击：
 * 把 3 改成 30 后，`dataQuality.test.ts` 里那条"z 检出但 IQR 围栏内"的用例
 * 必须变红（该用例的观测按构造恰好只有 z 能抓到）。
 */
const Z_LIMIT = 3

/** 严重级 z 阈值（v0.3.3 跟进 / F4，与 R 侧一致） */
const Z_LIMIT_SEVERE = 4

/** IQR 围栏倍数（Tukey 的 1.5 倍围栏） */
const IQR_MULTIPLIER = 1.5

/** 严重级 IQR 倍数（3 倍远围栏，与 R 侧一致） */
const IQR_MULTIPLIER_SEVERE = 3

/**
 * 报 `note` 级所需的最小有效样本量（v0.3.3 跟进 / F4）。
 *
 * 小样本下 1.5×IQR 围栏极窄、尾部观测几乎必然命中：实测 n=12 的**干净**数据
 * 就有 4 条命中。这会让告警失去意义（用户习惯性忽略 -> 真警报也失效）。
 * n < 20 时只报严重级。
 */
const MIN_SAMPLE_FOR_NOTE = 20

/** 默认高缺失阈值 */
const DEFAULT_MISSING_RATE = 0.3

/**
 * 判定一列是否为"数值列"的下限。
 *
 * 与 `dataService.analyzeColumns()` 的 `numericCount / nonMissing >= 0.8` 保持一致：
 * 两处若用不同门槛，会出现"向导里是数值变量、质量检查却当字符串跳过"的裂缝。
 */
const NUMERIC_COLUMN_RATIO = 0.8

/** 判定顺序固定，保证同样输入永远产出同样顺序的列表（便于快照与 UI 稳定） */
const KIND_ORDER: QualityIssue['kind'][] = ['outlier', 'out_of_range', 'high_missing', 'constant']

/**
 * 分位数（R 默认的 type-7 口径，与 `stats::quantile(x, type = 7)` 一致）。
 *
 * 为什么必须与 R 对齐：R 侧 `r_quality_check()` 也用 type 7。若两处用不同口径
 * （例如最近秩法），同一条数据在 UI 上显示 N 个离群值、在 R 输出里显示 M 个，
 * 用户会同时看到两个互相矛盾的"事实"——这正是 v0.2.x 四次事故的同一根源。
 *
 * @param sorted 已升序排序的数组
 * @param p 概率（0–1）
 */
export function quantileType7(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return Number.NaN
  if (n === 1) return sorted[0]
  const h = (n - 1) * p
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, n - 1)
  const frac = h - lo
  return sorted[lo] + frac * (sorted[hi] - sorted[lo])
}

/** 一列的有效（非缺失）数值及其 1 基行号 */
interface ColumnSample {
  values: number[]
  /** 与 values 同序的 1 基数据行号 */
  rowNumbers: number[]
  missingRows: number[]
  nonMissingCount: number
  isNumericColumn: boolean
  /** 全部非缺失值的原始文本（用于唯一值计数与常量列判定） */
  rawTexts: string[]
}

/** 把单元格收敛成"用于比较的唯一值文本"（数值与字符串统一口径） */
function valueKey(value: unknown): string {
  if (typeof value === 'number') return String(value)
  return String(value ?? '').trim()
}

/** 抽取一列的可分析数据 */
function sampleColumn(column: string, rows: Record<string, unknown>[]): ColumnSample {
  const values: number[] = []
  const rowNumbers: number[] = []
  const missingRows: number[] = []
  const rawTexts: string[] = []
  let numericCount = 0

  rows.forEach((row, index) => {
    const value = row[column]
    const rowNumber = index + 1 // 1 基，不含表头
    if (isMissingValue(value)) {
      missingRows.push(rowNumber)
      return
    }
    rawTexts.push(valueKey(value))
    if (isNumericLike(value)) {
      numericCount++
      values.push(Number(typeof value === 'string' ? value.trim() : value))
      rowNumbers.push(rowNumber)
    }
  })

  const nonMissingCount = rawTexts.length
  const isNumericColumn =
    nonMissingCount > 0 && numericCount / nonMissingCount >= NUMERIC_COLUMN_RATIO

  return { values, rowNumbers, missingRows, nonMissingCount, isNumericColumn, rawTexts }
}

/**
 * 用 z 分数找出极端值（|z| > Z_LIMIT）。
 *
 * 用**样本标准差**（n−1）。样本量 < 4 时不判定：3 个点算出的 sd 没有判别力，
 * 而"3 个值里 1 个被标成离群"会让小样本分析完全无法进行。
 */
function zScoreRowNumbers(sample: ColumnSample, limit: number = Z_LIMIT): number[] {
  const { values, rowNumbers } = sample
  const n = values.length
  if (n < 4) return []

  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
  const sd = Math.sqrt(variance)
  if (!Number.isFinite(sd) || sd === 0) return [] // 常量列由 constant 规则负责

  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (Math.abs((values[i] - mean) / sd) > limit) out.push(rowNumbers[i])
  }
  return out
}

/**
 * 用 Tukey 的 1.5 倍 IQR 围栏找出极端值（**稳健**口径，不受极端值本身影响）。
 *
 * 两条刻意的取舍：
 *
 * 1. **IQR = 0 时跳过**。当 ≥50% 的观测落在同一个值上（李克特数据极常见，
 *    例如 80% 的人选 5、20% 选 4），IQR 退化为 0，围栏塌缩成单点，
 *    于是那 20% 的合法少数派会被整片标成"离群值"。
 *    这不是漏洞而是必要的误报抑制：IQR=0 时我们无法区分"录入错误"与
 *    "真实的少数派取值"，而 z 分数在 sd>0 时仍能抓住真正的极端值。
 * 2. **两侧围栏都用**（下侧 `Q1 − 1.5·IQR`、上侧 `Q3 + 1.5·IQR`）。
 *    只查上界会让"漏录了一个 0 / 负值"永远不被发现。
 */
function iqrFenceRowNumbers(
  sample: ColumnSample,
  multiplier: number = IQR_MULTIPLIER
): number[] {
  const { values, rowNumbers } = sample
  const n = values.length
  if (n < 4) return []

  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantileType7(sorted, 0.25)
  const q3 = quantileType7(sorted, 0.75)
  const iqr = q3 - q1
  if (!Number.isFinite(iqr) || iqr === 0) return []

  const lower = q1 - multiplier * iqr
  const upper = q3 + multiplier * iqr
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (values[i] < lower || values[i] > upper) out.push(rowNumbers[i])
  }
  return out
}

/** 合并两组行号：去重 + 升序（保持 1 基行号的自然阅读顺序） */
function mergeRows(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y)
}

/** 数值格式化：保留 4 位有效数字，避免 detail 里出现 1e6 之类的字符串噪音 */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  if (Number.isInteger(v) && Math.abs(v) < 1e6) return String(v)
  return String(Number(v.toPrecision(6)))
}

/**
 * 推断一组题项的量表上限（v0.3.3 跟进 / F2，与 R 侧 `rq_infer_likert_max` 逐条对应）。
 *
 * 此前值域检查依赖调用方传 `likertMax`，但**没有任何调用方传**，
 * 于是 `out_of_range` 分支形同不存在（第三方实测：CFA 数据里 q3 含 7 和 0，无任何提示）。
 *
 * 保守推断，只在有强共识时下结论，猜不出就返回 `{}`（宁可不报，不可误报）：
 *   1. 候选 = 全部取值为整数、最小值 ≥ 0、唯一值数在 2..10 之间（像定序量表）
 *   2. 若候选数 ≥ 3 且同一最大值被 ≥ 60% 的候选共享，且该值 ≤ 10 → 认定它就是上限
 *   3. 否则不推断
 */
export function inferLikertMax(
  headers: string[],
  rows: Record<string, unknown>[]
): Record<string, number> {
  const maxs: number[] = []
  for (const column of headers) {
    const sample = sampleColumn(column, rows)
    if (!sample.isNumericColumn) continue
    const v = sample.values
    if (v.length < 3) continue
    if (v.some((x) => Math.abs(x - Math.round(x)) > 1e-8)) continue
    if (Math.min(...v) < 0) continue
    const uniq = new Set(v).size
    if (uniq < 2 || uniq > 10) continue
    maxs.push(Math.max(...v))
  }
  if (maxs.length < 3) return {}

  const tally = new Map<number, number>()
  for (const m of maxs) tally.set(m, (tally.get(m) ?? 0) + 1)
  let best = 0
  let bestCount = 0
  for (const [m, c] of tally) {
    if (c > bestCount || (c === bestCount && m > best)) {
      best = m
      bestCount = c
    }
  }
  if (bestCount / maxs.length < 0.6 || best > 10) return {}

  // 只对"确实像定序量表"的列应用该上限，避免把连续变量误判成越界
  const out: Record<string, number> = {}
  for (const column of headers) {
    const sample = sampleColumn(column, rows)
    if (!sample.isNumericColumn) continue
    const v = sample.values
    if (v.length < 3) continue
    if (v.some((x) => Math.abs(x - Math.round(x)) > 1e-8)) continue
    if (Math.min(...v) < 0) continue
    const uniq = new Set(v).size
    if (uniq < 2 || uniq > 10) continue
    out[column] = best
  }
  return out
}

/**
 * 检查数据质量。
 *
 * @param headers 列名（顺序即输出顺序）
 * @param rows 数据行（`rows[0]` 是第 1 数据行，与表头无关）
 * @param opts 可选：量表的理论最大值、高缺失阈值
 * @returns 问题列表；**干净数据返回空数组**（这条同样是验收标准，不只是"能报警"）
 */
export function checkDataQuality(
  headers: string[],
  rows: Record<string, unknown>[],
  opts: DataQualityOptions = {}
): QualityIssue[] {
  const missingThreshold = opts.missingRateThreshold ?? DEFAULT_MISSING_RATE
  // 调用方显式给了 likertMax 就用它；没给则尝试从数据自身推断量表上限（F2）。
  // 不推断的话 out_of_range 分支形同不存在——那正是第三方发现的问题。
  const likertMax = opts.likertMax ?? inferLikertMax(headers, rows)
  const total = rows.length
  const issues: QualityIssue[] = []

  for (const column of headers) {
    const sample = sampleColumn(column, rows)
    const perKind = new Map<QualityIssue['kind'], QualityIssue>()

    // ── 极端值：z 与 IQR 围栏取并集，并分两级（v0.3.3 跟进 / F4） ──
    // 之所以取并集而不是二选一：z 对"整体分布被一个极端值拉歪"敏感，
    // IQR 对同一情形稳健但要求 IQR > 0；两者互补，单用任一都有盲区。
    //
    // 分级与样本量自适应（与 R 侧 r_quality_check 逐条对应）：
    //   严重级 |z| > 4 或超 3.0×IQR 远围栏 -> level='warn'
    //   轻微级 |z| > 3 或超 1.5×IQR 近围栏 -> level='note'（n < 20 时不报）
    // n < 20 只报严重级：小样本下近围栏几乎必然命中（实测 n=12 干净数据 4 条误报），
    // 全是噪声，报出来只会训练用户忽略告警。
    if (sample.isNumericColumn && sample.values.length >= 4) {
      const n = sample.values.length
      const sorted = [...sample.values].sort((a, b) => a - b)
      const q1 = quantileType7(sorted, 0.25)
      const q3 = quantileType7(sorted, 0.75)
      const iqr = q3 - q1
      const hasFence = Number.isFinite(iqr) && iqr > 0

      const severeRows = mergeRows(
        zScoreRowNumbers(sample, Z_LIMIT_SEVERE),
        hasFence ? iqrFenceRowNumbers(sample, IQR_MULTIPLIER_SEVERE) : []
      )
      let noteRows = mergeRows(
        zScoreRowNumbers(sample, Z_LIMIT),
        hasFence ? iqrFenceRowNumbers(sample, IQR_MULTIPLIER) : []
      ).filter((r) => !severeRows.includes(r))

      // ── IQR = 0 的补位规则（v0.3.3 跟进 / F4）──
      //
      // 当 IQR 退化为 0（≥75% 观测同值，李克特数据极常见），围栏塌缩成单点，
      // 只剩 z 规则。但 z 在小样本下几乎失效：n=5 时单个极端值的 |z| 最多约 2，
      // 永远够不到 3/4 的阈值——实测 [10,10,10,10,9999] 在旧逻辑下**一条都不报**。
      // 这确实是漏报，必须补。
      //
      // 补位方案：IQR=0 说明绝大多数观测挤在同一个值上，此时任何偏离该众数的取值
      // 都是"少数派"。按偏离幅度分级：
      //   - 偏离 > 众数的 50%（相对）或绝对偏离超过 3 个"最小刻度"→ warn
      //   - 其余偏离 → note
      // 用"相对众数"而不是 z，因为 z 的分母被这个极端值自己拉大了。
      if (!hasFence && sample.values.length >= 4) {
        const mode = q1 // IQR=0 时 Q1=Q3=中位数=众数附近
        const devs = sample.values.map((v) => Math.abs(v - mode))
        const sortedDevs = [...devs].sort((a, b) => a - b)
        // 非零最小偏离即数据的最小刻度（避免硬编码 1）
        const minScale = sortedDevs.find((d) => d > 0) ?? 0
        for (let i = 0; i < devs.length; i++) {
          const d = devs[i]
          if (d === 0) continue
          const rel = mode !== 0 ? d / Math.abs(mode) : Number.POSITIVE_INFINITY
          const rowNo = sample.rowNumbers[i]
          if (severeRows.includes(rowNo) || noteRows.includes(rowNo)) continue
          if (rel > 0.5 || (minScale > 0 && d / minScale > 3)) {
            severeRows.push(rowNo)
          } else {
            noteRows.push(rowNo)
          }
        }
        severeRows.sort((a, b) => a - b)
        noteRows = noteRows.sort((a, b) => a - b)
      }

      if (severeRows.length > 0) {
        perKind.set('outlier', {
          column,
          kind: 'outlier',
          level: 'warn',
          count: severeRows.length,
          rows: severeRows,
          detail:
            `检出 ${severeRows.length} 个严重极端值（|z| > ${Z_LIMIT_SEVERE}` +
            (hasFence
              ? ` 或超出 3 倍 IQR 围栏 [${fmt(q1 - IQR_MULTIPLIER_SEVERE * iqr)}, ${fmt(q3 + IQR_MULTIPLIER_SEVERE * iqr)}]`
              : '') +
            `），很可能改变均值/标准差与显著性判断，请核查录入。`
        })
      } else if (noteRows.length > 0 && n >= MIN_SAMPLE_FOR_NOTE) {
        perKind.set('outlier', {
          column,
          kind: 'outlier',
          level: 'note',
          count: noteRows.length,
          rows: noteRows,
          detail:
            `检出 ${noteRows.length} 个轻微极端值（|z| > ${Z_LIMIT}` +
            (hasFence
              ? ` 或超出 IQR 围栏 [${fmt(q1 - IQR_MULTIPLIER * iqr)}, ${fmt(q3 + IQR_MULTIPLIER * iqr)}]`
              : '') +
            `），值得核对，但可能只是自然长尾。`
        })
      }
    }

    // ── 值域越界：只在调用方声明了该列的量表上限时才判定 ──
    const max = likertMax[column]
    if (typeof max === 'number' && Number.isFinite(max) && sample.values.length > 0) {
      const badRows: number[] = []
      let below = 0
      let above = 0
      sample.values.forEach((v, i) => {
        if (v < 1 || v > max) {
          badRows.push(sample.rowNumbers[i])
          if (v < 1) below++
          else above++
        }
      })
      if (badRows.length > 0) {
        perKind.set('out_of_range', {
          column,
          level: 'warn',
          kind: 'out_of_range',
          count: badRows.length,
          rows: badRows,
          detail:
            `检出 ${badRows.length} 个越界取值（${below} 个 < 1，${above} 个 > ${max}），` +
            `该列按 ${max} 点量表检查，越界值不应参与统计。`
        })
      }
    }

    // ── 高缺失 ──
    if (total > 0) {
      const rate = sample.missingRows.length / total
      if (rate > missingThreshold) {
        perKind.set('high_missing', {
          column,
          level: 'warn',
          kind: 'high_missing',
          count: sample.missingRows.length,
          rows: sample.missingRows,
          detail:
            `缺失 ${sample.missingRows.length}/${total}（${(rate * 100).toFixed(1)}%），` +
            `超过 ${(missingThreshold * 100).toFixed(0)}% 阈值；` +
            `整列删除会显著缩小可用样本，请确认缺失机制。`
        })
      }
    }

    // ── 常量列（唯一值 = 1） ──
    if (sample.nonMissingCount > 0) {
      const unique = new Set(sample.rawTexts)
      if (unique.size === 1) {
        perKind.set('constant', {
          column,
          level: 'warn',
          kind: 'constant',
          count: sample.nonMissingCount,
          detail:
            `整列只有一个取值（${[...unique][0]}），不提供任何变异信息；` +
            `参与相关/回归/因子分析会产生奇异矩阵或除零。`
        })
      }
    }

    for (const kind of KIND_ORDER) {
      const issue = perKind.get(kind)
      if (issue) issues.push(issue)
    }
  }

  return issues
}


