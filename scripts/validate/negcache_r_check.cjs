/*
 * T12 acceptance isolation #2: R-detection negative cache + manual-refresh escape hatch.
 *
 * getRPath() memoizes detection and, when detection FAILS, does not re-scan for 30 s
 * (R_NEGATIVE_CACHE_MS). This harness observes that behaviour deterministically by spying on
 * child_process.execFile (a failed detection costs a bounded number of spawns), so no 30-second
 * sleep is needed.
 *
 * It also proves the documented escape hatch: after the user installs R, the SettingsPage
 * "重新检测" button (r:detect) forces a fresh scan and execution starts working again. If this
 * machine genuinely has no R, the heal half prints SKIP instead of failing — never a false red.
 *
 * 持久化（engineer-gates）：原为 mainprocess 的临时脚本，现入库到 scripts/validate/。
 *   - 路径相对脚本自身；
 *   - ipc.ts 每次运行用 esbuild 现打包（_bundle.cjs），不提交编译产物（且必须在打补丁前完成，
 *     否则 esbuild 自己的子进程会被下面的 child_process spy 记录/干扰）。
 * 本 harness 不进入 npm test / ci.yml。
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

/* ── 先打包（esbuild 自己会 spawn 子进程，必须在 spy 安装前完成）────────── */
const { ensureBundle } = require('./_bundle.cjs')
const BUNDLE = ensureBundle('src/main/ipc.ts', 'ipc.cjs')
const REPO = path.resolve(__dirname, '..', '..')

const Module = require('module')

let failures = 0
const check = (n, c, d) => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? `  -> ${d}` : ''}`) }
const info = (m) => console.log(`INFO  ${m}`)

/* ── spy on child_process.execFile ───────────────────────────── */
/*
 * ⚠ TRAP（必须遵守，否则得到**假阴性**）：
 * `child_process.execFile` 携带 `util.promisify.custom`，正是它让 `promisify(execFile)` 解析为
 * `{ stdout, stderr }`。朴素包装会丢掉这个 symbol：
 *     const stub = Object.create(cp)
 *     stub.execFile = (...a) => { count(a[0]); return cp.execFile(...a) }   // ✗
 * 于是 promisify 走通用回调路径，解析结果变成**第一个回调参数（stdout 字符串）**，
 * `const { stdout } = await execFileAsync(...)` 得到 undefined → 探测全部“失败”
 * → 在 R 装得好好的机器上 r:detect 报 found:false。回调 API 与 custom-promise API 都要包装。
 */
const realChildProcess = require('child_process')
const { promisify } = require('util')
const spawns = []
const record = (file, args) => spawns.push({ file: String(file), args: Array.isArray(args) ? args.slice(0, 2) : [] })
const childProcessStub = Object.create(realChildProcess)
childProcessStub.execFile = function (...args) {
  record(args[0], args[1])
  return realChildProcess.execFile(...args)
}
childProcessStub.execFile[promisify.custom] = function (file, args, options) {
  record(file, args)
  return realChildProcess.execFile[promisify.custom](file, args, options)
}

/* ── stub electron ───────────────────────────────────────────── */
const handlers = new Map()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-negcache-userdata-'))
const electronStub = {
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
  app: {
    getPath: (n) => ({ userData, temp: os.tmpdir(), documents: userData, desktop: userData, downloads: userData }[n] || os.tmpdir()),
    getAppPath: () => REPO,
    getVersion: () => '0.2.6-test'
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
  clipboard: { write: () => undefined }
}
const origLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') return electronStub
  if (request === 'child_process') return childProcessStub
  return origLoad.apply(this, arguments)
}

/* ── environment: pretend R is not installed anywhere ────────── */
const fakeProgramFiles = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-noR-'))
const savedEnv = {
  ProgramFiles: process.env.ProgramFiles,
  'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  R_HOME: process.env.R_HOME,
  RWB_RSCRIPT: process.env.RWB_RSCRIPT
}
process.env.ProgramFiles = fakeProgramFiles
process.env['ProgramFiles(x86)'] = fakeProgramFiles
process.env.LOCALAPPDATA = fakeProgramFiles
delete process.env.R_HOME
delete process.env.RWB_RSCRIPT

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

const ipc = require(BUNDLE)
ipc.registerIpcHandlers()
const call = (ch, ...a) => handlers.get(ch)({}, ...a)
const detectionSpawns = () => spawns.filter((s) => s.file === 'Rscript' || /Rscript\.exe$/i.test(s.file)).length

async function main() {
  /* 1. first execute with R "absent" → exactly one detection probe */
  const before1 = spawns.length
  const e1 = await call('r:execute', 'cat(1)')
  const probes1 = spawns.length - before1
  info(`first r:execute: success=${e1.success} errors=${JSON.stringify(e1.errors)} spawns=${probes1} ${JSON.stringify(spawns.slice(before1).map((s) => s.file))}`)
  check('R absent → execute fails with the actionable message', e1.success === false && /未检测到可用的 R 安装|R_HOME|RWB_RSCRIPT/.test((e1.errors || []).join(' ')), e1.errors && e1.errors[0])
  check('detection probed exactly twice (--version + -e fallback on the bare Rscript)', probes1 === 2, probes1)

  /* 2. immediate second execute → negative cache, ZERO extra spawns */
  const before2 = spawns.length
  const e2 = await call('r:execute', 'cat(1)')
  const probes2 = spawns.length - before2
  check('second execute does NOT re-scan (negative cache holds)', probes2 === 0, `${probes2} spawns`)
  check('same failure surfaced (no silent PATH fallback)', e2.success === false)

  /* 3. r:detect forces a fresh scan even inside the cache window */
  const before3 = spawns.length
  const d1 = await call('r:detect')
  const probes3 = spawns.length - before3
  info(`r:detect (R still absent): ${JSON.stringify({ found: d1.found, searched: d1.searched })} spawns=${probes3}`)
  check('r:detect bypasses the negative cache (fresh scan)', probes3 >= 1, probes3)
  check('r:detect reports found:false with searched candidates', d1.found === false && Array.isArray(d1.searched), JSON.stringify(d1.searched))

  /* 4. user "installs R" → r:detect (the SettingsPage button) heals it */
  restoreEnv()
  const before4 = spawns.length
  const d2 = await call('r:detect')
  info(`r:detect (R present): ${JSON.stringify({ found: d2.found, version: d2.version, path: d2.path })} spawns=${spawns.length - before4}`)

  if (!d2.found) {
    // 本机确实没装 R：前面的缓存行为仍然被验证了，但"恢复"部分无从验证 → SKIP，绝不误判为红。
    info('SKIP  恢复部分——本机未安装 R（r:detect 仍为 found:false），无法验证手动重新检测后的自愈。')
    console.log(`\n>>> R-DETECTION NEGATIVE-CACHE CHECKS PASSED (缓存部分；自愈部分 SKIP)`)
    process.exit(failures === 0 ? 0 : 1)
  }
  check('after env fix, r:detect finds the real R', d2.found === true && /^\d+\.\d+\.\d+$/.test(d2.version || ''), `${d2.path} ${d2.version}`)

  /* 5. execute now works, and detection is memoized (no further probes) */
  const before5 = spawns.length
  const e5 = await call('r:execute', 'cat("healed")')
  const after5 = spawns.length - before5
  check('execute works again after the manual re-detect', e5.success === true && /healed/.test(e5.output || ''), JSON.stringify(e5.errors))
  check('exactly one spawn (= the R script itself), no re-detection', after5 === 1, `${after5} spawns`)

  const totalProbes = detectionSpawns()
  info(`total Rscript-ish spawns during the whole run: ${totalProbes}; all spawns: ${JSON.stringify(spawns.map((s) => s.file))}`)
  check('detection never fell back to a PATH-relative "Rscript" for execution', !spawns.some((s) => s.file === 'Rscript' && s.args[0] !== '--version' && s.args[0] !== '-e'), 'execution always used an absolute path')

  console.log(`\n${failures === 0 ? '>>> R-DETECTION NEGATIVE-CACHE CHECKS PASSED' : `>>> ${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2) })
