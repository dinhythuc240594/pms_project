import test from 'node:test'
import assert from 'node:assert/strict'
import { notificationTarget, validEntityId } from './notificationTargets.js'

const allowed = () => ({ allowed: true })
const scope = (overrides = {}) => ({
  tenantId: 'hotel-a',
  bookings: [{ id: 'BK-1' }, { id: 'BK 2/&?' }],
  rooms: [
    { id: 'room-a', name: '101' },
    { id: 'room-b', name: '101' },
    { id: '101', name: 'Suite' },
    { id: 'phòng-đẹp', name: 'Đẹp' },
    { id: 'old', name: '102', active: false },
  ],
  access: allowed,
  ...overrides,
})
const item = (entityType, entityId, eventCode = 'NEW_BOOKING', extra = {}) => ({
  id: 'n1',
  entityType,
  entityId,
  eventCode,
  ...extra,
})

test('reservation targets use the exact loaded booking and route payments separately', () => {
  assert.deepEqual(notificationTarget(item('reservation', 'BK-1'), scope()), {
    status: 'ready',
    kind: 'reservation',
    path: '/id/reservations?booking=BK-1',
  })
  assert.deepEqual(notificationTarget(item('reservation', 'BK-1', 'PAYMENT_RECEIVED'), scope()), {
    status: 'ready',
    kind: 'reservation',
    path: '/id/reservations?booking=BK-1&tab=payments',
  })
  const encoded = notificationTarget(item('reservation', 'BK 2/&?', 'BOOKING_CANCELLED'), scope())
  assert.equal(new URL(encoded.path, 'http://x').searchParams.get('booking'), 'BK 2/&?')
  assert.equal(notificationTarget(item('reservation', 'bk-1'), scope()).reason, 'missing')
})

test('room targets require the exact active room ID and encode Unicode without guessing names', () => {
  assert.equal(
    notificationTarget(item('room', 'room-b', 'ROOM_CLEANED'), scope()).path,
    '/id/housekeeping/status?room=room-b',
  )
  assert.equal(
    notificationTarget(item('room', '101', 'ROOM_CLEANED'), scope()).path,
    '/id/housekeeping/status?room=101',
  )
  const unicode = notificationTarget(item('room', 'phòng-đẹp', 'ROOM_MAINTENANCE'), scope())
  assert.equal(new URL(unicode.path, 'http://x').searchParams.get('room'), 'phòng-đẹp')
  assert.equal(notificationTarget(item('room', 'Suite', 'ROOM_CLEANED'), scope()).reason, 'missing')
  assert.equal(
    notificationTarget(item('room', ' room-a', 'ROOM_CLEANED'), scope()).reason,
    'missing',
  )
  assert.equal(notificationTarget(item('room', 'old', 'ROOM_CLEANED'), scope()).reason, 'missing')
})

test('IDs must be well-formed strings of valid length without control characters', () => {
  assert.equal(validEntityId('a'.repeat(64), 64), true)
  assert.equal(validEntityId('ở'.repeat(64), 64), true)
  assert.equal(validEntityId('a'.repeat(65), 64), false)
  assert.equal(validEntityId('', 64), false)
  assert.equal(validEntityId('room\n1', 64), false)
  assert.equal(validEntityId('\ud800', 64), false)
  assert.equal(validEntityId(101, 64), false)
  assert.equal(
    notificationTarget(item('room', 'a'.repeat(65), 'ROOM_CLEANED'), scope()).reason,
    'invalid',
  )
  assert.equal(notificationTarget(item('reservation', { id: 'BK-1' }), scope()).reason, 'invalid')
})

test('unsupported, unknown and untargeted items never get invented routes', () => {
  for (const type of ['pos_invoice', 'channel_incident', 'channel_job'])
    assert.deepEqual(notificationTarget(item(type, 'X-1'), scope()), {
      status: 'unavailable',
      kind: type,
      reason: 'unsupported',
    })
  assert.equal(notificationTarget(item(undefined, 'BK-1'), scope()), null)
  assert.equal(notificationTarget(item('folio', 'BK-1'), scope()), null)
  assert.equal(
    notificationTarget(item('reservation', 'BK-1', 'OTA_SYNC_ERROR'), scope()).reason,
    'unsupported',
  )
})

test('permission and explicit tenant conflicts are rejected before record lookup', () => {
  const calls = []
  const denied = (action, feature) => {
    calls.push([action, feature])
    return { allowed: false, message: 'Gói hiện tại chưa có tính năng này.' }
  }
  assert.deepEqual(notificationTarget(item('reservation', 'BK-1'), scope({ access: denied })), {
    status: 'unavailable',
    kind: 'reservation',
    reason: 'permission',
    message: 'Gói hiện tại chưa có tính năng này.',
  })
  assert.equal(
    notificationTarget(item('room', 'room-a', 'ROOM_CLEANED'), scope({ access: denied })).reason,
    'permission',
  )
  assert.deepEqual(calls, [
    ['reservations.view', 'RESERVATION_VIEW'],
    ['housekeeping.view', 'HOUSEKEEPING'],
  ])
  assert.equal(
    notificationTarget(item('reservation', 'unknown-id'), scope({ access: denied })).reason,
    'permission',
  )
  assert.equal(
    notificationTarget(item('reservation', 'BK-1', 'NEW_BOOKING', { tenantId: 'hotel-b' }), scope())
      .reason,
    'tenant',
  )
  assert.equal(
    notificationTarget(item('reservation', 'BK-1', 'NEW_BOOKING', { tenantId: 'hotel-a' }), scope())
      .status,
    'ready',
  )
  assert.equal(
    notificationTarget(item('reservation', 'BK-1', 'NEW_BOOKING', { tenantId: null }), scope())
      .status,
    'ready',
  )
})
