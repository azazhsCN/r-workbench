# 论文正确性验证 → GitHub Release 绑定说明

本说明供作者与审稿人明确：论文 Table 2（正确性验证）的**可复现证据**对应到哪个
GitHub release，以及如何复现。

## 1. 绑定目标

- 论文中引用的系统开源仓库：https://github.com/azazhsCN/r-workbench
- 论文实验绑定 release：**v0.2.3**（tag `v0.2.3`，commit `71e2906`）
  - 若验证设施在后续提交中加入，建议发布 **v0.2.4** 并让论文改绑新 tag。
- 论文中应写：
  > The validation scripts and results are available at:
  > https://github.com/azazhsCN/r-workbench/releases/tag/v0.2.3 (or the latest tag
  > containing the `scripts/validate/` directory)

## 2. 复现步骤

```bash
# 1) 克隆仓库并切换到绑定 tag
git clone https://github.com/azazhsCN/r-workbench.git
cd r-workbench
git checkout v0.2.3        # 或包含验证设施的最新 tag

# 2) 运行验证（需 R >= 4.2）
Rscript scripts/validate/run_validation.R
```

脚本会：
- 对 13 种统计方法（描述统计、独立/配对/单样本 t 检验、单因素 ANOVA、Pearson/Spearman
  相关、线性回归、卡方检验、Mann-Whitney U、Cronbach's α、Shapiro-Wilk 正态性、
  频数统计、分组汇总）逐一执行；
- 每个方法用 R 标准数据集（mtcars / iris / ToothGrowth / sleep / HairEyeColor）；
- 输出参考值、R Workbench 实现值，并判定是否在浮点精度内一致；
- 生成 `scripts/validate/VALIDATION_RESULTS.md`。

## 3. 验证环境

本仓库提交的 `VALIDATION_RESULTS.md` 由以下环境产生：
- R 版本：`R version 4.6.0 (2026-04-24 ucrt)`
- 依赖：**仅为 base R 标准函数**（无第三方 R 包依赖）。Cronbach's α 用 base R 手算，
  与 `src/renderer/src/services/rService.ts` 的 `reliabilityCode` 实现一致。

## 4. 结果与边界

- 本地运行汇总：**33 / 33 全部通过**（详见 `VALIDATION_RESULTS.md`）。
- 边界说明（避免夸大）：本脚本验证“R Workbench 所采用的方法在标准数据集上产生与公认
  结果一致的统计量”；脚本中参考实现与工作台实现调用相同 R 函数，故对比恒等，证明的是
  **参数映射与结果格式化正确**，而非“生成器输出的字符串代码可执行”。后者应由端到端
  单元测试另行覆盖。论文表述应如实反映这一层次。

## 5. CI（可选）

仓库内置 GitHub Actions（`.github/workflows/stat-validation.yml`），在修改 `rService.ts`、
`resultParser.ts`、`plotService.ts` 或 `scripts/validate/**` 时，自动安装 base R 并运行
`run_validation.R`，产出作为持续验证证据。
