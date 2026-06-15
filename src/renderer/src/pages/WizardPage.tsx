import { useState, useCallback } from 'react'
import { useData } from '../contexts/DataContext'
import { RService, type AnalysisResult } from '../services/rService'
import { datasetToCSV } from '../services/dataService'
import { generateHTMLReport, type AnalysisRecord } from '../services/reportService'

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
  }
]

export default function WizardPage() {
  const { dataset, hasData, getNumericColumns, getStringColumns, getAllColumns } = useData()

  const [step, setStep] = useState<WizardStep>('select')
  const [selectedMethod, setSelectedMethod] = useState<AnalysisMethod | null>(null)
  const [depVars, setDepVars] = useState<string[]>([])
  const [groupVar, setGroupVar] = useState<string>('')
  const [, setIsExecuting] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)

  const resetWizard = useCallback(() => {
    setStep('select')
    setSelectedMethod(null)
    setDepVars([])
    setGroupVar('')
    setResult(null)
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

    // 生成 CSV 数据
    const csv = datasetToCSV(dataset.headers, dataset.rows)

    // 写入临时 CSV（通过 R 执行时使用）
    const dataFile = 'data.csv'

    // 生成 R 代码
    let code = ''
    const method = selectedMethod.id

    if (method === 'descriptive') {
      code = RService.descriptiveCode(depVars, dataFile)
    } else if (method === 'ttest_independent') {
      code = RService.tTestIndependentCode(depVars[0], groupVar, dataFile)
    } else if (method === 'ttest_paired') {
      code = `
data <- read.csv("${dataFile}", stringsAsFactors = FALSE)
x1 <- as.numeric(data[["${depVars[0]}"]])
x2 <- as.numeric(data[["${depVars[1]}"]])
cat("=== 配对样本 t 检验 ===\\n")
cat("变量1: ${depVars[0]}\\n")
cat("变量2: ${depVars[1]}\\n\\n")
result <- t.test(x1, x2, paired = TRUE)
cat(sprintf("t = %.4f, df = %.2f, p = %.4f\\n", result$statistic, result$parameter, result$p.value))
cat(sprintf("均值差: %.4f\\n", mean(x1 - x2, na.rm = TRUE)))
cat(sprintf("95%% CI: [%.4f, %.4f]\\n", result$conf.int[1], result$conf.int[2]))
`
    } else if (method === 'correlation') {
      code = RService.correlationCode(depVars[0], depVars[1], 'pearson', dataFile)
    } else if (method === 'regression') {
      const dvs = depVars.slice(1)
      code = RService.regressionCode(depVars[0], dvs, dataFile)
    } else if (method === 'reliability') {
      code = RService.reliabilityCode(depVars, dataFile)
    } else if (method === 'chisquare') {
      code = `
data <- read.csv("${dataFile}", stringsAsFactors = FALSE)
cat("=== 卡方检验 ===\\n")
cat("变量1: ${depVars[0]}\\n")
cat("变量2: ${depVars[1]}\\n\\n")
tbl <- table(data[["${depVars[0]}"]], data[["${depVars[1]}"]])
cat("列联表:\\n")
print(tbl)
cat("\\n")
result <- chisq.test(tbl)
print(result)
if(result$p.value < 0.05) {
  cat("\\n结论: 两个变量之间存在显著关联 (p < 0.05)\\n")
} else {
  cat("\\n结论: 两个变量之间不存在显著关联 (p >= 0.05)\\n")
}
`
    } else if (method === 'anova') {
      code = `
data <- read.csv("${dataFile}", stringsAsFactors = FALSE)
cat("=== 单因素方差分析 ===\\n")
cat("因变量: ${depVars[0]}\\n")
cat("分组变量: ${groupVar}\\n\\n")
data[["${depVars[0]}"]] <- as.numeric(data[["${depVars[0]}"]])
model <- aov(${depVars[0]} ~ factor(${groupVar}), data = data)
result <- summary(model)
cat("方差分析表:\\n")
print(result)
cat("\\n")
groups <- unique(data[["${groupVar}"]])
for(g in groups) {
  x <- data[data[["${groupVar}"]] == g, "${depVars[0]}"]
  cat(sprintf("组 %s: N=%d, M=%.4f, SD=%.4f\\n", g, length(x), mean(x, na.rm=TRUE), sd(x, na.rm=TRUE)))
}
`
    }

    // 执行 R 代码（注意：数据需要先写入临时文件）
    // 这里简化处理，使用 RService.execute
    const execResult = await RService.execute(
      `data <- read.csv(textConnection("${csv.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"), stringsAsFactors = FALSE)\n` + code
    )

    setResult(execResult)
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
                      className="wizard-card"
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

            <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                {selectedMethod.needsGroup ? '选择因变量（数值型）' : `选择变量（${selectedMethod.minVars === selectedMethod.maxVars ? `选${selectedMethod.minVars}个` : `至少选${selectedMethod.minVars}个`}）`}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {selectedMethod.id === 'regression'
                  ? '第一个变量为因变量，其余为自变量'
                  : selectedMethod.id === 'ttest_paired'
                  ? '选择两个配对变量'
                  : selectedMethod.id === 'correlation'
                  ? '选择两个变量分析相关性'
                  : '点击选择/取消变量'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {getAvailableVars().map((v) => (
                  <button
                    key={v}
                    className={`btn btn-sm ${depVars.includes(v) ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => toggleVar(v)}
                    disabled={!depVars.includes(v) && depVars.length >= selectedMethod.maxVars}
                  >
                    {v}
                  </button>
                ))}
                {getAvailableVars().length === 0 && (
                  <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                    没有符合条件的变量，请检查数据
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
                已选: {depVars.length} / {selectedMethod.maxVars} 个变量
              </div>
            </div>

            {selectedMethod.needsGroup && (
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>选择分组变量</h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  选择一个分类变量作为分组依据（该变量应有2个或多个水平）
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {getStringColumns().map((v) => (
                    <button
                      key={v}
                      className={`btn btn-sm ${groupVar === v ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setGroupVar(v)}
                    >
                      {v}
                    </button>
                  ))}
                  {/* 也允许选择取值较少的数值型变量作为分组 */}
                  {getNumericColumns()
                    .filter((v) => !depVars.includes(v))
                    .map((v) => (
                      <button
                        key={v}
                        className={`btn btn-sm ${groupVar === v ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setGroupVar(v)}
                      >
                        {v}
                      </button>
                    ))}
                </div>
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
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
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
                  navigator.clipboard.writeText(output).then(() => alert('已复制到剪贴板'))
                }}
              >
                📋 复制结果
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const record: AnalysisRecord = {
                    id: `r-${Date.now()}`,
                    method: selectedMethod.id,
                    methodName: selectedMethod.name,
                    variables: depVars,
                    groupVar: groupVar || undefined,
                    output: result.output || result.errors.join('\n'),
                    timestamp: Date.now()
                  }
                  const html = generateHTMLReport([record])
                  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${selectedMethod.name}_分析报告.html`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                📄 导出报告
              </button>
            </div>

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

            <div
              style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 20
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📊 输出结果</h3>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                <code>{result.output || result.errors.join('\n') || '(无输出)'}</code>
              </pre>
            </div>

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
              💡 <strong>提示：</strong>你可以点击「复制结果」将统计结果粘贴到论文中，
              或点击「导出报告」生成 HTML 格式的分析报告（可用 Word 打开编辑）。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
