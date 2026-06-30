/**
 * AI 对话服务
 * 通过 OpenAI 兼容接口与各 LLM 服务商交互
 * 支持 OpenAI / DeepSeek / 通义千问 / 自定义接口
 */

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

/** 系统提示词 */
const SYSTEM_PROMPT = `你是 R Workbench 的 AI 数据分析助手。你的任务是帮助用户使用 R 语言进行统计分析。

## 你的能力

1. **理解用户需求**：用户会用自然语言描述分析需求，你需要理解并转化为 R 代码
2. **生成 R 代码**：编写正确、高效的 R 代码来完成分析
3. **解读结果**：用通俗易懂的中文解释统计结果

## 输出格式

当需要执行 R 代码时，请使用以下格式：

\`\`\`r-execute
# R 代码
\`\`\`

当只需解释概念时，直接用中文回复即可。

## 注意事项

- 始终用中文回复
- R 代码要添加充分的中文注释
- 统计结论要通俗易懂，适合本科生理解
- 如果用户没有提供数据，提醒用户先导入数据
- 对于假设检验，要说明零假设和备择假设
- p 值要精确到小数点后4位
- APA 格式报告统计结果

## 支持的分析方法

- 描述性统计（均值、标准差、频数等）
- t 检验（独立样本、配对样本）
- 方差分析（单因素 ANOVA）
- 卡方检验
- 相关分析（Pearson、Spearman）
- 线性回归
- 信度分析（Cronbach's α）
- 数据可视化（ggplot2）
`

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
        error: '请先在设置页面配置 AI API Key'
      }
    }

    const config = this.config!

    // 构建完整消息列表
    const fullMessages: ChatMsg[] = [
      { role: 'system', content: SYSTEM_PROMPT }
    ]

    // 添加数据上下文
    if (dataContext) {
      fullMessages.push({
        role: 'system',
        content: `当前已加载的数据集信息：\n${dataContext}\n\n请基于这些数据生成分析代码。数据文件名为 "data.csv"。`
      })
    }

    fullMessages.push(...messages)

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
        })
      })

      if (!response.ok) {
        const errorBody = await response.text()
        let errorMsg = `API 请求失败 (${response.status})`
        try {
          const errJson = JSON.parse(errorBody)
          errorMsg = errJson.error?.message || errorMsg
        } catch {
          // use default error
        }
        return { content: '', error: errorMsg }
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
      const err = error as { message?: string }
      return {
        content: '',
        error: `网络请求失败: ${err.message || '请检查网络连接和 API 配置'}`
      }
    }
  }

  /** 流式对话请求 */
  async *chatStream(
    messages: ChatMsg[],
    dataContext?: string
  ): AsyncGenerator<string, void, unknown> {
    if (!this.isConfigured()) {
      yield '❌ 请先在设置页面配置 AI API Key'
      return
    }

    const config = this.config!
    const fullMessages: ChatMsg[] = [
      { role: 'system', content: SYSTEM_PROMPT }
    ]

    if (dataContext) {
      fullMessages.push({
        role: 'system',
        content: `当前已加载的数据集信息：\n${dataContext}\n\n请基于这些数据生成分析代码。数据文件名为 "data.csv"。`
      })
    }

    fullMessages.push(...messages)

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
        })
      })

      if (!response.ok) {
        yield `❌ API 请求失败 (${response.status})`
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        yield '❌ 无法读取响应流'
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
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
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
      const err = error as { message?: string }
      yield `❌ 网络请求失败: ${err.message || '请检查网络连接'}`
    }
  }
}

/** 导出单例 */
export const aiService = new AIService()
