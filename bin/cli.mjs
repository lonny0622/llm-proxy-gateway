#!/usr/bin/env node

/**
 * LLM Proxy Gateway CLI
 * 用法: llm-proxy
 * 
 * 使用 tsx 动态运行 TypeScript 入口，无需预编译。
 */

import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const entryPoint = path.resolve(__dirname, '../src/gateway.ts');

// 查找项目本地安装的 tsx
const localTsx = path.resolve(__dirname, '../node_modules/.bin/tsx');

try {
  execFileSync(localTsx, [entryPoint], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env }
  });
} catch (err) {
  // execFileSync 在子进程被 SIGINT 终止时会抛出异常，这是正常退出
  if (err.status !== null) {
    process.exit(err.status);
  }
}
