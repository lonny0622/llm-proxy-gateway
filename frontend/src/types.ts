export interface ModelMap {
  [sourceModel: string]: string;
}

export interface ProxyConfig {
  id: string;
  name: string;
  port: number;
  type: 'anthropic-to-openrouter' | 'openrouter-to-anthropic' | 'responses-to-chat-completions';
  apiKey: string;
  targetUrl: string;
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
