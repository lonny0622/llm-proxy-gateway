import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // 全局忽略的目录，避免对构建产物和前端进行重复校验
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'frontend/**',          // 前端项目有其独立的 eslint 配置
      '.ref-moon-bridge/**', // 参考项目
    ],
  },
  // 继承默认推荐规则
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test-ts.ts', 'bin/cli.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // 允许使用 any 类型（由于大语言模型接口协议的数据结构极具动态性，允许一定程度的 any 规避类型过于繁琐）
      '@typescript-eslint/no-explicit-any': 'off',
      // 对未使用的变量报警告（排除下划线开头的变量、参数和捕获的错误）
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // 作为一个命令行和后台工具，允许直接使用 console 进行打印日志
      'no-console': 'off',
      // 允许空的 catch 块 (用于捕获并忽略解析异常)
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  }
);
