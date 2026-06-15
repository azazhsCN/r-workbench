/**
 * 共享类型定义
 * 供主进程和渲染进程共同使用
 */

// R 环境信息
export interface REnvironment {
  found: boolean
  path: string
  version: string
}

// R 执行结果
export interface RExecuteResult {
  success: boolean
  data: unknown
  stdout: string
  stderr: string
  workDir: string
}

// 应用路径
export interface AppPaths {
  userData: string
  temp: string
  documents: string
}

// 应用信息
export interface AppInfo {
  platform: string
  arch: string
  version: string
  electronVersion: string
  nodeVersion: string
}

// 数据集列信息
export interface ColumnInfo {
  name: string
  type: 'numeric' | 'string' | 'date' | 'unknown'
  missing: number
  total: number
}

// 数据集信息
export interface DatasetInfo {
  name: string
  columns: ColumnInfo[]
  rowCount: number
  filePath?: string
}

// 对话消息
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  rCode?: string
  rResult?: RExecuteResult
  timestamp: number
}

// 统计分析方法
export type AnalysisMethod =
  | 'descriptive'
  | 'ttest_independent'
  | 'ttest_paired'
  | 'anova'
  | 'chisquare'
  | 'correlation'
  | 'regression'
  | 'reliability'

// 分析方法信息
export interface AnalysisMethodInfo {
  id: AnalysisMethod
  name: string
  description: string
  icon: string
  applicableTypes: ('numeric' | 'string')[]
  minVariables: number
  maxVariables: number
}

// API 配置
export interface AIConfig {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
}
