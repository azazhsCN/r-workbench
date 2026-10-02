import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import type { RStatus } from '@shared/types'

export interface RContextValue {
  status: RStatus
  detecting: boolean
  /**
   * 检测**过程本身**的失败原因（IPC 异常等），与"没有安装 R"是两件事。
   * 旧实现把所有异常 catch 成 DEFAULT_STATUS，于是 IPC 出错时界面会
   * 告诉用户去重装一个其实工作正常的 R。
   */
  error: string | null
  detect: () => Promise<void>
}

const DEFAULT_STATUS: RStatus = { found: false, path: '', version: '' }

const RContext = createContext<RContextValue | null>(null)

export function RProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RStatus>(DEFAULT_STATUS)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detect = useCallback(async () => {
    if (!window.api) return
    setDetecting(true)
    setError(null)
    try {
      const result = await window.api.r.detect()
      setStatus(result)
    } catch (err) {
      // 保留原始错误：R 检测失败 ≠ R 未安装
      const message = (err as { message?: string } | null)?.message
      setStatus(DEFAULT_STATUS)
      setError(message || String(err))
    } finally {
      setDetecting(false)
    }
  }, [])

  // 启动时自动检测一次
  useEffect(() => {
    detect()
  }, [detect])

  const value = useMemo<RContextValue>(
    () => ({ status, detecting, error, detect }),
    [status, detecting, error, detect]
  )

  return <RContext.Provider value={value}>{children}</RContext.Provider>
}

export function useR(): RContextValue {
  const ctx = useContext(RContext)
  if (!ctx) throw new Error('useR must be used within an RProvider')
  return ctx
}
