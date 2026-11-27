import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter, RouterProvider, createMemoryRouter, Outlet } from 'react-router-dom'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

const item = (serviceId = 'a', quantity = '1', unitPrice = '0.0002') => ({
  serviceId,
  description: serviceId === 'a' ? 'Service A' : 'Service B',
  quantity,
  unitPrice,
})
const invoice = (extra) => ({
  id: 'invoice-a',
  status: 'DRAFT',
  currency: 'USD',
  customerName: '',
  note: '',
  total: '3.0000',
  paid: '0',
  balance: '3.0000',
  items: [item()],
  payments: [],
  createdAt: '2026-11-16T10:00:00Z',
  ...extra,
})
const button = (container, name) =>
  [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === name)

async function setup(
  dom,
  { record, overrides = {}, router: useRouter = false, blank = false } = {},
) {
  const { React, load, mount, click } = dom
  const { default: Sales } = await load('/src/apps/pms/finance/pages/Sales.jsx')
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const { DraftGuardProvider, DraftRouteGuard } = await load(
    '/src/shared/drafts/DraftGuardProvider.jsx',
  )
  const calls = { save: [], post: [] }
  const context = {
    tenantId: 'hotel-a',
    workspaceRevision: 1,
    settings: { timezone: 'UTC', currency: 'USD' },
    access: () => ({ allowed: true }),
    services: [
      { id: 'a', name: 'Service A', price: '0.0002' },
      { id: 'b', name: 'Service B', price: '0.0001' },
    ],
    serviceCategories: [],
    bookings: [],
    funds: [],
    paymentMethods: [],
    getPosInvoices: async () => ({
      posInvoices: record ? [record] : [],
      pagination: { totalItems: record ? 1 : 0 },
    }),
    getPosInvoice: async () => record,
    savePosInvoice: async (body) => {
      calls.save.push(body)
      return invoice({ ...body })
    },
    postPosInvoice: async (id, body) => {
      calls.post.push([id, body])
      return invoice({ id, status: 'POSTED', bookingId: body.bookingId, total: '3.0000' })
    },
    ...overrides,
  }
  const h = React.createElement
  let router
  let tree
  if (useRouter) {
    function Shell() {
      return h(
        React.Fragment,
        null,
        h(DraftRouteGuard),
        h(PmsContext.Provider, { value: context }, h(Outlet)),
      )
    }
    router = createMemoryRouter(
      [
        {
          element: h(Shell),
          children: [
            { path: '/id/sales', element: h(Sales) },
            { path: '/id/reservations', element: h('p', null, 'Booking destination') },
          ],
        },
      ],
      { initialEntries: ['/id/reservations', '/id/sales'], initialIndex: 1 },
    )
    tree = h(DraftGuardProvider, null, h(RouterProvider, { router }))
  } else tree = h(MemoryRouter, null, h(PmsContext.Provider, { value: context }, h(Sales)))
  const view = await mount(tree)
  await click(button(view.container, record ? 'Chi tiết' : '+ Thêm mới'))
  if (!record && !blank)
    await click(
      [...view.container.querySelectorAll('button')].find((node) =>
        node.textContent.startsWith('Service A'),
      ),
    )
  return {
    ...view,
    calls,
    router,
    quantity: () => view.container.querySelector('[aria-label="Số lượng Service A"]'),
    price: () => view.container.querySelector('[aria-label="Đơn giá Service A"]'),
    total: () => view.container.querySelector('.pos-draft-total strong'),
    press: (name) => click(button(view.container, name)),
  }
}

test('POS draft totals are exact before saving and invalid products or totals never produce a misleading amount', async () => {
  await withDraftDom(async (dom) => {
    const view = await setup(dom)
    await dom.input(view.quantity(), '0.5')
    assert.equal(view.total().textContent, '0.0001 USD')
    assert.equal(view.container.querySelector('.pos-line-amount').textContent, '0.0001 USD')
    assert.equal(view.calls.save.length, 0)
    await dom.input(view.price(), '0.0001')
    assert.equal(view.total().textContent, '—')
    assert.match(view.container.querySelector('[role="alert"]').textContent, /4 chữ số thập phân/)
    assert.equal(button(view.container, 'Lưu nháp').disabled, true)
    assert.equal(button(view.container, 'Ghi nhận hóa đơn').disabled, true)
    await dom.input(view.quantity(), '1')
    await dom.input(view.price(), '999999999999999.9999')
    assert.equal(view.total().textContent, '999,999,999,999,999.9999 USD')
    await dom.click(
      [...view.container.querySelectorAll('button')].find((node) =>
        node.textContent.startsWith('Service B'),
      ),
    )
    assert.equal(view.total().textContent, '—')
    assert.match(view.container.textContent, /Tổng hóa đơn vượt giới hạn/)
    const secondRow = [...view.container.querySelectorAll('fieldset table tbody tr')][1]
    await dom.click(secondRow.querySelector('button'))
    for (const invalid of ['', '0', '1e3', '-1', '1.00001', '100000000']) {
      await dom.input(view.quantity(), invalid)
      assert.equal(view.total().textContent, '—', invalid)
      assert.equal(button(view.container, 'Lưu nháp').disabled, true, invalid)
    }
    assert.equal(view.calls.save.length, 0)
  })
})

test('saved and draft totals stay distinct and posting automatically saves once without a separate draft step', async () => {
  await withDraftDom(async (dom) => {
    const view = await setup(dom)
    await dom.input(view.quantity(), '2')
    await dom.input(view.price(), '1.5')
    await view.press('Lưu nháp')
    assert.equal(view.calls.save.length, 1)
    assert.match(view.container.textContent, /Tổng đã lưu:.*3.00 USD/)
    await dom.input(view.quantity(), '3')
    assert.equal(view.total().textContent, '4.50 USD')
    assert.match(view.container.textContent, /Tổng đã lưu:.*3.00 USD/)
    await view.unmount()
    const direct = await setup(dom)
    await direct.press('Ghi nhận hóa đơn')
    assert.equal(direct.calls.save.length, 1)
    assert.equal(direct.calls.post.length, 1)
  })
})

test('a posted booking invoice opens its exact payment tab and protects an unfinished cancellation reason', async () => {
  await withDraftDom(async (dom) => {
    const id = 'BOOK /?% & test'
    const view = await setup(dom, {
      record: invoice({ status: 'POSTED', bookingId: id }),
      router: true,
    })
    const link = view.container.querySelector('a')
    assert.ok(link)
    assert.equal(new URL(link.href).searchParams.get('booking'), id)
    assert.equal(new URL(link.href).searchParams.get('tab'), 'payments')
    assert.doesNotMatch(view.container.textContent, /Quỹ thu|Chọn phương thức/)
    const cancelForm = [...view.container.querySelectorAll('form')].find((form) =>
      form.textContent.includes('Hủy và ghi giao dịch đối ứng'),
    )
    await dom.input(cancelForm.querySelector('input'), 'Unfinished cancellation')
    await dom.click(link)
    assert.equal(view.router.state.location.pathname, '/id/sales')
    let confirmation = dom.document.querySelector('.draft-confirmation')
    assert.ok(confirmation)
    await dom.click(confirmation.querySelector('button'))
    assert.equal(cancelForm.querySelector('input').value, 'Unfinished cancellation')
    await dom.click(link)
    confirmation = dom.document.querySelector('.draft-confirmation')
    await dom.click(confirmation.querySelector('.draft-confirmation-discard'))
    assert.equal(view.router.state.location.pathname, '/id/reservations')
    const params = new URLSearchParams(view.router.state.location.search)
    assert.equal(params.get('booking'), id)
    assert.equal(params.get('tab'), 'payments')
  })
})

test('only posted booking invoices expose the payment link and standalone payment remains available', async () => {
  await withDraftDom(async (dom) => {
    for (const status of ['DRAFT', 'CANCELLED']) {
      const view = await setup(dom, { record: invoice({ status, bookingId: 'booking-a' }) })
      assert.equal(view.container.querySelector('a'), null, status)
      await view.unmount()
    }
    const standalone = await setup(dom, { record: invoice({ status: 'POSTED' }) })
    assert.equal(standalone.container.querySelector('a'), null)
    assert.match(standalone.container.textContent, /Quỹ thu/)
  })
})

test('a pending write makes the booking link inert and cannot queue a later navigation', async () => {
  await withDraftDom(async (dom) => {
    const pending = Promise.withResolvers()
    const record = invoice({ status: 'POSTED', bookingId: 'booking-a' })
    const view = await setup(dom, {
      record,
      router: true,
      overrides: {
        cancelPosInvoice: async () => {
          await pending.promise
          return invoice({ status: 'CANCELLED' })
        },
      },
    })
    const cancelForm = [...view.container.querySelectorAll('form')].find((form) =>
      form.textContent.includes('Hủy và ghi giao dịch đối ứng'),
    )
    await dom.input(cancelForm.querySelector('input'), 'Cancel this invoice')
    await dom.act(async () => cancelForm.requestSubmit())
    const link = view.container.querySelector('a')
    assert.equal(link.getAttribute('aria-disabled'), 'true')
    await dom.click(link)
    assert.equal(view.router.state.location.pathname, '/id/sales')
    assert.equal(dom.document.querySelector('.draft-confirmation'), null)
    await dom.act(async () => pending.resolve())
    assert.equal(view.router.state.location.pathname, '/id/sales')
  })
})

const BACK = '← Danh sách hóa đơn'
const confirmation = (dom) => dom.document.querySelector('.draft-confirmation')
const keepEditing = (dom) => dom.click(confirmation(dom).querySelector('button'))
const discardDraft = (dom) =>
  dom.click(confirmation(dom).querySelector('.draft-confirmation-discard'))
const labelled = (root, name, selector = 'input') =>
  [...root.querySelectorAll('label')]
    .find((label) => label.textContent.startsWith(name))
    ?.querySelector(selector)
const go = (dom, view, to) =>
  dom.act(async () => {
    view.router.navigate(to)
  })
const inEditor = (view) => Boolean(button(view.container, BACK))
const tiles = (root) => [
  ...root.querySelectorAll('[role="group"][aria-label="Danh sách dịch vụ"] button'),
]

test('a blank POS form and presentation-only filters close without warning; reverting edits is clean', async () => {
  await withDraftDom(async (dom) => {
    const view = await setup(dom, { router: true, blank: true })
    await dom.input(labelled(view.container, 'Tìm dịch vụ'), 'servi')
    await view.press(BACK)
    assert.equal(confirmation(dom), null)
    assert.equal(inEditor(view), false)
    await view.press('+ Thêm mới')
    await dom.input(labelled(view.container, 'Tên khách'), 'Khách A')
    await view.press(BACK)
    assert.ok(confirmation(dom))
    await keepEditing(dom)
    assert.equal(labelled(view.container, 'Tên khách').value, 'Khách A')
    await dom.input(labelled(view.container, 'Tên khách'), '')
    await dom.click(tiles(view.container).find((node) => node.textContent.startsWith('Service A')))
    await dom.click(view.container.querySelector('fieldset table tbody tr button'))
    await view.press(BACK)
    assert.equal(confirmation(dom), null)
    assert.equal(inEditor(view), false)
  })
})

test('a dirty POS draft guards route, history, unload and local close; Continue keeps lines and Discard resets', async () => {
  await withDraftDom(async (dom) => {
    const view = await setup(dom, { router: true })
    await dom.input(view.quantity(), '3')
    const unload = new dom.window.Event('beforeunload', { cancelable: true })
    dom.window.dispatchEvent(unload)
    assert.equal(unload.defaultPrevented, true)
    await go(dom, view, '/id/reservations')
    assert.equal(view.router.state.location.pathname, '/id/sales')
    assert.ok(confirmation(dom))
    await keepEditing(dom)
    assert.equal(view.quantity().value, '3')
    await go(dom, view, -1)
    assert.equal(view.router.state.location.pathname, '/id/sales')
    await keepEditing(dom)
    assert.equal(view.quantity().value, '3')
    await view.press(BACK)
    assert.ok(confirmation(dom))
    await keepEditing(dom)
    assert.equal(inEditor(view), true)
    assert.equal(view.quantity().value, '3')
    await view.press(BACK)
    await discardDraft(dom)
    assert.equal(inEditor(view), false)
    assert.equal(view.calls.save.length, 0)
    await view.press('+ Thêm mới')
    assert.equal(view.quantity(), null)
    await view.press(BACK)
    assert.equal(confirmation(dom), null)
  })
})

test('saving clears only persisted fields: failed saves stay dirty and an unposted booking choice is not marked saved', async () => {
  await withDraftDom(async (dom) => {
    let fail = true
    const saves = []
    const view = await setup(dom, {
      router: true,
      overrides: {
        bookings: [{ id: 'booking-1', guest: 'Guest One', status: 'CONFIRMED', currency: 'USD' }],
        savePosInvoice: async (body) => {
          saves.push(body)
          if (fail) throw new Error('Lưu thất bại')
          return invoice({ ...body })
        },
      },
    })
    await dom.input(labelled(view.container, 'Tên khách'), 'Khách A')
    await view.press('Lưu nháp')
    assert.match(view.container.querySelector('[role="alert"]').textContent, /Lưu thất bại/)
    await view.press(BACK)
    assert.ok(confirmation(dom))
    await keepEditing(dom)
    assert.equal(labelled(view.container, 'Tên khách').value, 'Khách A')
    assert.equal(view.quantity().value, '1')
    fail = false
    await view.press('Lưu nháp')
    assert.equal(saves.length, 2)
    await view.press(BACK)
    assert.equal(confirmation(dom), null)
    assert.equal(inEditor(view), false)

    await view.press('+ Thêm mới')
    await dom.click(tiles(view.container).find((node) => node.textContent.startsWith('Service A')))
    await dom.input(labelled(view.container, 'Ghi vào booking', 'select'), 'booking-1')
    await view.press('Lưu nháp')
    assert.equal(saves.length, 3)
    assert.equal('bookingId' in saves[2], false)
    await go(dom, view, '/id/reservations')
    assert.equal(view.router.state.location.pathname, '/id/sales')
    assert.ok(confirmation(dom), 'the booking choice was not persisted by the draft save')
    await keepEditing(dom)
    assert.equal(labelled(view.container, 'Ghi vào booking', 'select').value, 'booking-1')
    await dom.input(labelled(view.container, 'Ghi vào booking', 'select'), '')
    await view.press(BACK)
    assert.equal(confirmation(dom), null)
    assert.equal(inEditor(view), false)
  })
})

test('a failed post keeps its retry context guarded and a successful post leaves cleanly', async () => {
  await withDraftDom(async (dom) => {
    let fail = true
    const posts = []
    const view = await setup(dom, {
      router: true,
      overrides: {
        postPosInvoice: async (id, body) => {
          posts.push([id, body])
          if (fail) throw new Error('Mất kết nối')
          return invoice({ id, status: 'POSTED', total: '3.0000' })
        },
      },
    })
    await view.press('Ghi nhận hóa đơn')
    assert.equal(view.calls.save.length, 1)
    assert.match(view.container.textContent, /Đang chờ xác nhận ghi nhận hóa đơn/)
    await view.press(BACK)
    assert.ok(confirmation(dom))
    await keepEditing(dom)
    assert.match(view.container.textContent, /Đang chờ xác nhận ghi nhận hóa đơn/)
    fail = false
    await view.press('Kiểm tra và thử lại')
    assert.equal(view.calls.save.length, 1, 'retry must reuse the saved invoice')
    assert.equal(posts.length, 2)
    assert.match(view.container.textContent, /Đã ghi nhận/)
    await view.press(BACK)
    assert.equal(confirmation(dom), null)
    assert.equal(inEditor(view), false)
  })
})

test('a pending POS save blocks navigation and discard before rerender, then leaves the saved draft clean', async () => {
  await withDraftDom(async (dom) => {
    const pending = Promise.withResolvers()
    const view = await setup(dom, {
      router: true,
      overrides: {
        savePosInvoice: async (body) => {
          await pending.promise
          return invoice({ ...body })
        },
      },
    })
    await dom.input(labelled(view.container, 'Tên khách'), 'Khách chờ')
    await dom.act(async () => {
      button(view.container, 'Lưu nháp').click()
      view.router.navigate('/id/reservations')
    })
    assert.equal(view.router.state.location.pathname, '/id/sales')
    assert.ok(confirmation(dom))
    const discard = confirmation(dom).querySelector('.draft-confirmation-discard')
    assert.equal(discard.disabled, true)
    await dom.click(discard)
    assert.equal(view.router.state.location.pathname, '/id/sales')
    await keepEditing(dom)
    await dom.act(async () => pending.resolve())
    assert.equal(view.router.state.location.pathname, '/id/sales')
    assert.equal(labelled(view.container, 'Tên khách').value, 'Khách chờ')
    await view.press(BACK)
    assert.equal(confirmation(dom), null)
    assert.equal(inEditor(view), false)
  })
})

test('"Xem hóa đơn" from the catalog end focuses the cart summary without navigating, guarding, saving or posting', async () => {
  await withDraftDom(async (dom) => {
    const proto = dom.window.HTMLElement.prototype
    const original = Object.getOwnPropertyDescriptor(proto, 'scrollIntoView')
    const scrolls = []
    proto.scrollIntoView = function (options) {
      scrolls.push([this, options])
    }
    try {
      const services = Array.from({ length: 30 }, (_, i) => ({
        id: i ? 's' + i : 'a',
        name: i ? 'Dịch vụ ' + i : 'Service A',
        price: '1',
      }))
      const view = await setup(dom, {
        router: true,
        overrides: {
          services,
          bookings: [{ id: 'booking-1', guest: 'Guest One', status: 'CONFIRMED', currency: 'USD' }],
        },
      })
      await dom.input(labelled(view.container, 'Tên khách'), 'Khách A')
      await dom.input(view.quantity(), '3')
      await dom.input(labelled(view.container, 'Ghi vào booking', 'select'), 'booking-1')
      const last = tiles(view.container).at(-1)
      assert.equal(tiles(view.container).length, 24)
      const jump = button(view.container, 'Xem hóa đơn')
      assert.ok(jump)
      assert.equal(jump.type, 'button')
      assert.equal(jump.closest('form'), null)
      assert.ok(jump.closest('.pos-catalog'), 'the control lives in the catalog')
      assert.ok(
        last.compareDocumentPosition(jump) & dom.window.Node.DOCUMENT_POSITION_PRECEDING,
        'reachable above the catalog end via the sticky heading',
      )
      const before = { ...view.router.state.location }
      const hash = dom.window.location.hash
      scrolls.length = 0
      await dom.click(jump)
      const summary = view.container.querySelector('.pos-draft-summary')
      assert.equal(dom.document.activeElement, summary)
      assert.equal(summary.tabIndex, -1)
      assert.equal(scrolls.length, 1)
      assert.equal(scrolls[0][0] === summary, true, 'scrollIntoView targets the cart summary')
      for (const part of [
        summary.querySelector('.pos-draft-total strong'),
        labelled(summary, 'Ghi vào booking', 'select'),
        button(summary, 'Lưu nháp'),
        button(summary, 'Ghi nhận hóa đơn'),
      ])
        assert.ok(part, 'summary holds total, booking choice and actions')
      assert.equal(view.total().textContent, '3.00 USD')
      assert.equal(view.router.state.location.pathname, before.pathname)
      assert.equal(view.router.state.location.search, before.search)
      assert.equal(view.router.state.location.hash, before.hash)
      assert.equal(view.router.state.location.key, before.key)
      assert.equal(dom.window.location.hash, hash)
      assert.equal(confirmation(dom), null)
      assert.equal(view.calls.save.length, 0)
      assert.equal(view.calls.post.length, 0)
      assert.equal(labelled(view.container, 'Tên khách').value, 'Khách A')
      assert.equal(view.quantity().value, '3')
      assert.equal(labelled(view.container, 'Ghi vào booking', 'select').value, 'booking-1')
      await view.press(BACK)
      assert.ok(confirmation(dom), 'the draft is still dirty and guarded')
      await keepEditing(dom)
      assert.equal(view.quantity().value, '3')
    } finally {
      if (original) Object.defineProperty(proto, 'scrollIntoView', original)
      else delete proto.scrollIntoView
    }
  })
})

test('the invoice precedes a bounded catalog with accent-insensitive name, code and SKU search', async () => {
  await withDraftDom(async (dom) => {
    const services = Array.from({ length: 30 }, (_, i) => ({
      id: 's' + i,
      name: i === 0 ? 'Cà phê sữa đá' : 'Dịch vụ ' + i,
      code: 'SV' + String(i).padStart(3, '0'),
      sku: i === 5 ? 'MINI-ĐỎ' : '',
      price: '1',
      category: i < 26 ? 'Bar' : 'Spa',
    }))
    const view = await setup(dom, {
      blank: true,
      overrides: {
        services,
        serviceCategories: [
          { id: 'c1', name: 'Bar' },
          { id: 'c2', name: 'Spa' },
        ],
      },
    })
    const search = labelled(view.container, 'Tìm dịch vụ')
    assert.equal(search.closest('label').textContent.trim(), 'Tìm dịch vụ')
    const customer = labelled(view.container, 'Tên khách')
    assert.ok(
      customer.compareDocumentPosition(search) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      'invoice fields come before the catalog in focus order',
    )
    assert.ok(
      customer.compareDocumentPosition(tiles(view.container)[0]) &
        dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    )
    assert.equal(tiles(view.container).length, 24)
    assert.match(view.container.textContent, /Trang 1\/2 · 30 dịch vụ/)
    await view.press('Trang dịch vụ sau')
    assert.equal(tiles(view.container).length, 6)
    await dom.input(search, 'ca phe')
    assert.deepEqual(
      tiles(view.container).map((node) => node.textContent.startsWith('Cà phê sữa đá')),
      [true],
    )
    await dom.input(search, 'CÀ PHÊ SUA DA')
    assert.equal(tiles(view.container).length, 1)
    await dom.input(search, 'sv007')
    assert.deepEqual(
      tiles(view.container).map((node) => node.textContent.startsWith('Dịch vụ 7')),
      [true],
    )
    await dom.input(search, 'mini-do')
    assert.deepEqual(
      tiles(view.container).map((node) => node.textContent.startsWith('Dịch vụ 5')),
      [true],
    )
    await dom.input(search, 'zzz')
    assert.equal(tiles(view.container).length, 0)
    assert.match(view.container.textContent, /Không có dịch vụ phù hợp/)
    await dom.input(search, '')
    assert.equal(tiles(view.container).length, 24, 'search resets to the first page')
    await view.press('Trang dịch vụ sau')
    await dom.input(labelled(view.container, 'Nhóm dịch vụ', 'select'), 'Spa')
    assert.equal(tiles(view.container).length, 4)
    assert.equal(button(view.container, 'Trang dịch vụ sau'), undefined)
    const spa = tiles(view.container)[0]
    await dom.click(spa)
    await dom.click(spa)
    assert.equal(view.container.querySelectorAll('fieldset table tbody tr').length, 1)
    assert.equal(view.container.querySelector('fieldset table tbody input').value, '1')
  })
})
