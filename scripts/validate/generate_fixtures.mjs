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
