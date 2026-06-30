import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // ── 文件操作 ──
  dialog: {
    openFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:openFile', options),
    readFile: (options?: { asText?: boolean }) =>
      ipcRenderer.invoke('dialog:readFile', options) as Promise<{
        filePath: string
        fileName: string
        ext: string
        content: string | null
        buffer: Buffer | null
      } | null>,
    saveFile: (options?: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:saveFile', options) as Promise<string | null>
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
      ipcRenderer.invoke('r:detect') as Promise<{ found: boolean; path: string; version: string }>,
    execute: (code: string, dataCsv?: string) =>
      ipcRenderer.invoke('r:execute', code, dataCsv) as Promise<{
        success: boolean; output: string; errors: string[]; stderr: string
      }>,
    plot: (code: string, dataCsv?: string) =>
      ipcRenderer.invoke('r:plot', code, dataCsv) as Promise<{
        success: boolean; base64: string | null; path: string | null; error: string | null
      }>,
    packages: (names: string[]) =>
      ipcRenderer.invoke('r:packages', names) as Promise<{ installed: string[] }>,
    install: (packageName: string) =>
      ipcRenderer.invoke('r:install', packageName) as Promise<{
        success: boolean; output: string; error: string | null
      }>
  },

  // ── 数据解析 ──
  data: {
    parseSav: (filePath: string) =>
      ipcRenderer.invoke('data:parseSav', filePath) as Promise<{
        success: boolean; headers?: string[]; rows?: Record<string, unknown>[]
        columnInfo?: Array<{ name: string; type: string; missing: number; total: number }>
        meta?: { name: string; rowCount: number; columnCount: number; product: string }
        error?: string
      }>
  },

  // ── 安全配置存储 ──
  config: {
    saveApiKey: (provider: string, apiKey: string) =>
      ipcRenderer.invoke('config:saveApiKey', provider, apiKey) as Promise<{ success: boolean; error?: string }>,
    loadApiKey: (provider: string) =>
      ipcRenderer.invoke('config:loadApiKey', provider) as Promise<string | null>
  },

  // ── 剪贴板 ──
  clipboard: {
    writeHtml: (html: string, plainText: string) =>
      ipcRenderer.invoke('clipboard:writeHtml', html, plainText) as Promise<{ success: boolean; error?: string }>
  },

  // ── OfficeCLI ──
  officecli: {
    detect: () =>
      ipcRenderer.invoke('officecli:detect') as Promise<{ found: boolean; version: string; path: string }>,
    generateDocx: (data: {
      title: string
      tables: Array<{ title: string; headers: string[]; rows: (string | number)[][]; note?: string }>
      interpretation?: string
      savePath: string
    }) =>
      ipcRenderer.invoke('officecli:generateDocx', data) as Promise<{ success: boolean; path?: string; error?: string }>
  },

  // ── 应用信息 ──
  app: {
    getPath: () =>
      ipcRenderer.invoke('app:getPath') as Promise<{ userData: string; temp: string; documents: string }>,
    getInfo: () =>
      ipcRenderer.invoke('app:getInfo') as Promise<{
        platform: string; arch: string; version: string; electronVersion: string; nodeVersion: string
      }>
  }
}

contextBridge.exposeInMainWorld('api', api)

export type AppAPI = typeof api
