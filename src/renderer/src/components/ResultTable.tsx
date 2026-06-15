/** 统计结果表格组件 — 解析 R 输出并格式化展示 */

interface ResultTableProps {
  title: string
  output: string
}

/** 简单解析 R 输出的文本为表格行 */
function parseRTable(output: string): { headers: string[]; rows: string[][] } | null {
  const lines = output.split('\n').filter((l) => l.trim())

  // 尝试查找包含多列数据的行（用空格分隔）
  const dataLines = lines.filter((l) => l.match(/\S+\s+[\d.-]+/))
  if (dataLines.length < 2) return null

  // 尝试从第一行提取表头
  const firstLine = dataLines[0]
  const parts = firstLine.split(/\s{2,}/).map((p) => p.trim())
  if (parts.length < 2) return null

  return {
    headers: parts,
    rows: dataLines.slice(1).map((l) => l.split(/\s{2,}/).map((p) => p.trim()))
  }
}

export default function ResultTable({ title, output }: ResultTableProps) {
  const table = parseRTable(output)

  return (
    <div style={{ marginBottom: 20 }}>
      {title && (
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
          {title}
        </h4>
      )}

      {table ? (
        <div className="data-table-wrapper" style={{ maxWidth: '100%', overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                {table.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
          <code>{output}</code>
        </pre>
      )}
    </div>
  )
}
