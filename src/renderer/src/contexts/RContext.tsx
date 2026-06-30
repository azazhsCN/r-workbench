import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { RStatus } from '../../shared/types'

export interface RContextValue {
  status: RStatus
  detecting: boolean
  detect: () => Promise<void>
}

const DEFAULT_STATUS: RStatus = { found: false, path: '', version: '' }

const RContext = createContext<RContextValue | null>(null)

export function RProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RStatus>(DEFAULT_STATUS)
  const [detecting, setDetecting] = useState(false)

  const detect = useCallback(async () => {
    if (!window.api) return
    setDetecting(true)
    try {
      const result = await window.api.r.detect()
      setStatus(result)
    } catch {
      setStatus(DEFAULT_STATUS)
    } finally {
      setDetecting(false)
    }
  }, [])

  // 启动时自动检测一次
  useEffect(() => {
    detect()
  }, [detect])

  return (
    <RContext.Provider value={{ status, detecting, detect }}>
      {children}
    </RContext.Provider>
  )
}

export function useR(): RContextValue {
  const ctx = useContext(RContext)
  if (!ctx) throw new Error('useR must be used within an RProvider')
  return ctx
}
