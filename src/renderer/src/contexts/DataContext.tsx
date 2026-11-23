import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode
} from 'react'
import type { ParseResult } from '../services/dataService'
import type { DatasetProfile } from '../services/columnProfile'

/**
 * 「从推荐跳到向导」的预选请求（v0.3.5 / T73）。
 *
 * ── 为什么放在 Context 而不是 props ──
 *
 * 智能推荐的入口有两处（数据页、向导页顶部），但**落点都是向导页**。
 * 数据页与向导页是 `App.tsx` 里的**兄弟组件**，而且两者都常驻挂载
 * （页面保活：切页不卸载，否则会丢失分析进度）。
 * 兄弟 + 常驻意味着：
 *   - 数据页无法通过 props 调用向导页的方法；
 *   - 也不能靠"重新挂载时读 initial state"，因为向导页根本不会重新挂载。
 *
 * 所以需要一个跨页面的单向通道：数据页写入请求 → 向导页消费并清空。
 * 放在 DataContext 而不是新开一个 Context，是因为它天然与"当前数据集"绑定
 * （换数据集后旧的预选请求就该失效）。
 */
export interface WizardSelection {
  /** 要选中的方法 id（`METHODS[].id`） */
  methodId: string
  /** 位置式变量（普通方法） */
  variables?: string[]
  /** 具名角色变量（中介/调节等的 x / m / y / w） */
  roles?: Record<string, string>
  /** 文本参数（路径规格 / 因子结构 / 区块划分） */
  texts?: Record<string, string>
  /** 分组变量（t 检验 / ANOVA / 非参数检验） */
  groupVar?: string
}

interface DataContextValue {
  /** 当前加载的数据集 */
  dataset: ParseResult | null
  /** 设置数据集 */
  setDataset: (data: ParseResult | null) => void
  /** 数据集是否已加载 */
  hasData: boolean
  /** 获取数值型列名 */
  getNumericColumns: () => string[]
  /** 获取分类型列名 */
  getStringColumns: () => string[]
  /** 获取所有列名 */
  getAllColumns: () => string[]
  /** 派生列表（引用稳定，避免消费者每次渲染都重新过滤） */
  numericColumns: string[]
  stringColumns: string[]
  allColumns: string[]
  /**
   * 当前数据集的列画像（v0.3.5 / T70）。
   *
   * 导入时已在 `dataService.buildResult()` 算好并挂在 `ParseResult.profile` 上，
   * 这里只做转发——不要在组件里重算（O(n·p) 的逐列扫描）。
   * `.sav` 路径不经过 `buildResult`，故可能为 undefined，消费方需判空。
   */
  profile: DatasetProfile | null
  /** 待向导页消费的预选请求（v0.3.5 / T73） */
  pendingSelection: WizardSelection | null
  /** 从推荐结果发起"用这个方法分析" */
  requestSelection: (selection: WizardSelection) => void
  /** 向导页消费后清空，避免重复应用同一请求 */
  consumeSelection: () => void
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [dataset, setDatasetState] = useState<ParseResult | null>(null)
  const [pendingSelection, setPendingSelection] = useState<WizardSelection | null>(null)

  /**
   * 换数据集时**必须**丢弃待处理的预选请求。
   *
   * 否则会出现这种静默错配：用户在看 A 数据的推荐，点了一项，
   * 但在跳转前又导入了 B 数据 —— 向导页会用 B 的列名去匹配 A 的建议变量，
   * 匹配不上的静默丢掉、匹配上的填进错误的角色。与 v0.3.2 记录的
   * "位置表达变量含义"同属一类静默错配。
   */
  const setDataset = useCallback((data: ParseResult | null) => {
    setDatasetState(data)
    setPendingSelection(null)
  }, [])

  const hasData = dataset !== null && dataset.rows.length > 0

  // columnInfo 只在导入数据时变化，这里只过滤一次并复用结果
  const numericColumns = useMemo(
    () => dataset?.columnInfo.filter((c) => c.type === 'numeric').map((c) => c.name) ?? [],
    [dataset]
  )

  const stringColumns = useMemo(
    () => dataset?.columnInfo.filter((c) => c.type === 'string').map((c) => c.name) ?? [],
    [dataset]
  )

  const allColumns = useMemo(() => dataset?.headers ?? [], [dataset])

  const profile = useMemo(() => dataset?.profile ?? null, [dataset])

  const getNumericColumns = useCallback(() => numericColumns, [numericColumns])
  const getStringColumns = useCallback(() => stringColumns, [stringColumns])
  const getAllColumns = useCallback(() => allColumns, [allColumns])

  const requestSelection = useCallback((selection: WizardSelection) => {
    setPendingSelection(selection)
  }, [])

  const consumeSelection = useCallback(() => {
    setPendingSelection(null)
  }, [])

  // provider value 必须 memo：否则任何一次父级渲染（例如点击侧边栏）
  // 都会重建对象并让全部消费者重渲染。
  const value = useMemo<DataContextValue>(
    () => ({
      dataset,
      setDataset,
      hasData,
      getNumericColumns,
      getStringColumns,
      getAllColumns,
      numericColumns,
      stringColumns,
      allColumns,
      profile,
      pendingSelection,
      requestSelection,
      consumeSelection
    }),
    [
      dataset,
      setDataset,
      hasData,
      getNumericColumns,
      getStringColumns,
      getAllColumns,
      numericColumns,
      stringColumns,
      allColumns,
      profile,
      pendingSelection,
      requestSelection,
      consumeSelection
    ]
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a DataProvider')
  return ctx
}
