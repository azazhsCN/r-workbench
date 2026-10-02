// 使用 @preload 别名而非相对路径：此前的 '../preload/index' 指向不存在的
// src/renderer/preload/，在 skipLibCheck: true 下被静默忽略，
// 导致 window.api 在整个渲染进程里退化为 any，IPC 契约漂移无法被类型系统发现。
import type { AppAPI } from '@preload/index'

declare global {
  interface Window {
    api: AppAPI
  }
}
