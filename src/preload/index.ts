import { contextBridge, ipcRenderer } from 'electron'

/**
 * 暴露给渲染进程的 API
 * 通过 contextBridge 安全地暴露 IPC 调用接口
 */
const api = {
  // ── 文件操作 ──
  dialog: {
    openFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:openFile', options)
  },

  fs: {
    readFile: (filePath: string) =>
      ipcRenderer.invoke('fs:readFile', filePath) as Promise<Buffer>,
    readFileText: (filePath: string) =>
      ipcRenderer.invoke('fs:readFileText', filePath) as Promise<string>,
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('fs:writeFile', filePath, content) as Promise<boolean>
  },

  // ── R 环境 ──
  r: {
    detect: () =>
      ipcRenderer.invoke('r:detect') as Promise<{
        found: boolean
        path: string
        version: string
      }>,
    execute: (code: string, dataFiles?: Record<string, string>) =>
      ipcRenderer.invoke('r:execute', code, dataFiles) as Promise<{
        success: boolean
        data: unknown
        stdout: string
        stderr: string
        workDir: string
      }>
  },

  // ── 数据解析 ──
  data: {
    parseSav: (filePath: string) =>
      ipcRenderer.invoke('data:parseSav', filePath) as Promise<{
        success: boolean
        headers?: string[]
        rows?: Record<string, unknown>[]
        columnInfo?: Array<{ name: string; type: string; missing: number; total: number }>
        meta?: { name: string; rowCount: number; columnCount: number; product: string }
        error?: string
      }>
  },

  // ── 应用信息 ──
  app: {
    getPath: () =>
      ipcRenderer.invoke('app:getPath') as Promise<{
        userData: string
        temp: string
        documents: string
      }>,
    getInfo: () =>
      ipcRenderer.invoke('app:getInfo') as Promise<{
        platform: string
        arch: string
        version: string
        electronVersion: string
        nodeVersion: string
      }>
  }
}

// 使用 contextBridge 安全暴露 API
contextBridge.exposeInMainWorld('api', api)

// 导出类型定义
export type AppAPI = typeof api
