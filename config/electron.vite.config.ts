import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * 仓库根目录。
 *
 * ⚠️ 本文件位于 config/，不在仓库根（v0.3.3 的 T60 根目录整理），
 * 所以所有路径必须以 projectRoot 为基准，不能直接用 __dirname。
 */
// eslint-disable-next-line no-undef
const projectRoot = resolve(__dirname, '..')

/** 源码目录别名：避免各文件手写易错的相对路径（T5） */
const alias = {
  '@shared': resolve(projectRoot, 'src/shared'),
  '@preload': resolve(projectRoot, 'src/preload'),
  '@renderer': resolve(projectRoot, 'src/renderer/src')
}

/** 发布版构建选项：开启压缩、关闭 sourcemap（T13） */
const releaseBuild = {
  minify: 'esbuild' as const,
  sourcemap: false
}

/**
 * 把第三方依赖拆成独立 chunk，避免 renderer 出现单个 >500KB 的巨型 bundle（T13）。
 * 仅按 node_modules 包名拆分，不改变业务模块的加载顺序语义。
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  const norm = id.replace(/\\/g, '/')
  if (norm.includes('/node_modules/xlsx/')) return 'vendor-xlsx'
  if (norm.includes('/node_modules/papaparse/')) return 'vendor-papaparse'
  if (/\/node_modules\/(react|react-dom|scheduler)\//.test(norm)) return 'vendor-react'
  if (/\/node_modules\/(i18next|react-i18next|i18next-browser-languagedetector)\//.test(norm)) {
    return 'vendor-i18n'
  }
  return 'vendor'
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      ...releaseBuild,
      // ⚠️ 必须显式指定 outDir（T60 坑）：本文件在 config/ 下，
      // 默认出目录会相对 config/ 解析，产物落到 config/out/ 而不是仓库根的 out/，
      // 导致 electron-builder 找不到 main 入口。
      outDir: resolve(projectRoot, 'out/main'),
      rollupOptions: {
        input: {
          index: resolve(projectRoot, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      ...releaseBuild,
      outDir: resolve(projectRoot, 'out/preload'),
      rollupOptions: {
        input: {
          index: resolve(projectRoot, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(projectRoot, 'src/renderer'),
    resolve: { alias },
    build: {
      ...releaseBuild,
      // 同 main/preload：本文件在 config/ 下，必须显式指定产物目录
      outDir: resolve(projectRoot, 'out/renderer'),
      // renderer 的 index.html 在 src/renderer 下，空目录警告需显式覆盖
      emptyOutDir: true,
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        input: {
          index: resolve(projectRoot, 'src/renderer/index.html')
        },
        output: {
          manualChunks
        }
      }
    },
    plugins: [react()]
  }
})
