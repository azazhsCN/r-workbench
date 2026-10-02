/*
 * v0.2.6 task-3 verification harness — REAL .sav files, REAL officecli, REAL savImport.ts
 *
 * 持久化说明（engineer-gates）：本文件原为 mainprocess 的临时验证脚本，现入库到
 * scripts/validate/。与临时版的两点差别：
 *   1) 路径全部相对脚本自身（不再依赖 %TEMP%\rwb-verify-026）；
 *   2) 不再 require 一份提交在仓库里的编译产物：每次运行时用 esbuild 从
 *      src/main/savImport.ts 现打包（见 _bundle.cjs），因此验证的永远是当前源码。
 *
 * 前置条件：fixtures/{small,big}.sav（Rscript scripts/validate/gen_sav.R，需要 haven）。
 * 缺少时本脚本打印 SKIP 并以退出码 0 结束 —— 它是按需验收 harness，不进入 CI / npm test。
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = process.argv[2] || path.resolve(__dirname, '..', '..')
/** fixtures 目录：RWB_FIXTURES 可覆盖（便于测试 SKIP 路径，无需搬动脚本） */
const FIX = process.env.RWB_FIXTURES || path.join(__dirname, 'fixtures')

const HAS_FIXTURES = fs.existsSync(path.join(FIX, 'small.sav')) && fs.existsSync(path.join(FIX, 'big.sav'))
if (!HAS_FIXTURES) {
  console.log('SKIP  verify.cjs — 缺少真实 .sav fixtures:', FIX)
  console.log('      生成方式: Rscript scripts/validate/gen_sav.R   （需要 haven 包）')
  console.log('      未执行任何检查，退出码 0（本 harness 为按需验收，不进入 CI）')
  process.exit(0)
}

const { ensureBundle } = require('./_bundle.cjs')
const S = require(ensureBundle('src/main/savImport.ts', 'savImport.cjs'))
const { SavBufferReader } = require('sav-reader')

let failures = 0
function check(name, cond, detail) {
  const ok = !!cond
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  -> ${detail}` : ''}`)
}
function section(t) { console.log(`\n=== ${t} ===`) }

async function openSav(name) {
  const sav = new SavBufferReader(fs.readFileSync(path.join(FIX, name)))
  await sav.open()
  return sav
}

async function main() {
  /* ─────────────── T2: 类型映射 ─────────────── */
  section('T2 — SysVarType 映射 (sav-reader: numeric=0, string=1)')
  check('SAV_TYPE_NUMERIC === 0', S.SAV_TYPE_NUMERIC === 0, S.SAV_TYPE_NUMERIC)
  check('mapSavColumnType(0) === "numeric"', S.mapSavColumnType(0) === 'numeric', S.mapSavColumnType(0))
  check('mapSavColumnType(1) === "string"', S.mapSavColumnType(1) === 'string', S.mapSavColumnType(1))
  check('旧写法 0 === "numeric" 恒假（bug 本身）', (0 === 'numeric') === false)

  /* ─────────────── 上游 readNextRow 缺陷复现 ─────────────── */
  section('F3-c — sav-reader@2.0.8 上游 readNextRow() 缺陷复现')
  const upstream = await openSav('small.sav')
  const upstreamRows = []
  for (let i = 0; i < 50; i++) { const r = await upstream.readNextRow(); if (r === null) break; upstreamRows.push(r) }
  console.log(`  上游 SavBufferReader.readNextRow(): ${upstreamRows.length} 行（应为 6）; readAllRows(): ${(await (async () => { const s = await openSav('small.sav'); return s.readAllRows() })()).length} 行`)
  check('上游只有 1 行（缺陷已复现，非本环境问题）', upstreamRows.length === 1, upstreamRows.length)
  const upstreamBig = await openSav('big.sav')
  check('上游 big.sav readAllRows 也只有 1 行', (await upstreamBig.readAllRows()).length === 1,
    (await (async () => { const s = await openSav('big.sav'); return s.readAllRows() })()).length)

  /* ─────────────── 修正后：small.sav 全量比对 R ─────────────── */
  section('T2/T3 — 修正后的行读取: small.sav（与 R foreign::read.spss 逐值比对）')
  const sav = await openSav('small.sav')
  const headers = sav.meta.sysvars.map((v) => v.name)
  const info = S.computeColumnInfo(sav.meta.sysvars, (await S.readSavRowsIncremental(S.createSavRowReader(sav), headers, { maxRows: S.MAX_SAV_ROWS })).rows)
  const res = await (async () => { const s = await openSav('small.sav'); return S.readSavRowsIncremental(S.createSavRowReader(s), headers, { maxRows: S.MAX_SAV_ROWS, declaredRows: S.declaredCaseCount(s.meta) }) })()
  const rows = res.rows
  console.log('  columnInfo =', JSON.stringify(S.computeColumnInfo((await openSav('small.sav')).meta.sysvars, rows)))
  console.log('  row1 =', JSON.stringify(rows[0])); console.log('  row3 =', JSON.stringify(rows[2])); console.log('  row6 =', JSON.stringify(rows[5]))
  const expected = [
    { id: 1, score: 88.5, name: '张三', group: 1 },
    { id: 2, score: 92, name: '李四', group: 2 },
    { id: 3, score: '', name: '王五', group: 1 },
    { id: 4, score: 75.25, name: '赵六', group: 2 },
    { id: 5, score: 60, name: '钱七', group: 1 },
    { id: 6, score: 99, name: '孙八', group: 2 }
  ]
  check('rows === 6（上游是 1）', rows.length === 6, rows.length)
  check('truncated === false', res.truncated === false, res.truncated)
  check('6 行数值与 R foreign::read.spss 完全一致', JSON.stringify(rows) === JSON.stringify(expected), JSON.stringify(rows))
  check('id -> numeric', info.find((c) => c.name === 'id').type === 'numeric')
  check('score -> numeric', info.find((c) => c.name === 'score').type === 'numeric')
  check('name -> string', info.find((c) => c.name === 'name').type === 'string')
  check('group -> numeric', info.find((c) => c.name === 'group').type === 'numeric')
  check('数值列 === 3（旧实现 0）', info.filter((c) => c.type === 'numeric').length === 3)
  check('score 缺失数 === 1', info.find((c) => c.name === 'score').missing === 1, info.find((c) => c.name === 'score').missing)
  check('无 "null" 幽灵行', !JSON.stringify(rows).includes('"null"'))

  /* ─────────────── T3: big.sav 30 万行 ─────────────── */
  section('T3 — big.sav: 300,000 行，上限 200,000')
  const big = await openSav('big.sav')
  const bigHeaders = big.meta.sysvars.map((v) => v.name)
  const declared = S.declaredCaseCount(big.meta)
  const h0 = Math.round(process.memoryUsage().heapUsed / 1048576)
  const t0 = Date.now()
  const bigRes = await S.readSavRowsIncremental(S.createSavRowReader(big), bigHeaders, { maxRows: S.MAX_SAV_ROWS, declaredRows: declared })
  const msNew = Date.now() - t0
  const hNew = Math.round(process.memoryUsage().heapUsed / 1048576) - h0
  console.log(`  修正后: rows=${bigRes.rows.length} truncated=${bigRes.truncated} totalRows=${bigRes.totalRows} ${msNew}ms heapDelta=${hNew}MB`)
  check('rows === 200000', bigRes.rows.length === 200000, bigRes.rows.length)
  check('truncated === true', bigRes.truncated === true)
  check('totalRows === 300000 (header.n_cases)', bigRes.totalRows === 300000, bigRes.totalRows)
  const notice = S.buildTruncationNotice(bigRes, S.MAX_SAV_ROWS)
  console.log('  truncationNotice =', notice)
  check('截断提示含 300000 与 200,000', notice.includes('300000') && notice.includes('200,000'))
  // 前 5 行 / 末行抽样 (id 1..5, x 1.5,2.25,3.75,NA,1.5; y 10,20,30,10,20)
  console.log('  first3 =', JSON.stringify(bigRes.rows.slice(0, 3)), ' row200000 =', JSON.stringify(bigRes.rows[199999]))
  check('row1 = {id:1,x:1.5,y:10}', JSON.stringify(bigRes.rows[0]) === JSON.stringify({ id: 1, x: 1.5, y: 10 }), JSON.stringify(bigRes.rows[0]))
  check('row4 x 为缺失(空串)', bigRes.rows[3].x === '', JSON.stringify(bigRes.rows[3]))
  check('row200000 id=200000', bigRes.rows[199999].id === 200000, bigRes.rows[199999].id)

  /* ─────────────── T3: exact.sav 边界 ─────────────── */
  section('T3 — exact.sav: 恰好 200,000 行（不应报截断）')
  const exact = await openSav('exact.sav')
  const exR = await S.readSavRowsIncremental(S.createSavRowReader(exact), exact.meta.sysvars.map((v) => v.name), {
    maxRows: S.MAX_SAV_ROWS, declaredRows: S.declaredCaseCount(exact.meta)
  })
  console.log(`  rows=${exR.rows.length} truncated=${exR.truncated} totalRows=${exR.totalRows} lastRow=${JSON.stringify(exR.rows[exR.rows.length - 1])}`)
  check('rows === 200000', exR.rows.length === 200000, exR.rows.length)
  check('truncated === false', exR.truncated === false)
  check('totalRows === 200000', exR.totalRows === 200000, exR.totalRows)

  /* ─────────────── 假 reader（Vitest 契约） ─────────────── */
  section('T3 — 可注入 fake reader（Vitest 可直接复用）')
  let calls = 0
  const fake = { readNextRow: async () => (++calls <= 250000 ? { a: calls } : null) }
  const fakeRes = await S.readSavRowsIncremental(fake, ['a'], { maxRows: 200000 })
  check('fake: 200001 次调用（200000 + 1 次截断探测）', calls === 200001, calls)
  check('fake: truncated true', fakeRes.truncated === true)
  let c2 = 0
  const f2 = await S.readSavRowsIncremental({ readNextRow: async () => (++c2 <= 10 ? { a: c2 } : null) }, ['a'], { maxRows: 200000 })
  check('fake(10 行): rows10/false/10', f2.rows.length === 10 && f2.truncated === false && f2.totalRows === 10)
  let c3 = 0
  const f3 = await S.readSavRowsIncremental({ readNextRow: async () => (++c3 <= 250000 ? { a: c3 } : null) }, ['a'], { maxRows: 200000, declaredRows: 250000 })
  check('declaredRows>max: 不探测（200000 次）', c3 === 200000, c3)
  check('declaredRows>max: truncated true/total 250000', f3.truncated === true && f3.totalRows === 250000)

  /* ─────────────── R stdout 解析 ─────────────── */
  section('T12 — R 错误哨兵跨行解析')
  const stdout = 'plot output\n__RWB_ERROR__:line1 of error\nline2 of error\nline3\n\n__RWB_DONE__\n'
  const parsed = S.parseRScriptStdout(stdout)
  const oldMatch = stdout.match(/__RWB_ERROR__:(.*)/)
  console.log('  旧正则 =', JSON.stringify(oldMatch[1]), ' 新解析 =', JSON.stringify(parsed.errors))
  check('旧正则只拿到首行（复现）', oldMatch[1] === 'line1 of error')
  check('新解析保留 3 行', parsed.errors[0] === 'line1 of error\nline2 of error\nline3')
  check('output 去掉哨兵', parsed.output === 'plot output', JSON.stringify(parsed.output))
  check('completed true', parsed.completed === true)
  const killed = S.parseRScriptStdout('partial re')
  check('kill 时 completed false 且保留部分输出', killed.completed === false && killed.output === 'partial re')

  /* ─────────────── Word 导出校验/构造 ─────────────── */
  section('T12 — validateDocxPayload / buildDocxBatchCommands')
  let threw = null
  try { S.validateDocxPayload({ title: 't', tables: undefined, savePath: 'x.docx' }) } catch (e) { threw = e.message }
  check('tables: undefined 抛清晰错误', threw === '无效参数：tables 必须是数组', threw)
  const ragged = S.validateDocxPayload({ title: 'rag', savePath: 'x.docx', tables: [{ title: 'T1', headers: ['a', 'b'], rows: [['1'], ['1', '2', '3']], note: 'n' }] })
  check('ragged: cols=3', ragged.tables[0].cols === 3, ragged.tables[0].cols)
  const cmds = S.buildDocxBatchCommands(ragged)
  const maxTc = Math.max(...cmds.filter((c) => typeof c.path === 'string').map((c) => { const m = /tc\[(\d+)\]/.exec(c.path); return m ? Number(m[1]) : 0 }))
  check('最大 tc 索引 <= cols=3', maxTc <= 3, maxTc)
  threw = null
  try { S.validateDocxPayload({ title: 't', savePath: 'x.docx', tables: new Array(51).fill({ headers: ['a'], rows: [['1']] }) }) } catch (e) { threw = e.message }
  check('表格数量超限被拒', /表格数量超限/.test(threw || ''), threw)
  const plan = S.planDocxExport(S.validateDocxPayload({
    title: '报告', savePath: 'x.docx',
    tables: [{ title: 'desc', headers: Array.from({ length: 10 }, (_, i) => `col${i}`), rows: Array.from({ length: 20 }, (_, r) => Array.from({ length: 10 }, (_, c) => `r${r}c${c}`)) }],
    interpretation: 'a\nb'
  }))
  console.log(`  20x10: batch 命令=${plan.commandCount} 子进程=${plan.processCount}（旧实现 226）`)
  check('20x10 = 3 个子进程', plan.processCount === 3)

  /* ─────────────── officecli 真实端到端 ─────────────── */
  section('T12 — officecli batch 真实端到端')
  const cli = path.join(ROOT, 'resources', 'bin', 'officecli.exe')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rwb-verify-docx-'))
  const docx = path.join(work, 'report.docx')
  const cmdsPath = path.join(work, 'commands.json')
  const payload = S.validateDocxPayload({
    title: '回归验证报告 "引号" 与 \\ 反斜杠', savePath: 'u.docx',
    tables: [{ title: '表1 三线表', headers: ['变量', 'M', 'SD', '带"引号"', '反斜杠\\x'],
      rows: [['成绩', '88.50', '12.34', 'a"b', 'c\\d'], ['人数', '6', '-', '中文', '换\n行'], ['短行', '1']], note: '注：p < .001' }],
    interpretation: '解读第一行\n解读第二行'
  })
  fs.writeFileSync(cmdsPath, JSON.stringify(S.planDocxExport(payload).commands), 'utf-8')
  let procCount = 0
  const run = (a) => { procCount++; return execFileSync(cli, a, { encoding: 'utf-8' }) }
  let batchOut = ''
  try { run(['create', docx]); batchOut = run(['batch', docx, '--input', cmdsPath, '--json', '--stop-on-error']); run(['close', docx]) } catch (e) { console.log('  officecli error', e.stdout, e.stderr) }
  const env = S.parseOfficecliEnvelope(batchOut)
  check('batch 成功', env.success === true, env.error)
  check('子进程 = 3（旧实现 226）', procCount === 3, procCount)
  check('docx 生成 > 5KB', fs.existsSync(docx) && fs.statSync(docx).size > 5000, fs.existsSync(docx) ? fs.statSync(docx).size : 'missing')
  const get = (p) => { try { return JSON.parse(execFileSync(cli, ['get', docx, p, '--json'], { encoding: 'utf-8' })) } catch (e) { return { _err: String(e.stdout || e.message) } } }
  const cellText = (p) => { const r = get(p); return r && r.data && r.data.results && r.data.results[0] ? r.data.results[0].text : null }
  console.log('  tr[1]/tc[1]=', JSON.stringify(cellText('/body/tbl[1]/tr[1]/tc[1]')), ' tc[4]=', JSON.stringify(cellText('/body/tbl[1]/tr[1]/tc[4]')))
  console.log('  tr[2]/tc[5] (反斜杠)=', JSON.stringify(cellText('/body/tbl[1]/tr[2]/tc[5]')), ' tr[3]/tc[4] (参差行补空)=', JSON.stringify(cellText('/body/tbl[1]/tr[3]/tc[4]')))
  check('表头 tc[1] === "变量"', cellText('/body/tbl[1]/tr[1]/tc[1]') === '变量', cellText('/body/tbl[1]/tr[1]/tc[1]'))
  check('表头含引号原样写入', cellText('/body/tbl[1]/tr[1]/tc[4]') === '带"引号"', cellText('/body/tbl[1]/tr[1]/tc[4]'))
  check('反斜杠原样写入', cellText('/body/tbl[1]/tr[2]/tc[5]') === 'c\\d', cellText('/body/tbl[1]/tr[2]/tc[5]'))
  check('参差行 tc[4] 有效（旧实现越界 exit 1）', cellText('/body/tbl[1]/tr[3]/tc[4]') === '中文', cellText('/body/tbl[1]/tr[3]/tc[4]'))
  let valOut = ''
  try { valOut = execFileSync(cli, ['validate', docx], { encoding: 'utf-8' }) } catch (e) { valOut = 'FAILED ' + String(e.stdout || e.message) }
  check('officecli validate 通过', /Validation passed/i.test(valOut), valOut.trim())
  try { run(['close', docx]) } catch {}
  try { fs.rmSync(work, { recursive: true, force: true }) } catch {}

  /* ─────────────── R 路径探测（T12 detectedRPath 修复） ─────────────── */
  section('T12 — R 版本排序 / Rscript 不在 PATH 的事实')
  const vers = ['R-4.6.0', 'R-4.10.0', 'R-4.9.1', 'R-3.6.3']
  const sorted = [...vers].sort(S.compareRVersionDesc)
  console.log('  数值排序 =', sorted.join(' > '))
  check('数值降序 (4.10.0 优先)', sorted[0] === 'R-4.10.0' && sorted[1] === 'R-4.9.1', sorted.join(','))
  const lex = [...vers].sort().reverse()
  check('旧字典序会把 R-4.6.0 排在 R-4.10.0 前面（bug 复现）', lex[0] === 'R-4.9.1' && lex.indexOf('R-4.6.0') < lex.indexOf('R-4.10.0'), lex.join(','))
  check('compareRVersionDesc 对 --version 字符串也适用', S.compareRVersionDesc('4.10.0', '4.6.0') < 0)
  let rscriptOnPath = true
  try { execFileSync('where', ['Rscript'], { encoding: 'utf-8' }) } catch { rscriptOnPath = false }
  console.log('  Rscript 在 PATH 上 =', rscriptOnPath)
  check('Rscript 不在 PATH（旧 detectedRPath 默认值必然失败）', rscriptOnPath === false)
  const rExe = 'C:\\Program Files\\R\\R-4.6.0\\bin\\Rscript.exe'
  check('Program Files 扫描候选存在', fs.existsSync(rExe), rExe)
  const rVersionOut = execFileSync(rExe, ['--version'], { encoding: 'utf-8' })
  const m = (rVersionOut + '').match(/version (\d+\.\d+\.\d+)/)
  console.log('  --version 输出 =', JSON.stringify(rVersionOut.trim()), '→ 正则捕获 =', m && m[1])
  check('--version 正则捕获 4.6.0', !!m && m[1] === '4.6.0', m && m[1])
  let rErr = null
  try { execFileSync('Rscript', ['--version'], { encoding: 'utf-8' }) } catch (e) { rErr = e.code || e.message }
  check('直接 spawn "Rscript" 失败（旧实现在本机的实际后果）', rErr !== null, String(rErr).slice(0, 60))

  /* ─────────────── 主菜单 i18n 键对齐 ─────────────── */
  section('T12 — 主菜单 i18n：mt() 键与 renderer locale 的 menu.* 对齐')
  const idxSrc = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf-8')
  const usedKeys = [...new Set([...idxSrc.matchAll(/mt\('([A-Za-z]+)'\)/g)].map((m) => m[1]))].sort()
  const zhLoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/src/i18n/locales/zh-CN.json'), 'utf-8'))
  const enLoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/src/i18n/locales/en-US.json'), 'utf-8'))
  const zhMenuKeys = Object.keys(zhLoc.menu).sort()
  const enMenuKeys = Object.keys(enLoc.menu).sort()
  console.log(`  index.ts 使用 ${usedKeys.length} 个键; zh-CN locale 有 ${zhMenuKeys.length} 个; en-US ${enMenuKeys.length} 个`)
  const missingZh = usedKeys.filter((k) => !(k in zhLoc.menu))
  const missingEn = usedKeys.filter((k) => !(k in enLoc.menu))
  check('全部 mt() 键都存在于 zh-CN.json', missingZh.length === 0, missingZh.join(','))
  check('全部 mt() 键都存在于 en-US.json', missingEn.length === 0, missingEn.join(','))
  check('zh-CN 与 en-US 的 menu 键集合一致', JSON.stringify(zhMenuKeys) === JSON.stringify(enMenuKeys))
  check('MENU_LABELS 内 zh/en 键集合一致', (() => {
    const block = idxSrc.slice(idxSrc.indexOf('const MENU_LABELS'), idxSrc.indexOf('let menuLanguage'))
    const groups = [...block.matchAll(/'zh-CN':\s*\{([\s\S]*?)\n  \},\n  'en-US':\s*\{([\s\S]*?)\n  \}/g)]
    if (groups.length !== 1) return false
    const keys = (s) => [...s.matchAll(/^\s*([A-Za-z]+):/gm)].map((m) => m[1]).sort()
    return JSON.stringify(keys(groups[0][1])) === JSON.stringify(keys(groups[0][2]))
  })())

  console.log(`\n${failures === 0 ? '>>> ALL CHECKS PASSED' : `>>> ${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2) })
