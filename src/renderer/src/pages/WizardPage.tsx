import { useState, useCallback } from 'react'
import { useData } from '../contexts/DataContext'
import { useAI } from '../contexts/AIContext'
import { RService, type AnalysisResult } from '../services/rService'
import { datasetToCSV } from '../services/dataService'
import { parseROutput } from '../services/resultParser'
import { generateInterpretation } from '../services/interpretService'
import ThreeLineTable, { threeLineTableToHTML } from '../components/ThreeLineTable'
import PlotViewer from '../components/PlotViewer'

/** 向导步骤 */
type WizardStep = 'select' | 'configure' | 'execute' | 'result'

/** 分析方法定义 */
interface AnalysisMethod {
  id: string
  name: string
  icon: string
  description: string
  category: string
  needsGroup: boolean
  minVars: number
  maxVars: number
  varType: 'numeric' | 'string' | 'any'
}

const METHODS: AnalysisMethod[] = [
  {
    id: 'descriptive',
    name: '描述性统计',
    icon: '📈',
    description: '计算均值、中位数、标准差、最大最小值',
    category: '基础分析',
    needsGroup: false,
    minVars: 1,
    maxVars: 20,
    varType: 'numeric'
  },
  {
    id: 'ttest_independent',
    name: '独立样本 t 检验',
    icon: '⚖️',
    description: '比较两组独立样本的均值差异',
    category: '差异检验',
    needsGroup: true,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  },
  {
    id: 'ttest_paired',
    name: '配对样本 t 检验',
    icon: '🔄',
    description: '比较同一组对象前后两次测量的差异',
    category: '差异检验',
    needsGroup: false,
    minVars: 2,
    maxVars: 2,
    varType: 'numeric'
  },
  {
    id: 'anova',
    name: '单因素方差分析',
    icon: '📊',
    description: '比较多组样本的均值差异',
    category: '差异检验',
    needsGroup: true,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  },
  {
    id: 'chisquare',
    name: '卡方检验',
    icon: '🎲',
    description: '检验两个分类变量之间是否独立',
    category: '差异检验',
    needsGroup: false,
    minVars: 2,
    maxVars: 2,
    varType: 'string'
  },
  {
    id: 'correlation',
    name: '相关分析',
    icon: '🔗',
    description: '分析两个变量之间的线性关系',
    category: '关系分析',
    needsGroup: false,
    minVars: 2,
    maxVars: 2,
    varType: 'numeric'
  },
  {
    id: 'regression',
    name: '线性回归',
    icon: '📉',
    description: '建立因变量与自变量的回归方程',
    category: '关系分析',
    needsGroup: false,
    minVars: 2,
    maxVars: 10,
    varType: 'numeric'
  },
  {
    id: 'reliability',
    name: '信度分析',
    icon: '✅',
    description: "计算问卷量表的 Cronbach's α",
    category: '问卷分析',
    needsGroup: false,
    minVars: 2,
    maxVars: 50,
    varType: 'numeric'
  },
  {
    id: 'ttest_one',
    name: '单样本 t 检验',
    icon: '🎯',
    description: '检验样本均值是否等于某个指定值',
    category: '差异检验',
    needsGroup: false,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  },
  {
    id: 'normality',
    name: '正态性检验',
    icon: '🔔',
    description: 'Shapiro-Wilk 检验数据是否服从正态分布',
    category: '基础分析',
    needsGroup: false,
    minVars: 1,
    maxVars: 10,
    varType: 'numeric'
  },
  {
    id: 'nonparametric',
    name: '非参数检验',
    icon: '📊',
    description: 'Mann-Whitney U 检验，数据不满足正态假设时使用',
    category: '差异检验',
    needsGroup: true,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  },
  {
    id: 'frequency',
    name: '频数统计',
    icon: '📋',
    description: '统计分类变量各类别的频数和百分比',
    category: '基础分析',
    needsGroup: false,
    minVars: 1,
    maxVars: 10,
    varType: 'any'
  },
  {
    id: 'summary_by',
    name: '分类汇总',
    icon: '📊',
    description: '按分组变量计算均值、标准差等汇总统计',
    category: '基础分析',
    needsGroup: true,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  }
]

export default function WizardPage() {
  const { dataset, hasData, getNumericColumns, getStringColumns, getAllColumns } = useData()
  const { isConfigured } = useAI()

  const [step, setStep] = useState<WizardStep>('select')
  const [selectedMethod, setSelectedMethod] = useState<AnalysisMethod | null>(null)
  const [depVars, setDepVars] = useState<string[]>([])
  const [groupVar, setGroupVar] = useState<string>('')
  const [, setIsExecuting] = useState(false) // S8: 无 getter，步骤切换已覆盖加载状态
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [interpretation, setInterpretation] = useState<string>('')
  const [interpretLoading, setInterpretLoading] = useState(false)

  const resetWizard = useCallback(() => {
    setStep('select')
    setSelectedMethod(null)
    setDepVars([])
    setGroupVar('')
    setResult(null)
    setInterpretation('')
  }, [])

  const handleSelectMethod = (method: AnalysisMethod) => {
    setSelectedMethod(method)
    setDepVars([])
    setGroupVar('')
    setStep('configure')
  }

  const toggleVar = (varName: string) => {
    setDepVars((prev) =>
      prev.includes(varName) ? prev.filter((v) => v !== varName) : [...prev, varName]
    )
  }

  const canProceed = (): boolean => {
    if (!selectedMethod) return false
    if (depVars.length < selectedMethod.minVars) return false
    if (selectedMethod.needsGroup && !groupVar) return false
    return true
  }

  const handleExecute = async () => {
    if (!selectedMethod || !dataset) return

    setStep('execute')
    setIsExecuting(true)

    // 生成 CSV 数据，通过 IPC 传入主进程写入临时文件（修复 #3）
    const csv = datasetToCSV(dataset.headers, dataset.rows)
    const dataFile = 'data.csv'

    let code = ''
    const method = selectedMethod.id

    if (method === 'descriptive') {
      code = RService.descriptiveCode(depVars, dataFile)
    } else if (method === 'ttest_independent') {
      code = RService.tTestIndependentCode(depVars[0], groupVar, dataFile)
    } else if (method === 'ttest_paired') {
      code = RService.tTestPairedCode(depVars[0], depVars[1], dataFile)
    } else if (method === 'correlation') {
      code = RService.correlationCode(depVars[0], depVars[1], 'pearson', dataFile)
    } else if (method === 'regression') {
      code = RService.regressionCode(depVars[0], depVars.slice(1), dataFile)
    } else if (method === 'reliability') {
      code = RService.reliabilityCode(depVars, dataFile)
    } else if (method === 'chisquare') {
      code = RService.chiSquareCode(depVars[0], depVars[1], dataFile)
    } else if (method === 'anova') {
      code = RService.anovaCode(depVars[0], groupVar, dataFile)
    } else if (method === 'ttest_one') {
      code = RService.tTestOneSampleCode(depVars[0], 0, dataFile)
    } else if (method === 'normality') {
      code = RService.normalityTestCode(depVars, dataFile)
    } else if (method === 'nonparametric') {
      code = RService.nonparametricCode(depVars[0], groupVar, dataFile)
    } else if (method === 'frequency') {
      code = RService.frequencyCode(depVars, dataFile)
    } else if (method === 'summary_by') {
      code = RService.summaryByCode(groupVar, depVars[0], dataFile)
    }

    // 通过 IPC 传递 CSV，不在代码中内嵌（修复 #3）
    const execResult = await RService.execute(code, csv)

    setResult(execResult)

    // 自动触发 AI 解读
    if (execResult.success && execResult.output) {
      const parsed = parseROutput(execResult.output)
      if (parsed.tables.length > 0 && isConfigured) {
        setInterpretLoading(true)
        const interp = await generateInterpretation(parsed)
        setInterpretation(interp)
        setInterpretLoading(false)
      }
    }

    setIsExecuting(false)
    setStep('result')
  }

  // 获取可选变量列表
  const getAvailableVars = (): string[] => {
    if (!selectedMethod) return []
    if (selectedMethod.varType === 'numeric') return getNumericColumns()
    if (selectedMethod.varType === 'string') return getStringColumns()
    return getAllColumns()
  }

  // 按类别分组方法
  const categories = METHODS.reduce<Record<string, AnalysisMethod[]>>((acc, m) => {
    if (!acc[m.category]) acc[m.category] = []
    acc[m.category].push(m)
    return acc
  }, {})

  return (
    <div className="wizard-page">
      <div className="page-header">
        <h1>
          📊 向导式分析
          {selectedMethod && step !== 'select' && (
            <span style={{ fontWeight: 400, fontSize: 16, color: 'var(--text-secondary)', marginLeft: 12 }}>
              / {selectedMethod.icon} {selectedMethod.name}
            </span>
          )}
        </h1>
        <p>
          {step === 'select' && '选择适合你研究问题的统计分析方法'}
          {step === 'configure' && '选择要分析的变量'}
          {step === 'execute' && '正在执行分析...'}
          {step === 'result' && '分析结果'}
        </p>
      </div>

      <div className="page-body">
        {/* 步骤 1：选择分析方法 */}
        {step === 'select' && (
          <div className="animate-fade-in">
            {!hasData && (
              <div
                style={{
                  background: 'var(--warning-bg)',
                  border: '1px solid var(--warning)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  marginBottom: 20,
                  fontSize: 13
                }}
              >
                ⚠️ 请先在「数据管理」页面导入数据后再进行分析
              </div>
            )}
            {Object.entries(categories).map(([cat, methods]) => (
              <div key={cat} style={{ marginBottom: 28 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {cat}
                </h3>
                <div className="wizard-grid">
                  {methods.map((m) => (
                    <div
                      key={m.id}
                      className={`wizard-card ${selectedMethod?.id === m.id ? 'active' : ''}`}
                      onClick={() => handleSelectMethod(m)}
                      style={{ opacity: hasData ? 1 : 0.6 }}
                    >
                      <div className="wizard-card-icon">{m.icon}</div>
                      <div className="wizard-card-name">{m.name}</div>
                      <div className="wizard-card-desc">{m.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 步骤 2：配置变量 */}
        {step === 'configure' && selectedMethod && (
          <div className="animate-slide-up">
            <button className="btn btn-ghost btn-sm" onClick={resetWizard} style={{ marginBottom: 16 }}>
              ← 返回选择
            </button>

            <div className="var-section">
              <div className="var-section-title">
                {selectedMethod.needsGroup ? '选择因变量（数值型）' : `选择变量（${selectedMethod.minVars === selectedMethod.maxVars ? `选${selectedMethod.minVars}个` : `至少选${selectedMethod.minVars}个`}）`}
              </div>
              <div className="var-section-desc">
                {selectedMethod.id === 'regression'
                  ? '第一个变量为因变量，其余为自变量'
                  : selectedMethod.id === 'ttest_paired'
                  ? '选择两个配对变量'
                  : selectedMethod.id === 'correlation'
                  ? '选择两个变量分析相关性'
                  : '点击选择或取消变量'}
              </div>
              <div className="var-tags">
                {getAvailableVars().map((v) => (
                  <span
                    key={v}
                    className={`var-tag ${depVars.includes(v) ? 'selected' : ''} ${!depVars.includes(v) && depVars.length >= selectedMethod.maxVars ? 'disabled' : ''}`}
                    onClick={() => toggleVar(v)}
                  >
                    {v}
                  </span>
                ))}
                {getAvailableVars().length === 0 && (
                  <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                    没有符合条件的变量，请检查数据
                  </span>
                )}
              </div>
              <div className="var-count">
                已选 {depVars.length} / {selectedMethod.maxVars} 个变量
                {depVars.length > 0 && (
                  <span>：{depVars.join('、')}</span>
                )}
              </div>
            </div>

            {selectedMethod.needsGroup && (
              <div className="var-section">
                <div className="var-section-title">选择分组变量</div>
                <div className="var-section-desc">
                  选择一个分类变量作为分组依据（该变量应有2个或多个水平）
                </div>
                <div className="var-tags">
                  {getStringColumns().map((v) => (
                    <span
                      key={v}
                      className={`var-tag ${groupVar === v ? 'selected' : ''}`}
                      onClick={() => setGroupVar(v)}
                    >
                      {v}
                    </span>
                  ))}
                  {getNumericColumns()
                    .filter((v) => !depVars.includes(v))
                    .map((v) => (
                      <span
                        key={v}
                        className={`var-tag ${groupVar === v ? 'selected' : ''}`}
                        onClick={() => setGroupVar(v)}
                      >
                        {v}
                      </span>
                    ))}
                </div>
                {groupVar && (
                  <div className="var-count">分组变量：{groupVar}</div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleExecute}
                disabled={!canProceed()}
              >
                🚀 开始分析
              </button>
              <button className="btn btn-ghost" onClick={resetWizard}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* 步骤 3：执行中 */}
        {step === 'execute' && (
          <div className="empty-state animate-fade-in">
            <div style={{ fontSize: 48, marginBottom: 16, animation: 'spin 1s linear infinite' }}>⏳</div>
            <div className="empty-state-text">正在执行 {selectedMethod?.name}...</div>
            <div className="empty-state-hint">R 正在分析你的数据</div>
          </div>
        )}

        {/* 步骤 4：结果 */}
        {step === 'result' && result && selectedMethod && (
          <div className="animate-slide-up">
            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={resetWizard}>
                ← 重新分析
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => handleExecute()}>
                🔄 重新执行
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const output = result.output || result.errors.join('\n')
                  navigator.clipboard.writeText(output).then(() => alert('✅ 已复制原始输出'))
                }}
              >
                📋 复制原始输出
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const parsed = parseROutput(result.output || '')
                  const html = threeLineTableToHTML(parsed.tables, interpretation)
                  const plainText = parsed.tables.map((t) => {
                    const h = t.headers.join('\t')
                    const r = t.rows.map((row) => row.join('\t')).join('\n')
                    return `${t.title}\n${h}\n${r}\n${t.note || ''}`
                  }).join('\n\n') + (interpretation ? '\n\n' + interpretation : '')
                  try {
                    await window.api.clipboard.writeHtml(html, plainText)
                    alert('✅ 已复制，直接粘贴到 Word 即可保留三线表排版')
                  } catch {
                    navigator.clipboard.writeText(plainText).then(() => alert('已复制纯文本'))
                  }
                }}
              >
                📄 复制到 Word
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const parsed = parseROutput(result.output || '')
                  // 尝试用 OfficeCLI 生成 .docx
                  if (window.api?.officecli) {
                    const cli = await window.api.officecli.detect()
                    if (cli.found) {
                      const savePath = await window.api.dialog.saveFile({
                        defaultName: `${selectedMethod.name}_分析报告.docx`,
                        filters: [{ name: 'Word 文档', extensions: ['docx'] }]
                      })
                      if (savePath) {
                        const res = await window.api.officecli.generateDocx({
                          title: selectedMethod.name + ' 分析报告',
                          tables: parsed.tables,
                          interpretation,
                          savePath
                        })
                        if (res.success) {
                          alert('✅ Word 报告已生成：' + res.path)
                        } else {
                          alert('❌ 生成失败：' + res.error)
                        }
                      }
                      return
                    }
                  }
                  // 降级：导出 HTML 三线表报告
                  const html = threeLineTableToHTML(parsed.tables, interpretation)
                  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${selectedMethod.name}_分析报告.html`
                  a.click()
                  URL.revokeObjectURL(url)
                  alert('⚠️ OfficeCLI 未安装，已导出 HTML 格式。运行 download-officecli.bat 安装后可导出 Word 格式。')
                }}
              >
                📥 导出报告
              </button>
            </div>

            {/* 成功/失败提示 */}
            <div
              style={{
                background: result.success ? 'var(--success-bg)' : 'var(--error-bg)',
                border: `1px solid ${result.success ? 'var(--success)' : 'var(--error)'}`,
                borderRadius: 'var(--radius-md)',
                padding: 12,
                marginBottom: 16,
                fontSize: 14,
                fontWeight: 500
              }}
            >
              {result.success ? '✅ 分析完成' : '❌ 分析失败'}
            </div>

            {/* 三线表展示 */}
            {result.success && result.output && (() => {
              const parsed = parseROutput(result.output)
              if (parsed.tables.length > 0) {
                return (
                  <div style={{ marginBottom: 20 }}>
                    {parsed.tables.map((table, i) => (
                      <ThreeLineTable
                        key={i}
                        title={table.title}
                        headers={table.headers}
                        rows={table.rows}
                        note={table.note}
                      />
                    ))}
                  </div>
                )
              }
              return null
            })()}

            {/* 图表可视化 */}
            {selectedMethod && depVars.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>📊 可视化图表</h3>
                <PlotViewer
                  methodId={selectedMethod.id}
                  variables={depVars}
                  groupVar={groupVar || undefined}
                />
              </div>
            )}

            {/* AI 结果解读 */}
            {interpretLoading && (
              <div className="result-interpretation">
                <h4>📝 结果解读</h4>
                <p style={{ opacity: 0.6 }}>AI 正在生成结果解读...</p>
              </div>
            )}
            {interpretation && !interpretLoading && (
              <div className="result-interpretation">
                <h4>📝 结果解读</h4>
                <p>{interpretation}</p>
              </div>
            )}
            {!interpretation && !interpretLoading && result.success && !isConfigured && (
              <div
                style={{
                  background: 'var(--warning-bg)',
                  border: '1px solid var(--warning)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  marginBottom: 16,
                  fontSize: 13
                }}
              >
                💡 配置 AI API Key 后，可自动生成符合论文风格的结果解读
              </div>
            )}

            {/* 原始输出（折叠） */}
            <details style={{ marginTop: 16 }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'var(--text-tertiary)',
                  marginBottom: 8
                }}
              >
                查看 R 原始输出
              </summary>
              <div
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 16
                }}
              >
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                  <code>{result.output || result.errors.join('\n') || '(无输出)'}</code>
                </pre>
              </div>
            </details>

            {/* 使用提示 */}
            <div
              style={{
                background: 'var(--primary-bg)',
                border: '1px solid var(--primary)',
                borderRadius: 'var(--radius-md)',
                padding: 16,
                marginTop: 16,
                fontSize: 13
              }}
            >
              💡 <strong>提示：</strong>「📄 复制到 Word」可将三线表和解读直接粘贴到论文中；
              「📥 导出报告」可生成 Word 格式的完整分析报告。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
