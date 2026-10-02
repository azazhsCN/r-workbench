import Papa from 'papaparse'
import type { ColumnInfo, DatasetInfo } from '@shared/types'
import { decodeBytes, stripBom, type DecodeResult, type SupportedEncoding } from './decode'

/** 解析结果 */
export interface ParseResult {
  headers: string[]
  rows: Record<string, unknown>[]
  columnInfo: ColumnInfo[]
  dataset: DatasetInfo
  /** 非阻断导入警告（字段数不匹配、空表头、公式无缓存值等） */
  warnings?: ParseWarning[]
  /** CSV 路径的编码探测结果 */
  encodingInfo?: DecodeResult
  /** Excel 全部工作表名（用于 sheet 选择器） */
  sheets?: string[]
  /** 实际读取的工作表名 */
  sheetName?: string
  /** 归一化缺失值时实际使用的哨兵集合 */
  sentinels?: string[]
  /** 每个变量有多少个真实取值被当作缺失值（按命中次数排序） */
  sentinelHits?: SentinelHit[]
}

/** 缺失值哨兵命中记录 */
export interface SentinelHit {
  column: string
  /** 命中的原始文本（如 `-999`、`99`、`NA`） */
  sentinel: string
  count: number
}

/** 非阻断导入警告。`code` 与语言无关，UI 通过 `data.warn.<code>` 本地化 */
export interface ParseWarning {
  code: string
  /** 原始消息（用于无对应语言键时兜底显示） */
  message?: string
  /** 1 基文件行号（含表头行） */
  row?: number
  /** 计数类警告的规模 */
  count?: number
  /** 附加参数，用于插值 */
  details?: Record<string, string | number>
}

// ── 缺失值哨兵 ──────────────────────────────────────

/**
 * 默认缺失值哨兵（无歧义）。
 *
 * 这些值在中文问卷 / SPSS 导出中稳定表示缺失，且**不可能是有效观测**：
 * `NA` 是 R 自己的缺失标记；`.` 是 SPSS 的缺失标记；`-999`/`-99` 是常见
 * 的缺失编码。归一化后 `-999` 不再作为有效观测参与均值/标准差/t/r 计算。
 */
export const DEFAULT_MISSING_SENTINELS: readonly string[] = [
  'NA',
  'N/A',
  '#N/A',
  'NULL',
  'NaN',
  '.',
  '-999',
  '-99'
]

/**
 * SPSS 惯例的"数值缺失编码"，**默认不启用**。
 *
 * `99`/`999` 在问卷里常被声明为缺失值，但在真实数据里（例如百分制成绩
 * 99 分、年龄 99 岁）也可能是有效观测。默认把它们当缺失会静默污染统计量，
 * 因此改为用户在导入界面显式勾选后才启用（`spssSentinels`）。
 */
export const SPSS_MISSING_SENTINELS: readonly string[] = ['99', '999', '9999', '-9999']

/** 根据用户选择构造哨兵集合 */
export function sentinelsFor(spssSentinels: boolean): string[] {
  return spssSentinels
    ? [...DEFAULT_MISSING_SENTINELS, ...SPSS_MISSING_SENTINELS]
    : [...DEFAULT_MISSING_SENTINELS]
}

/** 哨兵比较用的规范形式（去空白 + 大写，使 `na`/`Na`/`NA` 等价） */
function sentinelKey(value: string): string {
  return value.trim().toUpperCase()
}

/** 判断单个值是否为缺失（`null`/`undefined`/空白，或命中哨兵集合） */
export function isMissingValue(
  value: unknown,
  sentinels: readonly string[] = DEFAULT_MISSING_SENTINELS
): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return true
    if (sentinels.length === 0) return false
    return sentinels.some((s) => sentinelKey(s) === sentinelKey(trimmed))
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return true
    return sentinels.some((s) => sentinelKey(s) === sentinelKey(String(value)))
  }
  return false
}

/** 单个值是否命中缺失哨兵；命中时返回原始文本，否则 null */
function matchedSentinel(value: unknown, sentinels: readonly string[]): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    return sentinels.some((s) => sentinelKey(s) === sentinelKey(trimmed)) ? trimmed : null
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null
    const text = String(value)
    return sentinels.some((s) => sentinelKey(s) === sentinelKey(text)) ? text : null
  }
  return null
}

/**
 * 缺失值归一化：把哨兵替换成空字符串，**必须先于** `analyzeColumns` 执行。
 *
 * 旧实现只把 `null`/`undefined`/`''` 视为缺失，于是
 * `["1".."8","NA","."]` 被判成 `type: 'unknown'`，而 `unknown` 列既不在
 * `getNumericColumns()` 也不在 `getStringColumns()` 中 → 该列在向导里彻底消失。
 */
export function normalizeMissingValues(
  headers: string[],
  rows: Record<string, unknown>[],
  sentinels: readonly string[] = DEFAULT_MISSING_SENTINELS
): Record<string, unknown>[] {
  return normalizeMissingValuesWithReport(headers, rows, sentinels).rows
}

/**
 * 归一化并**按列统计**有多少个真实取值被当成缺失值。
 *
 * 这一步是"永不静默"的保障：用户勾选 SPSS 惯例（99/999 视为缺失）后，
 * 界面必须告诉他每个变量各有多少个值因此被排除在有效观测之外。
 */
export function normalizeMissingValuesWithReport(
  headers: string[],
  rows: Record<string, unknown>[],
  sentinels: readonly string[] = DEFAULT_MISSING_SENTINELS
): { rows: Record<string, unknown>[]; hits: SentinelHit[] } {
  const counts = new Map<string, Map<string, number>>()

  const normalized = rows.map((row) => {
    const next: Record<string, unknown> = { ...row }
    for (const header of headers) {
      const matched = matchedSentinel(next[header], sentinels)
      if (matched !== null) {
        const perColumn = counts.get(header) ?? new Map<string, number>()
        perColumn.set(matched, (perColumn.get(matched) ?? 0) + 1)
        counts.set(header, perColumn)
      }
      if (matched !== null || isMissingValue(next[header], sentinels)) next[header] = ''
    }
    return next
  })

  const hits: SentinelHit[] = []
  for (const [column, perColumn] of counts) {
    for (const [sentinel, count] of perColumn) hits.push({ column, sentinel, count })
  }
  hits.sort((a, b) => b.count - a.count || a.column.localeCompare(b.column))

  return { rows: normalized, hits }
}

// ── 类型推断 ──────────────────────────────────────

/**
 * 严格的数值字面量判定。
 *
 * 不能用 `!isNaN(Number(val))`：它会把 `true`（→1）、`0x10`（→16）、
 * `Infinity`、`' '`（→0）都当成数值，于是性别/是否类列被误判为 numeric，
 * 而 R 端 `as.numeric("true")` 全是 NA。
 */
const NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export function isNumericLike(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return false
  if (typeof value === 'bigint') return true
  if (value instanceof Date) return false
  if (typeof value === 'string') return NUMERIC_RE.test(value.trim())
  return false
}

/** 分析列的类型和缺失值 */
export function analyzeColumns(
  headers: string[],
  rows: Record<string, unknown>[],
  sentinels: readonly string[] = DEFAULT_MISSING_SENTINELS
): ColumnInfo[] {
  return headers.map((name) => {
    let numericCount = 0
    let missingCount = 0

    for (const row of rows) {
      const val = row[name]
      if (isMissingValue(val, sentinels)) {
        missingCount++
      } else if (isNumericLike(val)) {
        numericCount++
      }
    }

    const nonMissing = rows.length - missingCount
    let type: ColumnInfo['type'] = 'unknown'
    if (nonMissing > 0) {
      // 对称判定：≥80% 可解析为数值 → numeric，否则 → string（保守）。
      // 混合列一律按分类处理：R 端 as.numeric("男") 会静默产生 NA，
      // 把混合列送进数值分析比"少一个数值变量"危险得多。
      // 只有整列都是缺失值时才保留 unknown。
      type = numericCount / nonMissing >= 0.8 ? 'numeric' : 'string'
    }

    return {
      name,
      type,
      missing: missingCount,
      total: rows.length
    }
  })
}

// ── 表头规范化 ──────────────────────────────────────

/** 空表头 → `V1..Vn`（按 1 基列序号）；重复表头 → `name_2`、`name_3` */
export function normalizeHeaders(rawHeaders: unknown[]): {
  headers: string[]
  blank: number
  duplicated: number
} {
  const seen = new Map<string, number>()
  let blank = 0
  let duplicated = 0

  const headers = rawHeaders.map((raw, index) => {
    let name = String(raw ?? '')
      .replace(/^\uFEFF/, '')
      .trim()
    if (name === '') {
      name = `V${index + 1}`
      blank++
    }
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    if (count === 0) return name
    duplicated++
    return `${name}_${count + 1}`
  })

  return { headers, blank, duplicated }
}

// ── 日期格式化 ──────────────────────────────────────

/**
 * 消除 SheetJS 的浮点/时区误差。
 *
 * Excel 日期以"天"的浮点数存储，`cellDates: true` 读回 JS Date 时会落在
 * 整秒边界前 1 毫秒（实测 `2024-01-14 00:00` → `2024-01-13T15:59:59.999Z`，
 * 东八区显示为 `2024-01-13 23:59:59`，日期整整差一天）。把距整秒 ≤5ms 的
 * Date 吸附到整秒即可，且不会损失任何真实精度（Excel 不存亚秒信息）。
 */
export function snapDateToSecond(date: Date): Date {
  const ms = date.getTime()
  if (Number.isNaN(ms)) return date
  const nearestSecond = Math.round(ms / 1000) * 1000
  return Math.abs(ms - nearestSecond) <= 5 ? new Date(nearestSecond) : date
}

/** ISO 风格的日期字符串；R 的 `as.Date()` / `read.csv` 可直接解析 */
export function formatDateValue(input: Date): string {
  const date = snapDateToSecond(input)
  const time = date.getTime()
  if (Number.isNaN(time)) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const h = date.getHours()
  const m = date.getMinutes()
  const s = date.getSeconds()
  if (h === 0 && m === 0 && s === 0) return day
  return `${day} ${pad(h)}:${pad(m)}:${pad(s)}`
}

/** 单元格值序列化：Date → ISO 字符串，其余原样（避免 Papa.unparse 输出 `Sun Jan 14 2024 ...`） */
export function serializeCell(value: unknown): unknown {
  if (value instanceof Date) return formatDateValue(value)
  if (value === undefined) return ''
  return value
}

// ── 结果组装 ──────────────────────────────────────

const WARNING_LIMIT = 50

/** 限制警告条数，超出时追加汇总条目 */
function capWarnings(warnings: ParseWarning[]): ParseWarning[] {
  if (warnings.length <= WARNING_LIMIT) return warnings
  const head = warnings.slice(0, WARNING_LIMIT)
  head.push({ code: 'moreWarnings', count: warnings.length - WARNING_LIMIT })
  return head
}

function buildResult(
  headers: string[],
  rows: Record<string, unknown>[],
  datasetName: string,
  extra: Partial<ParseResult> = {},
  warnings: ParseWarning[] = [],
  sentinels: readonly string[] = DEFAULT_MISSING_SENTINELS
): ParseResult {
  const columnInfo = analyzeColumns(headers, rows, sentinels)
  return {
    headers,
    rows,
    columnInfo,
    dataset: {
      name: datasetName,
      columns: columnInfo,
      rowCount: rows.length
    },
    warnings: capWarnings(warnings),
    sentinels: [...sentinels],
    ...extra
  }
}

// ── CSV ──────────────────────────────────────

export interface CsvParseOptions {
  /** 用户手动指定的编码；省略则自动探测（仅字节路径有效） */
  encoding?: SupportedEncoding
  /** 是否把 99/999 也视为缺失（SPSS 惯例），默认 false */
  spssSentinels?: boolean
  /** 直接指定哨兵集合（优先于 spssSentinels） */
  sentinels?: readonly string[]
}

function resolveSentinels(options?: CsvParseOptions): readonly string[] {
  if (options?.sentinels) return options.sentinels
  return sentinelsFor(options?.spssSentinels === true)
}

/**
 * 按分隔符自动探测的要求，传 `delimiter: ''`。
 * 不传时 papaparse 固定按逗号切分，分号分隔的 CSV（中文 Excel 常见导出）
 * 会整个变成单列 `a;b;c`。
 */
function parseCsvText(
  text: string,
  fileName: string | undefined,
  sentinels: readonly string[]
): {
  headers: string[]
  rows: Record<string, unknown>[]
  warnings: ParseWarning[]
  sentinelHits: SentinelHit[]
} {
  const cleaned = stripBom(text)
  const warnings: ParseWarning[] = []

  const result = Papa.parse<Record<string, unknown>>(cleaned, {
    header: true,
    skipEmptyLines: true,
    // 自动探测分隔符（逗号/分号/制表符/竖线）
    delimiter: '',
    // 不使用 dynamicTyping：它会把学号 007 转成 7（不同 ID 合并成同一组），
    // 也会把 true/false 列当成 numeric。类型推断统一交给 analyzeColumns。
    dynamicTyping: false,
    // 纯函数、幂等：papaparse 在猜测分隔符时会调用两次 transformHeader，
    // 带状态的去重闭包会被二次追加后缀。
    transformHeader: (header, index) => {
      const name = (header ?? '').replace(/^\uFEFF/, '').trim()
      return name === '' ? `V${index + 1}` : name
    }
  })

  const headers = result.meta.fields ?? []

  for (const error of result.errors) {
    // 单列文件本来就没有分隔符，papaparse 的 UndetectableDelimiter 是噪声
    if (error.code === 'UndetectableDelimiter' && headers.length <= 1) continue
    const code = error.code || error.type || 'Unknown'
    warnings.push({
      code: `csv.${code}`,
      message: error.message,
      row: typeof error.row === 'number' ? error.row + 2 : undefined
    })
  }

  const rows: Record<string, unknown>[] = []
  for (const raw of result.data) {
    if (!raw || typeof raw !== 'object') continue
    const row = { ...raw }
    // 字段数多于表头时 papaparse 把多出来的塞进 __parsed_extra，
    // 下游（预览 / analyzeColumns / datasetToCSV）全部忽略它 → 静默错位。
    if ('__parsed_extra' in row) delete row.__parsed_extra
    rows.push(row)
  }

  const { rows: normalized, hits } = normalizeMissingValuesWithReport(headers, rows, sentinels)
  return { headers, rows: normalized, warnings, sentinelHits: hits }
}

/** 解析 CSV 文本（手动输入 / 示例数据 / 已完成解码的文本） */
export function parseCSV(text: string, fileName?: string, options?: CsvParseOptions): ParseResult {
  const sentinels = resolveSentinels(options)
  const { headers, rows, warnings, sentinelHits } = parseCsvText(text, fileName, sentinels)
  return buildResult(headers, rows, fileName || 'data.csv', { sentinelHits }, warnings, sentinels)
}

/**
 * 解析 CSV 字节流（文件导入路径）。
 *
 * 编码探测在渲染进程完成：中文 Excel 导出的 GBK/GB18030 CSV 直接用
 * `TextDecoder()`（UTF-8）解码会产生 U+FFFD，列名在进入 R 之前就毁了。
 */
export function parseCSVBytes(
  input: ArrayBuffer | ArrayBufferView,
  fileName?: string,
  options?: CsvParseOptions
): ParseResult {
  const sentinels = resolveSentinels(options)
  const decoded = decodeBytes(input, options?.encoding)
  const { headers, rows, warnings, sentinelHits } = parseCsvText(decoded.text, fileName, sentinels)

  if (decoded.replacements > 0) {
    warnings.unshift({
      code: 'csv.encodingLossy',
      count: decoded.replacements,
      details: { encoding: decoded.encoding }
    })
  }
  if (decoded.text.trim() === '') {
    warnings.unshift({ code: 'csv.emptyFile' })
  }

  return buildResult(
    headers,
    rows,
    fileName || 'data.csv',
    { encodingInfo: decoded, sentinelHits },
    warnings,
    sentinels
  )
}

// ── Excel ──────────────────────────────────────

type XLSXModule = typeof import('xlsx')
type CellObject = import('xlsx').CellObject
type WorkBook = import('xlsx').WorkBook

let xlsxPromise: Promise<XLSXModule> | null = null

/**
 * 按需加载 xlsx（T13：静态引入会让 xlsx 占据首屏 bundle 近一半）。
 * 兼容 ESM 命名导出与 CJS 默认导出两种形态。
 */
function loadXLSX(): Promise<XLSXModule> {
  if (!xlsxPromise) {
    xlsxPromise = import('xlsx').then((mod) => {
      const candidate = mod as XLSXModule & { default?: XLSXModule }
      return typeof candidate.read === 'function' ? candidate : candidate.default ?? candidate
    })
  }
  return xlsxPromise
}

export interface ExcelParseOptions {
  /** 要读取的工作表名；省略则用第一个 */
  sheetName?: string
  /** 是否把 99/999 也视为缺失（SPSS 惯例），默认 false */
  spssSentinels?: boolean
  sentinels?: readonly string[]
}

async function readWorkbook(input: ArrayBuffer | ArrayBufferView): Promise<WorkBook> {
  const XLSX = await loadXLSX()
  // cellDates: true —— 否则 `2024-01-14` 变成浮点序列号 45306.000497685185，
  // 被当作数值变量写进 data.csv，年龄/日期回归静默跑在序列号上。
  // sheetStubs: true —— 否则"有公式但无缓存值"的单元格会被 SheetJS 直接丢弃，
  // import 后静默变空且无法察觉（Excel 打开时能算，导入时是空的）。
  const data = input instanceof ArrayBuffer ? new Uint8Array(input) : input
  return XLSX.read(data, { type: 'array', cellDates: true, sheetStubs: true })
}

/** 列出工作簿中所有工作表名（供导入界面的 sheet 选择器使用） */
export async function listExcelSheets(input: ArrayBuffer | ArrayBufferView): Promise<string[]> {
  const workbook = await readWorkbook(input)
  return [...workbook.SheetNames]
}

/** 解析 Excel 文件 */
export async function parseExcel(
  input: ArrayBuffer | ArrayBufferView,
  fileName?: string,
  options?: ExcelParseOptions
): Promise<ParseResult> {
  const XLSX = await loadXLSX()
  const sentinels = options?.sentinels ?? sentinelsFor(options?.spssSentinels === true)
  const warnings: ParseWarning[] = []

  const workbook = await readWorkbook(input)
  const sheets = [...workbook.SheetNames]
  const sheetName = options?.sheetName && sheets.includes(options.sheetName)
    ? options.sheetName
    : sheets[0]

  if (options?.sheetName && !sheets.includes(options.sheetName)) {
    warnings.push({ code: 'excel.sheetNotFound', details: { name: options.sheetName } })
  }

  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheet) {
    warnings.push({ code: 'excel.emptySheet' })
    return buildResult([], [], fileName || sheetName || 'data.xlsx', { sheets, sheetName: sheetName ?? '' }, warnings, sentinels)
  }

  // header:1 → 二维数组，表头由我们自己规范化（空表头 → V1..Vn、重复表头去重），
  // 避免空表头变成列名 "" 导致 R 报 "undefined columns selected"。
  //
  // blankrows: true 是必须的：下面的单元格扫描用「行序号 - range.s.r」作为
  // matrix 下标，一旦中间有空行被丢掉，映射就会整体错位。空行在后面统一过滤。
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: true
  })

  // 扫描原始单元格：公式无缓存值 / 错误值（#DIV/0! 等）会静默变成空或数字
  let formulaNoCache = 0
  let errorCells = 0
  if (sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref'])
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })] as CellObject | undefined
        if (!cell) continue
        const rowIndex = r - range.s.r
        const colIndex = c - range.s.c
        // t === 'z' 且带 f = 有公式但 Excel 未写入缓存值（SheetJS 用 stub 表示）
        const formulaWithoutCache =
          (cell.t === 'z' && Boolean(cell.f)) ||
          (Boolean(cell.f) && (cell.v === undefined || cell.v === null || cell.v === ''))
        if (cell.t === 'e') {
          errorCells++
          if (matrix[rowIndex]) matrix[rowIndex][colIndex] = ''
        } else if (formulaWithoutCache) {
          formulaNoCache++
          if (matrix[rowIndex]) matrix[rowIndex][colIndex] = ''
        }
      }
    }
  }

  const rawHeaderRow = matrix.length > 0 ? matrix[0] : []
  const { headers, blank, duplicated } = normalizeHeaders(rawHeaderRow)

  if (blank > 0) warnings.push({ code: 'excel.blankHeader', count: blank })
  if (duplicated > 0) warnings.push({ code: 'excel.duplicateHeader', count: duplicated })
  if (formulaNoCache > 0) warnings.push({ code: 'excel.formulaNoCache', count: formulaNoCache })
  if (errorCells > 0) warnings.push({ code: 'excel.errorCells', count: errorCells })

  const rows: Record<string, unknown>[] = []
  for (let i = 1; i < matrix.length; i++) {
    const arr = matrix[i] ?? []
    // 整行为空（含只由无缓存值公式组成的行）时跳过，避免制造全缺失观测
    if (arr.every((v) => v === '' || v === null || v === undefined)) continue
    const row: Record<string, unknown> = {}
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = serializeCell(arr[c])
    }
    rows.push(row)
  }

  if (rows.length === 0) warnings.push({ code: 'excel.noRows' })

  const { rows: normalized, hits: sentinelHits } = normalizeMissingValuesWithReport(headers, rows, sentinels)
  const name = fileName ? `${fileName}${sheets.length > 1 && sheetName ? ` · ${sheetName}` : ''}` : sheetName || 'data.xlsx'

  return buildResult(
    headers,
    normalized,
    name,
    { sheets, sheetName: sheetName ?? '', sentinelHits },
    warnings,
    sentinels
  )
}

// ── 导出 ──────────────────────────────────────

/** 将数据集转换为 CSV 字符串（用于传给 R） */
export function datasetToCSV(
  headers: string[],
  rows: Record<string, unknown>[]
): string {
  const needsNormalizing = rows.some((row) =>
    headers.some((h) => row[h] instanceof Date || row[h] === undefined)
  )
  const source = needsNormalizing
    ? rows.map((row) => {
        const next: Record<string, unknown> = {}
        for (const h of headers) next[h] = serializeCell(row[h])
        return next
      })
    : rows
  return Papa.unparse(source, { columns: headers })
}
