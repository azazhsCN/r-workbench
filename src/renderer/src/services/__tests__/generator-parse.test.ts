import { describe, it, expect } from 'vitest'
import { RService } from '../rService'

/**
 * 「生成器产出的 R 代码必须是合法 R」契约（T20 验收要求）。
 *
 * v0.2.5 有 6 个生成器把 `else` 写在新的一行，R 直接 `parse` 失败：
 *     if (p < 0.01) cat(...)
 *     else if (...) cat(...)      # <- R: unexpected 'else'
 * 这 6 个方法从未成功运行过一次，而 typecheck / 单元测试都发现不了。
 *
 * 本文件不做黑盒字符串比较，而是对**每一个生成器产出的真实代码**做语法级检查：
 *   1. else 必须与上一个非空行的 `}` 同行（R 语法硬要求）；
 *   2. `{}` / `()` / `[]` 必须配平（先剥离字符串与注释）；
 *   3. 恶意变量名（引号/换行/反斜杠）不能让生成代码结构失衡。
 *
 * 说明：这里只做**无需安装 R** 的结构检查，因此 `npm test` 在任意机器可跑；
 * 真正的 `Rscript` 解析/执行由 scripts/validate/run_validation.R 在 CI 中完成
 * （它对每个 fixture 显式调用 parse() 并真正 source() 执行）。
 */

const CASES: Array<{ name: string; gen: () => string }> = [
  { name: 'descriptive', gen: () => RService.descriptiveCode(['mpg']) },
  { name: 'ttest_independent', gen: () => RService.tTestIndependentCode('score', 'group') },
  { name: 'ttest_paired', gen: () => RService.tTestPairedCode('pre', 'post') },
  { name: 'ttest_one', gen: () => RService.tTestOneSampleCode('value', 50) },
  { name: 'anova', gen: () => RService.anovaCode('dv', 'grp') },
  { name: 'chisquare', gen: () => RService.chiSquareCode('a', 'b') },
  { name: 'correlation_pearson', gen: () => RService.correlationCode('x', 'y', 'pearson') },
  { name: 'correlation_spearman', gen: () => RService.correlationCode('x', 'y', 'spearman') },
  { name: 'regression', gen: () => RService.regressionCode('y', ['x1', 'x2']) },
  { name: 'reliability', gen: () => RService.reliabilityCode(['q1', 'q2', 'q3']) },
  { name: 'normality', gen: () => RService.normalityTestCode(['x']) },
  { name: 'nonparametric', gen: () => RService.nonparametricCode('score', 'group') },
  { name: 'frequency', gen: () => RService.frequencyCode(['edu']) },
  { name: 'summary_by', gen: () => RService.summaryByCode('dept', 'salary') }
]

/** 把 R 字符串字面量（含转义）替换为空格，避免其中的括号/`#` 干扰结构检查 */
function stripRStrings(code: string): string {
  let out = ''
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === '"' || c === "'") {
      out += ' '
      i++
      while (i < code.length) {
        if (code[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        if (code[i] === c) break
        out += ' '
        i++
      }
      continue
    }
    out += c
  }
  return out
}

function structuralIssues(code: string): string[] {
  const issues: string[] = []
  const noStrings = stripRStrings(code)
  const noComments = noStrings
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n')

  // 1. R 要求 else 与上一行的 `}` 同行
  const lines = noComments.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*else\b/.test(lines[i])) {
      let j = i - 1
      while (j >= 0 && lines[j].trim() === '') j--
      if (j < 0 || !lines[j].trim().endsWith('}')) {
        issues.push(`第 ${i + 1} 行的 else 不在上一行的 } 之后（R: unexpected 'else'）`)
      }
    }
  }

  // 2. 括号/花括号配平
  const pairs: Array<[string, string]> = [
    ['{', '}'],
    ['(', ')'],
    ['[', ']']
  ]
  for (const [open, close] of pairs) {
    let depth = 0
    for (const ch of noComments) {
      if (ch === open) depth++
      else if (ch === close) depth--
      if (depth < 0) {
        issues.push(`多余的 ${close}`)
        break
      }
    }
    if (depth > 0) issues.push(`${open} 未闭合（缺 ${depth} 个 ${close}）`)
  }
  return issues
}

describe('生成器产出必须是合法 R（无需安装 R 的结构检查）', () => {
  it('covers all 14 generator outputs', () => {
    expect(CASES).toHaveLength(14)
    for (const c of CASES) expect(c.gen().length, `${c.name} 输出为空`).toBeGreaterThan(0)
  })

  for (const c of CASES) {
    it(`${c.name}: else 同行 + 括号配平`, () => {
      const issues = structuralIssues(c.gen())
      expect(issues, `${c.name} 的生成代码存在语法结构问题：\n${issues.join('\n')}`).toEqual([])
    })
  }

  it('detects the v0.2.5 dangling-else shape (meta-test: the check is discriminating)', () => {
    const broken = 'if (x < 0.05) cat("a\\n")\nelse cat("b\\n")\n'
    expect(structuralIssues(broken).join(' ')).toContain("unexpected 'else'")
    const fixed = 'if (x < 0.05) {\n  cat("a\\n")\n} else {\n  cat("b\\n")\n}\n'
    expect(structuralIssues(fixed)).toEqual([])
  })

  it('detects unbalanced braces (meta-test)', () => {
    expect(structuralIssues('f <- function() {\n  x\n').join(' ')).toContain('未闭合')
    expect(structuralIssues('for (i in 1:3) {\n  x\n}\n')).toEqual([])
  })

  it('ignores brackets and # inside string literals (meta-test)', () => {
    expect(structuralIssues('cat("({[ # not a comment\\n")\n')).toEqual([])
  })

  it('stays structurally valid with hostile variable names (injection attempt)', () => {
    const evil = ['a"b', "c'd", 'd\\e', 'f\ng', '$(whoami) `id`', '中文"; system("calc"); #']
    const outputs = [
      RService.descriptiveCode(evil),
      RService.frequencyCode(evil),
      RService.normalityTestCode(evil),
      RService.reliabilityCode(evil),
      RService.correlationCode(evil[0], evil[1], 'pearson'),
      RService.tTestIndependentCode(evil[0], evil[1]),
      RService.regressionCode(evil[0], evil.slice(1))
    ]
    for (const code of outputs) {
      expect(structuralIssues(code)).toEqual([])
      // 恶意内容不得以裸形式出现在代码里（必须有转义或已被字符串包裹）
      expect(code).not.toContain('system("calc")')
    }
  })
})
