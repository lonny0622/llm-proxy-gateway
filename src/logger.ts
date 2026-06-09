import { LogItem } from './types.js';

// 内存日志缓冲区，最多保留 200 条
export const logs: LogItem[] = [];

// 全局日志推送监听器
export const logListeners = new Set<(log: LogItem) => void>();

/**
 * 记录一次请求/响应事务日志，并广播给当前所有订阅的客户端 (如控制台 SSE 接口)
 * 
 * @param proxyId 代理配置的 ID
 * @param proxyName 代理配置名称
 * @param type 代理类型
 * @param direction 转换方向或阶段描述
 * @param requestBody 请求报文主体
 * @param responseData 响应报文主体或错误信息
 * @param statusCode HTTP 响应状态码
 * @param errorMsg 错误描述信息
 */
export function addLog(
  proxyId: string,
  proxyName: string,
  type: string,
  direction: string,
  requestBody: any,
  responseData: any,
  statusCode: number,
  errorMsg: string | null = null
) {
  const logItem: LogItem = {
    id: Math.random().toString(36).substring(2, 10),
    timestamp: new Date().toISOString(),
    proxyId,
    proxyName,
    type,
    direction,
    requestBody: typeof requestBody === 'object' ? requestBody : { raw: requestBody },
    responseData: typeof responseData === 'object' ? responseData : { raw: responseData },
    statusCode,
    error: errorMsg
  };
  
  // 插到队头
  logs.unshift(logItem);
  if (logs.length > 200) {
    logs.pop();
  }
  
  // 推送给所有活跃监听连接
  for (const listener of logListeners) {
    try {
      listener(logItem);
    } catch {
      // 容错处理，防止单监听器异常影响其他订阅
    }
  }
}

/**
 * 注册一个日志监听器 (SSE 长连接订阅)
 */
export function addLogListener(listener: (log: LogItem) => void) {
  logListeners.add(listener);
}

/**
 * 注销一个日志监听器 (连接关闭时)
 */
export function removeLogListener(listener: (log: LogItem) => void) {
  logListeners.delete(listener);
}

/**
 * 清空缓冲区日志
 */
export function clearLogs() {
  logs.length = 0;
}
