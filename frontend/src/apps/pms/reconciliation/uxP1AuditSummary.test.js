import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

const stays = (prefix, count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    guest: `Synthetic ${prefix} ${index}`,
    rooms: [String(100 + index)],
    checkIn: '2026-01-01',
    checkOut: '2026-01-03',
  }))
const dayPreview = {
  previewToken: 'day-token',
  timezone: 'Asia/Ho_Chi_Minh',
  generatedAt: '2026-01-03T00:00:00Z',
  currency: 'VND',
  summary: { cashReceived: '0', cashRefunded: '0', netReceipts: '0' },
  funds: [],
  arrivals: stays('arrival', 30),
  departures: stays('departure', 25),
}
const nightPreview = (blockers) => ({
  previewToken: 'night-token',
  periodLocked: false,
  recognitionStart: '2026-01-01',
  timezone: 'Asia/Ho_Chi_Minh',
  totals: [],
  entries: [],
  blockers: Array.from({ length: blockers }, (_, index) => ({
    bookingId: `blocked-${index}`,
    guest: `Blocked guest ${index}`,
    status: 'IN_HOUSE',
  })),
})

test('reconciliation summary links counts to sections without stale, zero or duplicate Night Audit reads', async () => {
  await withDraftDom(async ({ React, act, window, load, mount, click }) => {
    const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router-dom')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { DraftGuardProvider, DraftRouteGuard } = await load(
      '/src/shared/drafts/DraftGuardProvider.jsx',
    )
    const { default: DayReconciliation } = await load(
      '/src/apps/pms/reconciliation/DayReconciliation.jsx',
    )
    const h = React.createElement,
      reads = [],
      writes = []
    const firstDay = Promise.withResolvers(),
      lateNight = Promise.withResolvers()
    let firstDayPending = true,
      switchHotel
    const request = (hotel) => (path, options) => {
      if (options?.method) {
        writes.push(path)
        return Promise.reject(new Error('Unexpected write'))
      }
      reads.push(`${hotel}:${path}`)
      const date = new URLSearchParams(path.split('?')[1]).get('date')
      if (path.startsWith('/reconciliation/history'))
        return Promise.resolve({ confirmations: [], pagination: { totalItems: 0 } })
      if (path.startsWith('/reconciliation/night-audit')) {
        if (hotel === 'hotel-b') return new Promise(() => {})
        if (date === '2026-01-01') return Promise.resolve(nightPreview(3))
        if (date === '2025-12-31') return lateNight.promise
        return Promise.reject(new Error('Night audit unavailable'))
      }
      if (date === '2026-01-03') return Promise.reject(new Error('Day preview unavailable'))
      if (firstDayPending) {
        firstDayPending = false
        return firstDay.promise
      }
      return Promise.resolve(dayPreview)
    }
    function Shell() {
      const [hotel, setHotel] = React.useState('hotel-a')
      React.useEffect(() => {
        switchHotel = setHotel
      }, [])
      const value = React.useMemo(
        () => ({
          tenantId: hotel,
          user: { id: 'owner-a' },
          authGeneration: 1,
          workspaceRevision: 1,
          settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
          access: () => ({ allowed: true }),
          requestTenant: request(hotel),
        }),
        [hotel],
      )
      return h(
        DraftGuardProvider,
        null,
        h(DraftRouteGuard),
        h(PmsContext.Provider, { value }, h(Outlet)),
      )
    }
    const entry = '/id/reports/reconciliation?date=2026-01-02&auditDate=2026-01-01'
    const router = createMemoryRouter(
      [
        {
          path: '/id',
          element: h(Shell),
          children: [{ path: 'reports/reconciliation', element: h(DayReconciliation) }],
        },
      ],
      { initialEntries: [entry] },
    )
    const view = await mount(h(RouterProvider, { router }))
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    const go = async (path) => {
      await act(async () => {
        router.navigate(path)
      })
      await settle()
    }
    const where = () => router.state.location.pathname + router.state.location.search
    const item = (id) => view.container.querySelector(`[data-summary="${id}"]`)
    const value = (id) => item(id).querySelector('strong').textContent
    const nightReads = (date) =>
      reads.filter((path) => path === `hotel-a:/reconciliation/night-audit?date=${date}`).length
    await settle()

    // Loading day preview: no zero count and no jump target yet.
    assert.match(value('reconciliation-arrivals'), /Đang tải/)
    assert.match(value('reconciliation-departures'), /Đang tải/)
    assert.equal(item('reconciliation-arrivals').tagName, 'SPAN')
    assert.equal(value('night-audit'), '3 vướng mắc')

    await act(async () => firstDay.resolve(dayPreview))
    await settle()
    const nav = view.container.querySelector('.day-reconciliation-summary')
    const arrivals = view.container.querySelector('#reconciliation-arrivals')
    const departures = view.container.querySelector('#reconciliation-departures')
    const audit = view.container.querySelector('#night-audit')
    assert.ok(nav && arrivals && departures && audit)
    for (const section of [arrivals, departures, audit])
      assert.ok(
        nav.compareDocumentPosition(section) & window.Node.DOCUMENT_POSITION_FOLLOWING,
        'summary precedes long content',
      )
    assert.equal(item('reconciliation-arrivals').getAttribute('href'), '#reconciliation-arrivals')
    assert.equal(
      item('reconciliation-departures').getAttribute('href'),
      '#reconciliation-departures',
    )
    assert.equal(item('night-audit').getAttribute('href'), '#night-audit')
    assert.equal(value('reconciliation-arrivals'), '30')
    assert.equal(value('reconciliation-departures'), '25')
    assert.equal(value('night-audit'), '3 vướng mắc')
    assert.equal(nightReads('2026-01-01'), 1, 'summary reuses the single Night Audit preview read')
    // Existing sections remain intact.
    assert.equal(arrivals.querySelectorAll('li').length, 30)
    assert.equal(departures.querySelectorAll('li').length, 25)
    assert.equal(audit.querySelectorAll('.night-audit-blockers li').length, 3)

    // Jumps move focus within the page without a route change or draft prompt.
    await click(item('reconciliation-arrivals'))
    assert.equal(window.document.activeElement, arrivals)
    await click(item('night-audit'))
    assert.equal(window.document.activeElement, audit)
    assert.equal(where(), entry)
    assert.equal(view.container.querySelector('.draft-confirmation'), null)

    // Switching audit day never shows the previous day's blocker count.
    await go('/id/reports/reconciliation?date=2026-01-02&auditDate=2025-12-31')
    assert.match(value('night-audit'), /Đang tải/)
    await act(async () => lateNight.resolve(nightPreview(0)))
    await settle()
    assert.equal(value('night-audit'), '0 vướng mắc')
    await go('/id/reports/reconciliation?date=2026-01-02&auditDate=2025-12-30')
    assert.equal(value('night-audit'), 'Chưa tải được')
    await go('/id/reports/reconciliation?date=2026-01-02&auditDate=2026-02-30')
    assert.equal(value('night-audit'), 'Ngày không hợp lệ')
    assert.ok(!reads.some((path) => path.includes('2026-02-30')))

    // A failed day preview does not claim zero arrivals or departures.
    await go('/id/reports/reconciliation?date=2026-01-03&auditDate=2026-01-01')
    assert.equal(value('reconciliation-arrivals'), 'Chưa có dữ liệu')
    assert.equal(value('reconciliation-departures'), 'Chưa có dữ liệu')
    assert.equal(value('night-audit'), '3 vướng mắc')

    // Blockers still forbid closing and the confirmation controls remain.
    await go(entry)
    assert.equal(value('reconciliation-arrivals'), '30')
    assert.ok(view.container.querySelector('.day-reconciliation-confirm button'))
    const closeForm = view.container.querySelector('.night-audit-close-form')
    assert.ok(closeForm)
    await act(async () => {
      const reason = closeForm.querySelector('textarea')
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(
        reason,
        'Reviewed',
      )
      reason.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await click(closeForm.querySelector('input[type="checkbox"]'))
    assert.equal(closeForm.querySelector('button[type="submit"]').disabled, true)
    await act(async () =>
      closeForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    )
    await settle()
    assert.equal(writes.length, 0)

    // A hotel switch drops the previous hotel's blocker count while the new read is pending.
    await act(async () => switchHotel('hotel-b'))
    await settle()
    assert.match(value('night-audit'), /Đang tải/)
    assert.ok(!item('night-audit').textContent.includes('3 vướng mắc'))
    assert.equal(writes.length, 0)
    router.dispose()
  })
})
