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
  { name: 'summary_by', gen: () => RService.summaryByCode('dept', 'salary') },
  // v0.3.1：问卷效度进阶三件套（CFA / CVI / Harman），全部纯 base R
  { name: 'cfa', gen: () => RService.cfaCode(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) },
  { name: 'cvi', gen: () => RService.cviCode(['q1', 'q2', 'q3', 'q4']) },
  { name: 'harman', gen: () => RService.harmanCode(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) }
]

/**
 * 把 R 字符串字面量（含转义）替换为空格，避免其中的括号/`#` 干扰结构检查。
 *
 * v0.3.0 加固：旧实现遇到 `\` 时无条件 `i += 2`。这在 `"\\\""`（转义反斜杠 +
 * 转义引号）这类连续转义里会错位——R 的字符串结束判定必须按"反斜杠消解下一个
 * 字符"逐字符推进，否则会把闭合引号当成转义内容，导致后续文本被误当作代码，
 * 报出假的"多余的 }"。实测：JSON 转义辅助函数（含 `"\\\""`）触发了该误判。
 */
function stripRStrings(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const c = code[i]
    if (c === '"' || c === "'") {
      out += ' '
      i++
      // 逐字符推进：遇到反斜杠则连同下一个字符一起吃掉
      while (i < code.length) {
        if (code[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        if (code[i] === c) {
          i++
          break
        }
        out += ' '
        i++
      }
      continue
    }
    out += c
    i++
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
  it('covers all 17 generator outputs', () => {
    expect(CASES).toHaveLength(17)
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
      RService.regressionCode(evil[0], evil.slice(1)),
      // v0.3.1 三个新生成器同样必须扛住注入
      RService.cfaCode(evil),
      RService.cviCode(evil),
      RService.harmanCode(evil)
    ]
    for (const code of outputs) {
      expect(structuralIssues(code)).toEqual([])
      // 恶意内容不得以裸形式出现在代码里（必须有转义或已被字符串包裹）
      expect(code).not.toContain('system("calc")')
    }
  })

  /**
   * v0.3.1 三个新生成器的**契约形状**断言。
   *
   * 这里只做不需要 R 的文本级检查（真正跑 R 的验证在
   * scripts/validate/run_validation.R）。重点锁死三件在开发中真实踩到的事：
   *   1. R_COMMON 的 "g" 格式必须有 trimws —— formatC(format = "g") 不指定
   *      width 时会把字段右对齐补到 digits+1 个字符，实测 num_p(0) 输出
   *      "        0"，带空格的字段违反"以 | 分隔、不加空格"的契约。
   *   2. CFA 的 unstd_load 不得等于 std_load —— 拟合对象是相关矩阵时
   *      diag(Sigma) 恒为 1，若直接把 lam 当 unstd_load 输出，两列一模一样。
   *   3. CVI 阈值必须与离散取值的可达性一致（n=6→0.83 而非 0.78）。
   */
  it('num_p / num_sig 用 trimws 去掉 formatC 的宽度填充（否则字段带前导空格）', () => {
    const code = RService.harmanCode(['x', 'y', 'z'])
    const numPLine = code.split('\n').find((l) => l.includes('num_p <- function'))!
    expect(numPLine).toBeTruthy()
    // num_p 函数体必须出现 trimws
    const body = code.split('num_p <- function')[1].split('\n}\n')[0]
    expect(body, 'num_p 缺少 trimws，formatC("g") 会给字段补前导空格').toContain('trimws')
    expect(code).toContain('trimws(formatC')
  })

  it('CFA 的 unstd_load 是原始量纲载荷（std_load × sd），不与 std_load 恒等', () => {
    const code = RService.cfaCode(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'])
    // 必须真的用原始列标准差换算
    expect(code).toMatch(/unstd_lam <- std_lam \* raw_sd/)
    expect(code).toMatch(/raw_sd <- vapply/)
    // CFA_ESTIMATE 行必须输出 unstd_lam 而不是 lam
    expect(code).toMatch(/num\(unstd_lam\[i\]\)/)
  })

  it('CFA 翻转载荷列时必须同步翻转 Φ 的行与列（不然 φ 符号相反）', () => {
    const code = RService.cfaCode(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'])
    // 翻转符号必须记在 flip 向量里，且 Φ 的翻转必须做**行与列双向**夹乘：
    // diag(flip) %*% Phi %*% diag(flip) —— 只夹一侧会让 Φ 不再是对称相关矩阵，
    // 只翻 Λ 不翻 Φ 则 φ 符号相反（原型实测：真值 +0.35 估成 −0.37）。
    expect(code).toMatch(/flip\[j\] <- -1/)
    expect(code).toMatch(/diag\(flip, n_fac\) %\*% Phi_raw %\*% diag\(flip, n_fac\)/)
    // 双向夹乘的两个 diag(flip) 都要在：缺少任一侧都不等价于行列同时翻转
    const sandwich = code.match(/diag\(flip, n_fac\)/g) ?? []
    expect(sandwich.length, 'Φ 的翻转必须是 diag(flip) 双侧夹乘').toBeGreaterThanOrEqual(2)
  })

  it('CVI 阈值表是 Lynn/Polit 口径：n<=5 -> 1.00，6-8 -> 0.83，>=9 -> 0.78', () => {
    const code = RService.cviCode(['q1', 'q2', 'q3'])
    // 提取 cvi_threshold 函数体做精确断言：阈值写错会直接改变论文里的效度结论
    const body = code.split('cvi_threshold <- function(n) {')[1].split('\n}\n')[0]
    expect(body, 'n<=5 的阈值必须是 1.00').toMatch(/if \(n <= 5\) \{\s*1\.00/)
    expect(body, '6-8 的阈值必须是 0.83（曾误写 0.78/0.75）').toMatch(/if \(n <= 8\) \{\s*0\.83/)
    expect(body, 'n>=9 的阈值必须是 0.78').toMatch(/0\.78/)
    expect(body, '阈值中不得出现 0.75').not.toContain('0.75')
  })

  it('CVI 的 Pc 用单点二项系数 C(n, A)/2^n，不是尾概率和', () => {
    const code = RService.cviCode(['q1', 'q2', 'q3'])
    expect(code).toMatch(/Pc <- choose\(n_experts, A_req\) \/ 2\^n_experts/)
    expect(code).toMatch(/A_req <- ceiling\(thr \* n_experts\)/)
    // 绝不能出现 sum(choose(...)) 这类尾概率写法
    expect(code).not.toMatch(/Pc <- sum\(choose/)
  })

  it('CVI 的 verdict 用 Cicchetti & Sparrow 四级（含"尚可"）', () => {
    const code = RService.cviCode(['q1', 'q2', 'q3'])
    for (const v of ['优秀', '良好', '尚可', '需修改']) {
      expect(code, `verdict 缺少 ${v}`).toContain(v)
    }
  })

  it('Harman 必须输出"灵敏度低、只能初步筛查"的提示', () => {
    const code = RService.harmanCode(['q1', 'q2', 'q3'])
    expect(code).toContain('灵敏度低')
    expect(code).toContain('不能证明')
    // 判据阈值 40%
    expect(code).toMatch(/thr_pct <- 40/)
  })

  it('三个新生成器的横幅唯一且与契约完全一致', () => {
    const expected: Array<[string, string]> = [
      [RService.cfaCode(['q1', 'q2', 'q3', 'q4']), '=== 验证性因子分析 (CFA) ==='],
      [RService.cviCode(['q1', 'q2']), '=== 内容效度指数 (CVI) ==='],
      [RService.harmanCode(['q1', 'q2', 'q3']), '=== Harman 单因子检验 ===']
    ]
    for (const [code, banner] of expected) {
      const found = code.match(/^cat\("=== .+? ===\\n"\)/gm)
      expect(found, '横幅必须恰好一个').toHaveLength(1)
      expect(code).toContain(`cat("${banner}\\n")`)
    }
  })
})
