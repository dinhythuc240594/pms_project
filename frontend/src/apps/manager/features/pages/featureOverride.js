import { formatDateTime } from '../../../../shared/lib/date.js';
const DAY = 24 * 60 * 60 * 1000;

export function featureOverridePayload({ overrideType, notes }, now = Date.now()) {
  const isTrial = overrideType === 'TRIAL';
  return {
    enabled: overrideType !== 'FORCE_DISABLE',
    isTrial,
    expiresAt: isTrial ? new Date(now + 30 * DAY).toISOString() : null,
    notes: notes.trim(),
  };
}

export function overrideExpiry(expiresAt, now = Date.now()) {
  const expires = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(expires)
    ? { daysRemaining: Math.max(0, Math.ceil((expires - now) / DAY)), expired: expires <= now }
    : { daysRemaining: null, expired: false };
}

export function displayDate(value) {
  return value && Number.isFinite(Date.parse(value)) ? formatDateTime(value).slice(0, 10) : '—';
}
