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
 * 精确正交化：中心化 → Gram-Schmidt → 标准化到样本 sd = 1。
 *
 * ⚠️ 标准化这一步必须用 **sd()（n−1 定义）**，不能用向量范数：
 *   Gram-Schmidt 后向量范数为 1（平方和 = 1，即 sd = 1/√n·√(n/(n−1)) ≈ 1/√n），
 *   若不重新缩放到 sd=1，后续 `a0*zx + √(1−a0²)*e1` 的方差就不是 1，
 *   真值系数会整体被 √n 缩放——v0.3.2 开发时正是踩了这个坑（a 算出 1.166 而非 0.5）。
 */
const orthonormalize = (vecs) => {
  const out = []
  for (const raw of vecs) {
    // 中心化（不是标准化）：后续投影用内积做，此时向量范数为 √n 量级
    let w = raw.map((v) => v - raw.reduce((a, b) => a + b, 0) / raw.length)
    // 对**所有**已正交化的前序向量投影并扣除。
    // ⚠️ 投影必须用 `dot / ‖q‖²`，而不是 `dot`：out 里存的是 sd=1 的向量，
    //   其平方和为 n（不是 1）。写成 `x - dot*q` 会过冲，把 w 变成负向的
    //   近似反向向量 —— 这正是 v0.3.2 开发时 cor(zx,e1) 高达 0.996 的原因，
    //   也是「正交化看起来做了、实际没做」的隐蔽失效（比不做更危险）。
    for (const q of out) {
      const dot = w.reduce((a, b, i) => a + b * q[i], 0)
      const q2 = q.reduce((a, b) => a + b * b, 0)
      w = w.map((x, i) => x - (dot / q2) * q[i])
    }
    out.push(standardize(w))
  }
  return out
}

/**
 * 生成「精确已知真值」的因果链数据（中介 / 调节 / 路径分析共用）。
 *
 * 关键设计：直接构造**标准化形态** z_x, z_m, z_y，再乘回目标尺度。
 *   z_x = 基向量（sd=1）
 *   z_m = a0·z_x + √(1−a0²)·e1          （e1 ⊥ z_x, sd=1）
 *   z_y = u·z_x + v·z_m + r·e2          （e2 ⊥ {z_x, z_m}, sd=1）
 * 于是对观测列 X = mx + sx·z_x, M = mm + sm·z_m, Y = my + sy·z_y 做 OLS：
 *   a  = sm·a0/sx        ⇒ a0 = A·sx/sm
 *   b  = sy·v/sm         ⇒ v  = B·sm/sy
 *   c' = sy·u/sx         ⇒ u  = CP·sx/sy
 * 全部**代数精确**，样本层面误差仅来自 4 位小数舍入（实测 < 1e-4）。
 *
 * 为什么不能用「各列吃自己的基向量」：那样 X 与 M 互不相关，a 恒为 0
 * （v0.3.2 开发时的第一个 bug）。
 */
const makeMediationData = ({ n, A, B, CP, sx, sm, sy, seed, ySe = 0.7 }) => {
  const basis = orthonormalize([
    normalSeq(n, seed),
    normalSeq(n, seed + 101),
    normalSeq(n, seed + 202)
  ])
  const zx = basis[0]
  // 先构造 M 的标准化形态 z_m，再**重新标准化**到 sd=1。
  // ⚠️ 必须重新标准化：`a0·z_x + √(1−a0²)·e1` 看似方差为 1，
  // 但 e1 是"正交化后已中心化"的向量，且样本 cor(z_x,e1) 不是精确 0
  // （只剩 1e-17 量级，但 sd 会受影响）——实测 sd=1.399 而非 1。
  // 不重新标准化会让 a 被整体放大约 2.3 倍（实测 1.166 vs 期望 0.5）。
  const a0raw = (A * sx) / sm
  const zmRaw = zx.map((v, i) => a0raw * v + Math.sqrt(Math.max(1 - a0raw * a0raw, 1e-10)) * basis[1][i])
  const zm = standardize(zmRaw)
  // zm 与 zx 的真实样本相关（因重新标准化而与 a0raw 略有差异）
  const rho = zx.reduce((a, b, i) => a + b * zm[i], 0) / n
  // Y 的标准化形态：
  //   b  = sy·v/sm（v 为 z_y 对 z_m 的偏系数）⇒ v = B·sm/sy
  //   c' = sy·u'/sx，其中 u' 是"控制 z_m 后 z_x 的偏系数"
  // 由于 z_x 与 z_m 相关 rho，若直接写 z_y = u·z_x + v·z_m，
  // 则 u 是**原始系数**而非偏系数。要得到指定偏系数，需用正交分解：
  //   z_x = rho·z_m + √(1−rho²)·xOrth  （xOrth ⊥ z_m）
  //   z_y = P·xOrth + Q·z_m + r·e2
  // 此时偏系数：对 z_x 为 P/√(1−rho²)，对 z_m 为 Q − P·rho/√(1−rho²)
  // 反解令偏系数 = (uTarget, vTarget)：
  //   P = uTarget·√(1−rho²)
  //   Q = vTarget + uTarget·rho
  const uTarget = (CP * sx) / sy
  const vTarget = (B * sm) / sy
  const s = Math.sqrt(Math.max(1 - rho * rho, 1e-12))
  const P = uTarget * s
  const Q = vTarget + uTarget * rho
  const xOrth = standardize(zx.map((v, i) => v - rho * zm[i]))
  const e2 = (() => {
    let w = basis[2].slice()
    for (const q of [xOrth, zm]) {
      const dot = w.reduce((a, b, i) => a + b * q[i], 0)
      w = w.map((x, i) => x - dot * q[i])
    }
    return standardize(w)
  })()
  const X = zx.map((z) => 4.0 + sx * z)
  const M = zm.map((z) => 3.0 + sm * z)
  const Y = zx.map((z, i) => 2.5 + sy * (P * xOrth[i] + Q * zm[i] + ySe * e2[i]))
  return X.map((x, i) => [x.toFixed(4), M[i].toFixed(4), Y[i].toFixed(4)])
}

/**
 * 由「原始尺度目标系数」反解「标准化形态的系数」。保留给需要手算的 oracle 参考。
 */
const medScale = (A, B, CP, sx, sm, sy) => {
  const a0 = (A * sx) / sm
  const b0 = (B * sm) / sy
  const c1 = (CP * sx) / sy
  return { a0, b0, c1 }
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

// ══════════════════════════════════════════════════════════════════════════
// v0.3.2 因果链方法 fixtures（mediation / moderation / moderated mediation /
// path analysis / SEM）
//
// 与 v0.3.1 相同的铁律：**全部确定性构造**，不用 rnorm/runif。
// 手法：固定种子 LCG + Box-Muller 造序列，再用 Gram-Schmidt 精确正交化。
// 正交化的意义在因果链方法里更关键：只有「预测项」与「残差」在样本层面
// 精确正交，OLS 系数才精确等于数据生成时的真值（否则真值恢复断言只能放宽）。
// ══════════════════════════════════════════════════════════════════════════

/**
 * 中介效应数据（n = 300，真值 a = .5, b = .6, c' = .2）。
 *   M = 0.5 X + e1
 *   Y = 0.2 X + 0.6 M + e2
 * 于是 c_total = c' + a*b = 0.2 + 0.3 = 0.5（恒等式自动成立）。
 * 残差 sd 取 1：保证信噪比合理、Bootstrap CI 稳定。
 *
 * 真值对应的期望：indirect = .30，direct = .20，total = .50，prop_mediated = .60。
 */
const medN = 300
const medCols = ['x', 'm', 'y']
// 真值：a=.5 b=.6 c'=.2 ⇒ indirect=.30 total=.50 prop=.60
const medRows = makeMediationData({
  n: medN,
  A: 0.5,
  B: 0.6,
  CP: 0.2,
  sx: 1.2,
  sm: 1.0,
  sy: 1.1,
  seed: 20260801
})

/**
 * 无中介数据（真值 a*b = 0）—— 判别力证据。
 *   M = 0.5 X + e1        （a = .5，仍然存在）
 *   Y = 0.5 X + 0*M + e2  （b = 0！间接效应恒为 0）
 * 这条数据的关键：a 显著、c' 显著，但 b 不显著 ⇒ indirect 的 CI 必须跨 0。
 * 若实现把 direct 误当 indirect，或无条件报告"中介成立"，这里会红。
 */
const medNullRows = makeMediationData({
  n: medN,
  A: 0.5,
  B: 0.0,
  CP: 0.5,
  sx: 1.2,
  sm: 1.0,
  sy: 1.1,
  seed: 20260899
})

/**
 * 让残差对一组**回归项**正交（Gram-Schmidt 投影后标准化到 sd=1）。
 *
 * 为什么必须做：OLS 的系数只有在残差与全部回归项样本正交时才**精确**等于
 * 生成时的系数。否则残差里那一点相关会被吸收进系数，真值就变成"大约"而不是
 * "精确"，断言容差被迫放宽、判别力下降。
 * 在调节/有调节的中介里，回归项包含乘积项 X·W —— 它天然与 X、W 相关，
 * 所以残差必须对 {X_c, W_c, X_c·W_c} **三者**正交，而不只是对 X、W。
 * （v0.3.2 开发时只对 X、W 正交化，导致 b3 算出 0.475 而非 0.500。）
 */
const orthogonalResidual = (raw, regressors) => {
  const n = raw.length
  let w = raw.map((v) => v - raw.reduce((a, b) => a + b, 0) / n)
  for (const q of regressors) {
    const qc = q.map((v) => v - q.reduce((a, b) => a + b, 0) / n)
    const dot = w.reduce((a, b, i) => a + b * qc[i], 0)
    const q2 = qc.reduce((a, b) => a + b * b, 0)
    if (q2 > 1e-12) w = w.map((x, i) => x - (dot / q2) * qc[i])
  }
  return standardize(w)
}

/** 居中的乘积项（交互项的正确形式：先中心化再相乘）。 */
const productOf = (a, b) => {
  const ma = a.reduce((x, y) => x + y, 0) / a.length
  const mb = b.reduce((x, y) => x + y, 0) / b.length
  return a.map((v, i) => (v - ma) * (b[i] - mb))
}

/**
 * 调节效应数据（n = 400，真值 b1 = .3, b2 = .4, b3 = .5）。
 *   Y = 0.3·Xc + 0.4·Wc + 0.5·(Xc·Wc) + e
 * 残差对 {Xc, Wc, Xc·Wc} **三者**正交 ⇒ 三个系数都精确恢复。
 * X 与 W 在样本层面精确不相关（cor ≈ 1e-6），这使得"中心化不改变交互项"
 * 这一性质的验证最干净。
 */
const modN = 400
const modCols = ['x', 'w', 'y']
const modRows = (() => {
  const basis = orthonormalize([
    normalSeq(modN, 20260901),
    normalSeq(modN, 20260902),
    normalSeq(modN, 20260903)
  ])
  const X = basis[0].map((v) => 4.0 + 1.2 * v)
  const W = basis[1].map((v) => 3.5 + 1.4 * v)
  const Xc = X.map((v) => v - 4.0)
  const Wc = W.map((v) => v - 3.5)
  const XW = productOf(X, W)
  const e = orthogonalResidual(basis[2], [Xc, Wc, XW])
  const Y = X.map((_, i) => 2.0 + 0.3 * Xc[i] + 0.4 * Wc[i] + 0.5 * XW[i] + 1.0 * e[i])
  return X.map((v, i) => [v.toFixed(4), W[i].toFixed(4), Y[i].toFixed(4)])
})()

/**
 * 无调节数据（真值 b3 = 0）—— 判别力证据。
 *   Y = 0.3·Xc + 0.4·Wc + 0·(Xc·Wc) + e
 * 交互项系数真值为 0 ⇒ p 必须 > .05，ΔR² 必须接近 0。
 * 若实现无条件报告"调节成立"，或把主效应误当交互项，这里会红。
 */
const modNullRows = (() => {
  const basis = orthonormalize([
    normalSeq(modN, 20260911),
    normalSeq(modN, 20260912),
    normalSeq(modN, 20260913)
  ])
  const X = basis[0].map((v) => 4.0 + 1.2 * v)
  const W = basis[1].map((v) => 3.5 + 1.4 * v)
  const Xc = X.map((v) => v - 4.0)
  const Wc = W.map((v) => v - 3.5)
  const XW = productOf(X, W)
  const e = orthogonalResidual(basis[2], [Xc, Wc, XW])
  const Y = X.map((_, i) => 2.0 + 0.3 * Xc[i] + 0.4 * Wc[i] + 0.0 * XW[i] + 1.0 * e[i])
  return X.map((v, i) => [v.toFixed(4), W[i].toFixed(4), Y[i].toFixed(4)])
})()

/**
 * 有调节的中介数据（n = 350）。
 *   M = 0.4·Xc + 0.2·Wc + 0.3·(Xc·Wc) + e1     ← a2 = .4, a4 = .3（W 调节前半段）
 *   Y = 0.25·Xc + 0.5·Mc + e2                  ← b = .5
 * index of moderated mediation = a4 * b = .3 * .5 = .15
 * 条件间接效应 = (a2 + a4·W_c) * b，W_c 取 mean±1SD：
 *   W = mean−1SD → (.4 + .3·(−1.4))·.5 = −0.010
 *   W = mean     →  .4·.5              =  0.200
 *   W = mean+1SD → (.4 + .3·1.4)·.5    =  0.410
 * 三者明显不同 —— 若实现把条件间接效应当成常数，这里会红。
 */
const mmN = 350
const mmCols = ['x', 'm', 'y', 'w']
const mmRows = (() => {
  const basis = orthonormalize([
    normalSeq(mmN, 20261001),
    normalSeq(mmN, 20261002),
    normalSeq(mmN, 20261003),
    normalSeq(mmN, 20261004)
  ])
  const X = basis[0].map((v) => 4.0 + 1.1 * v)
  const W = basis[1].map((v) => 4.0 + 1.4 * v)
  const Xc = X.map((v) => v - 4.0)
  const Wc = W.map((v) => v - 4.0)
  const XW = productOf(X, W)
  // 第一个方程的残差：对 {Xc, Wc, XW} 三者正交 ⇒ a2/a4 精确
  const e1 = orthogonalResidual(basis[2], [Xc, Wc, XW])
  const M = X.map((_, i) => 3.0 + 0.4 * Xc[i] + 0.2 * Wc[i] + 0.3 * XW[i] + 1.0 * e1[i])
  const Mc = M.map((v) => v - 3.0)
  // 第二个方程：Y = .25 Xc + .5 Mc + e2，残差对 {Xc, Mc} 正交 ⇒ c'/b 精确
  const e2 = orthogonalResidual(basis[3], [Xc, Mc])
  const Y = X.map((_, i) => 2.5 + 0.25 * Xc[i] + 0.5 * Mc[i] + 1.0 * e2[i])
  return X.map((v, i) => [v.toFixed(4), M[i].toFixed(4), Y[i].toFixed(4), W[i].toFixed(4)])
})()

/**
 * 路径分析数据（n = 400）。
 *   M = 0.5 X + e1
 *   Y = 0.2 X + 0.6 M + e2
 * 路径规格 "X > M, M > Y, X > Y"，于是：
 *   direct(X→Y) = .2；indirect(X→Y) = .5 * .6 = .3；total = .5
 * 这组数据同时含**直接边与中介通路**，是效应分解最容易写错的情形
 * （把 total 写成 direct，或漏掉 indirect，都会红）。
 */
const pathCols = ['x', 'm', 'y']
const pathRows = makeMediationData({
  n: 400,
  A: 0.5,
  B: 0.6,
  CP: 0.2,
  sx: 1.2,
  sm: 1.0,
  sy: 1.1,
  seed: 20261101
})

/**
 * SEM 数据（n = 600，2 潜变量 × 3 指标，结构路径 γ 真值 0.5）。
 *   η1 = ζ1                       （外生，方差 1）
 *   η2 = 0.5 η1 + ζ2              （内生，Var(ζ2) = 1 − 0.25 = 0.75 → 潜变量方差为 1）
 *   x1..x3 指标 η1，载荷 .80/.75/.70
 *   y1..y3 指标 η2，载荷 .82/.76/.71
 * 指标 = λ·η + √(1−λ²)·e，且 e 与 η 精确正交 ⇒ 相关阵精确等于 ΛΦΛ' + Θ。
 */
const semCols = ['x1', 'x2', 'x3', 'y1', 'y2', 'y3']
const semN = 600

/**
 * 生成 2 潜变量 × 3 指标的 SEM 观测数据。
 * @param gamma 结构路径 η2 ← η1 的真值（0 表示两因子正交，用于判别力对照）
 */
const makeSemData = ({ n, gamma, seed }) => {
  const lamX = [0.8, 0.75, 0.7]
  const lamY = [0.82, 0.76, 0.71]
  const basis = orthonormalize([
    normalSeq(n, seed),       // ζ1
    normalSeq(n, seed + 101), // ζ2
    ...Array.from({ length: 6 }, (_, j) => normalSeq(n, seed + 211 + 97 * j))
  ]).map(standardize)
  const z1 = basis[0]
  // η2 = γ·η1 + √(1−γ²)·ζ2，使 Var(η2)=1（潜变量标准化识别法）
  const eta2 = standardize(z1.map((v, i) => gamma * v + Math.sqrt(Math.max(1 - gamma * gamma, 0)) * basis[1][i]))
  const eta1 = z1
  const e1 = basis.slice(2, 5)
  const e2 = basis.slice(5, 8)
  // 每列不同均值/尺度（防止 std_load 与 unstd_load 恒等的缺陷被掩盖，同 v0.3.1 教训）
  const col = (lam, eta, e, j, meanBase) => {
    const mean = meanBase + 0.25 * j
    const sd = 0.8 + 0.1 * j
    return Array.from({ length: n }, (_, i) =>
      (mean + sd * (lam * eta[i] + Math.sqrt(1 - lam * lam) * e[j][i])).toFixed(4))
  }
  const cols = [
    col(lamX[0], eta1, e1, 0, 3.5), col(lamX[1], eta1, e1, 1, 3.5), col(lamX[2], eta1, e1, 2, 3.5),
    col(lamY[0], eta2, e2, 0, 3.2), col(lamY[1], eta2, e2, 1, 3.2), col(lamY[2], eta2, e2, 2, 3.2)
  ]
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]))
}

const semRows = makeSemData({ n: semN, gamma: 0.5, seed: 20261201 })

/**
 * SEM 无结构路径数据（真值 γ = 0）—— 判别力证据。
 *
 * 为什么不用"结构规格留空"来构造：`sem.ts` 生成器对空结构会**正确地** stop()
 * 并提示"若只想检验测量模型请用 CFA"——那个行为是对的（SEM 无结构路径就是 CFA），
 * 让它跑反而误导用户。因此这里改为：**结构规格照常给 `F1 > F2`，
 * 但数据本身两因子正交（γ=0）**。于是：
 *   - 实现能正常跑（有合法结构路径）
 *   - 真值 γ=0 ⇒ 结构路径估计应接近 0 且不显著（p > .05）
 *   - 与 `sem` 场景（γ=.5、p=1.6e-34）形成**双向判别力**：
 *     有路径时显著、无路径时不显著。只验一个方向排除不了"判据恒真/恒假"。
 */
const semNullRows = makeSemData({ n: semN, gamma: 0.0, seed: 20261399 })

void semCols

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
  },

  // ── v0.3.2：因果链五方法 ────────────────────────────────────────────────
  {
    method: 'mediation',
    cols: medCols,
    rows: medRows,
    desc: '中介效应（n=300，真值 a=.5 b=.6 c\'=.2 ⇒ indirect=.30 total=.50，确定性正交数据）',
    code: (R, csv) => R.mediationCode('x', 'm', 'y', csv)
  },
  {
    method: 'mediation',
    dataset: 'mediation_null',
    cols: medCols,
    rows: medNullRows,
    desc: '无中介（真值 b=0 ⇒ indirect≡0 —— 判别力证据：CI 必须跨 0）',
    code: (R, csv) => R.mediationCode('x', 'm', 'y', csv)
  },
  {
    method: 'moderation',
    cols: modCols,
    rows: modRows,
    desc: '调节效应（n=400，真值 b1=.3 b2=.4 b3=.5，X 与 W 样本层面精确正交）',
    code: (R, csv) => R.moderationCode('x', 'w', 'y', csv)
  },
  {
    method: 'moderation',
    dataset: 'moderation_null',
    cols: modCols,
    rows: modNullRows,
    desc: '无调节（真值 b3=0 —— 判别力证据：交互项 p 必须 > .05、ΔR²≈0）',
    code: (R, csv) => R.moderationCode('x', 'w', 'y', csv)
  },
  {
    method: 'moderated_mediation',
    cols: mmCols,
    rows: mmRows,
    desc: '有调节的中介（n=350，a2=.4 a4=.3 b=.5 ⇒ index=.15，三水平条件间接效应各不相同）',
    code: (R, csv) => R.moderatedMediationCode('x', 'm', 'y', 'w', csv)
  },
  {
    method: 'path_analysis',
    cols: pathCols,
    rows: pathRows,
    desc: '路径分析（X>M, M>Y, X>Y；直接边 .2 与中介通路 .3 并存，效应分解易错点）',
    code: (R, csv) => R.pathAnalysisCode(['x', 'm', 'y'], 'x > m, m > y, x > y', csv)
  },
  {
    method: 'sem',
    cols: semCols,
    rows: semRows,
    desc: 'SEM（n=600，2 潜变量 × 3 指标，结构路径 γ=.5，载荷 .80/.75/.70 与 .82/.76/.71）',
    code: (R, csv) =>
      R.semCode({ F1: ['x1', 'x2', 'x3'], F2: ['y1', 'y2', 'y3'] }, 'F1 > F2', csv)
  },
  {
    method: 'sem',
    dataset: 'sem_null',
    // 结构规格照常给 `F1 > F2`，但**数据本身两因子正交（γ=0）**。
    // 判别力：有路径时结构系数显著（sem 场景 p=1.6e-34），无路径时 p > .05。
    // 不用"结构规格留空"是因为生成器对空结构会正确 stop()（SEM 无路径即 CFA）。
    cols: semCols,
    rows: semNullRows,
    desc: 'SEM 无结构路径数据（γ 真值=0，结构规格仍为 F1>F2 —— 判别力证据：p 须 > .05）',
    code: (R, csv) =>
      R.semCode({ F1: ['x1', 'x2', 'x3'], F2: ['y1', 'y2', 'y3'] }, 'F1 > F2', csv)
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
