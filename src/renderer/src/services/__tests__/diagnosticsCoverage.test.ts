/**
 * R 端警告在解析层的存活测试（v0.3.5 / I-9）
 *
 * ── 这条缺陷是什么 ──
 *
 * v0.3.3/v0.3.4 最值钱的东西是那批**自我限制声明**：
 *   - D04：「结局方程 Y ~ M + X_c，**未纳入 W 的主效应**」
 *   - D05：反向计分披露
 *   - SEM：多起点一致性、Heywood 案例、恰好识别时指标无判别力
 * 它们从 R 端用 `cat()` 打出来了，但 `collectDiagnostics()` 只认 6 个写死的标签，
 * 其余 9 个（LOGIT_WARN / HIER_NOTE / MED_NOTE / MM_NOTE / MOD_NOTE /
 * PATH_NOTE / SEM_NOTE / RELIABILITY_NOTE / RELIABILITY_WARN / DQ_NOTE）
 * 在解析层被**静默丢弃**。
 *
 * 后果不是"少一行字"：界面诊断区看不到，AI 解读的 `{diagnostics}` 渲染成
 * 「（无）」，而表格里仍带着可能错误的数值 —— 用户拿到的是一份
 * **自信的错结论**，而不是"有保留的结论"。
 *
 * ── 本文件的断言逻辑 ──
 *
 * 核心不变式：**R 端输出了几条 `*_WARN`/`*_NOTE`，解析后就必须有对应几条**
 * （允许显式分支合并/改名，但**条数不得减少**）。
 * 用「计数 + 逐条内容」双向断言，而不是 `diagnostics.length > 0` ——
 * 后者在只收集 1/7 条时也是绿的，正是本缺陷当初存活的原因。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import i18n from '../../i18n'
import { parseROutput, type Diagnostic } from '../resultParser'
import {
  extractWarningLines,
  truncateRawOutput,
  buildInterpretPrompt
} from '../interpretService'

/**
 * CI 的 runner 默认语言是英文（本地开发是中文），而下方若干断言用中文标签切分
 * prompt（`假设检验诊断：` / `原始 R 输出：`）。若不显式固定语言，
 * 同一份测试本地全绿、CI 上 4 条失败——这正是 2026-11-23 两次 CI 红灯的根因。
 *
 * 测试必须与环境语言无关：显式切到 zh-CN。
 */
beforeAll(async () => {
  await i18n.changeLanguage('zh-CN')
})

/** R 端 `*_WARN` / `*_NOTE` 行的条数（含未被解析器显式注册的） */
function countWarnNoteLines(output: string): number {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Z][A-Z0-9_]*_(?:WARN|NOTE)\|/.test(l)).length
}

/** 解析后 diagnostics 中由通用收集器（label 即标签名）产生的条目 */
function genericDiagnostics(diags: Diagnostic[]): Diagnostic[] {
  return diags.filter((d) => /^[A-Z][A-Z0-9_]*_(?:WARN|NOTE)$/.test(d.label))
}

/** 取某标签的条目（单条场景用；同标签多行时返回第一条） */
function byLabel(diags: Diagnostic[], label: string): Diagnostic | undefined {
  return diags.find((d) => d.label === label)
}

/* ══════════════════════════════════════════════════════════════════
 * 一、核心不变式：每个场景 R 端的 WARN/NOTE 条数 == 解析后条数
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 六个曾丢警告的场景。文案**逐字取自 R 生成器源码**
 * （rGenerators/*.ts 与 rService.ts 的 cat(sprintf("XXX_NOTE|..." ))），
 * 不是编造的占位串——否则测试只是在验证解析器能读我自己写的假数据。
 */
const SCENARIOS: Array<{
  name: string
  banner: string
  /** 该场景的 WARN/NOTE 行（真实文案） */
  warnLines: string[]
  /** 该场景的正文行（让 detectAnalysisType 走对应分支） */
  body: string[]
}> = [
  {
    name: 'logit_binary',
    banner: '=== Logistic 回归分析（二元） ===',
    warnLines: [
      'LOGIT_WARN|分类准确率 0.7400 仅略高于基线 0.6233（提升 0.1167），不能据此宣称模型有实际预测价值',
      'LOGIT_NOTE|估计方法：极大似然 ML（纯 base R 实现，未使用外部包）'
    ],
    body: ['LOGIT_SPEC|500|2|1', 'LOGIT_FIT|173.72|2|p < 0.001|1.2e-38|0.3412']
  },
  {
    name: 'hier',
    banner: '=== 层次回归分析 ===',
    warnLines: [
      'HIER_NOTE|ΔR² 的 F 检验以「步骤 1 模型」为基准；若步骤 1 未含控制变量，ΔR² 会高估新增变量的贡献'
    ],
    body: ['HIER_STEP|1|0.2412|0.2371|0.0521', 'HIER_STEP|2|0.3876|0.3802|0.1464']
  },
  {
    name: 'mediation',
    banner: '=== 中介效应分析 ===',
    warnLines: [
      'MED_NOTE|因缺失值采用逐行删除（listwise / 个案剔除），剔除 5 行，有效样本 495',
      'MED_NOTE|区间方法：percentile Bootstrap，5000 次重抽样，种子 20240101',
      'MED_NOTE|间接效应 a×b 的 CI 不含 0，支持存在中介效应',
      'MED_NOTE|完全标准化：所有变量已做 z 标准化，因此 a/b/c\' 均为标准化系数'
    ],
    body: ['MED_COEF|a|0.5123|0.0431|11.886|p < 0.001|1.4e-32', 'MED_EFFECT|indirect|0.2412|0.0611|0.1321|0.3712']
  },
  {
    name: 'moderated_mediation',
    banner: '=== 有调节的中介分析 ===',
    warnLines: [
      'MM_NOTE|因缺失值采用逐行删除（listwise / 个案剔除），剔除 65 行，有效样本 235',
      'MM_NOTE|X 与 W 均已做均数中心化（X 均值 3.4121，W 均值 4.0213），因此 a2 表示 W 处于均值时的条件前段效应',
      // ★ D04 的那一条：整个 v0.3.3 最值钱的自我限制声明
      'MM_NOTE|模型设定：中介方程 M ~ X_c + W_c + X_c:W_c；结局方程 Y ~ M + X_c。结局方程未纳入 W 的主效应（也未纳入 X_c:W_c），这是本工具的固定设定。若理论上 W 直接影响 Y，请改用含 W 主效应的设定或自行复核',
      'MM_NOTE|能力边界：本工具仅支持调节前半段路径（X -> M）。第二阶段的调节（M x W -> Y，Process Model 14）、双阶段调节（Model 15）与多重中介链均不支持',
      'MM_NOTE|index of moderated mediation = a4 x b = 0.0871；CI 来自 5000 次 percentile Bootstrap（种子 20240101，95% 水平）',
      'MM_NOTE|重要：index 显著只说明条件间接效应随 W 变化，不等于每个 W 水平上的间接效应都显著；两者必须分开报告',
      'MM_NOTE|index 的 95% CI 不含 0（0.0211, 0.1642），支持「有调节的中介」的存在'
    ],
    body: ['MM_COEF|a1|0.4123|0.0501|8.229|p < 0.001|1.1e-15', 'MM_INDEX|0.0871|0.0211|0.1642']
  },
  {
    name: 'reliability',
    banner: "=== 信度分析 (Cronbach's α) ===",
    warnLines: [
      'RELIABILITY_WARN|项目数少于 3（k = 2），α 的稳定性差，建议增加题项',
      'RELIABILITY_NOTE|题目数为奇数（k = 5），内部一致性以 α 为准而不宜用分半信度',
      'RELIABILITY_NOTE|未检测到需要反向计分的项目'
    ],
    body: ['ALPHA|0.8434|0.8501', 'ITEMS|5|300', 'ITEM|q1|3.4121|0.8123|0.6521|0.8100']
  },
  {
    name: 'sem',
    banner: '=== 结构方程模型 (SEM) ===',
    warnLines: [
      'SEM_NOTE|因缺失值采用逐行删除（listwise / 个案剔除），剔除 12 行，有效样本 288',
      'SEM_NOTE|估计方法：极大似然 ML（相关矩阵，纯 base R 实现，未使用 lavaan）；潜变量方差固定为 1 识别，因此结构系数已是标准化系数',
      'SEM_NOTE|多起点一致性：3/3 个起点收敛，F_ML 绝对极差 0.0000e+00（容差 1.0e-06，一致）；全部取 F 最小者，固定种子可复现',
      'SEM_NOTE|样本量与参数量之比：n = 288，自由参数 21 个，每个参数约 13.7 个样本（建议 >= 10）',
      'SEM_NOTE|外生潜变量 F1, F2 之间按模型设定假定不相关（本版不支持外生潜变量间的残差相关）；若理论上应当相关，请为它们增设路径或改用其他方法'
    ],
    body: ['SEM_FIT|45.1234|24|p = 0.0055|0.0055', 'SEM_FITIDX|0.9721|0.9582|0.0554|0.0341']
  }
]

describe('I-9 核心不变式：每个场景 R 端 WARN/NOTE 条数 == 解析后条数', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.name}: ${sc.warnLines.length} 条警告全部存活到 diagnostics`, () => {
      const output = [sc.banner, ...sc.warnLines, ...sc.body].join('\n')
      const parsed = parseROutput(output)

      const expected = countWarnNoteLines(output)
      expect(expected, 'fixture 自身应有警告行').toBe(sc.warnLines.length)

      const survived = genericDiagnostics(parsed.diagnostics)
      expect(
        survived.length,
        `${sc.name} 丢失了 ${expected - survived.length} 条警告。` +
          `R 端 ${expected} 条，解析后 ${survived.length} 条。` +
          `实际收到的标签：${survived.map((d) => d.label).join(', ') || '（无）'}`
      ).toBe(expected)
    })

    it(`${sc.name}: 每条警告的原文都完整保留（内容不得被截断/改写）`, () => {
      const output = [sc.banner, ...sc.warnLines, ...sc.body].join('\n')
      const diags = parseROutput(output).diagnostics
      // 同一标签可能有多行（MM_NOTE 7 条、SEM_NOTE 5 条），
      // 因此按「标签 + 原文」逐条比对，而不是按标签只取第一条。
      const surviving = genericDiagnostics(diags).map((d) => `${d.label}|${d.value}`)
      for (const line of sc.warnLines) {
        expect(
          surviving,
          `${sc.name}: 这一行原文未完整存活 → ${line}`
        ).toContain(line)
      }
    })
  }
})

/* ══════════════════════════════════════════════════════════════════
 * 二、D04 那条声明必须能被检索到（最值钱的一条）
 * ══════════════════════════════════════════════════════════════════ */

describe('D04 的「结局方程未纳入 W」必须出现在 diagnostics', () => {
  const sc = SCENARIOS.find((s) => s.name === 'moderated_mediation')!

  it('MM_NOTE 中那条模型设定声明逐字可达', () => {
    const output = [sc.banner, ...sc.warnLines, ...sc.body].join('\n')
    const diags = parseROutput(output).diagnostics
    const hit = diags.find((d) => d.value.includes('结局方程未纳入 W 的主效应'))
    expect(hit, 'D04 的自我限制声明在解析层丢失了 —— 这是本任务最不能接受的结果').toBeDefined()
    expect(hit!.label).toBe('MM_NOTE')
    expect(hit!.kind).toBe('note')
  })

  it('「能力边界」声明同样可达（第二阶段调节不支持）', () => {
    const output = [sc.banner, ...sc.warnLines, ...sc.body].join('\n')
    const diags = parseROutput(output).diagnostics
    expect(diags.some((d) => d.value.includes('第二阶段的调节（M x W -> Y，Process Model 14）'))).toBe(true)
  })
})

/* ══════════════════════════════════════════════════════════════════
 * 三、kind 映射：_WARN → warning，_NOTE → note
 * ══════════════════════════════════════════════════════════════════ */

describe('kind 映射规则正确', () => {
  it('*_WARN → warning，*_NOTE → note', () => {
    const output = [
      '=== 中介效应分析 ===',
      'MED_WARN|这是一个警告',
      'MED_NOTE|这是一个备注',
      'MED_COEF|a|0.5|0.1|5.0|p < 0.001|1e-6'
    ].join('\n')
    const diags = parseROutput(output).diagnostics
    expect(byLabel(diags, 'MED_WARN')!.kind).toBe('warning')
    expect(byLabel(diags, 'MED_NOTE')!.kind).toBe('note')
  })

  it('通用收集器不会误吞非 WARN/NOTE 的结构化行', () => {
    // 这些标签都以 NOTE/WARN 开头但不是 _WARN/_NOTE 结尾，必须由各自专用的
    // 分支处理，不能被通用收集器重复收进来
    const output = [
      '=== 独立样本 t 检验 ===',
      'NOTE_DROPPED|剔除 3 行',
      'WARN_EXPECTED|存在期望频数 < 5 的单元格',
      'GRP|0|19|17.1474|3.8340',
      'RESULT_IND|-3.7671|18.33|p = 0.001|0.0014|-7.2449|-11.2805|-3.2093|1.2|0.0606'
    ].join('\n')
    const diags = parseROutput(output).diagnostics
    // 各出现恰好一次（显式分支负责），通用收集器不重复添加
    expect(diags.filter((d) => d.label === '缺失值处理').length).toBe(1)
    expect(diags.filter((d) => d.label === '卡方适用性').length).toBe(1)
    expect(genericDiagnostics(diags)).toEqual([])
  })

  it('已显式处理的 DQ_WARN 不重复进入通用收集器（去重）', () => {
    const output = [
      '=== 描述性统计 ===',
      'DQ_WARN|score|outlier|1|detected 1 extreme value(s)',
      'score|20|10.0000|1.0000|9.0000|11.0000|10.0000'
    ].join('\n')
    const diags = parseROutput(output).diagnostics
    // 显式分支产出「数据质量（极端值）：score」，且只有一条
    const dq = diags.filter((d) => d.label.includes('数据质量'))
    expect(dq.length).toBe(1)
    expect(dq[0].label).toContain('极端值')
    // 通用收集器不得再以 label='DQ_WARN' 加一条
    expect(byLabel(diags, 'DQ_WARN')).toBeUndefined()
  })
})

/* ══════════════════════════════════════════════════════════════════
 * 四、DQ_NOTE（v0.3.3 两级告警的轻微级，一直没接）
 * ══════════════════════════════════════════════════════════════════ */

describe('DQ_NOTE 轻微级数据质量提示', () => {
  const OUTPUT = [
    '=== 探索性因子分析 (EFA) ===',
    'DQ_NOTE|q1|outlier|2|detected 2 mild outlier(s) beyond |z|>3 or 1.5x IQR fence, worth a glance',
    'NFACTOR|2'
  ].join('\n')

  it('DQ_NOTE 能被解析出来（v0.3.3 设计了轻微级但一直没接）', () => {
    const diags = parseROutput(OUTPUT).diagnostics
    const note = byLabel(diags, 'DQ_NOTE')
    expect(note, 'DQ_NOTE 未被解析').toBeDefined()
    // 轻微级 → note（不是 warning），这样 UI 可以用更弱的视觉层级
    expect(note!.kind).toBe('note')
    expect(note!.value).toContain('mild outlier')
  })

  it('DQ_NOTE 与 DQ_WARN 的呈现有区分度（kind 不同、文案不同）', () => {
    const output = [
      '=== 探索性因子分析 (EFA) ===',
      'DQ_WARN|score|outlier|1|detected 1 extreme value(s) beyond |z|>4',
      'DQ_NOTE|q1|outlier|2|detected 2 mild outlier(s)',
      'NFACTOR|2'
    ].join('\n')
    const diags = parseROutput(output).diagnostics
    const warn = diags.find((d) => d.label.includes('数据质量'))
    const note = byLabel(diags, 'DQ_NOTE')
    expect(warn).toBeDefined()
    expect(note).toBeDefined()
    // 严重级是 warning 且带列名与类型；轻微级是 note 且 label 为标签本身
    expect(warn!.kind).toBe('warning')
    expect(note!.kind).toBe('note')
    expect(warn!.label).not.toBe(note!.label)
  })
})

/* ══════════════════════════════════════════════════════════════════
 * 五、通用收集器的"前瞻性"：未存在的新标签也自动生效
 * ══════════════════════════════════════════════════════════════════ */

describe('通用规则而非白名单：全新标签无需注册即可收集', () => {
  it('未来新增的 FANCY_NEW_WARN / FANCY_NEW_NOTE 自动进 diagnostics', () => {
    // 这正是"不要逐个补标签"的意义：这条测试没有对应的产品代码，
    // 但通用规则能自动覆盖。若有人退回白名单写法，这条会立刻变红。
    const output = [
      '=== 探索性因子分析 (EFA) ===',
      'FANCY_NEW_WARN|一个未来才会出现的警告',
      'FANCY_NEW_NOTE|一个未来才会出现的备注',
      'NFACTOR|2'
    ].join('\n')
    const diags = parseROutput(output).diagnostics
    expect(byLabel(diags, 'FANCY_NEW_WARN')!.kind).toBe('warning')
    expect(byLabel(diags, 'FANCY_NEW_NOTE')!.kind).toBe('note')
    expect(byLabel(diags, 'FANCY_NEW_WARN')!.value).toBe('一个未来才会出现的警告')
  })

  it('含多个 | 的 NOTE 自由文本不被截断（value 存整段）', () => {
    const output = [
      '=== 探索性因子分析 (EFA) ===',
      'X_NOTE|前半段|后半段|第三段',
      'NFACTOR|2'
    ].join('\n')
    expect(byLabel(parseROutput(output).diagnostics, 'X_NOTE')!.value).toBe('前半段|后半段|第三段')
  })

  it('小写或非 _WARN/_NOTE 结尾的标签不被误收', () => {
    const output = [
      '=== 探索性因子分析 (EFA) ===',
      'med_note|小写不算',
      'MED_NOTES|复数形式不算',
      'MED_NOTE_EXTRA|后缀不算',
      'NFACTOR|2'
    ].join('\n')
    expect(genericDiagnostics(parseROutput(output).diagnostics)).toEqual([])
  })
})

/* ══════════════════════════════════════════════════════════════════
 * 六、interpretService：diagnostics 兜底与截断
 * ══════════════════════════════════════════════════════════════════ */

describe('interpretService：diagnostics 为空时不得渲染成「（无）」', () => {
  it('diagnostics 为空但 rawOutput 含警告 → prompt 里注入警告原文', () => {
    // 模拟"没走 parseROutput"的调用方：手工拼一个 diagnostics 为空的 analysis
    const analysis = {
      type: 'moderated_mediation',
      tables: [],
      keyValues: {},
      rawOutput: [
        '=== 有调节的中介分析 ===',
        'MM_NOTE|结局方程未纳入 W 的主效应',
        'CONCL|存在有调节的中介'
      ].join('\n'),
      diagnostics: []
    }
    const prompt = buildInterpretPrompt(analysis)
    // 断言落在"诊断段"本身，而不是整个 prompt ——
    // tables / keyValues 为空时它们各自渲染成「（无）」是**正确**行为，
    // 全局 not.toContain('（无）') 会误伤它们（第一版就这么错了）。
    const diagSection = prompt.split('假设检验诊断：')[1]?.split('三线表数据：')[0] ?? ''
    expect(diagSection, '未找到诊断段').not.toBe('')
    expect(diagSection).not.toContain('（无）')
    expect(diagSection).toContain('MM_NOTE: 结局方程未纳入 W 的主效应')
    expect(extractWarningLines(analysis.rawOutput)).toHaveLength(1)
  })

  it('diagnostics 非空时优先用 diagnostics（raw 兜底不重复注入）', () => {
    const analysis = {
      type: 'mediation',
      tables: [],
      keyValues: {},
      rawOutput: ['=== 中介效应分析 ===', 'MED_NOTE|这是备注'].join('\n'),
      diagnostics: [{ kind: 'note' as const, label: 'MED_NOTE', value: '这是备注' }]
    }
    const prompt = buildInterpretPrompt(analysis)
    const diagSection = prompt.split('假设检验诊断：')[1]?.split('三线表数据：')[0] ?? ''
    expect(diagSection).toContain('MED_NOTE: 这是备注')
    // 诊断段内只出现一次（raw 兜底只在 diagnostics 为空时启用）
    expect(diagSection.split('这是备注').length - 1).toBe(1)
  })

  it('prompt 里带「必须转述警告」的要求', () => {
    const analysis = {
      type: 'sem',
      tables: [],
      keyValues: {},
      rawOutput: '=== 结构方程模型 (SEM) ===\nSEM_NOTE|多起点一致性 3/3',
      diagnostics: []
    }
    const prompt = buildInterpretPrompt(analysis)
    expect(prompt).toContain('必须')
    expect(prompt).toMatch(/警告|限制声明/)
  })
})

describe('interpretService：rawOutput 按行截断并优先保留关键行', () => {
  it('超长输出的尾部 CONCL 与 *_NOTE 必须进入 prompt（旧实现会被 substring 切掉）', () => {
    // 造一份 > 2000 字符的输出：大量 COEF 行 + 尾部的结论与声明
    const filler = Array.from({ length: 120 }, (_, i) => `COEF|var${i}|0.1234|0.0456|2.705|p = 0.007|0.0069|0.1|1.2`)
    const raw = [
      '=== 结构方程模型 (SEM) ===',
      ...filler,
      'SEM_NOTE|多起点一致性：3/3 个起点收敛',
      'SEM_NOTE|外生潜变量按模型设定假定不相关',
      'CONCL|结构模型整体可接受'
    ].join('\n')

    expect(raw.length, 'fixture 必须超过 2000 字符才具检验力').toBeGreaterThan(2000)

    // 旧行为（substring 2000）会丢掉什么？下面显式证明这一点：
    expect(raw.substring(0, 2000), '旧实现确实切掉了 CONCL').not.toContain('CONCL|')

    const kept = truncateRawOutput(raw, 2000)
    expect(kept).toContain('CONCL|结构模型整体可接受')
    expect(kept).toContain('SEM_NOTE|多起点一致性：3/3 个起点收敛')
    expect(kept).toContain('SEM_NOTE|外生潜变量按模型设定假定不相关')
    expect(kept.length, '仍需受预算约束（不能无限长）').toBeLessThan(2600)
  })

  it('未超预算时内容与原文一致（不因截断逻辑改变正常路径）', () => {
    const raw = ['=== 相关分析 (pearson) ===', 'VARS|x|y|pearson', 'CONCL|存在显著相关'].join('\n')
    const kept = truncateRawOutput(raw, 2000)
    for (const line of raw.split('\n')) expect(kept).toContain(line)
  })

  it('buildInterpretPrompt 端到端：超长输出的尾部 CONCL/NOTE 仍进入 prompt', () => {
    // ⚠️ 这条是补出来的。第一版只测了 truncateRawOutput() 这个纯函数，
    // 结果我把 buildInterpretPrompt 里的调用退回 `substring(0, 2000)` 后，
    // 28 个测试**全部照常通过** —— 纯函数测了、调用点没测，等于没测。
    // 现在直接断言最终 prompt 的内容，调用点被改坏就会红。
    const filler = Array.from({ length: 120 }, (_, i) => `COEF|var${i}|0.1234|0.0456|2.705|p = 0.007|0.0069`)
    const analysis = {
      type: 'sem',
      tables: [],
      keyValues: {},
      rawOutput: [
        '=== 结构方程模型 (SEM) ===',
        ...filler,
        'SEM_NOTE|多起点一致性：3/3 个起点收敛',
        'CONCL|结构模型整体可接受'
      ].join('\n'),
      diagnostics: []
    }
    const prompt = buildInterpretPrompt(analysis)
    const rawSection = prompt.split('原始 R 输出：')[1] ?? ''
    expect(rawSection, '未找到原始输出段').not.toBe('')
    expect(rawSection, '尾部 CONCL 被切掉了（调用点仍在用 substring）').toContain('CONCL|结构模型整体可接受')
    expect(rawSection, '尾部 SEM_NOTE 被切掉了').toContain('SEM_NOTE|多起点一致性')
  })

  it('关键行自身超预算时退化为截断关键行，且不丢 CONCL 之外的标识', () => {
    const longNote = 'X_NOTE|' + 'A'.repeat(3000)
    const raw = ['=== 探索性因子分析 (EFA) ===', longNote, 'CONCL|结论'].join('\n')
    const kept = truncateRawOutput(raw, 2000)
    expect(kept.length).toBeLessThan(2100)
    expect(kept).toContain('已截断')
  })
})
