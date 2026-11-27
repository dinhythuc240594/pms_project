import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

const ROOM_UNICODE = 'phòng 7/ß&?'
function notification(id, eventCode, entityType, entityId, extra = {}) {
  return {
    id,
    eventCode,
    entityType,
    entityId,
    title: `i18n:notifications.events.${eventCode}`,
    body: { $i18n: `notifications.eventBodies.${eventCode}`, values: { entityId: id } },
    createdAt: '2026-11-18T03:30:00Z',
    readAt: null,
    ...extra,
  }
}
const inbox = () => [
  notification('n-new', 'NEW_BOOKING', 'reservation', 'BK-1'),
  notification('n-pay', 'PAYMENT_RECEIVED', 'reservation', 'BK-1'),
  notification('n-room', 'ROOM_CLEANED', 'room', 'room-b'),
  notification('n-unicode', 'ROOM_MAINTENANCE', 'room', ROOM_UNICODE),
  notification('n-pos', 'PAYMENT_RECEIVED', 'pos_invoice', 'INV-1'),
  notification('n-legacy', 'NEW_BOOKING', undefined, 'BK-1'),
  notification('n-missing', 'NEW_BOOKING', 'reservation', 'BK-404'),
  notification('n-tenant', 'NEW_BOOKING', 'reservation', 'BK-1', { tenantId: 'hotel-b' }),
]

test('notification targets open exact loaded records through the guarded router', async (context) => {
  await withDraftDom(async ({ React, act, document, load, mount, click }) => {
    const { default: NotificationBell } = await load(
      '/src/apps/pms/components/NotificationBell.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { DraftGuardProvider, DraftRouteGuard, useDraftGuard } = await load(
      '/src/shared/drafts/DraftGuardProvider.jsx',
    )
    const { getLocale, setLocale } = await load('/src/shared/i18n/store.js')
    const { createMemoryRouter, RouterProvider, useLocation } = await import('react-router-dom')
    const previousLocale = getLocale()
    setLocale('vi')
    const h = React.createElement
    const flush = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    const trigger = () => document.querySelector('button[aria-haspopup="dialog"]')
    const inboxDialog = () => document.querySelector('dialog.pms-legacy-overlay')
    const confirmation = () => document.querySelector('dialog.draft-confirmation')
    const rows = () => [...document.querySelectorAll('.pms-notification-list > li')]
    const openButton = (index) => rows()[index].querySelector('.pms-notification-open')
    const reason = (index) =>
      rows()[index].querySelector('.pms-notification-target-reason')?.textContent || ''
    const where = () => document.querySelector('output[data-location]').textContent
    const buttonText = (text) =>
      [...document.querySelectorAll('button')].find(
        (element) => element.textContent.trim() === text,
      )

    function basePms(calls, overrides = {}) {
      return {
        tenantId: 'hotel-a',
        tenant: { id: 'hotel-a', name: 'Khách sạn Mây' },
        user: { id: 'owner-a' },
        authGeneration: 1,
        settings: { timezone: 'Asia/Ho_Chi_Minh' },
        access: () => ({ allowed: true }),
        pendingRequests: { reads: 0, writes: 0 },
        bookings: [{ id: 'BK-1' }],
        rooms: [
          { id: 'room-a', name: '101' },
          { id: 'room-b', name: '101' },
          { id: ROOM_UNICODE, name: '7' },
        ],
        async requestTenant(path, options) {
          calls.push({ path, options })
          if (path.startsWith('/notifications?'))
            return { items: inbox(), unreadCount: 8, nextBefore: null }
          throw new Error('Unexpected request ' + path)
        },
        ...overrides,
      }
    }

    async function setup({ overrides = {}, draft = { dirty: false }, Wrapper } = {}) {
      const calls = []
      const pms = basePms(calls, overrides)
      function Dirty() {
        useDraftGuard({
          dirty: () => draft.dirty,
          onDiscard: () => {
            draft.dirty = false
          },
        })
        return null
      }
      function Where() {
        const location = useLocation()
        return h('output', { 'data-location': '' }, location.pathname + location.search)
      }
      const bell = Wrapper
        ? h(Wrapper, { pms })
        : h(PmsContext.Provider, { value: pms }, h(NotificationBell))
      const router = createMemoryRouter(
        [
          {
            path: '*',
            element: h(React.Fragment, null, h(DraftRouteGuard), h(Dirty), h(Where), bell),
          },
        ],
        { initialEntries: ['/id/dashboard'] },
      )
      const mounted = await mount(h(DraftGuardProvider, null, h(RouterProvider, { router })))
      return { ...mounted, calls, router, draft }
    }

    try {
      await context.test(
        'typed targets route by exact ID; unsupported, missing and cross-tenant items explain why',
        async () => {
          const mounted = await setup()
          try {
            await click(trigger())
            assert.equal(rows().length, 8)
            assert.ok(openButton(0) && openButton(1) && openButton(2) && openButton(3))
            assert.match(reason(4), /Chưa có liên kết trực tiếp/)
            assert.equal(openButton(4), null)
            assert.equal(openButton(5), null)
            assert.equal(reason(5), '')
            assert.match(reason(6), /dữ liệu đang tải/)
            assert.equal(openButton(6), null)
            assert.match(reason(7), /khách sạn khác/)
            assert.equal(openButton(7), null)
            assert.equal(document.querySelectorAll('.pms-notification-open').length, 4)

            await click(openButton(2))
            await flush()
            assert.equal(where(), '/id/housekeeping/status?room=room-b')
            assert.equal(inboxDialog(), null)

            await click(trigger())
            await click(openButton(3))
            await flush()
            assert.equal(new URLSearchParams(where().split('?')[1]).get('room'), ROOM_UNICODE)
            assert.match(where(), /^\/id\/housekeeping\/status\?room=ph%C3%B2ng\+7%2F%C3%9F%26%3F$/)
          } finally {
            await mounted.unmount()
          }
        },
      )

      await context.test(
        'opening a payment target never marks read and keeps browser Back',
        async () => {
          const mounted = await setup()
          try {
            await click(trigger())
            await click(openButton(1))
            await flush()
            assert.equal(where(), '/id/reservations?booking=BK-1&tab=payments')
            assert.equal(inboxDialog(), null)
            assert.equal(mounted.calls.filter((call) => call.options?.method).length, 0)
            assert.equal(mounted.calls.filter((call) => call.path.includes('/read')).length, 0)
            await act(async () => {
              await mounted.router.navigate(-1)
            })
            assert.equal(where(), '/id/dashboard')

            await click(trigger())
            await click(openButton(0))
            await flush()
            assert.equal(where(), '/id/reservations?booking=BK-1')
          } finally {
            await mounted.unmount()
          }
        },
      )

      await context.test(
        'dirty work blocks navigation and keeps the inbox open until the user discards',
        async () => {
          const mounted = await setup({ draft: { dirty: true } })
          try {
            await click(trigger())
            await click(openButton(0))
            await flush()
            assert.ok(confirmation())
            assert.ok(inboxDialog())
            assert.equal(where(), '/id/dashboard')
            await click(buttonText('Tiếp tục sửa'))
            await flush()
            assert.equal(confirmation(), null)
            assert.ok(inboxDialog())
            assert.equal(where(), '/id/dashboard')
            assert.equal(mounted.draft.dirty, true)

            await click(openButton(0))
            await flush()
            await click(buttonText('Bỏ bản nháp'))
            await flush()
            assert.equal(where(), '/id/reservations?booking=BK-1')
            assert.equal(inboxDialog(), null)
          } finally {
            await mounted.unmount()
          }
        },
      )

      await context.test('pending writes disable opening records', async () => {
        const mounted = await setup({ overrides: { pendingRequests: { reads: 0, writes: 1 } } })
        try {
          await click(trigger())
          assert.equal(openButton(0).disabled, true)
          await click(openButton(0))
          await flush()
          assert.equal(where(), '/id/dashboard')
          assert.ok(inboxDialog())
        } finally {
          await mounted.unmount()
        }
      })

      await context.test('missing permission shows a reason instead of a link', async () => {
        const access = (action) =>
          action === 'reservations.view'
            ? { allowed: false, message: 'Vai trò hiện tại không xem được đặt phòng.' }
            : { allowed: true }
        const mounted = await setup({ overrides: { access } })
        try {
          await click(trigger())
          assert.equal(openButton(0), null)
          assert.match(
            reason(0),
            /Bạn chưa có quyền xem hồ sơ này\. Vai trò hiện tại không xem được đặt phòng\./,
          )
          assert.ok(openButton(2))
        } finally {
          await mounted.unmount()
        }
      })

      await context.test(
        'a new auth generation replaces the inbox so old data cannot navigate',
        async () => {
          const controls = {}
          function Wrapper({ pms }) {
            const [value, setValue] = React.useState(pms)
            React.useEffect(() => {
              controls.next = () => setValue({ ...pms, authGeneration: 2, bookings: [] })
            }, [pms])
            return h(PmsContext.Provider, { value }, h(NotificationBell))
          }
          const mounted = await setup({ Wrapper })
          try {
            await click(trigger())
            assert.ok(openButton(0))
            await act(async () => controls.next())
            assert.equal(inboxDialog(), null)
            await click(trigger())
            assert.equal(openButton(0), null)
            assert.match(reason(0), /dữ liệu đang tải/)
            assert.equal(where(), '/id/dashboard')
          } finally {
            await mounted.unmount()
          }
        },
      )

      await context.test(
        'without a router the original inbox works and offers no navigation',
        async () => {
          const calls = []
          const mounted = await mount(
            h(PmsContext.Provider, { value: basePms(calls) }, h(NotificationBell)),
          )
          try {
            await click(trigger())
            assert.equal(rows().length, 8)
            assert.equal(document.querySelectorAll('.pms-notification-open').length, 0)
            assert.match(reason(4), /Chưa có liên kết trực tiếp/)
          } finally {
            await mounted.unmount()
          }
        },
      )
    } finally {
      setLocale(previousLocale)
    }
  })
})
