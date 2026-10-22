/**
 * 学术三线表组件
 * 符合 APA/中文论文期刊的表格规范：
 * - 顶线（粗）
 * - 表头底线（细）
 * - 表底线（粗）
 * - 无竖线、无多余横线
 *
 * 纯工具函数（HTML 导出 / XSS 转义 / 数值格式化）已抽出到
 * threeLineTableUtils.ts —— 这是 React Fast Refresh 的要求：
 * 一个文件只导出组件，才能保持局部热更新有效。
 */

import { formatCellValue, type ThreeLineTableData } from './threeLineTableUtils'

// 工具函数（threeLineTableToHTML / escapeHtml）从 ./threeLineTableUtils 导入：
// 该模块为纯 TS，无 React 组件，re-export 到本文件会触发
// react-refresh 的"非组件导出"警告并让 Fast Refresh 局部更新失效。
export type { ThreeLineTableData }

interface ThreeLineTableProps {
  /** 表格标题 */
  title?: string
  /** 表头 */
  headers: string[]
  /** 数据行 */
  rows: (string | number)[][]
  /** 注释说明 */
  note?: string
  /** 表格对齐方式 */
  align?: ('left' | 'center' | 'right')[]
}

export default function ThreeLineTable({
  title,
  headers,
  rows,
  note,
  align
}: ThreeLineTableProps) {
  const getAlign = (index: number): string => {
    if (align && align[index]) return align[index]
    // 默认：第一列左对齐，数值列居中
    return index === 0 ? 'left' : 'center'
  }

  return (
    <div style={{ margin: '16px 0', maxWidth: '100%', overflow: 'auto' }}>
      {title && (
        <div
          style={{
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 8
          }}
        >
          {title}
        </div>
      )}

      <table className="three-line-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ textAlign: getAlign(i) as 'left' | 'center' | 'right' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    textAlign: getAlign(ci) as 'left' | 'center' | 'right',
                    fontFamily: typeof cell === 'number' ? 'var(--font-mono)' : 'inherit'
                  }}
                >
                  {formatCellValue(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {note && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-tertiary)',
            marginTop: 6,
            lineHeight: 1.5
          }}
        >
          {note}
        </div>
      )}
    </div>
  )
}
