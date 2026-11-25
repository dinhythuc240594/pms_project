import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

async function textarea(act, window, element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(
      element,
      value,
    )
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

test('Manager can refund an existing SaaS receipt, retry safely, and read the preserved history', async () => {
  await withDraftDom(async ({ React, act, window, load, mount, click, input }) => {
    const { MemoryRouter } = await import('react-router-dom')
    const { default: AdminBilling } = await load('/src/apps/manager/billing/pages/AdminBilling.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const invoice = {
      id: 'invoice-a',
      number: 'SAAS-000001',
      tenantId: 'hotel-a',
      tenantName: 'Hotel A',
      description: 'SaaS',
      currency: 'VND',
      amount: '100',
      paid: '100',
      balance: '0',
      status: 'paid',
      payments: [{ id: 'payment-a', amount: '100', refundable: '100', method: 'bank' }],
    }
    const calls = []
    let fail = true
    const value = {
      authGeneration: 1,
      tenants: [],
      user: { globalRole: 'SUPER_ADMIN' },
      listPlans: async () => ({ plans: [] }),
      getTenantSubscription: async () => ({}),
      listSaasInvoices: async () => ({
        invoices: [invoice],
        pagination: { page: 1, pageSize: 20, totalItems: 1 },
      }),
      refundSaasPayment: async (...args) => {
        calls.push(args)
        if (fail) throw new Error('Temporary write error')
        return {
          ...invoice,
          paid: '60',
          refunded: '40',
          balance: '40',
          status: 'partial',
          payments: [{ ...invoice.payments[0], refunded: '40', refundable: '60' }],
          refunds: [
            { id: 'refund-a', paymentId: 'payment-a', amount: '40', reason: 'Wrong receipt' },
          ],
        }
      },
    }
    const view = await mount(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(PmsContext.Provider, { value }, React.createElement(AdminBilling)),
      ),
    )
    const button = (text) =>
      [...view.container.querySelectorAll('button')].find((item) => item.textContent === text)
    await click(button('Chi tiết'))
    await click(button('Hoàn/đảo khoản thu'))
    const dialog = () => view.container.querySelector('[role="dialog"]')
    await input(dialog().querySelector('input[inputmode="decimal"]'), '40')
    await textarea(act, window, dialog().querySelector('textarea'), 'Wrong receipt')
    await click(button('Xác nhận hoàn/đảo thu'))
    assert.match(dialog().textContent, /Temporary write error/)
    fail = false
    await click(button('Xác nhận hoàn/đảo thu'))
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0], calls[1])
    assert.deepEqual(calls[0].slice(0, 3), [
      'invoice-a',
      'payment-a',
      { amount: '40', reason: 'Wrong receipt' },
    ])
    assert.match(dialog().textContent, /Lịch sử hoàn\/đảo thu/)
    assert.match(dialog().textContent, /Wrong receipt/)
    assert.match(dialog().textContent, /100/)
  })
})

test('Operational recovery requires a reason, displays the scope, and supports revocation', async () => {
  await withDraftDom(async ({ React, act, window, load, mount, click }) => {
    const { default: OperationalAccess } = await load(
      '/src/apps/manager/billing/pages/OperationalAccess.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const calls = []
    const value = {
      getOperationalAccess: async () => ({ access: null }),
      saveOperationalAccess: async (id, data, key) => {
        calls.push([id, data, key])
        return {
          access: {
            id: 'access-a',
            until: data.until,
            reason: data.reason,
            active: data.until !== null,
          },
        }
      },
    }
    const view = await mount(
      React.createElement(
        PmsContext.Provider,
        { value },
        React.createElement(OperationalAccess, {
          tenant: { id: 'hotel-a', name: 'Hotel A' },
          onClose() {},
          onSaved() {},
        }),
      ),
    )
    assert.match(view.container.textContent, /Không mở tạo booking trực tiếp/)
    await act(async () =>
      view.container
        .querySelector('form')
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    )
    assert.equal(calls.length, 0)
    assert.match(view.container.textContent, /Cần nhập lý do/)
    await textarea(act, window, view.container.querySelector('textarea'), 'Complete stays')
    await click(
      [...view.container.querySelectorAll('button')].find(
        (item) => item.textContent === 'Cấp vận hành tạm',
      ),
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'hotel-a')
    assert.equal(calls[0][1].reason, 'Complete stays')
    assert.ok(Date.parse(calls[0][1].until) > Date.now())
    await textarea(act, window, view.container.querySelector('textarea'), 'All done')
    await click(
      [...view.container.querySelectorAll('button')].find(
        (item) => item.textContent === 'Thu hồi quyền vận hành tạm',
      ),
    )
    assert.deepEqual(calls[1].slice(0, 2), ['hotel-a', { until: null, reason: 'All done' }])
    assert.match(view.container.textContent, /Đã thu hồi/)
  })
})
