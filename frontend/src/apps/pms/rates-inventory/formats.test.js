import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRouter } from 'react-router-dom';
import { withDraftDom } from '../../../shared/drafts/testDom.js';

async function withPage(file, overrides, check) {
  await withDraftDom(async tools => {
    const { React, load, mount } = tools;
    const { default: Page } = await load(file);
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const context = {
      tenantId: 'hotel-a', user: { id: 'owner' }, settings: { currency: 'VND', timezone: 'UTC' },
      rooms: [{ id: '101', active: true }], roomTypes: [{ id: 'type-a', name: 'Deluxe', price: '100' }], roomBlocks: [],
      access: () => ({ allowed: true }), routeAccess: () => ({ allowed: true }),
      requestTenant: async () => ({ rates: [], availability: [], exchangeRates: [], rules: [], promotions: [], vouchers: [] }),
      ...overrides,
    };
    const view = await mount(React.createElement(MemoryRouter, null, React.createElement(PmsContext.Provider, { value: context }, React.createElement(Page))));
    const submit = form => tools.act(async () => form.dispatchEvent(new tools.window.Event('submit', { bubbles: true, cancelable: true })));
    await check({ ...tools, ...view, submit });
  });
}

test('base rates reject exponent prices before saving and retain the exact maximum decimal', async () => {
  const saved = [];
  await withPage('/src/apps/pms/rates-inventory/pages/Rates.jsx', { saveMaster: async (...args) => saved.push(args) }, async ({ container, input, submit }) => {
    const field = container.querySelector('form input');
    await input(field, '1e3');
    await submit(field.closest('form'));
    assert.equal(saved.length, 0);
    await input(field, '999999999999999.9999');
    await submit(field.closest('form'));
    assert.equal(saved[0][1].price, '999999999999999.9999');
  });
});

test('nightly rates use day-first dates and block actions while an outside-form date draft is invalid', async () => {
  const saved = [];
  await withPage('/src/apps/pms/rates-inventory/pages/NightlyRates.jsx', { saveRate: async value => saved.push(value) }, async ({ container, input, submit }) => {
    const date = container.querySelector('[aria-label="Giá từ ngày"]'), price = container.querySelector('[aria-label="Giá từng đêm"]');
    assert.match(date.value, /^\d{2}\/\d{2}\/\d{4}$/);
    await input(price, '123.4500');
    await input(date, '31/02/2026');
    assert.equal(date.checkValidity(), false);
    await submit(price.closest('form'));
    assert.equal(saved.length, 0);
    await input(date, '01/02/2028');
    await input(container.querySelector('[aria-label="Giá đến ngày"]'), '02/02/2028');
    await submit(price.closest('form'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].start, '2028-02-01');
    assert.equal(saved[0].price, '123.4500');
  });
});

test('exchange rates reject exponent or excess precision and preserve eight decimal places', async () => {
  const saved = [];
  await withPage('/src/apps/pms/rates-inventory/pages/ExchangeRates.jsx', { saveExchangeRate: async value => saved.push(value) }, async ({ container, input, submit }) => {
    const field = container.querySelector('form input');
    for (const value of ['1e3', '1.000000001', '0']) {
      await input(field, value);
      await submit(field.closest('form'));
      assert.equal(saved.length, 0, value);
    }
    await input(field, '99999999999.99999999');
    await submit(field.closest('form'));
    assert.equal(saved[0].rate, '99999999999.99999999');
  });
});

test('pricing integer fields reject exponent notation and signed percentage values stay exact', async () => {
  const saved = [];
  await withPage('/src/apps/pms/rates-inventory/pages/PricingManagement.jsx', { savePricing: async (...args) => saved.push(args) }, async ({ container, input, click, submit }) => {
    await click([...container.querySelectorAll('button')].find(button => button.textContent.includes('Thêm quy tắc')));
    await input(container.querySelector('[name="name"]'), 'Weekend');
    await input(container.querySelector('[name="priority"]'), '1e3');
    await submit(container.querySelector('form'));
    assert.equal(saved.length, 0);
    await input(container.querySelector('[name="priority"]'), '10');
    await input(container.querySelector('[name="adjustmentPercent"]'), '-10.1234');
    await submit(container.querySelector('form'));
    assert.equal(saved[0][1].priority, 10);
    assert.equal(saved[0][1].adjustmentPercent, '-10.1234');
  });
});
