import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

// Synthetic data only. PmsContext is mocked; BookingTabs and the draft guard are real.
const cash = { id: 'cash', name: 'Tiền mặt' }
const card = { id: 'card', name: 'Thẻ' }
const wireUsd = { id: 'wire-usd', name: 'Chuyển khoản USD', currencies: ['USD'] }
const fundVnd = { id: 'fund-vnd', name: 'Quỹ VND', currency: 'VND' }
const fundVnd2 = { id: 'fund-vnd-2', name: 'Quỹ VND 2', currency: 'VND' }
const fundUsd = { id: 'fund-usd', name: 'Quỹ USD', currency: 'USD' }
const makeBooking = (extra = {}) => ({
  id: 'BK-PAY',
  guest: 'Khách thử',
  status: 'IN_HOUSE',
  currency: 'VND',
  version: 1,
  total: '987654321198.7654',
  paid: '100000000.0000',
  balance: '987554321198.7654',
  guests: [],
  payments: [],
  charges: [],
  notes: [],
  history: [],
  nightlyRates: [],
  ...extra,
})
const payment = (id, amount, refunded) => ({
  id,
  amount,
  refunded,
  methodId: 'cash',
  createdAt: '2026-01-10T03:00:00Z',
  refunds: [],
})

test('P1 payment form: defaults, exact balance fill, gates, history/refund and current eligibility at submit', async (t) => {
  await withDraftDom(async ({ React, act, document, load, mount, click, input }) => {
    const { default: BookingTabs } = await load(
      '/src/apps/pms/reservations/components/BookingTabs.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { DraftGuardProvider, useDraftNavigation } = await load(
      '/src/shared/drafts/DraftGuardProvider.jsx',
    )
    const h = React.createElement
    const settle = () =>
      act(async () => {
        await new Promise((done) => setTimeout(done, 0))
      })

    async function open(setup = {}) {
      const calls = { payment: [], refund: [] }
      const state = {
        booking: makeBooking(setup.booking),
        methods: setup.methods ?? [cash],
        funds: setup.funds ?? [fundVnd],
        canWrite: setup.canWrite ?? true,
        parentPending: false,
        gates: {},
        paymentError: null,
        pending: [],
        left: 0,
      }
      const listeners = new Set()
      const gate = (name) => {
        const held = state.gates[name]
        delete state.gates[name]
        return held?.promise
      }
      const noop = async () => {}
      const api = {
        services: [],
        settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
        access: (permission) => ({
          allowed:
            permission === 'finance.adjust'
              ? false
              : permission !== 'payments.write' || state.canWrite,
        }),
        addPayment: async (id, payload, intent) => {
          calls.payment.push([id, payload, intent])
          await gate('payment')
          if (state.paymentError) {
            const failure = state.paymentError
            state.paymentError = null
            throw failure
          }
        },
        refundPayment: async (id, paymentId, payload, intent) => {
          calls.refund.push([id, paymentId, payload, intent])
        },
        addCharge: noop,
        addNote: noop,
        updateBooking: noop,
        adjustBooking: noop,
        refreshWorkspace: noop,
      }
      function Leave() {
        const navigation = useDraftNavigation()
        return h(
          'button',
          {
            type: 'button',
            className: 'probe-leave',
            onClick: () =>
              navigation.requestLeave(() => {
                state.left += 1
              }),
          },
          'Leave',
        )
      }
      function Host() {
        const [, bump] = React.useReducer((count) => count + 1, 0)
        React.useEffect(() => {
          listeners.add(bump)
          return () => {
            listeners.delete(bump)
          }
        }, [])
        return h(
          DraftGuardProvider,
          null,
          h(
            PmsContext.Provider,
            { value: { ...api, paymentMethods: state.methods, funds: state.funds } },
            h(BookingTabs, {
              tab: 'thanhtoán',
              booking: state.booking,
              draftGroup: 'payments-test',
              onPendingChange: (value) => state.pending.push(value),
              isParentPending: () => state.parentPending,
            }),
            h(Leave),
          ),
        )
      }
      const view = await mount(h(Host))
      await settle()
      const change = async (patch) => {
        patch(state)
        await act(async () => {
          for (const notify of [...listeners]) notify()
        })
        await settle()
      }
      return { ...view, state, calls, change }
    }

    const all = (selector) => [...document.querySelectorAll(selector)]
    const button = (text) => all('button').find((node) => node.textContent.trim() === text)
    const amount = () => document.querySelector('input[aria-label="Số tiền thanh toán"]')
    const method = () => document.querySelector('select[aria-label="Phương thức thanh toán"]')
    const fund = () => document.querySelector('select[aria-label="Quỹ nhận tiền"]')
    const fill = () => document.querySelector('.booking-detail-fill-balance')
    const values = (select) => [...select.options].map((option) => option.value)
    const alertText = () =>
      document.querySelector('.booking-detail-section [role="alert"]')?.textContent ?? ''
    const payFieldset = () => amount().closest('fieldset')
    const submitPay = async () => {
      await act(async () => amount().closest('form').requestSubmit())
      await settle()
    }
    async function isDirty(view) {
      const before = view.state.left
      await click(document.querySelector('.probe-leave'))
      if (document.querySelector('.draft-confirmation')) {
        await click(button('Tiếp tục sửa'))
        return true
      }
      assert.equal(view.state.left, before + 1)
      return false
    }

    await t.test(
      'a sole active compatible method/fund is defaulted without a draft; several, inactive or incompatible options are never guessed',
      async () => {
        const view = await open({
          methods: [cash, { ...card, active: false }, wireUsd],
          funds: [fundVnd, fundUsd, { ...fundVnd2, active: false }],
        })
        assert.deepEqual([values(method()), method().value], [['', 'cash'], 'cash'])
        assert.deepEqual([values(fund()), fund().value], [['', 'fund-vnd'], 'fund-vnd'])
        assert.equal(await isDirty(view), false, 'derived defaults do not dirty the form')

        await view.change((state) => {
          state.methods = [cash, card]
          state.funds = [fundVnd, fundVnd2]
        })
        assert.deepEqual(
          [method().value, fund().value],
          ['', ''],
          'several eligible options are not guessed',
        )
        await input(amount(), '100000')
        await submitPay()
        assert.equal(view.calls.payment.length, 0, 'a missing method choice never reaches the API')
        assert.match(alertText(), /phương thức/)
        await input(method(), 'card')
        await submitPay()
        assert.equal(view.calls.payment.length, 0, 'a missing fund choice never reaches the API')
        assert.match(alertText(), /quỹ/)
        await input(fund(), 'fund-vnd-2')
        await submitPay()
        assert.equal(view.calls.payment.length, 1)
        assert.deepEqual(view.calls.payment[0].slice(0, 2), [
          'BK-PAY',
          { amount: '100000', methodId: 'card', fundId: 'fund-vnd-2' },
        ])

        await view.change((state) => {
          state.methods = [{ ...cash, active: false }, wireUsd]
          state.funds = [fundUsd]
        })
        assert.deepEqual(
          [values(method()), values(fund())],
          [[''], ['']],
          'inactive and incompatible options are not offered',
        )
        await input(amount(), '5000')
        await submitPay()
        assert.equal(view.calls.payment.length, 1, 'no eligible option means no payment')
        assert.match(alertText(), /phương thức/)
        await view.unmount()
      },
    )

    await t.test(
      '"Thu đủ còn lại" fills the exact current balance; the amount stays editable and refreshed props never overwrite it',
      async () => {
        const view = await open()
        assert.equal(amount().value, '')
        await click(fill())
        assert.equal(
          amount().value,
          '987554321198.7654',
          'the exact 4-decimal balance, not a float',
        )
        assert.equal(await isDirty(view), true, 'a filled amount is a draft')
        await input(amount(), '1000000.5')
        assert.equal(amount().value, '1000000.5', 'a partial payment can be typed')
        await view.change((state) => {
          state.booking = {
            ...state.booking,
            balance: '999.0001',
            paid: '987554321198.7653',
            version: 2,
          }
        })
        assert.equal(amount().value, '1000000.5', 'a refreshed booking keeps the typed draft')
        assert.equal(view.calls.payment.length, 0, 'filling never submits')
        await click(fill())
        assert.equal(amount().value, '999.0001', 'filling after a refresh uses the latest balance')
        await submitPay()
        assert.equal(view.calls.payment.length, 1)
        assert.deepEqual(view.calls.payment[0][1], {
          amount: '999.0001',
          methodId: 'cash',
          fundId: 'fund-vnd',
        })
        assert.equal(amount().value, '')
        await view.unmount()
      },
    )

    await t.test(
      'zero balance, view-only, checked-out and cancelled bookings cannot fill or pay',
      async () => {
        for (const [reason, setup] of [
          ['zero balance', { booking: { balance: '0.0000', paid: '987654321198.7654' } }],
          ['view-only', { canWrite: false }],
          ['checked out', { booking: { status: 'CHECKED_OUT' } }],
          ['cancelled', { booking: { status: 'CANCELLED' } }],
        ]) {
          const view = await open(setup)
          assert.equal(fill().disabled, true, reason)
          assert.equal(payFieldset().disabled, true, reason)
          assert.deepEqual(
            [method().value, fund().value],
            ['', ''],
            `${reason}: no defaults are offered`,
          )
          await click(fill())
          assert.equal(amount().value, '', reason)
          await submitPay()
          assert.equal(view.calls.payment.length, 0, reason)
          await view.unmount()
        }
      },
    )

    await t.test(
      'parent-pending and local-pending writes block fill and submit; a failed payment retries with the same intent',
      async () => {
        const view = await open()
        await view.change((state) => {
          state.parentPending = true
        })
        assert.equal(payFieldset().disabled, true)
        assert.equal(fill().matches(':disabled'), true)
        await click(fill())
        await submitPay()
        assert.deepEqual(
          [amount().value, view.calls.payment.length],
          ['', 0],
          'a pending parent save blocks the payment tab',
        )
        await view.change((state) => {
          state.parentPending = false
        })
        assert.equal(fill().matches(':disabled'), false)

        await click(fill())
        const held = (view.state.gates.payment = Promise.withResolvers())
        view.state.paymentError = new Error('Mạng chập chờn.')
        await act(async () => amount().closest('form').requestSubmit())
        assert.equal(view.calls.payment.length, 1)
        assert.equal(
          payFieldset().disabled,
          true,
          'the form is locked while the payment is pending',
        )
        await act(async () => amount().closest('form').requestSubmit())
        await click(fill())
        assert.equal(view.calls.payment.length, 1, 'a pending payment cannot be submitted twice')
        assert.deepEqual(view.state.pending, [true])
        await act(async () => held.resolve())
        await settle()
        assert.match(alertText(), /Mạng chập chờn/)
        assert.equal(amount().value, '987554321198.7654', 'a failed payment keeps the draft')

        await submitPay()
        assert.equal(view.calls.payment.length, 2)
        assert.equal(
          view.calls.payment[1][2],
          view.calls.payment[0][2],
          'the retry reuses the idempotency intent',
        )
        assert.deepEqual(view.calls.payment[1][1], view.calls.payment[0][1])
        assert.deepEqual(view.state.pending, [true, false, true, false])
        assert.equal(amount().value, '')
        await input(amount(), '1000')
        await submitPay()
        assert.equal(view.calls.payment.length, 3)
        assert.notEqual(
          view.calls.payment[2][2],
          view.calls.payment[0][2],
          'a new payment gets a new intent',
        )
        await view.unmount()
      },
    )

    await t.test(
      'one empty-history state without a refund form; an eligible original payment can still be refunded',
      async () => {
        const empty = await open()
        assert.equal(all('.booking-detail-empty-history').length, 1)
        assert.equal(
          document.querySelector('.booking-detail-table-wrap'),
          null,
          'no empty history table is rendered',
        )
        assert.equal(document.querySelector('select[aria-label="Giao dịch cần hoàn tiền"]'), null)
        assert.equal(document.querySelector('.booking-detail-refund-empty'), null)
        await empty.unmount()

        const view = await open({
          booking: { payments: [payment('pay-done', '200000', '200000.0000')] },
        })
        assert.equal(document.querySelector('.booking-detail-empty-history'), null)
        assert.ok(document.querySelector('.booking-detail-table-wrap'))
        assert.equal(
          document.querySelector('select[aria-label="Giao dịch cần hoàn tiền"]'),
          null,
          'a fully refunded payment is not offered',
        )
        assert.ok(document.querySelector('.booking-detail-refund-empty'))

        await view.change((state) => {
          state.booking = {
            ...state.booking,
            payments: [
              payment('pay-done', '200000', '200000.0000'),
              payment('pay-1', '500000.0000', '0'),
            ],
          }
        })
        const refundFrom = document.querySelector('select[aria-label="Giao dịch cần hoàn tiền"]')
        assert.deepEqual(values(refundFrom), ['', 'pay-1'])
        assert.equal(document.querySelector('.booking-detail-refund-empty'), null)
        await input(refundFrom, 'pay-1')
        await input(document.querySelector('input[aria-label="Số tiền hoàn"]'), '100000')
        await input(document.querySelector('input[aria-label="Lý do hoàn tiền"]'), 'Khách đổi ý')
        await act(async () => refundFrom.closest('form').requestSubmit())
        await settle()
        assert.equal(view.calls.refund.length, 1)
        assert.deepEqual(view.calls.refund[0].slice(0, 3), [
          'BK-PAY',
          'pay-1',
          { amount: '100000', reason: 'Khách đổi ý' },
        ])
        assert.equal(view.calls.payment.length, 0, 'a refund never records a payment')
        await view.unmount()
      },
    )

    await t.test(
      'a manual method or fund that became inactive or incompatible is neither switched nor submitted, and stays for correction',
      async () => {
        const view = await open({ methods: [cash, card], funds: [fundVnd, fundVnd2] })
        await input(method(), 'card')
        await input(fund(), 'fund-vnd-2')
        await input(amount(), '50000')

        await view.change((state) => {
          state.methods = [cash, { ...card, active: false }]
        })
        assert.deepEqual(values(method()), ['', 'cash'])
        await submitPay()
        assert.equal(
          view.calls.payment.length,
          0,
          'the inactive manual method is not submitted and cash is not silently used',
        )
        assert.match(alertText(), /phương thức/)
        assert.equal(amount().value, '50000')

        await view.change((state) => {
          state.methods = [cash, card]
          state.funds = [fundVnd, { ...fundVnd2, currency: 'USD' }]
        })
        assert.equal(method().value, 'card', 'the manual method is kept for correction')
        await submitPay()
        assert.equal(
          view.calls.payment.length,
          0,
          'an incompatible manual fund is not submitted and the sole VND fund is not silently used',
        )
        assert.match(alertText(), /quỹ/)

        await input(fund(), 'fund-vnd')
        await submitPay()
        assert.equal(view.calls.payment.length, 1)
        assert.deepEqual(view.calls.payment[0][1], {
          amount: '50000',
          methodId: 'card',
          fundId: 'fund-vnd',
        })
        await view.unmount()
      },
    )
  })
})
