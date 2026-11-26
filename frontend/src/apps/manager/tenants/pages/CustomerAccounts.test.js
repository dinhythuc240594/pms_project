import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

const owner = {
  id: 'account-owner',
  name: 'Nguyễn An',
  email: 'owner@example.test',
  active: true,
  createdAt: '2026-10-01T08:00:00Z',
  memberships: [
    { tenantId: 'hotel-a', tenantName: 'Khách sạn A', role: 'HOTEL_OWNER', active: true },
    { tenantId: 'hotel-b', tenantName: 'Khách sạn B', role: 'FRONT_DESK', active: false },
  ],
}
const hotelA = { id: 'hotel-a', name: 'Khách sạn A', status: 'active' }
const hotelB = { id: 'hotel-b', name: 'Khách sạn B', status: 'active' }
const response = (users = [owner], page = 1, totalItems = users.length) => ({
  users,
  pagination: { page, pageSize: 20, totalItems },
})
const contextFor = (overrides) => ({
  authGeneration: 1,
  user: { id: 'manager-a', globalRole: 'SYSTEM_MANAGER' },
  tenants: [hotelA, hotelB],
  listCustomerAccounts: async () => response(),
  routeAccess: () => ({ allowed: true }),
  getTenantSubscription: async () => ({ subscription: null }),
  listPlans: async () => ({ plans: [] }),
  saveTenant: async () => {},
  ...overrides,
})
const control = (view, label) => view.container.querySelector(`[aria-label="${label}"]`)
const button = (view, text) =>
  [...view.container.querySelectorAll('button')].find(
    (element) => element.textContent.trim() === text,
  )
const flushSearch = (act) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300))
  })

async function modules(load) {
  const { default: CustomerAccounts } = await load(
    '/src/apps/manager/tenants/pages/CustomerAccounts.jsx',
  )
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const { setLocale } = await load('/src/shared/i18n/store.js')
  setLocale('vi')
  return { CustomerAccounts, PmsContext }
}

test('customer accounts pair each hotel with its role and retain inactive users and revoked memberships', async () => {
  await withDraftDom(async ({ React, document, load, mount, click }) => {
    const { CustomerAccounts, PmsContext } = await modules(load)
    const inactive = {
      id: 'account-inactive',
      name: 'Trần Bình',
      email: 'inactive@example.test',
      active: false,
      createdAt: null,
      memberships: [],
    }
    const requests = []
    const value = contextFor({
      listCustomerAccounts: async (filters) => {
        requests.push(filters)
        return response([owner, inactive])
      },
    })
    const view = await mount(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(PmsContext.Provider, { value }, React.createElement(CustomerAccounts)),
      ),
    )
    const table = control(view, 'Danh sách tài khoản khách hàng')
    assert.ok(table)
    const rows = [...table.querySelectorAll('tbody tr')]
    assert.equal(rows.length, 2)
    const ownerRow = rows.find((row) => row.textContent.includes(owner.email))
    assert.match(ownerRow.textContent, /Nguyễn An/)
    await click(accountDetailsButton(view, owner.email))
    const ownerDialog = document.querySelector('[role="dialog"]')
    assert.ok(ownerDialog)
    const memberships = [...ownerDialog.querySelectorAll('li')]
    assert.equal(memberships.length, 2)
    assert.match(memberships[0].textContent, /Khách sạn A/)
    assert.match(memberships[0].textContent, /Chủ khách sạn/)
    assert.doesNotMatch(memberships[0].textContent, /Đã thu hồi quyền/)
    assert.match(memberships[1].textContent, /Khách sạn B/)
    assert.match(memberships[1].textContent, /Lễ tân/)
    assert.match(memberships[1].textContent, /Đã thu hồi quyền/)
    await click(ownerDialog.querySelector('[aria-label="Đóng cửa sổ"]'))
    const inactiveRow = rows.find((row) => row.textContent.includes(inactive.email))
    assert.match(
      inactiveRow.textContent,
      /Vô hiệu hóa|Đã vô hiệu hóa|Tạm khóa|Đã khóa|Ngừng hoạt động/,
    )
    await click(accountDetailsButton(view, inactive.email))
    assert.match(document.querySelector('[role="dialog"]').textContent, /Chưa được gán khách sạn/)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].page, 1)
    assert.equal(requests[0].pageSize, 20)
    assert.equal(view.container.querySelector('input[type="password"]'), null)
  })
})

test('customer account paging resets for search, hotel, role and account status filters', async () => {
  await withDraftDom(async ({ React, act, load, mount, click, input }) => {
    const { CustomerAccounts, PmsContext } = await modules(load)
    const requests = []
    const value = contextFor({
      listCustomerAccounts: async (filters) => {
        requests.push(filters)
        return response([owner], filters.page, 41)
      },
    })
    const view = await mount(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(PmsContext.Provider, { value }, React.createElement(CustomerAccounts)),
      ),
    )
    const last = () => requests.at(-1)
    await click(button(view, 'Trang sau'))
    assert.equal(last().page, 2)
    await input(control(view, 'Vai trò'), 'FRONT_DESK')
    assert.equal(last().role, 'FRONT_DESK')
    assert.equal(last().page, 1)
    await input(control(view, 'Vai trò'), '')
    assert.equal(
      last().page,
      1,
      'clearing a filter must not restore an earlier page for the original filter set',
    )
    await input(control(view, 'Vai trò'), 'FRONT_DESK')
    await click(button(view, 'Trang sau'))
    assert.equal(last().page, 2)
    await input(control(view, 'Khách sạn'), 'hotel-b')
    assert.equal(last().tenantId, 'hotel-b')
    assert.equal(last().page, 1)
    await click(button(view, 'Trang sau'))
    await input(control(view, 'Trạng thái tài khoản'), 'false')
    assert.equal(String(last().active), 'false')
    assert.equal(last().page, 1)
    await click(button(view, 'Trang sau'))
    const beforeSearch = requests.length
    await input(control(view, 'Tìm tài khoản khách hàng'), '  Nguyễn')
    await input(control(view, 'Tìm tài khoản khách hàng'), '  Nguyễn An  ')
    await flushSearch(act)
    assert.equal(
      requests.length,
      beforeSearch + 1,
      'typing coalesces into one search after the debounce',
    )
    assert.equal(last().search, 'Nguyễn An')
    assert.equal(last().page, 1)
    assert.equal(last().role, 'FRONT_DESK')
    assert.equal(last().tenantId, 'hotel-b')
    assert.equal(String(last().active), 'false')
    await click(button(view, 'Trang trước'))
    assert.equal(last().page, 1, 'the previous page button is disabled at the first page')
  })
})

test('customer account reads discard stale responses and retry failed reads with the same filters', async () => {
  await withDraftDom(async ({ React, act, load, mount, click, input }) => {
    const { CustomerAccounts, PmsContext } = await modules(load)
    const old = Promise.withResolvers(),
      requests = []
    let failNext = true
    const value = contextFor({
      listCustomerAccounts: (filters) => {
        requests.push(filters)
        if (!filters.search) return old.promise
        if (filters.search === 'error' && failNext) {
          failNext = false
          return Promise.reject(new Error('Không tải được tài khoản QA.'))
        }
        return Promise.resolve(response([{ ...owner, name: 'Kết quả mới' }]))
      },
    })
    const view = await mount(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(PmsContext.Provider, { value }, React.createElement(CustomerAccounts)),
      ),
    )
    await input(control(view, 'Tìm tài khoản khách hàng'), 'new')
    await flushSearch(act)
    assert.match(view.container.textContent, /Kết quả mới/)
    await act(async () =>
      old.resolve(response([{ ...owner, name: 'TÀI KHOẢN CŨ KHÔNG ĐƯỢC HIỆN' }])),
    )
    assert.doesNotMatch(view.container.textContent, /TÀI KHOẢN CŨ KHÔNG ĐƯỢC HIỆN/)
    assert.match(view.container.textContent, /Kết quả mới/)
    await input(control(view, 'Tìm tài khoản khách hàng'), 'error')
    await flushSearch(act)
    assert.match(
      view.container.querySelector('[role="alert"]').textContent,
      /Không tải được tài khoản QA/,
    )
    const failed = requests.at(-1)
    await click(button(view, 'Thử lại'))
    assert.deepEqual(requests.at(-1), failed)
    assert.equal(view.container.querySelector('[role="alert"]'), null)
    assert.match(view.container.textContent, /Kết quả mới/)
  })
})

test('changing and clearing the manager header search resets paging without reviving an earlier page', async () => {
  await withDraftDom(async ({ React, act, load, mount, click }) => {
    const { CustomerAccounts, PmsContext } = await modules(load)
    const requests = []
    const value = contextFor({
      listCustomerAccounts: async (filters) => {
        requests.push(filters)
        return response([owner], filters.page, 41)
      },
    })
    let changeHeaderSearch
    function HeaderSearchHost() {
      const [searchQuery, setSearchQuery] = React.useState('')
      React.useEffect(() => {
        changeHeaderSearch = setSearchQuery
      }, [])
      return React.createElement(Outlet, { context: { searchQuery } })
    }
    const view = await mount(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/manager/tenants'] },
        React.createElement(
          Routes,
          null,
          React.createElement(
            Route,
            { element: React.createElement(HeaderSearchHost) },
            React.createElement(Route, {
              path: '/manager/tenants',
              element: React.createElement(
                PmsContext.Provider,
                { value },
                React.createElement(CustomerAccounts),
              ),
            }),
          ),
        ),
      ),
    )
    await click(button(view, 'Trang sau'))
    assert.equal(requests.at(-1).page, 2)
    await act(async () => changeHeaderSearch('Nguyễn'))
    await flushSearch(act)
    assert.equal(requests.at(-1).search, 'Nguyễn')
    assert.equal(requests.at(-1).page, 1)
    await act(async () => changeHeaderSearch(''))
    await flushSearch(act)
    assert.equal(
      requests.at(-1).page,
      1,
      'clearing the header search must not restore the original page 2',
    )
    assert.deepEqual(
      requests.map(({ search, page }) => ({ search, page })),
      [
        { search: '', page: 1 },
        { search: '', page: 2 },
        { search: 'Nguyễn', page: 1 },
        { search: '', page: 1 },
      ],
    )
  })
})

test('customer tab loads accounts on demand, preserves hotel filters and resets its scope after a session change', async () => {
  await withDraftDom(async ({ React, act, load, mount, click, input }) => {
    const { PmsContext } = await modules(load)
    const { default: AdminTenants } = await load('/src/apps/manager/tenants/pages/AdminTenants.jsx')
    const requests = [],
      old = Promise.withResolvers()
    let nextSession
    function Host() {
      const [authGeneration, setAuthGeneration] = React.useState(1)
      React.useEffect(() => {
        nextSession = () => setAuthGeneration(2)
      }, [])
      const listCustomerAccounts = React.useCallback(
        (filters) => {
          requests.push({ authGeneration, ...filters })
          return authGeneration === 1
            ? old.promise
            : Promise.resolve(response([{ ...owner, name: 'Tài khoản phiên mới' }]))
        },
        [authGeneration],
      )
      const value = React.useMemo(
        () => contextFor({ authGeneration, listCustomerAccounts }),
        [authGeneration, listCustomerAccounts],
      )
      return React.createElement(PmsContext.Provider, { value }, React.createElement(AdminTenants))
    }
    const view = await mount(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/manager/tenants'] },
        React.createElement(Host),
      ),
    )
    const tab = (label) =>
      [...view.container.querySelectorAll('[role="tab"]')].find(
        (element) => element.textContent.trim() === label,
      )
    assert.ok(tab('Khách sạn'))
    assert.ok(tab('Khách hàng'))
    assert.equal(tab('Khách sạn').getAttribute('aria-selected'), 'true')
    assert.equal(requests.length, 0)
    const hotelSearch = view.container.querySelector('input[type="search"]')
    await input(hotelSearch, 'Khách sạn B')
    assert.equal(view.container.querySelectorAll('.customer-table tbody tr').length, 1)
    await click(tab('Khách hàng'))
    assert.equal(requests.length, 1)
    assert.equal(tab('Khách hàng').getAttribute('aria-selected'), 'true')
    assert.equal(hotelSearch.closest('[role="tabpanel"]').hidden, true)
    await click(tab('Khách sạn'))
    assert.equal(hotelSearch.value, 'Khách sạn B')
    assert.equal(hotelSearch.closest('[role="tabpanel"]').hidden, false)
    assert.equal(view.container.querySelectorAll('.customer-table tbody tr').length, 1)
    await click(tab('Khách hàng'))
    await act(async () => nextSession())
    assert.match(view.container.textContent, /Tài khoản phiên mới/)
    await act(async () => old.resolve(response([{ ...owner, name: 'PHIÊN CŨ KHÔNG ĐƯỢC HIỆN' }])))
    assert.doesNotMatch(view.container.textContent, /PHIÊN CŨ KHÔNG ĐƯỢC HIỆN/)
    assert.match(view.container.textContent, /Tài khoản phiên mới/)
  })
})

test('hotel user management opens the matching account directory and clears the hotel header search', async () => {
  await withDraftDom(async ({ React, load, mount, click }) => {
    const { PmsContext } = await modules(load)
    const { default: AdminTenants } = await load('/src/apps/manager/tenants/pages/AdminTenants.jsx')
    const specialHotel = { ...hotelA, id: 'hotel/a & b', name: 'Khách sạn / A & B' }
    const requests = []
    const value = contextFor({
      tenants: [specialHotel, hotelB],
      listCustomerAccounts: async (filters) => {
        requests.push(filters)
        return response()
      },
    })
    let location, headerSearch
    function HeaderSearchHost() {
      const [searchQuery, setSearchQuery] = React.useState(specialHotel.name)
      const currentLocation = useLocation()
      React.useEffect(() => {
        location = currentLocation
        headerSearch = searchQuery
      }, [currentLocation, searchQuery])
      return React.createElement(Outlet, { context: { searchQuery, setSearchQuery } })
    }
    const view = await mount(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/manager/tenants?keep=1'] },
        React.createElement(
          Routes,
          null,
          React.createElement(
            Route,
            { element: React.createElement(HeaderSearchHost) },
            React.createElement(Route, {
              path: '/manager/tenants',
              element: React.createElement(
                PmsContext.Provider,
                { value },
                React.createElement(AdminTenants),
              ),
            }),
          ),
        ),
      ),
    )
    assert.equal(requests.length, 0)
    const hotelRow = [...view.container.querySelectorAll('.customer-table tbody tr')].find((row) =>
      row.textContent.includes(specialHotel.name),
    )
    assert.ok(hotelRow)
    const manage = [...hotelRow.querySelectorAll('a,button')].find(
      (element) => element.textContent.trim() === 'Quản lý người dùng',
    )
    assert.ok(manage)
    assert.match(manage.getAttribute('aria-label') || '', /Khách sạn \/ A & B/)
    await click(manage)
    assert.equal(headerSearch, '')
    assert.equal(control(view, 'Khách sạn').value, specialHotel.id)
    assert.equal(requests.at(-1).tenantId, specialHotel.id)
    assert.equal(requests.at(-1).search, '')
    const params = new URLSearchParams(location.search)
    assert.equal(params.get('tab'), 'customers')
    assert.equal(params.get('tenantId'), specialHotel.id)
    assert.equal(params.get('keep'), '1')
    const customerTab = [...view.container.querySelectorAll('[role="tab"]')].find(
      (element) => element.textContent === 'Khách hàng',
    )
    assert.equal(customerTab.getAttribute('aria-selected'), 'true')
  })
})

test('the hotel account filter follows direct links, manual changes and browser history', async () => {
  await withDraftDom(async ({ React, act, load, mount, input }) => {
    const { CustomerAccounts, PmsContext } = await modules(load)
    const requests = []
    const value = contextFor({
      listCustomerAccounts: async (filters) => {
        requests.push(filters)
        return response()
      },
    })
    let location, navigate
    function NavigationProbe() {
      const currentLocation = useLocation(),
        currentNavigate = useNavigate()
      React.useEffect(() => {
        location = currentLocation
        navigate = currentNavigate
      }, [currentLocation, currentNavigate])
      return null
    }
    const view = await mount(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/manager/tenants?tab=customers&tenantId=hotel-b&keep=1'] },
        React.createElement(NavigationProbe),
        React.createElement(PmsContext.Provider, { value }, React.createElement(CustomerAccounts)),
      ),
    )
    assert.equal(control(view, 'Khách sạn').value, hotelB.id)
    assert.equal(requests.at(-1).tenantId, hotelB.id)
    await input(control(view, 'Khách sạn'), hotelA.id)
    assert.equal(new URLSearchParams(location.search).get('tenantId'), hotelA.id)
    assert.equal(new URLSearchParams(location.search).get('keep'), '1')
    assert.equal(requests.at(-1).tenantId, hotelA.id)
    await act(async () => navigate(-1))
    assert.equal(control(view, 'Khách sạn').value, hotelB.id)
    assert.equal(requests.at(-1).tenantId, hotelB.id)
    await act(async () => navigate(1))
    assert.equal(control(view, 'Khách sạn').value, hotelA.id)
    assert.equal(requests.at(-1).tenantId, hotelA.id)
    await input(control(view, 'Khách sạn'), '')
    const cleared = new URLSearchParams(location.search)
    assert.equal(cleared.has('tenantId'), false)
    assert.equal(cleared.get('keep'), '1')
    assert.equal(cleared.get('tab'), 'customers')
    assert.equal(requests.at(-1).tenantId, '')
    assert.equal(requests.at(-1).page, 1)
  })
})

const accountDetailsButton = (view, email) => {
  const row = [...view.container.querySelectorAll('.customer-directory-table tbody tr')].find(
    (element) => element.textContent.includes(email),
  )
  return [...(row?.querySelectorAll('button') || [])].find(
    (element) => element.textContent.trim() === 'Xem chi tiết',
  )
}

test('account details show the complete read-only identity and hotel roles, including revoked access', async () => {
  await withDraftDom(async ({ React, act, window, document, load, mount, click }) => {
    const { CustomerAccounts, PmsContext } = await modules(load)
    const inactive = {
      id: 'inactive-account',
      name: 'Trần Bình',
      email: 'inactive@example.test',
      active: false,
      createdAt: null,
      memberships: [],
    }
    let reads = 0
    const value = contextFor({
      listCustomerAccounts: async () => {
        reads += 1
        return response([owner, inactive])
      },
    })
    const view = await mount(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(PmsContext.Provider, { value }, React.createElement(CustomerAccounts)),
      ),
    )
    const trigger = accountDetailsButton(view, owner.email)
    assert.ok(trigger)
    assert.equal(trigger.closest('td').getAttribute('data-label'), 'Khách sạn & vai trò')
    trigger.focus()
    await click(trigger)
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.equal(dialog.getAttribute('aria-label'), 'Chi tiết tài khoản')
    for (const expected of [owner.name, owner.email, owner.id, '01/10/2026'])
      assert.ok(dialog.textContent.includes(expected), expected)
    const memberships = [...dialog.querySelectorAll('.customer-account-detail-memberships li')]
    assert.equal(memberships.length, 2)
    assert.match(memberships[0].textContent, /Khách sạn A/)
    assert.match(memberships[0].textContent, /Chủ khách sạn/)
    assert.doesNotMatch(memberships[0].textContent, /Đã thu hồi quyền/)
    assert.match(memberships[1].textContent, /Khách sạn B/)
    assert.match(memberships[1].textContent, /Lễ tân/)
    assert.match(memberships[1].textContent, /Đã thu hồi quyền/)
    assert.equal(dialog.querySelector('form, input[type="password"]'), null)
    assert.equal(reads, 1, 'opening read-only details uses the already loaded safe account fields')
    await click(dialog.querySelector('[aria-label="Đóng cửa sổ"]'))
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.equal(document.activeElement, trigger)
    await click(accountDetailsButton(view, inactive.email))
    const inactiveDialog = document.querySelector('[role="dialog"]')
    assert.match(inactiveDialog.textContent, /Trần Bình/)
    assert.match(inactiveDialog.textContent, /Ngừng hoạt động/)
    assert.match(inactiveDialog.textContent, /Chưa được gán khách sạn/)
    await act(async () =>
      document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    )
    assert.equal(document.querySelector('[role="dialog"]'), null)
  })
})

test('account detail dialogs close when filters, refreshed results or the session scope change', async () => {
  await withDraftDom(async ({ React, act, document, load, mount, click, input }) => {
    const { CustomerAccounts, PmsContext } = await modules(load)
    let nextSession
    function Host() {
      const [authGeneration, setAuthGeneration] = React.useState(1)
      React.useEffect(() => {
        nextSession = () => setAuthGeneration((value) => value + 1)
      }, [])
      const listCustomerAccounts = React.useCallback(async () => response(), [])
      const value = React.useMemo(
        () => contextFor({ authGeneration, listCustomerAccounts }),
        [authGeneration, listCustomerAccounts],
      )
      return React.createElement(
        PmsContext.Provider,
        { value },
        React.createElement(CustomerAccounts),
      )
    }
    const view = await mount(React.createElement(MemoryRouter, null, React.createElement(Host)))
    const open = async () => {
      await click(accountDetailsButton(view, owner.email))
      assert.ok(document.querySelector('[role="dialog"]'))
    }
    await open()
    await input(control(view, 'Vai trò'), 'FRONT_DESK')
    assert.equal(document.querySelector('[role="dialog"]'), null)
    await input(control(view, 'Vai trò'), '')
    assert.equal(
      document.querySelector('[role="dialog"]'),
      null,
      'returning to an earlier filter must not reopen its old account dialog',
    )
    await open()
    await click(button(view, 'Tải lại tài khoản'))
    assert.equal(document.querySelector('[role="dialog"]'), null)
    await open()
    await act(async () => nextSession())
    assert.equal(document.querySelector('[role="dialog"]'), null)
  })
})
