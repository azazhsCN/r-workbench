/**
 * 向导方法注册表。
 *
 * 拆分原因：`react-refresh/only-export-components` 要求 React 组件文件只导出
 * 组件。`METHODS` 是纯数据（被 WizardPage 渲染、被测试做一致性校验），抽到纯
 * TS 文件后 Fast Refresh 局部热更新恢复有效。
 *
 * **每个方法新增要改的地方**（与 `method-registry.test.ts` 的一致性断言对应）：
 *   1. `METHODS` 数组（本文件）
 *   2. `RService` 中的生成器函数
 *   3. `WizardPage.tsx` 中的 `generators` 分发表
 *   4. `plotService.ts` 的 `METHOD_PLOT_MAP` 推荐图表
 *   5. `i18n/locales/{zh-CN,en-US}.json` 的方法名与描述
 *   6. `scripts/validate/generate_fixtures.mjs` 与 `run_validation.R`
 * 缺一即测试红。
 */

export interface AnalysisMethod {
  id: string
  name: string
  nameKey?: string
  icon: string
  description: string
  descKey?: string
  category: string
  categoryKey?: string
  needsGroup: boolean
  minVars: number
  maxVars: number
  varType: 'numeric' | 'string' | 'any'
  /** 该方法的可选参数（v0.2.6：相关分析可选择 Pearson / Spearman） */
  options?: {
    id: string
    labelKey: string
    label: string
    values: { value: string; labelKey: string; label: string }[]
  }[]
}

export const METHODS: AnalysisMethod[] = [
  {
    id: 'descriptive',
    name: '描述性统计',
    nameKey: 'wizard.method.descriptive',
    icon: '📈',
    description: '计算均值、中位数、标准差、最大最小值',
    descKey: 'wizard.method.descriptive.desc',
    category: '基础分析',
    categoryKey: 'wizard.category.basic',
    needsGroup: false,
    minVars: 1,
    maxVars: 20,
    varType: 'numeric'
  },
  {
    id: 'ttest_independent',
    name: '独立样本 t 检验',
    nameKey: 'wizard.method.ttest_independent',
    icon: '⚖️',
    description: '比较两组独立样本的均值差异',
    descKey: 'wizard.method.ttest_independent.desc',
    category: '差异检验',
    categoryKey: 'wizard.category.diff',
    needsGroup: true,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  },
  {
    id: 'ttest_paired',
    name: '配对样本 t 检验',
    nameKey: 'wizard.method.ttest_paired',
    icon: '🔗',
    description: '比较同一组被试前后两次测量的差异',
    descKey: 'wizard.method.ttest_paired.desc',
    category: '差异检验',
    categoryKey: 'wizard.category.diff',
    needsGroup: false,
    minVars: 2,
    maxVars: 2,
    varType: 'numeric'
  },
  {
    id: 'anova',
    name: '单因素方差分析',
    nameKey: 'wizard.method.anova',
    icon: '📊',
    description: '比较多组样本的均值差异（ANOVA）',
    descKey: 'wizard.method.anova.desc',
    category: '差异检验',
    categoryKey: 'wizard.category.diff',
    needsGroup: true,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  },
  {
    id: 'chisquare',
    name: '卡方检验',
    nameKey: 'wizard.method.chisquare',
    icon: '🔢',
    description: '检验两个分类变量之间的关联',
    descKey: 'wizard.method.chisquare.desc',
    category: '差异检验',
    categoryKey: 'wizard.category.diff',
    needsGroup: false,
    minVars: 2,
    maxVars: 2,
    varType: 'string'
  },
  {
    id: 'correlation',
    name: '相关分析',
    nameKey: 'wizard.method.correlation',
    icon: '📉',
    description: '分析两个变量之间的线性关系',
    descKey: 'wizard.method.correlation.desc',
    category: '关系分析',
    categoryKey: 'wizard.category.rel',
    needsGroup: false,
    minVars: 2,
    maxVars: 2,
    varType: 'numeric',
    options: [
      {
        id: 'correlationMethod',
        labelKey: 'wizard.option.correlationMethod',
        label: '相关方法',
        values: [
          { value: 'pearson', labelKey: 'wizard.option.pearson', label: 'Pearson' },
          { value: 'spearman', labelKey: 'wizard.option.spearman', label: 'Spearman' }
        ]
      }
    ]
  },
  {
    id: 'regression',
    name: '线性回归',
    nameKey: 'wizard.method.regression',
    icon: '📐',
    description: '建立因变量与自变量的回归方程',
    descKey: 'wizard.method.regression.desc',
    category: '关系分析',
    categoryKey: 'wizard.category.rel',
    needsGroup: false,
    minVars: 2,
    maxVars: 10,
    varType: 'numeric'
  },
  {
    id: 'reliability',
    name: '信度分析',
    nameKey: 'wizard.method.reliability',
    icon: '✅',
    description: "计算问卷量表的 Cronbach's α",
    descKey: 'wizard.method.reliability.desc',
    category: '问卷分析',
    categoryKey: 'wizard.category.survey',
    needsGroup: false,
    minVars: 2,
    maxVars: 50,
    varType: 'numeric'
  },
  {
    id: 'efa',
    name: '探索性因子分析',
    nameKey: 'wizard.method.efa',
    icon: '🧩',
    description: '检验量表结构效度：KMO、Bartlett 球形检验与因子载荷',
    descKey: 'wizard.method.efa.desc',
    category: '问卷分析',
    categoryKey: 'wizard.category.survey',
    needsGroup: false,
    minVars: 3,
    maxVars: 50,
    varType: 'numeric'
  },
  {
    id: 'ttest_one',
    name: '单样本 t 检验',
    nameKey: 'wizard.method.ttest_one',
    icon: '🎯',
    description: '检验样本均值是否等于某个指定值',
    descKey: 'wizard.method.ttest_one.desc',
    category: '差异检验',
    categoryKey: 'wizard.category.diff',
    needsGroup: false,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  },
  {
    id: 'normality',
    name: '正态性检验',
    nameKey: 'wizard.method.normality',
    icon: '🔔',
    description: 'Shapiro-Wilk 检验数据是否服从正态分布',
    descKey: 'wizard.method.normality.desc',
    category: '基础分析',
    categoryKey: 'wizard.category.basic',
    needsGroup: false,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  },
  {
    id: 'nonparametric',
    name: '非参数检验',
    nameKey: 'wizard.method.nonparametric',
    icon: '📊',
    description: 'Mann-Whitney U 检验，数据不满足正态假设时使用',
    descKey: 'wizard.method.nonparametric.desc',
    category: '差异检验',
    categoryKey: 'wizard.category.diff',
    needsGroup: true,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  },
  {
    id: 'frequency',
    name: '频数统计',
    nameKey: 'wizard.method.frequency',
    icon: '🔢',
    description: '统计分类变量各类别的频数和百分比',
    descKey: 'wizard.method.frequency.desc',
    category: '基础分析',
    categoryKey: 'wizard.category.basic',
    needsGroup: false,
    minVars: 1,
    maxVars: 10,
    varType: 'string'
  },
  {
    id: 'summary_by',
    name: '分类汇总',
    nameKey: 'wizard.method.summary',
    icon: '📋',
    description: '按分组变量计算均值、标准差等汇总统计',
    descKey: 'wizard.method.summary.desc',
    category: '基础分析',
    categoryKey: 'wizard.category.basic',
    needsGroup: true,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  }
]
