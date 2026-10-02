import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { aiService, type AIService } from '../services/aiService'

interface AIContextValue {
  service: AIService
  isConfigured: boolean
  refreshConfig: () => Promise<void>
}

const AIContext = createContext<AIContextValue | null>(null)

export function AIProvider({ children }: { children: ReactNode }) {
  const [isConfigured, setIsConfigured] = useState(false)

  const refreshConfig = useCallback(async () => {
    await aiService.loadConfig()
    setIsConfigured(aiService.isConfigured())
  }, [])

  // 启动时加载一次配置
  useEffect(() => {
    refreshConfig()
  }, [refreshConfig])

  // memo provider value，避免每次渲染让所有消费者重渲染
  const value = useMemo<AIContextValue>(
    () => ({ service: aiService, isConfigured, refreshConfig }),
    [isConfigured, refreshConfig]
  )

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>
}

export function useAI(): AIContextValue {
  const ctx = useContext(AIContext)
  if (!ctx) throw new Error('useAI must be used within an AIProvider')
  return ctx
}
