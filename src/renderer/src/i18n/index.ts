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
      escapeValue: false // React 已做 XSS 防护
    },
    react: {
      useSuspense: false
    }
  })

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
