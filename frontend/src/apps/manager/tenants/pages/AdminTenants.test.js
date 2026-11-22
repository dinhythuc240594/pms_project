import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRouter } from 'react-router-dom';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';
import { HOTEL_CURRENCY_CODES } from '../../../../shared/lib/currencies.js';

test('hotel create and edit forms reject letters in phone numbers and retain phone formatting', async () => {
  await withDraftDom(async ({ React, load, mount, click, input }) => {
    const { default: AdminTenants } = await load('/src/apps/manager/tenants/pages/AdminTenants.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { setLocale } = await load('/src/shared/i18n/store.js');
    setLocale('vi');
    for (const editing of [false, true]) {
      const saved = [];
      const hotel = { id: 'hotel-a', name: 'Test hotel', status: 'active', contactPhone: '098210910', domain: 'saved.example.test' };
      const context = {
        authGeneration: 1, tenants: editing ? [hotel] : [],
        saveTenant: async value => { saved.push(value); },
        getTenantSubscription: async () => ({ subscription: null }), listPlans: async () => ({ plans: [] }),
        routeAccess: () => ({ allowed: true }),
      };
      const view = await mount(React.createElement(MemoryRouter, null,
        React.createElement(PmsContext.Provider, { value: context }, React.createElement(AdminTenants))));
      await click([...view.container.querySelectorAll('button')].find(button => button.textContent === (editing ? 'Hồ sơ' : ' Thêm khách sạn')));
      const dialog = view.container.querySelector('[role="dialog"]');
      assert.doesNotMatch(dialog.textContent, /Tên miền|DNS|Tunnel/);
      const field = text => [...dialog.querySelectorAll('label')].find(label => label.textContent === text)?.querySelector('input');
      if (!editing) {
        await input(field('Tên khách sạn'), hotel.name);
        await input(field('Họ tên Owner'), 'Test owner');
        await input(field('Email đăng nhập Owner'), 'owner@example.test');
        await input(field('Mật khẩu Owner'), 'Owner-password-2026!');
      }
      const phone = field('Điện thoại / Zalo');
      await input(phone, '098210910');
      await input(phone, '098210910A');
      assert.equal(phone.value, '098210910');
      await input(phone, 'invalid pasted phone');
      assert.equal(phone.value, '098210910');
      for (const value of ['', '0982109100', '+84 982 109 100', '(028) 3822-1234', '0982.109.100']) {
        await input(phone, value);
        assert.equal(phone.value, value);
        assert.equal(phone.checkValidity(), true, value);
      }
      const save = dialog.querySelector('[type="submit"]');
      for (const value of ['++84982109100', '098+2109100', '---']) {
        await input(phone, value);
        assert.equal(phone.checkValidity(), false, value);
        await click(save);
        assert.equal(saved.length, 0);
      }
      await input(phone, '+84 982 109 100');
      await click(save);
      assert.equal(saved.length, 1);
      assert.equal(saved[0].contactPhone, '+84 982 109 100');
      assert.equal('domain' in saved[0], false);
      await view.unmount();
    }
  });
});

const account = {
  id: 'owner-existing', name: 'Nguyễn An', email: 'an@example.test', active: true, createdAt: '2026-10-01T08:00:00Z',
  memberships: [{ tenantId: 'hotel-old', tenantName: 'Khách sạn đang quản lý', role: 'HOTEL_OWNER', active: true }],
};
const contextFor = overrides => ({
  authGeneration: 1, tenants: [], saveTenant: async () => {},
  getTenantSubscription: async () => ({ subscription: null }), listPlans: async () => ({ plans: [] }),
  routeAccess: () => ({ allowed: true }), ...overrides,
});
const dialogField = (dialog, text) => [...dialog.querySelectorAll('label')].find(label => label.firstChild?.textContent.trim() === text)?.querySelector('input, select');
const buttonWithText = (container, text) => [...container.querySelectorAll('button')].find(button => button.textContent.trim() === text);
const flushSearch = act => act(async () => { await new Promise(resolve => setTimeout(resolve, 330)); });

test('existing account search shows manager details and submits only the selected owner ID', async () => {
  await withDraftDom(async ({ React, load, mount, click, input, act }) => {
    const { default: AdminTenants } = await load('/src/apps/manager/tenants/pages/AdminTenants.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { setLocale } = await load('/src/shared/i18n/store.js'); setLocale('vi');
    const saved = [], searches = [];
    const context = contextFor({ saveTenant: async value => saved.push(value), searchCustomerAccounts: async query => { searches.push(query); return { users: [account] }; } });
    const view = await mount(React.createElement(MemoryRouter, null, React.createElement(PmsContext.Provider, { value: context }, React.createElement(AdminTenants))));
    await click(buttonWithText(view.container, 'Thêm khách sạn'));
    const dialog = view.container.querySelector('[role="dialog"]');
    await input(dialogField(dialog, 'Tên khách sạn'), 'Khách sạn mới');
    await input(dialogField(dialog, 'Tiền tệ khách sạn'), 'USD');
    await input(dialogField(dialog, 'Tỉnh / Thành phố'), 'Đà Nẵng');
    await input(dialogField(dialog, 'Mật khẩu Owner'), 'Unused-password-2026!');
    await click(dialog.querySelector('[value="existing"]'));
    assert.equal(dialog.querySelector('[type="password"]'), null);
    await click(dialog.querySelector('[type="submit"]'));
    assert.equal(saved.length, 0);
    assert.match(dialog.querySelector('[role="alert"]').textContent, /chọn tài khoản/);
    const search = dialogField(dialog, 'Tìm tài khoản theo tên hoặc email');
    await input(search, 'a');
    await flushSearch(act);
    assert.deepEqual(searches, []);
    await input(search, '  Nguyễn An  ');
    await flushSearch(act);
    assert.deepEqual(searches, ['Nguyễn An']);
    await click(dialog.querySelector('.customer-account-option'));
    const details = dialog.querySelector('.customer-account-details');
    assert.match(details.textContent, /Nguyễn An/);
    assert.match(details.textContent, /an@example.test/);
    assert.match(details.textContent, /Khách sạn đang quản lý/);
    assert.match(details.textContent, /owner-existing/);
    await click(dialog.querySelector('[type="submit"]'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].ownerUserId, account.id);
    assert.equal(saved[0].currency, 'USD');
    assert.equal(saved[0].city, 'Đà Nẵng');
    for (const key of ['ownerName', 'ownerEmail', 'ownerPassword', 'contactName', 'contactEmail']) assert.equal(key in saved[0], false, key);
    assert.match(view.container.textContent, /gán tài khoản quản lý đã chọn/);
  });
});

test('account search ignores stale responses, supports retry, and requires reselection after query changes', async () => {
  await withDraftDom(async ({ React, load, mount, click, input, act }) => {
    const { default: AdminTenants } = await load('/src/apps/manager/tenants/pages/AdminTenants.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { setLocale } = await load('/src/shared/i18n/store.js'); setLocale('vi');
    let resolveOld, attempts = 0;
    const saved = [];
    const context = contextFor({ saveTenant: async value => saved.push(value), searchCustomerAccounts: query => {
      if (query === 'old') return new Promise(resolve => { resolveOld = resolve; });
      if (query === 'error' && attempts++ === 0) return Promise.reject(new Error('Không tải được tài khoản.'));
      return Promise.resolve({ users: query === 'empty' ? [] : [account] });
    } });
    const view = await mount(React.createElement(MemoryRouter, null, React.createElement(PmsContext.Provider, { value: context }, React.createElement(AdminTenants))));
    await click(buttonWithText(view.container, 'Thêm khách sạn'));
    const dialog = view.container.querySelector('[role="dialog"]');
    await input(dialogField(dialog, 'Tên khách sạn'), 'Khách sạn mới');
    await click(dialog.querySelector('[value="existing"]'));
    const search = dialogField(dialog, 'Tìm tài khoản theo tên hoặc email');
    await input(search, 'old'); await flushSearch(act);
    await input(search, 'new'); await flushSearch(act);
    await act(async () => resolveOld({ users: [{ ...account, id: 'stale', name: 'Tài khoản cũ' }] }));
    assert.doesNotMatch(dialog.textContent, /Tài khoản cũ/);
    await click(dialog.querySelector('.customer-account-option'));
    await input(search, 'empty');
    assert.equal(dialog.querySelector('.customer-account-details'), null);
    assert.equal(dialog.querySelector('.customer-account-option'), null);
    await click(dialog.querySelector('[type="submit"]'));
    assert.equal(saved.length, 0);
    await flushSearch(act);
    assert.match(dialog.textContent, /Không tìm thấy tài khoản phù hợp/);
    await input(search, 'error'); await flushSearch(act);
    assert.match(dialog.textContent, /Không tải được tài khoản/);
    await click(buttonWithText(dialog, 'Thử lại')); await flushSearch(act);
    assert.equal(dialog.querySelectorAll('.customer-account-option').length, 1);
    await click(dialog.querySelector('[value="new"]'));
    assert.equal(dialogField(dialog, 'Mật khẩu Owner').value, '');
    assert.equal(dialog.querySelector('.customer-account-details'), null);
  });
});

test('hotel form validates email, phone digit length, tax ID, and whitespace before submitting', async () => {
  await withDraftDom(async ({ React, load, mount, click, input, act, window }) => {
    const { default: AdminTenants } = await load('/src/apps/manager/tenants/pages/AdminTenants.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { setLocale } = await load('/src/shared/i18n/store.js'); setLocale('vi');
    const saved = [];
    const context = contextFor({ saveTenant: async value => saved.push(value) });
    const view = await mount(React.createElement(MemoryRouter, null, React.createElement(PmsContext.Provider, { value: context }, React.createElement(AdminTenants))));
    await click(buttonWithText(view.container, 'Thêm khách sạn'));
    const dialog = view.container.querySelector('[role="dialog"]');
    await input(dialogField(dialog, 'Tên khách sạn'), 'Khách sạn mới');
    await input(dialogField(dialog, 'Họ tên Owner'), 'Test owner');
    await input(dialogField(dialog, 'Email đăng nhập Owner'), 'owner@example.test');
    await input(dialogField(dialog, 'Mật khẩu Owner'), 'Owner-password-2026!');
    for (const [label, invalid] of [['Điện thoại / Zalo', '123456'], ['Điện thoại / Zalo', '1234567890123456'], ['Email liên hệ', 'bad..mail@example.test'], ['Mã số thuế', '1e10'], ['Mã số thuế', '123.45'], ['Tên khách sạn', '   ']]) {
      const field = dialogField(dialog, label), original = field.value;
      await input(field, invalid);
      assert.equal(field.checkValidity(), false, `${label}: ${invalid}`);
      await click(dialog.querySelector('[type="submit"]'));
      assert.equal(saved.length, 0);
      // Programmatic submits must also be checked by the save handler.
      await act(async () => dialog.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(saved.length, 0);
      await input(field, original);
    }
    await input(dialogField(dialog, 'Mã số thuế'), '01012345');
    await input(dialogField(dialog, 'Email liên hệ'), 'CONTACT@example.test');
    await click(dialog.querySelector('[type="submit"]'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].taxId, '01012345');
    assert.equal(saved[0].contactEmail, 'contact@example.test');
    assert.equal(saved[0].ownerEmail, 'owner@example.test');
    assert.equal('ownerUserId' in saved[0], false);
  });
});

test('hotel profile shows its owner account separately from contact information', async () => {
  await withDraftDom(async ({ React, load, mount, click }) => {
    const { default: AdminTenants } = await load('/src/apps/manager/tenants/pages/AdminTenants.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { setLocale } = await load('/src/shared/i18n/store.js'); setLocale('vi');
    const context = contextFor({ tenants: [{ id: 'hotel-a', name: 'Test hotel', status: 'active', contactEmail: 'contact@example.test', owner: account }] });
    const view = await mount(React.createElement(MemoryRouter, null, React.createElement(PmsContext.Provider, { value: context }, React.createElement(AdminTenants))));
    await click(buttonWithText(view.container, 'Hồ sơ'));
    const dialog = view.container.querySelector('[role="dialog"]');
    assert.equal(dialogField(dialog, 'Email liên hệ').value, 'contact@example.test');
    assert.match(dialog.querySelector('.customer-account-details').textContent, /an@example.test/);
    assert.equal(dialog.querySelectorAll('[name="owner-account-mode"]').length, 0);
  });
});

test('consecutive submissions create only one hotel while the request is pending', async () => {
  await withDraftDom(async ({ React, load, mount, click, input, act, window }) => {
    const { default: AdminTenants } = await load('/src/apps/manager/tenants/pages/AdminTenants.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { setLocale } = await load('/src/shared/i18n/store.js'); setLocale('vi');
    let complete;
    const saved = [];
    const context = contextFor({ saveTenant: value => { saved.push(value); return new Promise(resolve => { complete = resolve; }); } });
    const view = await mount(React.createElement(MemoryRouter, null, React.createElement(PmsContext.Provider, { value: context }, React.createElement(AdminTenants))));
    await click(buttonWithText(view.container, 'Thêm khách sạn'));
    const dialog = view.container.querySelector('[role="dialog"]');
    await input(dialogField(dialog, 'Tên khách sạn'), 'Khách sạn mới');
    await input(dialogField(dialog, 'Họ tên Owner'), 'Test owner');
    await input(dialogField(dialog, 'Email đăng nhập Owner'), 'owner@example.test');
    await input(dialogField(dialog, 'Mật khẩu Owner'), 'Owner-password-2026!');
    await act(async () => {
      const form = dialog.querySelector('form');
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(saved.length, 1);
    assert.equal(dialog.querySelector('[type="submit"]').disabled, true);
    await act(async () => complete());
    assert.equal(view.container.querySelector('[role="dialog"]'), null);
  });
});

test('hotel creation offers supported currencies and all 34 provinces and saves the chosen values', async () => {
  await withDraftDom(async ({ React, load, mount, click, input }) => {
    const { default: AdminTenants } = await load('/src/apps/manager/tenants/pages/AdminTenants.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { setLocale } = await load('/src/shared/i18n/store.js'); setLocale('vi');
    const saved = [];
    const context = contextFor({ saveTenant: async value => saved.push(value) });
    const view = await mount(React.createElement(MemoryRouter, null, React.createElement(PmsContext.Provider, { value: context }, React.createElement(AdminTenants))));
    await click(buttonWithText(view.container, 'Thêm khách sạn'));
    const dialog = view.container.querySelector('[role="dialog"]');
    const currency = dialogField(dialog, 'Tiền tệ khách sạn'), city = dialogField(dialog, 'Tỉnh / Thành phố');
    assert.equal(currency.tagName, 'SELECT');
    assert.equal(currency.value, 'VND');
    assert.deepEqual([...currency.options].map(option => option.value), HOTEL_CURRENCY_CODES);
    assert.equal(currency.options.length, 20);
    assert.equal(city.tagName, 'SELECT');
    assert.equal(city.value, '');
    assert.equal(city.options.length, 35);
    assert.equal(new Set([...city.options].filter(option => option.value).map(option => option.value)).size, 34);
    assert.ok([...city.options].some(option => option.value === 'Huế'));
    assert.ok([...city.options].some(option => option.value === 'Hồ Chí Minh'));
    assert.ok(![...city.options].some(option => option.value === 'Bình Dương'));
    await input(dialogField(dialog, 'Tên khách sạn'), 'Khách sạn EUR');
    await input(currency, 'EUR');
    await input(city, 'Hà Nội');
    await input(dialogField(dialog, 'Họ tên Owner'), 'Test owner');
    await input(dialogField(dialog, 'Email đăng nhập Owner'), 'owner@example.test');
    await input(dialogField(dialog, 'Mật khẩu Owner'), 'Owner-password-2026!');
    await click(dialog.querySelector('[type="submit"]'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].currency, 'EUR');
    assert.equal(saved[0].city, 'Hà Nội');
    assert.equal(saved[0].ownerEmail, 'owner@example.test');
  });
});

test('editing a hotel preserves its existing location and currency without sending currency changes', async () => {
  await withDraftDom(async ({ React, load, mount, click, input }) => {
    const { default: AdminTenants } = await load('/src/apps/manager/tenants/pages/AdminTenants.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { setLocale } = await load('/src/shared/i18n/store.js'); setLocale('vi');
    for (const savedCity of ['HCM', 'Hà Nội', '']) {
      const saved = [], hotel = { id: 'hotel-a', name: 'Hotel EUR', status: 'active', city: savedCity, currency: 'EUR' };
      const context = contextFor({ tenants: [hotel], saveTenant: async value => saved.push(value) });
      const view = await mount(React.createElement(MemoryRouter, null, React.createElement(PmsContext.Provider, { value: context }, React.createElement(AdminTenants))));
      await click(buttonWithText(view.container, 'Hồ sơ'));
      const dialog = view.container.querySelector('[role="dialog"]');
      const currency = dialogField(dialog, 'Tiền tệ khách sạn'), city = dialogField(dialog, 'Tỉnh / Thành phố');
      assert.equal(currency.value, 'EUR');
      assert.equal(currency.disabled, true);
      assert.equal(city.value, savedCity);
      assert.equal(city.options.length, savedCity === 'HCM' ? 36 : 35);
      await input(dialogField(dialog, 'Người liên hệ'), 'Updated contact');
      await click(dialog.querySelector('[type="submit"]'));
      assert.equal(saved.length, 1);
      assert.equal(saved[0].city, savedCity);
      assert.equal('currency' in saved[0], false);
      await view.unmount();
    }
  });
});
