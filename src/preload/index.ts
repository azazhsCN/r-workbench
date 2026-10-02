import { contextBridge, ipcRenderer } from 'electron'

/**
 * 注意：IPC 返回值经过 Electron 的结构化克隆，`Buffer` **不会**保留（到渲染进程是 `Uint8Array`）。
 * 因此这里一律声明为 `Uint8Array` —— 旧声明写 `Buffer` 会让渲染层误用 `Buffer` 专有 API 而运行期崩溃。
 */
const api = {
  // ── 文件操作 ──
  dialog: {
    openFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:openFile', options),
    /**
     * 始终返回**原始字节**（`buffer`），由渲染进程按 BOM / 严格 UTF-8 / GB18030 / Big5 解码。
     * `content` 恒为 null；`asText` 已废弃（保留仅为兼容旧调用方，行为不再变化）。
     *
     * @deprecated 请使用 `buffer` + 渲染进程编码探测（见 renderer services/decode.ts）
     */
    readFile: (options?: { asText?: boolean }) =>
      ipcRenderer.invoke('dialog:readFile', options) as Promise<{
        filePath: string
        fileName: string
        ext: string
        content: string | null
        buffer: Uint8Array | null
      } | null>,
    saveFile: (options?: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:saveFile', options) as Promise<string | null>
  },

  fs: {
    readFile: (filePath: string) =>
      ipcRenderer.invoke('fs:readFile', filePath) as Promise<Uint8Array>,
    /** 固定按 UTF-8 解码：需要 GBK/GB18030 时请改用 `fs.readFile` + 渲染进程探测 */
    readFileText: (filePath: string) =>
      ipcRenderer.invoke('fs:readFileText', filePath) as Promise<string>,
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('fs:writeFile', filePath, content) as Promise<boolean>
  },

  // ── R 环境 ──
  r: {
    detect: () =>
      ipcRenderer.invoke('r:detect') as Promise<{
        found: boolean; path: string; version: string; searched?: string[]
      }>,
    execute: (code: string, dataCsv?: string) =>
      ipcRenderer.invoke('r:execute', code, dataCsv) as Promise<{
        success: boolean; output: string; errors: string[]; stderr: string
        timedOut: boolean; truncated: boolean
      }>,
    plot: (code: string, dataCsv?: string) =>
      ipcRenderer.invoke('r:plot', code, dataCsv) as Promise<{
        success: boolean; base64: string | null; path: string | null; error: string | null
        stderr?: string; timedOut?: boolean
      }>,
    packages: (names: string[]) =>
      ipcRenderer.invoke('r:packages', names) as Promise<{ installed: string[] }>,
    install: (packageName: string) =>
      ipcRenderer.invoke('r:install', packageName) as Promise<{
        success: boolean; output: string; stderr?: string; error: string | null
      }>
  },

  // ── 数据解析 ──
  data: {
    parseSav: (filePath: string) =>
      ipcRenderer.invoke('data:parseSav', filePath) as Promise<{
        success: boolean; headers?: string[]; rows?: Record<string, unknown>[]
        columnInfo?: Array<{ name: string; type: string; missing: number; total: number }>
        /** 是否因超过 20 万行上限被截断 */
        truncated?: boolean
        /** 截断时给用户看的中文提示（未截断为 null） */
        truncationNotice?: string | null
        rowCount?: number
        totalRows?: number | null
        declaredRows?: number | null
        maxRows?: number
        meta?: { name: string; rowCount: number; columnCount: number; product: string }
        error?: string
      }>
  },

  // ── 安全配置存储 ──
  config: {
    saveApiKey: (provider: string, apiKey: string) =>
      ipcRenderer.invoke('config:saveApiKey', provider, apiKey) as Promise<{
        success: boolean; encrypted?: boolean; warning?: string; error?: string
      }>,
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
      ipcRenderer.invoke('officecli:detect') as Promise<{
        found: boolean; version: string; path: string; searched?: string[]
      }>,
    generateDocx: (data: {
      title: string
      tables: Array<{ title: string; headers: string[]; rows: (string | number)[][]; note?: string }>
      interpretation?: string
      savePath: string
    }) =>
      ipcRenderer.invoke('officecli:generateDocx', data) as Promise<{
        success: boolean; path?: string; error?: string
        tableCount?: number; commandCount?: number; processCount?: number; warnings?: string[]
      }>
  },

  // ── 应用信息 ──
  app: {
    getPath: () =>
      ipcRenderer.invoke('app:getPath') as Promise<{ userData: string; temp: string; documents: string }>,
    getInfo: () =>
      ipcRenderer.invoke('app:getInfo') as Promise<{
        platform: string; arch: string; version: string; electronVersion: string; nodeVersion: string
      }>,
    /** 把当前界面语言推给主进程 → 重建原生菜单（返回归一化后的语言） */
    setLanguage: (lng: string) =>
      ipcRenderer.invoke('app:setLanguage', lng) as Promise<'zh-CN' | 'en-US'>
  }
}

contextBridge.exposeInMainWorld('api', api)

export type AppAPI = typeof api
