import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { ParseResult } from '../services/dataService'

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
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<ParseResult | null>(null)

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

  const getNumericColumns = useCallback(() => numericColumns, [numericColumns])
  const getStringColumns = useCallback(() => stringColumns, [stringColumns])
  const getAllColumns = useCallback(() => allColumns, [allColumns])

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
      allColumns
    }),
    [
      dataset,
      hasData,
      getNumericColumns,
      getStringColumns,
      getAllColumns,
      numericColumns,
      stringColumns,
      allColumns
    ]
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a DataProvider')
  return ctx
}
