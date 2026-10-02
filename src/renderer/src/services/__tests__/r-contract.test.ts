/**
 * R 管线契约测试（v0.2.6）
 *
 * 这些测试锁死的是"生成器输出 → 解析器输入"之间的格式契约，
 * 也就是 v0.2.5 中失守的那一层：
 *   - 生成器把 `else` 写到下一行 → R 无法解析（6 个方法从未运行）
 *   - detectAnalysisType 用 ' N=' 启发式 → 7 个方法被判为 descriptive，tables 为空
 *   - 解析器数值捕获组不含负号/科学计数 → 含负值的变量被静默丢弃
 *   - `||` 把合法的 p=0 当成缺失 → AI 收到 p=1 而结论写"极显著"
 *   - sprintf 格式串与参数个数不匹配 → R 只发 warning，字段被静默丢弃
 *
 * 测试不需要安装 R：所有断言都针对生成器产出的 R 源码文本。
 * 与 R 的真实执行验证互补（见 scripts/validate/run_validation.R 与
 * docs 中的端到端记录）。
 */

import { describe, it, expect } from 'vitest'
import { RService } from '../rService'
import { parseROutput, detectAnalysisType, parsePValue } from '../resultParser'
import { METHODS } from '../../pages/WizardPage'

/** 每个方法的生成器调用，覆盖全部 13 种向导方法 */
const GENERATORS: Record<string, () => string> = {
  descriptive: () => RService.descriptiveCode(['score'], 'data.csv'),
  ttest_independent: () => RService.tTestIndependentCode('score', 'grp', 'data.csv'),
  ttest_paired: () => RService.tTestPairedCode('pre', 'post', 'data.csv'),
  ttest_one: () => RService.tTestOneSampleCode('score', 5, 'data.csv'),
  anova: () => RService.anovaCode('score', 'grp', 'data.csv'),
  chisquare: () => RService.chiSquareCode('a', 'b', 'data.csv'),
  correlation: () => RService.correlationCode('x', 'y', 'pearson', 'data.csv'),
  correlation_spearman: () => RService.correlationCode('x', 'y', 'spearman', 'data.csv'),
  regression: () => RService.regressionCode('y', ['x1', 'x2'], 'data.csv'),
  reliability: () => RService.reliabilityCode(['i1', 'i2'], 'data.csv'),
  normality: () => RService.normalityTestCode(['x'], 'data.csv'),
  nonparametric: () => RService.nonparametricCode('score', 'grp', 'data.csv'),
  frequency: () => RService.frequencyCode(['a'], 'data.csv'),
  summary_by: () => RService.summaryByCode('grp', 'score', 'data.csv')
}

/**
 * 每个方法在真实运行时的代表性 R stdout（含横幅 + 特征数据行）。
 *
 * 为什么需要它：只拿横幅喂给 detectAnalysisType 是"弱测试"——
 * v0.2.5 的缺陷恰恰是横幅之外的 `' N='` 启发式把 t 检验判成了 descriptive，
 * 而分组统计行正是 `GRP|...` / `组1 (0): N=19`。
 * 只有把带数据行的完整输出喂进去，才能真正守住这个缺陷。
 */
const SAMPLE_OUTPUT: Record<string, string> = {
  descriptive: [
    '=== 描述性统计 ===',
    'score|32|20.0906|6.0269|10.4000|33.9000|19.2000',
    '__INFO__:score|缺失=0|总计=32'
  ].join('\n'),
  ttest_independent: [
    '=== 独立样本 t 检验 ===',
    'GRP|0|19|17.1474|3.8340',
    'GRP|1|19|20.6633|2.9097',
    'ASSUMPTION|Fligner|p = 0.045|0.045',
    'METHOD|Welch Two Sample t-test',
    'RESULT_IND|-3.7671|18.33|p = 0.001|0.0014|-7.2449|-11.2805|-3.2093|1.2|0.0606',
    'RESULT_POOLED|-3.7671|58.00|p = 0.001|0.0004',
    'CONCL|两组差异具有统计学意义'
  ].join('\n'),
  ttest_paired: [
    '=== 配对样本 t 检验 ===',
    'PAIRS|pre|post|10|2.0|1.5',
    'PAIR_COR|0.9105',
    'METHOD|Paired t-test',
    'RESULT_PAIRED|-4.0621|9.00|p = 0.003|0.0028|2.0000|0.8861|3.1139|1.2847',
    'CONCL|两次测量差异具有统计学意义'
  ].join('\n'),
  ttest_one: [
    '=== 单样本 t 检验 ===',
    'DESC_ONE|score|32|20.0906|6.0269|20.0',
    'RESULT_ONE|0.0851|31.00|p = 0.933|0.9328|-2.0827|2.2636|0.0150',
    'MU_IN_CI|是',
    'CONCL|样本均值与检验值差异无统计学意义'
  ].join('\n'),
  anova: [
    '=== 单因素方差分析 ===',
    'LEVELS|3|L1,L2,L3',
    'GRP|L1|50|5.0060|0.3525',
    'GRP|L2|50|5.9360|0.5162',
    'GRP|L3|50|6.5880|0.6359',
    'ANOVA_ROW|组间|2|63.2121|31.6061|119.2645|p < 0.001|1.6696692e-31',
    'ANOVA_ROW|组内|147|38.9562|0.2650|NA|NA|NA',
    'ANOVA_ROW|总计|149|102.1683|NA|NA|NA|NA',
    'EFFECT|eta2|0.6187',
    'EFFECT|omega2|0.6139',
    'ASSUMPTION|Levene|p = 0.123|0.123',
    'POSTHOC|L2-L1|0.9300|0.6539|1.2061|p < 0.001|1e-10',
    'CONCL|各组均值差异具有统计学意义'
  ].join('\n'),
  chisquare: [
    '=== 卡方检验 ===',
    'TABLE_DIM|2|2',
    'EXPECTED|7.676|0',
    'METHOD|Pearson\'s Chi-squared test with Yates\' continuity correction',
    'RESULT_CHISQ|138.29|9|p < 0.001|1.5e-27|0.2071',
    'CONCL|两变量存在统计学关联'
  ].join('\n'),
  correlation: [
    '=== 相关分析 (pearson) ===',
    'VARS|mpg|wt|pearson',
    'DESC_COR|32|20.0906|6.0269|3.2173|0.9785',
    'RESULT_COR|-0.8677|p < 0.001|1.293959e-10|32',
    'CI_COR|-0.9338|-0.7441',
    'CONCL|存在极显著相关'
  ].join('\n'),
  regression: [
    '=== 线性回归分析 ===',
    'MODEL|0.8268|0.8148|69.2112|p < 0.001|2.2e-16|2.5112',
    'MODEL_DF|32|2|29',
    'RESPONSE|mpg',
    'COEF|(Intercept)|37.2272|1.5988|23.2849|0.0000000000001',
    'COEF|wt|-3.8778|0.6327|-6.1286|0.0000012',
    'COEF|hp|-0.0318|0.0090|-3.5191|0.0014',
    'BETA|wt|-0.6501',
    'BETA|hp|-0.3743',
    'VIF|wt|1.77',
    'VIF|hp|1.77',
    'RESID_NORMAL|p = 0.65|0.65',
    'CONCL|回归模型整体显著'
  ].join('\n'),
  reliability: [
    "=== 信度分析 (Cronbach's α) ===",
    'REVERSED|item4r',
    'ITEMS|4|90',
    'ALPHA|0.7500|0.7500',
    'ALPHA_CI|0.4356|0.9102',
    'ITEM|item1|4.5000|0.5189|0.8825|0.6100',
    'ITEM|item2|4.5000|0.5189|-0.1429|0.8100',
    'CONCL|信度可接受'
  ].join('\n'),
  normality: [
    '=== 正态性检验 (Shapiro-Wilk) ===',
    'NORM|mpg|32|0.9476|p = 0.123|0.1229|0.6110|-0.3730|未拒绝正态性假设',
    'NORM|wt|32|0.9200|p = 0.021|0.0208|0.7120|0.1230|拒绝正态性假设'
  ].join('\n'),
  nonparametric: [
    '=== 非参数检验 (Mann-Whitney U) ===',
    'GRP|0|30|15.0000|11.2000|19.7500',
    'GRP|1|30|22.5000|18.0000|25.2750',
    'METHOD|Wilcoxon rank sum exact test',
    'RESULT_MW|575.5|p = 0.064|0.0637|-0.1394',
    'CONCL|两组差异无统计学意义'
  ].join('\n'),
  frequency: [
    '=== 频数统计 ===',
    'FREQ_HEAD|Species|150|0',
    'FREQ|Species|setosa|50|33.3|33.3',
    'FREQ|Species|versicolor|50|33.3|33.3',
    'FREQ|Species|virginica|50|33.3|33.3'
  ].join('\n'),
  summary_by: [
    '=== 分类汇总 ===',
    'VARS|Species|Sepal.Length',
    'SUM|setosa|50|5.0060|0.3525|5.0000|4.3000|5.8000',
    'SUM|versicolor|50|5.9360|0.5162|5.9000|4.9000|7.0000',
    'TOTAL|150|5.8433|0.8281'
  ].join('\n')
}

/**
 * 解析 R 代码中的 sprintf 调用，返回 [格式串, 顶层参数个数] 列表。
 * 这是本文件最关键的一条防线：R 的 sprintf 在参数多余时只发 warning，
 * 而应用丢弃 stderr，所以字段缺失对用户完全不可见。
 */
function sprintfCalls(code: string): Array<{ fmt: string; args: number }> {
  const out: Array<{ fmt: string; args: number }> = []
  const re = /sprintf\(\s*"((?:[^"\\]|\\.)*)"\s*(?:,\s*([\s\S]*?))?\)\s*(?=\n|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const fmt = m[1]
    const argsRaw = (m[2] ?? '').trim()
    let args = 0
    if (argsRaw.length > 0) {
      let depth = 0
      let inStr = false
      args = 1
      for (let i = 0; i < argsRaw.length; i++) {
        const c = argsRaw[i]
        if (inStr) {
          if (c === '\\') i++
          else if (c === '"') inStr = false
          continue
        }
        if (c === '"') inStr = true
        else if (c === '(' || c === '[') depth++
        else if (c === ')' || c === ']') depth--
        else if (c === ',' && depth === 0) args++
      }
    }
    out.push({ fmt, args })
  }
  return out
}

/** 统计格式串中的转换说明符个数（%% 是字面百分号，不计） */
function specCount(fmt: string): number {
  return (fmt.replace(/%%/g, '').match(/%[-+ #0-9.*]*[a-zA-Z]/g) ?? []).length
}

describe('R 生成器语法契约', () => {
  it('每个生成器都输出唯一的 === 横幅，供解析器确定性判型', () => {
    for (const [name, gen] of Object.entries(GENERATORS)) {
      const code = gen()
      expect(code, `${name} 缺少横幅`).toMatch(/^cat\("=== .+? ===\\n"\)/m)
    }
  })

  it('横幅能唯一映射到 analysis type（无歧义、无 unknown）', () => {
    for (const [name, gen] of Object.entries(GENERATORS)) {
      const code = gen()
      // 取出横幅文本 + 该方法的代表性数据行，模拟真实 R stdout
      const banner = code.match(/^cat\("(=== .+? ===)\\n"\)/m)![1]
      const body =
        name === 'correlation_spearman' ? SAMPLE_OUTPUT['correlation'] : SAMPLE_OUTPUT[name] ?? ''
      const type = detectAnalysisType(`${banner}\n${body}`)
      expect(type, `${name} 的横幅「${banner}」未被识别`).not.toBe('unknown')
      if (name !== 'correlation_spearman') {
        expect(type, `${name} 的横幅「${banner}」被判为 ${type}`).toBe(name)
      } else {
        expect(type).toBe('correlation')
      }
    }
  })

  it('带数据行的完整输出也不会被误判（守住 v0.2.5 的 " N=" 缺陷）', () => {
    for (const [name, sample] of Object.entries(SAMPLE_OUTPUT)) {
      const type = detectAnalysisType(sample)
      expect(type, `真实输出被误判：期望 ${name}，实得 ${type}`).toBe(name)
    }
  })

  it('每种方法的代表性输出都能产出非空三线表', () => {
    for (const [name, sample] of Object.entries(SAMPLE_OUTPUT)) {
      const parsed = parseROutput(sample)
      expect(parsed.tables.length, `${name} 未产出任何三线表`).toBeGreaterThan(0)
      const rows = parsed.tables.reduce((n, t) => n + t.rows.length, 0)
      expect(rows, `${name} 的三线表没有数据行`).toBeGreaterThan(0)
    }
  })

  it('不使用换行裸 else —— R 语法要求 else 与 if 体同行，否则整脚本解析失败', () => {
    for (const [name, gen] of Object.entries(GENERATORS)) {
      const code = gen()
      // 匹配 "if (...) <单语句>" 后紧跟换行再出现 else 的写法
      const danglingElse = /if\s*\([^\n]*\)\s*(?!\{)[^\n{}]*\n\s*else\b/
      expect(danglingElse.test(code), `${name} 存在换行的裸 else`).toBe(false)
    }
  })

  it('不在 lm() 公式里给变量名加引号（v0.2.5 的 "y" ~ "x" 会让 R 报 invalid term）', () => {
    const code = RService.regressionCode('mpg', ['wt', 'hp'], 'data.csv')
    expect(code).not.toMatch(/lm\(\s*"/)
    expect(code).toMatch(/reformulate\(/)
  })

  it('ANOVA 不污染用户列名（不写 data$.dv / data$.grp）', () => {
    const code = RService.anovaCode('score', 'grp', 'data.csv')
    expect(code).not.toMatch(/data\$\.(dv|grp)\s*<-/)
  })

  it('summary_by 不覆盖用户可能的 value/group 列', () => {
    const code = RService.summaryByCode('grp', 'score', 'data.csv')
    expect(code).not.toMatch(/data\$(value|group)\s*<-/)
  })
})

describe('sprintf 格式串与参数个数一致', () => {
  it('所有生成器的每个 sprintf 调用都匹配（多一个参数会被 R 静默丢弃）', () => {
    for (const [name, gen] of Object.entries(GENERATORS)) {
      const code = gen()
      for (const { fmt, args } of sprintfCalls(code)) {
        expect(specCount(fmt), `${name} 格式串「${fmt}」说明符 ${specCount(fmt)} 个，实参 ${args} 个`).toBe(args)
      }
    }
  })
})

describe('p 值契约', () => {
  it('p 值用 APA 风格输出，不出现 %.4f 造成的 0.0000', () => {
    for (const [name, gen] of Object.entries(GENERATORS)) {
      const code = gen()
      expect(code, `${name} 仍在使用 %.4f 输出 p 值`).not.toMatch(/p\s*=\s*%\.4f/)
      expect(code, `${name} 未使用 fmt_p`).toContain('fmt_p')
    }
  })

  it('含 p 值的行同时携带展示串与原始数值（p<0.001 只有边界值，会丢失 1e-31 的精度）', () => {
    const anova = RService.anovaCode('score', 'grp', 'data.csv')
    // ANOVA_ROW 主效应行：... | fmt_p(p_val), num_p(p_val)
    expect(anova).toMatch(/fmt_p\(p_val\),\s*num_p\(p_val\)/)
    const cor = RService.correlationCode('x', 'y', 'pearson', 'data.csv')
    expect(cor).toMatch(/fmt_p\(res\$p\.value\),\s*num_p\(res\$p\.value\)/)
  })

  it('parsePValue 支持四种输入形态', () => {
    expect(parsePValue('p = .026').value).toBeCloseTo(0.026)
    expect(parsePValue('p < 0.001').value).toBe(0.001)
    expect(parsePValue('p < 0.001').display).toContain('<')
    expect(parsePValue('p = 1.2e-15').value).toBeCloseTo(1.2e-15)
    expect(parsePValue('p = 0.0000').value).toBe(0)
    expect(parsePValue('p = NA').value).toBeNull()
  })

  it('合法的 p = 0 不会被当成缺失（v0.2.5 的 || 会把它变成 1）', () => {
    const out = [
      '=== 相关分析 (pearson) ===',
      'VARS|x|y|pearson',
      'RESULT_COR|1.0000|p = 0.000|0|12',
      'CONCL|存在极显著相关'
    ].join('\n')
    const parsed = parseROutput(out)
    expect(parsed.keyValues['p']).toBe(0)
    expect(parsed.keyValues['p']).not.toBe(1)
    expect(parsed.keyValues['pDisplay']).toBe('p = 0.000')
  })
})

describe('解析器分派契约', () => {
  it('13 种方法都能被识别，且都不落入 unknown', () => {
    const seen = new Set<string>()
    for (const [name, gen] of Object.entries(GENERATORS)) {
      const banner = gen().match(/^cat\("(=== .+? ===)\\n"\)/m)![1]
      const type = detectAnalysisType(`${banner}\n`)
      expect(type, `${name}`).not.toBe('unknown')
      seen.add(type)
    }
    // correlation 与 correlation_spearman 映射到同一 type
    expect(seen.size).toBe(13)
  })

  it('分组统计行中的 " N=" 不会让 t 检验被误判为描述性统计', () => {
    const ttestOutput = [
      '=== 独立样本 t 检验 ===',
      'GRP|A|19|17.1474|3.8340',
      'GRP|B|19|20.6633|2.9097',
      'RESULT_IND|-3.7671|18.33|p = 0.001|0.0014|-7.2449|-11.2805|-3.2093|1.2|0.0606'
    ].join('\n')
    expect(detectAnalysisType(ttestOutput)).toBe('ttest_independent')
    expect(parseROutput(ttestOutput).tables.length).toBeGreaterThan(0)
  })

  it('无法识别时返回 unknown，绝不猜测类型（猜错比不猜更危险）', () => {
    // 旧版自由文本输出没有横幅。v0.2.5 会对它做子串猜测，
    // 而 ' N=' 会把分组行判成 descriptive。现在必须老实返回 unknown。
    const legacyNoBanner = [
      '组1 (0): N=19, M=17.1474, SD=3.8340',
      '组2 (1): N=19, M=20.6633, SD=2.9097',
      't = -3.7671, df = 18.33, p-value = 0.0014'
    ].join('\n')
    expect(detectAnalysisType(legacyNoBanner)).toBe('unknown')
    const parsed = parseROutput(legacyNoBanner)
    expect(parsed.type).toBe('unknown')
    // 关键：不得产出错误的三线表
    expect(parsed.tables).toHaveLength(0)
  })

  it('含 " N=" 的文本不会被路由到描述性统计（v0.2.5 的原始缺陷）', () => {
    const bait = ['=== 独立样本 t 检验 ===', '组1 (0): N=19, M=17.1', 't = -3.76, p = 0.001'].join('\n')
    expect(detectAnalysisType(bait)).toBe('ttest_independent')
    expect(detectAnalysisType('N=32 M=20.09 SD=6.03')).toBe('unknown')
  })

  it('含负值与科学计数的数值能被正确解析（字段以 | 分隔，不依赖数值正则）', () => {
    const out = [
      '=== 描述性统计 ===',
      'neg|5|-4.5000|1.5811|-6.5000|-2.5000|-4.5000',
      '__INFO__:neg|缺失=0|总计=5',
      'sci|5|0.0000|0.0000|1.2e-05|1.2e-05|1.2e-05'
    ].join('\n')
    const parsed = parseROutput(out)
    const table = parsed.tables[0]
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0][2]).toBeCloseTo(-4.5)
    expect(table.rows[0][4]).toBeCloseTo(-6.5)
    expect(table.rows[1][2]).toBeCloseTo(0)
  })

  it('ANOVA 从正确字段读取 F 与 p，且补齐 Df/SS/MS', () => {
    const out = [
      '=== 单因素方差分析 ===',
      'LEVELS|3|L1,L2,L3',
      'GRP|L1|50|5.006|0.3525',
      'ANOVA_ROW|组间|2|63.2121|31.6061|119.2645|p < 0.001|1.6696692e-31',
      'ANOVA_ROW|组内|147|38.9562|0.2650|NA|NA|NA',
      'ANOVA_ROW|总计|149|102.1683|NA|NA|NA|NA',
      'CONCL|各组均值差异具有统计学意义'
    ].join('\n')
    const parsed = parseROutput(out)
    expect(parsed.type).toBe('anova')
    expect(parsed.keyValues['F']).toBeCloseTo(119.2645, 3)
    // 关键：必须是真实 p 值（1.67e-31），而不是 Df 列读出的 2
    expect(parsed.keyValues['p'] as number).toBeLessThan(1e-20)
    const anovaTable = parsed.tables.find((t) => t.title.includes('方差分析'))!
    expect(anovaTable.headers).toEqual(['变异来源', 'Df', 'SS', 'MS', 'F', 'p'])
  })
})

describe('向导方法注册表一致性', () => {
  it('METHODS 为空说明导出被破坏', () => {
    expect(METHODS.length).toBe(13)
  })

  it('每个注册的方法 id 都有对应的 R 代码生成器（否则会执行空代码）', () => {
    for (const m of METHODS) {
      expect(GENERATORS[m.id], `方法 ${m.id} 没有生成器`).toBeDefined()
      expect(GENERATORS[m.id]()).toBeTruthy()
    }
  })

  it('生成器数量与方法数量一致（没有孤儿生成器）', () => {
    const methodIds = METHODS.map((m) => m.id).sort()
    const generatorIds = Object.keys(GENERATORS)
      .filter((k) => k !== 'correlation_spearman')
      .sort()
    expect(generatorIds).toEqual(methodIds)
  })
})
