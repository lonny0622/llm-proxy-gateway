import { TextDecoder } from 'util';
import { ServerResponse } from 'http';
import { ModelMap } from '../types.js';

// ============================================================================
// 类型声明 — Responses API
// ============================================================================

interface ResponsesRequest {
  model: string;
  input: any; // 可为 string 或 InputItem[]
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  tools?: ResponsesTool[];
  tool_choice?: any;
  parallel_tool_calls?: boolean;
  stream?: boolean;
  store?: boolean;
  previous_response_id?: string;
  include?: string[];
  reasoning?: Record<string, any>;
  text?: Record<string, any>;
  metadata?: Record<string, any>;
}

interface ResponsesTool {
  type: string;
  name?: string;
  description?: string;
  parameters?: Record<string, any>;
  strict?: boolean;
}

interface InputItem {
  type: string;
  role?: string;
  content?: any;
  summary?: any[];
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: any;
  input?: string;
  action?: any;
  id?: string;
  status?: string;
}

// ============================================================================
// 类型声明 — Chat Completions
// ============================================================================

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | any[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
    strict?: boolean;
  };
}

// ============================================================================
// 类型声明 — Responses API 输出
// ============================================================================

interface OutputItem {
  type: string;
  id?: string;
  status?: string;
  role?: string;
  content?: ContentPart[];
  call_id?: string;
  name?: string;
  arguments?: string;
  summary?: ReasoningSummary[];
}

interface ContentPart {
  type: string;
  text: string;
}

interface ReasoningSummary {
  type: string;
  text: string;
}

interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens: number };
  output_tokens_details?: { reasoning_tokens: number };
}

interface ResponsesResponse {
  id: string;
  object: 'response';
  created_at?: number;
  status: string;
  model: string;
  output: OutputItem[];
  output_text?: string;
  usage?: ResponsesUsage;
  error?: { message: string; type: string; code?: string } | null;
}

// ============================================================================
// 请求端转换：Responses API → Chat Completions
// ============================================================================

/**
 * 将 OpenAI Responses 请求体映射为标准的 Chat Completions 请求体
 */
export function convertResponsesRequestToChatCompletions(
  reqBody: ResponsesRequest,
  modelMap: ModelMap
): any {
  const targetModel = modelMap[reqBody.model] || reqBody.model;
  const messages: ChatMessage[] = [];

  // 1. 系统指令映射为第一个 system 消息
  if (reqBody.instructions) {
    messages.push({ role: 'system', content: reqBody.instructions });
  }

  // 2. 解析输入队列
  if (typeof reqBody.input === 'string') {
    // 简易文本字符串输入，直接生成单条用户消息
    if (reqBody.input.trim()) {
      messages.push({ role: 'user', content: reqBody.input });
    }
  } else if (Array.isArray(reqBody.input)) {
    // 输入为结构化节点数组，按序依次拼接
    const pendingFCBlocks: { id: string; name: string; arguments: string }[] = [];
    let pendingReasoningContent = '';

    for (const item of reqBody.input as InputItem[]) {
      // 处理工具返回结果
      if (item.type === 'function_call_output') {
        // 先冲刷之前的工具调用
        if (pendingFCBlocks.length > 0) {
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: null,
            tool_calls: pendingFCBlocks.map((fc) => ({
              id: fc.id,
              type: 'function' as const,
              function: { name: fc.name, arguments: fc.arguments }
            }))
          };
          if (pendingReasoningContent) {
            assistantMsg.reasoning_content = pendingReasoningContent;
            pendingReasoningContent = '';
          }
          messages.push(assistantMsg);
          pendingFCBlocks.length = 0;
        }
        // 独立生成一条 tool 消息
        const outputStr = typeof item.output === 'string'
          ? item.output
          : JSON.stringify(item.output ?? '');
        messages.push({
          role: 'tool',
          tool_call_id: item.call_id || '',
          content: outputStr
        });
        continue;
      }

      // 处理推理内容 (写入待处理缓冲区)
      if (item.type === 'reasoning') {
        const summaryArr = item.summary || [];
        const reasoningText = summaryArr
          .filter((s: any) => s.type === 'text')
          .map((s: any) => s.text || '')
          .join('');
        if (reasoningText) {
          pendingReasoningContent += reasoningText;
        }
        continue;
      }

      // 处理工具调用指令 (暂存待冲刷)
      if (item.type === 'function_call') {
        pendingFCBlocks.push({
          id: item.call_id || item.id || `call_${Math.random().toString(36).substring(2, 10)}`,
          name: item.name || '',
          arguments: item.arguments || '{}'
        });
        continue;
      }

      // 处理其他普通消息前，冲刷掉暂存的工具调用指令
      if (pendingFCBlocks.length > 0) {
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: null,
          tool_calls: pendingFCBlocks.map(fc => ({
            id: fc.id,
            type: 'function' as const,
            function: { name: fc.name, arguments: fc.arguments }
          }))
        };
        if (pendingReasoningContent) {
          assistantMsg.reasoning_content = pendingReasoningContent;
          pendingReasoningContent = '';
        }
        messages.push(assistantMsg);
        pendingFCBlocks.length = 0;
      }

      // 处理普通消息
      if (item.type === 'message') {
        const role = item.role || 'user';
        const content = extractContentText(item.content);

        if (role === 'system' || role === 'developer') {
          messages.push({ role: 'system', content });
        } else if (role === 'assistant') {
          const msg: ChatMessage = { role: 'assistant', content };
          if (pendingReasoningContent) {
            msg.reasoning_content = pendingReasoningContent;
            pendingReasoningContent = '';
          }
          messages.push(msg);
        } else {
          messages.push({ role: 'user', content });
        }
      }
    }

    // 冲刷残留的工具调用指令
    if (pendingFCBlocks.length > 0) {
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: null,
        tool_calls: pendingFCBlocks.map(fc => ({
          id: fc.id,
          type: 'function' as const,
          function: { name: fc.name, arguments: fc.arguments }
        }))
      };
      if (pendingReasoningContent) {
        assistantMsg.reasoning_content = pendingReasoningContent;
        pendingReasoningContent = '';
      }
      messages.push(assistantMsg);
    }

    // 冲刷残留的思考内容 (后面没有附带 assistant 消息)
    if (pendingReasoningContent) {
      messages.push({
        role: 'assistant',
        content: '',
        reasoning_content: pendingReasoningContent
      });
    }
  }

  // 3. 转换工具声明
  let chatTools: ChatTool[] | undefined = undefined;
  if (reqBody.tools && Array.isArray(reqBody.tools)) {
    chatTools = [];
    for (const tool of reqBody.tools) {
      if (tool.type === 'function' && tool.name) {
        chatTools.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            ...(tool.strict !== undefined ? { strict: tool.strict } : {})
          }
        });
      }
    }
    if (chatTools.length === 0) chatTools = undefined;
  }

  // 4. 转换 tool_choice
  let chatToolChoice: any = undefined;
  if (reqBody.tool_choice !== undefined && reqBody.tool_choice !== null) {
    if (typeof reqBody.tool_choice === 'string') {
      if (['auto', 'none', 'required'].includes(reqBody.tool_choice)) {
        chatToolChoice = reqBody.tool_choice;
      }
    } else if (typeof reqBody.tool_choice === 'object') {
      if (reqBody.tool_choice.type === 'function' && reqBody.tool_choice.name) {
        chatToolChoice = {
          type: 'function',
          function: { name: reqBody.tool_choice.name }
        };
      }
    }
  }

  // 5. 组合最终 Chat Completions 请求对象
  const chatReq: any = {
    model: targetModel,
    messages,
    stream: reqBody.stream || false,
  };

  if (reqBody.max_output_tokens) chatReq.max_completion_tokens = reqBody.max_output_tokens;
  if (reqBody.temperature !== undefined) chatReq.temperature = reqBody.temperature;
  if (reqBody.top_p !== undefined) chatReq.top_p = reqBody.top_p;
  if (reqBody.stop) chatReq.stop = reqBody.stop;
  if (chatTools) chatReq.tools = chatTools;
  if (chatToolChoice !== undefined) chatReq.tool_choice = chatToolChoice;
  if (reqBody.stream) chatReq.stream_options = { include_usage: true };

  return chatReq;
}

// ============================================================================
// 响应端转换：Chat Completions → Responses API (非流式响应转换)
// ============================================================================

/**
 * 将非流式 Chat Completions 响应映射为标准的 OpenAI Responses 响应
 */
export function convertChatCompletionsToResponsesResponse(
  chatResp: any,
  model: string
): ResponsesResponse {
  const choice = chatResp.choices?.[0];
  const message = choice?.message;
  const respId = `resp_${(chatResp.id || '').replace('chatcmpl-', '') || Math.random().toString(36).substring(2, 15)}`;

  const output: OutputItem[] = [];
  const textParts: string[] = [];

  // 1. 深度思考字段映射
  if (message?.reasoning_content) {
    output.push({
      type: 'reasoning',
      id: `rs_${Math.random().toString(36).substring(2, 10)}`,
      status: 'completed',
      summary: [{ type: 'text', text: message.reasoning_content }]
    });
  }

  // 2. 文本回答映射
  if (message?.content) {
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    textParts.push(text);
    output.push({
      type: 'message',
      id: `msg_${Math.random().toString(36).substring(2, 10)}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text }]
    });
  }

  // 3. 工具调用映射
  if (message?.tool_calls && Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      output.push({
        type: 'function_call',
        id: `fc_${Math.random().toString(36).substring(2, 10)}`,
        status: 'completed',
        call_id: tc.id || '',
        name: tc.function?.name || '',
        arguments: typeof tc.function?.arguments === 'string'
          ? tc.function.arguments
          : JSON.stringify(tc.function?.arguments || {})
      });
    }
  }

  // 决定最终响应状态
  let status = 'completed';
  if (choice?.finish_reason === 'length') {
    status = 'incomplete';
  }

  return {
    id: respId,
    object: 'response',
    created_at: chatResp.created || Math.floor(Date.now() / 1000),
    status,
    model,
    output,
    output_text: textParts.join(''),
    usage: {
      input_tokens: chatResp.usage?.prompt_tokens || 0,
      output_tokens: chatResp.usage?.completion_tokens || 0,
      total_tokens: chatResp.usage?.total_tokens || 0,
    }
  };
}

// ============================================================================
// 响应端流式翻译：Chat Completions Stream → Responses API Stream (SSE)
// ============================================================================

/**
 * 处理流式响应，将 OpenAI Chat Completions chunk 推送流式翻译为符合 Responses API 格式的事件流推送
 */
export async function handleChatCompletionsStreamToResponsesStream(
  response: Response,
  clientRes: ServerResponse,
  model: string,
  requestBody?: any,
  logCallback?: (text: string) => void
) {
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const respId = `resp_${Math.random().toString(36).substring(2, 15)}`;
  let seqNum = 0;
  const next = () => ++seqNum;

  // 初始状态结构体
  const responseObj: ResponsesResponse = {
    id: respId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'in_progress',
    model,
    output: [],
  };

  // 状态指针和临时缓冲区
  const contentText: Record<number, string> = {};
  const toolCallArgs: Record<number, string> = {};
  const toolCallNames: Record<number, string> = {};
  const toolCallIds: Record<number, string> = {};
  const outputIndexes: Record<number, number> = {};
  const itemIDs: Record<number, string> = {};
  const reasoningIndexes: Record<number, boolean> = {};

  let hasStartedReasoningBlock = false;
  let hasStartedTextBlock = false;
  let textBlockIndex = -1;
  let reasoningBlockIndex = -1;
  let fullResponseText = '';
  let accumulatedReasoningText = '';
  let streamUsage: { prompt_tokens?: number; completion_tokens?: number } = {};

  // SSE 发送工具函数
  const sendEvent = (event: string, data: any) => {
    clientRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 1. 发送 response.created
  sendEvent('response.created', {
    type: 'response.created',
    sequence_number: next(),
    response: { ...responseObj },
  });

  // 2. 发送 response.in_progress
  sendEvent('response.in_progress', {
    type: 'response.in_progress',
    sequence_number: next(),
    response: { ...responseObj },
  });

  // 处理单个 Chat Chunk 的 Choice
  const processChoice = (choice: any) => {
    const delta = choice?.delta;
    if (!delta) return;

    // --- 处理深度思考数据流 ---
    const reasoning = delta.reasoning_content || '';
    if (reasoning) {
      if (!hasStartedReasoningBlock) {
        const id = `rs_item_0`;
        itemIDs[-1] = id; // 使用 -1 键作为思考块的索引
        reasoningBlockIndex = responseObj.output.length;
        outputIndexes[-1] = reasoningBlockIndex;
        reasoningIndexes[-1] = true;

        responseObj.output.push({
          type: 'reasoning',
          id,
          status: 'in_progress',
          summary: []
        });

        sendEvent('response.output_item.added', {
          type: 'response.output_item.added',
          sequence_number: next(),
          output_index: reasoningBlockIndex,
          item: responseObj.output[reasoningBlockIndex],
        });

        sendEvent('response.reasoning_summary_part.added', {
          type: 'response.reasoning_summary_part.added',
          sequence_number: next(),
          item_id: id,
          output_index: reasoningBlockIndex,
          summary_index: 0,
        });

        hasStartedReasoningBlock = true;
      }

      accumulatedReasoningText += reasoning;
      sendEvent('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        sequence_number: next(),
        item_id: itemIDs[-1],
        output_index: reasoningBlockIndex,
        summary_index: 0,
        delta: reasoning,
      });
    }

    // --- 处理纯回答文本数据流 ---
    const text = delta.content || '';
    if (text) {
      if (!hasStartedTextBlock) {
        // 如果思考内容仍在传输，在回答开始前终结它
        if (hasStartedReasoningBlock) {
          finalizeReasoningBlock();
        }

        const id = `msg_item_0`;
        const outputIdx = responseObj.output.length;
        textBlockIndex = outputIdx;
        itemIDs[0] = id;
        outputIndexes[0] = outputIdx;

        const item: OutputItem = {
          type: 'message',
          id,
          status: 'in_progress',
          role: 'assistant',
          content: [{ type: 'output_text', text: '' }]
        };
        responseObj.output.push(item);

        sendEvent('response.output_item.added', {
          type: 'response.output_item.added',
          sequence_number: next(),
          output_index: outputIdx,
          item,
        });

        sendEvent('response.content_part.added', {
          type: 'response.content_part.added',
          sequence_number: next(),
          item_id: id,
          output_index: outputIdx,
          content_index: 0,
          part: { type: 'output_text', text: '' },
        });

        hasStartedTextBlock = true;
      }

      fullResponseText += text;
      sendEvent('response.output_text.delta', {
        type: 'response.output_text.delta',
        sequence_number: next(),
        item_id: itemIDs[0],
        output_index: textBlockIndex,
        content_index: 0,
        delta: text,
      });
    }

    // --- 处理工具调用数据流 ---
    const toolCalls = delta.tool_calls || [];
    for (const tc of toolCalls) {
      const tcIndex = tc.index ?? 0;
      const key = 100 + tcIndex; // 使用偏移避开与文本消息主索引 (0) 的键冲突

      if (tc.id || tc.function?.name) {
        if (!toolCallIds[key]) {
          // 在输出工具指令前，关闭可能活跃的文本或思考块
          if (hasStartedReasoningBlock && reasoningIndexes[-1]) {
            finalizeReasoningBlock();
          }
          if (hasStartedTextBlock) {
            finalizeTextBlock();
          }

          const callId = tc.id || `call_${Math.random().toString(36).substring(2, 10)}`;
          const name = tc.function?.name || '';
          toolCallIds[key] = callId;
          toolCallNames[key] = name;
          toolCallArgs[key] = '';

          const itemId = `fc_item_${tcIndex}`;
          itemIDs[key] = itemId;
          const outputIdx = responseObj.output.length;
          outputIndexes[key] = outputIdx;

          const item: OutputItem = {
            type: 'function_call',
            id: itemId,
            status: 'in_progress',
            call_id: callId,
            name,
            arguments: ''
          };
          responseObj.output.push(item);

          sendEvent('response.output_item.added', {
            type: 'response.output_item.added',
            sequence_number: next(),
            output_index: outputIdx,
            item,
          });
        }
      }

      const args = tc.function?.arguments || '';
      if (args && toolCallIds[key]) {
        toolCallArgs[key] = (toolCallArgs[key] || '') + args;
        sendEvent('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          sequence_number: next(),
          item_id: itemIDs[key],
          output_index: outputIndexes[key],
          delta: args,
        });
      }
    }

    // --- 处理流终结逻辑 ---
    if (choice.finish_reason) {
      if (hasStartedReasoningBlock && reasoningIndexes[-1]) {
        finalizeReasoningBlock();
      }
      if (hasStartedTextBlock) {
        finalizeTextBlock();
      }
      for (const key of Object.keys(toolCallIds).map(Number)) {
        finalizeToolCall(key);
      }
    }
  };

  // --- 内部内容块终结辅助函数 ---

  const finalizeReasoningBlock = () => {
    if (!reasoningIndexes[-1]) return;
    delete reasoningIndexes[-1];

    const id = itemIDs[-1];
    const outIdx = outputIndexes[-1];

    if (outIdx < responseObj.output.length) {
      responseObj.output[outIdx].status = 'completed';
      responseObj.output[outIdx].summary = [{ type: 'text', text: accumulatedReasoningText }];
    }

    sendEvent('response.reasoning_summary_part.done', {
      type: 'response.reasoning_summary_part.done',
      sequence_number: next(),
      item_id: id,
      output_index: outIdx,
      summary_index: 0,
    });

    sendEvent('response.output_item.done', {
      type: 'response.output_item.done',
      sequence_number: next(),
      output_index: outIdx,
      item: responseObj.output[outIdx],
    });
  };

  const finalizeTextBlock = () => {
    if (!hasStartedTextBlock) return;
    hasStartedTextBlock = false;

    const id = itemIDs[0];
    const outIdx = textBlockIndex;

    if (outIdx >= 0 && outIdx < responseObj.output.length && responseObj.output[outIdx].content) {
      responseObj.output[outIdx].content![0].text = fullResponseText;
      responseObj.output[outIdx].status = 'completed';
    }

    sendEvent('response.output_text.done', {
      type: 'response.output_text.done',
      sequence_number: next(),
      item_id: id,
      output_index: outIdx,
      content_index: 0,
      text: fullResponseText,
    });

    sendEvent('response.content_part.done', {
      type: 'response.content_part.done',
      sequence_number: next(),
      item_id: id,
      output_index: outIdx,
      content_index: 0,
      part: { type: 'output_text', text: fullResponseText },
    });

    sendEvent('response.output_item.done', {
      type: 'response.output_item.done',
      sequence_number: next(),
      output_index: outIdx,
      item: responseObj.output[outIdx],
    });
  };

  const finalizeToolCall = (key: number) => {
    if (!toolCallIds[key]) return;

    const id = itemIDs[key];
    const outIdx = outputIndexes[key];
    const finalArgs = toolCallArgs[key] || '{}';

    if (outIdx < responseObj.output.length) {
      responseObj.output[outIdx].arguments = finalArgs;
      responseObj.output[outIdx].status = 'completed';
    }

    sendEvent('response.function_call_arguments.done', {
      type: 'response.function_call_arguments.done',
      sequence_number: next(),
      item_id: id,
      output_index: outIdx,
      arguments: finalArgs,
    });

    sendEvent('response.output_item.done', {
      type: 'response.output_item.done',
      sequence_number: next(),
      output_index: outIdx,
      item: responseObj.output[outIdx],
    });

    delete toolCallIds[key];
  };

  // --- 从上游读取并处理 SSE chunk 字节流 ---
  const decoder = new TextDecoder();
  let buffer = '';

  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine.startsWith('data: ')) continue;

          const dataStr = cleanLine.substring(6).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            if (data.usage) {
              streamUsage = data.usage;
            }
            const choice = data.choices?.[0];
            if (choice) {
              processChoice(choice);
            }
          } catch {
            // 忽视残破分片块的解析错误
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // 扫尾缓冲残留
  if (buffer.trim().startsWith('data: ')) {
    const dataStr = buffer.trim().substring(6).trim();
    if (dataStr !== '[DONE]') {
      try {
        const data = JSON.parse(dataStr);
        if (data.usage) {
          streamUsage = data.usage;
        }
        const choice = data.choices?.[0];
        if (choice) processChoice(choice);
      } catch {}
    }
  }

  // 最终清算并保证所有的块完成状态输出
  if (hasStartedReasoningBlock && reasoningIndexes[-1]) {
    finalizeReasoningBlock();
  }
  if (hasStartedTextBlock) {
    finalizeTextBlock();
  }
  for (const key of Object.keys(toolCallIds).map(Number)) {
    finalizeToolCall(key);
  }

  // --- 发送 response.completed 事件并正常断开连接 ---
  responseObj.status = 'completed';
  responseObj.output_text = fullResponseText;
  responseObj.usage = {
    input_tokens: streamUsage.prompt_tokens || 0,
    output_tokens: streamUsage.completion_tokens || 0,
    total_tokens: (streamUsage.prompt_tokens || 0) + (streamUsage.completion_tokens || 0),
  };

  sendEvent('response.completed', {
    type: 'response.completed',
    sequence_number: next(),
    response: { ...responseObj },
  });

  clientRes.end();

  if (logCallback) {
    logCallback(fullResponseText);
  }
}

// ============================================================================
// 通用提取辅助函数
// ============================================================================

/**
 * 递归安全提取并扁平拼接内容文本
 */
function extractContentText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part.type === 'input_text' || part.type === 'text' || part.type === 'output_text')
      .map((part: any) => part.text || '')
      .join('');
  }
  return '';
}
