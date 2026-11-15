import test from 'node:test';
import assert from 'node:assert/strict';
import { channelSupportDecision, createApiClient, createRequestScope, createIntentJournal, localizeApiPayload, permitted, subscriptionDecision, tenantRole } from './api.js';
import { translateApiValue } from '../../../shared/i18n/core.js';
import { routePolicy } from './access.js';
import { setLocale } from '../../../shared/i18n/store.js';
import { csvContent } from '../../../shared/lib/csv.js';

test('OTA support permits both system roles without broadening PMS permissions', () => {
  const hotel = { id: 'hotel-a', status: 'active' };
  for (const globalRole of ['SUPER_ADMIN', 'SYSTEM_MANAGER']) {
    const user = { globalRole, memberships: [] };
    for (const action of ['channels.view', 'channels.write']) {
      assert.equal(channelSupportDecision(user, hotel, action, action.endsWith('.write')).allowed, true);
      assert.equal(permitted(user, hotel, action).reason, 'tenant');
    }
    assert.equal(channelSupportDecision(user, hotel, 'reservations.view').reason, 'role');
    assert.equal(channelSupportDecision({ ...user, active: false }, hotel).reason, 'session');
    assert.equal(channelSupportDecision(user, { ...hotel, status: 'suspended' }, 'channels.write', true).reason, 'suspended');
  }
  assert.equal(channelSupportDecision({ globalRole: 'USER', memberships: [{ tenantId: hotel.id, role: 'HOTEL_OWNER' }] }, hotel).reason, 'role');
});

test('system roles require active hotel membership and retain only its assigned role', () => {
  const hotel = { id: 'hotel-a', status: 'active' }, other = { id: 'hotel-b', status: 'active' };
  for (const globalRole of ['SUPER_ADMIN', 'SYSTEM_MANAGER']) {
    const user = { globalRole, memberships: [] };
    assert.equal(tenantRole(user, hotel.id), undefined);
    for (const action of ['dashboard.view', 'reservations.view', 'reservations.write', 'reports.view', 'cashbook.view', 'channels.view', 'users.write']) {
      assert.equal(permitted(user, hotel, action).reason, 'tenant');
    }
    user.memberships = [{ tenantId: hotel.id, role: 'HOUSEKEEPING', active: true }];
    assert.equal(tenantRole(user, hotel.id), 'HOUSEKEEPING');
    assert.equal(permitted(user, hotel, 'housekeeping.write').allowed, true);
    assert.equal(permitted(user, hotel, 'reservations.view').reason, 'role');
    assert.equal(permitted(user, other, 'housekeeping.view').reason, 'tenant');
    user.memberships[0].role = 'HOTEL_OWNER';
    assert.equal(permitted(user, hotel, 'reports.view').allowed, true);
    assert.equal(permitted(user, hotel, 'users.write').reason, 'role');
    user.memberships[0].active = false;
    assert.equal(permitted(user, hotel, 'reports.view').reason, 'tenant');
  }
});

test('API requests advertise the selected interface language', async () => {
  let request;
  const api = createApiClient(async (url, options) => {
    request = { url, ...options };
    return new Response('{}');
  });
  try {
    setLocale('zh-CN');
    await api.request('/api/locale');
    assert.equal(request.headers['Accept-Language'], 'zh-CN');
  } finally {
    setLocale('vi');
  }
});

test('API payload localization preserves reactive translation references and business data', () => {
  const payload = localizeApiPayload({
    definitions: { period: 'i18n:reports.definitions.period' },
    notification: {
      title: 'i18n:notifications.events.NEW_BOOKING',
      body: { $i18n: 'notifications.eventBodies.NEW_BOOKING', values: { entityId: 'booking-42' } },
    },
    error: { message: 'Cấu hình giá không hợp lệ.' },
    guestName: 'Nguyễn Thị Ánh',
    sourceName: 'Nguồn riêng',
  }, 'en-US');
  assert.equal(payload.definitions.period, 'i18n:reports.definitions.period');
  assert.equal(payload.notification.title, 'i18n:notifications.events.NEW_BOOKING');
  assert.deepEqual(payload.notification.body, { $i18n: 'notifications.eventBodies.NEW_BOOKING', values: { entityId: 'booking-42' } });
  assert.match(translateApiValue('en-US', payload.definitions.period), /Hotel business dates/i);
  assert.equal(translateApiValue('en-US', payload.notification.title), 'New booking');
  assert.equal(translateApiValue('en-US', payload.notification.body), 'New booking: booking-42');
  assert.match(translateApiValue('zh-CN', payload.definitions.period), /酒店营业日期/);
  assert.notEqual(payload.error.message, 'Cấu hình giá không hợp lệ.');
  assert.equal(payload.guestName, 'Nguyễn Thị Ánh');
  assert.equal(payload.sourceName, 'Nguồn riêng');
});

test('API localization only translates message envelopes and leaves nested business data untouched', () => {
  const data = {
    guestName: 'Ghi chú', hotelName: 'Khách lẻ', note: 'Đã lưu.', title: 'Lưu', body: 'Cấu hình giá không hợp lệ.',
    messages: ['Ghi chú'], metadata: { message: 'Đã lưu.', error: { message: 'Cấu hình giá không hợp lệ.' } },
    definitions: { $i18n: 'hk.taskTitle', values: { room: 'Ghi chú' } },
  };
  const payload = { message: 'Đã lưu.', error: { code: 'invalid_price', message: 'Cấu hình giá không hợp lệ.', details: data }, data };
  const original = structuredClone(payload);
  for (const locale of ['vi', 'en-US', 'zh-CN']) {
    const result = localizeApiPayload(payload, locale);
    assert.deepEqual(result.data, data);
    assert.deepEqual(result.error.details, data);
    assert.deepEqual(payload, original);
    if (locale !== 'vi') {
      assert.notEqual(result.message, payload.message);
      assert.notEqual(result.error.message, payload.error.message);
    }
    for (const opaque of ['Ghi chú', [data], { $i18n: 'hk.taskTitle', values: { room: 'Ghi chú' } }]) {
      assert.deepEqual(localizeApiPayload(opaque, locale), opaque);
    }
  }
});

test('API data survives VI to EN to ZH reads, client reload, booking edits and CSV export', async () => {
  const stored = {
    tenant: { id: 'hotel', name: 'Khách lẻ' },
    reservation: { id: 'booking', guestName: 'Ghi chú', note: 'Tồn thấp · mức tối thiểu 5', sourceName: 'Đã lưu.', guests: [{ fullName: 'Lưu' }], adults: 1 },
  };
  const expected = structuredClone(stored);
  const writes = [];
  const fetcher = async (_url, options) => {
    if (options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      writes.push(body);
      stored.reservation = body;
    }
    return new Response(JSON.stringify(stored));
  };
  try {
    for (const locale of ['vi', 'en-US', 'zh-CN']) {
      setLocale(locale);
      // A new client represents a reload with fresh server data, rather than a
      // previous locale's already localized in-memory payload.
      const api = createApiClient(fetcher);
      const data = await api.request('/api/tenants/hotel/workspace');
      assert.deepEqual(data, expected);
      const edited = { ...data.reservation, adults: data.reservation.adults + 1 };
      expected.reservation.adults += 1;
      assert.deepEqual(await api.request('/api/tenants/hotel/reservations/booking', { method: 'PATCH', body: edited }), expected);
      assert.deepEqual(writes.at(-1), expected.reservation);
      const csv = csvContent(['Hotel', 'Guest', 'Note', 'Source'], [[data.tenant.name, data.reservation.guestName, data.reservation.note, data.reservation.sourceName]]);
      for (const value of ['Khách lẻ', 'Ghi chú', 'Tồn thấp · mức tối thiểu 5', 'Đã lưu.']) assert.ok(csv.includes(`"${value}"`));
    }
  } finally { setLocale('vi'); }
});

test('API errors translate messages and descriptors while retaining raw error details', async () => {
  const details = { guestName: 'Ghi chú', note: 'Đã lưu.', message: 'Cấu hình giá không hợp lệ.' };
  try {
    for (const locale of ['vi', 'en-US', 'zh-CN']) {
      setLocale(locale);
      for (const message of ['Cấu hình giá không hợp lệ.', { $i18n: 'hk.taskTitle', values: { room: 'Ghi chú' } }]) {
        const api = createApiClient(async () => new Response(JSON.stringify({ error: { code: 'invalid', message, details } }), { status: 422 }));
        await assert.rejects(api.request('/api/tenants/hotel/reservations'), error => {
          assert.equal(error.status, 422);
          assert.equal(error.code, 'invalid');
          assert.deepEqual(error.details, details);
          if (typeof message === 'object') assert.ok(error.message.includes('Ghi chú'));
          else if (locale !== 'vi') assert.notEqual(error.message, message);
          return true;
        });
      }
    }
  } finally { setLocale('vi'); }
});

test('room location labels survive API reads and saves in every interface language', async () => {
  const room = { id: '1001', uuid: 'physical-room-1001', floor: 'Tầng', area: 'Kho hàng' };
  for (const locale of ['vi', 'en-US', 'zh-CN']) {
    try {
      setLocale(locale);
      let saved;
      const api = createApiClient(async (_url, options) => {
        if (options.method === 'PATCH') {
          saved = JSON.parse(options.body);
          return Response.json({ ...room, ...saved });
        }
        return Response.json({ rooms: [room, { id: 'A101', floor: null, area: null }] });
      });
      const workspace = await api.request('/api/tenants/hotel/workspace');
      assert.deepEqual(workspace.rooms[0], room);
      assert.deepEqual(workspace.rooms[1], { id: 'A101', floor: null, area: null });
      const { id, floor, area } = workspace.rooms[0];
      const updated = await api.request('/api/tenants/hotel/masters/rooms', { method: 'PATCH', body: { id, floor, area } });
      assert.deepEqual(saved, { id: '1001', floor: 'Tầng', area: 'Kho hàng' });
      assert.deepEqual(updated, room);
    } finally { setLocale('vi'); }
  }
});

test('commissions share cashbook role and subscription boundaries', () => {
  assert.deepEqual(routePolicy('/id/commissions'), { action: 'cashbook.view', feature: 'CASHBOOK' });
  const tenant = { id: 'hotel', status: 'active' };
  const user = role => ({ active: true, memberships: [{ tenantId: tenant.id, role }] });
  assert.equal(permitted(user('FRONT_DESK'), tenant, 'cashbook.view').allowed, true);
  assert.equal(permitted(user('FRONT_DESK'), tenant, 'cashbook.write').allowed, false);
  assert.equal(permitted(user('ACCOUNTANT'), tenant, 'cashbook.write').allowed, true);
  assert.equal(subscriptionDecision({ status: 'active', effectiveFeatures: { CASHBOOK: false } }, {}, 'cashbook.view').reason, 'feature');
  assert.equal(subscriptionDecision({ status: 'expired' }, {}, 'cashbook.write').reason, 'expired');
});

test('advanced reports require their own role and feature while basic reports keep basic access', () => {
  const tenant = { id: 'hotel', status: 'active' };
  const user = role => ({ active: true, memberships: [{ tenantId: tenant.id, role }] });
  for (const report of ['source', 'room', 'roomType', 'cancellations', 'nationality', 'discounts']) {
    assert.deepEqual(routePolicy('/id/reports/' + report), { action: 'reports.advanced.view', feature: 'REPORTS_ADVANCED' });
  }
  assert.equal(routePolicy('/id/reports/revenue').feature, 'REPORTS_BASIC');
  assert.equal(permitted(user('ACCOUNTANT'), tenant, 'reports.advanced.view').allowed, true);
  assert.equal(permitted(user('FRONT_DESK'), tenant, 'reports.advanced.view').allowed, false);
  const subscription = { status: 'active', effectiveFeatures: { REPORTS_BASIC: true, REPORTS_ADVANCED: false } };
  assert.equal(subscriptionDecision(subscription, {}, 'reports.advanced.view').reason, 'feature');
  assert.equal(subscriptionDecision(subscription, {}, 'reports.view').allowed, true);
});

test('front desk can read channels while only owners write; all hotel roles receive their own notifications', () => {
  const tenant = { id: 'hotel', status: 'active' };
  const user = role => ({ active: true, memberships: [{ tenantId: tenant.id, role, active: true }] });
  assert.equal(permitted(user('FRONT_DESK'), tenant, 'channels.view').allowed, true);
  assert.equal(permitted(user('FRONT_DESK'), tenant, 'channels.write').allowed, false);
  assert.equal(permitted(user('HOTEL_OWNER'), tenant, 'channels.write').allowed, true);
  for (const role of ['FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTANT']) assert.equal(permitted(user(role), tenant, 'notifications.view').allowed, true);
  assert.equal(subscriptionDecision({ status: 'active', planFeatures: { OTA_SYNC: false } }, {}, 'channels.view').reason, 'feature');
});

test('OTA settings retain front desk reads without granting hotel settings or channel writes', () => {
  const tenant = { id: 'hotel', status: 'active' };
  const user = role => ({ active: true, memberships: [{ tenantId: tenant.id, role, active: true }] });
  for (const tab of ['channels', 'connection', 'history']) {
    const policy = routePolicy('/id/settings?section=channels&tab=' + tab);
    assert.deepEqual(policy, { action: 'channels.view', feature: 'OTA_SYNC' });
    assert.equal(permitted(user('FRONT_DESK'), tenant, policy.action, false).allowed, true);
    for (const role of ['ACCOUNTANT', 'HOUSEKEEPING']) assert.equal(permitted(user(role), tenant, policy.action, false).allowed, false);
    assert.equal(subscriptionDecision({ status: 'active', effectiveFeatures: { OTA_SYNC: false } }, {}, policy.action, policy.feature, false).reason, 'feature');
  }
  for (const path of ['/id/settings', '/id/settings?section=business&tab=channels', '/id/settings?section=channels%26business', '/id/settings-other?section=channels']) {
    const policy = routePolicy(path);
    assert.equal(policy.action, 'settings.write');
    assert.equal(permitted(user('FRONT_DESK'), tenant, policy.action, false).allowed, false);
    assert.equal(permitted(user('HOTEL_OWNER'), tenant, policy.action, false).allowed, true);
  }
  assert.equal(permitted(user('FRONT_DESK'), tenant, 'channels.write').allowed, false);
  assert.equal(permitted(user('FRONT_DESK'), tenant, 'settings.write').allowed, false);
});

test('ambiguous money writes reuse an opaque intent across form remount and reload', async () => {
  const values=new Map();const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const first=createIntentJournal(storage);const body={amount:'125000.00',fundId:'fund',note:'private note'};
  const pending=await first.acquire('/api/tenants/a/reservations/b/payments',body,'first');
  const reloaded=createIntentJournal(storage);
  assert.equal((await reloaded.acquire('/api/tenants/a/reservations/b/payments',{note:'private note',fundId:'fund',amount:'125000.00'},'new-form')).key,pending.key);
  assert.equal([...values.values()].join('').includes('125000'),false);
  assert.equal([...values.values()].join('').includes('private note'),false);
  reloaded.confirm(pending);
  assert.equal((await reloaded.acquire('/api/tenants/a/reservations/b/payments',body,'next-confirmed-operation')).key,'next-confirmed-operation');
});

test('deployment API origin retains credentialed API paths',async()=>{
  let path;const api=createApiClient(async url=>{path=url;return new Response('{}');},'https://api.example.test/');
  await api.request('/api/auth/session');assert.equal(path,'https://api.example.test/api/auth/session');
});

test('tenant money retries keep the same actor and preserve unknown legacy results', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const path = '/api/tenants/a/reservations/b/payments', body = { amount: '25', methodId: 'bank' };
  await createIntentJournal(storage).acquire(path, body, 'owner-key', 'owner');
  assert.equal((await createIntentJournal(storage).acquire(path, body, 'desk-key', 'desk')).key, 'desk-key');
  assert.equal((await createIntentJournal(storage).acquire(path, body, 'retry', 'owner')).key, 'owner-key');
  const legacyPath = '/api/tenants/a/cashbook';
  const old = await createIntentJournal(storage).acquire(legacyPath, body, 'legacy-key');
  const upgraded = createIntentJournal(storage);
  const retry = await upgraded.acquire(legacyPath, body, 'new-key', 'owner');
  assert.equal(retry.fingerprint, old.fingerprint);
  assert.equal(retry.key, old.key);
  assert.equal(retry.actor, 'owner');
  upgraded.confirm(retry);
  assert.equal((await upgraded.acquire(legacyPath, body, 'next-key', 'owner')).key, 'next-key');
});

test('acknowledged writes retain their receipt and retry key across reload until reconciliation', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const path = '/api/tenants/a/reservations', body = { guest: 'Private guest', rooms: ['room'] };
  const journal = createIntentJournal(storage);
  const pending = await journal.acquire(path, body, 'booking-intent', 'owner');
  journal.acknowledge(pending, 'booking-42');
  const reloaded = createIntentJournal(storage);
  assert.equal((await reloaded.acquire(path, body, 'new-form', 'owner')).key, pending.key);
  const [receipt] = reloaded.acknowledged('/api/tenants/a/', 'owner');
  assert.equal(receipt.resultId, 'booking-42');
  assert.equal(receipt.path, path);
  assert.equal(receipt.key, pending.key);
  assert.equal(reloaded.acknowledged('/api/tenants/b/', 'owner').length, 0);
  assert.equal(reloaded.acknowledged('/api/tenants/a/', 'other-user').length, 0);
  assert.equal([...values.values()].join('').includes('Private guest'), false);
  reloaded.confirm(receipt);
  assert.equal(reloaded.acknowledged('/api/tenants/a/', 'owner').length, 0);
  assert.equal((await createIntentJournal(storage).acquire(path, body, 'next-booking', 'owner')).key, 'next-booking');
});

test('reconciliation only clears acknowledged writes and leaves ambiguous writes retryable', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const journal = createIntentJournal(storage);
  const unknown = await journal.acquire('/api/tenants/a/reservations/b/payments', { amount: '100' }, 'unknown', 'owner');
  const known = await journal.acquire('/api/tenants/a/reservations', { rooms: ['room'] }, 'known', 'owner');
  journal.acknowledge(known, 'booking');
  journal.acknowledged('/api/tenants/a/', 'owner').forEach(intent => journal.confirm(intent));
  assert.equal((await createIntentJournal(storage).acquire('/api/tenants/a/reservations/b/payments', { amount: '100' }, 'retry', 'owner')).key, unknown.key);
});

test('malformed and inaccessible intent storage still allow safe in-memory retries', async () => {
  for (const serialized of ['null', '[]', 'invalid']) {
    const journal = createIntentJournal({ getItem: () => serialized, setItem: () => { throw new Error('storage full'); } });
    const first = await journal.acquire('/api/tenants/a/reservations', {}, 'first', 'owner');
    journal.acknowledge(first, 'booking');
    assert.equal((await journal.acquire('/api/tenants/a/reservations', {}, 'retry', 'owner')).key, first.key);
    assert.equal(journal.acknowledged('/api/tenants/a/', 'owner')[0].resultId, 'booking');
  }
});

test('independent form journals preserve each other\'s writes and confirmations', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const provider = createIntentJournal(storage), reconciliation = createIntentJournal(storage);
  const booking = await provider.acquire('/api/tenants/a/reservations', {}, 'booking-intent', 'owner');
  provider.acknowledge(booking, 'booking-42');
  const closing = await reconciliation.acquire('/api/tenants/a/reconciliation', { date: '2026-10-23' }, 'closing-intent', 'owner');
  assert.equal(provider.acknowledged('/api/tenants/a/', 'owner')[0].resultId, 'booking-42');
  provider.confirm(booking);
  reconciliation.acknowledge(closing, 'closing-42');
  assert.deepEqual(createIntentJournal(storage).acknowledged('/api/tenants/a/', 'owner').map(row => row.resultId), ['closing-42']);
  reconciliation.confirm(closing);
  const next = await provider.acquire('/api/tenants/a/reservations', {}, 'next-booking', 'owner');
  assert.equal(next.key, 'next-booking');
  assert.deepEqual(provider.acknowledged('/api/tenants/a/', 'owner'), []);
});

test('concurrent forms submitting the same payload acquire the same retry key', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const [first, second] = await Promise.all([
    createIntentJournal(storage).acquire('/api/tenants/a/reservations', { rooms: ['101'] }, 'first-form', 'owner'),
    createIntentJournal(storage).acquire('/api/tenants/a/reservations', { rooms: ['101'] }, 'second-form', 'owner'),
  ]);
  assert.equal(first.key, second.key);
});

test('cookie credentials and CSRF protect mutations without persistent credentials', async () => {
  let request;
  const api = createApiClient(async (url, options) => { request = { url, ...options }; return new Response('{"id":"ok"}', { status: 200 }); });
  api.setCsrf('in-memory');
  await api.request('/api/tenants/a/reservations', { method: 'POST', body: { rooms: ['101'] }, intent: 'payment-intent' });
  assert.equal(request.credentials, 'include');
  assert.equal(request.headers['Accept-Language'], 'vi');
  assert.equal(request.headers['X-CSRF-Token'], 'in-memory');
  assert.equal(request.headers['Idempotency-Key'], 'payment-intent');
  assert.deepEqual(JSON.parse(request.body), { rooms: ['101'] });
});
test('structured 403 errors remain visible and never become successful fallback data', async () => {
  const api = createApiClient(async () => new Response('{"error":{"code":"FORBIDDEN","message":"No access"}}', { status: 403 }));
  await assert.rejects(api.request('/api/tenants/a/workspace'), error => error.status === 403 && error.message === 'No access');
});

test('pending activity distinguishes concurrent reads and writes until each finishes', async () => {
  const responses = [Promise.withResolvers(), Promise.withResolvers(), Promise.withResolvers()];
  const activity = [];
  let next = 0;
  const api = createApiClient(() => responses[next++].promise, '', value => activity.push(value));
  const first = api.request('/api/one');
  const second = api.request('/api/two');
  const write = api.request('/api/auth/login', { method: 'POST', body: { password: 'private' } });
  try {
    assert.deepEqual(activity.at(-1), { reads: 2, writes: 1 });
    responses[0].resolve(new Response('{}'));
    await first;
    assert.deepEqual(activity.at(-1), { reads: 1, writes: 1 });
    responses[2].resolve(new Response('{}'));
    await write;
    assert.deepEqual(activity.at(-1), { reads: 1, writes: 0 });
    responses[1].resolve(new Response('{}'));
    await second;
    assert.deepEqual(activity, [
      { reads: 1, writes: 0 }, { reads: 2, writes: 0 }, { reads: 2, writes: 1 },
      { reads: 1, writes: 1 }, { reads: 1, writes: 0 }, { reads: 0, writes: 0 },
    ]);
  } finally {
    for (const response of responses) response.resolve(new Response('{}'));
    await Promise.all([first, second, write]);
  }
});

test('read-only POST quote activity does not lock navigation like a pending mutation', async () => {
  const responses = [];
  const activity = [];
  const api = createApiClient(() => { const response = Promise.withResolvers(); responses.push(response); return response.promise; }, '', value => activity.push(value));
  const quote = api.request('/api/tenants/a/quote', { method: 'POST', body: { roomId: '101' }, readOnly: true });
  const write = api.request('/api/tenants/a/reservations', { method: 'POST', body: { roomId: '101' } });
  try {
    assert.deepEqual(activity.at(-1), { reads: 1, writes: 1 });
    responses[1].resolve(new Response('{}'));
    await write;
    assert.deepEqual(activity.at(-1), { reads: 1, writes: 0 });
    responses[0].resolve(new Response('{}'));
    await quote;
    assert.deepEqual(activity.at(-1), { reads: 0, writes: 0 });
  } finally {
    responses.forEach(response => response.resolve(new Response('{}')));
    await Promise.all([quote, write]);
  }
});

test('pending activity remains visible until JSON decoding completes', async () => {
  const json = Promise.withResolvers(), parsing = Promise.withResolvers();
  const activity = [];
  const api = createApiClient(async () => ({ status: 200, ok: true, json() { parsing.resolve(); return json.promise; } }), '', value => activity.push(value));
  const request = api.request('/api/one');
  try {
    await parsing.promise;
    assert.deepEqual(activity, [{ reads: 1, writes: 0 }]);
    json.resolve({ id: 'one' });
    assert.deepEqual(await request, { id: 'one' });
    assert.deepEqual(activity.at(-1), { reads: 0, writes: 0 });
  } finally {
    json.resolve({ id: 'one' });
    await request;
  }
});

test('pending activity clears after HTTP failures and preserves API error details', async () => {
  const activity = [];
  const api = createApiClient(async () => new Response('{"error":{"code":"FORBIDDEN","message":"No access"}}', { status: 403 }), '', value => activity.push(value));
  await assert.rejects(api.request('/api/one', { method: 'PATCH', body: {} }), error => error.status === 403 && error.code === 'FORBIDDEN' && error.message === 'No access');
  assert.deepEqual(activity, [{ reads: 0, writes: 1 }, { reads: 0, writes: 0 }]);
});

test('pending activity clears after network failures and cancellation', async () => {
  for (const failure of [new Error('Network failed'), new DOMException('Cancelled', 'AbortError')]) {
    const activity = [];
    const api = createApiClient(async () => { throw failure; }, '', value => activity.push(value));
    await assert.rejects(api.request('/api/one'), error => error === failure);
    assert.deepEqual(activity, [{ reads: 1, writes: 0 }, { reads: 0, writes: 0 }]);
  }
});

test('pending activity clears for empty 204 responses without decoding JSON', async () => {
  const activity = [];
  const api = createApiClient(async () => new Response(null, { status: 204 }), '', value => activity.push(value));
  assert.equal(await api.request('/api/one', { method: 'DELETE' }), null);
  assert.deepEqual(activity, [{ reads: 0, writes: 1 }, { reads: 0, writes: 0 }]);
});

test('old tenant responses cannot publish after switching tenant or session', () => {
  const scope = createRequestScope();
  const old = scope.select('hotel-a');
  const current = scope.select('hotel-b');
  assert.equal(scope.isCurrent(old), false);
  assert.equal(scope.isCurrent(current), true);
  scope.select(null);
  assert.equal(scope.isCurrent(current), false);
});
test('role access has no commercial plan gates and rejects suspended membership', () => {
  const user = { globalRole: 'USER', active: true, memberships: [{ tenantId: 'a', role: 'FRONT_DESK', active: true }] };
  assert.equal(permitted(user, { id: 'a', status: 'ACTIVE' }, 'payments.write').allowed, true);
  assert.equal(permitted(user, { id: 'a', status: 'ACTIVE' }, 'settings.write').allowed, false);
  assert.equal(permitted(user, { id: 'a', status: 'SUSPENDED' }, 'reservations.write').allowed, false);
});

test('a suspended hotel can read its inbox but cannot write read markers', () => {
  const user = { active: true, memberships: [{ tenantId: 'a', role: 'FRONT_DESK', active: true }] };
  const tenant = { id: 'a', status: 'SUSPENDED' };
  assert.equal(permitted(user, tenant, 'notifications.view').allowed, true);
  assert.equal(permitted(user, tenant, 'notifications.view', true).reason, 'suspended');
  assert.equal(subscriptionDecision({ status: 'expired' }, {}, 'notifications.view', undefined, false).allowed, true);
  assert.equal(subscriptionDecision({ status: 'expired' }, {}, 'notifications.view', undefined, true).reason, 'expired');
});

test('expired housekeeping management is a write while explicit read overrides remain available', () => {
  const expired = { status: 'expired', planFeatures: { HOUSEKEEPING: true } };
  assert.equal(subscriptionDecision(expired, {}, 'housekeeping.manage').reason, 'expired');
  assert.equal(subscriptionDecision(expired, {}, 'housekeeping.view').allowed, true);
  assert.equal(subscriptionDecision(expired, {}, 'housekeeping.manage', undefined, false).allowed, true);
  assert.equal(subscriptionDecision(expired, {}, 'notifications.view', undefined, true).reason, 'expired');
});

test('subscription gates preserve reads but reject expired writes and explicitly disabled features', () => {
  const now = Date.parse('2026-10-04T00:00:00Z');
  const expired = {status:'active',endDate:'2026-10-03T00:00:00Z',planFeatures:{POS_SALES:true}};
  assert.equal(subscriptionDecision(expired,{POS_SALES:false},'pos.view',undefined,false,now).allowed,true);
  assert.equal(subscriptionDecision(expired,{},'pos.write',undefined,true,now).reason,'expired');
  assert.equal(subscriptionDecision({status:'active',planFeatures:{POS_SALES:false}}, {},'pos.view').reason,'feature');
  assert.equal(subscriptionDecision({status:'active',effectiveActive:false}, {},'settings.write',undefined,true).allowed,false);
  assert.equal(subscriptionDecision(null,{},'reservations.write',undefined,true).allowed,true);
});

test('temporary operational access permits completion without enabling creation or disabled features', () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  const subscription = { status: 'active', blockedReason: 'expired', effectiveActive: false,
    endDate: '2026-10-28T00:00:00Z', operationalAccess: { active: true, until: '2026-10-30T00:00:00Z' } };
  for (const action of ['payments.write', 'finance.adjust', 'reservations.checkout', 'housekeeping.complete']) {
    assert.equal(subscriptionDecision(subscription, {}, action, undefined, true, now).allowed, true, action);
  }
  for (const action of ['reservations.write', 'pos.write', 'settings.write', 'housekeeping.manage', 'channels.write']) {
    assert.equal(subscriptionDecision(subscription, {}, action, undefined, true, now).reason, 'expired', action);
    assert.match(subscriptionDecision(subscription, {}, action, undefined, true, now).message, /vận hành tạm/, action);
  }
  assert.equal(subscriptionDecision(subscription, { CASHBOOK: false }, 'payments.write', undefined, true, now).reason, 'feature');
  assert.equal(subscriptionDecision(subscription, {}, 'payments.write', undefined, true, Date.parse('2026-10-30T00:00:00Z')).reason, 'expired');
  assert.equal(subscriptionDecision({ ...subscription, blockedReason: 'inactive' }, {}, 'payments.write', undefined, true, now).reason, 'expired');
  const user = { active: true, memberships: [{ tenantId: 'a', role: 'FRONT_DESK' }] };
  assert.equal(permitted(user, { id: 'a', status: 'ACTIVE' }, 'reservations.checkout', true).allowed, true);
  assert.equal(permitted(user, { id: 'a', status: 'SUSPENDED' }, 'reservations.checkout', true).reason, 'suspended');
});

test('SaaS payment retry keeps its actor and cannot reuse another managers pending key', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const path = '/api/billing/invoices/invoice/payments', body = { amount: '25', method: 'bank' };
  const first = await createIntentJournal(storage).acquire(path, body, 'admin-payment', 'admin');
  const journal = createIntentJournal(storage);
  assert.equal((await journal.acquire(path, body, 'manager-payment', 'manager')).key, 'manager-payment');
  assert.equal((await journal.acquire(path, body, 'admin-retry', 'admin')).key, first.key);
  assert.equal([...values.values()].join('').includes('"amount"'), false);
});

test('effective feature access honors hotel grants, global switches and legacy subscriptions', () => {
  const active = { status: 'active', planFeatures: { POS_SALES: false }, effectiveFeatures: { POS_SALES: true } };
  assert.equal(subscriptionDecision(active, {}, 'pos.view').allowed, true);
  assert.equal(subscriptionDecision(active, {}, 'pos.write').allowed, true);
  assert.equal(subscriptionDecision({ ...active, effectiveFeatures: { POS_SALES: false } }, {}, 'pos.view').reason, 'feature');
  assert.equal(subscriptionDecision({ ...active, status: 'expired' }, {}, 'pos.write').reason, 'expired');
  assert.equal(subscriptionDecision(null, { POS_SALES: false }, 'pos.view').reason, 'feature');
  assert.equal(subscriptionDecision(null, { POS_SALES: true }, 'pos.write').allowed, true);
});
