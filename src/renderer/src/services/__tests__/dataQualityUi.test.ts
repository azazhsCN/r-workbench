import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 数据质量警告的**界面接线**契约测试（v0.3.3 跟进 / F3 的第二部分）
 *
 * 背景：第三方跟进验证指出，`checkDataQuality()` 早就实现且有 36 个单测，
 * 但 DataPage / 导入流程**没有任何调用点**——纯函数正确、用户完全看不到。
 * 第一阶段已把数据接进 `ParseResult.qualityIssues`（见 `importQuality.test.ts`）。
 *
 * 这里验证**第二阶段**：界面是否真的会把它渲染出来。
 *
 * ⚠️ 诚实说明本测试的边界：
 * 项目当前没有 React 测试库（@testing-library/react / jsdom），
 * 引入它们会改变测试环境（现有 17 个测试文件全部跑在 `environment: 'node'` 下）。
 * 因此这里做的是**静态契约检查**——从源码层面确认"接线存在且关键分支齐全"，
 * 而不是真实渲染 DOM 后断言视觉呈现。
 *
 * 它能抓到的问题：
 *   - 有人删掉渲染分支 → 用户重新看不到警告
 *   - 有人删掉分级配色 → 严重/轻微不再区分
 *   - 有人删掉定位按钮或 data-preview-row 属性 → 点击定位失效
 *   - 有人把"干净数据不渲染"的条件去掉 → 每份数据都顶着一条空警告条
 *
 * 它抓不到的问题：颜色是否好看、文案是否通顺、点击后滚动是否流畅。
 * 这些仍需人工在 Electron 里过一遍。**不把静态检查伪装成视觉验证。**
 */
describe('DataPage 渲染数据质量警告（F3 界面接线）', () => {
  const DATA_PAGE = join(__dirname, '..', '..', 'pages', 'DataPage.tsx')
  const src = readFileSync(DATA_PAGE, 'utf8')

  it('从 ParseResult 读取 qualityIssues 并计算严重级别', () => {
    expect(src, '未从 parseResult 读取 qualityIssues').toMatch(
      /const\s+qualityIssues\s*=\s*parseResult\?\.qualityIssues\s*\?\?\s*\[\]/
    )
    expect(src, '未计算 hasSevereQuality（分级配色依赖它）').toMatch(
      /const\s+hasSevereQuality\s*=\s*qualityIssues\.some/
    )
  })

  it('干净数据不渲染任何质量 UI（避免凭空多出一条空警告条）', () => {
    // 关键：条件必须是 qualityIssues.length > 0
    expect(src, '渲染条件缺失：应只在有质量问题时才渲染').toMatch(
      /\{qualityIssues\.length\s*>\s*0\s*&&\s*\(/
    )
  })

  it('严重级与轻微级用不同配色（否则分级形同虚设）', () => {
    // 严重级用 danger 色，轻微级退回 warning 色
    expect(src, '未按严重级别切换配色').toMatch(/hasSevereQuality\s*\?\s*'var\(--danger/)
    expect(src, '严重级图标应为 ⛔').toContain('⛔')
    expect(src, '轻微级图标应为 ⚠️').toContain('⚠️')
  })

  it('每条问题都显示变量名与类型标签', () => {
    // 类型走 i18n 键 data.quality.kind.<kind>
    expect(src, '未渲染问题类型（outlier/out_of_range 等）').toMatch(
      /data\.quality\.kind\.\$\{issue\.kind\}/
    )
    expect(src, '未显示变量名').toMatch(/\{issue\.column\}/)
  })

  it('提供"定位到该行"按钮，且数据表行带对应锚点属性', () => {
    expect(src, '缺少跳转按钮的 i18n 键').toContain('data.quality.jumpToRow')
    // 按钮点击时按 data-preview-row 查找行
    expect(src, '跳转逻辑未按 data-preview-row 查找目标行').toMatch(
      /querySelector\(`\[data-preview-row="\$\{row\}"\]`\)/
    )
    // 数据预览的 <tr> 必须真的带这个属性，否则永远定位不到
    expect(src, '数据预览行缺少 data-preview-row 锚点').toMatch(
      /<tr\s+key=\{i\}\s+data-preview-row=\{i\}>/
    )
  })

  it('明确告知"软件没有修改你的数据"（产品红线：只提示不改数据）', () => {
    expect(src, '缺少"未修改数据"的声明').toContain('data.quality.notModified')
  })
})

/**
 * 中英文 i18n 键必须同时存在且完全一致。
 * 少一个键会让另一种语言界面直接显示原始 key（如 data.quality.jumpToRow）。
 */
describe('数据质量相关 i18n 键中英文一致', () => {
  const LOCALES = join(__dirname, '..', '..', 'i18n', 'locales')
  const REQUIRED = [
    'data.quality.title',
    'data.quality.hint',
    'data.quality.notModified',
    'data.quality.jumpToRow',
    'data.quality.kind.outlier',
    'data.quality.kind.out_of_range',
    'data.quality.kind.high_missing',
    'data.quality.kind.constant'
  ]

  for (const lang of ['zh-CN', 'en-US']) {
    it(`${lang}.json 含全部 ${REQUIRED.length} 个质量相关键`, () => {
      const raw = readFileSync(join(LOCALES, `${lang}.json`), 'utf8')
      const parsed = JSON.parse(raw) as { data?: Record<string, string> }
      // 该项目 locale 结构：顶层分段（app/nav/data/...），段内用扁平点号键。
      // 所以 data.quality.title 实际存在 data 段的 "quality.title" 键。
      const dataSection = parsed.data ?? {}
      const missing = REQUIRED.filter((k) => {
        const shortKey = k.replace(/^data\./, '')
        return !(shortKey in dataSection)
      })
      expect(missing, `${lang} 缺少键：${missing.join(', ')}`).toHaveLength(0)
    })
  }
})
