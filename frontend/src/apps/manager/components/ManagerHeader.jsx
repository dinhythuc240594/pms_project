import { t as tUi, useI18n } from '../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import { useLocation, Link, useNavigate } from 'react-router-dom'
import { Search, LogOut, UserRound, ChevronDown, Sun, Moon, Menu } from 'lucide-react'
import { usePms } from '../../pms/data/usePms'
import LanguageSwitcher from '../../../shared/i18n/LanguageSwitcher.jsx'
import { useDraftNavigation } from '../../../shared/drafts/DraftGuardProvider'

export default function ManagerHeader({
  searchQuery,
  setSearchQuery,
  isDarkMode,
  toggleDarkMode,
  currentRole,
  mobileNavOpen,
  onOpenNavigation,
}) {
  useI18n()
  const { logout, user } = usePms()
  const location = useLocation()
  const navigate = useNavigate()
  const { requestLeave } = useDraftNavigation()
  const [profileOpen, setProfileOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const profileRef = useRef(null)
  const profileButton = useRef(null)
  const route = location.pathname.split('/').at(-1)
  const searchable = ['tenants', 'features', 'users', 'logs'].includes(route)
  const roleName = currentRole === 'SUPER_ADMIN' ? 'Super Admin' : 'System Manager'
  const initials = (user?.name || user?.email || 'LOHA')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  useEffect(() => {
    if (!profileOpen) return
    const closeOutside = (event) => {
      if (!profileRef.current?.contains(event.target)) setProfileOpen(false)
    }
    const closeEscape = (event) => {
      if (event.key === 'Escape') {
        setProfileOpen(false)
        profileButton.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [profileOpen])

  function signOut() {
    requestLeave(async () => {
      setSigningOut(true)
      try {
        await logout()
        navigate('/id/login')
      } catch {
        /* Provider displays the request error and keeps the session. */
      } finally {
        setSigningOut(false)
      }
    })
  }

  return (
    <header className="manager-header">
      <div className="manager-header-title">
        <button
          className="manager-icon-button manager-mobile-toggle"
          type="button"
          aria-label={tUi('manager.openMenu')}
          aria-haspopup="dialog"
          aria-expanded={mobileNavOpen}
          aria-controls="manager-mobile-nav"
          onClick={onOpenNavigation}
        >
          <Menu size={20} />
        </button>
      </div>
      <div className="manager-header-actions">
        {searchable && (
          <label className="manager-header-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label={tUi('manager.searchLabel')}
              placeholder={tUi('manager.searchPlaceholder')}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        )}
        <LanguageSwitcher compact />
        <button
          className="manager-icon-button"
          type="button"
          onClick={toggleDarkMode}
          aria-label={isDarkMode ? tUi('manager.switchLight') : tUi('manager.switchDark')}
          title={isDarkMode ? tUi('manager.light') : tUi('manager.dark')}
        >
          {isDarkMode ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <div className="manager-profile" ref={profileRef}>
          <button
            type="button"
            className="manager-profile-trigger"
            ref={profileButton}
            aria-label={tUi('header.accountMenu')}
            aria-expanded={profileOpen}
            aria-controls="manager-profile-menu"
            onClick={() => setProfileOpen(!profileOpen)}
          >
            <span className="manager-avatar">{initials}</span>
            <span className="manager-profile-copy">
              <strong>{user?.name || roleName}</strong>
              <small>{roleName}</small>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {profileOpen && (
            <div id="manager-profile-menu" className="manager-profile-menu">
              <div className="manager-profile-identity">
                <strong>{user?.name}</strong>
                <span>{user?.email}</span>
                <small>{roleName}</small>
              </div>
              <Link to="/manager/profile" onClick={() => setProfileOpen(false)}>
                <UserRound size={17} />
                {tUi('nav.profile')}
              </Link>
              <button type="button" onClick={signOut} disabled={signingOut}>
                <LogOut size={17} />
                {signingOut ? tUi('header.loggingOut') : tUi('header.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
