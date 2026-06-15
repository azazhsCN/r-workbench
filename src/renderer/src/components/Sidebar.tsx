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
  label: string
  section: string
}

const navItems: NavItemConfig[] = [
  { id: 'chat', icon: '💬', label: 'AI 对话分析', section: '分析' },
  { id: 'wizard', icon: '📊', label: '向导式分析', section: '分析' },
  { id: 'data', icon: '📁', label: '数据管理', section: '数据' },
  { id: 'settings', icon: '⚙️', label: '设置', section: '系统' }
]

export default function Sidebar({
  currentPage,
  onNavigate,
  collapsed,
  onToggle
}: SidebarProps) {
  // 按 section 分组
  const sections = navItems.reduce<Record<string, NavItemConfig[]>>(
    (acc, item) => {
      if (!acc[item.section]) acc[item.section] = []
      acc[item.section].push(item)
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
            <div className="sidebar-section-title">{section}</div>
            {items.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => onNavigate(item.id)}
                title={collapsed ? item.label : undefined}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* 底部折叠按钮 */}
      <div className="sidebar-footer">
        <button className="sidebar-toggle" onClick={onToggle}>
          <span style={{ fontSize: 16 }}>{collapsed ? '→' : '←'}</span>
          {!collapsed && <span className="nav-label" style={{ marginLeft: 8, fontSize: 13 }}>收起</span>}
        </button>
      </div>
    </aside>
  )
}
