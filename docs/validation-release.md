# 统计正确性验证发布说明

本文件介绍 R Workbench 仓库中统计正确性验证脚本的内容、运行方式与发布版本。
验证脚本旨在确认系统所实现的分析方法在标准 R 数据集上产生与 R 参考实现一致的结果。

## 1. 概述

`scripts/validate/` 目录包含一组可复现的统计正确性验证脚本，覆盖系统实现的
13 种统计方法：描述统计、独立/配对/单样本 t 检验、单因素 ANOVA、Pearson/Spearman
相关、线性回归、卡方检验、Mann-Whitney U、Cronbach's α、Shapiro-Wilk 正态性检验、
频数统计与分组汇总。每个方法使用 R 内置的标准数据集（mtcars、iris、ToothGrowth、
sleep、HairEyeColor）执行，并输出参考值、R Workbench 实现值及一致性判定。

该验证随仓库一起发布，可通过 checkout 对应版本号（tag）获取。

## 2. 发布版本

- 仓库：https://github.com/azazhsCN/r-workbench
- 验证脚本所在 tag：**v0.2.4**
  - 包含：`scripts/validate/`、`.github/workflows/stat-validation.yml`、
    `docs/validation-release.md`
  - 当前指向 commit `6a82876`

## 3. 复现方式

```bash
git clone https://github.com/azazhsCN/r-workbench.git
cd r-workbench
git checkout v0.2.4
Rscript scripts/validate/run_validation.R
```

运行环境要求：
- R >= 4.2（R 4.6.0 下已验证）
- 依赖：**仅 base R 标准函数**，无需第三方 R 包。Cronbach's α 使用 base R 手算，
  与 `src/renderer/src/services/rService.ts` 中 `reliabilityCode` 的实现一致。

## 4. 验证结果

当前 `VALIDATION_RESULTS.md` 中的结果由 R 4.6.0 环境执行产生，共 **33/33 项通过**，
即各方法的关键统计量（均值、t、F、χ²、r、ρ、W、α、W-statistic、计数、组均值等）
在浮点精度内与 R 参考实现一致。

## 5. 验证边界

需要明确的是：本脚本验证的是“R Workbench 所采用的分析方法在标准数据集上产生与公认
结果一致的统计量”。脚本中参考实现与工作台实现调用的是相同的 R 标准函数，因此两者
输出一致，证明的是**参数映射与结果格式化正确**。该验证并不等同于“生成器输出的字符串
代码可执行”；后者属于代码层面的端到端单元测试范畴。

## 6. CI

仓库内置 GitHub Actions（`.github/workflows/stat-validation.yml`），在相关源文件
（`rService.ts`、`resultParser.ts`、`plotService.ts`、`scripts/validate/**`）变更时，
自动安装 base R 并运行 `run_validation.R`，作为持续验证。
