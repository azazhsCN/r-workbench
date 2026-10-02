/*
 * T12 acceptance isolation: `r:execute` must work BEFORE any `r:detect` call.
 *
 * 旧代码 `let detectedRPath = 'Rscript'` 会直接 spawn PATH 上的 "Rscript"（本机 ENOENT），
 * 而所有其他 harness 都先调 r:detect 再 r:execute，因此这个失效模式从未被真正断言。
 * 本 harness 用**全新的 handler registry**，让 r:execute 成为第一个 IPC 调用。
 *
 * 持久化（engineer-gates）：原为 mainprocess 的临时脚本，现入库到 scripts/validate/。
 *   - 路径相对脚本自身；
 *   - ipc.ts 每次运行用 esbuild 现打包（_bundle.cjs），不提交编译产物。
 * 前置条件：R（本机 R 4.6.0）；最后一项 r:plot 另需 ggplot2。
 * 本 harness 不进入 npm test / ci.yml，缺失前置条件时按需 SKIP（退出码 0）。
 */
const Module = require('module')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = process.argv[2] || path.resolve(__dirname, '..', '..')

const { ensureBundle } = require('./_bundle.cjs')
const BUNDLE = ensureBundle('src/main/ipc.ts', 'ipc.cjs')

let failures = 0
const check = (n, c, d) => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? `  -> ${d}` : ''}`) }
const info = (msg) => console.log(`INFO  ${msg}`)

const handlers = new Map()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-lazy-userdata-'))
const electronStub = {
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
  app: {
    getPath: (n) => ({ userData, temp: os.tmpdir(), documents: REPO, desktop: REPO, downloads: REPO }[n] || os.tmpdir()),
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
  return origLoad.apply(this, arguments)
}

const ipc = require(BUNDLE)
ipc.registerIpcHandlers()
const call = (ch, ...a) => handlers.get(ch)({}, ...a)

async function main() {
  // 1) 环境前提：Rscript 不在 PATH 上时，旧默认值必然 ENOENT（本机成立 → 该断言有判别力）。
  //    若某台机器 Rscript 恰好在 PATH 上，旧 bug 不会显现，此处记为 INFO 而不误报红。
  let onPath = true
  try { execFileSync('where', ['Rscript'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { onPath = false }
  if (onPath === false) {
    check('precondition: Rscript NOT on PATH (old default would ENOENT)', true)
  } else {
    info('Rscript 在 PATH 上：旧 PATH 回退在本机不会失败，因此该前置条件的判别力不可用（不计入断言）')
  }

  // 2) 第一个 IPC 调用就是 r:execute —— 之前没有任何 r:detect
  const first = await call('r:execute', 'cat(R.version.string)')
  console.log('  first-ever r:execute =', JSON.stringify({ success: first.success, output: first.output, errors: first.errors }))
  check('r:execute succeeds with NO prior r:detect', first.success === true, JSON.stringify(first.errors))
  check('output shows the real R install (4.6.0), not a PATH fallback', /R version 4\.6\.0/.test(first.output || ''), JSON.stringify(first.output))

  // 3) 第二次 execute 复用已记忆的路径（不重新探测，仍可用）
  const second = await call('r:execute', 'cat("second-ok")')
  check('second r:execute still works (memoized path)', second.success === true && /second-ok/.test(second.output), JSON.stringify(second.errors))

  // 4) 之后再 r:detect 必须一致，并给出候选路径（可诊断性）
  const det = await call('r:detect')
  check('r:detect found + version 4.6.0', det.found === true && det.version === '4.6.0', JSON.stringify(det.path))
  check('r:detect reports searched candidates (diagnosability)', Array.isArray(det.searched) && det.searched.length > 0, (det.searched || []).length)

  // 5) r:plot 走同一个惰性解析器（需要 ggplot2）
  const plot = await call('r:plot', 'p <- ggplot2::ggplot(data.frame(x = 1:3, y = 1:3), ggplot2::aes(x, y)) + ggplot2::geom_point(); save_plot(p, "lazy_plot.png", width = 4, height = 3)')
  check('r:plot succeeds (same lazy resolver)', plot.success === true && typeof plot.base64 === 'string' && plot.base64.length > 1000,
    plot.error || (plot.base64 ? plot.base64.length + ' bytes' : 'no base64'))

  console.log(`\n${failures === 0 ? '>>> LAZY R-RESOLUTION CHECKS PASSED' : `>>> ${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2) })
