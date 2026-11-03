import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  // 全局忽略
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', '*.config.*']
  },

  // 基础规则
  js.configs.recommended,

  // TypeScript 规则
  ...tseslint.configs.recommended,

  // 主进程和预加载脚本
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      globals: {
        NodeJS: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },

  // 渲染进程（React）
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Fast Refresh 要求一个文件只导出组件。但 React 官方文档的 Provider + hook
      // 模式天然违反这条（useAI/useData/useR 与 Provider 必须同文件，否则闭包无法
      // 访问 Context）。规则的 `allowExportNames` 让 hook 导出被视为合法；
      // 其他非常量导出仍然会被标记，以免热更新悄悄失效。
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: ['useAI', 'useData', 'useR']
        }
      ]
    }
  },

  // 通用规则覆盖
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error'
    }
  }
)
