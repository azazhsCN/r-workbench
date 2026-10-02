/*
 * v0.2.6 task-3 — handler-level acceptance harness.
 * Loads the REAL src/main/ipc.ts with a stubbed `electron` module, then invokes the actual IPC
 * handlers. No GUI required.
 *
 * 持久化说明（engineer-gates）：原为 mainprocess 的临时脚本，现入库到 scripts/validate/。
 * 路径相对脚本自身；ipc.ts 每次运行时用 esbuild 现打包（_bundle.cjs），不提交编译产物。
 *
 * 前置条件：fixtures/{small,big}.sav（Rscript scripts/validate/gen_sav.R，需要 haven）+ R 4.6.0。
 * 缺少 fixtures 时打印 SKIP 并以退出码 0 结束（按需验收 harness，不进入 CI / npm test）。
 */
const Module = require('module')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { execFileSync } = require('child_process')

const REPO = process.argv[2] || path.resolve(__dirname, '..', '..')
/** fixtures 源目录（仓库内，.gitignore 排除）；RWB_FIXTURES 可覆盖 */
const FIX_SRC = process.env.RWB_FIXTURES || path.join(__dirname, 'fixtures')
const RSCRIPT = process.env.RWB_RSCRIPT || 'C:\\Program Files\\R\\R-4.6.0\\bin\\Rscript.exe'
/** 中间产物目录（PNG 等），不再写死 %TEMP%\rwb-verify-026 */
const ARTIFACTS = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-verify-artifacts-'))

const HAS_FIXTURES = fs.existsSync(path.join(FIX_SRC, 'small.sav')) && fs.existsSync(path.join(FIX_SRC, 'big.sav'))
if (!HAS_FIXTURES) {
  console.log('SKIP  verify_ipc.cjs — 缺少真实 .sav fixtures:', FIX_SRC)
  console.log('      生成方式: Rscript scripts/validate/gen_sav.R   （需要 haven 包）')
  console.log('      未执行任何检查，退出码 0（本 harness 为按需验收，不进入 CI）')
  process.exit(0)
}

/**
 * 关键：ipc.ts 的 validateFilePath 只信任 os.tmpdir() 等目录，仓库内的 fixtures 路径会被
 * 拒绝（"路径不在允许范围内"）。因此把 fixtures 复制到临时目录，再喂给真实 handler ——
 * 这既保持了对白名单语义的验证，也让 harness 不依赖任何机器专有路径。
 */
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-fixtures-'))
for (const f of fs.readdirSync(FIX_SRC)) {
  fs.copyFileSync(path.join(FIX_SRC, f), path.join(FIX, f))
}

let failures = 0
const check = (name, cond, detail) => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  -> ${detail}` : ''}`)
}
const section = (t) => console.log(`\n=== ${t} ===`)

/* ── stub electron ───────────────────────────────────────────── */
const handlers = new Map()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-userdata-'))
let encryptionMode = 'working' // 'working' | 'unavailable' | 'decrypt-fails'
const safeStorageStub = {
  isEncryptionAvailable: () => encryptionMode !== 'unavailable',
  encryptString: (s) => Buffer.concat([Buffer.from('RWBENC:'), Buffer.from(Buffer.from(s, 'utf8').toString('base64'))]),
  decryptString: (b) => {
    if (encryptionMode === 'decrypt-fails') throw new Error('decrypt failed')
    const t = b.toString('utf8')
    if (!t.startsWith('RWBENC:')) throw new Error('bad magic')
    return Buffer.from(t.slice(7), 'base64').toString('utf8')
  }
}
let nextOpenFile = null
const electronStub = {
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  app: {
    getPath: (name) =>
      ({ userData, temp: os.tmpdir(), documents: path.join(REPO, 'docs-stub'), desktop: path.join(REPO, 'desktop-stub'), downloads: path.join(REPO, 'dl-stub') }[name] || os.tmpdir()),
    getAppPath: () => REPO,
    getVersion: () => '0.2.6-test'
  },
  dialog: {
    showOpenDialog: async () => (nextOpenFile ? { canceled: false, filePaths: [nextOpenFile] } : { canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: '' })
  },
  safeStorage: safeStorageStub,
  clipboard: { write: () => undefined }
}
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub
  return origLoad.apply(this, arguments)
}

const { ensureBundle } = require('./_bundle.cjs')
const ipc = require(ensureBundle('src/main/ipc.ts', 'ipc.cjs'))
ipc.registerIpcHandlers()
const call = (channel, ...args) => handlers.get(channel)({}, ...args)

/* ── helpers ─────────────────────────────────────────────────── */
/** Electron defines process.resourcesPath as a read-only accessor → plain assignment is a no-op. */
function setResourcesPath(p) {
  try {
    Object.defineProperty(process, 'resourcesPath', { value: p, configurable: true, writable: true })
  } catch (e) {
    console.log('  !! 无法设置 process.resourcesPath:', e.message)
  }
  return process.resourcesPath
}
function pngLumaStdDev(file) {
  const buf = fs.readFileSync(file)
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.slice(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const bpp = channels * (bitDepth / 8)
  const stride = width * bpp
  const out = []
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    raw.copy(cur, 0, rp, rp + stride); rp += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = cur[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c) }
      cur[i] = v & 0xff
    }
    for (let i = 0; i < stride; i += bpp) out.push(cur[i])
    cur.copy(prev)
  }
  const mean = out.reduce((s, v) => s + v, 0) / out.length
  const variance = out.reduce((s, v) => s + (v - mean) ** 2, 0) / out.length
  return { stdDev: Math.sqrt(variance), width, height }
}

const PLOT_GUARD = 'if (!exists("rwb_palette", mode = "function")) stop("绘图主题模板未正确加载（缺少 rwb_palette）：请确认 src/main/rScripts/theme_academic.R 随应用一起打包")'
const PLOT_CODE = `${PLOT_GUARD}
data <- read.csv("data.csv", fileEncoding = "UTF-8-BOM")
.na <- rwb_drop_na(data, c("score", "group"))
data <- .na$data
data$plot_grp <- rwb_factor(data[["group"]])
stopifnot(is.function(add_sig_label), is.function(apa_format), is.function(rwb_has_after_stat))
p <- ggplot2::ggplot(data, ggplot2::aes(x = plot_grp, y = score, fill = plot_grp)) +
  ggplot2::geom_boxplot(outlier.shape = 21, alpha = 0.7, na.rm = TRUE) +
  ggplot2::scale_fill_manual(values = rwb_palette(nlevels(data$plot_grp))) +
  ggplot2::labs(title = "箱线图", caption = rwb_caption(.na$dropped, .na$n)) +
  theme_academic()
save_plot(p, "plot_boxplot.png", width = 6, height = 4)`

async function main() {
  /* ── 1. data:parseSav ─────────────────────────────────────── */
  section('handler data:parseSav — T2/T3（真实 .sav）')
  const small = await call('data:parseSav', path.join(FIX, 'small.sav'))
  console.log('  columnInfo =', JSON.stringify(small.columnInfo))
  check('small.sav success', small.success === true, small.error)
  check('rows === 6（上游 readAllRows 只有 1 行）', small.rows.length === 6, small.rows.length)
  check('id/score/group = numeric, name = string',
    small.columnInfo.filter((c) => c.type === 'numeric').map((c) => c.name).join(',') === 'id,score,group',
    small.columnInfo.map((c) => `${c.name}:${c.type}`).join(','))
  check('score missing === 1', small.columnInfo.find((c) => c.name === 'score').missing === 1)
  check('truncated false / notice null', small.truncated === false && small.truncationNotice === null)
  check('meta.rowCount === 6', small.meta.rowCount === 6)

  const big = await call('data:parseSav', path.join(FIX, 'big.sav'))
  check('big.sav rows === 200000（上限生效）', big.rows.length === 200000, big.rows.length)
  check('big.sav truncated === true', big.truncated === true)
  check('big.sav totalRows === 300000', big.totalRows === 300000, big.totalRows)
  check('big.sav truncationNotice 面向 UI', typeof big.truncationNotice === 'string' && big.truncationNotice.includes('200,000'), big.truncationNotice)
  console.log('  truncationNotice =', big.truncationNotice)

  const outside = await call('data:parseSav', 'C:\\Windows\\System32\\drivers\\etc\\hosts.sav')
  check('可信目录之外被拒绝', outside.success === false && /不在允许范围内/.test(outside.error), outside.error)

  /* ── 2. r:detect ──────────────────────────────────────────── */
  section('handler r:detect — 惰性/自愈 R 路径（本机 Rscript 不在 PATH）')
  const det = await call('r:detect')
  console.log('  detect =', JSON.stringify(det))
  check('found === true', det.found === true)
  check('path = Program Files\\R\\R-4.6.0\\bin\\Rscript.exe', /R-4\.6\.0\\bin\\Rscript\.exe$/.test(det.path), det.path)
  check('version === 4.6.0', det.version === '4.6.0', det.version)

  /* ── 3. r:execute ─────────────────────────────────────────── */
  section('handler r:execute — 哨兵/部分输出/dataCsv 上限')
  const ok = await call('r:execute', 'cat("hello from R\\n"); cat(1 + 1)')
  check('成功脚本 success', ok.success === true, JSON.stringify(ok.errors))
  check('output 含 hello from R 与 2', ok.output.includes('hello from R') && ok.output.includes('2'), JSON.stringify(ok.output))
  const err = await call('r:execute', 'stop("boom")')
  check('错误脚本 success false', err.success === false)
  check('errors[0] === "boom"', err.errors[0] === 'boom', JSON.stringify(err.errors))
  const multi = await call('r:execute', 'f <- function() stop("line A\\nline B\\nline C"); f()')
  check('多行 R 报错完整保留（3 行，不再是首行）', multi.errors[0].replace(/\r\n/g, '\n') === 'line A\nline B\nline C', JSON.stringify(multi.errors))
  const partial = await call('r:execute', 'cat("PARTIAL-OUTPUT"); stop("after partial")')
  check('报错前的部分输出被保留', partial.output.includes('PARTIAL-OUTPUT'), JSON.stringify(partial.output))
  check('timedOut/truncated 字段存在且为 false', partial.timedOut === false && partial.truncated === false)
  const csvOk = await call('r:execute', 'cat(nrow(read.csv("data.csv")))', 'a,b\n1,2\n3,4\n')
  check('data.csv 写入并可读', csvOk.success === true && csvOk.output.includes('2'), JSON.stringify(csvOk.output) + ' errors=' + JSON.stringify(csvOk.errors))
  const bigCsv = 'x\n' + '1\n'.repeat(0)
  const overCsv = 'x\n' + '1\n'.repeat(1) + 'y'.repeat(65 * 1024 * 1024)
  const over = await call('r:execute', 'cat(1)', overCsv)
  check('dataCsv 超 64MB 被拒', over.success === false && /dataCsv 过大/.test(over.errors.join(' ')), over.errors[0])
  void bigCsv

  /* ── 4. r:plot：正式主题 / 备用主题 / 主题报错 ─────────────── */
  section('handler r:plot — 正式主题（process.resourcesPath 指向 src/main）')
  const realResources = process.resourcesPath
  console.log('  set resourcesPath ->', setResourcesPath(path.join(REPO, 'src', 'main')))
  const p1 = await call('r:plot', PLOT_CODE, 'group,score\n1,88\n2,92\n1,75\n2,60\n')
  console.log('  plot(official) =', JSON.stringify({ success: p1.success, error: p1.error, bytes: p1.base64 ? p1.base64.length : 0 }))
  check('正式主题：success true', p1.success === true, p1.error)
  check('正式主题：返回 base64', typeof p1.base64 === 'string' && p1.base64.length > 2000, p1.base64 ? p1.base64.length : 0)
  if (!p1.base64) {
    console.log("SKIP  PNG 像素检查——没有生成图片。若错误为 \"there is no package called 'ggplot2'\"，")
    console.log('      说明本机 R 缺少绘图依赖（绘图相关检查需要 ggplot2 / showtext）。')
  } else {
    const png1 = path.join(ARTIFACTS, 'out_official.png')
    fs.writeFileSync(png1, Buffer.from(p1.base64, 'base64'))
    const l1 = pngLumaStdDev(png1)
    console.log(`  正式主题 PNG ${l1.width}x${l1.height} 亮度标准差 = ${l1.stdDev.toFixed(2)}`)
    check('正式主题 PNG 非全白 (stdDev > 5)', l1.stdDev > 5, l1.stdDev.toFixed(2))
  }

  section('handler r:plot — 备用主题（process.resourcesPath 不可用 → themeWritten=false）')
  console.log('  set resourcesPath ->', JSON.stringify(setResourcesPath('')))
  const p2 = await call('r:plot', PLOT_CODE, 'group,score\n1,88\n2,92\n1,75\n2,60\n')
  console.log('  plot(fallback) =', JSON.stringify({ success: p2.success, error: p2.error, bytes: p2.base64 ? p2.base64.length : 0 }))
  check('备用主题：success true（旧备用主题因 save_plot(w,h) 形参不符必定失败）', p2.success === true, p2.error)
  if (!p2.base64) {
    console.log('SKIP  PNG 像素检查——没有生成图片（见上面的 R 错误；需要 ggplot2 / showtext）。')
  } else {
    const png2 = path.join(ARTIFACTS, 'out_fallback.png')
    fs.writeFileSync(png2, Buffer.from(p2.base64, 'base64'))
    const l2 = pngLumaStdDev(png2)
    console.log(`  备用主题 PNG ${l2.width}x${l2.height} 亮度标准差 = ${l2.stdDev.toFixed(2)}`)
    check('备用主题 PNG 非全白 (stdDev > 5)', l2.stdDev > 5, l2.stdDev.toFixed(2))
  }

  section('handler r:plot — 主题 source() 抛错必须被哨兵捕获（旧版 source 在 tryCatch 之外）')
  const badThemeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-badtheme-'))
  fs.mkdirSync(path.join(badThemeDir, 'rScripts'), { recursive: true })
  fs.writeFileSync(path.join(badThemeDir, 'rScripts', 'theme_academic.R'),
    'stop("font file not found for \'regular\' type")\n', 'utf-8')
  console.log('  set resourcesPath ->', setResourcesPath(badThemeDir))
  const p3 = await call('r:plot', PLOT_CODE, 'group,score\n1,88\n2,92\n')
  console.log('  plot(broken theme) =', JSON.stringify(p3))
  check('主题抛错 → success false', p3.success === false)
  check('主题抛错 → 错误文本含 font file not found', /font file not found/.test(p3.error || ''), p3.error)

  // A/B：证明 source() 在 tryCatch 之外会逃逸（旧行为），在内则被捕获（新行为）
  const abDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-ab-'))
  fs.writeFileSync(path.join(abDir, 'theme_academic.R'), 'stop("THEME-EXPLODED")\n', 'utf-8')
  const oldWrapper = `options(warn = 1)\nsetwd(${JSON.stringify(abDir)})\nsource("theme_academic.R")\ntryCatch({\ncat("never")\n}, error = function(e) { cat("__RWB_ERROR__:", conditionMessage(e), "\\n") })\ncat("\\n__RWB_DONE__\\n")\n`
  const newWrapper = `options(warn = 1)\nsetwd(${JSON.stringify(abDir)})\ntryCatch({\nsource("theme_academic.R")\ncat("never")\n}, error = function(e) { cat("__RWB_ERROR__:", conditionMessage(e), "\\n") })\ncat("\\n__RWB_DONE__\\n")\n`
  fs.writeFileSync(path.join(abDir, 'old.R'), oldWrapper, 'utf-8')
  fs.writeFileSync(path.join(abDir, 'new.R'), newWrapper, 'utf-8')
  const runR = (f) => { try { return { out: execFileSync(RSCRIPT, [f], { encoding: 'utf-8', cwd: abDir }), code: 0 } } catch (e) { return { out: String(e.stdout || ''), code: e.status } } }
  const oldRun = runR('old.R')
  const newRun = runR('new.R')
  console.log('  旧（source 在 tryCatch 外）: exit=' + oldRun.code + ' stdout=' + JSON.stringify(oldRun.out.slice(0, 60)))
  console.log('  新（source 在 tryCatch 内）: exit=' + newRun.code + ' stdout=' + JSON.stringify(newRun.out.slice(0, 80)))
  check('旧写法：无哨兵且非零退出（错误逃逸）', oldRun.code !== 0 && !oldRun.out.includes('__RWB_ERROR__'))
  check('新写法：捕获到哨兵', /__RWB_ERROR__:\s*THEME-EXPLODED/.test(newRun.out), JSON.stringify(newRun.out))
  setResourcesPath(realResources)

  /* ── 5. r:packages ────────────────────────────────────────── */
  section('handler r:packages — 临时目录 finally 清理')
  const pkgs = await call('r:packages', ['stats', 'definitelynotapkg12345'])
  check('只返回已安装包', JSON.stringify(pkgs.installed) === '["stats"]', JSON.stringify(pkgs.installed))
  const pkgTmpBefore = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('rwb-pkg-')).length
  await call('r:packages', ['!!!invalid!!!'])
  const pkgTmpAfter = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('rwb-pkg-')).length
  check('无 rwb-pkg-* 临时目录泄漏', pkgTmpAfter === 0 && pkgTmpBefore === 0, `before=${pkgTmpBefore} after=${pkgTmpAfter}`)

  /* ── 6. dialog:readFile 编码契约 ───────────────────────────── */
  section('handler dialog:readFile — T6：始终返回原始字节（GBK 不被破坏）')
  const gbk = Buffer.from('d0d5c3fb2cb7d6caFD0a', 'hex') // 「姓名,分数\n」的 GBK 字节
  const csvPath = path.join(userData, 'gbk-test.csv')
  fs.writeFileSync(csvPath, gbk)
  nextOpenFile = csvPath
  const rf = await call('dialog:readFile')
  nextOpenFile = null
  const got = Buffer.from(rf.buffer)
  console.log('  原字节 =', gbk.toString('hex'), ' handler 返回 =', got.toString('hex'))
  console.log('  旧行为 Buffer.toString("utf-8") =', JSON.stringify(gbk.toString('utf-8')))
  check('content === null（不再在主编解码）', rf.content === null)
  check('buffer 与原文件字节完全一致', got.equals(gbk))
  check('渲染侧 gb18030 解码正确', new TextDecoder('gb18030').decode(got) === '姓名,分数\n', JSON.stringify(new TextDecoder('gb18030').decode(got)))
  check('旧 utf-8 解码会损坏（复现 bug）', gbk.toString('utf-8').includes('\uFFFD'))
  check('ext === "csv"', rf.ext === 'csv')

  /* ── 7. config API Key 安全 ───────────────────────────────── */
  section('handler config:* — hasOwn / 白名单 / 解密失败不覆盖 / 0600')
  encryptionMode = 'working'
  const s1 = await call('config:saveApiKey', 'openai', 'sk-openai-123')
  const s2 = await call('config:saveApiKey', 'deepseek', 'sk-deepseek-456')
  check('saveApiKey 两次都成功', s1.success === true && s2.success === true, JSON.stringify([s1, s2]))
  check('loadApiKey openai 保留', (await call('config:loadApiKey', 'openai')) === 'sk-openai-123')
  check('loadApiKey deepseek 保留（未被覆盖）', (await call('config:loadApiKey', 'deepseek')) === 'sk-deepseek-456')
  check('loadApiKey("constructor") === null（原型成员被拒）', (await call('config:loadApiKey', 'constructor')) === null)
  check('loadApiKey("__proto__") === null', (await call('config:loadApiKey', '__proto__')) === null)
  check('loadApiKey("toString") === null', (await call('config:loadApiKey', 'toString')) === null)
  check('saveApiKey("constructor") 被拒', (await call('config:saveApiKey', 'constructor', 'x')).success === false)

  const cfgPath = path.join(userData, 'config.enc.json')
  const before = fs.readFileSync(cfgPath)
  const mode = fs.statSync(cfgPath).mode & 0o777
  console.log(`  配置文件模式位 = ${mode.toString(8)}（Windows/NTFS 忽略 POSIX mode；代码请求 0o600）`)
  encryptionMode = 'decrypt-fails'
  const sFail = await call('config:saveApiKey', 'openai', 'sk-new')
  const after = fs.readFileSync(cfgPath)
  check('解密失败时 saveApiKey 返回失败', sFail.success === false, sFail.error)
  check('解密失败时**未覆盖**配置文件', before.equals(after))
  encryptionMode = 'working'
  check('失败后原有 Key 仍在', (await call('config:loadApiKey', 'openai')) === 'sk-openai-123')

  // 明文回退：加密可用但文件是明文 JSON（老版本降级写入）→ 保留其它 provider
  fs.writeFileSync(cfgPath, JSON.stringify({ openai: 'sk-plain', legacy: 'sk-legacy' }), { mode: 0o600 })
  const sMix = await call('config:saveApiKey', 'deepseek', 'sk-d2')
  check('明文文件 + 加密可用：保存成功', sMix.success === true, sMix.error)
  check('明文文件：legacy provider 未被丢弃', (await call('config:loadApiKey', 'legacy')) === 'sk-legacy')
  // 加密不可用 + 文件是密钥环加密的（无法解密）：必须中止而不是丢掉其它 Key
  fs.writeFileSync(cfgPath, Buffer.concat([Buffer.from('RWBENC:'), Buffer.from('eyJvcGVuYWkiOiJ4In0=')]))
  encryptionMode = 'unavailable'
  const sLocked = await call('config:saveApiKey', 'openai', 'sk-plain2')
  check('加密不可用且文件不可解密：中止保存并给出可操作提示',
    sLocked.success === false && /避免覆盖其它服务商/.test(sLocked.error || ''), sLocked.error)
  // 加密不可用 + 明文文件：正常保存并带明文警告
  fs.writeFileSync(cfgPath, JSON.stringify({ legacy: 'sk-legacy' }), 'utf-8')
  const sPlain = await call('config:saveApiKey', 'openai', 'sk-plain2')
  check('加密不可用 + 明文文件：成功但带明文警告',
    sPlain.success === true && sPlain.encrypted === false && typeof sPlain.warning === 'string', JSON.stringify(sPlain))
  check('加密不可用时仍保留 legacy', (await call('config:loadApiKey', 'legacy')) === 'sk-legacy')
  encryptionMode = 'working'

  /* ── 8. fs:writeFile 危险扩展名 ───────────────────────────── */
  section('handler fs:writeFile — 危险扩展名阻断（写文件→openExternal 链条）')
  let batErr = null
  try { await call('fs:writeFile', path.join(os.tmpdir(), 'evil.bat'), '@echo off') } catch (e) { batErr = e.message }
  check('.bat 被拒绝', /不允许写入/.test(batErr || ''), batErr)
  let okWrite = null
  try { okWrite = await call('fs:writeFile', path.join(os.tmpdir(), 'ok-export.csv'), 'a,b\n1,2\n') } catch (e) { okWrite = 'THREW ' + e.message }
  check('.csv 允许写入', okWrite === true, okWrite)

  /* ── 9. officecli 检测与批量导出 ─────────────────────────── */
  section('handler officecli:* — 检测 + batch 真实导出')
  const ocl = await call('officecli:detect')
  console.log('  detect =', JSON.stringify(ocl))
  check('officecli found true', ocl.found === true, JSON.stringify(ocl.searched))
  check('检测到 resources/bin/officecli.exe', /resources\\bin\\officecli\.exe$/.test(ocl.path), ocl.path)
  const savePath = path.join(os.tmpdir(), 'rwb-verify-report.docx')
  const gen = await call('officecli:generateDocx', {
    title: '报告标题',
    savePath,
    tables: [
      { title: '表1', headers: ['变量', 'M', 'SD'], rows: [['成绩', '88.5', '12.3'], ['人数', '6', '-']], note: '注' },
      { title: '表2 参差行', headers: ['a', 'b'], rows: [['1'], ['1', '2', '3']] }
    ],
    interpretation: '第一行解读\n第二行解读'
  })
  console.log('  generateDocx =', JSON.stringify(gen))
  check('generateDocx success', gen.success === true, gen.error)
  check('processCount === 3（旧实现 226 次进程）', gen.processCount === 3, gen.processCount)
  check('docx 已写出且 > 5KB', fs.existsSync(savePath) && fs.statSync(savePath).size > 5000, fs.existsSync(savePath) ? fs.statSync(savePath).size : 'missing')
  const cli = path.join(REPO, 'resources', 'bin', 'officecli.exe')
  let valOut = ''
  try { valOut = execFileSync(cli, ['validate', savePath], { encoding: 'utf-8' }) } catch (e) { valOut = 'FAILED ' + String(e.stdout || e.message) }
  check('officecli validate 通过', /Validation passed/i.test(valOut), valOut.trim())
  const badGen = await call('officecli:generateDocx', { title: 't', tables: undefined, savePath })
  check('tables undefined 返回失败而非 TypeError', badGen.success === false && /tables 必须是数组/.test(badGen.error), badGen.error)

  console.log(`\n${failures === 0 ? '>>> ALL HANDLER CHECKS PASSED' : `>>> ${failures} HANDLER CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2) })
