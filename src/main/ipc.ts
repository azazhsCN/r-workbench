import { ipcMain, dialog, app, safeStorage, clipboard } from 'electron'
import { readFile, writeFile, rm, stat, mkdtemp, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, normalize, sep, extname } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { SavBufferReader } from 'sav-reader'
import {
  MAX_SAV_FILE_BYTES,
  MAX_SAV_ROWS,
  buildTruncationNotice,
  compareRVersionDesc,
  computeColumnInfo,
  createSavRowReader,
  declaredCaseCount,
  parseOfficecliEnvelope,
  parseRScriptStdout,
  planDocxExport,
  readSavRowsIncremental,
  validateDocxPayload
} from './savImport'

const execFileAsync = promisify(execFile)

// ── 通用上限 ──────────────────────────────────────

/** `r:execute` / `r:plot` 的 R 代码长度上限 */
const MAX_CODE_CHARS = 5_000_000
/** 传入 R 的 data.csv 大小上限（旧实现完全不校验 → 无界内存/磁盘写入） */
const MAX_DATA_CSV_CHARS = 64 * 1024 * 1024
/** 通过对话框/白名单目录读取的单个文件大小上限 */
const MAX_FILE_READ_BYTES = MAX_SAV_FILE_BYTES
/** R 脚本执行超时 */
const R_TIMEOUT_MS = 60_000
/** R 子进程 stdout 缓冲上限 */
const R_MAX_BUFFER = 10 * 1024 * 1024
/** 一次 Word 导出的总截止时间（含 create/batch/close） */
const DOCX_EXPORT_DEADLINE_MS = 180_000

// ── 安全工具 ──────────────────────────────────────

/** 验证文件路径是否在允许的目录内（防路径遍历） */
function validateFilePath(filePath: string, allowedDirs: string[]): string {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('无效的文件路径')
  }
  if (filePath.length > 1024) {
    throw new Error('文件路径过长')
  }
  const normalized = normalize(resolve(filePath))
  const allowed = allowedDirs.some(
    (dir) => normalized.startsWith(normalize(dir) + sep) || normalized === normalize(dir)
  )
  if (!allowed) {
    throw new Error(`路径不在允许范围内: ${filePath}`)
  }
  return normalized
}

/** 验证 IPC 参数类型 */
function validateString(value: unknown, name: string, maxLen = 100_000_000): string {
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串`)
  if (value.length > maxLen) throw new Error(`${name} 长度超限`)
  return value
}

/** 送入 R 的 data.csv 校验（长度上限 + 类型） */
function validateDataCsv(dataCsv: unknown): string | null {
  if (dataCsv === undefined || dataCsv === null) return null
  if (typeof dataCsv !== 'string') throw new Error('dataCsv 必须是字符串')
  if (dataCsv.length > MAX_DATA_CSV_CHARS) {
    const mb = (dataCsv.length / 1024 / 1024).toFixed(1)
    throw new Error(`dataCsv 过大（${mb}MB，上限 ${MAX_DATA_CSV_CHARS / 1024 / 1024}MB）`)
  }
  return dataCsv
}

/** 读取前的文件大小检查（对话框接受 ['*']，旧实现会把任意大小的文件整体读进内存） */
async function assertReadableSize(filePath: string, maxBytes = MAX_FILE_READ_BYTES): Promise<void> {
  const info = await stat(filePath)
  if (info.size > maxBytes) {
    const mb = (info.size / 1024 / 1024).toFixed(1)
    throw new Error(`文件过大（${mb}MB，上限 ${Math.round(maxBytes / 1024 / 1024)}MB），请先拆分数据`)
  }
}

/**
 * 禁止写入的可执行/脚本扩展名。
 * `fs:writeFile` 允许写入 `%TEMP%`，与 `shell.openExternal` 组合本可构成
 * “写文件 → 打开” 的代码执行链；三层防护（本处 + openExternal 协议白名单 + will-navigate）之一。
 */
const BLOCKED_WRITE_EXTS = new Set([
  '.bat', '.cmd', '.com', '.exe', '.scr', '.ps1', '.psm1', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.lnk', '.reg', '.hta', '.msi', '.dll', '.sys', '.cpl'
])

function assertSafeWriteTarget(filePath: string): void {
  const ext = extname(filePath).toLowerCase()
  if (BLOCKED_WRITE_EXTS.has(ext)) {
    throw new Error(`出于安全考虑，不允许写入 ${ext} 文件`)
  }
}

/** API Key 安全存储路径 */
function getSecureConfigPath(): string {
  return join(app.getPath('userData'), 'config.enc.json')
}

/**
 * 服务商名白名单校验。
 * 除了字符集限制，还必须排除 `Object.prototype` 的成员名（`constructor` / `toString` /
 * `__proto__` 等），因为旧代码用 `config[provider]` 直接取值会把继承成员当成真值返回
 * （`provider='constructor'` → 返回 `Object` 构造函数）。
 */
const KNOWN_PROVIDERS = [
  'openai', 'deepseek', 'custom', 'moonshot', 'kimi', 'zhipu', 'glm', 'qwen',
  'dashscope', 'baichuan', 'minimax', 'siliconflow', 'openrouter', 'anthropic',
  'azure-openai', 'ollama', 'lmstudio', 'localai'
] as const

function isSafeProviderName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 100) return false
  // 形状白名单（前向兼容新增服务商）
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) return false
  // 拒绝 Object.prototype 的成员名
  if (Object.prototype.hasOwnProperty.call(Object.prototype, name)) return false
  return true
}

/**
 * 校验服务商标识并返回。
 * 先查显式登记的白名单（`KNOWN_PROVIDERS`），未登记的再按形状白名单 + 原型成员检查放行，
 * 这样既能挡住 `constructor` 这类危险键，又不会因为新增服务商而拒绝保存。
 */
function requireSafeProvider(provider: unknown): string {
  if (typeof provider === 'string' && KNOWN_PROVIDERS.includes(provider as (typeof KNOWN_PROVIDERS)[number])) {
    return provider
  }
  if (!isSafeProviderName(provider)) {
    throw new Error('无效的服务商标识')
  }
  return provider
}

/** 只保留字符串值且键名安全的配置对象（顺带丢弃原型残留 / 垃圾键） */
function parseApiKeyConfig(text: string): Record<string, string> {
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('配置格式错误：不是 JSON 对象')
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && isSafeProviderName(key)) out[key] = value
  }
  return out
}

/**
 * 读取（并解密）API Key 配置。
 * 加密可用但解密失败时，先尝试按明文 JSON 解析（老版本降级写入的文件）以**保留其它服务商的 Key**；
 * 两者都失败才抛错 —— 调用方据此中止保存，而不是把整个配置覆盖成只剩当前一个 provider。
 */
async function readApiKeyConfig(configPath: string): Promise<Record<string, string>> {
  const raw = await readFile(configPath)
  const unreadable = new Error(
    '无法读取已保存的 API Key 配置（内容既不是可用密钥环加密的数据，也不是明文 JSON）。' +
      '为避免覆盖其它服务商的 Key，本次保存已中止。' +
      `可手动删除后重试：${configPath}`
  )

  if (safeStorage.isEncryptionAvailable()) {
    try {
      return parseApiKeyConfig(safeStorage.decryptString(raw))
    } catch {
      try {
        return parseApiKeyConfig(raw.toString('utf-8'))
      } catch {
        throw unreadable
      }
    }
  }

  // 加密不可用（例如 Linux 无密钥环）：文件可能是之前用密钥环加密写入的 → 无法解密，
  // 此时继续保存会把其它 provider 的 Key 全部丢掉，因此同样中止并给出可操作提示。
  try {
    return parseApiKeyConfig(raw.toString('utf-8'))
  } catch {
    throw unreadable
  }
}

// ── 主窗口引用 ──────────────────────────────────────

let _mainWindow: import('electron').BrowserWindow | null = null
export function getMainWindow() {
  return _mainWindow
}
export function setMainWindow(win: import('electron').BrowserWindow) {
  _mainWindow = win
}

/**
 * 主菜单语言切换回调（由 src/main/index.ts 注册）。
 * 菜单标签无法走 renderer 的 i18next（主进程没有 i18n 运行时，且 tsconfig.node.json
 * 不包含 renderer 的 locale JSON），因此这里只负责把渲染进程推送的语言转发给菜单构建器。
 */
let menuLanguageHandler: ((lng: string) => void) | null = null
export function setMenuLanguageHandler(handler: (lng: string) => void): void {
  menuLanguageHandler = handler
}

/**
 * 注册所有 IPC 处理器
 */
export function registerIpcHandlers(): void {
  // 可信目录列表
  const trustedDirs = [
    app.getPath('userData'),
    app.getPath('documents'),
    app.getPath('temp'),
    app.getPath('desktop')
  ]

  // ── 文件操作（路径受限） ──────────────────────────────

  ipcMain.handle('dialog:openFile', async (_event, options) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options?.filters || [
        { name: '数据文件', extensions: ['csv', 'xlsx', 'xls', 'sav'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  /**
   * 从对话框选中的文件直接读取内容
   * 路径来自系统文件对话框，用户主动选择，天然可信
   *
   * T6：**永远返回原始字节**，由渲染进程负责解码（BOM 嗅探 / 严格 UTF-8 / GB18030 / Big5）。
   * 旧实现文本分支硬编码 `readFile(path, 'utf-8')`，中文 Excel 导出的 GBK/GB18030 CSV
   * 会被解码成一堆 U+FFFD。`asText` 参数已废弃（保留形参仅为兼容旧调用方，行为不变）。
   */
  ipcMain.handle(
    'dialog:readFile',
    async (_event, _options?: { asText?: boolean }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: '数据文件', extensions: ['csv', 'xlsx', 'xls', 'sav'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const filePath = result.filePaths[0]
      const fileName = filePath.split(/[/\\]/).pop() || ''
      const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

      // 无大小限制地整体读入内存 = OOM；先 stat 再读
      await assertReadableSize(filePath)

      const buffer = await readFile(filePath)
      return { filePath, fileName, ext, content: null, buffer }
    }
  )

  ipcMain.handle('fs:readFile', async (_event, filePath: unknown) => {
    const safePath = validateFilePath(validateString(filePath, 'filePath'), trustedDirs)
    await assertReadableSize(safePath)
    return await readFile(safePath)
  })

  ipcMain.handle('fs:readFileText', async (_event, filePath: unknown) => {
    const safePath = validateFilePath(validateString(filePath, 'filePath'), trustedDirs)
    await assertReadableSize(safePath)
    // 注意：这里固定 UTF-8。需要读取 GBK/GB18030 时请用 fs:readFile + 渲染进程编码探测。
    return await readFile(safePath, 'utf-8')
  })

  ipcMain.handle(
    'fs:writeFile',
    async (_event, filePath: unknown, content: unknown) => {
      const safePath = validateFilePath(validateString(filePath, 'filePath'), trustedDirs)
      assertSafeWriteTarget(safePath)
      await writeFile(safePath, validateString(content, 'content'), 'utf-8')
      return true
    }
  )

  ipcMain.handle('app:getPath', async () => {
    return {
      userData: app.getPath('userData'),
      temp: app.getPath('temp'),
      documents: app.getPath('documents')
    }
  })

  // ── R 环境 ──────────────────────────────

  interface RDetection {
    found: boolean
    path: string
    version: string
    /** 已尝试的候选路径（诊断用） */
    searched: string[]
  }

  /**
   * R 安装探测结果缓存。
   * 旧实现是 `let detectedRPath = 'Rscript'`：若用户从未调用 `r:detect`，所有执行都会去
   * PATH 上找 `Rscript`（本机 R 4.6.0 装在 Program Files，PATH 上没有 → 一律失败）。
   * 现在改为「惰性 + 记忆化的 Promise」，并在每次执行前做廉价校验、失败后自愈重探。
   */
  let rDetectionPromise: Promise<RDetection> | null = null
  /** 上一次探测完成的时间（用于“未找到”结果的短缓存，避免每次执行都重扫） */
  let rDetectionAt = 0
  /** “未找到 R”结果的最短缓存时间：用户新装 R 后最多 30 秒即可被识别 */
  const R_NEGATIVE_CACHE_MS = 30_000

  function refreshRDetection(): Promise<RDetection> {
    rDetectionAt = Date.now()
    const promise = detectRInstallation().catch((error: unknown) => {
      // 不要把 rejected promise 永久留在缓存里，否则后续每次执行都会立刻失败
      rDetectionPromise = null
      throw error
    })
    rDetectionPromise = promise
    return promise
  }

  /** 版本号**数值**比较（旧的 `.sort().reverse()` 是字典序：R-4.10.0 会排在 R-4.6.0 之后） */
  const compareRVersions = compareRVersionDesc

  async function probeRPath(rPath: string): Promise<string | null> {
    const attempts: string[][] = [['--version'], ['-e', 'cat(R.version.string)']]
    for (const args of attempts) {
      try {
        const { stdout, stderr } = await execFileAsync(rPath, args, { timeout: 10000 })
        const out = String(stdout) + String(stderr)
        const m = out.match(/version (\d+\.\d+\.\d+)/)
        if (m) return m[1]
      } catch {
        continue
      }
    }
    return null
  }

  async function detectRInstallation(): Promise<RDetection> {
    const { readdir } = await import('fs/promises')
    const candidates: string[] = []
    const searched: string[] = []

    // 1) 用户显式指定的位置（便携版 / 非标准安装）
    const rHome = process.env['R_HOME']
    if (rHome) {
      candidates.push(join(rHome, 'bin', 'Rscript.exe'), join(rHome, 'bin', 'x64', 'Rscript.exe'))
    }
    const explicit = process.env['RWB_RSCRIPT']
    if (explicit) candidates.push(explicit)

    // 2) PATH
    candidates.push('Rscript')

    // 3) 扫描 Program Files 下的 R 安装目录（兼容所有版本）
    const programFilesDirs = [
      process.env['ProgramFiles'] || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      process.env['LOCALAPPDATA'] || ''
    ].filter(Boolean)

    for (const dir of programFilesDirs) {
      try {
        const rDir = `${dir}\\R`
        const entries = await readdir(rDir, { withFileTypes: true })
        const versions = entries
          .filter((e) => e.isDirectory() && e.name.startsWith('R-'))
          .map((e) => e.name)
          .sort(compareRVersions) // 数值降序：最新版本优先
        for (const ver of versions) {
          candidates.push(`${rDir}\\${ver}\\bin\\Rscript.exe`)
          candidates.push(`${rDir}\\${ver}\\bin\\x64\\Rscript.exe`)
        }
      } catch {
        // 目录不存在，跳过
      }
    }

    // S1: 用 execFileAsync 替代 execAsync，不走 shell
    for (const rPath of new Set(candidates)) {
      if (rPath !== 'Rscript' && !existsSync(rPath)) continue
      searched.push(rPath)
      const version = await probeRPath(rPath)
      if (version) {
        return { found: true, path: rPath, version, searched }
      }
    }
    return { found: false, path: '', version: '', searched }
  }

  /** 解析出一个可用的 Rscript 路径；未检测过时**隐式触发一次探测** */
  async function getRPath(forceRedetect = false): Promise<string> {
    if (forceRedetect) rDetectionPromise = null
    // 本次调用是否会启动一次**全新**探测（而不是复用缓存结果）
    const isFreshDetection = forceRedetect || !rDetectionPromise
    if (!rDetectionPromise) refreshRDetection()
    const det = await rDetectionPromise!
    // 路径存在（或就是 PATH 上的 Rscript）→ 直接使用；每次执行前的校验不额外 spawn 进程
    if (det.found && det.path && (det.path === 'Rscript' || existsSync(det.path))) return det.path
    // 刚探测过（首次/强制重探）→ 不再重复扫描
    if (isFreshDetection) return ''
    // 已知未找到且未超过负缓存时间 → 直接用失败结果（用户装好 R 后最多 30 秒生效）
    if (Date.now() - rDetectionAt < R_NEGATIVE_CACHE_MS) return ''
    // 自愈：R 被安装/卸载/移动 → 重探一次
    const again = await refreshRDetection()
    return again.found && again.path ? again.path : ''
  }

  ipcMain.handle('r:detect', async () => {
    return await refreshRDetection()
  })

  const R_NOT_FOUND_MESSAGE =
    '未检测到可用的 R 安装。请安装 R 4.x（https://cran.r-project.org/），或在设置页重新检测；' +
    '也可通过环境变量 R_HOME / RWB_RSCRIPT 指定 Rscript 路径。'

  interface ExecOptions {
    timeout?: number
    maxBuffer?: number
    cwd?: string
  }

  async function execFileSafe(
    file: string,
    args: string[],
    options: ExecOptions
  ): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await execFileAsync(file, args, options)
    return { stdout: String(stdout), stderr: String(stderr) }
  }

  /**
   * 执行 R 脚本。解析路径失败时抛清晰错误；遇到 ENOENT（R 被移除）时清缓存重探并重试一次。
   */
  async function runRscript(
    args: string[],
    options: ExecOptions = {}
  ): Promise<{ stdout: string; stderr: string }> {
    const opts: ExecOptions = {
      timeout: R_TIMEOUT_MS,
      maxBuffer: R_MAX_BUFFER,
      ...options
    }
    const rPath = await getRPath()
    if (!rPath) throw new Error(R_NOT_FOUND_MESSAGE)
    try {
      return await execFileSafe(rPath, args, opts)
    } catch (error: unknown) {
      const code = (error as { code?: unknown }).code
      if (code === 'ENOENT') {
        const reDetected = await getRPath(true)
        if (!reDetected) throw new Error(R_NOT_FOUND_MESSAGE)
        return await execFileSafe(reDetected, args, opts)
      }
      throw error
    }
  }

  /** 把 execFile 的 rejection 归一化为 UI 可读的失败结果，并**保留部分输出** */
  function normalizeRExecFailure(
    error: unknown,
    timeoutMs: number,
    maxBufferBytes: number,
    label: string
  ): { output: string; errors: string[]; stderr: string; timedOut: boolean; truncated: boolean } {
    const err = error as {
      stdout?: string
      stderr?: string
      message?: string
      killed?: boolean
      signal?: string
      code?: unknown
    }
    const stdout = typeof err.stdout === 'string' ? err.stdout : ''
    const stderr = typeof err.stderr === 'string' ? err.stderr : ''
    const message = err.message || ''
    const timedOut =
      err.killed === true ||
      err.signal === 'SIGTERM' ||
      /timed?\s*out/i.test(message) ||
      /ETIMEDOUT/.test(String(err.code ?? ''))
    const truncated =
      /maxBuffer|max buffer|ERR_CHILD_PROCESS_STDIO_MAXBUFFER/i.test(message) ||
      err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'

    // 关键修复：超时/maxBuffer 时 err.stdout 里有**已经算出来的部分结果**，旧代码直接返回 output: ''
    const parsed = parseRScriptStdout(stdout)
    const errors: string[] = []
    if (parsed.errors.length > 0) {
      errors.push(...parsed.errors)
    } else if (timedOut) {
      errors.push(`${label}超时（超过 ${Math.round(timeoutMs / 1000)} 秒），进程已终止。`)
    } else if (truncated) {
      errors.push(`R 输出超过 ${Math.round(maxBufferBytes / 1024 / 1024)}MB 缓冲上限，已截断。`)
    }
    if (stderr.trim()) {
      const tail = stderr.trim()
      if (!errors.includes(tail)) errors.push(errors.length === 0 ? tail : `stderr: ${tail.slice(0, 4000)}`)
    }
    if (errors.length === 0) errors.push(message || `${label}失败`)

    return { output: parsed.output, errors, stderr, timedOut, truncated }
  }

  // ── R 执行（统一包装 + 自动清理） ──────────────────────

  ipcMain.handle(
    'r:execute',
    async (_event, code: unknown, dataCsv?: unknown) => {
      let workDir = ''
      try {
        const safeCode = validateString(code, 'code', MAX_CODE_CHARS)
        const safeCsv = validateDataCsv(dataCsv)

        workDir = await mkdtemp(join(tmpdir(), 'rworkbench-'))

        // 写入数据 CSV（如果提供）
        if (safeCsv !== null) {
          await writeFile(join(workDir, 'data.csv'), safeCsv, 'utf-8')
        }

        // 统一包装：主进程负责错误捕获和结果输出
        const scriptContent = `options(warn = 1)
options(digits = 6)
setwd("${workDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")
tryCatch({
${safeCode}
}, error = function(e) {
  cat("__RWB_ERROR__:", conditionMessage(e), "\\n")
})
cat("\\n__RWB_DONE__\\n")
`

        const scriptPath = join(workDir, 'script.R')
        await writeFile(scriptPath, scriptContent, 'utf-8')

        const { stdout, stderr } = await runRscript([scriptPath], { cwd: workDir })

        const parsed = parseRScriptStdout(stdout)

        return {
          success: parsed.errors.length === 0,
          output: parsed.output,
          errors: parsed.errors,
          stderr,
          timedOut: false,
          truncated: false
        }
      } catch (error: unknown) {
        const failure = normalizeRExecFailure(error, R_TIMEOUT_MS, R_MAX_BUFFER, 'R 脚本执行')
        return {
          success: false,
          output: failure.output,
          errors: failure.errors,
          stderr: failure.stderr,
          timedOut: failure.timedOut,
          truncated: failure.truncated
        }
      } finally {
        // 清理临时目录
        if (workDir) {
          await rm(workDir, { recursive: true, force: true }).catch(() => {})
        }
      }
    }
  )

  // ── R 绘图（r:plot） ──────────────────────

  ipcMain.handle('r:plot', async (_event, code: unknown, dataCsv?: unknown) => {
    let workDir = ''
    try {
      const safeCode = validateString(code, 'code', MAX_CODE_CHARS)
      const safeCsv = validateDataCsv(dataCsv)

      workDir = await mkdtemp(join(tmpdir(), 'rwb-plot-'))

      // 写入数据
      if (safeCsv !== null) {
        await writeFile(join(workDir, 'data.csv'), safeCsv, 'utf-8')
      }

      // 写入主题模板（开发模式用 __dirname，打包后用 process.resourcesPath）
      const themeCandidates = [
        join(__dirname, '..', '..', 'src', 'main', 'rScripts', 'theme_academic.R'),
        join(process.resourcesPath || '', 'rScripts', 'theme_academic.R')
      ]
      let themeWritten = false
      for (const themePath of themeCandidates) {
        try {
          const themeContent = await readFile(themePath, 'utf-8')
          await writeFile(join(workDir, 'theme_academic.R'), themeContent, 'utf-8')
          themeWritten = true
          break
        } catch {
          continue
        }
      }
      if (!themeWritten) {
        // 最小备用主题：必须与 src/main/rScripts/theme_academic.R 提供的助手保持同步，
        // 否则 plotService 生成的代码找不到 rwb_* 而全部失败。
        // 旧版本这里连 save_plot 的形参名都是错的（w/h vs width/height）→ 即使走备用分支也画不出图。
        await writeFile(join(workDir, 'theme_academic.R'), `
rwb_has_after_stat <- function() tryCatch(utils::packageVersion("ggplot2") >= "3.4.0", error = function(e) FALSE)
colors_academic <- c("#2166AC", "#B2182B", "#4DAF4A", "#FF7F00", "#984EA3", "#A65628")
rwb_base_family <- function() ""
rwb_palette <- function(n, base = colors_academic) {
  n <- suppressWarnings(as.integer(n))
  if (length(n) != 1L || is.na(n) || n < 0L) n <- length(base)
  if (n == 0L) return(character(0))
  if (n <= length(base)) return(as.character(base[seq_len(n)]))
  if (requireNamespace("scales", quietly = TRUE)) {
    pal <- try(scales::hue_pal()(n), silent = TRUE)
    if (!inherits(pal, "try-error") && length(pal) >= n) return(as.character(pal)[seq_len(n)])
  }
  as.character(grDevices::hcl.colors(n, "Dark 3"))
}
rwb_drop_na <- function(data, cols) {
  keep <- rep(TRUE, nrow(data))
  for (cn in cols) if (cn %in% names(data)) keep <- keep & !is.na(data[[cn]])
  list(data = data[keep, , drop = FALSE], dropped = as.integer(sum(!keep)), n = as.integer(sum(keep)))
}
rwb_caption <- function(dropped = 0L, n = NULL, extra = NULL) {
  parts <- character(0)
  if (!is.null(dropped) && length(dropped) == 1L && !is.na(dropped) && dropped > 0) parts <- c(parts, sprintf("\\u5df2\\u5254\\u9664 %d \\u4e2a\\u7f3a\\u5931\\u503c", as.integer(dropped)))
  if (!is.null(n) && length(n) == 1L && !is.na(n)) parts <- c(parts, sprintf("\\u6709\\u6548\\u6837\\u672c n = %d", as.integer(n)))
  if (!is.null(extra) && length(extra) && any(nzchar(extra))) parts <- c(parts, extra[nzchar(extra)])
  if (!length(parts)) return(NULL)
  paste(parts, collapse = "\\uff1b")
}
rwb_factor <- function(x) {
  if (is.factor(x)) return(x)
  if (is.numeric(x)) { lv <- sort(unique(x[!is.na(x)])); return(factor(x, levels = lv)) }
  xc <- as.character(x); lv <- unique(xc[!is.na(xc)]); factor(xc, levels = lv)
}
add_sig_label <- function(p_value) {
  if (is.null(p_value) || length(p_value) != 1L || is.na(p_value)) return("")
  if (p_value < 0.001) return("***"); if (p_value < 0.01) return("**"); if (p_value < 0.05) return("*"); "ns"
}
apa_format <- function(stat_name, stat_value, df = NULL, p_value = NA_real_) {
  p_str <- if (is.null(p_value) || length(p_value) != 1L || is.na(p_value)) "" else if (p_value < 0.001) "p < .001" else sprintf("p = %.3f", p_value)
  df_str <- if (is.null(df) || !length(df)) "" else sprintf("(%s)", paste(format(df, trim = TRUE), collapse = ", "))
  val_str <- if (is.null(stat_value) || length(stat_value) != 1L || is.na(stat_value)) "NA" else sprintf("%.3f", stat_value)
  out <- sprintf("%s%s = %s", stat_name, df_str, val_str)
  if (nzchar(p_str)) out <- paste0(out, ", ", p_str)
  out
}
theme_academic <- function(base_size = 12) {
  ggplot2::theme_minimal(base_size = base_size, base_family = rwb_base_family()) +
    ggplot2::theme(axis.line = ggplot2::element_line(color = "black", linewidth = 0.5),
                   axis.ticks = ggplot2::element_line(color = "black", linewidth = 0.3),
                   plot.title = ggplot2::element_text(hjust = 0.5, face = "bold"))
}
save_plot <- function(p, filename, width = 6, height = 4, dpi = 300) {
  ggplot2::ggsave(filename, plot = p, width = width, height = height, dpi = dpi, units = "in", bg = "white")
  cat(paste0("PLOT_SAVED:", filename, "\\n"))
}`, 'utf-8')
      }

      // 写入 R 脚本（B1: 加载主题 + B2: tryCatch 错误捕获）
      // source() 必须在 tryCatch **内部**：装了 showtext 但缺 simhei.ttc 的机器上
      // font_add() 会抛 "font file not found" —— 旧版本 source 在 tryCatch 之外，
      // 该异常直接逃出应用错误处理：16/16 图表全灭、退出码 1、stderr 里才有线索、无 PLOT_SAVED。
      const scriptContent = `options(warn = 1)
setwd("${workDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")
tryCatch({
source("theme_academic.R")
${safeCode}
}, error = function(e) {
  cat("__RWB_ERROR__:", conditionMessage(e), "\\n")
})
cat("\\n__RWB_DONE__\\n")
`
      await writeFile(join(workDir, 'plot_script.R'), scriptContent, 'utf-8')

      const { stdout, stderr } = await runRscript([join(workDir, 'plot_script.R')], { cwd: workDir })

      // 解析输出（检查 R 错误哨兵 + 找图片路径）
      const parsed = parseRScriptStdout(stdout)
      if (parsed.errors.length > 0) {
        return { success: false, base64: null, path: null, error: parsed.errors.join('\n'), stderr }
      }

      const plotMatch = parsed.output.match(/PLOT_SAVED:(.+)/)
      if (plotMatch) {
        const plotFile = plotMatch[1].trim()
        const plotPath = join(workDir, plotFile)
        try {
          const imgBuffer = await readFile(plotPath)
          const base64 = imgBuffer.toString('base64')
          // Nit: 临时目录会在 finally 中删除，path 不再指向有效文件，返回空
          return { success: true, base64, path: '', error: null, stderr }
        } catch {
          return { success: false, base64: null, path: null, error: '图表文件未生成', stderr }
        }
      }

      // 修复：旧实现用 `stderr || stdout`，于是 `options(warn = 1)` 的普通警告会被当成失败原因。
      // 现在优先展示脚本自身的 stdout（末段），stderr 只作为补充信息。
      const stdoutTail = parsed.output.trim()
      const stderrTail = stderr.trim()
      const detail = stdoutTail
        ? `未找到图表输出（缺少 PLOT_SAVED 标记）。脚本输出：${stdoutTail.slice(-800)}`
        : stderrTail
          ? `未找到图表输出。stderr：${stderrTail.slice(-800)}`
          : '未找到图表输出'
      return { success: false, base64: null, path: null, error: detail, stderr }
    } catch (error: unknown) {
      const failure = normalizeRExecFailure(error, R_TIMEOUT_MS, R_MAX_BUFFER, 'R 绘图')
      return {
        success: false,
        base64: null,
        path: null,
        error: failure.errors.join('\n'),
        stderr: failure.stderr,
        timedOut: failure.timedOut
      }
    } finally {
      // S5: 图片已通过 base64 返回，清理临时目录
      if (workDir) {
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  })

  // ── R 包管理 ──────────────────────

  ipcMain.handle('r:packages', async (_event, packageNames: unknown) => {
    // 修复：tempDir 之前声明在 try 内部，catch/finally 都看不到 → 每次报错都泄漏临时目录
    let tempDir = ''
    try {
      const names = Array.isArray(packageNames) ? packageNames : [packageNames]
      // S1: 白名单校验包名，防 R 代码注入
      const pkgRegex = /^[a-zA-Z0-9._]+$/
      const validNames = names.filter((n) => {
        const s = validateString(n, 'packageName', 100)
        return pkgRegex.test(s)
      })
      if (validNames.length === 0) return { installed: [] }
      const checkCode = validNames.map((n) => `"${n}"`).join(', ')
      const code = `pkgs <- c(${checkCode})
installed <- pkgs[pkgs %in% rownames(installed.packages())]
cat(paste(installed, collapse = ","))`
      // S6: 使用唯一临时目录
      tempDir = await mkdtemp(join(tmpdir(), 'rwb-pkg-'))
      const scriptPath = join(tempDir, 'check.R')
      await writeFile(scriptPath, code, 'utf-8')
      const { stdout } = await runRscript([scriptPath], { timeout: 30000 })
      return { installed: stdout.trim().split(',').filter(Boolean) }
    } catch {
      return { installed: [] }
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  })

  ipcMain.handle('r:install', async (_event, packageName: unknown) => {
    // 修复：清理只写一次（原来成功路径和 catch 各写一份）
    let tempDir = ''
    try {
      const pkg = validateString(packageName, 'packageName', 100)
      // S1: 白名单校验
      if (!/^[a-zA-Z0-9._]+$/.test(pkg)) {
        return { success: false, output: '', error: '无效的包名' }
      }
      const code = `install.packages("${pkg}", repos = "https://cran.r-project.org", quiet = TRUE)`
      tempDir = await mkdtemp(join(tmpdir(), 'rwb-ins-'))
      const scriptPath = join(tempDir, 'install.R')
      await writeFile(scriptPath, code, 'utf-8')
      const { stdout, stderr } = await runRscript([scriptPath], { timeout: 300_000, maxBuffer: 32 * 1024 * 1024 })
      return { success: true, output: stdout, stderr, error: null }
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string; stdout?: string }
      return {
        success: false,
        output: err.stdout ?? '',
        error: err.stderr || err.message || '安装失败'
      }
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  })

  // ── SPSS 解析 ──────────────────────────────

  ipcMain.handle('data:parseSav', async (_event, filePath: unknown) => {
    try {
      const safePath = validateFilePath(validateString(filePath, 'filePath'), trustedDirs)
      // S4: 限制文件大小（SPSS .sav 超过 200MB 视为异常，避免 OOM）
      const info = await stat(safePath)
      if (info.size > MAX_SAV_FILE_BYTES) {
        return { success: false, error: '文件过大（>200MB），暂不支持解析' }
      }
      const buffer = await readFile(safePath)
      const sav = new SavBufferReader(buffer)
      await sav.open()

      const sysvars = sav.meta.sysvars
      const headers = sysvars.map((v) => v.name)

      // T3: 逐行读取并在 20 万行处停止。
      // 旧实现 `sav.meta.nrows ?? MAX_SAFE_INTEGER` → SavMeta 并无 nrows 字段 → 条件恒真，
      // 而 readAllRows() 会把**全部**行读进内存后才被 slice 丢弃，内存峰值由文件总行数决定。
      // 另外 sav-reader@2.0.8 自带的 readNextRow() 在第 1 行后就误报 EOF（详见 savImport.ts
      // “F3-c” 段），因此这里使用本地修正过的行读取器 createSavRowReader()。
      const declaredRows = declaredCaseCount(sav.meta)
      const readResult = await readSavRowsIncremental(createSavRowReader(sav), headers, {
        maxRows: MAX_SAV_ROWS,
        declaredRows
      })
      const rows = readResult.rows

      // T2: 列类型映射（数值枚举 0 = numeric）——见 savImport.ts 顶部说明
      const columnInfo = computeColumnInfo(sysvars, rows)

      return {
        success: true,
        headers,
        rows,
        columnInfo,
        truncated: readResult.truncated,
        truncationNotice: buildTruncationNotice(readResult, MAX_SAV_ROWS),
        rowCount: rows.length,
        totalRows: readResult.totalRows,
        declaredRows: readResult.declaredRows,
        maxRows: MAX_SAV_ROWS,
        meta: {
          name: safePath.split(/[/\\]/).pop(),
          rowCount: rows.length,
          columnCount: headers.length,
          product: sav.meta.header.product
        }
      }
    } catch (error: unknown) {
      const err = error as { message?: string }
      return { success: false, error: err.message || 'SPSS 文件解析失败' }
    }
  })

  // ── 安全配置存储（API Key 加密） ──────────────────────

  ipcMain.handle('config:saveApiKey', async (_event, provider: unknown, apiKey: unknown) => {
    try {
      const safeProvider = requireSafeProvider(provider)
      const safeKey = validateString(apiKey, 'apiKey', 500)

      const configPath = getSecureConfigPath()
      let config: Record<string, string> = {}

      if (existsSync(configPath)) {
        // 解密/解析失败会抛错 → 交给 catch 返回失败，**绝不**覆盖成只剩当前 provider
        config = await readApiKeyConfig(configPath)
      }

      config[safeProvider] = safeKey

      const json = JSON.stringify(config)
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(json)
        // 0600：仅当前用户可读写（Windows 上只体现只读位，POSIX 上生效）
        await writeFile(configPath, encrypted, { mode: 0o600 })
      } else {
        // S2: 加密不可用时仍写入，但结果里带上警告（打包后的 GUI 看不到 console.warn）
        await writeFile(configPath, json, { encoding: 'utf-8', mode: 0o600 })
        return {
          success: true,
          encrypted: false,
          warning: '当前系统不支持安全加密存储，API Key 将以明文保存在用户配置目录中。'
        }
      }
      return { success: true, encrypted: true }
    } catch (error: unknown) {
      const err = error as { message?: string }
      return { success: false, error: err.message || '保存失败' }
    }
  })

  ipcMain.handle('config:loadApiKey', async (_event, provider: unknown) => {
    try {
      const safeProvider = requireSafeProvider(provider)
      const configPath = getSecureConfigPath()

      if (!existsSync(configPath)) return null

      const config = await readApiKeyConfig(configPath)
      // Object.hasOwn：旧实现 `config[provider] || null` 会把继承成员当成真值返回
      // （provider='constructor' → 返回 Object 构造函数）
      if (!Object.hasOwn(config, safeProvider)) return null
      const value = config[safeProvider]
      return typeof value === 'string' && value.length > 0 ? value : null
    } catch {
      return null
    }
  })

  // ── 剪贴板（HTML 格式，用于粘贴到 Word） ──────────────────────

  ipcMain.handle('clipboard:writeHtml', async (_event, html: unknown, plainText: unknown) => {
    try {
      const safeHtml = validateString(html, 'html', 5_000_000)
      const safeText = validateString(plainText, 'plainText', 5_000_000)
      // Electron clipboard 同时写入 HTML 和纯文本
      // Word 粘贴时会优先使用 HTML 格式
      clipboard.write({
        text: safeText,
        html: safeHtml
      })
      return { success: true }
    } catch (error: unknown) {
      const err = error as { message?: string }
      return { success: false, error: err.message || '复制失败' }
    }
  })

  // ── OfficeCLI（Word/Excel 导出） ──────────────────────

  let officecliPath = ''

  /**
   * 检测 officecli 二进制。
   *
   * T12/F6（打包后 Word 导出失效的根因）：`electron-builder.json5` 之前把二进制放到
   * `resources/officecli.exe`，而这里找的是 `resources/bin/officecli.exe`。
   * 现在 builder 的 `extraResources.to` 已统一为 `bin/officecli.exe`，两边一致。
   * 实测产物：`releases/win-unpacked/resources/bin/officecli.exe`。
   */
  function officeCliCandidates(): string[] {
    return [
      // 打包后（首选，也是唯一被验证过的路径）
      process.resourcesPath ? join(process.resourcesPath, 'bin', 'officecli.exe') : '',
      // 开发模式：app.getAppPath() 是项目根目录
      join(app.getAppPath(), 'resources', 'bin', 'officecli.exe'),
      // 开发模式（__dirname = out/main）
      join(__dirname, '..', '..', 'resources', 'bin', 'officecli.exe'),
      // PATH 中
      'officecli'
    ].filter((p) => p.length > 0)
  }

  async function detectOfficeCli(): Promise<string> {
    if (officecliPath) return officecliPath
    for (const p of new Set(officeCliCandidates())) {
      if (p !== 'officecli' && !existsSync(p)) continue
      try {
        const { stdout } = await execFileAsync(p, ['--version'], { timeout: 5000 })
        if (String(stdout).trim()) {
          officecliPath = p
          return p
        }
      } catch {
        continue
      }
    }
    return ''
  }

  const OFFICECLI_MISSING_MESSAGE =
    '未找到 Word 导出引擎 officecli.exe（打包后应位于 resources/bin/officecli.exe）。' +
    '请重新安装完整版应用；开发模式下请把 officecli.exe 放到项目 resources/bin/ 目录。'

  ipcMain.handle('officecli:detect', async () => {
    const searched = officeCliCandidates()
    const path = await detectOfficeCli()
    if (!path) return { found: false, version: '', path: '', searched }
    try {
      const { stdout } = await execFileAsync(path, ['--version'], { timeout: 5000 })
      return { found: true, version: String(stdout).trim(), path, searched }
    } catch {
      return { found: false, version: '', path: '', searched }
    }
  })

  ipcMain.handle('officecli:generateDocx', async (_event, data: unknown) => {
    let tempDir = ''
    let docxPath = ''
    let cli = ''
    const deadline = Date.now() + DOCX_EXPORT_DEADLINE_MS
    const remaining = () => Math.max(5000, deadline - Date.now())

    try {
      cli = await detectOfficeCli()
      if (!cli) return { success: false, error: OFFICECLI_MISSING_MESSAGE }

      // 输入校验（tables 必须是数组、行列上限、cols = max(headers, 最长行)）
      const payload = validateDocxPayload(data)

      // B3: savePath 路径校验
      const safeSavePath = validateFilePath(payload.savePath, [
        app.getPath('userData'), app.getPath('documents'), app.getPath('desktop'),
        app.getPath('temp'), app.getPath('downloads')
      ])

      tempDir = await mkdtemp(join(tmpdir(), 'rwb-docx-'))
      docxPath = join(tempDir, 'report.docx')

      const plan = planDocxExport(payload)
      const commandsPath = join(tempDir, 'commands.json')
      await writeFile(commandsPath, JSON.stringify(plan.commands), 'utf-8')

      // 1. 创建 docx（空文档）
      await execFileAsync(cli, ['create', docxPath], { timeout: remaining() })

      // 2. **一次 batch** 应用全部命令（旧实现每单元格一次 execFileAsync：20×10 表 = 226 次进程创建）
      let batchStdout = ''
      try {
        const result = await execFileAsync(
          cli,
          ['batch', docxPath, '--input', commandsPath, '--json', '--stop-on-error'],
          { timeout: remaining(), maxBuffer: 16 * 1024 * 1024 }
        )
        batchStdout = String(result.stdout)
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message?: string }
        const envelope = parseOfficecliEnvelope(err.stdout ?? '')
        throw new Error(
          `officecli 批量写入失败：${envelope.error || err.stderr?.trim() || err.message || '未知错误'}`
        )
      }
      const envelope = parseOfficecliEnvelope(batchStdout)
      if (!envelope.success) {
        throw new Error(`officecli 批量写入失败：${envelope.error ?? '未知错误'}`)
      }

      // 3. flush 并释放文件句柄（非 officecli 程序读盘前必须）
      await execFileAsync(cli, ['close', docxPath], { timeout: remaining() })

      // 4. 复制到目标
      await copyFile(docxPath, safeSavePath)

      return {
        success: true,
        path: safeSavePath,
        tableCount: payload.tables.length,
        commandCount: plan.commandCount,
        processCount: plan.processCount,
        warnings: envelope.warnings
      }
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string }
      return { success: false, error: err.stderr?.trim() || err.message || '生成失败' }
    } finally {
      // **close 必须在 finally**：失败的 set 会让常驻 officecli 继续持有 report.docx，
      // 旧代码的 `rm(...).catch(()=>{})` 于是静默泄漏进程 + 临时目录。
      if (cli && docxPath) {
        await execFileAsync(cli, ['close', docxPath], { timeout: 10000 }).catch(() => {})
      }
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  })

  ipcMain.handle('dialog:saveFile', async (_event, options?: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: options?.defaultName || '分析报告.docx',
      filters: options?.filters || [
        { name: 'Word 文档', extensions: ['docx'] },
        { name: 'HTML 文件', extensions: ['html'] }
      ]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  // ── 系统信息 ──────────────────────────────

  ipcMain.handle('app:getInfo', async () => {
    return {
      platform: process.platform,
      arch: process.arch,
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node
    }
  })

  /**
   * 渲染进程推送当前界面语言 → 重建主菜单（T12：菜单文案此前硬编码中文）。
   * 渲染侧在 i18next 的 languageChanged 钩子里调用，通道不存在时静默跳过。
   */
  ipcMain.handle('app:setLanguage', async (_event, lng: unknown) => {
    const normalized = typeof lng === 'string' && /^en/i.test(lng) ? 'en-US' : 'zh-CN'
    try {
      menuLanguageHandler?.(normalized)
    } catch (error: unknown) {
      const err = error as { message?: string }
      console.warn('[main] 重建菜单失败:', err.message || error)
    }
    return normalized
  })
}
