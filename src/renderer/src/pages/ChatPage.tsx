import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAI } from '../contexts/AIContext'
import { useData } from '../contexts/DataContext'
import { useR } from '../contexts/RContext'
import { RService } from '../services/rService'
import { datasetToCSV } from '../services/dataService'
import { parseROutput } from '../services/resultParser'
import { generateInterpretation } from '../services/interpretService'
import ThreeLineTable from '../components/ThreeLineTable'
import type { AnalysisResult } from '../services/rService'

/** 消息类型 */
interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  rCode?: string
  rResult?: AnalysisResult
  /** 解析后的三线表 */
  parsedTables?: Array<{ title?: string; headers: string[]; rows: (string | number)[][]; note?: string }>
  /** AI 解读 */
  interpretation?: string
  interpretLoading?: boolean
  isExecuting?: boolean
  timestamp: number
}

export default function ChatPage() {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<Message[]>([{ id: 'welcome', role: 'assistant', content: t('chat.welcome'), timestamp: Date.now() }])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { service: ai, isConfigured } = useAI()
  const { dataset, hasData } = useData()
  const { status: rStatus } = useR()

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 获取数据上下文
  const getDataContext = useCallback((): string | undefined => {
    if (!dataset) return undefined
    const colDescs = dataset.columnInfo.map(
      (c) => `  - ${c.name} (${c.type === 'numeric' ? t('chat.typed.numeric') : t('chat.typed.categorical')}, ${t('chat.validCount', { n: c.total - c.missing })})`
    )
    return `数据集: ${dataset.dataset.name}\n行数: ${dataset.rows.length}\n列数: ${dataset.headers.length}\n变量:\n${colDescs.join('\n')}`
  }, [dataset, t])

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return

    // 添加用户消息
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now()
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsStreaming(true)

    // 检查 AI 配置
    if (!isConfigured) {
      const sysMsg: Message = {
        id: `sys-${Date.now()}`,
        role: 'system',
        content: t('chat.needConfig'),
        timestamp: Date.now()
      }
      setMessages((prev) => [...prev, sysMsg])
      setIsStreaming(false)
      return
    }

    // 构建消息历史
    const chatHistory = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    chatHistory.push({ role: 'user', content: trimmed })

    // 创建助手消息（用于流式填充）
    const assistantMsg: Message = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    }
    setMessages((prev) => [...prev, assistantMsg])

    // 流式获取 AI 响应
    let fullContent = ''
    try {
      const stream = ai.chatStream(chatHistory, getDataContext())
      for await (const chunk of stream) {
        fullContent += chunk
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: fullContent } : m
          )
        )
      }
    } catch {
      fullContent = t('chat.error')
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: fullContent } : m
        )
      )
    }

    // 解析 R 代码块
    const rCodeMatch = fullContent.match(/```r-execute\n([\s\S]*?)```/)
    if (rCodeMatch) {
      const rCode = rCodeMatch[1].trim()
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, rCode } : m
        )
      )
    }

    setIsStreaming(false)
  }

  // 执行 R 代码
  const handleExecuteR = async (msgId: string, code: string) => {
    if (!hasData) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                rResult: {
                  success: false,
                  output: '',
                  tables: [],
                  plots: [],
                  errors: [t('chat.needData')]
                }
              }
            : m
        )
      )
      return
    }

    // 标记为执行中
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, isExecuting: true } : m))
    )

    // 通过 dataCsv 参数传递数据（不在代码中嵌入）
    const csv = datasetToCSV(dataset!.headers, dataset!.rows)
    const result = await RService.execute(code, csv)

    // 解析为三线表
    let parsedTables: Message['parsedTables'] = undefined
    let interpretation = ''

    if (result.success && result.output) {
      const parsed = parseROutput(result.output)
      if (parsed.tables.length > 0) {
        parsedTables = parsed.tables

        // 自动触发 AI 解读
        if (isConfigured) {
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, rResult: result, isExecuting: false, parsedTables, interpretLoading: true } : m))
          )
          interpretation = await generateInterpretation(parsed)
        }
      }
    }

    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, rResult: result, isExecuting: false, parsedTables, interpretation, interpretLoading: false }
          : m
      )
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-page">
      {/* 状态栏 */}
      <div
        style={{
          padding: '8px 28px',
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 16,
          fontSize: 12,
          color: 'var(--text-tertiary)'
        }}
      >
        <span>
          🤖 AI: {isConfigured ? t('chat.configured') : t('chat.notConfigured')}
        </span>
        <span>
          📊 数据: {hasData ? `✅ ${dataset!.dataset.name}` : `❌ ${t('chat.notLoaded')}`}
        </span>
        <span>
          ⚙️ R: {rStatus.found ? `✅ R ${rStatus.version}` : `❌ ${t('chat.notLoaded')}`}
        </span>
      </div>

      {/* 消息列表 */}
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            <div className={`chat-avatar ${msg.role}`}>
              {msg.role === 'assistant' ? 'R' : msg.role === 'user' ? t('chat.me') : '⚡'}
            </div>
            <div className={`chat-bubble ${msg.role}`}>
              {/* 安全文本渲染 — 不使用 dangerouslySetInnerHTML（修复 #4） */}
              {msg.role === 'assistant' ? (
                <SafeMarkdown text={msg.content} />
              ) : (
                msg.content
              )}

              {/* R 代码块 */}
              {msg.rCode && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                        fontWeight: 600
                      }}
                    >
                      📝 {t('chat.code.title').replace('📝 ', '')}
                    </span>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleExecuteR(msg.id, msg.rCode!)}
                      disabled={msg.isExecuting}
                    >
                      {msg.isExecuting ? `⏳ ${t('chat.code.executing')}` : `▶️ ${t('chat.code.execute')}`}
                    </button>
                  </div>
                  <pre>
                    <code>{msg.rCode}</code>
                  </pre>
                </div>
              )}

              {/* R 执行结果 */}
              {msg.rResult && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      marginBottom: 8,
                      color: msg.rResult.success ? 'var(--success)' : 'var(--error)'
                    }}
                  >
                    {msg.rResult.success ? t('chat.analyzeDone') : t('chat.analyzeFailed')}
                  </div>

                  {/* 三线表展示 */}
                  {msg.parsedTables && msg.parsedTables.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      {msg.parsedTables.map((table, i) => (
                        <ThreeLineTable
                          key={i}
                          title={table.title}
                          headers={table.headers}
                          rows={table.rows}
                          note={table.note}
                        />
                      ))}
                    </div>
                  )}

                  {/* AI 解读 */}
                  {msg.interpretLoading && (
                    <div className="result-interpretation" style={{ marginTop: 8 }}>
                      <h4>{t('chat.ai.title')}</h4>
                      <p style={{ opacity: 0.6 }}>{t('chat.ai.generating')}</p>
                    </div>
                  )}
                  {msg.interpretation && !msg.interpretLoading && (
                    <div className="result-interpretation" style={{ marginTop: 8 }}>
                      <h4>{t('chat.interpretation.title')}</h4>
                      <p>{msg.interpretation}</p>
                    </div>
                  )}

                  {/* 原始输出（折叠） */}
                  {msg.rResult.output && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {t('chat.viewOutput')}
                      </summary>
                      <pre
                        style={{
                          background: msg.rResult.success ? '#0f172a' : '#1a0000',
                          fontSize: 13,
                          whiteSpace: 'pre-wrap',
                          marginTop: 4
                        }}
                      >
                        <code>{msg.rResult.output}</code>
                      </pre>
                    </details>
                  )}

                  {/* 错误信息 */}
                  {!msg.rResult.success && msg.rResult.errors.length > 0 && (
                    <pre style={{ background: '#1a0000', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                      <code>{msg.rResult.errors.join('\n')}</code>
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {isStreaming && messages[messages.length - 1]?.content === '' && (
          <div className="chat-message assistant">
            <div className="chat-avatar assistant">R</div>
            <div className="chat-bubble assistant">
              <span style={{ opacity: 0.6 }}>{t('chat.thinking')}</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={
              isConfigured
                ? t('chat.inputPlaceholder')
                : t('chat.inputPlaceholderNoConfig')
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={!isConfigured}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming || !isConfigured}
            title={t('chat.send')}
          >
            →
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 安全 Markdown 渲染组件（修复 #4 XSS）
 * 不使用 dangerouslySetInnerHTML，纯 React 组件渲染
 */
function SafeMarkdown({ text }: { text: string }) {
  // 移除 R 代码块
  const cleaned = text.replace(/```r-execute\n[\s\S]*?```/g, '')

  // 按行处理
  const lines = cleaned.split('\n')
  const elements: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (!line.trim()) {
      elements.push(<br key={i} />)
      return
    }

    // 处理行内格式
    const parts: React.ReactNode[] = []
    const remaining = line
    let partIndex = 0

    // 匹配 **bold**、*italic*、`code`
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
    let match: RegExpExecArray | null
    let lastIdx = 0

    while ((match = regex.exec(remaining)) !== null) {
      // 匹配前的文本
      if (match.index > lastIdx) {
        parts.push(remaining.slice(lastIdx, match.index))
      }

      if (match[2]) {
        parts.push(<strong key={`${i}-${partIndex++}`}>{match[2]}</strong>)
      } else if (match[3]) {
        parts.push(<em key={`${i}-${partIndex++}`}>{match[3]}</em>)
      } else if (match[4]) {
        parts.push(
          <code
            key={`${i}-${partIndex++}`}
            style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3, fontSize: 13 }}
          >
            {match[4]}
          </code>
        )
      }

      lastIdx = match.index + match[0].length
    }

    if (lastIdx < remaining.length) {
      parts.push(remaining.slice(lastIdx))
    }

    // 处理列表前缀（S5: 原始文本已含前缀，不重复添加）
    const content: React.ReactNode = parts.length === 1 ? parts[0] : <>{parts}</>
    if (line.startsWith('• ') || line.startsWith('- ')) {
      // 原始文本中的 • / - 已包含在 parts 中，不需再前置
    } else if (/^\d+\.\s/.test(line)) {
      // 有序列表保持原样
    }

    elements.push(
      <span key={i}>
        {content}
        {i < lines.length - 1 && <br />}
      </span>
    )
  })

  return <div>{elements}</div>
}
