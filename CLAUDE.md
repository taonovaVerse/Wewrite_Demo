# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Wewrite — AI 协作写作补全系统（「人做船长，AI 做局部最优」）。VS Code 风格的本地写作 IDE，全部 AI 能力内联在 CodeMirror 编辑器中（无聊天面板、无弹窗）。

npm workspaces monorepo：`client`（原生 TS + CodeMirror 6 + Vite）、`server`（Express + better-sqlite3）、`src-tauri`（Tauri 2 桌面壳，Rust 拉起 Node sidecar）。全部中文注释与 UI 文案。

## 常用命令

```bash
npm run dev              # 同时起 server(tsx watch :4000) 与 client(Vite :5173)；浏览器打开 http://localhost:5173，Vite 代理 /api → 4000
npm run build            # 构建 client(tsc+vite build) + server(tsc → server/dist)
npm run build -w server  # 单构建任一 workspace（client 同理）
npm run start            # 只运行已构建的 server（node dist/index.js）
npm run build:desktop    # 完整桌面打包：build + package-server + tauri build（NSIS 安装包）
```

**没有测试框架、没有 linter**。校验只靠 `tsc`（即各 workspace 的 build）。不要去找或假设存在测试脚本。

首次开发需 `cp server/config.example.json server/config.json` 并填入 API Key（或设 `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` 环境变量）。`config.json` 已在 .gitignore。

## 三层 AI 架构（核心）

服务端 `server/src/ai/` 按「层」组织，层 = 交互方式 + 模型路由。数据流：`routes/ai.ts` 解析请求 → `ai/context.ts` 从 SQLite 装配 system/user prompt → `ai/router.ts` 按层解析 provider → `providers.ts` 调 Anthropic / OpenAI-compatible SDK（流式）。

| 层 | 接口 | 行为 |
|---|---|---|
| L1 自动补全 | POST `/api/ai/autocomplete` | 返回单段补全文本（非流式，后端截断 120 字），前端渲染为幽灵文本 |
| L2 场景细节 | POST `/api/ai/detail` | 返回 `{ text, sources }`，`sources` 是素材库检索命中的范例 |
| L3 段落续写 | POST `/api/ai/continue` | SSE 流式，事件 `token` / `warning` / `error` / `done` |

- 模型路由在 `server/config.json`：`routing.autocomplete/detail/continue` 各指到 `providers` 里某个 provider（anthropic / deepseek 均可配，`mock` 为内置示例正文，用于无密钥本地联调）。`resolveProvider` 在密钥缺失时抛错。
- Anthropic 走 prompt caching：`context.ts` 把文风/上下文作为 user 前缀并设 `cachePrefix`，`providers.ts` 用 `cache_control: { type: 'ephemeral' }`。
- 防吃书：L3 稳定前缀含人物卡 + 世界观 + 未完结伏笔 + 章节细纲；AI 若偏离大纲输出【偏离预警】，`routes/ai.ts` 监测到即发 `warning` 事件，前端会尝试剥离预警段。
- 去 AI 味：`ai/prompts.ts` 维护禁用词表（DEFAULT_TABOO）与句式雷区，要求用名词/动词/量词/具体数字替代抽象形容词。

## 数据库（server/src/db.ts）

- 启动时 `CREATE TABLE IF NOT EXISTS` 全部表；空库时 `seedIfEmpty()` 种一部示例小说「雨夜便利店」。
- 数据文件 `server/data/wewrite.db`，WAL 模式。数据目录可用 `--data-dir` CLI 参数或 `WEWRITE_DATA_DIR` 覆盖（桌面端由 Tauri 传入 appData 目录）。
- 表：novels / chapters（含 blueprint 细纲）/ characters / world_settings / foreshadowing / style_profiles / detail_bank。
- **注意**：`detail_bank_fts` 是 external-content FTS5 表（trigram），schema 末尾**每次启动都 DROP 重建并重灌**，与它的 AI/AD/AU 触发器配套。改动 detail_bank 相关 schema 时注意保持三者一致。

## 素材库检索（server/src/ai/detailBank.ts）

从场景提示提取中文检索词（整段前缀 + 3 字滑窗，去停用字，适配 FTS5 trigram 与中文子串），查 FTS，异常时降级 LIKE。L2 用它检索 2-3 条范例注入 prompt。

## 前端（client/src）

- 无框架，入口 `client/src/main.ts`（初始化编辑器、TabManager、注册命令与快捷键）。
- **幽灵补全（L1）在 `client/src/editor.ts`**：StateField 存 suggestion + GhostWidget 渲染 `.cm-ghost`。输入停顿 800ms 触发（句号后 0ms），连续两次 dismiss 进 30s 冷却。Tab 全接受 / 右箭头逐词接受 / Esc 丢弃。改这段逻辑要同时关注 `acceptAll` / `acceptNextWord` / 冷却状态机。
- `client/src/tabs.ts` TabManager：多章节标签，800ms 防抖自动保存（`flushActive`），切页/关页前先 `cancelSuggestion` 并用 `isSwitching` 抑制虚假 onChange/补全。
- 7 个侧边栏视图在 `client/src/views/`：explorer / characters / world / foreshadow / style / blueprint / bank。CRUD 类视图复用 `views/crud.ts` 的 `createCrudView` 工厂。
- API 基址（`apiBase.ts`）：浏览器走 Vite 代理（base 为空）；Tauri 内通过 `get_backend_port` command 取实际端口。

## 桌面壳（src-tauri）

- `src/lib.rs` setup 中：非 dev 模式找一个空闲端口，spawn `wewrite-server.exe` sidecar（参数 `--port <port> --data-dir <appData>`），轮询端口 15s 等就绪，前端经 `get_backend_port` 拿端口；退出时 kill sidecar。dev 模式直接写死 4000（依赖 `npm run dev` 已起后端，前端走 Vite 代理）。
- sidecar 的 stdout/stderr 落 `%APPDATA%/com.wewrite.app/backend.log`，排查启动失败先看这里。
- Windows 特有：`to_normal_path` 去掉 `\\?\` verbatim 前缀（Node 模块加载器解析不了）；node.exe 是控制台程序，spawn 加 `CREATE_NO_WINDOW` 防弹黑窗。

## 桌面打包（scripts/package-server.mjs）

把本机 node.exe（或从 npmmirror 下载）复制为 sidecar `src-tauri/binaries/wewrite-server-<triple>.exe`；把 `server/dist` + 生产依赖 node_modules + config.json 组装进 `src-tauri/resources/server-runtime/`。**better-sqlite3 是原生模块，sidecar 的 node ABI 必须与运行时一致**——默认复用本机 node，不要随意改 NODE_VERSION。产物在 `src-tauri/target/release/`。
