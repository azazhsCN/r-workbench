import { describe, it, expect } from 'vitest'
import { threeLineTableToHTML } from '../ThreeLineTable'

const PAYLOAD = '<img src=x onerror=alert(1)>'
const ESCAPED_PAYLOAD = '&lt;img src=x onerror=alert(1)&gt;'

/** 统计字符串中“开始一个标签”的 `<` 数量（`&lt;` 不算） */
function tagOpenCount(html: string): number {
  return (html.match(/</g) || []).length
}

const cleanTable = {
  title: '表1 描述性统计',
  headers: ['变量', 'M', 'SD'],
  rows: [
    ['mpg', 20.09, 6.03],
    ['wt', 3.22, 0.98]
  ],
  note: '注：N = 32。'
}

describe('threeLineTableToHTML — XSS / HTML 注入防护', () => {
  it('escapes the payload in title, header, cell, note and interpretation', () => {
    const html = threeLineTableToHTML(
      [
        {
          title: PAYLOAD,
          headers: [PAYLOAD, 'b'],
          rows: [[PAYLOAD, 1]],
          note: PAYLOAD
        }
      ],
      PAYLOAD
    )

    // 原始标签一个都不能出现
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/<[a-z][^>]*\sonerror=/i)
    // 必须以实体形式出现，且 5 处注入点全部被转义
    const escapedOccurrences = html.split(ESCAPED_PAYLOAD).length - 1
    expect(escapedOccurrences).toBe(5)
  })

  it('adds exactly zero HTML tags for hostile input compared with clean input', () => {
    // 结构性 oracle：结构完全相同、只有字段内容不同的两次调用，
    // 恶意字段不得新增任何标签（`<` 总数必须完全一致）
    const shape = { headers: ['a', 'b', 'c'], rows: [['x', 'y', 'z']], title: 't', note: 'n' }
    const clean = threeLineTableToHTML([shape], '结论：正常解读')
    const hostile = threeLineTableToHTML(
      [
        {
          title: PAYLOAD,
          headers: [PAYLOAD, PAYLOAD, PAYLOAD],
          rows: [[PAYLOAD, PAYLOAD, PAYLOAD]],
          note: PAYLOAD
        }
      ],
      PAYLOAD
    )

    expect(tagOpenCount(clean)).toBeGreaterThan(0)
    expect(tagOpenCount(hostile)).toBe(tagOpenCount(clean))
  })

  it('escapes every HTML metacharacter, not just < and >', () => {
    const evil = `& " ' < > <script>alert("x")</script>`
    const html = threeLineTableToHTML([{ headers: ['h'], rows: [[evil]], title: evil, note: evil }], evil)
    expect(html).not.toContain('<script')
    // 原始与号不得出现（除实体外），否则可构造 `&lt;` 二次解码
    const body = html.slice(html.indexOf('<body>'))
    expect(body).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/)
    expect(body).toContain('&amp;')
    expect(body).toContain('&quot;')
    expect(body).toContain('&#39;')
  })

  it('keeps legitimate text and numbers intact', () => {
    const html = threeLineTableToHTML([cleanTable], '解读：mpg 均值约 20.09')
    expect(html).toContain('表1 描述性统计')
    expect(html).toContain('20.09')
    expect(html).toContain('解读：mpg 均值约 20.09')
    expect(html).toContain('<table>')
    expect(html).toContain('</html>')
  })

  it('formats numbers without letting a string cell be reinterpreted as a number', () => {
    const html = threeLineTableToHTML([
      { headers: ['a', 'b'], rows: [['0.0000001', 0.0000001]] }
    ])
    // 字符串 '0.0000001' 原样保留（不进入数值格式化分支）
    expect(html).toContain('>0.0000001<')
    // 数值 0.0000001 走科学计数分支
    expect(html).toContain('1.000e-7')
  })
})
