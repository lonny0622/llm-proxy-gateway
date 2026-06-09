import { loadConfig, config } from './config.js';
import { startDashboardServer, closeDashboardServer } from './dashboard-server.js';
import { startProxy, stopAllProxies } from './proxy-server.js';

/**
 * 网关代理主程序入口逻辑
 */
async function bootstrap() {
  console.log('正在初始化 LLM 多端代理网关...');

  // 1. 从磁盘载入 config.json 全局配置
  loadConfig();

  // 2. 遍历配置中已被激活的所有端口代理，依次拉起
  if (config.proxies && Array.isArray(config.proxies)) {
    let activeCount = 0;
    for (const proxy of config.proxies) {
      if (proxy.active) {
        try {
          startProxy(proxy);
          activeCount++;
        } catch (err: any) {
          console.error(`无法启动代理 "${proxy.name}":`, err.message);
        }
      }
    }
    console.log(`已启动 ${activeCount} 个活跃端口代理服务。`);
  }

  // 3. 启动后台控制台 HTTP 服务
  try {
    startDashboardServer();
  } catch (err: any) {
    console.error('控制台后台启动失败:', err.message);
  }

  console.log('系统初始化完成。按 Ctrl+C 可安全停止服务。');
}

// 启动入口
bootstrap().catch(err => {
  console.error('系统启动发生致命错误:', err);
  process.exit(1);
});

// 注册 SIGINT 信号监听以执行优雅关机
process.on('SIGINT', () => {
  console.log('\n正在优雅关闭所有代理及控制面板服务...');
  
  // 1. 停止所有端口代理
  stopAllProxies();
  
  // 2. 关闭管理后台端口监听
  closeDashboardServer();

  console.log('服务已完全退出。');
  process.exit(0);
});
