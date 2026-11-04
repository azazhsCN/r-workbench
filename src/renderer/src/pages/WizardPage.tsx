import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../contexts/DataContext'
import { useAI } from '../contexts/AIContext'
import { RService, type AnalysisResult } from '../services/rService'
import { datasetToCSV } from '../services/dataService'
import { parseROutput } from '../services/resultParser'
import { generateInterpretation } from '../services/interpretService'
import ThreeLineTable from '../components/ThreeLineTable'
import { threeLineTableToHTML } from '../components/threeLineTableUtils'
import PlotViewer from '../components/PlotViewer'
import { METHODS, type AnalysisMethod } from '../data/methodRegistry'

/** 向导步骤 */
type WizardStep = 'select' | 'configure' | 'execute' | 'result'



/**
 * 回退标签：仅在语言包缺少对应键时使用。
 * 注意这里已是英文，避免中文界面以外的用户看到中文
 * （v0.2.6 起 i18n 覆盖向导全部配置区）。
 *
 * **键必须是方法 id**（`METHODS[].id`），不是 nameKey 的末段，也不是别的拼法：
 * v0.3.0 里 `chisquare` 的键写成 `chi_square`、`summary_by` 写成 `summary`，
 * 而查找侧用 `nameKey.split('.').pop()` —— 两套命名一旦不同，回退就会静默失效
 * （表现为英文界面下看到中文名，且不易发现）。现在查找侧以 id 为准，见 `fallbackFor`。
 */
const FALLBACK_LABELS: Record<string, { name: string; desc: string; category: string }> = {
  descriptive: { name: 'Descriptive Statistics', desc: 'Mean, median, SD, min, max', category: 'Basic' },
  ttest_independent: { name: 'Independent-samples t-test', desc: 'Compare means of two independent groups', category: 'Difference tests' },
  ttest_paired: { name: 'Paired-samples t-test', desc: 'Compare two measurements on the same subjects', category: 'Difference tests' },
  anova: { name: 'One-way ANOVA', desc: 'Compare means across multiple groups', category: 'Difference tests' },
  chisquare: { name: 'Chi-square test', desc: 'Test independence of two categorical variables', category: 'Difference tests' },
  correlation: { name: 'Correlation', desc: 'Linear association between two variables', category: 'Relationship' },
  regression: { name: 'Linear regression', desc: 'Model a dependent variable from predictors', category: 'Relationship' },
  reliability: { name: 'Reliability', desc: "Cronbach's alpha for a scale", category: 'Survey' },
  efa: { name: 'Exploratory factor analysis', desc: 'KMO, Bartlett and factor loadings', category: 'Survey' },
  cfa: { name: 'Confirmatory factor analysis', desc: 'Test the factor structure of a scale', category: 'Survey' },
  cvi: { name: 'Content validity index', desc: 'I-CVI, S-CVI and modified kappa from expert ratings', category: 'Survey' },
  harman: { name: 'Harman single-factor test', desc: 'Unrotated PCA for common method bias', category: 'Survey' },
  ttest_one: { name: 'One-sample t-test', desc: 'Test a sample mean against a value', category: 'Difference tests' },
  normality: { name: 'Normality test', desc: 'Shapiro-Wilk test for normality', category: 'Basic' },
  nonparametric: { name: 'Nonparametric test', desc: 'Mann-Whitney U when normality fails', category: 'Difference tests' },
  frequency: { name: 'Frequency', desc: 'Counts and percentages of categories', category: 'Basic' },
  summary_by: { name: 'Summary by group', desc: 'Group-wise means and SDs', category: 'Basic' },
  // v0.3.2 因果链五方法
  mediation: { name: 'Mediation analysis', desc: 'Indirect effect of X on Y through M with bootstrap percentile CI', category: 'Causal' },
  moderation: { name: 'Moderation analysis', desc: 'Interaction of X and W on Y, ΔR² and simple slopes', category: 'Causal' },
  moderated_mediation: { name: 'Moderated mediation', desc: 'W moderates the X→M path: index of moderated mediation', category: 'Causal' },
  path_analysis: { name: 'Path analysis', desc: 'Equation-by-equation OLS with direct / indirect / total effects', category: 'Causal' },
  sem: { name: 'Structural equation modelling', desc: 'Joint ML estimation of measurement and structural models', category: 'Causal' }
}

/**
 * 解析 SEM 的「因子结构」文本 → `Record<因子名, 指标[]>`。
 *
 * 输入形如 `F1: i1, i2; F2: i3, i4`：
 *   - 顶层用分号分隔因子，`:` 或中文全角 `：` 分隔因子名与指标；
 *   - 指标之间用半角或全角逗号分隔，两端空白剔除、空项丢弃；
 *   - **同名因子合并**而不是覆盖：`F1: i1, i2; F1: i3` 得到 `F1: [i1, i2, i3]`。
 *     早期版本直接赋值，第二块会静默吃掉第一块（用户少填的指标不会报错，
 *     SEM 只是拟合了一个指标更少的模型）——正是 v0.3.2 要消灭的静默失败。
 *
 * 任何解析不出来的片段都**直接丢弃**（返回空对象的一部分），而不是猜一个默认因子名：
 * 猜错的因子结构会静默产出一份看起来正常的 SEM 结果。
 * 完全解析不出因子时由 `canProceed()` 拦下，用户看到的是「还不能开始」。
 */
function parseItemsByFactor(input: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const block of input.split(/[;；]/)) {
    const seg = block.trim()
    if (!seg) continue
    const idx = seg.search(/[:：]/)
    // idx <= 0 表示没有冒号，或因子名为空（`": i1, i2"`）
    if (idx <= 0) continue
    const factor = seg.slice(0, idx).trim()
    const items = seg
      .slice(idx + 1)
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!factor || items.length === 0) continue
    // 同名因子合并、指标去重（保留首次出现的顺序）。
    // 块内重复（`F1: i1, i1, i2`）与跨块重复（`F1: i1, i2; F1: i3`）都要处理：
    // 重复指标会让 R 端的测量模型矩阵出现重复列，拟合失败或载荷错位。
    const merged = out[factor] ?? []
    for (const item of items) {
      if (!merged.includes(item)) merged.push(item)
    }
    out[factor] = merged
  }
  return out
}

export default function WizardPage() {
  const { t } = useTranslation()
  const { dataset, hasData, getNumericColumns, getStringColumns, getAllColumns } = useData()
  const { isConfigured } = useAI()

  const [step, setStep] = useState<WizardStep>('select')
  const [selectedMethod, setSelectedMethod] = useState<AnalysisMethod | null>(null)
  const [depVars, setDepVars] = useState<string[]>([])
  const [groupVar, setGroupVar] = useState<string>('')
  const [mu, setMu] = useState<number>(0) // S9: 单样本 t 检验的检验值
  /** 相关分析的相关系数类型（v0.2.6：Spearman 此前在后端已支持但 UI 无法选择） */
  const [correlationMethod, setCorrelationMethod] = useState<'pearson' | 'spearman'>('pearson')
  /** CFA 的因子数（v0.3.1：auto = 由 EFA 特征值 > 1 自动判定；'1'..'4' 为强制指定） */
  const [cfaFactors, setCfaFactors] = useState<string>('auto')
  /**
   * 具名变量角色 → 变量名（v0.3.2）。
   *
   * 键是 `METHODS[].roles[].id`（'x' / 'm' / 'y' / 'w'），值是列名。
   * **这是 v0.3.2 的核心改造**：中介/调节类方法里变量含义由角色决定，不能靠位置。
   * `M = aX + e ; Y = c'X + bM + e` 中交换 X 与 M 会得到完全不同的模型，
   * 且错了不会报错——只会静默输出一个含义相反的结论。
   */
  const [roleVars, setRoleVars] = useState<Record<string, string>>({})
  /** `textInputs` 的文本参数（路径分析的路径列表、SEM 的因子结构与结构路径） */
  const [textValues, setTextValues] = useState<Record<string, string>>({})
  const [, setIsExecuting] = useState(false) // S8: 无 getter，步骤切换已覆盖加载状态
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [interpretation, setInterpretation] = useState<string>('')
  const [interpretLoading, setInterpretLoading] = useState(false)

  const resetWizard = useCallback(() => {
    setStep('select')
    setSelectedMethod(null)
    setDepVars([])
    setGroupVar('')
    setRoleVars({})
    setTextValues({})
    setResult(null)
    setInterpretation('')
  }, [])

  const handleSelectMethod = (method: AnalysisMethod) => {
    setSelectedMethod(method)
    setDepVars([])
    setGroupVar('')
    setRoleVars({})
    setTextValues({})
    setStep('configure')
  }

  const toggleVar = (varName: string) => {
    setDepVars((prev) =>
      prev.includes(varName) ? prev.filter((v) => v !== varName) : [...prev, varName]
    )
  }

  /** 具名角色选择：同一角色重复点同一变量 = 取消该角色（不做「已选则忽略」的静默行为） */
  const setRoleVar = (roleId: string, varName: string) => {
    setRoleVars((prev) => {
      const next = { ...prev }
      if (next[roleId] === varName) delete next[roleId]
      else next[roleId] = varName
      return next
    })
  }

  const setTextValue = (id: string, value: string) => {
    setTextValues((prev) => ({ ...prev, [id]: value }))
  }

  /**
   * 角色 id → 该角色选中的变量名；未选返回空串。
   *
   * 只对声明了 `roles` 的方法有意义。未声明的方法不会调用它
   * （进入配置页时 `roleVars` 已清空，两套语义不会混用）。
   */
  const roleValue = (roleId: string): string => roleVars[roleId] ?? ''

  /**
   * 能否进入「开始分析」。
   *
   * 三条互斥的变量口径（v0.3.2 起）：
   *   1. 声明 `roles` → 每个角色都必须选中（角色数即变量数，minVars/maxVars 不参与）；
   *   2. 否则照旧按 `depVars.length >= minVars` + `needsGroup`；
   *   3. 最后统一校验必填的 `textInputs` 非空。
   *
   * 第 1 条是硬约束：**不允许**用"已选够 3 个变量"来放行中介分析，
   * 那正是"看起来正常、含义相反"的静默错误来源。
   */
  const canProceed = (): boolean => {
    if (!selectedMethod) return false
    if (selectedMethod.roles && selectedMethod.roles.length > 0) {
      const allRolesFilled = selectedMethod.roles.every((r) => Boolean(roleValue(r.id)))
      if (!allRolesFilled) return false
    } else {
      if (depVars.length < selectedMethod.minVars) return false
      if (selectedMethod.needsGroup && !groupVar) return false
    }
    // 必填 textInputs：只校验"非空"，不校验格式——格式错误由 R 端给出可操作报错，
    // 在这里用正则猜一遍只会把合法输入（全角符号、多余空格）挡在外面。
    for (const ti of selectedMethod.textInputs ?? []) {
      if (!textValues[ti.id]?.trim()) return false
    }
    // 例外：SEM 的因子结构必须**至少解析出一个因子**才放行。
    // 只判"非空"不够——用户填了 `F1`（漏冒号）时文本非空但解析结果为空对象，
    // 那会生成一份测量模型为空的 R 代码。这里宁可先不许开始。
    if (selectedMethod.id === 'sem') {
      const parsed = parseItemsByFactor(textValues['itemsByFactor'] ?? '')
      if (Object.keys(parsed).length === 0) return false
    }
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

    // 生成器分发表：新增方法只需在此注册一行，避免 13 分支 if-else 链
    // （v0.2.6 技术债 #1：长 if-else 链是新增方法时的回归高发点）
    const generators: Record<string, () => string> = {
      descriptive: () => RService.descriptiveCode(depVars, dataFile),
      ttest_independent: () => RService.tTestIndependentCode(depVars[0], groupVar, dataFile),
      ttest_paired: () => RService.tTestPairedCode(depVars[0], depVars[1], dataFile),
      ttest_one: () => RService.tTestOneSampleCode(depVars[0], mu, dataFile),
      anova: () => RService.anovaCode(depVars[0], groupVar, dataFile),
      chisquare: () => RService.chiSquareCode(depVars[0], depVars[1], dataFile),
      correlation: () => RService.correlationCode(depVars[0], depVars[1], correlationMethod, dataFile),
      regression: () => RService.regressionCode(depVars[0], depVars.slice(1), dataFile),
      reliability: () => RService.reliabilityCode(depVars, dataFile),
      efa: () => RService.efaCode(depVars, undefined, dataFile),
      cfa: () => RService.cfaCode(depVars, cfaFactors === 'auto' ? undefined : Number(cfaFactors), dataFile),
      cvi: () => RService.cviCode(depVars, dataFile),
      harman: () => RService.harmanCode(depVars, dataFile),
      normality: () => RService.normalityTestCode(depVars, dataFile),
      nonparametric: () => RService.nonparametricCode(depVars[0], groupVar, dataFile),
      frequency: () => RService.frequencyCode(depVars, dataFile),
      summary_by: () => RService.summaryByCode(groupVar, depVars[0], dataFile),
      // v0.3.2 因果链：变量按**角色**取值（roleVars['x'] 等），不再靠 depVars 的位置。
      // 下面五行必须保持单行 —— method-registry.test.ts 用正则逐行静态解析这张表。
      mediation: () => RService.mediationCode(roleValue('x'), roleValue('m'), roleValue('y'), dataFile),
      moderation: () => RService.moderationCode(roleValue('x'), roleValue('w'), roleValue('y'), dataFile),
      moderated_mediation: () => RService.moderatedMediationCode(roleValue('x'), roleValue('m'), roleValue('y'), roleValue('w'), dataFile),
      path_analysis: () => RService.pathAnalysisCode(depVars, textValues['pathSpec'] ?? '', dataFile),
      sem: () => RService.semCode(parseItemsByFactor(textValues['itemsByFactor'] ?? ''), textValues['structure'] ?? '', dataFile),
      // v0.3.4：层次回归用 textValues['blockSpec'] 传区块规格（形如 "x1,x2 | x3,x4"）
      hierarchical_regression: () => RService.hierarchicalRegressionCode(depVars[0], textValues['blockSpec'] ?? '', dataFile),
      // v0.3.4：Logistic 回归，depVars[0] 为因变量，其余为自变量
      logistic_regression: () => RService.logisticRegressionCode(depVars[0], depVars.slice(1), dataFile)
    }
    const generate = generators[method]
    code = generate ? generate() : ''

    if (!code) {
      setResult({
        success: false,
        output: '',
        tables: [],
        plots: [],
        errors: [t('wizard.noGenerator', { method })],
        warnings: []
      })
      setIsExecuting(false)
      setStep('result')
      return
    }

    // 通过 IPC 传递 CSV，不在代码中内嵌（修复 #3）
    const execResult = await RService.execute(code, csv)

    setResult(execResult)

    // 自动触发 AI 解读
    if (execResult.success && execResult.output) {
      const parsed = parseROutput(execResult.output)
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

  // 按类别分组方法（技术债 #2：原实现每次渲染重复计算，改为 useMemo）
  const categories = useMemo(
    () =>
      METHODS.reduce<Record<string, AnalysisMethod[]>>((acc, m) => {
        if (!acc[m.category]) acc[m.category] = []
        acc[m.category].push(m)
        return acc
      }, {}),
    []
  )

  // 解析 R 输出一次，供三线表与诊断面板复用（避免重复解析）
  const parsedResult = useMemo(
    () => (result?.success && result.output ? parseROutput(result.output) : null),
    [result]
  )

  /**
   * 传给 `PlotViewer` 的变量列表（v0.3.2）。
   *
   * - 具名角色方法：按 `roles` 的声明顺序取各角色选中的变量 —— 顺序有意义（x→m→y），
   *   与生成器拿到的角色一致，图表侧的散点/折线才不会张冠李戴；
   * - 其余方法：沿用位置式的 `depVars`。
   *
   * 放在结果页渲染前计算，避免在 JSX 里写三目嵌套（也便于上面 `chartVars.length > 0` 判断）。
   */
  const chartVars = selectedMethod?.roles?.length
    ? selectedMethod.roles.map((r) => roleValue(r.id)).filter(Boolean)
    : depVars

  // 解析方法/描述/类别的本地化文本。
  // 语言包缺键时回退到英文标签（而不是中文 name/description），
  // 否则英文界面会出现中文方法名。
  // 回退键直接用方法 id：nameKey 的末段曾与 id 不一致（chisquare vs chi_square、
  // summary_by vs summary），导致回退静默失效。
  const fallbackFor = (m: AnalysisMethod) => FALLBACK_LABELS[m.id]
  const methodName = (m: AnalysisMethod) =>
    m.nameKey ? t(m.nameKey, { defaultValue: fallbackFor(m)?.name ?? m.name }) : m.name
  const methodDesc = (m: AnalysisMethod) =>
    m.descKey ? t(m.descKey, { defaultValue: fallbackFor(m)?.desc ?? m.description }) : m.description
  const categoryLabel = (c: string, m?: AnalysisMethod) => {
    const fb = m ? fallbackFor(m)?.category : undefined
    return m?.categoryKey ? t(m.categoryKey, { defaultValue: fb ?? c }) : c
  }

  return (
    <div className="wizard-page">
      <div className="page-header">
        <h1>
          📊 {t('wizard.title')}
          {selectedMethod && step !== 'select' && (
            <span style={{ fontWeight: 400, fontSize: 16, color: 'var(--text-secondary)', marginLeft: 12 }}>
              / {selectedMethod.icon} {methodName(selectedMethod)}
            </span>
          )}
        </h1>
        <p>
          {step === 'select' && t('wizard.step.select')}
          {step === 'configure' && t('wizard.step.configure')}
          {step === 'execute' && t('wizard.step.execute')}
          {step === 'result' && t('wizard.step.result')}
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
                ⚠️ {t('wizard.noData')}
              </div>
            )}
            {Object.entries(categories).map(([cat, methods]) => (
              <div key={cat} style={{ marginBottom: 28 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {categoryLabel(cat, methods[0])}
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
                      <div className="wizard-card-name">{methodName(m)}</div>
                      <div className="wizard-card-desc">{methodDesc(m)}</div>
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
              ← {t('wizard.backToSelect')}
            </button>

            {/* v0.3.2：声明了 roles 的方法按**角色**渲染，每个角色独立一块选择区。
                未声明的（含路径分析 / SEM 这类同质节点方法）走下面原有的位置式选择区。 */}
            {selectedMethod.roles && selectedMethod.roles.length > 0 ? (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    {t('wizard.roles.title')}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                    {t('wizard.roles.desc')}
                  </div>
                </div>
                {selectedMethod.roles.map((role) => {
                  const candidates =
                    role.varType === 'numeric' ? getNumericColumns() : getStringColumns()
                  const chosen = roleValue(role.id)
                  // 同一变量不能被两个角色同时占用：x 与 m 取了同一列，
                  // 中介模型就退化成"X 中介 X"，同样是不报错的静默错配。
                  // 已被**其他**角色占用的列渲染为禁用，点不动（先在原角色取消即可腾出）。
                  const takenByOthers = new Set(
                    selectedMethod.roles!
                      .filter((r) => r.id !== role.id)
                      .map((r) => roleValue(r.id))
                      .filter(Boolean)
                  )
                  return (
                    <div className="var-section" key={role.id}>
                      <div className="var-section-title">
                        {t(role.labelKey, { defaultValue: role.label })}
                      </div>
                      <div className="var-section-desc">
                        {role.descKey
                          ? t(role.descKey, { defaultValue: role.desc ?? '' })
                          : role.desc}
                      </div>
                      <div className="var-tags">
                        {candidates.map((v) => {
                          const taken = takenByOthers.has(v) && chosen !== v
                          return (
                            <span
                              key={v}
                              className={`var-tag ${chosen === v ? 'selected' : ''} ${taken ? 'disabled' : ''}`}
                              title={taken ? t('wizard.role.taken') : undefined}
                              onClick={() => {
                                if (!taken) setRoleVar(role.id, v)
                              }}
                            >
                              {v}
                            </span>
                          )
                        })}
                        {candidates.length === 0 && (
                          <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                            {t('wizard.noVarMatch')}
                          </span>
                        )}
                      </div>
                      <div className="var-count">
                        {chosen
                          ? t('wizard.role.selected', { name: chosen })
                          : t('wizard.role.unselected')}
                      </div>
                    </div>
                  )
                })}
              </>
            ) : (
              <div className="var-section">
                <div className="var-section-title">
                  {selectedMethod.needsGroup ? '选择因变量（数值型）' : `选择变量（${selectedMethod.minVars === selectedMethod.maxVars ? `选${selectedMethod.minVars}个` : `至少选${selectedMethod.minVars}个`}）`}
                </div>
                <div className="var-section-desc">
                  {selectedMethod.id === 'regression'
                    ? t('wizard.depVarHint')
                    : selectedMethod.id === 'ttest_paired'
                    ? t('wizard.pairedHint')
                    : selectedMethod.id === 'correlation'
                    ? t('wizard.corrHint')
                    : t('wizard.clickSelect')}
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
                      {t('wizard.noVarMatch')}
                    </span>
                  )}
                </div>
                <div className="var-count">
                  {t('wizard.selectedCount', { selected: depVars.length, max: selectedMethod.maxVars })}
                  {depVars.length > 0 && (
                    <span>：{depVars.join('、')}</span>
                  )}
                </div>
              </div>
            )}

            {selectedMethod.needsGroup && (
              <div className="var-section">
                <div className="var-section-title">{t('wizard.selectGroupVar')}</div>
                <div className="var-section-desc">
                  {t('wizard.selectGroupVar.desc')}
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
                  <div className="var-count">{t('wizard.groupVarLabel', { name: groupVar })}</div>
                )}
              </div>
            )}

            {/* S9: 单样本 t 检验需要指定检验值 */}
            {selectedMethod.id === 'ttest_one' && (
              <div className="var-section">
                <div className="var-section-title">{t('wizard.specifyMu')}</div>
                <div className="var-section-desc">{t('wizard.specifyMu.desc')}</div>
                <input
                  type="number"
                  value={mu}
                  onChange={(e) => setMu(Number(e.target.value))}
                  style={{ width: 200, padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}
                />
              </div>
            )}

            {/* v0.2.6: 相关系数类型选择（后端早已支持 Spearman，此前 UI 无法选择） */}
            {selectedMethod.id === 'correlation' && (
              <div className="var-section">
                <div className="var-section-title">{t('wizard.corrMethod')}</div>
                <div className="var-section-desc">{t('wizard.corrMethod.desc')}</div>
                <div className="var-tags">
                  <span
                    className={`var-tag ${correlationMethod === 'pearson' ? 'selected' : ''}`}
                    onClick={() => setCorrelationMethod('pearson')}
                  >
                    Pearson
                  </span>
                  <span
                    className={`var-tag ${correlationMethod === 'spearman' ? 'selected' : ''}`}
                    onClick={() => setCorrelationMethod('spearman')}
                  >
                    Spearman
                  </span>
                </div>
              </div>
            )}

            {/* v0.3.1: CFA 因子数（auto = 按 Kaiser 准则自动判定） */}
            {selectedMethod.id === 'cfa' && (
              <div className="var-section">
                <div className="var-section-title">{t('wizard.cfaFactors')}</div>
                <div className="var-section-desc">{t('wizard.cfaFactors.desc')}</div>
                <div className="var-tags">
                  {(selectedMethod.options?.find((o) => o.id === 'cfaFactors')?.values ?? []).map(
                    (v) => (
                      <span
                        key={v.value}
                        className={`var-tag ${cfaFactors === v.value ? 'selected' : ''}`}
                        onClick={() => setCfaFactors(v.value)}
                      >
                        {t(v.labelKey, { defaultValue: v.label })}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {/* v0.3.2：文本型结构参数（路径列表 / SEM 因子结构与结构路径）。
                这类结构无法用枚举表达，只能让用户填文本；值为空时 canProceed() 拦下。 */}
            {(selectedMethod.textInputs ?? []).map((ti) => (
              <div className="var-section" key={ti.id}>
                <div className="var-section-title">
                  {t(ti.labelKey, { defaultValue: ti.label })}
                </div>
                {ti.descKey && (
                  <div className="var-section-desc">
                    {t(ti.descKey, { defaultValue: ti.desc ?? '' })}
                  </div>
                )}
                <input
                  type="text"
                  value={textValues[ti.id] ?? ''}
                  placeholder={ti.placeholder}
                  onChange={(e) => setTextValue(ti.id, e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: 520,
                    padding: '6px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)'
                  }}
                />
              </div>
            ))}

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleExecute}
                disabled={!canProceed()}
              >
                🚀 {t('wizard.start')}
              </button>
              <button className="btn btn-ghost" onClick={resetWizard}>
                {t('wizard.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* 步骤 3：执行中 */}
        {step === 'execute' && (
          <div className="empty-state animate-fade-in">
            <div style={{ fontSize: 48, marginBottom: 16, animation: 'spin 1s linear infinite' }}>⏳</div>
            <div className="empty-state-text">{t('wizard.executing', { name: selectedMethod ? methodName(selectedMethod) : '' })}</div>
            <div className="empty-state-hint">{t('wizard.executingHint')}</div>
          </div>
        )}

        {/* 步骤 4：结果 */}
        {step === 'result' && result && selectedMethod && (
          <div className="animate-slide-up">
            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={resetWizard}>
                ← {t('wizard.reanalyze')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => handleExecute()}>
                🔄 {t('wizard.reexecute')}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const output = result.output || result.errors.join('\n')
                  navigator.clipboard.writeText(output).then(() => alert(t('wizard.copied.raw')))
                }}
              >
                📋 {t('wizard.copyOutput')}
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
                    alert(t('wizard.copied.word'))
                  } catch {
                    navigator.clipboard.writeText(plainText).then(() => alert(t('wizard.copied.plain')))
                  }
                }}
              >
                📄 {t('wizard.copyToWord')}
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
                        defaultName: t('wizard.report.defaultName', { method: methodName(selectedMethod) }),
                        filters: [{ name: t('wizard.report.filterWord'), extensions: ['docx'] }]
                      })
                      if (savePath) {
                        const res = await window.api.officecli.generateDocx({
                          title: t('wizard.report.title', { method: methodName(selectedMethod) }),
                          tables: parsed.tables,
                          interpretation,
                          savePath
                        })
                        if (res.success) {
                          alert(t('wizard.report.saved', { path: res.path }))
                        } else {
                          alert(t('wizard.report.failed', { error: res.error }))
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
                  a.download = t('wizard.report.defaultName', { method: methodName(selectedMethod) }).replace('.docx', '.html')
                  a.click()
                  URL.revokeObjectURL(url)
                  alert(t('wizard.report.officecliOffline'))
                }}
              >
                📥 {t('wizard.exportReport')}
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
              {result.success ? t('wizard.analyzeDone') : t('wizard.analyzeFailed')}
            </div>

            {/* 三线表展示 */}
            {parsedResult && parsedResult.tables.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                {parsedResult.tables.map((table, i) => (
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

            {/* 诊断信息（v0.2.6 新增）：假设检验、效应量、反向计分、R 警告 */}
            {(() => {
              const diags = parsedResult?.diagnostics ?? []
              const rWarnings = result.warnings ?? []
              if (diags.length === 0 && rWarnings.length === 0) return null
              return (
                <div className="result-diagnostics">
                  <h4>{t('wizard.diagnostics.title')}</h4>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
                    {diags.map((d, i) => (
                      <li key={`d${i}`} className={`diag-${d.kind}`}>
                        <strong>{d.label}：</strong>
                        <span>{d.value}</span>
                      </li>
                    ))}
                    {rWarnings.map((w, i) => (
                      <li key={`w${i}`} className="diag-warning">
                        <strong>{t('wizard.diagnostics.rWarning')}：</strong>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })()}

            {/* 图表可视化。
                v0.3.2：变量来源按方法类型分叉 —— 具名角色方法传角色里选中的变量（按角色声明顺序），
                其余方法仍传位置式的 depVars。PlotViewer 只按 `variables[]` 画图，
                拿不到角色语义，所以对中介/调节类它只能画"两两散点"这类通用图；
                配对的统计表由 generateAnalysisCode 那边显式返回 null（原因写在注释里）。 */}
            {chartVars.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{t('wizard.chart.title')}</h3>
                <PlotViewer
                  methodId={selectedMethod.id}
                  variables={chartVars}
                  groupVar={groupVar || undefined}
                />
              </div>
            )}

            {/* v0.3.2：因果链方法的前置提示 —— 中介/调节的前提是测量工具本身站得住 */}
            {selectedMethod && selectedMethod.categoryKey === 'wizard.category.causal' && (
              <div
                style={{
                  background: 'var(--primary-bg)',
                  border: '1px solid var(--primary)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  marginTop: 16,
                  fontSize: 13
                }}
              >
                💡 {t('wizard.causalHint')}
              </div>
            )}

            {/* AI 结果解读 */}
            {interpretLoading && (
              <div className="result-interpretation">
                <h4>{t('wizard.interpretation.title')}</h4>
                <p style={{ opacity: 0.6 }}>{t('wizard.interpretation.generating')}</p>
              </div>
            )}
            {interpretation && !interpretLoading && (
              <div className="result-interpretation">
                <h4>{t('wizard.interpretation.title')}</h4>
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
                💡 {t('wizard.interpretation.hint')}
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
                {t('wizard.viewROutput')}
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
                  <code>{result.output || result.errors.join('\n') || t('wizard.noOutput')}</code>
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
              💡 <strong>{t('common.tip')}:</strong>{t('wizard.tip.copy')}
              {t('wizard.tip.export')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
