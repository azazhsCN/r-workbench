import { ipcMain, dialog, app, safeStorage } from 'electron'
import { readFile, writeFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, normalize } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { SavBufferReader } from 'sav-reader'

const execAsync = promisify(exec)

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
    (dir) => normalized.startsWith(normalize(dir) + '\\') || normalized === normalize(dir)
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

/** API Key 安全存储路径 */
function getSecureConfigPath(): string {
  return join(app.getPath('userData'), 'config.enc.json')
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

  ipcMain.handle('fs:readFile', async (_event, filePath: unknown) => {
    const safePath = validateFilePath(validateString(filePath, 'filePath'), trustedDirs)
    return await readFile(safePath)
  })

  ipcMain.handle('fs:readFileText', async (_event, filePath: unknown) => {
    const safePath = validateFilePath(validateString(filePath, 'filePath'), trustedDirs)
    return await readFile(safePath, 'utf-8')
  })

  ipcMain.handle(
    'fs:writeFile',
    async (_event, filePath: unknown, content: unknown) => {
      const safePath = validateFilePath(validateString(filePath, 'filePath'), trustedDirs)
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

  ipcMain.handle('r:detect', async () => {
    const paths = [
      'Rscript',
      'C:\\Program Files\\R\\R-4.4.1\\bin\\Rscript.exe',
      'C:\\Program Files\\R\\R-4.3.3\\bin\\Rscript.exe',
      'C:\\Program Files\\R\\R-4.3.2\\bin\\Rscript.exe',
      'C:\\Program Files\\R\\R-4.2.3\\bin\\Rscript.exe'
    ]

    for (const rPath of paths) {
      try {
        const { stdout } = await execAsync(
          `"${rPath}" --version 2>&1 || "${rPath}" -e "cat(R.version.string)"`,
          { timeout: 10000 }
        )
        const versionMatch = stdout.match(/R version (\d+\.\d+\.\d+)/)
        if (versionMatch) {
          return { found: true, path: rPath, version: versionMatch[1] }
        }
      } catch {
        continue
      }
    }
    return { found: false, path: '', version: '' }
  })

  // ── R 执行（统一包装 + 自动清理） ──────────────────────

  ipcMain.handle(
    'r:execute',
    async (_event, code: unknown, dataCsv?: unknown) => {
      let workDir = ''
      try {
        const safeCode = validateString(code, 'code', 5_000_000)

        const os = await import('os')
        const { mkdtemp, writeFile: fsWriteFile } = await import('fs/promises')

        workDir = await mkdtemp(join(os.tmpdir(), 'rworkbench-'))

        // 写入数据 CSV（如果提供）
        if (dataCsv && typeof dataCsv === 'string') {
          await fsWriteFile(join(workDir, 'data.csv'), dataCsv, 'utf-8')
        }

        // 统一包装：主进程负责错误捕获和结果输出
        const scriptContent = `options(warn = 1)
options(digits = 6)
setwd("${workDir.replace(/\\/g, '\\\\')}")
tryCatch({
${safeCode}
}, error = function(e) {
  cat("__RWB_ERROR__:", conditionMessage(e), "\\n")
})
cat("\\n__RWB_DONE__\\n")
`

        const scriptPath = join(workDir, 'script.R')
        await fsWriteFile(scriptPath, scriptContent, 'utf-8')

        const { stdout, stderr } = await execAsync(`Rscript "${scriptPath}"`, {
          timeout: 60000,
          maxBuffer: 10 * 1024 * 1024,
          cwd: workDir
        })

        // 解析错误
        const errorMatch = stdout.match(/__RWB_ERROR__:(.*)/)
        const errors = errorMatch ? [errorMatch[1].trim()] : []

        return {
          success: errors.length === 0,
          output: stdout.replace(/__RWB_ERROR__:.*\n?/g, '').replace(/__RWB_DONE__\n?$/, '').trim(),
          errors,
          stderr,
          workDir
        }
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message?: string }
        return {
          success: false,
          output: '',
          errors: [err.stderr || err.message || '执行失败'],
          stderr: err.stderr || '',
          workDir: ''
        }
      } finally {
        // 清理临时目录
        if (workDir) {
          rm(workDir, { recursive: true, force: true }).catch(() => {})
        }
      }
    }
  )

  // ── SPSS 解析 ──────────────────────────────

  ipcMain.handle('data:parseSav', async (_event, filePath: unknown) => {
    try {
      const safePath = validateFilePath(validateString(filePath, 'filePath'), trustedDirs)
      const buffer = await readFile(safePath)
      const sav = new SavBufferReader(buffer)
      await sav.open()

      const headers = sav.meta.sysvars.map((v) => v.name)
      const allRows = await sav.readAllRows()

      const rows = allRows.map((row: Record<string, unknown>) => {
        const normalized: Record<string, unknown> = {}
        for (const h of headers) {
          const val = row[h]
          normalized[h] = val === null || val === undefined ? '' : val
        }
        return normalized
      })

      const columnInfo = sav.meta.sysvars.map((v) => {
        let missing = 0
        const missingValues = v.missing
        for (const row of rows) {
          const val = row[v.name]
          if (
            val === '' || val === null || val === undefined ||
            (typeof missingValues === 'number' && val === missingValues) ||
            (Array.isArray(missingValues) && missingValues.includes(val as number))
          ) {
            missing++
          }
        }
        return {
          name: v.name,
          type: v.type === 'numeric' ? ('numeric' as const) : ('string' as const),
          missing,
          total: rows.length
        }
      })

      return {
        success: true,
        headers,
        rows,
        columnInfo,
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
      const safeProvider = validateString(provider, 'provider', 100)
      const safeKey = validateString(apiKey, 'apiKey', 500)

      const configPath = getSecureConfigPath()
      let config: Record<string, string> = {}

      if (existsSync(configPath)) {
        try {
          const encrypted = await readFile(configPath)
          if (safeStorage.isEncryptionAvailable()) {
            const decrypted = safeStorage.decryptString(encrypted)
            config = JSON.parse(decrypted)
          } else {
            config = JSON.parse(encrypted.toString('utf-8'))
          }
        } catch {
          config = {}
        }
      }

      config[safeProvider] = safeKey

      const json = JSON.stringify(config)
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(json)
        await writeFile(configPath, encrypted)
      } else {
        await writeFile(configPath, json, 'utf-8')
      }
      return { success: true }
    } catch (error: unknown) {
      const err = error as { message?: string }
      return { success: false, error: err.message || '保存失败' }
    }
  })

  ipcMain.handle('config:loadApiKey', async (_event, provider: unknown) => {
    try {
      const safeProvider = validateString(provider, 'provider', 100)
      const configPath = getSecureConfigPath()

      if (!existsSync(configPath)) return null

      const encrypted = await readFile(configPath)
      let config: Record<string, string> = {}

      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(encrypted)
        config = JSON.parse(decrypted)
      } else {
        config = JSON.parse(encrypted.toString('utf-8'))
      }

      return config[safeProvider] || null
    } catch {
      return null
    }
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
}
