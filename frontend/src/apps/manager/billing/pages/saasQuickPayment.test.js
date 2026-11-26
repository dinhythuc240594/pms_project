import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

const invoice = {
  id: 'invoice-qa',
  number: 'SAAS-QA-1',
  tenantId: 'hotel-qa',
  tenantName: 'QA Hotel',
  description: 'Software service',
  currency: 'VND',
  amount: '100',
  paid: '0',
  balance: '100',
  status: 'unpaid',
  payments: [],
}
const response = (row) => ({
  invoices: row ? [row] : [],
  pagination: { page: 1, pageSize: 20, totalItems: 40 },
})
const deferred = () => Promise.withResolvers()

async function withInvoices(check, initial = invoice) {
  await withDraftDom(async (tools) => {
    const { React, act, load, mount } = tools
    const { MemoryRouter } = await import('react-router-dom')
    const { default: AdminBilling } = await load('/src/apps/manager/billing/pages/AdminBilling.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { setLocale } = await load('/src/shared/i18n/store.js')
    setLocale('vi')
    const reads = [],
      payments = []
    const state = {
      read: async () => response(initial),
      pay: async () => ({ ...initial, balance: '0', paid: initial.amount, status: 'paid' }),
    }
    const value = {
      authGeneration: 1,
      user: { globalRole: 'SUPER_ADMIN' },
      tenants: [{ id: 'hotel-qa', name: 'QA Hotel' }],
      listPlans: async () => ({ plans: [] }),
      getTenantSubscription: async () => ({ subscription: null }),
      listSaasInvoices: async (filters) => {
        reads.push(filters)
        return state.read(filters)
      },
      recordSaasPayment: async (...args) => {
        payments.push(args)
        return state.pay(...args)
      },
    }
    const view = await mount(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/manager/billing'] },
          React.createElement(PmsContext.Provider, { value }, React.createElement(AdminBilling)),
        ),
      ),
    )
    const section = view.container.querySelector('.manager-invoices')
    const button = (text) =>
      [...section.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
    const dialog = () => section.querySelector('.manager-invoice-dialog')
    const settle = () =>
      act(async () => {
        await Promise.resolve()
      })
    await check({ ...tools, ...view, state, reads, payments, section, button, dialog, settle })
  })
}

test('quick SaaS collection opens one fresh payment form and only records money after explicit submit', async () => {
  await withInvoices(async ({ state, reads, payments, button, dialog, click }) => {
    const fresh = {
      ...invoice,
      number: 'SAAS-QA-LATEST',
      tenantName: 'Latest QA Hotel',
      currency: 'USD',
      paid: '39.7500',
      balance: '60.2500',
      status: 'partial',
    }
    state.read = async () => response(fresh)
    await click(button('Thu tiền'))
    assert.equal(reads.at(-1), reads[0], 'fresh read uses the exact current filters/page')
    assert.equal(payments.length, 0)
    assert.match(dialog().textContent, /SAAS-QA-LATEST/)
    assert.match(dialog().textContent, /Latest QA Hotel/)
    assert.match(dialog().textContent, /USD/)
    assert.equal(dialog().querySelector('input[inputmode="decimal"]').value, '60.2500')
    await click(dialog().querySelector('button[type="submit"]'))
    assert.equal(payments.length, 1)
    assert.deepEqual(payments[0].slice(0, 2), [
      invoice.id,
      { amount: '60.2500', method: 'bank', reference: '', note: '' },
    ])
    assert.ok(payments[0][2])
  })
})

test('both the row shortcut and detail payment action use the same fresh read and preserve retry identity', async () => {
  await withInvoices(async ({ state, reads, payments, button, dialog, click }) => {
    await click(button('Chi tiết'))
    const before = reads.length
    state.read = async () => response({ ...invoice, balance: '80', paid: '20', status: 'partial' })
    await click(button('Ghi nhận thanh toán'))
    assert.equal(reads.length, before + 1)
    assert.equal(dialog().querySelector('input[inputmode="decimal"]').value, '80')
    let fail = true
    state.pay = async () => {
      if (fail) throw new Error('Temporary payment error')
      return { ...invoice, balance: '0', paid: '100', status: 'paid' }
    }
    await click(dialog().querySelector('button[type="submit"]'))
    assert.match(dialog().textContent, /Temporary payment error/)
    fail = false
    await click(dialog().querySelector('button[type="submit"]'))
    assert.equal(payments.length, 2)
    assert.deepEqual(payments[0], payments[1])
  })
})

test('a pending fresh read locks competing controls and a double click cannot start another read', async () => {
  await withInvoices(async ({ state, reads, payments, button, dialog, section, act, window }) => {
    const read = deferred(),
      before = reads.length
    state.read = () => read.promise
    const collect = button('Thu tiền')
    await act(async () => {
      collect.click()
      collect.click()
      button('Chi tiết').click()
      section
        .querySelector('.manager-invoice-filters')
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    })
    assert.equal(reads.length, before + 1)
    assert.equal(dialog(), null)
    for (const text of ['Thu tiền', 'Chi tiết', 'Tạo hóa đơn', 'Lọc hóa đơn', 'Trước', 'Sau'])
      assert.ok(button(text).disabled, text)
    assert.equal(section.getAttribute('aria-busy'), 'true')
    await act(async () => read.resolve(response(invoice)))
    assert.ok(dialog().querySelector('form'))
    assert.equal(payments.length, 0)
  })
})

test('fresh collection refuses changed, missing, forbidden or malformed invoices without posting money', async (t) => {
  const cases = [
    ['paid', { ...invoice, status: 'paid', balance: '0' }],
    ['void', { ...invoice, status: 'void' }],
    ['missing', null],
    ['wrong tenant', { ...invoice, tenantId: 'other-hotel' }],
    ['bad currency', { ...invoice, currency: 'not-currency' }],
    ['zero', { ...invoice, balance: '0.0000' }],
    ['negative', { ...invoice, balance: '-1' }],
    ['not a decimal', { ...invoice, balance: '1e3' }],
  ]
  for (const [name, fresh] of cases)
    await t.test(name, async () =>
      withInvoices(async ({ state, payments, button, dialog, section, click }) => {
        state.read = async () => response(fresh)
        await click(button('Thu tiền'))
        assert.equal(dialog(), null)
        assert.equal(payments.length, 0)
        assert.ok(section.querySelector('[role="alert"]')?.textContent.trim())
        assert.equal(button('Thu tiền').disabled, false)
      }),
    )
  await t.test('denied', async () =>
    withInvoices(async ({ state, payments, button, dialog, section, click }) => {
      state.read = async () => {
        throw new Error('403 denied')
      }
      await click(button('Thu tiền'))
      assert.equal(dialog(), null)
      assert.equal(payments.length, 0)
      assert.match(section.querySelector('[role="alert"]').textContent, /403 denied/)
    }),
  )
})

test('a late read cannot reopen a payment form after unmount', async () => {
  await withInvoices(async ({ state, payments, button, click, unmount, act, document }) => {
    const read = deferred()
    state.read = () => read.promise
    await click(button('Thu tiền'))
    await unmount()
    await act(async () => read.resolve(response(invoice)))
    assert.equal(document.querySelector('.manager-invoice-dialog'), null)
    assert.equal(payments.length, 0)
  })
})

test('paid and void invoice rows keep details without a collection shortcut', async (t) => {
  for (const status of ['paid', 'void'])
    await t.test(status, async () =>
      withInvoices(
        async ({ button, click, dialog }) => {
          assert.equal(button('Thu tiền'), undefined)
          await click(button('Chi tiết'))
          assert.ok(dialog())
        },
        { ...invoice, status, balance: '0', paid: status === 'paid' ? '100' : '0' },
      ),
    )
})
