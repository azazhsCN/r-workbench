# 统计验证结果（真实生成器 + 独立 oracle）

R 版本：R version 4.6.0 (2026-04-24 ucrt)
生成时间：2026-10-02 17:53:13
fixtures 目录：generated
被测代码：src/renderer/src/services/rService.ts（esbuild 打包后运行时调用，非手抄副本）

方法覆盖：**13 / 13**
断言总数：**282**（PASS 282 / FAIL 0）

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
| __coverage__ | - | methods_covered |      13 |      13 | PASS |

**汇总：PASS 282 / 282**
