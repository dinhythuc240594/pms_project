import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

const PERIOD = '?start=2028-02-01&end=2028-02-03&view=compact'
const ASOF = '2028-02-02T03:04:00Z'

// Distinct synthetic amounts so any merge, swap or recomputation is visible.
const financialFixture = () => ({
  rows: [{ date: '2028-02-01', realizedRevenue: '21.0000', netReceipts: '31.0000' }],
  summary: {
    forecastRoomRevenue: '5555.0000',
    recognizedRevenue: '1111.0000',
    realizedRevenue: '2222.0000',
    netReceipts: '3333.0000',
    adr: '4444.0000',
    servedNights: 7,
    opening: '8888.0000',
    income: '9999.0000',
    outflow: '1212.0000',
    closing: '1313.0000',
  },
  snapshot: { deposits: '6666.0000', debt: '7777.0000', asOf: ASOF },
  definitions: {
    recognizedRevenue: 'Định nghĩa doanh thu ghi nhận XYZ.',
    netReceipts: 'Định nghĩa thực thu QRS.',
  },
})

async function workspace(tools, initial, options = {}) {
  const { React, load, mount, act } = tools
  const { createMemoryRouter, RouterProvider } = await import('react-router-dom')
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const { default: Reports } = await load('/src/apps/pms/reports/pages/Reports.jsx')
  const { money } = await load('/src/apps/pms/data/model.js')
  const { formatDateTime } = await load('/src/shared/lib/date.js')
  const h = React.createElement,
    reads = [],
    listeners = new Set()
  let failFinancial = options.failFinancial || 0
  let context = {
    tenantId: 'hotel-a',
    user: { id: 'owner-a' },
    authGeneration: 1,
    workspaceRevision: 1,
    settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
    rooms: [
      { id: '101', typeId: 'std' },
      { id: '102', typeId: 'std' },
      { id: '201', typeId: 'dlx' },
      { id: '202', typeId: 'dlx', active: false },
    ],
    roomTypes: [
      { id: 'std', name: 'Standard' },
      { id: 'dlx', name: 'Deluxe' },
    ],
    routeAccess: () => ({ allowed: true }),
    showAccess: () => {},
    getRevenueReport: async (...args) => {
      reads.push(['revenue', ...args])
      return {
        rows: [
          { date: '2028-02-01', reserved: 1, reservedRooms: 2, nights: 2, amount: '100.0000' },
        ],
      }
    },
    getFinancialReport: async (...args) => {
      reads.push(['financial', ...args])
      if (options.gate) await options.gate.promise
      if (failFinancial > 0) {
        failFinancial -= 1
        throw new Error('Máy chủ tạm lỗi')
      }
      return financialFixture()
    },
  }
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
  function Host() {
    const value = React.useSyncExternalStore(store.subscribe, store.snapshot)
    return h(PmsContext.Provider, { value }, h(RouterProvider, { router }))
  }
  const router = createMemoryRouter([{ path: '/id/reports/:report', element: h(Reports) }], {
    initialEntries: [initial],
  })
  const view = await mount(h(Host))
  const settle = () =>
    act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
  await settle()
  const asOf = formatDateTime(ASOF, 'Asia/Ho_Chi_Minh')
  return {
    ...view,
    reads,
    store,
    settle,
    router,
    act,
    vnd: (value) => money(value, 'VND'),
    asOfTime: asOf.slice(11),
    asOfDate: asOf.slice(0, 10),
    location: () =>
      router.state.location.pathname + router.state.location.search + router.state.location.hash,
  }
}

const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & 4) // b comes after a
const cards = (root) => [...root.querySelectorAll('.pms-reports-summary-card')]
const values = (group) =>
  [...group.querySelectorAll('.pms-reports-summary-value')].map((node) => node.textContent)
const descriptions = (group) =>
  [...group.querySelectorAll('.pms-reports-summary-card p')].map((node) => node.textContent)

function assertFinancialDetails(view, details) {
  const financial = details.querySelector('.pms-reports-financial')
  const ledger = details.querySelector('.pms-reports-ledger')
  assert.ok(financial && ledger, 'both groups live inside the disclosure')
  assert.deepEqual(values(financial), [
    view.vnd('1111.0000'),
    view.vnd('2222.0000'),
    view.vnd('3333.0000'),
    view.vnd('4444.0000'),
    view.vnd('6666.0000'),
    view.vnd('7777.0000'),
    view.asOfTime,
  ])
  assert.deepEqual(values(ledger), [
    view.vnd('8888.0000'),
    view.vnd('9999.0000'),
    view.vnd('1212.0000'),
    view.vnd('1313.0000'),
  ])
  const financialText = descriptions(financial)
  assert.ok(financialText.includes('Hóa đơn lưu trú/POS đã chốt trong kỳ'))
  assert.ok(financialText.includes('Tiền khách thanh toán trừ hoàn tiền trong kỳ'))
  assert.ok(financialText.includes('7 đêm đã phục vụ, trước ngày kinh doanh hiện tại'))
  assert.ok(financialText.includes('Đã thu cho các booking chưa nhận phòng'))
  assert.ok(financialText.includes('Số tiền còn phải thu của booking/POS đang có dư nợ'))
  assert.ok(financialText.includes(view.asOfDate))
  assert.deepEqual(descriptions(ledger), [
    'Tổng số dư ledger trước ngày bắt đầu',
    'Các bút toán tăng quỹ trong kỳ',
    'Các bút toán giảm quỹ trong kỳ',
    'Đầu kỳ + thu − chi; chuyển quỹ được đối ứng',
  ])
  assert.equal(cards(details).length, 11)
  assert.ok(details.querySelector('.pms-reports-basis'), 'revenue-basis note kept')
  const definitions = details.querySelector('.pms-reports-definitions')?.textContent || ''
  assert.match(definitions, /XYZ/)
  assert.match(definitions, /QRS/)
}

test('occupancy shows three primary cards, a table jump, the table and chips before a closed financial disclosure', async () => {
  await withDraftDom(async (tools) => {
    const { click } = tools
    const view = await workspace(tools, '/id/reports/occupancy' + PERIOD)
    const root = view.container
    assert.deepEqual(
      view.reads
        .map(([kind, start, end, currency, basis]) => [kind, start, end, currency, basis])
        .sort(),
      [
        ['financial', '2028-02-01', '2028-02-03', 'VND', 'base'],
        ['revenue', '2028-02-01', '2028-02-03', 'VND', 'base'],
      ],
    )
    const table = root.querySelector('.pms-reports-table-card')
    const region = root.querySelector('.pms-reports-table-scroll[role="region"]')
    const details = root.querySelector('details.pms-reports-details')
    assert.equal(root.querySelectorAll('details').length, 1)
    assert.equal(details.querySelector('summary').textContent, 'Chi tiết tài chính')
    assert.equal(details.open, false, 'disclosure starts closed')

    const outside = cards(root).filter((card) => !card.closest('details'))
    assert.equal(outside.length, 3, 'exactly three primary cards')
    for (const card of outside) assert.ok(follows(card, table), 'primary cards precede the table')
    assert.deepEqual(
      outside.map((card) => card.querySelector('.pms-reports-summary-value').textContent),
      ['3', '33.3%', '2 ngày'],
    )

    const jump = root.querySelector('button.pms-reports-jump')
    assert.ok(jump.textContent.trim(), 'jump is labelled')
    assert.equal(jump.getAttribute('aria-controls'), region.id)
    assert.ok(
      follows(outside[2], jump) && follows(jump, table),
      'jump sits between the cards and the table',
    )
    const chips = root.querySelector('.pms-reports-room-types')
    assert.ok(
      follows(table, chips) && follows(chips, details),
      'table, then chips, then disclosure',
    )
    assert.equal(root.querySelector('.pms-reports-financial').closest('details'), details)
    assert.equal(root.querySelector('.pms-reports-ledger').closest('details'), details)
    assert.equal(root.querySelector('.pms-reports-definitions').closest('details'), details)
    assert.equal(root.querySelector('.pms-reports-basis').closest('details'), details)
    assertFinancialDetails(view, details)

    const scrolled = []
    region.scrollIntoView = (...args) => {
      scrolled.push(args)
    } // jsdom fixture stub only
    const before = view.location()
    await click(jump)
    assert.equal(scrolled.length, 1)
    assert.equal(tools.document.activeElement, region, 'focus lands on the real table region')
    assert.equal(region.tabIndex, 0)
    assert.equal(view.location(), before, 'no hash or route change')
  })
})

test('expanded disclosure keeps every figure and stays open across refresh', async () => {
  await withDraftDom(async (tools) => {
    const { act } = tools
    const view = await workspace(tools, '/id/reports/occupancy' + PERIOD)
    const details = view.container.querySelector('details.pms-reports-details')
    await act(async () => {
      details.open = true
    })
    assertFinancialDetails(view, details)
    const readsBefore = view.reads.length
    await act(async () => view.store.patch({ workspaceRevision: 2 }))
    await view.settle()
    assert.equal(
      view.reads.length,
      readsBefore + 2,
      'refresh reads revenue and financial once each',
    )
    assert.equal(
      view.container.querySelector('details.pms-reports-details'),
      details,
      'same disclosure element',
    )
    assert.equal(details.open, true, 'still open after refresh')
    assertFinancialDetails(view, details)
  })
})

test('disclosure opened before data shows honest loading, then the data', async () => {
  await withDraftDom(async (tools) => {
    const { act } = tools
    let release
    const gate = {
      promise: new Promise((done) => {
        release = done
      }),
    }
    const view = await workspace(tools, '/id/reports/occupancy' + PERIOD, { gate })
    const details = view.container.querySelector('details.pms-reports-details')
    await act(async () => {
      details.open = true
    })
    assert.equal(cards(details).length, 0)
    const status = details.querySelector('[role="status"]')
    assert.ok(status && status.textContent.trim(), 'loading status inside disclosure')
    await act(async () => {
      release()
    })
    await view.settle()
    assert.equal(details.open, true)
    assertFinancialDetails(view, details)
  })
})

test('error then retry reloads with the disclosure kept open', async () => {
  await withDraftDom(async (tools) => {
    const { act, click } = tools
    const view = await workspace(tools, '/id/reports/occupancy' + PERIOD, { failFinancial: 1 })
    const details = view.container.querySelector('details.pms-reports-details')
    await act(async () => {
      details.open = true
    })
    const alert = [...view.container.querySelectorAll('[role="alert"]')].find((node) =>
      node.textContent.includes('Máy chủ tạm lỗi'),
    )
    assert.ok(alert, 'error shown')
    assert.equal(cards(details).length, 0)
    assert.ok(details.querySelector('[role="status"]').textContent.trim())
    const before = view.reads.length
    await click(alert.querySelector('button'))
    await view.settle()
    assert.equal(view.reads.length, before + 2)
    assert.equal(details.open, true)
    assert.equal(view.container.querySelector('details.pms-reports-details'), details)
    assertFinancialDetails(view, details)
  })
})

test('invalid occupancy period makes no reads and the disclosure reports it', async () => {
  await withDraftDom(async (tools) => {
    for (const query of [
      '?start=bad&end=2028-02-03',
      '?start=2028-02-01&end=2028-02-03&period_invalid=1',
    ]) {
      const view = await workspace(tools, '/id/reports/occupancy' + query)
      assert.equal(view.reads.length, 0, query)
      const details = view.container.querySelector('details.pms-reports-details')
      assert.equal(details.open, false)
      assert.equal(cards(details).length, 0)
      assert.ok(details.querySelector('[role="status"]').textContent.trim())
      assert.ok(view.container.querySelector('#report-date-error[role="alert"]'))
      await view.unmount()
    }
  })
})

test('revenue mode keeps its hierarchy without a disclosure or jump', async () => {
  await withDraftDom(async (tools) => {
    const view = await workspace(tools, '/id/reports/revenue' + PERIOD)
    const root = view.container
    assert.equal(root.querySelector('details'), null)
    assert.equal(root.querySelector('.pms-reports-jump'), null)
    assert.equal(root.querySelector('.pms-reports-room-types'), null)
    assert.equal(cards(root).length, 14)
    const table = root.querySelector('.pms-reports-table-card')
    const financial = root.querySelector('.pms-reports-financial')
    const ledger = root.querySelector('.pms-reports-ledger')
    assert.ok(follows(financial, table), 'financial cards before table')
    assert.ok(follows(table, ledger), 'ledger cards after table')
    assert.equal(
      financial.previousElementSibling.classList.contains('pms-reports-summary'),
      true,
      'primary cards directly precede financial cards',
    )
    assert.equal(cards(financial.previousElementSibling).length, 3)
    assert.deepEqual(values(financial), [
      view.vnd('1111.0000'),
      view.vnd('2222.0000'),
      view.vnd('3333.0000'),
      view.vnd('4444.0000'),
      view.vnd('6666.0000'),
      view.vnd('7777.0000'),
      view.asOfTime,
    ])
    assert.deepEqual(values(ledger), [
      view.vnd('8888.0000'),
      view.vnd('9999.0000'),
      view.vnd('1212.0000'),
      view.vnd('1313.0000'),
    ])
    const basis = root.querySelector('.pms-reports-basis'),
      definitions = root.querySelector('.pms-reports-definitions')
    assert.ok(follows(ledger, basis) && follows(basis, definitions))
    assert.match(definitions.textContent, /XYZ/)
    assert.equal(view.reads.length, 2)
  })
})
