import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

const user = {
  id: 'manager-a',
  name: 'Nguyễn Minh An',
  email: 'manager@example.test',
  globalRole: 'SYSTEM_MANAGER',
}
const currentSession = {
  current: true,
  createdAt: '2026-10-30T01:00:00Z',
  expiresAt: '2026-11-06T01:00:00Z',
}
const otherSession = { ...currentSession, current: false, createdAt: '2026-10-29T01:00:00Z' }

async function withProfile(overrides, check) {
  await withDraftDom(async (tools) => {
    const { React, load, mount } = tools
    const { default: AdminProfile } = await load('/src/apps/manager/profile/pages/AdminProfile.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { setLocale } = await load('/src/shared/i18n/store.js')
    setLocale('vi')
    const value = {
      user,
      authGeneration: 1,
      getOwnSessions: async () => ({ sessions: [currentSession, otherSession] }),
      saveOwnProfile: async (name) => ({ user: { ...user, name } }),
      changePassword: async () => ({}),
      revokeOtherSessions: async () => ({}),
      ...overrides,
    }
    const { container } = await mount(
      React.createElement(PmsContext.Provider, { value }, React.createElement(AdminProfile)),
    )
    const field = (text) =>
      [...container.querySelectorAll('label')]
        .find((label) => label.textContent.includes(text))
        ?.querySelector('input')
    const button = (text) =>
      [...container.querySelectorAll('button')].find((item) => item.textContent.includes(text))
    const submit = (element) =>
      tools.act(async () =>
        element
          .closest('form')
          .dispatchEvent(new tools.window.Event('submit', { bubbles: true, cancelable: true })),
      )
    await check({ ...tools, container, field, button, submit })
  })
}

test('manager profile saves only a trimmed name and keeps the login email read-only', async () => {
  const names = []
  await withProfile(
    {
      saveOwnProfile: async (name) => {
        names.push(name)
        return { user: { ...user, name } }
      },
    },
    async ({ container, field, input, submit }) => {
      const name = field('Họ và tên')
      assert.equal(field('Email').readOnly, true)
      assert.equal(name.closest('form').querySelector('[type="submit"]').disabled, true)
      await input(name, '  Trần Minh Ánh  ')
      await submit(name)
      assert.deepEqual(names, ['Trần Minh Ánh'])
      assert.equal(name.value, 'Trần Minh Ánh')
      assert.ok(container.querySelector('[role="status"]'))
    },
  )
})

test('manager password confirmation blocks mismatches; a successful change clears secrets and reloads sessions', async () => {
  const changes = []
  let reads = 0
  await withProfile(
    {
      getOwnSessions: async () => {
        reads++
        return { sessions: [currentSession] }
      },
      changePassword: async (draft) => {
        changes.push(draft)
      },
    },
    async ({ container, field, input, submit }) => {
      const current = field('Mật khẩu hiện tại'),
        next = field('Mật khẩu mới'),
        confirmation = field('Xác nhận mật khẩu mới')
      await input(current, 'old-password')
      await input(next, '  New-password-2026!  ')
      await input(confirmation, 'Does-not-match-2026!')
      await submit(current)
      assert.equal(changes.length, 0)
      assert.match(container.querySelector('[role="alert"]').textContent, /không khớp/)
      assert.equal(current.value, 'old-password')
      await input(confirmation, '  New-password-2026!  ')
      await submit(current)
      assert.deepEqual(changes, [
        { currentPassword: 'old-password', newPassword: '  New-password-2026!  ' },
      ])
      assert.equal(current.value, '')
      assert.equal(next.value, '')
      assert.equal(confirmation.value, '')
      assert.equal(reads, 2)
      assert.equal(container.querySelector('[role="alert"]'), null)
    },
  )
})

test('manager session controls preserve the current session after revoking others', async () => {
  let revoked = 0,
    reads = 0
  await withProfile(
    {
      getOwnSessions: async () => {
        reads++
        return { sessions: revoked ? [currentSession] : [currentSession, otherSession] }
      },
      revokeOtherSessions: async () => {
        revoked++
      },
    },
    async ({ button, click, container }) => {
      assert.equal(button('Đăng xuất các phiên khác').disabled, false)
      await click(button('Đăng xuất các phiên khác'))
      assert.equal(revoked, 1)
      assert.equal(reads, 2)
      assert.equal(button('Đăng xuất các phiên khác').disabled, true)
      assert.match(container.textContent, /Phiên hiện tại/)
      await click(button('Tải lại phiên'))
      assert.equal(reads, 3)
    },
  )
})

test('a pending password change blocks duplicate submissions and keeps the draft after failure', async () => {
  const pending = Promise.withResolvers()
  let writes = 0
  await withProfile(
    {
      changePassword: () => {
        writes++
        return pending.promise
      },
    },
    async ({ act, window, container, field, input }) => {
      const current = field('Mật khẩu hiện tại')
      await input(current, 'old-password')
      await input(field('Mật khẩu mới'), 'New-password-2026!')
      await input(field('Xác nhận mật khẩu mới'), 'New-password-2026!')
      const form = current.closest('form')
      await act(async () => {
        for (let index = 0; index < 2; index++)
          form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      })
      assert.equal(writes, 1)
      assert.equal(form.getAttribute('aria-busy'), 'true')
      assert.equal(current.disabled, true)
      assert.equal(field('Họ và tên').disabled, true)
      assert.equal(
        field('Họ và tên').closest('form').querySelector('[type="submit"]').textContent,
        'Lưu hồ sơ',
      )
      await act(async () => pending.reject(new Error('Mật khẩu hiện tại không đúng.')))
      assert.match(
        container.querySelector('[role="alert"]').textContent,
        /Mật khẩu hiện tại không đúng/,
      )
      assert.equal(current.value, 'old-password')
      assert.equal(field('Mật khẩu mới').value, 'New-password-2026!')
      assert.equal(form.getAttribute('aria-busy'), 'false')
      assert.equal(current.disabled, false)
    },
  )
})

test('manager session loading and read errors allow a retry without exposing stale session actions', async () => {
  const pending = Promise.withResolvers()
  let reads = 0
  await withProfile(
    {
      getOwnSessions: () =>
        ++reads === 1 ? pending.promise : Promise.resolve({ sessions: [currentSession] }),
    },
    async ({ act, button, click, container }) => {
      assert.equal(button('Tải lại phiên').disabled, true)
      assert.equal(button('Đăng xuất các phiên khác').disabled, true)
      await act(async () => pending.reject(new Error('Không tải được phiên thử nghiệm.')))
      assert.match(
        container.querySelector('[role="alert"]').textContent,
        /Không tải được phiên thử nghiệm/,
      )
      assert.equal(button('Tải lại phiên').disabled, false)
      await click(button('Tải lại phiên'))
      assert.equal(reads, 2)
      assert.equal(container.querySelector('[role="alert"]'), null)
      assert.equal(button('Đăng xuất các phiên khác').disabled, true)
    },
  )
})
