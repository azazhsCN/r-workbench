/**
 * R 源码卫生检查（v0.3.0 新增）
 *
 * 这些看似琐碎，但每一个都在本项目真实发生过、且**不报错地**破坏了功能：
 *
 * 1. **R_COMMON 内的反引号会提前关闭 TS 模板字符串**
 *    R_COMMON 用 `String.raw` 包裹。只要内部出现一个反引号（哪怕在注释里），
 *    模板字符串就会在该处提前结束，后续 R 代码被当成 JS 解析 → 整个文件编译失败。
 *    实际踩过三次（写 `` `__RWB_JSON__` `` 与 `` `else if` `` 的注释时）。
 *
 * 2. **R 注释里的不配对引号会破坏"剥离字符串"类工具**
 *    generator-parse 的 structuralIssues 需要先剥离 R 字符串字面量才能数括号。
 *    若注释里出现 `"a\\"b\c"` 这种引号不配对的文本，剥离器会把注释当成字符串
 *    开头，一路错位到后文，报出假的"多余的 }"。实际踩过一次。
 *
 * 3. **R 的 if/else 必须用花括号**
 *    R 语法要求 `else` 与 `if` 体同行，否则 `unexpected 'else'`。
 *    v0.2.5 有 6 个方法因此从未能运行（见 CHANGELOG）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { RService } from '../rService'

const R_SERVICE_PATH = join(__dirname, '..', 'rService.ts')
const rServiceSource = readFileSync(R_SERVICE_PATH, 'utf8')

/** 提取 R_COMMON 常量体的源码文本（不含 const 声明与结束反引号） */
function extractRCommonSource(): { body: string; startLine: number } {
  const lines = rServiceSource.split('\n')
  const start = lines.findIndex((l) => l.includes('const R_COMMON = String.raw`'))
  if (start < 0) throw new Error('未找到 R_COMMON 声明')
  let end = -1
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '`') {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('未找到 R_COMMON 结束反引号')
  return { body: lines.slice(start + 1, end).join('\n'), startLine: start + 2 }
}

describe('R 源码卫生：R_COMMON 模板安全', () => {
  it('R_COMMON 源码体内不得出现反引号（否则提前关闭 TS 模板字符串）', () => {
    const { body, startLine } = extractRCommonSource()
    const offenders: string[] = []
    body.split('\n').forEach((line, i) => {
      if (line.includes('`')) offenders.push(`  第 ${startLine + i} 行: ${line.trim()}`)
    })
    expect(offenders, `R_COMMON 内出现反引号，会提前关闭模板字符串：\n${offenders.join('\n')}`).toEqual([])
  })

  it('R_COMMON 内的 R 注释不得含不配对的双引号', () => {
    const { body, startLine } = extractRCommonSource()
    const offenders: string[] = []
    body.split('\n').forEach((line, i) => {
      const hashIdx = findCommentStart(line)
      if (hashIdx < 0) return
      const comment = line.slice(hashIdx + 1)
      // 统计未转义的双引号数量，奇数说明不配对
      let count = 0
      for (let k = 0; k < comment.length; k++) {
        if (comment[k] === '\\') {
          k++
          continue
        }
        if (comment[k] === '"') count++
      }
      if (count % 2 !== 0) {
        offenders.push(`  第 ${startLine + i} 行: ${comment.trim()}`)
      }
    })
    expect(
      offenders,
      `R 注释中的不配对引号会让"剥离字符串"类工具错位：\n${offenders.join('\n')}`
    ).toEqual([])
  })
})

/** 找到行内注释起点（跳过字符串内部），没有则返回 -1 */
function findCommentStart(line: string): number {
  let inStr: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inStr) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'") {
      inStr = c
      continue
    }
    if (c === '#') return i
  }
  return -1
}

describe('R 源码卫生：生成器输出的 R 结构', () => {
  const GENERATORS: Array<[string, () => string]> = [
    ['descriptive', () => RService.descriptiveCode(['mpg'])],
    ['ttest_independent', () => RService.tTestIndependentCode('score', 'group')],
    ['ttest_paired', () => RService.tTestPairedCode('pre', 'post')],
    ['ttest_one', () => RService.tTestOneSampleCode('value', 50)],
    ['anova', () => RService.anovaCode('dv', 'grp')],
    ['chisquare', () => RService.chiSquareCode('a', 'b')],
    ['correlation_pearson', () => RService.correlationCode('x', 'y', 'pearson')],
    ['correlation_spearman', () => RService.correlationCode('x', 'y', 'spearman')],
    ['regression', () => RService.regressionCode('y', ['x1', 'x2'])],
    ['reliability', () => RService.reliabilityCode(['q1', 'q2', 'q3'])],
    ['normality', () => RService.normalityTestCode(['x'])],
    ['nonparametric', () => RService.nonparametricCode('score', 'group')],
    ['frequency', () => RService.frequencyCode(['edu'])],
    ['summary_by', () => RService.summaryByCode('dept', 'salary')],
    // v0.3.1：问卷效度进阶三件套
    ['cfa', () => RService.cfaCode(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'])],
    ['cvi', () => RService.cviCode(['q1', 'q2', 'q3', 'q4'])],
    ['harman', () => RService.harmanCode(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'])]
  ]

  for (const [name, gen] of GENERATORS) {
    it(`${name}: 不含裸 else（R 要求 else 与 if 体同行或花括号）`, () => {
      const code = gen()
      const lines = code.split('\n')
      const bad: string[] = []
      lines.forEach((line, i) => {
        const t = line.trim()
        // "else" 独占一行开头且上一非空行不是 } → 非法
        if (/^else\b/.test(t)) {
          let j = i - 1
          while (j >= 0 && lines[j].trim() === '') j--
          if (j < 0 || !lines[j].trim().endsWith('}')) {
            bad.push(`  第 ${i + 1} 行: ${t}`)
          }
        }
      })
      expect(bad, `${name} 存在裸 else：\n${bad.join('\n')}`).toEqual([])
    })
  }
})

describe('R 源码卫生：JSON 辅助函数已注入', () => {
  const code = RService.descriptiveCode(['mpg'])

  for (const fn of ['jstr', 'jnum', 'jbool', 'jarr_num', 'jarr_str', 'jp', 'jdiag', 'jemit']) {
    it(`R_COMMON 定义了 ${fn}`, () => {
      expect(code).toContain(fn + ' <- function')
    })
  }

  it('生成器代码中不含字面反斜杠+n（会被 R 当成普通字符而非换行）', () => {
    // 生成器的 cat("...\n") 经过 TS 模板字符串后应为真实换行转义，
    // 而非字面的两个字符 \ 和 n。用 String.raw 包裹 R_COMMON 时尤其容易弄错。
    const all = RService.tTestIndependentCode('s', 'g')
    const banner = all.split('\n').find((l) => l.includes('=== \u72ec\u7acb\u6837\u672c'))
    expect(banner, '未找到横幅行').toBeTruthy()
    // 横幅行内应含反斜杠+n（R 源码形式），而不是被 TS 提前转义成真实换行
    expect(banner!).toContain('\\n')
  })
})

/**
 * 配置文件不得带 UTF-8 BOM。
 *
 * 实战事故：用 PowerShell 的 Set-Content 改 package.json 的版本号，写入了 BOM
 * （字节 EF BB BF）。Vite 加载 PostCSS 配置时报
 * `SyntaxError: Unexpected token`（不可见字符即 BOM），整个构建失败。
 * BOM 对 JSON/JS 配置是纯污染——没有任何解析器需要它。
 */
describe('配置与语言包文件不得含 UTF-8 BOM', () => {
  const FILES = [
    'package.json',
    'src/renderer/src/i18n/locales/zh-CN.json',
    'src/renderer/src/i18n/locales/en-US.json'
  ]
  const ROOT = join(__dirname, '..', '..', '..', '..', '..')

  for (const rel of FILES) {
    it(`${rel} 无 BOM`, () => {
      const buf = readFileSync(join(ROOT, rel))
      const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
      expect(hasBom, `${rel} 含 UTF-8 BOM，会导致 Vite/JSON 解析失败`).toBe(false)
    })
  }
})
