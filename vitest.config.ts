import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@preload': resolve(__dirname, 'src/preload'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
}

/**
 * 单元测试配置（T4）。
 *
 * - 两个 project：`node`（主进程 / shared 纯函数）与 `renderer`（渲染进程纯函数与注册表一致性）。
 * - 全部测试为纯函数 / 静态源码断言，**不需要安装 R**，因此可在任意 CI runner 上运行。
 * - 不使用 vitest globals：每个测试文件显式 `import { describe, it, expect } from 'vitest'`，
 *   这样 `tsc -p tsconfig.web.json` 也能对测试本身做类型检查。
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts']
        }
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'node',
          include: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx']
        }
      }
    ]
  }
})
