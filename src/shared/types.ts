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
  /**
   * R 运行期间产生的 warning（v0.2.6 起上浮）。
   * v0.2.5 之前 warning 走 stderr 被静默丢弃，导致
   * "卡方近似可能不正确"、"无法计算精确 p 值（存在结点）" 等
   * 统计警告永远到不了用户面前。
   */
  warnings?: string[]
  /** 因超时被中断（此时 output 可能仍有部分结果） */
  timedOut?: boolean
  /** 输出被 maxBuffer 截断 */
  truncated?: boolean
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
  type: 'numeric' | 'string' | 'unknown'
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
