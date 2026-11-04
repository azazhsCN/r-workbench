/**
 * v0.3.4 新增两个方法的 fixture 数据（确定性构造）
 *
 * 放在单独文件里是为了不把 generate_fixtures.mjs 继续撑大（已 1300+ 行）。
 * 所有数据用固定种子 + Box-Muller 生成，可复现。
 */

/** 简单 LCG，与 generate_fixtures.mjs 内的实现同构 */
function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 标准正态，Box-Muller */
function gaussSeq(n, seed) {
  const r = lcg(seed)
  const out = []
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(r(), 1e-12)
    const u2 = r()
    out.push(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2))
  }
  return out
}

/**
 * 层次回归 fixture。
 *
 * 设计：4 个自变量分 3 个区块，真实贡献**递减**，便于验证 ΔR² 的顺序：
 *   - 区块 1（x1,x2）：贡献大（b = 0.6 / 0.5）
 *   - 区块 2（x3）  ：贡献中（b = 0.3）
 *   - 区块 3（x4）  ：贡献几乎为 0（b = 0.02）→ 该块的 ΔF 应不显著
 *
 * 这样验证的不只是"能算出 ΔR²"，而是"**不能显著的地方确实不显著**"——
 * 反例比正例更能证明实现是对的。
 */
export const hierCols = ['y', 'x1', 'x2', 'x3', 'x4']
export const hierRows = (() => {
  const n = 400
  const [zx1, zx2, zx3, zx4, ze] = [
    gaussSeq(n, 20261601),
    gaussSeq(n, 20261602),
    gaussSeq(n, 20261603),
    gaussSeq(n, 20261604),
    gaussSeq(n, 20261605)
  ]
  const rows = []
  for (let i = 0; i < n; i++) {
    const y = 0.6 * zx1[i] + 0.5 * zx2[i] + 0.3 * zx3[i] + 0.02 * zx4[i] + ze[i]
    rows.push([
      Number(y.toFixed(6)),
      Number(zx1[i].toFixed(6)),
      Number(zx2[i].toFixed(6)),
      Number(zx3[i].toFixed(6)),
      Number(zx4[i].toFixed(6))
    ])
  }
  return rows
})()

/**
 * 二元 Logistic fixture。
 *
 * 真实模型：logit(p) = -0.5 + 1.2·x1 - 0.8·x2
 * 这两个系数是**已知真值**，用来断言恢复精度（类似中介/调节的做法）。
 */
export const logitBinCols = ['y', 'x1', 'x2']
export const logitBinRows = (() => {
  const n = 600
  const x1 = gaussSeq(n, 20261701)
  const x2 = gaussSeq(n, 20261702)
  const ru = lcg(20261703)
  const rows = []
  for (let i = 0; i < n; i++) {
    const lp = -0.5 + 1.2 * x1[i] - 0.8 * x2[i]
    const p = 1 / (1 + Math.exp(-lp))
    const y = ru() < p ? 1 : 0
    rows.push([y, Number(x1[i].toFixed(6)), Number(x2[i].toFixed(6))])
  }
  return rows
})()

/**
 * 有序 Logistic fixture（3 类）。
 *
 * 真实模型：潜变量 eta = 0.9·x1 - 0.6·x2 + noise，阈值 -0.8 / 0.9。
 * 加噪声是为了避免"完全分离"（完全分离会让系数发散，那不是好 fixture）。
 */
export const logitOrdCols = ['y', 'x1', 'x2']
export const logitOrdRows = (() => {
  const n = 600
  const x1 = gaussSeq(n, 20261801)
  const x2 = gaussSeq(n, 20261802)
  const noise = gaussSeq(n, 20261803)
  const rows = []
  for (let i = 0; i < n; i++) {
    const eta = 0.9 * x1[i] - 0.6 * x2[i] + noise[i]
    const y = eta < -0.8 ? 1 : eta < 0.9 ? 2 : 3
    rows.push([y, Number(x1[i].toFixed(6)), Number(x2[i].toFixed(6))])
  }
  return rows
})()
