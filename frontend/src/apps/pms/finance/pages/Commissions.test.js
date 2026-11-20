import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

const record = { id: 'commission-a', bookingId: 'booking-a', guestName: 'Guest A', sourceName: 'Agency A', percent: '10.0000', calculationBasis: 'percent', roomNet: '200.0000', baseRoomNet: '200.0000', amount: '20.0000', baseAmount: '20.0000', baseCurrency: 'VND', currency: 'VND', originalAmount: '20.0000', paid: '20.0000', balance: '0.0000', recoveryDue: '0.0000', needsReview: true, status: 'NEEDS_REVIEW', date: '2026-10-29', payments: [], recoveries: [], reviews: [] };

async function context({ React, load, mount }, overrides = {}) {
  const { MemoryRouter } = await import('react-router-dom');
  const { default: Commissions } = await load('/src/apps/pms/finance/pages/Commissions.jsx');
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
  const value = {
    tenantId: 'hotel-a', user: { id: 'owner-a' }, authGeneration: 1, workspaceRevision: 1,
    settings: { currency: 'VND', timezone: 'Asia/Ho_Chi_Minh' }, access: () => ({ allowed: true }),
    funds: [{ id: 'fund-a', name: 'Cash', currency: 'VND' }],
    getCommissions: async () => ({ items: [record], candidates: [], summary: { currency: 'VND', accrued: '20', paid: '20', balance: '0' }, pagination: { totalItems: 1 } }),
    getCommissionReview: async () => ({ previewToken: 'a'.repeat(64), current: record, roomSubtotal: '200.0000', blockedByOta: false, refunds: [{ id: 'refund-a', amount: '50' }], charges: [{ id: 'discount-a', kind: 'discount', description: 'Room refund', amount: '-50.0000', allocatable: true }, { id: 'tax-a', kind: 'tax', description: 'VAT', amount: '10', allocatable: false }] }),
    ...overrides,
  };
  return mount(React.createElement(MemoryRouter, null, React.createElement(PmsContext.Provider, { value }, React.createElement(Commissions))));
}

test('review uses explicit allocations and keeps the reason and idempotency intent on retry', async () => {
  await withDraftDom(async helpers => {
    const { act, click, window } = helpers;
    const calls = [];
    let fail = true;
    const view = await context(helpers, { reviewCommission: async (...args) => { calls.push(args); if (fail) throw new Error('Review service unavailable'); return {}; } });
    await click([...view.container.querySelectorAll('button')].find(button => button.textContent === 'Đối soát lại'));
    assert.equal(view.container.querySelector('[aria-label="Phần tiền phòng Room refund"]').value, '-50.0000');
    assert.equal(view.container.querySelector('[aria-label="Phần tiền phòng VAT"]'), null);
    const reason = view.container.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(reason, 'Confirmed room allocation');
      reason.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const submit = () => [...view.container.querySelectorAll('button')].find(button => button.textContent === 'Lưu kết quả đối soát');
    await click(submit());
    assert.match(view.container.textContent, /Review service unavailable/);
    assert.equal(view.container.querySelector('textarea').value, 'Confirmed room allocation');
    fail = false;
    await click(submit());
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0][0], 'commission-a');
    assert.deepEqual(calls[0][1].allocations, [{ chargeId: 'discount-a', roomAmount: '-50.0000' }]);
    assert.match(view.container.textContent, /Đã lưu kết quả đối soát/);
  });
});

test('overpaid commissions collect a receipt with the recovery limit and never send a payout', async () => {
  await withDraftDom(async helpers => {
    const { act, click, window } = helpers;
    const calls = [];
    const overpaid = { ...record, needsReview: false, status: 'OVERPAID', amount: '15.0000', balance: '-5.0000', recoveryDue: '5.0000' };
    const view = await context(helpers, {
      getCommissions: async () => ({ items: [overpaid], candidates: [], summary: { currency: 'VND', accrued: '15', paid: '20', balance: '-5' }, pagination: { totalItems: 1 } }),
      recoverCommission: async (...args) => { calls.push(args); return {}; },
      payCommission: async () => assert.fail('Recovery must not call the payout endpoint'),
    });
    const pay = [...view.container.querySelectorAll('button')].find(button => button.textContent === 'Chi hoa hồng');
    assert.equal(pay.disabled, true);
    await click([...view.container.querySelectorAll('button')].find(button => button.textContent === 'Thu hồi hoa hồng'));
    const amount = view.container.querySelector('form input[inputmode="decimal"]');
    assert.equal(amount.max, '5.0000');
    const note = view.container.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(note, 'Agency returned overpayment');
      note.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    for (const value of ['5e0', '5.0001']) {
      await helpers.input(amount, value);
      await click([...view.container.querySelectorAll('button')].find(button => button.textContent === 'Ghi phiếu thu hồi'));
      assert.equal(calls.length, 0, value);
    }
    await helpers.input(amount, '5.0000');
    await click([...view.container.querySelectorAll('button')].find(button => button.textContent === 'Ghi phiếu thu hồi'));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 2), ['commission-a', { amount: '5.0000', fundId: 'fund-a', note: 'Agency returned overpayment' }]);
    assert.match(view.container.textContent, /Đã ghi phiếu thu hồi/);
  });
});
