import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../shared/drafts/testDom.js'
import { defaultPricingRules } from '../../shared/lib/planPricing.js'

const plan = {
  id: 'qa-pro',
  code: 'PRO',
  name: 'Gói Gia đình & Đối tác',
  currency: 'VND',
  price: '100',
  priceYear: '1200',
  maxRooms: 20,
  maxUsers: 5,
  features: {},
  pricingRules: defaultPricingRules(),
}
const contactPath = (values) => '/contact?' + new URLSearchParams(values)

async function withMarketing(path, check) {
  await withDraftDom(async (tools) => {
    const { React, act, window, load, mount, input } = tools
    const previousFetch = globalThis.fetch,
      requests = []
    globalThis.fetch = async (url, options = {}) => {
      requests.push({
        url,
        method: options.method || 'GET',
        ...(options.body ? { body: JSON.parse(options.body) } : {}),
      })
      if (url === '/api/public/plans') return Response.json({ plans: [plan], featureLabels: {} })
      assert.equal(url, '/api/public/contact')
      assert.equal(options.method, 'POST')
      return Response.json({ sent: true })
    }
    try {
      const { createMemoryRouter, RouterProvider } = await import('react-router-dom')
      const { default: Pricing } = await load('/src/apps/marketing/Pricing.jsx')
      const { default: Contact } = await load('/src/apps/marketing/Contact.jsx')
      const { setLocale } = await load('/src/shared/i18n/store.js')
      setLocale('vi')
      const router = createMemoryRouter(
        [
          { path: '/pricing', element: React.createElement(Pricing) },
          { path: '/contact', element: React.createElement(Contact) },
        ],
        { initialEntries: [path] },
      )
      const view = await mount(React.createElement(RouterProvider, { router }))
      const message = () => view.container.querySelector('textarea[name="message"]')
      const inquiry = () => view.container.querySelector('.loha-price-card a')
      const posts = () => requests.filter((row) => row.method === 'POST')
      async function changeMessage(value) {
        await act(async () => {
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(
            message(),
            value,
          )
          message().dispatchEvent(new window.Event('input', { bubbles: true }))
        })
      }
      const go = async (target) => {
        await act(async () => {
          await router.navigate(target)
        })
      }
      await check({
        ...tools,
        ...view,
        router,
        requests,
        posts,
        message,
        inquiry,
        changeMessage,
        go,
        input,
      })
    } finally {
      globalThis.fetch = previousFetch
    }
  })
}

test('pricing carries the selected plan, canonical room count and cycle to an editable Contact reference', async () => {
  await withMarketing(
    '/pricing',
    async ({
      container,
      inquiry,
      click,
      input,
      message,
      posts,
      router,
      act,
      changeMessage,
      go,
      window,
    }) => {
      const rooms = container.querySelector('#pricing-room-count')
      await input(rooms, '0016')
      await click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Theo năm',
        ),
      )
      const target = new URL(inquiry().href)
      assert.equal(target.pathname, '/contact')
      assert.deepEqual(Object.fromEntries(target.searchParams), {
        plan: plan.name,
        rooms: '16',
        cycle: 'year',
      })
      assert.equal(target.searchParams.has('amount'), false)
      assert.equal(target.searchParams.has('price'), false)
      await click(inquiry())
      assert.equal(router.state.location.pathname, '/contact')
      assert.match(message().value, /Gói Gia đình & Đối tác/)
      assert.match(message().value, /16 phòng/)
      assert.match(message().value, /theo năm/)
      assert.match(message().value, /chưa đăng ký hoặc thanh toán/)
      assert.equal(posts().length, 0)
      await changeMessage('My own inquiry and budget.')
      await go(contactPath({ plan: 'Different plan', rooms: '8', cycle: 'month' }))
      assert.equal(
        message().value,
        'My own inquiry and budget.',
        'query changes must not overwrite the edited message',
      )
      await act(async () => window.dispatchEvent(new window.Event('focus')))
      assert.equal(message().value, 'My own inquiry and budget.')
    },
  )
})

test('invalid counts and a count above the selected plan limit link to plain Contact without a misleading quote', async () => {
  await withMarketing('/pricing', async ({ container, input, inquiry }) => {
    for (const value of ['', '0', '1.5', '1000001', '21']) {
      await input(container.querySelector('#pricing-room-count'), value)
      const target = new URL(inquiry().href)
      assert.equal(target.pathname, '/contact')
      assert.equal(target.search, '', value)
    }
    await input(container.querySelector('#pricing-room-count'), '20')
    assert.equal(new URL(inquiry().href).searchParams.get('rooms'), '20')
  })
})

test('plain Contact is empty and a valid reference is sent only after the visitor explicitly submits', async () => {
  await withMarketing('/contact', async ({ message, requests }) => {
    assert.equal(message().value, '')
    assert.equal(requests.length, 0)
  })
  await withMarketing(
    contactPath({ plan: 'QA Pro', rooms: '10', cycle: 'month' }),
    async ({ container, message, requests, posts, input, changeMessage, act, window }) => {
      assert.match(message().value, /QA Pro, 10 phòng, chu kỳ theo tháng/)
      assert.equal(requests.length, 0)
      await changeMessage('Please discuss this plan with us.')
      await input(container.querySelector('[name="name"]'), 'QA Visitor')
      await input(container.querySelector('[name="email"]'), 'qa@example.test')
      await act(async () =>
        container
          .querySelector('form')
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
      )
      assert.equal(posts().length, 1)
      assert.deepEqual(posts()[0].body, {
        name: 'QA Visitor',
        email: 'qa@example.test',
        phone: '',
        hotel: '',
        message: 'Please discuss this plan with us.',
      })
      assert.match(container.querySelector('[role="status"]').textContent, /gửi/i)
    },
  )
})

test('Contact ignores incomplete, ambiguous, oversized and unsafe URL references', async (t) => {
  const normal = { plan: 'QA Pro', rooms: '10', cycle: 'month' }
  const paths = [
    ['markup', contactPath({ ...normal, plan: '<img src=x onerror=alert(1)>' })],
    ['control character', contactPath({ ...normal, plan: 'QA\nPro' })],
    ['bidi control', contactPath({ ...normal, plan: 'QA\u202ePro' })],
    ['oversized name', contactPath({ ...normal, plan: 'Q'.repeat(161) })],
    ['invalid cycle', contactPath({ ...normal, cycle: 'weekly' })],
    ['zero rooms', contactPath({ ...normal, rooms: '0' })],
    ['exponent', contactPath({ ...normal, rooms: '1e3' })],
    ['oversized rooms', contactPath({ ...normal, rooms: '1000001' })],
    ['missing cycle', contactPath({ plan: 'QA Pro', rooms: '10' })],
    ['duplicate parameter', contactPath(normal) + '&rooms=20'],
  ]
  for (const [name, path] of paths)
    await t.test(name, async () =>
      withMarketing(path, async ({ container, message, requests }) => {
        assert.equal(message().value, '')
        assert.equal(container.querySelector('script, img'), null)
        assert.equal(requests.length, 0)
      }),
    )
})
