import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { METHODS } from '../../data/methodRegistry'
import { buildMethodListPrompt } from '../aiService'

/**
 * v0.3.5 / I-7：AI 提示词的方法清单必须**自动派生**自注册表。
 *
 * 历史缺陷：`ai.systemPrompt` 硬编码 8 个方法，而注册表已有 24 个。
 * 用户问"帮我做中介分析"时 AI 看不到该能力，就即兴手写 R 代码——
 * 绕开经过验证的生成器、解析契约与断言守护的公式。
 *
 * 这里测的是**最终发出的 prompt**，不是某个纯函数——
 * 另一个队友踩过"纯函数测了、调用点没测，把调用点改回去照样全绿"的坑。
 */
describe('AI 提示词方法清单自动派生（I-7）', () => {
  const SERVICES = join(__dirname, '..')          // src/renderer/src/services
  const RENDERER = join(SERVICES, '..')           // src/renderer/src

  it('buildMethodListPrompt 覆盖全部注册方法，且包含最新的 24 个方法', () => {
    const list = buildMethodListPrompt()
    const lines = list.split('\n').filter(Boolean)
    expect(lines).toHaveLength(METHODS.length)
    for (const m of METHODS) {
      expect(list, `方法「${m.id}」未出现在提示词清单中`).toContain(m.name)
    }
    // 抽查 v0.3.4 新增方法与 v0.3.2 因果链方法
    for (const name of ['层次回归', 'Logistic 回归', '中介效应', '结构方程模型']) {
      expect(list, `关键方法「${name}」缺失`).toContain(name)
    }
  })

  it('systemPrompt() 真正替换了 {METHOD_LIST}（测调用点，不是纯函数）', () => {
    const src = readFileSync(join(SERVICES, 'aiService.ts'), 'utf8')
    // 调用点必须调用 buildMethodListPrompt 并替换占位符
    expect(src, 'systemPrompt 未调用 buildMethodListPrompt').toMatch(/buildMethodListPrompt\(\)/)
    expect(src, 'systemPrompt 未替换 {METHOD_LIST} 占位符').toMatch(/replace\(\s*'\{METHOD_LIST\}'/)
    // 有防御：替换后不能残留花括号占位符（源码里写的是 /\{[A-Z_]+\}/ 形式的正则）
    expect(src, '缺少占位符残留的防御').toMatch(/\{[A-Z_]+\}/)
  })

  it('两个 locale 都含 METHOD_LIST 占位符（单一真相入口）', () => {
    for (const lang of ['zh-CN', 'en-US']) {
      const raw = readFileSync(join(RENDERER, 'i18n/locales', `${lang}.json`), 'utf8')
      expect(raw, `${lang} 缺少 METHOD_LIST 占位符`).toContain('{METHOD_LIST}')
    }
  })

  it('失败能力：注册表少一个方法时清单会跟着变（防硬编码回退）', () => {
    const list = buildMethodListPrompt()
    const lines = list.split('\n').filter(Boolean)
    // 若有人把清单改回写死 8 项，这条会红
    expect(lines.length, '清单不应退回到旧的 8 项').toBeGreaterThan(8)
    expect(lines.length).toBe(METHODS.length)
    // 清单必须真的引用 METHODS 的 name，而非另写一份
    expect(lines[0]).toBe(`- ${METHODS[0].name}：${METHODS[0].description}`)
  })
})

/**
 * v0.3.5 / I-6：AI 执行通道（r:execute）必须注入数据质量体检。
 *
 * 此前向导通道已通过 rwb_read 做体检，但 AI 通道的包装模板不含 R_COMMON，
 * AI 自己写 read.csv 时零警告——而目标用户更可能从对话框开始。
 */
describe('AI 执行通道注入数据体检（I-6）', () => {
  // __dirname = src/renderer/src/services/__tests__ → 上溯三级到 src
  const SRC_ROOT = join(__dirname, '..', '..', '..', '..')

  it('r:execute 包装模板在 AI 代码前跑体检并输出 DQ_WARN', () => {
    const src = readFileSync(join(SRC_ROOT, 'main/ipc.ts'), 'utf8')
    // prelude 存在
    expect(src, '未定义 dataQualityPrelude').toContain('dataQualityPrelude')
    // prelude 里真的做体检
    expect(src).toContain('DQ_WARN|')
    expect(src).toContain('DQ_NOTE|')
    // 关键：prelude 被注入到模板，且在 ${safeCode} 之前
    const preludePos = src.indexOf('${dataQualityPrelude}')
    const codePos = src.indexOf('${safeCode}')
    expect(preludePos, 'prelude 未注入包装模板').toBeGreaterThan(0)
    expect(codePos, 'safeCode 未找到').toBeGreaterThan(0)
    expect(preludePos, '体检必须在 AI 代码之前执行').toBeLessThan(codePos)
  })

  it('体检是只读的（不改数据文件、不阻断 AI 执行）', () => {
    const src = readFileSync(join(SRC_ROOT, 'main/ipc.ts'), 'utf8')
    const m = src.match(/const dataQualityPrelude = `([\s\S]*?)`\s*\n/)
    expect(m, '未找到 prelude 定义').toBeTruthy()
    const body = m![1]
    // 错误被吞掉：体检失败不应阻断
    expect(body).toContain('error = function(e) NULL')
    // 只读：prelude 内不写 data.csv
    expect(body, '体检不应写入数据文件').not.toMatch(/write\.(csv|table)/)
    // 数据不存在时静默跳过
    expect(body).toContain('file.exists("data.csv")')
  })
})
