import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  parseCSV,
  parseCSVBytes,
  parseExcel,
  datasetToCSV,
  type ParseResult,
  type ParseWarning
} from '../services/dataService'
import { toUint8Array, SUPPORTED_ENCODINGS, type SupportedEncoding } from '../services/decode'
import { useData } from '../contexts/DataContext'
import type { ColumnInfo } from '@shared/types'

/** 已本地化的警告代码（其余代码回退显示 papaparse 的原始英文消息） */
const KNOWN_WARNING_CODES = new Set([
  'moreWarnings',
  'csv.TooManyFields',
  'csv.TooFewFields',
  'csv.UndetectableDelimiter',
  'csv.MissingQuotes',
  'csv.InvalidQuotes',
  'csv.encodingLossy',
  'csv.emptyFile',
  'excel.blankHeader',
  'excel.duplicateHeader',
  'excel.formulaNoCache',
  'excel.errorCells',
  'excel.emptySheet',
  'excel.noRows',
  'excel.sheetNotFound'
])

/** 重新解析所需的原始输入（编码/工作表/缺失值选项变化时复用，无需重新选文件） */
interface RawSource {
  kind: 'csv' | 'excel' | 'manual' | 'sav'
  fileName: string
  bytes?: Uint8Array
  text?: string
  filePath?: string
}

/** 把异常翻译成可展示文案（主进程的"文件过大"等拒绝原因会原样附上） */
function errorText(err: unknown, fallback: string): string {
  const message = (err as { message?: string } | null)?.message
  return message ? `${fallback} (${message})` : fallback
}

export default function DataPage() {
  const { t } = useTranslation()
  const { dataset: sharedDataset, setDataset: setSharedDataset } = useData()
  const [parseResult, setParseResult] = useState<ParseResult | null>(sharedDataset)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [manualInput, setManualInput] = useState(false)
  const [manualText, setManualText] = useState('')
  const [encoding, setEncoding] = useState<SupportedEncoding | ''>('')
  const [sheetName, setSheetName] = useState('')
  const [spssSentinels, setSpssSentinels] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rawSourceRef = useRef<RawSource | null>(null)

  /** 更新本地和全局状态 */
  const updateData = useCallback((result: ParseResult | null) => {
    setParseResult(result)
    setSharedDataset(result)
  }, [setSharedDataset])

  /** 本地化导入警告 */
  const warningText = useCallback((warning: ParseWarning): string => {
    if (!KNOWN_WARNING_CODES.has(warning.code)) {
      return warning.message || warning.code
    }
    const params: Record<string, string | number> = {
      ...(warning.details ?? {}),
      row: warning.row ?? 0,
      count: warning.count ?? 0
    }
    if (typeof params.encoding === 'string') {
      params.encoding = t(`data.encoding.${params.encoding}`, { defaultValue: params.encoding })
    }
    return t(`data.warn.${warning.code}`, params)
  }, [t])

  /**
   * 用新的导入选项重新解析同一份原始数据。
   * 编码 / 工作表 / 缺失值哨兵的变化都不需要再选一次文件。
   */
  const reprocess = useCallback(async (overrides: {
    encoding?: SupportedEncoding | ''
    sheetName?: string
    spssSentinels?: boolean
  }) => {
    const source = rawSourceRef.current
    if (!source || source.kind === 'sav') return

    const nextEncoding = overrides.encoding !== undefined ? overrides.encoding : encoding
    const nextSheet = overrides.sheetName !== undefined ? overrides.sheetName : sheetName
    const nextSpss = overrides.spssSentinels !== undefined ? overrides.spssSentinels : spssSentinels

    setIsLoading(true)
    setError('')
    try {
      let next: ParseResult | null = null
      if (source.kind === 'csv' && source.bytes) {
        next = parseCSVBytes(source.bytes, source.fileName, {
          encoding: nextEncoding || undefined,
          spssSentinels: nextSpss
        })
      } else if (source.kind === 'excel' && source.bytes) {
        next = await parseExcel(source.bytes, source.fileName, {
          sheetName: nextSheet || undefined,
          spssSentinels: nextSpss
        })
      } else if (source.kind === 'manual' && source.text !== undefined) {
        next = parseCSV(source.text, source.fileName, { spssSentinels: nextSpss })
      }
      if (next) {
        updateData(next)
        if (next.sheets && next.sheets.length > 0) setSheetName(next.sheetName ?? '')
      }
    } catch (err) {
      setError(errorText(err, t('data.error.loadFailed')))
    } finally {
      setIsLoading(false)
    }
  }, [encoding, sheetName, spssSentinels, updateData, t])

  /** 导入 .sav（解析在主进程完成） */
  const applySav = useCallback(async (filePath: string, fileName: string) => {
    const savResult = await window.api.data.parseSav(filePath)
    if (savResult.success && savResult.headers && savResult.rows && savResult.columnInfo) {
      const columns = savResult.columnInfo as ColumnInfo[]
      updateData({
        headers: savResult.headers,
        rows: savResult.rows as Record<string, unknown>[],
        columnInfo: columns,
        dataset: {
          name: savResult.meta?.name || fileName,
          columns,
          rowCount: savResult.rows.length
        }
      })
    } else {
      setError(savResult.error || t('data.error.savParse'))
    }
  }, [updateData, t])

  const handleFileSelect = useCallback(async () => {
    if (!window.api) {
      fileInputRef.current?.click()
      return
    }
    setIsLoading(true)
    setError('')
    try {
      // 始终取原始字节：编码探测在渲染进程完成（GBK/GB18030 CSV 不能用
      // 主进程的 readFile(path, 'utf-8')，那会直接产生 U+FFFD 破坏列名）。
      const result = await window.api.dialog.readFile()
      if (!result) return

      const { fileName, ext, buffer, filePath } = result
      const bytes = toUint8Array(buffer)

      setEncoding('')
      setSheetName('')

      if (ext === 'csv') {
        if (!bytes) {
          setError(t('data.error.readFailed'))
          return
        }
        rawSourceRef.current = { kind: 'csv', fileName, bytes }
        updateData(parseCSVBytes(bytes, fileName, { spssSentinels }))
      } else if (ext === 'xlsx' || ext === 'xls') {
        if (!bytes) {
          setError(t('data.error.readFailed'))
          return
        }
        rawSourceRef.current = { kind: 'excel', fileName, bytes }
        const parsed = await parseExcel(bytes, fileName, { spssSentinels })
        updateData(parsed)
        setSheetName(parsed.sheetName ?? '')
      } else if (ext === 'sav') {
        rawSourceRef.current = { kind: 'sav', fileName, filePath }
        await applySav(filePath, fileName)
      } else {
        setError(t('data.error.unsupported', { ext }))
      }
    } catch (err) {
      console.error('文件加载失败:', err)
      setError(errorText(err, t('data.error.loadFailed')))
    } finally {
      setIsLoading(false)
    }
  }, [updateData, t, spssSentinels, applySav])

  /** 浏览器回退路径（无 window.api 时）——同样按字节解码 */
  const handleLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsLoading(true)
    setError('')
    try {
      const ext = file.name.split('.').pop()?.toLowerCase()
      setEncoding('')
      setSheetName('')
      if (ext === 'csv') {
        const bytes = new Uint8Array(await file.arrayBuffer())
        rawSourceRef.current = { kind: 'csv', fileName: file.name, bytes }
        updateData(parseCSVBytes(bytes, file.name, { spssSentinels }))
      } else if (ext === 'xlsx' || ext === 'xls') {
        const bytes = new Uint8Array(await file.arrayBuffer())
        rawSourceRef.current = { kind: 'excel', fileName: file.name, bytes }
        const parsed = await parseExcel(bytes, file.name, { spssSentinels })
        updateData(parsed)
        setSheetName(parsed.sheetName ?? '')
      } else {
        setError(t('data.error.unsupported', { ext }))
      }
    } catch (err) {
      setError(errorText(err, t('data.error.readFailed')))
    } finally {
      setIsLoading(false)
    }
  }

  const handleManualImport = () => {
    if (!manualText.trim()) return
    try {
      const name = t('data.manualInput.title')
      rawSourceRef.current = { kind: 'manual', fileName: name, text: manualText }
      updateData(parseCSV(manualText, name, { spssSentinels }))
      setManualInput(false)
      setManualText('')
    } catch {
      setError(t('data.error.parseFailed'))
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

  const encodingLabel = (value: string): string =>
    t(`data.encoding.${value}`, { defaultValue: value })

  /** 列类型徽章文案（注意 ColumnInfo 的 'string' 对应界面上的"分类"） */
  const typeLabel = (type: ColumnInfo['type']): string => {
    if (type === 'numeric') return t('data.colInfo.numeric')
    if (type === 'unknown') return t('data.colInfo.unknown')
    return t('data.colInfo.categorical')
  }

  const warnings = parseResult?.warnings ?? []
  const unknownColumns = parseResult?.columnInfo.filter((c) => c.type === 'unknown') ?? []
  const source = rawSourceRef.current
  const showImportOptions = parseResult !== null && source !== null && source.kind !== 'sav'
  const isExcelSource = source?.kind === 'excel'
  const isCsvSource = source?.kind === 'csv'

  return (
    <div className="data-page">
      <div className="page-header">
        <h1>📁 {t('data.title')}</h1>
        <p>{t('data.subtitle')}</p>
      </div>

      <div className="page-body">
        {/* 导入按钮区域 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <button className="btn btn-primary" onClick={handleFileSelect}>
            📂 {t('data.importFile')}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setManualInput(!manualInput)}
          >
            ✏️ {t('data.manualInput')}
          </button>
          {parseResult && (
            <button className="btn btn-secondary" onClick={handleExportCSV}>
              💾 {t('data.exportCsv')}
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
              {t('data.manualInput.hint')}
            </p>
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder={t('data.manualInput.placeholder')}
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
                {t('data.manualInput.import')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setManualInput(false)}>
                {t('data.manualInput.cancel')}
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

        {/* 导入选项：编码 / 工作表 / 缺失值哨兵 */}
        {showImportOptions && (
          <div
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 16,
              marginBottom: 20
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              {t('data.import.title')}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
              {isCsvSource && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{t('data.import.encoding')}</span>
                  <select
                    value={encoding}
                    onChange={(e) => {
                      const value = e.target.value as SupportedEncoding | ''
                      setEncoding(value)
                      void reprocess({ encoding: value })
                    }}
                  >
                    <option value="">{t('data.import.encoding.auto')}</option>
                    {SUPPORTED_ENCODINGS.map((enc) => (
                      <option key={enc} value={enc}>
                        {encodingLabel(enc)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {isExcelSource && (parseResult?.sheets?.length ?? 0) > 1 && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{t('data.import.sheet')}</span>
                  <select
                    value={sheetName}
                    onChange={(e) => {
                      setSheetName(e.target.value)
                      void reprocess({ sheetName: e.target.value })
                    }}
                  >
                    {(parseResult?.sheets ?? []).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={spssSentinels}
                  onChange={() => {
                    const next = !spssSentinels
                    setSpssSentinels(next)
                    void reprocess({ spssSentinels: next })
                  }}
                />
                <span>{t('data.import.sentinels.spss')}</span>
              </label>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10, lineHeight: 1.6 }}>
              {isCsvSource && parseResult?.encodingInfo && (
                <div>
                  {t('data.import.encoding.detected', {
                    encoding: encodingLabel(parseResult.encodingInfo.encoding)
                  })}
                  {' · '}
                  {t('data.import.encoding.hint')}
                </div>
              )}
              {isExcelSource && parseResult?.sheetName && (
                <div>{t('data.import.sheet.hint', { name: parseResult.sheetName })}</div>
              )}
              <div>{t('data.import.sentinels.hint')}</div>
            </div>

            {/* 按列列出被当作缺失值的真实取值：勾选 SPSS 惯例（99/999）后
                绝不能静默丢弃，否则用户不会发现自己的 99 分被吃掉了 */}
            {parseResult?.sentinelHits && parseResult.sentinelHits.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>
                  {t('data.import.sentinels.hits')}
                </div>
                <ul
                  style={{
                    margin: '4px 0 0',
                    paddingLeft: 18,
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.7
                  }}
                >
                  {parseResult.sentinelHits.slice(0, 50).map((hit) => (
                    <li key={`${hit.column}-${hit.sentinel}`}>
                      {t('data.import.sentinels.hit', {
                        column: hit.column,
                        count: hit.count,
                        value: hit.sentinel
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 导入警告 */}
        {warnings.length > 0 && (
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
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              ⚠️ {t('data.warnings.title', { count: warnings.length })}
            </div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
              {t('data.warnings.hint')}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {warnings.map((warning, i) => (
                <li key={`${warning.code}-${i}`}>{warningText(warning)}</li>
              ))}
            </ul>
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
              <InfoCard label={t('data.info.dataset')} value={parseResult.dataset.name} />
              <InfoCard label={t('data.info.rows')} value={parseResult.rows.length.toString()} />
              <InfoCard label={t('data.info.cols')} value={parseResult.headers.length.toString()} />
              <InfoCard
                label={t('data.info.numericCols')}
                value={parseResult.columnInfo
                  .filter((c) => c.type === 'numeric')
                  .length.toString()}
              />
              <InfoCard
                label={t('data.info.catCols')}
                value={parseResult.columnInfo
                  .filter((c) => c.type === 'string')
                  .length.toString()}
              />
              <InfoCard
                label={t('data.info.unknownCols')}
                value={unknownColumns.length.toString()}
              />
              {parseResult.encodingInfo && (
                <InfoCard
                  label={t('data.info.encoding')}
                  value={encodingLabel(parseResult.encodingInfo.encoding)}
                />
              )}
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
              {t('data.colInfo.title')}
            </h3>
            <div className="data-table-wrapper" style={{ marginBottom: 20, overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('data.colInfo.name')}</th>
                    <th>{t('data.colInfo.type')}</th>
                    <th>{t('data.colInfo.valid')}</th>
                    <th>{t('data.colInfo.missing')}</th>
                    <th>{t('data.colInfo.missingRate')}</th>
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
                                : col.type === 'unknown'
                                ? 'var(--warning-bg)'
                                : 'var(--success-bg)',
                            color:
                              col.type === 'numeric'
                                ? 'var(--primary)'
                                : col.type === 'unknown'
                                ? 'var(--warning)'
                                : 'var(--success)'
                          }}
                        >
                          {typeLabel(col.type)}
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

            {/* 未识别列说明：这类列不会出现在向导的变量选择中 */}
            {unknownColumns.length > 0 && (
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
                {t('data.colInfo.unknownHint', {
                  names: unknownColumns.map((c) => c.name).join('、')
                })}
              </div>
            )}

            {/* 数据表格 */}
            <h3
              style={{
                fontSize: 15,
                fontWeight: 600,
                marginBottom: 8,
                color: 'var(--text-primary)'
              }}
            >
              {t('data.preview.title')}
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
                {t('data.preview.showRows', { total: parseResult.rows.length })}
              </p>
            )}
          </div>
        )}

        {/* 空状态 */}
        {!parseResult && !isLoading && (
          <div className="data-upload-zone" onClick={handleFileSelect}>
            <div className="data-upload-icon">📂</div>
            <div className="data-upload-text">{t('data.empty.title')}</div>
            <div className="data-upload-hint">
              {t('data.empty.hint')}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="empty-state">
            <div className="empty-state-icon" style={{ animation: 'spin 1s linear infinite' }}>
              ⏳
            </div>
            <div className="empty-state-text">{t('data.loading')}</div>
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
