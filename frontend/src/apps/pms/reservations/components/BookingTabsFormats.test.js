import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

test('booking payments reject exponent and zero amounts and send exact decimal strings', async () => {
  await withDraftDom(async ({ React, load, mount, input, act }) => {
    const { default: BookingTabs } = await load('/src/apps/pms/reservations/components/BookingTabs.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const payments = [];
    const context = { services: [], paymentMethods: [{ id: 'cash', name: 'Cash' }], funds: [{ id: 'fund', name: 'Cash fund', currency: 'VND' }], settings: { currency: 'VND', timezone: 'Asia/Ho_Chi_Minh' }, access: () => ({ allowed: true }), addPayment: async (...args) => { payments.push(args); } };
    const booking = { id: 'booking-a', currency: 'VND', status: 'IN_HOUSE', balance: '1000000', payments: [], guests: [] };
    const view = await mount(React.createElement(PmsContext.Provider, { value: context }, React.createElement(BookingTabs, { tab: 'thanhtoán', booking })));
    const form = view.container.querySelector('form'), amount = form.querySelector('[aria-label="Số tiền thanh toán"]');
    await input(amount, '1e3');
    assert.equal(amount.checkValidity(), false);
    await act(async () => form.requestSubmit());
    assert.equal(payments.length, 0);
    await input(amount, '0');
    await act(async () => form.requestSubmit());
    assert.equal(payments.length, 0);
    await input(amount, '123.4500');
    await input(form.querySelector('[aria-label="Phương thức thanh toán"]'), 'cash');
    await input(form.querySelector('[aria-label="Quỹ nhận tiền"]'), 'fund');
    await act(async () => form.requestSubmit());
    assert.equal(payments.length, 1);
    assert.equal(payments[0][1].amount, '123.4500');
  });
});
