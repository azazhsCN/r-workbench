# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.6] — 2026-09-04

> **这是一个必须升级的版本。** v0.2.5 存在多处会静默产出错误结果、甚至完全无法运行的缺陷：
> 13 种分析方法中只有 1 种能端到端产出三线表，`.sav` 导入只导入 1 行数据，
> 且工程门禁（typecheck / CI / 验证脚本）全部失效，无法发现上述任何问题。
>
> **凡在 v0.2.5 中用 `.sav` 跑过分析的用户，必须用 v0.2.6 重新导入并重跑，不得沿用旧结果。**

### 修复 — 数据丢失（严重）

- **`.sav`（SPSS）导入每份文件只导入 1 行数据。** 上游依赖 `sav-reader@2.0.8`（npm 最新版）的
  `readNextRow()` / `readAllRows()` 在任何字节码压缩（`$FL2`）的 `.sav` 上都会在第 1 行之后误报 EOF：
  `CommandReader.peekByte()` 在 8 字节命令块剩余字节全为 0 时返回 `undefined`，且未处理 SPSS EOF 码 252
  （`str += null` 还会伪造一行 `{name:"null"}`）。
  **v0.2.5 对每个压缩 `.sav` 只导入 1 个 case，却照常输出统计结果**（n=1）。
  现改为自实现的修正版逐行读取（`src/main/savImport.ts`），
  并以 R `foreign::read.spss` 对 30 万行文件的前 20 万行做逐值交叉验证（n / sum(id) / sum(x) / sum(y) 完全一致）。
- **SPSS 数值列全部被标记为字符串列。** `v.type === 'numeric'` 与数值枚举（`numeric = 0`）比较恒假，
  导致向导页的数值方法选不到任何变量。现与数值枚举比较（实测 3 个数值列，旧代码 0 个）。
- **打包版 Word 导出永久失效。** `extraResources.to` 落地为 `resources/officecli.exe`，
  而检测代码只查找 `resources/bin/officecli.exe`（仅开发模式可用）。现两边统一为 `bin/`。
- **20 万行上限完全失效。** `sav.meta.nrows` 在 `SavMeta` 上不存在，条件恒真且
  `readAllRows()` 会先把全部行读入内存再被 `slice()` 丢弃。现改为逐行增量读取并在上限停止，
  返回 `truncated` 标志与真实总行数。

### 修复 — 分析方法（13 种中 12 种此前不可用）

- **6 个方法产出的 R 代码 R 本身无法解析。** `else` 被写在 `if` 体的下一行（R 语法要求同行或使用花括号），
  导致配对样本 t 检验、单样本 t 检验、卡方检验、相关分析、信度分析、非参数检验
  **从未成功运行过一次**，用户看到的是英文 `unexpected 'else'`。现统一改为花括号形式。
- **线性回归生成非法公式。** `lm("y" ~ "x")` 会被 R 判为 `invalid term in model formula`，
  **回归功能从未执行过**。现改用 `reformulate()`。
- **7 个方法不产出三线表与 AI 解读。** `detectAnalysisType` 的 `' N='` 启发式置于判定链首位，
  而分组统计行恰好都是 `组1 (0): N=19` 形式，于是 t 检验、ANOVA、单样本 t、非参数检验全被判为
  描述性统计 → `tables` 为空 → 三线表与 AI 解读双双消失。现改为只认生成器输出的唯一横幅
  `=== 方法名 ===`；无法识别时返回 `unknown` 而非猜测，并补齐正态性 / 频数 / 分类汇总三个缺失解析器。
- **ANOVA 的 F 与 p 从错误的列读出，且把结论写反。** 实测解析出 `F = 2, p = 2`（真值 `F = 119.2645, p = 1.67e-31`），
  注记写成"组间差异不显著"。现锚定到数据行并补齐 `Df / SS / MS / η² / ω² / Tukey HSD` 事后检验。
- **含负值的变量被静默删除。** 数值捕获组 `[\d.]` 不含负号与科学计数，
  实测 4 个变量只解析出 1 行。现改为以 `|` 分隔的明确字段，数值统一走 `toNum()`。
- **标准化回归系数实际是零阶相关系数。** 逐变量做简单回归得到的是 `cor(xⱼ, y)`，不是标准化偏回归系数，
  符号都可能相反（实测 x2 报 +0.22，真值 −0.15）。现对整个设计矩阵标准化后做多元回归，
  与独立 oracle `b·sd(x)/sd(y)` 逐位一致。
- **信度分析不支持反向计分。** 一个 α = 0.89 的良好量表会被判为"信度不佳"。
  现自动识别并与总分负相关的项目做反向计分，并补充标准化 α、α 的 95% 置信区间与逐项删除分析。
- **7 处 `sprintf` 格式串参数个数不匹配**，R 仅发出 warning（而应用丢弃 stderr），
  字段被静默丢弃（例如分类汇总的 `max` 列、回归的残差标准误）。

### 修复 — p 值报告

- **所有方法使用 `sprintf("%.4f")` 输出 p 值**，`1.29e-10` 会显示为 `0.0000`，论文无法报告 `p < .001`。
  现统一为 APA 风格（`p < 0.001` 或保留 3 位小数），同时输出保留 8 位有效数字的原始数值供判断与 AI 解读使用。
- **合法的 `p = 0` 被 `||` 当成缺失值**，产生 `kv.p = 1` 传给 AI，导致"结论写极显著、Prompt 里 p = 1"的矛盾。
  现全部改用 `??`。

### 修复 — 绘图（6 种图表中 5 种有实缺陷）

- **字体硬编码导致全部图表失败。** `font_add("simhei", "simhei.ttc")` 写死了在多数机器上不存在的文件名
  （通常只有 `simhei.ttf`）；且 `source("theme_academic.R")` 位于 `tryCatch` 之外，
  错误完全逃逸出应用错误处理——装了 `showtext` 的用户会遇到 16/16 图表失败且无任何提示。
  现用 `font_files()` 解析真实路径、以 `try()` 包裹、失败安全回退，并将 `source()` 移入 `tryCatch`。
- **调色板只有 6 色却用于 `scale_fill_manual`**，分组数 ≥ 7 时直接报错并留下全白 PNG
  （实测 8 组：`Insufficient values in manual scale. 8 needed but only 6 provided.`）。现改为动态调色板。
- **"均值柱状图 / 条目均值图"实际绘制的是计数**（ANOVA 场景把连续变量转成 32 个 x 类别的梳状图）。
  现实现真正的 `stat_summary(fun = mean)` + `mean_se` 误差线，条目均值图用 `colMeans`。
- **折线图按数据框行序连线**（锯齿状，与旁边的相关系数相互矛盾），现按 x 排序。
- **散点图无 R² 标注；直方图叠加的是核密度估计而非正态曲线；柱状图无误差线**（README 声称均有）。
- **缺失值静默丢点**（ggplot 的 `Removed N rows` 警告走 stderr 被丢弃），现显式过滤并标注剔除数量。
- **兜底主题本身是坏的**：`save_plot(p, f, w, h)` 形参名与生成代码的 `width = / height =` 不匹配，
  且缺少全部 `rwb_*` 助手。

### 修复 — 数据导入

- **CSV 导入完全不可用。** `dialog.readFile()` 未传 `asText` → `content` 恒为 `null` →
  任何 `.csv` 都会报"不支持的文件格式: .csv"。现改为始终返回原始字节，由渲染进程解码。
- **GBK/GB18030 中文 CSV 乱码。** 主进程硬编码以 UTF-8 读取。现新增编码探测
  （BOM → 严格 UTF-8 → GB18030 → Big5，附用户手动覆盖），实测 GBK 文件 0 处替换字符。
- **Excel 日期变成浮点序列号**（`2024-01-14` → `45306.0005`），并被当作数值变量送进 R。
  现启用 `cellDates` 并对 SheetJS 的 1ms 回读误差做吸附；另补齐多 sheet 选择、空表头重命名、
  无缓存值的公式单元格告警与错误值按缺失处理。
- **分隔符未探测**：分号 CSV 塌成单列 `a;b;c`。现启用自动探测。
- **`dynamicTyping` 破坏标识列**：学号 `007` 变成 `7`（不同 ID 被合并成同一组），
  布尔列被误判为数值变量。现移除该选项，类型推断统一交给 `analyzeColumns`。
- **缺失值哨兵未识别**：`NA`/`.` 使列变成 `unknown` 而在向导中彻底消失，`-999` 被计为有效观测
  （可让均值偏移约 500 个单位）。现归一化哨兵集合（`NA`/`N/A`/`.`/`-999`/`-99` 等），
  `99`/`999` 作为 SPSS 惯例由用户显式启用（因为 99 分、99 岁都是真实观测）。
- **Papa.parse 的错误被忽略**：字段数不匹配的行被静默错位，现上浮为带行号的警告。

### 修复 — 工程门禁

- **`npm run typecheck` 共 13 个错误**（node 3 + web 10），且因 `&&` 短路导致 web 目标从不执行、
  极易误判为"只有 3 个问题"。现两个目标**分别** 0 错误。
- **`window.api` 静默退化为 `any`。** `electron.d.ts` 的 `../preload/index` 指向不存在的路径，
  在 `skipLibCheck: true` 下被忽略，这正是 IPC 契约漂移长期无法被类型系统发现的通道。
  现引入 `@preload/*` 别名（实测注入类型错误可报出完整 `AppAPI` 形状）。
- **唯一 CI 的验证任务永远返回成功。** `run_validation.R` 结尾只 `cat()` 汇总、无退出码控制，
  实测把 `EPS` 改为 `-1` 后 `PASS: 0 / 33` 仍 **exit 0**。
- **统计验证脚本是同义反复。** 14 处 `compare_code()` 的"参考实现"与"工作台实现"是**逐字符相同**的字符串，
  即同一段代码与自己比较，永远通过，且从不读取或执行 `rService.ts`。
  现改为从真实 `rService.ts` 生成 R 代码，并用 **14 个独立 oracle**（手算闭式解、精确置换分布、
  矩阵代数、第二 R 包）复算 **282 个断言**；**失败能力已证**（把 `sd` 改成 `var` → FAIL 3, exit 1）。
- **新增 CI 门禁**（`.github/workflows/ci.yml`，ubuntu + windows 矩阵，typecheck 两个目标分步执行、lint、test、build）。
- **新增测试框架与 158 个测试**（Vitest），包括"横幅 → 解析器"契约测试、
  生成器产出必须能被 R `parse()`、以及遍历所有生成器 `sprintf` 的格式串/参数个数一致性检查。
- **构建产物未压缩且无代码分割**：入口 chunk 1518 KB。现开启 minify 与 vendor 拆分，入口降至 **165 KB**。
- **打包体积**：见"已知问题"。

### 修复 — 其它

- **i18n 插值在两种语言里全部失效**（24 处），界面直接显示字面 `{total}` / `{version}` / `{path}` / `{ext}`。
  原因是 i18next 默认分隔符为 `{{ }}` 而语言包使用单花括号。现设 `prefix: '{'` / `suffix: '}'`，
  348 个键在中英文间完全对齐、0 处占位符不一致。
- **AI 配置首次启动不可用。** `aiService.ts` 的 `rest` 未定义 → `ReferenceError` 被 `catch {}` 吞掉 →
  `config` 永不赋值且旧版明文 API Key 永久残留在 `localStorage`。现补回解构（并真正清除明文 key）。
- **CSP 阻止所有本地 AI 端点**（Ollama / LM Studio），现允许 `http://localhost:*` 与 `http://127.0.0.1:*`。
- **设置页连接测试在每次重启后必定失败**（key 只在 safeStorage，页面从不调用 `loadApiKey`）；
  切到"自定义"服务商时保留上一家的 baseUrl（可能把 Key 发往非预期端点）。
- **切换页面会销毁进行中的分析**：`switch` 渲染导致打开"设置"即卸载对话页，
  整段 AI 对话、已执行的 R 结果、三线表与图表全部丢失。现 5 个页面常驻挂载。
- **R 执行失败会永久卡在"执行中"**（无 `try/finally`）；流式请求无超时、无中止。
- **`fs:writeFile` + 无 `will-navigate` 防护 + `openExternal` 无协议白名单**构成写文件后打开执行的链路，
  现补导航防护、协议白名单、单实例锁、生产环境禁用 DevTools。
  **注意**：`r:execute` 本身就是任意 R 代码执行原语，因此路径白名单**不构成安全边界**；
  该信任模型已在文档中明确说明。
- **`officecli:generateDocx` 为 20×10 表格创建 226 个进程**（每单元格一次），现为 3 次（create / batch / close）。
- **权限处理器**：一刀切拒绝所有权限会静默破坏渲染进程的复制按钮
  （`navigator.clipboard.writeText` 需要 `clipboard-sanitized-write`），现仅放行该权限。

### 已知问题（计划于 v0.3.x 处理）

- 打包产物的 asar 仍包含 `scripts/validate/**`（含生成的 R fixtures）、`vitest.config.ts`、
  `docs/screenshots/` 与完整 `node_modules`（894 项）；已备好 `files` 白名单方案，
  但应用后需重新打包**并启动一次打包后的应用**验证。
- `r:packages` 安装失败时仍返回 `{ installed: [] }`，设置页看不到失败原因。
- macOS / Linux 未做真机验证：仅证明非 Windows 分支"不报错且安全回退"，
  未验证真机中文字体渲染与 DMG / AppImage 打包。
- 未对打包后的 Electron 应用做人工 GUI 走查（无显示环境）。
- 保留 6 个 lint warning（5 个 `react-refresh/only-export-components`，其中 1 个源于为测试导出 `METHODS`；
  1 个未使用变量）。

### 验证方式

| 检查项 | 结果 |
|--------|------|
| `npm run typecheck:node` | 0 错误 |
| `npm run typecheck:web` | 0 错误 |
| `npm run lint` | 0 error / 6 warning |
| `npm test` | 9 个文件 / **158 个测试全通过** |
| `npm run build` | 成功，入口 chunk 165 KB，最大 429 KB |
| `Rscript scripts/validate/run_validation.R` | 13/13 方法，**282 断言全通过**，注入错误时 exit 1 |
| 端到端（真实 R 4.6.0） | **13/13 方法**横幅识别 + 非空三线表 + 数据行 |
| ANOVA 基准（iris） | `F = 119.2645, p = 1.67e-31` |
| 打包产物验收（`npm run verify:packaged`） | `officecli:detect → found: true`（1.0.153），20 个 handler 注册成功，`.sav` 6 行 / 20 万行截断通过 |

## [0.2.5] — 2026-07-03

- 国际化（react-i18next）：中文 / 英文语言包与软件内切换。
- 发布方式由 NSIS 安装包改为 zip 绿色版（免安装、无需管理员权限）。

## [0.2.3] — 2026-06-30

- 审查问题修复（ANOVA 临时变量名、统一转义、组序稳定、`.sav` 解析上限）。

## [0.2.2] — 2026-07-02

- 二次审查修复（PlotViewer 影子 `rEscape`、`global.css` 选择器、`r:detect` 改用 `execFile`）。
- 开源发布准备：MIT LICENSE、package.json 元数据、应用图标、electron-builder 全平台配置。

## [0.2.1] — 2026-06-30

- 审查问题修复：`r:plot` 主题加载与 `tryCatch`、R 包管理白名单、`rEscape` 统一、临时目录清理。

## [0.2.0] — 2026-06-30

- 图表引擎：`theme_academic.R` 学术主题、`plotService.ts`、`PlotViewer`、`r:plot` / `r:packages` / `r:install`。
- 新增 5 种分析方法（单样本 t 检验、正态性检验、非参数检验、频数统计、分类汇总）。

## [0.1.3] — 2026-06-30

- 安全加固：3 Blocking + 8 Should-fix（`make.names` 构造公式、`execFileAsync` 替代 `execAsync`、`savePath` 校验等）。

## [0.1.2] — 2026-06-26

- Bug 修复与技术债务清理：ANOVA 括号不匹配、`RExecuteResult` 类型对齐、3 种方法迁移到 `rService`、死代码清理。

## [0.1.1] — 2026-06-25

- 学术三线表（APA 规范）、R 输出解析器、AI 结果解读、OfficeCLI Word 报告导出。

## [0.1.0] — 2026-06-15

- 首个版本：Electron + React + TypeScript 脚手架、IPC 通信、数据导入（CSV / Excel / SPSS）、
  AI 对话、向导式分析（8 种方法）、示例数据集、HTML 报告导出。
