// Giao diện theo vai trò: trang chủ và thứ tự menu của từng role trong khách sạn.
// Quyền thực sự vẫn do backend (ROLE_ACTIONS) và `permitted()` quyết định;
// file này chỉ điều chỉnh phần hiển thị.

export const ROLE_PROFILES = {
  HOTEL_OWNER: { home: '/id/dashboard', pinned: [] },
  FRONT_DESK: {
    home: '/id/room-diagram',
    pinned: ['/id/room-diagram', '/id/ari', '/id/reservations'],
  },
  HOUSEKEEPING: { home: '/id/housekeeping/status', pinned: ['/id/housekeeping'] },
  ACCOUNTANT: { home: '/id/cashflow', pinned: [] },
}

export const DEFAULT_HOME = '/id/dashboard'

// Bố cục dashboard theo vai trò. Dữ liệu vẫn lấy từ /reports/dashboard; backend tự
// bỏ số liệu tài chính với role không có quyền báo cáo.
const ALL_TASKS = ['dirty', 'inspection', 'overdue', 'arrivals']
const OWNER_DASHBOARD = {
  titleKey: 'dashboard.today',
  metrics: ['arrivals', 'departures', 'occupied', 'occupancy'],
  highlight: 'occupancy',
  order: ['queues', 'overview'],
  queues: ['arrivals', 'departures'],
  overview: ['chart', 'tasks'],
  tasks: ALL_TASKS,
}
export const DASHBOARD_LAYOUTS = {
  HOTEL_OWNER: OWNER_DASHBOARD,
  FRONT_DESK: {
    titleKey: 'roleDashboard.frontDeskTitle',
    metrics: ['arrivals', 'departures', 'occupied', 'overdue'],
    highlight: 'arrivals',
    order: ['queues', 'overview'],
    queues: ['arrivals', 'departures'],
    overview: ['tasks'],
    tasks: ALL_TASKS,
  },
  ACCOUNTANT: {
    titleKey: 'roleDashboard.accountantTitle',
    metrics: ['revenue', 'balanceDue', 'departures', 'occupancy'],
    highlight: 'revenue',
    order: ['overview', 'queues'],
    queues: ['departures'],
    overview: ['chart', 'shortcuts'],
    tasks: [],
  },
}

export function dashboardLayout(role) {
  return DASHBOARD_LAYOUTS[role] || OWNER_DASHBOARD
}

export const ACCOUNTANT_SHORTCUTS = [
  { labelKey: 'roleDashboard.cashflow', path: '/id/cashflow' },
  { labelKey: 'roleDashboard.reconciliation', path: '/id/reports/reconciliation' },
  { labelKey: 'roleDashboard.revenueReport', path: '/id/reports/revenue' },
  { labelKey: 'roleDashboard.sales', path: '/id/sales' },
  { labelKey: 'roleDashboard.commissions', path: '/id/commissions' },
]

export function visibleShortcuts(routeAccess, shortcuts = ACCOUNTANT_SHORTCUTS) {
  return shortcuts.filter((item) => !hiddenByRole(routeAccess(item.path)))
}

// Số liệu tài chính cho dashboard kế toán; trả null khi backend không gửi tài chính.
export function financeSummary(data) {
  if (!data?.financial) return null
  const today = data.chart?.find((row) => row.date === data.date) || data.chart?.at(-1)
  // Chỉ cộng các đặt phòng cùng tiền tệ báo cáo để không trộn VND với USD.
  const due = [...(data.arrivalBookings || []), ...(data.departureBookings || [])]
    .filter((booking) => !booking.currency || booking.currency === data.currency)
    .reduce((sum, booking) => sum + Math.max(0, Number(booking.balance) || 0), 0)
  return { revenue: Number(today?.realizedRevenue || 0), balanceDue: due }
}

export function homePath(role) {
  return ROLE_PROFILES[role]?.home || DEFAULT_HOME
}

// Chỉ ẩn khi bị chặn vì vai trò; mục bị khóa vì gói dịch vụ (feature/expired)
// vẫn hiện kèm ổ khóa để chủ khách sạn biết có thể nâng cấp.
const HIDDEN_REASONS = new Set(['role', 'tenant'])

export function hiddenByRole(decision) {
  return !decision?.allowed && HIDDEN_REASONS.has(decision?.reason)
}

// Lọc menu theo quyền của role và đưa các mục ưu tiên của role lên đầu.
export function navForRole(items, role, routeAccess) {
  const visible = items
    .map((item) => {
      if (!item.subItems) return hiddenByRole(routeAccess(item.path)) ? null : item
      const subItems = item.subItems.filter((sub) => !hiddenByRole(routeAccess(sub.path)))
      return subItems.length ? { ...item, subItems } : null
    })
    .filter(Boolean)
  const pinned = ROLE_PROFILES[role]?.pinned || []
  const rank = (item) => {
    const index = pinned.indexOf(item.path)
    return index === -1 ? pinned.length : index
  }
  return visible
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item)
}
