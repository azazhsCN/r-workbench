import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { aiService, type AIService } from '../services/aiService'

interface AIContextValue {
  /** AI 服务实例 */
  service: AIService
  /** 是否已配置 */
  isConfigured: boolean
  /** 刷新配置状态 */
  refreshConfig: () => void
}

const AIContext = createContext<AIContextValue | null>(null)

export function AIProvider({ children }: { children: ReactNode }) {
  const [isConfigured, setIsConfigured] = useState(aiService.isConfigured())

  const refreshConfig = useCallback(() => {
    aiService.loadConfig()
    setIsConfigured(aiService.isConfigured())
  }, [])

  return (
    <AIContext.Provider value={{ service: aiService, isConfigured, refreshConfig }}>
      {children}
    </AIContext.Provider>
  )
}

export function useAI(): AIContextValue {
  const ctx = useContext(AIContext)
  if (!ctx) throw new Error('useAI must be used within an AIProvider')
  return ctx
}
