/**
 * 数据质量检查的单元测试（v0.3.3 / T82，对应 TECH_DEBT.md D02 + D03）
 *
 * ── 这一层要防的是什么 ──
 *
 * 实测（三组各 20 观测），只把一个单元格改成 `1e6`：
 *   正常:            ANOVA F=229.13, p=5.6e-28（极显著）；α=0.8434
 *   注入 1 个 1e6:   ANOVA F=0.9998,  p=0.374 （不显著）；  α=-0.0000
 * 全程 rc=0、零警告。数值层面完全正确，错的是"该不该这么算"。
 *
 * ── 本文件的双向要求 ──
 *
 * 1. **该报的必须报**，且**行号必须精确**（`rows` 是 1 基、不含表头；
 *    行号错一位，用户会去改错的单元格——这比不报更糟）。
 * 2. **不该报的必须不报**。「干净数据返回空数组」是同等级的验收标准：
 *    一个动辄报警的质量模块会被用户直接忽略，等于没有。
 *
 * 判定口径与 R 侧 `r_quality_check()` 必须一致（分位数用 type-7）：
 * 两处若漂移，用户会同时看到两个互相矛盾的"N 个离群值"。
 */

import { describe, it, expect } from 'vitest'
import { checkDataQuality, quantileType7, type QualityIssue } from '../dataQuality'
import { READ_CSV, R_COMMON } from '../rCommon'
import { DEFAULT_MISSING_SENTINELS, SPSS_MISSING_SENTINELS } from '../dataService'

/** 造行：`{ a: [...] }` → `[{a:v0},{a:v1},...]`，列长度必须一致 */
function makeRows(columns: Record<string, unknown[]>): Record<string, unknown>[] {
  const names = Object.keys(columns)
  const n = columns[names[0]].length
  return Array.from({ length: n }, (_, i) => {
    const row: Record<string, unknown> = {}
    for (const name of names) row[name] = columns[name][i]
    return row
  })
}

/** 取指定列 + 指定类型的 issue */
function issueOf(issues: QualityIssue[], column: string, kind: QualityIssue['kind']) {
  return issues.find((x) => x.column === column && x.kind === kind)
}

describe('checkDataQuality：极端值（D02）', () => {
  it('注入 1 个 1e6 → 检出 outlier，且行号精确指向被污染的单元格', () => {
    // 20 个正常分数（约 10 分上下）+ 第 13 行被录成 1e6
    const scores = [
      9, 10, 11, 10, 9, 12, 10, 11, 10, 9, 11, 10,
      1e6, // ← 第 13 行（1 基）
      10, 11, 9, 10, 12, 10, 11
    ]
    const rows = makeRows({ score: scores })
    const issues = checkDataQuality(['score'], rows)

    const outlier = issueOf(issues, 'score', 'outlier')
    expect(outlier, '1e6 未被检出为极端值').toBeDefined()
    expect(outlier!.count).toBe(1)
    // 行号必须是 1 基且不含表头：1e6 在下标 12 → 行号 13
    expect(outlier!.rows).toEqual([13])
    expect(outlier!.detail).toContain('|z| > 3')
  })

  it('极端值行号是 1 基、不含表头（错一位会指导用户改错单元格）', () => {
    // 把极端值放在第 1 行，行号必须是 [1] 而不是 [2] 或 [0]
    const rows = makeRows({ v: [1e6, 10, 11, 10, 9, 12, 10, 11, 10, 9, 11, 10, 10, 11, 9, 10] })
    const outlier = issueOf(checkDataQuality(['v'], rows), 'v', 'outlier')
    expect(outlier!.rows).toEqual([1])
  })

  it('多个极端值时行号按升序给出，count 与行号个数一致', () => {
    const rows = makeRows({
      v: [10, 11, -1e6, 10, 9, 12, 10, 11, 1e6, 9, 11, 10, 10, 11, 9, 10]
    })
    const outlier = issueOf(checkDataQuality(['v'], rows), 'v', 'outlier')!
    expect(outlier.count).toBe(outlier.rows!.length)
    expect(outlier.rows).toEqual([...outlier.rows!].sort((a, b) => a - b))
    expect(outlier.rows).toContain(3) // -1e6
    expect(outlier.rows).toContain(9) // +1e6
  })

  it('z 规则能独立触发（IQR 退化为 0 时，z 是唯一防线）', () => {
    // 19 个 5 分 + 1 个 50 分（典型录入错误：50 应为 5）。
    // 此时 Q1 = Q3 = 5 → IQR = 0，IQR 规则按设计弃权（无法区分录入错误与
    // 真实少数派取值），**只有 z 规则能抓到**。
    // 这条用例是「把 |z|>3 改成 |z|>30 会变红」的落地保证：
    // 若删掉 z 规则或放宽阈值，本断言立刻失败。
    const scores = [5, 5, 5, 5, 5, 5, 50, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
    const rows = makeRows({ q1: scores })
    const outlier = issueOf(checkDataQuality(['q1'], rows), 'q1', 'outlier')
    expect(outlier, 'IQR=0 时 z 规则应独立生效').toBeDefined()
    expect(outlier!.count).toBe(1)
    expect(outlier!.rows).toEqual([7])
  })

  it('IQR 围栏能独立触发（稳健口径，不被极端值本身拉偏）', () => {
    // 均匀分布的 1..20，IQR 明确非零；上界 40 远超 Q3+1.5IQR
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 40]
    const rows = makeRows({ v })
    const outlier = issueOf(checkDataQuality(['v'], rows), 'v', 'outlier')
    expect(outlier).toBeDefined()
    expect(outlier!.rows).toContain(21)
  })

  it('负向极端值也会被检出（只查上界会漏掉"误录成负数"）', () => {
    // ⚠️ 这里刻意**不用** -999/-99：它们是 DEFAULT_MISSING_SENTINELS 的成员，
    // 会在缺失层就被判成缺失（正确的分层行为，见下一条用例），
    // 根本走不到极端值判定。用 -500 才是"真实的、非哨兵的负向录入错误"。
    const v = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, -500]
    const rows = makeRows({ v })
    const outlier = issueOf(checkDataQuality(['v'], rows), 'v', 'outlier')
    expect(outlier).toBeDefined()
    expect(outlier!.rows).toContain(17)
  })

  it('缺失哨兵优先于极端值判定（-999 走缺失层，不重复报为离群值）', () => {
    // 分层是刻意的：-999 在 DEFAULT_MISSING_SENTINELS 里，导入时已被归一成缺失。
    // 质量模块复用的是同一套 `isMissingValue()`，所以 -999 计入缺失、不计入有效值。
    // 若它同时被报成"极端值"，用户会看到两条互相矛盾的提示。
    const v = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, -999]
    const issues = checkDataQuality(['v'], makeRows({ v }))
    expect(issueOf(issues, 'v', 'outlier')).toBeUndefined()
  })

  it('样本量 < 4 时不做极端值判定（3 个点的 sd 没有判别力）', () => {
    const rows = makeRows({ v: [1, 2, 100] })
    expect(checkDataQuality(['v'], rows)).toEqual([])
  })

  it('n = 3 时即便数据看起来"很离群"也不报（记录小样本的数学边界）', () => {
    // ⚠️ 诚实说明：这条**不能**证明 `>= 4` 守卫被测试锁定。
    // 我实测过——把外层 `values.length >= 4` 放宽到 `>= 2`、
    // 甚至把内部两处 `if (n < 4) return []` 改成 `< 2`，31 个测试**全部照常通过**。
    // 原因是数学事实（R 实算确认）：
    //   - z 规则在 n <= 11 时不可能触发（|z| 理论上界 (n-1)/√n，n=11 才刚过 3）；
    //   - IQR 围栏在 n = 2/3 时也从不触发（暴力搜索 2 万次 fire rate 恰为 0），
    //     从 n = 4 起才约 55% 触发（如 [2,3,50,2] 判 3 号位离群）。
    // 也就是说 `n < 4` 是**冗余防御**：放宽它不改变任何可观察行为，
    // 所以没有任何黑盒断言能抓住它。这不是测试缺口可以补的，而是这条守卫本身
    // 在数学上不可观测。保留它仍是对的（意图明确、防未来改坏 z/IQR 规则），
    // 但我不谎称它有测试保护。
    // 这条用例的真实价值：钉住"小样本不报警"这个**用户可观察**的承诺。
    expect(checkDataQuality(['v'], makeRows({ v: [1, 2, 100] }))).toEqual([])
    expect(checkDataQuality(['v'], makeRows({ v: [1, 100] }))).toEqual([])
    // 同样的形状，n 到 4 就该报（证明不是"永远不报"）
    const fired = checkDataQuality(['v'], makeRows({ v: [2, 3, 50, 2] }))
    expect(issueOf(fired, 'v', 'outlier'), 'n=4 的 [2,3,50,2] 应检出离群值').toBeDefined()
  })
})

describe('checkDataQuality：值域越界（D03 / N3）', () => {
  it('5 点量表里出现 7 → 检出 out_of_range，并定位到单元格', () => {
    const rows = makeRows({
      q1: [5, 4, 3, 2, 1, 7, 4, 5], // 第 6 行 = 7
      q2: [5, 4, 3, 2, 1, 4, 4, 5]
    })
    const issues = checkDataQuality(['q1', 'q2'], rows, { likertMax: { q1: 5, q2: 5 } })

    const bad = issueOf(issues, 'q1', 'out_of_range')
    expect(bad, '5 点量表的 7 未被检出').toBeDefined()
    expect(bad!.count).toBe(1)
    expect(bad!.rows).toEqual([6])
    expect(bad!.detail).toContain('> 5')
    // q2 全在范围内 → 不得误报
    expect(issueOf(issues, 'q2', 'out_of_range')).toBeUndefined()
  })

  it('小于 1 的取值也算越界（0 分在 1–5 量表里不合法）', () => {
    const rows = makeRows({ q1: [5, 4, 3, 2, 1, 0, 4, 5] })
    const bad = issueOf(checkDataQuality(['q1'], rows, { likertMax: { q1: 5 } }), 'q1', 'out_of_range')
    expect(bad).toBeDefined()
    expect(bad!.rows).toEqual([6])
    expect(bad!.detail).toContain('< 1')
  })

  it('未声明量表上限的列不做值域判定（不知道范围就不该猜）', () => {
    // 同一份数据，只给 q1 声明上限 → q2 的 7 不得被报为越界
    const rows = makeRows({ q1: [1, 2, 3, 4, 5], q2: [1, 2, 3, 4, 7] })
    const issues = checkDataQuality(['q1', 'q2'], rows, { likertMax: { q1: 5 } })
    expect(issueOf(issues, 'q2', 'out_of_range')).toBeUndefined()
  })
})

describe('checkDataQuality：高缺失与常量列', () => {
  it('缺失 40% → 检出 high_missing，count 与行号都正确', () => {
    // 10 行里 4 行缺失（40% > 30%），第 2/4/7/9 行
    const rows = makeRows({
      score: [3, null, 5, '', 4, 2, 'NA', 5, undefined, 1]
    })
    const issues = checkDataQuality(['score'], rows)
    const miss = issueOf(issues, 'score', 'high_missing')
    expect(miss, '40% 缺失未被检出').toBeDefined()
    expect(miss!.count).toBe(4)
    expect(miss!.rows).toEqual([2, 4, 7, 9])
    expect(miss!.detail).toContain('40.0%')
  })

  it('缺失 20% 不报（未超过 30% 阈值）', () => {
    const rows = makeRows({ score: [3, null, 5, 4, 4, 2, 5, 3, 2, 1] })
    expect(issueOf(checkDataQuality(['score'], rows), 'score', 'high_missing')).toBeUndefined()
  })

  it('常量列 → 检出 constant 且不带 rows（整列同值，行号无意义）', () => {
    const rows = makeRows({ grp: [5, 5, 5, 5, 5, 5] })
    const issues = checkDataQuality(['grp'], rows)
    const constant = issueOf(issues, 'grp', 'constant')
    expect(constant).toBeDefined()
    expect(constant!.count).toBe(6)
    expect(constant!.detail).toContain('5')
    // 常量列不应同时被判成极端值（sd = 0 时 z 无定义）
    expect(issueOf(issues, 'grp', 'outlier')).toBeUndefined()
  })
})

describe('R 层纵深防御：READ_CSV 的 na.strings 与 JS 端同源（D03）', () => {
  // ⚠️ 这一组用例是补出来的，因为**第一版没有**：
  // 我把 READ_CSV 里的 na.strings 整段删掉后，392 个测试全部照常通过。
  // 也就是说 D03 的修复当时完全没有测试保护——"改了没测"正是本项目反复吃亏的地方。
  // 现在的防线：
  //   1. 断言 na.strings 存在且逐个哨兵都在
  //   2. 断言它由 DEFAULT_MISSING_SENTINELS 生成（改一处即同步，不用改测试）
  //   3. 断言 99/999 **不在**其中（红线的机器化看守）

  it('READ_CSV 必须带 na.strings（删掉它测试要红）', () => {
    expect(READ_CSV).toContain('na.strings')
    expect(READ_CSV).toMatch(/na\.strings\s*=\s*c\(/)
  })

  it('na.strings 的每一项都来自 DEFAULT_MISSING_SENTINELS（单一真相）', () => {
    for (const sentinel of DEFAULT_MISSING_SENTINELS) {
      expect(READ_CSV, `哨兵 "${sentinel}" 未注入 R 端`).toContain(`"${sentinel}"`)
    }
  })

  it('na.strings 的项数恰好等于 DEFAULT_MISSING_SENTINELS 的长度（没有多也没有少）', () => {
    const block = READ_CSV.match(/na\.strings\s*=\s*c\(([^)]*)\)/)
    expect(block, '未找到 na.strings 的 c(...) 块').toBeTruthy()
    const items = block![1].split(',').map((s) => s.trim()).filter(Boolean)
    expect(items).toHaveLength(DEFAULT_MISSING_SENTINELS.length)
  })

  it('🚫 红线：99 / 999 / 9999 / -9999 绝不在默认 na.strings 里', () => {
    // 把 99 当缺失会让"百分制 99 分、年龄 99 岁"这类有效观测被静默删除。
    // 为补 D03 而加进去，会引入比 D03 更严重的新缺陷（TECH_DEBT.md D03 的明确警告）。
    for (const bad of SPSS_MISSING_SENTINELS) {
      expect(
        READ_CSV,
        `SPSS 惯例哨兵 "${bad}" 泄漏进了默认 na.strings —— 这会静默删除有效观测`
      ).not.toContain(`"${bad}"`)
    }
    // 逐项精确校验，避免 "99" 被 "999" 之类的子串断言误判
    const block = READ_CSV.match(/na\.strings\s*=\s*c\(([^)]*)\)/)!
    const items = block[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
    expect(items).not.toContain('99')
    expect(items).not.toContain('999')
    expect(items).not.toContain('9999')
    expect(items).not.toContain('-9999')
  })

  it('R_COMMON 定义了 r_quality_check 与 r_quality_check_all', () => {
    expect(R_COMMON).toContain('r_quality_check <- function')
    expect(R_COMMON).toContain('r_quality_check_all <- function')
    expect(R_COMMON).toContain('DQ_WARN|')
  })

  it('R 侧 z 阈值必须是 3（与 TS 侧 Z_LIMIT 对齐，且放宽到 30 会红）', () => {
    // R 侧的判定写成 `z > 3`；若有人把它改成 30，与 TS 侧就会出现
    // "界面报 1 个离群值、R 输出报 0 个"的双事实，这是最坏的结果。
    expect(R_COMMON).toMatch(/z\s*>\s*3\b/)
    expect(R_COMMON).not.toMatch(/z\s*>\s*30\b/)
  })

  it('R 侧分位数用 type = 7（与 quantileType7 同口径）', () => {
    expect(R_COMMON).toMatch(/type\s*=\s*7/)
  })

  it('R 侧质量检查不得输出到 stderr（走 stdout 结构化通道）', () => {
    // DQ_WARN 必须由 cat() 输出；用 warning() 会走 parseRWarnings 的 stderr 通道，
    // 把"数据问题"和"方法警告"混成一类。
    expect(R_COMMON).toContain('cat(sprintf("DQ_WARN|')
    const dqSection = R_COMMON.slice(R_COMMON.indexOf('r_quality_check <- function'))
    expect(dqSection).not.toContain('warning(')
  })
})

describe('checkDataQuality：干净数据必须返回空数组（防误报）', () => {
  it('真实形状的 5 点李克特数据不产生任何 issue', () => {
    // 20 行、两列 1–5 整数、天然有天花板效应（真实问卷的常见形态）。
    // 这条是本文件的"另一半验收标准"：一个到处报警的质量模块等于没有。
    const rows = makeRows({
      q1: [3, 4, 5, 4, 5, 3, 4, 5, 2, 4, 5, 4, 3, 5, 4, 4, 5, 3, 4, 5],
      q2: [4, 3, 4, 5, 4, 4, 3, 5, 4, 3, 5, 4, 4, 5, 3, 4, 4, 5, 3, 4]
    })
    expect(checkDataQuality(['q1', 'q2'], rows, { likertMax: { q1: 5, q2: 5 } })).toEqual([])
  })

  it('含字符串列的数据不因字符串列报警', () => {
    const rows = makeRows({
      gender: ['男', '女', '男', '女', '男', '女', '男', '女'],
      score: [10, 12, 11, 13, 10, 12, 11, 13]
    })
    expect(checkDataQuality(['gender', 'score'], rows)).toEqual([])
  })

  it('空的 rows 不崩溃也不报警', () => {
    expect(checkDataQuality(['q1'], [])).toEqual([])
  })
})

describe('checkDataQuality：输出结构与顺序稳定', () => {
  it('同一列多个问题按固定顺序输出（outlier → out_of_range → high_missing → constant）', () => {
    // 一列同时触发：极端值（含越界）+ 高缺失
    const rows = makeRows({
      q1: [1, 2, 3, 99, null, null, 4, 5, null, null]
    })
    const issues = checkDataQuality(['q1'], rows, { likertMax: { q1: 5 } })
    const kinds = issues.filter((x) => x.column === 'q1').map((x) => x.kind)
    expect(kinds).toEqual(['outlier', 'out_of_range', 'high_missing'])
  })

  it('列顺序与 headers 顺序一致', () => {
    const rows = makeRows({
      a: [1, 2, 3, 4, 5, 6, 7, 8, 99],
      b: [1, 2, 3, 4, 5, 6, 7, 8, 98]
    })
    const issues = checkDataQuality(['b', 'a'], rows)
    const columns = [...new Set(issues.map((x) => x.column))]
    expect(columns).toEqual(['b', 'a'])
  })
})

describe('quantileType7 与 R 的 stats::quantile(type = 7) 对齐', () => {
  it('小样本手算校验', () => {
    // R: quantile(1:5, c(.25,.5,.75), type=7) = 2, 3, 4
    expect(quantileType7([1, 2, 3, 4, 5], 0.25)).toBeCloseTo(2, 10)
    expect(quantileType7([1, 2, 3, 4, 5], 0.5)).toBeCloseTo(3, 10)
    expect(quantileType7([1, 2, 3, 4, 5], 0.75)).toBeCloseTo(4, 10)
  })

  it('插值：n=4 的 0.25 分位落在第 1、2 个值之间', () => {
    // h = (4-1)*0.25 = 0.75 → 1 + 0.75*(2-1) = 1.75
    expect(quantileType7([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10)
    // h = (4-1)*0.75 = 2.25 → 3 + 0.25*(4-3) = 3.25
    expect(quantileType7([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 10)
  })

  it('IQR 围栏按 type-7 口径：1..20 + 40 的下界 −9、上界 31', () => {
    // R 实算（stats::quantile type=7）：Q1=6、Q3=16、IQR=10
    //   lower = 6 − 1.5×10 = −9；upper = 16 + 1.5×10 = 31
    // 40 > 31 → 越界。这几个数字**由 Rscript 4.6.0 实跑确认**，
    // 不是手算——手算时我曾误按 20 个值取分位（实为 21 个），得到 29.5 的错值。
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 40]
    const outlier = issueOf(checkDataQuality(['v'], makeRows({ v })), 'v', 'outlier')
    expect(outlier!.detail).toContain('[-9, 31]')
  })
})
