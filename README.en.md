# R Workbench

> 🧪 An AI-driven data analysis workbench for the R language

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![Version](https://img.shields.io/badge/version-v0.3.0-blue.svg)]()
[![Languages](https://img.shields.io/badge/languages-中文%20%7C%20English-brightgreen.svg)]()

[中文](README.md) | **English**

## Introduction

R Workbench is an **AI-driven data analysis desktop application** built for statistics beginners and researchers. You don't need to learn a statistics package's menu tree, and you don't need to memorise R syntax — **just say what you want to know**.

It breaks a complete statistical analysis into four steps and takes care of each one:

| You only need to | R Workbench handles |
|---------|-----------------|
| State your research question<br>"Is there a difference in satisfaction between genders?" | Understand the intent → match the right statistical method |
| — | Generate clean, readable R code |
| — | Run the real computation on your own machine |
| — | Produce an APA three-line table + chart + written interpretation |

### Three ways to work

- **💬 Conversational** — describe your question in plain language; the AI writes and explains the R code, then you run it with one click
- **📊 Wizard-based** — step-by-step guidance for 14 common methods; just pick your variables, no code required
- **🔍 Traceable** — every result expands down to the raw R output; the code is always visible and editable

Supports a **bilingual interface (Chinese / English)**, detected from the system locale or switched manually.

### Target Users

- 🎓 Undergraduates and graduate students in statistics and related fields
- 📝 Students who need to complete data analysis for their thesis
- 📄 Researchers who need to publish journal papers
- 💻 Beginners who want to learn R but find it too steep a learning curve

## Why R Workbench

### 🔒 Your data never leaves your machine

All statistical computation runs through the R installation on your own computer. **Data files are never uploaded anywhere.** No cloud, no account binding, no internet connection required to run an analysis. For survey microdata, clinical records, or unpublished research data, this is often a hard requirement.

It also means your analytical capability is limited only by the **local R ecosystem** — not by how many methods a platform chooses to expose.

### ✅ The numbers come from real computation, not from the AI

This is the project's core design principle: **the AI understands and explains; it does not calculate.**

- Every statistic (t values, p values, regression coefficients, confidence intervals…) is computed by local R
- The AI only reads the computed results and writes an academically formatted interpretation
- **310 statistical-correctness assertions** are built in, cross-checked against independent oracles (hand-derived closed forms, exact permutation distributions, second R packages) — and you can run them yourself at any time

### 🔍 No black box: code, process and numbers are all transparent

- **R code is visible** — the generated code is shown as-is, not hidden behind an opaque API call
- **Raw output is expandable** — behind every three-line table is genuine R output you can inspect
- **Code is editable** — rewrite it if you disagree, then run it again; you keep the final say
- **Results are reproducible** — every step leaves R code behind, so you can re-run it months later

We believe **lowering the barrier must not come at the cost of verifiability**. Beginners need understandable automation, not another tool that produces output nobody can explain.

### 🆓 Free and open source, MIT licensed

No subscription, no per-use billing, no feature gating. Read all the source, modify it, redistribute it.

## Core Features

### 💬 AI Chat Analysis
- Describe your analysis needs in natural language — no need to remember statistical terminology or menu paths
- The AI generates R code and explains it line by line
- Run with one click and get a three-line table + chart + AI interpretation
- Works with OpenAI / DeepSeek / Qwen and other compatible endpoints, including local models (Ollama / LM Studio)

### 📊 Wizard Analysis
- 14 common statistical methods:
  - Descriptive statistics / Frequency statistics / Group summary
  - Independent samples t-test / Paired samples t-test / One-sample t-test
  - One-way ANOVA
  - Chi-square test / Normality test / Non-parametric test
  - Pearson / Spearman correlation
  - Linear regression
  - Cronbach's α reliability analysis
  - **Exploratory Factor Analysis (EFA)** — KMO, Bartlett's test, factor loadings
- Step-by-step guidance with automatic variable filtering
- Automatic R code generation and execution — no formulas to write
- **No extra R packages required**: every method relies only on base R and stats (EFA included)

### 📈 Visualizations
- 6 academic-standard charts:
  - Scatter plot (+ regression line + R²)
  - Histogram (+ normal curve)
  - Boxplot (group comparison)
  - Bar chart (+ error bars)
  - Line chart (trend display)
  - Density plot
- Academic theme template (APA style) — colours and type sizes suitable for submission
- Export PNG images (300 DPI, print-ready)

### 📁 Data Management
- Supports CSV, Excel (.xlsx/.xls), SPSS (.sav) formats
- Data preview and variable info
- Automatic variable type detection (numeric/categorical)
- Missing-value statistics with common sentinel recognition (`NA` / `.` / `-999` etc.)
- Automatic Chinese encoding detection (UTF-8 / GBK / GB18030 / Big5) to avoid mojibake

### 📄 Result Export
- Academic three-line table display (APA style: top rule, header rule, bottom rule, no vertical lines)
- AI-generated interpretation written in the style of a paper's Results section
- One-click copy to Word (three-line table formatting preserved)
- Export Word-format analysis reports
- The current export scope is **the result of a single analysis** (tables + interpretation); multi-analysis reports with embedded figures are planned

### 🌐 Multi-language
- Supports **Simplified Chinese** and **English** interfaces
- Defaults to the system language (Chinese locale → Chinese, otherwise English)
- Manual language switch within the app (Settings page)
- Language-pack architecture for easy extension to more languages

## Tech Stack

| Module | Technology |
|------|------|
| Desktop framework | Electron 33 |
| Frontend | React 19 + TypeScript 5 + Vite |
| Build tool | electron-vite |
| UI styling | Custom CSS |
| Internationalization | react-i18next + i18next |
| Data parsing | xlsx (SheetJS) + papaparse + sav-reader |
| R execution | child_process + Rscript |
| Plotting | ggplot2 |
| AI interface | OpenAI-compatible API |
| Report export | OfficeCLI |
| Packaging | electron-builder (portable zip) |

## Quick Start

### Prerequisites

1. **Node.js** >= 18
2. **R environment** >= 4.0 ([Download R](https://cran.r-project.org/bin/windows/base/))
3. **AI API Key** (any provider, or a local model):
   - [OpenAI](https://platform.openai.com/api-keys)
   - [DeepSeek](https://platform.deepseek.com/)
   - [Qwen](https://dashscope.console.aliyun.com/)

### Install & Run

```bash
# Clone the project
git clone https://github.com/azazhsCN/r-workbench.git
cd r-workbench

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Build the Windows portable/zip package
npm run build:win
```

### First Use

1. After launching, configure your AI API Key in the "Settings" page
2. Return to Home and click "Sample Data" to try it out
3. Use "Wizard Analysis" or "AI Chat" to complete your analysis

## Project Structure

```
r-workbench/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Window management
│   │   └── ipc.ts               # IPC handlers (files/data/R execution)
│   ├── preload/                 # Preload script (secure bridge)
│   │   └── index.ts
│   ├── renderer/                # React renderer
│   │   └── src/
│   │       ├── components/      # Shared components
│   │       ├── contexts/        # React Context
│   │       ├── data/            # Sample datasets
│   │       ├── i18n/            # Internationalization packs
│   │       │   └── locales/     # zh-CN / en-US
│   │       ├── pages/           # Page components
│   │       ├── services/        # Service layer (AI/R/data/plots)
│   │       └── styles/          # CSS styles
│   └── shared/                  # Shared type definitions
│       └── types.ts
├── resources/                   # App resources
├── electron.vite.config.ts      # electron-vite config
├── electron-builder.json5       # Packaging config
├── scripts/validate/            # Statistical correctness validation
├── .github/workflows/           # GitHub Actions (CI)
└── package.json
```

## Statistical Correctness Validation

R Workbench ships with a set of reproducible statistical-correctness validation scripts.
The script first loads the **real `rService.ts`** via esbuild, writes the R code that the
13 method generators actually produce into fixtures, executes it with R, and re-computes the
key statistics using **independent oracles** (hand-derived closed forms, exact permutation
distributions, matrix algebra, second R packages). **310 assertions** across all 14/14 methods.

```bash
# Run validation (requires R >= 4.2; base R is enough, psych::alpha is used as an extra
# cross-check when psych is installed)
Rscript scripts/validate/run_validation.R
```

The script **exits non-zero when any assertion fails**, so it works directly as a CI gate, and
it captures R's stderr so that "warning-only" defects such as `sprintf` argument mismatches
(silently dropped fields) count as failures. Since v0.2.6 it validates the application's
actually-generated code rather than a byte-identical copy of the reference implementation.

- Scripts: `scripts/validate/run_validation.R` (fixtures generated by `generate_fixtures.mjs`)
- Results: `scripts/validate/VALIDATION_RESULTS.md`
- Run instructions & validation boundaries: `scripts/validate/README.md`
- Packaged-artifact acceptance (on demand, after `npm run build:win`):
  `npm run verify:sav` / `verify:ipc` / `verify:lazy` / `verify:negcache` / `verify:packaged`
- Release notes: `docs/validation-release.md`

## Contributing

Issues and pull requests are welcome. Because this project has strict requirements on
**statistical correctness**, a new analysis method must ship with all of: an R code generator,
an output parser, field-level assertion tests, and a statistical validation script based on an
independent oracle. See the development plan for details.

## License

[MIT License](LICENSE)

## Acknowledgements

- [R](https://www.r-project.org/) — Statistical computing and graphics
- [Electron](https://www.electronjs.org/) — Cross-platform desktop framework
- [React](https://react.dev/) — UI library
- [ggplot2](https://ggplot2.tidyverse.org/) — Data visualization
- [i18next](https://www.i18next.com/) — Internationalization framework

---

**R Workbench** — Making professional data analysis approachable — and never a black box 🚀
