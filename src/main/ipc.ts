import { ipcMain, dialog, app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'
import { SavBufferReader } from 'sav-reader'

const execAsync = promisify(exec)

/**
 * 注册所有 IPC 处理器
 * 负责：文件操作、R环境检测、R脚本执行、SPSS解析
 */
export function registerIpcHandlers(): void {
  // ── 文件操作 ──────────────────────────────

  // 打开文件对话框
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

  // 读取文件（二进制）
  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    const buffer = await readFile(filePath)
    return buffer
  })

  // 读取文件（文本）
  ipcMain.handle('fs:readFileText', async (_event, filePath: string) => {
    const content = await readFile(filePath, 'utf-8')
    return content
  })

  // 写入文件
  ipcMain.handle(
    'fs:writeFile',
    async (_event, filePath: string, content: string) => {
      await writeFile(filePath, content, 'utf-8')
      return true
    }
  )

  // 获取应用路径
  ipcMain.handle('app:getPath', async () => {
    return {
      userData: app.getPath('userData'),
      temp: app.getPath('temp'),
      documents: app.getPath('documents')
    }
  })

  // ── R 环境 ──────────────────────────────

  // 检测 R 环境
  ipcMain.handle('r:detect', async () => {
    try {
      // Windows: 尝试常见路径和 PATH
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
            return {
              found: true,
              path: rPath,
              version: versionMatch[1]
            }
          }
        } catch {
          continue
        }
      }

      return { found: false, path: '', version: '' }
    } catch {
      return { found: false, path: '', version: '' }
    }
  })

  // 执行 R 脚本
  ipcMain.handle(
    'r:execute',
    async (_event, code: string, dataFiles?: Record<string, string>) => {
      try {
        const { join: pathJoin } = await import('path')
        const { mkdtemp, writeFile: fsWriteFile } = await import(
          'fs/promises'
        )
        const os = await import('os')

        // 创建临时工作目录
        const workDir = await mkdtemp(pathJoin(os.tmpdir(), 'rworkbench-'))

        // 写入数据文件
        if (dataFiles) {
          for (const [name, content] of Object.entries(dataFiles)) {
            await fsWriteFile(pathJoin(workDir, name), content, 'utf-8')
          }
        }

        // 生成 R 脚本，添加 JSON 输出包装
        const scriptContent = `
# R Workbench 自动执行脚本
options(warn = 1)
options(digits = 6)

# 设置工作目录
setwd("${workDir.replace(/\\/g, '\\\\')}")

# 捕获输出
output <- list(success = TRUE, results = list(), errors = list(), plots = list())

tryCatch({
  # 用户代码开始
  ${code}
  # 用户代码结束
}, error = function(e) {
  output$success <<- FALSE
  output$errors <<- list(conditionMessage(e))
})

# 输出结果
cat("__RWORKBENCH_RESULT_START__\\n")
cat(jsonlite::toJSON(output, auto_unbox = TRUE, force = TRUE))
cat("\\n__RWORKBENCH_RESULT_END__\\n")
`

        const scriptPath = pathJoin(workDir, 'script.R')
        await fsWriteFile(scriptPath, scriptContent, 'utf-8')

        // 执行 R 脚本
        const { stdout, stderr } = await execAsync(
          `Rscript "${scriptPath}"`,
          {
            timeout: 60000,
            maxBuffer: 10 * 1024 * 1024,
            cwd: workDir
          }
        )

        // 解析结果
        const resultMatch = stdout.match(
          /__RWORKBENCH_RESULT_START__\n([\s\S]*?)\n__RWORKBENCH_RESULT_END__/
        )

        if (resultMatch) {
          return {
            success: true,
            data: resultMatch[1],
            stdout,
            stderr,
            workDir
          }
        }

        return { success: true, data: stdout, stdout, stderr, workDir }
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message?: string }
        return {
          success: false,
          data: null,
          stdout: err.stdout || '',
          stderr: err.stderr || err.message || 'Unknown error',
          workDir: ''
        }
      }
    }
  )

  // ── SPSS 解析 ──────────────────────────────

  ipcMain.handle('data:parseSav', async (_event, filePath: string) => {
    try {
      const buffer = await readFile(filePath)
      const sav = new SavBufferReader(buffer)
      await sav.open()

      const headers = sav.meta.sysvars.map((v) => v.name)
      const allRows = await sav.readAllRows()

      // 将 SPSS 数据转换为标准格式
      const rows = allRows.map((row: Record<string, unknown>) => {
        const normalized: Record<string, unknown> = {}
        for (const h of headers) {
          const val = row[h]
          if (val === null || val === undefined) {
            normalized[h] = ''
          } else {
            normalized[h] = val
          }
        }
        return normalized
      })

      // 列信息
      const columnInfo = sav.meta.sysvars.map((v) => {
        let missing = 0
        const missingValues = v.missing
        for (const row of rows) {
          const val = row[v.name]
          if (
            val === '' ||
            val === null ||
            val === undefined ||
            (typeof missingValues === 'number' && val === missingValues) ||
            (Array.isArray(missingValues) && missingValues.includes(val as number))
          ) {
            missing++
          }
        }
        return {
          name: v.name,
          type: v.type === 'numeric' ? 'numeric' as const : 'string' as const,
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
          name: filePath.split(/[/\\]/).pop(),
          rowCount: rows.length,
          columnCount: headers.length,
          product: sav.meta.header.product
        }
      }
    } catch (error: unknown) {
      const err = error as { message?: string }
      return {
        success: false,
        error: err.message || 'SPSS 文件解析失败'
      }
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
