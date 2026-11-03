import { describe, it, expect } from 'vitest'
import { parseROutput } from '../resultParser'

/**
 * 数据质量警告的解析（v0.3.3 / D02+D03）
 *
 * 背景：R 端 `r_quality_check_all` 会输出 `DQ_WARN|变量|类型|计数|详情` 行。
 * 这些警告必须**到达用户**——实测单点极端值能让 ANOVA 从 p=5.6e-28 变成 0.374，
 * 而此前项目没有任何离群值检测，用户完全无从察觉结果已被录入错误摧毁。
 *
 * 如果解析器不消费 DQ_WARN，那么 R 端做得再好也是"哑的"——
 * 这正是本项目反复吃亏的"改了没测/接了没通"。
 */
describe('解析器消费 DQ_WARN（数据质量警告）', () => {
  const output = [
    '=== 信度分析 (Cronbach\'s α) ===',
    'DQ_WARN|q1|outlier|2|detected 2 extreme value(s), |z| > 3 or outside IQR fence',
    'DQ_WARN|score|out_of_range|1|1 value(s) outside 1..5, checked as Likert scale',
    'DQ_WARN|age|high_missing|5|缺失 5/100（5.0%）',
    'DQ_WARN|grp|constant|100|常量列，唯一值 1',
    'ALPHA|0.9263|0.9268'
  ].join('\n')

  it('DQ_WARN 被转成 warning 类诊断', () => {
    const parsed = parseROutput(output)
    expect(parsed.type).toBe('reliability')
    const warns = parsed.diagnostics.filter((d) => d.kind === 'warning')
    expect(warns.length, '四条 DQ_WARN 应全部变成诊断').toBe(4)
  })

  it('每条警告都带上变量名与类型标签', () => {
    const parsed = parseROutput(output)
    const labels = parsed.diagnostics.map((d) => d.label)
    expect(labels.some((l) => l.includes('q1') && l.includes('极端值'))).toBe(true)
    expect(labels.some((l) => l.includes('score') && l.includes('值域越界'))).toBe(true)
    expect(labels.some((l) => l.includes('age') && l.includes('高缺失'))).toBe(true)
    expect(labels.some((l) => l.includes('grp') && l.includes('常量列'))).toBe(true)
  })

  it('警告内容包含计数与详情（用户要能看到是几个、是什么问题）', () => {
    const parsed = parseROutput(output)
    const q1 = parsed.diagnostics.find((d) => d.label.includes('q1'))
    expect(q1).toBeDefined()
    expect(q1!.value).toContain('2')
    expect(q1!.value).toContain('extreme')
  })

  it('没有 DQ_WARN 时不产生多余诊断（防误报）', () => {
    const clean = ['=== 信度分析 (Cronbach\'s α) ===', 'ALPHA|0.9263|0.9268'].join('\n')
    const parsed = parseROutput(clean)
    expect(parsed.diagnostics.filter((d) => d.kind === 'warning').length).toBe(0)
  })

  it('未知类型的 DQ_WARN 也不会丢失（宁可显示原始信息也不静默吞掉）', () => {
    const odd = ['=== 信度分析 (Cronbach\'s α) ===', 'DQ_WARN|x|weird_kind|3|某说明'].join('\n')
    const parsed = parseROutput(odd)
    const w = parsed.diagnostics.filter((d) => d.kind === 'warning')
    expect(w.length).toBe(1)
    expect(w[0].label).toContain('x')
    expect(w[0].value).toContain('某说明')
  })
})
