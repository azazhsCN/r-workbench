import { useState, useRef, useCallback } from 'react'
import { parseCSV, parseExcel, datasetToCSV, type ParseResult } from '../services/dataService'
import { useData } from '../contexts/DataContext'

export default function DataPage() {
  const { dataset: sharedDataset, setDataset: setSharedDataset } = useData()
  const [parseResult, setParseResult] = useState<ParseResult | null>(sharedDataset)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [manualInput, setManualInput] = useState(false)
  const [manualText, setManualText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** 更新本地和全局状态 */
  const updateData = useCallback((result: ParseResult | null) => {
    setParseResult(result)
    setSharedDataset(result)
  }, [setSharedDataset])

  const handleFileSelect = useCallback(async () => {
    if (window.api) {
      setIsLoading(true)
      setError('')
      try {
        // 一次性完成：选文件 + 读内容，路径不限
        const result = await window.api.dialog.readFile()
        if (!result) {
          setIsLoading(false)
          return
        }

        const { fileName, ext, content, buffer } = result

        if (ext === 'csv' && content) {
          updateData(parseCSV(content, fileName))
        } else if ((ext === 'xlsx' || ext === 'xls') && buffer) {
          updateData(parseExcel(buffer.buffer, fileName))
        } else if (ext === 'sav') {
          const savResult = await window.api.data.parseSav(result.filePath)
          if (savResult.success && savResult.headers && savResult.rows && savResult.columnInfo) {
            updateData({
              headers: savResult.headers,
              rows: savResult.rows as Record<string, unknown>[],
              columnInfo: savResult.columnInfo as unknown as import('../shared/types').ColumnInfo[],
              dataset: {
                name: savResult.meta?.name || fileName,
                columns: savResult.columnInfo as unknown as import('../shared/types').ColumnInfo[],
                rowCount: savResult.rows.length
              }
            })
          } else {
            setError(savResult.error || 'SPSS 文件解析失败')
          }
        } else {
          setError(`不支持的文件格式: .${ext}，请使用 CSV、Excel 或 SPSS 格式`)
        }
      } catch (err) {
        console.error('文件加载失败:', err)
        setError('文件加载失败，请检查文件格式是否正确')
      } finally {
        setIsLoading(false)
      }
    } else {
      fileInputRef.current?.click()
    }
  }, [updateData])

  const handleLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsLoading(true)
    setError('')
    try {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (ext === 'csv') {
        const text = await file.text()
        updateData(parseCSV(text, file.name))
      } else if (ext === 'xlsx' || ext === 'xls') {
        const buffer = await file.arrayBuffer()
        updateData(parseExcel(buffer, file.name))
      } else {
        setError(`不支持的文件格式: .${ext}`)
      }
    } catch {
      setError('文件读取失败')
    } finally {
      setIsLoading(false)
    }
  }

  const handleManualImport = () => {
    if (!manualText.trim()) return
    try {
      updateData(parseCSV(manualText, '手动输入数据'))
      setManualInput(false)
      setManualText('')
    } catch {
      setError('数据解析失败，请检查格式')
    }
  }

  const handleExportCSV = () => {
    if (!parseResult) return
    const csv = datasetToCSV(parseResult.headers, parseResult.rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${parseResult.dataset.name}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="data-page">
      <div className="page-header">
        <h1>📁 数据管理</h1>
        <p>导入和预览你的数据集，支持 CSV、Excel (.xlsx/.xls)、SPSS (.sav) 格式</p>
      </div>

      <div className="page-body">
        {/* 导入按钮区域 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <button className="btn btn-primary" onClick={handleFileSelect}>
            📂 导入文件
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setManualInput(!manualInput)}
          >
            ✏️ 手动输入
          </button>
          {parseResult && (
            <button className="btn btn-secondary" onClick={handleExportCSV}>
              💾 导出 CSV
            </button>
          )}
        </div>

        {/* 手动输入区域 */}
        {manualInput && (
          <div
            className="animate-slide-up"
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 16,
              marginBottom: 20
            }}
          >
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              粘贴 CSV 格式数据（第一行为列名）：
            </p>
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder={'姓名,年龄,成绩\n张三,20,85\n李四,21,92\n王五,20,78'}
              style={{
                width: '100%',
                height: 150,
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                resize: 'vertical'
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleManualImport}>
                导入
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setManualInput(false)}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div
            style={{
              background: 'var(--error-bg)',
              border: '1px solid var(--error)',
              borderRadius: 'var(--radius-md)',
              padding: 12,
              marginBottom: 16,
              fontSize: 13,
              color: 'var(--error)'
            }}
          >
            ❌ {error}
          </div>
        )}

        {/* 隐藏文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={handleLocalFile}
        />

        {/* 数据预览 */}
        {parseResult && (
          <div className="animate-slide-up">
            {/* 数据集信息卡 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 12,
                marginBottom: 20
              }}
            >
              <InfoCard label="数据集" value={parseResult.dataset.name} />
              <InfoCard label="行数" value={parseResult.rows.length.toString()} />
              <InfoCard label="列数" value={parseResult.headers.length.toString()} />
              <InfoCard
                label="数值列"
                value={parseResult.columnInfo
                  .filter((c) => c.type === 'numeric')
                  .length.toString()}
              />
              <InfoCard
                label="分类列"
                value={parseResult.columnInfo
                  .filter((c) => c.type === 'string')
                  .length.toString()}
              />
            </div>

            {/* 列信息 */}
            <h3
              style={{
                fontSize: 15,
                fontWeight: 600,
                marginBottom: 8,
                color: 'var(--text-primary)'
              }}
            >
              变量信息
            </h3>
            <div className="data-table-wrapper" style={{ marginBottom: 20, overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>变量名</th>
                    <th>类型</th>
                    <th>有效值</th>
                    <th>缺失值</th>
                    <th>缺失率</th>
                  </tr>
                </thead>
                <tbody>
                  {parseResult.columnInfo.map((col) => (
                    <tr key={col.name}>
                      <td style={{ fontWeight: 500 }}>{col.name}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 12,
                            background:
                              col.type === 'numeric'
                                ? 'var(--primary-bg)'
                                : 'var(--success-bg)',
                            color:
                              col.type === 'numeric'
                                ? 'var(--primary)'
                                : 'var(--success)'
                          }}
                        >
                          {col.type === 'numeric' ? '数值' : '分类'}
                        </span>
                      </td>
                      <td>{col.total - col.missing}</td>
                      <td style={{ color: col.missing > 0 ? 'var(--warning)' : 'inherit' }}>
                        {col.missing}
                      </td>
                      <td>
                        {col.total > 0
                          ? `${((col.missing / col.total) * 100).toFixed(1)}%`
                          : '0%'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 数据表格 */}
            <h3
              style={{
                fontSize: 15,
                fontWeight: 600,
                marginBottom: 8,
                color: 'var(--text-primary)'
              }}
            >
              数据预览
            </h3>
            <div className="data-table-wrapper" style={{ overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 50, textAlign: 'center' }}>#</th>
                    {parseResult.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parseResult.rows.slice(0, 200).map((row, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-tertiary)', textAlign: 'center' }}>
                        {i + 1}
                      </td>
                      {parseResult.headers.map((h) => (
                        <td key={h}>{String(row[h] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parseResult.rows.length > 200 && (
              <p
                style={{
                  textAlign: 'center',
                  padding: 12,
                  fontSize: 13,
                  color: 'var(--text-tertiary)'
                }}
              >
                显示前 200 行，共 {parseResult.rows.length} 行数据
              </p>
            )}
          </div>
        )}

        {/* 空状态 */}
        {!parseResult && !isLoading && (
          <div className="data-upload-zone" onClick={handleFileSelect}>
            <div className="data-upload-icon">📂</div>
            <div className="data-upload-text">点击导入数据文件</div>
            <div className="data-upload-hint">
              支持 CSV (.csv)、Excel (.xlsx/.xls) 格式
            </div>
          </div>
        )}

        {isLoading && (
          <div className="empty-state">
            <div className="empty-state-icon" style={{ animation: 'spin 1s linear infinite' }}>
              ⏳
            </div>
            <div className="empty-state-text">正在加载数据...</div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 信息卡片组件 */
function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px'
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  )
}
