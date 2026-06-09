# 架构与开发规范 (Architecture & Development Rules)

本规则适用于 LLM Proxy Gateway 项目的文件架构、编码风格以及模块间调用依赖。

## 1. 语言与模块规范
- **运行环境**：使用 Node.js 18+ 原生 ESM 模块化方式 (`"type": "module"`)。
- **导入扩展名**：所有本地文件（如 `.ts` 文件）在进行 `import` 导入时，必须显式书写 `.js` 后缀，禁止省略。
  - 正确：`import { config } from './config.js';`
  - 错误：`import { config } from './config';`
- **代码注释**：所有新增、重构的代码注释，必须且只能使用**中文**。
- **类型声明**：使用 TypeScript 5.x。尽量避免使用 `any`，应使用并扩展 `src/types.ts` 中的共享接口声明。

## 2. 目录结构职责
为了保持高内聚低耦合，项目后端采用以下分层结构：

- **类型定义层 (`src/types.ts`)**：
  - 存放所有的共享接口声明（例如 `ProxyConfig`、`LogItem`、`AnthropicMessage` 等）。禁止在具体业务文件中声明临时且冗余的对外通用数据结构。
- **配置管理层 (`src/config.ts`)**：
  - 封装全局配置对象 `config` 及对磁盘 `config.json` 的读写方法。其他模块不得直接调用 `fs.writeFileSync('config.json')`。
- **日志分发层 (`src/logger.ts`)**：
  - 封装全局内存日志数组，限制最大 200 条并提供事件监听机制，用来广播给管理控制台的 SSE 连接。
- **协议转换层 (`src/protocol/`)**：
  - 此目录下只允许编写**无状态、纯逻辑**的格式翻译函数，禁止引入任何 HTTP 服务器实例或直接操作磁盘。以便于运行无网络环境依赖的单元测试。
  - `anthropic-openrouter.ts` 负责 Anthropic ↔ OpenAI 格式转换。
  - `responses-chat.ts` 负责 OpenAI Responses ↔ Chat Completions 格式转换。
- **代理运行层 (`src/proxy-server.ts`)**：
  - 负责动态端口 HTTP 代理服务器的创建、关闭与请求监听转发。通过调用协议转换层完成 Payload 格式映射，并将请求和响应提交给 `logger.ts`。
- **管理面板层 (`src/dashboard-server.ts`)**：
  - 托管 React 前端静态资源，提供 REST APIs (增删改查代理配置)，以及实时日志 SSE 流与 Playground 沙箱联调端点。
- **系统入口 (`src/gateway.ts`)**：
  - 系统启动引导，负责载入配置、启动管理面板，并拉起配置中处于 `active` 状态的代理服务。
