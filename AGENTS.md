# LLM Proxy Gateway AI 智能体协同指南

本文件旨在为参与本项目开发与维护的所有 AI 智能体（Agents）及辅助助手提供项目全局上下文、系统架构和开发规范指导。

## 1. 项目定位与背景
LLM Proxy Gateway 是一个基于 Node.js/TypeScript 构建的多协议大语言模型转换网关。它支持动态代理管理、管理控制面板以及以下核心翻译方向：
- **Anthropic ➔ OpenRouter (OpenAI chat/completions 兼容)**
- **OpenRouter (OpenAI chat/completions 兼容) ➔ Anthropic**
- **Responses (OpenAI Responses API) ➔ Chat Completions**

## 2. 智能体约束规则系统
为了确保系统的健壮性及协议转换的准确度，所有智能体在修改代码时，必须遵守 `.ai/rules/` 目录下的细化规则文件：

- **[架构与开发规范](file:///.ai/rules/architecture.md)**：包含 TypeScript 规范、ESM 模块规范、导入扩展名约束以及文件模块的分层职责。
- **[协议转换与流式翻译规范](file:///.ai/rules/translation.md)**：包含消息队列清洗机制（合并同类型角色消息）、严格的角色交替规则、深度思考内容（reasoning_content / thinking）的处理及 SSE 流式事件的生命周期管理。

## 3. 开发流程建议
1. 每次修改协议转换逻辑后，均需运行单元测试：`npm run test`。
2. 每次涉及前端组件修改后，必须运行前端打包命令：`npm run build:frontend`，确保类型声明与前端兼容。
3. 所有文件中的新增代码注释必须使用**中文**。
