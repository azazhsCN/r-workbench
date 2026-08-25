# 统计验证结果

R 版本：R version 4.6.0 (2026-04-24 ucrt)
psych 包：未安装

| 方法 | 数据集 | 统计量 | 参考 | 工作台 | 结果 |
|---|---|---|---|---|---|
| descriptive | mtcars | M | 20.0906 | 20.0906 | PASS |
| descriptive | mtcars | SD | 6.0269 | 6.0269 | PASS |
| descriptive | mtcars | Med | 19.2 | 19.2 | PASS |
| ttest_independent | ToothGrowth | t | 1.9153 | 1.9153 | PASS |
| ttest_independent | ToothGrowth | df | 55.3094 | 55.3094 | PASS |
| ttest_independent | ToothGrowth | p | 0.0606 | 0.0606 | PASS |
| ttest_paired | sleep | t | -4.0621 | -4.0621 | PASS |
| ttest_paired | sleep | df | 9 | 9 | PASS |
| ttest_paired | sleep | p | 0.0028 | 0.0028 | PASS |
| ttest_one | mtcars | t | 0.0851 | 0.0851 | PASS |
| ttest_one | mtcars | p | 0.9328 | 0.9328 | PASS |
| anova | iris | F | 119.264 | 119.264 | PASS |
| anova | iris | p | 0 | 0 | PASS |
| correlation_pearson | mtcars | r | -0.8677 | -0.8677 | PASS |
| correlation_pearson | mtcars | p | 0 | 0 | PASS |
| correlation_spearman | mtcars | rho | -0.8864 | -0.8864 | PASS |
| correlation_spearman | mtcars | p | 0 | 0 | PASS |
| regression | mtcars | R2 | 0.8268 | 0.8268 | PASS |
| regression | mtcars | adjR2 | 0.8148 | 0.8148 | PASS |
| regression | mtcars | F | 69.2112 | 69.2112 | PASS |
| regression | mtcars | p | 0 | 0 | PASS |
| chisquare | HairEyeColor | chi2 | 138.29 | 138.29 | PASS |
| chisquare | HairEyeColor | df | 9 | 9 | PASS |
| chisquare | HairEyeColor | p | 0 | 0 | PASS |
| nonparametric | ToothGrowth | W | 575.5 | 575.5 | PASS |
| nonparametric | ToothGrowth | p | 0.0637 | 0.0637 | PASS |
| reliability | mtcars | alpha | 0.4672 | 0.4672 | PASS |
| normality | mtcars | W | 0.9476 | 0.9476 | PASS |
| normality | mtcars | p | 0.1229 | 0.1229 | PASS |
| frequency | iris | count | 150 | 150 | PASS |
| frequency | iris | ncat | 3 | 3 | PASS |
| summary_by | iris | mean | 5.8433 | 5.8433 | PASS |
| summary_by | iris | ngroup | 3 | 3 | PASS |

**汇总：33 / 33 通过**
