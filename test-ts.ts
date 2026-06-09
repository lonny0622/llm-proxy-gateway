import assert from 'assert';
import {
  convertAnthropicToOpenRouterRequest,
  convertOpenRouterToAnthropicRequest,
  convertOpenRouterToAnthropicResponse,
  convertAnthropicToOpenRouterResponse
} from './src/protocol/anthropic-openrouter.js';
import {
  convertResponsesRequestToChatCompletions,
  convertChatCompletionsToResponsesResponse
} from './src/protocol/responses-chat.js';
import { ModelMap } from './src/types.js';

console.log('开始运行 TypeScript 网关协议转换单元测试...');

try {
  // Test 1: Anthropic to OpenRouter Request
  console.log('测试 1: Anthropic -> OpenRouter 请求格式转换...');
  const anthropicReq = {
    model: 'claude-3-5-sonnet-20241022',
    messages: [
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'What is 1+1?' }
    ],
    system: 'You are a helpful math tutor.',
    max_tokens: 1024,
    stream: true,
    temperature: 0.5
  };
  const modelMap: ModelMap = {
    'claude-3-5-sonnet-20241022': 'anthropic/claude-3.5-sonnet'
  };

  const openRouterReq = convertAnthropicToOpenRouterRequest(anthropicReq, modelMap);
  
  assert.strictEqual(openRouterReq.model, 'anthropic/claude-3.5-sonnet');
  assert.strictEqual(openRouterReq.stream, true);
  assert.strictEqual(openRouterReq.max_tokens, 1024);
  assert.strictEqual(openRouterReq.temperature, 0.5);
  assert.strictEqual(openRouterReq.messages.length, 4);
  assert.deepStrictEqual(openRouterReq.messages[0], { role: 'system', content: 'You are a helpful math tutor.' });
  assert.deepStrictEqual(openRouterReq.messages[1], { role: 'user', content: 'Hello!' });
  console.log('✓ 测试 1 通过');

  // Test 2: OpenRouter to Anthropic Request (Cleans message list)
  console.log('测试 2: OpenRouter -> Anthropic 请求转换及消息序列清洗...');
  const openRouterReqInput = {
    model: 'anthropic/claude-3.5-sonnet',
    messages: [
      { role: 'system', content: 'System prompt part 1' },
      { role: 'system', content: 'System prompt part 2' },
      { role: 'assistant', content: 'Prefilled assistant hello' }, // Starts with assistant
      { role: 'user', content: 'User query 1' },
      { role: 'user', content: 'User query 2 (consecutive user)' } // Consecutive user
    ],
    max_tokens: 2048,
    stream: false
  };

  const anthropicConverted = convertOpenRouterToAnthropicRequest(openRouterReqInput, {
    'anthropic/claude-3.5-sonnet': 'claude-3-5-sonnet-20241022'
  });

  assert.strictEqual(anthropicConverted.model, 'claude-3-5-sonnet-20241022');
  assert.strictEqual(anthropicConverted.max_tokens, 2048);
  assert.strictEqual(anthropicConverted.stream, false);
  assert.strictEqual(anthropicConverted.system, 'System prompt part 1\n\nSystem prompt part 2');
  
  // Checking list structure
  assert.strictEqual(anthropicConverted.messages.length, 3);
  assert.strictEqual(anthropicConverted.messages[0].role, 'user');
  assert.strictEqual(anthropicConverted.messages[0].content, 'Hello'); // Prepend default
  assert.strictEqual(anthropicConverted.messages[1].role, 'assistant');
  assert.strictEqual(anthropicConverted.messages[1].content, 'Prefilled assistant hello');
  assert.strictEqual(anthropicConverted.messages[2].role, 'user');
  assert.strictEqual(anthropicConverted.messages[2].content, 'User query 1\n\nUser query 2 (consecutive user)');
  console.log('✓ 测试 2 通过');

  // Test 3: OpenAI to Anthropic Response
  console.log('测试 3: OpenRouter (OpenAI) -> Anthropic 响应转换...');
  const openRouterRes = {
    id: 'chatcmpl-12345',
    choices: [
      {
        message: { role: 'assistant', content: 'Test response content' },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 15, completion_tokens: 25 }
  };
  
  const anthropicRes = convertOpenRouterToAnthropicResponse(openRouterRes, 'claude-3-5-sonnet-20241022');
  
  assert.strictEqual(anthropicRes.id, 'msg_12345');
  assert.strictEqual(anthropicRes.type, 'message');
  assert.strictEqual(anthropicRes.role, 'assistant');
  assert.strictEqual(anthropicRes.model, 'claude-3-5-sonnet-20241022');
  assert.deepStrictEqual(anthropicRes.content, [{ type: 'text', text: 'Test response content' }]);
  assert.strictEqual(anthropicRes.stop_reason, 'end_turn');
  assert.strictEqual(anthropicRes.usage.input_tokens, 15);
  assert.strictEqual(anthropicRes.usage.output_tokens, 25);
  console.log('✓ 测试 3 通过');

  // Test 4: Anthropic to OpenAI Response
  console.log('测试 4: Anthropic -> OpenRouter (OpenAI) 响应转换...');
  const anthropicResInput = {
    id: 'msg_98765',
    content: [{ type: 'text', text: 'Anthropic reply' }],
    stop_reason: 'max_tokens',
    usage: { input_tokens: 30, output_tokens: 50 }
  };

  const openRouterResOutput = convertAnthropicToOpenRouterResponse(anthropicResInput, 'anthropic/claude-3.5-sonnet');
  
  assert.strictEqual(openRouterResOutput.id, 'chatcmpl-98765');
  assert.strictEqual(openRouterResOutput.object, 'chat.completion');
  assert.strictEqual(openRouterResOutput.model, 'anthropic/claude-3.5-sonnet');
  assert.strictEqual(openRouterResOutput.choices[0].message.content, 'Anthropic reply');
  assert.strictEqual(openRouterResOutput.choices[0].finish_reason, 'length'); // mapped max_tokens -> length
  assert.strictEqual(openRouterResOutput.usage.prompt_tokens, 30);
  assert.strictEqual(openRouterResOutput.usage.completion_tokens, 50);
  assert.strictEqual(openRouterResOutput.usage.total_tokens, 80);
  console.log('✓ 测试 4 通过');

  // Test 5: OpenAI -> Anthropic Tools & Reasoning & History merging
  console.log('测试 5: OpenAI -> Anthropic 工具调用和深度思考字段处理与历史清洗...');
  
  const openaiReqWithTools = {
    model: 'anthropic/claude-3.5-sonnet',
    messages: [
      { role: 'user', content: 'Search for files' },
      { 
        role: 'assistant', 
        content: 'I will list the directory.',
        reasoning_content: 'Thinking: I need to use the list_dir tool to find the files.',
        tool_calls: [
          {
            id: 'call_abc123',
            type: 'function',
            function: {
              name: 'list_dir',
              arguments: '{"DirectoryPath": "/tmp"}'
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_abc123',
        content: '{"files": ["a.txt", "b.txt"]}'
      }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'list_dir',
          description: 'List files in directory',
          parameters: { type: 'object', properties: {} }
        }
      }
    ],
    tool_choice: 'auto',
    max_tokens: 2000
  };

  const anthropicConvertedTools = convertOpenRouterToAnthropicRequest(openaiReqWithTools, {
    'anthropic/claude-3.5-sonnet': 'claude-3-5-sonnet-20241022'
  });

  assert.strictEqual(anthropicConvertedTools.model, 'claude-3-5-sonnet-20241022');
  assert.deepStrictEqual(anthropicConvertedTools.tools, [
    {
      name: 'list_dir',
      description: 'List files in directory',
      input_schema: { type: 'object', properties: {} }
    }
  ]);
  assert.deepStrictEqual(anthropicConvertedTools.tool_choice, { type: 'auto' });

  // Verify the cleaned messages
  const cleanedMsgs = anthropicConvertedTools.messages;
  assert.strictEqual(cleanedMsgs.length, 3);
  
  // First msg: user
  assert.strictEqual(cleanedMsgs[0].role, 'user');
  assert.strictEqual(cleanedMsgs[0].content, 'Search for files');

  // Second msg: assistant (should contain thinking block + tool_use block)
  assert.strictEqual(cleanedMsgs[1].role, 'assistant');
  assert.strictEqual(Array.isArray(cleanedMsgs[1].content), true);
  const assistantBlocks = cleanedMsgs[1].content as any[];
  assert.strictEqual(assistantBlocks.length, 3);
  assert.strictEqual(assistantBlocks[0].type, 'thinking');
  assert.strictEqual(assistantBlocks[0].thinking, 'Thinking: I need to use the list_dir tool to find the files.');
  assert.strictEqual(assistantBlocks[1].type, 'text');
  assert.strictEqual(assistantBlocks[1].text, 'I will list the directory.');
  assert.strictEqual(assistantBlocks[2].type, 'tool_use');
  assert.strictEqual(assistantBlocks[2].id, 'call_abc123');
  assert.strictEqual(assistantBlocks[2].name, 'list_dir');
  assert.deepStrictEqual(assistantBlocks[2].input, { DirectoryPath: '/tmp' });

  // Third msg: user (from tool response)
  assert.strictEqual(cleanedMsgs[2].role, 'user');
  assert.strictEqual(Array.isArray(cleanedMsgs[2].content), true);
  const userBlocks = cleanedMsgs[2].content as any[];
  assert.strictEqual(userBlocks.length, 1);
  assert.strictEqual(userBlocks[0].type, 'tool_result');
  assert.strictEqual(userBlocks[0].tool_use_id, 'call_abc123');
  assert.strictEqual(userBlocks[0].content, '{"files": ["a.txt", "b.txt"]}');

  console.log('✓ 测试 5 通过');

  // Test 6: Responses Request to Chat Completions Request
  console.log('测试 6: Responses -> Chat Completions 请求转换...');
  const responsesReq = {
    model: 'gpt-4o',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Hello, what tools do you have?' }]
      }
    ],
    instructions: 'You are a coder.',
    max_output_tokens: 150,
    temperature: 0.7,
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: {} }
      }
    ]
  };

  const convertedChatReq = convertResponsesRequestToChatCompletions(responsesReq, {
    'gpt-4o': 'deepseek-chat'
  });

  assert.strictEqual(convertedChatReq.model, 'deepseek-chat');
  assert.strictEqual(convertedChatReq.max_completion_tokens, 150);
  assert.strictEqual(convertedChatReq.temperature, 0.7);
  assert.strictEqual(convertedChatReq.messages.length, 2);
  assert.deepStrictEqual(convertedChatReq.messages[0], { role: 'system', content: 'You are a coder.' });
  assert.deepStrictEqual(convertedChatReq.messages[1], { role: 'user', content: 'Hello, what tools do you have?' });
  assert.deepStrictEqual(convertedChatReq.tools, [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: {} }
      }
    }
  ]);
  console.log('✓ 测试 6 通过');

  // Test 7: Chat Completions to Responses Response
  console.log('测试 7: Chat Completions -> Responses 响应转换...');
  const chatCompletionsRes = {
    id: 'chatcmpl-responses-123',
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Hello! I am a coding assistant.',
          reasoning_content: 'Thinking: The user asked who I am.'
        },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
  };

  const convertedResponsesRes = convertChatCompletionsToResponsesResponse(chatCompletionsRes, 'gpt-4o');

  assert.strictEqual(convertedResponsesRes.object, 'response');
  assert.strictEqual(convertedResponsesRes.model, 'gpt-4o');
  assert.strictEqual(convertedResponsesRes.status, 'completed');
  assert.strictEqual(convertedResponsesRes.output_text, 'Hello! I am a coding assistant.');
  assert.strictEqual(convertedResponsesRes.output.length, 2);
  assert.strictEqual(convertedResponsesRes.output[0].type, 'reasoning');
  assert.strictEqual(convertedResponsesRes.output[0].summary?.[0].text, 'Thinking: The user asked who I am.');
  assert.strictEqual(convertedResponsesRes.output[1].type, 'message');
  assert.strictEqual(convertedResponsesRes.output[1].content?.[0].text, 'Hello! I am a coding assistant.');
  assert.strictEqual(convertedResponsesRes.usage?.input_tokens, 10);
  assert.strictEqual(convertedResponsesRes.usage?.output_tokens, 20);
  console.log('✓ 测试 7 通过');

  console.log('\n所有 TypeScript 单元测试运行成功！🎉');
  process.exit(0);
} catch (err) {
  console.error('\n❌ TS 单元测试运行失败:');
  console.error(err);
  process.exit(1);
}
