/**
 * 字段级解析断言：v0.3.2 因果链五方法（中介 / 调节 / 有调节的中介 / 路径分析 / SEM）
 *
 * ── 为什么这个文件必须存在 ──
 *
 * v0.2.x 的四次真实事故（ANOVA 读错列、负数被静默删除、独立样本 t 的均值差
 * 取成 CI 下限、单样本 t 的 CI 下限取成 p 值）全部在 **158 个测试全绿**的情况下
 * 存活了一整个版本，因为当时的断言只有 `tables.length > 0`。
 * v0.3.1 又补了一条教训：**只写单方向的"透传"断言会漏掉半吊子重复实现**——
 * 如果解析器写成 `cond ? R端值 : 自己算的值`，只测一个方向恰好会兜底通过。
 *
 * 因此本文件对五个方法一律：
 *   1. 逐格断言具体数值（不是"有值"，是"值对"）；
 *   2. 强制表与 keyValues 一致（同一统计量不得有两个值）；
 *   3. 对每个"不参与决策"的字段，构造**两个结论相反**的输入各测一次；
 *   4. 断言**四个互不相同的数值**必须互不相同（错位时最常见的表现就是两者相等）。
 *
 * ── 关于"注入缺陷 → 断言变红" ──
 *
 * 逐个注入并记录在完成说明里。本文件里每个 `it` 都刻意指向一个具体的错位方式，
 * 注释里写明"这一行是防哪个注入的"，这样将来改坏时红的是**指定的那一条**，
 * 而不是一片模糊的连带失败。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseROutput, detectAnalysisType } from '../resultParser'
import { RESULT_KINDS, type ResultKindMap } from '../../../../shared/resultSchema'

/* ═══════════════════════════════════════════════════════════════════════
 * 工具：取表 / 取行
 * ═══════════════════════════════════════════════════════════════════════ */

function tableOf(tables: ReturnType<typeof parseROutput>['tables'], keyword: string) {
  const t = tables.find((x) => x.title.includes(keyword))
  if (!t) {
    throw new Error(
      `未找到包含 "${keyword}" 的表，实际表：${tables.map((x) => x.title).join(' / ')}`
    )
  }
  return t
}

/** 取第一列（或指定列）等于给定标签的行 */
function rowOf(
  t: { rows: (string | number)[][] },
  label: string,
  col = 0
): (string | number)[] {
  const row = t.rows.find((r) => String(r[col]) === label)
  if (!row) {
    throw new Error(`未找到标签为 "${label}" 的行，实际：${t.rows.map((r) => r[0]).join(' / ')}`)
  }
  return row
}

const num = (v: string | number): number => Number(v)

/* ═══════════════════════════════════════════════════════════════════════
 * 一、类型判定：横幅全等匹配
 *
 * 这是本任务的**第一个死锁点**：`有调节的中介分析` 与 `中介效应分析`
 * 都是「…中介分析」，任何前缀/子串实现都会把前者判成后者。
 * 判错的后果不是崩溃，而是**用错的解析器读对的输出**→ 表里全是占位符，
 * 或者更糟：两个方法都有「间接效应」概念，能读出"看起来合理"的数字。
 * ═══════════════════════════════════════════════════════════════════════ */

describe('v0.3.2 类型判定：五方法横幅', () => {
  it('五个新横幅各自映射到正确的 kind', () => {
    expect(detectAnalysisType('=== 中介效应分析 ===\nMED_SPEC|100|x|m|y')).toBe('mediation')
    expect(detectAnalysisType('=== 调节效应分析 ===\nMOD_SPEC|100|x|w|y|是')).toBe('moderation')
    expect(
      detectAnalysisType('=== 有调节的中介分析 ===\nMM_SPEC|300|x|m|y|w')
    ).toBe('moderated_mediation')
    expect(detectAnalysisType('=== 路径分析 ===\nPATH_SPEC|200|3|3')).toBe('path_analysis')
    expect(detectAnalysisType('=== 结构方程模型 (SEM) ===\nSEM_SPEC|300|2|6')).toBe('sem')
  })

  it('【死锁】有调节的中介分析 不得被误判为 中介效应分析', () => {
    // 若把 detectAnalysisType 写成 `startsWith('中介')` 或
    // `name.includes('中介效应分析')`，下面第一条会立刻变红。
    // 注意 verify 的方向：两个横幅都必须在**同一次断言**里被区分开，
    // 否则"把两个都判成 moderated_mediation"也能骗过单条断言。
    expect(detectAnalysisType('=== 有调节的中介分析 ===')).toBe('moderated_mediation')
    expect(detectAnalysisType('=== 中介效应分析 ===')).toBe('mediation')
    // 反向：前缀更长的那个绝不能落到更短的分支上
    expect(detectAnalysisType('=== 有调节的中介分析 ===')).not.toBe('mediation')
    expect(detectAnalysisType('=== 中介效应分析 ===')).not.toBe('moderated_mediation')
    // 「中介」与「调节」两个字面在两者里都出现，故不能靠字面判
    expect(detectAnalysisType('=== 调节效应分析 ===')).not.toBe('moderated_mediation')
  })

  it('正文里出现方法名但没有横幅 → unknown（证明判定不是子串匹配）', () => {
    // 若有人退回 `output.includes('中介效应分析')` 之类的启发式，这三条会红。
    expect(detectAnalysisType('本次做了中介效应分析，结果见附件')).toBe('unknown')
    expect(detectAnalysisType('MM_SPEC|300|x|m|y|w\n有调节的中介分析结果如下')).toBe('unknown')
    expect(detectAnalysisType('PATH_SPEC|200|3|3\n路径分析已完成')).toBe('unknown')
    expect(detectAnalysisType('SEM_SPEC|300|2|6\n结构方程模型拟合一般')).toBe('unknown')
  })

  it('横幅带尾部括号限定词时仍能全等匹配（但中间夹带正文则不行）', () => {
    expect(detectAnalysisType('=== 结构方程模型 (SEM) ===')).toBe('sem')
    expect(detectAnalysisType('=== 结构方程模型（SEM）===')).toBe('sem')
    // 前缀匹配会把它吸进 sem；全等不会
    expect(detectAnalysisType('=== 结构方程模型 与 路径分析 ===')).toBe('unknown')
    expect(detectAnalysisType('=== 前言 | 路径分析 ===')).toBe('unknown')
  })

  it('旧方法的判定不受新分支影响（回归防护）', () => {
    expect(detectAnalysisType('=== 描述性统计 ===')).toBe('descriptive')
    expect(detectAnalysisType('=== 独立样本 t 检验 ===')).toBe('ttest_independent')
    expect(detectAnalysisType("=== 信度分析 (Cronbach's α) ===")).toBe('reliability')
    expect(detectAnalysisType('=== 探索性因子分析 (EFA) ===')).toBe('efa')
    expect(detectAnalysisType('=== 验证性因子分析 (CFA) ===')).toBe('cfa')
    expect(detectAnalysisType('=== 内容效度指数 (CVI) ===')).toBe('cvi')
    expect(detectAnalysisType('=== Harman 单因子检验 ===')).toBe('harman')
  })
})

/* ═══════════════════════════════════════════════════════════════════════
 * 二、中介效应
 *
 * Fixture 的数值刻意互相"不像"：
 *   a = 0.4712, b = 0.3841, c′ = 0.2158, c = 0.4106
 *   a·b = 0.18098...  → indirect 印 0.1810
 *   c′ + a·b = 0.3968 ≠ c = 0.4106
 * 咦——这里故意让**恒等式在 4 位小数下不完全成立**吗？不。
 * 契约容差是 1e-10（R 端内部），但解析器只拿得到 `num(x,4)` 的文本。
 * 为了让 fixture 自身自洽，取 a·b 恰好是 4 位小数可控的值，见下方注释。
 * ═══════════════════════════════════════════════════════════════════════ */

describe('字段级断言：中介效应（mediation）', () => {
  // 数值自洽性设计：
  //   a = 0.5000, b = 0.4000  → a·b = 0.2000（indirect）
  //   c′ = 0.3000             → c = 0.3000 + 0.2000 = 0.5000（total）
  //   三个量 0.2000 / 0.3000 / 0.5000 互不相同，且 indirect ≠ direct 且 total ≠ direct。
  const OUT = [
    '=== 中介效应分析 ===',
    'MED_SPEC|300|support|self_esteem|wellbeing',
    'MED_PATH|a|0.5000|0.0451|11.0865|p < 0.001|1.2e-24',
    'MED_PATH|b|0.4000|0.0488|8.1967|p < 0.001|4.5e-15',
    'MED_PATH|c_prime|0.3000|0.0520|5.7692|p < 0.001|1.7e-08',
    'MED_PATH|c_total|0.5000|0.0501|9.9800|p < 0.001|2.3e-20',
    'MED_EFFECT|indirect|0.2000|0.0332|0.1357|0.2664|percentile',
    'MED_EFFECT|direct|0.3000|0.0520|0.1981|0.4019|percentile',
    'MED_EFFECT|total|0.5000|0.0501|0.4009|0.5991|percentile',
    'MED_EFFECT|prop_mediated|0.4000|NA|NA|NA|percentile',
    'MED_SOBEL|4.7234|p < 0.001|2.3e-06',
    'MED_BOOT|5000|20260101|0.95|percentile',
    'MED_STD|a_std|0.4218',
    'MED_STD|b_std|0.3804',
    'MED_STD|c_prime_std|0.2603',
    'MED_STD|indirect_std|0.1605',
    'MED_NOTE|Bootstrap 采用 percentile 法，B = 5000，固定种子 20260101',
    'CONCL|间接效应显著，部分中介成立'
  ].join('\n')

  it('MED_SPEC 的四个字段各就各位', () => {
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['样本量'])).toBe(300)
    expect(String(kv['自变量X'])).toBe('support')
    expect(String(kv['中介变量M'])).toBe('self_esteem')
    expect(String(kv['因变量Y'])).toBe('wellbeing')
  })

  it('表1 路径系数：a / b / c′ / c 的系数、SE、t、p 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '中介模型路径系数')
    expect(t.rows).toHaveLength(4)
    expect(t.headers).toEqual(['路径', '系数', 'SE', 't', 'p'])

    // 用「路径列包含 a / b / c′ / c」定位，而不是按下标取行——
    // 按下标取会让"表里少了一行"和"值错位"混为一谈。
    const aRow = rowOf(t, 'a：X → M')
    expect(num(aRow[1])).toBeCloseTo(0.5, 4)
    expect(num(aRow[2])).toBeCloseTo(0.0451, 4)
    expect(num(aRow[3])).toBeCloseTo(11.0865, 4)
    expect(String(aRow[4])).toBe('p < 0.001')

    const bRow = rowOf(t, 'b：M → Y（控制 X）')
    expect(num(bRow[1])).toBeCloseTo(0.4, 4)
    expect(num(bRow[2])).toBeCloseTo(0.0488, 4)
    expect(num(bRow[3])).toBeCloseTo(8.1967, 4)

    const cpRow = rowOf(t, 'c′：X → Y（控制 M）')
    expect(num(cpRow[1])).toBeCloseTo(0.3, 4)

    const cRow = rowOf(t, 'c：X → Y（总效应）')
    expect(num(cRow[1])).toBeCloseTo(0.5, 4)
  })

  it('表1 的 a / b / c′ / c 四行系数互不相同（错位必被抓）', () => {
    const t = tableOf(parseROutput(OUT).tables, '中介模型路径系数')
    const vals = ['a：X → M', 'b：M → Y（控制 X）', 'c′：X → Y（控制 M）', 'c：X → Y（总效应）'].map(
      (k) => num(rowOf(t, k)[1])
    )
    // 本 fixture 里 a 与 c 恰好都是 0.5（数学上可能，故意保留以证明
    // 「只比较两两不等」是不够的——必须同时断言它们各自等于契约期望值）
    expect(new Set(vals).size).toBeGreaterThanOrEqual(3)
    expect(vals[0]).toBeCloseTo(0.5, 4)
    expect(vals[1]).toBeCloseTo(0.4, 4)
    expect(vals[2]).toBeCloseTo(0.3, 4)
    expect(vals[3]).toBeCloseTo(0.5, 4)
  })

  it('表2 效应分解：indirect / direct / total / prop_mediated 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '效应分解与 Bootstrap 置信区间')
    expect(t.headers).toEqual([
      '效应',
      '效应值',
      'SE',
      'CI 下限',
      'CI 上限',
      'CI 方法',
      'CI 是否含 0'
    ])

    const ind = rowOf(t, '间接效应 a×b')
    expect(num(ind[1])).toBeCloseTo(0.2, 4) // indirect = a·b，不是 direct
    expect(num(ind[2])).toBeCloseTo(0.0332, 4)
    expect(num(ind[3])).toBeCloseTo(0.1357, 4) // CI 下限 ← f[4]
    expect(num(ind[4])).toBeCloseTo(0.2664, 4) // CI 上限 ← f[5]
    expect(String(ind[5])).toBe('percentile') // ci_method ← f[6]
    expect(String(ind[6])).toBe('不含 0') // 0.1357 ~ 0.2664 不跨 0

    const dir = rowOf(t, '直接效应 c′')
    expect(num(dir[1])).toBeCloseTo(0.3, 4)
    expect(num(dir[3])).toBeCloseTo(0.1981, 4)
    expect(num(dir[4])).toBeCloseTo(0.4019, 4)

    const tot = rowOf(t, '总效应 c')
    expect(num(tot[1])).toBeCloseTo(0.5, 4)
    expect(num(tot[3])).toBeCloseTo(0.4009, 4)
    expect(num(tot[4])).toBeCloseTo(0.5991, 4)

    const prop = rowOf(t, '中介效应占比')
    expect(String(prop[1])).toBe('0.4')
    // total 接近 0 时占比为 NA：不得输出 Inf，也不得显示成 0
    expect(String(prop[3])).toBe('—')
    expect(String(prop[4])).toBe('—')
  })

  it('indirect ≠ direct ≠ total（三个量互不相同，错位必被抓）', () => {
    const t = tableOf(parseROutput(OUT).tables, '效应分解与 Bootstrap 置信区间')
    const ind = num(rowOf(t, '间接效应 a×b')[1])
    const dir = num(rowOf(t, '直接效应 c′')[1])
    const tot = num(rowOf(t, '总效应 c')[1])
    expect(ind).not.toBeCloseTo(dir, 4) // 这一条是防"indirect 取成 direct"的直接断言
    expect(tot).not.toBeCloseTo(dir, 4)
    expect(ind + dir).toBeCloseTo(tot, 6) // 契约恒等式
  })

  it('Bootstrap CI 必须被解析（ci_lower/upper 不是 NA、不是 Sobel 的 z）', () => {
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['indirect_ci_lower'])).toBeCloseTo(0.1357, 4)
    expect(Number(kv['indirect_ci_upper'])).toBeCloseTo(0.2664, 4)
    expect(String(kv['indirect_ci_excludes_zero'])).toBe('是')
    // Sobel 是另一个量（z = 4.7234），不能与 CI 端点混为一谈
    expect(Number(kv['sobel_z'])).toBeCloseTo(4.7234, 4)
    expect(Number(kv['sobel_z'])).not.toBeCloseTo(Number(kv['indirect_ci_lower']), 4)
    // Bootstrap 配置四项
    expect(Number(kv['boot_B'])).toBe(5000)
    expect(Number(kv['boot_seed'])).toBe(20260101)
    expect(Number(kv['boot_ci_level'])).toBeCloseTo(0.95, 6)
    expect(String(kv['boot_method'])).toBe('percentile')
    expect(String(kv['ci_method'])).toBe('percentile')
  })

  it('表3 标准化系数四项各取正确字段', () => {
    const t = tableOf(parseROutput(OUT).tables, '标准化路径系数')
    expect(t.rows).toHaveLength(4)
    expect(num(rowOf(t, 'a（标准化）')[1])).toBeCloseTo(0.4218, 4)
    expect(num(rowOf(t, 'b（标准化）')[1])).toBeCloseTo(0.3804, 4)
    expect(num(rowOf(t, 'c′（标准化）')[1])).toBeCloseTo(0.2603, 4)
    expect(num(rowOf(t, '间接效应（标准化）')[1])).toBeCloseTo(0.1605, 4)
  })

  it('表与 keyValues 一致（v0.2.7 红线：同一统计量不得有两个值）', () => {
    const parsed = parseROutput(OUT)
    const t2 = tableOf(parsed.tables, '效应分解与 Bootstrap 置信区间')
    expect(Number(parsed.keyValues['indirect'])).toBeCloseTo(num(rowOf(t2, '间接效应 a×b')[1]), 6)
    expect(Number(parsed.keyValues['direct'])).toBeCloseTo(num(rowOf(t2, '直接效应 c′')[1]), 6)
    expect(Number(parsed.keyValues['total'])).toBeCloseTo(num(rowOf(t2, '总效应 c')[1]), 6)
    expect(Number(parsed.keyValues['prop_mediated'])).toBeCloseTo(
      num(rowOf(t2, '中介效应占比')[1]),
      6
    )
    expect(Number(parsed.keyValues['indirect_ci_lower'])).toBeCloseTo(
      num(rowOf(t2, '间接效应 a×b')[3]),
      6
    )
    expect(Number(parsed.keyValues['indirect_ci_upper'])).toBeCloseTo(
      num(rowOf(t2, '间接效应 a×b')[4]),
      6
    )

    const t1 = tableOf(parsed.tables, '中介模型路径系数')
    expect(Number(parsed.keyValues['path_a_coef'])).toBeCloseTo(num(rowOf(t1, 'a：X → M')[1]), 6)
    expect(Number(parsed.keyValues['path_b_coef'])).toBeCloseTo(
      num(rowOf(t1, 'b：M → Y（控制 X）')[1]),
      6
    )
    expect(Number(parsed.keyValues['path_c_prime_coef'])).toBeCloseTo(
      num(rowOf(t1, 'c′：X → Y（控制 M）')[1]),
      6
    )
    expect(Number(parsed.keyValues['path_c_total_coef'])).toBeCloseTo(
      num(rowOf(t1, 'c：X → Y（总效应）')[1]),
      6
    )

    const t3 = tableOf(parsed.tables, '标准化路径系数')
    expect(Number(parsed.keyValues['std_a_std'])).toBeCloseTo(num(rowOf(t3, 'a（标准化）')[1]), 6)
    expect(Number(parsed.keyValues['std_indirect_std'])).toBeCloseTo(
      num(rowOf(t3, '间接效应（标准化）')[1]),
      6
    )
  })

  it('契约恒等式 c = c′ + a·b 自检通过', () => {
    expect(String(parseROutput(OUT).keyValues['恒等式自检'])).toBe('一致')
  })

  /* ── 三态自检：「无法判断」必须与「一致」区分开 ──
   *
   * 这条测试的由来是一次真实的注入实验：把 MED_PATH 的键名从 `a` 改成 `a2`
   * 之后，所有 `if (x !== null && …)` 整段跳过，自检报告"一致"——测试全绿，
   * 而实际上自检根本没有发生。这与会静默丢数据的 v0.2.x 事故同源：
   * **空转通过比报错更危险**，因为它给用户一句安全背书。
   */
  it('自检所需字段取不到时必须报「无法判断」，不得假报「一致」', () => {
    // 把 a 这一行的 path 键改成契约外的名字 → coefOf 取不到 a
    const keyBroken = OUT.replace('MED_PATH|a|0.5000|', 'MED_PATH|a_typo|0.5000|')
    const kv = parseROutput(keyBroken).keyValues
    expect(String(kv['恒等式自检'])).toBe('无法判断')
    expect(String(kv['恒等式自检'])).not.toBe('一致')
    expect(String(kv['恒等式缺失字段'])).toContain('a')
  })

  it('R 端未输出 MED_EFFECT 时不产生任何自检结论（不是空转的「一致」）', () => {
    const noEffects = [
      '=== 中介效应分析 ===',
      'MED_SPEC|300|x|m|y',
      'MED_PATH|a|0.5000|0.0451|11.0865|p < 0.001|1.2e-24',
      'MED_PATH|b|0.4000|0.0488|8.1967|p < 0.001|4.5e-15'
    ].join('\n')
    const kv = parseROutput(noEffects).keyValues
    // 没有效应分解行，就根本没有可自检的恒等式 → 不输出结论键
    expect(kv['恒等式自检']).toBeUndefined()
  })

  it('恒等式被破坏时给出「不一致」而不静默放行（自检真的有牙齿）', () => {
    // 故意把 total 改成 0.6500（≠ c′ + a·b = 0.5000）。
    // 若解析器把自检写成"永远返回一致"，这条会红。
    const broken = OUT.replace(
      'MED_PATH|c_total|0.5000|0.0501|9.9800|p < 0.001|2.3e-20',
      'MED_PATH|c_total|0.6500|0.0501|9.9800|p < 0.001|2.3e-20'
    )
    const kv = parseROutput(broken).keyValues
    expect(String(kv['恒等式自检'])).toBe('不一致')
    expect(String(kv['恒等式偏差'])).toContain('c ≠ c′ + a·b')
  })

  it('indirect ≠ a×b 时也报警（不是只检查 c 那一条）', () => {
    const broken = OUT.replace(
      'MED_EFFECT|indirect|0.2000|0.0332|0.1357|0.2664|percentile',
      'MED_EFFECT|indirect|0.3000|0.0332|0.1357|0.2664|percentile'
    )
    const kv = parseROutput(broken).keyValues
    expect(String(kv['恒等式自检'])).toBe('不一致')
    expect(String(kv['恒等式偏差'])).toContain('indirect ≠ a×b')
  })

  /* ── 反向用例：CI 跨 0 时不得写"显著" ──
   *
   * 这是任务描述点名的「反向用例」。它要抓住的是**用点估计代替区间读显著**：
   * indirect = 0.0800 点估计为正、且 Sobel p = 0.041（正态近似说显著），
   * 但 Bootstrap 区间 [-0.0120, 0.1720] 跨 0。此时表里必须写「含 0」。
   *
   * 反方向也要测（v0.3.1 教训）：若把 ciZeroText 写死成「含 0」，
   * 上面那个不含 0 的用例会红；若写死成「不含 0」，这个用例会红。
   * 两个方向合起来才证明它真的在算。
   */
  it('【反向】Bootstrap CI 跨 0 → 表必须写「含 0」，且 kv 同步', () => {
    const crossing = [
      '=== 中介效应分析 ===',
      'MED_SPEC|120|x|m|y',
      'MED_PATH|a|0.4000|0.1600|2.5000|p = 0.014|0.0139',
      'MED_PATH|b|0.2000|0.1700|1.1765|p = 0.242|0.2416',
      'MED_PATH|c_prime|0.3100|0.1200|2.5833|p = 0.011|0.0112',
      'MED_PATH|c_total|0.3900|0.1250|3.1200|p = 0.002|0.0023',
      'MED_EFFECT|indirect|0.0800|0.0469|-0.0120|0.1720|percentile',
      'MED_EFFECT|direct|0.3100|0.1200|0.0750|0.5450|percentile',
      'MED_EFFECT|total|0.3900|0.1250|0.1450|0.6350|percentile',
      'MED_EFFECT|prop_mediated|0.2051|NA|NA|NA|percentile',
      // Sobel 正态近似说显著（p = 0.041），与 Bootstrap 区间结论相反 —— 故意的
      'MED_SOBEL|2.0412|p = 0.041|0.0412',
      'MED_BOOT|5000|20260101|0.95|percentile',
      'MED_NOTE|间接效应 Bootstrap 区间跨 0，不宜断言中介成立',
      'CONCL|间接效应不显著，中介效应不成立'
    ].join('\n')

    const parsed = parseROutput(crossing)
    const t = tableOf(parsed.tables, '效应分解与 Bootstrap 置信区间')
    const ind = rowOf(t, '间接效应 a×b')
    expect(num(ind[1])).toBeCloseTo(0.08, 4) // 点估计为正
    expect(num(ind[3])).toBeCloseTo(-0.012, 4) // 下限为负
    expect(num(ind[4])).toBeCloseTo(0.172, 4) // 上限为正
    expect(String(ind[6])).toBe('含 0') // ← 关键断言：区间跨 0
    expect(String(parsed.keyValues['indirect_ci_excludes_zero'])).toBe('否')
    // 点估计为正 ≠ 区间不含 0：这一条把"拿点估计读显著"的写法钉死
    expect(num(ind[3])).toBeLessThan(0)
    expect(num(ind[4])).toBeGreaterThan(0)
    // 结论以 R 端为准（TS 不重算），且与区间方向一致
    expect(String(parsed.keyValues['结论'])).toContain('不成立')
  })

  it('【反向·另一侧】CI 不含 0 时必须写「不含 0」（防止写死成一个值）', () => {
    const t = tableOf(parseROutput(OUT).tables, '效应分解与 Bootstrap 置信区间')
    expect(String(rowOf(t, '间接效应 a×b')[6])).toBe('不含 0')
    // 同一张表里 direct 的区间也不含 0，两者都得对
    expect(String(rowOf(t, '直接效应 c′')[6])).toBe('不含 0')
    // 端点为 NA 时给占位，而不是错误地算成「含 0」或「不含 0」
    expect(String(rowOf(t, '中介效应占比')[6])).toBe('—')
  })

  it('至少 3 张表，且每张都有数据行', () => {
    const tables = parseROutput(OUT).tables
    expect(tables.length).toBeGreaterThanOrEqual(3)
    for (const t of tables) expect(t.rows.length).toBeGreaterThan(0)
  })
})

/* ═══════════════════════════════════════════════════════════════════════
 * 三、调节效应
 *
 * 死锁点：**简单斜率**。契约要求 slope = b1 + b3·w0 由 R 端算，
 * SE 用线性组合法。任务描述点名要注入的缺陷是"简单斜率取成交互项系数"——
 * 那正是把 MOD_SLOPE 的 f[3] 错取成 MOD_COEF 的 x_w（b3）。
 * 本 fixture 刻意让 b3 与三个斜率两两不同。
 * ═══════════════════════════════════════════════════════════════════════ */

describe('字段级断言：调节效应（moderation）', () => {
  // 数值设计（中心化后 W 的 SD = 1.2）：
  //   b1(x) = 0.3000, b2(w) = 0.1500, b3(x_w) = 0.2500, intercept = 4.8000
  //   w0 = -1.2 / 0 / +1.2（mean±1SD）
  //   slope(-1SD) = 0.3 + 0.25×(-1.2) = 0.0000
  //   slope(mean) = 0.3 + 0.25×0     = 0.3000
  //   slope(+1SD) = 0.3 + 0.25×1.2   = 0.6000
  // 三个斜率 0.0 / 0.3 / 0.6 与 b3 = 0.25 **全部不同**，
  // 所以"斜率取成交互项系数"的注入必然被抓住（0.25 不等于任何一个）。
  const OUT = [
    '=== 调节效应分析 ===',
    'MOD_SPEC|240|stress|support|burnout|是',
    'MOD_COEF|intercept|4.8000|0.0620|77.4194|p < 0.001|0.0',
    'MOD_COEF|x|0.3000|0.0510|5.8824|p < 0.001|3.4e-09',
    'MOD_COEF|w|0.1500|0.0510|2.9412|p = 0.004|0.0036',
    'MOD_COEF|x_w|0.2500|0.0480|5.2083|p < 0.001|4.2e-07',
    'MOD_MODEL|0.4120|0.4045|55.2053|p < 0.001|1.1e-25|3|236',
    'MOD_DELTA|0.0521|20.9275|1|236|p < 0.001|4.2e-07',
    'MOD_SLOPE|-1SD|-1.2000|0.0000|0.0611|0.0000|p = 1.000|0.9999',
    'MOD_SLOPE|mean|0.0000|0.3000|0.0510|5.8824|p < 0.001|3.4e-09',
    'MOD_SLOPE|+1SD|1.2000|0.6000|0.0607|9.8847|p < 0.001|3.1e-19',
    'MOD_JOHNSON|显著|-1.2000|1.2000',
    'MOD_NOTE|已对 stress 与 support 做均值中心化；简单斜率 SE 用线性组合法',
    'CONCL|交互项显著，support 对 stress → burnout 的路径具有调节作用'
  ].join('\n')

  it('MOD_SPEC 的五个字段各就各位（含 centered 透传）', () => {
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['n'])).toBe(240)
    expect(String(kv['x'])).toBe('stress')
    expect(String(kv['w'])).toBe('support')
    expect(String(kv['y'])).toBe('burnout')
    expect(String(kv['centered'])).toBe('是') // 原样透传
    expect(Number(kv['centered_code'])).toBe(1)
  })

  it('表1 系数：intercept / x / w / x_w 各自取对字段', () => {
    const t = tableOf(parseROutput(OUT).tables, '调节效应回归系数')
    expect(t.rows).toHaveLength(4)

    const iRow = rowOf(t, '截距')
    expect(num(iRow[1])).toBeCloseTo(4.8, 4) // 不是 0.0（那是 p_raw）
    expect(num(iRow[2])).toBeCloseTo(0.062, 4)
    expect(num(iRow[3])).toBeCloseTo(77.4194, 4)
    expect(String(iRow[4])).toBe('p < 0.001')

    const xRow = rowOf(t, 'stress（自变量）')
    expect(num(xRow[1])).toBeCloseTo(0.3, 4)
    expect(num(xRow[2])).toBeCloseTo(0.051, 4)
    expect(num(xRow[3])).toBeCloseTo(5.8824, 4)

    const wRow = rowOf(t, 'support（调节变量）')
    expect(num(wRow[1])).toBeCloseTo(0.15, 4)

    const xwRow = rowOf(t, 'stress × support（交互项）')
    expect(num(xwRow[1])).toBeCloseTo(0.25, 4) // 交互项系数 b3 ← f[2]
    expect(num(xwRow[2])).toBeCloseTo(0.048, 4) // SE ← f[3]（不是 b3）
    expect(num(xwRow[3])).toBeCloseTo(5.2083, 4) // t ← f[4]
    expect(String(xwRow[4])).toBe('p < 0.001') // p ← f[5]
  })

  it('表1 交互项的系数 ≠ 其 SE ≠ 其 t（三个量互不相同）', () => {
    const t = tableOf(parseROutput(OUT).tables, '调节效应回归系数')
    const r = rowOf(t, 'stress × support（交互项）')
    expect(num(r[1])).not.toBeCloseTo(num(r[2]), 4) // 0.25 vs 0.048
    expect(num(r[1])).not.toBeCloseTo(num(r[3]), 4) // 0.25 vs 5.2083
    expect(num(r[2])).not.toBeCloseTo(num(r[3]), 4)
  })

  it('表2 ΔR² / ΔF 与模型整体拟合各取正确字段', () => {
    const t = tableOf(parseROutput(OUT).tables, '模型解释力与交互项增量检验')
    expect(num(rowOf(t, 'R²')[1])).toBeCloseTo(0.412, 4) // 整体 R² ← f[1]
    expect(num(rowOf(t, '调整 R²')[1])).toBeCloseTo(0.4045, 4) // ← f[2]
    expect(num(rowOf(t, 'F')[1])).toBeCloseTo(55.2053, 4) // F ← f[3]（不是 adj_r2）
    // ΔR² ← MOD_DELTA f[1]；ΔF ← f[2]；p ← f[5]
    expect(num(rowOf(t, 'ΔR²（加入交互项）')[1])).toBeCloseTo(0.0521, 4)
    expect(num(rowOf(t, 'ΔF')[1])).toBeCloseTo(20.9275, 4)
    expect(String(rowOf(t, 'ΔF')[3])).toBe('p < 0.001')
    // R² 与 ΔR² 是两个不同的量（0.412 vs 0.0521），错位必被抓
    expect(num(rowOf(t, 'R²')[1])).not.toBeCloseTo(num(rowOf(t, 'ΔR²（加入交互项）')[1]), 4)
  })

  it('表3 三个简单斜率：slope / SE / t / p 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '简单斜率分析')
    expect(t.headers).toEqual(['W 水平', 'W 取值', '简单斜率', 'SE', 't', 'p'])
    expect(t.rows).toHaveLength(3)

    const low = rowOf(t, '-1SD')
    expect(num(low[1])).toBeCloseTo(-1.2, 4) // w_value ← f[2]
    expect(num(low[2])).toBeCloseTo(0.0, 4) // slope   ← f[3]
    expect(num(low[3])).toBeCloseTo(0.0611, 4) // se      ← f[4]（不是 slope）
    expect(num(low[4])).toBeCloseTo(0.0, 4) // t       ← f[5]
    expect(String(low[5])).toBe('p = 1.000') // p       ← f[6]

    const mid = rowOf(t, 'mean')
    expect(num(mid[1])).toBeCloseTo(0.0, 4)
    expect(num(mid[2])).toBeCloseTo(0.3, 4)
    expect(num(mid[3])).toBeCloseTo(0.051, 4)

    const high = rowOf(t, '+1SD')
    expect(num(high[1])).toBeCloseTo(1.2, 4)
    expect(num(high[2])).toBeCloseTo(0.6, 4)
    expect(num(high[3])).toBeCloseTo(0.0607, 4)
    expect(num(high[4])).toBeCloseTo(9.8847, 4)
  })

  it('【死锁】三个简单斜率既不等于交互项系数 b3，也互不相同', () => {
    // 任务描述点名要注入的缺陷：「简单斜率取成交互项系数」。
    // 若把 MOD_SLOPE 的 f[3] 错写成 MOD_COEF 里 x_w 的系数（0.25），
    // 三条断言会同时红；若只是"三个水平都取同一个斜率"，后两条会红。
    const t = tableOf(parseROutput(OUT).tables, '简单斜率分析')
    const b3 = num(rowOf(tableOf(parseROutput(OUT).tables, '调节效应回归系数'), 'stress × support（交互项）')[1])
    const slopes = ['-1SD', 'mean', '+1SD'].map((k) => num(rowOf(t, k)[2]))
    for (const s of slopes) expect(s).not.toBeCloseTo(b3, 4)
    expect(slopes[0]).toBeCloseTo(0.0, 4)
    expect(slopes[1]).toBeCloseTo(0.3, 4)
    expect(slopes[2]).toBeCloseTo(0.6, 4)
    expect(new Set(slopes).size).toBe(3)
  })

  it('表与 keyValues 一致（系数 + Δ + 斜率）', () => {
    const parsed = parseROutput(OUT)
    const t1 = tableOf(parsed.tables, '调节效应回归系数')
    expect(Number(parsed.keyValues['coef_x'])).toBeCloseTo(num(rowOf(t1, 'stress（自变量）')[1]), 6)
    expect(Number(parsed.keyValues['coef_w'])).toBeCloseTo(num(rowOf(t1, 'support（调节变量）')[1]), 6)
    expect(Number(parsed.keyValues['coef_x_w'])).toBeCloseTo(
      num(rowOf(t1, 'stress × support（交互项）')[1]),
      6
    )
    expect(Number(parsed.keyValues['coef_intercept'])).toBeCloseTo(num(rowOf(t1, '截距')[1]), 6)

    const t2 = tableOf(parsed.tables, '模型解释力与交互项增量检验')
    expect(Number(parsed.keyValues['r2'])).toBeCloseTo(num(rowOf(t2, 'R²')[1]), 6)
    expect(Number(parsed.keyValues['r2_change'])).toBeCloseTo(num(rowOf(t2, 'ΔR²（加入交互项）')[1]), 6)
    expect(Number(parsed.keyValues['f_change'])).toBeCloseTo(num(rowOf(t2, 'ΔF')[1]), 6)
    expect(Number(parsed.keyValues['delta_p'])).toBeLessThan(0.001)

    const t3 = tableOf(parsed.tables, '简单斜率分析')
    for (const lvl of ['-1SD', 'mean', '+1SD']) {
      expect(Number(parsed.keyValues[`slope_${lvl}`])).toBeCloseTo(num(rowOf(t3, lvl)[2]), 6)
      expect(Number(parsed.keyValues[`slope_se_${lvl}`])).toBeCloseTo(num(rowOf(t3, lvl)[3]), 6)
    }
  })

  it('简单斜率恒等式 slope = b1 + b3·w0 自检通过', () => {
    expect(String(parseROutput(OUT).keyValues['一致性自检'])).toBe('一致')
    // 交互项 p 与 ΔF 的 p 同向（都是 p < 0.001）
    expect(String(parseROutput(OUT).keyValues['交互项显著性自检'])).toBe('一致')
  })

  it('交互项系数取不到时自检报「无法判断」，不得假报「一致」', () => {
    // 把 x_w 的 term 改成契约外的名字 → b3 取不到
    const keyBroken = OUT.replace('MOD_COEF|x_w|', 'MOD_COEF|xw_typo|')
    const kv = parseROutput(keyBroken).keyValues
    expect(String(kv['一致性自检'])).toBe('无法判断')
    expect(String(kv['一致性缺失字段'])).toContain('b3')
  })

  it('简单斜率与 b1 + b3·w0 不符时报「不一致」（自检有牙齿）', () => {
    // 把 +1SD 的斜率改成 0.25（= b3），这正是"斜率取成交互项系数"的注入形态
    const injected = OUT.replace(
      'MOD_SLOPE|+1SD|1.2000|0.6000|0.0607|9.8847|p < 0.001|3.1e-19',
      'MOD_SLOPE|+1SD|1.2000|0.2500|0.0607|9.8847|p < 0.001|3.1e-19'
    )
    const kv = parseROutput(injected).keyValues
    expect(String(kv['一致性自检'])).toBe('不一致')
    expect(String(kv['一致性偏差'])).toContain('simple slope(+1SD)')
  })

  it('交互项 p 与 ΔF 的 p 显著性不同向时报警（半吊子实现会漏掉）', () => {
    // 交互项 p = 0.180（不显著）但 ΔF 的 p < 0.001（显著）—— 同一模型不可能。
    const inconsistent = OUT.replace(
      'MOD_COEF|x_w|0.2500|0.0480|5.2083|p < 0.001|4.2e-07',
      'MOD_COEF|x_w|0.2500|0.1800|1.3889|p = 0.180|0.1798'
    )
    const kv = parseROutput(inconsistent).keyValues
    expect(String(kv['交互项显著性自检'])).toBe('不一致')
    expect(String(kv['一致性自检'])).toBe('不一致')
  })

  it('centered 一律透传 R 端，解析器不自行推断', () => {
    // 方向 A：centered = 是
    expect(String(parseROutput(OUT).keyValues['centered'])).toBe('是')
    expect(String(parseROutput(OUT).keyValues['centered_code'])).toBe('1')
    expect(tableOf(parseROutput(OUT).tables, '调节效应回归系数').note).toContain('已对')
    // 方向 B：centered = 否 —— 表注必须跟着改口，不得硬编码"已中心化"
    const raw = OUT.replace(
      'MOD_SPEC|240|stress|support|burnout|是',
      'MOD_SPEC|240|stress|support|burnout|否'
    )
    const parsed = parseROutput(raw)
    expect(String(parsed.keyValues['centered'])).toBe('否')
    expect(String(parsed.keyValues['centered_code'])).toBe('0')
    const note = tableOf(parsed.tables, '调节效应回归系数').note
    expect(note).toContain('未做中心化')
    expect(note).not.toContain('已对 stress 与 support 做均值中心化')
  })

  it('表4 Johnson-Neyman 区间', () => {
    const t = tableOf(parseROutput(OUT).tables, 'Johnson-Neyman')
    expect(t.rows).toHaveLength(1)
    expect(String(t.rows[0][0])).toBe('显著')
    expect(num(t.rows[0][1])).toBeCloseTo(-1.2, 4)
    expect(num(t.rows[0][2])).toBeCloseTo(1.2, 4)
  })

  it('至少 2 张表（实际 4 张），且每张都有数据行', () => {
    const tables = parseROutput(OUT).tables
    expect(tables.length).toBeGreaterThanOrEqual(2)
    for (const t of tables) expect(t.rows.length).toBeGreaterThan(0)
  })
})

/* ═══════════════════════════════════════════════════════════════════════
 * 四、有调节的中介
 *
 * 死锁点：**两个方程的 term 重名**。MM_COEF 里 m 方程与 y 方程都有 `x` 项，
 * 但含义不同（a2 vs c）。若解析器只按 term 建索引，后者会静默覆盖前者。
 * 本 fixture 让 m 方程的 x = 0.4200、y 方程的 x = 0.1800，二者不同，
 * 覆盖与否一眼可见。
 * ═══════════════════════════════════════════════════════════════════════ */

describe('字段级断言：有调节的中介（moderated_mediation）', () => {
  // m 方程：a1 + a2·X + a3·W + a4·(X·W)
  //   a2 = 0.4200, a3 = 0.1100, a4 = 0.3000
  // y 方程：c′ + b·M + c·X
  //   b  = 0.5000, c = 0.1800, c′ = 2.1000（intercept 不在此契约行里）
  // index = a4 · b = 0.1500
  // W 的三个水平：w0 = -1.0 / 0 / +1.0（SD = 1.0）
  //   条件 a = a2 + a4·w0 = 0.1200 / 0.4200 / 0.7200
  //   条件间接 = 条件 a × b = 0.0600 / 0.2100 / 0.3600
  const OUT = [
    '=== 有调节的中介分析 ===',
    'MM_SPEC|450|stress|burnout|turnover|support',
    'MM_COEF|m|x|0.4200|0.0480|8.7500|p < 0.001|2.4e-16',
    'MM_COEF|m|w|0.1100|0.0490|2.2449|p = 0.025|0.0251',
    'MM_COEF|m|x_w|0.3000|0.0470|6.3830|p < 0.001|4.9e-10',
    'MM_COEF|y|m|0.5000|0.0420|11.9048|p < 0.001|8.1e-27',
    'MM_COEF|y|x|0.1800|0.0500|3.6000|p < 0.001|0.00035',
    'MM_INDEX|0.1500|0.0392|0.0730|0.2270',
    'MM_COND|-1SD|-1.0000|0.1200|0.0600|0.0068|0.1352',
    'MM_COND|mean|0.0000|0.4200|0.2100|0.1018|0.3182',
    'MM_COND|+1SD|1.0000|0.7200|0.3600|0.1881|0.5319',
    'MM_BOOT|5000|20260101|0.95|percentile',
    'MM_NOTE|index 显著不代表每个水平都显著，需逐水平报告条件间接效应',
    'CONCL|有调节的中介成立：support 调节 stress → burnout 的前半段路径'
  ].join('\n')

  it('MM_SPEC 的五个字段各就各位', () => {
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['n'])).toBe(450)
    expect(String(kv['x'])).toBe('stress')
    expect(String(kv['m'])).toBe('burnout')
    expect(String(kv['y'])).toBe('turnover')
    expect(String(kv['w'])).toBe('support')
  })

  it('表1 两个方程的系数：按 (model, term) 复合键分开存，不得互相覆盖', () => {
    const parsed = parseROutput(OUT)
    const t = tableOf(parsed.tables, '两个回归方程的系数')
    expect(t.headers).toEqual(['方程', '项', '系数', 'SE', 't', 'p'])
    expect(t.rows).toHaveLength(5)

    // 两个方程各有一个 x 项，值不同（0.42 vs 0.18）——这是本 fixture 的关键
    const mX = t.rows.find((r) => String(r[0]).includes('burnout 方程') && String(r[1]).includes('stress（'))
    const yX = t.rows.find((r) => String(r[0]).includes('turnover 方程') && String(r[1]).includes('stress（'))
    expect(mX, `未找到 m 方程中的 x 项，实际行：${JSON.stringify(t.rows)}`).toBeDefined()
    expect(yX, `未找到 y 方程中的 x 项，实际行：${JSON.stringify(t.rows)}`).toBeDefined()
    expect(num(mX![2])).toBeCloseTo(0.42, 4) // a2
    expect(num(yX![2])).toBeCloseTo(0.18, 4) // c（≠ a2）

    // a4：m 方程里的交互项 ← f[3]
    const a4Row = t.rows.find((r) => String(r[1]).includes('（交互项 a4）'))!
    expect(num(a4Row[2])).toBeCloseTo(0.3, 4)
    expect(num(a4Row[3])).toBeCloseTo(0.047, 4) // SE ← f[4]
    expect(num(a4Row[4])).toBeCloseTo(6.383, 4) // t ← f[5]
    expect(String(a4Row[5])).toBe('p < 0.001') // p ← f[6]

    // b：y 方程里的中介变量 ← f[3]
    const bRow = t.rows.find((r) => String(r[1]).includes('（中介变量 b）'))!
    expect(num(bRow[2])).toBeCloseTo(0.5, 4)

    // kv 也必须分开存：coef_m_x = 0.42、coef_y_x = 0.18
    expect(Number(parsed.keyValues['coef_m_x'])).toBeCloseTo(0.42, 4)
    expect(Number(parsed.keyValues['coef_y_x'])).toBeCloseTo(0.18, 4)
    expect(Number(parsed.keyValues['coef_m_x'])).not.toBeCloseTo(
      Number(parsed.keyValues['coef_y_x']),
      4
    )
  })

  it('表2 index of moderated mediation：index / SE / CI 端点 / 含 0 判定', () => {
    const parsed = parseROutput(OUT)
    const t = tableOf(parsed.tables, '有调节的中介效应指数')
    expect(t.headers).toEqual(['指标', '数值', 'CI 下限', 'CI 上限', 'CI 是否含 0'])
    const idx = rowOf(t, 'index = a4 × b')
    expect(num(idx[1])).toBeCloseTo(0.15, 4) // index ← f[1]
    expect(num(idx[2])).toBeCloseTo(0.073, 4) // ci_lower ← f[3]（不是 se）
    expect(num(idx[3])).toBeCloseTo(0.227, 4) // ci_upper ← f[4]
    expect(String(idx[4])).toBe('不含 0') // 0.073 ~ 0.227
    const se = rowOf(t, 'SE（Bootstrap）')
    expect(num(se[1])).toBeCloseTo(0.0392, 4) // se ← f[2]，不得与 ci_lower 混
    expect(num(se[1])).not.toBeCloseTo(num(idx[2]), 4)

    expect(Number(parsed.keyValues['index'])).toBeCloseTo(0.15, 4)
    expect(Number(parsed.keyValues['index_se'])).toBeCloseTo(0.0392, 4)
    expect(Number(parsed.keyValues['index_ci_lower'])).toBeCloseTo(0.073, 4)
    expect(Number(parsed.keyValues['index_ci_upper'])).toBeCloseTo(0.227, 4)
    expect(String(parsed.keyValues['index_ci_excludes_zero'])).toBe('是')
  })

  it('表3 三个条件间接效应：a_cond / indirect / CI 逐格正确', () => {
    const parsed = parseROutput(OUT)
    const t = tableOf(parsed.tables, '各 support 水平下的条件间接效应')
    expect(t.headers).toEqual([
      'W 水平',
      'W 取值',
      '条件 a',
      '条件间接效应',
      'CI 下限',
      'CI 上限',
      'CI 是否含 0'
    ])
    expect(t.rows).toHaveLength(3)

    const low = rowOf(t, '-1SD')
    expect(num(low[1])).toBeCloseTo(-1.0, 4) // w_value ← f[2]
    expect(num(low[2])).toBeCloseTo(0.12, 4) // a_cond  ← f[3]
    expect(num(low[3])).toBeCloseTo(0.06, 4) // indirect ← f[4]
    expect(num(low[4])).toBeCloseTo(0.0068, 4) // ci_lower ← f[5]
    expect(num(low[5])).toBeCloseTo(0.1352, 4) // ci_upper ← f[6]
    expect(String(low[6])).toBe('不含 0')

    const mid = rowOf(t, 'mean')
    expect(num(mid[1])).toBeCloseTo(0.0, 4)
    expect(num(mid[2])).toBeCloseTo(0.42, 4)
    expect(num(mid[3])).toBeCloseTo(0.21, 4)
    expect(num(mid[4])).toBeCloseTo(0.1018, 4)
    expect(num(mid[5])).toBeCloseTo(0.3182, 4)

    const high = rowOf(t, '+1SD')
    expect(num(high[1])).toBeCloseTo(1.0, 4)
    expect(num(high[2])).toBeCloseTo(0.72, 4)
    expect(num(high[3])).toBeCloseTo(0.36, 4)
    expect(num(high[4])).toBeCloseTo(0.1881, 4)
    expect(num(high[5])).toBeCloseTo(0.5319, 4)
  })

  it('三个条件间接效应互不相同，且不等于 index（index ≠ 任一条件间接效应）', () => {
    const t = tableOf(parseROutput(OUT).tables, '各 support 水平下的条件间接效应')
    const vals = ['-1SD', 'mean', '+1SD'].map((k) => num(rowOf(t, k)[3]))
    expect(new Set(vals).size).toBe(3)
    // index = a4·b = 0.15 是"每单位 W 变化带来的间接效应变化量"，
    // 与任一水平上的条件间接效应都是不同量。把 index 错填进条件效应列会被抓住。
    for (const v of vals) expect(v).not.toBeCloseTo(0.15, 4)
  })

  it('表与 keyValues 一致（index + 三个条件效应）', () => {
    const parsed = parseROutput(OUT)
    const t2 = tableOf(parsed.tables, '有调节的中介效应指数')
    expect(Number(parsed.keyValues['index'])).toBeCloseTo(num(rowOf(t2, 'index = a4 × b')[1]), 6)
    expect(Number(parsed.keyValues['index_ci_lower'])).toBeCloseTo(
      num(rowOf(t2, 'index = a4 × b')[2]),
      6
    )
    expect(Number(parsed.keyValues['index_ci_upper'])).toBeCloseTo(
      num(rowOf(t2, 'index = a4 × b')[3]),
      6
    )

    const t3 = tableOf(parsed.tables, '各 support 水平下的条件间接效应')
    for (const lvl of ['-1SD', 'mean', '+1SD']) {
      expect(Number(parsed.keyValues[`cond_${lvl}_indirect`])).toBeCloseTo(
        num(rowOf(t3, lvl)[3]),
        6
      )
      expect(Number(parsed.keyValues[`cond_${lvl}_a`])).toBeCloseTo(num(rowOf(t3, lvl)[2]), 6)
      expect(Number(parsed.keyValues[`cond_${lvl}_ci_lower`])).toBeCloseTo(
        num(rowOf(t3, lvl)[4]),
        6
      )
      expect(Number(parsed.keyValues[`cond_${lvl}_ci_upper`])).toBeCloseTo(
        num(rowOf(t3, lvl)[5]),
        6
      )
    }
  })

  it('契约恒等式：index = a4×b、条件间接 = (a2 + a4·W)·b 自检通过', () => {
    expect(String(parseROutput(OUT).keyValues['恒等式自检'])).toBe('一致')
    // Bootstrap 配置
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['boot_B'])).toBe(5000)
    expect(Number(kv['boot_seed'])).toBe(20260101)
    expect(String(kv['boot_method'])).toBe('percentile')
  })

  it('index ≠ a4×b 时报「不一致」（自检有牙齿）', () => {
    const injected = OUT.replace('MM_INDEX|0.1500|', 'MM_INDEX|0.4200|')
    const kv = parseROutput(injected).keyValues
    expect(String(kv['恒等式自检'])).toBe('不一致')
    expect(String(kv['恒等式偏差'])).toContain('index ≠ a4×b')
  })

  /* ── 三态自检：复合键坏掉时必须报「无法判断」 ──
   *
   * 这是注入实验抓出的**我自己代码里的真实缺陷**：
   * 把 coefOf 的复合键从 `model:term` 改成裸 `term` 后，y 方程的 `m` 项
   * 覆盖同名键，a2 / a4 / b 全部取不到 → 恒等式检查整段跳过 → 报"一致"。
   * 测试当时仍然全绿，因为"一致"是默认兜底值。
   * 现在缺字段会显式降级为「无法判断」，这条测试锁死该行为。
   */
  it('两个方程的同名 term 覆盖后，自检必须报「无法判断」而非「一致」', () => {
    // 造一份「y 方程污染 m 方程键名」的输入：m 方程缺 x_w、y 方程多一个 x_w
    // （等价于解析器若按裸 term 建索引时会看到的世界）
    const polluted = [
      '=== 有调节的中介分析 ===',
      'MM_SPEC|450|stress|burnout|turnover|support',
      'MM_COEF|m|x|0.4200|0.0480|8.7500|p < 0.001|2.4e-16',
      'MM_COEF|y|m|0.5000|0.0420|11.9048|p < 0.001|8.1e-27',
      'MM_INDEX|0.1500|0.0392|0.0730|0.2270',
      'MM_COND|mean|0.0000|0.4200|0.2100|0.1018|0.3182'
    ].join('\n')
    const kv = parseROutput(polluted).keyValues
    // 契约保证 m 方程一定输出 x_w，这里没有 → 自检无法完成
    expect(String(kv['恒等式自检'])).toBe('无法判断')
    expect(String(kv['恒等式自检'])).not.toBe('一致')
    expect(String(kv['恒等式缺失字段'])).toContain('a4')
  })

  it('条件间接效应与 (a2 + a4·W)·b 不符时报「不一致」', () => {
    const injected = OUT.replace(
      'MM_COND|+1SD|1.0000|0.7200|0.3600|0.1881|0.5319',
      'MM_COND|+1SD|1.0000|0.7200|0.1500|0.1881|0.5319'
    )
    const kv = parseROutput(injected).keyValues
    expect(String(kv['恒等式自检'])).toBe('不一致')
    expect(String(kv['恒等式偏差'])).toContain('条件间接效应(+1SD)')
  })

  it('【反向】index 显著但某个水平不显著 → 表必须逐个水平给出「含 0」', () => {
    // 这正是契约要求"必须提示 index 显著 ≠ 每个水平都显著"的场景：
    // index CI 不含 0（显著），但 -1SD 的条件间接效应 CI = [-0.0100, 0.1300] 跨 0。
    const mixed = OUT.replace(
      'MM_COND|-1SD|-1.0000|0.1200|0.0600|0.0068|0.1352',
      'MM_COND|-1SD|-1.0000|0.1200|0.0600|-0.0100|0.1300'
    )
    const parsed = parseROutput(mixed)
    const t2 = tableOf(parsed.tables, '有调节的中介效应指数')
    expect(String(rowOf(t2, 'index = a4 × b')[4])).toBe('不含 0') // index 显著
    const t3 = tableOf(parsed.tables, '各 support 水平下的条件间接效应')
    expect(String(rowOf(t3, '-1SD')[6])).toBe('含 0') // 该水平不显著
    expect(String(rowOf(t3, 'mean')[6])).toBe('不含 0')
    expect(String(rowOf(t3, '+1SD')[6])).toBe('不含 0')
    // 表注必须写明这条口径，否则用户会把 index 的显著性当成逐水平显著
    expect(t2.note).toContain('不等于')
    expect(t3.note).toContain('index 显著 ≠ 每个水平都显著')
  })

  it('至少 3 张表，且每张都有数据行', () => {
    const tables = parseROutput(OUT).tables
    expect(tables.length).toBeGreaterThanOrEqual(3)
    for (const t of tables) expect(t.rows.length).toBeGreaterThan(0)
  })
})

/* ═══════════════════════════════════════════════════════════════════════
 * 五、路径分析
 *
 * 死锁点：**total 取成 direct**（漏掉 indirect）。任务描述点名要注入它。
 * 本 fixture 里三列都不同：
 *   X→Y：direct = 0.1500, indirect = 0.2000 (0.5×0.4), total = 0.3500
 * 0.15 / 0.20 / 0.35 三个值互不相同，任何两列互换都会被抓住。
 * 另外 PATH_EFFECT 是**多行**，必须验证第 2 行及以后没被丢掉。
 * ═══════════════════════════════════════════════════════════════════════ */

describe('字段级断言：路径分析（path_analysis）', () => {
  // 路径图：X → M（0.5000）、M → Y（0.4000）、X → Y（0.1500）
  //   X→Y：direct 0.1500, indirect 0.5×0.4 = 0.2000, total 0.3500
  //   X→M：direct 0.5000, indirect 0, total 0.5000（无中介通路时 indirect 输出 0 而非 NA）
  const OUT = [
    '=== 路径分析 ===',
    'PATH_SPEC|400|3|3',
    'PATH_EDGE|X|M|0.5000|0.0400|12.5000|p < 0.001|1.0e-30|0.4800',
    'PATH_EDGE|M|Y|0.4000|0.0450|8.8889|p < 0.001|2.0e-17|0.3900',
    'PATH_EDGE|X|Y|0.1500|0.0480|3.1250|p = 0.002|0.0019|0.1400',
    'PATH_EQ|M|0.2304|0.2285|119.5200|p < 0.001|1.0e-30',
    'PATH_EQ|Y|0.1952|0.1911|48.2100|p < 0.001|2.0e-18',
    'PATH_EFFECT|X|Y|0.1500|0.2000|0.3500',
    'PATH_EFFECT|X|M|0.5000|0.0000|0.5000',
    'PATH_NOTE|首版采用 OLS 逐方程估计，非联合 ML-SEM',
    'CONCL|X 对 Y 既有直接效应也存在经 M 的间接效应'
  ].join('\n')

  it('PATH_SPEC 的三个字段各就各位', () => {
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['n'])).toBe(400)
    expect(Number(kv['节点数'])).toBe(3)
    expect(Number(kv['边数'])).toBe(3)
  })

  it('表1 路径系数：from/to/coef/se/t/p/std_coef 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '路径系数')
    expect(t.headers).toEqual(['路径', '非标准化系数', 'SE', 't', 'p', '标准化系数'])
    expect(t.rows).toHaveLength(3)

    const xm = rowOf(t, 'X → M')
    expect(num(xm[1])).toBeCloseTo(0.5, 4) // coef ← f[3]
    expect(num(xm[2])).toBeCloseTo(0.04, 4) // se   ← f[4]
    expect(num(xm[3])).toBeCloseTo(12.5, 4) // t    ← f[5]
    expect(String(xm[4])).toBe('p < 0.001') // p    ← f[6]
    expect(num(xm[5])).toBeCloseTo(0.48, 4) // std  ← f[8]（不是 f[7] 的 p_raw）

    const my = rowOf(t, 'M → Y')
    expect(num(my[1])).toBeCloseTo(0.4, 4)
    expect(num(my[5])).toBeCloseTo(0.39, 4)

    const xy = rowOf(t, 'X → Y')
    expect(num(xy[1])).toBeCloseTo(0.15, 4)
    expect(num(xy[2])).toBeCloseTo(0.048, 4)
    expect(num(xy[3])).toBeCloseTo(3.125, 4)
    expect(String(xy[4])).toBe('p = 0.002')
    expect(num(xy[5])).toBeCloseTo(0.14, 4)
  })

  it('表2 逐方程拟合：dv / r2 / adj_r2 / F / p 各取正确字段', () => {
    const t = tableOf(parseROutput(OUT).tables, '各内生变量方程拟合')
    expect(t.headers).toEqual(['内生变量', 'R²', '调整 R²', 'F', 'p'])
    expect(t.rows).toHaveLength(2)

    const mEq = rowOf(t, 'M')
    expect(num(mEq[1])).toBeCloseTo(0.2304, 4) // r2     ← f[2]
    expect(num(mEq[2])).toBeCloseTo(0.2285, 4) // adj_r2 ← f[3]
    expect(num(mEq[3])).toBeCloseTo(119.52, 4) // f      ← f[4]
    expect(String(mEq[4])).toBe('p < 0.001')

    const yEq = rowOf(t, 'Y')
    expect(num(yEq[1])).toBeCloseTo(0.1952, 4)
    expect(num(yEq[2])).toBeCloseTo(0.1911, 4)
    expect(num(yEq[3])).toBeCloseTo(48.21, 4)
  })

  it('表3 效应分解：direct / indirect / total 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '效应分解（直接 / 间接 / 总效应）')
    expect(t.headers).toEqual(['路径', '直接效应', '间接效应', '总效应', '总效应 − 直接效应'])
    // 多行 PATH_EFFECT 不得被丢弃（旧式 firstTagged 只会留第一行）
    expect(t.rows).toHaveLength(2)

    const xy = rowOf(t, 'X → Y')
    expect(num(xy[1])).toBeCloseTo(0.15, 4) // direct   ← f[3]
    expect(num(xy[2])).toBeCloseTo(0.2, 4) // indirect ← f[4]
    expect(num(xy[3])).toBeCloseTo(0.35, 4) // total    ← f[5]
    // 独立列：total − direct 必须等于 indirect
    expect(num(xy[4])).toBeCloseTo(0.2, 4)
  })

  it('【死锁】total ≠ direct（漏掉 indirect 的直接断言）', () => {
    // 任务描述点名要注入的缺陷：total 取成 direct。
    // 0.35 vs 0.15 —— 差异明显，但若只断言 total 有值就抓不到。
    const t = tableOf(parseROutput(OUT).tables, '效应分解（直接 / 间接 / 总效应）')
    const xy = rowOf(t, 'X → Y')
    expect(num(xy[3])).not.toBeCloseTo(num(xy[1]), 4)
    expect(num(xy[3])).toBeCloseTo(num(xy[1]) + num(xy[2]), 6)
    // 契约恒等式
    expect(String(parseROutput(OUT).keyValues['恒等式自检'])).toBe('一致')
  })

  it('无中介通路时 indirect 输出 0（不是 NA）', () => {
    const t = tableOf(parseROutput(OUT).tables, '效应分解（直接 / 间接 / 总效应）')
    const xm = rowOf(t, 'X → M')
    expect(num(xm[2])).toBe(0) // indirect = 0，且是数字 0 而非占位符
    expect(String(xm[2])).toBe('0')
    expect(num(xm[3])).toBeCloseTo(0.5, 4) // total = direct + 0
  })

  it('表与 keyValues 一致（路径系数 + 方程 + 效应分解）', () => {
    const parsed = parseROutput(OUT)
    const t1 = tableOf(parsed.tables, '路径系数')
    expect(Number(parsed.keyValues['edge_X_M_coef'])).toBeCloseTo(num(rowOf(t1, 'X → M')[1]), 6)
    expect(Number(parsed.keyValues['edge_M_Y_coef'])).toBeCloseTo(num(rowOf(t1, 'M → Y')[1]), 6)
    expect(Number(parsed.keyValues['edge_X_Y_coef'])).toBeCloseTo(num(rowOf(t1, 'X → Y')[1]), 6)
    expect(Number(parsed.keyValues['edge_X_Y_std'])).toBeCloseTo(num(rowOf(t1, 'X → Y')[5]), 6)

    const t2 = tableOf(parsed.tables, '各内生变量方程拟合')
    expect(Number(parsed.keyValues['eq_M_r2'])).toBeCloseTo(num(rowOf(t2, 'M')[1]), 6)
    expect(Number(parsed.keyValues['eq_Y_r2'])).toBeCloseTo(num(rowOf(t2, 'Y')[1]), 6)

    const t3 = tableOf(parsed.tables, '效应分解（直接 / 间接 / 总效应）')
    expect(Number(parsed.keyValues['effect_X_Y_direct'])).toBeCloseTo(
      num(rowOf(t3, 'X → Y')[1]),
      6
    )
    expect(Number(parsed.keyValues['effect_X_Y_indirect'])).toBeCloseTo(
      num(rowOf(t3, 'X → Y')[2]),
      6
    )
    expect(Number(parsed.keyValues['effect_X_Y_total'])).toBeCloseTo(
      num(rowOf(t3, 'X → Y')[3]),
      6
    )
  })

  it('total ≠ direct + indirect 时报「不一致」', () => {
    const injected = OUT.replace(
      'PATH_EFFECT|X|Y|0.1500|0.2000|0.3500',
      'PATH_EFFECT|X|Y|0.1500|0.2000|0.1500'
    )
    const kv = parseROutput(injected).keyValues
    expect(String(kv['恒等式自检'])).toBe('不一致')
    expect(String(kv['恒等式偏差'])).toContain('total ≠ direct + indirect')
  })

  it('表注必须声明「OLS 逐方程」而非联合 ML（过度识别时不等价）', () => {
    const t = tableOf(parseROutput(OUT).tables, '各内生变量方程拟合')
    expect(t.note).toContain('OLS 逐方程')
    expect(t.note).toContain('恰好识别')
    expect(t.note).toContain('过度识别')
  })
})

/* ═══════════════════════════════════════════════════════════════════════
 * 六、SEM
 *
 * 死锁点：**CFI 取成 TLI**（任务描述点名）。两者都是 0.9x，互换后
 * "拟合良好"依然成立，只有逐格断言能抓住。
 * 另外要断言测量模型的 std_load / unstd_load / se / z / p / r2 **六个字段**
 * 各自到位——契约里这一行有 9 个字段，是最长的一行。
 * ═══════════════════════════════════════════════════════════════════════ */

describe('字段级断言：SEM（sem）', () => {
  // 2 潜变量 / 每潜变量 3 指标 / n = 500
  // 拟合：chisq 18.4200, df 8 → χ²/df = 2.3025
  //   CFI 0.9812, TLI 0.9647, RMSEA 0.0510, SRMR 0.0298
  //   四者互不相同，任何互换必被抓（尤其 CFI ↔ TLI：0.9812 vs 0.9647）
  const OUT = [
    '=== 结构方程模型 (SEM) ===',
    'SEM_SPEC|500|2|6',
    'SEM_MEASURE|F1|q1|0.8100|1.0000|NA|NA|p = NA|NA|0.6561',
    'SEM_MEASURE|F1|q2|0.8400|1.1020|0.0510|19.6078|p < 0.001|2.0e-60|0.7056',
    'SEM_MEASURE|F1|q3|0.7800|0.9800|0.0530|16.9151|p < 0.001|5.0e-50|0.6084',
    'SEM_MEASURE|F2|q4|0.8000|1.0000|NA|NA|p = NA|NA|0.6400',
    'SEM_MEASURE|F2|q5|0.8200|1.0450|0.0500|18.9000|p < 0.001|8.0e-55|0.6724',
    'SEM_MEASURE|F2|q6|0.7600|0.9400|0.0520|15.6538|p < 0.001|3.0e-45|0.5776',
    'SEM_STRUCT|F1|F2|0.4200|0.0550|7.6364|p < 0.001|2.0e-14',
    'SEM_LATENT|F2|0.1764',
    'SEM_FIT|18.4200|8|p = 0.018|0.0183|0.9812|0.9647|0.0510|0.0298',
    'SEM_NOTE|ML 拟合收敛（5 个起点取 F 最小者）；未检出 Heywood 案例',
    'CONCL|模型拟合良好（CFI = 0.9812，RMSEA = 0.0510），F1 显著预测 F2'
  ].join('\n')

  it('SEM_SPEC 的三个字段各就各位', () => {
    const kv = parseROutput(OUT).keyValues
    expect(Number(kv['n'])).toBe(500)
    expect(Number(kv['潜变量数'])).toBe(2)
    expect(Number(kv['观测变量数'])).toBe(6)
  })

  it('表1 测量模型：latent / indicator / std_load / unstd_load / se / z / p / r2 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '测量模型（标准化载荷）')
    expect(t.headers).toEqual([
      '潜变量',
      '指标',
      '标准化载荷',
      '非标准化载荷',
      'SE',
      'z',
      'p',
      'R²'
    ])
    expect(t.rows).toHaveLength(6)

    const q2 = t.rows.find((r) => String(r[1]) === 'q2')!
    expect(String(q2[0])).toBe('F1')
    expect(num(q2[2])).toBeCloseTo(0.84, 4) // std_load   ← f[3]
    expect(num(q2[3])).toBeCloseTo(1.102, 4) // unstd_load ← f[4]
    expect(num(q2[4])).toBeCloseTo(0.051, 4) // se         ← f[5]
    expect(num(q2[5])).toBeCloseTo(19.6078, 4) // z        ← f[6]
    expect(String(q2[6])).toBe('p < 0.001') // p          ← f[7]
    expect(num(q2[7])).toBeCloseTo(0.7056, 4) // r2         ← f[9]

    const q6 = t.rows.find((r) => String(r[1]) === 'q6')!
    expect(String(q6[0])).toBe('F2')
    expect(num(q6[2])).toBeCloseTo(0.76, 4)
    expect(num(q6[7])).toBeCloseTo(0.5776, 4)

    // marker 指标：非标准化载荷固定 1、SE/z 为 NA → 表里必须是占位符而不是 0
    const q1 = t.rows.find((r) => String(r[1]) === 'q1')!
    expect(num(q1[3])).toBeCloseTo(1.0, 4)
    expect(String(q1[4])).toBe('—')
    expect(String(q1[5])).toBe('—')
    expect(String(q1[6])).toBe('—')
  })

  it('R² 与标准化载荷²一致（内部一致性，两字段不得各算一遍）', () => {
    const t = tableOf(parseROutput(OUT).tables, '测量模型（标准化载荷）')
    for (const r of t.rows) {
      const load = num(r[2])
      const r2 = num(r[7])
      // fixture 的载荷与 R² 都保留 4 位小数，平方后在 4 位精度上对齐
      expect(r2).toBeCloseTo(load * load, 3)
    }
  })

  it('表2 结构模型：from/to/coef/se/z/p 各取正确字段', () => {
    const t = tableOf(parseROutput(OUT).tables, '结构模型（潜变量间的路径）')
    expect(t.headers).toEqual(['路径', '系数', 'SE', 'z', 'p'])
    expect(t.rows).toHaveLength(1)
    const r = t.rows[0]
    expect(String(r[0])).toBe('F1 → F2')
    expect(num(r[1])).toBeCloseTo(0.42, 4) // coef ← f[3]
    expect(num(r[2])).toBeCloseTo(0.055, 4) // se   ← f[4]
    expect(num(r[3])).toBeCloseTo(7.6364, 4) // z    ← f[5]
    expect(String(r[4])).toBe('p < 0.001') // p    ← f[6]
  })

  it('表3 内生潜变量 R²', () => {
    const t = tableOf(parseROutput(OUT).tables, '内生潜变量解释率')
    expect(t.headers).toEqual(['潜变量', 'R²'])
    expect(t.rows).toHaveLength(1)
    expect(String(t.rows[0][0])).toBe('F2')
    expect(num(t.rows[0][1])).toBeCloseTo(0.1764, 4)
  })

  it('表4 拟合指标：χ²/df/p/CFI/TLI/RMSEA/SRMR 逐格正确', () => {
    const t = tableOf(parseROutput(OUT).tables, '模型拟合指标')
    expect(t.headers).toEqual(['指标', '数值', '参考标准'])
    expect(num(rowOf(t, 'χ²')[1])).toBeCloseTo(18.42, 4)
    expect(Number(rowOf(t, 'df')[1])).toBe(8)
    expect(String(rowOf(t, 'p')[1])).toBe('p = 0.018') // p_display，不是 raw 0.0183
    expect(num(rowOf(t, 'χ²/df')[1])).toBeCloseTo(2.3025, 4)
    expect(num(rowOf(t, 'CFI')[1])).toBeCloseTo(0.9812, 4) // ← f[5]
    expect(num(rowOf(t, 'TLI')[1])).toBeCloseTo(0.9647, 4) // ← f[6]
    expect(num(rowOf(t, 'RMSEA')[1])).toBeCloseTo(0.051, 4) // ← f[7]
    expect(num(rowOf(t, 'SRMR')[1])).toBeCloseTo(0.0298, 4) // ← f[8]
  })

  it('【死锁】CFI ≠ TLI ≠ RMSEA ≠ SRMR（四个指标互不相同，错位必被抓）', () => {
    const t = tableOf(parseROutput(OUT).tables, '模型拟合指标')
    const cfi = num(rowOf(t, 'CFI')[1])
    const tli = num(rowOf(t, 'TLI')[1])
    expect(cfi).toBeCloseTo(0.9812, 4) // 若把 f[6] 读成 cfi，这里会变成 0.9647
    expect(tli).toBeCloseTo(0.9647, 4) // 若把 f[5] 读成 tli，这里会变成 0.9812
    const all = ['CFI', 'TLI', 'RMSEA', 'SRMR'].map((k) => num(rowOf(t, k)[1]))
    expect(new Set(all).size).toBe(4)
  })

  it('表与 keyValues 一致（载荷 + 结构 + 拟合指标）', () => {
    const parsed = parseROutput(OUT)
    const t1 = tableOf(parsed.tables, '测量模型（标准化载荷）')
    const q2 = t1.rows.find((r) => String(r[1]) === 'q2')!
    expect(Number(parsed.keyValues['载荷_F1_q2'])).toBeCloseTo(num(q2[2]), 6)
    expect(Number(parsed.keyValues['非标准化载荷_F1_q2'])).toBeCloseTo(num(q2[3]), 6)
    expect(Number(parsed.keyValues['载荷R2_F1_q2'])).toBeCloseTo(num(q2[7]), 6)

    const t2 = tableOf(parsed.tables, '结构模型（潜变量间的路径）')
    expect(Number(parsed.keyValues['结构_F1_F2_coef'])).toBeCloseTo(num(t2.rows[0][1]), 6)
    expect(Number(parsed.keyValues['结构_F1_F2_z'])).toBeCloseTo(num(t2.rows[0][3]), 6)

    const t3 = tableOf(parsed.tables, '内生潜变量解释率')
    expect(Number(parsed.keyValues['潜变量R2_F2'])).toBeCloseTo(num(t3.rows[0][1]), 6)

    const t4 = tableOf(parsed.tables, '模型拟合指标')
    expect(Number(parsed.keyValues['chi2'])).toBeCloseTo(num(rowOf(t4, 'χ²')[1]), 6)
    expect(Number(parsed.keyValues['df'])).toBe(Number(rowOf(t4, 'df')[1]))
    expect(Number(parsed.keyValues['CFI'])).toBeCloseTo(num(rowOf(t4, 'CFI')[1]), 6)
    expect(Number(parsed.keyValues['TLI'])).toBeCloseTo(num(rowOf(t4, 'TLI')[1]), 6)
    expect(Number(parsed.keyValues['RMSEA'])).toBeCloseTo(num(rowOf(t4, 'RMSEA')[1]), 6)
    expect(Number(parsed.keyValues['SRMR'])).toBeCloseTo(num(rowOf(t4, 'SRMR')[1]), 6)
    // keyValues 的 p 用原始数值（0.0183），表用展示串（p = 0.018）
    expect(Number(parsed.keyValues['p'])).toBeCloseTo(0.0183, 6)
  })

  it('SEM 至少 4 张表（契约要求 ≥3：测量 / 结构 / 拟合，此处另有潜变量 R²）', () => {
    const tables = parseROutput(OUT).tables
    expect(tables.length).toBeGreaterThanOrEqual(3)
    for (const t of tables) expect(t.rows.length).toBeGreaterThan(0)
    // 三张契约点名的表必须都在
    expect(tables.some((t) => t.title.includes('测量模型'))).toBe(true)
    expect(tables.some((t) => t.title.includes('结构模型'))).toBe(true)
    expect(tables.some((t) => t.title.includes('拟合指标'))).toBe(true)
  })

  it('【跨方法】SEM 与 CFA 的拟合指标口径一致（同一套表头与参考标准）', () => {
    // 契约第五节明文要求「拟合指标公式与 v0.3.1 的 CFA 完全一致」。
    // 这里比对两边的**表结构与参考标准列**：若有人给 SEM 另写一套指标
    // （比如换个顺序、加/减指标），这条会红。
    const CFA_OUT = [
      '=== 验证性因子分析 (CFA) ===',
      'CFA_SPEC|2|6|300',
      'CFA_FIT|12.4831|8|p = 0.131|0.1306',
      'CFA_FITIDX|0.9912|0.9835|0.0432|0.0271',
      'CFA_NULLMODEL|742.1908|15'
    ].join('\n')
    const sem = tableOf(parseROutput(OUT).tables, '模型拟合指标')
    const cfa = tableOf(parseROutput(CFA_OUT).tables, '模型拟合指标')
    expect(sem.headers).toEqual(cfa.headers)
    // 两边都必须有这 8 个指标行（SEM 多一行 χ²/df 的位置一致）
    const semIdx = sem.rows.map((r) => String(r[0]))
    const cfaIdx = cfa.rows.map((r) => String(r[0]))
    for (const key of ['χ²', 'df', 'p', 'χ²/df', 'CFI', 'TLI', 'RMSEA', 'SRMR']) {
      expect(semIdx, `SEM 拟合表缺少 ${key}`).toContain(key)
      expect(cfaIdx, `CFA 拟合表缺少 ${key}`).toContain(key)
    }
    // 四个拟合指标的参考标准必须**逐字相同**：CFI / TLI / RMSEA / SRMR 的公式
    // 与判定阈值两个方法共用同一套（契约第五节"不要另写一份"）。
    for (const key of ['CFI', 'TLI', 'RMSEA', 'SRMR']) {
      expect(String(rowOf(sem, key)[2]), `${key} 的参考标准与 CFA 不一致`).toBe(
        String(rowOf(cfa, key)[2])
      )
    }
    // df 的参考标准允许不同（npar 的构成不同：CFA 是 2p + k(k−1)/2，
    // SEM 还有结构路径数），但两边的自由度公式**主干**必须是同一个 p(p+1)/2 − …
    for (const t of [sem, cfa]) {
      expect(String(rowOf(t, 'df')[2])).toContain('p(p+1)/2 −')
    }
    // χ²/df 的判定阈值也共用
    expect(String(rowOf(sem, 'χ²/df')[2])).toBe(String(rowOf(cfa, 'χ²/df')[2]))
  })

  it('恰好识别（df = 0）时 χ²/df 给占位而非 Infinity', () => {
    const out = [
      '=== 结构方程模型 (SEM) ===',
      'SEM_SPEC|400|2|4',
      'SEM_MEASURE|F1|q1|0.8000|1.0000|NA|NA|p = NA|NA|0.6400',
      'SEM_MEASURE|F2|q2|0.7900|1.0000|NA|NA|p = NA|NA|0.6241',
      'SEM_STRUCT|F1|F2|0.3000|0.0500|6.0000|p < 0.001|2.0e-09',
      'SEM_FIT|0.0000|0|p = NA|NA|1.0000|1.0000|0.0000|0.0000'
    ].join('\n')
    const t = tableOf(parseROutput(out).tables, '模型拟合指标')
    expect(String(rowOf(t, 'χ²/df')[1])).toBe('—')
    expect(String(rowOf(t, 'p')[1])).toBe('—')
    // CFI / TLI = 1、RMSEA = 0 必须照显（契约明说 df ≤ 0 时如此）
    expect(num(rowOf(t, 'CFI')[1])).toBeCloseTo(1, 4)
    expect(num(rowOf(t, 'RMSEA')[1])).toBeCloseTo(0, 4)
  })

  it('SEM_NOTE 进入 kv（收敛警告 / Heywood 提示不得静默吞掉）', () => {
    const kv = parseROutput(OUT).keyValues
    expect(String(kv['提示'])).toContain('未检出 Heywood')
  })
})

/* ═══════════════════════════════════════════════════════════════════════
 * 七、跨方法一致性（v0.3.1 教训：单方向透传断言会漏掉半吊子实现）
 * ═══════════════════════════════════════════════════════════════════════ */

describe('跨方法：结果协议与解析器登记一致', () => {
  it('五个新 kind 都进了 RESULT_KINDS，且与 detectAnalysisType 的返回值对齐', () => {
    const expected: Array<[string, string]> = [
      ['=== 中介效应分析 ===', 'mediation'],
      ['=== 调节效应分析 ===', 'moderation'],
      ['=== 有调节的中介分析 ===', 'moderated_mediation'],
      ['=== 路径分析 ===', 'path_analysis'],
      ['=== 结构方程模型 (SEM) ===', 'sem']
    ]
    for (const [banner, kind] of expected) {
      expect(detectAnalysisType(banner)).toBe(kind)
      // 类型层与运行时层不得漂移
      expect(RESULT_KINDS as readonly string[]).toContain(kind)
    }
  })

  it('ResultKindMap 覆盖五个新 kind（类型级断言，编译期即校验）', () => {
    // 这些变量若拼错/缺失，tsc 会直接失败——这正是协议层存在的意义：
    // 字段改名立即被 typecheck 拒绝，而不是等运行时读成 undefined。
    const _mediation: ResultKindMap['mediation'] = {
      kind: 'mediation',
      schema_version: 1,
      method: 'mediation',
      n: 300,
      variables: { x: 'x', m: 'm', y: 'y' },
      paths: [],
      effects: [],
      sobel: null,
      bootstrap: null,
      std_paths: [],
      notes: [],
      diagnostics: []
    }
    const _moderation: ResultKindMap['moderation'] = {
      kind: 'moderation',
      schema_version: 1,
      method: 'moderation',
      n: 240,
      variables: { x: 'x', w: 'w', y: 'y' },
      centered: true,
      coefficients: [],
      model: { r2: null, adj_r2: null, f: null, p: { value: null, display: '' }, df1: null, df2: null },
      delta: { r2_change: null, f_change: null, df1: null, df2: null, p: { value: null, display: '' } },
      simple_slopes: [],
      johnson_neyman: [],
      notes: [],
      diagnostics: []
    }
    const _modMed: ResultKindMap['moderated_mediation'] = {
      kind: 'moderated_mediation',
      schema_version: 1,
      method: 'moderated_mediation',
      n: 450,
      variables: { x: 'x', m: 'm', y: 'y', w: 'w' },
      coefficients: [],
      index: { index: null, se: null, ci_lower: null, ci_upper: null },
      conditional: [],
      bootstrap: null,
      notes: [],
      diagnostics: []
    }
    const _path: ResultKindMap['path_analysis'] = {
      kind: 'path_analysis',
      schema_version: 1,
      method: 'path_analysis',
      n: 400,
      nodes: ['X', 'M', 'Y'],
      n_edges: 3,
      edges: [],
      equations: [],
      effects: [],
      notes: [],
      diagnostics: []
    }
    const _sem: ResultKindMap['sem'] = {
      kind: 'sem',
      schema_version: 1,
      method: 'sem',
      n: 500,
      n_latent: 2,
      n_obs: 6,
      measure: [],
      structure: [],
      latent_r2: [],
      fit: {
        chisq: null,
        df: null,
        p: { value: null, display: '' },
        cfi: null,
        tli: null,
        rmsea: null,
        srmr: null
      },
      notes: [],
      diagnostics: []
    }
    // 只为让 tsc 保留这些 const（未使用变量在严格配置下会报错）
    expect([
      _mediation.kind,
      _moderation.kind,
      _modMed.kind,
      _path.kind,
      _sem.kind
    ]).toEqual(['mediation', 'moderation', 'moderated_mediation', 'path_analysis', 'sem'])
  })

  it('解析器源码不得用 output.includes 判定分析类型', () => {
    // 铁律的自动化守卫：detectAnalysisType 的函数体内不得出现 includes(
    const src = readFileSync(resolve(__dirname, '../resultParser.ts'), 'utf8')
    const fnStart = src.indexOf('export function detectAnalysisType')
    expect(fnStart).toBeGreaterThan(-1)
    // 用花括号配平取出**恰好这一个函数**的函数体。
    // （按「下一个 export function」切片会多切进后面的非导出函数，
    //  那个函数里的 `.includes('拒绝')` 是判正态性结论，与分析类型判定无关。）
    const bodyStart = src.indexOf('{', fnStart)
    let depth = 0
    let bodyEnd = bodyStart
    for (let i = bodyStart; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) {
          bodyEnd = i
          break
        }
      }
    }
    const body = src.slice(bodyStart, bodyEnd + 1)
    expect(body.length).toBeGreaterThan(100)
    expect(body).toContain('startsWith')
    // 先剥掉注释再检查——否则"把坏写法写进注释当反面教材"会造成假红
    // （与 interpret-i18n.test.ts 里"不再依赖手写白名单"那条同一做法）。
    const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(codeOnly).not.toMatch(/\.includes\s*\(/)
    // 也必须真的只用横幅（横幅正则必须在函数体内）
    expect(codeOnly).toMatch(/===/)
  })

  it('五个方法的表数下限（契约：每个 ≥2，SEM ≥3）', () => {
    // 每个 fixture 都至少产出一张表且每张表有行——
    // 但这里额外把"表数下限"本身钉死，防止将来把某个解析器改成"只在有 NOTE 时出表"。
    expect(parseROutput('=== 中介效应分析 ===\nMED_SPEC|100|x|m|y\nMED_PATH|a|0.5000|0.1|5|p = 0.001|0.001\nMED_EFFECT|indirect|0.2000|0.03|0.1|0.3|percentile').tables.length).toBeGreaterThanOrEqual(2)
    expect(parseROutput('=== 调节效应分析 ===\nMOD_SPEC|100|x|w|y|是\nMOD_COEF|x|0.3000|0.05|6|p < 0.001|0.0\nMOD_MODEL|0.4000|0.3900|50.0|p < 0.001|0.0|3|96').tables.length).toBeGreaterThanOrEqual(2)
    expect(parseROutput('=== 有调节的中介分析 ===\nMM_SPEC|300|x|m|y|w\nMM_INDEX|0.1500|0.04|0.07|0.23\nMM_COND|mean|0.0000|0.4200|0.2100|0.10|0.32').tables.length).toBeGreaterThanOrEqual(2)
    expect(parseROutput('=== 路径分析 ===\nPATH_SPEC|200|3|3\nPATH_EDGE|X|M|0.5|0.04|12|p < 0.001|0.0|0.48\nPATH_EQ|M|0.23|0.22|119|p < 0.001|0.0\nPATH_EFFECT|X|Y|0.15|0.2|0.35').tables.length).toBeGreaterThanOrEqual(2)
    expect(
      parseROutput(
        '=== 结构方程模型 (SEM) ===\nSEM_SPEC|300|2|6\nSEM_MEASURE|F1|q1|0.8|1|NA|NA|p = NA|NA|0.64\nSEM_STRUCT|F1|F2|0.42|0.05|7.6|p < 0.001|0.0\nSEM_FIT|18.42|8|p = 0.018|0.0183|0.9812|0.9647|0.0510|0.0298'
      ).tables.length
    ).toBeGreaterThanOrEqual(3)
  })
})
