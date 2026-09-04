# R Workbench

> 🧪 An AI-driven data analysis workbench for the R language

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![Version](https://img.shields.io/badge/version-v0.2.5-blue.svg)]()
[![Languages](https://img.shields.io/badge/languages-中文%20%7C%20English-brightgreen.svg)]()

[中文](README.md) | **English**

## Introduction

R Workbench is an AI-driven data analysis desktop application designed for statistics beginners. With two interaction modes — **conversational** and **wizard-based** — users can perform professional statistical analysis without writing any code.

Supports a **bilingual interface (Chinese / English)**, automatically detected from the system locale, or manually switched within the app.

### Screenshots

| AI Chat Analysis | Wizard Analysis |
|-------------|-----------|
| ![AI Chat Analysis](docs/screenshots/chat.png) | ![Wizard Analysis](docs/screenshots/wizard.png) |

| Data Management | Settings |
|----------|------|
| ![Data Management](docs/screenshots/data.png) | ![Settings](docs/screenshots/settings.png) |

### Target Users

- 🎓 Undergraduates and graduate students in statistics and related fields
- 📝 Students who need to complete data analysis for their thesis
- 📄 Researchers who need to publish journal papers
- 💻 Beginners who want to learn R but find it too steep a learning curve

## Core Features

### 💬 AI Chat Analysis
- Describe your analysis needs in natural language
- AI generates R code automatically and explains it
- Run the code with one click and view the results
- Supports OpenAI / DeepSeek / Qwen (Tongyi Qianwen) APIs

### 📊 Wizard Analysis
- 13 common statistical methods:
  - Descriptive statistics / Frequency statistics / Group summary
  - Independent samples t-test / Paired samples t-test / One-sample t-test
  - One-way ANOVA
  - Chi-square test / Normality test / Non-parametric test
  - Pearson / Spearman correlation
  - Linear regression
  - Cronbach's α reliability analysis
- Step-by-step guidance with automatic variable selection
- Automatic R code generation and execution

### 📈 Visualizations
- 6 academic-standard charts:
  - Scatter plot (+ regression line + R²)
  - Histogram (+ normal curve)
  - Boxplot (group comparison)
  - Bar chart (+ error bars)
  - Line chart (trend display)
  - Density plot
- Academic theme template (APA style)
- Export PNG images (300/600 DPI)

### 📁 Data Management
- Supports CSV, Excel (.xlsx/.xls), SPSS (.sav) formats
- Data preview and variable info
- Automatic variable type detection (numeric/categorical)
- Missing value statistics

### 📄 Result Export
- Academic three-line table display (APA style)
- AI-generated result interpretation
- One-click copy to Word (three-line table format)
- Export Word-format analysis reports

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
| Packaging | electron-builder (NSIS) |

## Quick Start

### Prerequisites

1. **Node.js** >= 18
2. **R environment** >= 4.0 ([Download R](https://cran.r-project.org/bin/windows/base/))
3. **AI API Key** (any provider):
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

R Workbench ships with a set of reproducible statistical-correctness validation scripts
that verify the implemented analysis methods (descriptive statistics, t-tests, ANOVA,
correlation, regression, chi-square, non-parametric, reliability, normality, etc.)
produce results consistent with reference R implementations on standard R datasets.

```bash
# Run validation (requires R >= 4.2, pure base R, no extra dependencies)
Rscript scripts/validate/run_validation.R
```

- Scripts: `scripts/validate/run_validation.R`
- Results: `scripts/validate/VALIDATION_RESULTS.md`
- Run instructions & validation boundaries: `scripts/validate/README.md`
- Release notes: `docs/validation-release.md`

## License

[MIT License](LICENSE)

## Acknowledgements

- [R](https://www.r-project.org/) — Statistical computing and graphics
- [Electron](https://www.electronjs.org/) — Cross-platform desktop framework
- [React](https://react.dev/) — UI library
- [ggplot2](https://ggplot2.tidyverse.org/) — Data visualization
- [i18next](https://www.i18next.com/) — Internationalization framework

---

**R Workbench** — Making professional data analysis easy for everyone 🚀
