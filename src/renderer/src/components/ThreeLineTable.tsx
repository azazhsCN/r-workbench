/**
 * 学术三线表组件
 * 符合 APA/中文论文期刊的表格规范：
 * - 顶线（粗）
 * - 表头底线（细）
 * - 表底线（粗）
 * - 无竖线、无多余横线
 */

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

/** HTML 实体转义 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 将三线表数据导出为 Word 兼容的 HTML */
export function threeLineTableToHTML(tables: Array<{ title?: string; headers: string[]; rows: (string | number)[][]; note?: string }>, interpretation?: string): string {
  const formatCell = (v: string | number) => {
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return v.toString()
      if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(3)
      return v.toFixed(4).replace(/\.?0+$/, '') || '0'
    }
    return String(v)
  }

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

  const formatCell = (value: string | number): string => {
    if (typeof value === 'number') {
      // 数值格式化：保留合理小数位
      if (Number.isInteger(value)) return value.toString()
      if (Math.abs(value) < 0.001 && value !== 0) return value.toExponential(3)
      return value.toFixed(4).replace(/\.?0+$/, '') || '0'
    }
    return String(value)
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
                  {formatCell(cell)}
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
