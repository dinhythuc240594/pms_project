import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

// Synthetic data only. Search must cover the full loaded workspace array, never a slice.
const pad = (value) => String(value).padStart(4, '0')
const cashbookRows = (count = 1000) =>
  Array.from({ length: count }, (_, index) => {
    const n = index + 1
    return {
      id: `cash-${pad(n)}`,
      name: n === count ? 'Zebra Ledger Unique' : `Category ${pad(n)}`,
      type: n % 2 ? 'INCOME' : 'EXPENSE',
      active: true,
    }
  })
const serviceCategories = [
  { id: 'cat-food', name: 'Food', active: true },
  { id: 'cat-spa', name: 'Spa', active: true },
]
const services = [
  { id: 'svc-01', name: 'Spa Massage', category: 'Spa', price: 300000, unit: 'Lần', active: true },
  { id: 'svc-02', name: 'Spa Juice', category: 'Food', price: 50000, unit: 'Ly', active: true },
  {
    id: 'svc-03',
    name: 'Breakfast Set',
    category: 'Food',
    price: 120000,
    unit: 'Phần',
    active: true,
  },
  { id: 'svc-04', name: 'Sauna Room', category: 'Spa', price: 200000, unit: 'Lần', active: true },
  ...Array.from({ length: 26 }, (_, index) => ({
    id: `svc-${String(index + 5).padStart(2, '0')}`,
    name: `Item ${index + 5}`,
    category: index % 2 ? 'Food' : 'Spa',
    price: 1000,
    unit: 'Lần',
    active: true,
  })),
]

function makePms({ canWrite = true, cashbook = cashbookRows() } = {}) {
  const calls = { save: [], toggle: [] }
  const value = {
    tenantId: 'tenant-test',
    authGeneration: 1,
    settings: { currency: 'VND' },
    access: (permission) => ({ allowed: permission === 'settings.write' ? canWrite : true }),
    routeAccess: () => ({ allowed: true }),
    saveMaster: async (...args) => {
      calls.save.push(args)
    },
    toggleMaster: async (...args) => {
      calls.toggle.push(args)
    },
    cashbookCategories: cashbook,
    serviceCategories,
    services,
    units: [
      { id: 'u1', name: 'Lần' },
      { id: 'u2', name: 'Ly' },
      { id: 'u3', name: 'Phần' },
    ],
    paymentMethods: [{ id: 'pm-1', name: 'Cash', type: 'CASH', active: true }],
    funds: [{ id: 'fund-1', name: 'Front cash', type: 'cash', currency: 'VND', active: true }],
    bedTypes: [{ id: 'bed-1', name: 'Queen' }],
    meals: [{ id: 'meal-1', name: 'Breakfast', price: 0, active: true }],
    commissionTypes: [],
    commissionRules: [],
    bookingSources: [],
  }
  return { value, calls }
}

async function mountSettings({ React, load, mount }, url, pms) {
  const { default: Settings } = await load('/src/apps/pms/settings/pages/Settings.jsx')
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const { MemoryRouter } = await import('react-router-dom')
  return mount(
    React.createElement(
      PmsContext.Provider,
      { value: pms },
      React.createElement(MemoryRouter, { initialEntries: [url] }, React.createElement(Settings)),
    ),
  )
}

const bodyRows = (section) => [...section.querySelectorAll('tbody tr')]
const names = (section) =>
  bodyRows(section).map((row) => row.querySelector('.pms-catalog-name')?.textContent)
const resultNumbers = (section) =>
  (section.querySelector('.pms-catalog-results')?.textContent || '')
    .replace(/(\d)[.,\s ](?=\d{3}\b)/g, '$1')
    .match(/\d+/g)
    ?.map(Number) || []

test('cashbook categories search the full 1000-row workspace array and clear restores all rows without writes', async () => {
  await withDraftDom(async (dom) => {
    const { value, calls } = makePms()
    const view = await mountSettings(dom, '/id/settings?section=accounting&tab=transactions', value)
    const catalogs = view.container.querySelectorAll('section.pms-catalog')
    assert.equal(catalogs.length, 1)
    const section = catalogs[0]
    assert.equal(view.container.querySelectorAll('.pms-catalog-toolbar').length, 1)
    const search = section.querySelector('.pms-catalog-toolbar input[type="search"]')
    assert.ok(search)
    assert.equal(bodyRows(section).length, 1000)

    await dom.input(search, 'cash-1000')
    assert.deepEqual(names(section), ['Zebra Ledger Unique'])
    assert.ok(
      resultNumbers(section).includes(1) && resultNumbers(section).includes(1000),
      section.querySelector('.pms-catalog-results').textContent,
    )

    await dom.input(search, 'zEBRA ledger UNIQUE')
    assert.deepEqual(names(section), ['Zebra Ledger Unique'])

    await dom.input(search, 'no-such-category-xyz')
    assert.equal(bodyRows(section).length, 0)
    const clear = section.querySelector('.pms-catalog-empty button')
    assert.ok(clear, 'filtered empty state offers the existing clear action')
    await dom.click(clear)
    assert.equal(search.value, '')
    assert.equal(bodyRows(section).length, 1000)
    assert.equal(section.querySelector('.pms-catalog-count').textContent, '1000')
    assert.deepEqual(calls, { save: [], toggle: [] })
    await view.unmount()
  })
})

test('owner editor draft survives filtering its own row away while focus stays in search and nothing saves', async () => {
  await withDraftDom(async (dom) => {
    const { value, calls } = makePms({ cashbook: cashbookRows(40) })
    const view = await mountSettings(dom, '/id/settings?section=accounting&tab=transactions', value)
    const section = view.container.querySelector('section.pms-catalog')
    const target = bodyRows(section).find(
      (row) => row.querySelector('.pms-catalog-name').textContent === 'Category 0005',
    )
    await dom.click(target.querySelector('.pms-catalog-edit'))
    const form = section.querySelector('form.pms-catalog-editor')
    assert.ok(form)
    const nameInput = form.querySelector('input[id$="-name"]')
    assert.equal(nameInput.value, 'Category 0005')
    await dom.input(nameInput, 'Draft renamed category')

    const search = section.querySelector('.pms-catalog-toolbar input[type="search"]')
    search.focus()
    await dom.input(search, 'cash-0020')
    assert.deepEqual(names(section), ['Category 0020'])
    assert.ok(!names(section).includes('Category 0005'), 'edited row is filtered out')
    assert.equal(
      section.querySelector('form.pms-catalog-editor'),
      form,
      'editor form stays mounted',
    )
    assert.equal(form.querySelector('input[id$="-name"]').value, 'Draft renamed category')
    assert.equal(dom.document.activeElement, search)
    assert.equal(search.value, 'cash-0020')

    await dom.input(search, '')
    assert.equal(bodyRows(section).length, 40)
    assert.equal(form.querySelector('input[id$="-name"]').value, 'Draft renamed category')
    assert.deepEqual(calls, { save: [], toggle: [] })
    await view.unmount()
  })
})

test('services tab: only the services grid is searchable, category filter composes with query and clear', async () => {
  await withDraftDom(async (dom) => {
    const { value, calls } = makePms()
    const view = await mountSettings(dom, '/id/settings?section=services&tab=services', value)
    const catalogs = view.container.querySelectorAll('section.pms-catalog')
    assert.equal(catalogs.length, 2)
    const [categoriesGrid, servicesGrid] = catalogs
    assert.equal(categoriesGrid.querySelector('.pms-catalog-toolbar'), null)
    assert.equal(view.container.querySelectorAll('.pms-catalog-toolbar').length, 1)

    const search = servicesGrid.querySelector('.pms-catalog-toolbar input[type="search"]')
    const filter = servicesGrid.querySelector('.pms-catalog-toolbar select')
    assert.ok(search && filter)
    assert.equal(bodyRows(servicesGrid).length, services.length)

    await dom.input(search, 'SPA')
    assert.deepEqual(names(servicesGrid).sort(), ['Spa Juice', 'Spa Massage'])
    await dom.input(filter, 'Food')
    assert.deepEqual(names(servicesGrid), ['Spa Juice'])
    await dom.input(search, '')
    assert.equal(
      bodyRows(servicesGrid).length,
      services.filter((row) => row.category === 'Food').length,
    )

    await dom.input(search, 'no-such-service-xyz')
    assert.equal(bodyRows(servicesGrid).length, 0)
    await dom.click(servicesGrid.querySelector('.pms-catalog-empty button'))
    assert.equal(search.value, '')
    assert.equal(filter.value, '')
    assert.equal(bodyRows(servicesGrid).length, services.length)
    assert.equal(bodyRows(categoriesGrid).length, serviceCategories.length)
    assert.deepEqual(calls, { save: [], toggle: [] })
    await view.unmount()
  })
})

test('small catalogs stay compact without a search toolbar', async () => {
  await withDraftDom(async (dom) => {
    const { value } = makePms()
    for (const [url, grids] of [
      ['/id/settings?section=accounting&tab=payments', 2],
      ['/id/settings?section=rooms&tab=bed_types', 1],
      ['/id/settings?section=services&tab=meals', 1],
    ]) {
      const view = await mountSettings(dom, url, value)
      assert.equal(view.container.querySelectorAll('section.pms-catalog').length, grids, url)
      assert.equal(
        view.container.querySelectorAll('.pms-catalog-toolbar, input[type="search"]').length,
        0,
        url,
      )
      await view.unmount()
    }
  })
})

test('viewer can search catalogs but never gains add, edit or toggle controls', async () => {
  await withDraftDom(async (dom) => {
    const { value, calls } = makePms({ canWrite: false })
    const cash = await mountSettings(dom, '/id/settings?section=accounting&tab=transactions', value)
    const section = cash.container.querySelector('section.pms-catalog')
    const search = section.querySelector('.pms-catalog-toolbar input[type="search"]')
    assert.ok(search, 'viewer still gets read-only search')
    await dom.input(search, 'zebra')
    assert.deepEqual(names(section), ['Zebra Ledger Unique'])
    assert.equal(section.querySelectorAll('button, [role="switch"], form').length, 0)
    await dom.input(search, '')
    assert.equal(bodyRows(section).length, 1000)
    assert.equal(section.querySelectorAll('button, [role="switch"], form').length, 0)
    await cash.unmount()

    const svc = await mountSettings(dom, '/id/settings?section=services&tab=services', value)
    const servicesGrid = svc.container.querySelectorAll('section.pms-catalog')[1]
    await dom.input(servicesGrid.querySelector('.pms-catalog-toolbar select'), 'Spa')
    await dom.input(
      servicesGrid.querySelector('.pms-catalog-toolbar input[type="search"]'),
      'massage',
    )
    assert.deepEqual(names(servicesGrid), ['Spa Massage'])
    assert.equal(
      svc.container.querySelectorAll(
        'section.pms-catalog button, section.pms-catalog [role="switch"], section.pms-catalog form',
      ).length,
      0,
    )
    assert.deepEqual(calls, { save: [], toggle: [] })
    await svc.unmount()
  })
})
