import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'
import {
  cashflowSearchValid,
  cashflowTarget,
  readCashflowFilters,
  writeCashflowFilters,
} from './cashflowFilters.js'

const hotel = {
  tenantId: 'qa',
  user: { id: 'owner' },
  authGeneration: 1,
  settings: { currency: 'VND', timezone: 'UTC' },
  funds: [],
  users: [],
}
const scoped = (q) =>
  writeCashflowFilters(
    new URLSearchParams('keep=1'),
    { startDate: '', endDate: '', currency: 'VND', page: 1, q },
    hotel,
  )

test('cashbook search URL stays scoped, preserves other filters and rejects malformed values without truncation', () => {
  const params = scoped('café')
  assert.equal(readCashflowFilters(params, hotel, 'cash').q, 'café')
  assert.equal(
    new URL('http://qa' + cashflowTarget('/id/cashflow/bank', params, hotel)).searchParams.get(
      'cf_q',
    ),
    'café',
  )
  assert.equal(params.get('keep'), '1')
  assert.equal(cashflowSearchValid(params, hotel), true)
  for (const value of ['x'.repeat(161), 'bad\nquery'])
    assert.equal(cashflowSearchValid(scoped(value), hotel), false)
  const duplicate = scoped('one')
  duplicate.append('cf_q', 'two')
  assert.equal(cashflowSearchValid(duplicate, hotel), false)
  assert.equal(
    readCashflowFilters(scoped('secret hotel filter'), { ...hotel, tenantId: 'other' }, 'cash').q,
    undefined,
  )
  assert.equal(scoped('').has('cf_q'), false)
})

test('cashbook submits search to the whole-result reader, distinguishes totals, and clears without a write', async () => {
  await withDraftDom(async ({ React, load, mount, input, click }) => {
    const { MemoryRouter, Route, Routes } = await import('react-router-dom')
    const { default: Cashflow } = await load('/src/apps/pms/finance/pages/Cashflow.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const calls = []
    let confirmSearch = true
    const pms = {
      ...hotel,
      cashDocuments: [],
      ledger: [],
      cashbookCategories: [],
      workspaceRevision: 1,
      access: () => ({ allowed: false }),
      getCashbook: async (filters) => {
        calls.push(filters)
        return {
          search:
            filters.q && confirmSearch
              ? { q: filters.q, scope: 'ledger_entries', summaryFiltered: false }
              : undefined,
          summary: { opening: '100', income: '1000', outflow: '0', closing: '1100' },
          fundBalances: [],
          cashDocuments: [],
          pagination: { page: filters.page, pageSize: 20, totalItems: filters.q ? 1 : 1000 },
          ledger: filters.q
            ? [
                {
                  id: 'entry-0001',
                  description: 'Needle beyond page one',
                  amount: '1',
                  currency: 'VND',
                  date: '2026-01-02',
                  createdAt: '2026-01-02T00:00:00Z',
                },
              ]
            : [],
        }
      },
    }
    const h = React.createElement
    const view = await mount(
      h(
        MemoryRouter,
        { initialEntries: ['/id/cashflow/cash'] },
        h(
          PmsContext.Provider,
          { value: pms },
          h(Routes, null, h(Route, { path: '/id/cashflow/:tab', element: h(Cashflow) })),
        ),
      ),
    )
    try {
      const field = () => view.container.querySelector('input[aria-label="Tìm giao dịch quỹ"]')
      const button = (name) =>
        [...view.container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
      const before = calls.length
      await input(field(), 'Needle')
      assert.equal(calls.length, before, 'typing does not read each keystroke')
      await click(button('Tìm giao dịch'))
      assert.equal(calls.at(-1).q, 'Needle')
      assert.equal(calls.at(-1).page, 1)
      assert.match(view.container.textContent, /entry-0001/)
      assert.match(view.container.textContent, /1 giao dịch khớp/)
      assert.match(view.container.textContent, /Tổng kỳ và số dư quỹ không lọc theo từ khóa/)
      await click(button('Xóa tìm kiếm'))
      assert.equal(calls.at(-1).q, undefined)
      assert.equal(field().value, '')
      confirmSearch = false
      await input(field(), 'Unconfirmed')
      await click(button('Tìm giao dịch'))
      assert.match(view.container.textContent, /Máy chủ chưa xác nhận/)
      assert.equal(
        view.container.querySelectorAll('tbody tr td').length,
        1,
        'unconfirmed rows are not presented as matching results',
      )
    } finally {
      await view.unmount()
    }
  })
})

test('cashbook search is not a workspace draft, applies on Enter (not while composing), and money dialogs stay guarded', async () => {
  await withDraftDom(async ({ React, load, mount, input, click, act, window, document }) => {
    const { MemoryRouter, Route, Routes } = await import('react-router-dom')
    const { default: Cashflow } = await load('/src/apps/pms/finance/pages/Cashflow.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { watchWorkspace } = await load('/src/apps/pms/data/workspaceSync.js')
    const calls = []
    let refreshes = 0
    const pms = {
      ...hotel,
      funds: [{ id: 'f1', name: 'Quỹ tiền mặt', type: 'CASH', currency: 'VND', active: true }],
      cashDocuments: [],
      ledger: [],
      cashbookCategories: [],
      workspaceRevision: 1,
      access: () => ({ allowed: true }),
      getCashbook: async (filters) => {
        calls.push(filters)
        return {
          search: filters.q
            ? { q: filters.q, scope: 'ledger_entries', summaryFiltered: false }
            : undefined,
          summary: { opening: '0', income: '0', outflow: '0', closing: '0' },
          fundBalances: [],
          cashDocuments: [],
          pagination: { page: filters.page, pageSize: 20, totalItems: 0 },
          ledger: [],
        }
      },
    }
    const watcher = watchWorkspace(
      async () => {
        refreshes++
      },
      { doc: document },
    )
    const h = React.createElement
    const view = await mount(
      h(
        'div',
        { className: 'pms-content' },
        h(
          MemoryRouter,
          { initialEntries: ['/id/cashflow/cash'] },
          h(
            PmsContext.Provider,
            { value: pms },
            h(Routes, null, h(Route, { path: '/id/cashflow/:tab', element: h(Cashflow) })),
          ),
        ),
      ),
    )
    try {
      const field = () => view.container.querySelector('input[aria-label="Tìm giao dịch quỹ"]')
      const button = (name) =>
        [...view.container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
      const enter = async (init) =>
        act(async () =>
          field().dispatchEvent(
            new window.KeyboardEvent('keydown', {
              key: 'Enter',
              bubbles: true,
              cancelable: true,
              ...init,
            }),
          ),
        )
      assert.equal(field().closest('form'), null, 'search lives outside any form')
      assert.ok(view.container.querySelector('[role="search"]'))
      await input(field(), 'Unapplied')
      button('Tìm giao dịch').focus()
      assert.equal(
        await watcher.refresh(),
        true,
        'typed-but-unapplied search does not block manual refresh',
      )
      assert.equal(refreshes, 1)
      assert.equal(field().value, 'Unapplied', 'refresh keeps the typed text')
      const before = calls.length
      await enter({ isComposing: true })
      assert.equal(calls.length, before, 'Enter while composing does not apply')
      await enter()
      assert.equal(calls.at(-1).q, 'Unapplied')
      await input(field(), 'Applied')
      await click(button('Tìm giao dịch'))
      assert.equal(calls.at(-1).q, 'Applied')
      button('Tìm giao dịch').focus()
      assert.equal(await watcher.refresh(), true, 'applied search does not block manual refresh')
      assert.equal(refreshes, 2)
      await click(button('Thu tiền'))
      assert.ok(view.container.querySelector('dialog[open]'))
      assert.equal(await watcher.refresh(), false, 'open money dialog still blocks refresh')
      assert.equal(refreshes, 2)
    } finally {
      watcher.stop()
      await view.unmount()
    }
  })
})

test('invalid cashbook search links show recovery and never request misleading rows', async () => {
  await withDraftDom(async ({ React, load, mount }) => {
    const { MemoryRouter, Route, Routes } = await import('react-router-dom')
    const { default: Cashflow } = await load('/src/apps/pms/finance/pages/Cashflow.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    let reads = 0
    const pms = {
      ...hotel,
      cashDocuments: [],
      ledger: [],
      cashbookCategories: [],
      access: () => ({ allowed: false }),
      getCashbook: async () => {
        reads++
        throw Error('must not read')
      },
    }
    const h = React.createElement
    const view = await mount(
      h(
        MemoryRouter,
        { initialEntries: ['/id/cashflow/cash?' + scoped('x'.repeat(161))] },
        h(
          PmsContext.Provider,
          { value: pms },
          h(Routes, null, h(Route, { path: '/id/cashflow/:tab', element: h(Cashflow) })),
        ),
      ),
    )
    try {
      assert.equal(reads, 0)
      assert.match(
        view.container.querySelector('[role="alert"]').textContent,
        /Từ khóa không hợp lệ/,
      )
    } finally {
      await view.unmount()
    }
  })
})
