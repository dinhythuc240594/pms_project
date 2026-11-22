import { t } from '../../../../shared/i18n/store.js';
import { formatDate, formatDateTime } from '../../../../shared/lib/date.js';

export function billingDate(value, timezone = 'Asia/Ho_Chi_Minh', includeTime = true) {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  const formatted = formatDateTime(value, timezone);
  return includeTime ? formatted : formatted.slice(0, 10);
}

const invoiceStatuses = new Set(['unpaid', 'partial', 'paid', 'void']);
const subscriptionStatuses = new Set(['active', 'expired', 'cancelled', 'inactive', 'future', 'unassigned']);
const historyActions = new Set(['created', 'changed_plan', 'renewed', 'updated', 'changed_status']);

export function invoiceStatusLabel(status) {
  return invoiceStatuses.has(status) ? t(`billing.invoiceStatus.${status}`) : status || '—';
}

export function subscriptionStatusLabel(subscription) {
  const status = subscription?.blockedReason || subscription?.status || 'unassigned';
  return subscriptionStatuses.has(status) ? t(`billing.subscriptionStatus.${status}`) : status;
}

export function historyActionLabel(action) {
  return historyActions.has(action) ? t(`billing.historyAction.${action}`) : action || '—';
}

export function paymentMethodLabel(method) {
  return ['bank', 'cash'].includes(method) ? t(`billing.paymentMethod.${method}`) : method || '—';
}
