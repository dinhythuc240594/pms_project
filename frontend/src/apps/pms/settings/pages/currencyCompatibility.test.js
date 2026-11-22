import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRouter } from 'react-router-dom';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

const context = overrides => ({
  tenantId: 'hotel-a', user: { id: 'owner-a' }, workspaceRevision: 1,
  settings: { name: 'Hotel JPY', currency: 'JPY', timezone: 'Asia/Ho_Chi_Minh' },
  access: () => ({ allowed: true }), routeAccess: () => ({ allowed: true }),
  ...overrides,
});

test('a hotel profile shows its base currency read-only and excludes it when saving other information', async () => {
  await withDraftDom(async ({ React, load, mount, click, input }) => {
    const { BusinessProfile } = await load('/src/apps/pms/settings/pages/BusinessSettings.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    for (const currency of ['VND', 'EUR', 'JPY']) {
      const saved = [];
      const value = context({ settings: { name: 'Hotel', currency, timezone: 'Asia/Ho_Chi_Minh' }, saveSettings: async draft => { saved.push(draft); return draft; } });
      const view = await mount(React.createElement(PmsContext.Provider, { value }, React.createElement(BusinessProfile)));
      const field = view.container.querySelector('input[readonly]');
      assert.ok(field);
      assert.equal(field.value, currency);
      assert.equal(field.readOnly, true);
      await input(view.container.querySelector('input[required]'), 'Updated hotel');
      await click(view.container.querySelector('[type="submit"]'));
      assert.equal(saved.length, 1);
      assert.equal(saved[0].name, 'Updated hotel');
      assert.equal(Object.hasOwn(saved[0], 'currency'), false);
      assert.equal(field.value, currency);
      await view.unmount();
    }
  });
});

test('new funds default to the hotel base and can choose another supported currency', async () => {
  await withDraftDom(async ({ React, load, mount, click, input }) => {
    const { default: Settings } = await load('/src/apps/pms/settings/pages/Settings.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const saved = [];
    const value = context({ funds: [], paymentMethods: [], saveMaster: async (...args) => saved.push(args) });
    const view = await mount(React.createElement(MemoryRouter, { initialEntries: ['/id/settings?section=accounting&tab=payments'] }, React.createElement(PmsContext.Provider, { value }, React.createElement(Settings))));
    const funds = view.container.querySelectorAll('.pms-catalog')[1];
    await click(funds.querySelector('.pms-catalog-heading button'));
    const form = funds.querySelector('form'), selects = form.querySelectorAll('select');
    assert.equal(selects[1].value, 'JPY');
    assert.ok([...selects[1].options].some(option => option.value === 'EUR'));
    await input(form.querySelector('input'), 'EUR cash');
    await input(selects[0], 'cash');
    await input(selects[1], 'EUR');
    await click(form.querySelector('[type="submit"]'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0][0], 'funds');
    assert.equal(saved[0][1].currency, 'EUR');
  });
});

test('exchange rates offer every supported foreign code while preserving eight decimal input', async () => {
  await withDraftDom(async ({ React, load, mount, click, input }) => {
    const { default: ExchangeRates } = await load('/src/apps/pms/rates-inventory/pages/ExchangeRates.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const saved = [];
    const value = context({ requestTenant: async () => ({ exchangeRates: [] }), saveExchangeRate: async draft => saved.push(draft) });
    const view = await mount(React.createElement(PmsContext.Provider, { value }, React.createElement(ExchangeRates)));
    const select = view.container.querySelector('select');
    assert.equal(select.options.length, 19);
    assert.ok(![...select.options].some(option => option.value === 'JPY'));
    await input(select, 'EUR');
    await input(view.container.querySelector('input[type="number"]'), '162.12345678');
    await click(view.container.querySelector('[type="submit"]'));
    assert.deepEqual(saved, [{ currency: 'EUR', rate: '162.12345678' }]);
  });
});

test('cashbook links retain an extended currency instead of replacing it with hotel base', async () => {
  await withDraftDom(async ({ React, load, mount }) => {
    const { default: Cashflow } = await load('/src/apps/pms/finance/pages/Cashflow.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const requests = [];
    const value = context({ funds: [], users: [], cashDocuments: [], ledger: [], getCashbook: async filters => {
      requests.push(filters);
      return { summary: { currency: filters.currency, opening: '0', income: '0', outflow: '0', closing: '0' }, ledger: [], cashDocuments: [], fundBalances: [], pagination: { totalItems: 0 } };
    } });
    const view = await mount(React.createElement(MemoryRouter, { initialEntries: ['/id/cashflow/cash?currency=EUR'] }, React.createElement(PmsContext.Provider, { value }, React.createElement(Cashflow))));
    const currency = [...view.container.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'EUR'));
    assert.equal(currency.value, 'EUR');
    assert.equal(requests.at(-1).currency, 'EUR');
  });
});
