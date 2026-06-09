export interface ModelMap {
  [sourceModel: string]: string;
}

export interface ProxyConfig {
  id: string;
  name: string;
  port: number;
  type: 'anthropic-to-openrouter' | 'openrouter-to-anthropic' | 'responses-to-chat-completions';
  apiKey: string;
  targetUrl?: string;
  active: boolean;
  modelMap: ModelMap;
  running?: boolean;
}

export interface GatewayConfig {
  dashboardPort: number;
  proxies: ProxyConfig[];
}

export interface LogItem {
  id: string;
  timestamp: string;
  proxyId: string;
  proxyName: string;
  type: string;
  direction: string;
  requestBody: any;
  responseData: any;
  statusCode: number;
  error?: string | null;
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | string;
  content: string | any[];
}

export interface AnthropicContentBlock {
  type: 'text' | 'image' | string;
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}
