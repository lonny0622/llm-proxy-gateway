# 协议转换与流式翻译规范 (Protocol Translation Rules)

本项目核心逻辑是对各类大模型协议进行双向映射。智能体在调整或新增转换算法时，必须确保绝对不违反以下规则：

## 1. Anthropic ↔ OpenAI / OpenRouter 映射约束
由于 Anthropic API 在设计上与 OpenAI 有重大差别，在翻译请求时需遵循：

### 1.1 严格的角色交替 (Alternate Roles)
- Anthropic API 严格要求消息流必须以 `user` 角色开始，并以 `user` 和 `assistant` 角色严格交替。
- **必须进行消息合并与清洗** (`cleanMessagesForAnthropic`)：
  - 如果消息序列的开头是 `assistant`，必须在队头预插一条内容为 `"Hello"` 的 `user` 消息。
  - 连续出现的同类型角色消息（例如连续的两个 `user` 消息，或连续的 `tool` 返回消息），必须合并为一条消息。其 `content` 应转为由多个子内容块（例如 `text` 块和 `tool_result` 块）组成的数组。
  - 剔除内容为空白的内容块。

### 1.2 深度思考 (Reasoning Content)
- OpenAI/DeepSeek 的 `reasoning_content` 代表模型思考过程，在翻译为 Anthropic 协议时必须映射为 `thinking` 类型的内容块。
- 在流式响应翻译中，若收到 `reasoning_content` delta，需作为 `thinking_delta` 推送；若后续开始收到普通 `content` delta，必须显式向客户端发送当前思考块 stop 事件，并开辟新的 `text` 内容块。

### 1.3 工具调用与工具返回 (Tools & Tool Results)
- OpenAI 的 `tool_calls` 对应 Anthropic 的 `tool_use` 块。
- OpenAI 的 `tool` 角色消息（工具执行结果）在 Anthropic 中必须包装为包含 `tool_result` 内容块的 `user` 消息，并携带相匹配的 `tool_use_id`。

---

## 2. OpenAI Responses API ↔ Chat Completions 映射约束
用于支持新版 Codex 等客户端调用只支持 chat/completions 的后端。

### 2.1 请求解析
- `/v1/responses` 的 `input` 数组中，若包含类型为 `function_call_output` 的节点，必须把前面暂存未刷的 `function_call` 合并到同一条 `assistant` 消息的 `tool_calls` 中，并在其后追加 `role: 'tool'` 消息。
- 合并推理节点 (`reasoning`) 的 `summary` 输出到待发送的消息上下文中。

### 2.2 流式 SSE 生命周期事件管理
在流式响应翻译 (`handleChatCompletionsStreamToResponsesStream`) 中，必须严格管理 SSE 流的各种状态事件：
1. 建立连接后，首先发送 `response.created` 和 `response.in_progress` 事件。
2. 按照以下流式块 of 生命周期分发增量：
   - 思考阶段：添加并推送 `response.output_item.added` -> `response.reasoning_summary_part.added` -> 连续发送 `response.reasoning_summary_text.delta` -> 思考结束发送 `*.done`。
   - 文本回答阶段：添加并推送 `response.content_part.added` -> 连续发送 `response.output_text.delta` -> 文本结束发送 `*.done`。
   - 工具调用阶段：添加并推送 `response.output_item.added` -> 连续发送 `response.function_call_arguments.delta` -> 工具参数结束发送 `*.done`。
3. 当上游流传输完成且所有活跃内容块均终结后，计算完整的 prompt 和 completion token 消耗，组装 `response.completed` 事件推送给客户端，并安全关闭 Response 连接。
