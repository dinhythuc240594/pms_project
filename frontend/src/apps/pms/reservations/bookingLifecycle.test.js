import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInBlockReason } from './bookingLifecycle.js';

const stay = { id: 'new', status: 'CONFIRMED', rooms: ['101', '102'], checkIn: '2026-10-25', checkOut: '2026-10-27' };
const rooms = ['101', '102'].map(id => ({ id, active: true, condition: 'clean' }));
const check = (booking = stay, physical = rooms, bookings = [stay], day = '2026-10-25') => checkInBlockReason(booking, physical, bookings, day);

test('check-in allows arrival and last stay night but excludes the departure date', () => {
  assert.equal(check(), '');
  assert.equal(check(stay, rooms, [stay], '2026-10-26'), '');
  for (const day of ['2026-10-24', '2026-10-27', '']) assert.equal(check(stay, rooms, [stay], day), 'outside_stay');
});

test('check-in requires every selected room to exist, remain active and be clean', () => {
  for (const condition of ['dirty', 'inspection', 'maintenance']) {
    assert.equal(check(stay, [rooms[0], { ...rooms[1], condition }]), 'room_not_ready');
  }
  assert.equal(check(stay, [rooms[0]]), 'room_not_ready');
  assert.equal(check(stay, [rooms[0], { ...rooms[1], active: false }]), 'room_not_ready');
  assert.equal(check({ ...stay, rooms: [] }), 'room_not_ready');
});

test('a clean room with an overdue in-house guest stays blocked until checkout', () => {
  const old = { id: 'old', room: '102', status: 'IN_HOUSE', checkIn: '2026-10-23', checkOut: '2026-10-25' };
  assert.equal(check(stay, rooms, [stay, old]), 'room_occupied');
  for (const status of ['CHECKED_OUT', 'CANCELLED', 'NO_SHOW', 'CONFIRMED']) {
    assert.equal(check(stay, rooms, [stay, { ...old, status }]), '');
  }
  assert.equal(check(stay, rooms, [stay, { ...old, room: '103' }]), '');
});

test('check-in never reopens a terminal or already in-house booking', () => {
  for (const status of ['IN_HOUSE', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW']) {
    assert.equal(check({ ...stay, status }), 'invalid_transition');
  }
});
