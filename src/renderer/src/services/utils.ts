/**
 * 共享工具函数
 * 供主进程和渲染进程共同使用
 */

/**
 * 转义字符串以安全嵌入 R 代码
 * 处理: 反斜杠、双引号、单引号、换行、回车、制表、空字符
 */
export function rEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\0/g, '')
}
