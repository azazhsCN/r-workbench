import { app, BrowserWindow, shell, Menu, session } from 'electron'
import { join } from 'path'
import { existsSync, appendFileSync, statSync, writeFileSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { registerIpcHandlers, setMainWindow, setMenuLanguageHandler } from './ipc'

// ── 最小日志设施 ──────────────────────────────────────
// v0.2.5 完全没有日志：打包后的 GUI 里崩溃 / 未处理拒绝不可诊断（也没有 stderr 可看）。
// 这里把日志同时写到控制台与 userData/rworkbench-main.log，并在启动时做一次 2MB 截断。
const LOG_FILE_MAX_BYTES = 2 * 1024 * 1024
let logFilePath: string | null = null

function getLogFilePath(): string | null {
  try {
    if (!logFilePath) logFilePath = join(app.getPath('userData'), 'rworkbench-main.log')
    return logFilePath
  } catch {
    return null
  }
}

function rotateLogIfNeeded(): void {
  const file = getLogFilePath()
  if (!file) return
  try {
    if (existsSync(file) && statSync(file).size > LOG_FILE_MAX_BYTES) {
      writeFileSync(file, '', 'utf-8')
    }
  } catch {
    // 日志不是关键路径，失败即忽略
  }
}

function log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  const detailText =
    detail === undefined
      ? ''
      : ` ${detail instanceof Error ? (detail.stack ?? detail.message) : JSON.stringify(detail)}`
  const line = `[${new Date().toISOString()}] [${level}] ${message}${detailText}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else process.stdout.write(`${line}\n`)
  const file = getLogFilePath()
  if (file) {
    try {
      appendFileSync(file, `${line}\n`, 'utf-8')
    } catch {
      // 忽略
    }
  }
}

rotateLogIfNeeded()

process.on('uncaughtException', (error) => {
  log('error', 'uncaughtException', error instanceof Error ? (error.stack ?? error.message) : error)
})
process.on('unhandledRejection', (reason) => {
  log('error', 'unhandledRejection', reason instanceof Error ? (reason.stack ?? reason.message) : reason)
})

// ── 单实例锁 ──────────────────────────────────────
// 两个实例会并发地对 config.enc.json 做 read-modify-write（丢 Key），也会争抢 officecli 常驻进程。
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // 让位给已经运行的实例：它会收到 second-instance 事件并聚焦窗口
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

/** 只允许用系统浏览器打开这几种协议（阻断 file: / 自定义协议 → 本地可执行文件） */
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function openExternalSafely(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    log('warn', `拒绝打开非法 URL: ${rawUrl}`)
    return
  }
  if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    log('warn', `拒绝打开非白名单协议的 URL (${parsed.protocol}): ${rawUrl}`)
    return
  }
  void shell.openExternal(parsed.toString()).catch((err) => log('warn', 'openExternal 失败', err))
}

/** 应用自身的 origin（dev 为 ELECTRON_RENDERER_URL，打包为 file:// 的 index.html） */
function isAppOrigin(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl && url.startsWith(devUrl)) return true
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') {
      // 打包后只允许加载自己的 index.html
      return parsed.pathname.endsWith('/renderer/index.html') || parsed.pathname.endsWith('/index.html')
    }
    if (parsed.protocol === 'devtools:') return true
  } catch {
    return false
  }
  return false
}

/**
 * 进程级导航/窗口防护。
 * 旧代码只设置了 `setWindowOpenHandler`，**没有 will-navigate**：任何页面内导航（例如
 * 渲染进程被注入的 `location.href='file:///...evil.bat'`）都会真的发生，而 preload 在导航后
 * 依然被注入 → 与 `fs:writeFile`（可写 %TEMP%）组合成 “写文件 → 打开” 的代码执行链。
 */
function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (isAppOrigin(url)) return
      event.preventDefault()
      log('warn', `已拦截页面导航: ${url}`)
    })

    contents.setWindowOpenHandler((details) => {
      openExternalSafely(details.url)
      return { action: 'deny' }
    })

    contents.on('will-attach-webview', (event) => {
      // 本应用不需要 webview
      event.preventDefault()
    })
  })
}

/**
 * 主菜单文案（T12：此前 22 个 label 全部硬编码中文，英文用户看到的是中文菜单）。
 *
 * 键名与渲染进程 i18n 的顶层 `menu` 段**逐一对应**
 * （src/renderer/src/i18n/locales/zh-CN.json / en-US.json → `menu.*`）。
 * 这里不 import 那两个 JSON：tsconfig.node.json 的 include 不含 renderer，
 * 跨 project 引用会触发 TS6307，且主进程没有 i18next 运行时。
 */
type MenuLanguage = 'zh-CN' | 'en-US'

const MENU_LABELS: Record<MenuLanguage, Record<string, string>> = {
  'zh-CN': {
    file: '文件',
    edit: '编辑',
    view: '视图',
    help: '帮助',
    reload: '重新加载',
    forceReload: '强制重新加载',
    toggleDevTools: '开发者工具',
    resetZoom: '重置缩放',
    zoomIn: '放大',
    zoomOut: '缩小',
    togglefullscreen: '全屏',
    about: '关于 R Workbench',
    quitApp: '退出 R Workbench',
    closeWindow: '关闭窗口',
    quit: '退出',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    helpAbout: '关于'
  },
  'en-US': {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    help: 'Help',
    reload: 'Reload',
    forceReload: 'Force Reload',
    toggleDevTools: 'Toggle Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    togglefullscreen: 'Toggle Full Screen',
    about: 'About R Workbench',
    quitApp: 'Quit R Workbench',
    closeWindow: 'Close Window',
    quit: 'Quit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    helpAbout: 'About'
  }
}

let menuLanguage: MenuLanguage = 'zh-CN'

function mt(key: string): string {
  return MENU_LABELS[menuLanguage][key] ?? MENU_LABELS['zh-CN'][key] ?? key
}

function createMenu(): void {
  const isMac = process.platform === 'darwin'

  // 生产构建不应暴露开发者工具 / 强制重新加载
  const viewSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: 'reload' as const, label: mt('reload') },
    ...(is.dev
      ? ([
          { role: 'forceReload' as const, label: mt('forceReload') },
          { role: 'toggleDevTools' as const, label: mt('toggleDevTools') }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    { type: 'separator' as const },
    { role: 'resetZoom' as const, label: mt('resetZoom') },
    { role: 'zoomIn' as const, label: mt('zoomIn') },
    { role: 'zoomOut' as const, label: mt('zoomOut') },
    { type: 'separator' as const },
    { role: 'togglefullscreen' as const, label: mt('togglefullscreen') }
  ]

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS 应用菜单
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const, label: mt('about') },
              { type: 'separator' as const },
              { role: 'quit' as const, label: mt('quitApp') }
            ]
          }
        ]
      : []),
    {
      label: mt('file'),
      submenu: [
        isMac ? { role: 'close' as const, label: mt('closeWindow') } : { role: 'quit' as const, label: mt('quit') }
      ]
    },
    {
      label: mt('edit'),
      submenu: [
        { role: 'undo' as const, label: mt('undo') },
        { role: 'redo' as const, label: mt('redo') },
        { type: 'separator' as const },
        { role: 'cut' as const, label: mt('cut') },
        { role: 'copy' as const, label: mt('copy') },
        { role: 'paste' as const, label: mt('paste') },
        { role: 'selectAll' as const, label: mt('selectAll') }
      ]
    },
    {
      label: mt('view'),
      submenu: viewSubmenu
    },
    {
      label: mt('help'),
      submenu: [
        {
          label: mt('helpAbout'),
          click: async () => { /* 未来可链接到项目主页 */ }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/**
 * 窗口图标。
 * 旧代码写死 `join(__dirname, '../../resources/icon.png')`：打包后它指向 asar **内部**，
 * 而 asar 里没有 `resources/` 目录（实测 0 个条目匹配 resources）→ 死引用（Windows 上被
 * exe 图标掩盖）。现在 resources/icon.png 已通过 electron-builder `extraResources`
 * 落到 `process.resourcesPath/icon.png`（见 electron-builder.json5），因此打包后可用；
 * 这里保持「找得到才传」以免任何一端缺失时抛错。
 */
function resolveWindowIcon(): string | undefined {
  const candidates = [
    // 打包后（extraResources → process.resourcesPath/icon.png）
    process.resourcesPath ? join(process.resourcesPath, 'icon.png') : '',
    // 开发模式（__dirname = out/main）
    join(__dirname, '..', '..', 'resources', 'icon.png'),
    process.resourcesPath ? join(process.resourcesPath, 'icon.ico') : '',
    join(__dirname, '..', '..', 'resources', 'icon.ico')
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch {
      continue
    }
  }
  return undefined
}

function createWindow(): void {
  const icon = resolveWindowIcon()
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'R Workbench',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
      // sandbox 默认为 true，不再显式禁用
    }
  })

  // 注册到 ipc 模块供其他模块访问
  setMainWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 窗口打开新窗口的兜底（web-contents-created 已统一处理，这里保持显式以防被绕过）
  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalSafely(details.url)
    return { action: 'deny' }
  })

  // 主窗口导航兜底（app.on('web-contents-created') 已统一处理，这里显式再加一道）
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppOrigin(url)) return
    event.preventDefault()
    log('warn', `已拦截主窗口导航: ${url}`)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    // 默认拒绝一切权限请求（摄像头/麦克风/通知/地理位置/串口……本应用都不需要）。
    // 例外：渲染进程用 `navigator.clipboard.writeText()` 实现“复制结果”按钮，Chromium 会向
    // 主进程查询 **clipboard-sanitized-write** 权限。实测（Electron 33.4.11）：
    //   setPermissionCheckHandler(() => false)                → permissions.query('clipboard-write') = "denied"
    //   permission === 'clipboard-sanitized-write' 时返回 true → "granted"
    // 因此必须显式放行这一项，否则“复制到剪贴板”在打包后静默失败。
    const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed = ALLOWED_PERMISSIONS.has(permission)
      if (!allowed) log('warn', `已拒绝权限请求: ${permission}`)
      callback(allowed)
    })
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))

    hardenWebContents()
    // 菜单语言跟随渲染进程（i18next languageChanged → app:setLanguage）
    setMenuLanguageHandler((lng) => {
      menuLanguage = lng === 'en-US' ? 'en-US' : 'zh-CN'
      createMenu()
    })
    createMenu()
    registerIpcHandlers()
    createWindow()

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
