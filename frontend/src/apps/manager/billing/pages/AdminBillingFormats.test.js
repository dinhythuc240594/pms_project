import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter } from 'react-router-dom'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'
import { defaultPricingRules } from '../../../../shared/lib/planPricing.js'

test('subscription form calculates exact plan prices and enforces room counts, date order and currency', async () => {
  await withDraftDom(async ({ React, load, mount, input, click }) => {
    const { default: AdminBilling } = await load('/src/apps/manager/billing/pages/AdminBilling.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const saved = [],
      plan = {
        id: 'pro',
        code: 'PRO',
        name: 'Pro',
        currency: 'VND',
        active: true,
        maxRooms: 20,
        price: '999999999999999.9998',
        priceYear: '1200.0000',
        pricingRules: {
          ...defaultPricingRules(),
          extraRoomPrice: '0.0001',
          extraRoomPriceYear: '10.1250',
        },
      }
    const subscription = {
      planId: 'pro',
      status: 'active',
      roomCount: 10,
      startDate: '2026-01-01T00:00:33.123Z',
      endDate: '2099-12-31T00:00:45.123Z',
    }
    const context = {
      authGeneration: 1,
      user: { globalRole: 'SUPER_ADMIN' },
      tenants: [{ id: 'hotel-a', name: 'Test hotel' }],
      listPlans: async () => ({ plans: [plan] }),
      getTenantSubscription: async () => ({ subscription }),
      listSaasInvoices: async () => ({ invoices: [], pagination: { totalItems: 0 } }),
      saveTenantSubscription: async (id, value) => {
        saved.push([id, value])
      },
    }
    const view = await mount(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/manager/billing?tenant=hotel-a'] },
        React.createElement(
          PmsContext.Provider,
          { value: context },
          React.createElement(AdminBilling),
        ),
      ),
    )
    const dialog = view.container.querySelector('[role="dialog"]')
    const field = (label) => dialog.querySelector(`[aria-label="${label}"]`)
    const amount = field('Số tiền gia hạn'),
      rooms = field('Số phòng đăng ký')
    await click(dialog.querySelector('[type="submit"]'))
    assert.equal(saved[0][1].startDate, subscription.startDate)
    assert.equal(saved[0][1].endDate, subscription.endDate)
    assert.equal(saved[0][1].amount, plan.price)
    assert.equal(saved[0][1].cycle, 'monthly')
    saved.length = 0
    assert.equal(field('Tiền tệ gia hạn').readOnly, true)
    assert.equal(amount.readOnly, true)
    for (const value of ['0', '1.5', '21', '1000001']) {
      await input(rooms, value)
      assert.equal(rooms.checkValidity(), false, value)
      await click(dialog.querySelector('[type="submit"]'))
      assert.equal(saved.length, 0)
    }
    await input(rooms, '17')
    assert.equal(amount.value, '')
    assert.equal(dialog.querySelector('[type="submit"]').disabled, true)
    await input(rooms, '16')
    assert.equal(amount.value, '999999999999999.9999')
    await input(field('Chu kỳ thuê bao'), 'yearly')
    assert.equal(amount.value, '1210.1250')
    await input(field('Chu kỳ thuê bao'), 'monthly')
    await input(field('Bắt đầu kỳ'), '30/10/2099 12:00')
    await input(field('Hạn sử dụng mới'), '29/10/2099 12:00')
    assert.equal(field('Hạn sử dụng mới').checkValidity(), false)
    await input(field('Hạn sử dụng mới'), '30/10/2099 12:00')
    await click(dialog.querySelector('[type="submit"]'))
    assert.equal(saved.length, 0)
    await input(field('Hạn sử dụng mới'), '30/11/2099 12:00')
    await click(dialog.querySelector('[type="submit"]'))
    assert.equal(saved.length, 1)
    assert.equal(saved[0][1].amount, '999999999999999.9999')
    assert.equal(saved[0][1].roomCount, 16)
    assert.equal(saved[0][1].currency, 'VND')
  })
})
