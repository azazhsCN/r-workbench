/**
 * R Workbench 界面截图工具（v0.3.5）
 *
 * 做法：以 `--remote-debugging-port` 启动 Electron，用 CDP 驱动页面，
 * 通过 Page.captureScreenshot 截屏。不修改应用源码。
 *
 * 用法：node scripts/shots/capture.mjs [输出目录]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'docs', 'screenshots')
const PORT = 9333
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

fs.mkdirSync(OUT, { recursive: true })

/** 简单 CDP 客户端 */
class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
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

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

async function waitTargets(timeoutMs = 40000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`)
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('等待 CDP 目标超时')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const userData = path.join(ROOT, '_shot-userdata')
  fs.rmSync(userData, { recursive: true, force: true })

  console.log('[1/4] 启动 Electron …')
  // 注意：必须显式清掉 ELECTRON_RUN_AS_NODE（某些环境会设置它），
  // 否则 electron.exe 会以 Node 模式解析参数，报 "bad option: --remote-debugging-port"。
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(ELECTRON, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userData}`,
    '--no-sandbox',
    '.'
  ], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })

  let stdout = ''
  child.stdout.on('data', (d) => (stdout += d))
  child.stderr.on('data', (d) => (stdout += d))

  try {
    const target = await waitTargets()
    console.log('[2/4] CDP 已连接 …')

    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res)
      ws.addEventListener('error', rej)
    })
    const cdp = new CDP(ws)

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await sleep(2500)

    // 固定视口，保证截图为 1400x900（与 BrowserWindow 一致）
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1400, height: 900, deviceScaleFactor: 2, mobile: false
    })
    await sleep(800)

    async function shot(name) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
      const file = path.join(OUT, `${name}.png`)
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
      const kb = Math.round(fs.statSync(file).size / 1024)
      console.log(`    ✓ ${name}.png (${kb} KB)`)
    }

    async function click(selector) {
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return 'NOT_FOUND';
          el.click();
          return 'OK';
        })()`,
        returnByValue: true
      })
      await sleep(1200)
    }

    async function evalJs(expr) {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      return r.result?.value
    }

    console.log('[3/4] 逐页截图 …')

    // 首页（默认）
    await shot('01-welcome')

    // 先加载示例数据：智能推荐与向导的变量选择都依赖已有数据
    const loaded = await evalJs(`(() => {
      const el = Array.from(document.querySelectorAll('button, div[role=button], [class*=card]'))
        .find(e => /问卷|考试成绩|学习投入/.test(e.textContent) && e.textContent.length < 200);
      if (!el) return false;
      el.click();
      return true;
    })()`)
    console.log(`    加载示例数据: ${loaded ? 'OK' : '未找到'}`)
    await sleep(2500)

    // 用侧栏导航切页：读取 nav 项文本后点击
    const navs = await evalJs(`Array.from(document.querySelectorAll('nav button, aside button, .nav-item'))
      .map(b => b.textContent.trim()).filter(Boolean)`)
    console.log('    导航项:', JSON.stringify(navs))

    // 依次点击侧栏中的页面入口
    const pages = ['AI 对话分析', '向导式分析', '数据管理', '设置']
    const fileMap = {
      'AI 对话分析': '02-chat',
      '向导式分析': '03-wizard',
      '数据管理': '04-data',
      '设置': '05-settings'
    }
    for (const label of pages) {
      // 侧栏按钮文本带 emoji（如 "💬AI 对话分析"），故用 includes 匹配而非全等
      const ok = await evalJs(`(() => {
        const els = Array.from(document.querySelectorAll('button, a, div[role=button]'));
        const el = els.find(e => e.textContent.replace(/\\s/g,'').includes(${JSON.stringify(label.replace(/\s/g, ''))}));
        if (!el) return false;
        el.click();
        return true;
      })()`)
      if (!ok) { console.log(`    ! 未找到入口「${label}」`); continue }
      await sleep(1500)
      await shot(fileMap[label])

      // 向导页：额外截一张打开智能推荐面板的图（v0.3.5 核心功能）
      if (label === '向导式分析') {
        const opened = await evalJs(`(() => {
          const el = Array.from(document.querySelectorAll('button,a,div[role=button]'))
            .find(e => e.textContent.replace(/\\s/g,'').includes('智能推荐'));
          if (!el) return false;
          el.click();
          return true;
        })()`)
        if (opened) {
          await sleep(3200)
          await shot('06-recommend')
        }
      }
    }

    console.log('[4/4] 完成')
    ws.close()
  } catch (e) {
    console.error('失败:', e.message)
    console.error('--- electron 输出 ---')
    console.error(stdout.slice(-3000))
    process.exitCode = 1
  } finally {
    child.kill()
    await sleep(500)
    fs.rmSync(userData, { recursive: true, force: true })
    fs.rmSync(path.join(ROOT, '_shot-userdata'), { recursive: true, force: true })
  }
}

main()
