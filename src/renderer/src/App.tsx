import { useState } from 'react'
import { DataProvider } from './contexts/DataContext'
import { AIProvider } from './contexts/AIContext'
import { RProvider } from './contexts/RContext'
import Sidebar from './components/Sidebar'
import ChatPage from './pages/ChatPage'
import WizardPage from './pages/WizardPage'
import DataPage from './pages/DataPage'
import SettingsPage from './pages/SettingsPage'
import WelcomePage from './pages/WelcomePage'
import './styles/app.css'

/** 页面类型 */
export type PageType = 'welcome' | 'chat' | 'wizard' | 'data' | 'settings'

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageType>('welcome')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const renderPage = () => {
    switch (currentPage) {
      case 'welcome':
        return <WelcomePage onNavigate={setCurrentPage} />
      case 'chat':
        return <ChatPage />
      case 'wizard':
        return <WizardPage />
      case 'data':
        return <DataPage />
      case 'settings':
        return <SettingsPage />
      default:
        return <WelcomePage onNavigate={setCurrentPage} />
    }
  }

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
            <div className="page-container animate-fade-in">{renderPage()}</div>
          </main>
        </div>
        </RProvider>
      </AIProvider>
    </DataProvider>
  )
}
