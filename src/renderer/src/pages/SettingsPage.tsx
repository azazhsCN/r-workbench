import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAI } from '../contexts/AIContext'
import { useR } from '../contexts/RContext'
import { setLanguage, type AppLanguage } from '../i18n'

interface AppSettings {
  aiProvider: string
  aiApiKey: string
  aiBaseUrl: string
  aiModel: string
  fontSize: number
  language: AppLanguage | 'system'
}

/** 预设服务商 — 只提供 API 地址，模型由用户填写 */
const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', placeholder: 'gpt-4o / gpt-4o-mini / o3 ...' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', placeholder: 'deepseek-chat / deepseek-reasoner ...' },
  { id: 'custom', nameKey: 'settings.ai.provider.custom', baseUrl: '', placeholder: '' }
]

const DEFAULT_SETTINGS: AppSettings = {
  aiProvider: 'openai',
  aiApiKey: '',
  aiBaseUrl: PROVIDERS[0].baseUrl,
  aiModel: '',
  fontSize: 14,
  language: 'system'
}

type VerifyStatus = 'idle' | 'testing' | 'success' | 'fail'

export default function SettingsPage() {
  const { t } = useTranslation()
  const { refreshConfig } = useAI()
  const { status: rStatus, detecting: rDetecting, error: rError, detect: rDetect } = useR()
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  /** 输入框里的 Key 是否来自本机安全存储（而非用户刚刚输入） */
  const [keyLoaded, setKeyLoaded] = useState(false)

  // 验证状态
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle')
  const [verifyMsg, setVerifyMsg] = useState('')

  // 语言选项
  const languageOptions: { value: AppLanguage | 'system'; labelKey: string }[] = [
    { value: 'system', labelKey: 'settings.language.system' },
    { value: 'zh-CN', labelKey: 'settings.language.zhCN' },
    { value: 'en-US', labelKey: 'settings.language.enUS' }
  ]

  useEffect(() => {
    let cancelled = false
    const loadStoredSettings = async () => {
      let stored: AppSettings = DEFAULT_SETTINGS
      const raw = localStorage.getItem('rworkbench_settings')
      if (raw) {
        try {
          stored = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
        } catch {
          // ignore
        }
      }
      if (cancelled) return
      setSettings(stored)

      // handleSave 不会把 API Key 写进 localStorage（只进 safeStorage），
      // 因此这里必须主动读回来：否则每次重启后「验证连接」都必定失败，
      // 提示"请先填写完整的 API Key"，即使 key 已安全保存。
      if (!stored.aiApiKey && window.api?.config) {
        try {
          const key = await window.api.config.loadApiKey(stored.aiProvider)
          if (!cancelled && key) {
            setSettings((prev) => ({ ...prev, aiApiKey: key }))
            setKeyLoaded(true)
          }
        } catch {
          // safeStorage 不可用（如缺少密钥环）时静默回退到手动输入
        }
      }
    }
    void loadStoredSettings()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = async () => {
    // S1: 不将 aiApiKey 写入 localStorage，避免明文残留
    const { aiApiKey, ...safeSettings } = settings
    localStorage.setItem('rworkbench_settings', JSON.stringify(safeSettings))

    // API Key 仅通过 safeStorage 加密存储
    if (window.api?.config && aiApiKey) {
      await window.api.config.saveApiKey(settings.aiProvider, aiApiKey)
    }
    // 应用语言选择
    setLanguage(settings.language)
    // 通知 AIContext 刷新配置，让对话页面立即可用
    await refreshConfig()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleProviderChange = async (providerId: string) => {
    const provider = PROVIDERS.find((p) => p.id === providerId)
    const isCustom = providerId === 'custom'
    setSettings((prev) => ({
      ...prev,
      aiProvider: providerId,
      // 自定义服务商必须清空地址：保留上一服务商的 URL（旧的
      // `provider?.baseUrl || prev.aiBaseUrl`）会让用户以为指向本地服务，
      // 实际仍把 API Key 发往 DeepSeek。
      aiBaseUrl: isCustom ? '' : provider?.baseUrl ?? '',
      aiModel: '' // 切换服务商清空模型名，让用户重新填写
    }))
    setVerifyStatus('idle')
    setVerifyMsg('')
    setKeyLoaded(false)

    // 换服务商后重新载入该服务商自己的 Key（不同服务商的 Key 不通用）
    if (window.api?.config) {
      try {
        const key = await window.api.config.loadApiKey(providerId)
        setSettings((prev) => ({ ...prev, aiApiKey: key || '' }))
        setKeyLoaded(Boolean(key))
      } catch {
        setSettings((prev) => ({ ...prev, aiApiKey: '' }))
      }
    } else {
      setSettings((prev) => ({ ...prev, aiApiKey: '' }))
    }
  }

  /** 验证 AI 连接是否可用 */
  const handleVerify = async () => {
    if (!settings.aiApiKey || !settings.aiBaseUrl || !settings.aiModel) {
      setVerifyStatus('fail')
      setVerifyMsg(t('settings.ai.test.fillFirst'))
      return
    }

    setVerifyStatus('testing')
    setVerifyMsg(t('settings.ai.testing'))

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
          setVerifyMsg(t('settings.ai.test.modelOk', { model: settings.aiModel }))
        } else {
          setVerifyStatus('fail')
          setVerifyMsg(t('settings.ai.test.responseAbnormal'))
        }
      } else {
        const errBody = await response.text().catch(() => '')
        let errMsg = `${t('settings.ai.test.genericFail')} (${response.status})`
        try {
          const errJson = JSON.parse(errBody)
          errMsg = `❌ ${errJson.error?.message || errMsg}`
        } catch {
          // use default
        }
        if (response.status === 401) errMsg = `❌ ${t('settings.ai.test.keyInvalid')}`
        if (response.status === 404) errMsg = `❌ ${t('settings.ai.test.modelNotFound')}`
        if (response.status === 429) errMsg = `⚠️ ${t('settings.ai.test.rateLimit')}`

        setVerifyStatus(response.status === 429 ? 'success' : 'fail')
        setVerifyMsg(errMsg)
      }
    } catch (err: unknown) {
      const e = err as { message?: string }
      setVerifyStatus('fail')
      setVerifyMsg(`❌ ${t('settings.ai.test.networkError')}${e.message || t('settings.ai.test.checkNetwork')}`)
    }
  }

  const currentProvider = PROVIDERS.find((p) => p.id === settings.aiProvider)
  const providerName = (p: (typeof PROVIDERS)[number]) => (p.name as string) || t(p.nameKey || '')

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>⚙️ {t('settings.title')}</h1>
        <p>{t('settings.subtitle')}</p>
      </div>

      <div className="page-body">
        {/* ── 语言 ── */}
        <div className="settings-section">
          <div className="settings-section-title">🌐 {t('settings.section.language')}</div>
          <div className="settings-desc" style={{ marginBottom: 12 }}>
            {t('settings.language.desc')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {languageOptions.map((opt) => (
              <button
                key={opt.value}
                className={`btn btn-sm ${settings.language === opt.value ? 'active' : 'btn-secondary'}`}
                onClick={() => setSettings((prev) => ({ ...prev, language: opt.value }))}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* ── AI 配置 ── */}
        <div className="settings-section">
          <div className="settings-section-title">🤖 {t('settings.section.ai')}</div>

          {/* 服务商选择 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={`btn btn-sm ${settings.aiProvider === p.id ? 'active' : 'btn-secondary'}`}
                onClick={() => handleProviderChange(p.id)}
              >
                {providerName(p)}
              </button>
            ))}
          </div>

          {/* API Key */}
          <div style={{ marginBottom: 16 }}>
            <label className="settings-label">{t('settings.ai.apiKey')}</label>
            <div className="settings-desc" style={{ marginBottom: 6 }}>
              {t('settings.ai.apiKey.localOnly')}
            </div>
            <input
              type="password"
              style={{ width: '100%' }}
              placeholder="sk-..."
              value={settings.aiApiKey}
              onChange={(e) => {
                setSettings((prev) => ({ ...prev, aiApiKey: e.target.value }))
                setKeyLoaded(false)
                setVerifyStatus('idle')
              }}
            />
            {keyLoaded && (
              <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 4 }}>
                {t('settings.ai.apiKey.loaded')}
              </div>
            )}
          </div>

          {/* API Base URL */}
          <div style={{ marginBottom: 16 }}>
            <label className="settings-label">{t('settings.ai.baseUrl')}</label>
            <div className="settings-desc" style={{ marginBottom: 6 }}>
              {settings.aiProvider === 'custom'
                ? t('settings.ai.model.customUrl')
                : `${providerName(currentProvider!)} ${t('settings.ai.model.providerDefault')}`}
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
            <label className="settings-label">{t('settings.ai.model')}</label>
            <div className="settings-desc" style={{ marginBottom: 6 }}>
              {t('settings.ai.model.desc')}
            </div>
            <input
              style={{ width: '100%' }}
              placeholder={currentProvider?.placeholder || t('settings.ai.model.placeholder')}
              value={settings.aiModel}
              onChange={(e) => {
                setSettings((prev) => ({ ...prev, aiModel: e.target.value.trim() }))
                setVerifyStatus('idle')
              }}
            />
            {/* 快捷填写提示 */}
            {settings.aiProvider !== 'custom' && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {t('settings.ai.model.commonModels')}
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
              {verifyStatus === 'testing' ? `⏳ ${t('settings.ai.testing')}` : `🔍 ${t('settings.ai.test')}`}
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
          <div className="settings-section-title">📊 {t('settings.section.r')}</div>

          <div className="settings-row">
            <div>
              <div className="settings-label">
                <span
                  className={`status-dot ${rStatus.found ? 'success' : 'error'}`}
                  style={{ marginRight: 8 }}
                />
                {t('settings.r.status')}
              </div>
              <div className="settings-desc">
                {rError
                  ? `⚠️ ${t('settings.r.detectError', { error: rError })}`
                  : rStatus.found
                  ? t('settings.r.detectedWith', { version: rStatus.version, path: rStatus.path })
                  : t('settings.r.notDetectedHint')}
              </div>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={rDetect}
              disabled={rDetecting}
            >
              {rDetecting ? t('settings.r.detecting') : t('settings.r.redetect')}
            </button>
          </div>

          {/* R 检测过程失败：与"未安装 R"区分开，否则会误导用户重装一个正常的 R */}
          {rError && (
            <div
              style={{
                background: 'var(--error-bg)',
                border: '1px solid var(--error)',
                borderRadius: 'var(--radius-md)',
                padding: 12,
                marginTop: 12,
                fontSize: 13,
                color: 'var(--error)'
              }}
            >
              {t('settings.r.detectError', { error: rError })}
            </div>
          )}

          {!rStatus.found && !rError && (
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
              {t('settings.r.noEnvWarning')}
              <br />
              {t('settings.r.noEnvDesc', { url: '' })}
              <a
                href="https://cran.r-project.org/bin/windows/base/"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--primary)' }}
              >
                CRAN
              </a>
            </div>
          )}
        </div>

        {/* ── R 包管理 ── */}
        {rStatus.found && (
          <div className="settings-section">
            <div className="settings-section-title">📦 {t('settings.r.packages')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {t('settings.r.packages.desc')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { name: 'ggplot2', descKey: 'settings.r.package.ggplot2' },
                { name: 'psych', descKey: 'settings.r.package.psych' },
                { name: 'lavaan', descKey: 'settings.r.package.lavaan' },
                { name: 'mediation', descKey: 'settings.r.package.mediation' },
                { name: 'pROC', descKey: 'settings.r.package.pROC' },
                { name: 'survival', descKey: 'settings.r.package.survival' },
              ].map((pkg) => (
                <RPackageCard key={pkg.name} name={pkg.name} desc={t(pkg.descKey)} />
              ))}
            </div>
          </div>
        )}

        {/* 保存按钮 */}
        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? t('settings.ai.saved') : `💾 ${t('settings.ai.save')}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** R 包状态卡片 */
function RPackageCard({ name, desc }: { name: string; desc: string }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'unknown' | 'installed' | 'missing' | 'installing'>('unknown')
  const [checking, setChecking] = useState(false)

  const checkInstalled = async () => {
    if (!window.api) return
    setChecking(true)
    try {
      const result = await window.api.r.packages([name])
      setStatus(result.installed.includes(name) ? 'installed' : 'missing')
    } catch {
      setStatus('unknown')
    } finally {
      setChecking(false)
    }
  }

  // S4+S5: useEffect + name 依赖
  useEffect(() => {
    checkInstalled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  const handleInstall = async () => {
    if (!window.api) return
    setStatus('installing')
    try {
      const result = await window.api.r.install(name)
      setStatus(result.success ? 'installed' : 'missing')
    } catch {
      setStatus('missing')
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', fontSize: 13, minWidth: 180
    }}>
      <span style={{ fontWeight: 500 }}>{name}</span>
      <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{desc}</span>
      <span style={{ marginLeft: 'auto' }}>
        {status === 'installed' && <span style={{ color: 'var(--success)' }}>✓</span>}
        {status === 'missing' && (
          <button className="btn btn-sm btn-secondary" onClick={handleInstall} style={{ padding: '2px 8px', fontSize: 12 }}>
            {t('settings.r.install')}
          </button>
        )}
        {status === 'installing' && <span style={{ color: 'var(--text-tertiary)' }}>⏳</span>}
        {checking && <span style={{ color: 'var(--text-tertiary)' }}>...</span>}
      </span>
    </div>
  )
}