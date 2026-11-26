import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

test('hotel owners can grant an existing customer account a scoped role without its password', async () => {
  await withDraftDom(async ({ React, act, load, mount, click, input, window }) => {
    const previousFetch = globalThis.fetch
    const session = {
      csrfToken: 'csrf',
      user: {
        id: 'owner',
        globalRole: 'USER',
        memberships: [{ tenantId: 'hotel-a', role: 'HOTEL_OWNER', active: true }],
      },
      tenants: [{ id: 'hotel-a', status: 'active' }],
    }
    const grants = []
    globalThis.fetch = async (url, options) => {
      if (url === '/api/auth/session') return Response.json(session)
      if (url === '/api/tenants/hotel-a/workspace')
        return Response.json({ tenant: session.tenants[0] })
      if (url === '/api/tenants/hotel-a/users' && options.method === 'POST') {
        grants.push(JSON.parse(options.body))
        return Response.json({ id: 'existing-account' })
      }
      throw new Error('Unexpected request: ' + url)
    }
    try {
      const { PmsProvider } = await load('/src/apps/pms/data/PmsProvider.jsx')
      const { usePms } = await load('/src/apps/pms/data/usePms.js')
      const { default: UserManagement } = await load(
        '/src/apps/pms/user-management/pages/UserManagement.jsx',
      )
      const { DraftGuardProvider } = await load('/src/shared/drafts/DraftGuardProvider.jsx')
      function Page() {
        const pms = usePms()
        return pms.loading || pms.workspaceLoading ? null : React.createElement(UserManagement)
      }
      const view = await mount(
        React.createElement(
          DraftGuardProvider,
          null,
          React.createElement(PmsProvider, null, React.createElement(Page)),
        ),
      )
      for (const email of ['staff@example.test', 'other-owner@example.test']) {
        await click(
          [...view.container.querySelectorAll('button')].find((button) =>
            button.textContent.includes('Thêm mới tài khoản'),
          ),
        )
        const dialog = view.container.querySelector('dialog')
        await click(dialog.querySelector('input[type="checkbox"]'))
        assert.equal(dialog.querySelector('#user-password'), null)
        assert.equal(dialog.querySelector('#user-name'), null)
        await input(dialog.querySelector('#user-email'), email)
        await input(dialog.querySelector('select'), 'HOUSEKEEPING')
        await act(async () => {
          dialog
            .querySelector('form')
            .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
        })
        assert.deepEqual(grants.at(-1), { email, role: 'HOUSEKEEPING', active: true })
        assert.equal(view.container.querySelector('dialog'), null)
      }
      assert.equal(grants.length, 2)
    } finally {
      globalThis.fetch = previousFetch
    }
  })
})

function owner(tenantId = 'hotel-a') {
  return {
    id: 'owner',
    globalRole: 'USER',
    active: true,
    memberships: [{ tenantId, role: 'HOTEL_OWNER', active: true }],
  }
}

function accounts(tenantId = 'hotel-a') {
  return [
    { ...owner(tenantId), name: 'Hotel owner', email: 'owner@example.test' },
    {
      id: 'staff',
      name: 'Reception account',
      email: 'staff@example.test',
      globalRole: 'USER',
      active: true,
      memberships: [{ tenantId, role: 'FRONT_DESK', active: true }],
    },
  ]
}

function deferred() {
  let resolve, reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function withUsersDom(callback) {
  await withDraftDom(async (dom) => {
    const { React, act, load, mount } = dom
    const { default: UserManagement } = await load(
      '/src/apps/pms/user-management/pages/UserManagement.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { getLocale, setLocale, t } = await load('/src/shared/i18n/store.js')
    const previousLocale = getLocale()
    setLocale('vi')
    async function setup(overrides = {}) {
      const saves = []
      const initial = {
        tenantId: 'hotel-a',
        tenant: { id: 'hotel-a', name: 'Hotel A', status: 'active' },
        user: owner(),
        users: accounts(),
        authGeneration: 1,
        access: () => ({ allowed: true }),
        requestTenant: async (path) => {
          throw new Error(`Unexpected read: ${path}`)
        },
        saveTenantUser: async (value) => {
          saves.push(structuredClone(value))
          return { id: value.id || 'created' }
        },
        ...overrides,
      }
      let update
      function Host() {
        const [value, setValue] = React.useState(initial)
        React.useEffect(() => {
          update = (patch) => setValue((current) => ({ ...current, ...patch }))
        }, [])
        return React.createElement(
          PmsContext.Provider,
          { value },
          React.createElement(UserManagement),
        )
      }
      const view = await mount(React.createElement(Host))
      return {
        ...view,
        saves,
        update: async (patch) => {
          await act(async () => update(patch))
        },
        button: (label) =>
          [...view.container.querySelectorAll('button')].find(
            (element) =>
              (element.getAttribute('aria-label') || element.textContent.trim()) === label,
          ),
        row: (email) =>
          [...view.container.querySelectorAll('tbody tr')].find((element) =>
            element.textContent.includes(email),
          ),
        add: () =>
          [...view.container.querySelectorAll('button')].find((element) =>
            element.textContent.includes(t('users.addAccount')),
          ),
        dialog: () => view.container.querySelector('dialog'),
      }
    }
    const submit = async (dialog) => {
      await act(async () =>
        dialog
          .querySelector('form')
          .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
      )
    }
    try {
      await callback({ ...dom, setup, submit, t })
    } finally {
      setLocale(previousLocale)
    }
  })
}

test('account permissions have one action and protect the current hotel owner', async () => {
  await withUsersDom(async ({ setup, click, input, submit }) => {
    const view = await setup()
    const self = view.row('owner@example.test')
    assert.ok(self)
    assert.match(self.textContent, /Bạn/)
    assert.equal(self.querySelector('button:not([disabled])'), null)
    assert.equal(view.button('Phân quyền owner@example.test'), undefined)
    assert.equal(view.button('Kích hoạt owner@example.test'), undefined)
    assert.doesNotMatch(view.container.textContent, /IP Access|Hotel Access|Tùy chọn/)
    assert.equal(
      view
        .row('staff@example.test')
        .querySelectorAll('button[aria-label="Phân quyền staff@example.test"]').length,
      1,
    )
    await click(view.button('Phân quyền staff@example.test'))
    const dialog = view.dialog()
    for (const id of ['user-name', 'user-email', 'user-password', 'user-confirm-password'])
      assert.equal(dialog.querySelector(`#${id}`), null)
    const role = dialog.querySelector('select[aria-label="Vai trò người dùng"]')
    assert.equal(role.value, 'FRONT_DESK')
    assert.deepEqual([...role.options].map((option) => option.value).sort(), [
      'ACCOUNTANT',
      'FRONT_DESK',
      'HOTEL_OWNER',
      'HOUSEKEEPING',
    ])
    await input(role, 'HOUSEKEEPING')
    await click(dialog.querySelector('input[type="checkbox"]'))
    await submit(dialog)
    assert.equal(view.saves.length, 1)
    assert.equal(view.saves[0].id, 'staff')
    assert.equal(view.saves[0].role, 'HOUSEKEEPING')
    assert.equal(view.saves[0].active, false)
    assert.equal(view.dialog(), null)
  })
})

test('only an active ordinary owner of the selected hotel can change accounts', async (context) => {
  await withUsersDom(async ({ setup, click }) => {
    const cases = [
      [
        'current-hotel staff with an owner role elsewhere',
        {
          ...owner('hotel-b'),
          memberships: [
            ...owner('hotel-b').memberships,
            { tenantId: 'hotel-a', role: 'FRONT_DESK', active: true },
          ],
        },
      ],
      [
        'missing current-hotel membership with a legacy owner fallback',
        { ...owner('hotel-b'), role: 'HOTEL_OWNER' },
      ],
      [
        'inactive current-hotel owner membership',
        { ...owner(), memberships: [{ tenantId: 'hotel-a', role: 'HOTEL_OWNER', active: false }] },
      ],
      [
        'owner membership without an explicit active grant',
        { ...owner(), memberships: [{ tenantId: 'hotel-a', role: 'HOTEL_OWNER' }] },
      ],
      ['inactive actor', { ...owner(), active: false }],
      [
        'system administrator with a scoped owner membership',
        { ...owner(), globalRole: 'SUPER_ADMIN' },
      ],
      [
        'system manager with a scoped owner membership',
        { ...owner(), globalRole: 'SYSTEM_MANAGER' },
      ],
    ]
    for (const [name, user] of cases)
      await context.test(name, async () => {
        const view = await setup({ user })
        try {
          assert.equal(view.row('staff@example.test'), undefined)
          assert.ok(!view.add() || view.add().disabled)
          assert.ok(
            !view.button('Phân quyền staff@example.test') ||
              view.button('Phân quyền staff@example.test').disabled,
          )
          assert.ok(
            !view.button('Kích hoạt staff@example.test') ||
              view.button('Kích hoạt staff@example.test').disabled,
          )
          if (view.add()) await click(view.add())
          assert.equal(view.dialog(), null)
          assert.equal(view.saves.length, 0)
        } finally {
          await view.unmount()
        }
      })
    await context.test('access policy can deny an otherwise valid owner', async () => {
      const view = await setup({ access: (action) => ({ allowed: action !== 'users.write' }) })
      try {
        assert.ok(!view.add() || view.add().disabled)
        assert.ok(
          !view.button('Phân quyền staff@example.test') ||
            view.button('Phân quyền staff@example.test').disabled,
        )
        assert.equal(view.saves.length, 0)
      } finally {
        await view.unmount()
      }
    })
  })
})

test('a pending permission save cannot repeat and an API failure preserves the draft for retry', async () => {
  await withUsersDom(async ({ setup, click, input, submit, act, window }) => {
    const pending = deferred(),
      saves = []
    const view = await setup({
      saveTenantUser: async (value) => {
        saves.push(structuredClone(value))
        if (saves.length === 1) return pending.promise
        return { id: value.id }
      },
    })
    await click(view.button('Phân quyền staff@example.test'))
    const dialog = view.dialog()
    await input(dialog.querySelector('select[aria-label="Vai trò người dùng"]'), 'ACCOUNTANT')
    await act(async () => {
      for (let index = 0; index < 2; index++)
        dialog
          .querySelector('form')
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    })
    assert.equal(saves.length, 1)
    assert.equal(dialog.getAttribute('aria-busy'), 'true')
    assert.ok(dialog.querySelector('fieldset').disabled)
    assert.ok(dialog.querySelector('button[type="submit"]').disabled)
    await act(async () => {
      pending.reject(new Error('Permission service is temporarily unavailable'))
      await pending.promise.catch(() => {})
    })
    assert.equal(view.dialog(), dialog)
    assert.equal(
      dialog.querySelector('select[aria-label="Vai trò người dùng"]').value,
      'ACCOUNTANT',
    )
    assert.match(
      dialog.querySelector('[role="alert"]').textContent,
      /Permission service is temporarily unavailable/,
    )
    await submit(dialog)
    assert.equal(saves.length, 2)
    assert.deepEqual(saves[1], saves[0])
    assert.equal(view.dialog(), null)
    assert.ok(view.container.querySelector('[role="status"]'))
  })
})

test('an owner cannot use the existing-account grant form to change their own permissions', async () => {
  await withUsersDom(async ({ setup, click, input, submit, t }) => {
    const view = await setup({ user: { ...owner(), email: 'owner@example.test' } })
    await click(view.add())
    const dialog = view.dialog()
    await click(dialog.querySelector('input[type="checkbox"]'))
    await input(dialog.querySelector('#user-email'), 'OWNER@EXAMPLE.TEST')
    await input(dialog.querySelector('select[aria-label="Vai trò người dùng"]'), 'ACCOUNTANT')
    await submit(dialog)
    assert.equal(view.saves.length, 0)
    assert.equal(view.dialog(), dialog)
    assert.equal(dialog.querySelector('[role="alert"]').textContent, t('users.selfLocked'))
  })
})

test('late saves cannot close an editor or show success after the hotel or authenticated session changes', async (context) => {
  await withUsersDom(async ({ setup, click, input, submit, act }) => {
    for (const change of ['hotel', 'authentication'])
      await context.test(change, async () => {
        const pending = deferred()
        const view = await setup({ saveTenantUser: () => pending.promise })
        try {
          await click(view.button('Phân quyền staff@example.test'))
          await input(
            view.dialog().querySelector('select[aria-label="Vai trò người dùng"]'),
            'HOUSEKEEPING',
          )
          await submit(view.dialog())
          await view.update(
            change === 'hotel'
              ? {
                  tenantId: 'hotel-b',
                  tenant: { id: 'hotel-b', name: 'Hotel B', status: 'active' },
                  user: owner('hotel-b'),
                  users: accounts('hotel-b'),
                }
              : { authGeneration: 2 },
          )
          assert.equal(view.dialog(), null)
          await click(view.button('Phân quyền staff@example.test'))
          const newDialog = view.dialog()
          await input(
            newDialog.querySelector('select[aria-label="Vai trò người dùng"]'),
            'ACCOUNTANT',
          )
          await act(async () => {
            pending.resolve({ id: 'staff' })
            await pending.promise
          })
          assert.equal(view.dialog(), newDialog)
          assert.equal(
            newDialog.querySelector('select[aria-label="Vai trò người dùng"]').value,
            'ACCOUNTANT',
          )
          assert.equal(view.container.querySelector('[role="status"]'), null)
        } finally {
          await view.unmount()
        }
      })
  })
})

test('losing hotel-owner authority closes an open editor and discards its draft', async (context) => {
  await withUsersDom(async ({ setup, click, input }) => {
    const cases = [
      [
        'membership role revoked',
        {
          user: {
            ...owner(),
            memberships: [{ tenantId: 'hotel-a', role: 'FRONT_DESK', active: true }],
          },
        },
      ],
      [
        'membership deactivated',
        {
          user: {
            ...owner(),
            memberships: [{ tenantId: 'hotel-a', role: 'HOTEL_OWNER', active: false }],
          },
        },
      ],
      ['actor promoted to a system account', { user: { ...owner(), globalRole: 'SUPER_ADMIN' } }],
      ['write policy revoked', { access: (action) => ({ allowed: action !== 'users.write' }) }],
    ]
    for (const [name, patch] of cases)
      await context.test(name, async () => {
        const view = await setup()
        try {
          await click(view.button('Phân quyền staff@example.test'))
          await input(
            view.dialog().querySelector('select[aria-label="Vai trò người dùng"]'),
            'HOUSEKEEPING',
          )
          await view.update(patch)
          assert.equal(view.dialog(), null)
          assert.ok(
            !view.button('Phân quyền staff@example.test') ||
              view.button('Phân quyền staff@example.test').disabled,
          )
          assert.equal(view.saves.length, 0)
          await view.update({ user: owner(), access: () => ({ allowed: true }) })
          await click(view.button('Phân quyền staff@example.test'))
          assert.equal(
            view.dialog().querySelector('select[aria-label="Vai trò người dùng"]').value,
            'FRONT_DESK',
          )
        } finally {
          await view.unmount()
        }
      })
  })
})

test('creating a new hotel account keeps validation and sends normalized account details', async () => {
  await withUsersDom(async ({ setup, click, input, submit }) => {
    const view = await setup()
    await click(view.add())
    const dialog = view.dialog()
    await input(dialog.querySelector('#user-name'), '  New receptionist  ')
    await input(dialog.querySelector('#user-email'), 'New.Reception@Example.test')
    await input(dialog.querySelector('#user-password'), 'strong-pass-123')
    await input(dialog.querySelector('#user-confirm-password'), 'different-pass-123')
    await submit(dialog)
    assert.equal(view.saves.length, 0)
    assert.ok(dialog.querySelector('[role="alert"]'))
    assert.equal(dialog.querySelector('#user-name').value, '  New receptionist  ')
    await input(dialog.querySelector('#user-confirm-password'), 'strong-pass-123')
    await input(dialog.querySelector('select[aria-label="Vai trò người dùng"]'), 'FRONT_DESK')
    await submit(dialog)
    assert.equal(view.saves.length, 1)
    assert.equal(view.saves[0].name, 'New receptionist')
    assert.equal(view.saves[0].email, 'new.reception@example.test')
    assert.equal(view.saves[0].password, 'strong-pass-123')
    assert.equal(view.saves[0].role, 'FRONT_DESK')
    assert.equal(view.dialog(), null)
  })
})

test('a reserved Loha email keeps the draft and shows the server error in both account modes', async () => {
  await withUsersDom(async ({ setup, click, input, submit }) => {
    const message = 'Email đã được sử dụng. Vui lòng dùng email khác để thêm nhân viên.'
    for (const existingAccount of [false, true]) {
      const view = await setup({
        saveTenantUser: async () => {
          throw new Error(message)
        },
      })
      try {
        await click(view.add())
        const dialog = view.dialog()
        if (existingAccount) await click(dialog.querySelector('input[type="checkbox"]'))
        else {
          await input(dialog.querySelector('#user-name'), 'Receptionist')
          await input(dialog.querySelector('#user-password'), 'strong-pass-123')
          await input(dialog.querySelector('#user-confirm-password'), 'strong-pass-123')
        }
        await input(dialog.querySelector('#user-email'), 'manager@example.test')
        await submit(dialog)
        assert.equal(view.dialog(), dialog)
        assert.equal(dialog.querySelector('[role="alert"]').textContent, message)
        assert.equal(dialog.querySelector('#user-email').value, 'manager@example.test')
        assert.equal(view.container.querySelector('[role="status"]'), null)
        assert.equal(dialog.querySelector('button[type="submit"]').disabled, false)
      } finally {
        await view.unmount()
      }
    }
  })
})
