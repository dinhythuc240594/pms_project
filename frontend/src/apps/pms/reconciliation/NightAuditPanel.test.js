import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../shared/drafts/testDom.js';

const preview = { previewToken: 'night-token-a', periodLocked: false, timezone: 'Asia/Ho_Chi_Minh', totals: [{ amount: '100', currency: 'VND', baseAmount: '100', baseCurrency: 'VND' }], blockers: [], entries: [] };
const context = overrides => ({ tenantId: 'hotel-a', user: { id: 'owner-a' }, authGeneration: 1, settings: { timezone: 'Asia/Ho_Chi_Minh' }, access: () => ({ allowed: true }), ...overrides });

test('invalid typed audit dates block reloading and closing the previously selected date', async () => {
  await withDraftDom(async tools => {
    const { React, load, mount, input, click } = tools;
    const { default: NightAuditPanel } = await load('/src/apps/pms/reconciliation/NightAuditPanel.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const requests = [];
    const value = context({ requestTenant: async (...args) => { requests.push(args); return preview; } });
    const view = await mount(React.createElement(PmsContext.Provider, { value }, React.createElement(NightAuditPanel)));
    await input(view.container.querySelector('input[type="text"]'), '31/02/2026');
    const before = requests.length;
    const reload = view.container.querySelector('.day-reconciliation-filter > button');
    assert.equal(reload.disabled, true);
    await click(reload);
    assert.equal(requests.length, before);
    assert.equal(view.container.querySelector('form'), null);
  });
});

async function reasonInput({ act, window }, element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function flush(act) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
}

test('Night Audit presents blockers and prevents closing a day until they are resolved', async () => {
  await withDraftDom(async tools => {
    const { React, act, window, load, mount, click } = tools;
    const { default: NightAuditPanel } = await load('/src/apps/pms/reconciliation/NightAuditPanel.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const writes = [];
    const value = context({ requestTenant: async (url, options) => { if (options?.method === 'POST') writes.push(options); return { ...preview, blockers: [{ bookingId: 'late-stay', guest: 'Unresolved arrival', status: 'CONFIRMED' }] }; } });
    const view = await mount(React.createElement(PmsContext.Provider, { value }, React.createElement(NightAuditPanel)));
    assert.match(view.container.textContent, /Unresolved arrival/);
    await reasonInput(tools, view.container.querySelector('textarea'), 'Checked balances');
    await click(view.container.querySelector('input[type="checkbox"]'));
    const button = [...view.container.querySelectorAll('button')].find(item => item.textContent === 'Chốt ngày và ghi doanh thu');
    assert.equal(button.disabled, true);
    await act(async () => view.container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await flush(act);
    assert.equal(writes.length, 0);
  });
});

test('Night Audit retries the same intent, prevents in-flight duplicates, and preserves a successful close after refresh failure', async () => {
  await withDraftDom(async tools => {
    const { React, act, load, mount, click } = tools;
    const { default: NightAuditPanel } = await load('/src/apps/pms/reconciliation/NightAuditPanel.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const pending = Promise.withResolvers(), writes = [];
    let refreshes = 0;
    const value = context({ requestTenant: (url, options) => {
      if (options?.method !== 'POST') return Promise.resolve(preview);
      writes.push({ url, ...options });
      return writes.length === 1 ? Promise.reject(new Error('Network timeout')) : pending.promise;
    }, refreshWorkspace: async () => { refreshes++; throw new Error('Refresh unavailable'); } });
    const view = await mount(React.createElement(PmsContext.Provider, { value }, React.createElement(NightAuditPanel)));
    const button = () => [...view.container.querySelectorAll('button')].find(item => item.textContent === 'Chốt ngày và ghi doanh thu');
    assert.equal(button().disabled, true);
    await reasonInput(tools, view.container.querySelector('textarea'), 'Room and cash reviewed');
    assert.equal(button().disabled, true);
    await click(view.container.querySelector('input[type="checkbox"]'));
    await click(button()); await flush(act);
    assert.equal(writes.length, 1);
    assert.match(view.container.querySelector('[role="alert"]').textContent, /Network timeout/);
    assert.equal(view.container.querySelector('textarea').value, 'Room and cash reviewed');
    assert.equal(view.container.querySelector('input[type="checkbox"]').checked, true);
    await click(button()); await flush(act);
    const submitting = view.container.querySelector('button[type="submit"]');
    await click(submitting); await flush(act);
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(writes[0].body.previewToken, 'night-token-a');
    assert.equal(writes[0].body.reason, 'Room and cash reviewed');
    assert.ok(writes[0].intent);
    await act(async () => pending.resolve({ ...preview, periodLocked: true }));
    assert.equal(refreshes, 1);
    assert.match(view.container.textContent, /Đã chốt ngày/);
    assert.ok(!view.container.textContent.includes('Refresh unavailable'));
    assert.equal(view.container.querySelector('form'), null);
    assert.equal(writes.length, 2);
  });
});

test('A late Night Audit read cannot overwrite the next hotel preview', async () => {
  await withDraftDom(async tools => {
    const { React, act, load, mount } = tools;
    const { default: NightAuditPanel } = await load('/src/apps/pms/reconciliation/NightAuditPanel.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const pending = Promise.withResolvers();
    let switchHotel;
    function Host() {
      const [hotel, setHotel] = React.useState('hotel-a');
      React.useEffect(() => { switchHotel = setHotel; }, []);
      const value = context({ tenantId: hotel, requestTenant: () => hotel === 'hotel-a' ? pending.promise : Promise.resolve({ ...preview, timezone: 'Pacific/Kiritimati' }) });
      return React.createElement(PmsContext.Provider, { value }, React.createElement(NightAuditPanel));
    }
    const view = await mount(React.createElement(Host));
    await act(async () => switchHotel('hotel-b'));
    assert.match(view.container.textContent, /Pacific\/Kiritimati/);
    await act(async () => pending.resolve({ ...preview, timezone: 'PRIVATE-A-TIMEZONE' }));
    assert.ok(!view.container.textContent.includes('PRIVATE-A-TIMEZONE'));
    assert.match(view.container.textContent, /Pacific\/Kiritimati/);
  });
});

test('A Night Audit write completing after scope change cannot retain the old draft or leave the new hotel stuck', async () => {
  await withDraftDom(async tools => {
    const { React, act, load, mount, click } = tools;
    const { default: NightAuditPanel } = await load('/src/apps/pms/reconciliation/NightAuditPanel.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const pending = Promise.withResolvers(), writes = [];
    let switchHotel, refreshed = 0;
    function Host() {
      const [hotel, setHotel] = React.useState('hotel-a');
      React.useEffect(() => { switchHotel = setHotel; }, []);
      const value = context({ tenantId: hotel, requestTenant: (url, options) => {
        if (options?.method === 'POST') { writes.push(hotel); return pending.promise; }
        return Promise.resolve({ ...preview, timezone: hotel });
      }, refreshWorkspace: async () => { refreshed++; } });
      return React.createElement(PmsContext.Provider, { value }, React.createElement(NightAuditPanel));
    }
    const view = await mount(React.createElement(Host));
    await reasonInput(tools, view.container.querySelector('textarea'), 'PRIVATE HOTEL A NOTE');
    await click(view.container.querySelector('input[type="checkbox"]'));
    await click([...view.container.querySelectorAll('button')].find(item => item.textContent === 'Chốt ngày và ghi doanh thu'));
    await flush(act);
    assert.deepEqual(writes, ['hotel-a']);
    await act(async () => switchHotel('hotel-b'));
    await act(async () => pending.resolve({ ...preview, periodLocked: true }));
    assert.equal(view.container.querySelector('textarea').value, '');
    assert.equal(view.container.querySelector('textarea').disabled, false);
    assert.equal(view.container.querySelector('input[type="date"]').disabled, false);
    assert.ok(!view.container.textContent.includes('Đã chốt ngày.'));
    assert.equal(refreshed, 0);
  });
});
