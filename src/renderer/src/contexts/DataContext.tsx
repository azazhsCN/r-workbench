import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
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
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<ParseResult | null>(null)

  const hasData = dataset !== null && dataset.rows.length > 0

  const getNumericColumns = useCallback(
    () => dataset?.columnInfo.filter((c) => c.type === 'numeric').map((c) => c.name) || [],
    [dataset]
  )

  const getStringColumns = useCallback(
    () => dataset?.columnInfo.filter((c) => c.type === 'string').map((c) => c.name) || [],
    [dataset]
  )

  const getAllColumns = useCallback(
    () => dataset?.headers || [],
    [dataset]
  )

  return (
    <DataContext.Provider
      value={{
        dataset,
        setDataset,
        hasData,
        getNumericColumns,
        getStringColumns,
        getAllColumns
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a DataProvider')
  return ctx
}
