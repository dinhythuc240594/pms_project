import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

// UX12 Stock slice: operational tabs, compact report with paging, detail toggle
// and a document history that is seeded once from the report warehouse only.
const A = 'warehouse-a',
  B = 'warehouse-b & 2',
  C = 'warehouse-c',
  OFF = 'warehouse-off'
const masters = {
  warehouses: [
    { id: OFF, name: 'Kho dừng', active: false },
    { id: A, name: 'Kho A', active: true, isDefault: true },
    { id: B, name: 'Kho B', active: true },
    { id: C, name: 'Kho C', active: true },
  ],
  items: [],
  suppliers: [],
}
const pad = (n) => String(n).padStart(4, '0')
// lowStock is deliberately inconsistent with quantity/minStock: the UI must follow the server flag.
const stockRow = (i) => {
  const low = i % 7 === 0
  return {
    warehouseId: A,
    warehouse: 'Kho A',
    itemId: `item-${pad(i)}`,
    item: `Mặt hàng ${pad(i)}`,
    sku: `SKU-${pad(i)}`,
    unit: 'chai',
    openingQuantity: `${i}.5000`,
    received: '2.0000',
    issued: '0.2500',
    closingQuantity: `${i + 2}.2500`,
    quantity: low ? '20.0000' : '3.0000',
    minStock: '10.0000',
    lowStock: low,
    unitCost: '12345.67890000',
    costValue: `${i}000.1200`,
  }
}
const stockReport = (count, { reconciled = true } = {}) => {
  const rows = Array.from({ length: count }, (_, index) => stockRow(index + 1))
  return {
    rows,
    summary: {
      rowCount: count,
      lowStockCount: rows.filter((row) => row.lowStock).length,
      currency: 'VND',
      valuation: '987654.3200',
      reconciled,
    },
  }
}

const field = (root, name, selector = 'select') =>
  [...root.querySelectorAll('label')]
    .find((label) => label.textContent.trim().startsWith(name))
    ?.querySelector(selector)
const pathsWith = (paths, pathname) =>
  paths.map((path) => new URL(path, 'http://fixture')).filter((url) => url.pathname === pathname)
const shown = (node) => Boolean(node) && !node.closest('[hidden]')
const tab = (root, name) =>
  [...root.querySelectorAll('[role="tab"]')].find((node) => node.textContent.trim() === name)
const panels = (root) => [...root.querySelectorAll('[role="tabpanel"]')]
const historyPanel = (root) => panels(root).find((panel) => Boolean(field(panel, 'Lọc kho')))
const stockPanel = (root) => panels(root).find((panel) => panel !== historyPanel(root))
function visiblePanel(root) {
  const open = panels(root).filter((panel) => !panel.hidden)
  assert.equal(open.length, 1, 'exactly one tabpanel is visible')
  return open[0]
}
function requireTabs(root) {
  const stockTab = tab(root, 'Tồn kho'),
    historyTab = tab(root, 'Lịch sử phiếu kho')
  assert.ok(stockTab, 'Stock page must render a role="tab" named "Tồn kho"')
  assert.ok(historyTab, 'Stock page must render a role="tab" named "Lịch sử phiếu kho"')
  assert.equal(panels(root).length, 2, 'both tabpanels stay mounted')
  return { stockTab, historyTab }
}
const headers = (panel) =>
  [...panel.querySelector('table').querySelectorAll('thead th')].map((node) =>
    node.textContent.trim(),
  )
const bodyRows = (panel) => [...panel.querySelector('table').tBodies[0].rows]
const skus = (panel) => bodyRows(panel).map((row) => row.cells[2]?.textContent.trim())
const pageText = (page, pages) => new RegExp(`Trang\\D{0,12}${page}\\D{1,12}${pages}(?!\\d)`)
const matchCount = (count) => new RegExp(`(?<!\\d)${count}\\s*dòng`)
const nextPage = (root) => root.querySelector('[aria-label="Trang báo cáo sau"]')
const previousPage = (root) => root.querySelector('[aria-label="Trang báo cáo trước"]')
const reportReload = (root) =>
  [...root.querySelectorAll('button')].find((node) => node.textContent.includes('Tải lại báo cáo'))
const receiptQuery = (root) => {
  const link = [...root.querySelectorAll('a')].find(
    (node) => new URL(node.href).pathname === '/id/inventory/in',
  )
  assert.ok(link, 'receipt header link stays available')
  return [...new URL(link.href).searchParams]
}
const reconcileAlertShown = (root) =>
  [...root.querySelectorAll('[role="alert"]')].some(
    (node) => node.textContent.includes('Sổ biến động chưa khớp') && shown(node),
  )
const leafShown = (root, text) =>
  [...root.querySelectorAll('*')].some(
    (node) => !node.children.length && node.textContent.includes(text) && shown(node),
  )
const historyDates = (panel) => [
  ...panel.querySelectorAll('.date-input-control input[type="text"]'),
]
const MAIN_COLUMNS = ['Kho', 'Mặt hàng', 'SKU', 'Đơn vị', 'Tồn hiện tại', 'Cảnh báo']

async function fixture(env, { report = () => stockReport(1000), read, allowed = true } = {}) {
  const { React, load, mount } = env
  const { default: Stock } = await load('/src/apps/pms/inventory/pages/InventoryStock.jsx')
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const paths = [],
    writes = []
  const record =
    (name) =>
    async (...args) => {
      writes.push([name, ...args])
      return { id: 'synthetic-doc' }
    }
  const pms = {
    tenantId: 'synthetic-hotel',
    user: { id: 'synthetic-user' },
    workspaceRevision: 1,
    settings: { timezone: 'UTC', currency: 'VND' },
    access: () => ({ allowed }),
    requestTenant: async (path) => {
      paths.push(path)
      if (read) {
        const override = read(path)
        if (override !== undefined) return override
      }
      const url = new URL(path, 'http://fixture')
      if (url.pathname === '/inventory/masters') return structuredClone(masters)
      if (url.pathname === '/inventory/stock') return report(url)
      if (url.pathname === '/inventory/documents')
        return { documents: [], pagination: { totalItems: 100 } }
      throw new Error('Unexpected fixture request: ' + path)
    },
    createInventoryDocument: record('create'),
    reverseInventoryDocument: record('reverse'),
    returnPosStock: record('return'),
  }
  const h = React.createElement
  const view = await mount(
    h(
      MemoryRouter,
      { initialEntries: ['/id/inventory/stock'] },
      h(
        PmsContext.Provider,
        { value: pms },
        h(Routes, null, h(Route, { path: '/id/inventory/stock', element: h(Stock) })),
      ),
    ),
  )
  return { ...view, paths, writes }
}

test('stock tab shows six operational columns with 50-row paging, full-dataset search, server low-stock flag and clamping', async () => {
  await withDraftDom(async (env) => {
    let total = 1000
    const { container, writes } = await fixture(env, { report: () => stockReport(total) })
    const { stockTab } = requireTabs(container)
    assert.equal(stockTab.getAttribute('aria-selected'), 'true')
    assert.equal(historyPanel(container).hidden, true, 'inactive history panel is hidden')
    let panel = visiblePanel(container)
    assert.equal(panel, stockPanel(container))
    assert.deepEqual(headers(panel), MAIN_COLUMNS)
    assert.equal(
      shown(field(container, 'Từ ngày báo cáo', 'input')),
      true,
      'report start date stays visible',
    )
    assert.equal(
      shown(field(container, 'Đến ngày báo cáo', 'input')),
      true,
      'report end date stays visible',
    )
    assert.equal(bodyRows(panel).length, 50)
    assert.equal(skus(panel)[0], 'SKU-0001')
    assert.match(panel.textContent, pageText(1, 20))
    assert.match(panel.textContent, matchCount(1000))
    assert.equal(previousPage(container).disabled, true)

    await env.click(nextPage(container))
    panel = visiblePanel(container)
    assert.equal(bodyRows(panel).length, 50)
    assert.equal(skus(panel)[0], 'SKU-0051')
    assert.equal(skus(panel).at(-1), 'SKU-0100')
    assert.match(panel.textContent, pageText(2, 20))

    const search = panel.querySelector('input[type="search"]')
    assert.ok(search, 'search stays in the stock tab')
    await env.input(search, 'SKU-0999')
    panel = visiblePanel(container)
    assert.deepEqual(
      skus(panel),
      ['SKU-0999'],
      'search covers the full 1000-row report, not only the current page',
    )
    assert.match(panel.textContent, pageText(1, 1))
    assert.match(panel.textContent, matchCount(1))

    await env.input(search, '')
    await env.click(nextPage(container))
    assert.equal(skus(visiblePanel(container))[0], 'SKU-0051')
    await env.click(field(container, 'Chỉ xem tồn thấp', 'input[type="checkbox"]'))
    panel = visiblePanel(container)
    assert.equal(bodyRows(panel).length, 50)
    assert.equal(
      skus(panel)[0],
      'SKU-0007',
      'low-stock filter resets to page 1 and follows row.lowStock',
    )
    assert.equal(
      skus(panel).every((sku) => Number(sku.slice(4)) % 7 === 0),
      true,
    )
    assert.equal(
      bodyRows(panel).every((row) => row.cells[5].textContent.includes('Tồn thấp')),
      true,
    )
    assert.match(panel.textContent, pageText(1, 3))
    assert.match(panel.textContent, matchCount(142))

    await env.click(field(container, 'Chỉ xem tồn thấp', 'input[type="checkbox"]'))
    await env.click(nextPage(container))
    await env.click(nextPage(container))
    assert.equal(skus(visiblePanel(container))[0], 'SKU-0101')
    total = 60
    await env.click(reportReload(container))
    panel = visiblePanel(container)
    assert.equal(
      bodyRows(panel).length,
      10,
      'page 3 clamps to the last page after the result shrinks',
    )
    assert.equal(skus(panel)[0], 'SKU-0051')
    assert.equal(skus(panel).at(-1), 'SKU-0060')
    assert.match(panel.textContent, pageText(2, 2))
    assert.equal(nextPage(container).disabled, true)
    assert.equal(writes.length, 0)
  })
})

test('detail toggle shows period, cost and currency columns; an unreconciled ledger alert stays visible in every mode and tab', async () => {
  await withDraftDom(async (env) => {
    const { container, writes } = await fixture(env, {
      report: () => stockReport(3, { reconciled: false }),
    })
    const { historyTab } = requireTabs(container)
    assert.deepEqual(headers(visiblePanel(container)), MAIN_COLUMNS)
    assert.equal(reconcileAlertShown(container), true, 'alert visible in compact mode')

    const toggle = field(container, 'Hiện số liệu kỳ và giá trị', 'input[type="checkbox"]')
    assert.ok(toggle, 'detail checkbox is labelled "Hiện số liệu kỳ và giá trị"')
    await env.click(toggle)
    let panel = visiblePanel(container)
    const detailed = headers(panel)
    assert.equal(detailed.length, 12)
    for (const name of [
      'Nhập trong kỳ',
      'Xuất trong kỳ',
      'Tồn cuối kỳ',
      'Tồn hiện tại',
      'Giá vốn TB cuối kỳ',
      'Giá trị cuối kỳ (VND)',
      'Cảnh báo',
    ])
      assert.equal(detailed.includes(name), true, `detail column ${name}`)
    const cells = [...bodyRows(panel)[0].cells].map((cell) => cell.textContent.trim())
    for (const value of ['1.5', '2', '0.25', '3.25', '12345.6789', '1000.12'])
      assert.equal(cells.includes(value), true, `detail cell ${value}`)
    assert.equal(
      leafShown(container, '987654.32'),
      true,
      'summary valuation visible in detail mode',
    )
    assert.equal(reconcileAlertShown(container), true, 'alert visible in detail mode')

    await env.click(toggle)
    assert.deepEqual(headers(visiblePanel(container)), MAIN_COLUMNS)
    assert.equal(reconcileAlertShown(container), true)

    await env.click(historyTab)
    panel = visiblePanel(container)
    assert.equal(panel, historyPanel(container))
    assert.equal(stockPanel(container).hidden, true)
    assert.equal(reconcileAlertShown(container), true, 'alert visible in the history tab')
    assert.equal(writes.length, 0)
  })
})

test('history is seeded once with the report warehouse only; dates, manual choice and both paginations stay independent', async () => {
  await withDraftDom(async (env) => {
    const { container, paths, writes } = await fixture(env, { report: () => stockReport(120) })
    const { stockTab, historyTab } = requireTabs(container)
    const documents = () => pathsWith(paths, '/inventory/documents')

    await env.input(field(container, 'Kho báo cáo'), B)
    await env.input(field(container, 'Từ ngày báo cáo', 'input'), '01/01/2020')
    await env.input(field(container, 'Đến ngày báo cáo', 'input'), '31/01/2020')
    const report = pathsWith(paths, '/inventory/stock').at(-1).searchParams
    assert.equal(report.get('warehouseId'), B)
    assert.equal(report.get('start_date'), '2020-01-01')
    assert.equal(report.get('end_date'), '2020-01-31')
    await env.click(nextPage(container))
    assert.equal(skus(visiblePanel(container))[0], 'SKU-0051')
    assert.deepEqual(receiptQuery(container), [['warehouseId', B]])
    // No live sync while the stock tab is active; the mounted history select stays empty.
    assert.equal(historyPanel(container).hidden, true)
    assert.equal(field(container, 'Lọc kho').value, '')
    assert.equal(
      documents().some((url) => url.searchParams.get('warehouseId') === B),
      false,
    )

    await env.click(historyTab)
    assert.equal(historyTab.getAttribute('aria-selected'), 'true')
    let history = visiblePanel(container)
    assert.equal(history, historyPanel(container))
    assert.equal(field(history, 'Lọc kho').value, B)
    const seeded = documents().at(-1).searchParams
    assert.equal(seeded.get('warehouseId'), B)
    assert.notEqual(seeded.get('start_date'), '2020-01-01', 'report start date is not copied')
    assert.notEqual(seeded.get('end_date'), '2020-01-31', 'report end date is not copied')
    assert.equal(
      historyDates(history).some((input) => ['01/01/2020', '31/01/2020'].includes(input.value)),
      false,
    )
    assert.match(
      history.textContent,
      /độc lập/i,
      'history explains that its dates are independent of the report',
    )

    await env.click(history.querySelector('[aria-label="Trang tiếp"]'))
    assert.equal(documents().at(-1).searchParams.get('page'), '2')
    assert.equal(documents().at(-1).searchParams.get('warehouseId'), B)
    await env.input(field(history, 'Lọc kho'), C)
    await env.input(historyDates(history)[0], '05/02/2021')
    let latest = documents().at(-1).searchParams
    assert.equal(latest.get('warehouseId'), C)
    assert.equal(latest.get('start_date'), '2021-02-05')

    await env.click(stockTab)
    assert.equal(visiblePanel(container), stockPanel(container))
    assert.equal(
      skus(visiblePanel(container))[0],
      'SKU-0051',
      'report page is independent of history paging',
    )
    const before = documents().length
    await env.input(field(container, 'Kho báo cáo'), A)
    assert.deepEqual(receiptQuery(container), [['warehouseId', A]])
    assert.equal(documents().length, before, 'report warehouse changes do not refetch history')
    assert.equal(field(container, 'Lọc kho').value, C)

    await env.click(historyTab)
    history = visiblePanel(container)
    assert.equal(
      field(history, 'Lọc kho').value,
      C,
      'manual history warehouse survives a later report warehouse',
    )
    assert.equal(historyDates(history)[0].value, '05/02/2021')
    latest = documents().at(-1).searchParams
    assert.equal(latest.get('warehouseId'), C)
    assert.equal(latest.get('start_date'), '2021-02-05')
    assert.equal(writes.length, 0)
  })
})

test('"Dùng kho đang xem" applies only the current report warehouse to a manually filtered history in one action', async () => {
  await withDraftDom(async (env) => {
    const { container, paths, writes } = await fixture(env, { report: () => stockReport(120) })
    const { stockTab, historyTab } = requireTabs(container)
    const documents = () => pathsWith(paths, '/inventory/documents')
    const useCurrent = () =>
      [...container.querySelectorAll('button')].find(
        (node) => node.textContent.trim() === 'Dùng kho đang xem',
      )

    await env.input(field(container, 'Kho báo cáo'), B)
    await env.input(field(container, 'Từ ngày báo cáo', 'input'), '01/01/2020')
    await env.click(historyTab)
    let history = visiblePanel(container)
    const historySelect = field(history, 'Lọc kho')
    assert.equal(historySelect.value, B)
    assert.equal(
      shown(useCurrent()),
      false,
      'no override offer while history follows the report warehouse',
    )

    await env.input(historySelect, C)
    await env.input(historyDates(history)[0], '05/02/2021')
    await env.click(history.querySelector('[aria-label="Trang tiếp"]'))
    assert.equal(documents().at(-1).searchParams.get('page'), '2')

    await env.click(stockTab)
    await env.input(field(container, 'Kho báo cáo'), A)
    await env.click(historyTab)
    history = visiblePanel(container)
    assert.equal(field(history, 'Lọc kho').value, C, 'manual history warehouse is kept on reopen')
    const button = useCurrent()
    assert.equal(
      shown(button),
      true,
      'explicit action is offered when the manual warehouse differs from the report',
    )
    assert.match(button.parentElement.textContent, /Kho đang xem trong báo cáo: Kho A/)
    assert.match(button.parentElement.textContent, /Kho C/)

    await env.click(button)
    history = visiblePanel(container)
    assert.equal(field(history, 'Lọc kho'), historySelect, 'history is not remounted')
    assert.equal(historySelect.value, A)
    let latest = documents().at(-1).searchParams
    assert.equal(latest.get('warehouseId'), A)
    assert.equal(latest.get('page'), '1', 'applying the report warehouse resets the history page')
    assert.equal(latest.get('start_date'), '2021-02-05', 'history dates stay independent')
    assert.notEqual(latest.get('start_date'), '2020-01-01')
    assert.equal(historyDates(history)[0].value, '05/02/2021')
    assert.equal(
      useCurrent(),
      undefined,
      'offer disappears once history matches the report warehouse',
    )

    // Report scope "all warehouses" is offered and applied as such.
    await env.input(historySelect, C)
    await env.click(stockTab)
    await env.input(field(container, 'Kho báo cáo'), '')
    await env.click(historyTab)
    assert.equal(historySelect.value, C)
    assert.match(useCurrent().parentElement.textContent, /Kho đang xem trong báo cáo: Tất cả kho/)
    await env.click(useCurrent())
    assert.equal(historySelect.value, '')
    latest = documents().at(-1).searchParams
    assert.equal(latest.has('warehouseId'), false)
    assert.equal(latest.get('start_date'), '2021-02-05')
    assert.equal(writes.length, 0)
  })
})

test('read-only stock keeps tabs, explicit report retry and a create-free history', async () => {
  await withDraftDom(async (env) => {
    let fail = true
    const read = (path) => {
      if (fail && path.startsWith('/inventory/stock?')) {
        fail = false
        return Promise.reject(new Error('Báo cáo tồn tạm lỗi'))
      }
      return undefined
    }
    const { container, writes } = await fixture(env, {
      read,
      allowed: false,
      report: () => stockReport(3),
    })
    const { historyTab } = requireTabs(container)
    const errorShown = () =>
      [...container.querySelectorAll('[role="alert"]')].some(
        (node) => node.textContent.includes('Báo cáo tồn tạm lỗi') && shown(node),
      )
    assert.equal(errorShown(), true)
    const retry = [...container.querySelectorAll('button')].find((node) =>
      node.textContent.includes('Thử lại báo cáo'),
    )
    assert.equal(shown(retry), true)
    await env.click(retry)
    assert.equal(errorShown(), false)
    assert.deepEqual(headers(visiblePanel(container)), MAIN_COLUMNS)
    assert.equal(bodyRows(visiblePanel(container)).length, 3)

    await env.click(historyTab)
    const history = visiblePanel(container)
    assert.match(history.textContent, /Bạn đang xem kho/)
    assert.equal(
      [...container.querySelectorAll('button')].some((node) =>
        node.textContent.includes('Tạo phiếu'),
      ),
      false,
    )
    assert.equal(writes.length, 0)
  })
})
