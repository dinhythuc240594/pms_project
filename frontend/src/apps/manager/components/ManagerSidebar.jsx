import { t as tUi, tr as labelUi, useI18n } from '../../../shared/i18n/useI18n.js'
import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Building2,
  Link2,
  CreditCard,
  SlidersHorizontal,
  Users,
  ScrollText,
  UserRound,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react'

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Tổng quan', path: 'dashboard' },
  { icon: Building2, label: 'Khách hàng & khách sạn', path: 'tenants' },
  { icon: Link2, label: 'Channex & Kênh OTA', path: 'channex' },
  { icon: CreditCard, label: 'Gói cước & hóa đơn', path: 'billing' },
  { icon: SlidersHorizontal, label: 'Tính năng', path: 'features' },
  { icon: Users, label: 'Nhân sự nội bộ', path: 'users', superOnly: true },
  { icon: ScrollText, label: 'Nhật ký hệ thống', path: 'logs', superOnly: true },
]

export default function ManagerSidebar({
  isCollapsed = false,
  setIsCollapsed,
  currentRole,
  onClose,
}) {
  useI18n()
  const isSuperAdmin = currentRole === 'SUPER_ADMIN'
  const { pathname } = useLocation()
  const hotelOta = /^\/manager\/tenants\/[^/]+\/ota(?:-history)?\/?$/.test(pathname)
  const collapsed = isCollapsed && !onClose
  return (
    <aside
      className={`manager-sidebar${collapsed ? ' is-collapsed' : ''}`}
      aria-label={tUi('manager.navigation')}
    >
      <div className="manager-brand-row">
        <Link
          to="/manager/dashboard"
          className="manager-brand"
          aria-label={tUi('manager.brandLabel')}
          onClick={onClose}
        >
          <span className="manager-brand-mark" aria-hidden="true">
            L<span />
          </span>
          <span className="manager-brand-copy">
            <strong>LOHA</strong>
            <small>PMS SYSTEM</small>
          </span>
        </Link>
        {onClose && (
          <button
            className="manager-sidebar-icon"
            type="button"
            onClick={onClose}
            aria-label={tUi('nav.closeMenu')}
          >
            <X size={20} />
          </button>
        )}
      </div>
      <div className="manager-sidebar-body">
        <p className="manager-nav-label">{tUi('manager.workspace')}</p>
        <nav className="manager-nav" aria-label={tUi('manager.navigation')}>
          {NAV_ITEMS.filter((item) => !item.superOnly || isSuperAdmin).map(
            ({ icon: Icon, label, path }) =>
              hotelOta && path === 'channex' ? (
                <Link
                  key={path}
                  to="/manager/channex"
                  className="manager-nav-link is-active"
                  aria-current="page"
                  title={collapsed ? labelUi(label) : undefined}
                  aria-label={labelUi(label)}
                  onClick={onClose}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{labelUi(label)}</span>
                </Link>
              ) : (
                <NavLink
                  key={path}
                  to={`/manager/${path}`}
                  end={path === 'tenants'}
                  className={({ isActive }) => `manager-nav-link${isActive ? ' is-active' : ''}`}
                  title={collapsed ? labelUi(label) : undefined}
                  aria-label={labelUi(label)}
                  onClick={onClose}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{labelUi(label)}</span>
                </NavLink>
              ),
          )}
        </nav>
      </div>
      <div className="manager-sidebar-footer">
        <NavLink
          to="/manager/profile"
          className={({ isActive }) => `manager-nav-link${isActive ? ' is-active' : ''}`}
          aria-label={tUi('nav.profile')}
          title={collapsed ? tUi('nav.profile') : undefined}
          onClick={onClose}
        >
          <UserRound size={19} />
          <span>{tUi('nav.profile')}</span>
        </NavLink>
        {!onClose && (
          <button
            type="button"
            className="manager-nav-link manager-collapse"
            onClick={() => setIsCollapsed(!collapsed)}
            aria-label={collapsed ? tUi('nav.expand') : tUi('nav.collapse')}
            aria-expanded={!collapsed}
            title={collapsed ? tUi('nav.expand') : undefined}
          >
            {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            <span>{tUi('nav.collapseMenu')}</span>
          </button>
        )}
      </div>
    </aside>
  )
}
