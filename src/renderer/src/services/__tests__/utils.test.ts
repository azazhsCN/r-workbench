import { describe, it, expect } from 'vitest'
import { rEscape } from '../utils'

/**
 * 独立的 R 字符串字面量词法分析器（测试用 oracle）。
 *
 * 它不依赖 rEscape 的实现：按 R 自身的转义规则解析 `"..."` 字面量。
 * - 中途遇到未转义的 `"` → 字面量提前结束 = **注入逃逸**，ok:false。
 * - 成功则返回解码后的字符串值，可与原始输入比对。
 */
function lexRStringLiteral(literal: string): { ok: boolean; value: string } {
  let value = ''
  if (literal.length < 2 || literal[0] !== '"' || literal[literal.length - 1] !== '"') {
    return { ok: false, value }
  }
  for (let i = 1; i < literal.length - 1; i++) {
    const c = literal[i]
    if (c === '"') return { ok: false, value } // 未转义引号：字符串提前结束
    if (c !== '\\') {
      value += c
      continue
    }
    i++
    if (i >= literal.length - 1) return { ok: false, value } // 结尾孤立反斜杠会吞掉闭引号
    const e = literal[i]
    if (e === 'n') value += '\n'
    else if (e === 'r') value += '\r'
    else if (e === 't') value += '\t'
    else if (e === '\\') value += '\\'
    else if (e === '"') value += '"'
    else if (e === "'") value += "'"
    else value += '\\' + e // R 对未知转义保留反斜杠
  }
  return { ok: true, value }
}

/** 把 s 作为 R 双引号字符串字面量嵌入并尝试解析 */
function embedInRString(s: string): { ok: boolean; value: string } {
  return lexRStringLiteral(`"${rEscape(s)}"`)
}

const INJECTION_PAYLOADS = [
  '"; cat("pwned"); x <- "',
  "'); system('calc'); #",
  '\\"); system("whoami"); ("',
  'a" + b + "c',
  "it's",
  'line1\nline2',
  'line1\r\nline2',
  'tab\there',
  'back\\slash',
  '\\\\"double',
  '中文变量名与说明',
  'e\u0301moji 🙂',
  '\u0000null\u0000byte',
  'quote"quote\'quote',
  '$(whoami) `id`',
  '}; .Internal(invisible(1)); if(TRUE){ "'
]

describe('rEscape', () => {
  it('escapes quotes, backslashes, newlines and tabs', () => {
    expect(rEscape('a"b')).toBe('a\\"b')
    expect(rEscape("a'b")).toBe("a\\'b")
    expect(rEscape('a\\b')).toBe('a\\\\b')
    expect(rEscape('a\nb')).toBe('a\\nb')
    expect(rEscape('a\rb')).toBe('a\\rb')
    expect(rEscape('a\tb')).toBe('a\\tb')
  })

  it('drops NUL bytes (R strings cannot contain them)', () => {
    expect(rEscape('a\u0000b')).toBe('ab')
  })

  it('passes non-ASCII through unchanged (R sources are UTF-8)', () => {
    const s = '中文变量名 é ① 🙂'
    expect(rEscape(s)).toBe(s)
  })

  it('always escapes the backslash BEFORE the quote it protects', () => {
    // 若顺序写反（先转义引号再转义反斜杠），`\"` 会变成 `\\"` = 反斜杠 + 结束引号 → 注入
    const escaped = rEscape('\\"')
    const lexed = lexRStringLiteral(`"${escaped}"`)
    expect(lexed.ok).toBe(true)
    expect(lexed.value).toBe('\\"')
  })

  for (const payload of INJECTION_PAYLOADS) {
    it(`cannot break out of an R string literal: ${JSON.stringify(payload)}`, () => {
      const escaped = rEscape(payload)
      const lexed = embedInRString(payload)

      // 1. 词法上必须是一个完整的字面量（没有提前终止）
      expect(lexed.ok).toBe(true)
      // 2. 解码回来必须等于原值（\0 被删除），即转义是可逆的、未篡改数据
      expect(lexed.value).toBe(payload.replace(/\0/g, ''))
      // 3. 输出中不得残留裸引号 / 裸换行，否则会脱离字符串上下文
      expect(escaped).not.toMatch(/(^|[^\\])"/)
      expect(escaped).not.toMatch(/[\n\r]/)
    })
  }

  it('produces code that is still a single line for a multi-line payload', () => {
    const escaped = rEscape('a\nb\rc')
    expect(escaped.split('\n')).toHaveLength(1)
    expect(escaped.split('\r')).toHaveLength(1)
  })
})

describe('R 字符串 oracle 自身的判别力（元测试：证明上面的注入测试不是同义反复）', () => {
  it('rejects an escaper that escapes quotes but forgets backslashes', () => {
    const naive = (s: string): string => s.replace(/"/g, '\\"')
    expect(naive('\\"')).not.toBe(rEscape('\\"'))
    // 顺序错误（先转义引号）会让反斜杠把转义符自身吃掉 → 字符串提前结束
    expect(lexRStringLiteral(`"${naive('\\"')}"`).ok).toBe(false)
    // 正确实现则必须通过
    expect(lexRStringLiteral(`"${rEscape('\\"')}"`).ok).toBe(true)
  })

  it('rejects an escaper that leaves newlines raw', () => {
    const naive = (s: string): string => s.replace(/"/g, '\\"').replace(/\\/g, '\\\\')
    const withRawNewline = (s: string): string => naive(s) // 未处理 \n
    expect(withRawNewline('a\nb')).toContain('\n')
    expect(rEscape('a\nb')).not.toContain('\n')
  })
})
