export const FEATURES = [
  ['DASHBOARD', 'Bảng điều khiển', 'Trial'], ['ROOM_DIAGRAM', 'Sơ đồ phòng', 'Trial'],
  ['RESERVATION_VIEW', 'Xem đặt phòng', 'Trial'], ['RESERVATION_CREATE', 'Tạo đặt phòng', 'Trial'],
  ['TAPE_CHART', 'Timeline đặt phòng', 'Basic'], ['ARI_MANAGEMENT', 'Giá & Phòng trống', 'Basic'],
  ['HOUSEKEEPING', 'Buồng phòng', 'Basic'], ['POS_SALES', 'Dịch vụ & POS', 'Basic'],
  ['CASHBOOK', 'Thu chi', 'Basic'], ['REPORTS_BASIC', 'Báo cáo cơ bản', 'Basic'],
  ['OTA_SYNC', 'Đồng bộ OTA', 'Pro'], ['REPORTS_ADVANCED', 'Báo cáo nâng cao', 'Pro'],
  ['INVENTORY_WAREHOUSE', 'Quản lý kho', 'Pro'], ['MULTI_CURRENCY', 'Đa tiền tệ', 'Pro'],
  ['VOUCHER_PROMO', 'Voucher & Khuyến mãi', 'Pro'], ['API_EXTERNAL', 'API bên ngoài', 'Pro'],
].map(([code, name, minPlan]) => ({ id: code, code, name, minPlan, category: 'Nghiệp vụ PMS', enabledGlobal: true, description: name }));

export const ROLE_NAMES = { HOTEL_OWNER: 'Chủ khách sạn', FRONT_DESK: 'Lễ tân', HOUSEKEEPING: 'Buồng phòng', ACCOUNTANT: 'Kế toán', SUPER_ADMIN: 'Super Admin', SYSTEM_MANAGER: 'System Manager' };
export function routePolicy(path) {
  if (path.startsWith('/manager')) {
    const hotelChannels = /^\/manager\/tenants\/([^/?]+)\/ota(?:-history)?\/?(?:\?|$)/.exec(path);
    if (hotelChannels) {
      let tenantId;
      try { tenantId = decodeURIComponent(hotelChannels[1]); } catch { tenantId = ''; }
      return { manager: true, tenantId, action: 'channels.view', feature: 'OTA_SYNC' };
    }
    return { manager: true, superOnly: /^\/manager\/(logs|users)/.test(path) };
  }
  const [pathname, query = ''] = path.split('?');
  const p = pathname.replace(/^\/id\/?/, '');
  if (/^profile/.test(p)) return { action: 'profile.view' };
  if (/^settings\/?$/.test(p) && new URLSearchParams(query).get('section') === 'channels') return { action: 'channels.view', feature: 'OTA_SYNC' };
  if (/^settings/.test(p)) return { action: 'settings.write' };
  if (/^users/.test(p)) return { action: 'users.write' };
  if (/^reservations/.test(p)) return { action: 'reservations.view', feature: 'RESERVATION_VIEW' };
  if (/^room-diagram|^rooms/.test(p)) return { action: 'rooms.view', feature: 'ROOM_DIAGRAM' };
  if (/^ari/.test(p)) return { action: 'reservations.view', feature: 'TAPE_CHART' };
  if (/^gia\/(vouchers|promotions)/.test(p)) return { action: 'rates.view', feature: 'VOUCHER_PROMO' };
  if (/^gia\/exchange-rates/.test(p)) return { action: 'rates.view', feature: 'MULTI_CURRENCY' };
  if (/^gia|^matrix-rate/.test(p)) return { action: 'rates.view', feature: 'ARI_MANAGEMENT' };
  if (/^housekeeping\/staff/.test(p)) return { action: 'housekeeping.manage', feature: 'HOUSEKEEPING' };
  if (/^housekeeping/.test(p)) return { action: 'housekeeping.view', feature: 'HOUSEKEEPING' };
  if (/^inventory/.test(p)) return { action: 'inventory.view', feature: 'INVENTORY_WAREHOUSE' };
  if (/^sales/.test(p)) return { action: 'pos.view', feature: 'POS_SALES' };
  if (/^cashflow|^commissions/.test(p)) return { action: 'cashbook.view', feature: 'CASHBOOK' };
  if (/^reports\/(source|room|roomType|cancellations|nationality|discounts)(\/|$)/.test(p)) return { action: 'reports.advanced.view', feature: 'REPORTS_ADVANCED' };
  if (/^reports\/reconciliation(\/|$)/.test(p)) return { action: 'reconciliation.view', feature: 'REPORTS_BASIC' };
  if (/^reports/.test(p)) return { action: 'reports.view', feature: 'REPORTS_BASIC' };
  if (/^ota/.test(p)) return { action: 'channels.view', feature: 'OTA_SYNC' };
  return { action: 'dashboard.view', feature: 'DASHBOARD' };
}
