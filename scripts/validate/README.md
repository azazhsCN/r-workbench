# 统计正确性验证（Statistical Correctness Validation）

本目录提供 R Workbench 统计实现的**可复现、可失败**的验证。

> 历史说明：v0.2.5 的 `run_validation.R` 把「参考实现」与「工作台实现」写成同一段字符串
> 逐字符比较（14 处），因此**永远 PASS 且不测试任何产品代码**；脚本结尾也只 `cat()` 汇总，
> 即使 `PASS: 0 / 33` 仍退出 0，CI 永远绿灯（规划文档 F4 + F7）。
> 该实现已被完全替换，README 第 5 节的旧声明不再成立。

## 1. 验证思路

```
rService.ts（被测产品代码）
      │  node scripts/validate/generate_fixtures.mjs （esbuild 打包 → 运行时调用真实生成器）
      ▼
scripts/validate/generated/<dataset>.R + <dataset>.csv + manifest.txt
      │  Rscript scripts/validate/run_validation.R （执行真实生成的 R 代码并捕获 stdout/stderr）
      ▼
与**独立 oracle** 比较 → 任一 FAIL → quit(status = 1)
```

要点：

1. **被测对象是产品代码本身。** R 代码由 `rService.ts` 的真实生成器在运行时产出，
   不是手抄副本；生成器改动后验证自动跟随（无需维护两份 R 代码）。
2. **oracle 与被测实现来源不同。** 每种方法至少一条独立路径：手算闭式解、精确零分布枚举、
   蒙特卡洛置换分布、或第二个独立 R 包（`psych::alpha`，可选）。
3. **验证脚本能失败。** 存在任何 FAIL 时 `quit(status = 1)`；同时捕获 R 的
   `arguments not used by format`（sprintf 格式符与参数数量不匹配 → 字段被静默丢弃），
   这类缺陷在应用内不可见（stderr 被丢弃）。

## 2. 环境要求

- Node.js（用于 esbuild 打包 `rService.ts`；`npm ci` 即可）
- R >= 4.2（建议 4.4+），**仅需 base R**
- 可选：`psych`（信度分析的第二个独立实现）。默认缺失只记 SKIP；设置
  `RWB_REQUIRE_PSYCH=1` 时缺失判为 FAIL。

## 3. 运行

```bash
# 项目根目录
Rscript scripts/validate/run_validation.R
# 等价写法（npm script）
npm run validate:stat
```

脚本会自行调用 `generate_fixtures.mjs` 重新生成 fixtures（`--no-regenerate` 可跳过），
逐条打印断言，并写出 `VALIDATION_RESULTS.md`（路径基于脚本自身位置，不依赖 cwd）。

手动只跑生成器：

```bash
node scripts/validate/generate_fixtures.mjs --src <rService.ts> --out <dir>
Rscript scripts/validate/run_validation.R --generated <dir> --no-regenerate
```

`--src` / `--out` 也可用于**变异测试**：复制一份 `rService.ts` 做故意改动后跑验证，
脚本必须变红且退出码非 0（见第 6 节）。

## 4. oracle 一览（17 个方法）

| # | 方法 | fixtures 数据 | oracle（独立来源） |
|---|------|--------------|-------------------|
| 1 | 描述性统计 | 含负值 / 中文列名 / 全缺失列 | 逐列手算 mean/sd/min/max/median |
| 2 | 独立样本 t 检验 | 不等方差 + 缺失值 | Welch t 手算闭式解（t、df、p、CI、Cohen's d、合并方差 p） |
| 3 | 配对样本 t 检验 | 前后测各 10 例 | 对差值手算单样本 t |
| 4 | 单样本 t 检验 | mu = 50 | 手算 t / CI / Cohen's d |
| 5 | 单因素方差分析 | 3 组、不等样本量 | SS 手算分解（组间/组内/总计）、η²、ω²、手算 Tukey HSD（studentized range） |
| 6 | 卡方检验 | 2×3 列联表 | χ² = Σ(O−E)²/E、df、Cramér's V 闭式解 |
| 7 | Pearson 相关 | 含缺失（成对删除） | r 闭式解 + t 变换求 p + Fisher z（含 R 的偏差校正）CI |
| 8 | Spearman 相关 | 无结点 | ρ = 1 − 6Σd²/(n(n²−1)) + 置换零分布（20000 次）估 p |
| 9 | 线性回归 | y ~ x1 + x2（低共线性） | 矩阵代数求 R²/adj R²/F/p/σ/SE/t/p、相关矩阵逆求 VIF、β = b·sd(x)/sd(y) |
| 10 | Cronbach's α | 5 项目、含缺失 | **两条独立路径**：方差分量恒等式 (MS_sub−MS_err)/MS_sub 与协方差矩阵恒等式；另有 psych::alpha（可选） |
| 11 | 正态性 (Shapiro-Wilk) | 近似正态 + 强偏态 | Blom 得分手算 W + 蒙特卡洛零分布估 p + 手算偏度/峰度 |
| 12 | Mann-Whitney U | 两组各 7 例、无结点 | 秩和定义求 W + **精确枚举**零分布（C(14,7)）求 p + 配对计数求 rank-biserial |
| 13 | 频数统计 / 分类汇总 | 含缺失与 n=1 组 | 手工计数与逐组手算（含百分比双口径） |
| 14 | 探索性因子分析 (EFA) | 6 题 2 因子 / 9 题 3 因子 | Bartlett 用 `determinant()`、KMO 用 `chol2inv(chol())`；独立 eigen + varimax 逐值比对；共同度旋转不变性 |
| 15 | 验证性因子分析 (CFA) | 6 题 2 因子 (n=800) / 9 题 3 因子 (n=600) / 失配模型 | **换参数化**：Cholesky-Φ + `nlm`（实现用角度-Φ + `optim(BFGS)`）；`ln\|Σ\|` 用特征值展开（实现用 `determinant()`）；`Σ⁻¹` 用 `chol2inv`；另有参数化无关不变式 `diag(Σ)=1`、`Σλ²+θ_std=1`、df 公式 |
| 16 | 内容效度指数 (CVI) | 8 专家 × 6 题项，I-CVI 覆盖 5 档 | 逐专家**穷举计数**求 I-CVI / S-CVI/UA；`choose()` 独立算 Pc；阈值表在 oracle 内**重写一份** |
| 17 | Harman 单因子检验 | 中等相关 / 单一强因子 | `eigen(cor(X))` 独立算首特征值占比（实现用 `prcomp`）；SVD 奇异值做第二重自校验 |

数值比较默认相对容差 `TOL = 1e-3`（输出保留 4 位小数 → 误差上界 5e-5），
3 位小数与平滑近似量用 `TOL_LOOSE = 1e-2`，置换/蒙特卡洛 p 单独设容差。
所有随机过程固定随机种子（`set.seed(20260904)`），结果可复现。

### 4.1 v0.3.1 三个新方法的 oracle 设计要点

**CFA 为什么必须换参数化而不是"把实现再写一遍"**：
被测实现用「角度编码保证 Φ 半正定 + `optim(BFGS)` + 多起点」。如果 oracle 也这么写，
就退化成 v0.2.5 那种"同一段代码跑两遍"的同义反复。因此 oracle 改用
「Φ 的 Cholesky 下三角自由估计再归一化 + `nlm` 的 Newton 型优化」——
参数向量的维数与含义都不同，**只有模型隐含 Σ 与 F_ML 这两个不变量应当一致**。
两套优化器在全部 fixture 上给出的 `F_ML` 相对差约 **5.8e-10**，
这才是真正独立的交叉验证。

另外断言了三条与参数化完全无关的**不变式**（任何正确实现都必须满足）：
`diag(Σ) ≈ 1`（相关阵拟合）、`Σλ² + θ_std = 1`（标准化分解）、
`df = p(p+1)/2 − (2p + k(k−1)/2)`（与 lavaan 一致的参数量口径）。

`lavaan` 在本机**未安装**，且项目红线是零外部 R 包依赖，因此拟合指标（CFI/TLI/
RMSEA/SRMR）全部按 lavaan 的公式在 oracle 内独立复算，而不是与 lavaan 输出比对。

**CVI 的阈值表在 oracle 里重写一份**：这不是冗余，而是刻意的冗余——oracle 若直接读
实现的阈值向量，阈值表本身写错就永远不会被发现（正是 v0.2.5 事故的同类模式）。
本版这条设计**实际抓到了一个真实缺陷**（初稿阈值偏松，见 CHANGELOG）。

**Harman 走 `eigen(cor(X))` 而实现走 `prcomp()`**：两者数学等价但 LAPACK 例程不同，
若实现的中心化/标准化写错（例如忘了 `scale`），首成分占比会明显不同。
oracle 内部还额外用 SVD 奇异值做第二重自校验（两条路径互差 1.8e-15）。

**判别力必须双向验证**：CFA 用「正确模型 CFI ≥ 0.95」+「失配模型 CFI < 0.80」两条断言
夹住判据；Harman 用「中等相关数据 first_pct < 40」+「强因子数据 first_pct > 40」夹住 40% 判据。
只验一个方向的断言无法排除"判据恒为真/恒为假"。

## 5. 验证边界（诚实声明）

- 本脚本验证 **R 生成器产出的代码与独立 oracle 一致**；它**不**验证
  `resultParser.ts` 的解析结果。解析器契约由 Vitest 测试覆盖
  （`src/renderer/src/services/__tests__/` 与 lead 的 `r-contract.test.ts`）。
- 它不回答「该数据集上选用某方法是否恰当」——那是研究设计问题。
- **CFA 的 oracle 验证的是"给定因子结构下的估计与拟合指标算得对不对"，
  不验证"该因子结构是否成立"**。实现的因子归属由同一数据集的 EFA 自动导出
  （EFA → CFA 串联），属**探索—验证同源**：同一份数据既用来发现结构、
  又用来确认结构，会**高估**拟合优度。独立 oracle 无法发现这个问题
  （它是研究设计层面的局限，不是计算错误），因此产品在 `CFA_NOTE` 里显式提示，
  CHANGELOG 与 README 也都有同样的声明。
- 同理，CFA oracle 的 `.std_load` 比对是"两个独立优化器是否收敛到同一个解"，
  不是"估计是否等于真值"。真值恢复另有一条独立断言
  （`truth.std_load.max_abs_error`，容差 0.02），它依赖 fixtures 的已知真值，
  且仅在正确模型场景下断言（失配场景真值不适用）。
- `VALIDATION_RESULTS.md` 是**本机 R 自动生成的产物**，随 R 版本/平台变化，
  不构成对某个已提交 commit 的独立证据；CI 会在每次运行时重新生成并比对。
- 缺少 `psych` 时信度分析用两条 base R 独立路径，覆盖强度足够；安装 `psych` 只是增加
  第二方实现作为额外交叉验证。
- `lavaan` 同理：本机未安装，且项目红线是零外部 R 包依赖。CFA 的拟合指标按
  lavaan 公式在 oracle 内**独立复算**，因此即使装上 lavaan 也不会改变验证结论；
  它只会多提供一条"与业界实现比对"的额外路径。

## 6. 失败能力验证（可复现）

### 6.1 自动 harness（推荐，一条命令）

```bash
Rscript scripts/validate/prove_failure_ability.R
# 等价写法
npm run validate:oracle-failure
# 退出码 0 = 三处注入都成功让断言变红（即验证脚本确实有判别力）
# 退出码 1 = 注入后断言没有变红 → 验证脚本存在盲区
```

它把 `run_validation.R` 复制成临时副本，向三处 oracle 注入**语义错误**
（不是语法错误——语法错误只能证明 `parse` 失败，证明不了断言有判别力），
运行后核对退出码为 1 且每个注入点都有断言变红，最后删除临时副本。

| 注入点 | 注入内容 | 变红的断言 |
|---|---|---|
| Harman | 首成分占比 × 2 | `HARMAN_SUMMARY.first_pct` / `ok` / `criterion.medium_side` / `CONCL.direction` |
| CFA | 零模型卡方符号取反 | `CFA_NULLMODEL.chisq` / `CFI` / `TLI` |
| CVI | 阈值表 0.83 → 0.75 | `p_c` / `kappa` / `verdict` |

本机实测（R 4.6.0）：**536 断言 → PASS 510 / FAIL 26，退出码 1**，
三个注入点各自都有断言变红，harness 自身退出码 0。

### 6.2 对产品代码做变异测试（手动）

对**产品代码**（而非 oracle）注入缺陷，同样应让验证变红：

```bash
# 故意把描述性统计的 sd() 写成 var()，验证脚本必须变红且退出码非 0
cp src/renderer/src/services/rService.ts /tmp/mut/rService.ts
cp src/renderer/src/services/utils.ts     /tmp/mut/utils.ts
node -e "const fs=require('fs');const p='/tmp/mut/rService.ts';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('sd(valid) else NA','var(valid) else NA'))"
node scripts/validate/generate_fixtures.mjs --src /tmp/mut/rService.ts --out /tmp/mut/generated
Rscript scripts/validate/run_validation.R --generated /tmp/mut/generated --no-regenerate
echo "exit=$?"   # 必须为 1，且 SD 断言为 FAIL
```

实测结果：`PASS 265 / FAIL 3`（三条 `.SD` 断言），退出码 **1**。

> v0.3.1 开发期间，本 harness 还实际抓到了 3 个产品缺陷（CFA 的 `phi_idx`
> 下标崩溃、CVI 阈值表口径错误、CFA 的 `unstd_load` 与 `std_load` 恒等）。
> 这说明它不是"写完就绿灯"的摆设。详见 CHANGELOG `[0.3.1]` 的「修复」一节。

---

## 7. 制品级验收 harness（**按需运行，绝不进入 CI / npm test**）

第 1-6 节的 R oracle 证明的是**统计正确性**；下面这组 harness 证明的是**另一件事**：
代码在真实 `.sav` 文件、真实 `officecli` 二进制、以及**已打包的 `app.asar` 产物**里确实能工作。
它们原本是 task-3（mainprocess）在 `%TEMP%` 下的临时脚本——本目录把它们入库，避免
「最强的一份端到端证据随临时目录一起消失」这类**不可复现**的失效模式。

| 文件 | 证明什么 | 前置条件 | 检查数 |
|---|---|---|---|
| `verify.cjs` | 真实 `.sav`（small 6 行 / big 30 万行 / exact 20 万行）经**当前源码** `savImport.ts` 的行读取、类型映射、截断与缺失值统计；上游 sav-reader 缺陷复现；officecli 生成 docx；R 版本数值排序；主菜单 i18n 键对齐 | `.sav` fixtures + `resources/bin/officecli.exe` | 60 |
| `verify_ipc.cjs` | 用 stub `electron` 加载**当前源码** `ipc.ts` 并逐个调用真实 IPC handler：`data:parseSav`、`r:detect`、`r:execute`（含 64MB 上限）、`r:plot`（正式/备用/主题抛错）、`config:*ApiKey`（含 `constructor` 原型链）、officecli 批量导出与输入校验、临时目录泄漏 | `.sav` fixtures + R（`RWB_RSCRIPT` 可覆盖路径）；绘图检查另需 `ggplot2`/`showtext` | 63 |
| `lazy_r_check.cjs` | **惰性 R 路径解析**（T12 item 5）：让 `r:execute` 成为**第一个** IPC 调用（之前无 `r:detect`）。旧代码 `detectedRPath = 'Rscript'` 会 spawn PATH 上的 Rscript 并在本机 ENOENT——只有这个 harness 隔离该失效模式 | R 4.6.0（绘图检查另需 `ggplot2`） | 7 |
| `negcache_r_check.cjs` | **R 探测负缓存 + 手动重新检测的自愈**：把 `ProgramFiles`/`LOCALAPPDATA`/`R_HOME`/`RWB_RSCRIPT` 指向空目录制造「没装 R」，用 `child_process.execFile` spy 数 spawn 次数，从而**无需等 30 s** 就确定性地断言「失败后不重扫（负缓存生效）」与「`r:detect` 强制重扫、之后执行恢复」。本机真无 R 时自愈部分 SKIP 而非判红 | R 4.6.0（Windows；自愈部分需要真实的 R） | 10 |
| `packaged_app_check.cjs` | **已打包产物**：用 Electron（`ELECTRON_RUN_AS_NODE=1`）加载 `releases/win-unpacked/resources/app.asar` 里的 main bundle，对真实 `resources/` 布局调用 handler——`officecli:detect` 必须 `found:true`（F6 验收线）、`.sav` 导入、`r:detect`、`r:plot`（随包发布的 `rScripts/theme_academic.R`）、API key 存储。普通 Node 下会自动用 `node_modules/electron` 重新执行 | `npm run build:win` 产物 + `.sav` fixtures + R（绘图检查另需 `ggplot2`/`showtext`） | 16 |
| `gen_sav.R` | 用 `haven` 重新生成 `fixtures/{small,big,exact}.sav`，并用 `foreign::read.spss` 做独立交叉校验 | R + `haven`（缺失时 **SKIP，退出码 0**） | — |
| `crosscheck.R` | 用 R 自己的 SPSS 读取器（`foreign`）作为**不同解析器/不同语言**的独立参照读出 fixtures | R + `foreign` + fixtures（缺失时 SKIP，退出码 0） | — |

运行方式：

```bash
npm run verify:sav        # verify.cjs
npm run verify:ipc        # verify_ipc.cjs
npm run verify:lazy       # lazy_r_check.cjs（惰性 R 路径解析）
npm run verify:negcache   # negcache_r_check.cjs（负缓存 + 手动重新检测自愈）
npm run verify:packaged   # packaged_app_check.cjs（需要先 npm run build:win）
Rscript scripts/validate/gen_sav.R        # 生成 .sav fixtures（需要 haven）
Rscript scripts/validate/crosscheck.R     # foreign 独立交叉校验
```

环境变量（全部可选）：

| 变量 | 作用 | 适用于 |
|---|---|---|
| `RWB_FIXTURES` | fixtures 目录（默认 `<script dir>/fixtures`）；指向空目录即可验证 SKIP 路径 | `verify.cjs` / `verify_ipc.cjs` / `packaged_app_check.cjs` |
| `RWB_RSCRIPT` | Rscript 可执行文件路径（默认 `C:\Program Files\R\R-4.6.0\bin\Rscript.exe`） | `verify_ipc.cjs` |
| `RWB_OUT` | fixtures 输出目录 | `gen_sav.R` |
| `RWB_LIBS` | 追加库路径（未设置时不改动 `.libPaths()`） | `gen_sav.R` |

设计约定：

- **不提交编译产物。** `verify.cjs` / `verify_ipc.cjs` / `lazy_r_check.cjs` / `negcache_r_check.cjs`
  每次运行时用 esbuild 从 `src/main/savImport.ts` / `src/main/ipc.ts` **现打包**
  （`_bundle.cjs`，产物写入 `generated/`），因此验证的永远是当前源码，而不是一份可能过期的
  `*.cjs` 副本——这正是原 `run_validation.R` 同义反复的同类失效模式。
  ⚠ 打包必须在**安装任何 `child_process` spy 之前**完成：esbuild 自己会 spawn 子进程，
  否则那些子进程会被 spy 记录并干扰断言。
- **缺失前置条件时 SKIP + 退出码 0**，永不把干净 checkout 判红：
  `packaged_app_check.cjs` 找不到 `releases/win-unpacked/resources/app.asar` 时 SKIP；
  `gen_sav.R` 缺 `haven` 时 SKIP；`verify.cjs` / `verify_ipc.cjs` 缺 fixtures 时 SKIP
  （用 `RWB_FIXTURES=<空目录>` 可复现该路径）。
- **绘图检查在缺 `ggplot2` 时保持 FAIL（不是 SKIP）**：没有绘图依赖的机器应当肉眼可见地非全绿，
  而不是看起来干净。只有「图像已生成但无法做像素统计」这一步退化为 SKIP。
- `.sav` fixtures 与 esbuild 产物都在 `.gitignore` 中（`fixtures/`、`generated/`），
  可随时重建，二进制不入库。
- `fixtures/` 位于仓库内时会被 `ipc.ts` 的 `validateFilePath` 拒绝（白名单只信任
  `os.tmpdir()` 等目录）。两个 handler 级 harness 因此自动把 fixtures 复制到临时目录再喂给
  handler——既验证了白名单语义，也不依赖任何机器专有路径。
- **运行期覆盖范围不同**：`verify.cjs` / `verify_ipc.cjs` / `lazy_r_check.cjs` / `negcache_r_check.cjs`
  在**普通 Node**（本机 v24.12.0）下运行；`packaged_app_check.cjs` 在
  **Electron 33.4.11 / Node 20.18.3** 下运行（即应用真实运行期）。`verify_ipc.cjs` 的 63 项检查
  在迁移前也曾于 Electron 的 Node 20.18.3 下跑过 63/63，但仓库内脚本的默认运行期是 Node 24
  —— 只有 `verify:packaged` 覆盖应用运行期。

### 给新增 harness 的一条硬规则：包装 `child_process.execFile` 会毁掉 `promisify`

`child_process.execFile` 携带 `util.promisify.custom`，正是它让 `promisify(execFile)` 解析为
`{ stdout, stderr }`。下面这种「朴素 spy」会丢掉该 symbol：

```js
const cp = require('child_process')
const stub = Object.create(cp)
stub.execFile = (...a) => { count(a[0]); return cp.execFile(...a) }   // ✗ 丢失 [promisify.custom]
```

后果不是报错，而是**假阴性**：`promisify(stub.execFile)` 回退到通用回调路径，解析结果变成
**第一个回调参数（stdout 字符串）**；`const { stdout } = await execFileAsync(...)` 得到
`undefined` → 探测全部「失败」→ 在 R 装得好好的机器上 `r:detect` 报 `found:false`，
看起来像是产品缺陷。正确写法是回调 API 与 custom-promise API 都包装：

```js
const { promisify } = require('util')
stub.execFile = (...a) => { count(a[0]); return cp.execFile(...a) }
stub.execFile[promisify.custom] = (file, args, opts) => {
  count(file)
  return cp.execFile[promisify.custom](file, args, opts)
}
```

`negcache_r_check.cjs` 是唯一会 stub `child_process` 的 harness，它按上面的正确形式实现；
`verify_ipc.cjs` / `packaged_app_check.cjs` 不触碰 `child_process`，不受影响。
这也是本目录存在的理由——「看起来是证据、实际上是错的」比没有证据更危险。

本机实测（R 4.6.0；`ggplot2 4.0.3` + `scales` 已装入 R 默认用户库 `R_LIBS_USER`
= `C:\Users\<user>\AppData\Local\R\win-library\4.6`）：

| harness | 结果 |
|---|---|
| `npm run verify:sav` | **60 PASS / 0 FAIL**，`>>> ALL CHECKS PASSED`，退出码 0 |
| `npm run verify:ipc` | **63 PASS / 0 FAIL**，`>>> ALL HANDLER CHECKS PASSED`，退出码 0 |
| `npm run verify:lazy` | **7 PASS / 0 FAIL**，`>>> LAZY R-RESOLUTION CHECKS PASSED`，退出码 0（`r:execute` 在无 `r:detect` 的前提下解析到 `R-4.6.0\bin\Rscript.exe`） |
| `npm run verify:negcache` | **10 PASS / 0 FAIL**，`>>> R-DETECTION NEGATIVE-CACHE CHECKS PASSED`，退出码 0（负缓存 0 次重扫、`r:detect` 强制重扫、环境恢复后执行自愈且只 spawn 1 次 R 脚本本身） |
| `npm run verify:packaged` | **16 PASS / 0 FAIL**，退出码 0；`officecli:detect → found:true, version 1.0.153, path …\resources\bin\officecli.exe`，20 个 IPC handler 从 asar bundle 注册，随包绘图 1800×1200 PNG（`lumStdDev=21.51`） |
| `npm run verify:packaged -- <不存在的目录>` | 打印 SKIP，退出码 **0** |
| `RWB_FIXTURES=<空目录> npm run verify:sav` | 打印 SKIP，退出码 **0** |

合计 **156 项断言**（60 + 63 + 7 + 10 + 16）。

> 这些 harness **不进入** `npm test` 与 `ci.yml`：门禁保持 hermetic（无 R、无 officecli、无打包产物也能跑），
> 而制品级验收按需执行。要拿到全绿，需要在装有 `ggplot2`/`showtext` 的 R 库上运行（`RWB_LIBS` 可指向该库）。

