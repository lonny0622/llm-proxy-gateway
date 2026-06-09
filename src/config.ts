import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GatewayConfig } from './types.js';

// 获取当前模块的绝对路径及配置文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const CONFIG_FILE = path.join(__dirname, '../config.json');

// 全局配置对象，通过直接修改属性保持 ESM 导入引用的有效性
export const config: GatewayConfig = {
  dashboardPort: 9000,
  proxies: []
};

/**
 * 从磁盘加载配置文件
 */
export function loadConfig(): GatewayConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(data);
      config.dashboardPort = parsed.dashboardPort ?? 9000;
      config.proxies = parsed.proxies ?? [];
    } else {
      saveConfig();
    }
  } catch (err: any) {
    console.error('加载 config.json 发生错误，将使用默认配置:', err.message);
  }
  return config;
}

/**
 * 将当前配置持久化到磁盘
 */
export function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (err: any) {
    console.error('保存 config.json 失败:', err.message);
  }
}
