import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

const services = [
  { id: 'a', name: 'Service A', price: '100.0000' },
  { id: 'b', name: 'Service B', price: '200.5000' },
  { id: 'free', name: 'Free service', price: '0.0000' },
  { id: 'bad', name: 'Invalid catalog price', price: 'not-money' },
  { id: 'inactive', name: 'Inactive', price: '50', active: false },
]

async function setup(dom, overrides = {}, guarded = false) {
  const { React, load, mount } = dom
  const { default: BookingTabs } = await load(
    '/src/apps/pms/reservations/components/BookingTabs.jsx',
  )
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const { DraftGuardProvider, useDraftNavigation } = await load(
    '/src/shared/drafts/DraftGuardProvider.jsx',
  )
  const calls = [],
    pending = []
  const context = {
    services,
    paymentMethods: [],
    funds: [],
    settings: { currency: 'USD', timezone: 'UTC' },
    access: () => ({ allowed: true }),
    addCharge: async (...args) => {
      calls.push(args)
    },
    ...overrides,
  }
  const booking = {
    id: 'booking-service',
    status: 'IN_HOUSE',
    currency: 'USD',
    guests: [],
    charges: [],
  }
  const h = React.createElement
  function Leave() {
    const navigation = useDraftNavigation()
    return h('button', { onClick: () => navigation.requestLeave(() => {}) }, 'Leave')
  }
  const body = h(
    PmsContext.Provider,
    { value: context },
    h(BookingTabs, {
      booking,
      tab: 'dịchvụ',
      onPendingChange: (value) => pending.push(value),
      isParentPending: overrides.isParentPending,
    }),
    guarded && h(Leave),
  )
  const view = await mount(
    h(React.StrictMode, null, guarded ? h(DraftGuardProvider, null, body) : body),
  )
  const field = (label) => view.container.querySelector(`[aria-label="${label}"]`)
  return {
    ...view,
    calls,
    pending,
    field,
    form: view.container.querySelector('form'),
    pick: (value) => dom.input(field('Dịch vụ'), value),
  }
}

test('catalog services fill exact defaults, replace automatic values, clear on deselect and reject an invalid catalog price', async () => {
  await withDraftDom(async (dom) => {
    const view = await setup(dom)
    assert.equal(view.field('Dịch vụ').querySelector('[value="inactive"]'), null)
    await view.pick('a')
    assert.equal(view.field('Nội dung khoản phí').value, 'Service A')
    assert.equal(view.field('Số lượng').value, '1')
    assert.equal(view.field('Đơn giá').value, '100.0000')
    await view.pick('b')
    assert.equal(view.field('Nội dung khoản phí').value, 'Service B')
    assert.equal(view.field('Đơn giá').value, '200.5000')
    await view.pick('bad')
    assert.equal(view.field('Đơn giá').value, '')
    assert.match(view.container.querySelector('[role="alert"]').textContent, /Giá dịch vụ/)
    await dom.input(view.field('Đơn giá'), '125')
    assert.equal(view.container.querySelector('[role="alert"]'), null)
    await view.pick('a')
    assert.equal(view.field('Đơn giá').value, '125')
    await dom.input(view.field('Đơn giá'), '')
    await view.pick('free')
    assert.equal(view.field('Đơn giá').value, '0.0000')
    await view.pick('')
    for (const label of ['Nội dung khoản phí', 'Số lượng', 'Đơn giá'])
      assert.equal(view.field(label).value, '')
  })
})

test('manual fields remain owned by the user even when retyped to the old automatic value', async () => {
  await withDraftDom(async (dom) => {
    const view = await setup(dom)
    await view.pick('a')
    for (const [label, intermediate, restored] of [
      ['Nội dung khoản phí', 'Changed', 'Service A'],
      ['Đơn giá', '101', '100.0000'],
      ['Số lượng', '2', '1'],
    ]) {
      await dom.input(view.field(label), intermediate)
      await dom.input(view.field(label), restored)
    }
    await dom.input(view.field('Loại khoản phí'), 'fee')
    await view.pick('b')
    await view.pick('')
    assert.equal(view.field('Nội dung khoản phí').value, 'Service A')
    assert.equal(view.field('Đơn giá').value, '100.0000')
    assert.equal(view.field('Số lượng').value, '1')
    assert.equal(view.field('Loại khoản phí').value, 'fee')
    await dom.act(async () => view.form.requestSubmit())
    assert.equal(view.calls.length, 1)
    assert.deepEqual(view.calls[0][1], {
      serviceId: '',
      description: 'Service A',
      quantity: '1',
      unitPrice: '100.0000',
      type: 'fee',
    })
    assert.match(view.calls[0][2], /^[a-f0-9-]{36}$/)
  })
})

test('service defaults preserve permission, pending and successful-reset behaviour', async () => {
  await withDraftDom(async (dom) => {
    const denied = await setup(dom, { access: () => ({ allowed: false }) })
    assert.equal(denied.form.querySelector('fieldset').disabled, true)
    await denied.unmount()
    const deferred = Promise.withResolvers(),
      writes = []
    const view = await setup(dom, {
      addCharge: async (...args) => {
        writes.push(args)
        await deferred.promise
      },
    })
    await view.pick('a')
    await dom.act(async () => view.form.requestSubmit())
    await dom.act(async () =>
      view.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
    )
    assert.equal(writes.length, 1)
    assert.equal(view.form.querySelector('fieldset').disabled, true)
    await dom.act(async () => deferred.resolve())
    assert.deepEqual(view.pending, [true, false])
    await view.pick('b')
    assert.equal(view.field('Đơn giá').value, '200.5000')
    await view.unmount()
    const parentPending = await setup(dom, { isParentPending: () => true })
    assert.equal(parentPending.field('Dịch vụ').disabled, true)
  })
})

test('discarding a service draft resets automatic-field ownership', async () => {
  await withDraftDom(async (dom) => {
    const view = await setup(dom, {}, true)
    await view.pick('a')
    await dom.input(view.field('Đơn giá'), '125')
    await dom.click(
      [...view.container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Leave',
      ),
    )
    const confirmation = dom.document.querySelector('.draft-confirmation')
    assert.ok(confirmation)
    await dom.click(confirmation.querySelector('.draft-confirmation-discard'))
    await view.pick('a')
    await view.pick('b')
    assert.equal(view.field('Đơn giá').value, '200.5000')
  })
})
