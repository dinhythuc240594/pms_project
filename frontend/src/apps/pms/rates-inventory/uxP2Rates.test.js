import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'
import { readRateParams, writeRateParams } from './rateModes.js'
import { rateRangeError } from './rateRange.js'

test('rate context preserves explicit ranges, unknown params and invalid/duplicate input without clamping', () => {
  const params = new URLSearchParams('rateStart=2026-01-01&rateEnd=2026-02-02&rateType=a&keep=1')
  const view = readRateParams(params, { todayDate: '2026-01-01', defaultNights: 7 })
  assert.equal(rateRangeError(view.range, 31), 'Chọn tối đa 31 ngày mỗi lần.')
  assert.equal(rateRangeError(view.range), '')
  assert.equal(writeRateParams(params, { typeId: 'b' }).get('rateEnd'), '2026-02-02')
  assert.equal(writeRateParams(params, { typeId: 'b' }).get('keep'), '1')
  for (const search of [
    'rateStart=bad',
    'rateStart=',
    'rateStart=0000-01-01',
    'rateType=a&rateType=b',
  ])
    assert.ok(
      readRateParams(new URLSearchParams(search), { todayDate: '2026-01-01', defaultNights: 7 })
        .urlError,
    )
})

async function fixture(to, check, overrides = {}) {
  await withDraftDom(async (tools) => {
    const { React, load, mount, act } = tools
    const { createMemoryRouter, RouterProvider } = await import('react-router-dom')
    const { default: Nightly } = await load('/src/apps/pms/rates-inventory/pages/NightlyRates.jsx')
    const { default: Matrix } = await load('/src/apps/pms/rates-inventory/pages/MatrixRate.jsx')
    const { default: RatesARI } = await load('/src/apps/pms/rates-inventory/pages/RatesARI.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const h = React.createElement,
      calls = [],
      reads = [],
      blocks = [],
      control = {}
    const state = { save: async () => {}, settings: { currency: 'VND', timezone: 'UTC' } }
    const initial = {
      tenantId: 'qa',
      authGeneration: 1,
      user: { id: 'owner' },
      settings: state.settings,
      roomTypes: [
        { id: 'a', name: 'Alpha', price: '100.0001', active: true },
        { id: 'b', name: 'Beta', price: '200', active: true },
      ],
      rooms: [{ id: '101', typeId: 'a', active: true }],
      roomBlocks: [],
      rates: [],
      access: () => ({ allowed: true }),
      requestTenant: async (path) => {
        reads.push(path)
        return { rates: [], availability: [] }
      },
      saveRate: async (body) => {
        calls.push(body)
        await state.save(body)
      },
      addBlock: async (body) => {
        blocks.push(body)
      },
      deleteBlock: async () => {},
      ...overrides,
    }
    const router = createMemoryRouter(
      [
        { path: '/form', element: h(Nightly) },
        { path: '/id/gia/ari', element: h(RatesARI) },
        { path: '/id/matrix-rate', element: h(Matrix) },
      ],
      { initialEntries: [to] },
    )
    function Host() {
      const [value, setValue] = React.useState(initial)
      React.useEffect(() => {
        control.change = (patch) => setValue((old) => ({ ...old, ...patch }))
      }, [])
      return h(PmsContext.Provider, { value }, h(RouterProvider, { router }))
    }
    const view = await mount(h(Host))
    const button = (text) =>
      [...view.container.querySelectorAll('button')].find(
        (node) => node.textContent.trim() === text,
      )
    const submit = (form) =>
      act(async () =>
        form.dispatchEvent(new tools.window.Event('submit', { bubbles: true, cancelable: true })),
      )
    try {
      await check({
        ...tools,
        ...view,
        router,
        state,
        calls,
        reads,
        blocks,
        control,
        button,
        submit,
      })
    } finally {
      await view.unmount()
    }
  })
}

test('nightly preview requires explicit confirmation, keeps exact money and carries range/type through modes and Back', async () => {
  await fixture(
    '/form?rateStart=2026-01-01&rateEnd=2026-01-03&rateType=a&keep=1',
    async ({ container, input, click, button, submit, calls, router, act }) => {
      const price = container.querySelector('[aria-label="Giá từng đêm"]')
      await input(price, '123.4500')
      await submit(price.closest('form'))
      assert.equal(calls.length, 0)
      assert.match(
        container.querySelector('[aria-label="Xem trước cập nhật giá"]').textContent,
        /Alpha/,
      )
      await click(button('Xác nhận cập nhật giá'))
      assert.deepEqual(calls, [
        {
          start: '2026-01-01',
          end: '2026-01-03',
          roomTypeId: 'a',
          price: '123.4500',
          stopSell: false,
        },
      ])
      const link = container.querySelector('a[data-rate-mode="matrix"]')
      assert.match(link.getAttribute('href'), /rateType=a/)
      await click(link)
      assert.equal(router.state.location.pathname, '/id/matrix-rate')
      assert.equal(new URLSearchParams(router.state.location.search).get('rateEnd'), '2026-01-03')
      assert.equal(new URLSearchParams(router.state.location.search).get('keep'), '1')
      await act(async () => router.navigate(-1))
      assert.equal(router.state.location.pathname, '/form')
    },
  )
})

test('matrix refuses a 32-day range without a read or truncation and the form can keep it', async () => {
  await fixture(
    '/id/matrix-rate?rateStart=2026-01-01&rateEnd=2026-02-02&rateType=a',
    async ({ container, reads, calls, click, router }) => {
      assert.match(container.querySelector('[role="alert"]').textContent, /31/)
      assert.equal(reads.length, 0)
      assert.equal(calls.length, 0)
      await click(container.querySelector('a[data-rate-mode="form"]'))
      assert.equal(new URLSearchParams(router.state.location.search).get('rateEnd'), '2026-02-02')
      assert.equal(
        container.querySelectorAll('[aria-label="Giá từng đêm"]').length,
        1,
        'the outer rate form renders one editor',
      )
      assert.ok(reads.length > 0)
    },
  )
})

test('matrix partial completion preserves only failed/unattempted cells for a new explicit preview', async () => {
  await fixture(
    '/id/matrix-rate?rateStart=2026-01-01&rateEnd=2026-01-02',
    async ({ container, click, calls, state, button }) => {
      await click(container.querySelectorAll('.rates-cell')[0])
      await click(container.querySelectorAll('.rates-cell')[1])
      await click(
        [...container.querySelectorAll('.rates-bulk-panel button')].find((node) =>
          /Dừng bán/.test(node.textContent),
        ),
      )
      assert.equal(calls.length, 0)
      state.save = async (body) => {
        if (body.roomTypeId === 'b') throw Error('Synthetic second-range error')
      }
      await click(button('Xác nhận áp dụng ma trận'))
      assert.equal(calls.length, 2)
      assert.equal(
        container.querySelectorAll('.rates-cell')[0].getAttribute('aria-pressed'),
        'false',
      )
      assert.equal(
        container.querySelectorAll('.rates-cell')[1].getAttribute('aria-pressed'),
        'true',
      )
      assert.match(container.querySelector('[role="alert"]').textContent, /Đã áp dụng 1 ô/)
      state.save = async () => {}
      await click(
        [...container.querySelectorAll('.rates-bulk-panel button')].find((node) =>
          /Dừng bán/.test(node.textContent),
        ),
      )
      await click(button('Xác nhận áp dụng ma trận'))
      assert.equal(calls.length, 3)
      assert.equal(calls[2].roomTypeId, 'b')
    },
  )
})

const typeSelect = (container) => container.querySelector('[aria-label="Loại phòng áp dụng giá"]')
const search = (router) => new URLSearchParams(router.state.location.search)

test('nightly default type stays implicit: form→matrix keeps the 7-day range but shows all types', async () => {
  await fixture('/form', async ({ container, click, router }) => {
    assert.doesNotMatch(
      container.querySelector('a[data-rate-mode="matrix"]').getAttribute('href'),
      /rateType/,
    )
    await click(container.querySelector('a[data-rate-mode="matrix"]'))
    assert.equal(router.state.location.pathname, '/id/matrix-rate')
    const params = search(router)
    assert.equal(params.has('rateType'), false)
    assert.equal(
      (Date.parse(params.get('rateEnd')) - Date.parse(params.get('rateStart'))) / 86400000,
      7,
    )
    assert.equal(container.querySelector('.rates-filters select').value, '')
  })
})

test('nightly explicitly selected type survives form→matrix and Back', async () => {
  await fixture(
    '/form?rateStart=2026-01-01&rateEnd=2026-01-03',
    async ({ container, input, click, router, act }) => {
      await input(typeSelect(container), 'b')
      assert.equal(search(router).get('rateType'), 'b')
      await click(container.querySelector('a[data-rate-mode="matrix"]'))
      assert.equal(search(router).get('rateType'), 'b')
      assert.equal(container.querySelector('.rates-filters select').value, 'b')
      await act(async () => router.navigate(-1))
      assert.equal(router.state.location.pathname, '/form')
      assert.equal(typeSelect(container).value, 'b')
    },
  )
})

test('nightly unknown type is recoverable in one select change and does not block valid-date room blocking', async () => {
  await fixture(
    '/form?rateStart=2026-01-01&rateEnd=2026-01-03&rateType=zzz',
    async ({ container, input, submit, click, button, calls, blocks, reads, router }) => {
      assert.match(container.querySelector('#nightly-type-error').textContent, /không tồn tại/)
      const select = typeSelect(container)
      assert.equal(select.disabled, false, 'the selector that fixes the type stays enabled')
      assert.equal(select.value, 'zzz')
      assert.equal(select.querySelector('option[value="zzz"]').disabled, true)
      const price = container.querySelector('[aria-label="Giá từng đêm"]')
      assert.equal(price.disabled, true)
      await submit(price.closest('form'))
      assert.equal(
        container.querySelector('[aria-label="Xem trước cập nhật giá"]'),
        null,
        'no preview for an invalid type',
      )
      assert.equal(calls.length, 0)
      assert.ok(reads.length > 0, 'valid dates still read rates')
      const reason = container.querySelector('[aria-label="Lý do khóa phòng"]')
      assert.equal(
        reason.closest('fieldset').disabled,
        false,
        'room block form is independent of the rate type',
      )
      await input(reason, 'Bảo trì')
      await submit(reason.closest('form'))
      assert.deepEqual(blocks, [
        { start: '2026-01-01', end: '2026-01-03', room: '101', reason: 'Bảo trì' },
      ])
      await input(typeSelect(container), 'a')
      assert.equal(search(router).get('rateType'), 'a')
      assert.equal(container.querySelector('#nightly-type-error'), null)
      await input(container.querySelector('[aria-label="Giá từng đêm"]'), '10')
      await submit(container.querySelector('[aria-label="Giá từng đêm"]').closest('form'))
      await click(button('Xác nhận cập nhật giá'))
      assert.deepEqual(calls, [
        { start: '2026-01-01', end: '2026-01-03', roomTypeId: 'a', price: '10', stopSell: false },
      ])
    },
  )
})

test('nightly inactive or duplicate type recovers via the select, not as a date error', async () => {
  const roomTypes = [
    { id: 'a', name: 'Alpha', price: '1', active: true },
    { id: 'b', name: 'Beta', price: '2', active: true },
    { id: 'c', name: 'Gamma', price: '3', active: false },
  ]
  await fixture(
    '/form?rateStart=2026-01-01&rateEnd=2026-01-03&rateType=c',
    async ({ container, input, router }) => {
      assert.match(container.querySelector('#nightly-type-error').textContent, /ngừng hoạt động/)
      assert.equal(typeSelect(container).value, 'c')
      await input(typeSelect(container), 'b')
      assert.equal(search(router).get('rateType'), 'b')
      assert.equal(container.querySelector('#nightly-type-error'), null)
    },
    { roomTypes },
  )
  await fixture(
    '/form?rateStart=2026-01-01&rateEnd=2026-01-03&rateType=a&rateType=b',
    async ({ container, input, router, reads }) => {
      assert.match(container.querySelector('#nightly-type-error').textContent, /bị lặp/)
      assert.equal(
        container.querySelectorAll('[role="alert"]').length,
        1,
        'duplicate type is not reported as a date error',
      )
      assert.ok(reads.length > 0)
      assert.equal(
        typeSelect(container).value,
        '',
        'placeholder makes re-choosing the first value a real change',
      )
      await input(typeSelect(container), 'a')
      assert.deepEqual(search(router).getAll('rateType'), ['a'])
      assert.equal(container.querySelector('#nightly-type-error'), null)
    },
  )
})

test('nightly invalid or duplicate URL dates never read or write, even with a valid type', async () => {
  for (const to of [
    '/form?rateStart=bad&rateEnd=2026-01-03&rateType=a',
    '/form?rateStart=2026-01-01&rateStart=2026-01-02&rateEnd=2026-01-03&rateType=a',
  ]) {
    await fixture(to, async ({ container, input, submit, reads, calls, blocks }) => {
      assert.equal(reads.length, 0)
      const reason = container.querySelector('[aria-label="Lý do khóa phòng"]')
      await input(reason, 'Bảo trì')
      await submit(reason.closest('form'))
      const price = container.querySelector('[aria-label="Giá từng đêm"]')
      await submit(price.closest('form'))
      assert.equal(blocks.length, 0)
      assert.equal(calls.length, 0)
      assert.equal(container.querySelector('[aria-label="Xem trước cập nhật giá"]'), null)
    })
  }
})

test('matrix unknown or inactive type clears to All in one select change', async () => {
  const roomTypes = [
    { id: 'a', name: 'Alpha', price: '1', active: true },
    { id: 'c', name: 'Gamma', price: '3', active: false },
  ]
  for (const typeId of ['zzz', 'c']) {
    await fixture(
      `/id/matrix-rate?rateStart=2026-01-01&rateEnd=2026-01-03&rateType=${typeId}`,
      async ({ container, input, reads, router }) => {
        assert.ok(container.querySelector('[role="alert"]'))
        assert.equal(reads.length, 0)
        const select = container.querySelector('.rates-filters select')
        assert.equal(select.value, typeId)
        assert.equal(select.querySelector(`option[value="${typeId}"]`).disabled, true)
        await input(select, '')
        assert.equal(search(router).has('rateType'), false)
        assert.equal(container.querySelector('[role="alert"]'), null)
        assert.ok(reads.length > 0)
      },
      { roomTypes },
    )
  }
})

test('a changed currency invalidates the preview and view-only roles receive no confirm action', async () => {
  await fixture(
    '/form?rateStart=2026-01-01&rateEnd=2026-01-03',
    async ({ container, input, submit, calls, control, act }) => {
      const price = container.querySelector('[aria-label="Giá từng đêm"]')
      await input(price, '123.4500')
      await submit(price.closest('form'))
      await act(async () => control.change({ settings: { currency: 'USD', timezone: 'UTC' } }))
      assert.equal(container.querySelector('[aria-label="Xem trước cập nhật giá"]'), null)
      await act(async () => control.change({ access: () => ({ allowed: false }) }))
      await submit(price.closest('form'))
      assert.equal(calls.length, 0)
      assert.equal(container.querySelector('[aria-label="Xem trước cập nhật giá"]'), null)
    },
  )
})
