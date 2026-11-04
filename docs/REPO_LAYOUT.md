# 仓库结构约定（v0.3.3 根目录整理，T60-T63）

> **本文件是"根目录该放什么"的唯一权威约定。**
> 新增文件到根目录前，请先读本文档并回答那个唯一的问题：**它必须在这吗？**

## 为什么要有这份文档

整理前的根目录有 **17 个**已跟踪文件，混杂了「工具配置」「项目文档」「发布说明」三类，
新人（以及接手的 AI）首次打开难以分辨哪个能动、哪个动不得。

整理后降到 **9 个**。但整理本身不是终点——**如果没有约定，半年后一定会回到原样**。
所以除了移动文件，还要把"为什么这样分"写下来。

> 判断标准不是"根目录文件越少越好"，而是**"新人一眼能看出哪个文件能动"**。
> 为凑数字把 `package.json` / `README.md` 移走属于**负优化**。

## 当前根目录（9 个文件，全部不可移动）

| 文件 | 为什么必须在根目录 |
|------|-------------------|
| `package.json` | npm/Node 的**约定入口**，工具链与 `npm install` 都按根目录找 |
| `package-lock.json` | npm 强制要求与 `package.json` 同目录 |
| `.gitignore` | Git 只认根目录（以及各级子目录）的这个名字 |
| `README.md` | GitHub 仓库首页约定名；移到子目录会让首页空白 |
| `README.en.md` | 同上，英文版（GitHub 不会自动识别，但读者按根目录找） |
| `LICENSE` | GitHub 许可识别只认根目录；移走会导致仓库显示"无许可证" |
| `CHANGELOG.md` | [Keep a Changelog](https://keepachangelog.com/) 事实标准；README 与 Release 都链到它 |
| `electron-builder.json5` | `package.json` 的 `build.extends` 指向它，移动需同步改 `package.json` |
| （无第 9 个）| — |

> 实际上表只有 8 项：`electron-builder.json5` 是**可以**移动的（改 `build.extends` 即可），
> 但它属于"打包工具强相关、且与 `package.json` 配套阅读"的类型，留在根目录收益更大。
> 列在这里是为了**明确记录这个判断**，而不是因为它动不了。

## 已迁移的文件

| 原位置 | 新位置 | 迁移版本 |
|--------|--------|---------|
| `tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json` | `config/` | v0.3.3 |
| `electron.vite.config.ts` | `config/` | v0.3.3 |
| `vitest.config.ts` | `config/` | v0.3.3 |
| `eslint.config.mjs` | `config/` | v0.3.3 |
| `.prettierrc` | `config/` | v0.3.3 |
| `RELEASE.md`（停在 v0.3.1 的滚动文件） | `docs/releases/v0.3.1.md` | v0.3.3 |
| `RELEASE_v0.3.0.md` | `docs/releases/v0.3.0.md` | v0.3.3 |

## ⚠️ 迁移配置文件的 3 个必踩的坑（已实测）

这三条都真实踩过，改动 `config/` 下的文件前**务必先读**：

### 1. `vitest.config.ts`：`root` 必须显式指向仓库根

不设 `test.root` 时，vitest 以**配置文件所在目录**（`config/`）为 root，
测试会被扫到 **0 个**（表现为 "No test files found"）。

另外 `include` 必须写成 `**/*.test.tsx` 这种明确模式。若图省事写宽泛的 `*.tsx`，
`App.tsx` 这类非测试文件也会被当成测试文件，报 **13 个 "No test suite found"**。

### 2. `tsconfig.*.json`：必须显式 `rootDir` + `baseUrl`

不设 `rootDir: ".."` 会报 **TS6059 "not under rootDir"**——因为 `include` 里的
`../src/**` 落在了默认 rootDir（`config/`）之外。

`baseUrl: ".."` 后，`paths` 里的相对路径要按**新的 baseUrl** 写：
`sav-reader` 应为 `node_modules/...`（**不是** `../node_modules/...`，baseUrl 已生效）。

### 3. `electron.vite.config.ts`：`outDir` 必须显式指定

默认产物目录会相对配置文件位置解析，结果落到 `config/out/` 而不是仓库根的 `out/`，
导致 electron-builder 找不到 `main` 入口（`package.json` 的 `main` 写的是 `./out/main/index.js`）。
必须给 main / preload / renderer 三个部分都显式写 `outDir`。

> **共同根因**：这些工具都以**配置文件所在目录**为相对路径基准，
> 而它们原本被放在根目录时这个基准恰好是对的。移动后必须逐个确认基准。

### 4. 最大的回归风险：`package.json` scripts 必须同步改

移动配置后，所有工具都要用 `-c` / `-p` / `--config` 显式传路径。
**只改配置文件不改 scripts，或只改 scripts 不改配置文件，都会导致全线红。**

当前 scripts 里显式传路径的位置（改动配置文件名时必须同步更新）：

```json
"dev":         "electron-vite dev --config config/electron.vite.config.ts"
"build":       "... && electron-vite build --config config/electron.vite.config.ts"
"typecheck:node": "tsc --noEmit -p config/tsconfig.node.json"
"typecheck:web":  "tsc --noEmit -p config/tsconfig.web.json"
"lint":        "eslint src/ --config config/eslint.config.mjs"
"test":        "vitest run --config config/vitest.config.ts"
```

## 📋 发布检查清单（T63）

每次发版前逐项确认：

- [ ] **根目录文件数没有无理由增长**（当前 8 个，见上表）
- [ ] 新增到根目录的每个文件都能回答"它为什么必须在这"
- [ ] `npm run typecheck` 0 错误
- [ ] `npm run lint` 0 error / 0 warning
- [ ] `npm test` 全通过
- [ ] `npm run build` 成功，且产物落在**仓库根的 `out/`**（不是 `config/out/`）
- [ ] `npm run validate:stat` 全 PASS、exit 0
- [ ] README 的断言数 / 测试数与 `VALIDATION_RESULTS.md` 一致
- [ ] `CHANGELOG.md` 已更新，且版本号与 `package.json` 一致

## 新增文件该放哪

| 类型 | 位置 | 例子 |
|------|------|------|
| 工具链配置 | `config/` | 新的构建工具配置、格式化规则 |
| 各版发布说明 | `docs/releases/vX.Y.Z.md` | 只在发版时新增，不滚动 |
| 验证脚本与 fixtures | `scripts/validate/` | 统计 oracle、失败能力 harness |
| 界面截图 | `docs/screenshots/` | 命名必须与**页面**对应，见下节 |
| 源码 | `src/` | 见 `ARCHITECTURE.md` 的项目结构一节 |
| **不确定时** | **先不要放根目录** | 放进最相关的子目录，或先问维护者 |

## 截图命名约定与更新要求

截图放在 `docs/screenshots/`，由 `README.md` / `README.en.md` 引用。

**当前 4 张**（文件名必须与页面内容一致）：

| 文件 | 对应页面 |
|------|---------|
| `welcome.png` | 首页 / 快速开始 |
| `chat.png` | AI 对话分析 |
| `wizard.png` | 向导式分析 |
| `data.png` | 数据管理 |

> 🐞 **历史坑（v0.3.4 已修正）**：这张首页截图曾被误命名为 `settings.png`，
> 导致 README 里"设置"一栏实际展示的是首页。文件名与内容不符时，
> 读者会以为自己看到的是另一页——**这类错误不会报错，只会长期误导**。
> 新增/替换截图后请核对文件名与实际内容一致。

**更新要求**：界面有可见变化（新增方法、调整布局、改文案）时，
截图应与该次发布的版本一致；无法及时更新时，**必须在 README 的截图区块
显式标注拍摄版本与差异**（参考 v0.3.4 的做法：注明"拍摄于 v0.2.x、
方法数已从 7 增至 24、以实际界面为准"）。

> 宁可标注清楚的旧截图，也不要让读者以为过时界面就是当前版本——
> README 是项目的门面，用户会照着截图判断软件能力。
