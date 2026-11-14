import test from 'node:test';
import assert from 'node:assert/strict';
import { availableRooms, validateBooking, addDays, nights, money, roomIsBlocked, statusLabels } from './model.js';
import { getLocale, setLocale } from '../../../shared/i18n/store.js';

test('booking status labels follow language changes without changing stored status codes', () => {
  const previousLocale = getLocale();
  try {
    const seen = [];
    for (const locale of ['vi', 'en-US', 'zh-CN']) {
      setLocale(locale);
      assert.deepEqual(Object.keys(statusLabels), ['CONFIRMED', 'IN_HOUSE', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW']);
      seen.push(statusLabels.CONFIRMED);
      assert.equal(Object.entries(statusLabels)[0][1], statusLabels.CONFIRMED);
    }
    assert.equal(new Set(seen).size, 3);
    assert.equal(seen[0], 'Đã xác nhận');
  } finally { setLocale(previousLocale); }
});
test('money uses the record currency and preserves VND appearance',()=>{
  assert.equal(money('123456'), '123.456 ₫');
  assert.equal(money('123.45','USD'), '123.45 USD');
  assert.equal(money('1.2345','USD'), '1.2345 USD');
  assert.equal(money('999999999999999.9999'), '999.999.999.999.999,9999 ₫');
  assert.equal(money('-0.2500','USD'), '-0.25 USD');
});

test('VND display keeps Vietnamese separators and exact amounts in every UI language', () => {
  const previousLocale = getLocale();
  try {
    for (const locale of ['vi', 'en-US', 'zh-CN']) {
      setLocale(locale);
      for (const [value, expected] of [
        ['1234567.0000', '1.234.567 ₫'],
        ['1250000.1234', '1.250.000,1234 ₫'],
        ['999999999999999.9999', '999.999.999.999.999,9999 ₫'],
        ['-1234567.2500', '-1.234.567,25 ₫'],
        ['0.0001', '0,0001 ₫'],
        [0, '0 ₫'],
        [null, '0 ₫'],
        [undefined, '0 ₫'],
        ['1e3', '1.000 ₫'],
      ]) assert.equal(money(value), expected, `${locale}: ${value}`);
      assert.equal(money('1234.5000', 'USD'), '1,234.50 USD');
    }
  } finally { setLocale(previousLocale); }
});

test('foreign currencies use national separators and minor units independently of UI language', () => {
  const previousLocale = getLocale();
  const cases = [
    ['USD', '1,234,567.00 USD'], ['EUR', '1.234.567,00 EUR'],
    ['GBP', '1,234,567.00 GBP'], ['JPY', '1,234,567 JPY'],
    ['KRW', '1,234,567 KRW'], ['CNY', '1,234,567.00 CNY'],
    ['HKD', '1,234,567.00 HKD'], ['SGD', '1,234,567.00 SGD'],
    ['THB', '1,234,567.00 THB'], ['AUD', '1,234,567.00 AUD'],
    ['CAD', '1,234,567.00 CAD'], ['CHF', "1'234'567.00 CHF"],
    ['NZD', '1,234,567.00 NZD'], ['MYR', '1,234,567.00 MYR'],
    ['IDR', '1.234.567 IDR'], ['PHP', '1,234,567.00 PHP'],
    ['INR', '12,34,567.00 INR'], ['AED', '1,234,567.00 AED'],
    ['TWD', '1,234,567.00 TWD'],
  ];
  try {
    for (const locale of ['vi', 'en-US', 'zh-CN']) {
      setLocale(locale);
      for (const [currency, expected] of cases) {
        assert.equal(money('1234567.0000', currency), expected, `${locale}: ${currency}`);
      }
      assert.equal(money('999999999999999.9999', 'USD'), '999,999,999,999,999.9999 USD');
      assert.equal(money('999999999999999.9999', 'INR'), '99,99,99,99,99,99,999.9999 INR');
      assert.equal(money('-1234.2500', 'EUR'), '-1.234,25 EUR');
      assert.equal(money('1234.2500', 'JPY'), '1,234.25 JPY');
      assert.equal(money('0.0001', 'KRW'), '0.0001 KRW');
      assert.equal(money(null, 'JPY'), '0 JPY');
      assert.equal(money(undefined, 'USD'), '0.00 USD');
      assert.equal(money('1e3', 'EUR'), '1.000,00 EUR');
    }
  } finally { setLocale(previousLocale); }
});
const rooms = [{ id: '101', typeId: 'city', condition: 'clean' }, { id: '102', typeId: 'city', condition: 'maintenance' }, { id: '401', typeId: 'sea', condition: 'clean' }];
const booking = { id: 'A', room: '101', guest: 'Demo', checkIn: '2026-10-02', checkOut: '2026-10-04', status: 'CONFIRMED' };

test('a room move blocks each room only for its own nights', () => {
  const moved = { ...booking, status: 'IN_HOUSE', room: '401', rooms: ['401'], checkOut: '2026-10-06', roomStays: [
    { room: '101', start: '2026-10-02', end: '2026-10-04' },
    { room: '401', start: '2026-10-04', end: '2026-10-06' },
  ] };
  assert.deepEqual(availableRooms(rooms, [moved], '2026-10-03', '2026-10-04').map(r => r.id), ['401']);
  assert.deepEqual(availableRooms(rooms, [moved], '2026-10-04', '2026-10-05').map(r => r.id), ['101']);
  assert.deepEqual(availableRooms(rooms, [moved], '2026-10-03', '2026-10-05').map(r => r.id), []);
});
test('check-out frees the room for an adjacent booking', () => {
  assert.deepEqual(availableRooms(rooms, [booking], '2026-10-04', '2026-10-05', 'city').map(r => r.id), ['101']);
  assert.equal(availableRooms(rooms, [booking], '2026-10-03', '2026-10-05', 'city').length, 0);
});
test('cancelled, no-show and checked-out reservations do not block new bookings', () => {
  for (const status of ['CANCELLED', 'NO_SHOW', 'CHECKED_OUT']) assert.equal(availableRooms(rooms, [{ ...booking, status }], '2026-10-02', '2026-10-04', 'city').length, 1);
});
test('reject invalid dates, blank guest and overlapping booking', () => {
  assert.throws(() => validateBooking({ ...booking, guest: '  ' }, rooms, []));
  assert.throws(() => validateBooking({ ...booking, checkOut: booking.checkIn }, rooms, []));
  assert.throws(() => validateBooking({ ...booking, checkOut: 'invalid' }, rooms, []));
  assert.throws(() => validateBooking(booking, rooms, [booking]));
  assert.doesNotThrow(() => validateBooking({ ...booking, room: '401' }, rooms, [booking]));
});
test('maintenance rooms and wrong room types cannot be selected', () => {
  assert.deepEqual(availableRooms(rooms, [], '2026-10-02', '2026-10-04', 'sea').map(r => r.id), ['401']);
  assert.throws(() => validateBooking({ ...booking, room: '102' }, rooms, []));
});
test('maintenance remains blocked throughout the calendar without a dated lock', () => {
  for (const day of ['2026-10-17', '2026-10-24', '2026-11-01']) {
    assert.equal(roomIsBlocked(rooms[1], [], day, addDays(day, 1)), true);
    assert.equal(roomIsBlocked(rooms[0], [], day, addDays(day, 1)), false);
  }
});
test('room locks match the room number or UUID and use an exclusive end date', () => {
  const room = { id: '101', uuid: 'room-101', condition: 'clean' };
  for (const target of [{ room: '101' }, { roomId: 'room-101' }]) {
    const blocks = [{ ...target, start: '2026-10-19', end: '2026-10-21' }];
    assert.equal(roomIsBlocked(room, blocks, '2026-10-18', '2026-10-19'), false);
    assert.equal(roomIsBlocked(room, blocks, '2026-10-19', '2026-10-20'), true);
    assert.equal(roomIsBlocked(room, blocks, '2026-10-20', '2026-10-21'), true);
    assert.equal(roomIsBlocked(room, blocks, '2026-10-21', '2026-10-22'), false);
    assert.equal(roomIsBlocked({ id: '102', condition: 'clean' }, blocks, '2026-10-19', '2026-10-20'), false);
  }
});
test('stay length uses calendar nights across month boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(nights('2026-10-31', '2026-11-02'), 2);
});
test('all assigned rooms block availability and adjacent stays remain valid', () => {
  const multi = { ...booking, rooms: ['101', '401'] };
  assert.deepEqual(availableRooms(rooms, [multi], '2026-10-03', '2026-10-04'), []);
  assert.deepEqual(availableRooms(rooms, [multi], '2026-10-04', '2026-10-05').map(r => r.id), ['101', '401']);
});
