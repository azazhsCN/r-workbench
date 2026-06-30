/**
 * 共享类型定义
 * 供主进程和渲染进程共同使用
 * 注意：所有类型必须与实际 IPC 返回值对齐
 */

// R 执行结果（与 ipc.ts r:execute handler 返回值对齐）
export interface RExecuteResult {
  success: boolean
  output: string
  errors: string[]
  stderr: string
  workDir: string
}

// R 环境检测状态
export interface RStatus {
  found: boolean
  path: string
  version: string
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
