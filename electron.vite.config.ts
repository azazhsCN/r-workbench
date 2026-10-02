import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/** 源码目录别名：避免各文件手写易错的相对路径（T5） */
const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@preload': resolve(__dirname, 'src/preload'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
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
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      ...releaseBuild,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    build: {
      ...releaseBuild,
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        output: {
          manualChunks
        }
      }
    },
    plugins: [react()]
  }
})
