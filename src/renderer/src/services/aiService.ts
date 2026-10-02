/**
 * AI 对话服务
 * 通过 OpenAI 兼容接口与各 LLM 服务商交互
 * 支持 OpenAI / DeepSeek / 通义千问 / 自定义接口
 */

import i18n from '../i18n'

/** AI 配置 */
interface AIConfig {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
}

/** 对话消息 */
interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** AI 响应 */
interface AIResponse {
  content: string
  rCode?: string
  explanation?: string
  error?: string
}

/** 单次请求超时（毫秒）—— 连接挂起时不能永久锁死发送按钮 */
export const REQUEST_TIMEOUT_MS = 60_000

/** 取当前语言的文案（i18n 可能在初始化完成前被调用，故统一 String() 兜底） */
function tr(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, options))
}

/**
 * 语言感知的系统提示词。
 *
 * 旧实现把「始终用中文回复」硬编码在 Prompt 里：英文界面下用户用英文提问，
 * 模型仍被指令用中文回答。现在按当前界面语言取提示词。
 */
function systemPrompt(): string {
  return tr('ai.systemPrompt')
}

function dataContextMessage(dataContext: string): string {
  return tr('ai.dataContext', { context: dataContext })
}

/** 把响应体里的服务商错误消息解析出来（流式与非流式共用） */
async function parseErrorBody(response: Response): Promise<string> {
  const fallback = tr('ai.error.apiFailed', { status: response.status })
  const body = await response.text().catch(() => '')
  if (!body) return fallback
  try {
    const json = JSON.parse(body) as { error?: { message?: string }; message?: string }
    return json.error?.message || json.message || fallback
  } catch {
    return body.length > 300 ? `${fallback} — ${body.slice(0, 300)}` : `${fallback} — ${body}`
  }
}

interface RequestSignal {
  signal: AbortSignal
  cleanup: () => void
  /** 超时触发的 abort（用于区分用户点击"停止生成"） */
  didTimeOut: () => boolean
}

/**
 * 组合外部取消信号与 60 秒超时。
 *
 * 旧实现的流式请求没有任何 AbortSignal/超时：连接一旦挂起，
 * `isStreaming` 永远为 true，发送按钮永久禁用且无法取消。
 */
function createRequestSignal(external?: AbortSignal): RequestSignal {
  const controller = new AbortController()
  let timedOut = false
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  const onAbort = (): void => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onAbort, { once: true })
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    },
    didTimeOut: () => timedOut
  }
}

export class AIService {
  private config: AIConfig | null = null

  /** 加载配置 — 优先从主进程安全存储读取，回退到 localStorage */
  async loadConfig(): Promise<AIConfig | null> {
    const saved = localStorage.getItem('rworkbench_settings')
    if (saved) {
      try {
        const settings = JSON.parse(saved)
        const provider = settings.aiProvider || 'openai'
        const baseUrl = settings.aiBaseUrl
        const model = settings.aiModel

        if (!baseUrl || !model) return null

        // 优先从主进程安全存储读取 API Key（修复 #7）
        let apiKey = ''
        if (window.api?.config) {
          apiKey = (await window.api.config.loadApiKey(provider)) || ''
        }
        // 回退：从 localStorage 读取（兼容旧版）
        if (!apiKey && settings.aiApiKey) {
          apiKey = settings.aiApiKey
          // 迁移到安全存储
          if (window.api?.config) {
            await window.api.config.saveApiKey(provider, apiKey)
          }
          // S6: 迁移完成后从 localStorage 删除明文 key，避免永久残留。
          // 注意：`rest` 必须在这里解构出来，否则 delete 抛 ReferenceError，
          // 被下面的 catch 静默吞掉 → this.config 永不赋值 + 明文 key 永久残留。
          const { aiApiKey: migratedApiKey, ...rest } = settings as Record<string, unknown>
          if (migratedApiKey) {
            delete rest.aiApiKey
            localStorage.setItem('rworkbench_settings', JSON.stringify(rest))
          }
        }

        if (!apiKey) return null

        this.config = { provider, apiKey, baseUrl, model }
        return this.config
      } catch {
        // ignore
      }
    }
    return null
  }

  /** 检查是否已配置（同步检查缓存） */
  isConfigured(): boolean {
    return this.config !== null && this.config.apiKey !== ''
  }

  /** 获取当前配置 */
  async getConfig(): Promise<AIConfig | null> {
    if (!this.config) await this.loadConfig()
    return this.config
  }

  /** 发送对话请求 */
  async chat(
    messages: ChatMsg[],
    dataContext?: string
  ): Promise<AIResponse> {
    if (!this.isConfigured()) {
      return {
        content: '',
        error: tr('ai.error.needConfig')
      }
    }

    const config = this.config!

    // 构建完整消息列表
    const fullMessages: ChatMsg[] = [
      { role: 'system', content: systemPrompt() }
    ]

    // 添加数据上下文
    if (dataContext) {
      fullMessages.push({
        role: 'system',
        content: dataContextMessage(dataContext)
      })
    }

    fullMessages.push(...messages)

    const request = createRequestSignal()
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: fullMessages,
          temperature: 0.3,
          max_tokens: 4096
        }),
        signal: request.signal
      })

      if (!response.ok) {
        return { content: '', error: await parseErrorBody(response) }
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content || ''

      // 解析 R 代码块
      const rCodeMatch = content.match(/```r-execute\n([\s\S]*?)```/)
      const rCode = rCodeMatch ? rCodeMatch[1].trim() : undefined

      // 解释部分（排除代码块）
      const explanation = content
        .replace(/```r-execute\n[\s\S]*?```/g, '')
        .trim()

      return {
        content,
        rCode,
        explanation: explanation || undefined
      }
    } catch (error: unknown) {
      return {
        content: '',
        error: describeFetchError(error, request)
      }
    } finally {
      request.cleanup()
    }
  }

  /** 流式对话请求 */
  async *chatStream(
    messages: ChatMsg[],
    dataContext?: string,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    if (!this.isConfigured()) {
      yield `❌ ${tr('ai.error.needConfig')}`
      return
    }

    const config = this.config!
    const fullMessages: ChatMsg[] = [
      { role: 'system', content: systemPrompt() }
    ]

    if (dataContext) {
      fullMessages.push({
        role: 'system',
        content: dataContextMessage(dataContext)
      })
    }

    fullMessages.push(...messages)

    const request = createRequestSignal(signal)
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: fullMessages,
          temperature: 0.3,
          max_tokens: 4096,
          stream: true
        }),
        signal: request.signal
      })

      if (!response.ok) {
        // 复用非流式路径的错误体解析（旧实现只显示状态码）
        yield `❌ ${await parseErrorBody(response)}`
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        yield `❌ ${tr('ai.error.noStream')}`
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          // 宽容匹配：部分服务商返回 `data:{...}`（无空格）
          if (!trimmed || !/^data:\s?/.test(trimmed)) continue
          const data = trimmed.replace(/^data:\s?/, '')
          if (data === '[DONE]') return

          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta?.content
            if (delta) yield delta
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (error: unknown) {
      yield `❌ ${describeFetchError(error, request)}`
    } finally {
      request.cleanup()
    }
  }
}

/** 把 fetch 异常翻译成当前语言的说明（区分超时 / 用户取消 / 网络错误） */
function describeFetchError(error: unknown, request: RequestSignal): string {
  const err = error as { name?: string; message?: string }
  if (err?.name === 'AbortError') {
    return request.didTimeOut() ? tr('ai.error.timeout') : tr('ai.error.aborted')
  }
  return tr('ai.error.network', { message: err?.message || tr('ai.error.checkNetwork') })
}

/** 导出单例 */
export const aiService = new AIService()
