import type { PageType } from '../App'
import { SAMPLE_DATASETS } from '../data/sampleDatasets'
import { parseCSV } from '../services/dataService'
import { useData } from '../contexts/DataContext'

interface WelcomePageProps {
  onNavigate: (page: PageType) => void
}

export default function WelcomePage({ onNavigate }: WelcomePageProps) {
  const { setDataset } = useData()

  const quickActions = [
    {
      icon: '💬',
      title: 'AI 对话分析',
      desc: '用自然语言描述你的分析需求，AI 帮你生成 R 代码并执行',
      page: 'chat' as PageType
    },
    {
      icon: '📊',
      title: '向导式分析',
      desc: '选择分析方法，逐步引导完成 t检验、方差分析、回归等统计分析',
      page: 'wizard' as PageType
    },
    {
      icon: '📁',
      title: '导入数据',
      desc: '支持 CSV、Excel、SPSS (.sav) 格式的数据导入和预览',
      page: 'data' as PageType
    },
    {
      icon: '⚙️',
      title: '配置 API Key',
      desc: '配置你的 AI 服务 API Key，开始使用 AI 驱动的数据分析',
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
      <h1 className="welcome-title">欢迎使用 R Workbench</h1>
      <p className="welcome-subtitle">
        AI 驱动的 R 语言数据分析工作台。无需编写代码，用自然语言即可完成专业级统计分析。
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
            <div className="welcome-card-title">{action.title}</div>
            <div className="welcome-card-desc">{action.desc}</div>
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
          📦 快速体验 — 加载示例数据
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
        R Workbench v0.1.2 — 开源 · 免费 · 中文友好
      </div>
    </div>
  )
}
