# 统计正确性验证发布说明

本文件介绍 R Workbench 仓库中统计正确性验证脚本的内容、运行方式与发布版本。

> **v0.2.6 起本文件已重写。** 旧版本曾把"参考实现与工作台实现调用相同 R 函数、输出必然一致"
> 描述为验证依据——那是**同义反复**，无法发现任何缺陷（v0.2.5 的 12 个失效方法就在那份"33/33 通过"
> 之下长期存在）。现在的验证执行**应用真实生成的代码**，并用**独立 oracle** 复算。

## 1. 概述

`scripts/validate/` 包含可复现的统计正确性验证，覆盖全部 13 种统计方法：
描述统计、独立/配对/单样本 t 检验、单因素 ANOVA、Pearson/Spearman 相关、线性回归、
卡方检验、Mann-Whitney U、Cronbach's α、Shapiro-Wilk 正态性、频数统计与分组汇总。

验证流程（`run_validation.R`）：

1. 通过 `generate_fixtures.mjs` 用 esbuild **加载真实的 `src/renderer/src/services/rService.ts`**，
   调用真实的生成器函数，把它们实际产出的 R 代码写入 `scripts/validate/generated/*.R`；
2. 用 Rscript 执行这些代码，捕获 stdout **与 stderr**；
3. 用**独立 oracle** 复算关键统计量并逐项比对：

| 方法 | 独立 oracle |
|------|------------|
| 独立样本 t 检验 | Welch 闭式解（非调用 `t.test`） |
| ANOVA | 平方和分解 + η²/ω² + 手算 Tukey 学生化极差区间 |
| 卡方 | Σ(O−E)²/E 与 Cramér's V 定义式 |
| Pearson / Spearman | 相关系数闭式解；Spearman 另做精确置换检验 p |
| 线性回归 | 矩阵代数求 R²/F/SE/t；VIF 由相关矩阵逆阵求得；β = b·sd(x)/sd(y) |
| Cronbach's α | 方差成分恒等式 + 协方差矩阵恒等式两条独立路径（装有 psych 时再与 `psych::alpha` 交叉验证）|
| Shapiro-Wilk | Blom 分数构造 W + 蒙特卡洛 p |
| Mann-Whitney U | 秩定义 + 精确枚举分布 C(n,k) + 配对计数法秩二列相关 |
| 频数 / 分组汇总 | 手工计数 |

4. 共 **282 项断言**。**脚本在断言失败时以非 0 退出码结束**，可直接作为 CI 门禁；
   并会把 R 的 stderr 中 `sprintf` 参数不匹配（"只发 warning、静默丢字段"）判为失败。
5. 另有 14 处对生成代码执行 `parse()` 的断言，防止再次出现"生成的代码 R 根本解析不了"。

## 2. 发布版本

- 仓库：https://github.com/azazhsCN/r-workbench
- 当前验证脚本版本：**v0.2.6**
  - 包含：`scripts/validate/**`、`.github/workflows/stat-validation.yml`、
    `.github/workflows/ci.yml`、`docs/validation-release.md`

## 3. 复现方式

```bash
git clone https://github.com/azazhsCN/r-workbench.git
cd r-workbench
git checkout v0.2.6
npm ci                      # fixtures 生成需要 esbuild
Rscript scripts/validate/run_validation.R
```

运行环境要求：

- R >= 4.2（已在 R 4.6.0 下验证）
- R 依赖：**base R 即可**；若装有 `psych`，会额外用 `psych::alpha` 交叉验证信度分析
- Node + `npm ci`：仅用于把 TypeScript 生成器打包后取真实代码

## 4. 验证结果

由 R 4.6.0 执行产生：**方法覆盖 13 / 13，断言 282（PASS 282 / FAIL 0）**。

**失败能力已验证**：把 `rService.ts` 中的 `sd(valid)` 改成 `var(valid)` 后，
脚本报告 `PASS 265 / FAIL 3` 并 **exit 1**；缺少 fixtures 时给出明确错误并 exit 1。

## 5. 验证边界

- 本验证检验的是"**应用生成的 R 代码**在标准数据集上产生与独立 oracle 一致的统计量"。
  因此它能发现生成器公式错误、参数映射错误、结果格式化错误与生成代码语法错误。
- 它**不**覆盖：TypeScript 解析器把 R 输出读成三线表的过程、UI 交互、打包产物行为。
  解析器与横幅映射由 `src/renderer/src/services/__tests__/r-contract.test.ts`（Vitest）覆盖；
  打包产物由 `scripts/validate/verify*.cjs`（按需运行）覆盖。
- 部分 oracle 使用蒙特卡洛（Shapiro-Wilk p、Spearman 置换 p），结果在固定随机种子下可复现。

## 6. CI

仓库内置两个工作流：

- `.github/workflows/ci.yml`：push/PR 上运行 `typecheck:node`、`typecheck:web`、`lint`、
  `test`、`build`（ubuntu + windows 矩阵；两个 typecheck 目标**分步执行**，
  避免 `&&` 短路导致 web 目标被跳过）。
- `.github/workflows/stat-validation.yml`：安装 base R 后运行 `run_validation.R`，
  并额外运行一次 `npm run build`，防止"R 脚本全绿、应用编译不过"。

## 7. 按需运行的打包产物验收

以下脚本需要真实产物或可选 R 包，**不进入 CI**，缺前置条件时输出 `SKIP` 并 exit 0：

```bash
npm run build:win          # 需要 resources/bin/officecli.exe
npm run verify:sav         # 60 项：savImport + officecli
npm run verify:ipc         # 63 项：真实 ipc.ts handler
npm run verify:lazy        #  7 项：r:execute 作为首个 IPC 调用（应自愈检测 R）
npm run verify:negcache    # 10 项：R 检测负缓存与手动刷新
npm run verify:packaged    # 16 项：shipped asar 产物验收
```

合计 **156 项断言**。详见 `scripts/validate/README.md` 第 7 节。
