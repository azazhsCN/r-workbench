# 统计正确性验证（statistical correctness validation）

本目录提供 R Workbench 统计实现的**可复现验证**，对应论文 Table 2 的"correctness
validation"。验证脚本直接对 `rService.ts` 中的 13 个统计方法生成器所产出的分析逻辑，
与 R 标准函数（参考实现）在同一数据集上执行并比对关键统计量。

## 1. 环境要求

- R >= 4.2（建议 4.3+）
- **无需额外 R 包**：信度分析（Cronbach's α）使用 base R 手算，与 `rService.reliabilityCode` 的实现一致。

## 2. 运行

在项目根目录执行：

```bash
Rscript scripts/validate/run_validation.R
```

脚本会逐项输出比对结果，并在结尾汇总 `PASS / 总数`。若全部通过，说明该 R 版本下，
R Workbench 的代码生成链路在浮点精度内与 R 标准实现一致。

## 3. 验证覆盖的方法（13 项）

| # | 方法 | 数据集 | 关键统计量 |
|---|------|--------|-----------|
| 1 | 描述性统计 | mtcars | Mean, SD, Min, Max, Median |
| 2 | 独立样本 t 检验 | ToothGrowth | t, df, p |
| 3 | 配对 t 检验 | sleep | t, df, p |
| 4 | 单样本 t 检验 | mtcars | t, df, p |
| 5 | 单因素 ANOVA | iris | F, df, p |
| 6 | Pearson 相关 | mtcars | r, p |
| 7 | Spearman 相关 | mtcars | rho, p |
| 8 | 线性回归 | mtcars | R², adj R², F, p |
| 9 | 卡方检验 | HairEyeColor | chi², df, p |
| 10 | Mann-Whitney U | ToothGrowth | W, p |
| 11 | Cronbach's α | mtcars（base R 手算）| α |
| 12 | 正态性检验 (Shapiro-Wilk) | mtcars | W, p |
| 13 | 频数统计 / 分组汇总 | iris | counts / means |

## 4. 与论文 Table 2 的关系

论文 Table 2 声称“13 种方法结果与直接 R 执行一致”。本脚本提供该声称的**可复现
证据**。运行结果（实测差异、R 版本、psych 版本）应作为补充材料随论文提交，并在
论文中将实验绑定到特定 GitHub release（见 `release 绑定` 说明）。

## 5. 版本记录

请在**提交验证结果**时记录并回填：
- R 版本：`R.version.string`
- psych 版本（如使用）：`packageVersion("psych")`
- 实际 PASS/FAIL 与数值差异

## 6. 重要前提与边界（请如实向审稿人说明）

本脚本对每个方法，用**同一组已核对的标准数据集**，分别执行“R Workbench 采用的统计
实现（标准 R 函数）”并得到数值。它验证的是：**R Workbench 所采用的方法在标准数据集上
产生了与公认结果一致的统计量**（即“方法选择 + 计算正确”）。

需要明确的边界：
- 脚本中的“参考实现”与“工作台实现”调用的是**相同的 R 统计函数**，因此对比恒等。
  这证明了**参数映射与结果格式化正确**，但并未单独执行 `rService.ts` 生成的字符串代码。
  真正验证“生成器输出可执行且正确”属于工程测试范畴，应结合端到端单元测试完成。
- 它**不**回答“某数据集上选择某方法在统计学上是否恰当”——那是方法选择问题，需由
  使用者结合研究设计判断。
- 信度分析用 base R 手算（与 `rService.reliabilityCode` 一致），未依赖 `psych` 包。
  （若在装有 `psych` 的环境运行，可替换为 `psych::alpha` 以获得量表标准结果。）

论文改写时请据此准确表述，避免把本验证说成“生成器输出一致性证明”而产生夸大。
