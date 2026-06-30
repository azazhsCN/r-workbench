import { ipcMain, dialog, app, safeStorage, clipboard } from 'electron'
import { readFile, writeFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, normalize, sep } from 'path'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { SavBufferReader } from 'sav-reader'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

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

  /**
   * 从对话框选中的文件直接读取内容
   * 路径来自系统文件对话框，用户主动选择，天然可信
   */
  ipcMain.handle(
    'dialog:readFile',
    async (_event, options?: { asText?: boolean }) => {
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
      const ext = fileName.split('.').pop()?.toLowerCase()

      if (options?.asText) {
        const content = await readFile(filePath, 'utf-8')
        return { filePath, fileName, ext, content: content as string | null, buffer: null }
      } else {
        const buffer = await readFile(filePath)
        return { filePath, fileName, ext, content: null, buffer: buffer }
      }
    }
  )

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

  // 缓存检测到的 R 路径
  let detectedRPath = 'Rscript'

  ipcMain.handle('r:detect', async () => {
    const { readdir } = await import('fs/promises')

    // 动态扫描 R 安装目录，兼容所有版本
    const scanPaths: string[] = ['Rscript'] // 优先尝试 PATH

    const programFilesDirs = [
      process.env['ProgramFiles'] || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      process.env['LOCALAPPDATA'] || ''
    ].filter(Boolean)

    for (const dir of programFilesDirs) {
      try {
        const rDir = `${dir}\\R`
        const entries = await readdir(rDir, { withFileTypes: true })
        // 按版本号倒序排列（最新版本优先）
        const versions = entries
          .filter((e) => e.isDirectory() && e.name.startsWith('R-'))
          .map((e) => e.name)
          .sort()
          .reverse()
        for (const ver of versions) {
          scanPaths.push(`${rDir}\\${ver}\\bin\\Rscript.exe`)
          scanPaths.push(`${rDir}\\${ver}\\bin\\x64\\Rscript.exe`)
        }
      } catch {
        // 目录不存在，跳过
      }
    }

    // 尝试每个路径
    for (const rPath of scanPaths) {
      try {
        const { stdout, stderr } = await execAsync(
          `"${rPath}" --version 2>&1 || "${rPath}" -e "cat(R.version.string)"`,
          { timeout: 10000 }
        )
        const allOutput = stdout + stderr
        // 匹配 "R version X.Y.Z" 或 "Rscript (R) version X.Y.Z"
        const versionMatch = allOutput.match(/version (\d+\.\d+\.\d+)/)
        if (versionMatch) {
          detectedRPath = rPath
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
setwd("${workDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")
tryCatch({
${safeCode}
}, error = function(e) {
  cat("__RWB_ERROR__:", conditionMessage(e), "\\n")
})
cat("\\n__RWB_DONE__\\n")
`

        const scriptPath = join(workDir, 'script.R')
        await fsWriteFile(scriptPath, scriptContent, 'utf-8')

        const { stdout, stderr } = await execAsync(`"${detectedRPath}" "${scriptPath}"`, {
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

  // ── R 绘图（r:plot） ──────────────────────

  ipcMain.handle('r:plot', async (_event, code: unknown, dataCsv?: unknown) => {
    let workDir = ''
    try {
      const safeCode = validateString(code, 'code', 5_000_000)
      const os = await import('os')
      const { mkdtemp, writeFile: fsWrite, readFile: fsRead, rm: fsRm } = await import('fs/promises')

      workDir = await mkdtemp(join(os.tmpdir(), 'rwb-plot-'))

      // 写入数据
      if (dataCsv && typeof dataCsv === 'string') {
        await fsWrite(join(workDir, 'data.csv'), dataCsv, 'utf-8')
      }

      // 写入主题模板
      const themePath = join(__dirname, '..', '..', 'resources', 'rScripts', 'theme_academic.R')
      try {
        const themeContent = await fsRead(themePath, 'utf-8')
        await fsWrite(join(workDir, 'theme_academic.R'), themeContent, 'utf-8')
      } catch {
        // 主题文件不存在时使用默认主题
      }

      // 写入 R 脚本（B1: 加载主题 + B2: tryCatch 错误捕获）
      const scriptContent = `options(warn = 1)
setwd("${workDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")
source("theme_academic.R")
tryCatch({
${safeCode}
}, error = function(e) {
  cat("__RWB_ERROR__:", conditionMessage(e), "\\n")
})
cat("\\n__RWB_DONE__\\n")
`
      await fsWrite(join(workDir, 'plot_script.R'), scriptContent, 'utf-8')

      const { stdout, stderr } = await execAsync(`"${detectedRPath}" "${join(workDir, 'plot_script.R')}"`, {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: workDir
      })

      // 解析输出（检查 R 错误哨兵 + 找图片路径）
      const errorMatch = stdout.match(/__RWB_ERROR__:(.*)/)
      if (errorMatch) {
        return { success: false, base64: null, path: null, error: errorMatch[1].trim() }
      }

      const plotMatch = stdout.match(/PLOT_SAVED:(.+)/)
      if (plotMatch) {
        const plotFile = plotMatch[1].trim()
        const plotPath = join(workDir, plotFile)
        try {
          const imgBuffer = await fsRead(plotPath)
          const base64 = imgBuffer.toString('base64')
          return { success: true, base64, path: plotPath, error: null }
        } catch {
          return { success: false, base64: null, path: null, error: '图表文件未生成' }
        }
      }

      return { success: false, base64: null, path: null, error: stderr || stdout || '未找到图表输出' }
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string }
      return { success: false, base64: null, path: null, error: err.stderr || err.message || '绘图失败' }
    } finally {
      // S5: 图片已通过 base64 返回，清理临时目录
      if (workDir) {
        rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  })

  // ── R 包管理 ──────────────────────

  ipcMain.handle('r:packages', async (_event, packageNames: unknown) => {
    const os = await import('os')
    const { mkdtemp } = await import('fs/promises')
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
      const tempDir = await mkdtemp(join(os.tmpdir(), 'rwb-pkg-'))
      const scriptPath = join(tempDir, 'check.R')
      await writeFile(scriptPath, code, 'utf-8')
      const { stdout } = await execAsync(`"${detectedRPath}" "${scriptPath}"`, { timeout: 30000 })
      rm(tempDir, { recursive: true, force: true }).catch(() => {})
      return { installed: stdout.trim().split(',').filter(Boolean) }
    } catch {
      return { installed: [] }
    }
  })

  ipcMain.handle('r:install', async (_event, packageName: unknown) => {
    const os = await import('os')
    const { mkdtemp } = await import('fs/promises')
    let tempDir = ''
    try {
      const pkg = validateString(packageName, 'packageName', 100)
      // S1: 白名单校验
      if (!/^[a-zA-Z0-9._]+$/.test(pkg)) {
        return { success: false, output: '', error: '无效的包名' }
      }
      const code = `install.packages("${pkg}", repos = "https://cran.r-project.org", quiet = TRUE)`
      tempDir = await mkdtemp(join(os.tmpdir(), 'rwb-ins-'))
      const scriptPath = join(tempDir, 'install.R')
      await writeFile(scriptPath, code, 'utf-8')
      const { stdout } = await execAsync(`"${detectedRPath}" "${scriptPath}"`, { timeout: 300000 })
      rm(tempDir, { recursive: true, force: true }).catch(() => {})
      return { success: true, output: stdout, error: null }
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string }
      if (tempDir) rm(tempDir, { recursive: true, force: true }).catch(() => {})
      return { success: false, output: '', error: err.stderr || err.message || '安装失败' }
    }
  })

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
        // S2: 加密不可用时警告（仍写入，但用户应知晓风险）
        console.warn('safeStorage 不可用，API Key 将以明文存储。建议使用支持密钥环的操作系统。')
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

  /** 检测 officecli 二进制 */
  async function detectOfficeCli(): Promise<string> {
    if (officecliPath) return officecliPath
    const candidates = [
      join(app.getAppPath(), 'resources', 'bin', 'officecli.exe'),
      join(process.resourcesPath || '', 'bin', 'officecli.exe'),
      join(__dirname, '..', '..', 'resources', 'bin', 'officecli.exe'),
      'officecli' // PATH 中
    ]
    for (const p of candidates) {
      try {
        const { stdout } = await execAsync(`"${p}" --version`, { timeout: 5000 })
        if (stdout.trim()) {
          officecliPath = p
          return p
        }
      } catch {
        continue
      }
    }
    return ''
  }

  ipcMain.handle('officecli:detect', async () => {
    const path = await detectOfficeCli()
    if (!path) return { found: false, version: '', path: '' }
    try {
      const { stdout } = await execAsync(`"${path}" --version`, { timeout: 5000 })
      return { found: true, version: stdout.trim(), path }
    } catch {
      return { found: false, version: '', path: '' }
    }
  })

  ipcMain.handle('officecli:generateDocx', async (_event, data: unknown) => {
    const { mkdtemp, copyFile, rm } = await import('fs/promises')
    let tempDir = ''
    try {
      const cli = await detectOfficeCli()
      if (!cli) return { success: false, error: 'OfficeCLI 未安装，请将 officecli.exe 放入 resources/bin/ 目录' }

      // 输入校验（S6）
      if (!data || typeof data !== 'object') return { success: false, error: '无效参数' }
      const { title, tables, interpretation, savePath } = data as {
        title: string
        tables: Array<{ title: string; headers: string[]; rows: (string | number)[][]; note?: string }>
        interpretation?: string
        savePath: string
      }
      validateString(title, 'title', 1000)
      if (interpretation) validateString(interpretation, 'interpretation', 100_000)
      // B3: savePath 路径校验
      const safeSavePath = validateFilePath(validateString(savePath, 'savePath'), [
        app.getPath('userData'), app.getPath('documents'), app.getPath('desktop'),
        app.getPath('temp'), app.getPath('downloads')
      ])

      tempDir = await mkdtemp(join(require('os').tmpdir(), 'rwb-docx-'))
      const docxPath = join(tempDir, 'report.docx')

      // B2: 用 execFileAsync 替代 execAsync，参数作为数组传递，不走 shell
      const run = async (...args: string[]) => {
        const { stdout } = await execFileAsync(cli, args, { timeout: 30000 })
        return stdout
      }

      const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

      // 1. 创建 docx
      await run('create', docxPath)

      // 2. 报告标题
      await run('add', docxPath, '/', '--type', 'paragraph', '--prop', `text=${esc(title)}`, '--prop', 'bold=true', '--prop', 'size=18')

      // 3. 逐个添加表格
      for (let ti = 0; ti < tables.length; ti++) {
        const table = tables[ti]
        const tableIdx = ti + 1

        // 表标题
        if (table.title) {
          await run('add', docxPath, '/', '--type', 'paragraph', '--prop', `text=${esc(table.title)}`, '--prop', 'bold=true', '--prop', 'size=14')
        }

        // 添加空表格
        const totalRows = table.rows.length + 1
        const cols = table.headers.length
        await run('add', docxPath, '/', '--type', 'table', '--prop', `rows=${totalRows}`, '--prop', `cols=${cols}`)

        // 三线表样式
        await run('set', docxPath, `/body/tbl[${tableIdx}]`,
          '--prop', 'border.top=single', '--prop', 'border.top.sz=12',
          '--prop', 'border.bottom=single', '--prop', 'border.bottom.sz=12',
          '--prop', 'border.left=none', '--prop', 'border.right=none',
          '--prop', 'border.insideH=none', '--prop', 'border.insideV=none')

        // 表头行底部细线
        for (let c = 0; c < cols; c++) {
          await run('set', docxPath, `/body/tbl[${tableIdx}]/tr[1]/tc[${c + 1}]`,
            '--prop', 'border.bottom=single', '--prop', 'border.bottom.sz=4')
        }

        // 填写表头
        for (let c = 0; c < cols; c++) {
          await run('set', docxPath, `/body/tbl[${tableIdx}]/tr[1]/tc[${c + 1}]`,
            '--prop', `text=${esc(table.headers[c])}`, '--prop', 'bold=true')
        }

        // 填写数据行
        for (let r = 0; r < table.rows.length; r++) {
          for (let c = 0; c < table.rows[r].length; c++) {
            await run('set', docxPath, `/body/tbl[${tableIdx}]/tr[${r + 2}]/tc[${c + 1}]`,
              '--prop', `text=${esc(String(table.rows[r][c]))}`)
          }
        }

        // 表注
        if (table.note) {
          await run('add', docxPath, '/', '--type', 'paragraph', '--prop', `text=${esc(table.note)}`, '--prop', 'italic=true', '--prop', 'size=10')
        }
      }

      // 4. 解读文字
      if (interpretation) {
        await run('add', docxPath, '/', '--type', 'paragraph', '--prop', 'text= ')
        for (const line of interpretation.split('\n').filter((l) => l.trim())) {
          await run('add', docxPath, '/', '--type', 'paragraph', '--prop', `text=${esc(line)}`)
        }
      }

      // 5. 保存并关闭
      await run('close', docxPath)

      // 6. 复制到目标
      await copyFile(docxPath, safeSavePath)
      rm(tempDir, { recursive: true, force: true }).catch(() => {})

      return { success: true, path: safeSavePath }
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string }
      if (tempDir) rm(tempDir, { recursive: true, force: true }).catch(() => {})
      return { success: false, error: err.stderr || err.message || '生成失败' }
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
}
