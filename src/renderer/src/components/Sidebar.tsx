import { useTranslation } from 'react-i18next'
import type { PageType } from '../App'

interface SidebarProps {
  currentPage: PageType
  onNavigate: (page: PageType) => void
  collapsed: boolean
  onToggle: () => void
}

interface NavItemConfig {
  id: PageType
  icon: string
  labelKey: string
  sectionKey: string
}

// label/section 使用 i18n key，支持运行时切换语言
const navItems: NavItemConfig[] = [
  { id: 'welcome', icon: '🏠', labelKey: 'nav.home', sectionKey: 'nav.section.nav' },
  { id: 'chat', icon: '💬', labelKey: 'nav.chat', sectionKey: 'nav.section.analysis' },
  { id: 'wizard', icon: '📊', labelKey: 'nav.wizard', sectionKey: 'nav.section.analysis' },
  { id: 'data', icon: '📁', labelKey: 'nav.data', sectionKey: 'nav.section.data' },
  { id: 'settings', icon: '⚙️', labelKey: 'nav.settings', sectionKey: 'nav.section.system' }
]

export default function Sidebar({
  currentPage,
  onNavigate,
  collapsed,
  onToggle
}: SidebarProps) {
  const { t } = useTranslation()

  // 按 section 分组，section 标题取翻译
  const sections = navItems.reduce<Record<string, NavItemConfig[]>>(
    (acc, item) => {
      if (!acc[item.sectionKey]) acc[item.sectionKey] = []
      acc[item.sectionKey].push(item)
      return acc
    },
    {}
  )

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* 头部 Logo */}
      <div className="sidebar-header">
        <div className="sidebar-logo">R</div>
        <span className="sidebar-title">R Workbench</span>
      </div>

      {/* 导航菜单 */}
      <nav className="sidebar-nav">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section}>
            <div className="sidebar-section-title">{t(section)}</div>
            {items.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => onNavigate(item.id)}
                title={collapsed ? t(item.labelKey) : undefined}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{t(item.labelKey)}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* 底部折叠按钮 */}
      <div className="sidebar-footer">
        <button className="sidebar-toggle" onClick={onToggle}>
          <span style={{ fontSize: 16 }}>{collapsed ? '→' : '←'}</span>
          {!collapsed && <span className="nav-label" style={{ marginLeft: 8, fontSize: 13 }}>{t('nav.collapse')}</span>}
        </button>
      </div>
    </aside>
  )
}
