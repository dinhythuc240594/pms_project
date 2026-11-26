import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

const pagination = (page, totalItems = 11) => ({ page, pageSize: 10, totalItems })

test('staff cannot open billing through the profile orders URL and never request billing data', async () => {
  await withDraftDom(async ({ React, load, mount }) => {
    const { MemoryRouter } = await import('react-router-dom')
    const { default: Profile } = await load('/src/apps/pms/profile/pages/Profile.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { permitted } = await load('/src/apps/pms/data/api.js')
    for (const role of ['FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTANT']) {
      let calls = 0
      const tenant = { id: 'hotel-a', name: 'Hotel A', status: 'ACTIVE' }
      const user = {
        id: 'user-a',
        globalRole: 'USER',
        memberships: [{ tenantId: tenant.id, role }],
      }
      const read = async () => {
        calls++
        throw new Error('Billing must not be requested')
      }
      const value = {
        tenant,
        tenantId: tenant.id,
        user,
        authGeneration: 1,
        access: (action) => permitted(user, tenant, action),
        getOwnBilling: read,
        listOwnBillingInvoices: read,
        listOwnBillingHistory: read,
      }
      const view = await mount(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/id/profile?tab=orders'] },
          React.createElement(PmsContext.Provider, { value }, React.createElement(Profile)),
        ),
      )
      assert.match(view.container.querySelector('[role="alert"]').textContent, /Chỉ chủ khách sạn/)
      assert.equal(view.container.querySelectorAll('.pms-profile-tabs button').length, 2)
      assert.equal(calls, 0, role)
      await view.unmount()
    }
  })
})

test('owner billing paginates invoices and plan history independently and reads fresh internal documents', async () => {
  await withDraftDom(async ({ React, load, mount, click }) => {
    const { MemoryRouter } = await import('react-router-dom')
    const { default: Profile } = await load('/src/apps/pms/profile/pages/Profile.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { permitted } = await load('/src/apps/pms/data/api.js')
    const tenant = { id: 'hotel-a', name: 'Hotel A', status: 'SUSPENDED' }
    const user = {
      id: 'owner-a',
      globalRole: 'USER',
      memberships: [{ tenantId: tenant.id, role: 'HOTEL_OWNER' }],
    }
    const invoice = {
      id: 'invoice-a',
      number: 'SAAS-000001',
      tenantId: tenant.id,
      tenantName: tenant.name,
      description: 'Stored service invoice',
      currency: 'USD',
      amount: '100.25',
      paid: '40.125',
      balance: '60.125',
      status: 'partial',
      createdAt: '2026-10-01T00:00:00Z',
      dueDate: '2026-10-20',
    }
    const invoiceCalls = [],
      historyCalls = [],
      detailCalls = []
    let failInvoices = true
    const value = {
      tenant,
      tenantId: tenant.id,
      user,
      authGeneration: 1,
      settings: { timezone: 'America/New_York' },
      access: (action) => permitted(user, tenant, action),
      getOwnBilling: async () => ({
        subscription: {
          planName: 'Historical Pro',
          planCode: 'PRO',
          status: 'active',
          blockedReason: 'expired',
          roomCount: 12,
        },
        summary: [
          { currency: 'USD', amount: invoice.amount, paid: invoice.paid, balance: invoice.balance },
        ],
      }),
      listOwnBillingInvoices: async (page = 1) => {
        invoiceCalls.push(page)
        if (failInvoices) throw new Error('Invoice service unavailable')
        return {
          invoices:
            page === 1 ? [invoice] : [{ ...invoice, id: 'invoice-b', number: 'SAAS-000002' }],
          pagination: pagination(page),
        }
      },
      listOwnBillingHistory: async (page = 1) => {
        historyCalls.push(page)
        return {
          history: [
            {
              id: `history-${page}`,
              planName: `Plan record ${page}`,
              action: 'renewed',
              status: 'active',
              roomCount: 12,
              amount: '900',
              currency: 'USD',
            },
          ],
          pagination: pagination(page),
        }
      },
      getOwnBillingInvoice: async (id) => {
        detailCalls.push(id)
        return {
          ...invoice,
          paid: '50.125',
          balance: '50.125',
          payments: [
            {
              id: 'payment-a',
              amount: '50.125',
              method: 'bank',
              reference: 'BANK-REF',
              note: 'Stored payment note',
              createdAt: '2026-10-02T00:00:00Z',
            },
          ],
        }
      },
    }
    const view = await mount(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/id/profile?tab=orders'] },
        React.createElement(PmsContext.Provider, { value }, React.createElement(Profile)),
      ),
    )
    assert.match(view.container.textContent, /Historical Pro/)
    assert.match(view.container.textContent, /Hết hạn/)
    assert.match(view.container.textContent, /Invoice service unavailable/)
    assert.match(view.container.textContent, /Plan record 1/)
    assert.deepEqual(historyCalls, [1])
    failInvoices = false
    await click(
      [...view.container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Thử lại',
      ),
    )
    assert.match(view.container.textContent, /SAAS-000001/)
    assert.match(view.container.textContent, /60\.125 USD/)
    assert.ok(!view.container.textContent.includes('Gia hạn gói'))
    const next = (label) =>
      [...view.container.querySelector(`[aria-label="${label}"]`).querySelectorAll('button')].find(
        (button) => button.textContent === 'Sau',
      )
    await click(next('Phân trang hóa đơn'))
    assert.match(view.container.textContent, /SAAS-000002/)
    assert.deepEqual(invoiceCalls, [1, 1, 2])
    assert.deepEqual(historyCalls, [1])
    await click(next('Phân trang lịch sử gói'))
    assert.match(view.container.textContent, /Plan record 2/)
    assert.deepEqual(historyCalls, [1, 2])
    await click(view.container.querySelector('[aria-label="Xem hóa đơn SAAS-000002"]'))
    assert.deepEqual(detailCalls, ['invoice-b'])
    const dialog = view.container.querySelector('[role="dialog"]')
    assert.match(dialog.textContent, /Chứng từ nội bộ, không phải hóa đơn thuế/)
    assert.match(dialog.textContent, /50\.125 USD/)
    assert.match(dialog.textContent, /BANK-REF/)
    assert.match(dialog.textContent, /Stored payment note/)
    assert.match(dialog.textContent, /Tải chứng từ/)
    assert.match(dialog.textContent, /Mở bản in/)
  })
})

test('tenant and authentication changes clear billing documents and ignore old responses', async () => {
  await withDraftDom(async ({ React, act, load, mount, click }) => {
    const { MemoryRouter } = await import('react-router-dom')
    const { default: Profile } = await load('/src/apps/pms/profile/pages/Profile.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { permitted } = await load('/src/apps/pms/data/api.js')
    const pending = Promise.withResolvers()
    let update
    function context(tenantId, authGeneration, loaders = {}) {
      const tenant = { id: tenantId, name: tenantId, status: 'ACTIVE' }
      const user = {
        id: 'owner',
        globalRole: 'USER',
        memberships: [{ tenantId, role: 'HOTEL_OWNER' }],
      }
      return {
        tenant,
        tenantId,
        authGeneration,
        user,
        access: (action) => permitted(user, tenant, action),
        getOwnBilling: async () => ({ subscription: null, summary: [] }),
        listOwnBillingInvoices: async () => ({
          invoices: [
            {
              id: 'invoice-a',
              number: `${tenantId} document`,
              currency: 'VND',
              amount: '1',
              paid: '0',
              balance: '1',
            },
          ],
          pagination: pagination(1, 1),
        }),
        listOwnBillingHistory: async () => ({ history: [], pagination: pagination(1, 0) }),
        getOwnBillingInvoice: () => pending.promise,
        ...loaders,
      }
    }
    function Host() {
      const [value, setValue] = React.useState(context('hotel-a', 1))
      React.useEffect(() => {
        update = setValue
      }, [])
      return React.createElement(
        MemoryRouter,
        { initialEntries: ['/id/profile?tab=orders'] },
        React.createElement(PmsContext.Provider, { value }, React.createElement(Profile)),
      )
    }
    const view = await mount(React.createElement(Host))
    await click(view.container.querySelector('[aria-label="Xem hóa đơn hotel-a document"]'))
    assert.ok(view.container.querySelector('[role="dialog"]'))
    await act(async () => update(context('hotel-b', 1)))
    assert.equal(view.container.querySelector('[role="dialog"]'), null)
    await act(async () => pending.resolve({ number: 'PRIVATE HOTEL A INVOICE', payments: [] }))
    assert.ok(!view.container.textContent.includes('PRIVATE HOTEL A INVOICE'))
    assert.ok(!view.container.textContent.includes('hotel-a document'))
    const pendingInvoices = Promise.withResolvers()
    await act(async () =>
      update(context('hotel-b', 1, { listOwnBillingInvoices: () => pendingInvoices.promise })),
    )
    await act(async () => update(context('hotel-b', 2)))
    await act(async () =>
      pendingInvoices.resolve({
        invoices: [{ id: 'old', number: 'PRIVATE OLD SESSION' }],
        pagination: pagination(1, 1),
      }),
    )
    assert.ok(!view.container.textContent.includes('PRIVATE OLD SESSION'))
    assert.match(view.container.textContent, /hotel-b document/)
  })
})
