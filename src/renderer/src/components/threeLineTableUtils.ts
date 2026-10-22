/**
 * 三线表工具函数（与 React 组件分离）。
 *
 * 拆分原因：`react-refresh/only-export-components` 要求一个文件只导出组件，
 * 否则 Fast Refresh 的局部热更新会失效。而 `threeLineTableToHTML` 是纯工具
 * 函数（被测试与剪贴板导出复用），不该住在组件文件里。
 * 改动不改变任何行为，只是把导出移到纯 TS 文件。
 */

/** HTML 实体转义（XSS 防护：导出路径不信任任何输入） */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 单元格数值格式化（与 React 组件内的 formatCell 保持一致） */
export function formatCellValue(value: string | number): string {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toString()
    if (Math.abs(value) < 0.001 && value !== 0) return value.toExponential(3)
    return value.toFixed(4).replace(/\.?0+$/, '') || '0'
  }
  return String(value)
}

/** 三线表数据类型 */
export interface ThreeLineTableData {
  title?: string
  headers: string[]
  rows: (string | number)[][]
  note?: string
}

/** 将三线表数据导出为 Word 兼容的 HTML */
export function threeLineTableToHTML(
  tables: ThreeLineTableData[],
  interpretation?: string
): string {
  const formatCell = (v: string | number) => formatCellValue(v)

  let html = `<html><head><meta charset="utf-8"><style>
body { font-family: "宋体", SimSun, serif; font-size: 12pt; line-height: 1.8; }
table { border-collapse: collapse; margin: 12pt auto; min-width: 60%; }
table thead tr { border-top: 2pt solid black; }
table thead tr th { border-bottom: 1pt solid black; padding: 4pt 12pt; font-weight: bold; text-align: center; }
table tbody td { padding: 4pt 12pt; text-align: center; }
table tbody tr:nth-child(1) td { text-align: left; }
table tbody tr:last-child { border-bottom: 2pt solid black; }
.title { text-align: center; font-weight: bold; font-size: 12pt; margin: 6pt 0; }
.note { font-size: 10pt; color: #666; margin: 4pt 0; }
.interp { font-size: 12pt; margin: 12pt 0; text-indent: 2em; line-height: 1.8; }
</style></head><body>`

  for (const t of tables) {
    if (t.title) html += `<p class="title">${escapeHtml(t.title)}</p>`
    html += '<table><thead><tr>'
    for (const h of t.headers) html += `<th>${escapeHtml(h)}</th>`
    html += '</tr></thead><tbody>'
    for (const row of t.rows) {
      html += '<tr>'
      for (let i = 0; i < row.length; i++) {
        const align = i === 0 ? 'left' : 'center'
        html += `<td style="text-align:${align}">${escapeHtml(formatCell(row[i]))}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table>'
    if (t.note) html += `<p class="note">${escapeHtml(t.note)}</p>`
  }

  if (interpretation) {
    html += `<p class="interp">${escapeHtml(interpretation)}</p>`
  }

  html += '</body></html>'
  return html
}
