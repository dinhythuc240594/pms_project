import test from 'node:test'
import assert from 'node:assert/strict'
import { workflowLink, workflowReturnState, workflowReturnTarget } from './workflowNavigation.js'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

const reviewId = '00000000-0000-0000-0000-000000000123'
const pmsScope = {
  tenantId: 'hotel-a',
  user: { id: 'owner-a', globalRole: 'USER' },
  authGeneration: 1,
}
test('workflow returns carry only allowed context and reject changed booking, hotel, user or login', () => {
  const source = {
    pathname: '/id/settings',
    search:
      '?section=channels&tab=history&reviewId=' + reviewId + '&reviewPage=3&token=private-test',
  }
  const link = workflowLink('/id/reservations?booking=stay-1', 'stay-1', pmsScope, source)
  const location = { state: link.state }
  assert.equal(
    workflowReturnTarget(location, 'stay-1', pmsScope),
    '/id/settings?section=channels&tab=history&reviewId=' + reviewId + '&reviewPage=3',
  )
  assert.equal(workflowReturnTarget(location, 'stay-2', pmsScope), null)
  for (const overrides of [
    { tenantId: 'hotel-b' },
    { user: { id: 'other' } },
    { authGeneration: 2 },
  ])
    assert.equal(workflowReturnTarget(location, 'stay-1', { ...pmsScope, ...overrides }), null)
  for (const path of [
    'https://example.test',
    '//example.test',
    '/manager/users',
    '/id/settings?section=profile',
  ]) {
    assert.equal(
      workflowReturnTarget(
        { state: { workflowReturn: { ...link.state.workflowReturn, path } } },
        'stay-1',
        pmsScope,
      ),
      null,
    )
  }
})

test('default audit days are captured and nested OTA to booking returns retain the audit source', () => {
  const pms = { ...pmsScope, settings: { timezone: 'Asia/Ho_Chi_Minh' } }
  const review = workflowLink('/id/settings', reviewId, pms, {
    pathname: '/id/reports/reconciliation',
    search: '',
  })
  const captured = workflowReturnTarget({ state: review.state }, reviewId, pms)
  assert.match(
    captured,
    /^\/id\/reports\/reconciliation\?date=\d{4}-\d{2}-\d{2}&auditDate=\d{4}-\d{2}-\d{2}$/,
  )
  const booking = workflowLink('/id/reservations?booking=stay-1', 'stay-1', pms, {
    pathname: '/id/settings',
    search: '?section=channels&tab=history&reviewId=' + reviewId,
    state: review.state,
  })
  const restored = workflowReturnState({ state: booking.state }, 'stay-1', pms)
  assert.equal(workflowReturnTarget({ state: restored }, reviewId, pms), captured)
  assert.equal(
    workflowReturnState({ state: booking.state }, 'stay-1', { ...pms, authGeneration: 2 }),
    undefined,
  )
})

test('reconciliation and audit links open exact targets, retain both days and fetch fresh preview on return', async (t) => {
  await withDraftDom(async ({ React, act, load, mount, click }) => {
    const { createMemoryRouter, RouterProvider, Outlet, Link, useLocation, useSearchParams } =
      await import('react-router-dom')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { DraftGuardProvider, DraftRouteGuard } = await load(
      '/src/shared/drafts/DraftGuardProvider.jsx',
    )
    const { default: DayReconciliation } = await load(
      '/src/apps/pms/reconciliation/DayReconciliation.jsx',
    )
    const { workflowReturnTarget: returnTarget } = await load(
      '/src/apps/pms/reconciliation/workflowNavigation.js',
    )
    const h = React.createElement,
      reads = [],
      writes = []
    const rows = (id) => [
      {
        id,
        guest: 'Synthetic guest',
        rooms: ['101'],
        checkIn: '2026-01-01',
        checkOut: '2026-01-02',
      },
    ]
    const value = {
      ...pmsScope,
      workspaceRevision: 1,
      settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
      access: () => ({ allowed: true }),
      requestTenant: async (path, options) => {
        if (options?.method) writes.push(path)
        else reads.push(path)
        if (path.startsWith('/reconciliation/night-audit'))
          return {
            previewToken: 'must-still-confirm',
            periodLocked: false,
            recognitionStart: '2026-01-01',
            timezone: 'Asia/Ho_Chi_Minh',
            totals: [],
            entries: [],
            blockers: [
              { bookingId: 'late-stay', guest: 'Late guest', status: 'IN_HOUSE' },
              { reviewId, status: 'OTA_REVIEW' },
            ],
          }
        if (path.startsWith('/reconciliation/history'))
          return { confirmations: [], pagination: { totalItems: 0 } }
        return {
          previewToken: 'day-token',
          timezone: 'Asia/Ho_Chi_Minh',
          generatedAt: '2026-01-03T00:00:00Z',
          currency: 'VND',
          summary: { cashReceived: '0', cashRefunded: '0', netReceipts: '0' },
          funds: [],
          arrivals: rows('arriving'),
          departures: rows('departing'),
        }
      },
    }
    function Shell() {
      return h(
        DraftGuardProvider,
        null,
        h(DraftRouteGuard),
        h(PmsContext.Provider, { value }, h(Outlet)),
      )
    }
    function Target() {
      const location = useLocation(),
        [params] = useSearchParams()
      const back = returnTarget(location, params.get('booking') || params.get('reviewId'), value)
      return h(
        'div',
        null,
        h('p', null, 'Synthetic target'),
        back && h(Link, { to: back }, 'Return'),
      )
    }
    const entry = '/id/reports/reconciliation?date=2026-01-02&auditDate=2026-01-01'
    const router = createMemoryRouter(
      [
        {
          path: '/id',
          element: h(Shell),
          children: [
            { path: 'reports/reconciliation', element: h(DayReconciliation) },
            { path: 'reservations', element: h(Target) },
            { path: 'settings', element: h(Target) },
          ],
        },
      ],
      { initialEntries: [entry] },
    )
    const view = await mount(h(RouterProvider, { router }))
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    const find = (text) =>
      [...view.container.querySelectorAll('a')].find((node) => node.textContent === text)
    await settle()
    const cases = [
      ['Mở booking / nhận phòng', '/id/reservations?booking=arriving'],
      ['Mở thanh toán / trả phòng', '/id/reservations?booking=departing&tab=payments'],
      ['Mở booking để xử lý', '/id/reservations?booking=late-stay&tab=payments'],
      [
        'Mở hồ sơ OTA cần đối soát',
        '/id/settings?section=channels&tab=history&reviewId=' + reviewId,
      ],
    ]
    for (const [label, expected] of cases)
      await t.test(label, async () => {
        const before = reads.length
        assert.equal(find(label)?.getAttribute('href'), expected)
        await click(find(label))
        await settle()
        assert.equal(router.state.location.pathname + router.state.location.search, expected)
        await click(find('Return'))
        await settle()
        assert.equal(router.state.location.pathname + router.state.location.search, entry)
        assert.ok(reads.length > before)
        assert.ok(reads.slice(before).includes('/reconciliation/night-audit?date=2026-01-01'))
        assert.ok(reads.slice(before).includes('/reconciliation?date=2026-01-02'))
      })
    await act(async () =>
      router.navigate('/id/reports/reconciliation?date=2026-02-30&auditDate=2026-02-30'),
    )
    await settle()
    assert.ok(!reads.some((path) => path.includes('2026-02-30')))
    assert.equal(writes.length, 0)
    router.dispose()
  })
})

test('OTA exact review lookup restores page and checks dirty input before opening the selected PMS booking', async () => {
  await withDraftDom(async ({ React, act, load, mount, click, input }) => {
    const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router-dom')
    const { DraftGuardProvider, DraftRouteGuard } = await load(
      '/src/shared/drafts/DraftGuardProvider.jsx',
    )
    const { HistoryWorkspace } = await load('/src/apps/pms/channel-manager/pages/OTAHistory.jsx')
    const { default: Reservations } = await load(
      '/src/apps/pms/reservations/pages/Reservations.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const h = React.createElement,
      reads = [],
      writes = []
    const row = {
      id: reviewId,
      revisionId: 'provider-revision',
      bookingId: 'provider-booking',
      jobStatus: 'needs_review',
      details: { currency: 'VND', amount: '100' },
    }
    const pms = {
      ...pmsScope,
      tenant: { name: 'Synthetic hotel' },
      rooms: [],
      roomTypes: [],
      bookingSources: [],
      services: [],
      funds: [],
      paymentMethods: [],
      settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
      access: () => ({ allowed: true }),
      bookings: [
        {
          id: 'stay-1',
          guest: 'Synthetic guest',
          status: 'IN_HOUSE',
          checkIn: '2026-01-01',
          checkOut: '2026-01-03',
          rooms: ['101'],
          total: '100',
          paid: '0',
          balance: '100',
          charges: [],
          payments: [],
          notes: [],
          history: [],
          currency: 'VND',
          version: 2,
        },
      ],
      requestTenant: async (path, options) => {
        if (options?.method) writes.push(path)
        else reads.push(path)
        if (path.includes('reviewId=')) return { items: [row] }
        return { items: [], pagination: { page: 3, totalPages: 4, totalItems: 80 } }
      },
    }
    const query = { data: { connection: {}, mappings: [] }, revision: 0, refresh() {} }
    function Shell() {
      return h(
        DraftGuardProvider,
        null,
        h(DraftRouteGuard),
        h(PmsContext.Provider, { value: pms }, h(Outlet)),
      )
    }
    const entry = '/id/settings?section=channels&tab=history&reviewPage=3&reviewId=' + reviewId
    const audit = workflowLink(entry, reviewId, pms, {
      pathname: '/id/reports/reconciliation',
      search: '?date=2026-01-02&auditDate=2026-01-01',
    })
    const router = createMemoryRouter(
      [
        {
          path: '/id',
          element: h(Shell),
          children: [
            { path: 'settings', element: h(HistoryWorkspace, { pms, query, embedded: true }) },
            { path: 'reservations', element: h(Reservations) },
            { path: 'reports/reconciliation', element: h('p', null, 'Audit returned') },
          ],
        },
      ],
      {
        initialEntries: [
          { pathname: '/id/settings', search: entry.slice(entry.indexOf('?')), state: audit.state },
        ],
      },
    )
    const view = await mount(h(RouterProvider, { router }))
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    await settle()
    assert.ok(reads.includes('/channels/booking-reviews?page=3&pageSize=25'))
    assert.ok(reads.includes('/channels/booking-reviews?reviewId=' + reviewId))
    const select = view.container.querySelector('.ota-exception-form select')
    assert.ok(select, 'exact review opens even when it is outside the current list page')
    await input(select, 'stay-1')
    const link = view.container.querySelector('.ota-exception-form a')
    assert.equal(link.getAttribute('href'), '/id/reservations?booking=stay-1&tab=payments')
    await click(link)
    await settle()
    assert.equal(router.state.location.pathname, '/id/settings')
    assert.ok(view.container.querySelector('.draft-confirmation'))
    await click(
      [...view.container.querySelectorAll('button')].find(
        (node) => node.textContent === 'Tiếp tục sửa',
      ),
    )
    assert.equal(select.value, 'stay-1')
    await click(link)
    await settle()
    await click(
      [...view.container.querySelectorAll('button')].find(
        (node) => node.textContent === 'Bỏ bản nháp',
      ),
    )
    await settle()
    assert.equal(router.state.location.pathname, '/id/reservations')
    assert.equal(
      router.state.location.state.workflowReturn.path,
      '/id/settings?section=channels&tab=history&reviewId=' + reviewId + '&reviewPage=3',
    )
    assert.ok(
      view.container.querySelector('.booking-detail-panel'),
      'the real booking modal is open',
    )
    const back = [...view.container.querySelectorAll('.booking-detail-panel button')].find(
      (node) => node.textContent === 'Quay lại đối soát',
    )
    assert.ok(back, 'return control must be inside the modal')
    await click(back)
    await settle()
    assert.equal(
      router.state.location.pathname + router.state.location.search,
      '/id/settings?section=channels&tab=history&reviewId=' + reviewId + '&reviewPage=3',
    )
    assert.ok(view.container.querySelector('.ota-exception-form select'))
    const auditBack = [...view.container.querySelectorAll('.ota-exception-actions button')].find(
      (node) => node.textContent === 'Quay lại đối soát',
    )
    assert.ok(auditBack, 'nested audit return remains accessible inside the OTA dialog')
    await click(auditBack)
    await settle()
    assert.equal(
      router.state.location.pathname + router.state.location.search,
      '/id/reports/reconciliation?date=2026-01-02&auditDate=2026-01-01',
    )
    assert.equal(writes.length, 0)
    router.dispose()
  })
})
