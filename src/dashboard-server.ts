import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, saveConfig } from './config.js';
import { logs, logListeners } from './logger.js';
import { activeServers, startProxy, stopProxy, readRequestBody } from './proxy-server.js';
import { ProxyConfig, LogItem } from './types.js';
import {
  convertAnthropicToOpenRouterRequest,
  convertOpenRouterToAnthropicResponse,
  convertOpenRouterToAnthropicRequest,
  convertAnthropicToOpenRouterResponse
} from './protocol/anthropic-openrouter.js';
import {
  convertResponsesRequestToChatCompletions,
  convertChatCompletionsToResponsesResponse
} from './protocol/responses-chat.js';

// 获取前端 React 打包目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '../frontend/dist');

// 全局唯一的控制台服务实例
export let dashboardServer: http.Server | null = null;

/**
 * 启动控制台 HTTP 管理服务
 */
export function startDashboardServer() {
  if (dashboardServer) return;

  dashboardServer = http.createServer(async (req, res) => {
    const host = req.headers.host || `localhost:${config.dashboardPort}`;
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = parsedUrl.pathname;

    // 默认允许跨域 (Dashboard 面板调试)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // ========================================================================
    // REST API 控制器路由
    // ========================================================================

    // 1. GET /api/config -> 获取配置和当前代理服务运行状态
    if (req.method === 'GET' && pathname === '/api/config') {
      const proxiesWithState = config.proxies.map(p => ({
        ...p,
        running: activeServers.has(p.id)
      }));
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        dashboardPort: config.dashboardPort,
        proxies: proxiesWithState
      }));
      return;
    }

    // 2. POST /api/proxies -> 新增代理配置
    if (req.method === 'POST' && pathname === '/api/proxies') {
      try {
        const data = await readRequestBody(req);
        const newProxy: ProxyConfig = {
          id: `p-${Math.random().toString(36).substring(2, 9)}`,
          name: data.name || '未命名代理',
          port: parseInt(data.port) || 9005,
          type: data.type || 'anthropic-to-openrouter',
          apiKey: data.apiKey || '',
          targetUrl: data.targetUrl || '',
          active: false,
          modelMap: data.modelMap || {}
        };

        // 端口碰撞检查
        if (config.proxies.some(p => p.port === newProxy.port)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '该监听端口已被另一个代理服务占用' }));
          return;
        }

        config.proxies.push(newProxy);
        saveConfig();

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newProxy));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 3. PUT /api/proxies/:id -> 修改已有代理配置
    if (req.method === 'PUT' && pathname.startsWith('/api/proxies/')) {
      const id = pathname.substring(13);
      const index = config.proxies.findIndex(p => p.id === id);

      if (index === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '找不到指定的代理配置' }));
        return;
      }

      try {
        const data = await readRequestBody(req);
        const updatedPort = parseInt(data.port) || config.proxies[index].port;

        // 端口碰撞检查
        if (config.proxies.some(p => p.id !== id && p.port === updatedPort)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '端口已被其他代理配置占用' }));
          return;
        }

        const wasRunning = activeServers.has(id);
        if (wasRunning) {
          stopProxy(id);
        }

        config.proxies[index] = {
          ...config.proxies[index],
          name: data.name || config.proxies[index].name,
          port: updatedPort,
          type: data.type || config.proxies[index].type,
          apiKey: data.apiKey !== undefined ? data.apiKey : config.proxies[index].apiKey,
          targetUrl: data.targetUrl !== undefined ? data.targetUrl : config.proxies[index].targetUrl,
          modelMap: data.modelMap || config.proxies[index].modelMap
        };

        saveConfig();

        if (wasRunning && config.proxies[index].active) {
          startProxy(config.proxies[index]);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...config.proxies[index], running: activeServers.has(id) }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 4. DELETE /api/proxies/:id -> 删除代理配置
    if (req.method === 'DELETE' && pathname.startsWith('/api/proxies/')) {
      const id = pathname.substring(13);
      const index = config.proxies.findIndex(p => p.id === id);

      if (index === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '找不到指定的代理配置' }));
        return;
      }

      stopProxy(id);
      config.proxies.splice(index, 1);
      saveConfig();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 5. POST /api/proxies/:id/toggle -> 快速启/停指定代理服务
    if (req.method === 'POST' && pathname.startsWith('/api/proxies/') && pathname.endsWith('/toggle')) {
      const id = pathname.substring(13, pathname.length - 7);
      const proxy = config.proxies.find(p => p.id === id);

      if (!proxy) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '找不到指定的代理配置' }));
        return;
      }

      const isRunning = activeServers.has(id);
      if (isRunning) {
        stopProxy(id);
        proxy.active = false;
      } else {
        proxy.active = true;
        startProxy(proxy);
      }
      saveConfig();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...proxy, running: activeServers.has(id) }));
      return;
    }

    // 6. GET /api/logs -> 获取最近 200 条日志
    if (req.method === 'GET' && pathname === '/api/logs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
      return;
    }

    // 7. GET /api/logs/stream -> 实时日志推送 SSE 连接
    if (req.method === 'GET' && pathname === '/api/logs/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      const listener = (logItem: LogItem) => {
        res.write(`data: ${JSON.stringify(logItem)}\n\n`);
      };

      logListeners.add(listener);

      req.on('close', () => {
        logListeners.delete(listener);
      });
      return;
    }

    // 8. POST /api/test -> 协议翻译沙箱 Playground 测试端点
    if (req.method === 'POST' && pathname === '/api/test') {
      try {
        const data = await readRequestBody(req);
        const { type, apiKey, model, targetModel, message } = data;

        if (!apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '进行接口连通性测试必须提供 API Key' }));
          return;
        }

        const testModelMap = { [model]: targetModel };

        if (type === 'anthropic-to-openrouter') {
          const testAnthropicReq = {
            model,
            messages: [{ role: 'user', content: message }],
            max_tokens: 100,
            stream: false
          };

          const convertedOpenRouterRequest = convertAnthropicToOpenRouterRequest(testAnthropicReq, testModelMap);
          
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              'HTTP-Referer': 'http://localhost:9000',
              'X-Title': 'LLM Proxy Gateway Test'
            },
            body: JSON.stringify(convertedOpenRouterRequest)
          });

          const rawText = await response.text();
          let rawJson = {};
          try { rawJson = JSON.parse(rawText); } catch {}

          if (!response.ok) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: rawJson?.error?.message || rawText,
              translatedRequest: convertedOpenRouterRequest,
              rawResponse: rawJson
            }));
            return;
          }

          const finalAnthropicResponse = convertOpenRouterToAnthropicResponse(rawJson, model);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            translatedRequest: convertedOpenRouterRequest,
            rawResponse: rawJson,
            translatedResponse: finalAnthropicResponse
          }));

        } else if (type === 'openrouter-to-anthropic') {
          const testOpenRouterReq = {
            model,
            messages: [{ role: 'user', content: message }],
            max_tokens: 100,
            stream: false
          };

          const convertedAnthropicRequest = convertOpenRouterToAnthropicRequest(testOpenRouterReq, testModelMap);

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(convertedAnthropicRequest)
          });

          const rawText = await response.text();
          let rawJson = {};
          try { rawJson = JSON.parse(rawText); } catch {}

          if (!response.ok) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: rawJson?.error?.message || rawText,
              translatedRequest: convertedAnthropicRequest,
              rawResponse: rawJson
            }));
            return;
          }

          const finalOpenRouterResponse = convertAnthropicToOpenRouterResponse(rawJson, model);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            translatedRequest: convertedAnthropicRequest,
            rawResponse: rawJson,
            translatedResponse: finalOpenRouterResponse
          }));
        } else if (type === 'responses-to-chat-completions') {
          const testResponsesReq = {
            model,
            input: message,
            max_output_tokens: 100,
            stream: false
          };

          const convertedChatRequest = convertResponsesRequestToChatCompletions(testResponsesReq, testModelMap);

          const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(convertedChatRequest)
          });

          const rawText = await response.text();
          let rawJson: any = {};
          try { rawJson = JSON.parse(rawText); } catch {}

          if (!response.ok) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: rawJson?.error?.message || rawText,
              translatedRequest: convertedChatRequest,
              rawResponse: rawJson
            }));
            return;
          }

          const finalResponsesResponse = convertChatCompletionsToResponsesResponse(rawJson, model);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            translatedRequest: convertedChatRequest,
            rawResponse: rawJson,
            translatedResponse: finalResponsesResponse
          }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '不支持测试指定的翻译方向' }));
        }
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `执行沙箱测试出错: ${err.message}` }));
      }
      return;
    }

    // ========================================================================
    // 静态文件服务路由 (仅用于托管 React SPA 应用)
    // ========================================================================
    if (req.method === 'GET') {
      let relativeFilePath = pathname === '/' ? 'index.html' : pathname.slice(1);
      
      // 如果路径没有后缀，回退到 index.html 从而支持前端的 React SPA 路由
      if (!path.extname(relativeFilePath)) {
        relativeFilePath = 'index.html';
      }

      const fullFilePath = path.join(PUBLIC_DIR, relativeFilePath);
      
      if (fs.existsSync(fullFilePath) && fs.statSync(fullFilePath).isFile()) {
        const ext = path.extname(fullFilePath);
        let contentType = 'text/html';
        if (ext === '.css') contentType = 'text/css';
        else if (ext === '.js') contentType = 'application/javascript';
        else if (ext === '.json') contentType = 'application/json';
        else if (ext === '.svg') contentType = 'image/svg+xml';
        else if (ext === '.png') contentType = 'image/png';
        
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(fullFilePath).pipe(res);
        return;
      } else {
        // 本地调试在 3000 或其他端口时，可能没有编译前端资源，返回提示
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('前端静态资源尚未构建，或处于 Vite 开发服务器代理模式。请在生产环境下执行前端构建。');
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  const dashboardPort = config.dashboardPort || 9000;
  dashboardServer.listen(dashboardPort, () => {
    console.log(`===================================================`);
    console.log(`[Management Dashboard] 管理后台运行在: http://localhost:${dashboardPort}`);
    console.log(`===================================================`);
  });
}

/**
 * 关闭控制台 HTTP 服务
 */
export function closeDashboardServer() {
  if (dashboardServer) {
    dashboardServer.close(() => {
      console.log('管理后台 HTTP 服务器已正常关闭。');
    });
    dashboardServer = null;
  }
}
