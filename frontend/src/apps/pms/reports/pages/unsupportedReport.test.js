import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

// Same Reports component as App, mounted on routes without a keyed Outlet so a single
// BusinessReports instance survives supported -> unsupported -> supported transitions.
async function workspace(tools, initial, overrides = {}) {
  const { React, load, mount, act } = tools
  const { createMemoryRouter, RouterProvider } = await import('react-router-dom')
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const { default: Reports } = await load('/src/apps/pms/reports/pages/Reports.jsx')
  const { today, addDays } = await load('/src/apps/pms/data/model.js')
  const h = React.createElement,
    reads = [],
    access = []
  const financial = {
    rows: [],
    definitions: {},
    summary: {
      forecastRoomRevenue: '0',
      recognizedRevenue: '0',
      realizedRevenue: '0',
      netReceipts: '0',
      servedNights: 0,
      adr: '0',
      opening: '0',
      income: '0',
      outflow: '0',
      closing: '0',
    },
    snapshot: { deposits: '0', debt: '0', asOf: '2028-02-01T00:00:00Z' },
  }
  const value = {
    tenantId: 'hotel-a',
    user: { id: 'owner-a' },
    authGeneration: 1,
    workspaceRevision: 1,
    settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
    rooms: [],
    roomTypes: [],
    routeAccess: () => ({ allowed: true }),
    showAccess: (result) => access.push(result),
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
    ...overrides,
  }
  const router = createMemoryRouter(
    [
      { path: '/id/reports', element: h(Reports) },
      { path: '/id/reports/:report', element: h(Reports) },
    ],
    { initialEntries: [initial] },
  )
  const view = await mount(h(PmsContext.Provider, { value }, h(RouterProvider, { router })))
  const settle = () =>
    act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
  await settle()
  const now = today(value.settings.timezone)
  return {
    ...view,
    router,
    reads,
    access,
    settle,
    now,
    fallbackEnd: addDays(now, 7),
    go: async (to) => {
      await act(async () => {
        await router.navigate(to)
      })
      await settle()
    },
    path: () => router.state.location.pathname,
    params: () => new URLSearchParams(router.state.location.search),
  }
}

const heading = (root) => root.querySelector('h1')?.textContent
const UNSUPPORTED = 'Báo cáo không khả dụng'

function assertUnsupported(root, label) {
  assert.equal(heading(root), UNSUPPORTED, label)
  assert.ok(root.querySelector('[role="status"]')?.textContent.trim(), label + ': explanation')
  for (const selector of [
    'table',
    'select',
    'input',
    '.pms-reports-export',
    '.pms-reports-summary',
    '.pms-reports-tabs',
    '.pms-reports-table-card',
    'details',
  ])
    assert.equal(root.querySelector(selector), null, `${label}: no ${selector}`)
  const links = root.querySelectorAll('a')
  assert.equal(links.length, 1, label + ': exactly one recovery link')
  return links[0]
}

function captureConsoleErrors() {
  const errors = [],
    original = console.error
  console.error = (...args) => {
    errors.push(args.map(String).join(' '))
  }
  return {
    errors,
    restore: () => {
      console.error = original
    },
  }
}

test('discounts, unknown and inherited keys show the unsupported state with zero reads', async () => {
  await withDraftDom(async (tools) => {
    for (const key of [
      'discounts',
      'unknown',
      'toString',
      'constructor',
      '__proto__',
      'hasOwnProperty',
      'valueOf',
    ]) {
      const logs = captureConsoleErrors()
      let view
      try {
        view = await workspace(
          tools,
          `/id/reports/${key}?start=2028-02-01&end=2028-02-03&view=compact&tab=x`,
        )
      } finally {
        logs.restore()
      }
      // Legacy test servers can report this transport-only port collision; keep every component error fatal.
      assert.deepEqual(
        logs.errors.filter(
          (text) => !/^WebSocket server error: Port \d+ is already in use$/.test(text),
        ),
        [],
        key,
      )
      assert.equal(view.router.state.errors, null, key + ': no router error boundary')
      const link = assertUnsupported(view.container, key)
      assert.equal(view.reads.length, 0, key + ': no API call')
      assert.notEqual(link.getAttribute('aria-disabled'), 'true', key)
      const href = new URL(link.href)
      assert.equal(href.pathname, '/id/reports/source')
      assert.deepEqual(
        ['start', 'end', 'view', 'tab'].map((name) => href.searchParams.get(name)),
        ['2028-02-01', '2028-02-03', 'compact', 'x'],
      )
      assert.equal(
        view.container.querySelector('[role="alert"]'),
        null,
        key + ': valid period has no alert',
      )
      await view.unmount()
    }
  })
})

test('valid recovery link lands on the supported source report with the same period and params', async () => {
  await withDraftDom(async (tools) => {
    const { click } = tools
    const view = await workspace(
      tools,
      '/id/reports/discounts?start=2028-02-01&end=2028-02-03&view=compact',
    )
    await click(assertUnsupported(view.container, 'discounts'))
    await view.settle()
    assert.equal(view.path(), '/id/reports/source')
    assert.deepEqual(view.reads, [
      ['business', 'source', '2028-02-01', '2028-02-03', 'VND', 'base'],
    ])
    assert.equal(view.params().get('view'), 'compact')
    assert.equal(view.container.querySelector('#business-report-type').value, 'source')
    assert.deepEqual(
      [...view.container.querySelectorAll('#business-report-type option')].map(
        (option) => option.value,
      ),
      ['source', 'room', 'roomType', 'cancellations', 'nationality'],
      'discounts stays disabled',
    )
    await view.unmount()

    // A valid default period (no dates in the URL) is carried unchanged.
    const fallback = await workspace(tools, '/id/reports/discounts?view=compact')
    const href = new URL(assertUnsupported(fallback.container, 'fallback').href)
    assert.deepEqual(
      [href.searchParams.get('start'), href.searchParams.get('end'), href.searchParams.get('view')],
      [fallback.now, fallback.fallbackEnd, 'compact'],
    )
    assert.equal(fallback.reads.length, 0)
  })
})

test('invalid URL period keeps the recovery link usable and the supported page blocks reads until corrected', async () => {
  await withDraftDom(async (tools) => {
    const { click, input } = tools
    const view = await workspace(
      tools,
      '/id/reports/discounts?start=bad&end=2028-02-03&view=compact',
    )
    const link = assertUnsupported(view.container, 'invalid')
    assert.ok(view.container.querySelector('[role="alert"]'), 'invalid period is explained')
    assert.notEqual(
      link.getAttribute('aria-disabled'),
      'true',
      'sole recovery link is not stranded',
    )
    assert.equal(new URL(link.href).searchParams.get('start'), 'bad', 'invalid date is not reset')
    await click(link)
    await view.settle()
    assert.equal(view.path(), '/id/reports/source')
    assert.equal(view.params().get('start'), 'bad')
    assert.equal(view.params().get('end'), '2028-02-03')
    assert.equal(view.params().get('view'), 'compact')
    assert.equal(view.reads.length, 0, 'no read for an invalid period')
    assert.ok(
      view.container.querySelector('#business-report-start'),
      'supported page shows its date controls',
    )
    assert.ok(view.container.querySelector('#business-report-error[role="alert"]'))
    await input(view.container.querySelector('#business-report-start'), '01/02/2028')
    await view.settle()
    assert.deepEqual(
      view.reads
        .filter(([kind]) => kind === 'business')
        .at(-1)
        .slice(1, 4),
      ['source', '2028-02-01', '2028-02-03'],
    )
    assert.equal(view.params().has('period_invalid'), false)
    assert.equal(view.params().get('view'), 'compact')
  })
})

test('period_invalid marker survives recovery and still blocks reads until a date edit', async () => {
  await withDraftDom(async (tools) => {
    const { click, input } = tools
    const view = await workspace(
      tools,
      '/id/reports/toString?start=2028-02-01&end=2028-02-03&period_invalid=1&view=compact',
    )
    const link = assertUnsupported(view.container, 'marker')
    assert.ok(view.container.querySelector('[role="alert"]'))
    const href = new URL(link.href)
    assert.equal(href.searchParams.get('period_invalid'), '1')
    assert.equal(link.getAttribute('aria-disabled'), null)
    await click(link)
    await view.settle()
    assert.equal(view.path(), '/id/reports/source')
    assert.equal(view.params().get('period_invalid'), '1', 'marker is not erased by navigation')
    assert.equal(view.reads.length, 0)
    assert.ok(view.container.querySelector('#business-report-error[role="alert"]'))
    await input(view.container.querySelector('#business-report-end'), '04/02/2028')
    await view.settle()
    assert.equal(view.params().has('period_invalid'), false)
    assert.deepEqual(
      view.reads
        .filter(([kind]) => kind === 'business')
        .at(-1)
        .slice(1, 4),
      ['source', '2028-02-01', '2028-02-04'],
    )
  })
})

test('permission-denied recovery link keeps its guard', async () => {
  await withDraftDom(async (tools) => {
    const { click } = tools
    const denied = { allowed: false, reason: 'permission', message: 'Không có quyền xem báo cáo' }
    const view = await workspace(tools, '/id/reports/discounts?start=2028-02-01&end=2028-02-03', {
      routeAccess: (to) =>
        String(to).startsWith('/id/reports/source') ? denied : { allowed: true },
    })
    const link = assertUnsupported(view.container, 'denied')
    assert.equal(link.getAttribute('data-locked'), 'true')
    await click(link)
    await view.settle()
    assert.equal(view.path(), '/id/reports/discounts')
    assert.deepEqual(view.access, [denied])
    assert.equal(view.reads.length, 0)
  })
})

test('hook order survives supported -> unsupported -> supported transitions in one instance', async () => {
  await withDraftDom(async (tools) => {
    const logs = captureConsoleErrors()
    try {
      const view = await workspace(tools, '/id/reports/source?start=2028-02-01&end=2028-02-03')
      assert.deepEqual(
        view.reads.map((read) => read.slice(0, 2)),
        [['business', 'source']],
      )
      for (const key of ['discounts', '__proto__', 'constructor']) {
        await view.go(`/id/reports/${key}?start=2028-02-01&end=2028-02-03`)
        assertUnsupported(view.container, key)
        assert.equal(view.reads.length, 1, key)
      }
      await view.go('/id/reports/room?start=2028-02-01&end=2028-02-03')
      assert.deepEqual(view.reads.at(-1).slice(0, 4), [
        'business',
        'room',
        '2028-02-01',
        '2028-02-03',
      ])
      assert.equal(view.container.querySelector('#business-report-type').value, 'room')
      await view.go('/id/reports/hasOwnProperty?start=2028-02-01&end=2028-02-03')
      assertUnsupported(view.container, 'hasOwnProperty')
      await view.go('/id/reports/source?start=2028-02-01&end=2028-02-03')
      assert.deepEqual(view.reads.at(-1).slice(0, 4), [
        'business',
        'source',
        '2028-02-01',
        '2028-02-03',
      ])
      assert.ok(view.container.querySelector('table'))
      await view.go('/id/reports/occupancy?start=2028-02-01&end=2028-02-03')
      assert.deepEqual(
        view.reads
          .slice(-2)
          .map(([kind]) => kind)
          .sort(),
        ['financial', 'revenue'],
      )
      assert.ok(view.container.querySelector('details.pms-reports-details'))
    } finally {
      logs.restore()
    }
    assert.deepEqual(
      logs.errors.filter((text) => /hook|Unexpected Application Error|Cannot read/i.test(text)),
      [],
    )
  })
})

test('root, revenue, occupancy and trailing slashes keep their reports; trailing unsupported keys stay unsupported', async () => {
  await withDraftDom(async (tools) => {
    const period = '?start=2028-02-01&end=2028-02-03'
    for (const path of [
      '/id/reports',
      '/id/reports/',
      '/id/reports/revenue',
      '/id/reports/revenue/',
    ]) {
      const view = await workspace(tools, path + period)
      assert.ok(view.container.querySelector('#report-start'), path)
      assert.equal(view.container.querySelector('details'), null, path + ': revenue layout')
      assert.equal(
        view.container.querySelectorAll('.pms-reports-financial .pms-reports-summary-card').length,
        7,
        path,
      )
      assert.deepEqual(view.reads.map(([kind]) => kind).sort(), ['financial', 'revenue'], path)
      await view.unmount()
    }
    const occupancy = await workspace(tools, '/id/reports/occupancy/' + period)
    assert.ok(
      occupancy.container.querySelector('details.pms-reports-details'),
      'trailing occupancy keeps occupancy mode',
    )
    assert.deepEqual(occupancy.reads.map(([kind]) => kind).sort(), ['financial', 'revenue'])
    await occupancy.unmount()
    const discounts = await workspace(tools, '/id/reports/discounts/' + period)
    assertUnsupported(discounts.container, 'discounts/')
    assert.equal(discounts.reads.length, 0)
    await discounts.unmount()
    const unknown = await workspace(tools, '/id/reports/foo/' + period)
    assertUnsupported(unknown.container, 'foo/')
    assert.equal(unknown.reads.length, 0, 'unknown keys never render fake revenue')
    await unknown.unmount()
    const source = await workspace(tools, '/id/reports/source/' + period)
    assert.deepEqual(source.reads, [
      ['business', 'source', '2028-02-01', '2028-02-03', 'VND', 'base'],
    ])
  })
})
