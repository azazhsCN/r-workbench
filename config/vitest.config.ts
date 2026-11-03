import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * 单元测试配置。
 *
 * ⚠️ **本文件位于 `config/`，不在仓库根**（v0.3.3 的 T60 根目录整理）。
 * 因此所有路径都必须以 `projectRoot`（仓库根）为基准，不能用 `__dirname` 直接拼。
 *
 * ⚠️ **三个必踩的坑**（都已实测，改动前请先读）：
 *
 * 1. `test.root` 必须显式指向**仓库根**。
 *    不设的话 vitest 以本文件所在目录（`config/`）为 root，测试会被扫到 0 个。
 * 2. `include` 里必须用 `**` + `*.test.tsx` 这种明确模式（见下方写法）。
 *    若写成宽泛的 `*.tsx`，`App.tsx` 这类非测试文件也会被当测试文件，
 *    报 13 个 "No test suite found"。
 * 3. `alias` 也要以仓库根为基准——否则 `@shared` 之类全部解析失败。
 */
const projectRoot = resolve(__dirname, '..')

const alias = {
  '@shared': resolve(projectRoot, 'src/shared'),
  '@preload': resolve(projectRoot, 'src/preload'),
  '@renderer': resolve(projectRoot, 'src/renderer/src')
}

export default defineConfig({
  // 坑 1：root 必须是仓库根，不是 config/
  root: projectRoot,
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
          // 坑 2：必须限定 `*.test.tsx`，不能写 `*.tsx`
          include: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx']
        }
      }
    ]
  }
})
