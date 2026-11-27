import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
  useNavigate,
} from 'react-router-dom'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

const A = 'warehouse-a',
  B = 'warehouse-b & 2',
  C = 'warehouse-c',
  OFF = 'warehouse-off'
const masters = {
  warehouses: [
    { id: OFF, name: 'Kho dừng', active: false, isDefault: true },
    { id: A, name: 'Kho A', active: true, isDefault: true },
    { id: B, name: 'Kho B', active: true },
    { id: C, name: 'Kho C', active: true },
  ],
  items: [{ id: 'item-a', name: 'Nước', active: true, costPrice: '1.2500' }],
  suppliers: [],
}
const href = (id, extra = {}) =>
  '/id/inventory/in?' + new URLSearchParams({ warehouseId: id, ...extra })
const field = (root, name, selector = 'select') =>
  [...root.querySelectorAll('label')]
    .find((label) => label.textContent.startsWith(name))
    ?.querySelector(selector)
const createButton = (root) =>
  [...root.querySelectorAll('header button')].find((button) =>
    button.textContent.includes('Tạo phiếu'),
  )
const form = (root) => root.querySelector('.inventory-dialog form')
const listFilter = (root) => field(root, 'Lọc kho')
const pathsWith = (paths, pathname) =>
  paths.map((path) => new URL(path, 'http://fixture')).filter((url) => url.pathname === pathname)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function fixture(
  env,
  {
    initial = '/id/inventory/in',
    kind = 'receipt',
    embedded = false,
    allowed = true,
    read,
    write,
    stock = false,
    guarded = false,
  } = {},
) {
  const { React, load, mount } = env
  const { default: Documents } = await load('/src/apps/pms/inventory/InventoryDocuments.jsx')
  const { default: Stock } = await load('/src/apps/pms/inventory/pages/InventoryStock.jsx')
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const paths = [],
    writes = []
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
      if (url.pathname === '/inventory/stock')
        return { rows: [{ itemId: 'item-a', quantity: '5', version: 9 }] }
      if (url.pathname === '/inventory/documents')
        return { documents: [], pagination: { totalItems: 0 } }
      if (url.pathname === '/inventory/documents/doc-a')
        return {
          id: 'doc-a',
          kind,
          date: '2026-01-01',
          warehouse: 'Kho B',
          lines: [],
          canReverse: false,
        }
      throw new Error('Unexpected fixture request: ' + path)
    },
    createInventoryDocument: async (...args) => {
      writes.push(args)
      return write ? write(...args) : { id: 'doc-a' }
    },
  }
  if (guarded) {
    // Realistic app shell: global provider, route blocker and browser-like history.
    const { DraftGuardProvider, DraftRouteGuard } = await load(
      '/src/shared/drafts/DraftGuardProvider.jsx',
    )
    const h = React.createElement
    function Shell() {
      return h(
        React.Fragment,
        null,
        h(DraftRouteGuard),
        h(PmsContext.Provider, { value: pms }, h(Outlet)),
      )
    }
    const router = createMemoryRouter(
      [
        {
          element: h(Shell),
          children: [
            { path: '/id/inventory/in', element: h(Documents, { kind }) },
            { path: '/id/elsewhere', element: h('p', null, 'Elsewhere') },
          ],
        },
      ],
      { initialEntries: ['/id/elsewhere', initial], initialIndex: 1 },
    )
    const view = await mount(h(DraftGuardProvider, null, h(RouterProvider, { router })))
    return {
      ...view,
      paths,
      writes,
      router,
      go: (to) =>
        env.act(async () => {
          router.navigate(to)
        }),
    }
  }
  let navigate
  function Navigation() {
    const routerNavigate = useNavigate()
    React.useEffect(() => {
      navigate = routerNavigate
    }, [routerNavigate])
    return null
  }
  const content = stock
    ? React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/id/inventory/stock',
          element: React.createElement(Stock),
        }),
        React.createElement(Route, {
          path: '/id/inventory/in',
          element: React.createElement(Documents),
        }),
      )
    : React.createElement(Documents, { kind, embedded })
  const view = await mount(
    React.createElement(
      MemoryRouter,
      { initialEntries: [initial] },
      React.createElement(
        PmsContext.Provider,
        { value: pms },
        React.createElement(Navigation),
        content,
      ),
    ),
  )
  return { ...view, paths, writes, navigate: (...args) => env.act(async () => navigate(...args)) }
}

test('stock carries only the selected warehouse to receipts, their list and a fresh form', async () => {
  await withDraftDom(async (env) => {
    const { container, paths, writes } = await fixture(env, {
      stock: true,
      initial: '/id/inventory/stock',
    })
    let link = container.querySelector('header a')
    assert.equal(new URL(link.href).search, '')
    await env.input(field(container, 'Kho báo cáo'), B)
    await env.input(field(container, 'Từ ngày báo cáo', 'input'), '01/01/2020')
    link = container.querySelector('header a')
    const params = new URL(link.href).searchParams
    assert.deepEqual([...params], [['warehouseId', B]])
    // The embedded history has its own filters, independent of the stock report.
    assert.equal(listFilter(container).value, '')
    await env.click(link)
    assert.equal(listFilter(container).value, B)
    assert.equal(pathsWith(paths, '/inventory/documents').at(-1).searchParams.get('warehouseId'), B)
    await env.click(createButton(container))
    assert.equal(field(form(container), 'Kho của phiếu').value, B)
    assert.equal(
      field(form(container), 'Ngày phiếu', 'input[type="date"]').value,
      new Date().toISOString().slice(0, 10),
    )
    assert.equal(writes.length, 0)
  })
})

test('empty query preserves all-history and default-active form; manual list filters seed only new forms', async () => {
  await withDraftDom(async (env) => {
    const view = await fixture(env)
    assert.equal(listFilter(view.container).value, '')
    assert.equal(
      pathsWith(view.paths, '/inventory/documents').at(-1).searchParams.has('warehouseId'),
      false,
    )
    await env.click(createButton(view.container))
    assert.equal(field(form(view.container), 'Kho của phiếu').value, A)
    await env.click(view.container.querySelector('[aria-label="Đóng phiếu kho"]'))
    await env.input(listFilter(view.container), B)
    await env.click(createButton(view.container))
    assert.equal(field(form(view.container), 'Kho của phiếu').value, B)
    await env.click(view.container.querySelector('[aria-label="Đóng phiếu kho"]'))
    await env.input(listFilter(view.container), OFF)
    assert.equal(
      pathsWith(view.paths, '/inventory/documents').at(-1).searchParams.get('warehouseId'),
      OFF,
    )
    await env.click(createButton(view.container))
    assert.equal(field(form(view.container), 'Kho của phiếu').value, A)
    assert.equal(
      [...field(form(view.container), 'Kho của phiếu').options].some(
        (option) => option.value === OFF,
      ),
      false,
    )
  })
})

test('URL warehouses are validated before list requests, with safe active fallback and a notice', async () => {
  await withDraftDom(async (env) => {
    for (const id of ['missing & ?warehouse', OFF]) {
      const pendingMasters = deferred()
      const view = await fixture(env, {
        initial: href(id),
        read: (path) => (path === '/inventory/masters' ? pendingMasters.promise : undefined),
      })
      assert.equal(pathsWith(view.paths, '/inventory/documents').length, 0)
      assert.equal(createButton(view.container).disabled, true)
      await env.act(async () => pendingMasters.resolve(structuredClone(masters)))
      assert.equal(listFilter(view.container).value, A)
      assert.match(
        view.container.textContent,
        /Kho trong đường dẫn không tồn tại hoặc đã ngừng hoạt động/,
      )
      assert.match(view.container.textContent, /Đang dùng kho mặc định: Kho A/)
      for (const request of pathsWith(view.paths, '/inventory/documents'))
        assert.equal(request.searchParams.get('warehouseId'), A)
      await env.click(createButton(view.container))
      assert.equal(field(form(view.container), 'Kho của phiếu').value, A)
      await view.unmount()
    }
  })
})

test('manual warehouse choice survives refresh, while incoming context resets warehouse and pagination', async () => {
  await withDraftDom(async (env) => {
    const view = await fixture(env, {
      initial: href(B),
      read: (path) =>
        path.startsWith('/inventory/documents?')
          ? { documents: [], pagination: { totalItems: 100 } }
          : undefined,
    })
    await env.input(listFilter(view.container), C)
    await env.click(view.container.querySelector('header button'))
    assert.equal(
      listFilter(view.container).value,
      C,
      'reloading must not reapply the original URL selection',
    )
    await env.click(view.container.querySelector('[aria-label="Trang tiếp"]'))
    assert.equal(pathsWith(view.paths, '/inventory/documents').at(-1).searchParams.get('page'), '2')
    await view.navigate(href(A))
    assert.equal(listFilter(view.container).value, A)
    const request = pathsWith(view.paths, '/inventory/documents').at(-1)
    assert.equal(request.searchParams.get('page'), '1')
    assert.equal(request.searchParams.get('warehouseId'), A)
    assert.equal(request.searchParams.has('context'), false)
    await env.click(createButton(view.container))
    assert.equal(field(form(view.container), 'Kho của phiếu').value, A)
  })
})

test('failed or empty master catalogs never forward an unvalidated URL warehouse; embedded history stays independent', async () => {
  await withDraftDom(async (env) => {
    const failed = await fixture(env, {
      initial: href(B),
      read: (path) =>
        path === '/inventory/masters'
          ? Promise.reject(new Error('Danh mục tạm thời lỗi'))
          : undefined,
    })
    assert.match(failed.container.textContent, /Danh mục tạm thời lỗi/)
    assert.equal(pathsWith(failed.paths, '/inventory/documents').length, 0)
    assert.equal(createButton(failed.container).disabled, true)
    await failed.unmount()
    const empty = await fixture(env, {
      initial: href(B),
      read: (path) =>
        path === '/inventory/masters'
          ? { ...masters, warehouses: [masters.warehouses[0]] }
          : undefined,
    })
    assert.equal(listFilter(empty.container).value, '')
    assert.match(empty.container.textContent, /Chưa có kho đang hoạt động/)
    assert.equal(
      pathsWith(empty.paths, '/inventory/documents').at(-1).searchParams.has('warehouseId'),
      false,
    )
    await env.click(createButton(empty.container))
    assert.equal(field(form(empty.container), 'Kho của phiếu').value, '')
    assert.equal(form(empty.container).querySelector('[type="submit"]').disabled, true)
    await empty.unmount()
    const embedded = await fixture(env, { initial: href(B), kind: 'all', embedded: true })
    assert.equal(listFilter(embedded.container).value, '')
    assert.equal(
      pathsWith(embedded.paths, '/inventory/documents').at(-1).searchParams.has('warehouseId'),
      false,
    )
    assert.equal(createButton(embedded.container), undefined)
  })
})

test('open form keeps its fields and line intent across refresh, manual filters and URL changes', async () => {
  await withDraftDom(async (env) => {
    let reloading
    const view = await fixture(env, {
      initial: href(B),
      read: (path) => (path === '/inventory/masters' && reloading ? reloading.promise : undefined),
    })
    await env.click(createButton(view.container))
    const originalForm = form(view.container)
    await env.input(field(originalForm, 'Kho của phiếu'), C)
    await env.input(field(originalForm, 'Mặt hàng dòng 1'), 'item-a')
    await env.input(field(originalForm, 'Số lượng dòng 1', 'input'), '2.5000')
    const note = field(originalForm, 'Ghi chú phiếu', 'textarea')
    await env.act(async () => {
      Object.getOwnPropertyDescriptor(env.window.HTMLTextAreaElement.prototype, 'value').set.call(
        note,
        'Giữ bản nháp',
      )
      note.dispatchEvent(new env.window.Event('input', { bubbles: true }))
    })
    await env.input(listFilter(view.container), A)
    await view.navigate(href(A))
    reloading = deferred()
    await env.click(view.container.querySelector('header button'))
    assert.equal(
      form(view.container),
      originalForm,
      'refresh must not unmount the draft while masters are loading',
    )
    assert.equal(field(originalForm, 'Kho của phiếu').value, C)
    assert.equal(field(originalForm, 'Số lượng dòng 1', 'input').value, '2.5000')
    assert.equal(field(originalForm, 'Ghi chú phiếu', 'textarea').value, 'Giữ bản nháp')
    await env.act(async () => reloading.resolve(structuredClone(masters)))
    assert.equal(form(view.container), originalForm)
    assert.equal(field(originalForm, 'Kho của phiếu').value, C)
    await env.act(async () =>
      originalForm.dispatchEvent(
        new env.window.Event('submit', { bubbles: true, cancelable: true }),
      ),
    )
    assert.equal(view.writes.length, 1)
    assert.equal(view.writes[0][0].warehouseId, C)
    assert.equal(view.writes[0][0].note, 'Giữ bản nháp')
    assert.deepEqual(view.writes[0][0].lines, [
      { itemId: 'item-a', quantity: '2.5000', unitCost: '1.2500' },
    ])
    assert.match(view.writes[0][1], /^[0-9a-f-]{36}$/i)
  })
})

test('transfer context seeds only the source warehouse and never the destination or report dates', async () => {
  await withDraftDom(async (env) => {
    const view = await fixture(env, {
      kind: 'transfer',
      initial: href(B, { toWarehouseId: A, start_date: '2020-01-01', date: '2020-01-02' }),
    })
    await env.click(createButton(view.container))
    assert.equal(field(form(view.container), 'Kho chuyển').value, B)
    assert.equal(field(form(view.container), 'Kho nhận').value, '')
    assert.equal(
      field(form(view.container), 'Ngày phiếu', 'input[type="date"]').value,
      new Date().toISOString().slice(0, 10),
    )
    assert.equal(
      pathsWith(view.paths, '/inventory/documents').at(-1).searchParams.has('start_date'),
      false,
    )
  })
})

test('warehouse context preserves write permission, count versions and pending duplicate protection', async () => {
  await withDraftDom(async (env) => {
    const denied = await fixture(env, { initial: href(B), allowed: false })
    assert.equal(createButton(denied.container), undefined)
    assert.equal(denied.container.querySelector('form'), null)
    assert.equal(denied.writes.length, 0)
    await denied.unmount()
    const pending = deferred()
    const view = await fixture(env, {
      kind: 'count',
      initial: href(B),
      write: () => pending.promise,
    })
    await env.click(createButton(view.container))
    await env.input(field(form(view.container), 'Mặt hàng dòng 1'), 'item-a')
    await env.input(field(form(view.container), 'Số lượng thực tế dòng 1', 'input'), '3.0000')
    const submit = () =>
      env.act(async () =>
        form(view.container).dispatchEvent(
          new env.window.Event('submit', { bubbles: true, cancelable: true }),
        ),
      )
    await submit()
    await submit()
    assert.equal(view.writes.length, 1)
    assert.equal(view.writes[0][0].warehouseId, B)
    assert.deepEqual(view.writes[0][0].lines, [
      { itemId: 'item-a', quantity: '3.0000', expectedVersion: 9 },
    ])
    assert.equal(view.container.querySelector('[aria-label="Đóng phiếu kho"]').disabled, true)
    assert.equal(form(view.container).querySelector('fieldset').disabled, true)
    await env.act(async () => pending.resolve({ id: 'doc-a' }))
    assert.equal(form(view.container), null)
    assert.equal(view.writes.length, 1)
  })
})

const confirmation = (env) => env.document.querySelector('.draft-confirmation')
const keepEditing = (env) => env.click(confirmation(env).querySelector('button'))
const discardDraft = (env) =>
  env.click(confirmation(env).querySelector('.draft-confirmation-discard'))
const closeX = (root) => root.querySelector('[aria-label="Đóng phiếu kho"]')
const cancelButton = (root) => form(root).querySelector('.domain-toolbar button[type="button"]')
const escape = (env) =>
  env.act(async () => {
    env.document.dispatchEvent(
      new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
  })
const submitForm = (env, root) =>
  env.act(async () =>
    form(root).dispatchEvent(new env.window.Event('submit', { bubbles: true, cancelable: true })),
  )
const noteField = (root) => field(form(root), 'Ghi chú phiếu', 'textarea')
async function typeNote(env, root, value) {
  const note = noteField(root)
  await env.act(async () => {
    Object.getOwnPropertyDescriptor(env.window.HTMLTextAreaElement.prototype, 'value').set.call(
      note,
      value,
    )
    note.dispatchEvent(new env.window.Event('input', { bubbles: true }))
  })
}
async function fillDraft(env, root) {
  await typeNote(env, root, 'Phiếu chưa lưu')
  await env.input(field(form(root), 'Mặt hàng dòng 1'), 'item-a')
  await env.input(field(form(root), 'Số lượng dòng 1', 'input'), '4')
}
function assertDraftKept(root) {
  assert.ok(form(root))
  assert.equal(noteField(root).value, 'Phiếu chưa lưu')
  assert.equal(field(form(root), 'Mặt hàng dòng 1').value, 'item-a')
  assert.equal(field(form(root), 'Số lượng dòng 1', 'input').value, '4')
}

test('a newly opened document form closes without warning, including after adding and removing a blank line', async () => {
  await withDraftDom(async (env) => {
    const view = await fixture(env, { guarded: true })
    await env.click(createButton(view.container))
    await env.click(closeX(view.container))
    assert.equal(confirmation(env), null)
    assert.equal(form(view.container), null)
    await env.click(createButton(view.container))
    await env.click(
      [...form(view.container).querySelectorAll('button')].find((node) =>
        node.textContent.includes('Thêm mặt hàng'),
      ),
    )
    assert.ok(field(form(view.container), 'Mặt hàng dòng 2'))
    await env.click(form(view.container).querySelector('[aria-label="Xóa dòng 2"]'))
    await escape(env)
    assert.equal(confirmation(env), null)
    assert.equal(form(view.container), null)
    await env.click(createButton(view.container))
    await env.click(cancelButton(view.container))
    assert.equal(form(view.container), null)
    await env.click(createButton(view.container))
    await view.go('/id/elsewhere')
    assert.equal(confirmation(env), null)
    assert.equal(view.router.state.location.pathname, '/id/elsewhere')
  })
})

test('a dirty document form guards X, Escape, Cancel, route and back; Continue keeps everything and Discard is explicit', async () => {
  await withDraftDom(async (env) => {
    const view = await fixture(env, { guarded: true })
    await env.click(createButton(view.container))
    const opened = form(view.container)
    await fillDraft(env, view.container)
    for (const leave of [
      () => env.click(closeX(view.container)),
      () => escape(env),
      () => env.click(cancelButton(view.container)),
      () => view.go('/id/elsewhere'),
      () => view.go(-1),
    ]) {
      await leave()
      assert.ok(confirmation(env))
      await keepEditing(env)
      assert.equal(confirmation(env), null)
      assert.equal(form(view.container), opened)
      assert.equal(view.router.state.location.pathname, '/id/inventory/in')
      assertDraftKept(view.container)
    }
    await env.click(closeX(view.container))
    await discardDraft(env)
    assert.equal(form(view.container), null)
    assert.equal(view.writes.length, 0)
    await env.click(createButton(view.container))
    assert.equal(noteField(view.container).value, '')
    assert.equal(field(form(view.container), 'Mặt hàng dòng 1').value, '')
    await typeNote(env, view.container, 'Rời trang')
    await view.go('/id/elsewhere')
    await discardDraft(env)
    assert.equal(view.router.state.location.pathname, '/id/elsewhere')
  })
})

test('a failed write keeps note, lines and intent guarded; a successful retry closes without warning', async () => {
  await withDraftDom(async (env) => {
    let fail = true
    const view = await fixture(env, {
      guarded: true,
      write: () => {
        if (fail) throw new Error('Không ghi được phiếu')
        return { id: 'doc-a' }
      },
    })
    await env.click(createButton(view.container))
    await fillDraft(env, view.container)
    await submitForm(env, view.container)
    assert.match(
      form(view.container).querySelector('[role="alert"]').textContent,
      /Không ghi được phiếu/,
    )
    await env.click(closeX(view.container))
    assert.ok(confirmation(env))
    await keepEditing(env)
    assertDraftKept(view.container)
    fail = false
    await submitForm(env, view.container)
    assert.equal(view.writes.length, 2)
    assert.equal(
      view.writes[1][1],
      view.writes[0][1],
      'the retry reuses the same idempotency intent',
    )
    assert.equal(view.writes[1][0].note, 'Phiếu chưa lưu')
    assert.equal(form(view.container), null)
    assert.equal(confirmation(env), null)
    await view.go('/id/elsewhere')
    assert.equal(confirmation(env), null)
    assert.equal(view.router.state.location.pathname, '/id/elsewhere')
  })
})

test('a pending write blocks closing, navigation and discard before the busy state renders', async () => {
  await withDraftDom(async (env) => {
    const pending = deferred()
    const view = await fixture(env, { guarded: true, write: () => pending.promise })
    await env.click(createButton(view.container))
    await fillDraft(env, view.container)
    await env.act(async () => {
      form(view.container).dispatchEvent(
        new env.window.Event('submit', { bubbles: true, cancelable: true }),
      )
      env.document.dispatchEvent(
        new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    assert.ok(form(view.container), 'Escape during a write must not close the form')
    await view.go('/id/elsewhere')
    assert.equal(view.router.state.location.pathname, '/id/inventory/in')
    const discard = confirmation(env).querySelector('.draft-confirmation-discard')
    assert.equal(discard.disabled, true)
    await env.click(discard)
    assert.ok(form(view.container))
    await keepEditing(env)
    await env.act(async () => pending.resolve({ id: 'doc-a' }))
    assert.equal(view.writes.length, 1)
    assert.equal(form(view.container), null)
    assert.equal(view.router.state.location.pathname, '/id/inventory/in')
  })
})

test('an invalid typed document date is protected even while the stored date is unchanged', async () => {
  await withDraftDom(async (env) => {
    const view = await fixture(env, { guarded: true })
    await env.click(createButton(view.container))
    const date = field(form(view.container), 'Ngày phiếu', 'input')
    await env.input(date, '31/02/20')
    await env.click(closeX(view.container))
    assert.ok(confirmation(env), 'a partially typed date must not be silently dropped')
    await keepEditing(env)
    assert.ok(form(view.container))
    await env.click(closeX(view.container))
    await discardDraft(env)
    assert.equal(form(view.container), null)
  })
})
