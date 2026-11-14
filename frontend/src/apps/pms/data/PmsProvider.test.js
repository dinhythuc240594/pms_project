import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { act, createElement, useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import { withDraftDom } from '../../../shared/drafts/testDom.js';

let server, PmsProvider, PmsContext, usePms, PmsLayout;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../../../../', import.meta.url)),
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  ({ PmsProvider } = await server.ssrLoadModule('/src/apps/pms/data/PmsProvider.jsx'));
  ({ PmsContext, usePms } = await server.ssrLoadModule('/src/apps/pms/data/usePms.js'));
  ({ default: PmsLayout } = await server.ssrLoadModule('/src/apps/pms/layouts/PmsLayout.jsx'));
});
after(async () => { await server?.close(); });

const hotel = { id: 'hotel', name: 'Hotel', status: 'ACTIVE' };
const booking = { id: 'booking-42', version: 1, rooms: ['101'], payments: [], charges: [], notes: [], history: [], paid: '0', balance: '100' };
const session = {
  user: { id: 'owner', name: 'Owner', active: true, globalRole: 'USER', memberships: [{ tenantId: hotel.id, role: 'HOTEL_OWNER' }] },
  tenants: [hotel], csrfToken: 'csrf',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const unavailable = () => json({ error: { code: 'unavailable', message: 'Service unavailable' } }, 503);
const workspace = (bookings = [], tenant = hotel) => ({ tenant, bookings, settings: { timezone: 'Asia/Ho_Chi_Minh' } });
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const storedIntents = storage => Object.values(JSON.parse(storage.getItem('bluejay-pms-pending-intents-v1') || '{}'));

async function mount(request, { storage = memoryStorage(), identity = session } = {}) {
  const win = new Window({ url: 'http://localhost' });
  const replacements = { window: win, document: win.document, localStorage: memoryStorage(), sessionStorage: storage, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options) => {
      if (url === '/api/auth/session') return request?.(url, options) ?? json(identity);
      if (url === '/api/tenants' && options.method === 'GET') return json({ tenants: identity.tenants });
      return request?.(url, options) ?? json(workspace());
    } };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = await import('react-dom/client');
  let current;
  function Probe() { const value = usePms(); useEffect(() => { current = value; }, [value]); return null; }
  const container = win.document.createElement('div');
  win.document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(PmsProvider, null, createElement(Probe))); });
  return {
    get value() { return current; }, storage,
    async run(callback) { let result; await act(async () => { result = await callback(current); }); return result; },
    async close() {
      await act(async () => { root.unmount(); });
      await win.happyDOM.close();
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('Expected request did not start');
}

test('PMS context exposes the system request used by manager operations', () => {
  function Probe() { assert.equal(typeof usePms().requestSystem, 'function'); assert.equal(usePms().saveManagedTenantUser, undefined); return null; }
  renderToString(createElement(PmsProvider, null, createElement(Probe)));
});

test('customer directory requests preserve filters and pagination without changing account picker search', async () => {
  const requests = [];
  const mounted = await mount((url, options) => {
    requests.push({ url, options });
    if (url.startsWith('/api/admin/customer-accounts')) return json({ users: [], pagination: { page: 2, pageSize: 20, totalItems: 0 } });
  });
  try {
    await mounted.run(pms => pms.listCustomerAccounts({ search: 'An & Bình', tenantId: 'hotel/a', role: 'FRONT_DESK', active: false, page: 2, pageSize: 20 }));
    const directory = requests.find(row => row.url.startsWith('/api/admin/customer-accounts/directory?'));
    assert.ok(directory);
    assert.deepEqual(Object.fromEntries(new URL(directory.url, 'http://localhost').searchParams), { search: 'An & Bình', tenantId: 'hotel/a', role: 'FRONT_DESK', active: 'false', page: '2', pageSize: '20' });
    assert.equal(directory.options.method, 'GET');
    assert.equal(directory.options.body, undefined);
    await mounted.run(pms => pms.listCustomerAccounts({ search: '', tenantId: undefined, role: null, active: '', page: 1, pageSize: 20 }));
    const unfiltered = requests.filter(row => row.url.startsWith('/api/admin/customer-accounts/directory?')).at(-1);
    assert.deepEqual(Object.fromEntries(new URL(unfiltered.url, 'http://localhost').searchParams), { page: '1', pageSize: '20' });
    await mounted.run(pms => pms.searchCustomerAccounts('owner@example.test'));
    const picker = requests.find(row => row.url.startsWith('/api/admin/customer-accounts?'));
    assert.deepEqual(Object.fromEntries(new URL(picker.url, 'http://localhost').searchParams), { search: 'owner@example.test' });
  } finally { await mounted.close(); }
});

test('date range requests send canonical query names and preserve exact dates and other filters', async () => {
  const requests = [];
  const mounted = await mount((url, options) => { requests.push({ url, options }); });
  const start = '2026-11-01', end = '2026-12-01';
  const cases = [
    [pms => pms.getManagerOverview(start, end), '/api/manager/overview', {}],
    [pms => pms.listSaasInvoices({ start, end, tenantId: 'hotel-a', status: 'unpaid', page: 2 }), '/api/billing/invoices', { tenantId: 'hotel-a', status: 'unpaid', page: '2' }],
    [pms => pms.getChannexInventory('account-a', 'property-a', start, end), '/api/admin/channex/properties/property-a/inventory', { accountId: 'account-a' }],
    [pms => pms.getRevenueReport(start, end, 'USD', 'base'), '/api/tenants/hotel/reports/revenue', { currency: 'USD', basis: 'base' }],
    [pms => pms.getFinancialReport(start, end, 'VND'), '/api/tenants/hotel/reports/financial', { currency: 'VND', basis: 'original' }],
    [pms => pms.getBusinessReport('source', start, end, 'USD'), '/api/tenants/hotel/reports/business', { report: 'source', currency: 'USD', basis: 'original' }],
    [pms => pms.getCashbook({ startDate: start, endDate: end, currency: 'USD', fundId: 'fund-a', page: 1 }), '/api/tenants/hotel/cashbook', { currency: 'USD', fundId: 'fund-a', page: '1' }],
    [pms => pms.getCommissions({ startDate: start, endDate: end, currency: 'VND', sourceId: 'source-a', status: 'PARTIAL' }), '/api/tenants/hotel/commissions', { currency: 'VND', sourceId: 'source-a', status: 'PARTIAL' }],
    [pms => pms.getAvailability(start, end, 'room-type-a'), '/api/tenants/hotel/availability', { typeId: 'room-type-a' }],
  ];
  try {
    for (const [invoke, path, filters] of cases) {
      const previous = requests.length;
      await mounted.run(invoke);
      const request = requests.slice(previous).find(item => new URL(item.url, 'http://localhost').pathname === path);
      assert.ok(request, path);
      const url = new URL(request.url, 'http://localhost');
      assert.deepEqual(Object.fromEntries(url.searchParams), { start_date: start, end_date: end, ...filters }, path);
      assert.equal(url.searchParams.getAll('start_date').length, 1, path);
      assert.equal(url.searchParams.getAll('end_date').length, 1, path);
      assert.equal(request.options.method, 'GET', path);
      assert.equal(request.options.body, undefined, path);
    }
  } finally { await mounted.close(); }
});

test('booking POST success remains saved with its ID when refresh returns 503, then reconciles on reload', async () => {
  let saved = false, failRefresh = true;
  const mounted = await mount((url, options) => {
    if (options.method === 'POST') { saved = true; return json(booking, 201); }
    if (url.endsWith('/workspace') && saved) return failRefresh ? unavailable() : json(workspace([booking]));
  });
  try {
    const result = await mounted.run(pms => pms.createBooking({ rooms: ['101'], guest: 'Guest' }, 'create-intent'));
    assert.equal(result.id, booking.id);
    assert.equal(mounted.value.bookings[0].id, booking.id);
    assert.equal(mounted.value.writeReceipt.id, booking.id);
    assert.equal(mounted.value.writeReceipt.intent, 'create-intent');
    assert.equal(mounted.value.writeReceipt.synchronized, false);
    assert.equal(mounted.value.workspaceSyncError, 'Service unavailable');
    assert.equal(mounted.value.accessDialog, null);
    assert.equal(mounted.value.loadError, '');
    assert.equal(storedIntents(mounted.storage)[0].resultId, booking.id);
    const markup = renderToString(createElement(MemoryRouter, null, createElement(PmsContext.Provider, { value: mounted.value }, createElement(PmsLayout))));
    assert.match(markup, /Đã ghi dữ liệu \(mã: booking-42\)/);
    failRefresh = false;
    assert.equal(await mounted.run(pms => pms.refreshWorkspace({ quiet: true })), true);
    assert.equal(mounted.value.writeReceipt.synchronized, true);
    assert.equal(mounted.value.workspaceSyncError, '');
    assert.deepEqual(storedIntents(mounted.storage), []);
  } finally { await mounted.close(); }
});

test('an acknowledged booking survives a provider remount and retries with the original key', async () => {
  const storage = memoryStorage(), keys = [];
  let saved = false;
  const request = (url, options) => {
    if (options.method === 'POST') { saved = true; keys.push(options.headers['Idempotency-Key']); return json(booking, 201); }
    if (url.endsWith('/workspace') && saved) return unavailable();
  };
  const first = await mount(request, { storage });
  try { await first.run(pms => pms.createBooking({ rooms: ['101'] }, 'first-form')); }
  finally { await first.close(); }
  const reloaded = await mount(request, { storage });
  try {
    assert.equal(reloaded.value.writeReceipt.id, booking.id);
    assert.equal(reloaded.value.writeReceipt.synchronized, false);
    assert.equal((await reloaded.run(pms => pms.createBooking({ rooms: ['101'] }, 'new-form'))).id, booking.id);
    assert.deepEqual(keys, ['first-form', 'first-form']);
  } finally { await reloaded.close(); }
});

test('a payment with a lost response reuses its key after remount and a successful workspace read', async () => {
  const storage = memoryStorage(), keys = [];
  let writes = 0;
  const paid = { ...booking, paid: '20', balance: '80', payments: [{ id: 'payment-42', amount: '20' }] };
  const request = (url, options) => {
    if (options.method === 'POST') {
      keys.push(options.headers['Idempotency-Key']);
      if (++writes === 1) throw new TypeError('Connection lost after commit');
      return json(paid, 201);
    }
    if (url.endsWith('/workspace')) return json(workspace(writes ? [paid] : [booking]));
  };
  const first = await mount(request, { storage });
  try { await assert.rejects(first.run(pms => pms.addPayment(booking.id, { amount: '20' }, 'payment-intent')), /Connection lost/); }
  finally { await first.close(); }
  const reloaded = await mount(request, { storage });
  try {
    assert.equal((await reloaded.run(pms => pms.addPayment(booking.id, { amount: '20' }, 'new-payment-form'))).id, booking.id);
    assert.deepEqual(keys, ['payment-intent', 'payment-intent']);
    assert.equal(reloaded.value.bookings[0].payments.length, 1);
    assert.deepEqual(storedIntents(storage), []);
  } finally { await reloaded.close(); }
});

test('an acknowledged partial payment retries after reload without appending another payment', async () => {
  const storage = memoryStorage(), committed = new Map(), keys = [];
  let saved = false;
  const request = (url, options) => {
    if (options.method === 'POST') {
      saved = true;
      const key = options.headers['Idempotency-Key']; keys.push(key);
      if (!committed.has(key)) committed.set(key, { ...booking, paid: '20', balance: '80', payments: [{ id: 'payment-' + committed.size, amount: '20' }] });
      return json(committed.get(key), 201);
    }
    if (url.endsWith('/workspace')) return saved ? unavailable() : json(workspace([booking]));
  };
  const first = await mount(request, { storage });
  let paymentId;
  try { paymentId = (await first.run(pms => pms.addPayment(booking.id, { amount: '20' }, 'payment-intent'))).payments[0].id; }
  finally { await first.close(); }
  const reloaded = await mount(request, { storage });
  try {
    assert.equal(reloaded.value.writeReceipt.id, booking.id);
    const result = await reloaded.run(pms => pms.addPayment(booking.id, { amount: '20' }, 'new-payment-form'));
    assert.equal(result.payments[0].id, paymentId);
    assert.deepEqual(keys, ['payment-intent', 'payment-intent']);
    assert.equal(committed.size, 1);
    assert.equal(reloaded.value.bookings[0].payments.length, 1);
  } finally { await reloaded.close(); }
});

test('a read preceding a payment retry cannot clear its key when the retry response is lost', async () => {
  const read = Promise.withResolvers(), retryResponse = Promise.withResolvers(), keys = [];
  const paid = { ...booking, paid: '20', balance: '80', payments: [{ id: 'payment-42', amount: '20' }] };
  let writes = 0, manualRead = false, manual, retry;
  const mounted = await mount((url, options) => {
    if (options.method === 'POST') {
      keys.push(options.headers['Idempotency-Key']);
      return ++writes === 2 ? retryResponse.promise : json(paid, 201);
    }
    if (url.endsWith('/workspace')) {
      if (manualRead) { manualRead = false; return read.promise; }
      return writes ? unavailable() : json(workspace([booking]));
    }
  });
  try {
    await mounted.run(pms => pms.addPayment(booking.id, { amount: '20' }, 'original-payment'));
    await act(async () => { manualRead = true; manual = mounted.value.refreshWorkspace({ quiet: true }); });
    await act(async () => {
      retry = mounted.value.addPayment(booking.id, { amount: '20' }, 'retry-form');
      await waitFor(() => writes === 2);
    });
    let applied;
    await act(async () => { read.resolve(json(workspace([paid]))); applied = await manual; });
    assert.equal(applied, false);
    assert.equal(storedIntents(mounted.storage)[0].key, 'original-payment');
    await act(async () => {
      retryResponse.reject(new TypeError('Retry response lost'));
      await assert.rejects(retry, /Retry response lost/);
    });
    await mounted.run(pms => pms.addPayment(booking.id, { amount: '20' }, 'next-form'));
    assert.deepEqual(keys, ['original-payment', 'original-payment', 'original-payment']);
    assert.equal(mounted.value.bookings[0].payments.length, 1);
  } finally { read.resolve(unavailable()); retryResponse.resolve(json(paid, 201)); await mounted.close(); }
});

test('a malformed payment response retains its retry key across refreshes and never reports success', async () => {
  for (const body of ['{"id":"booking-42",', 'null', 'false', '123', '"invalid"']) {
    const keys = [], committed = new Map();
    let malformed = true;
    const mounted = await mount((url, options) => {
      if (options.method === 'POST') {
        const key = options.headers['Idempotency-Key']; keys.push(key);
        if (!committed.has(key)) committed.set(key, { ...booking, paid: '20', balance: '80', payments: [{ id: 'payment-' + committed.size, amount: '20' }] });
        return malformed ? new Response(body, { status: 201 }) : json(committed.get(key), 201);
      }
      if (url.endsWith('/workspace')) return json(workspace([...committed.values()]));
    });
    try {
      await mounted.run(pms => assert.rejects(pms.addPayment(booking.id, { amount: '20' }, 'original-payment'), error => error.code === 'invalid_response'));
      assert.equal(mounted.value.writeReceipt, null);
      await mounted.run(pms => pms.refreshWorkspace());
      malformed = false;
      const result = await mounted.run(pms => pms.addPayment(booking.id, { amount: '20' }, 'retry-form'));
      assert.equal(result.payments[0].id, 'payment-0');
      assert.deepEqual(keys, ['original-payment', 'original-payment']);
      assert.equal(committed.size, 1);
    } finally { await mounted.close(); }
  }
});

test('superseded refreshes cannot mark a committed write synchronized or discard its intent', async () => {
  const reads = [], saved = Promise.withResolvers();
  let writeStarted = false, operation, manual;
  const mounted = await mount((url, options) => {
    if (options.method === 'POST') { writeStarted = true; return saved.promise; }
    if (url.endsWith('/workspace') && writeStarted) { const read = Promise.withResolvers(); reads.push(read); return read.promise; }
  });
  try {
    await act(async () => {
      operation = mounted.value.createBooking({ rooms: ['101'] }, 'original');
      await waitFor(() => writeStarted);
      saved.resolve(json(booking, 201));
      await waitFor(() => reads.length === 1);
    });
    await act(async () => { manual = mounted.value.refreshWorkspace({ quiet: true }).catch(() => {}); });
    await act(async () => { reads[0].resolve(json(workspace([booking]))); await operation; });
    assert.equal(mounted.value.writeReceipt.synchronized, false);
    assert.equal(storedIntents(mounted.storage)[0].key, 'original');
    await act(async () => { reads[1].resolve(unavailable()); await manual; });
    assert.equal(mounted.value.writeReceipt.synchronized, false);
  } finally { for (const read of reads) read.resolve(unavailable()); await mounted.close(); }
});

test('a later applied refresh reconciles an unkeyed saved write', async () => {
  let saved = false, failRefresh = true;
  const mounted = await mount((url, options) => {
    if (options.method === 'PATCH') { saved = true; return json({ id: 'settings' }); }
    if (url.endsWith('/workspace') && saved) return failRefresh ? unavailable() : json(workspace());
  });
  try {
    assert.equal((await mounted.run(pms => pms.saveSettings({ name: 'Updated hotel' }))).id, 'settings');
    assert.equal(mounted.value.writeReceipt.intent, null);
    assert.equal(mounted.value.writeReceipt.synchronized, false);
    failRefresh = false;
    await mounted.run(pms => pms.refreshWorkspace({ quiet: true }));
    assert.equal(mounted.value.writeReceipt.synchronized, true);
  } finally { await mounted.close(); }
});

test('a refresh blocked before applying cannot reconcile a saved write', async () => {
  let saved = false, failRefresh = true;
  const mounted = await mount((url, options) => {
    if (options.method === 'POST') { saved = true; return json(booking, 201); }
    if (url.endsWith('/workspace') && saved) return failRefresh ? unavailable() : json(workspace([booking]));
  });
  try {
    await mounted.run(pms => pms.createBooking({ rooms: ['101'] }, 'booking-intent'));
    failRefresh = false;
    assert.equal(await mounted.run(pms => pms.refreshWorkspace({ quiet: true, canApply: () => false })), false);
    assert.equal(mounted.value.writeReceipt.synchronized, false);
    assert.equal(storedIntents(mounted.storage)[0].key, 'booking-intent');
  } finally { await mounted.close(); }
});

test('a committed booking remains successful after switching tenants and its receipt stays with its tenant', async () => {
  const other = { id: 'other-hotel', name: 'Other hotel', status: 'ACTIVE' };
  const identity = { ...session, tenants: [hotel, other], user: { ...session.user, memberships: [...session.user.memberships, { tenantId: other.id, role: 'HOTEL_OWNER' }] } };
  const write = Promise.withResolvers();
  let writeStarted = false, operation;
  const mounted = await mount((url, options) => {
    if (options.method === 'POST') { writeStarted = true; return write.promise; }
    if (url.endsWith('/workspace')) return url.includes(other.id) ? json(workspace([], other)) : writeStarted ? unavailable() : json(workspace());
  }, { identity });
  try {
    await act(async () => { operation = mounted.value.createBooking({ rooms: ['101'] }, 'booking-intent'); await waitFor(() => writeStarted); });
    await mounted.run(pms => pms.selectTenant(other.id));
    let result;
    await act(async () => { write.resolve(json(booking, 201)); result = await operation; });
    assert.equal(result.id, booking.id);
    assert.equal(mounted.value.tenantId, other.id);
    assert.equal(mounted.value.writeReceipt, null);
    assert.deepEqual(mounted.value.bookings, []);
    await mounted.run(pms => pms.selectTenant(hotel.id));
    assert.equal(mounted.value.writeReceipt.id, booking.id);
    assert.equal(mounted.value.writeReceipt.tenantId, hotel.id);
    assert.equal(mounted.value.writeReceipt.synchronized, false);
  } finally { write.resolve(json(booking, 201)); await mounted.close(); }
});

test('a replayed booking snapshot cannot remove a newer payment, charge, note or refund', async () => {
  let saved = false;
  const paid = { ...booking, paid: '20', balance: '80', payments: [{ id: 'payment', refunds: [{ id: 'refund' }] }], charges: [{ id: 'charge' }], notes: [{ id: 'note' }] };
  const mounted = await mount((url, options) => {
    if (options.method === 'POST') { saved = true; return json(url.endsWith('/payments') ? paid : booking, 201); }
    if (url.endsWith('/workspace') && saved) return unavailable();
  });
  try {
    await mounted.run(pms => pms.createBooking({ rooms: ['101'] }, 'booking-intent'));
    await mounted.run(pms => pms.addPayment(booking.id, { amount: '20' }, 'payment-intent'));
    await mounted.run(pms => pms.createBooking({ rooms: ['101'] }, 'new-form'));
    assert.equal(mounted.value.bookings[0].paid, '20');
    assert.equal(mounted.value.bookings[0].payments[0].refunds[0].id, 'refund');
    assert.equal(mounted.value.bookings[0].charges[0].id, 'charge');
    assert.equal(mounted.value.bookings[0].notes[0].id, 'note');
  } finally { await mounted.close(); }
});

test('replaying a payment snapshot cannot remove a later refund on the same payment', async () => {
  const paid = { ...booking, paid: '20', balance: '80', payments: [{ id: 'payment', refunds: [] }] };
  const refunded = { ...paid, paid: '15', balance: '85', payments: [{ id: 'payment', refunds: [{ id: 'refund', amount: '5' }] }] };
  let saved = false;
  const mounted = await mount((url, options) => {
    if (options.method === 'POST') { saved = true; return json(paid, 201); }
    if (url.endsWith('/workspace')) return saved ? unavailable() : json(workspace([refunded]));
  });
  try {
    await mounted.run(pms => pms.addPayment(booking.id, { amount: '20' }, 'old-payment-intent'));
    assert.equal(mounted.value.bookings[0].paid, '15');
    assert.equal(mounted.value.bookings[0].payments[0].refunds[0].id, 'refund');
  } finally { await mounted.close(); }
});

test('successful tenant and membership writes do not fail when identity synchronization fails', async () => {
  let saved = false;
  const mounted = await mount((url, options) => {
    if (url === '/api/auth/session' && saved) return unavailable();
    if (options.method !== 'GET') { saved = true; return json({ id: 'updated' }); }
  });
  try {
    assert.equal((await mounted.run(pms => pms.saveTenant({ id: hotel.id, name: 'Updated' }))).id, 'updated');
    assert.equal(mounted.value.accessDialog, null);
    assert.equal((await mounted.run(pms => pms.saveTenantUser({ id: 'user', role: 'FRONT_DESK', active: true }))).id, 'updated');
    assert.equal(mounted.value.accessDialog, null);
    assert.equal(mounted.value.workspaceSyncError, 'Service unavailable');
  } finally { await mounted.close(); }
});

test('successful plan and subscription writes do not fail when workspace synchronization fails', async () => {
  let saved = false;
  const mounted = await mount((url, options) => {
    if (options.method !== 'GET') { saved = true; return json({ id: 'updated' }); }
    if (url.endsWith('/workspace') && saved) return unavailable();
  });
  try {
    assert.equal((await mounted.run(pms => pms.savePlan({ id: 'plan', name: 'Updated' }))).id, 'updated');
    assert.equal((await mounted.run(pms => pms.saveTenantSubscription(hotel.id, { planId: 'plan' }))).id, 'updated');
    assert.equal(mounted.value.accessDialog, null);
    assert.equal(mounted.value.loadError, '');
    assert.equal(mounted.value.workspaceSyncError, 'Service unavailable');
  } finally { await mounted.close(); }
});

test('a committed booking remains successful when its refresh detects revoked hotel access', async () => {
  let saved = false;
  const identity = { ...session, user: { ...session.user, globalRole: 'SUPER_ADMIN' } };
  const mounted = await mount((url, options) => {
    if (url === '/api/audit') return json({ logs: [] });
    if (options.method === 'POST') { saved = true; return json(booking, 201); }
    if (url.endsWith('/workspace') && saved) return json({ error: { code: 'tenant_denied', message: 'Hotel access revoked' } }, 403);
  }, { identity });
  try {
    const result = await mounted.run(pms => pms.createBooking({ rooms: ['101'] }, 'booking-intent'));
    assert.equal(result.id, booking.id);
    assert.deepEqual(mounted.value.bookings, []);
    assert.deepEqual(mounted.value.hotels, []);
    assert.equal(mounted.value.tenantId, null);
    assert.equal(mounted.value.writeReceipt, null);
    assert.equal(mounted.value.workspaceLoading, false);
    assert.equal(storedIntents(mounted.storage)[0].resultId, booking.id);
  } finally { await mounted.close(); }
});

test('provider preserves the editable workspace after save and reload API failures', async () => {
  await withDraftDom(async ({ React, act, load, mount }) => {
    const previousFetch = globalThis.fetch;
    const session = {
      csrfToken: 'csrf',
      user: { id: 'user-a', globalRole: 'USER', memberships: [{ tenantId: 'hotel-a', role: 'FRONT_DESK' }] },
      tenants: [{ id: 'hotel-a', name: 'Hotel A', status: 'ACTIVE' }],
    };
    const workspace = { tenant: session.tenants[0], bookings: [{ id: 'booking-a', guestName: 'Server guest' }] };
    let failWorkspace = false;
    let failWrite = false;
    let quoteResponse;
    let writeResponse;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/auth/session') return Response.json(session);
      if (url === '/api/force401') return Response.json({ error: { message: 'Session expired' } }, { status: 401 });
      if (url.endsWith('/quote')) return quoteResponse.promise;
      if (url.endsWith('/workspace')) return failWorkspace ? Response.json({ error: { message: 'Workspace unavailable' } }, { status: 503 }) : Response.json(workspace);
      if (url.endsWith('/reservations/booking-a')) return writeResponse ? writeResponse.promise : failWrite ? Response.json({ error: { message: 'Save rejected' } }, { status: 422 }) : Response.json({ id: 'booking-a' });
      throw new Error('Unexpected request: ' + url);
    };
    try {
      const { PmsProvider } = await load('/src/apps/pms/data/PmsProvider.jsx');
      const { usePms } = await load('/src/apps/pms/data/usePms.js');
      const { DraftGuardProvider, useDraftGuard, useDraftNavigation } = await load('/src/shared/drafts/DraftGuardProvider.jsx');
      let pms;
      let navigation;
      let formPending = false;
      let formDraft = null;
      function EditableForm({ guestName }) {
        useDraftGuard({ dirty: () => Boolean(formDraft), pending: () => formPending, onDiscard: () => { formDraft = null; } });
        return React.createElement('div', null, guestName);
      }
      function Probe() {
        pms = usePms();
        navigation = useDraftNavigation();
        // LayoutGuard mounts forms only after session restoration. Keep this
        // observer mounted so logout assertions also see the cleared context.
        return pms.user && !pms.loading ? React.createElement(EditableForm, { guestName: pms.bookings[0]?.guestName }) : null;
      }
      const view = await mount(React.createElement(DraftGuardProvider, null, React.createElement(PmsProvider, null, React.createElement(Probe))));
      assert.equal(view.container.textContent, 'Server guest');
      assert.equal(pms.loadError, '');

      failWrite = true;
      await act(async () => { await assert.rejects(pms.updateBooking('booking-a', { guestName: 'Edited guest' }), error => error.status === 422); });
      assert.equal(pms.bookings[0].guestName, 'Server guest');
      assert.equal(pms.loadError, '');
      assert.equal(pms.pendingRequests.writes, 0);

      failWrite = false;
      failWorkspace = true;
      await act(async () => { assert.equal((await pms.updateBooking('booking-a', { guestName: 'Edited guest' })).id, 'booking-a'); });
      assert.equal(JSON.parse(requests.findLast(request => request.url.endsWith('/reservations/booking-a')).options.body).guestName, 'Edited guest');
      assert.equal(view.container.textContent, 'Server guest');
      assert.equal(pms.loadError, '');
      assert.equal(pms.workspaceSyncError, 'Workspace unavailable');
      assert.equal(pms.workspaceLoading, false);
      assert.equal(pms.writeReceipt.id, 'booking-a');
      assert.equal(pms.writeReceipt.synchronized, false);

      await act(async () => { await assert.rejects(pms.refreshWorkspace(), error => error.status === 503); });
      assert.equal(pms.bookings[0].guestName, 'Server guest');
      assert.equal(pms.loadError, '');

      quoteResponse = Promise.withResolvers();
      let quote;
      await act(async () => { quote = pms.quote({ roomId: '101' }); });
      assert.equal(pms.pendingRequests.reads, 1);
      assert.equal(pms.pendingRequests.writes, 0);
      let left = false;
      assert.equal(navigation.requestLeave(() => { left = true; }), true);
      assert.equal(left, true);
      quoteResponse.resolve(Response.json({ total: 100 }));
      await act(async () => { await quote; });

      failWorkspace = false;
      writeResponse = Promise.withResolvers();
      const previousRequestCount = requests.length;
      let writeOutcome;
      await act(async () => {
        writeOutcome = pms.updateBooking('booking-a', { guestName: 'Edited guest' });
        await waitFor(() => requests.length > previousRequestCount);
      });
      assert.equal(pms.pendingRequests.writes, 1);
      left = false;
      await act(async () => { assert.equal(navigation.requestLeave(() => { left = true; }), false); });
      assert.equal(left, false);
      assert.equal(navigation.getSnapshot().confirmation.pending, true);

      // An expired session must clear form memory and release every old-scope
      // guard, including a still-pending form write, so login can be reached.
      formPending = true;
      formDraft = 'Private guest draft';
      await act(async () => { await assert.rejects(pms.requestSystem('/api/force401'), error => error.status === 401); });
      assert.equal(pms.user, null);
      assert.deepEqual(pms.bookings, []);
      assert.equal(formDraft, null);
      assert.equal(navigation.hasBlockers(), false);
      assert.equal(navigation.requestLeave(() => { left = true; }), true);
      assert.equal(left, true);
      writeResponse.resolve(Response.json({ id: 'booking-a' }));
      await act(async () => { assert.equal((await writeOutcome).id, 'booking-a'); });
      assert.equal(pms.user, null);
      assert.equal(pms.writeReceipt, null);
      assert.deepEqual(pms.bookings, []);
      assert.equal(navigation.hasBlockers(), false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('system hotel pickers require membership and active sessions drop revoked hotel data', async () => {
  await withDraftDom(async ({ React, act, load, mount, window }) => {
    const previousFetch = globalThis.fetch;
    const { PmsProvider } = await load('/src/apps/pms/data/PmsProvider.jsx');
    const { usePms } = await load('/src/apps/pms/data/usePms.js');
    const { DraftGuardProvider } = await load('/src/shared/drafts/DraftGuardProvider.jsx');
    try {
      for (const globalRole of ['SUPER_ADMIN', 'SYSTEM_MANAGER']) {
        let pms;
        let session = {
          csrfToken: 'csrf',
          user: { id: globalRole, globalRole, memberships: [{ tenantId: 'hotel-a', role: 'FRONT_DESK', active: true }, { tenantId: 'hotel-b', role: 'HOTEL_OWNER', active: false }] },
          tenants: [{ id: 'hotel-a', status: 'active' }, { id: 'hotel-b', status: 'active' }],
        };
        let sessionReads = 0;
        globalThis.fetch = async url => {
          if (url === '/api/auth/session') { sessionReads += 1; return Response.json(session); }
          if (url === '/api/tenants') return Response.json({ tenants: session.tenants });
          if (url === '/api/audit') return Response.json({ logs: [] });
          if (url === '/api/tenants/hotel-a/workspace') return Response.json({ tenant: session.tenants[0], bookings: [{ id: 'booking-a', guestName: 'Private guest' }] });
          if (url === '/api/admin/channex/tenants/hotel-b/workspace') return Response.json({ tenant: session.tenants[1] });
          throw new Error('Unexpected request: ' + url);
        };
        function Probe() { pms = usePms(); return React.createElement('output', null, pms.bookings[0]?.guestName || 'No hotel data'); }
        const view = await mount(React.createElement(DraftGuardProvider, null, React.createElement(PmsProvider, null, React.createElement(Probe))));
        assert.deepEqual(pms.hotels.map(hotel => hotel.id), ['hotel-a']);
        assert.equal(pms.role, 'FRONT_DESK');
        assert.equal(view.container.textContent, 'Private guest');
        assert.equal(pms.routeAccess('/id/reports').reason, 'role');
        assert.equal(pms.routeAccess('/manager/tenants/hotel-b/ota').allowed, true);
        assert.equal((await pms.requestManagedTenant('hotel-b', '/workspace')).tenant.id, 'hotel-b');
        await act(async () => { assert.throws(() => pms.selectTenant('hotel-b'), /không có quyền/); });
        session = { ...session, user: { ...session.user, memberships: [] }, tenants: [] };
        await act(async () => { window.dispatchEvent(new window.Event('focus')); });
        assert.equal(sessionReads, 2);
        assert.deepEqual(pms.hotels, []);
        assert.deepEqual(pms.bookings, []);
        assert.equal(pms.tenantId, null);
        assert.equal(pms.workspaceLoading, false);
        assert.equal(pms.routeAccess('/id/reservations').reason, 'tenant');
        assert.equal(pms.routeAccess('/manager/dashboard').allowed, true);
        assert.equal(view.container.textContent, 'No hotel data');
        await view.unmount();
      }
    } finally { globalThis.fetch = previousFetch; }
  });
});

test('a revoked tenant API response clears cached workspace instead of preserving it as a failed refresh', async () => {
  await withDraftDom(async ({ React, act, load, mount }) => {
    const previousFetch = globalThis.fetch;
    const session = { csrfToken: 'csrf', user: { id: 'admin', globalRole: 'SUPER_ADMIN', memberships: [{ tenantId: 'hotel-a', role: 'HOTEL_OWNER', active: true }] }, tenants: [{ id: 'hotel-a', status: 'active' }] };
    let revoked = false;
    globalThis.fetch = async url => {
      if (url === '/api/auth/session') return Response.json(session);
      if (url === '/api/tenants') return Response.json({ tenants: session.tenants });
      if (url === '/api/audit') return Response.json({ logs: [] });
      if (url.endsWith('/workspace')) return revoked
        ? Response.json({ error: { code: 'tenant_denied', message: 'Access revoked' } }, { status: 403 })
        : Response.json({ tenant: session.tenants[0], bookings: [{ id: 'booking-a', guestName: 'Private guest' }] });
      throw new Error('Unexpected request: ' + url);
    };
    try {
      const { PmsProvider } = await load('/src/apps/pms/data/PmsProvider.jsx');
      const { usePms } = await load('/src/apps/pms/data/usePms.js');
      const { DraftGuardProvider } = await load('/src/shared/drafts/DraftGuardProvider.jsx');
      let pms;
      function Probe() { pms = usePms(); return null; }
      await mount(React.createElement(DraftGuardProvider, null, React.createElement(PmsProvider, null, React.createElement(Probe))));
      assert.equal(pms.bookings.length, 1);
      revoked = true;
      await act(async () => { await assert.rejects(pms.refreshWorkspace(), error => error.status === 403); });
      assert.deepEqual(pms.bookings, []);
      assert.deepEqual(pms.hotels, []);
      assert.equal(pms.tenantId, null);
      assert.equal(pms.workspaceLoading, false);
    } finally { globalThis.fetch = previousFetch; }
  });
});
