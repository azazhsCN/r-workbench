import { useTranslation } from 'react-i18next'
import type { PageType } from '../App'
import { SAMPLE_DATASETS } from '../data/sampleDatasets'
import { parseCSV } from '../services/dataService'
import { useData } from '../contexts/DataContext'

interface WelcomePageProps {
  onNavigate: (page: PageType) => void
}

export default function WelcomePage({ onNavigate }: WelcomePageProps) {
  const { t } = useTranslation()
  const { setDataset } = useData()

  const quickActions = [
    {
      icon: '💬',
      titleKey: 'welcome.quickAction.ai.title',
      descKey: 'welcome.quickAction.ai.desc',
      page: 'chat' as PageType
    },
    {
      icon: '📊',
      titleKey: 'welcome.quickAction.wizard.title',
      descKey: 'welcome.quickAction.wizard.desc',
      page: 'wizard' as PageType
    },
    {
      icon: '📁',
      titleKey: 'welcome.quickAction.data.title',
      descKey: 'welcome.quickAction.data.desc',
      page: 'data' as PageType
    },
    {
      icon: '⚙️',
      titleKey: 'welcome.quickAction.settings.title',
      descKey: 'welcome.quickAction.settings.desc',
      page: 'settings' as PageType
    }
  ]

  const handleLoadSample = (sampleId: string) => {
    const sample = SAMPLE_DATASETS.find((d) => d.id === sampleId)
    if (!sample) return

    const result = parseCSV(sample.csv, sample.name + '.csv')
    setDataset(result)
    onNavigate('wizard')
  }

  return (
    <div className="welcome-page">
      <div className="welcome-logo">R</div>
      <h1 className="welcome-title">{t('welcome.title')}</h1>
      <p className="welcome-subtitle">
        {t('welcome.subtitle')}
      </p>

      {/* 快捷操作 */}
      <div className="welcome-cards" style={{ marginBottom: 32 }}>
        {quickActions.map((action) => (
          <div
            key={action.page}
            className="welcome-card"
            onClick={() => onNavigate(action.page)}
          >
            <div className="welcome-card-icon">{action.icon}</div>
            <div className="welcome-card-title">{t(action.titleKey)}</div>
            <div className="welcome-card-desc">{t(action.descKey)}</div>
          </div>
        ))}
      </div>

      {/* 示例数据 */}
      <div style={{ width: '100%', maxWidth: 800 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            marginBottom: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}
        >
          {t('welcome.sample.title')}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {SAMPLE_DATASETS.map((sample) => (
            <div
              key={sample.id}
              className="welcome-card"
              onClick={() => handleLoadSample(sample.id)}
              style={{ padding: 16 }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                {sample.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {sample.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 版本信息 */}
      <div
        style={{
          marginTop: 40,
          fontSize: 12,
          color: 'var(--text-tertiary)',
          textAlign: 'center'
        }}
      >
        {t('app.version')}
      </div>
    </div>
  )
}
