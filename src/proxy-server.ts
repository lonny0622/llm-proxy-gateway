import http, { IncomingMessage } from 'http';
import { saveConfig } from './config.js';
import { addLog } from './logger.js';
import { ProxyConfig } from './types.js';
import {
  convertAnthropicToOpenRouterRequest,
  convertOpenRouterToAnthropicRequest,
  convertOpenRouterToAnthropicResponse,
  convertAnthropicToOpenRouterResponse,
  handleOpenRouterToAnthropicStream,
  handleAnthropicToOpenRouterStream
} from './protocol/anthropic-openrouter.js';
import {
  convertResponsesRequestToChatCompletions,
  convertChatCompletionsToResponsesResponse,
  handleChatCompletionsStreamToResponsesStream
} from './protocol/responses-chat.js';

// 当前活跃运行的代理服务器 Map，键为 proxyId，值为 http.Server 实例
export const activeServers = new Map<string, http.Server>();

/**
 * 读取 HTTP 请求体数据并解析为 JSON 对象
 */
export async function readRequestBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('请求体非合法的 JSON 格式'));
      }
    });
    req.on('error', err => reject(err));
  });
}

/**
 * 启动指定的代理实例
 * 
 * @param proxy 代理配置项
 */
export function startProxy(proxy: ProxyConfig) {
  if (activeServers.has(proxy.id)) {
    console.log(`代理服务器 "${proxy.name}" 已经在端口 ${proxy.port} 运行。`);
    return;
  }

  const server = http.createServer(async (req, res) => {
    // 允许跨域
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const direction = proxy.type;

    try {
      if (direction === 'anthropic-to-openrouter') {
        // 期望路径: /v1/messages 或 /messages
        if (req.url !== '/v1/messages' && req.url !== '/messages') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `找不到端点 ${req.url}。请使用 /v1/messages` } }));
          return;
        }

        const anthropicReqBody = await readRequestBody(req);
        const apiKey = proxy.apiKey || (req.headers['x-api-key'] as string);

        if (!apiKey) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'authentication_error', message: '缺少 API Key。' } }));
          return;
        }

        // 转换请求体
        const openRouterBody = convertAnthropicToOpenRouterRequest(anthropicReqBody, proxy.modelMap || {});
        
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:9000',
          'X-Title': 'LLM Proxy Gateway'
        };

        let targetUrl = proxy.targetUrl || 'https://openrouter.ai/api/v1/chat/completions';
        if (proxy.targetUrl) {
          if (!targetUrl.endsWith('/chat/completions')) {
            targetUrl = targetUrl.endsWith('/') ? targetUrl + 'chat/completions' : targetUrl + '/chat/completions';
          }
        }
        
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(openRouterBody)
        });

        if (!response.ok) {
          const errText = await response.text();
          let errJson;
          try { errJson = JSON.parse(errText); } catch {
            // 忽略解析错误
          }
          
          const errorMsg = errJson?.error?.message || errText || 'OpenRouter API 错误';
          addLog(proxy.id, proxy.name, proxy.type, 'anthropic -> openrouter', anthropicReqBody, errJson || errText, response.status, errorMsg);
          
          res.writeHead(response.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            type: 'error',
            error: {
              type: 'api_error',
              message: errorMsg
            }
          }));
          return;
        }

        if (openRouterBody.stream) {
          await handleOpenRouterToAnthropicStream(response, res, anthropicReqBody.model, openRouterBody, (fullText) => {
            addLog(proxy.id, proxy.name, proxy.type, 'anthropic -> openrouter', anthropicReqBody, { text: fullText, stream: true }, 200);
          });
        } else {
          const openRouterJson = await response.json();
          const anthropicResponse = convertOpenRouterToAnthropicResponse(openRouterJson, anthropicReqBody.model);
          
          addLog(proxy.id, proxy.name, proxy.type, 'anthropic -> openrouter', anthropicReqBody, anthropicResponse, 200);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(anthropicResponse));
        }

      } else if (direction === 'openrouter-to-anthropic') {
        // 期望路径: /v1/chat/completions 或 /chat/completions
        if (req.url !== '/v1/chat/completions' && req.url !== '/chat/completions') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `找不到端点 ${req.url}。请使用 /v1/chat/completions` } }));
          return;
        }

        const openRouterReqBody = await readRequestBody(req);
        
        let apiKey = proxy.apiKey;
        if (!apiKey && req.headers['authorization']) {
          const authHeader = req.headers['authorization'] as string;
          if (authHeader.startsWith('Bearer ')) {
            apiKey = authHeader.substring(7);
          }
        }

        if (!apiKey) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Authorization 头部或代理配置中缺少 API Key。' } }));
          return;
        }

        // 转换请求体
        const anthropicBody = convertOpenRouterToAnthropicRequest(openRouterReqBody, proxy.modelMap || {});
        
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': (req.headers['anthropic-version'] as string) || '2023-06-01'
        };

        let targetUrl = proxy.targetUrl || 'https://api.anthropic.com/v1/messages';
        if (proxy.targetUrl) {
          if (!targetUrl.endsWith('/messages')) {
            targetUrl = targetUrl.endsWith('/') ? targetUrl + 'messages' : targetUrl + '/messages';
          }
        }
        
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(anthropicBody)
        });

        if (!response.ok) {
          const errText = await response.text();
          let errJson;
          try { errJson = JSON.parse(errText); } catch {
            // 忽略解析错误
          }
          
          const errorMsg = errJson?.error?.message || errText || 'Anthropic API 错误';
          addLog(proxy.id, proxy.name, proxy.type, 'openrouter -> anthropic', openRouterReqBody, errJson || errText, response.status, errorMsg);
          
          res.writeHead(response.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: errorMsg,
              type: errJson?.error?.type || 'api_error',
              code: response.status
            }
          }));
          return;
        }

        if (openRouterReqBody.stream) {
          await handleAnthropicToOpenRouterStream(response, res, openRouterReqBody.model, openRouterReqBody, (fullText) => {
            addLog(proxy.id, proxy.name, proxy.type, 'openrouter -> anthropic', openRouterReqBody, { text: fullText, stream: true }, 200);
          });
        } else {
          const anthropicJson = await response.json();
          const openRouterResponse = convertAnthropicToOpenRouterResponse(anthropicJson, openRouterReqBody.model);
          
          addLog(proxy.id, proxy.name, proxy.type, 'openrouter -> anthropic', openRouterReqBody, openRouterResponse, 200);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(openRouterResponse));
        }

      } else if (direction === 'responses-to-chat-completions') {
        // 期望路径: /v1/responses 或 /responses
        if (req.url !== '/v1/responses' && req.url !== '/responses') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `找不到端点 ${req.url}。请使用 /v1/responses` } }));
          return;
        }

        const responsesReqBody = await readRequestBody(req);

        let apiKey = proxy.apiKey;
        if (!apiKey && req.headers['authorization']) {
          const authHeader = req.headers['authorization'] as string;
          if (authHeader.startsWith('Bearer ')) {
            apiKey = authHeader.substring(7);
          }
        }

        if (!apiKey) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Authorization 头部或代理配置中缺少 API Key。' } }));
          return;
        }

        // 转换请求体
        const chatBody = convertResponsesRequestToChatCompletions(responsesReqBody, proxy.modelMap || {});

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        };

        let targetUrl = proxy.targetUrl || 'https://api.deepseek.com/v1/chat/completions';
        if (proxy.targetUrl) {
          if (!targetUrl.endsWith('/chat/completions')) {
            targetUrl = targetUrl.endsWith('/') ? targetUrl + 'chat/completions' : targetUrl + '/chat/completions';
          }
        }

        const upstreamResp = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(chatBody)
        });

        if (!upstreamResp.ok) {
          const errText = await upstreamResp.text();
          let errJson: any;
          try { errJson = JSON.parse(errText); } catch {
            // 忽略解析错误
          }

          const errorMsg = errJson?.error?.message || errText || '上游 API 发生错误';
          addLog(proxy.id, proxy.name, proxy.type, 'responses -> chat/completions', responsesReqBody, errJson || errText, upstreamResp.status, errorMsg);

          res.writeHead(upstreamResp.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: errorMsg,
              type: errJson?.error?.type || 'api_error',
              code: String(upstreamResp.status)
            }
          }));
          return;
        }

        if (chatBody.stream) {
          await handleChatCompletionsStreamToResponsesStream(upstreamResp, res, responsesReqBody.model, chatBody, (fullText) => {
            addLog(proxy.id, proxy.name, proxy.type, 'responses -> chat/completions', responsesReqBody, { text: fullText, stream: true }, 200);
          });
        } else {
          const chatJson = await upstreamResp.json();
          const responsesResponse = convertChatCompletionsToResponsesResponse(chatJson, responsesReqBody.model);

          addLog(proxy.id, proxy.name, proxy.type, 'responses -> chat/completions', responsesReqBody, responsesResponse, 200);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(responsesResponse));
        }
      }
    } catch (err: any) {
      console.error(`代理 "${proxy.name}" 处理请求时发生错误:`, err.message);
      addLog(proxy.id, proxy.name, proxy.type, 'error', {}, {}, 500, err.message);
      
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          message: `代理内部错误: ${err.message}`,
          type: 'proxy_error'
        }
      }));
    }
  });

  server.on('error', (err: any) => {
    console.error(`无法在端口 ${proxy.port} 启动代理服务器 "${proxy.name}":`, err.message);
    proxy.active = false;
    saveConfig();
  });

  server.listen(proxy.port, () => {
    console.log(`[Proxy Started] 代理服务器 "${proxy.name}" 正在监听端口 ${proxy.port}`);
  });

  activeServers.set(proxy.id, server);
}

/**
 * 停止运行指定的代理实例
 * 
 * @param proxyId 代理 ID
 */
export function stopProxy(proxyId: string) {
  const server = activeServers.get(proxyId);
  if (server) {
    server.close(() => {
      console.log(`[Proxy Stopped] 代理服务器已停止 (ID: ${proxyId})`);
    });
    activeServers.delete(proxyId);
  }
}

/**
 * 停止运行所有的代理实例
 */
export function stopAllProxies() {
  for (const id of Array.from(activeServers.keys())) {
    stopProxy(id);
  }
}
