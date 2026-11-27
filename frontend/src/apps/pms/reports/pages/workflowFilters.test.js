import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

async function workspace(tools, initial) {
  const { React, load, mount, act } = tools
  const { createMemoryRouter, RouterProvider, Outlet, useLocation } =
    await import('react-router-dom')
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const { default: Reports } = await load('/src/apps/pms/reports/pages/Reports.jsx')
  const { default: Cashflow } = await load('/src/apps/pms/finance/pages/Cashflow.jsx')
  const { default: Sidebar } = await load('/src/apps/pms/components/Sidebar.jsx')
  const { today } = await load('/src/apps/pms/data/model.js')
  const h = React.createElement,
    reads = [],
    listeners = new Set()
  let context
  const store = {
    snapshot: () => context,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    patch: (value) => {
      context = { ...context, ...value }
      for (const fn of listeners) fn()
    },
  }
  const financial = {
    rows: [],
    summary: {
      forecastRoomRevenue: '0',
      realizedRevenue: '0',
      netReceipts: '0',
      servedNights: 0,
      adr: '0',
      opening: '0',
      income: '0',
      outflow: '0',
      closing: '0',
    },
    snapshot: { deposits: '0', debt: '0', asOf: '2026-11-16T00:00:00Z' },
  }
  context = {
    tenantId: 'hotel-a',
    user: { id: 'owner-a' },
    authGeneration: 1,
    workspaceRevision: 1,
    settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
    rooms: [],
    roomTypes: [],
    cashDocuments: [],
    ledger: [],
    users: [{ id: 'actor-a', name: 'Actor A' }],
    cashbookCategories: [{ id: 'cat-a', name: 'Category A', type: 'INCOME', active: true }],
    funds: [
      { id: 'cash-usd', name: 'USD cash', type: 'CASH', currency: 'USD', active: true },
      { id: 'bank-usd', name: 'USD bank', type: 'BANK', currency: 'USD', active: true },
    ],
    routeAccess: () => ({ allowed: true }),
    access: () => ({ allowed: true }),
    settingsPath: '/id/settings',
    getRevenueReport: async (...args) => {
      reads.push(['revenue', ...args])
      return { rows: [] }
    },
    getFinancialReport: async (...args) => {
      reads.push(['financial', ...args])
      return financial
    },
    getBusinessReport: async (...args) => {
      reads.push(['business', ...args])
      return { rows: [], currency: 'VND', basis: 'base', definitions: {} }
    },
    getCashbook: async (filters) => {
      reads.push([
        'cashbook',
        { ...filters, tenant: context.tenantId, auth: context.authGeneration },
      ])
      return {
        summary: {
          currency: filters.currency,
          opening: '0',
          income: '0',
          outflow: '0',
          closing: '0',
        },
        ledger: [],
        cashDocuments: [],
        fundBalances: [],
        pagination: { totalItems: 100 },
      }
    },
  }
  function Shell() {
    const location = useLocation()
    return h(React.Fragment, null, h(Sidebar), h(Outlet, { key: location.pathname }))
  }
  function Host() {
    const value = React.useSyncExternalStore(store.subscribe, store.snapshot)
    return h(PmsContext.Provider, { value }, h(RouterProvider, { router }))
  }
  const router = createMemoryRouter(
    [
      {
        element: h(Shell),
        children: [
          { path: '/id/reports/:report', element: h(Reports) },
          { path: '/id/cashflow/:tab', element: h(Cashflow) },
        ],
      },
    ],
    { initialEntries: [initial] },
  )
  const view = await mount(h(Host))
  const settle = () =>
    act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
  await settle()
  return {
    ...view,
    router,
    reads,
    store,
    now: today(context.settings.timezone),
    settle,
    go: async (to) => {
      await act(async () => {
        await router.navigate(to)
      })
      await settle()
    },
    path: () => router.state.location.pathname,
    params: () => new URLSearchParams(router.state.location.search),
    lastCash: () => reads.filter(([kind]) => kind === 'cashbook').at(-1)?.[1],
  }
}

const control = (root, text, selector = 'select') =>
  [...root.querySelectorAll('label')]
    .find((label) => label.textContent.startsWith(text))
    ?.querySelector(selector)
const bankTab = (root) =>
  [...root.querySelectorAll('button[aria-pressed]')].find(
    (button) => button.textContent.trim() === 'Quỹ tiền gửi',
  )

test('report period survives page remount, report tabs, Sidebar, reload and Back', async () => {
  await withDraftDom(async (tools) => {
    const { click, input } = tools
    let view = await workspace(
      tools,
      '/id/reports/revenue?start=2028-02-01&end=2028-02-03&view=compact',
    )
    assert.deepEqual(view.reads.find(([kind]) => kind === 'revenue').slice(1, 3), [
      '2028-02-01',
      '2028-02-03',
    ])
    await input(view.container.querySelector('#report-end'), '04/02/2028')
    assert.equal(view.params().get('view'), 'compact')
    await click(view.container.querySelector('.pms-sidebar a[href^="/id/reports/occupancy"]'))
    assert.equal(view.path(), '/id/reports/occupancy')
    assert.equal(view.params().get('view'), 'compact')
    assert.equal(view.reads.filter(([kind]) => kind === 'revenue').at(-1)[2], '2028-02-04')
    await click(view.container.querySelector('.pms-reports-tabs a[href^="/id/reports/source"]'))
    await input(view.container.querySelector('#business-report-type'), 'room')
    assert.deepEqual(
      view.reads
        .filter(([kind]) => kind === 'business')
        .at(-1)
        .slice(1, 4),
      ['room', '2028-02-01', '2028-02-04'],
    )
    await view.go(-1)
    assert.equal(view.path(), '/id/reports/source')
    assert.equal(view.params().get('end'), '2028-02-04')
    const url = view.path() + view.router.state.location.search
    await view.unmount()
    view = await workspace(tools, url)
    assert.deepEqual(view.reads.find(([kind]) => kind === 'business').slice(2, 4), [
      '2028-02-01',
      '2028-02-04',
    ])
  })
})

test('report malformed URL and unfinished date draft cannot navigate or query the previous period', async () => {
  await withDraftDom(async (tools) => {
    const { click, input } = tools
    for (const query of [
      'start=bad&end=2028-02-03',
      'start=%E0%A4%A&end=2028-02-03',
      'start=2028-02-31&end=2028-03-03',
      'start=2028-02-01',
      'start=2028-03-01&end=2028-02-01',
      'start=2027-01-01&end=2028-01-03',
    ]) {
      const view = await workspace(tools, '/id/reports/source?' + query)
      assert.equal(view.reads.filter(([kind]) => kind === 'business').length, 0, query)
      assert.ok(view.container.querySelector('[role="alert"]'))
      await view.unmount()
    }
    const view = await workspace(
      tools,
      '/id/reports/source?start=2028-02-01&end=2028-02-03&view=compact',
    )
    const count = view.reads.length
    await input(view.container.querySelector('#business-report-start'), '31/02/2028')
    await input(view.container.querySelector('#business-report-end'), '04/02/2028')
    const link = view.container.querySelector('.pms-sidebar a[href^="/id/reports/occupancy"]')
    assert.equal(link.getAttribute('aria-disabled'), 'true')
    assert.equal(new URL(link.href).searchParams.get('period_invalid'), '1')
    await click(link)
    assert.equal(view.path(), '/id/reports/source')
    assert.equal(view.reads.length, count)
    assert.equal(view.container.querySelector('#business-report-start').value, '31/02/2028')
    await input(view.container.querySelector('#business-report-start'), '01/02/2028')
    assert.deepEqual(
      view.reads
        .filter(([kind]) => kind === 'business')
        .at(-1)
        .slice(2, 4),
      ['2028-02-01', '2028-02-04'],
    )
    assert.equal(view.params().get('view'), 'compact')
  })
})

test('report boundaries stay strict and cashbook targets discard stale scope filters', async () => {
  await withDraftDom(async ({ load }) => {
    const { readReportPeriod } = await load('/src/apps/pms/reports/pages/reportPeriod.js')
    assert.equal(readReportPeriod('start=2028-01-01&end=2029-01-01', 'UTC').valid, true)
    assert.equal(readReportPeriod('start=2028-01-01&end=2029-01-02', 'UTC').valid, false)
    const { cashflowScope, cashflowTarget, readCashflowFilters } = await load(
      '/src/apps/pms/finance/pages/cashflowFilters.js',
    )
    const pms = {
      tenantId: 'new-hotel',
      user: { id: 'owner' },
      authGeneration: 2,
      settings: { timezone: 'UTC', currency: 'VND' },
      funds: [],
      users: [],
      cashbookCategories: [],
    }
    const query = new URLSearchParams(
      'cf_scope=old-scope&cf_invalid=1&cf_currency=USD&cf_fund=old-fund&cf_actor=old-user&cf_category=old-category&cf_page=2&view=compact&booking=old-booking&tab=payments&start=2028-01-01',
    )
    const target = new URL(cashflowTarget('/id/cashflow/bank', query, pms), 'http://localhost')
    assert.equal(target.searchParams.get('cf_scope'), cashflowScope(pms, target.searchParams))
    assert.equal(target.searchParams.has('cf_invalid'), false)
    assert.equal(target.searchParams.get('view'), 'compact')
    for (const key of ['booking', 'tab', 'start']) assert.equal(target.searchParams.has(key), false)
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(readCashflowFilters(target.searchParams, pms, 'bank')).filter(
          ([key]) => !['startDate', 'endDate'].includes(key),
        ),
      ),
      { fundId: '', actorId: '', categoryId: '', currency: 'VND', page: 1 },
    )
  })
})

test('correcting the start date recovers an end date invalidated by its minimum', async () => {
  await withDraftDom(async (tools) => {
    const { input } = tools
    for (const report of ['revenue', 'source']) {
      const view = await workspace(tools, `/id/reports/${report}?start=2028-02-01&end=2028-02-03`)
      const prefix = report === 'source' ? '#business-report-' : '#report-'
      const before = view.reads.length
      await input(view.container.querySelector(prefix + 'start'), '04/02/2028')
      assert.equal(view.container.querySelector(prefix + 'end').checkValidity(), false)
      assert.equal(view.params().get('period_invalid'), '1')
      assert.equal(view.reads.length, before)
      await input(view.container.querySelector(prefix + 'start'), '01/02/2028')
      assert.equal(view.container.querySelector(prefix + 'end').checkValidity(), true)
      assert.equal(view.params().has('period_invalid'), false)
      assert.ok(view.reads.length > before)
      assert.notEqual(
        view.container
          .querySelector('.pms-sidebar a[href^="/id/reports/occupancy"]')
          .getAttribute('aria-disabled'),
        'true',
      )
      await view.unmount()
      const blocked = await workspace(
        tools,
        `/id/reports/${report}?start=2028-02-01&end=2028-02-03&period_invalid=1`,
      )
      assert.equal(
        blocked.reads.length,
        0,
        'opening a marked URL cannot clear it without a date edit',
      )
      assert.equal(blocked.params().get('period_invalid'), '1')
      await blocked.unmount()
    }
    const cash = await workspace(tools, '/id/cashflow/cash')
    const dates = cash.container.querySelectorAll('.date-input-control > input[type="text"]')
    await input(dates[0], '01/10/2026')
    await input(dates[1], '31/10/2026')
    const before = cash.reads.length
    await input(dates[0], '01/11/2026')
    assert.equal(dates[1].checkValidity(), false)
    assert.equal(cash.params().get('cf_invalid'), '1')
    assert.equal(cash.reads.length, before)
    await input(dates[0], '01/10/2026')
    assert.equal(dates[1].checkValidity(), true)
    assert.equal(cash.params().has('cf_invalid'), false)
    assert.ok(cash.reads.length > before)
    assert.equal(bankTab(cash.container).disabled, false)
  })
})

test('invalid cashbook date drafts block tab switches and direct links with the invalid marker', async () => {
  await withDraftDom(async (tools) => {
    const { input, click, load } = tools
    const { cashflowTarget } = await load('/src/apps/pms/finance/pages/cashflowFilters.js')
    const view = await workspace(tools, '/id/cashflow/cash')
    const count = view.reads.length
    const dates = view.container.querySelectorAll('.date-input-control > input[type="text"]')
    await input(dates[0], '32/10/2026')
    await input(dates[1], '31/10/2026')
    const tab = bankTab(view.container)
    assert.equal(tab.disabled, true)
    const target = cashflowTarget('/id/cashflow/bank', view.params(), view.store.snapshot())
    assert.equal(new URL(target, 'http://qa').searchParams.get('cf_invalid'), '1')
    await click(tab)
    assert.equal(view.path(), '/id/cashflow/cash')
    assert.equal(view.reads.length, count)
    await view.go(target)
    assert.equal(
      view.reads.length,
      count,
      'opening the marked URL still cannot query the old valid range',
    )
    assert.ok(view.container.querySelector('[role="alert"]'))
    const fixed = view.container.querySelectorAll('.date-input-control > input[type="text"]')
    await input(fixed[0], '01/10/2026')
    assert.equal(view.lastCash().startDate, '2026-10-01')
    assert.equal(view.lastCash().endDate, '2026-10-31')
    const params = view.params()
    params.set('cf_start', 'bad')
    params.delete('cf_invalid')
    const beforeInvalidUrl = view.reads.length
    await view.go(view.path() + '?' + params)
    assert.equal(view.reads.length, beforeInvalidUrl)
  })
})

test('cash and bank keep shared filters through page tabs and reset them on tenant or auth scope change', async () => {
  await withDraftDom(async (tools) => {
    const { input, click, act } = tools
    const view = await workspace(tools, '/id/cashflow/cash?view=compact')
    assert.equal(view.container.querySelector('.pms-sidebar a[href^="/id/cashflow"]'), null)
    assert.equal(
      view.container.querySelector('.pms-sidebar button[aria-label="Tài chính & thu chi"]'),
      null,
    )
    let dates = view.container.querySelectorAll('.date-input-control > input[type="text"]')
    await input(dates[0], '01/10/2026')
    await input(dates[1], '31/10/2026')
    await input(control(view.container, 'Tiền tệ'), 'USD')
    await input(control(view.container, 'Quỹ'), 'cash-usd')
    await input(control(view.container, 'Người ghi sổ'), 'actor-a')
    await input(control(view.container, 'Danh mục'), 'cat-a')
    await click(
      [...view.container.querySelectorAll('button')].find(
        (button) => button.textContent.trim() === 'Sau',
      ),
    )
    assert.equal(view.lastCash().page, 2)
    await click(bankTab(view.container))
    assert.deepEqual(
      Object.fromEntries(
        [
          'startDate',
          'endDate',
          'currency',
          'actorId',
          'categoryId',
          'fundId',
          'page',
          'fundType',
        ].map((key) => [key, view.lastCash()[key]]),
      ),
      {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        currency: 'USD',
        actorId: 'actor-a',
        categoryId: 'cat-a',
        fundId: '',
        page: 1,
        fundType: 'bank',
      },
    )
    assert.equal(view.params().get('view'), 'compact')
    const url = view.path() + view.router.state.location.search
    await view.go(url)
    assert.equal(control(view.container, 'Tiền tệ').value, 'USD')
    await act(async () => view.store.patch({ tenantId: 'hotel-b' }))
    await view.settle()
    assert.equal(view.lastCash().tenant, 'hotel-b')
    assert.equal(view.lastCash().currency, 'VND')
    assert.equal(view.lastCash().actorId, '')
    assert.equal(view.lastCash().categoryId, '')
    await input(control(view.container, 'Tiền tệ'), 'USD')
    await act(async () => view.store.patch({ authGeneration: 2 }))
    await view.settle()
    assert.equal(view.lastCash().currency, 'VND')
    assert.equal(view.lastCash().auth, 2)
    await view.go('/id/cashflow/bank?documentId=doc-b&currency=EUR')
    assert.equal(view.lastCash().documentId, 'doc-b')
    assert.equal(view.lastCash().currency, 'EUR')
    assert.equal(view.lastCash().startDate, '')
    assert.equal(view.lastCash().endDate, '')
  })
})
