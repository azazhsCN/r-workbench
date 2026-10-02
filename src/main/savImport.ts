/**
 * savImport.ts — 主进程的**纯函数**层（无 electron / fs / child_process 依赖，可直接被 Vitest 导入）
 *
 * 本文件承载两类可测逻辑（v0.2.6 只允许新增这一个文件）：
 *   1) SPSS (.sav) 导入：SysVarType 映射、逐行读取与截断检测、缺失值统计（T2/T3）
 *   2) Word 导出：officecli batch 命令构造与输入校验（T12）
 */

/* ═══════════════════════════════════════════════════════════════
 * 一、SPSS (.sav) 导入
 * ═══════════════════════════════════════════════════════════════ */

/**
 * sav-reader 的 `SysVarType` 是一个**未导出**的 const enum：
 *
 *   // node_modules/sav-reader/dist/SysVar.d.ts
 *   export declare const enum SysVarType { numeric = 0, string = 1 }
 *
 * 包入口 `dist/index.d.ts` 只导出 `SavBufferReader` / `SavFileReader` / `DateHelper`，
 * 枚举本身拿不到，因此这里用本地常量镜像它（值必须与上游一致）。
 *
 * ⚠ 绝对不要改回 `v.type === 'numeric'`：`v.type` 的静态类型是 `0 | 1`，与字符串比较
 *   恒为 false（TS2367 + 运行期逻辑错误），会导致**每一个** .sav 列都被标记为 `string`，
 *   于是 `DataContext.getNumericColumns()` 永远为空 → 向导页所有数值方法都选不到变量。
 */
export const SAV_TYPE_NUMERIC = 0
export const SAV_TYPE_STRING = 1

export type SavColumnType = 'numeric' | 'string'

/** 把 sav-reader 的数值枚举映射为本应用前端的列类型 */
export function mapSavColumnType(type: unknown): SavColumnType {
  return type === SAV_TYPE_NUMERIC ? 'numeric' : 'string'
}

/** .sav 单文件大小上限（超过视为异常，避免 OOM） */
export const MAX_SAV_FILE_BYTES = 200 * 1024 * 1024

/**
 * .sav 读取行数上限。
 * 逐行读取并在到达此上限时停止；绝不调用 `readAllRows()`（其实现会先把全部行读进内存，
 * 之前的 `.slice(0, MAX_SAV_ROWS)` 因此完全无法阻止内存峰值随文件总行数增长）。
 */
export const MAX_SAV_ROWS = 200_000

/** 逐行读取所需的最小 reader 契约（`SavReader.readNextRow` 满足它） */
export interface MinimalSavReader {
  readNextRow(includeNulls?: boolean): Promise<unknown>
}

/** 只用到 name / type / missing 三个字段的 sysvar 视图 */
export interface SavSysVarLike {
  name: string
  type?: unknown
  missing?: unknown
}

export interface SavColumnInfo {
  name: string
  type: SavColumnType
  missing: number
  total: number
}

/**
 * `SavMeta` 没有 `nrows`。（旧代码 `sav.meta.nrows ?? MAX_SAFE_INTEGER` 恒为 MAX_SAFE_INTEGER，
 * 是 T3 的根因。）真实用例数是 `meta.header.n_cases`：SPSS 规范里 "Set to the number of cases
 * in the file if it is known, or -1 otherwise"。未知（-1）或非整数时返回 null。
 *
 * 见 node_modules/sav-reader/dist/records/HeaderRecord.d.ts（n_cases 字段注释）。
 */
export function declaredCaseCount(meta: unknown): number | null {
  const header = (meta as { header?: { n_cases?: unknown } } | null | undefined)?.header
  const n = header?.n_cases
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null
  return n
}

/** 把一行原始对象补全为「每个表头都有值」的对象（null/undefined → ''，与旧行为一致） */
export function normalizeSavRow(
  row: unknown,
  headers: readonly string[]
): Record<string, unknown> {
  const src = (row ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const h of headers) {
    const val = src[h]
    out[h] = val === null || val === undefined ? '' : val
  }
  return out
}

export function normalizeSavRows(
  rows: readonly unknown[],
  headers: readonly string[]
): Record<string, unknown>[] {
  return rows.map((r) => normalizeSavRow(r, headers))
}

/**
 * 单元格是否算作缺失。
 * 与 v0.2.5 的判定保持一致，仅抽出为纯函数：
 *  空串 / null / undefined、等于 `missing` 声明值（数字或数组之一）、
 *  以及字符串形态的 '.' / 'NA' / 空白。
 */
export function isMissingCell(value: unknown, missingValues?: unknown): boolean {
  if (value === '' || value === null || value === undefined) return true
  if (typeof missingValues === 'number' && value === missingValues) return true
  if (Array.isArray(missingValues) && missingValues.includes(value as never)) return true
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '' || trimmed === '.' || trimmed.toLowerCase() === 'na') return true
  }
  return false
}

/** 逐列统计缺失数 + 列类型（T2 的类型映射在此生效） */
export function computeColumnInfo(
  sysVars: readonly SavSysVarLike[],
  rows: readonly Record<string, unknown>[]
): SavColumnInfo[] {
  return sysVars.map((v) => {
    let missing = 0
    for (const row of rows) {
      if (isMissingCell(row[v.name], v.missing)) missing++
    }
    return {
      name: v.name,
      type: mapSavColumnType(v.type),
      missing,
      total: rows.length
    }
  })
}

export interface ReadSavRowsOptions {
  /** 最多读取的行数，默认 MAX_SAV_ROWS */
  maxRows?: number
  /**
   * 读取达到上限后，是否再多读一行以确认被截断（默认 true）。
   * 需要多一次 `readNextRow()`，但能在文件头未记录用例数时给出准确的 truncated 标志。
   */
  probeTruncation?: boolean
  /** 文件头声明的用例数（`declaredCaseCount(meta)`）；已知且 ≤ maxRows 时跳过探测 */
  declaredRows?: number | null
}

export interface ReadSavRowsResult {
  rows: Record<string, unknown>[]
  /** 是否因为 maxRows 上限而丢弃了后续行 */
  truncated: boolean
  /** 实际读入的行数（= rows.length） */
  readRows: number
  /** 文件头声明的用例数；未知为 null */
  declaredRows: number | null
  /** 真实用例数：已声明则用声明值，否则未截断时等于 readRows，截断时未知（null） */
  totalRows: number | null
}

/** 把任意外部传入的 maxRows 收敛到安全区间 */
export function clampMaxRows(maxRows: unknown): number {
  const n = typeof maxRows === 'number' && Number.isFinite(maxRows) ? Math.floor(maxRows) : MAX_SAV_ROWS
  if (n <= 0) return MAX_SAV_ROWS
  return Math.min(n, MAX_SAV_ROWS)
}

/**
 * **逐行**读取 .sav（T3 核心修复）。
 *
 * 内存占用上界 = maxRows 行，与文件总行数无关。读者只需满足 `readNextRow()`：
 * sav-reader 的 `SavReader.readNextRow()` 在 EOF 返回 `null`（也会在数据耗尽时返回
 * `undefined`），两者都视为结束。纯函数、无 IO 依赖，可注入 fake reader 做单测。
 */
export async function readSavRowsIncremental(
  reader: MinimalSavReader,
  headers: readonly string[],
  options: ReadSavRowsOptions = {}
): Promise<ReadSavRowsResult> {
  const maxRows = clampMaxRows(options.maxRows)
  const probeTruncation = options.probeTruncation !== false
  const declaredRows =
    typeof options.declaredRows === 'number' && Number.isInteger(options.declaredRows) && options.declaredRows >= 0
      ? options.declaredRows
      : null

  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < maxRows; i++) {
    const raw = await reader.readNextRow()
    if (raw === null || raw === undefined) break
    rows.push(normalizeSavRow(raw, headers))
  }

  let truncated = false
  if (declaredRows !== null && declaredRows > rows.length) {
    // 文件头已声明总数且比读到的多 → 必然截断，无需探测
    truncated = true
  } else if (rows.length === maxRows && probeTruncation) {
    // 恰好读满上限：多读一行判断是否还有数据
    const probe = await reader.readNextRow()
    truncated = probe !== null && probe !== undefined
  }

  const totalRows = declaredRows !== null ? declaredRows : truncated ? null : rows.length

  return { rows, truncated, readRows: rows.length, declaredRows, totalRows }
}

/** 生成给用户看的截断提示文案（IPC 返回值的一部分） */
export function buildTruncationNotice(
  result: Pick<ReadSavRowsResult, 'truncated' | 'readRows' | 'totalRows'>,
  maxRows: number = MAX_SAV_ROWS
): string | null {
  if (!result.truncated) return null
  const total = result.totalRows === null ? '超过' : String(result.totalRows)
  return `数据量过大：文件共 ${total} 例，已仅导入前 ${maxRows.toLocaleString('en-US')} 例（实际 ${result.readRows.toLocaleString('en-US')} 行），后续分析基于截断后的数据。`
}

/* ═══════════════════════════════════════════════════════════════
 * 一之二、修正 sav-reader 2.0.8 的行读取缺陷（F3-c，2026-02 实测发现）
 *
 * 背景：`SavReader.readNextRow()` / `readAllRows()` 在**任何**字节压缩（`$FL2`）的 .sav 上
 * 都不可靠。实测（Node 20/Electron 33 与 Node 24 结果一致，sav-reader@2.0.8 为 npm 最新版）：
 *   1) `CommandReader.peekByte()`（dist/internal-readers/CommandReader.js）在 8 字节命令块
 *      的剩余字节全为 0 时会把 `commandBuffer[8]`（= `undefined`）当成“下一个非零字节”返回：
 *          let b = this.commandBuffer[i];
 *          while (b === 0 && i < 8) { i++; b = this.commandBuffer[i]; }   // i 可能变成 8
 *          if (b !== 0) return b;                                        // undefined !== 0 → return undefined
 *      `SavReader.readNextRow()` 的首行 EOF 判定是 `if (b === null || b === undefined) return null`
 *      → **读到第 1 行就被当成文件结束**。
 *   2) 即使修掉 (1)，`readNextRow()` 也不处理 SPSS 的 EOF 命令码 **252**：`readDouble2` 返回
 *      null（被当作缺失值丢弃），而 `read8CharString` 返回 null 后 `str += varStr` 会把
 *      `null` 拼成字符串 `"null"` → 凭空多出一行 `{ name: 'null' }`。
 *
 * 因此本模块**自行实现逐行读取**，直接复用 `CommandReader` 的公开原语
 * （`peekByte` 之外：`commandPointer` / `commandBuffer` / `readDouble2` / `read8CharString`），
 * 并把「下一个数据字节」定义为：命令块内剩余的非零字节，否则看下一个命令块的首字节；
 * 得到 `null`（无字节）或 **252（EOF 标记）** 时结束。
 *
 * 与 R `foreign::read.spss` 的交叉验证见 .tmp-verify 验证脚本（small.sav 6 行、big.sav 30 万行、
 * exact.sav 20 万行，数值逐一比对）。
 * ═══════════════════════════════════════════════════════════════ */

/** SPSS 压缩数据流中的 EOF 命令码（SPSS 规范：252 = end of file） */
export const SAV_COMPRESSED_EOF_CODE = 252

export interface SavCommandReaderLike {
  commandPointer: number
  commandBuffer: Uint8Array | null
  reader: { peek(len: number): Promise<Uint8Array> }
  readDouble2(compression: unknown): Promise<number | null>
  read8CharString(compression: unknown): Promise<string | null>
}

export interface SavStringSysVarLike extends SavSysVarLike {
  __child_string_sysvars?: SavStringSysVarLike[]
  __nb_string_contin_recs?: number
}

export interface SavReaderLike {
  meta: {
    sysvars: SavStringSysVarLike[]
    header: { compression?: unknown }
  }
  reader: SavCommandReaderLike
}

export interface SavRowReader extends MinimalSavReader {
  readNextRow(includeNulls?: boolean): Promise<Record<string, unknown> | null>
}

/**
 * 「下一个数据字节」：命令块内剩余的非零字节；若剩余全为 0（填充/忽略码，读取时会被
 * `readDouble2`/`read8CharString` 的 `while (code === 0)` 跳过），则看下一个命令块的首字节
 * —— 此时底层流位置正好停在下一个 8 字节块的起始处。
 * 返回 `null` 表示真正的文件结束（底层已无字节可 peek）。
 */
export async function peekNextSavDataByte(cmd: SavCommandReaderLike): Promise<number | null> {
  if (cmd.commandPointer > 0 && cmd.commandPointer < 8 && cmd.commandBuffer) {
    for (let i = cmd.commandPointer; i < 8; i++) {
      const b = cmd.commandBuffer[i]
      if (b !== 0) return b
    }
  }
  try {
    const buf = await cmd.reader.peek(1)
    if (!buf || buf.length !== 1) return null
    return buf[0]
  } catch {
    // 底层流已耗尽：AsyncChunkReader/AsyncReader 在真正 EOF 时抛错
    return null
  }
}

/**
 * 逐行读取一行 .sav 数据（修正版）。
 * 语义与 `SavReader.readNextRow()` 一致：非压缩模式读原始 double/8 字节字符串；
 * 压缩模式读命令码。遇到 EOF 标记或无数据返回 `null`。
 */
export async function readNextSavRow(
  sav: SavReaderLike,
  includeNulls = false
): Promise<Record<string, unknown> | null> {
  const cmd = sav.reader
  const compression = sav.meta?.header?.compression ?? null

  const next = await peekNextSavDataByte(cmd)
  if (next === null || next === SAV_COMPRESSED_EOF_CODE) return null

  const row: Record<string, unknown> = {}
  for (const v of sav.meta.sysvars) {
    if (v.type === SAV_TYPE_NUMERIC) {
      const d = await cmd.readDouble2(compression)
      if (includeNulls || (d !== null && d !== undefined)) row[v.name] = d
    } else if (v.type === SAV_TYPE_STRING) {
      const allSysVars = [v, ...(v.__child_string_sysvars ?? [])]
      let str = ''
      for (const sv of allSysVars) {
        let varStr = ''
        // 上游这里是 `varStr += await read8CharString(...)`：一旦返回 null 就拼成字符串 "null"
        const head = await cmd.read8CharString(compression)
        if (typeof head === 'string') varStr += head
        const continuations = sv.__nb_string_contin_recs ?? 0
        for (let j = 0; j < continuations; j++) {
          const cont = await cmd.read8CharString(compression)
          if (typeof cont === 'string') varStr += cont
        }
        if (varStr.length > 255) varStr = varStr.substring(0, 255)
        str += varStr
      }
      const strVal = str.trimEnd()
      if (includeNulls || strVal.length > 0) row[v.name] = strVal
    }
  }
  return row
}

/**
 * 把 `SavBufferReader` / `SavFileReader` 实例包装成一个**修正过的**行读取器。
 * 不做任何 monkey-patch：只使用 reader 的公开字段与原语，因此对上游版本升级是安全的
 * （若上游修好了，本函数仍可继续工作）。
 */
export function createSavRowReader(sav: unknown): SavRowReader {
  const source = sav as SavReaderLike
  return {
    readNextRow: (includeNulls = false) => readNextSavRow(source, includeNulls)
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 二、R 脚本 stdout 解析
 * ═══════════════════════════════════════════════════════════════ */

/**
 * R 安装目录版本号的**数值**降序比较（最新版本优先）。
 * 旧的 `versions.sort().reverse()` 是字典序：`['R-4.6.0','R-4.10.0']` 排序后会优先选中
 * **R-4.6.0**，用户装了 4.10 反而用到旧版。此函数同时可用于对 `--version` 输出的版本号排序。
 */
export function compareRVersionDesc(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^R-?/i, '')
      .split(/[.\-+_]/)
      .map((p) => Number.parseInt(p, 10))
      .filter((n) => !Number.isNaN(n))
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0) // 降序
    if (diff !== 0) return diff
  }
  return 0
}

export interface RStdoutParseResult {
  /** 去掉哨兵后的正文输出 */
  output: string
  /** 错误行数组（0 或 1 项；保留多行原文） */
  errors: string[]
  /** 错误原文（无错误为 null） */
  error: string | null
  /** 是否看到 `__RWB_DONE__`（脚本正常跑完的标志） */
  completed: boolean
}

/**
 * 解析 R 侧包装脚本的 stdout。
 *
 * 旧实现是 `stdout.match(/__RWB_ERROR__:(.*)/)`：JS 的 `.` **不匹配换行**，
 * 于是 `conditionMessage(e)` 里的多行 R 报错只留下第一行；`[1]` 又丢掉了 `\n` 之外的内容。
 * 这里改为先定位哨兵、再截到 `__RWB_DONE__` 之前，完整保留多行报错。
 *
 * 同时暴露 `completed`，超时/被 maxBuffer 杀掉的进程不会有 `__RWB_DONE__`。
 */
export function parseRScriptStdout(stdout: unknown): RStdoutParseResult {
  const text = typeof stdout === 'string' ? stdout : ''
  const START = '__RWB_ERROR__:'
  const DONE = '__RWB_DONE__'

  const completed = text.includes(DONE)
  const startIdx = text.indexOf(START)

  let error: string | null = null
  let output: string

  if (startIdx >= 0) {
    const after = text.slice(startIdx + START.length)
    const doneIdx = after.indexOf(DONE)
    const rawError = doneIdx >= 0 ? after.slice(0, doneIdx) : after
    const cleaned = rawError.trim()
    error = cleaned.length > 0 ? cleaned : '（R 未提供错误信息）'
    output = text.slice(0, startIdx) + (doneIdx >= 0 ? after.slice(doneIdx + DONE.length) : '')
  } else {
    output = text
  }

  // 兜底：正文里若还残留 DONE 标记则去掉
  output = output.split(DONE).join('').trim()

  return { output, errors: error ? [error] : [], error, completed }
}

/* ═══════════════════════════════════════════════════════════════
 * 三、Word 导出（officecli batch）
 * ═══════════════════════════════════════════════════════════════ */

/** 单次导出的规模上限（超出直接报错，而不是静默生成一个卡死的文档） */
export const MAX_DOCX_TABLES = 50
export const MAX_DOCX_TABLE_ROWS = 1000
export const MAX_DOCX_TABLE_COLS = 60
/** 全文档单元格总量上限（含表头行） */
export const MAX_DOCX_CELLS = 60_000
/** 单个段落文本长度上限 */
export const MAX_DOCX_TEXT_CHARS = 20_000
/** 单张表的标题/表注长度上限 */
export const MAX_DOCX_TABLE_LABEL_CHARS = 500

export interface DocxTableInput {
  title?: unknown
  headers?: unknown
  rows?: unknown
  note?: unknown
}

export interface NormalizedDocxTable {
  title: string
  note: string
  headers: string[]
  rows: string[][]
  /** 实际建表的列数 = max(headers.length, 最长数据行长度)，避免 tc[] 越界 */
  cols: number
  /** 建表行数 = 数据行数 + 1（表头行） */
  tableRows: number
}

export interface NormalizedDocxPayload {
  title: string
  tables: NormalizedDocxTable[]
  interpretation: string
  savePath: string
}

export interface OfficecliBatchCommand {
  command: string
  [key: string]: unknown
}

/** 把任意值渲染成单行文本（去掉控制字符；officecli 的 prop 文本对 \n 有特殊语义） */
export function toDocxText(value: unknown, maxChars = MAX_DOCX_TEXT_CHARS): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'string' ? value : String(value)
  return s
    .replace(/\r\n/g, ' ')
    .replace(/[\r\n\t\v\f]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, maxChars)
}

/**
 * 校验并归一化 Word 导出请求。
 * 旧实现直接 `tables.length`（`tables: undefined` → TypeError）且按 `headers.length` 建表
 * （参差行会去 set 不存在的 `tc[]`，实测真实 CLI 直接 exit 1）。
 */
export function validateDocxPayload(data: unknown): NormalizedDocxPayload {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('无效参数：导出请求必须是对象')
  }
  const payload = data as DocxTableInput & {
    title?: unknown
    tables?: unknown
    interpretation?: unknown
    savePath?: unknown
  }

  if (typeof payload.title !== 'string') throw new Error('无效参数：title 必须是字符串')
  const title = toDocxText(payload.title, MAX_DOCX_TEXT_CHARS)
  if (title.trim() === '') throw new Error('无效参数：title 不能为空')

  if (typeof payload.savePath !== 'string' || payload.savePath.trim() === '') {
    throw new Error('无效参数：savePath 必须是字符串')
  }
  const savePath = payload.savePath

  if (!Array.isArray(payload.tables)) {
    throw new Error('无效参数：tables 必须是数组')
  }
  if (payload.tables.length > MAX_DOCX_TABLES) {
    throw new Error(`表格数量超限（${payload.tables.length} > ${MAX_DOCX_TABLES}）`)
  }

  const interpretation =
    payload.interpretation === undefined || payload.interpretation === null
      ? ''
      : typeof payload.interpretation === 'string'
        ? payload.interpretation
        : (() => {
            throw new Error('无效参数：interpretation 必须是字符串')
          })()

  let totalCells = 0
  const tables: NormalizedDocxTable[] = payload.tables.map((raw, index) => {
    const label = `第 ${index + 1} 张表`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`${label}：表格必须是对象`)
    }
    const t = raw as DocxTableInput
    if (!Array.isArray(t.headers)) throw new Error(`${label}：headers 必须是数组`)
    if (!Array.isArray(t.rows)) throw new Error(`${label}：rows 必须是数组`)

    const headers = t.headers.map((h) => toDocxText(h, MAX_DOCX_TABLE_LABEL_CHARS))
    const rows = t.rows.map((row) => {
      if (!Array.isArray(row)) throw new Error(`${label}：rows 的元素必须是数组`)
      return row.map((cell) => toDocxText(cell, MAX_DOCX_TEXT_CHARS))
    })

    if (rows.length + 1 > MAX_DOCX_TABLE_ROWS) {
      throw new Error(`${label}：行数超限（${rows.length} + 表头 > ${MAX_DOCX_TABLE_ROWS}）`)
    }
    const widest = rows.reduce((m, r) => Math.max(m, r.length), 0)
    const cols = Math.max(headers.length, widest)
    if (cols === 0) throw new Error(`${label}：表头与数据行都为空`)
    if (cols > MAX_DOCX_TABLE_COLS) {
      throw new Error(`${label}：列数超限（${cols} > ${MAX_DOCX_TABLE_COLS}）`)
    }

    totalCells += (rows.length + 1) * cols
    if (totalCells > MAX_DOCX_CELLS) {
      throw new Error(`单元格总量超限（> ${MAX_DOCX_CELLS}）`)
    }

    return {
      title: toDocxText(t.title, MAX_DOCX_TABLE_LABEL_CHARS),
      note: toDocxText(t.note, MAX_DOCX_TABLE_LABEL_CHARS),
      headers,
      rows,
      cols,
      tableRows: rows.length + 1
    }
  })

  return { title, tables, interpretation, savePath }
}

const THREE_LINE_TABLE_PROPS: Record<string, string> = {
  'border.top': 'single',
  'border.top.sz': '12',
  'border.bottom': 'single',
  'border.bottom.sz': '12',
  'border.left': 'none',
  'border.right': 'none',
  'border.insideH': 'none',
  'border.insideV': 'none'
}

/**
 * 构造 officecli `batch` 的 JSON 命令数组。
 *
 * 旧实现**每个单元格一次 execFileAsync**：实测 20 行 × 10 列 = 226 次进程创建。
 * `batch` 在一次 open/save 周期内应用全部命令（officecli batch --help），因此整个文档
 * 只需常数个进程：`create` → `batch` → `close`。
 */
export function buildDocxBatchCommands(payload: NormalizedDocxPayload): OfficecliBatchCommand[] {
  const cmds: OfficecliBatchCommand[] = []

  // 报告标题
  cmds.push({
    command: 'add',
    parent: '/',
    type: 'paragraph',
    props: { text: payload.title, bold: 'true', size: '18' }
  })

  payload.tables.forEach((table, ti) => {
    const tableIdx = ti + 1

    if (table.title) {
      cmds.push({
        command: 'add',
        parent: '/',
        type: 'paragraph',
        props: { text: table.title, bold: 'true', size: '14' }
      })
    }

    // 建表：cols 已取 max(headers, 最长行)，绝不越界
    cmds.push({
      command: 'add',
      parent: '/',
      type: 'table',
      props: { rows: String(table.tableRows), cols: String(table.cols) }
    })

    // 三线表外观
    cmds.push({
      command: 'set',
      path: `/body/tbl[${tableIdx}]`,
      props: { ...THREE_LINE_TABLE_PROPS }
    })

    // 表头行底部细线 + 表头文字
    for (let c = 0; c < table.cols; c++) {
      cmds.push({
        command: 'set',
        path: `/body/tbl[${tableIdx}]/tr[1]/tc[${c + 1}]`,
        props: { 'border.bottom': 'single', 'border.bottom.sz': '4' }
      })
    }
    for (let c = 0; c < table.headers.length; c++) {
      cmds.push({
        command: 'set',
        path: `/body/tbl[${tableIdx}]/tr[1]/tc[${c + 1}]`,
        props: { text: table.headers[c], bold: 'true' }
      })
    }

    // 数据行（只写该行真实存在的单元格）
    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r]
      for (let c = 0; c < row.length; c++) {
        cmds.push({
          command: 'set',
          path: `/body/tbl[${tableIdx}]/tr[${r + 2}]/tc[${c + 1}]`,
          props: { text: row[c] }
        })
      }
    }

    if (table.note) {
      cmds.push({
        command: 'add',
        parent: '/',
        type: 'paragraph',
        props: { text: table.note, italic: 'true', size: '10' }
      })
    }
  })

  // 解读文字
  if (payload.interpretation) {
    cmds.push({ command: 'add', parent: '/', type: 'paragraph', props: { text: ' ' } })
    for (const line of payload.interpretation.split(/\r?\n/)) {
      if (!line.trim()) continue
      cmds.push({
        command: 'add',
        parent: '/',
        type: 'paragraph',
        props: { text: toDocxText(line) }
      })
    }
  }

  return cmds
}

/** officecli 的执行计划：常数个进程（旧实现是 O(行×列) 个） */
export interface DocxExportPlan {
  /** 建表命令总数（统计口径与旧实现一致） */
  commandCount: number
  /** 子进程调用次数（新实现为常数） */
  processCount: number
  commands: OfficecliBatchCommand[]
}

export function planDocxExport(payload: NormalizedDocxPayload): DocxExportPlan {
  const commands = buildDocxBatchCommands(payload)
  return {
    commandCount: commands.length,
    // create + batch + close（+ 失败时的兜底 close 不计入正常路径）
    processCount: 3,
    commands
  }
}

/** 把 officecli `batch --json` 的返回体归一化为可读错误（envelope: success/error/warnings） */
export function parseOfficecliEnvelope(stdout: string): {
  success: boolean
  error: string | null
  warnings: string[]
} {
  const text = (stdout || '').trim()
  if (!text) return { success: false, error: 'officecli 无输出', warnings: [] }
  try {
    const parsed = JSON.parse(text) as {
      success?: unknown
      error?: unknown
      warnings?: unknown
      message?: unknown
    }
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map((w) => String(w)) : []
    if (parsed.success === false) {
      const err =
        parsed.error && typeof parsed.error === 'object'
          ? JSON.stringify(parsed.error)
          : String(parsed.error ?? parsed.message ?? 'officecli 报告失败')
      return { success: false, error: err, warnings }
    }
    return { success: true, error: null, warnings }
  } catch {
    // 非 JSON（例如 --json 未生效）：只要退出码为 0 就当作成功，把输出留给调用方记录
    return { success: true, error: null, warnings: [] }
  }
}
