/*
 * v0.2.6 task-3 — FINAL packaged-artifact runtime check.
 * Loads the SHIPPED, minified `resources/app.asar` main bundle (not the source) with a stubbed
 * `electron`, pointed at the real `releases/win-unpacked/resources` layout, and calls the real
 * IPC handlers. This closes the F6 acceptance line
 * "打包后的应用 officecli:detect 返回 found: true" without needing a GUI.
 *
 * Run with ELECTRON_RUN_AS_NODE=1 and an Electron binary (asar support required).
 */
const Module = require('module')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.resolve(__dirname, '..', '..')
const PACKAGED = process.argv[2] || path.join(ROOT, 'releases', 'win-unpacked')
const REPO = process.argv[3] || ROOT
const FIX_SRC = process.env.RWB_FIXTURES || path.join(__dirname, 'fixtures')
const RESOURCES = path.join(PACKAGED, 'resources')
const ASAR_FILE = path.join(RESOURCES, 'app.asar')
const ASAR_MAIN = path.join(ASAR_FILE, 'out', 'main', 'index.js')
const HAS_FIXTURES = fs.existsSync(path.join(FIX_SRC, 'small.sav')) && fs.existsSync(path.join(FIX_SRC, 'big.sav'))

/* ── 前置条件 1：必须存在 build:win 产物 ─────────────────────────────────
 * 缺失时打印 SKIP 并以退出码 0 结束，绝不把干净 checkout 判红。
 * （本 harness 为按需验收，不进入 npm test / ci.yml。）
 * 注意：asar 内部路径（out/main/index.js）在**普通 Node** 下 existsSync 恒为 false，
 * 只能先判断 app.asar 文件本身；内部条目在 Electron 阶段用 asar 支持检查。 */
if (!fs.existsSync(ASAR_FILE)) {
  console.log('SKIP  packaged_app_check — 未找到打包产物:', ASAR_FILE)
  console.log('      先运行 npm run build:win（需要 resources/bin/officecli.exe），再重新执行本脚本。')
  console.log('      未执行任何检查，退出码 0（本 harness 为按需验收，不进入 CI）')
  process.exit(0)
}

/* ── 前置条件 2：asar 需要 Electron 的读取能力；普通 Node 下自动用 Electron 重新执行 ── */
if (!process.versions.electron) {
  const { spawnSync } = require('child_process')
  let electronBin = null
  try {
    // electron 包的 index.js 导出可执行文件路径
    electronBin = require(path.join(ROOT, 'node_modules', 'electron'))
  } catch {
    electronBin = null
  }
  if (typeof electronBin !== 'string' || !fs.existsSync(electronBin)) {
    console.log('SKIP  packaged_app_check — 未找到 Electron 可执行文件（先运行 npm ci）')
    console.log('      未执行任何检查，退出码 0')
    process.exit(0)
  }
  const r = spawnSync(electronBin, [__filename, PACKAGED, REPO], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  })
  process.exit(r.status === null ? 1 : r.status)
}

/**
 * 中间产物目录（PNG 等），不再写死 %TEMP%\rwb-verify-026。
 * 前缀刻意避开 `rwb-pkg-`：verify_ipc.cjs 用该前缀检测 ipc.ts 的临时目录泄漏。
 */
const ARTIFACTS = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-pkgcheck-artifacts-'))

/**
 * 与 verify_ipc.cjs 同理：ipc.ts 的 validateFilePath 只信任 os.tmpdir() 等目录，
 * 仓库内的 fixtures 路径会被拒绝。复制到临时目录后再喂给真实 handler。
 */
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-pkgcheck-fixtures-'))
if (HAS_FIXTURES) {
  for (const f of fs.readdirSync(FIX_SRC)) {
    fs.copyFileSync(path.join(FIX_SRC, f), path.join(FIX, f))
  }
}

let failures = 0
const check = (name, cond, detail) => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  -> ${detail}` : ''}`)
}
const section = (t) => console.log(`\n=== ${t} ===`)

/* ── stub electron ───────────────────────────────────────────── */
const handlers = new Map()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-pkgcheck-userdata-'))
let rDetectionLog = null
class BrowserWindowStub {
  constructor(opts) {
    this.opts = opts
    this.webContents = {
      setWindowOpenHandler: () => undefined,
      on: () => undefined,
      executeJavaScript: async () => undefined
    }
  }
  on() { return this }
  show() { return this }
  focus() { return this }
  restore() { return this }
  isMinimized() { return false }
  loadFile() { return Promise.resolve() }
  loadURL() { return Promise.resolve() }
  static getAllWindows() { return [] }
}
const electronStub = {
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  BrowserWindow: BrowserWindowStub,
  Menu: { buildFromTemplate: (t) => ({ template: t }), setApplicationMenu: () => undefined },
  shell: { openExternal: () => Promise.resolve() },
  clipboard: { write: () => undefined },
  session: {
    defaultSession: {
      setPermissionRequestHandler: () => undefined,
      setPermissionCheckHandler: () => undefined
    }
  },
  app: {
    name: 'R Workbench',
    on: () => undefined,
    quit: () => undefined,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getVersion: () => '0.2.5',
    getAppPath: () => path.join(RESOURCES, 'app.asar'),
    getPath: (name) => ({
      userData,
      temp: os.tmpdir(),
      documents: path.join(REPO, 'docs-stub'),
      desktop: path.join(REPO, 'desktop-stub'),
      downloads: path.join(REPO, 'dl-stub')
    }[name] || os.tmpdir())
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('RWBENC:' + Buffer.from(s, 'utf8').toString('base64')),
    decryptString: (b) => {
      const t = b.toString('utf8')
      if (!t.startsWith('RWBENC:')) throw new Error('bad magic')
      return Buffer.from(t.slice(7), 'base64').toString('utf8')
    }
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) }
}
const origLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') return electronStub
  return origLoad.apply(this, arguments)
}

/* packaged layout: process.resourcesPath is a read-only accessor in Electron */
Object.defineProperty(process, 'resourcesPath', { value: RESOURCES, configurable: true, writable: true })

const call = (channel, ...args) => handlers.get(channel)({}, ...args)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function pngLumaStdDev(file) {
  const buf = fs.readFileSync(file)
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.slice(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const bpp = channels * (bitDepth / 8), stride = width * bpp
  const out = [], prev = Buffer.alloc(stride), cur = Buffer.alloc(stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    raw.copy(cur, 0, rp, rp + stride); rp += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0
      let v = cur[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c) }
      cur[i] = v & 0xff
    }
    for (let i = 0; i < stride; i += bpp) out.push(cur[i])
    cur.copy(prev)
  }
  const mean = out.reduce((s, v) => s + v, 0) / out.length
  return { stdDev: Math.sqrt(out.reduce((s, v) => s + (v - mean) ** 2, 0) / out.length), width, height }
}

const PLOT_CODE = `if (!exists("rwb_palette", mode = "function")) stop("绘图主题模板未正确加载（缺少 rwb_palette）")
data <- read.csv("data.csv", fileEncoding = "UTF-8-BOM")
data$plot_grp <- rwb_factor(data[["group"]])
p <- ggplot2::ggplot(data, ggplot2::aes(x = plot_grp, y = score)) +
  ggplot2::geom_boxplot(na.rm = TRUE) +
  ggplot2::labs(title = "打包产物验证", caption = rwb_caption(0L, nrow(data))) +
  theme_academic()
save_plot(p, "plot_boxplot.png", width = 6, height = 4)`

async function main() {
  console.log(`runtime: electron=${process.versions.electron} node=${process.versions.node}`)
  console.log(`shipped bundle: ${ASAR_MAIN}`)
  console.log(`resourcesPath: ${process.resourcesPath}`)
  if (!fs.existsSync(ASAR_MAIN)) {
    check('shipped asar main bundle readable', false, ASAR_MAIN)
    console.log('\n>>> PACKAGED ARTIFACT: app.asar 内缺少 out/main/index.js（产物损坏或不完整）')
    process.exit(1)
  }
  check('shipped asar main bundle readable', true)

  require(ASAR_MAIN)
  await sleep(300)
  section('shipped bundle bootstrapped through stubbed electron')
  check('IPC handlers registered from the asar bundle', handlers.size > 0, `${handlers.size} handlers`)

  section('F6 line: packaged officecli:detect must return found:true')
  const ocl = await call('officecli:detect')
  console.log('  detect =', JSON.stringify(ocl))
  check('found === true', ocl.found === true, ocl.path)
  check('path is the SHIPPED resources/bin/officecli.exe', ocl.path === path.join(RESOURCES, 'bin', 'officecli.exe'), ocl.path)
  check('shipped binary answers --version', /^\d+\.\d+\.\d+$/.test(ocl.version || ''), ocl.version)

  section('shipped bundle .sav import (T2/T3 in the real artifact)')
  if (!HAS_FIXTURES) {
    console.log('SKIP  fixtures/{small,big}.sav 缺失（Rscript scripts/validate/gen_sav.R，需要 haven）——跳过 4 项 .sav 检查')
  } else {
    const small = await call('data:parseSav', path.join(FIX, 'small.sav'))
    check('small.sav rows === 6', small.success === true && small.rows.length === 6, `${small.rows ? small.rows.length : small.error}`)
    check('numeric columns = id,score,group',
      small.success && small.columnInfo.filter((c) => c.type === 'numeric').map((c) => c.name).join(',') === 'id,score,group',
      small.success ? small.columnInfo.map((c) => c.name + ':' + c.type).join(',') : small.error)
    const big = await call('data:parseSav', path.join(FIX, 'big.sav'))
    check('big.sav rows === 200000', big.success === true && big.rows.length === 200000, big.rows ? big.rows.length : big.error)
    check('big.sav truncated === true / totalRows 300000', big.truncated === true && big.totalRows === 300000)
  }

  section('shipped bundle r:detect (R not on PATH)')
  const det = await call('r:detect')
  rDetectionLog = det
  check('found === true', det.found === true, det.path)
  check('points at R 4.6.0 bin/Rscript.exe', /R-4\.6\.0\\bin\\Rscript\.exe$/.test(det.path || ''), det.path)

  section('shipped bundle r:plot with the SHIPPED rScripts/theme_academic.R')
  const p1 = await call('r:plot', PLOT_CODE, 'group,score\n1,88\n2,92\n1,75\n2,60\n')
  console.log('  plot =', JSON.stringify({ success: p1.success, error: p1.error, bytes: p1.base64 ? p1.base64.length : 0 }))
  check('plot success true', p1.success === true, p1.error)
  if (p1.base64) {
    const out = path.join(ARTIFACTS, 'out_packaged.png')
    fs.writeFileSync(out, Buffer.from(p1.base64, 'base64'))
    const l = pngLumaStdDev(out)
    console.log(`  packaged PNG ${l.width}x${l.height} lumStdDev=${l.stdDev.toFixed(2)}`)
    check('PNG non-blank (stdDev > 5)', l.stdDev > 5, l.stdDev.toFixed(2))
  } else {
    check('PNG produced', false, 'no base64')
  }

  section('shipped bundle config API-key path')
  check('saveApiKey openai', (await call('config:saveApiKey', 'openai', 'sk-packaged')).success === true)
  check('loadApiKey round-trips', (await call('config:loadApiKey', 'openai')) === 'sk-packaged')
  check('loadApiKey("constructor") === null', (await call('config:loadApiKey', 'constructor')) === null)

  console.log(`\n${failures === 0 ? '>>> PACKAGED ARTIFACT: ALL CHECKS PASSED' : `>>> ${failures} PACKAGED CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2) })
