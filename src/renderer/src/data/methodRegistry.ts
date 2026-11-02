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

/**
 * 变量角色声明（v0.3.2）。
 *
 * ── 为什么必须引入 ──
 * v0.3.1 及之前，向导用**位置**表达变量含义：`depVars[0]` 是因变量、`depVars[1]` 是
 * 第二个变量、`groupVar` 是分组变量。这套约定对 t 检验/相关这类「两个变量对称」的
 * 方法够用，但对中介/调节完全不成立：
 *
 *   M = aX + e ; Y = c'X + bM + e
 *
 * X 与 M 谁放前面，得到的**是完全不同的分析结果**，而且错了不会报错——只会静默
 * 输出一个看起来正常但含义相反的结论。用户在界面上看到的是「已选 3 个变量」
 * 加一串变量名，根本无从知道哪个被当作中介。
 *
 * 所以 q 必须让**每个变量有名字**：
 *   `roles: [{ id: 'x', label: '自变量 X' }, { id: 'm', label: '中介变量 M' } ...]`
 * 界面据此为每个角色单独渲染一个选择区。
 *
 * 一旦声明了 `roles`，`minVars`/`maxVars`/`needsGroup` 就不再参与渲染
 * （由角色数决定要选几个变量）。
 */
export interface VariableRole {
  /** 角色标识，生成器按此取值，如 'x' / 'm' / 'y' / 'w' */
  id: string
  labelKey: string
  label: string
  descKey?: string
  desc?: string
  /** 该角色接受的变量类型 */
  varType: 'numeric' | 'string'
}

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
  /**
   * 具名变量角色（v0.3.2）。声明后，UI 为每个角色渲染独立选择区，
   * 并把结果以 `Record<roleId, variableName>` 传给生成器。
   */
  roles?: VariableRole[]
  /** 该方法的可选参数（v0.2.6：相关分析可选择 Pearson / Spearman） */
  options?: {
    id: string
    labelKey: string
    label: string
    values: { value: string; labelKey: string; label: string }[]
  }[]
  /**
   * 需要用户额外填写的**文本**参数（v0.3.2）。
   * 用于路径分析的边列表、SEM 的结构路径这类无法用枚举表达的结构。
   */
  textInputs?: {
    id: string
    labelKey: string
    label: string
    descKey?: string
    desc?: string
    placeholder: string
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
    categoryKey: 'wizard.category.relation',
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
    categoryKey: 'wizard.category.relation',
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
    id: 'cfa',
    name: '验证性因子分析',
    nameKey: 'wizard.method.cfa',
    icon: '🧭',
    description: '在已有理论结构下检验题项的因子归属与模型拟合',
    descKey: 'wizard.method.cfa.desc',
    category: '问卷分析',
    categoryKey: 'wizard.category.survey',
    needsGroup: false,
    minVars: 3,
    maxVars: 50,
    varType: 'numeric',
    options: [
      {
        id: 'cfaFactors',
        labelKey: 'wizard.option.cfaFactors',
        label: '因子数',
        values: [
          { value: 'auto', labelKey: 'wizard.option.cfaFactors.auto', label: '自动' },
          { value: '1', labelKey: 'wizard.option.cfaFactors.n1', label: '1 个因子' },
          { value: '2', labelKey: 'wizard.option.cfaFactors.n2', label: '2 个因子' },
          { value: '3', labelKey: 'wizard.option.cfaFactors.n3', label: '3 个因子' },
          { value: '4', labelKey: 'wizard.option.cfaFactors.n4', label: '4 个因子' }
        ]
      }
    ]
  },
  {
    id: 'cvi',
    name: '内容效度指数',
    nameKey: 'wizard.method.cvi',
    icon: '👨‍⚖️',
    description: '由专家 1–4 评分计算 I-CVI、S-CVI 与修正 Kappa',
    descKey: 'wizard.method.cvi.desc',
    category: '问卷分析',
    categoryKey: 'wizard.category.survey',
    needsGroup: false,
    minVars: 2,
    maxVars: 50,
    varType: 'numeric'
  },
  {
    id: 'harman',
    name: 'Harman 单因子检验',
    nameKey: 'wizard.method.harman',
    icon: '🧪',
    description: '未旋转主成分分析，检验共同方法偏差',
    descKey: 'wizard.method.harman.desc',
    category: '问卷分析',
    categoryKey: 'wizard.category.survey',
    needsGroup: false,
    minVars: 2,
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
    nameKey: 'wizard.method.summary_by',
    icon: '📋',
    description: '按分组变量计算均值、标准差等汇总统计',
    descKey: 'wizard.method.summary_by.desc',
    category: '基础分析',
    categoryKey: 'wizard.category.basic',
    needsGroup: true,
    minVars: 1,
    maxVars: 1,
    varType: 'numeric'
  }
]
