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

/** IQR 围栏倍数（Tukey 的 1.5 倍围栏） */
const IQR_MULTIPLIER = 1.5

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
function zScoreRowNumbers(sample: ColumnSample): number[] {
  const { values, rowNumbers } = sample
  const n = values.length
  if (n < 4) return []

  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
  const sd = Math.sqrt(variance)
  if (!Number.isFinite(sd) || sd === 0) return [] // 常量列由 constant 规则负责

  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (Math.abs((values[i] - mean) / sd) > Z_LIMIT) out.push(rowNumbers[i])
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
function iqrFenceRowNumbers(sample: ColumnSample): number[] {
  const { values, rowNumbers } = sample
  const n = values.length
  if (n < 4) return []

  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantileType7(sorted, 0.25)
  const q3 = quantileType7(sorted, 0.75)
  const iqr = q3 - q1
  if (!Number.isFinite(iqr) || iqr === 0) return []

  const lower = q1 - IQR_MULTIPLIER * iqr
  const upper = q3 + IQR_MULTIPLIER * iqr
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
  const likertMax = opts.likertMax ?? {}
  const total = rows.length
  const issues: QualityIssue[] = []

  for (const column of headers) {
    const sample = sampleColumn(column, rows)
    const perKind = new Map<QualityIssue['kind'], QualityIssue>()

    // ── 极端值：z 与 IQR 围栏取并集（任一命中即报） ──
    // 之所以取并集而不是二选一：z 对"整体分布被一个极端值拉歪"敏感，
    // IQR 对同一情形稳健但要求 IQR > 0；两者互补，单用任一都有盲区。
    if (sample.isNumericColumn && sample.values.length >= 4) {
      const zRows = zScoreRowNumbers(sample)
      const iqrRows = iqrFenceRowNumbers(sample)
      const hitRows = mergeRows(zRows, iqrRows)
      if (hitRows.length > 0) {
        const sorted = [...sample.values].sort((a, b) => a - b)
        const q1 = quantileType7(sorted, 0.25)
        const q3 = quantileType7(sorted, 0.75)
        const iqr = q3 - q1
        perKind.set('outlier', {
          column,
          kind: 'outlier',
          count: hitRows.length,
          rows: hitRows,
          detail:
            `检出 ${hitRows.length} 个极端值（|z| > ${Z_LIMIT} 或超出 IQR 围栏 ` +
            `[${fmt(q1 - IQR_MULTIPLIER * iqr)}, ${fmt(q3 + IQR_MULTIPLIER * iqr)}]），` +
            `可能显著改变均值/标准差与显著性判断，请核查录入。`
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


