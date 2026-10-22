/**
 * R stderr → warnings 提取（v0.2.7 / T31）
 *
 * 背景：`RExecuteResult.warnings` 自 v0.2.6 起就在 `shared/types.ts:19` 声明，
 * 但 `r:execute` 的返回对象从未给它赋值，于是渲染层的警告面板永远是空的。
 * "卡方期望频数不足""存在结点无法计算精确 p 值"这类**统计前提不满足**的提示
 * 被静默丢弃——用户拿到结果却不知道结论可能不可靠。
 */

import { describe, it, expect } from 'vitest'
import { parseRWarnings } from '../savImport'

describe('parseRWarnings — R stderr 中的警告提取', () => {
  it('提取单行 warning', () => {
    const stderr = 'Warning in t.test(x, y) : cannot compute exact p-value with ties\n'
    expect(parseRWarnings(stderr)).toEqual(['cannot compute exact p-value with ties'])
  })

  it('提取带 Warning message: 标题的块', () => {
    const stderr = [
      'Warning message:',
      'In chisq.test(x) : Chi-squared approximation may be incorrect'
    ].join('\n')
    const w = parseRWarnings(stderr)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('Chi-squared approximation may be incorrect')
  })

  it('多行 warning 的续行并入同一条', () => {
    const stderr = [
      'Warning message:',
      'In model.matrix.default(mt, mf, contrasts) :',
      '  non-list contrasts argument ignored'
    ].join('\n')
    const w = parseRWarnings(stderr)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('non-list contrasts argument ignored')
  })

  it('多个 warning 分别提取', () => {
    const stderr = ['Warning: message one', 'Warning in foo() : message two'].join('\n')
    expect(parseRWarnings(stderr)).toEqual(['message one', 'message two'])
  })

  it('"In addition: Warning messages:" 汇总块不产生重复条目', () => {
    const stderr = [
      'Warning in a : second',
      'In addition: Warning messages:',
      '1: In a : second',
      '2: In b : third'
    ].join('\n')
    expect(parseRWarnings(stderr)).toEqual(['second'])
  })

  it('无 warning 时返回空数组（不把普通 stderr 当警告）', () => {
    expect(parseRWarnings('')).toEqual([])
    expect(parseRWarnings('some ordinary stderr output')).toEqual([])
    expect(parseRWarnings(undefined)).toEqual([])
    expect(parseRWarnings(null)).toEqual([])
  })

  it('纯 "Warning message:" 标题行不产生空条目', () => {
    expect(parseRWarnings('Warning message:')).toEqual([])
  })

  it('单条 warning 长度上限 500 字符（防止超长 stderr 撑爆 UI）', () => {
    const long = 'Warning: ' + 'x'.repeat(2000)
    const w = parseRWarnings(long)
    expect(w[0].length).toBeLessThanOrEqual(500)
  })
})
