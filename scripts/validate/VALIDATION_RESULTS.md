# 统计验证结果（真实生成器 + 独立 oracle）

R 版本：R version 4.6.0 (2026-04-24 ucrt)
生成时间：2026-11-03 20:06:52
fixtures 目录：generated
被测代码：src/renderer/src/services/rService.ts（esbuild 打包后运行时调用，非手抄副本）

方法覆盖：**22 / 22**
断言总数：**989**（PASS 989 / FAIL 0）

| 方法 | 数据集 | 断言 | 参考(oracle) | 工作台 | 结果 |
|---|---|---|---|---|---|
| descriptive | descriptive | r_syntax_parse | parse() ok | ok | PASS |
| descriptive | descriptive | sprintf_format_args | no mismatch | ok | PASS |
| descriptive | descriptive | no_r_error | no error | ok | PASS |
| descriptive | descriptive | banner | === 描述性统计 === | === 描述性统计 === | PASS |
| descriptive | descriptive | data_quality.hooked | rwb_read used | ok | PASS |
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
| ttest_independent | ttest_independent | data_quality.hooked | rwb_read used | ok | PASS |
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
| ttest_paired | ttest_paired | data_quality.hooked | rwb_read used | ok | PASS |
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
| ttest_one | ttest_one | data_quality.hooked | rwb_read used | ok | PASS |
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
| anova | anova | data_quality.hooked | rwb_read used | ok | PASS |
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
| chisquare | chisquare | data_quality.hooked | rwb_read used | ok | PASS |
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
| correlation | correlation_pearson | data_quality.hooked | rwb_read used | ok | PASS |
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
| correlation | correlation_spearman | data_quality.hooked | rwb_read used | ok | PASS |
| correlation | correlation_spearman | RESULT_COR.n |      11 |      11 | PASS |
| correlation | correlation_spearman | RESULT_COR.rho | 0.997727 |  0.9977 | PASS |
| correlation | correlation_spearman | RESULT_COR.p |       0 | 7.4591e-12 | PASS |
| correlation | correlation_spearman | CONCL.direction | sig | sig | PASS |
| regression | regression | r_syntax_parse | parse() ok | ok | PASS |
| regression | regression | sprintf_format_args | no mismatch | ok | PASS |
| regression | regression | no_r_error | no error | ok | PASS |
| regression | regression | banner | === 线性回归分析 === | === 线性回归分析 === | PASS |
| regression | regression | data_quality.hooked | rwb_read used | ok | PASS |
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
| reliability | reliability | data_quality.hooked | rwb_read used | ok | PASS |
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
| efa | efa | data_quality.hooked | rwb_read used | ok | PASS |
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
| efa | efa_3factors | data_quality.hooked | rwb_read used | ok | PASS |
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
| normality | normality | data_quality.hooked | rwb_read used | ok | PASS |
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
| nonparametric | nonparametric | data_quality.hooked | rwb_read used | ok | PASS |
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
| frequency | frequency | data_quality.hooked | rwb_read used | ok | PASS |
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
| summary_by | summary_by | data_quality.hooked | rwb_read used | ok | PASS |
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
| cfa | cfa | data_quality.hooked | rwb_read used | ok | PASS |
| cfa | cfa | CFA_SPEC.p |       6 |       6 | PASS |
| cfa | cfa | CFA_SPEC.n |     800 |     800 | PASS |
| cfa | cfa | CFA_ITEM.order | q1,q2,q3,q4,q5,q6 | q1,q2,q3,q4,q5,q6 | PASS |
| cfa | cfa | CFA_SPEC.nfac |       2 |       2 | PASS |
| cfa | cfa | CFA_ITEM.partition | 1-2-3|4-5-6 | 1-2-3|4-5-6 | PASS |
| cfa | cfa | CFA_FIT.chisq | 9.50518e-08 |       0 | PASS |
| cfa | cfa | CFA_FIT.df |       8 |       8 | PASS |
| cfa | cfa | F_ML | 1.18964e-10 |       0 | PASS |
| cfa | cfa | CFA_FIT.p |       1 |       1 | PASS |
| cfa | cfa | invariant.diag_Sigma_eq_1 | 2.12025e-06 |       0 | PASS |
| cfa | cfa | invariant.lambda2_plus_theta | 2.22045e-16 |       0 | PASS |
| cfa | cfa | invariant.df_formula |       8 |       8 | PASS |
| cfa | cfa | invariant.npar |      13 |      13 | PASS |
| cfa | cfa | CFA_NULLMODEL.chisq | 1893.23 | 1893.23 | PASS |
| cfa | cfa | CFA_NULLMODEL.df |      15 |      15 | PASS |
| cfa | cfa | CFA_FITIDX.cfi |       1 |       1 | PASS |
| cfa | cfa | CFA_FITIDX.tli | 1.00799 |   1.008 | PASS |
| cfa | cfa | CFA_FITIDX.rmsea |       0 |       0 | PASS |
| cfa | cfa | CFA_FITIDX.srmr | 1.76889e-06 |       0 | PASS |
| cfa | cfa | CFA_ESTIMATE.items | q1,q2,q3,q4,q5,q6 | q1,q2,q3,q4,q5,q6 | PASS |
| cfa | cfa | CFA_ESTIMATE.std_load.numeric | all numeric | all numeric | PASS |
| cfa | cfa | CFA_ESTIMATE.q1.std_load | 0.849999 |    0.85 | PASS |
| cfa | cfa | CFA_ESTIMATE.q2.std_load |     0.8 |     0.8 | PASS |
| cfa | cfa | CFA_ESTIMATE.q3.std_load | 0.749999 |    0.75 | PASS |
| cfa | cfa | CFA_ESTIMATE.q4.std_load | 0.819998 |    0.82 | PASS |
| cfa | cfa | CFA_ESTIMATE.q5.std_load |    0.78 |    0.78 | PASS |
| cfa | cfa | CFA_ESTIMATE.q6.std_load | 0.720001 |    0.72 | PASS |
| cfa | cfa | CFA_ESTIMATE.std_load.max_abs_diff |       0 | 1.9433e-06 | PASS |
| cfa | cfa | CFA_ESTIMATE.sign_convention | TRUE | TRUE | PASS |
| cfa | cfa | CFA_ESTIMATE.std_load_in_range | TRUE | TRUE | PASS |
| cfa | cfa | truth.std_load.max_abs_error |       0 |       0 | PASS |
| cfa | cfa | CFA_ESTIMATE.r2_equals_load_sq |       0 | 1.11022e-16 | PASS |
| cfa | cfa | CFA_ESTIMATE.unstd_over_raw_sd_equals_std |       0 | 3.97386e-05 | PASS |
| cfa | cfa | CFA_ESTIMATE.unstd_differs_from_std | TRUE | TRUE | PASS |
| cfa | cfa | CFA_FACTOR.cor.max_abs_diff |       0 |       0 | PASS |
| cfa | cfa | truth.phi12 |    0.35 |    0.35 | PASS |
| cfa | cfa | CFA_RELIAB.F1.cr | 0.842721 |  0.8427 | PASS |
| cfa | cfa | CFA_RELIAB.F1.ave | 0.641667 |  0.6417 | PASS |
| cfa | cfa | CFA_RELIAB.F1.sqrt_ave | 0.801041 |   0.801 | PASS |
| cfa | cfa | CFA_RELIAB.F1.cr_ge_ave | CR >= AVE | CR= 0.8427 AVE= 0.6417 | PASS |
| cfa | cfa | CFA_RELIAB.F1.in_unit_interval | 0 < CR <= 1 且 0 < AVE <= 1 | CR= 0.8427 AVE= 0.6417 | PASS |
| cfa | cfa | CFA_RELIAB.F2.cr | 0.817596 |  0.8176 | PASS |
| cfa | cfa | CFA_RELIAB.F2.ave | 0.599733 |  0.5997 | PASS |
| cfa | cfa | CFA_RELIAB.F2.sqrt_ave | 0.774425 |  0.7744 | PASS |
| cfa | cfa | CFA_RELIAB.F2.cr_ge_ave | CR >= AVE | CR= 0.8176 AVE= 0.5997 | PASS |
| cfa | cfa | CFA_RELIAB.F2.in_unit_interval | 0 < CR <= 1 且 0 < AVE <= 1 | CR= 0.8176 AVE= 0.5997 | PASS |
| cfa | cfa | CONCL.matches_fit_indices | good | good | PASS |
| cfa | cfa | discriminant.correct_model_CFI_above_0.95 | >= 0.95 |       1 | PASS |
| cfa | cfa_3factors | r_syntax_parse | parse() ok | ok | PASS |
| cfa | cfa_3factors | sprintf_format_args | no mismatch | ok | PASS |
| cfa | cfa_3factors | no_r_error | no error | ok | PASS |
| cfa | cfa_3factors | banner | === 验证性因子分析 (CFA) === | === 验证性因子分析 (CFA) === | PASS |
| cfa | cfa_3factors | data_quality.hooked | rwb_read used | ok | PASS |
| cfa | cfa_3factors | CFA_SPEC.p |       9 |       9 | PASS |
| cfa | cfa_3factors | CFA_SPEC.n |     600 |     600 | PASS |
| cfa | cfa_3factors | CFA_ITEM.order | a1,a2,a3,b1,b2,b3,c1,c2,c3 | a1,a2,a3,b1,b2,b3,c1,c2,c3 | PASS |
| cfa | cfa_3factors | CFA_SPEC.nfac |       3 |       3 | PASS |
| cfa | cfa_3factors | CFA_ITEM.partition | 1-2-3|4-5-6|7-8-9 | 1-2-3|4-5-6|7-8-9 | PASS |
| cfa | cfa_3factors | CFA_FIT.chisq | 7.4721e-08 |       0 | PASS |
| cfa | cfa_3factors | CFA_FIT.df |      24 |      24 | PASS |
| cfa | cfa_3factors | F_ML | 1.24743e-10 |       0 | PASS |
| cfa | cfa_3factors | CFA_FIT.p |       1 |       1 | PASS |
| cfa | cfa_3factors | invariant.diag_Sigma_eq_1 | 4.88204e-07 |       0 | PASS |
| cfa | cfa_3factors | invariant.lambda2_plus_theta | 2.22045e-16 |       0 | PASS |
| cfa | cfa_3factors | invariant.df_formula |      24 |      24 | PASS |
| cfa | cfa_3factors | invariant.npar |      21 |      21 | PASS |
| cfa | cfa_3factors | CFA_NULLMODEL.chisq | 2021.58 | 2021.58 | PASS |
| cfa | cfa_3factors | CFA_NULLMODEL.df |      36 |      36 | PASS |
| cfa | cfa_3factors | CFA_FITIDX.cfi |       1 |       1 | PASS |
| cfa | cfa_3factors | CFA_FITIDX.tli | 1.01813 |  1.0181 | PASS |
| cfa | cfa_3factors | CFA_FITIDX.rmsea |       0 |       0 | PASS |
| cfa | cfa_3factors | CFA_FITIDX.srmr | 9.82283e-07 |       0 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.items | a1,a2,a3,b1,b2,b3,c1,c2,c3 | a1,a2,a3,b1,b2,b3,c1,c2,c3 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.std_load.numeric | all numeric | all numeric | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.a1.std_load | 0.820004 |    0.82 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.a2.std_load | 0.790001 |    0.79 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.a3.std_load | 0.759998 |    0.76 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.b1.std_load |    0.81 |    0.81 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.b2.std_load |    0.78 |    0.78 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.b3.std_load | 0.750001 |    0.75 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.c1.std_load | 0.799999 |     0.8 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.c2.std_load |    0.77 |    0.77 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.c3.std_load | 0.740001 |    0.74 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.std_load.max_abs_diff |       0 | 4.25018e-06 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.sign_convention | TRUE | TRUE | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.std_load_in_range | TRUE | TRUE | PASS |
| cfa | cfa_3factors | truth.std_load.max_abs_error |       0 |       0 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.r2_equals_load_sq |       0 | 1.11022e-16 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.unstd_over_raw_sd_equals_std |       0 | 4.46966e-05 | PASS |
| cfa | cfa_3factors | CFA_ESTIMATE.unstd_differs_from_std | TRUE | TRUE | PASS |
| cfa | cfa_3factors | CFA_FACTOR.cor.max_abs_diff |       0 |       0 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F1.cr | 0.823572 |  0.8236 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F1.ave |   0.609 |   0.609 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F1.sqrt_ave | 0.780385 |  0.7804 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F1.cr_ge_ave | CR >= AVE | CR= 0.8236 AVE=  0.609 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F1.in_unit_interval | 0 < CR <= 1 且 0 < AVE <= 1 | CR= 0.8236 AVE=  0.609 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F2.cr | 0.813976 |   0.814 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F2.ave |  0.5935 |  0.5935 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F2.sqrt_ave | 0.77039 |  0.7704 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F2.cr_ge_ave | CR >= AVE | CR=  0.814 AVE= 0.5935 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F2.in_unit_interval | 0 < CR <= 1 且 0 < AVE <= 1 | CR=  0.814 AVE= 0.5935 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F3.cr | 0.833022 |   0.833 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F3.ave |  0.6247 |  0.6247 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F3.sqrt_ave | 0.79038 |  0.7904 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F3.cr_ge_ave | CR >= AVE | CR=  0.833 AVE= 0.6247 | PASS |
| cfa | cfa_3factors | CFA_RELIAB.F3.in_unit_interval | 0 < CR <= 1 且 0 < AVE <= 1 | CR=  0.833 AVE= 0.6247 | PASS |
| cfa | cfa_3factors | CONCL.matches_fit_indices | good | good | PASS |
| cfa | cfa_3factors | discriminant.correct_model_CFI_above_0.95 | >= 0.95 |       1 | PASS |
| cfa | cfa_misfit | r_syntax_parse | parse() ok | ok | PASS |
| cfa | cfa_misfit | sprintf_format_args | no mismatch | ok | PASS |
| cfa | cfa_misfit | no_r_error | no error | ok | PASS |
| cfa | cfa_misfit | banner | === 验证性因子分析 (CFA) === | === 验证性因子分析 (CFA) === | PASS |
| cfa | cfa_misfit | data_quality.hooked | rwb_read used | ok | PASS |
| cfa | cfa_misfit | CFA_SPEC.p |       6 |       6 | PASS |
| cfa | cfa_misfit | CFA_SPEC.n |     800 |     800 | PASS |
| cfa | cfa_misfit | CFA_ITEM.order | q1,q2,q3,q4,q5,q6 | q1,q2,q3,q4,q5,q6 | PASS |
| cfa | cfa_misfit | CFA_SPEC.nfac |       1 |       1 | PASS |
| cfa | cfa_misfit | CFA_ITEM.partition | 1-2-3-4-5-6 | 1-2-3-4-5-6 | PASS |
| cfa | cfa_misfit | CFA_ITEM.forced_1factor |       1 |       1 | PASS |
| cfa | cfa_misfit | CFA_FIT.chisq | 710.966 | 710.966 | PASS |
| cfa | cfa_misfit | CFA_FIT.df |       9 |       9 | PASS |
| cfa | cfa_misfit | F_ML | 0.88982 | 0.88982 | PASS |
| cfa | cfa_misfit | CFA_FIT.p | 3.03456e-147 | 3.03456e-147 | PASS |
| cfa | cfa_misfit | invariant.diag_Sigma_eq_1 | 3.96794e-08 |       0 | PASS |
| cfa | cfa_misfit | invariant.lambda2_plus_theta | 1.11022e-16 |       0 | PASS |
| cfa | cfa_misfit | invariant.df_formula |       9 |       9 | PASS |
| cfa | cfa_misfit | invariant.npar |      12 |      12 | PASS |
| cfa | cfa_misfit | CFA_NULLMODEL.chisq | 1893.23 | 1893.23 | PASS |
| cfa | cfa_misfit | CFA_NULLMODEL.df |      15 |      15 | PASS |
| cfa | cfa_misfit | CFA_FITIDX.cfi | 0.626262 |  0.6263 | PASS |
| cfa | cfa_misfit | CFA_FITIDX.tli | 0.377104 |  0.3771 | PASS |
| cfa | cfa_misfit | CFA_FITIDX.rmsea | 0.312438 |  0.3124 | PASS |
| cfa | cfa_misfit | CFA_FITIDX.srmr | 0.18461 |  0.1846 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.items | q1,q2,q3,q4,q5,q6 | q1,q2,q3,q4,q5,q6 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.std_load.numeric | all numeric | all numeric | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q1.std_load | 0.833244 |  0.8332 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q2.std_load | 0.792677 |  0.7927 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q3.std_load | 0.745101 |  0.7451 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q4.std_load | 0.363166 |  0.3632 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q5.std_load | 0.34929 |  0.3493 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.q6.std_load | 0.327373 |  0.3274 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.std_load.max_abs_diff |       0 | 4.37045e-05 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.sign_convention | TRUE | TRUE | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.std_load_in_range | TRUE | TRUE | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.r2_equals_load_sq |       0 | 7.776e-05 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.unstd_over_raw_sd_equals_std |       0 | 3.54908e-05 | PASS |
| cfa | cfa_misfit | CFA_ESTIMATE.unstd_differs_from_std | TRUE | TRUE | PASS |
| cfa | cfa_misfit | CFA_FACTOR.absent_when_1factor | absent | absent | PASS |
| cfa | cfa_misfit | CFA_RELIAB.F1.cr | 0.755698 |  0.7557 | PASS |
| cfa | cfa_misfit | CFA_RELIAB.F1.ave | 0.373148 |  0.3731 | PASS |
| cfa | cfa_misfit | CFA_RELIAB.F1.sqrt_ave | 0.610858 |  0.6109 | PASS |
| cfa | cfa_misfit | CFA_RELIAB.F1.cr_ge_ave | CR >= AVE | CR= 0.7557 AVE= 0.3731 | PASS |
| cfa | cfa_misfit | CFA_RELIAB.F1.in_unit_interval | 0 < CR <= 1 且 0 < AVE <= 1 | CR= 0.7557 AVE= 0.3731 | PASS |
| cfa | cfa_misfit | CONCL.matches_fit_indices | poor | poor | PASS |
| cfa | cfa_misfit | discriminant.misfit_CFI_below_0.80 | < 0.80 |  0.6263 | PASS |
| cfa | cfa_reverse | r_syntax_parse | parse() ok | ok | PASS |
| cfa | cfa_reverse | sprintf_format_args | no mismatch | ok | PASS |
| cfa | cfa_reverse | no_r_error | no error | ok | PASS |
| cfa | cfa_reverse | banner | === 验证性因子分析 (CFA) === | === 验证性因子分析 (CFA) === | PASS |
| cfa | cfa_reverse | data_quality.hooked | rwb_read used | ok | PASS |
| cfa | cfa_reverse | CFA_SPEC.p |       6 |       6 | PASS |
| cfa | cfa_reverse | CFA_SPEC.n |     800 |     800 | PASS |
| cfa | cfa_reverse | CFA_ITEM.order | q1,q2,q3,q4,q5,q6 | q1,q2,q3,q4,q5,q6 | PASS |
| cfa | cfa_reverse | CFA_SPEC.nfac |       2 |       2 | PASS |
| cfa | cfa_reverse | CFA_ITEM.partition | 1-2-3|4-5-6 | 1-2-3|4-5-6 | PASS |
| cfa | cfa_reverse | CFA_FIT.chisq | 3.65827e-08 |       0 | PASS |
| cfa | cfa_reverse | CFA_FIT.df |       8 |       8 | PASS |
| cfa | cfa_reverse | F_ML | 4.57856e-11 |       0 | PASS |
| cfa | cfa_reverse | CFA_FIT.p |       1 |       1 | PASS |
| cfa | cfa_reverse | invariant.diag_Sigma_eq_1 | 2.05846e-06 |       0 | PASS |
| cfa | cfa_reverse | invariant.lambda2_plus_theta | 2.22045e-16 |       0 | PASS |
| cfa | cfa_reverse | invariant.df_formula |       8 |       8 | PASS |
| cfa | cfa_reverse | invariant.npar |      13 |      13 | PASS |
| cfa | cfa_reverse | CFA_NULLMODEL.chisq | 1841.56 | 1841.56 | PASS |
| cfa | cfa_reverse | CFA_NULLMODEL.df |      15 |      15 | PASS |
| cfa | cfa_reverse | CFA_FITIDX.cfi |       1 |       1 | PASS |
| cfa | cfa_reverse | CFA_FITIDX.tli | 1.00821 |  1.0082 | PASS |
| cfa | cfa_reverse | CFA_FITIDX.rmsea |       0 |       0 | PASS |
| cfa | cfa_reverse | CFA_FITIDX.srmr | 1.13513e-06 |       0 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.items | q1,q2,q3,q4,q5,q6 | q1,q2,q3,q4,q5,q6 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.std_load.numeric | all numeric | all numeric | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.q1.std_load | 0.849997 |    0.85 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.q2.std_load | 0.800002 |     0.8 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.q3.std_load | -0.719999 |   -0.72 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.q4.std_load |    0.82 |    0.82 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.q5.std_load |    0.78 |    0.78 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.q6.std_load | 0.719998 |    0.72 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.std_load.max_abs_diff |       0 | 2.74049e-06 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.sign_convention | TRUE | TRUE | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.std_load_in_range | TRUE | TRUE | PASS |
| cfa | cfa_reverse | truth.std_load.max_abs_error |       0 |       0 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.r2_equals_load_sq |       0 | 1.11022e-16 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.unstd_over_raw_sd_equals_std |       0 | 4.87785e-05 | PASS |
| cfa | cfa_reverse | CFA_ESTIMATE.unstd_differs_from_std | TRUE | TRUE | PASS |
| cfa | cfa_reverse | CFA_FACTOR.cor.max_abs_diff |       0 |       0 | PASS |
| cfa | cfa_reverse | CFA_RELIAB.F1.cr | 0.833863 |  0.8339 | PASS |
| cfa | cfa_reverse | CFA_RELIAB.F1.ave | 0.626967 |   0.627 | PASS |
| cfa | cfa_reverse | CFA_RELIAB.F1.sqrt_ave | 0.791812 |  0.7918 | PASS |
| cfa | cfa_reverse | CFA_RELIAB.F1.cr_ge_ave | CR >= AVE | CR= 0.8339 AVE=  0.627 | PASS |
| cfa | cfa_reverse | CFA_RELIAB.F1.in_unit_interval | 0 < CR <= 1 且 0 < AVE <= 1 | CR= 0.8339 AVE=  0.627 | PASS |
| cfa | cfa_reverse | CFA_RELIAB.F2.cr | 0.817596 |  0.8176 | PASS |
| cfa | cfa_reverse | CFA_RELIAB.F2.ave | 0.599733 |  0.5997 | PASS |
| cfa | cfa_reverse | CFA_RELIAB.F2.sqrt_ave | 0.774425 |  0.7744 | PASS |
| cfa | cfa_reverse | CFA_RELIAB.F2.cr_ge_ave | CR >= AVE | CR= 0.8176 AVE= 0.5997 | PASS |
| cfa | cfa_reverse | CFA_RELIAB.F2.in_unit_interval | 0 < CR <= 1 且 0 < AVE <= 1 | CR= 0.8176 AVE= 0.5997 | PASS |
| cfa | cfa_reverse | d01.negative_loading_present | at least one lambda < 0 | min(lambda) =   -0.72 | PASS |
| cfa | cfa_reverse | d01.F1.sign_matters | Σ|λ| − |Σλ| > 0.1 | Σλ=   0.93 Σ|λ|=   2.37 | PASS |
| cfa | cfa_reverse | CONCL.matches_fit_indices | good | good | PASS |
| cfa | cfa_reverse | discriminant.correct_model_CFI_above_0.95 | >= 0.95 |       1 | PASS |
| cvi | cvi | r_syntax_parse | parse() ok | ok | PASS |
| cvi | cvi | sprintf_format_args | no mismatch | ok | PASS |
| cvi | cvi | no_r_error | no error | ok | PASS |
| cvi | cvi | banner | === 内容效度指数 (CVI) === | === 内容效度指数 (CVI) === | PASS |
| cvi | cvi | data_quality.hooked | rwb_read used | ok | PASS |
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
| harman | harman_medium | data_quality.hooked | rwb_read used | ok | PASS |
| harman | harman_medium | HARMAN_SPEC.p |       6 |       6 | PASS |
| harman | harman_medium | HARMAN_SPEC.n |     400 |     400 | PASS |
| harman | harman_medium | oracle.consistency_eigen_vs_svd | 1.44329e-15 |       0 | PASS |
| harman | harman_medium | HARMAN_SUMMARY.n_factors_gt1 |       2 |       2 | PASS |
| harman | harman_medium | HARMAN_EIGEN.count |       2 |       2 | PASS |
| harman | harman_medium | HARMAN_EIGEN.eigen1 | 2.25026 |  2.2503 | PASS |
| harman | harman_medium | HARMAN_EIGEN.variance_pct1 | 37.5043 |    37.5 | PASS |
| harman | harman_medium | HARMAN_EIGEN.eigen2 | 1.50065 |  1.5006 | PASS |
| harman | harman_medium | HARMAN_EIGEN.variance_pct2 | 25.0108 |   25.01 | PASS |
| harman | harman_medium | HARMAN_EIGEN.cumulative_monotone | TRUE | TRUE | PASS |
| harman | harman_medium | HARMAN_SUMMARY.first_pct | 37.5043 |    37.5 | PASS |
| harman | harman_medium | HARMAN_SUMMARY.ok | 是 | 是 | PASS |
| harman | harman_medium | HARMAN_SUMMARY.threshold |      40 |      40 | PASS |
| harman | harman_medium | criterion.medium_side | first_pct<40 & n_gt1>1 | first_pct=37.50 n_gt1=2 | PASS |
| harman | harman_medium | CONCL.direction | no_bias | no_bias | PASS |
| harman | harman_medium | HARMAN_NOTE.sensitivity_caveat | present | present | PASS |
| harman | harman_high | r_syntax_parse | parse() ok | ok | PASS |
| harman | harman_high | sprintf_format_args | no mismatch | ok | PASS |
| harman | harman_high | no_r_error | no error | ok | PASS |
| harman | harman_high | banner | === Harman 单因子检验 === | === Harman 单因子检验 === | PASS |
| harman | harman_high | data_quality.hooked | rwb_read used | ok | PASS |
| harman | harman_high | HARMAN_SPEC.p |       6 |       6 | PASS |
| harman | harman_high | HARMAN_SPEC.n |     400 |     400 | PASS |
| harman | harman_high | oracle.consistency_eigen_vs_svd | 2.66454e-15 |       0 | PASS |
| harman | harman_high | HARMAN_SUMMARY.n_factors_gt1 |       1 |       1 | PASS |
| harman | harman_high | HARMAN_EIGEN.count |       1 |       1 | PASS |
| harman | harman_high | HARMAN_EIGEN.eigen1 |  4.2082 |  4.2082 | PASS |
| harman | harman_high | HARMAN_EIGEN.variance_pct1 | 70.1366 |   70.14 | PASS |
| harman | harman_high | HARMAN_SUMMARY.first_pct | 70.1366 |   70.14 | PASS |
| harman | harman_high | HARMAN_SUMMARY.ok | 否 | 否 | PASS |
| harman | harman_high | HARMAN_SUMMARY.threshold |      40 |      40 | PASS |
| harman | harman_high | criterion.high_side | first_pct>40 | first_pct=70.14 | PASS |
| harman | harman_high | CONCL.direction | bias | bias | PASS |
| harman | harman_high | HARMAN_NOTE.sensitivity_caveat | present | present | PASS |
| mediation | mediation | r_syntax_parse | parse() ok | ok | PASS |
| mediation | mediation | sprintf_format_args | no mismatch | ok | PASS |
| mediation | mediation | no_r_error | no error | ok | PASS |
| mediation | mediation | banner | === 中介效应分析 === | === 中介效应分析 === | PASS |
| mediation | mediation | data_quality.hooked | rwb_read used | ok | PASS |
| mediation | mediation | MED_SPEC.n |     300 |     300 | PASS |
| mediation | mediation | MED_SPEC.vars | x,m,y | x,m,y | PASS |
| mediation | mediation | MED_PATH.a.coef | 0.499999 |     0.5 | PASS |
| mediation | mediation | MED_PATH.a.se | 0.038619 |  0.0386 | PASS |
| mediation | mediation | MED_PATH.a.t |  12.947 |  12.947 | PASS |
| mediation | mediation | MED_PATH.a.p | 1.01089e-30 | 1.01089e-30 | PASS |
| mediation | mediation | MED_PATH.b.coef | 0.599999 |     0.6 | PASS |
| mediation | mediation | MED_PATH.b.se | 0.0558499 |  0.0558 | PASS |
| mediation | mediation | MED_PATH.b.t |  10.743 |  10.743 | PASS |
| mediation | mediation | MED_PATH.b.p | 5.82822e-23 | 5.82822e-23 | PASS |
| mediation | mediation | MED_PATH.c_prime.coef | 0.200003 |     0.2 | PASS |
| mediation | mediation | MED_PATH.c_prime.se | 0.0465416 |  0.0465 | PASS |
| mediation | mediation | MED_PATH.c_prime.t |  4.2973 |  4.2973 | PASS |
| mediation | mediation | MED_PATH.c_prime.p | 2.34613e-05 | 2.34613e-05 | PASS |
| mediation | mediation | MED_PATH.c_total.coef | 0.500002 |     0.5 | PASS |
| mediation | mediation | MED_PATH.c_total.se | 0.0438016 |  0.0438 | PASS |
| mediation | mediation | MED_PATH.c_total.t | 11.4152 | 11.4152 | PASS |
| mediation | mediation | MED_PATH.c_total.p | 2.79575e-25 | 2.79575e-25 | PASS |
| mediation | mediation | invariant.c_equals_cprime_plus_ab | <= 1e-10 | 0.000e+00 | PASS |
| mediation | mediation | oracle.identity_selfcheck |       0 | 6.10623e-16 | PASS |
| mediation | mediation | MED_EFFECT.indirect | 0.299999 |     0.3 | PASS |
| mediation | mediation | MED_EFFECT.direct | 0.200003 |     0.2 | PASS |
| mediation | mediation | MED_EFFECT.total | 0.500002 |     0.5 | PASS |
| mediation | mediation | consistency.indirect_eq_a_times_b | 0.3000 | 0.3000 | PASS |
| mediation | mediation | consistency.direct_eq_c_prime | 0.2000 | 0.2000 | PASS |
| mediation | mediation | MED_EFFECT.indirect.ci_lower(reference) | 0.226268 |  0.2238 | PASS |
| mediation | mediation | MED_EFFECT.indirect.ci_upper(reference) | 0.380351 |  0.3861 | PASS |
| mediation | mediation | MED_EFFECT.indirect.ci_contains_point | lo <= est <= hi |  0.2238 <=     0.3 <=  0.3861 | PASS |
| mediation | mediation | discriminant.real_indirect_ci_excludes_zero | FALSE（真值 a*b=.30） | FALSE | PASS |
| mediation | mediation | MED_EFFECT.prop_mediated | 0.599995 |     0.6 | PASS |
| mediation | mediation | MED_EFFECT.prop_mediated.finite | finite or NA |     0.6 | PASS |
| mediation | mediation | MED_SOBEL.z |  8.2675 |  8.2675 | PASS |
| mediation | mediation | MED_SOBEL.p | 1.368e-16 | 1.368e-16 | PASS |
| mediation | mediation | MED_EFFECT.ci_method_truthful | percentile 或 bca | percentile | PASS |
| mediation | mediation | MED_BOOT.B_positive | TRUE | TRUE | PASS |
| mediation | mediation | MED_STD.a_std | 0.599999 |     0.6 | PASS |
| mediation | mediation | MED_STD.b_std | 0.551572 |  0.5516 | PASS |
| mediation | mediation | MED_STD.c_prime_std | 0.220633 |  0.2206 | PASS |
| mediation | mediation | MED_STD.indirect_std | 0.330943 |  0.3309 | PASS |
| mediation | mediation | MED_STD.differs_from_raw | TRUE | TRUE | PASS |
| mediation | mediation_null | r_syntax_parse | parse() ok | ok | PASS |
| mediation | mediation_null | sprintf_format_args | no mismatch | ok | PASS |
| mediation | mediation_null | no_r_error | no error | ok | PASS |
| mediation | mediation_null | banner | === 中介效应分析 === | === 中介效应分析 === | PASS |
| mediation | mediation_null | data_quality.hooked | rwb_read used | ok | PASS |
| mediation | mediation_null | MED_SPEC.n |     300 |     300 | PASS |
| mediation | mediation_null | MED_SPEC.vars | x,m,y | x,m,y | PASS |
| mediation | mediation_null | MED_PATH.a.coef | 0.499999 |     0.5 | PASS |
| mediation | mediation_null | MED_PATH.a.se | 0.0386189 |  0.0386 | PASS |
| mediation | mediation_null | MED_PATH.a.t |  12.947 |  12.947 | PASS |
| mediation | mediation_null | MED_PATH.a.p | 1.01089e-30 | 1.01089e-30 | PASS |
| mediation | mediation_null | MED_PATH.b.coef | 6.13484e-06 |       0 | PASS |
| mediation | mediation_null | MED_PATH.b.se | 0.0558499 |  0.0558 | PASS |
| mediation | mediation_null | MED_PATH.b.t | 0.000109845 |  0.0001 | PASS |
| mediation | mediation_null | MED_PATH.b.p | 0.999912 | 0.999912 | PASS |
| mediation | mediation_null | MED_PATH.c_prime.coef | 0.499996 |     0.5 | PASS |
| mediation | mediation_null | MED_PATH.c_prime.se | 0.0465415 |  0.0465 | PASS |
| mediation | mediation_null | MED_PATH.c_prime.t |  10.743 |  10.743 | PASS |
| mediation | mediation_null | MED_PATH.c_prime.p | 5.82964e-23 | 5.82964e-23 | PASS |
| mediation | mediation_null | MED_PATH.c_total.coef |     0.5 |     0.5 | PASS |
| mediation | mediation_null | MED_PATH.c_total.se | 0.0371707 |  0.0372 | PASS |
| mediation | mediation_null | MED_PATH.c_total.t | 13.4514 | 13.4514 | PASS |
| mediation | mediation_null | MED_PATH.c_total.p | 1.47804e-32 | 1.47804e-32 | PASS |
| mediation | mediation_null | invariant.c_equals_cprime_plus_ab | <= 1e-10 | 0.000e+00 | PASS |
| mediation | mediation_null | oracle.identity_selfcheck |       0 | 2.77279e-15 | PASS |
| mediation | mediation_null | MED_EFFECT.indirect | 3.06741e-06 |       0 | PASS |
| mediation | mediation_null | MED_EFFECT.direct | 0.499996 |     0.5 | PASS |
| mediation | mediation_null | MED_EFFECT.total |     0.5 |     0.5 | PASS |
| mediation | mediation_null | consistency.indirect_eq_a_times_b | 0.0000 | 0.0000 | PASS |
| mediation | mediation_null | consistency.direct_eq_c_prime | 0.5000 | 0.5000 | PASS |
| mediation | mediation_null | MED_EFFECT.indirect.ci_lower(reference) | -0.0534535 | -0.0547 | PASS |
| mediation | mediation_null | MED_EFFECT.indirect.ci_upper(reference) | 0.0673496 |  0.0625 | PASS |
| mediation | mediation_null | MED_EFFECT.indirect.ci_contains_point | lo <= est <= hi | -0.0547 <=       0 <=  0.0625 | PASS |
| mediation | mediation_null | discriminant.null_indirect_ci_crosses_zero | TRUE（真值 a*b=0） | TRUE | PASS |
| mediation | mediation_null | MED_EFFECT.prop_mediated | 6.13483e-06 |       0 | PASS |
| mediation | mediation_null | MED_EFFECT.prop_mediated.finite | finite or NA |       0 | PASS |
| mediation | mediation_null | MED_SOBEL.z | 0.000109845 |  0.0001 | PASS |
| mediation | mediation_null | MED_SOBEL.p | 0.999912 | 0.999912 | PASS |
| mediation | mediation_null | MED_EFFECT.ci_method_truthful | percentile 或 bca | percentile | PASS |
| mediation | mediation_null | MED_BOOT.B_positive | TRUE | TRUE | PASS |
| mediation | mediation_null | MED_STD.a_std | 0.599999 |     0.6 | PASS |
| mediation | mediation_null | MED_STD.b_std | 6.28462e-06 |       0 | PASS |
| mediation | mediation_null | MED_STD.c_prime_std | 0.614646 |  0.6146 | PASS |
| mediation | mediation_null | MED_STD.indirect_std | 3.77077e-06 |       0 | PASS |
| mediation | mediation_null | MED_STD.differs_from_raw | TRUE | TRUE | PASS |
| moderation | moderation | r_syntax_parse | parse() ok | ok | PASS |
| moderation | moderation | sprintf_format_args | no mismatch | ok | PASS |
| moderation | moderation | no_r_error | no error | ok | PASS |
| moderation | moderation | banner | === 调节效应分析 === | === 调节效应分析 === | PASS |
| moderation | moderation | data_quality.hooked | rwb_read used | ok | PASS |
| moderation | moderation | MOD_SPEC.n |     400 |     400 | PASS |
| moderation | moderation | MOD_SPEC.vars | x,w,y | x,w,y | PASS |
| moderation | moderation | MOD_SPEC.centered_declared | 是 | 是 | PASS |
| moderation | moderation | invariant.centering_preserves_interaction |       0 | 7.07212e-14 | PASS |
| moderation | moderation | MOD_COEF.x.coef | 0.300113 |  0.3001 | PASS |
| moderation | moderation | MOD_COEF.x.se | 0.0418768 |  0.0419 | PASS |
| moderation | moderation | MOD_COEF.x.t | 7.16656 |  7.1666 | PASS |
| moderation | moderation | MOD_COEF.x.p | 3.788e-12 | 3.788e-12 | PASS |
| moderation | moderation | MOD_COEF.w.coef | 0.39884 |  0.3988 | PASS |
| moderation | moderation | MOD_COEF.w.se | 0.035917 |  0.0359 | PASS |
| moderation | moderation | MOD_COEF.w.t | 11.1045 | 11.1045 | PASS |
| moderation | moderation | MOD_COEF.w.p | 3.98857e-25 | 3.98857e-25 | PASS |
| moderation | moderation | MOD_COEF.x_w.coef | 0.499968 |     0.5 | PASS |
| moderation | moderation | MOD_COEF.x_w.se | 0.027137 |  0.0271 | PASS |
| moderation | moderation | MOD_COEF.x_w.t | 18.4239 | 18.4239 | PASS |
| moderation | moderation | MOD_COEF.x_w.p | 3.44277e-55 | 3.44277e-55 | PASS |
| moderation | moderation | MOD_COEF.intercept.coef |       2 |       2 | PASS |
| moderation | moderation | MOD_COEF.intercept.se | 0.050252 |  0.0503 | PASS |
| moderation | moderation | MOD_COEF.intercept.t | 39.7994 | 39.7994 | PASS |
| moderation | moderation | MOD_COEF.intercept.p | 1.79998e-140 | 1.79998e-140 | PASS |
| moderation | moderation | MOD_MODEL.r2 | 0.558479 |  0.5585 | PASS |
| moderation | moderation | MOD_MODEL.adj_r2 | 0.555134 |  0.5551 | PASS |
| moderation | moderation | MOD_MODEL.f | 166.967 | 166.967 | PASS |
| moderation | moderation | MOD_MODEL.df1 |       3 |       3 | PASS |
| moderation | moderation | MOD_MODEL.df2 |     396 |     396 | PASS |
| moderation | moderation | MOD_DELTA.r2_change | 0.378458 |  0.3785 | PASS |
| moderation | moderation | MOD_DELTA.f_change | 339.439 | 339.439 | PASS |
| moderation | moderation | MOD_DELTA.p | 3.44277e-55 | 3.44277e-55 | PASS |
| moderation | moderation | invariant.deltaF_equals_t_squared |       0 | 2.27374e-13 | PASS |
| moderation | moderation | MOD_SLOPE.-1SD.w_value | 2.09825 |  2.0982 | PASS |
| moderation | moderation | MOD_SLOPE.-1SD.slope | -0.40072 | -0.4007 | PASS |
| moderation | moderation | MOD_SLOPE.-1SD.se | 0.0566582 |  0.0567 | PASS |
| moderation | moderation | MOD_SLOPE.-1SD.t | -7.07259 | -7.0726 | PASS |
| moderation | moderation | MOD_SLOPE.mean.w_value |     3.5 |     3.5 | PASS |
| moderation | moderation | MOD_SLOPE.mean.slope | 0.300113 |  0.3001 | PASS |
| moderation | moderation | MOD_SLOPE.mean.se | 0.0418768 |  0.0419 | PASS |
| moderation | moderation | MOD_SLOPE.mean.t | 7.16656 |  7.1666 | PASS |
| moderation | moderation | MOD_SLOPE.+1SD.w_value | 4.90176 |  4.9018 | PASS |
| moderation | moderation | MOD_SLOPE.+1SD.slope | 1.00095 |  1.0009 | PASS |
| moderation | moderation | MOD_SLOPE.+1SD.se | 0.0564905 |  0.0565 | PASS |
| moderation | moderation | MOD_SLOPE.+1SD.t | 17.7188 | 17.7188 | PASS |
| moderation | moderation | MOD_SLOPE.se_uses_linear_combination | 更接近 L'VL 而非子集重跑 | |got-correct|=0.0000 |got-subset|=0.0153 | PASS |
| moderation | moderation | discriminant.real_interaction_significant | p < .05（真值 b3=.5） | 3.44277e-55 | PASS |
| moderation | moderation | truth.b3 |     0.5 | 0.499968 | PASS |
| moderation | moderation_null | r_syntax_parse | parse() ok | ok | PASS |
| moderation | moderation_null | sprintf_format_args | no mismatch | ok | PASS |
| moderation | moderation_null | no_r_error | no error | ok | PASS |
| moderation | moderation_null | banner | === 调节效应分析 === | === 调节效应分析 === | PASS |
| moderation | moderation_null | data_quality.hooked | rwb_read used | ok | PASS |
| moderation | moderation_null | MOD_SPEC.n |     400 |     400 | PASS |
| moderation | moderation_null | MOD_SPEC.vars | x,w,y | x,w,y | PASS |
| moderation | moderation_null | MOD_SPEC.centered_declared | 是 | 是 | PASS |
| moderation | moderation_null | invariant.centering_preserves_interaction |       0 | 5.44009e-15 | PASS |
| moderation | moderation_null | MOD_COEF.x.coef | 0.298505 |  0.2985 | PASS |
| moderation | moderation_null | MOD_COEF.x.se | 0.0418916 |  0.0419 | PASS |
| moderation | moderation_null | MOD_COEF.x.t | 7.12565 |  7.1256 | PASS |
| moderation | moderation_null | MOD_COEF.x.p | 4.93166e-12 | 4.93166e-12 | PASS |
| moderation | moderation_null | MOD_COEF.w.coef | 0.40179 |  0.4018 | PASS |
| moderation | moderation_null | MOD_COEF.w.se | 0.0359194 |  0.0359 | PASS |
| moderation | moderation_null | MOD_COEF.w.t | 11.1859 | 11.1859 | PASS |
| moderation | moderation_null | MOD_COEF.w.p | 1.98875e-25 | 1.98875e-25 | PASS |
| moderation | moderation_null | MOD_COEF.x_w.coef | 7.95258e-05 |  0.0001 | PASS |
| moderation | moderation_null | MOD_COEF.x_w.se | 0.0281597 |  0.0282 | PASS |
| moderation | moderation_null | MOD_COEF.x_w.t | 0.0028241 |  0.0028 | PASS |
| moderation | moderation_null | MOD_COEF.x_w.p | 0.997748 | 0.997748 | PASS |
| moderation | moderation_null | MOD_COEF.intercept.coef |       2 |       2 | PASS |
| moderation | moderation_null | MOD_COEF.intercept.se | 0.0502517 |  0.0503 | PASS |
| moderation | moderation_null | MOD_COEF.intercept.t | 39.7997 | 39.7997 | PASS |
| moderation | moderation_null | MOD_COEF.intercept.p | 1.79633e-140 | 1.79633e-140 | PASS |
| moderation | moderation_null | MOD_MODEL.r2 | 0.307826 |  0.3078 | PASS |
| moderation | moderation_null | MOD_MODEL.adj_r2 | 0.302582 |  0.3026 | PASS |
| moderation | moderation_null | MOD_MODEL.f | 58.7034 | 58.7034 | PASS |
| moderation | moderation_null | MOD_MODEL.df1 |       3 |       3 | PASS |
| moderation | moderation_null | MOD_MODEL.df2 |     396 |     396 | PASS |
| moderation | moderation_null | MOD_DELTA.r2_change | 1.39406e-08 |       0 | PASS |
| moderation | moderation_null | MOD_DELTA.f_change | 7.97554e-06 |       0 | PASS |
| moderation | moderation_null | MOD_DELTA.p | 0.997748 | 0.997748 | PASS |
| moderation | moderation_null | invariant.deltaF_equals_t_squared |       0 | 2.38976e-15 | PASS |
| moderation | moderation_null | MOD_SLOPE.-1SD.w_value | 2.09825 |  2.0982 | PASS |
| moderation | moderation_null | MOD_SLOPE.-1SD.slope | 0.298393 |  0.2984 | PASS |
| moderation | moderation_null | MOD_SLOPE.-1SD.se | 0.0583278 |  0.0583 | PASS |
| moderation | moderation_null | MOD_SLOPE.-1SD.t |  5.1158 |  5.1158 | PASS |
| moderation | moderation_null | MOD_SLOPE.mean.w_value |     3.5 |     3.5 | PASS |
| moderation | moderation_null | MOD_SLOPE.mean.slope | 0.298505 |  0.2985 | PASS |
| moderation | moderation_null | MOD_SLOPE.mean.se | 0.0418916 |  0.0419 | PASS |
| moderation | moderation_null | MOD_SLOPE.mean.t | 7.12565 |  7.1256 | PASS |
| moderation | moderation_null | MOD_SLOPE.+1SD.w_value | 4.90175 |  4.9018 | PASS |
| moderation | moderation_null | MOD_SLOPE.+1SD.slope | 0.298616 |  0.2986 | PASS |
| moderation | moderation_null | MOD_SLOPE.+1SD.se | 0.0567795 |  0.0568 | PASS |
| moderation | moderation_null | MOD_SLOPE.+1SD.t | 5.25923 |  5.2592 | PASS |
| moderation | moderation_null | MOD_SLOPE.se_uses_linear_combination | 更接近 L'VL 而非子集重跑 | |got-correct|=0.0000 |got-subset|=0.0193 | PASS |
| moderation | moderation_null | discriminant.null_interaction_nonsignificant | p > .05（真值 b3=0） | 0.997748 | PASS |
| moderation | moderation_null | discriminant.null_delta_r2_near_zero | ΔR² < 0.02 | 1.39406e-08 | PASS |
| moderated_mediation | moderated_mediation | r_syntax_parse | parse() ok | ok | PASS |
| moderated_mediation | moderated_mediation | sprintf_format_args | no mismatch | ok | PASS |
| moderated_mediation | moderated_mediation | no_r_error | no error | ok | PASS |
| moderated_mediation | moderated_mediation | banner | === 有调节的中介分析 === | === 有调节的中介分析 === | PASS |
| moderated_mediation | moderated_mediation | data_quality.hooked | rwb_read used | ok | PASS |
| moderated_mediation | moderated_mediation | MM_SPEC.n |     350 |     350 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.m.x_c.coef | 0.399657 |  0.3997 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.m.x_c.se | 0.0488741 |  0.0489 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.m.x_c.p | 5.57166e-15 | 5.57166e-15 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.m.w_c.coef | 0.196385 |  0.1964 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.m.w_c.se | 0.0386062 |  0.0386 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.m.w_c.p | 5.98064e-07 | 5.98064e-07 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.m.xw.coef | 0.299641 |  0.2996 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.m.xw.se | 0.0369321 |  0.0369 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.m.xw.p | 8.68324e-15 | 8.68324e-15 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.y.m_v.coef | 0.498769 |  0.4988 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.y.m_v.se | 0.0481506 |  0.0482 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.y.m_v.p | 4.35777e-22 | 4.35777e-22 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.y.x_c.coef | 0.253676 |  0.2537 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.y.x_c.se | 0.0524051 |  0.0524 | PASS |
| moderated_mediation | moderated_mediation | MM_COEF.y.x_c.p | 1.95137e-06 | 1.95137e-06 | PASS |
| moderated_mediation | moderated_mediation | MM_INDEX.index | 0.149452 |  0.1495 | PASS |
| moderated_mediation | moderated_mediation | MM_INDEX.boot_mean(reference) | 0.149577 | 0.149452 | PASS |
| moderated_mediation | moderated_mediation | MM_INDEX.ci_lower(reference) | 0.107604 |  0.1075 | PASS |
| moderated_mediation | moderated_mediation | MM_INDEX.ci_upper(reference) | 0.192026 |  0.1931 | PASS |
| moderated_mediation | moderated_mediation | MM_COND.-1SD.a_cond | -0.02044 | -0.0204 | PASS |
| moderated_mediation | moderated_mediation | MM_COND.-1SD.indirect | -0.0101949 | -0.0102 | PASS |
| moderated_mediation | moderated_mediation | MM_COND.-1SD.ci_present | finite | -0.0827 ..  0.0541 | PASS |
| moderated_mediation | moderated_mediation | MM_COND.mean.a_cond | 0.399657 |  0.3997 | PASS |
| moderated_mediation | moderated_mediation | MM_COND.mean.indirect | 0.199337 |  0.1993 | PASS |
| moderated_mediation | moderated_mediation | MM_COND.mean.ci_present | finite |  0.1374 ..  0.2634 | PASS |
| moderated_mediation | moderated_mediation | MM_COND.+1SD.a_cond | 0.819755 |  0.8198 | PASS |
| moderated_mediation | moderated_mediation | MM_COND.+1SD.indirect | 0.408868 |  0.4089 | PASS |
| moderated_mediation | moderated_mediation | MM_COND.+1SD.ci_present | finite |  0.3051 ..  0.5078 | PASS |
| moderated_mediation | moderated_mediation | discriminant.conditional_indirect_varies_by_w | max-min > 0.05 | 0.4191 | PASS |
| moderated_mediation | moderated_mediation | invariant.cond_gap_equals_2sd_index | 0.4191 | 0.4191 | PASS |
| moderated_mediation | moderated_mediation | invariant.index_equals_a4_times_b |       0 | 5.952e-05 | PASS |
| moderated_mediation | moderated_mediation | MM_NOTE.warns_index_vs_levels | present | present | PASS |
| path_analysis | path_analysis | r_syntax_parse | parse() ok | ok | PASS |
| path_analysis | path_analysis | sprintf_format_args | no mismatch | ok | PASS |
| path_analysis | path_analysis | no_r_error | no error | ok | PASS |
| path_analysis | path_analysis | banner | === 路径分析 === | === 路径分析 === | PASS |
| path_analysis | path_analysis | data_quality.hooked | rwb_read used | ok | PASS |
| path_analysis | path_analysis | PATH_SPEC.n |     400 |     400 | PASS |
| path_analysis | path_analysis | PATH_SPEC.n_nodes |       3 |       3 | PASS |
| path_analysis | path_analysis | PATH_SPEC.n_edges |       3 |       3 | PASS |
| path_analysis | path_analysis | PATH_EQ.m.r2 | 0.360001 |    0.36 | PASS |
| path_analysis | path_analysis | PATH_EQ.y.r2 | 0.498945 |  0.4989 | PASS |
| path_analysis | path_analysis | PATH_EDGE.x>m.coef | 0.500002 |     0.5 | PASS |
| path_analysis | path_analysis | PATH_EDGE.m>y.coef | 0.600003 |     0.6 | PASS |
| path_analysis | path_analysis | PATH_EDGE.x>y.coef | 0.199998 |     0.2 | PASS |
| path_analysis | path_analysis | PATH_EFFECT.x>y.direct | 0.199998 |     0.2 | PASS |
| path_analysis | path_analysis | PATH_EFFECT.x>y.indirect | 0.300003 |     0.3 | PASS |
| path_analysis | path_analysis | PATH_EFFECT.x>y.total | 0.500001 |     0.5 | PASS |
| path_analysis | path_analysis | invariant.total_equals_direct_plus_indirect | 0.5000 | 0.5000 | PASS |
| path_analysis | path_analysis | discriminant.indirect_nonzero | |indirect| > 0.05 | 0.300003 | PASS |
| path_analysis | path_analysis | discriminant.total_gt_direct | total > direct | total=0.5000 direct=0.2000 | PASS |
| path_analysis | path_analysis | PATH_NOTE.declares_ols_per_equation | present | present | PASS |
| sem | sem | r_syntax_parse | parse() ok | ok | PASS |
| sem | sem | sprintf_format_args | no mismatch | ok | PASS |
| sem | sem | no_r_error | no error | ok | PASS |
| sem | sem | banner | === 结构方程模型 (SEM) === | === 结构方程模型 (SEM) === | PASS |
| sem | sem | data_quality.hooked | rwb_read used | ok | PASS |
| sem | sem | SEM_SPEC.n |     600 |     600 | PASS |
| sem | sem | SEM_SPEC.n_latent |       2 |       2 | PASS |
| sem | sem | SEM_SPEC.n_obs |       6 |       6 | PASS |
| sem | sem | invariant.df_formula |       8 |       8 | PASS |
| sem | sem | SEM_FIT.chisq | 1.78535e-08 |       0 | PASS |
| sem | sem | SEM_FIT.df |       8 |       8 | PASS |
| sem | sem | SEM_FIT.cfi |       1 |       1 | PASS |
| sem | sem | SEM_FIT.tli | 1.01223 |  1.0122 | PASS |
| sem | sem | SEM_FIT.rmsea |       0 |       0 | PASS |
| sem | sem | SEM_FIT.srmr | 8.05636e-07 |       0 | PASS |
| sem | sem | invariant.diag_Sigma_eq_1 | 5.59388e-08 |       0 | PASS |
| sem | sem | SEM_MEASURE.x1.std_load |     0.8 |     0.8 | PASS |
| sem | sem | SEM_MEASURE.x1.r2 |    0.64 |    0.64 | PASS |
| sem | sem | SEM_MEASURE.x2.std_load | 0.750001 |    0.75 | PASS |
| sem | sem | SEM_MEASURE.x2.r2 | 0.562502 |  0.5625 | PASS |
| sem | sem | SEM_MEASURE.x3.std_load | 0.699999 |     0.7 | PASS |
| sem | sem | SEM_MEASURE.x3.r2 | 0.489999 |    0.49 | PASS |
| sem | sem | SEM_MEASURE.y1.std_load | 0.819997 |    0.82 | PASS |
| sem | sem | SEM_MEASURE.y1.r2 | 0.672396 |  0.6724 | PASS |
| sem | sem | SEM_MEASURE.y2.std_load |    0.76 |    0.76 | PASS |
| sem | sem | SEM_MEASURE.y2.r2 |  0.5776 |  0.5776 | PASS |
| sem | sem | SEM_MEASURE.y3.std_load |    0.71 |    0.71 | PASS |
| sem | sem | SEM_MEASURE.y3.r2 | 0.504099 |  0.5041 | PASS |
| sem | sem | SEM_STRUCT.F1>F2.coef | 0.499998 |     0.5 | PASS |
| sem | sem | truth.gamma |     0.5 |     0.5 | PASS |
| sem | sem | discriminant.real_model_fits_well | CFI >= 0.95 |       1 | PASS |
| sem | sem | discriminant.real_struct_path_significant | p < .001（真值 γ=.5） | coef=0.5000 p=1.643e-34 | PASS |
| sem | sem | truth.gamma_recovered | |γ-0.5| < 0.05 | 0.5000 | PASS |
| sem | sem | discriminant.lr_test_significant | p < .001（γ 真值 .5） | LR=106.87 p=4.75e-25 | PASS |
| sem | sem_null | r_syntax_parse | parse() ok | ok | PASS |
| sem | sem_null | sprintf_format_args | no mismatch | ok | PASS |
| sem | sem_null | no_r_error | no error | ok | PASS |
| sem | sem_null | banner | === 结构方程模型 (SEM) === | === 结构方程模型 (SEM) === | PASS |
| sem | sem_null | data_quality.hooked | rwb_read used | ok | PASS |
| sem | sem_null | SEM_SPEC.n |     600 |     600 | PASS |
| sem | sem_null | SEM_SPEC.n_latent |       2 |       2 | PASS |
| sem | sem_null | SEM_SPEC.n_obs |       6 |       6 | PASS |
| sem | sem_null | invariant.df_formula |       8 |       8 | PASS |
| sem | sem_null | SEM_FIT.chisq | 3.28846e-08 |       0 | PASS |
| sem | sem_null | SEM_FIT.df |       8 |       8 | PASS |
| sem | sem_null | SEM_FIT.cfi |       1 |       1 | PASS |
| sem | sem_null | SEM_FIT.tli |  1.0134 |  1.0134 | PASS |
| sem | sem_null | SEM_FIT.rmsea |       0 |       0 | PASS |
| sem | sem_null | SEM_FIT.srmr | 1.17128e-06 |       0 | PASS |
| sem | sem_null | invariant.diag_Sigma_eq_1 | 1.90038e-06 |       0 | PASS |
| sem | sem_null | SEM_MEASURE.x1.std_load | 0.800001 |     0.8 | PASS |
| sem | sem_null | SEM_MEASURE.x1.r2 | 0.640002 |    0.64 | PASS |
| sem | sem_null | SEM_MEASURE.x2.std_load | 0.749997 |    0.75 | PASS |
| sem | sem_null | SEM_MEASURE.x2.r2 | 0.562496 |  0.5625 | PASS |
| sem | sem_null | SEM_MEASURE.x3.std_load | 0.700001 |     0.7 | PASS |
| sem | sem_null | SEM_MEASURE.x3.r2 | 0.490002 |    0.49 | PASS |
| sem | sem_null | SEM_MEASURE.y1.std_load | 0.819999 |    0.82 | PASS |
| sem | sem_null | SEM_MEASURE.y1.r2 | 0.672398 |  0.6724 | PASS |
| sem | sem_null | SEM_MEASURE.y2.std_load | 0.759998 |    0.76 | PASS |
| sem | sem_null | SEM_MEASURE.y2.r2 | 0.577597 |  0.5776 | PASS |
| sem | sem_null | SEM_MEASURE.y3.std_load | 0.709999 |    0.71 | PASS |
| sem | sem_null | SEM_MEASURE.y3.r2 | 0.504099 |  0.5041 | PASS |
| sem | sem_null | SEM_STRUCT.absent_or_zero_when_null | absent or coef=0 | 0.0000 | PASS |
| sem | sem_null | discriminant.null_struct_path_nonsignificant | |coef| < 0.10 且 p > .05（真值 γ=0） | coef=0.0000 p=1.0000 | PASS |
| sem | sem_null | discriminant.null_cross_block_uncorrelated | max|r| < 0.10 | 0.0000 | PASS |
| cfa | cfa_likert | r_syntax_parse | parse() ok | ok | PASS |
| cfa | cfa_likert | sprintf_format_args | no mismatch | ok | PASS |
| cfa | cfa_likert | no_r_error | no error | ok | PASS |
| cfa | cfa_likert | banner | === 验证性因子分析 (CFA) === | === 验证性因子分析 (CFA) === | PASS |
| cfa | cfa_likert | data_quality.hooked | rwb_read used | ok | PASS |
| cfa | cfa_likert | likert.CFA_SPEC.n_equals_complete_cases |     505 |     505 | PASS |
| cfa | cfa_likert | likert.CFA_SPEC.p |       5 |       5 | PASS |
| cfa | cfa_likert | likert.dropped_some_rows | n < n_raw | n=505 n_raw=600 | PASS |
| cfa | cfa_likert | likert.n_matches_listwise | 精确等于完整个案数 | oracle=505 output=    505 | PASS |
| cfa | cfa_likert | likert.dropped_count_matches | 剔除量一致 | oracle=95 | PASS |
| cfa | cfa_likert | likert.reports_missing_handling | present | present | PASS |
| cfa | cfa_likert | likert.std_load.all_numeric | TRUE | TRUE | PASS |
| cfa | cfa_likert | likert.std_load_in_open_unit_interval | 0 < lam < 1 | 0.5498 .. 0.7614 | PASS |
| cfa | cfa_likert | likert.std_load_magnitude_reasonable | 0.3 <= lam <= 0.95 | 0.5498 .. 0.7614 | PASS |
| cfa | cfa_likert | likert.std_load_sign_matches_truth | 全部同号（正） | 5/5 正 | PASS |
| cfa | cfa_likert | likert.CFA_RELIAB.F1.in_unit_interval | 0 < CR <= 1 且 0 < AVE <= 1 | CR=0.7308 AVE=0.4753 | PASS |
| cfa | cfa_likert | likert.CFA_RELIAB.F1.cr_ge_ave | CR >= AVE | CR=0.7308 AVE=0.4753 | PASS |
| cfa | cfa_likert | likert.CFA_RELIAB.F2.in_unit_interval | 0 < CR <= 1 且 0 < AVE <= 1 | CR=0.6060 AVE=0.4410 | PASS |
| cfa | cfa_likert | likert.CFA_RELIAB.F2.cr_ge_ave | CR >= AVE | CR=0.6060 AVE=0.4410 | PASS |
| cfa | cfa_likert | likert.fit_indices_in_feasible_range | CFI/TLI 有限, RMSEA>=0, SRMR>=0 | CFI=0.9968 TLI=0.9921 RMSEA=0.0262 SRMR=0.0176 | PASS |
| cfa | cfa_likert | likert.fit_not_artificially_perfect | chisq > 0 且 SRMR > 0 | chisq=5.3793 SRMR=0.0176 | PASS |
| path_analysis | path_overid | r_syntax_parse | parse() ok | ok | PASS |
| path_analysis | path_overid | sprintf_format_args | no mismatch | ok | PASS |
| path_analysis | path_overid | no_r_error | no error | ok | PASS |
| path_analysis | path_overid | data_quality.hooked | rwb_read used | ok | PASS |
| path_analysis | path_overid | PATH_SPEC.n |     500 |     500 | PASS |
| path_analysis | path_overid | PATH_SPEC.n_nodes |       4 |       4 | PASS |
| path_analysis | path_overid | PATH_SPEC.n_edges |       5 |       5 | PASS |
| path_analysis | path_overid | PATH_EQ.m1.r2 |    0.25 |    0.25 | PASS |
| path_analysis | path_overid | PATH_EQ.m2.r2 |    0.16 |    0.16 | PASS |
| path_analysis | path_overid | PATH_EQ.y.r2 | 0.590909 |  0.5909 | PASS |
| path_analysis | path_overid | PATH_EDGE.x>m1.coef | 0.416667 |  0.4167 | PASS |
| path_analysis | path_overid | PATH_EDGE.x>m2.coef | 0.366667 |  0.3667 | PASS |
| path_analysis | path_overid | PATH_EDGE.m1>y.coef |   0.585 |   0.585 | PASS |
| path_analysis | path_overid | PATH_EDGE.m2>y.coef | 0.413636 |  0.4136 | PASS |
| path_analysis | path_overid | PATH_EDGE.x>y.coef |  0.1625 |  0.1625 | PASS |
| path_analysis | path_overid | overid.n_indirect_paths | 2 | 2 | PASS |
| path_analysis | path_overid | PATH_EFFECT.x>y.direct |  0.1625 |  0.1625 | PASS |
| path_analysis | path_overid | PATH_EFFECT.x>y.indirect | 0.395417 |  0.3954 | PASS |
| path_analysis | path_overid | PATH_EFFECT.x>y.total | 0.557917 |  0.5579 | PASS |
| path_analysis | path_overid | invariant.total_equals_direct_plus_indirect | 0.5579 | 0.5579 | PASS |
| path_analysis | path_overid | discriminant.indirect_nonzero | |indirect| > 0.05 | 0.395417 | PASS |
| path_analysis | path_overid | discriminant.total_gt_direct | total > direct | total=0.5579 direct=0.1625 | PASS |
| path_analysis | path_overid | PATH_NOTE.declares_ols_per_equation | present | present | PASS |
| path_analysis | path_overid | overid.note_mentions_overidentification | present | present | PASS |
| path_analysis | path_overid | overid.model_df_positive | df > 0（真过度识别） | 非冗余矩=10 参数=8 df=2 | PASS |
| path_analysis | path_overid | overid.df_does_not_match_saturated | df > 0 | df=2 | PASS |
| path_analysis | path_overid | overid.both_paths_reported | 2 条中介通路逐条列出 | 2 条 | PASS |
| path_analysis | path_overid | overid.total_equals_direct_plus_indirect | 0.5579 | 0.5579 | PASS |
| path_analysis | path_overid | overid.truth.x>m1 | 0.416667 | 0.416667 | PASS |
| path_analysis | path_overid | overid.truth.x>m2 | 0.366667 | 0.366667 | PASS |
| path_analysis | path_overid | overid.truth.m1>y |   0.585 |   0.585 | PASS |
| path_analysis | path_overid | overid.truth.m2>y | 0.413636 | 0.413636 | PASS |
| path_analysis | path_overid | overid.truth.x>y |  0.1625 |  0.1625 | PASS |
| __coverage__ | - | methods_covered |      22 |      22 | PASS |

**汇总：PASS 989 / 989**
