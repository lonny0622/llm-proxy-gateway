import { TextDecoder } from 'util';
import { ServerResponse } from 'http';
import { ModelMap, OpenRouterMessage, AnthropicMessage, AnthropicContentBlock } from '../types.js';

/**
 * 将 Anthropic 请求格式转换为 OpenRouter (OpenAI chat/completions) 格式
 * 
 * @param anthropicBody Anthropic 协议请求体
 * @param modelMap 模型映射字典
 */
export function convertAnthropicToOpenRouterRequest(anthropicBody: any, modelMap: ModelMap): any {
  const {
    model,
    messages,
    system,
    max_tokens,
    stream,
    temperature,
    top_p,
    stop_sequences,
    tools,
    tool_choice
  } = anthropicBody;

  const targetModel = modelMap[model] || model;

  // 转换系统提示词及普通消息到 OpenAI 格式
  const openRouterMessages: OpenRouterMessage[] = [];
  
  if (system) {
    if (typeof system === 'string') {
      openRouterMessages.push({ role: 'system', content: system });
    } else if (Array.isArray(system)) {
      const systemText = system.map((block: any) => block.text || '').join('\n');
      if (systemText) {
        openRouterMessages.push({ role: 'system', content: systemText });
      }
    }
  }

  for (const msg of messages || []) {
    const role = msg.role;
    let content = msg.content;

    if (Array.isArray(content)) {
      // 转换内容块到 OpenAI 格式
      content = content.map((block: any) => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        } else if (block.type === 'image') {
          return {
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`
            }
          };
        }
        return block;
      });
    }

    openRouterMessages.push({ role, content });
  }

  // 转换工具定义
  let openRouterTools: any[] | undefined = undefined;
  if (tools && Array.isArray(tools)) {
    openRouterTools = tools.map((t: any) => {
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }
      };
    });
  }

  // 转换 tool_choice
  let openRouterToolChoice: any = undefined;
  if (tool_choice) {
    if (tool_choice.type === 'auto') {
      openRouterToolChoice = 'auto';
    } else if (tool_choice.type === 'any') {
      openRouterToolChoice = 'required';
    } else if (tool_choice.type === 'tool' && tool_choice.name) {
      openRouterToolChoice = {
        type: 'function',
        function: { name: tool_choice.name }
      };
    }
  }

  return {
    model: targetModel,
    messages: openRouterMessages,
    max_tokens: max_tokens,
    temperature: temperature,
    top_p: top_p,
    stop: stop_sequences,
    stream: stream || false,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    tools: openRouterTools,
    tool_choice: openRouterToolChoice
  };
}

/**
 * 将 OpenRouter (OpenAI chat/completions) 请求格式转换为 Anthropic 格式
 * 
 * @param openRouterBody OpenRouter 协议请求体
 * @param modelMap 模型映射字典
 */
export function convertOpenRouterToAnthropicRequest(openRouterBody: any, modelMap: ModelMap): any {
  const {
    model,
    messages,
    max_tokens,
    stream,
    temperature,
    top_p,
    stop,
    tools,
    tool_choice
  } = openRouterBody;

  const targetModel = modelMap[model] || model;

  // 清洗并交替消息流，同时转换 system 角色
  const { system, messages: cleanedMessages } = cleanMessagesForAnthropic(messages || []);

  // 转换工具声明
  let anthropicTools: any[] | undefined = undefined;
  if (tools && Array.isArray(tools)) {
    anthropicTools = tools.map((t: any) => {
      if (t.type === 'function' && t.function) {
        return {
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters
        };
      }
      return t;
    });
  }

  // 转换 tool_choice
  let anthropicToolChoice: any = undefined;
  if (tool_choice) {
    if (tool_choice === 'auto') {
      anthropicToolChoice = { type: 'auto' };
    } else if (tool_choice === 'required') {
      anthropicToolChoice = { type: 'any' };
    } else if (typeof tool_choice === 'object') {
      const toolName = tool_choice.function?.name || tool_choice.tool?.name;
      if (toolName) {
        anthropicToolChoice = { type: 'tool', name: toolName };
      }
    }
  }

  return {
    model: targetModel,
    messages: cleanedMessages,
    system: system,
    max_tokens: max_tokens || 4096,
    stream: stream || false,
    temperature: temperature,
    top_p: top_p,
    stop_sequences: typeof stop === 'string' ? [stop] : (Array.isArray(stop) ? stop : undefined),
    tools: anthropicTools,
    tool_choice: anthropicToolChoice
  };
}

/**
 * 依据 Anthropic API 的约束规则清洗并规范化消息队列
 * 核心逻辑：
 * 1. 拆分 system 角色消息到独立变量中，供最外层 system 属性使用。
 * 2. 保证首个消息的 role 是 user（若非则插入预设用户消息）。
 * 3. 严格保证 user -> assistant -> user 的严格交替排列。合并连续出现的同类型角色或 tool 响应消息。
 * 4. 合并 OpenAI 的 reasoning_content 思考字段为 Anthropic 的 thinking 内容块。
 */
export function cleanMessagesForAnthropic(messages: OpenRouterMessage[]): { system?: string; messages: AnthropicMessage[] } {
  const systemMessages: string[] = [];
  const conversationMessages: OpenRouterMessage[] = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map((b: any) => b.text || '').join('\n') : '');
      if (text) systemMessages.push(text);
    } else {
      conversationMessages.push(msg);
    }
  }
  
  const systemPrompt = systemMessages.join('\n\n');
  const merged: AnthropicMessage[] = [];
  
  for (const msg of conversationMessages) {
    const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
    let content: any = msg.content;
    
    // 映射 OpenAI 工具消息到 Anthropic tool_result
    if (msg.role === 'tool') {
      content = [
        {
          type: 'tool_result',
          tool_use_id: (msg as any).tool_call_id,
          content: msg.content
        }
      ];
    }
    
    // 映射内容块数组
    if (Array.isArray(content)) {
      content = content.map((block: any) => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        } else if (block.type === 'image_url') {
          const url = block.image_url?.url;
          if (url && url.startsWith('data:')) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: match[1],
                  data: match[2]
                }
              };
            }
          }
          return { type: 'text', text: `[Image URL: ${url}]` };
        }
        return block;
      });
    }

    // 映射 OpenAI tool_calls 到 Anthropic tool_use 内容块
    const toolCalls = (msg as any).tool_calls;
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      const blocks: any[] = [];
      if (typeof content === 'string' && content.trim()) {
        blocks.push({ type: 'text', text: content });
      } else if (Array.isArray(content)) {
        blocks.push(...content);
      }
      
      for (const tc of toolCalls) {
        let parsedInput = {};
        try {
          parsedInput = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {});
        } catch {}
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || '',
          input: parsedInput
        });
      }
      content = blocks;
    }

    // 映射 OpenAI reasoning_content 到 Anthropic thinking 内容块
    const reasoning = (msg as any).reasoning_content;
    if (reasoning) {
      const blocks: any[] = [
        { type: 'thinking', thinking: reasoning }
      ];
      if (typeof content === 'string' && content.trim()) {
        blocks.push({ type: 'text', text: content });
      } else if (Array.isArray(content)) {
        blocks.push(...content);
      }
      content = blocks;
    }

    // 处理同角色消息的追加与合并，满足严格交替要求
    if (merged.length > 0 && merged[merged.length - 1].role === role) {
      const prev = merged[merged.length - 1];
      if (typeof prev.content === 'string' && typeof content === 'string') {
        prev.content += '\n\n' + content;
      } else {
        const prevBlocks = typeof prev.content === 'string'
          ? (prev.content ? [{ type: 'text', text: prev.content } as AnthropicContentBlock] : [])
          : (Array.isArray(prev.content) ? prev.content : []);
        const currBlocks = typeof content === 'string'
          ? (content ? [{ type: 'text', text: content } as AnthropicContentBlock] : [])
          : (Array.isArray(content) ? content : []);
        prev.content = [...prevBlocks, ...currBlocks];
      }
    } else {
      merged.push({ role, content });
    }
  }

  // 必须以 user 角色作为开头
  if (merged.length > 0 && merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: 'Hello' });
  }

  // 剔除内容为空白的消息块
  const finalMessages = merged.filter(msg => {
    if (typeof msg.content === 'string') return msg.content.trim().length > 0;
    if (Array.isArray(msg.content)) return msg.content.length > 0;
    return false;
  });

  return {
    system: systemPrompt || undefined,
    messages: finalMessages
  };
}

/**
 * 将 OpenRouter (OpenAI) 响应转换到 Anthropic 响应
 */
export function convertOpenRouterToAnthropicResponse(openRouterJson: any, model: string): any {
  if (openRouterJson && (openRouterJson.content || openRouterJson.type === 'message')) {
    return {
      ...openRouterJson,
      model: model
    };
  }

  const choice = openRouterJson.choices?.[0];
  const message = choice?.message;
  const contentText = message?.content || '';
  const reasoningContent = message?.reasoning_content || '';
  const toolCalls = message?.tool_calls || [];

  const contentBlocks: any[] = [];

  // 优先存入思考思考内容
  if (reasoningContent) {
    contentBlocks.push({
      type: 'thinking',
      thinking: reasoningContent
    });
  }

  if (contentText) {
    contentBlocks.push({
      type: 'text',
      text: contentText
    });
  }

  if (toolCalls.length > 0) {
    for (const tc of toolCalls) {
      let parsedInput = {};
      try {
        parsedInput = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {});
      } catch {}
      contentBlocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function?.name || '',
        input: parsedInput
      });
    }
  }

  let stopReason = 'end_turn';
  if (choice?.finish_reason === 'length') {
    stopReason = 'max_tokens';
  } else if (choice?.finish_reason === 'stop_sequence') {
    stopReason = 'stop_sequence';
  } else if (choice?.finish_reason === 'tool_calls') {
    stopReason = 'tool_use';
  }

  return {
    id: `msg_${openRouterJson.id?.replace('chatcmpl-', '') || Math.random().toString(36).substring(2, 15)}`,
    type: 'message',
    role: 'assistant',
    model: model,
    content: contentBlocks,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openRouterJson.usage?.prompt_tokens || 0,
      output_tokens: openRouterJson.usage?.completion_tokens || 0
    }
  };
}

/**
 * 将 Anthropic 响应转换到 OpenRouter (OpenAI) 响应
 */
export function convertAnthropicToOpenRouterResponse(anthropicJson: any, model: string): any {
  if (anthropicJson && (anthropicJson.choices || anthropicJson.object === 'chat.completion')) {
    return {
      ...anthropicJson,
      model: model
    };
  }

  let contentText = '';
  let reasoningContent = '';
  const toolCalls: any[] = [];

  const contentBlocks = anthropicJson.content || [];
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i];
    if (block.type === 'text') {
      contentText += block.text || '';
    } else if (block.type === 'thinking') {
      reasoningContent += block.thinking || '';
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: typeof block.input === 'object' ? JSON.stringify(block.input) : (block.input || '{}')
        }
      });
    }
  }

  let finishReason = 'stop';
  if (anthropicJson.stop_reason === 'max_tokens') {
    finishReason = 'length';
  } else if (anthropicJson.stop_reason === 'stop_sequence') {
    finishReason = 'stop_sequence';
  } else if (anthropicJson.stop_reason === 'tool_use') {
    finishReason = 'tool_calls';
  }

  const messageObj: any = {
    role: 'assistant',
    content: contentText || null
  };

  if (reasoningContent) {
    messageObj.reasoning_content = reasoningContent;
  }

  if (toolCalls.length > 0) {
    messageObj.tool_calls = toolCalls;
  }

  return {
    id: `chatcmpl-${anthropicJson.id?.replace('msg_', '') || Math.random().toString(36).substring(2, 15)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [
      {
        index: 0,
        message: messageObj,
        finish_reason: finishReason
      }
    ],
    usage: {
      prompt_tokens: anthropicJson.usage?.input_tokens || 0,
      completion_tokens: anthropicJson.usage?.output_tokens || 0,
      total_tokens: (anthropicJson.usage?.input_tokens || 0) + (anthropicJson.usage?.output_tokens || 0)
    }
  };
}

/**
 * 辅助函数：输出 SSE 行
 */
function sendSSEEvent(res: ServerResponse, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * 将上游 OpenAI 格式流式事件响应，转换翻译为 Anthropic 协议客户端 SSE 流
 */
export async function handleOpenRouterToAnthropicStream(
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
    'Transfer-Encoding': 'chunked'
  });

  const msgId = `msg_${Math.random().toString(36).substring(2, 15)}`;
  
  // 估算输入 Token (用于回退保护)
  const estimatedInputTokens = requestBody ? Math.ceil(JSON.stringify(requestBody).length / 4) : 0;

  // 发送初始 Anthropic 消息头
  sendSSEEvent(clientRes, 'message_start', {
    type: 'message_start',
    message: {
      id: msgId,
      type: 'message',
      role: 'assistant',
      model: model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: estimatedInputTokens, output_tokens: 0 }
    }
  });

  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponseText = '';

  let hasStartedThinking = false;
  let hasStartedText = false;
  let textIndex = -1;
  const activeToolCalls = new Map<number, { id: string; name: string; index: number; started: boolean }>();
  let blockCount = 0;
  let streamUsage: { prompt_tokens?: number; completion_tokens?: number } = {};

  const processOpenAIChoice = (choice: any) => {
    const delta = choice?.delta;
    if (!delta) return;

    // 1. 处理思考内容
    const reasoning = delta.reasoning_content || '';
    if (reasoning) {
      if (!hasStartedThinking) {
        sendSSEEvent(clientRes, 'content_block_start', {
          type: 'content_block_start',
          index: blockCount,
          content_block: { type: 'thinking', thinking: '' }
        });
        hasStartedThinking = true;
        blockCount++;
      }
      sendSSEEvent(clientRes, 'content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: reasoning }
      });
    }

    // 2. 处理纯文本内容
    const text = delta.content || '';
    if (text) {
      if (!hasStartedText) {
        // 如果思考内容块仍处于开启状态，需要关闭它
        if (hasStartedThinking) {
          sendSSEEvent(clientRes, 'content_block_stop', {
            type: 'content_block_stop',
            index: 0
          });
        }
        sendSSEEvent(clientRes, 'content_block_start', {
          type: 'content_block_start',
          index: blockCount,
          content_block: { type: 'text', text: '' }
        });
        textIndex = blockCount;
        hasStartedText = true;
        blockCount++;
      }
      fullResponseText += text;
      sendSSEEvent(clientRes, 'content_block_delta', {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text: text }
      });
    }

    // 3. 处理工具调用
    const toolCalls = delta.tool_calls || [];
    for (const tc of toolCalls) {
      const tcIndex = tc.index ?? 0;
      let activeTc = activeToolCalls.get(tcIndex);
      
      if (!activeTc) {
        activeTc = {
          id: tc.id || `toolu_${Math.random().toString(36).substring(2, 15)}`,
          name: tc.function?.name || '',
          index: blockCount,
          started: false
        };
        activeToolCalls.set(tcIndex, activeTc);
        blockCount++;
      }

      if (!activeTc.started && tc.function?.name) {
        sendSSEEvent(clientRes, 'content_block_start', {
          type: 'content_block_start',
          index: activeTc.index,
          content_block: {
            type: 'tool_use',
            id: activeTc.id,
            name: activeTc.name || tc.function.name,
            input: {}
          }
        });
        activeTc.started = true;
      }

      const args = tc.function?.arguments || '';
      if (args && activeTc.started) {
        sendSSEEvent(clientRes, 'content_block_delta', {
          type: 'content_block_delta',
          index: activeTc.index,
          delta: {
            type: 'input_json_delta',
            partial_json: args
          }
        });
      }
    }
  };

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
              processOpenAIChoice(choice);
            }
          } catch {
            // 忽略碎片块的 JSON 解析错误
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // 消化最后缓冲区残留
  if (buffer.startsWith('data: ')) {
    const dataStr = buffer.substring(6).trim();
    if (dataStr !== '[DONE]') {
      try {
        const data = JSON.parse(dataStr);
        if (data.usage) {
          streamUsage = data.usage;
        }
        const choice = data.choices?.[0];
        if (choice) {
          processOpenAIChoice(choice);
        }
      } catch {}
    }
  }

  // 优雅地关闭任何残留的内容块
  if (hasStartedThinking) {
    sendSSEEvent(clientRes, 'content_block_stop', {
      type: 'content_block_stop',
      index: 0
    });
  }

  if (hasStartedText) {
    sendSSEEvent(clientRes, 'content_block_stop', {
      type: 'content_block_stop',
      index: textIndex
    });
  }

  for (const [_, activeTc] of activeToolCalls.entries()) {
    if (activeTc.started) {
      sendSSEEvent(clientRes, 'content_block_stop', {
        type: 'content_block_stop',
        index: activeTc.index
      });
    }
  }

  // 决定终结状态原因
  let stopReason = 'end_turn';
  if (activeToolCalls.size > 0) {
    stopReason = 'tool_use';
  }

  // 整合得出最终 token 计数统计
  const finalOutputTokens = streamUsage.completion_tokens || Math.ceil(fullResponseText.length / 4);
  const finalInputTokens = streamUsage.prompt_tokens || estimatedInputTokens;

  sendSSEEvent(clientRes, 'message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null
    },
    usage: {
      input_tokens: finalInputTokens,
      output_tokens: finalOutputTokens
    }
  });

  sendSSEEvent(clientRes, 'message_stop', {
    type: 'message_stop'
  });

  clientRes.end();

  if (logCallback) {
    logCallback(fullResponseText);
  }
}

/**
 * 将上游 Anthropic 格式流式事件响应，转换翻译为 OpenAI / OpenRouter 协议客户端 SSE 流
 */
export async function handleAnthropicToOpenRouterStream(
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
    'Transfer-Encoding': 'chunked'
  });

  const openRouterId = `chatcmpl-${Math.random().toString(36).substring(2, 15)}`;
  const created = Math.floor(Date.now() / 1000);

  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponseText = '';
  let currentEvent = '';
  let streamInputTokens = 0;
  let streamOutputTokens = 0;

  // 估算输入 Token 备用
  const estimatedInputTokens = requestBody ? Math.ceil(JSON.stringify(requestBody).length / 4) : 0;

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
          if (!cleanLine) continue;

          if (cleanLine.startsWith('event: ')) {
            currentEvent = cleanLine.substring(7).trim();
          } else if (cleanLine.startsWith('data: ')) {
            const dataStr = cleanLine.substring(5).trim();
            try {
              const data = JSON.parse(dataStr);
              
              if (currentEvent === 'message_start') {
                if (data.message?.usage?.input_tokens) {
                  streamInputTokens = data.message.usage.input_tokens;
                }
                // 初始化推送 OpenAI 消息头
                clientRes.write(`data: ${JSON.stringify({
                  id: openRouterId,
                  object: 'chat.completion.chunk',
                  created: created,
                  model: model,
                  choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
                })}\n\n`);
              } else if (currentEvent === 'content_block_start') {
                const block = data.content_block;
                if (block?.type === 'tool_use') {
                  clientRes.write(`data: ${JSON.stringify({
                    id: openRouterId,
                    object: 'chat.completion.chunk',
                    created: created,
                    model: model,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          index: data.index,
                          id: block.id,
                          type: 'function',
                          function: {
                            name: block.name,
                            arguments: ''
                          }
                        }]
                      },
                      finish_reason: null
                    }]
                  })}\n\n`);
                }
              } else if (currentEvent === 'content_block_delta') {
                if (data.delta?.type === 'input_json_delta') {
                  const partialJson = data.delta.partial_json || '';
                  clientRes.write(`data: ${JSON.stringify({
                    id: openRouterId,
                    object: 'chat.completion.chunk',
                    created: created,
                    model: model,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          index: data.index,
                          function: {
                            arguments: partialJson
                          }
                        }]
                      },
                      finish_reason: null
                    }]
                  })}\n\n`);
                } else if (data.delta?.type === 'thinking_delta') {
                  const thinking = data.delta.thinking || '';
                  clientRes.write(`data: ${JSON.stringify({
                    id: openRouterId,
                    object: 'chat.completion.chunk',
                    created: created,
                    model: model,
                    choices: [{
                      index: 0,
                      delta: {
                        reasoning_content: thinking
                      },
                      finish_reason: null
                    }]
                  })}\n\n`);
                } else {
                  const text = data.delta?.text || '';
                  if (text) {
                    fullResponseText += text;
                    clientRes.write(`data: ${JSON.stringify({
                      id: openRouterId,
                      object: 'chat.completion.chunk',
                      created: created,
                      model: model,
                      choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
                    })}\n\n`);
                  }
                }
              } else if (currentEvent === 'message_delta') {
                if (data.usage?.output_tokens) {
                  streamOutputTokens = data.usage.output_tokens;
                }
                let finishReason = 'stop';
                if (data.delta?.stop_reason === 'max_tokens') {
                  finishReason = 'length';
                } else if (data.delta?.stop_reason === 'tool_use') {
                  finishReason = 'tool_calls';
                }
                const finalInputTokens = streamInputTokens || estimatedInputTokens;
                const finalOutputTokens = streamOutputTokens || Math.ceil(fullResponseText.length / 4);

                clientRes.write(`data: ${JSON.stringify({
                  id: openRouterId,
                  object: 'chat.completion.chunk',
                  created: created,
                  model: model,
                  choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
                  usage: {
                    prompt_tokens: finalInputTokens,
                    completion_tokens: finalOutputTokens,
                    total_tokens: finalInputTokens + finalOutputTokens
                  }
                })}\n\n`);
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // 关闭客户端流
  clientRes.write('data: [DONE]\n\n');
  clientRes.end();

  if (logCallback) {
    logCallback(fullResponseText);
  }
}
