import { useState, type CSSProperties } from 'react'
import { DataProvider } from './contexts/DataContext'
import { AIProvider } from './contexts/AIContext'
import { RProvider } from './contexts/RContext'
import Sidebar from './components/Sidebar'
import ChatPage from './pages/ChatPage'
import WizardPage from './pages/WizardPage'
import DataPage from './pages/DataPage'
import SettingsPage from './pages/SettingsPage'
import WelcomePage from './pages/WelcomePage'
import './i18n' // 初始化 i18next（自动根据系统/本地语言加载）
import './styles/app.css'

/** 页面类型 */
export type PageType = 'welcome' | 'chat' | 'wizard' | 'data' | 'settings'

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageType>('welcome')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  /**
   * 页面保活：所有页面保持挂载，只切换可见性。
   *
   * 旧实现用 `switch (currentPage)` 渲染，切到"设置"或"数据管理"会**卸载**
   * ChatPage，从而销毁整段 AI 对话、已执行的 R 结果、三线表与图表。
   * 对统计工具而言这是分析进度丢失。
   */
  const pageStyle = (page: PageType): CSSProperties => ({
    display: currentPage === page ? undefined : 'none'
  })

  return (
    <DataProvider>
      <AIProvider>
        <RProvider>
          <div className="app-layout">
          <Sidebar
            currentPage={currentPage}
            onNavigate={setCurrentPage}
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
          <main className="main-content">
            <div className="page-container">
              <div style={pageStyle('welcome')}>
                <WelcomePage onNavigate={setCurrentPage} />
              </div>
              <div style={pageStyle('chat')}>
                <ChatPage />
              </div>
              <div style={pageStyle('wizard')}>
                <WizardPage />
              </div>
              <div style={pageStyle('data')}>
                <DataPage />
              </div>
              <div style={pageStyle('settings')}>
                <SettingsPage />
              </div>
            </div>
          </main>
        </div>
        </RProvider>
      </AIProvider>
    </DataProvider>
  )
}
