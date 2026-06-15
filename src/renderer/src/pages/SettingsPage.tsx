import { useState, useEffect } from 'react'

interface AppSettings {
  // AI 配置
  aiProvider: string
  aiApiKey: string
  aiBaseUrl: string
  aiModel: string

  // R 环境
  rPath: string
  rVersion: string
  rDetected: boolean

  // 界面
  fontSize: number
}

const DEFAULT_SETTINGS: AppSettings = {
  aiProvider: 'openai',
  aiApiKey: '',
  aiBaseUrl: 'https://api.openai.com/v1',
  aiModel: 'gpt-4o-mini',
  rPath: '',
  rVersion: '',
  rDetected: false,
  fontSize: 14
}

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'] },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-coder'] },
  { id: 'qwen', name: '通义千问 (阿里云)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
  { id: 'custom', name: '自定义', baseUrl: '', models: [] }
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [detecting, setDetecting] = useState(false)
  const [saved, setSaved] = useState(false)

  // 加载设置
  useEffect(() => {
    const saved = localStorage.getItem('rworkbench_settings')
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) })
      } catch {
        // 忽略解析错误
      }
    }
    // 自动检测 R 环境
    detectR()
  }, [])

  const detectR = async () => {
    if (!window.api) return
    setDetecting(true)
    try {
      const result = await window.api.r.detect()
      setSettings((prev) => ({
        ...prev,
        rDetected: result.found,
        rPath: result.path,
        rVersion: result.version
      }))
    } catch {
      // 忽略
    } finally {
      setDetecting(false)
    }
  }

  const handleSave = async () => {
    // 保存配置到 localStorage
    localStorage.setItem('rworkbench_settings', JSON.stringify(settings))

    // API Key 通过主进程加密存储（修复 #7）
    if (window.api?.config && settings.aiApiKey) {
      await window.api.config.saveApiKey(settings.aiProvider, settings.aiApiKey)
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleProviderChange = (providerId: string) => {
    const provider = PROVIDERS.find((p) => p.id === providerId)
    setSettings((prev) => ({
      ...prev,
      aiProvider: providerId,
      aiBaseUrl: provider?.baseUrl || '',
      aiModel: provider?.models[0] || ''
    }))
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>⚙️ 设置</h1>
        <p>配置 AI 服务和 R 环境</p>
      </div>

      <div className="page-body">
        {/* AI 配置 */}
        <div className="settings-section">
          <div className="settings-section-title">🤖 AI 服务配置</div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div>
              <div className="settings-label">服务提供商</div>
              <div className="settings-desc">选择你使用的 AI 服务</div>
            </div>
            <select
              value={settings.aiProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
              style={{ width: '100%' }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div>
              <div className="settings-label">API Key</div>
              <div className="settings-desc">你的 API Key 仅存储在本地，不会上传到任何服务器</div>
            </div>
            <input
              type="password"
              className="settings-input"
              style={{ width: '100%' }}
              placeholder="sk-..."
              value={settings.aiApiKey}
              onChange={(e) => setSettings((prev) => ({ ...prev, aiApiKey: e.target.value }))}
            />
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div>
              <div className="settings-label">API Base URL</div>
              <div className="settings-desc">API 服务地址，部分国内服务需要修改</div>
            </div>
            <input
              className="settings-input"
              style={{ width: '100%' }}
              placeholder="https://api.openai.com/v1"
              value={settings.aiBaseUrl}
              onChange={(e) => setSettings((prev) => ({ ...prev, aiBaseUrl: e.target.value }))}
            />
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div>
              <div className="settings-label">模型</div>
              <div className="settings-desc">选择使用的 AI 模型</div>
            </div>
            {PROVIDERS.find(p => p.id === settings.aiProvider)?.models.length ? (
              <select
                value={settings.aiModel}
                onChange={(e) => setSettings((prev) => ({ ...prev, aiModel: e.target.value }))}
                style={{ width: '100%' }}
              >
                {PROVIDERS.find(p => p.id === settings.aiProvider)?.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                className="settings-input"
                style={{ width: '100%' }}
                placeholder="模型名称"
                value={settings.aiModel}
                onChange={(e) => setSettings((prev) => ({ ...prev, aiModel: e.target.value }))}
              />
            )}
          </div>
        </div>

        {/* R 环境 */}
        <div className="settings-section">
          <div className="settings-section-title">📊 R 环境</div>

          <div className="settings-row">
            <div>
              <div className="settings-label">
                <span
                  className={`status-dot ${settings.rDetected ? 'success' : 'error'}`}
                  style={{ marginRight: 8 }}
                />
                R 环境状态
              </div>
              <div className="settings-desc">
                {settings.rDetected
                  ? `已检测到 R ${settings.rVersion} (${settings.rPath})`
                  : '未检测到 R 环境，请先安装 R'}
              </div>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={detectR}
              disabled={detecting}
            >
              {detecting ? '检测中...' : '重新检测'}
            </button>
          </div>

          {!settings.rDetected && (
            <div
              style={{
                background: 'var(--warning-bg)',
                border: '1px solid var(--warning)',
                borderRadius: 'var(--radius-md)',
                padding: 12,
                marginTop: 12,
                fontSize: 13
              }}
            >
              ⚠️ R Workbench 需要本地安装 R 环境才能执行统计分析。
              <br />
              请访问{' '}
              <a
                href="https://cran.r-project.org/bin/windows/base/"
                target="_blank"
                style={{ color: 'var(--primary)' }}
              >
                CRAN
              </a>{' '}
              下载安装 R。
            </div>
          )}
        </div>

        {/* 保存按钮 */}
        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? '✅ 已保存' : '💾 保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}
