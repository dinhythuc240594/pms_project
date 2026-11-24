import { t as tUi, useI18n } from '../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { usePms } from '../../pms/data/usePms'
import ManagerSidebar from '../components/ManagerSidebar'
import ManagerHeader from '../components/ManagerHeader'
import RequestActivity from '../../../shared/components/RequestActivity'
import { getThemeTokens } from '../theme'
import './ManagerLayout.css'

export default function ManagerLayout() {
  useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      return localStorage.getItem('pms_manager_theme') === 'dark'
    } catch {
      return false
    }
  })
  const { user } = usePms()
  const currentRole = user?.globalRole
  const mobileNav = useRef(null)
  const theme = getThemeTokens(isDarkMode)
  useEffect(() => {
    if (mobileNavOpen) mobileNav.current?.showModal()
    else mobileNav.current?.close()
  }, [mobileNavOpen])
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 901px)')
    const closeOnDesktop = (event) => {
      if (event.matches) setMobileNavOpen(false)
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])
  const toggleDarkMode = () => {
    const next = !isDarkMode
    setIsDarkMode(next)
    try {
      localStorage.setItem('pms_manager_theme', next ? 'dark' : 'light')
    } catch {
      /* Theme remains available in memory. */
    }
  }

  return (
    <div
      className={`manager-shell${isCollapsed ? ' manager-shell-collapsed' : ''}`}
      data-theme={isDarkMode ? 'dark' : 'light'}
      style={{
        '--manager-ink': theme.textPrimary,
        '--manager-muted': theme.textSecondary,
        '--manager-accent': theme.primaryText,
        '--manager-accent-bg': theme.primaryBg,
        '--manager-primary': theme.primary,
        '--manager-primary-hover': theme.primaryHover,
        '--manager-surface': theme.bgSurface,
        '--manager-soft': theme.bgMain,
        '--manager-line': theme.border,
        '--manager-lime': '#def09f',
        '--manager-danger': theme.danger,
        '--manager-warning': theme.warning,
        '--manager-input': theme.bgInput,
      }}
    >
      <a href="#manager-main" className="manager-skip-link">
        {tUi('nav.skip')}
      </a>
      <div className="manager-desktop-navigation">
        <ManagerSidebar
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
          currentRole={currentRole}
        />
      </div>
      <dialog
        id="manager-mobile-nav"
        ref={mobileNav}
        className="manager-mobile-dialog"
        aria-label={tUi('manager.menu')}
        onClick={(event) => {
          if (event.target === event.currentTarget) setMobileNavOpen(false)
        }}
        onCancel={() => setMobileNavOpen(false)}
        onClose={() => setMobileNavOpen(false)}
      >
        <ManagerSidebar currentRole={currentRole} onClose={() => setMobileNavOpen(false)} />
      </dialog>
      <div className="manager-workspace">
        <RequestActivity />
        <ManagerHeader
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isDarkMode={isDarkMode}
          toggleDarkMode={toggleDarkMode}
          currentRole={currentRole}
          mobileNavOpen={mobileNavOpen}
          onOpenNavigation={() => setMobileNavOpen(true)}
        />
        <main id="manager-main" className="manager-main" tabIndex={-1}>
          <div className="manager-content">
            <Outlet
              context={{
                searchQuery,
                setSearchQuery,
                isDarkMode,
                toggleDarkMode,
                currentRole,
                theme,
              }}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
