import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter, RouterProvider, createMemoryRouter, Outlet } from 'react-router-dom'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

// ---------- synthetic fixtures ----------
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
const listing = (rows, totalItems = rows.length) => ({
  posInvoices: rows,
  pagination: { totalItems },
})

// 1000 eligible bookings whose IDs all share the same first 10 characters.
const eligibleId = (i) => `BOOKING-00-${String(i).padStart(4, '0')}`
const FAR = eligibleId(999)
const FIRST = eligibleId(0)
const LEGACY_ROOM = eligibleId(500)
const INELIGIBLE = ['BOOKING-00-X001', 'BOOKING-00-X002', 'BOOKING-00-X003', 'BOOKING-00-X004']
function bookingFixtures() {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: eligibleId(i),
    guest: `Guest ${i}`,
    room: String(1000 + i),
    checkIn: '2026-12-01',
    checkOut: '2026-12-03',
    status: i % 2 ? 'IN_HOUSE' : 'CONFIRMED',
    currency: 'USD',
  }))
  // Duplicate guest names, distinguished only by ID, rooms, dates and status.
  rows[0] = {
    ...rows[0],
    guest: 'Nguyễn Thị Ánh',
    checkIn: '2026-12-01',
    checkOut: '2026-12-04',
    status: 'CONFIRMED',
  }
  const { room: _unused, ...far } = rows[999]
  rows[999] = {
    ...far,
    guest: 'Nguyễn Thị Ánh',
    rooms: ['7A01', '7A02'],
    checkIn: '2026-12-10',
    checkOut: '2026-12-12',
    status: 'IN_HOUSE',
  }
  rows[500] = { ...rows[500], room: '9Q09' }
  // Ineligible rows come first so a missing filter would surface them in the first page.
  const ineligible = [
    {
      id: INELIGIBLE[0],
      guest: 'Nguyễn Thị Ánh',
      room: '7A01',
      checkIn: '2026-11-01',
      checkOut: '2026-11-02',
      status: 'CHECKED_OUT',
      currency: 'USD',
    },
    {
      id: INELIGIBLE[1],
      guest: 'Nguyễn Thị Ánh',
      room: '9Q09',
      checkIn: '2026-11-01',
      checkOut: '2026-11-02',
      status: 'CANCELLED',
      currency: 'USD',
    },
    {
      id: INELIGIBLE[2],
      guest: 'Nguyễn Thị Ánh',
      room: '7A01',
      checkIn: '2026-12-01',
      checkOut: '2026-12-02',
      status: 'CONFIRMED',
      currency: 'EUR',
    },
    {
      id: INELIGIBLE[3],
      guest: 'Guest 0999',
      room: '7A01',
      checkIn: '2026-12-01',
      checkOut: '2026-12-02',
      status: 'NO_SHOW',
      currency: 'USD',
    },
  ]
  return [...ineligible, ...rows]
}

// ---------- DOM helpers ----------
const BACK = '← Danh sách hóa đơn'
const button = (root, name) =>
  [...root.querySelectorAll('button')].find((node) => node.textContent.trim() === name)
const labelled = (root, name, selector = 'input') =>
  [...root.querySelectorAll('label')]
    .find((label) => label.textContent.trim().startsWith(name))
    ?.querySelector(selector)
const confirmation = (dom) => dom.document.querySelector('.draft-confirmation')
const tiles = (root) => [
  ...root.querySelectorAll('[role="group"][aria-label="Danh sách dịch vụ"] button'),
]
const bookingSelect = (view) => labelled(view.container, 'Ghi vào booking', 'select')
const bookingSearch = (view) => labelled(view.container, 'Tìm booking')
const bookingValues = (view) =>
  [...bookingSelect(view).options].map((option) => option.value).filter(Boolean)
const optionText = (view, id) =>
  [...bookingSelect(view).options].find((option) => option.value === id)?.textContent ?? ''
const preview = (view) => view.container.querySelector('.pos-booking-preview')?.textContent ?? ''
const sameSet = (actual, expected, message) =>
  assert.deepEqual([...actual].sort(), [...expected].sort(), message)
const hasDate = (text, iso) => {
  const [y, m, d] = iso.split('-')
  return text.includes(iso) || text.includes(`${d}/${m}/${y}`)
}
const invoiceRows = (view) =>
  [...view.container.querySelectorAll('tbody tr')]
    .filter((row) => button(row, 'Chi tiết'))
    .map((row) => row.textContent)
const showsCount = (view) => /\d+\s*hóa đơn/.test(view.container.textContent)
const showsEmpty = (view) => view.container.textContent.includes('Không có hóa đơn phù hợp')
const alertText = (view) =>
  [...view.container.querySelectorAll('[role="alert"]')].map((node) => node.textContent).join(' | ')

function listScript(steps) {
  const calls = []
  const fn = (args) => {
    calls.push({ ...args })
    const step = steps.shift()
    if (!step) return Promise.reject(new Error('unexpected list request'))
    return typeof step === 'function' ? step(args) : Promise.resolve(step)
  }
  return { calls, fn }
}

async function mountSales(dom, { overrides = {}, router: useRouter = false } = {}) {
  const { React, load, mount } = dom
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
    getPosInvoices: async () => listing([]),
    getPosInvoice: async (id) => invoice({ id }),
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
  } else
    tree = h(
      DraftGuardProvider,
      null,
      h(MemoryRouter, null, h(PmsContext.Provider, { value: context }, h(Sales))),
    )
  const view = await mount(tree)
  return {
    ...view,
    context,
    calls,
    router,
    press: (name) => dom.click(button(view.container, name)),
  }
}

async function openEditor(dom, view, { withServiceA = true } = {}) {
  await view.press('+ Thêm mới')
  if (withServiceA)
    await dom.click(tiles(view.container).find((node) => node.textContent.startsWith('Service A')))
}

// ---------- booking search ----------

test('"Tìm booking" searches every eligible booking by accent-insensitive guest, canonical rooms and full ID with a capped native list', async () => {
  await withDraftDom(async (dom) => {
    const view = await mountSales(dom, { overrides: { bookings: bookingFixtures() } })
    await openEditor(dom, view)
    assert.equal(bookingSelect(view)?.tagName, 'SELECT', 'the booking choice stays a native select')
    assert.ok(bookingSearch(view), 'a "Tìm booking" search field exists')
    assert.equal(
      [...bookingSelect(view).options].some((option) => option.value === ''),
      true,
      'standalone stays available',
    )

    // Without a query: at most the first 50 eligible options, never ineligible ones.
    let values = bookingValues(view)
    assert.equal(values.length, 50)
    assert.equal(
      values.some((id) => INELIGIBLE.includes(id)),
      false,
    )

    // Full ID suffix beyond the 10-character abbreviation finds the far end.
    await dom.input(bookingSearch(view), '0999')
    sameSet(bookingValues(view), [FAR], 'ID suffix')
    await dom.input(bookingSearch(view), 'booking-00-0999')
    sameSet(bookingValues(view), [FAR], 'full ID, case-insensitive')

    // Accent-insensitive guest search; duplicate guests stay distinguishable.
    for (const query of ['nguyen thi anh', 'NGUYEN THI ANH', 'nguyễn thị ánh']) {
      await dom.input(bookingSearch(view), query)
      sameSet(bookingValues(view), [FIRST, FAR], query)
    }
    const farText = optionText(view, FAR)
    const firstText = optionText(view, FIRST)
    assert.notEqual(farText, firstText, 'duplicate guests have distinct options')
    assert.equal(farText.includes(FAR), true, 'option shows the full ID')
    assert.equal(firstText.includes(FIRST), true, 'option shows the full ID')
    assert.equal(
      farText.includes('7A01') && farText.includes('7A02'),
      true,
      'option shows every room',
    )
    assert.equal(firstText.includes('1000'), true, 'option shows the room')
    assert.equal(
      hasDate(farText, '2026-12-10') && hasDate(farText, '2026-12-12'),
      true,
      'option shows check-in/check-out',
    )
    assert.equal(
      hasDate(firstText, '2026-12-01') && hasDate(firstText, '2026-12-04'),
      true,
      'option shows check-in/check-out',
    )
    assert.match(farText, /IN_HOUSE|Đang ở/)
    assert.match(firstText, /CONFIRMED|Đã xác nhận/)
    assert.equal(
      farText.includes('USD') && firstText.includes('USD'),
      true,
      'option shows the currency',
    )

    // Room search goes through bookingRooms(): rooms[] and the legacy single room.
    await dom.input(bookingSearch(view), '7a02')
    sameSet(bookingValues(view), [FAR], 'rooms[] entry')
    await dom.input(bookingSearch(view), '9Q09')
    sameSet(bookingValues(view), [LEGACY_ROOM], 'legacy room field')

    // Broad queries stay capped at 50, plus the selected booking.
    await dom.input(bookingSearch(view), 'guest')
    values = bookingValues(view)
    assert.equal(values.length, 50)
    assert.equal(
      values.some((id) => INELIGIBLE.includes(id)),
      false,
    )
    await dom.input(bookingSearch(view), '0999')
    await dom.input(bookingSelect(view), FAR)
    await dom.input(bookingSearch(view), 'guest')
    values = bookingValues(view)
    assert.equal(values.length, 51, 'first 50 matches plus the selected booking')
    assert.equal(values.includes(FAR), true)
    assert.equal(bookingSelect(view).value, FAR)
  })
})

test('selecting a far-end booking previews its identity without side effects; search is clean, the choice is dirty and only posting sends it', async () => {
  await withDraftDom(async (dom) => {
    const view = await mountSales(dom, { router: true, overrides: { bookings: bookingFixtures() } })
    await openEditor(dom, view, { withServiceA: false })
    await dom.input(bookingSearch(view), '0999')
    await view.press(BACK)
    assert.equal(confirmation(dom), null, 'typing a booking search alone is not a draft edit')
    assert.equal(Boolean(button(view.container, BACK)), false)

    await openEditor(dom, view)
    await dom.input(labelled(view.container, 'Tên khách'), 'Khách A')
    const quantity = () => view.container.querySelector('[aria-label="Số lượng Service A"]')
    const price = () => view.container.querySelector('[aria-label="Đơn giá Service A"]')
    await dom.input(quantity(), '2')
    await view.press('Lưu nháp')
    assert.equal(view.calls.save.length, 1)

    await dom.input(bookingSearch(view), '0999')
    await dom.input(bookingSelect(view), FAR)
    assert.equal(bookingSelect(view).value, FAR)
    const text = preview(view)
    assert.equal(text.includes(FAR), true, 'preview shows the full ID')
    assert.equal(text.includes('Nguyễn Thị Ánh'), true)
    assert.equal(text.includes('7A01') && text.includes('7A02'), true, 'preview shows every room')
    assert.equal(
      hasDate(text, '2026-12-10') && hasDate(text, '2026-12-12'),
      true,
      'preview shows the stay dates',
    )
    assert.match(text, /IN_HOUSE|Đang ở/)
    assert.equal(text.includes('USD'), true)
    // No side effects on the draft or the route.
    assert.equal(labelled(view.container, 'Tên khách').value, 'Khách A')
    assert.equal(quantity().value, '2')
    assert.equal(price().value, '0.0002')
    assert.equal(view.container.querySelector('.pos-draft-total strong').textContent, '0.0004 USD')
    assert.equal(view.calls.save.length, 1)
    assert.equal(view.calls.post.length, 0)
    assert.equal(view.router.state.location.pathname, '/id/sales')
    assert.equal(confirmation(dom), null)

    // A different or empty-result query keeps the selected booking and its preview.
    for (const query of ['Guest 12', 'zzz-no-match', '']) {
      await dom.input(bookingSearch(view), query)
      assert.equal(bookingSelect(view).value, FAR, query)
      assert.equal(preview(view).includes(FAR), true, query)
    }

    await view.press(BACK)
    assert.ok(confirmation(dom), 'the booking choice is an unsaved edit')
    await dom.click(confirmation(dom).querySelector('button'))
    assert.equal(bookingSelect(view).value, FAR)

    await view.press('Lưu nháp')
    assert.equal(view.calls.save.length, 2)
    assert.equal(
      view.calls.save.some((body) => 'bookingId' in body),
      false,
      'draft saves never send bookingId',
    )
    await view.press('Ghi nhận hóa đơn')
    assert.equal(view.calls.post.length, 1)
    assert.equal(view.calls.post[0][1].bookingId, FAR, 'posting sends the exact full ID')
  })
})

test('a chosen booking that became ineligible blocks a new post and keeps the draft, selection and a warning', async () => {
  await withDraftDom(async (dom) => {
    const id = 'BOOKING-00-0001-LONG-SUFFIX'
    const view = await mountSales(dom, {
      overrides: {
        bookings: [
          {
            id,
            guest: 'Khách B',
            rooms: ['301'],
            checkIn: '2026-12-01',
            checkOut: '2026-12-03',
            status: 'CONFIRMED',
            currency: 'USD',
          },
        ],
      },
    })
    await openEditor(dom, view)
    await dom.input(bookingSelect(view), id)
    assert.equal(bookingSelect(view).value, id)

    view.context.bookings = view.context.bookings.map((row) => ({ ...row, status: 'CHECKED_OUT' }))
    await dom.input(labelled(view.container, 'Tên khách'), 'Khách đổi')
    await view.press('Ghi nhận hóa đơn')

    assert.equal(view.calls.save.length, 0, 'no save for an ineligible booking target')
    assert.equal(view.calls.post.length, 0, 'no post for an ineligible booking target')
    assert.equal(bookingSelect(view).value, id, 'the selection is retained')
    assert.equal(labelled(view.container, 'Tên khách').value, 'Khách đổi')
    assert.equal(view.container.querySelector('[aria-label="Số lượng Service A"]').value, '1')
    const warnings = [...view.container.querySelectorAll('[role="alert"], [role="status"]')].map(
      (node) => node.textContent,
    )
    assert.equal(
      warnings.some((message) => /booking/i.test(message)),
      true,
      'a booking warning is announced',
    )
  })
})

// ---------- invoice listing ----------

test('an initial list failure offers an explicit retry instead of a fake empty result; loading shows no count; a true empty result is clear', async () => {
  await withDraftDom(async (dom) => {
    const first = Promise.withResolvers()
    const script = listScript([() => first.promise, listing([])])
    const view = await mountSales(dom, { overrides: { getPosInvoices: script.fn } })
    assert.equal(showsCount(view), false, 'no fake count while loading')
    assert.equal(showsEmpty(view), false)

    await dom.act(async () => first.reject(new Error('Máy chủ không phản hồi')))
    assert.match(alertText(view), /Máy chủ không phản hồi|không tải được/i)
    assert.ok(button(view.container, 'Thử lại'), 'an explicit retry is offered')
    assert.equal(invoiceRows(view).length, 0)
    assert.equal(showsEmpty(view), false, 'a failed read is not an empty result')
    assert.equal(showsCount(view), false, 'a failed read has no count')
    assert.equal(script.calls.length, 1, 'no automatic retry')

    await view.press('Thử lại')
    assert.equal(script.calls.length, 2)
    assert.deepEqual(script.calls[1], script.calls[0])
    assert.equal(showsEmpty(view), true, 'a successful empty read says so')
    assert.match(view.container.textContent.match(/\d+\s*hóa đơn/)?.[0] ?? '', /^0\s*hóa đơn$/)
    assert.equal(alertText(view), '')
    assert.equal(button(view.container, 'Thử lại'), undefined)
  })
})

test('retrying a failed page 2 of a submitted search keeps q/page/pageSize and never shows page 1 rows as current', async () => {
  await withDraftDom(async (dom) => {
    const second = Promise.withResolvers()
    const retry = Promise.withResolvers()
    const script = listScript([
      listing([invoice({ id: 'inv-0', customerName: 'Khách đầu', status: 'POSTED' })]),
      listing([invoice({ id: 'inv-p1', customerName: 'Khách trang 1', status: 'POSTED' })], 30),
      () => second.promise,
      () => retry.promise,
    ])
    const view = await mountSales(dom, { overrides: { getPosInvoices: script.fn } })
    const searchBox = () => labelled(view.container, 'Tìm hóa đơn')
    await dom.input(searchBox(), 'abc')
    await view.press('Tìm / tải lại')
    assert.equal(
      invoiceRows(view).some((row) => row.includes('Khách trang 1')),
      true,
    )
    await view.press('Trang sau')
    assert.deepEqual(script.calls[2], { q: 'abc', page: 2, pageSize: 25 })
    assert.equal(
      invoiceRows(view).some((row) => row.includes('Khách trang 1')),
      false,
      'page 1 rows are not shown while page 2 loads',
    )

    await dom.act(async () => second.reject(new Error('Mất kết nối')))
    assert.ok(button(view.container, 'Thử lại'))
    assert.notEqual(alertText(view), '')
    assert.equal(invoiceRows(view).length, 0, 'stale page 1 rows are not shown as page 2')
    assert.equal(script.calls.length, 3, 'no automatic retry')

    await dom.input(searchBox(), 'unsubmitted edit')
    await view.press('Thử lại')
    assert.equal(script.calls.length, 4)
    assert.deepEqual(
      script.calls[3],
      { q: 'abc', page: 2, pageSize: 25 },
      'retry repeats the failed request',
    )
    await dom.act(async () =>
      retry.resolve(
        listing([invoice({ id: 'inv-p2', customerName: 'Khách trang 2', status: 'POSTED' })], 30),
      ),
    )
    const rows = invoiceRows(view)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].includes('Khách trang 2'), true)
    assert.equal(alertText(view), '')
    assert.equal(view.calls.save.length + view.calls.post.length, 0, 'retry never writes')
  })
})

test('a failed detail read is an action error beside the intact listing, and stale list responses are ignored', async () => {
  await withDraftDom(async (dom) => {
    const alpha = Promise.withResolvers()
    const beta = Promise.withResolvers()
    const script = listScript([
      listing([invoice({ id: 'inv-1', customerName: 'Khách có sẵn', status: 'POSTED' })]),
      () => alpha.promise,
      () => beta.promise,
    ])
    const view = await mountSales(dom, {
      overrides: {
        getPosInvoices: script.fn,
        getPosInvoice: async () => {
          throw new Error('Không tải được chi tiết')
        },
      },
    })
    await view.press('Chi tiết')
    assert.match(alertText(view), /Không tải được chi tiết/)
    assert.equal(button(view.container, BACK), undefined, 'the editor does not open')
    const rows = invoiceRows(view)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].includes('Khách có sẵn'), true)
    assert.match(view.container.textContent.match(/\d+\s*hóa đơn/)?.[0] ?? '', /^1\s*hóa đơn$/)
    assert.equal(showsEmpty(view), false)

    const form = labelled(view.container, 'Tìm hóa đơn').closest('form')
    await dom.input(labelled(view.container, 'Tìm hóa đơn'), 'alpha')
    await dom.act(async () => form.requestSubmit())
    await dom.input(labelled(view.container, 'Tìm hóa đơn'), 'beta')
    await dom.act(async () => form.requestSubmit())
    assert.equal(script.calls.at(-1).q, 'beta')
    await dom.act(async () =>
      beta.resolve(
        listing([invoice({ id: 'inv-beta', customerName: 'Beta row', status: 'POSTED' })]),
      ),
    )
    await dom.act(async () =>
      alpha.resolve(
        listing([invoice({ id: 'inv-alpha', customerName: 'Alpha row', status: 'POSTED' })]),
      ),
    )
    const latest = invoiceRows(view)
    assert.equal(latest.length, 1)
    assert.equal(latest[0].includes('Beta row'), true, 'the latest request wins')
  })
})
