import { useState, useEffect } from 'react'
import { useAI } from '../contexts/AIContext'
import { useR } from '../contexts/RContext'

interface AppSettings {
  aiProvider: string
  aiApiKey: string
  aiBaseUrl: string
  aiModel: string
  fontSize: number
}

/** 预设服务商 — 只提供 API 地址，模型由用户填写 */
const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', placeholder: 'gpt-4o / gpt-4o-mini / o3 ...' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', placeholder: 'deepseek-chat / deepseek-reasoner ...' },
  { id: 'custom', name: '其他（自定义地址）', baseUrl: '', placeholder: '输入模型名称' }
]

const DEFAULT_SETTINGS: AppSettings = {
  aiProvider: 'openai',
  aiApiKey: '',
  aiBaseUrl: PROVIDERS[0].baseUrl,
  aiModel: '',
  fontSize: 14
}

type VerifyStatus = 'idle' | 'testing' | 'success' | 'fail'

export default function SettingsPage() {
  const { refreshConfig } = useAI()
  const { status: rStatus, detecting: rDetecting, detect: rDetect } = useR()
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)

  // 验证状态
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle')
  const [verifyMsg, setVerifyMsg] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('rworkbench_settings')
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) })
      } catch {
        // ignore
      }
    }
  }, [])

  const handleSave = async () => {
    localStorage.setItem('rworkbench_settings', JSON.stringify(settings))
    if (window.api?.config && settings.aiApiKey) {
      await window.api.config.saveApiKey(settings.aiProvider, settings.aiApiKey)
    }
    // 通知 AIContext 刷新配置，让对话页面立即可用
    await refreshConfig()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleProviderChange = (providerId: string) => {
    const provider = PROVIDERS.find((p) => p.id === providerId)
    setSettings((prev) => ({
      ...prev,
      aiProvider: providerId,
      aiBaseUrl: provider?.baseUrl || prev.aiBaseUrl,
      aiModel: '' // 切换服务商清空模型名，让用户重新填写
    }))
    setVerifyStatus('idle')
    setVerifyMsg('')
  }

  /** 验证 AI 连接是否可用 */
  const handleVerify = async () => {
    if (!settings.aiApiKey || !settings.aiBaseUrl || !settings.aiModel) {
      setVerifyStatus('fail')
      setVerifyMsg('请先填写完整的 API Key、地址和模型名称')
      return
    }

    setVerifyStatus('testing')
    setVerifyMsg('正在验证...')

    try {
      const response = await fetch(`${settings.aiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.aiApiKey}`
        },
        body: JSON.stringify({
          model: settings.aiModel,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.choices && data.choices.length > 0) {
          setVerifyStatus('success')
          setVerifyMsg(`✅ 连接成功！模型 ${settings.aiModel} 可用`)
        } else {
          setVerifyStatus('fail')
          setVerifyMsg('⚠️ 响应格式异常，请检查模型名称是否正确')
        }
      } else {
        const errBody = await response.text().catch(() => '')
        let errMsg = `❌ 请求失败 (${response.status})`
        try {
          const errJson = JSON.parse(errBody)
          errMsg = `❌ ${errJson.error?.message || errMsg}`
        } catch {
          // use default
        }
        if (response.status === 401) errMsg = '❌ API Key 无效，请检查'
        if (response.status === 404) errMsg = '❌ 模型不存在，请检查模型名称'
        if (response.status === 429) errMsg = '⚠️ 请求频率过高，但连接本身是通的'

        setVerifyStatus(response.status === 429 ? 'success' : 'fail')
        setVerifyMsg(errMsg)
      }
    } catch (err: unknown) {
      const e = err as { message?: string }
      setVerifyStatus('fail')
      setVerifyMsg(`❌ 网络错误: ${e.message || '请检查地址和网络'}`)
    }
  }

  const currentProvider = PROVIDERS.find((p) => p.id === settings.aiProvider)

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>⚙️ 设置</h1>
        <p>配置 AI 服务和 R 环境</p>
      </div>

      <div className="page-body">
        {/* ── AI 配置 ── */}
        <div className="settings-section">
          <div className="settings-section-title">🤖 AI 服务配置</div>

          {/* 服务商选择 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={`btn btn-sm ${settings.aiProvider === p.id ? 'active' : 'btn-secondary'}`}
                onClick={() => handleProviderChange(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* API Key */}
          <div style={{ marginBottom: 16 }}>
            <label className="settings-label">API Key</label>
            <div className="settings-desc" style={{ marginBottom: 6 }}>
              仅存储在本地，不会上传到任何服务器
            </div>
            <input
              type="password"
              style={{ width: '100%' }}
              placeholder="sk-..."
              value={settings.aiApiKey}
              onChange={(e) => {
                setSettings((prev) => ({ ...prev, aiApiKey: e.target.value }))
                setVerifyStatus('idle')
              }}
            />
          </div>

          {/* API Base URL */}
          <div style={{ marginBottom: 16 }}>
            <label className="settings-label">API 地址</label>
            <div className="settings-desc" style={{ marginBottom: 6 }}>
              {settings.aiProvider === 'custom'
                ? '输入你的 API 兼容接口地址'
                : `${currentProvider?.name} 接口地址（通常无需修改）`}
            </div>
            <input
              style={{ width: '100%' }}
              placeholder="https://api.openai.com/v1"
              value={settings.aiBaseUrl}
              onChange={(e) => {
                setSettings((prev) => ({ ...prev, aiBaseUrl: e.target.value }))
                setVerifyStatus('idle')
              }}
            />
          </div>

          {/* 模型名称 — 统一文本输入 */}
          <div style={{ marginBottom: 16 }}>
            <label className="settings-label">模型名称</label>
            <div className="settings-desc" style={{ marginBottom: 6 }}>
              填写你要使用的模型 ID
            </div>
            <input
              style={{ width: '100%' }}
              placeholder={currentProvider?.placeholder || '模型名称'}
              value={settings.aiModel}
              onChange={(e) => {
                setSettings((prev) => ({ ...prev, aiModel: e.target.value.trim() }))
                setVerifyStatus('idle')
              }}
            />
            {/* 快捷填写提示 */}
            {settings.aiProvider !== 'custom' && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                常用模型：
                {settings.aiProvider === 'openai' && 'gpt-4o、gpt-4o-mini、o3'}
                {settings.aiProvider === 'deepseek' && 'deepseek-chat、deepseek-reasoner'}
              </div>
            )}
          </div>

          {/* 验证按钮 + 状态 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn btn-secondary"
              onClick={handleVerify}
              disabled={verifyStatus === 'testing'}
            >
              {verifyStatus === 'testing' ? '⏳ 验证中...' : '🔍 验证连接'}
            </button>
            {verifyMsg && (
              <span
                style={{
                  fontSize: 13,
                  color:
                    verifyStatus === 'success'
                      ? 'var(--success)'
                      : verifyStatus === 'fail'
                      ? 'var(--error)'
                      : 'var(--text-secondary)'
                }}
              >
                {verifyMsg}
              </span>
            )}
          </div>
        </div>

        {/* ── R 环境 ── */}
        <div className="settings-section">
          <div className="settings-section-title">📊 R 环境</div>

          <div className="settings-row">
            <div>
              <div className="settings-label">
                <span
                  className={`status-dot ${rStatus.found ? 'success' : 'error'}`}
                  style={{ marginRight: 8 }}
                />
                R 环境状态
              </div>
              <div className="settings-desc">
                {rStatus.found
                  ? `已检测到 R ${rStatus.version} (${rStatus.path})`
                  : '未检测到 R 环境，请先安装 R'}
              </div>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={rDetect}
              disabled={rDetecting}
            >
              {rDetecting ? '检测中...' : '重新检测'}
            </button>
          </div>

          {!rStatus.found && (
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
                rel="noreferrer"
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
