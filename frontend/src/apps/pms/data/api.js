import { getLocale } from '../../../shared/i18n/store.js';
import { translateApiMessage } from '../../../shared/i18n/core.js';

export function localizeApiPayload(value, locale = getLocale()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.$i18n === 'string') return value;
  // Keep descriptors reactive and all business fields opaque, including nested
  // fields named "message". Only these response envelopes contain legacy copy.
  const message = item => typeof item === 'string' && !item.startsWith('i18n:') ? translateApiMessage(locale, item) : item;
  const result = { ...value };
  if (Object.hasOwn(value, 'message')) result.message = message(value.message);
  if (value.error && typeof value.error === 'object' && !Array.isArray(value.error) && Object.hasOwn(value.error, 'message')) {
    result.error = { ...value.error, message: message(value.error.message) };
  }
  return result;
}

export const CORE_ROLES = {
  HOTEL_OWNER: ['*'],
  FRONT_DESK: ['profile.view', 'dashboard.view', 'reservations.view', 'reservations.write', 'rooms.view', 'housekeeping.view', 'housekeeping.write', 'rates.view', 'guests.view', 'guests.write', 'payments.write', 'cashbook.view', 'pos.view', 'pos.write', 'housekeeping.manage', 'channels.view', 'notifications.view'],
  HOUSEKEEPING: ['profile.view', 'rooms.view', 'housekeeping.view', 'housekeeping.write', 'notifications.view'],
  ACCOUNTANT: ['profile.view', 'dashboard.view', 'reservations.view', 'guests.view', 'cashbook.view', 'reports.view', 'reports.advanced.view', 'rates.view', 'payments.write', 'cashbook.write', 'pos.view', 'pos.write', 'finance.adjust', 'pos.cancel', 'cashbook.reverse', 'inventory.view', 'inventory.write', 'notifications.view'],
};
export const systemUser = user => ['SYSTEM_MANAGER', 'SUPER_ADMIN'].includes(user?.globalRole);
export function tenantRole(user, id) {
  return user?.memberships?.find(m => m.tenantId === id && m.active !== false)?.role;
}
export function channelSupportDecision(user, tenant, action = 'channels.view', write = false) {
  if (!user || user.active === false) return { allowed: false, reason: 'session', message: 'Vui lòng đăng nhập lại (401).' };
  if (!systemUser(user) || !['channels.view', 'channels.write'].includes(action)) return { allowed: false, reason: 'role', message: 'Bạn không có quyền quản trị phần này (403).' };
  if (write && tenant?.status?.toUpperCase() !== 'ACTIVE') return { allowed: false, reason: 'suspended', message: 'Khách sạn đang tạm ngưng. Dữ liệu chỉ được xem.' };
  return { allowed: true };
}
export function permitted(user, tenant, action, write = false) {
  action = ({ 'reservations.checkout': 'reservations.write', 'housekeeping.complete': 'housekeeping.write' })[action] || action;
  if (!user || user.active === false) return { allowed: false, reason: 'session', message: 'Vui lòng đăng nhập lại (401).' };
  if (!tenant || !tenantRole(user, tenant.id)) return { allowed: false, reason: 'tenant', message: 'Bạn không có quyền vào khách sạn này (403).' };
  if (action === 'users.write' && systemUser(user)) return { allowed: false, reason: 'role', message: 'Chỉ chủ khách sạn có tài khoản khách hàng được cấp hoặc thu hồi quyền truy cập (403).' };
  if (tenant.status?.toUpperCase() !== 'ACTIVE' && (write || !action.endsWith('.view'))) return { allowed: false, reason: 'suspended', message: 'Khách sạn đang tạm ngưng. Dữ liệu chỉ được xem.' };
  if (!CORE_ROLES[tenantRole(user, tenant.id)]?.some(a => a === '*' || a === action)) return { allowed: false, reason: 'role', message: 'Vai trò của bạn không được phép thực hiện thao tác này (403).' };
  return { allowed: true };
}
export const ACTION_FEATURES = {
  'reservations.checkout': 'RESERVATION_VIEW', 'housekeeping.complete': 'HOUSEKEEPING',
  'dashboard.view': 'DASHBOARD', 'reservations.view': 'RESERVATION_VIEW', 'reservations.write': 'RESERVATION_CREATE',
  'rooms.view': 'ROOM_DIAGRAM', 'housekeeping.view': 'HOUSEKEEPING', 'housekeeping.write': 'HOUSEKEEPING', 'housekeeping.manage': 'HOUSEKEEPING',
  'cashbook.view': 'CASHBOOK', 'cashbook.write': 'CASHBOOK', 'cashbook.reverse': 'CASHBOOK', 'payments.write': 'CASHBOOK', 'finance.adjust': 'CASHBOOK',
  'rates.view': 'ARI_MANAGEMENT', 'reports.view': 'REPORTS_BASIC', 'reports.advanced.view': 'REPORTS_ADVANCED', 'pos.view': 'POS_SALES', 'pos.write': 'POS_SALES', 'pos.cancel': 'POS_SALES',
  'inventory.view': 'INVENTORY_WAREHOUSE', 'inventory.write': 'INVENTORY_WAREHOUSE',
  'channels.view': 'OTA_SYNC', 'channels.write': 'OTA_SYNC',
};
export function subscriptionDecision(subscription, features, action, feature = ACTION_FEATURES[action], write = !action.endsWith('.view'), now = Date.now()) {
  const configured = subscription?.effectiveFeatures || subscription?.planFeatures || features || {};
  if (feature && configured[feature] === false) return { allowed: false, reason: 'feature', message: 'Tính năng này đang tắt tại khách sạn. Vui lòng liên hệ quản trị viên.' };
  if (!subscription) return { allowed: true };
  const inactive = subscription.effectiveActive === false || subscription.status !== 'active'
    || (subscription.startDate && Date.parse(subscription.startDate) > now)
    || (subscription.endDate && Date.parse(subscription.endDate) <= now);
  const temporary = subscription.blockedReason === 'expired' && subscription.operationalAccess?.active === true
    && Date.parse(subscription.operationalAccess.until) > now;
  const completion = temporary && ['payments.write', 'finance.adjust', 'reservations.checkout', 'housekeeping.complete'].includes(action);
  if (write && inactive && !completion) return { allowed: false, reason: 'expired', message: temporary
    ? 'Quyền vận hành tạm chỉ cho hoàn tất nghiệp vụ hiện có. Thao tác này cần gia hạn gói.'
    : 'Gói chưa hoạt động hoặc đã hết hạn. Dữ liệu hiện chỉ được xem; vui lòng liên hệ gia hạn.' };
  return { allowed: true };
}
export function createRequestScope() {
  let generation = 0;
  let tenantId = null;
  return {
    select(id) { tenantId = id; return { tenantId, generation: ++generation }; },
    current() { return { tenantId, generation }; },
    isCurrent(value) { return value.tenantId === tenantId && value.generation === generation; },
  };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function createIntentJournal(storage) {
  const storageKey = 'bluejay-pms-pending-intents-v1';
  let pending = {};
  let persistenceFailed = false;
  const reload = () => {
    if (!storage?.getItem || persistenceFailed) return;
    try {
      const saved = JSON.parse(storage.getItem(storageKey) || '{}');
      pending = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch { /* An inaccessible storage still permits in-memory retries. */ }
  };
  reload();
  const keyOf = value => typeof value === 'string' ? value : value?.key;
  const save = () => { try { storage?.setItem(storageKey, JSON.stringify(pending)); } catch { persistenceFailed = true; /* Retain the in-memory intent. */ } };
  return {
    async acquire(path, body, suggested = crypto.randomUUID(), actor = '') {
      const payload = path + JSON.stringify(canonical(body));
      const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const fingerprint = await hash((actor ? actor + '\u0000' : '') + payload);
      const legacy = actor ? await hash(payload) : null;
      // Other forms can hold another journal over this same session storage.
      reload();
      // Keep unknown pre-upgrade money results on their original key until reconciled.
      if (actor) {
        if (keyOf(pending[legacy])) return { fingerprint: legacy, key: keyOf(pending[legacy]), path, actor };
      }
      if (!keyOf(pending[fingerprint])) { pending[fingerprint] = suggested; save(); }
      return { fingerprint, key: keyOf(pending[fingerprint]), path, actor };
    },
    acknowledge(intent, resultId) {
      reload();
      if (keyOf(pending[intent.fingerprint]) !== intent.key) return;
      pending[intent.fingerprint] = { key: intent.key, path: intent.path, actor: intent.actor || '', resultId: resultId || null, committedAt: new Date().toISOString() };
      save();
    },
    acknowledged(prefix, actor = '') {
      reload();
      return Object.entries(pending)
        .filter(([, value]) => value?.committedAt && value.path?.startsWith(prefix) && value.actor === actor)
        .map(([fingerprint, value]) => ({ fingerprint, ...value }));
    },
    confirm(intent) { reload(); if (keyOf(pending[intent.fingerprint]) === intent.key) { delete pending[intent.fingerprint]; save(); } },
  };
}
export function createApiClient(fetcher = globalThis.fetch, baseUrl = import.meta.env?.VITE_API_BASE_URL || '', onPendingChange) {
  let csrfToken = null;
  const pending = { reads: 0, writes: 0 };
  return {
    setCsrf(token) { csrfToken = token; },
    async request(url, { method = 'GET', body, signal, intent, quiet = false, readOnly = false } = {}) {
      const kind = readOnly || method === 'GET' ? 'reads' : 'writes';
      if (!quiet) pending[kind] += 1;
      try {
        if (!quiet) onPendingChange?.({ ...pending });
        const headers = { Accept: 'application/json', 'Accept-Language': getLocale() };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (!['GET', 'HEAD'].includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
        if (intent) headers['Idempotency-Key'] = intent;
        const response = await fetcher(baseUrl.replace(/\/$/, '') + url, { method, credentials: 'include', headers, signal, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        const payload = response.status === 204 ? null : await response.json().catch(() => null);
        const data = localizeApiPayload(payload);
        if (!response.ok) {
          const error = new Error(translateApiMessage(getLocale(), data?.error?.message) || translateApiMessage(getLocale(), `Yêu cầu thất bại (${response.status}).`));
          Object.assign(error, { status: response.status, code: data?.error?.code, details: data?.error?.details });
          throw error;
        }
        return data;
      } finally {
        if (!quiet) { pending[kind] -= 1; onPendingChange?.({ ...pending }); }
      }
    },
  };
}
