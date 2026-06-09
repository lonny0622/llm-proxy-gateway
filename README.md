# LLM Proxy Gateway (多端 LLM 协议转换网关)

LLM Proxy Gateway 是一个轻量级、零负担的本地大语言模型协议映射转换网关。它允许您在本地多端口上动态拉起代理服务，以对各主流大模型 API 接口（如 OpenAI Chat Completions、Anthropic Messages 以及新版 OpenAI Responses API）进行双向转换，同时提供了一个优雅的管理后台来进行可视化配置与实时日志追踪。

---

## 🌟 核心特性

- **多协议互转支撑**：
  - **Anthropic ➔ OpenRouter (OpenAI)**：将 Anthropic Messages 请求转换为 OpenAI 兼容格式。
  - **OpenRouter (OpenAI) ➔ Anthropic**：将 OpenAI/OpenRouter 请求转换为 Anthropic 格式，支持多轮工具调用（Tool Calls）、深度思考内容（Reasoning Content）的智能清洗与严格角色交替。
  - **Responses API ➔ Chat Completions**：支持新版 OpenAI Responses 规范，将输入节点队列（messages, reasoning, function_calls）映射到普通的 chat/completions 模型上（如 DeepSeek 4 Pro），并完整模拟流式与非流式事件输出，使项目无缝适配新版 Codex。
- **可视化管理控制台**：
  - **动态启停**：实时创建、修改、删除及一键启停各个代理实例，支持独立端口配置与自定义目标 Base URL。
  - **实时日志流 (SSE)**：基于 Server-Sent Events 的秒级交易日志更新，展示 Payload 详情与上游返回结果，方便联调。
  - **Playground 沙箱**：提供翻译验证沙箱，无需真实流量即可测试不同协议方向的模型转换效果。
- **现代架构设计**：
  - 基于 Node.js ESM 与 TypeScript 5 编写，模块间高内聚低耦合。
  - 核心算法层与 I/O 隔离，支持完备的无网络单元测试。

---

## 📁 目录文件结构

```bash
├── AGENTS.md                  # 智能体协同开发总纲
├── .ai/                       # AI 开发约束规则目录
│   └── rules/
│       ├── architecture.md    # 目录层级职责与模块调用规范
│       └── translation.md     # 协议交互、角色合并、流式事件转换硬性约束
├── bin/
│   └── cli.mjs                # 命令行 CLI 快捷启动入口
├── frontend/                  # 管理后台前端源码 (React + Vite)
│   ├── src/
│   └── dist/                  # 前端静态编译产物（由网关进行托管服务）
├── src/                       # 网关后端源码 (TypeScript)
│   ├── protocol/              # 协议翻译转换核心逻辑（纯函数，无状态）
│   │   ├── anthropic-openrouter.ts
│   │   └── responses-chat.ts
│   ├── config.ts              # config.json 读写配置文件管理器
│   ├── logger.ts              # 内存日志缓冲区及客户端 SSE 订阅分发器
│   ├── proxy-server.ts        # 端口代理服务器实例管理
│   ├── dashboard-server.ts    # 控制台后台 HTTP 服务器 (API 及静态文件)
│   ├── types.ts               # 共享 TypeScript 类型声明
│   └── gateway.ts             # 极简程序引导入口
├── eslint.config.js           # ESLint Flat 语法校验配置文件
├── test-ts.ts                 # 协议映射单元测试套件
└── package.json               # 项目配置文件及开发依赖
```

---

## 🚀 快速开始

### 1. 安装依赖

请确保您本地已安装了 Node.js 18+ 环境，并在项目根目录下安装依赖：

```bash
pnpm install
```

### 2. 运行网关

#### 本地启动：
```bash
pnpm start
```
或者在开发模式下运行（支持后端热重载）：
```bash
pnpm dev:backend
```

#### 全局命令行启动：
本网关支持在控制台使用一行命令全局启动，您可以在项目根目录中将其链接到全局：
```bash
pnpm link --global
# 之后您可以在任何路径直接运行以下命令拉起网关：
llm-proxy
```

启动成功后，您将在控制台看到：
```bash
正在初始化 LLM 多端代理网关...
系统初始化完成。按 Ctrl+C 可安全停止服务。
===================================================
[Management Dashboard] 管理后台运行在: http://localhost:9000
===================================================
```
打开浏览器访问 `http://localhost:9000` 即可进入管理后台。

---

## 🛠️ 项目开发脚本

- **`pnpm test`**：运行网关协议转换单元测试（验证角色交替、合并、工具调用等翻译逻辑）。
- **`pnpm lint`**：运行 ESLint 静态代码风格与安全校验。
- **`pnpm dev:frontend`**：在本地拉起控制台前端开发服务器（Vite 热更新调试）。
- **`pnpm build:frontend`**：编译 React 前端静态资源输出到 `frontend/dist/`，编译产物将自动被网关后端托管。

---

## 🔒 隐私与配置安全

- 所有新增的代理配置均保存在本地项目根目录下的 `config.json` 中，包含您的 API Key 与目标接口地址。
- 该 `config.json` 已默认加入 `.gitignore` 中，**请勿将其提交到公共代码仓库**。
