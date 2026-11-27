import { t as tUi, tr as labelUi, useI18n } from '../../../shared/i18n/useI18n.js'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AccessLink as Link } from '../../../shared/components/AccessControl'
import LohaBrand from '../../../shared/components/LohaBrand'
import { usePms } from '../data/usePms'
import { hiddenByRole, navForRole } from '../data/roleProfiles'
import { isReportPath, readReportPeriod } from '../reports/pages/reportPeriod.js'
import {
  LayoutDashboard,
  CalendarCheck,
  BedDouble,
  Tags,
  Globe,
  Settings,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ListChecks,
  Wallet,
  Store,
  Sparkles,
  Box,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react'
const reconciliationNav = {
  labelKey: 'reconciliation.title',
  path: '/id/reports/reconciliation',
}
const navItems = [
  {
    icon: Globe,
    label: 'Marketing',
    path: '/id/marketing',
    subItems: [
      { label: 'Trang giới thiệu', path: '/id/marketing/pages' },
      { label: 'Hồ sơ thương hiệu', path: '/id/marketing/brand' },
    ],
  },
  { icon: LayoutDashboard, label: 'Tổng quan', path: '/id/dashboard' },
  { icon: CalendarCheck, label: 'Lịch đặt phòng', path: '/id/ari' },
  { icon: BedDouble, label: 'Sơ đồ phòng', path: '/id/room-diagram' },
  { icon: ClipboardList, label: 'Đặt phòng', path: '/id/reservations' },
  { icon: Store, label: 'Dịch vụ & POS', path: '/id/sales' },
  {
    icon: Tags,
    label: 'Giá & Phòng trống',
    path: '/id/gia',
    subItems: [
      { label: 'Giá cơ bản', path: '/id/gia/basic' },
      { label: 'Giá nâng cao', path: '/id/gia/advanced' },
      { label: 'Giá & Phòng trống hàng ngày', path: '/id/matrix-rate' },
      { label: 'Giá cho lịch đặt phòng', path: '/id/gia/ari' },
      // { label: 'Khuyến mãi', path: '/id/gia/promotions' },
      // { label: 'Tỷ giá', path: '/id/gia/exchange-rates' }
    ],
  },
  {
    icon: Sparkles,
    label: 'Buồng phòng',
    path: '/id/housekeeping',
    subItems: [
      { label: 'Buồng phòng', path: '/id/housekeeping/status' },
      { label: 'Nhân viên buồng phòng', path: '/id/housekeeping/staff' },
      { label: 'Kế hoạch dọn phòng', path: '/id/housekeeping/plan' },
    ],
  },
  {
    icon: Box,
    label: 'Kho hàng',
    path: '/id/inventory',
    subItems: [
      { label: 'Phiếu nhập kho', path: '/id/inventory/in' },
      { label: 'Phiếu xuất kho', path: '/id/inventory/out' },
      { label: 'Phiếu chuyển kho', path: '/id/inventory/transfer' },
      { label: 'Phiếu kiểm kê', path: '/id/inventory/check' },
      { label: 'Tồn kho & biến động', path: '/id/inventory/stock' },
    ],
  },
  {
    icon: BarChart3,
    label: 'Báo cáo',
    path: '/id/reports',
    subItems: [
      { label: 'Báo cáo doanh thu', path: '/id/reports/revenue' },
      { label: 'Hiệu suất phòng', path: '/id/reports/occupancy' },
      { label: 'Báo cáo chuyên sâu', path: '/id/reports/source' },
      reconciliationNav,
    ],
  },
]
const accountantNavItems = [
  { icon: Wallet, labelKey: 'roleDashboard.cashflow', path: '/id/cashflow' },
  { icon: ListChecks, ...reconciliationNav },
  ...navItems.map((item) =>
    item.path === '/id/reports'
      ? { ...item, subItems: item.subItems.filter((sub) => sub !== reconciliationNav) }
      : item,
  ),
]

export default function Sidebar({ isCollapsed = false, setIsCollapsed, onClose }) {
  useI18n()
  const { pathname, search } = useLocation()
  const [expandedMenus, setExpandedMenus] = useState({})
  const pms = usePms()
  const { routeAccess, settingsPath, role } = pms
  const items = navForRole(role === 'ACCOUNTANT' ? accountantNavItems : navItems, role, routeAccess)
  const showSettings = !hiddenByRole(routeAccess(settingsPath))
  const isActive = (path) => pathname === path || pathname.startsWith(path + '/')
  const accountantReconciliation = role === 'ACCOUNTANT' && isActive(reconciliationNav.path)
  const collapsed = isCollapsed && !onClose
  function destination(path) {
    if (isReportPath(pathname) && isReportPath(path)) {
      const period = readReportPeriod(search, pms.settings?.timezone)
      const params = new URLSearchParams(search)
      for (const key of ['booking', 'tab', 'date']) params.delete(key)
      params.set('start', period.start)
      params.set('end', period.end)
      if (!period.valid) params.set('period_invalid', '1')
      return { to: path + '?' + params, disabled: !period.valid }
    }
    return { to: path, disabled: false }
  }
  function follow(event, disabled) {
    if (disabled) event.preventDefault()
    else onClose?.()
  }

  function toggleSubmenu(item) {
    if (collapsed) setIsCollapsed(false)
    setExpandedMenus((previous) => ({
      ...previous,
      [item.path]: collapsed || !(previous[item.path] ?? isActive(item.path)),
    }))
  }

  return (
    <aside
      className={`pms-sidebar${collapsed ? ' is-collapsed' : ''}`}
      aria-label={tUi('nav.hotelNavigation')}
    >
      <div className="pms-sidebar-brand">
        <LohaBrand />
        {onClose && (
          <button
            type="button"
            className="pms-sidebar-close"
            aria-label={tUi('nav.closeMenu')}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        )}
      </div>
      <nav className="pms-sidebar-nav" aria-label={tUi('nav.pmsOperations')}>
        {!collapsed && <p className="pms-nav-caption">{tUi('nav.hotelOperations')}</p>}
        {items.map((item) => {
          const active =
            (item.path !== '/id/reports' || !accountantReconciliation) &&
            (isActive(item.path) || item.subItems?.some((sub) => pathname === sub.path))
          const expanded = expandedMenus[item.path] ?? active
          const hasAccess =
            routeAccess(item.path).allowed ||
            item.subItems?.some((sub) => routeAccess(sub.path).allowed)
          const Icon = item.icon
          const label = item.labelKey ? tUi(item.labelKey) : labelUi(item.label)
          return (
            <div key={item.path} className="pms-nav-group">
              {item.subItems ? (
                <button
                  type="button"
                  className={`pms-nav-link${active ? ' is-active' : ''}`}
                  aria-label={label}
                  aria-expanded={!collapsed && expanded}
                  aria-controls={
                    !collapsed && expanded
                      ? `pms-submenu-${onClose ? 'mobile-' : ''}${item.path.split('/').at(-1)}`
                      : undefined
                  }
                  title={collapsed ? label : undefined}
                  onClick={() => toggleSubmenu(item)}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{label}</span>
                  {!collapsed &&
                    (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
                  {!hasAccess && (
                    <span className="pms-nav-lock" aria-label={tUi('nav.locked')}>
                      🔒
                    </span>
                  )}
                </button>
              ) : (
                <Link
                  to={item.path}
                  className={`pms-nav-link${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  aria-label={label}
                  title={collapsed ? label : undefined}
                  onClick={onClose}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              )}
              {item.subItems && expanded && !collapsed && (
                <div
                  className="pms-submenu"
                  id={`pms-submenu-${onClose ? 'mobile-' : ''}${item.path.split('/').at(-1)}`}
                >
                  {item.subItems.map((sub) => {
                    const next = destination(sub.path)
                    return (
                      <Link
                        key={sub.path}
                        to={next.to}
                        className={`pms-submenu-link${pathname === sub.path ? ' is-active' : ''}`}
                        aria-current={pathname === sub.path ? 'page' : undefined}
                        aria-disabled={next.disabled || undefined}
                        title={
                          next.disabled
                            ? labelUi('Hoàn tất khoảng ngày hợp lệ trước khi chuyển màn.')
                            : undefined
                        }
                        onClick={(event) => follow(event, next.disabled)}
                      >
                        {sub.labelKey ? tUi(sub.labelKey) : labelUi(sub.label)}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <div className="pms-sidebar-footer">
        {showSettings && (
          <Link
            to={settingsPath}
            className={`pms-nav-link${isActive('/id/settings') ? ' is-active' : ''}`}
            aria-label={tUi('nav.settings')}
            title={collapsed ? tUi('nav.settings') : undefined}
            onClick={onClose}
          >
            <Settings size={19} />
            <span>{tUi('nav.settings')}</span>
          </Link>
        )}
        {!onClose && (
          <button
            type="button"
            className="pms-nav-link pms-collapse-toggle"
            aria-label={collapsed ? tUi('nav.expand') : tUi('nav.collapse')}
            title={collapsed ? tUi('nav.expand') : undefined}
            onClick={() => setIsCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            <span>{tUi('nav.collapseMenu')}</span>
          </button>
        )}
      </div>
    </aside>
  )
}
