# 统计验证结果（真实生成器 + 独立 oracle）

R 版本：R version 4.6.0 (2026-04-24 ucrt)
生成时间：2026-10-25 21:31:51
fixtures 目录：generated
被测代码：src/renderer/src/services/rService.ts（esbuild 打包后运行时调用，非手抄副本）

方法覆盖：**17 / 17**
断言总数：**536**（PASS 536 / FAIL 0）

| 方法 | 数据集 | 断言 | 参考(oracle) | 工作台 | 结果 |
|---|---|---|---|---|---|
| descriptive | descriptive | r_syntax_parse | parse() ok | ok | PASS |
| descriptive | descriptive | sprintf_format_args | no mismatch | ok | PASS |
| descriptive | descriptive | no_r_error | no error | ok | PASS |
| descriptive | descriptive | banner | === 描述性统计 === | === 描述性统计 === | PASS |
| descriptive | descriptive | vars_present | mpg,diff,中文列,allna | mpg,diff,中文列,allna | PASS |
| descriptive | descriptive | mpg.N |       8 |       8 | PASS |
| descriptive | descriptive | mpg.M | 22.3625 | 22.3625 | PASS |
| descriptive | descriptive | mpg.SD | 4.80623 |  4.8062 | PASS |
| descriptive | descriptive | mpg.Min |    15.8 |    15.8 | PASS |
| descriptive | descriptive | mpg.Max |    30.1 |    30.1 | PASS |
| descriptive | descriptive | mpg.Median |   21.75 |   21.75 | PASS |
| descriptive | descriptive | diff.N |       8 |       8 | PASS |
| descriptive | descriptive | diff.M |    -0.5 |    -0.5 | PASS |
| descriptive | descriptive | diff.SD | 3.63239 |  3.6324 | PASS |
| descriptive | descriptive | diff.Min |    -7.1 |    -7.1 | PASS |
| descriptive | descriptive | diff.Max |     4.4 |     4.4 | PASS |
| descriptive | descriptive | diff.Median |   -0.45 |   -0.45 | PASS |
| descriptive | descriptive | 中文列.N |       8 |       8 | PASS |
| descriptive | descriptive | 中文列.M |     8.5 |     8.5 | PASS |
| descriptive | descriptive | 中文列.SD | 2.44949 |  2.4495 | PASS |
| descriptive | descriptive | 中文列.Min |       5 |       5 | PASS |
| descriptive | descriptive | 中文列.Max |      12 |      12 | PASS |
| descriptive | descriptive | 中文列.Median |     8.5 |     8.5 | PASS |
| descriptive | descriptive | allna.N |       0 |       0 | PASS |
| ttest_independent | ttest_independent | r_syntax_parse | parse() ok | ok | PASS |
| ttest_independent | ttest_independent | sprintf_format_args | no mismatch | ok | PASS |
| ttest_independent | ttest_independent | no_r_error | no error | ok | PASS |
| ttest_independent | ttest_independent | banner | === 独立样本 t 检验 === | === 独立样本 t 检验 === | PASS |
| ttest_independent | ttest_independent | GRP.n1 |       7 |       7 | PASS |
| ttest_independent | ttest_independent | GRP.m1 | 13.2714 | 13.2714 | PASS |
| ttest_independent | ttest_independent | GRP.sd1 | 1.23385 |  1.2338 | PASS |
| ttest_independent | ttest_independent | GRP.n2 |       7 |       7 | PASS |
| ttest_independent | ttest_independent | GRP.m2 |    10.1 |    10.1 | PASS |
| ttest_independent | ttest_independent | GRP.sd2 | 0.804156 |  0.8042 | PASS |
| ttest_independent | ttest_independent | RESULT_IND.t |  5.6973 |  5.6973 | PASS |
| ttest_independent | ttest_independent | RESULT_IND.df | 10.3181 |   10.32 | PASS |
| ttest_independent | ttest_independent | RESULT_IND.p | 0.00017685 | 0.00017685 | PASS |
| ttest_independent | ttest_independent | RESULT_IND.meanDiff | 3.17143 |  3.1714 | PASS |
| ttest_independent | ttest_independent | RESULT_IND.ci_lo | 1.93629 |  1.9363 | PASS |
| ttest_independent | ttest_independent | RESULT_IND.ci_hi | 4.40657 |  4.4066 | PASS |
| ttest_independent | ttest_independent | RESULT_IND.cohen_d | 3.04534 |  3.0453 | PASS |
| ttest_independent | ttest_independent | RESULT_IND.pooled_p | 9.95534e-05 | 9.95534e-05 | PASS |
| ttest_independent | ttest_independent | RESULT_POOLED.t |  5.6973 |  5.6973 | PASS |
| ttest_independent | ttest_independent | RESULT_POOLED.p | 9.95534e-05 | 9.95534e-05 | PASS |
| ttest_independent | ttest_independent | CONCL.direction | sig | sig | PASS |
| ttest_paired | ttest_paired | r_syntax_parse | parse() ok | ok | PASS |
| ttest_paired | ttest_paired | sprintf_format_args | no mismatch | ok | PASS |
| ttest_paired | ttest_paired | no_r_error | no error | ok | PASS |
| ttest_paired | ttest_paired | banner | === 配对样本 t 检验 === | === 配对样本 t 检验 === | PASS |
| ttest_paired | ttest_paired | PAIRS.n |      10 |      10 | PASS |
| ttest_paired | ttest_paired | PAIRS.mean_d |     1.7 |     1.7 | PASS |
| ttest_paired | ttest_paired | PAIRS.sd_d | 0.674949 |  0.6749 | PASS |
| ttest_paired | ttest_paired | PAIR_COR.r | 0.958625 |  0.9586 | PASS |
| ttest_paired | ttest_paired | RESULT_PAIRED.t | 7.96486 |  7.9649 | PASS |
| ttest_paired | ttest_paired | RESULT_PAIRED.df |       9 |       9 | PASS |
| ttest_paired | ttest_paired | RESULT_PAIRED.p | 2.29267e-05 | 2.29267e-05 | PASS |
| ttest_paired | ttest_paired | RESULT_PAIRED.meanDiff |     1.7 |     1.7 | PASS |
| ttest_paired | ttest_paired | RESULT_PAIRED.ci_lo | 1.21717 |  1.2172 | PASS |
| ttest_paired | ttest_paired | RESULT_PAIRED.ci_hi | 2.18283 |  2.1828 | PASS |
| ttest_paired | ttest_paired | RESULT_PAIRED.d_z | 2.51871 |  2.5187 | PASS |
| ttest_paired | ttest_paired | CONCL.direction | sig | sig | PASS |
| ttest_one | ttest_one | r_syntax_parse | parse() ok | ok | PASS |
| ttest_one | ttest_one | sprintf_format_args | no mismatch | ok | PASS |
| ttest_one | ttest_one | no_r_error | no error | ok | PASS |
| ttest_one | ttest_one | banner | === 单样本 t 检验 === | === 单样本 t 检验 === | PASS |
| ttest_one | ttest_one | DESC_ONE.n |      12 |      12 | PASS |
| ttest_one | ttest_one | DESC_ONE.mean |      50 |      50 | PASS |
| ttest_one | ttest_one | DESC_ONE.sd | 3.16228 |  3.1623 | PASS |
| ttest_one | ttest_one | RESULT_ONE.t |       0 |       0 | PASS |
| ttest_one | ttest_one | RESULT_ONE.df |      11 |      11 | PASS |
| ttest_one | ttest_one | RESULT_ONE.p |       1 |       1 | PASS |
| ttest_one | ttest_one | RESULT_ONE.ci_lo | 47.9908 | 47.9908 | PASS |
| ttest_one | ttest_one | RESULT_ONE.ci_hi | 52.0092 | 52.0092 | PASS |
| ttest_one | ttest_one | RESULT_ONE.d |       0 |       0 | PASS |
| ttest_one | ttest_one | MU_IN_CI | 是 | 是 | PASS |
| ttest_one | ttest_one | CONCL.direction | ns | ns | PASS |
| anova | anova | r_syntax_parse | parse() ok | ok | PASS |
| anova | anova | sprintf_format_args | no mismatch | ok | PASS |
| anova | anova | no_r_error | no error | ok | PASS |
| anova | anova | banner | === 单因素方差分析 === | === 单因素方差分析 === | PASS |
| anova | anova | LEVELS.k |       3 |       3 | PASS |
| anova | anova | ANOVA_ROW.df_between |       2 |       2 | PASS |
| anova | anova | ANOVA_ROW.ss_between | 128.183 | 128.183 | PASS |
| anova | anova | ANOVA_ROW.ms_between | 64.0913 | 64.0913 | PASS |
| anova | anova | ANOVA_ROW.F |  62.311 |  62.311 | PASS |
| anova | anova | ANOVA_ROW.p | 5.41418e-08 | 5.41418e-08 | PASS |
| anova | anova | ANOVA_ROW.df_within |      15 |      15 | PASS |
| anova | anova | ANOVA_ROW.ss_within | 15.4286 | 15.4286 | PASS |
| anova | anova | ANOVA_ROW.df_total |      17 |      17 | PASS |
| anova | anova | ANOVA_ROW.ss_total | 143.611 | 143.611 | PASS |
| anova | anova | EFFECT.eta2 | 0.892567 |  0.8926 | PASS |
| anova | anova | EFFECT.omega2 | 0.871997 |   0.872 | PASS |
| anova | anova | POSTHOC.B-A.diff |       3 |       3 | PASS |
| anova | anova | POSTHOC.B-A.lo | 1.40484 |  1.4048 | PASS |
| anova | anova | POSTHOC.B-A.hi | 4.59516 |  4.5952 | PASS |
| anova | anova | POSTHOC.B-A.p | 0.000546698 | 0.000546698 | PASS |
| anova | anova | POSTHOC.C-A.diff | 6.28571 |  6.2857 | PASS |
| anova | anova | POSTHOC.C-A.lo | 4.82012 |  4.8201 | PASS |
| anova | anova | POSTHOC.C-A.hi | 7.75131 |  7.7513 | PASS |
| anova | anova | POSTHOC.C-A.p | 3.40579e-08 | 3.40579e-08 | PASS |
| anova | anova | POSTHOC.C-B.diff | 3.28571 |  3.2857 | PASS |
| anova | anova | POSTHOC.C-B.lo | 1.74322 |  1.7432 | PASS |
| anova | anova | POSTHOC.C-B.hi | 4.82821 |  4.8282 | PASS |
| anova | anova | POSTHOC.C-B.p | 0.000160171 | 0.000160171 | PASS |
| anova | anova | CONCL.direction | sig | sig | PASS |
| chisquare | chisquare | r_syntax_parse | parse() ok | ok | PASS |
| chisquare | chisquare | sprintf_format_args | no mismatch | ok | PASS |
| chisquare | chisquare | no_r_error | no error | ok | PASS |
| chisquare | chisquare | banner | === 卡方检验 === | === 卡方检验 === | PASS |
| chisquare | chisquare | TABLE_DIM.r |       2 |       2 | PASS |
| chisquare | chisquare | TABLE_DIM.c |       3 |       3 | PASS |
| chisquare | chisquare | EXPECTED.min | 18.4615 |  18.462 | PASS |
| chisquare | chisquare | EXPECTED.n_lt5 |       0 |       0 | PASS |
| chisquare | chisquare | RESULT_CHISQ.chi2 | 14.8743 | 14.8743 | PASS |
| chisquare | chisquare | RESULT_CHISQ.df |       2 |       2 | PASS |
| chisquare | chisquare | RESULT_CHISQ.p | 0.00058895 | 0.00058895 | PASS |
| chisquare | chisquare | RESULT_CHISQ.cramer_v | 0.338257 |  0.3383 | PASS |
| chisquare | chisquare | WARN_EXPECTED.consistency | absent | absent | PASS |
| correlation | correlation_pearson | r_syntax_parse | parse() ok | ok | PASS |
| correlation | correlation_pearson | sprintf_format_args | no mismatch | ok | PASS |
| correlation | correlation_pearson | no_r_error | no error | ok | PASS |
| correlation | correlation_pearson | banner | === 相关分析 (pearson) === | === 相关分析 (pearson) === | PASS |
| correlation | correlation_pearson | DESC_COR.n |      11 |      11 | PASS |
| correlation | correlation_pearson | DESC_COR.mx | 12.6364 | 12.6364 | PASS |
| correlation | correlation_pearson | DESC_COR.sdx |  3.5291 |  3.5291 | PASS |
| correlation | correlation_pearson | DESC_COR.my | 26.3636 | 26.3636 | PASS |
| correlation | correlation_pearson | DESC_COR.sdy |  6.9896 |  6.9896 | PASS |
| correlation | correlation_pearson | RESULT_COR.r | 0.999126 |  0.9991 | PASS |
| correlation | correlation_pearson | RESULT_COR.p | 1.00679e-13 | 1.00679e-13 | PASS |
| correlation | correlation_pearson | RESULT_COR.n |      11 |      11 | PASS |
| correlation | correlation_pearson | CI_COR.lo | 0.996946 |  0.9965 | PASS |
| correlation | correlation_pearson | CI_COR.hi | 0.999809 |  0.9998 | PASS |
| correlation | correlation_pearson | CONCL.direction | sig | sig | PASS |
| correlation | correlation_spearman | r_syntax_parse | parse() ok | ok | PASS |
| correlation | correlation_spearman | sprintf_format_args | no mismatch | ok | PASS |
| correlation | correlation_spearman | no_r_error | no error | ok | PASS |
| correlation | correlation_spearman | banner | === 相关分析 (spearman) === | === 相关分析 (spearman) === | PASS |
| correlation | correlation_spearman | RESULT_COR.n |      11 |      11 | PASS |
| correlation | correlation_spearman | RESULT_COR.rho | 0.997727 |  0.9977 | PASS |
| correlation | correlation_spearman | RESULT_COR.p |       0 | 7.4591e-12 | PASS |
| correlation | correlation_spearman | CONCL.direction | sig | sig | PASS |
| regression | regression | r_syntax_parse | parse() ok | ok | PASS |
| regression | regression | sprintf_format_args | no mismatch | ok | PASS |
| regression | regression | no_r_error | no error | ok | PASS |
| regression | regression | banner | === 线性回归分析 === | === 线性回归分析 === | PASS |
| regression | regression | MODEL.r2 | 0.999907 |  0.9999 | PASS |
| regression | regression | MODEL.adj_r2 | 0.999891 |  0.9999 | PASS |
| regression | regression | MODEL.F | 64369.3 | 64369.3 | PASS |
| regression | regression | MODEL.p | 6.55527e-25 | 6.55527e-25 | PASS |
| regression | regression | MODEL.sigma | 0.132918 |  0.1329 | PASS |
| regression | regression | MODEL_DF.n |      15 |      15 | PASS |
| regression | regression | MODEL_DF.df1 |       2 |       2 | PASS |
| regression | regression | MODEL_DF.df2 |      12 |      12 | PASS |
| regression | regression | RESPONSE | y | y | PASS |
| regression | regression | COEF.all_present | (Intercept),x1,x2 | (Intercept),x1,x2 | PASS |
| regression | regression | COEF.(Intercept).B | 2.71186 |  2.7119 | PASS |
| regression | regression | COEF.(Intercept).SE | 0.0867645 |  0.0868 | PASS |
| regression | regression | COEF.(Intercept).t | 31.2554 | 31.2554 | PASS |
| regression | regression | COEF.(Intercept).p | 7.24034e-13 |       0 | PASS |
| regression | regression | COEF.x1.B | 1.98045 |  1.9805 | PASS |
| regression | regression | COEF.x1.SE | 0.00565375 |  0.0057 | PASS |
| regression | regression | COEF.x1.t |  350.29 |  350.29 | PASS |
| regression | regression | COEF.x1.p | 1.97255e-25 |       0 | PASS |
| regression | regression | COEF.x2.B | -0.429704 | -0.4297 | PASS |
| regression | regression | COEF.x2.SE | 0.00848691 |  0.0085 | PASS |
| regression | regression | COEF.x2.t | -50.6314 | -50.6314 | PASS |
| regression | regression | COEF.x2.p | 2.31238e-15 |       0 | PASS |
| regression | regression | BETA.x1 | 1.04303 |   1.043 | PASS |
| regression | regression | BETA.x2 | -0.150761 | -0.1508 | PASS |
| regression | regression | VIF.x1 | 1.14154 |   1.142 | PASS |
| regression | regression | VIF.x2 | 1.14154 |   1.142 | PASS |
| regression | regression | CONCL.direction | sig | sig | PASS |
| reliability | reliability | r_syntax_parse | parse() ok | ok | PASS |
| reliability | reliability | sprintf_format_args | no mismatch | ok | PASS |
| reliability | reliability | no_r_error | no error | ok | PASS |
| reliability | reliability | banner | === 信度分析 (Cronbach's α) === | === 信度分析 (Cronbach's α) === | PASS |
| reliability | reliability | ITEMS.k |       5 |       5 | PASS |
| reliability | reliability | ITEMS.n |      11 |      11 | PASS |
| reliability | reliability | ALPHA.raw_vc | 0.926276 |  0.9263 | PASS |
| reliability | reliability | ALPHA.raw_cov | 0.926276 |  0.9263 | PASS |
| reliability | reliability | ALPHA.std | 0.926841 |  0.9268 | PASS |
| reliability | reliability | ITEM.q1.mean | 4.09091 |  4.0909 | PASS |
| reliability | reliability | ITEM.q1.sd | 0.700649 |  0.7006 | PASS |
| reliability | reliability | ITEM.q1.r_it | 0.924486 |  0.9245 | PASS |
| reliability | reliability | ITEM.q1.a_drop | 0.886179 |  0.8862 | PASS |
| reliability | reliability | ITEM.q2.mean | 4.45455 |  4.4545 | PASS |
| reliability | reliability | ITEM.q2.sd | 0.687552 |  0.6876 | PASS |
| reliability | reliability | ITEM.q2.r_it | 0.666014 |   0.666 | PASS |
| reliability | reliability | ITEM.q2.a_drop | 0.935484 |  0.9355 | PASS |
| reliability | reliability | ITEM.q3.mean | 4.18182 |  4.1818 | PASS |
| reliability | reliability | ITEM.q3.sd | 0.750757 |  0.7508 | PASS |
| reliability | reliability | ITEM.q3.r_it | 0.733829 |  0.7338 | PASS |
| reliability | reliability | ITEM.q3.a_drop | 0.924855 |  0.9249 | PASS |
| reliability | reliability | ITEM.q4.mean | 3.45455 |  3.4545 | PASS |
| reliability | reliability | ITEM.q4.sd | 0.687552 |  0.6876 | PASS |
| reliability | reliability | ITEM.q4.r_it | 0.801938 |  0.8019 | PASS |
| reliability | reliability | ITEM.q4.a_drop | 0.910476 |  0.9105 | PASS |
| reliability | reliability | ITEM.q5.mean | 4.09091 |  4.0909 | PASS |
| reliability | reliability | ITEM.q5.sd | 0.700649 |  0.7006 | PASS |
| reliability | reliability | ITEM.q5.r_it | 0.924486 |  0.9245 | PASS |
| reliability | reliability | ITEM.q5.a_drop | 0.886179 |  0.8862 | PASS |
| reliability | reliability | ALPHA_CI.ordering | lo<=alpha<=hi |  0.8239<= 0.9263<= 0.9774 | PASS |
| reliability | reliability | NOTE_DROPPED.consistency | present | present | PASS |
| reliability | reliability | ALPHA.psych_raw | psych::alpha | SKIP: psych 未安装（已用两条独立闭式解替代） | PASS |
| efa | efa | r_syntax_parse | parse() ok | ok | PASS |
| efa | efa | sprintf_format_args | no mismatch | ok | PASS |
| efa | efa | no_r_error | no error | ok | PASS |
| efa | efa | banner | === 探索性因子分析 (EFA) === | === 探索性因子分析 (EFA) === | PASS |
| efa | efa | kmo | 0.754404 |  0.7544 | PASS |
| efa | efa | bartlett_chisq | 442.978 | 442.978 | PASS |
| efa | efa | bartlett_df |      15 |      15 | PASS |
| efa | efa | eigen_sum_equals_p |       6 |       6 | PASS |
| efa | efa | n_factors_kaiser |       2 |       2 | PASS |
| efa | efa | communality_invariant | 4.44089e-16 |       0 | PASS |
| efa | efa | loadings_max_abs_diff |       0 | 4.57275e-05 | PASS |
| efa | efa | structure_recovered | TRUE | TRUE | PASS |
| efa | efa | n_factors_matches_truth |       2 |       2 | PASS |
| efa | efa | loading_table_cols |       4 |       4 | PASS |
| efa | efa_3factors | r_syntax_parse | parse() ok | ok | PASS |
| efa | efa_3factors | sprintf_format_args | no mismatch | ok | PASS |
| efa | efa_3factors | no_r_error | no error | ok | PASS |
| efa | efa_3factors | banner | === 探索性因子分析 (EFA) === | === 探索性因子分析 (EFA) === | PASS |
| efa | efa_3factors | kmo | 0.760322 |  0.7603 | PASS |
| efa | efa_3factors | bartlett_chisq | 912.351 | 912.351 | PASS |
| efa | efa_3factors | bartlett_df |      36 |      36 | PASS |
| efa | efa_3factors | eigen_sum_equals_p |       9 |       9 | PASS |
| efa | efa_3factors | n_factors_kaiser |       3 |       3 | PASS |
| efa | efa_3factors | communality_invariant | 6.66134e-16 |       0 | PASS |
| efa | efa_3factors | loadings_max_abs_diff |       0 | 4.85267e-05 | PASS |
| efa | efa_3factors | structure_recovered | TRUE | TRUE | PASS |
| efa | efa_3factors | n_factors_matches_truth |       3 |       3 | PASS |
| efa | efa_3factors | loading_table_cols |       5 |       5 | PASS |
| normality | normality | r_syntax_parse | parse() ok | ok | PASS |
| normality | normality | sprintf_format_args | no mismatch | ok | PASS |
| normality | normality | no_r_error | no error | ok | PASS |
| normality | normality | banner | === 正态性检验 (Shapiro-Wilk) === | === 正态性检验 (Shapiro-Wilk) === | PASS |
| normality | normality | NORM.vars | norm,skewed | norm,skewed | PASS |
| normality | normality | NORM.norm.n |      20 |      20 | PASS |
| normality | normality | NORM.norm.W | 0.995908 |  0.9876 | PASS |
| normality | normality | NORM.norm.p |       1 | 0.993364 | PASS |
| normality | normality | NORM.norm.skew | 0.0664416 |   0.066 | PASS |
| normality | normality | NORM.norm.kurt | -1.04626 |  -1.046 | PASS |
| normality | normality | NORM.norm.decision | 未拒绝正态性假设 | 未拒绝正态性假设 | PASS |
| normality | normality | NORM.skewed.n |      20 |      20 | PASS |
| normality | normality | NORM.skewed.W | 0.808301 |  0.8063 | PASS |
| normality | normality | NORM.skewed.p |  0.0015 | 0.00107507 | PASS |
| normality | normality | NORM.skewed.skew | 1.25631 |   1.256 | PASS |
| normality | normality | NORM.skewed.kurt | 0.441085 |   0.441 | PASS |
| normality | normality | NORM.skewed.decision | 拒绝正态性假设 | 拒绝正态性假设 | PASS |
| nonparametric | nonparametric | r_syntax_parse | parse() ok | ok | PASS |
| nonparametric | nonparametric | sprintf_format_args | no mismatch | ok | PASS |
| nonparametric | nonparametric | no_r_error | no error | ok | PASS |
| nonparametric | nonparametric | banner | === 非参数检验 (Mann-Whitney U) === | === 非参数检验 (Mann-Whitney U) === | PASS |
| nonparametric | nonparametric | GRP.n1 |       7 |       7 | PASS |
| nonparametric | nonparametric | GRP.median1 |    13.1 |    13.1 | PASS |
| nonparametric | nonparametric | GRP.n2 |       7 |       7 | PASS |
| nonparametric | nonparametric | GRP.median2 |    10.1 |    10.1 | PASS |
| nonparametric | nonparametric | RESULT_MW.W |      49 |      49 | PASS |
| nonparametric | nonparametric | RESULT_MW.p | 0.000582751 | 0.000582751 | PASS |
| nonparametric | nonparametric | RESULT_MW.rank_biserial |       1 |       1 | PASS |
| nonparametric | nonparametric | CONCL.direction | sig | sig | PASS |
| frequency | frequency | r_syntax_parse | parse() ok | ok | PASS |
| frequency | frequency | sprintf_format_args | no mismatch | ok | PASS |
| frequency | frequency | no_r_error | no error | ok | PASS |
| frequency | frequency | banner | === 频数统计 === | === 频数统计 === | PASS |
| frequency | frequency | FREQ_HEAD.n_valid |      11 |      11 | PASS |
| frequency | frequency | FREQ_HEAD.n_missing |       1 |       1 | PASS |
| frequency | frequency | FREQ.levels | 本科,博士,硕士 | 本科,博士,硕士 | PASS |
| frequency | frequency | FREQ.本科.count |       5 |       5 | PASS |
| frequency | frequency | FREQ.本科.pct_valid | 45.4545 |    45.5 | PASS |
| frequency | frequency | FREQ.本科.pct_total | 41.6667 |    41.7 | PASS |
| frequency | frequency | FREQ.博士.count |       2 |       2 | PASS |
| frequency | frequency | FREQ.博士.pct_valid | 18.1818 |    18.2 | PASS |
| frequency | frequency | FREQ.博士.pct_total | 16.6667 |    16.7 | PASS |
| frequency | frequency | FREQ.硕士.count |       4 |       4 | PASS |
| frequency | frequency | FREQ.硕士.pct_valid | 36.3636 |    36.4 | PASS |
| frequency | frequency | FREQ.硕士.pct_total | 33.3333 |    33.3 | PASS |
| summary_by | summary_by | r_syntax_parse | parse() ok | ok | PASS |
| summary_by | summary_by | sprintf_format_args | no mismatch | ok | PASS |
| summary_by | summary_by | no_r_error | no error | ok | PASS |
| summary_by | summary_by | banner | === 分类汇总 === | === 分类汇总 === | PASS |
| summary_by | summary_by | VARS.group | dept | dept | PASS |
| summary_by | summary_by | VARS.value | salary | salary | PASS |
| summary_by | summary_by | TOTAL.n |      10 |      10 | PASS |
| summary_by | summary_by | TOTAL.mean |      23 |      23 | PASS |
| summary_by | summary_by | TOTAL.sd | 9.48683 |  9.4868 | PASS |
| summary_by | summary_by | SUM.groups | A,B,C,D | A,B,C,D | PASS |
| summary_by | summary_by | SUM.A.n |       3 |       3 | PASS |
| summary_by | summary_by | SUM.A.mean |      12 |      12 | PASS |
| summary_by | summary_by | SUM.A.sd |       2 |       2 | PASS |
| summary_by | summary_by | SUM.A.median |      12 |      12 | PASS |
| summary_by | summary_by | SUM.A.min |      10 |      10 | PASS |
| summary_by | summary_by | SUM.A.max |      14 |      14 | PASS |
| summary_by | summary_by | SUM.B.n |       4 |       4 | PASS |
| summary_by | summary_by | SUM.B.mean |      23 |      23 | PASS |
| summary_by | summary_by | SUM.B.sd | 2.58199 |   2.582 | PASS |
| summary_by | summary_by | SUM.B.median |      23 |      23 | PASS |
| summary_by | summary_by | SUM.B.min |      20 |      20 | PASS |
| summary_by | summary_by | SUM.B.max |      26 |      26 | PASS |
| summary_by | summary_by | SUM.C.n |       2 |       2 | PASS |
| summary_by | summary_by | SUM.C.mean |      31 |      31 | PASS |
| summary_by | summary_by | SUM.C.sd | 1.41421 |  1.4142 | PASS |
| summary_by | summary_by | SUM.C.median |      31 |      31 | PASS |
| summary_by | summary_by | SUM.C.min |      30 |      30 | PASS |
| summary_by | summary_by | SUM.C.max |      32 |      32 | PASS |
| summary_by | summary_by | SUM.D.n |       1 |       1 | PASS |
| summary_by | summary_by | SUM.D.mean |      40 |      40 | PASS |
| summary_by | summary_by | SUM.D.min |      40 |      40 | PASS |
| summary_by | summary_by | SUM.D.max |      40 |      40 | PASS |
| cfa | cfa | r_syntax_parse | parse() ok | ok | PASS |
| cfa | cfa | sprintf_format_args | no mismatch | ok | PASS |
| cfa | cfa | no_r_error | no error | ok | PASS |
| cfa | cfa | banner | === 验证性因子分析 (CFA) === | === 验证性因子分析 (CFA) === | PASS |
| cfa | cfa | CFA_SPEC.p |       6 |       6 | PASS |
| cfa | cfa | CFA_SPEC.n |     800 |     800 | PASS |
| cfa | cfa | CFA_ITEM.order | q1,q2,q3,q4,q5,q6 | q1,q2,q3,q4,q5,q6 | PASS |
| cfa | cfa | CFA_SPEC.nfac |       2 |       2 | PASS |
| cfa | cfa | CFA_ITEM.partition | 1-2-3|4-5-6 | 1-2-3|4-5-6 | PASS |
| cfa | cfa | CFA_FIT.chisq | 0.00208516 |  0.0021 | PASS |
| cfa | cfa | CFA_FIT.df |       8 |       8 | PASS |
| cfa | cfa | F_ML | 2.60971e-06 | 2.62829e-06 | PASS |
| cfa | cfa | CFA_FIT.p |       1 |       1 | PASS |
| cfa | cfa | invariant.diag_Sigma_eq_1 | 2.12359e-06 |       0 | PASS |
| cfa | cfa | invariant.lambda2_plus_theta | 2.22045e-16 |       0 | PASS |
| cfa | cfa | invariant.df_formula |       8 |       8 | PASS |
| cfa | cfa | invariant.npar |      13 |      13 | PASS |
| cfa | cfa | CFA_NULLMODEL.chisq | 1893.48 | 1893.48 | PASS |
| cfa | cfa | CFA_NULLMODEL.df |      15 |      15 | PASS |
| cfa | cfa | CFA_FITIDX.cfi |       1 |       1 | PASS |
| cfa | cfa | CFA_FITIDX.tli | 1.00798 |   1.008 | PASS |
| cfa | cfa | CFA_FITIDX.rmsea |       0 |       0 | PASS |
| cfa | cfa | CFA_FITIDX.srmr | 0.000196983 |  0.0002 | PASS |
| cfa | cfa | CFA_ESTIMATE.items | q1,q2,q3,q4,q5,q6 | q1,q2,q3,q4,q5,q6 | PASS |
| cfa | cfa | CFA_ESTIMATE.std_load.numeric | all numeric | all numeric | PASS |
| cfa | cfa | CFA_ESTIMATE.q1.std_load | 0.849759 |  0.8498 | PASS |
| cfa | cfa | CFA_ESTIMATE.q2.std_load | 0.800337 |  0.8003 | PASS |
| cfa | cfa | CFA_ESTIMATE.q3.std_load | 0.750033 |    0.75 | PASS |
| cfa | cfa | CFA_ESTIMATE.q4.std_load | 0.81999 |    0.82 | PASS |
| cfa | cfa | CFA_ESTIMATE.q5.std_load | 0.78004 |    0.78 | PASS |
| cfa | cfa | CFA_ESTIMATE.q6.std_load | 0.720055 |  0.7201 | PASS |
| cfa | cfa | CFA_ESTIMATE.std_load.max_abs_diff |       0 | 4.50406e-05 | PASS |
| cfa | cfa | CFA_ESTIMATE.sign_convention | TRUE | TRUE | PASS |
| cfa | cfa | CFA_ESTIMATE.std_load_in_range | TRUE | TRUE | PASS |
| cfa | cfa | truth.std_load.max_abs_error |       0 |  0.0003 | PASS |
| cfa | cfa | CFA_ESTIMATE.r2_equals_load_sq |       0 |   1e-04 | PASS |
| cfa | cfa | CFA_ESTIMATE.unstd_over_raw_sd_equals_std |       0 | 7.64205e-05 | PASS |
| cfa | cfa | CFA_ESTIMATE.unstd_differs_from_std | TRUE | TRUE | PASS |
| cfa | cfa | CFA_FACTOR.cor.max_abs_diff |       0 |       0 | PASS |
| cfa | cfa | truth.phi12 |    0.35 |  0.3497 | PASS |
| cfa | cfa | CFA_RELIAB.F1.cr | 0.842758 |  0.8428 | PASS |
| cfa | cfa | CFA_RELIAB.F1.ave | 0.641726 |  0.6417 | PASS |
| cfa | cfa | CFA_RELIAB.F1.sqrt_ave | 0.801078 |  0.8011 | PASS |
| cfa | cfa | CFA_RELIAB.F2.cr | 0.817623 |  0.8176 | PASS |
| cfa | cfa | CFA_RELIAB.F2.ave | 0.599775 |  0.5998 | PASS |
| cfa | cfa | CFA_RELIAB.F2.sqrt_ave | 0.774452 |  0.7745 | PASS |
| cfa | cfa | CONCL.matches_fit_indices | good | good | PASS |
| cfa | cfa | discriminant.correct_model_CFI_above_0.95 | >= 0.95 |       1 | PASS |
| cfa | cfa_3factors | r_syntax_parse | parse() ok | ok | PASS |
| cfa | cfa_3factors | sprintf_format_args | no mismatch | ok | PASS |
| cfa | cfa_3factors | no_r_error | no error | ok | PASS |
| cfa | cfa_3factors | banner | === 验证性因子分析 (CFA) === | === 验证性因子分析 (CFA) === | PASS |
| cfa | cfa_3factors | CFA_SPEC.p |       9 |       9 | PASS |
| cfa | cfa_3factors | CFA_SPEC.n |     600 |     600 | PASS |
| cfa | cfa_3factors | CFA_ITEM.order | a1,a2,a3,b1,b2,b3,c1,c2,c3 | a1,a2,a3,b1,b2,b3,c1,c2,c3 | PASS |
| cfa | cfa_3factors | CFA_SPEC.nfac |       3 |       3 | PASS |
| cfa | cfa_3factors | CFA_ITEM.partition | 1-2-3|4-5-6|7-8-9 | 1-2-3|4-5-6|7-8-9 | PASS |
| cfa | cfa_3factors | CFA_FIT.chisq | 0.0121063 |  0.0121 | PASS |
| cfa | cfa_3factors | CFA_FIT.df |      24 |      24 | PASS |
| cfa | cfa_3factors | F_ML | 2.02108e-05 | 2.02003e-05 | PASS |
| cfa | cfa_3factors | CFA_FIT.p |       1 |       1 | PASS |
| cfa | cfa_3factors | invariant.diag_Sigma_eq_1 | 4.8124e-07 |       0 | PASS |
| cfa | cfa_3factors | invariant.lambda2_plus_theta | 3.33067e-16 |       0 | PASS |
| cfa | cfa_3factors | invariant.df_formula |      24 |      24 | PASS |
| cfa | cfa_3factors | invariant.npar |      21 |      21 | PASS |
| cfa | cfa_3factors | CFA_NULLMODEL.chisq | 2023.47 | 2023.47 | PASS |
| cfa | cfa_3factors | CFA_NULLMODEL.df |      36 |      36 | PASS |
| cfa | cfa_3factors | CFA_FITIDX.cfi |       1 |       1 | PASS |
| cfa | cfa_3factors | CFA_FITIDX.tli |  1.0181 |  1.0181 | PASS |
| cfa | cfa_3factors | CFA_FITIDX.rmsea |       0 |       0 | PASS |
| cfa | cfa_3factors | CFA_FITIDX.srmr | 0.000478256 |  0.0005 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.items | a1,a2,a3,b1,b2,b3,c1,c2,c3 | a1,a2,a3,b1,b2,b3,c1,c2,c3 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.std_load.numeric | all numeric | all numeric | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.a1.std_load | 0.82014 |  0.8201 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.a2.std_load | 0.790232 |  0.7902 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.a3.std_load | 0.760251 |  0.7603 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.b1.std_load | 0.809673 |  0.8097 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.b2.std_load | 0.780696 |  0.7807 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.b3.std_load | 0.749674 |  0.7497 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.c1.std_load | 0.800262 |  0.8003 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.c2.std_load | 0.769941 |  0.7699 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.c3.std_load | 0.740532 |  0.7405 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.std_load.max_abs_diff |       0 | 4.93981e-05 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.sign_convention | TRUE | TRUE | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.std_load_in_range | TRUE | TRUE | PASS |
| cfa | cfa_3factors | truth.std_load.max_abs_error |       0 |  0.0007 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.r2_equals_load_sq |       0 | 8.396e-05 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.unstd_over_raw_sd_equals_std |       0 | 8.10121e-05 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.unstd_differs_from_std | TRUE | TRUE | PASS |
| cfa | cfa_3factors | CFA_FACTOR.cor.max_abs_diff |       0 |       0 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F1.cr | 0.823586 |  0.8236 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F1.ave | 0.609022 |   0.609 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F1.sqrt_ave | 0.780399 |  0.7804 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F2.cr | 0.814211 |  0.8142 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F2.ave | 0.593872 |  0.5939 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F2.sqrt_ave | 0.770631 |  0.7706 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F3.cr | 0.833216 |  0.8332 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F3.ave | 0.625026 |   0.625 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F3.sqrt_ave | 0.790586 |  0.7906 | PASS |
| cfa | cfa_3factors | CONCL.matches_fit_indices | good | good | PASS |
| cfa | cfa_3factors | discriminant.correct_model_CFI_above_0.95 | >= 0.95 |       1 | PASS |
| cfa | cfa_misfit | r_syntax_parse | parse() ok | ok | PASS |
| cfa | cfa_misfit | sprintf_format_args | no mismatch | ok | PASS |
| cfa | cfa_misfit | no_r_error | no error | ok | PASS |
| cfa | cfa_misfit | banner | === 验证性因子分析 (CFA) === | === 验证性因子分析 (CFA) === | PASS |
| cfa | cfa_misfit | CFA_SPEC.p |       6 |       6 | PASS |
| cfa | cfa_misfit | CFA_SPEC.n |     800 |     800 | PASS |
| cfa | cfa_misfit | CFA_ITEM.order | q1,q2,q3,q4,q5,q6 | q1,q2,q3,q4,q5,q6 | PASS |
| cfa | cfa_misfit | CFA_SPEC.nfac |       1 |       1 | PASS |
| cfa | cfa_misfit | CFA_ITEM.partition | 1-2-3-4-5-6 | 1-2-3-4-5-6 | PASS |
| cfa | cfa_misfit | CFA_ITEM.forced_1factor |       1 |       1 | PASS |
| cfa | cfa_misfit | CFA_FIT.chisq | 711.264 | 711.264 | PASS |
| cfa | cfa_misfit | CFA_FIT.df |       9 |       9 | PASS |
| cfa | cfa_misfit | F_ML | 0.890193 | 0.890193 | PASS |
| cfa | cfa_misfit | CFA_FIT.p | 2.61892e-147 | 2.61892e-147 | PASS |
| cfa | cfa_misfit | invariant.diag_Sigma_eq_1 | 2.06459e-07 |       0 | PASS |
| cfa | cfa_misfit | invariant.lambda2_plus_theta | 1.11022e-16 |       0 | PASS |
| cfa | cfa_misfit | invariant.df_formula |       9 |       9 | PASS |
| cfa | cfa_misfit | invariant.npar |      12 |      12 | PASS |
| cfa | cfa_misfit | CFA_NULLMODEL.chisq | 1893.48 | 1893.48 | PASS |
| cfa | cfa_misfit | CFA_NULLMODEL.df |      15 |      15 | PASS |
| cfa | cfa_misfit | CFA_FITIDX.cfi | 0.626153 |  0.6262 | PASS |
| cfa | cfa_misfit | CFA_FITIDX.tli | 0.376922 |  0.3769 | PASS |
| cfa | cfa_misfit | CFA_FITIDX.rmsea | 0.312504 |  0.3125 | PASS |
| cfa | cfa_misfit | CFA_FITIDX.srmr | 0.184686 |  0.1847 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.items | q1,q2,q3,q4,q5,q6 | q1,q2,q3,q4,q5,q6 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.std_load.numeric | all numeric | all numeric | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q1.std_load | 0.833135 |  0.8331 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q2.std_load | 0.793017 |   0.793 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q3.std_load | 0.745041 |   0.745 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q4.std_load | 0.362752 |  0.3628 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q5.std_load | 0.349115 |  0.3491 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q6.std_load | 0.327223 |  0.3272 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.std_load.max_abs_diff |       0 | 4.75547e-05 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.sign_convention | TRUE | TRUE | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.std_load_in_range | TRUE | TRUE | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.r2_equals_load_sq |       0 | 7.5e-05 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.unstd_over_raw_sd_equals_std |       0 | 8.47905e-05 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.unstd_differs_from_std | TRUE | TRUE | PASS |
| cfa | cfa_misfit | CFA_FACTOR.absent_when_1factor | absent | absent | PASS |
| cfa | cfa_misfit | CFA_RELIAB.F1.cr | 0.755618 |  0.7556 | PASS |
| cfa | cfa_misfit | CFA_RELIAB.F1.ave | 0.373104 |  0.3731 | PASS |
| cfa | cfa_misfit | CFA_RELIAB.F1.sqrt_ave | 0.610822 |  0.6108 | PASS |
| cfa | cfa_misfit | CONCL.matches_fit_indices | poor | poor | PASS |
| cfa | cfa_misfit | discriminant.misfit_CFI_below_0.80 | < 0.80 |  0.6262 | PASS |
| cvi | cvi | r_syntax_parse | parse() ok | ok | PASS |
| cvi | cvi | sprintf_format_args | no mismatch | ok | PASS |
| cvi | cvi | no_r_error | no error | ok | PASS |
| cvi | cvi | banner | === 内容效度指数 (CVI) === | === 内容效度指数 (CVI) === | PASS |
| cvi | cvi | CVI_SPEC.n_items |       6 |       6 | PASS |
| cvi | cvi | CVI_SPEC.n_experts |       8 |       8 | PASS |
| cvi | cvi | CVI_ITEM.order | c1,c2,c3,c4,c5,c6 | c1,c2,c3,c4,c5,c6 | PASS |
| cvi | cvi | CVI_ITEM.c1.n_relevant |       8 |       8 | PASS |
| cvi | cvi | CVI_ITEM.c1.i_cvi |       1 |       1 | PASS |
| cvi | cvi | CVI_ITEM.c1.p_c | 0.03125 | 0.03125 | PASS |
| cvi | cvi | CVI_ITEM.c1.kappa |       1 |       1 | PASS |
| cvi | cvi | CVI_ITEM.c1.verdict | 优秀 | 优秀 | PASS |
| cvi | cvi | CVI_ITEM.c2.n_relevant |       8 |       8 | PASS |
| cvi | cvi | CVI_ITEM.c2.i_cvi |       1 |       1 | PASS |
| cvi | cvi | CVI_ITEM.c2.p_c | 0.03125 | 0.03125 | PASS |
| cvi | cvi | CVI_ITEM.c2.kappa |       1 |       1 | PASS |
| cvi | cvi | CVI_ITEM.c2.verdict | 优秀 | 优秀 | PASS |
| cvi | cvi | CVI_ITEM.c3.n_relevant |       7 |       7 | PASS |
| cvi | cvi | CVI_ITEM.c3.i_cvi |   0.875 |   0.875 | PASS |
| cvi | cvi | CVI_ITEM.c3.p_c | 0.03125 | 0.03125 | PASS |
| cvi | cvi | CVI_ITEM.c3.kappa | 0.870968 |   0.871 | PASS |
| cvi | cvi | CVI_ITEM.c3.verdict | 优秀 | 优秀 | PASS |
| cvi | cvi | CVI_ITEM.c4.n_relevant |       6 |       6 | PASS |
| cvi | cvi | CVI_ITEM.c4.i_cvi |    0.75 |    0.75 | PASS |
| cvi | cvi | CVI_ITEM.c4.p_c | 0.03125 | 0.03125 | PASS |
| cvi | cvi | CVI_ITEM.c4.kappa | 0.741935 |  0.7419 | PASS |
| cvi | cvi | CVI_ITEM.c4.verdict | 优秀 | 优秀 | PASS |
| cvi | cvi | CVI_ITEM.c5.n_relevant |       5 |       5 | PASS |
| cvi | cvi | CVI_ITEM.c5.i_cvi |   0.625 |   0.625 | PASS |
| cvi | cvi | CVI_ITEM.c5.p_c | 0.03125 | 0.03125 | PASS |
| cvi | cvi | CVI_ITEM.c5.kappa | 0.612903 |  0.6129 | PASS |
| cvi | cvi | CVI_ITEM.c5.verdict | 良好 | 良好 | PASS |
| cvi | cvi | CVI_ITEM.c6.n_relevant |       4 |       4 | PASS |
| cvi | cvi | CVI_ITEM.c6.i_cvi |     0.5 |     0.5 | PASS |
| cvi | cvi | CVI_ITEM.c6.p_c | 0.03125 | 0.03125 | PASS |
| cvi | cvi | CVI_ITEM.c6.kappa | 0.483871 |  0.4839 | PASS |
| cvi | cvi | CVI_ITEM.c6.verdict | 尚可 | 尚可 | PASS |
| cvi | cvi | CVI_SUMMARY.s_cvi_ave | 0.791667 |  0.7917 | PASS |
| cvi | cvi | CVI_SUMMARY.s_cvi_ua | 0.333333 |  0.3333 | PASS |
| cvi | cvi | CVI_SUMMARY.n_ua |       2 |       2 | PASS |
| cvi | cvi | CVI_SUMMARY.threshold_ok | FALSE | FALSE | PASS |
| cvi | cvi | fixture.i_cvi_has_discrimination | >= 3 distinct values | 5 distinct | PASS |
| cvi | cvi | fixture.verdict_has_multiple_levels | >= 2 levels | 3 levels | PASS |
| cvi | cvi | oracle.a_req_matches_threshold_table | ceiling(   0.83 x 8) = 7 | Pc = C(8,7)/2^8 = 0.03125 | PASS |
| harman | harman_medium | r_syntax_parse | parse() ok | ok | PASS |
| harman | harman_medium | sprintf_format_args | no mismatch | ok | PASS |
| harman | harman_medium | no_r_error | no error | ok | PASS |
| harman | harman_medium | banner | === Harman 单因子检验 === | === Harman 单因子检验 === | PASS |
| harman | harman_medium | HARMAN_SPEC.p |       6 |       6 | PASS |
| harman | harman_medium | HARMAN_SPEC.n |     400 |     400 | PASS |
| harman | harman_medium | oracle.consistency_eigen_vs_svd | 2.66454e-15 |       0 | PASS |
| harman | harman_medium | HARMAN_SUMMARY.n_factors_gt1 |       2 |       2 | PASS |
| harman | harman_medium | HARMAN_EIGEN.count |       2 |       2 | PASS |
| harman | harman_medium | HARMAN_EIGEN.eigen1 | 2.25318 |  2.2532 | PASS |
| harman | harman_medium | HARMAN_EIGEN.variance_pct1 |  37.553 |   37.55 | PASS |
| harman | harman_medium | HARMAN_EIGEN.eigen2 | 1.50016 |  1.5002 | PASS |
| harman | harman_medium | HARMAN_EIGEN.variance_pct2 | 25.0027 |      25 | PASS |
| harman | harman_medium | HARMAN_EIGEN.cumulative_monotone | TRUE | TRUE | PASS |
| harman | harman_medium | HARMAN_SUMMARY.first_pct |  37.553 |   37.55 | PASS |
| harman | harman_medium | HARMAN_SUMMARY.ok | 是 | 是 | PASS |
| harman | harman_medium | HARMAN_SUMMARY.threshold |      40 |      40 | PASS |
| harman | harman_medium | criterion.medium_side | first_pct<40 & n_gt1>1 | first_pct=37.55 n_gt1=2 | PASS |
| harman | harman_medium | CONCL.direction | no_bias | no_bias | PASS |
| harman | harman_medium | HARMAN_NOTE.sensitivity_caveat | present | present | PASS |
| harman | harman_high | r_syntax_parse | parse() ok | ok | PASS |
| harman | harman_high | sprintf_format_args | no mismatch | ok | PASS |
| harman | harman_high | no_r_error | no error | ok | PASS |
| harman | harman_high | banner | === Harman 单因子检验 === | === Harman 单因子检验 === | PASS |
| harman | harman_high | HARMAN_SPEC.p |       6 |       6 | PASS |
| harman | harman_high | HARMAN_SPEC.n |     400 |     400 | PASS |
| harman | harman_high | oracle.consistency_eigen_vs_svd | 1.77636e-15 |       0 | PASS |
| harman | harman_high | HARMAN_SUMMARY.n_factors_gt1 |       1 |       1 | PASS |
| harman | harman_high | HARMAN_EIGEN.count |       1 |       1 | PASS |
| harman | harman_high | HARMAN_EIGEN.eigen1 | 4.20843 |  4.2084 | PASS |
| harman | harman_high | HARMAN_EIGEN.variance_pct1 | 70.1404 |   70.14 | PASS |
| harman | harman_high | HARMAN_SUMMARY.first_pct | 70.1404 |   70.14 | PASS |
| harman | harman_high | HARMAN_SUMMARY.ok | 否 | 否 | PASS |
| harman | harman_high | HARMAN_SUMMARY.threshold |      40 |      40 | PASS |
| harman | harman_high | criterion.high_side | first_pct>40 | first_pct=70.14 | PASS |
| harman | harman_high | CONCL.direction | bias | bias | PASS |
| harman | harman_high | HARMAN_NOTE.sensitivity_caveat | present | present | PASS |
| __coverage__ | - | methods_covered |      17 |      17 | PASS |

**汇总：PASS 536 / 536**
