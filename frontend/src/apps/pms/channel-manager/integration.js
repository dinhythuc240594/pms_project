import { parseIsoDate } from '../../../shared/lib/date.js';

export const INTEGRATION_TABS = ['overview', 'connection', 'channels', 'history'];

export function channelCompletionAccess(pms, decision) {
  const grant = pms.subscription?.operationalAccess;
  return decision.allowed || (decision.reason === 'expired' && grant?.active === true && Date.parse(grant.until) > Date.now());
}

export function integrationTab(value) {
  return INTEGRATION_TABS.includes(value) ? value : 'overview';
}

export function integrationState(snapshot = {}) {
  const { connection, roomTypes = [], mappings = [], jobs = [], bookingReviewCount = 0 } = snapshot;
  const connected = Boolean(connection?.credentialsConfigured && connection?.verifiedAt);
  const mapped = roomTypes.filter(room => mappings.some(mapping => mapping.roomTypeId === room.id && mapping.active && !mapping.pauseRequested)).length;
  const latest = jobs.find(job => ['push_ari', 'pull_bookings'].includes(job.kind));
  const pending = jobs.filter(job => ['queued', 'processing'].includes(job.status));
  const failed = jobs.filter(job => job.status === 'failed');
  const ready = connected && connection.active && mapped > 0 && Boolean(connection.inventoryReconciledAt);
  const next = !connected || !connection?.active || !mapped || !connection.inventoryReconciledAt ? 'connection' : 'channels';
  return { connected, mapped, total: roomTypes.length, ready, latest, pending, failed, bookingReviewCount, next };
}

export function syncRangeError(start, end) {
  const days = (parseIsoDate(end) - parseIsoDate(start)) / 86400000;
  if (!Number.isFinite(days)) return 'Chọn ngày bắt đầu và ngày kết thúc hợp lệ.';
  if (days <= 0) return 'Ngày kết thúc phải sau ngày bắt đầu.';
  if (days > 31) return 'Mỗi lần chỉ gửi tối đa 31 ngày. Hãy chọn khoảng ngắn hơn.';
  return '';
}
