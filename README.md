# Wewrite — AI 协作写作补全系统

> **人做船长，AI 做局部最优。** AI 擅长故事架构、情节走向与语句流畅，但生活细节描写差劲、容易有"AI 味"。
> Wewrite 把 GitHub Copilot 的交互模式搬到小说写作：AI 的每一处输出都内联在编辑器里，由作者逐字审阅与裁决。

## 三层写作补全

| 层级 | 交互 | 说明 |
|------|------|------|
| **L1 自动补全** | 输入停顿后光标后出现灰色幽灵文本，`Tab` 接受 | 逐词/逐句补全，快模型 + 最小上下文，首 token 快、不打扰 |
| **L2 场景细节** | 卡壳处选中文本或 `Ctrl+Shift+\`，生成细节并插入 | 个人素材库 FTS5 检索 2-3 条范例注入，专攻生活质感、规避 AI 腔 |
| **L3 段落续写** | 光标在段末按 `Ctrl+\`，流式续写正文，随时 `Esc` 中断 | 人物卡 + 世界观 + 伏笔 + 章节细纲进入上下文，防吃书 |

**防吃书**：人物卡、世界观、伏笔表、章节细纲全部进入续写上下文的稳定前缀；AI 若要偏离大纲，会输出【偏离预警】交由作者裁决，走向决策权始终在作者手里。

**去 AI 味**：内置禁用词表（氛围感、治愈、仿佛…）+ 素材库质感注入 + 文风档案，鼓励用名词、动词、量词与具体数字，替代抽象形容词堆砌。

## 界面

VS Code 风格的本地 IDE，全部 AI 能力内联在编辑器里，无聊天面板、无弹窗。

- 左侧活动栏 + 侧边栏：**资源管理器**（小说/章节树）、**人物卡**、**世界观**、**伏笔**、**文风**、**章节细纲**、**素材库**
- 顶部多标签编辑器，可同时打开多章，独立防抖自动保存
- 底部状态栏：当前章节、保存状态、字数、AI 运行状态
- `Ctrl+Shift+P` 命令面板复用 VS Code 心智

## 技术栈

- 前端：TypeScript + CodeMirror 6 + Vite
- 后端：Express + better-sqlite3（含 FTS5 全文检索）
- AI：官方 SDK（`@anthropic-ai/sdk` / `openai`），DeepSeek / Anthropic 按层路由
- 桌面：Tauri 2（Rust 拉起 Node sidecar，动态端口握手）

## 目录结构

```
├── client/            # 前端（CodeMirror 6 + Vite）
│   └── src/views/     # 7 个侧边栏视图
├── server/            # Express + SQLite 后端
│   ├── src/ai/        # 模型路由 / prompt 构造 / 上下文装配
│   └── src/routes/    # REST + SSE 接口
├── scripts/           # 桌面打包脚本
└── src-tauri/         # Tauri 2 桌面壳（Rust）
```

## 快速开始

### 1. 配置 AI

```bash
cp server/config.example.json server/config.json
```

编辑 `server/config.json`，填入你的 API Key（也可用环境变量 `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` 覆盖）：

```json
{
  "providers": {
    "anthropic": { "apiKey": "", "model": "claude-sonnet-4-6" },
    "deepseek": { "apiKey": "", "model": "deepseek-chat", "baseURL": "https://api.deepseek.com" }
  },
  "routing": {
    "autocomplete": "deepseek",
    "detail": "anthropic",
    "continue": "anthropic"
  }
}
```

> `server/config.json` 已在 `.gitignore` 中，包含真实密钥，不会进入版本库。

### 2. 安装依赖

```bash
npm install
```

### 3. 开发（网页）

```bash
npm run dev
```

浏览器打开 http://localhost:5173 （Vite 代理 `/api` → 后端 127.0.0.1:4000）。

### 4. 构建桌面应用

```bash
npm run build:desktop
```

产物为 NSIS 安装包（`src-tauri/target/release/`），首次构建会下载 Rust 依赖与 Node 运行时。安装后数据落 `%APPDATA%/com.wewrite.app`。

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Tab` | 接受幽灵补全（L1） |
| `Ctrl+\` | 续写一段（L3，流式） |
| `Ctrl+Shift+\` | 生成场景细节（L2） |
| `Esc` | 中断 AI 生成 |
| `Ctrl+Shift+P` | 命令面板 |
| `Ctrl+P` | 快速打开章节 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+S` | 保存 |
| `Ctrl+Shift+E` | 切换到资源管理器 |

## 数据安全

- 后端仅监听 `127.0.0.1`，局域网内不可访问
- API Key 只存于本机 `server/config.json`（或环境变量），不入版本库
- 数据库为本地单文件 SQLite，不联网同步
