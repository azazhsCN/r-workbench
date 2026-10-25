#!/usr/bin/env node
/**
 * T10 前置步骤：把 rService.ts 的**真实生成器**在运行时打包并调用，
 * 把产出的 R 代码 + 配套数据写成 fixtures，供 run_validation.R 独立验证。
 *
 * 为什么必须这样做：v0.2.5 的 run_validation.R 把「参考实现」和「工作台实现」
 * 写成同一段字符串逐字符比较，永远 PASS，零验证效力（F4）。
 * 本脚本保证 R 脚本跑的是 **TypeScript 里真实的生成器输出**，而不是手抄副本。
 *
 * 用法：
 *   node scripts/validate/generate_fixtures.mjs [--src <rService.ts>] [--out <dir>]
 *
 * 输出（默认 scripts/validate/generated/）：
 *   <scenario>.R        rService 生成器产出的 R 脚本
 *   <scenario>.csv      该脚本 read.csv() 所需的数据文件
 *   manifest.txt        <method>|<rfile>|<csvfile>|<描述>
 *   .rservice.bundle.mjs（中间产物，esbuild 打包结果）
 */
import { build } from 'esbuild'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(here, '..', '..')

function argOf(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const srcFile = resolve(argOf('--src', join(PROJECT_ROOT, 'src', 'renderer', 'src', 'services', 'rService.ts')))
const outDir = resolve(argOf('--out', join(here, 'generated')))

if (!existsSync(srcFile)) {
  console.error(`FATAL: rService source not found: ${srcFile}`)
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// ── 1. 用 esbuild 打包 rService.ts（浏览器无关，platform=node 即可）──────────
const bundlePath = join(outDir, '.rservice.bundle.mjs')
await build({
  entryPoints: [srcFile],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: bundlePath,
  logLevel: 'warning',
  alias: {
    '@shared': join(PROJECT_ROOT, 'src', 'shared'),
    '@renderer': join(PROJECT_ROOT, 'src', 'renderer', 'src')
  }
})

const mod = await import(pathToFileURL(bundlePath).href)
const RService = mod.RService
if (!RService) {
  console.error('FATAL: rService.ts 未导出 RService 类')
  process.exit(1)
}

// ── 2. 场景数据（确定性、无随机数，保证 CI 结果稳定）────────────────────────
const NA = ''

const repeat = (arr, n) => Array.from({ length: n }, (_, i) => arr[i % arr.length])

const descriptiveCols = ['mpg', 'diff', '中文列', 'allna']
const descriptiveRows = [
  ['21.0', '-3.5', '5', NA],
  ['22.5', '-1.2', '6', NA],
  ['18.3', '0.0', '7', NA],
  ['30.1', '2.8', '8', NA],
  ['27.4', '-7.1', '9', NA],
  ['15.8', '4.4', '10', NA],
  ['19.2', '-0.9', '11', NA],
  ['24.6', '1.5', '12', NA]
]

// 分组 A 8 行（含 1 个缺失），分组 B 7 行；方差不同 → Welch t
const ttestCols = ['score', 'group']
const ttestRows = [
  ['12.5', 'A'],
  ['14.1', 'A'],
  ['11.8', 'A'],
  ['13.9', 'A'],
  ['12.2', 'A'],
  ['15.3', 'A'],
  ['13.1', 'A'],
  [NA, 'A'],
  ['9.8', 'B'],
  ['10.5', 'B'],
  ['8.9', 'B'],
  ['11.2', 'B'],
  ['10.1', 'B'],
  ['9.4', 'B'],
  ['10.8', 'B']
]

const pairedCols = ['pre', 'post']
const pairedRows = [
  ['20', '18'],
  ['22', '21'],
  ['19', '17'],
  ['24', '22'],
  ['25', '24'],
  ['21', '19'],
  ['23', '22'],
  ['20', '18'],
  ['22', '21'],
  ['26', '23']
]

const oneSampleCols = ['value']
const oneSampleRows = ['48', '52', '47', '55', '50', '46', '53', '49', '51', '54', '50', '45'].map((v) => [v])

const anovaCols = ['dv', 'grp']
const anovaRows = [
  ...['5', '6', '7', '5', '6', '7'].map((v) => [v, 'A']),
  ...['8', '9', '10', '8', '10'].map((v) => [v, 'B']),
  ...['12', '13', '11', '14', '12', '13', '11'].map((v) => [v, 'C']),
  [NA, 'C']
]

const chiCols = ['sex', 'vote']
const chiCells = [
  ['男', 'A', 30],
  ['男', 'B', 20],
  ['男', 'C', 10],
  ['女', 'A', 15],
  ['女', 'B', 25],
  ['女', 'C', 30]
]
const chiRows = chiCells.flatMap(([s, v, n]) => Array.from({ length: n }, () => [s, v]))

const corCols = ['x', 'y']
const corRows = [
  ['10', '21'],
  ['12', '25'],
  ['9', '19'],
  ['14', '29'],
  [NA, '31'],
  ['11', '23'],
  ['13', '27'],
  ['16', '33'],
  ['8', '17'],
  ['17', '35'],
  ['10', '22'],
  ['19', '39']
]

const regCols = ['y', 'x1', 'x2']
const regX1 = [2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23]
// x2 刻意与 x1 低相关（非单调），避免共线性把标准化系数推向 >1 而掩盖实现缺陷
const regX2 = [8, 2, 9, 4, 10, 3, 11, 5, 12, 6, 13, 1, 14, 7, 15]
const regNoise = [0.31, -0.22, 0.47, -0.35, 0.18, -0.44, 0.29, -0.12, 0.38, -0.27, 0.15, -0.41, 0.26, -0.19, 0.34]
const regRows = regX1.map((x1, i) => [(3 + 2 * x1 - 0.5 * regX2[i] + regNoise[i]).toFixed(3), String(x1), String(regX2[i])])

const relCols = ['q1', 'q2', 'q3', 'q4', 'q5']
const relBase = [4, 5, 4, 3, 5, 4, 5, 3, 4, 5, 4, 4]
const relRows = relBase.map((q1, i) => [
  String(q1),
  String([5, 5, 4, 3, 4, 5, 5, 4, 4, 5, 4, 5][i]),
  i === 4 ? NA : String([4, 4, 5, 3, 5, 4, 5, 3, 5, 5, 4, 4][i]),
  String([3, 4, 4, 2, 5, 3, 4, 3, 4, 4, 3, 4][i]),
  String([4, 5, 4, 3, 5, 4, 5, 3, 4, 5, 4, 4][i])
])

const normCols = ['norm', 'skewed']
const normNormal = [-1.83, -1.42, -1.25, -1.01, -0.84, -0.62, -0.51, -0.33, -0.18, -0.05, 0.09, 0.21, 0.38, 0.52, 0.71, 0.94, 1.12, 1.37, 1.61, 1.98]
const normSkewed = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9, 1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 4.0, 5.0, 6.2, 7.8, 9.5, 12.0]
const normRows = normNormal.map((v, i) => [String(v), String(normSkewed[i])])

/**
 * EFA 数据：6 个题项、已知 2 因子结构。
 *
 * 构造方式（确定性，不依赖随机数，保证 fixtures 可复现）：
 *   - 因子 1 驱动 q1-q3（载荷约 0.8）
 *   - 因子 2 驱动 q4-q6（载荷约 0.8）
 *   - 两因子正交，题项带独立噪声
 *
 * 期望结果：Kaiser 准则抽出 2 个因子；q1-q3 归入同一因子、q4-q6 归入另一因子；
 * 且**任一同题项在另一因子上的载荷接近 0**（区分效度的直接证据）。
 *
 * 数据用"确定性三角波 + 相位"生成，避免随机的不可复现性：
 *   f1(i) = sin(2πi/13), f2(i) = cos(2πi/7 + 0.5)
 */
const efaCols = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']
const efaN = 120
const efaRows = Array.from({ length: efaN }, (_, i) => {
  const f1 = Math.sin((2 * Math.PI * i) / 13)
  const f2 = Math.cos((2 * Math.PI * i) / 7 + 0.5)
  // 确定性"噪声"：高频三角波，与两个因子的周期互质，避免共线
  const noise = (k) => 0.45 * Math.sin((2 * Math.PI * i * (k + 3)) / 29 + k)
  const v = (loading, factor, k) => (4 + loading * factor + noise(k)).toFixed(4)
  return [v(0.8, f1, 0), v(0.78, f1, 1), v(0.75, f1, 2), v(0.8, f2, 3), v(0.77, f2, 4), v(0.74, f2, 5)]
})

/**
 * EFA 3 因子数据（9 题项）。
 *
 * 为什么需要它：只有 2 因子数据时，即便实现把因子数硬编码成 2 也照样通过——
 * 测试不具判别力。这份数据要求实现**真正按 Kaiser 准则选出 3 个因子**。
 *   a1-a3 → 因子 1；b1-b3 → 因子 2；c1-c3 → 因子 3
 */
const efa9Cols = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3']
const efa9N = 150
const efa9Rows = Array.from({ length: efa9N }, (_, i) => {
  const f1 = Math.sin((2 * Math.PI * i) / 11)
  const f2 = Math.cos((2 * Math.PI * i) / 7 + 0.3)
  const f3 = Math.sin((2 * Math.PI * i) / 5 + 1.1)
  const noise = (k) => 0.4 * Math.sin((2 * Math.PI * i * (k + 2)) / 31 + k)
  const v = (loading, factor, k) => (4 + loading * factor + noise(k)).toFixed(4)
  return [
    v(0.82, f1, 0), v(0.79, f1, 1), v(0.76, f1, 2),
    v(0.81, f2, 3), v(0.78, f2, 4), v(0.75, f2, 5),
    v(0.8, f3, 6), v(0.77, f3, 7), v(0.74, f3, 8)
  ]
})


// ══════════════════════════════════════════════════════════════════════════
// v0.3.1 新方法 fixtures（CFA / CVI / Harman）
//
// 全部确定性构造，**不使用 runif/rnorm**：验证结果必须在任何机器上逐位复现，
// 否则「oracle 一致」这件事本身就不成立（fixtures 变了，参考值也得跟着变）。
// ══════════════════════════════════════════════════════════════════════════

/** 把确定性序列标准化为 mean 0 / 总体 sd 1（相关矩阵对缩放不敏感）。 */
const standardize = (xs) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
  return xs.map((v) => (v - mean) / sd)
}

/**
 * 确定性伪随机源（线性同余发生器，Numerical Recipes 参数）。
 *
 * 为什么不用 Math.random()：fixtures 必须逐位可复现，否则"oracle 一致"
 * 这件事本身就依赖于运行时刻，无法作为证据。
 * 为什么不用 sin 波（旧做法）：周期 5/7/13 的 sin 序列在 n 维空间里只能
 * 张成极少数几个方向（周期 p 只有 p 个不同取值），12 个向量 Gram-Schmidt
 * 之后必然出现近乎共线的方向 → 相关矩阵奇异/病态，CFA 直接报"接近奇异"。
 * LCG 产生的序列在样本空间里接近满秩，正交化后是良态基。
 */
const makeRng = (seed) => {
  let s = seed >>> 0
  return () => {
    // x_{n+1} = (a x_n + c) mod 2^32
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 确定性正态序列（Box-Muller），仅供构造 fixtures 用。 */
const normalSeq = (n, seed) => {
  const rnd = makeRng(seed)
  const out = []
  while (out.length < n) {
    const u1 = Math.max(rnd(), 1e-12)
    const u2 = rnd()
    const r = Math.sqrt(-2 * Math.log(u1))
    out.push(r * Math.cos(2 * Math.PI * u2))
    if (out.length < n) out.push(r * Math.sin(2 * Math.PI * u2))
  }
  return out.slice(0, n)
}

/**
 * 精确正交化（Gram-Schmidt）：把一组确定性序列变成**样本层面精确**的
 * 均值 0 / 单位范数 / 两两内积 0 的基。
 *
 * 为什么必须精确正交而不是"近似正交"：
 *   只有基精确正交时，样本相关矩阵才**精确等于** ΛΦΛ' + Θ，
 *   于是「估计载荷 ≈ 真值载荷」这条断言才是紧的（否则容差要放到 0.10 以上，
 *   判别力大幅下降）。这一步纯确定性，不引入任何随机数。
 */
const orthonormalize = (vecs) => {
  const out = []
  for (const v of vecs) {
    let w = v.slice()
    for (const q of out) {
      const dot = w.reduce((a, b, i) => a + b * q[i], 0)
      w = w.map((x, i) => x - dot * q[i])
    }
    const norm = Math.sqrt(w.reduce((a, b) => a + b * b, 0))
    out.push(w.map((x) => x / norm))
  }
  return out
}

/**
 * 已知真值的因子数据生成器。
 *   item_j = λ_j · g_group(j) + √(1 − λ_j²) · e_j
 * 其中 {g_1..g_k, e_1..e_p} 是**精确正交**的 n 维单位向量（Gram-Schmidt），
 * g 之间再按目标 Φ 的相关做 Cholesky 线性组合。
 * 于是样本层面 cor(item) = Λ Φ Λ' + Θ **精确成立**，
 * 「载荷恢复误差」断言因此可以是紧的（见 run_validation.R 的 cfa oracle）。
 *
 * **刻意给每列不同的均值与尺度**（模拟 1–7 量表的不同题项）：若不这样做，
 * 原始尺度载荷与标准化载荷在数值上几乎相等，「unstd_load 被误当成 std_load」
 * 这类映射缺陷就不可见——测试将失去判别力。
 *
 * 返回 { cols, rows }；rows 为 4 位小数定长字符串。
 */
const makeFactorData = ({ n, cols, loads, groups, phi, seed = 20260301 }) => {
  const k = Math.max(...groups)
  const p = cols.length
  // 潜在因子方向 + 题项噪声：用确定性伪随机序列，正交化后得到良态基
  const raw = [
    ...Array.from({ length: k }, (_, j) => normalSeq(n, seed + 101 * (j + 1))),
    ...Array.from({ length: p }, (_, j) => normalSeq(n, seed + 7717 * (j + 1)))
  ]
  const basis = orthonormalize(raw)
  const latent = basis.slice(0, k)
  // 正交化后的向量范数为 1（平方和 = 1，即 sd = 1/√n）。因子与噪声都统一
  // 重新缩放到 **样本 sd = 1**，否则 item 的方差会变成
  // λ²·1 + (1−λ²)·(1/n) ≠ 1，观测相关就不再等于 ΛΦΛ'——真值恢复断言随之失效。
  const noise = basis.slice(k).map(standardize)
  // 由 Φ 的 Cholesky 下三角组合出相关的潜在因子（Φ 半正定 → 组合一定合法）
  const L = Array.from({ length: k }, () => Array(k).fill(0))
  for (let a = 0; a < k; a++) {
    for (let b = 0; b <= a; b++) {
      let s = phi(a, b)
      for (let t = 0; t < b; t++) s -= L[a][t] * L[b][t]
      L[a][b] = a === b ? Math.sqrt(s) : s / L[b][b]
    }
  }
  // g 仍精确正交，按 Φ 组合后再标准化 → 互相关精确等于 Φ
  const g = Array.from({ length: k }, (_, a) => {
    const mixed = latent[0].map((_, i) =>
      Array.from({ length: a + 1 }, (_, t) => L[a][t] * latent[t][i]).reduce((x, y) => x + y, 0))
    return standardize(mixed)
  })
  // 每题的均值与尺度（确定性）：均值 3.5–5.2，sd 0.7–1.6
  const itemMean = cols.map((_, j) => 3.5 + 0.28 * j)
  const itemSd = cols.map((_, j) => 0.7 + 0.15 * j)
  const rows = Array.from({ length: n }, (_, i) =>
    cols.map((_, j) => {
      const lam = loads[j]
      const f = g[groups[j] - 1][i]
      const v = lam * f + Math.sqrt(1 - lam * lam) * noise[j][i]
      return (itemMean[j] + itemSd[j] * v).toFixed(4)
    })
  )
  return { cols, rows }
}

/**
 * CFA 2 因子 6 题项（n = 800，真值载荷 0.85/0.80/0.75 | 0.82/0.78/0.72，φ12 = 0.35）。
 * 这组数值与原型实测一致：估计的标准化载荷最大偏差约 0.04，正确模型 CFI 应接近 1。
 */
const cfaData = makeFactorData({
  n: 800,
  cols: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'],
  loads: [0.85, 0.8, 0.75, 0.82, 0.78, 0.72],
  groups: [1, 1, 1, 2, 2, 2],
  phi: (a, b) => (a === b ? 1 : 0.35),
  seed: 20260301
})

/**
 * CFA 3 因子 9 题项（n = 600，φ 分别 0.30 / 0.25 / 0.20）。
 * 存在意义：只有 2 因子数据时，实现把因子数写死成 2 也能通过——测试无判别力。
 */
const cfa3Data = makeFactorData({
  n: 600,
  cols: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'],
  loads: [0.82, 0.79, 0.76, 0.81, 0.78, 0.75, 0.8, 0.77, 0.74],
  groups: [1, 1, 1, 2, 2, 2, 3, 3, 3],
  phi: (a, b) => (a === b ? 1 : [[0, 0.3, 0.25], [0.3, 0, 0.2], [0.25, 0.2, 0]][a][b]),
  seed: 20260399
})

/**
 * CVI 数据：行 = 专家（8 位）、列 = 题项（6 个），1–4 相关性评分。
 * 刻意让 I-CVI 覆盖 1.00 / 0.875 / 0.75 / 0.625 / 0.50 五档，
 * 使 Cicchetti & Sparrow 的四个判读档（优秀 / 良好 / 尚可 / 需修改）都出现，
 * 判据才有判别力。
 * 当专家数 n = 8 时（V031_CONTRACT.md 第二节当前口径：6 ≤ n ≤ 8 → 阈值 0.83）
 *   → A = ceiling(0.83·8) = 7，Pc = C(8,7)/2^8 = 8/256 = 0.03125。
 */
const cviCols = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']
const cviRows = [
  // item1 全评 ≥3，item2 全评 ≥3 → S-CVI/UA = 2/6
  ['4', '3', '4', '4', '4', '4'],
  ['4', '4', '4', '3', '3', '2'],
  ['3', '4', '3', '3', '2', '2'],
  ['4', '3', '4', '2', '2', '3'],
  ['3', '4', '3', '3', '3', '2'],
  ['4', '3', '4', '4', '4', '4'],
  ['4', '4', '4', '2', '3', '3'],
  ['3', '4', '2', '4', '2', '2']
]

/**
 * Harman 两组数据（n = 400，6 题项），用于证明 40% 判据有判别力：
 *   - 中等相关（两个 3 题簇：簇内 r≈0.40、簇间 r≈0.08）→ 首成分约 34%，且 λ>1 的因子 >1
 *   - 高相关（单一强因子，载荷≈0.8 → r≈0.64）→ 首成分约 70%
 * 两组都必须真跑，判据「<40 且因子数>1」才会在两个方向上都被检验。
 */
const harmanN = 400
const harmanCols = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
const harmanMediumRows = (() => {
  // 全局成分 g0（给所有题项一点公共相关）+ 两个簇成分 gA/gB，正交化后互不相关
  const g0v = normalSeq(harmanN, 91001)
  const gAv = normalSeq(harmanN, 91002)
  const gBv = normalSeq(harmanN, 91003)
  const noiseV = harmanCols.map((_, j) => normalSeq(harmanN, 92000 + 13 * j))
  const [g0, gA, gB] = orthonormalize([g0v, gAv, gBv]).map(standardize)
  const noise = orthonormalize(noiseV).map(standardize)
  const col = (j) => {
    const gc = j < 3 ? gA : gB
    return standardize(
      Array.from({ length: harmanN }, (_, i) =>
        Math.sqrt(0.08) * g0[i] + Math.sqrt(0.34) * gc[i] + Math.sqrt(0.58) * noise[j][i])
    )
  }
  const cols = harmanCols.map((_, j) => col(j))
  return Array.from({ length: harmanN }, (_, i) => cols.map((c) => c[i].toFixed(4)))
})()
const harmanHighRows = (() => {
  const g = orthonormalize([normalSeq(harmanN, 93001)]).map(standardize)[0]
  const noise = orthonormalize(harmanCols.map((_, j) => normalSeq(harmanN, 94000 + 17 * j))).map(standardize)
  const lam = [0.84, 0.82, 0.8, 0.79, 0.77, 0.75]
  const cols = harmanCols.map((_, j) =>
    standardize(Array.from({ length: harmanN }, (_, i) =>
      lam[j] * g[i] + Math.sqrt(1 - lam[j] * lam[j]) * noise[j][i]))
  )
  return Array.from({ length: harmanN }, (_, i) => cols.map((c) => c[i].toFixed(4)))
})()

const freqCols = ['edu']
// 注意：R 的 read.csv(blank.lines.skip=TRUE) 会整行丢弃全空行，因此缺失值用
// 字面量 "NA"（read.csv 默认 na.strings="NA" → NA），保证那一行仍然存在。
const freqRows = [
  ...repeat([['本科']], 5),
  ...repeat([['硕士']], 4),
  ...repeat([['博士']], 2),
  ['NA']
]

const sumCols = ['dept', 'salary']
const sumRows = [
  ['A', '10'],
  ['A', '12'],
  ['A', '14'],
  ['B', '20'],
  ['B', '22'],
  ['B', '24'],
  ['B', '26'],
  ['C', '30'],
  ['C', '32'],
  ['D', '40'],
  ['E', NA]
]

// ── 3. 场景定义：每个场景 = 一个生成器调用 + 其数据 ────────────────────────
const scenarios = [
  {
    method: 'descriptive',
    cols: descriptiveCols,
    rows: descriptiveRows,
    desc: '描述性统计（含负值 / 中文列名 / 全缺失列）',
    code: (R, csv) => R.descriptiveCode(['mpg', 'diff', '中文列', 'allna'], csv)
  },
  {
    method: 'ttest_independent',
    cols: ttestCols,
    rows: ttestRows,
    desc: '独立样本 t 检验（不等方差 + 1 个缺失值）',
    code: (R, csv) => R.tTestIndependentCode('score', 'group', csv)
  },
  {
    method: 'ttest_paired',
    cols: pairedCols,
    rows: pairedRows,
    desc: '配对样本 t 检验',
    code: (R, csv) => R.tTestPairedCode('pre', 'post', csv)
  },
  {
    method: 'ttest_one',
    cols: oneSampleCols,
    rows: oneSampleRows,
    desc: '单样本 t 检验（mu = 50）',
    code: (R, csv) => R.tTestOneSampleCode('value', 50, csv)
  },
  {
    method: 'anova',
    cols: anovaCols,
    rows: anovaRows,
    desc: '单因素方差分析（3 组，不等样本量 + 1 个缺失值）',
    code: (R, csv) => R.anovaCode('dv', 'grp', csv)
  },
  {
    method: 'chisquare',
    cols: chiCols,
    rows: chiRows,
    desc: '卡方检验（2×3 列联表）',
    code: (R, csv) => R.chiSquareCode('sex', 'vote', csv)
  },
  {
    method: 'correlation',
    dataset: 'correlation_pearson',
    cols: corCols,
    rows: corRows,
    desc: 'Pearson 相关（1 个缺失值 → 成对删除）',
    code: (R, csv) => R.correlationCode('x', 'y', 'pearson', csv)
  },
  {
    method: 'correlation',
    dataset: 'correlation_spearman',
    cols: corCols,
    rows: corRows,
    desc: 'Spearman 相关（无结点）',
    code: (R, csv) => R.correlationCode('x', 'y', 'spearman', csv)
  },
  {
    method: 'regression',
    cols: regCols,
    rows: regRows,
    desc: '线性回归 y ~ x1 + x2（含 VIF / 标准化系数 / 残差正态性）',
    code: (R, csv) => R.regressionCode('y', ['x1', 'x2'], csv)
  },
  {
    method: 'reliability',
    cols: relCols,
    rows: relRows,
    desc: "Cronbach's α（5 个项目，含 1 个缺失值）",
    code: (R, csv) => R.reliabilityCode(['q1', 'q2', 'q3', 'q4', 'q5'], csv)
  },
  {
    method: 'efa',
    cols: efaCols,
    rows: efaRows,
    desc: '探索性因子分析（6 题项、已知 2 因子结构、纯 base R 实现）',
    code: (R, csv) => R.efaCode(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'], undefined, csv)
  },
  {
    method: 'efa',
    dataset: 'efa_3factors',
    cols: efa9Cols,
    rows: efa9Rows,
    desc: '探索性因子分析（9 题项、已知 3 因子结构 —— 用于验证因子数不是碰巧等于 2）',
    code: (R, csv) => R.efaCode(['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'], undefined, csv)
  },
  {
    method: 'normality',
    cols: normCols,
    rows: normRows,
    desc: 'Shapiro-Wilk（1 个近似正态变量 + 1 个强偏态变量）',
    code: (R, csv) => R.normalityTestCode(['norm', 'skewed'], csv)
  },
  {
    method: 'nonparametric',
    cols: ttestCols,
    rows: ttestRows,
    desc: 'Mann-Whitney U（与独立样本 t 同一数据）',
    code: (R, csv) => R.nonparametricCode('score', 'group', csv)
  },
  {
    method: 'frequency',
    cols: freqCols,
    rows: freqRows,
    desc: '频数统计（含空值与字面量 "NA"）',
    code: (R, csv) => R.frequencyCode(['edu'], csv)
  },
  {
    method: 'summary_by',
    cols: sumCols,
    rows: sumRows,
    desc: '分类汇总（含 n=1 组与缺失值）',
    code: (R, csv) => R.summaryByCode('dept', 'salary', csv)
  },

  // ── v0.3.1：CFA / CVI / Harman ──────────────────────────────────────────
  {
    method: 'cfa',
    cols: cfaData.cols,
    rows: cfaData.rows,
    desc: 'CFA（6 题项、已知 2 因子真值载荷 + φ12 = 0.35、n = 800、纯 base R）',
    code: (R, csv) => R.cfaCode(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'], undefined, csv)
  },
  {
    method: 'cfa',
    dataset: 'cfa_3factors',
    cols: cfa3Data.cols,
    rows: cfa3Data.rows,
    desc: 'CFA（9 题项、已知 3 因子结构、n = 600 —— 用于验证因子数不是碰巧等于 2）',
    code: (R, csv) => R.cfaCode(['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'], 3, csv)
  },
  {
    method: 'cfa',
    dataset: 'cfa_misfit',
    // 与 cfa 同一份 2 因子数据，但**强制拟合成 1 因子**：
    // 判别力证据——误设模型的 CFI 必须显著低于正确模型（原型实测 0.6266 vs 1.0000）。
    cols: cfaData.cols,
    rows: cfaData.rows,
    desc: 'CFA 失配模型（真 2 因子数据强制 1 因子 —— 判别力证据，CFI 须显著下降）',
    code: (R, csv) => R.cfaCode(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'], 1, csv)
  },
  {
    method: 'cvi',
    cols: cviCols,
    rows: cviRows,
    desc: 'CVI（8 位专家 × 6 题项，I-CVI 覆盖 1.00/0.875/0.75/0.625/0.50 五档）',
    code: (R, csv) => R.cviCode(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], csv)
  },
  {
    method: 'harman',
    dataset: 'harman_medium',
    cols: harmanCols,
    rows: harmanMediumRows,
    desc: 'Harman（中等相关：两个 3 题簇，首成分应 < 40% 且 λ>1 的因子 > 1）',
    code: (R, csv) => R.harmanCode(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], csv)
  },
  {
    method: 'harman',
    dataset: 'harman_high',
    cols: harmanCols,
    rows: harmanHighRows,
    desc: 'Harman（单一强因子：载荷≈0.8，首成分应 > 40% —— 判据反向证明）',
    code: (R, csv) => R.harmanCode(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], csv)
  }
]

const manifest = []
for (const sc of scenarios) {
  const dataset = sc.dataset || sc.method
  const csvName = `${dataset}.csv`
  const rName = `${dataset}.R`
  const csv = [sc.cols.join(','), ...sc.rows.map((r) => r.map((v) => (v === NA || v === null || v === undefined ? '' : String(v))).join(','))].join('\n') + '\n'
  writeFileSync(join(outDir, csvName), csv, 'utf8')
  const code = sc.code(RService, csvName)
  if (typeof code !== 'string' || code.trim().length === 0) {
    console.error(`FATAL: 生成器 ${sc.method} 未返回代码`)
    process.exit(1)
  }
  writeFileSync(join(outDir, rName), code, 'utf8')
  manifest.push(`${sc.method}|${dataset}|${rName}|${csvName}|${sc.desc}`)
}

writeFileSync(join(outDir, 'manifest.txt'), manifest.join('\n') + '\n', 'utf8')

// 只删中间产物，保留 fixtures（CI 需要 Rscript 读取它们）
rmSync(bundlePath, { force: true })

const uniqueMethods = new Set(scenarios.map((s) => s.method))
console.log(`生成的 fixtures：${scenarios.length} 个场景，覆盖 ${uniqueMethods.size} 个方法 → ${outDir}`)
