# R Workbench

> 🧪 AI 驱动的 R 语言数据分析工作台

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![Version](https://img.shields.io/badge/version-v0.3.1-blue.svg)]()
[![Languages](https://img.shields.io/badge/languages-中文%20%7C%20English-brightgreen.svg)]()

**中文** | [English](README.en.md)

## 简介

R Workbench 是一款面向统计学初学者与研究者的 **AI 驱动数据分析桌面应用**。你不需要学习统计软件的菜单，也不需要背 R 语法——**用一句话说清你想知道什么**，剩下的交给它。

它把一次完整的统计分析拆成四步，每一步都替你接住：

| 你只需要 | R Workbench 负责 |
|---------|-----------------|
| 一句研究问题<br>「不同性别在满意度上有没有差异？」 | 理解需求 → 匹配合适的统计方法 |
| — | 生成规范、可读的 R 代码 |
| — | 在你的电脑上执行真实计算 |
| — | 输出学术三线表 + 图表 + 结果解读 |

### 三种使用方式

- **💬 对话式** — 用自然语言描述研究问题，AI 生成 R 代码并解释，一键执行看结果
- **📊 向导式** — 17 种常用方法分步引导，选变量即可，无需接触代码
- **🔍 可追溯** — 每个结果都能展开看到原始 R 输出，代码随时可查、可改

支持**中英文双语界面**，自动跟随系统语言，也可手动切换。

### 适用人群

- 🎓 统计学相关专业的专科生、本科生、入门研究生
- 📝 需要完成毕业论文数据分析的学生
- 📄 需要发表期刊论文的研究者
- 💻 想学 R 但被门槛挡住，希望"边用边看"的初学者

## 为什么选择 R Workbench

### 🔒 数据不出本机

所有统计分析都通过你本地安装的 R 执行，**数据文件从不离开你的电脑**。没有云端上传、没有账号绑定、不需要联网也能分析。对涉及问卷原始数据、临床数据、未发表研究数据的场景，这一点往往是硬性要求。

同时这也意味着：你的分析能力**只受本地 R 生态限制**，而不是某个平台愿意开放多少方法。

### ✅ 数字来自真实计算，不是 AI 编出来的

这是本项目的核心设计原则：**AI 负责理解与解释，不负责算数。**

- 统计量（t 值、p 值、回归系数、置信区间……）全部由本地 R 计算得出
- AI 只读取计算结果，负责撰写符合学术规范的文字解读
- 内置 **310 项统计正确性断言**，用独立 oracle（手算闭式解、精确置换分布、第二 R 包）交叉复算，可随时自行运行验证

### 🔍 拒绝黑箱：代码、过程、数字全部透明

- **R 代码可见**：AI 生成的代码原样展示，不是隐藏的黑盒调用
- **原始输出可展开**：三线表背后是真实的 R 输出，随时核对
- **代码可改**：不满意就自己改，改完再跑——你始终保留最终控制权
- **结果可复现**：每一步都有 R 代码留痕，几个月后回来还能重跑

我们相信：**降低门槛不应该以牺牲可验证性为代价**。初学者需要的是看得懂的自动化，而不是又一个"点了就出结果但不知道为什么"的软件。

### 🆓 免费开源，MIT 许可

没有订阅、没有按次计费、没有功能阉割。你可以查看全部源码、自行修改、二次分发。

## 核心功能

### 💬 AI 对话分析
- 用自然语言描述分析需求，无需记忆统计术语或菜单路径
- AI 自动生成 R 代码并逐行解释
- 一键执行，直接得到三线表 + 图表 + AI 解读
- 支持 OpenAI / DeepSeek / 通义千问等兼容接口，也可接本地模型（Ollama / LM Studio）

### 📊 向导式分析
- 17 种常用统计分析方法：
  - 描述性统计 / 频数统计 / 分类汇总
  - 独立样本 t 检验 / 配对样本 t 检验 / 单样本 t 检验
  - 单因素方差分析 (ANOVA)
  - 卡方检验 / 正态性检验 / 非参数检验
  - Pearson / Spearman 相关分析
  - 线性回归
  - Cronbach's α 信度分析
  - **探索性因子分析 (EFA)** — KMO、Bartlett 球形检验、因子载荷
  - **验证性因子分析 (CFA)** — 纯 base R 的 ML 估计，CFI / TLI / RMSEA / SRMR、
    标准化载荷（含 SE / z / p / R²）、CR / AVE，附失配模型判别力证据
  - **内容效度指数 (CVI)** — I-CVI、S-CVI/Ave、S-CVI/UA、修正 Kappa
  - **Harman 单因子检验** — 未旋转主成分，首成分解释率与 λ>1 成分数，筛查共同方法偏差
- 分步引导，自动筛选可用变量
- 自动生成 R 代码并执行，无需手写公式
- **无需额外安装 R 包**：全部方法仅依赖 base R 与 stats
  （EFA 与 **CFA** 也如此——CFA 不依赖 `lavaan`）

### 📈 可视化图表
- 6 种学术规范图表：
  - 散点图（+ 回归线 + R²）
  - 直方图（+ 正态曲线）
  - 箱线图（分组对比）
  - 柱状图（+ 误差线）
  - 折线图（趋势展示）
  - 核密度图
- 学术主题模板（APA 规范），配色与字号适合直接投稿
- 导出 PNG 图片（300 DPI，满足印刷要求）

### 📁 数据管理
- 支持 CSV、Excel (.xlsx/.xls)、SPSS (.sav) 格式
- 数据预览与变量信息展示
- 自动识别变量类型（数值/分类）
- 缺失值统计与常用缺失值哨兵识别（`NA` / `.` / `-999` 等）
- 中文编码自动探测（UTF-8 / GBK / GB18030 / Big5），避免乱码

### 📄 结果导出
- 学术三线表展示（APA 规范：顶线、表头线、底线，无竖线）
- AI 自动生成结果解读，符合论文"结果"章节的写法
- 一键复制到 Word（保留三线表格式）
- 导出 Word 格式分析报告
- 当前导出的范围是**单次分析的结果**（表格 + 解读）；多分析汇总与图片嵌入在规划中

### 🌐 多语言
- 支持**简体中文**与 **English** 双语界面
- 默认跟随系统语言（中文环境显示中文，否则英文）
- 软件内可手动切换（设置页）
- 采用语言包架构，方便后续扩展更多语言

## 技术栈

| 模块 | 技术 |
|------|------|
| 桌面框架 | Electron 33 |
| 前端 | React 19 + TypeScript 5 + Vite |
| 构建工具 | electron-vite |
| UI 样式 | 自定义 CSS |
| 国际化 | react-i18next + i18next |
| 数据解析 | xlsx (SheetJS) + papaparse + sav-reader |
| R 执行 | child_process + Rscript |
| 绘图 | ggplot2 |
| AI 接口 | OpenAI 兼容 API |
| 报告导出 | OfficeCLI |
| 打包 | electron-builder (zip 绿色版) |

## 快速开始

### 前置条件

1. **Node.js** >= 18
2. **R 环境** >= 4.0（[下载 R](https://cran.r-project.org/bin/windows/base/)）
3. **AI API Key**（任选一个服务商，或使用本地模型）：
   - [OpenAI](https://platform.openai.com/api-keys)
   - [DeepSeek](https://platform.deepseek.com/)
   - [通义千问](https://dashscope.console.aliyun.com/)

### 安装运行

```bash
# 克隆项目
git clone https://github.com/azazhsCN/r-workbench.git
cd r-workbench

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建生产版本
npm run build

# 打包 Windows 绿色版（zip）
npm run build:win
```

### 首次使用

1. 启动后进入「设置」页面配置 AI API Key
2. 回到首页，点击「示例数据」快速体验
3. 使用「向导式分析」或「AI 对话」完成分析

## 项目结构

```
r-workbench/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 窗口管理
│   │   └── ipc.ts               # IPC 处理器（文件/数据/R执行）
│   ├── preload/                 # 预加载脚本（安全桥接）
│   │   └── index.ts
│   ├── renderer/                # React 渲染进程
│   │   └── src/
│   │       ├── components/      # 通用组件
│   │       ├── contexts/        # React Context
│   │       ├── data/            # 示例数据
│   │       ├── i18n/            # 国际化语言包
│   │       │   └── locales/     # zh-CN / en-US
│   │       ├── pages/           # 页面组件
│   │       ├── services/        # 服务层（AI/R/数据/图表）
│   │       └── styles/          # CSS 样式
│   └── shared/                  # 共享类型定义
│       └── types.ts
├── resources/                   # 应用资源
├── electron.vite.config.ts      # electron-vite 配置
├── electron-builder.json5       # 打包配置
├── scripts/validate/            # 统计正确性验证脚本
├── .github/workflows/           # GitHub Actions（CI）
└── package.json
```

## 统计正确性验证

R Workbench 内置一组可复现的统计正确性验证脚本。脚本会先用 esbuild 加载**真实的
`rService.ts`**，把 17 个方法生成器实际产出的 R 代码写入 fixtures，再交给 R 执行，
并用**独立 oracle**（手算闭式解、精确置换分布、矩阵代数、第二 R 包）复算关键统计量，
逐项比对。共 **536 项断言**，覆盖 **17/17 个方法**。

```bash
# 运行验证（需 R >= 4.2；base R 即可，装有 psych 时会额外用 psych::alpha 交叉验证）
Rscript scripts/validate/run_validation.R

# 反向自证：向 oracle 注入错误，确认断言真的会变红且退出码为 1
Rscript scripts/validate/prove_failure_ability.R
```

脚本在断言失败时**以非 0 退出码结束**（可直接作为 CI 门禁），并会捕获 R 的 stderr，
把 `sprintf` 参数不匹配这类"只发 warning、静默丢字段"的问题判为失败。
自 v0.2.6 起，验证的是应用真实生成的代码，而不再是与参考实现逐字符相同的副本。

- 脚本：`scripts/validate/run_validation.R`（fixtures 由 `generate_fixtures.mjs` 生成）
- 结果：`scripts/validate/VALIDATION_RESULTS.md`
- 运行说明与验证边界：`scripts/validate/README.md`
- 打包产物验收（按需运行，需先 `npm run build:win`）：
  `npm run verify:sav` / `verify:ipc` / `verify:lazy` / `verify:negcache` / `verify:packaged`
- 发布说明：`docs/validation-release.md`

## 参与贡献

欢迎提交 Issue 与 Pull Request。由于本项目对**统计结果正确性**有较高要求，新的分析方法
必须同时提供：R 代码生成器、输出解析器、字段级断言测试，以及基于独立 oracle 的
统计验证脚本。详见开发计划文档。

## 开源许可

[MIT License](LICENSE)

## 致谢

- [R 语言](https://www.r-project.org/) — 统计计算与图形
- [Electron](https://www.electronjs.org/) — 跨平台桌面框架
- [React](https://react.dev/) — 用户界面库
- [ggplot2](https://ggplot2.tidyverse.org/) — 数据可视化
- [i18next](https://www.i18next.com/) — 国际化框架

---

**R Workbench** — 让专业数据分析不再有门槛，也不再是黑箱 🚀
