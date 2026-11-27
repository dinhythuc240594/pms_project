// Resolve a notification to a typed, tenant-local route. Only explicit entity
// types are routed; the event code alone never implies a record.
const BOOKING_EVENTS = new Set([
  'NEW_BOOKING',
  'BOOKING_MODIFIED',
  'BOOKING_CANCELLED',
  'CHECKIN_DONE',
  'CHECKOUT_DONE',
  'PAYMENT_RECEIVED',
])
const KNOWN_UNROUTED = new Set(['pos_invoice', 'channel_incident', 'channel_job'])
const LIMITS = { reservation: 128, room: 64 }
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

export function validEntityId(id, max) {
  if (typeof id !== 'string' || CONTROL.test(id)) return false
  if (typeof id.isWellFormed === 'function' && !id.isWellFormed()) return false
  const length = Array.from(id).length
  return length >= 1 && length <= max
}

const unavailable = (kind, reason, message) => ({
  status: 'unavailable',
  kind,
  reason,
  ...(message ? { message } : {}),
})

// Returns null for untargeted/unknown legacy items (no action, no reason),
// { status: 'ready', kind, path } or { status: 'unavailable', kind, reason }.
export function notificationTarget(item, { tenantId, bookings = [], rooms = [], access }) {
  const type = item?.entityType
  if (KNOWN_UNROUTED.has(type)) return unavailable(type, 'unsupported')
  if (type !== 'reservation' && type !== 'room') return null
  if (type === 'reservation' && !BOOKING_EVENTS.has(item.eventCode))
    return unavailable(type, 'unsupported')
  const id = item.entityId
  if (!validEntityId(id, LIMITS[type])) return unavailable(type, 'invalid')
  if (item.tenantId != null && item.tenantId !== tenantId) return unavailable(type, 'tenant')
  const permission =
    type === 'reservation'
      ? access('reservations.view', 'RESERVATION_VIEW', false)
      : access('housekeeping.view', 'HOUSEKEEPING', false)
  if (!permission?.allowed) return unavailable(type, 'permission', permission?.message)
  if (type === 'reservation') {
    if (!bookings.some((booking) => booking.id === id)) return unavailable(type, 'missing')
    const params = new URLSearchParams({ booking: id })
    if (item.eventCode === 'PAYMENT_RECEIVED') params.set('tab', 'payments')
    return { status: 'ready', kind: type, path: '/id/reservations?' + params }
  }
  if (!rooms.some((room) => room.id === id && room.active !== false))
    return unavailable(type, 'missing')
  return {
    status: 'ready',
    kind: type,
    path: '/id/housekeeping/status?' + new URLSearchParams({ room: id }),
  }
}
