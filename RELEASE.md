# GitHub Release 发布指南

## 准备工作

1. 确保已安装 Git 并配置好 GitHub 账号
2. 确保本地代码已提交并推送到 GitHub

## 创建 Release

### 1. 创建 GitHub 仓库

```bash
# 在 GitHub 上创建新仓库（如果还没有）
# 仓库名：r-workbench
# 描述：AI 驱动的 R 语言数据分析工作台
# 设置为 Public（开源）
```

### 2. 推送代码到 GitHub

```bash
cd r-workbench

# 添加远程仓库（替换为你的 GitHub 用户名）
git remote add origin https://github.com/azazhsCN/r-workbench.git

# 推送代码
git push -u origin master
```

### 3. 创建 Release Tag

```bash
# 创建标签
git tag -a v0.2.2 -m "v0.2.2 - 首个正式版本"

# 推送标签
git push origin v0.2.2
```

### 4. 上传安装包

1. 访问 GitHub 仓库页面
2. 点击 "Releases" → "Create a new release"
3. 选择刚创建的标签 `v0.2.2`
4. 填写 Release 标题：`R Workbench v0.2.2`
5. 填写 Release 说明（见下方模板）
6. 上传安装包文件：`releases/R Workbench Setup 0.2.2.exe`
7. 点击 "Publish release"

## Release 说明模板

```markdown
## R Workbench v0.2.2

AI 驱动的 R 语言数据分析工作台

### 功能特性

- 🤖 AI 对话分析（支持 OpenAI / DeepSeek / 通义千问）
- 📊 13 种统计分析方法
- 📈 6 种学术规范图表
- 📁 数据导入（CSV / Excel / SPSS）
- 📄 Word 报告导出

### 下载

- **Windows 安装包**：`R Workbench Setup 0.2.2.exe` (81 MB)

### 安装说明

1. 下载 `R Workbench Setup 0.2.2.exe`
2. 双击运行安装程序
3. 按照提示完成安装
4. 首次使用需要：
   - 安装 R 语言环境（[下载地址](https://cran.r-project.org/bin/windows/base/)）
   - 配置 AI API Key（在设置页面）

### 技术栈

- Electron 33 + React 19 + TypeScript 5
- ggplot2 图表引擎
- OfficeCLI 报告导出

### 问题反馈

如有问题或建议，请提交 [Issue](https://github.com/azazhsCN/r-workbench/issues)

---

**完整文档**：[README](https://github.com/YOUR_USERNAME/r-workbench#readme)
```

## 更新 README 中的链接

发布后，需要更新 `README.md` 中的 GitHub 链接：

```markdown
# 替换以下内容
git clone https://github.com/your-repo/r-workbench.git

# 改为实际地址
git clone https://github.com/YOUR_USERNAME/r-workbench.git
```

## 注意事项

1. **安装包大小**：81 MB（包含 Electron 运行时）
2. **系统要求**：Windows 10/11 64位
3. **依赖**：需要单独安装 R 语言环境
4. **API Key**：用户需要自行申请 AI 服务的 API Key
