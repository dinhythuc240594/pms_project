import { t as tUi, tr as labelUi, useI18n } from '../../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AccessLink as Link } from '../../../shared/components/AccessControl';
import LohaBrand from '../../../shared/components/LohaBrand';
import { usePms } from '../data/usePms';
import { ROLE_NAMES } from '../data/access';
import { LayoutDashboard, CalendarCheck, BedDouble, Tags, Database, Settings, ChevronDown, ChevronRight, ClipboardList, Store, Sparkles, Box, BarChart3, PanelLeftClose, PanelLeftOpen, Building2, X } from 'lucide-react';
const navItems = [
  { icon: LayoutDashboard, label: 'Tổng quan', path: '/id/dashboard' },
  { icon: CalendarCheck, label: 'Lịch đặt phòng', path: '/id/ari' },
  { icon: BedDouble, label: 'Sơ đồ phòng', path: '/id/room-diagram' },
  { icon: ClipboardList, label: 'Đặt phòng', path: '/id/reservations' },
  { icon: Store, label: 'Dịch vụ & POS', path: '/id/sales' },
  {
    icon: Database, label: 'Tài chính & thu chi', path: '/id/cashflow',
    subItems: [
      { label: 'Quỹ tiền mặt', path: '/id/cashflow/cash' },
      { label: 'Quỹ tiền gửi', path: '/id/cashflow/bank' }
    ]
  },
  {
    icon: Tags, label: 'Giá & Phòng trống', path: '/id/gia',
    subItems: [
      { label: 'Giá cơ bản', path: '/id/gia/basic' },
      { label: 'Giá nâng cao', path: '/id/gia/advanced' },
      { label: 'Giá & Phòng trống hàng ngày', path: '/id/matrix-rate' },
      { label: 'Vouchers', path: '/id/gia/vouchers' },
      { label: 'Giá cho lịch đặt phòng', path: '/id/gia/ari' },
      { label: 'Khuyến mãi', path: '/id/gia/promotions' },
      { label: 'Tỷ giá', path: '/id/gia/exchange-rates' }
    ]
  },
  {
    icon: Sparkles, label: 'Buồng phòng', path: '/id/housekeeping',
    subItems: [
      { label: 'Buồng phòng', path: '/id/housekeeping/status' },
      { label: 'Nhân viên buồng phòng', path: '/id/housekeeping/staff' },
      { label: 'Kế hoạch dọn phòng', path: '/id/housekeeping/plan' }
    ]
  },
  {
    icon: Box, label: 'Kho hàng', path: '/id/inventory',
    subItems: [
      { label: 'Phiếu nhập kho', path: '/id/inventory/in' },
      { label: 'Phiếu xuất kho', path: '/id/inventory/out' },
      { label: 'Phiếu chuyển kho', path: '/id/inventory/transfer' },
      { label: 'Phiếu kiểm kê', path: '/id/inventory/check' },
      { label: 'Tồn kho & biến động', path: '/id/inventory/stock' }
    ]
  },
  {
    icon: BarChart3, label: 'Báo cáo', path: '/id/reports',
    subItems: [
      { label: 'Báo cáo doanh thu', path: '/id/reports/revenue' },
      { label: 'Hiệu suất phòng', path: '/id/reports/occupancy' },
      { label: 'Báo cáo chuyên sâu', path: '/id/reports/source' },
      { label: 'Đối soát ngày', labelKey: 'reconciliation.title', path: '/id/reports/reconciliation' }
    ]
  },
];

export default function Sidebar({ isCollapsed = false, setIsCollapsed, onClose }) {
  useI18n();
  const { pathname } = useLocation();
  const [expandedMenus, setExpandedMenus] = useState({});
  const { hotels, tenant, selectTenant, role, routeAccess, settingsPath } = usePms();
  const isActive = path => pathname === path || pathname.startsWith(path + '/');
  const collapsed = isCollapsed && !onClose;

  function toggleSubmenu(item) {
    if (collapsed) setIsCollapsed(false);
    setExpandedMenus(previous => ({ ...previous, [item.path]: collapsed || !(previous[item.path] ?? isActive(item.path)) }));
  }

  return (
    <aside className={`pms-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label={tUi("nav.hotelNavigation")}>
      <div className="pms-sidebar-brand"><LohaBrand />{onClose && <button type="button" className="pms-sidebar-close" aria-label={tUi("nav.closeMenu")} onClick={onClose}><X size={20} /></button>}</div>
      <div className="pms-hotel-selector">
        <Building2 size={19} aria-hidden="true" />
        {collapsed ? <button type="button" aria-label={tUi("nav.selectHotel")} title={tenant?.name} onClick={() => setIsCollapsed(false)}><Building2 size={19} /></button> : <div><label htmlFor={onClose ? 'pms-mobile-hotel' : 'pms-desktop-hotel'}>{tUi("nav.selectedHotel")}</label><select id={onClose ? 'pms-mobile-hotel' : 'pms-desktop-hotel'} value={tenant?.id || ''} onChange={event => { selectTenant(event.target.value); onClose?.(); }} disabled={!hotels.length}>{!hotels.length && <option value="">{tUi("nav.noHotel")}</option>}{hotels.map(hotel => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select><small>{labelUi(ROLE_NAMES[role]) || tUi("nav.hotelAccount")}</small></div>}
      </div>
      <nav className="pms-sidebar-nav" aria-label={tUi("nav.pmsOperations")}>
        {!collapsed && <p className="pms-nav-caption">{tUi("nav.hotelOperations")}</p>}
        {navItems.map(item => {
          const active = isActive(item.path) || item.subItems?.some(sub => pathname === sub.path);
          const expanded = expandedMenus[item.path] ?? active;
          const hasAccess = routeAccess(item.path).allowed || item.subItems?.some(sub => routeAccess(sub.path).allowed);
          const Icon = item.icon;
          return <div key={item.path} className="pms-nav-group">
            {item.subItems ? <button type="button" className={`pms-nav-link${active ? ' is-active' : ''}`} aria-label={labelUi(item.label)} aria-expanded={!collapsed && expanded} aria-controls={!collapsed && expanded ? `pms-submenu-${onClose ? 'mobile-' : ''}${item.path.split('/').at(-1)}` : undefined} title={collapsed ? labelUi(item.label) : undefined} onClick={() => toggleSubmenu(item)}><Icon size={19} aria-hidden="true" /><span>{labelUi(item.label)}</span>{!collapsed && (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}{!hasAccess && <span className="pms-nav-lock" aria-label={tUi("nav.locked")}>🔒</span>}</button> : <Link to={item.path} className={`pms-nav-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} aria-label={labelUi(item.label)} title={collapsed ? labelUi(item.label) : undefined} onClick={onClose}><Icon size={19} aria-hidden="true" /><span>{labelUi(item.label)}</span></Link>}
            {item.subItems && expanded && !collapsed && <div className="pms-submenu" id={`pms-submenu-${onClose ? 'mobile-' : ''}${item.path.split('/').at(-1)}`}>{item.subItems.map(sub => <Link key={sub.path} to={sub.path} className={`pms-submenu-link${pathname === sub.path ? ' is-active' : ''}`} aria-current={pathname === sub.path ? 'page' : undefined} onClick={onClose}>{sub.labelKey ? tUi(sub.labelKey) : labelUi(sub.label)}</Link>)}</div>}
          </div>;
        })}
      </nav>
      <div className="pms-sidebar-footer">
        <Link to={settingsPath} className={`pms-nav-link${isActive('/id/settings') ? ' is-active' : ''}`} aria-label={tUi("nav.settings")} title={collapsed ? tUi("nav.settings") : undefined} onClick={onClose}><Settings size={19} /><span>{tUi("nav.settings")}</span></Link>
        {!onClose && <button type="button" className="pms-nav-link pms-collapse-toggle" aria-label={collapsed ? tUi("nav.expand") : tUi("nav.collapse")} title={collapsed ? tUi("nav.expand") : undefined} onClick={() => setIsCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}<span>{tUi("nav.collapseMenu")}</span></button>}
      </div>
    </aside>
  );
}
