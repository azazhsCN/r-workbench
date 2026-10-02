import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

export type AppLanguage = 'zh-CN' | 'en-US'

/** 语言常量 */
export const LANGUAGES: { code: AppLanguage; label: string; englishName: string }[] = [
  { code: 'zh-CN', label: '简体中文', englishName: '简体中文' },
  { code: 'en-US', label: 'English', englishName: 'English' }
]

/** 语言检测顺序：本地保存 > 系统语言 */
const detectorOptions = {
  order: ['localStorage', 'navigator'],
  caches: ['localStorage'],
  lookupLocalStorage: 'rworkbench_language',
  convertDetectedLanguage: (lng: string) => (lng.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US')
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS }
    },
    fallbackLng: 'zh-CN',
    supportedLngs: ['zh-CN', 'en-US'],
    detection: detectorOptions,
    interpolation: {
      escapeValue: false, // React 已做 XSS 防护
      // i18next 默认插值分隔符是 {{ }}，但本项目全部 locale 值使用单花括号
      // （共 12 个键 × 2 种语言）。不设置这两项时界面会直接显示字面量
      // "显示前 200 行，共 {total} 行数据" / "不支持的文件格式: .{ext}"。
      prefix: '{',
      suffix: '}'
    },
    react: {
      useSuspense: false
    }
  })

/**
 * 同步 <html lang>，供屏幕阅读器、断词与 CSS `:lang()` 选择器使用。
 * index.html 里硬编码的 `lang="zh-CN"` 不会随语言切换更新。
 */
function applyDocumentLang(lng: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('lang', lng)
  notifyMainProcessLanguage(lng)
}

/**
 * 通知主进程重建应用菜单（T8：主菜单文案硬编码中文）。
 *
 * 通道 `app:setLanguage` 由 mainprocess 提供；这里用可选调用，通道尚未实现时
 * 静默跳过，不影响启动。菜单键见 locales 里的顶层 "menu" 段。
 */
function notifyMainProcessLanguage(lng: string): void {
  if (typeof window === 'undefined') return
  const api = window.api as unknown as
    | { app?: { setLanguage?: (lng: string) => void } }
    | undefined
  try {
    api?.app?.setLanguage?.(lng)
  } catch {
    // 菜单语言同步失败不影响界面
  }
}

i18n.on('languageChanged', applyDocumentLang)
applyDocumentLang(i18n.language || 'zh-CN')

/** 设置语言（持久化 + 应用） */
export function setLanguage(lang: AppLanguage | 'system'): void {
  if (lang === 'system') {
    // 清除本地保存，交给检测器按系统语言决定
    localStorage.removeItem('rworkbench_language')
    const detected = detectSystemLanguage()
    i18n.changeLanguage(detected)
  } else {
    i18n.changeLanguage(lang)
  }
}

/** 检测系统环境是否为中文 */
export function detectSystemLanguage(): AppLanguage {
  const nav = (navigator.language || navigator.languages?.[0] || 'en-US').toLowerCase()
  return nav.startsWith('zh') ? 'zh-CN' : 'en-US'
}

/** 当前是否使用中文 */
export function isZh(): boolean {
  return i18n.language.toLowerCase().startsWith('zh')
}

export default i18n
