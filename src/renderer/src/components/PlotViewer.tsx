import { useState } from 'react'
import { useData } from '../contexts/DataContext'
import { useAI } from '../contexts/AIContext'
import { RService } from '../services/rService'
import { generatePlotCode, METHOD_PLOT_MAP, type PlotConfig } from '../services/plotService'
import { datasetToCSV } from '../services/dataService'
import ThreeLineTable from './ThreeLineTable'
import { generateInterpretation } from '../services/interpretService'
import { parseROutput } from '../services/resultParser'

interface PlotViewerProps {
  /** 分析方法 ID */
  methodId: string
  /** 已选变量 */
  variables: string[]
  /** 分组变量 */
  groupVar?: string
}

export default function PlotViewer({ methodId, variables, groupVar }: PlotViewerProps) {
  const { dataset } = useData()
  const { isConfigured } = useAI()
  const [plotSrc, setPlotSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [interpretation, setInterpretation] = useState('')
  const [interpretLoading, setInterpretLoading] = useState(false)
  const [parsedTables, setParsedTables] = useState<Array<{ title?: string; headers: string[]; rows: (string | number)[][]; note?: string }>>([])

  const plots = METHOD_PLOT_MAP[methodId] || []

  if (plots.length === 0) return null

  const handleGeneratePlot = async (type: string) => {
    if (!dataset) return
    setSelectedType(type)
    setLoading(true)
    setError(null)
    setPlotSrc(null)

    try {
      const config: PlotConfig = {
        type,
        variables,
        groupVar,
        width: 6,
        height: 4
      }

      const code = generatePlotCode(config, 'data.csv')
      const csv = datasetToCSV(dataset.headers, dataset.rows)

      if (!window.api) {
        setError('API 未就绪')
        return
      }

      const result = await window.api.r.plot(code, csv)

      if (result.success && result.base64) {
        setPlotSrc(`data:image/png;base64,${result.base64}`)

        // 同时执行分析获取结果（S5: 复用 rService 生成器，与向导页保持一致）
      const analysisCode = generateAnalysisCode(methodId, variables, groupVar)
      if (analysisCode) {
        const analysisRes = await RService.execute(analysisCode, csv)
          if (analysisRes.success && analysisRes.output) {
            const parsed = parseROutput(analysisRes.output)
            setParsedTables(parsed.tables)
            if (parsed.tables.length > 0 && isConfigured) {
              setInterpretLoading(true)
              try {
                const interp = await generateInterpretation(parsed)
                setInterpretation(interp)
              } catch {
                setInterpretation('')
              } finally {
                setInterpretLoading(false)
              }
            }
          }
        }
      } else {
        setError(result.error || '图表生成失败')
      }
    } catch (e: unknown) {
      setError((e as Error).message || '生成失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      {/* 图表类型选择 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {plots.map((p) => (
          <button
            key={p.type}
            className={`btn btn-sm ${selectedType === p.type ? 'active' : 'btn-secondary'}`}
            onClick={() => handleGeneratePlot(p.type)}
            disabled={loading}
          >
            📊 {p.label}
          </button>
        ))}
      </div>

      {/* 加载状态 */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
          <div style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 24, marginBottom: 8 }}>⏳</div>
          <div>正在生成图表...</div>
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div style={{
          background: 'var(--error-bg)', border: '1px solid var(--error)',
          borderRadius: 'var(--radius-md)', padding: 12, marginBottom: 16, fontSize: 13, color: 'var(--error)'
        }}>
          ❌ {error}
        </div>
      )}

      {/* 图表展示 */}
      {plotSrc && (
        <div className="animate-slide-up">
          <div style={{
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: 16, textAlign: 'center'
          }}>
            <img
              src={plotSrc}
              alt="分析图表"
              style={{ maxWidth: '100%', height: 'auto', borderRadius: 'var(--radius-sm)' }}
            />
          </div>

          {/* 导出按钮 */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const link = document.createElement('a')
                link.download = `${methodId}_${selectedType}.png`
                link.href = plotSrc
                link.click()
              }}
            >
              💾 保存图片
            </button>
          </div>

          {/* 统计结果 */}
          {parsedTables.length > 0 && (
            <div style={{ marginTop: 20 }}>
              {parsedTables.map((table, i) => (
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
          {interpretLoading && (
            <div className="result-interpretation" style={{ marginTop: 12 }}>
              <h4>📝 结果解读</h4>
              <p style={{ opacity: 0.6 }}>正在生成...</p>
            </div>
          )}
          {interpretation && !interpretLoading && (
            <div className="result-interpretation" style={{ marginTop: 12 }}>
              <h4>📝 结果解读</h4>
              <p>{interpretation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 为图表配套生成分析代码（S5: 复用 rService 生成器，与向导页保持一致） */
function generateAnalysisCode(methodId: string, variables: string[], groupVar?: string): string | null {
  if (variables.length < 1) return null

  switch (methodId) {
    case 'descriptive':
      return RService.descriptiveCode(variables)
    case 'correlation':
      if (variables.length < 2) return null
      return RService.correlationCode(variables[0], variables[1])
    case 'ttest_independent':
      if (!groupVar || variables.length < 1) return null
      return RService.tTestIndependentCode(variables[0], groupVar)
    case 'ttest_paired':
      if (variables.length < 2) return null
      return RService.tTestPairedCode(variables[0], variables[1])
    case 'anova':
      if (!groupVar || variables.length < 1) return null
      return RService.anovaCode(variables[0], groupVar)
    case 'chi_square':
      if (variables.length < 2) return null
      return RService.chiSquareCode(variables[0], variables[1])
    case 'regression':
      if (variables.length < 2) return null
      return RService.regressionCode(variables[0], variables.slice(1))
    case 'reliability':
      return RService.reliabilityCode(variables)
    case 'frequency':
      return RService.frequencyCode(variables)
    default:
      return null
  }
}
