/**
 * 交互式验证脚本：点击智能推荐、查看推荐结果、验证跳转预选
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, '_shots_test')
const PORT = 9334
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
fs.mkdirSync(OUT, { recursive: true })

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}
const getJSON = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) }).on('error', reject)
})
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function waitTargets(timeoutMs = 40000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`)
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch { }
    await sleep(500)
  }
  throw new Error('等待 CDP 超时')
}

async function main() {
  const userData = path.join(ROOT, '_shot-userdata2')
  fs.rmSync(userData, { recursive: true, force: true })
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(ELECTRON, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--no-sandbox', '.'],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', d => log += d)
  child.stderr.on('data', d => log += d)

  try {
    const target = await waitTargets()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
    const cdp = new CDP(ws)
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable')
    await sleep(2500)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false })
    await sleep(800)

    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
      return r.result?.value
    }
    const shot = async (name) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
      console.log(`    ✓ ${name}.png`)
    }

    // 1. 加载示例数据
    await ev(`(() => { const el = Array.from(document.querySelectorAll('button,div[role=button],[class*=card]')).find(e => /问卷|考试成绩|学习投入/.test(e.textContent) && e.textContent.length < 200); if (el) el.click(); return !!el })()`)
    await sleep(2500)
    console.log('步骤1: 示例数据已加载')

    // 2. 进入向导
    await ev(`(() => { const el = Array.from(document.querySelectorAll('button,a,div[role=button]')).find(e => e.textContent.replace(/\\s/g,'').includes('向导式分析')); if (el) el.click(); return !!el })()`)
    await sleep(1500)

    // 3. 点击智能推荐
    const clicked = await ev(`(() => { const el = Array.from(document.querySelectorAll('button,a,div[role=button]')).find(e => e.textContent.replace(/\\s/g,'').includes('智能推荐')); if (!el) return false; el.click(); return true })()`)
    console.log('步骤2: 点击智能推荐 =', clicked)
    await sleep(3500)
    await shot('06-recommend-clicked')

    // 4. 读取推荐结果 DOM
    const summary = await ev(`(() => {
      const body = document.body.innerText;
      return body.slice(0, 4000);
    })()`)
    console.log('\n=== 推荐面板文字 ===')
    console.log(summary?.slice(0, 1800) ?? '(空)')

    const errs = log.split('\n').filter(l => /error|Error|错误|未捕获/.test(l)).slice(0, 5)
    if (errs.length) { console.log('\n=== 控制台错误 ==='); console.log(errs.join('\n')) }

    ws.close()
  } catch (e) {
    console.error('失败:', e.message, '\n--- log ---\n', log.slice(-2000))
    process.exitCode = 1
  } finally {
    child.kill(); await sleep(500)
    fs.rmSync(userData, { recursive: true, force: true })
  }
}
main()
