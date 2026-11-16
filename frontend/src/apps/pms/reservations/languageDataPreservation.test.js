import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../data/api.js';
import { bookingEditInput } from './bookingDraft.js';
import { reservationCsvHeaders, reservationCsvRows } from './reservationsCsv.js';
import { csvContent } from '../../../shared/lib/csv.js';
import { translateApiValue } from '../../../shared/i18n/core.js';
import { getLocale, setLocale, t } from '../../../shared/i18n/store.js';

test('VI to EN to ZH preserves dictionary-colliding business data through reload, booking edits and CSV', async () => {
  const original = {
    tenant: { id: 'hotel-1', name: 'Đặt phòng' },
    settings: { name: 'Đặt phòng', address: 'Phòng', timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
    masters: { bookingSources: [{ id: 'source-1', name: 'Khách' }], roomTypes: [{ id: 'room-type-1', name: 'Hủy' }] },
    bookings: [{
      id: 'RES-1', version: 1, guest: 'Lưu', phone: '0900000000', email: 'guest@example.test', identity: 'Trạng thái', nationality: 'Khách',
      rooms: ['101', '102'], checkIn: '2026-10-21', checkOut: '2026-10-23', source: 'Khách', status: 'CONFIRMED', total: '1250000.1234', currency: 'VND',
      guests: [{ id: 'guest-1', name: 'Lưu', phone: '0900000000', email: 'guest@example.test', identityNumber: 'Trạng thái', nationality: 'Khách', note: 'Cấu hình giá không hợp lệ.' }, { id: 'guest-2', name: 'Hủy', identityNumber: 'Phòng', metadata: { title: 'Đặt phòng', message: 'Lưu' } }],
      notes: [{ id: 'note-1', body: 'Cấu hình giá không hợp lệ.', author: { name: 'Đặt phòng' } }, { id: 'note-2', body: 'i18n:common.save' }],
    }],
    notifications: [{ title: 'i18n:notifications.events.NEW_BOOKING', body: { $i18n: 'notifications.eventBodies.NEW_BOOKING', values: { entityId: 'Lưu' } } }],
  };
  let persisted = JSON.stringify(original);
  const requests = [], writes = [];
  const fetcher = async (url, options) => {
    requests.push(options.headers['Accept-Language']);
    const state = JSON.parse(persisted);
    if (url === '/api/tenants/hotel-1/workspace' && options.method === 'GET') return Response.json(state);
    assert.equal(url, '/api/tenants/hotel-1/reservations/RES-1');
    assert.equal(options.method, 'PATCH');
    const input = JSON.parse(options.body);
    writes.push(input);
    const booking = state.bookings[0];
    assert.equal(input.expectedVersion, booking.version);
    const primary = input.guests[0];
    state.bookings[0] = { ...booking, ...input, guest: primary.name, phone: primary.phone, email: primary.email, identity: primary.identityNumber, nationality: primary.nationality, version: booking.version + 1 };
    delete state.bookings[0].expectedVersion;
    persisted = JSON.stringify(state);
    return Response.json(state.bookings[0]);
  };
  const expectedCsv = status => `\uFEFF"Mã booking","Khách","Phòng","Nhận","Trả","Trạng thái","Nguồn","Tổng tiền","Tiền tệ"\r\n"RES-1","Lưu","101, 102","2026-10-21","2026-10-23","${status}","Khách","1250000.1234","VND"`;
  const previousLocale = getLocale();
  try {
    for (const [locale, saveLabel, notification, status] of [['vi', 'Lưu', 'Đặt phòng mới: Lưu', 'Đã xác nhận'], ['en-US', 'Save', 'New booking: Lưu', 'Confirmed'], ['zh-CN', '保存', '新预订：Lưu', '已确认']]) {
      setLocale(locale);
      // Recreate the client and decode the persisted server response as a page reload would.
      const api = createApiClient(fetcher);
      const loaded = await api.request('/api/tenants/hotel-1/workspace');
      assert.deepEqual(loaded, JSON.parse(persisted));
      assert.equal(t('common.save'), saveLabel);
      assert.equal(translateApiValue(locale, loaded.notifications[0].body), notification);
      assert.equal(csvContent(reservationCsvHeaders, reservationCsvRows(loaded.bookings)), expectedCsv(status));

      // Saving an unchanged editable form must never write translated identity data back.
      const edit = bookingEditInput(loaded.bookings[0]);
      assert.deepEqual(edit.guests, original.bookings[0].guests);
      assert.equal(edit.source, original.bookings[0].source);
      const saved = await api.request('/api/tenants/hotel-1/reservations/RES-1', { method: 'PATCH', body: edit });
      assert.deepEqual(saved.guests, original.bookings[0].guests);
      const reloaded = await createApiClient(fetcher).request('/api/tenants/hotel-1/workspace');
      assert.equal(reloaded.tenant.name, original.tenant.name);
      assert.deepEqual(reloaded.settings, original.settings);
      assert.deepEqual(reloaded.masters, original.masters);
      assert.deepEqual(reloaded.bookings[0].notes, original.bookings[0].notes);
      assert.deepEqual(reloaded.bookings[0].guests, original.bookings[0].guests);
      assert.equal(csvContent(reservationCsvHeaders, reservationCsvRows(reloaded.bookings)), expectedCsv(status));
    }
    assert.deepEqual(requests, ['vi', 'vi', 'vi', 'en-US', 'en-US', 'en-US', 'zh-CN', 'zh-CN', 'zh-CN']);
    assert.equal(writes.length, 3);
    assert.deepEqual(writes.map(input => input.expectedVersion), [1, 2, 3]);
  } finally {
    setLocale(previousLocale);
  }
});
