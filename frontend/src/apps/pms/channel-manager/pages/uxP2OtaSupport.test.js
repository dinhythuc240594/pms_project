import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

const PROVIDER_ID = 'chx-booking-7f1c2d9e-5a4b-4e0f-9c21-000000000001'
const REVISION_ID = 'chx-revision-0a9b8c7d-6e5f-4a3b-8c2d-111111111111'
const JOB_REVISION = 'chx-revision-job-22222222-3333-4444-5555-666666666666'
const reviews = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    bookingId: PROVIDER_ID,
    revisionId: REVISION_ID,
    providerStatus: 'cancelled',
    revisionAt: '2026-11-17T08:00:00Z',
    createdAt: '2026-11-17T08:00:00Z',
    errorCode: 'booking_review_required',
    jobStatus: 'failed',
    jobId: 'job-1',
    details: {
      bookingCode: 'BDC-778899',
      source: 'Booking.com',
      arrivalDate: '2026-12-01',
      departureDate: '2026-12-03',
      amount: '1200000',
      currency: 'VND',
    },
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    bookingId: 'chx-no-ref-0002',
    revisionId: 'chx-rev-0002',
    providerStatus: 'modified',
    createdAt: '2026-11-17T09:00:00Z',
    errorCode: 'booking_review_required',
    jobStatus: 'queued',
    jobId: 'job-2',
    details: {
      source: 'Expedia',
      arrivalDate: '2026-12-05',
      departureDate: '2026-12-06',
      amount: '500000',
      currency: 'VND',
    },
  },
]
const historyRow = {
  id: 'job-9',
  kind: 'pull_bookings',
  status: 'failed',
  attempts: 2,
  revisionId: JOB_REVISION,
  createdAt: '2026-11-17T07:00:00Z',
  errorCode: 'provider_unavailable',
}

test('OTA review rows keep business facts visible and full provider IDs in a support disclosure', async (context) => {
  await withDraftDom(async ({ React, act, window, document, load, mount, click }) => {
    const { default: OTAHistory } = await load('/src/apps/pms/channel-manager/pages/OTAHistory.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { getLocale, setLocale } = await load('/src/shared/i18n/store.js')
    const { createMemoryRouter, RouterProvider } = await import('react-router-dom')
    const previousLocale = getLocale()
    setLocale('vi')
    const h = React.createElement
    const flush = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    const reviewRows = () => [...document.querySelectorAll('.ota-review-table tbody tr')]
    const buttonsIn = (root, text) =>
      [...root.querySelectorAll('button')].filter((element) => element.textContent.trim() === text)
    const textOutsideDetails = (cell) => {
      const copy = cell.cloneNode(true)
      copy.querySelectorAll('details').forEach((node) => node.remove())
      return copy.textContent
    }

    async function setup() {
      const calls = []
      async function requestTenant(path, options) {
        calls.push({ path, options })
        if (options?.method) throw new Error('Unexpected write ' + path)
        if (path.startsWith('/channels/booking-reviews'))
          return {
            items: path.includes('reviewId=') ? [] : reviews,
            pagination: { page: 1, totalPages: 1, totalItems: reviews.length },
          }
        if (path.startsWith('/channels/incidents'))
          return { items: [], pagination: null, assignees: [] }
        if (path === '/channels') return { connection: null, mappings: [] }
        if (path.startsWith('/channels/jobs/')) return { ...historyRow }
        return {
          items: [historyRow],
          pagination: {
            page: 1,
            totalPages: 1,
            totalItems: 1,
            currentCursor: null,
            nextCursor: null,
          },
        }
      }
      const pms = {
        tenantId: 'hotel-a',
        user: { id: 'owner-a' },
        authGeneration: 1,
        settings: { timezone: 'Asia/Ho_Chi_Minh' },
        access: () => ({ allowed: true }),
        requestTenant,
        bookings: [],
      }
      const router = createMemoryRouter(
        [{ path: '*', element: h(PmsContext.Provider, { value: pms }, h(OTAHistory)) }],
        { initialEntries: ['/id/ota-history'] },
      )
      const mounted = await mount(h(RouterProvider, { router }))
      await flush()
      return { ...mounted, calls }
    }

    try {
      await context.test(
        'booking ref, source, status, stay, money and reason stay outside the support disclosure',
        async () => {
          const mounted = await setup()
          try {
            const [first, second] = reviewRows()
            const [ref, stay, result, actions] = first.querySelectorAll('td')
            const visible = textOutsideDetails(ref)
            assert.match(visible, /BDC-778899/)
            assert.match(visible, /Kênh: Booking\.com/)
            assert.match(visible, /Hủy đặt phòng/)
            assert.doesNotMatch(visible, new RegExp(PROVIDER_ID))
            assert.doesNotMatch(visible, new RegExp(REVISION_ID))
            assert.equal(stay.querySelector('details.ota-support-ids'), null)
            assert.ok(stay.textContent.trim().length > 0)
            assert.equal(result.querySelector('details'), null)
            assert.match(result.textContent, /Cần xử lý/)
            assert.ok(buttonsIn(actions, 'Thử lại sau khi xử lý').length === 1)

            const support = ref.querySelector('details.ota-support-ids')
            assert.equal(support.open, false)
            assert.match(support.querySelector('summary').textContent, /Mã hỗ trợ kỹ thuật/)
            assert.match(support.textContent, new RegExp(PROVIDER_ID))
            assert.match(support.textContent, new RegExp(REVISION_ID))

            const secondRef = second.querySelector('td')
            assert.match(second.querySelector('td strong').textContent, /chx-no-ref-0002/)
            assert.match(textOutsideDetails(secondRef), /Kênh: Expedia/)
            assert.match(
              textOutsideDetails(second.querySelectorAll('td')[2]),
              /Đã xếp hàng kiểm tra lại theo yêu cầu\./,
            )
          } finally {
            await mounted.unmount()
          }
        },
      )

      await context.test(
        'copy is explicit and falls back to manual copy without writes or retries',
        async () => {
          const written = []
          let fail = false
          Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: {
              async writeText(text) {
                if (fail) throw new Error('denied')
                written.push(text)
              },
            },
          })
          const mounted = await setup()
          try {
            assert.equal(written.length, 0)
            const support = reviewRows()[0].querySelector('details.ota-support-ids')
            await click(buttonsIn(support, 'Sao chép mã hỗ trợ')[0])
            assert.equal(written.length, 1)
            assert.match(written[0], new RegExp(PROVIDER_ID))
            assert.match(written[0], new RegExp(REVISION_ID))
            assert.match(
              support.querySelector('[role="status"]').textContent,
              /Đã sao chép mã hỗ trợ\./,
            )

            fail = true
            await click(buttonsIn(support, 'Sao chép mã hỗ trợ')[0])
            assert.match(
              support.querySelector('[role="status"]').textContent,
              /Không thể sao chép tự động/,
            )
            assert.match(support.querySelector('code').textContent, new RegExp(PROVIDER_ID))

            Object.defineProperty(window.navigator, 'clipboard', {
              configurable: true,
              value: undefined,
            })
            const historySupport = document.querySelector(
              'table:not(.ota-review-table) details.ota-support-ids',
            )
            assert.match(historySupport.textContent, new RegExp(JOB_REVISION))
            await click(buttonsIn(historySupport, 'Sao chép mã hỗ trợ')[0])
            assert.match(
              historySupport.querySelector('[role="status"]').textContent,
              /Không thể sao chép tự động/,
            )
            assert.equal(mounted.calls.filter((call) => call.options?.method).length, 0)
          } finally {
            await mounted.unmount()
            delete window.navigator.clipboard
          }
        },
      )
    } finally {
      setLocale(previousLocale)
    }
  })
})
