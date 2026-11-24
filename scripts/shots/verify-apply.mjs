/**
 * 验证「点推荐 → 跳转并预选」闭环（T73 验收硬指标）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, '_shots_test')
const PORT = 9335
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
fs.mkdirSync(OUT, { recursive: true })

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result) } }) }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })) }) }
}
const getJSON = url => new Promise((res, rej) => { http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitTargets(t = 40000) { const s = Date.now(); while (Date.now() - s < t) { try { const l = await getJSON(`http://127.0.0.1:${PORT}/json/list`); const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); if (p) return p } catch { } await sleep(500) } throw new Error('CDP 超时') }

async function main() {
  const userData = path.join(ROOT, '_shot-userdata3')
  fs.rmSync(userData, { recursive: true, force: true })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(ELECTRON, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--no-sandbox', '.'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d)

  try {
    const target = await waitTargets()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
    const cdp = new CDP(ws)
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable')
    await sleep(2500)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false })
    await sleep(800)

    const ev = async e => { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value }
    const shot = async n => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }); fs.writeFileSync(path.join(OUT, `${n}.png`), Buffer.from(data, 'base64')); console.log(`    ✓ ${n}.png`) }

    await ev(`(() => { const el = Array.from(document.querySelectorAll('button,div[role=button],[class*=card]')).find(e => /问卷|考试成绩|学习投入/.test(e.textContent) && e.textContent.length < 200); if (el) el.click(); return !!el })()`)
    await sleep(2500)
    await ev(`(() => { const el = Array.from(document.querySelectorAll('button,a,div[role=button]')).find(e => e.textContent.replace(/\\s/g,'').includes('向导式分析')); if (el) el.click(); return !!el })()`)
    await sleep(1500)
    await ev(`(() => { const el = Array.from(document.querySelectorAll('button,a,div[role=button]')).find(e => e.textContent.replace(/\\s/g,'').includes('智能推荐')); if (el) el.click(); return !!el })()`)
    await sleep(3000)
    console.log('步骤: 推荐面板已打开')

    // 点第 1 个「用这个方法分析 →」
    const clicked = await ev(`(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('用这个方法分析'));
      if (!btns.length) return 'NO_BUTTON';
      btns[0].click();
      return 'OK:' + btns.length;
    })()`)
    console.log('步骤: 点击『用这个方法分析』=', clicked)
    await sleep(2500)
    await shot('07-after-apply')

    // 检查是否切到 configure 步骤且方法已被选中
    const state = await ev(`(() => {
      const t = document.body.innerText;
      return {
        hasStep2: /第 ?2|步骤 ?2|配置|选择变量/.test(t),
        text: t.slice(0, 1200)
      };
    })()`)
    console.log('\n=== 点击后页面状态 ===')
    console.log(state?.text?.slice(0, 900) ?? '(空)')

    ws.close()
  } catch (e) { console.error('失败:', e.message, '\n', log.slice(-1500)); process.exitCode = 1 }
  finally { child.kill(); await sleep(500); fs.rmSync(userData, { recursive: true, force: true }) }
}
main()
