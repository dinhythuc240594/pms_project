import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter } from 'react-router-dom'
import { withDraftDom } from '../../shared/drafts/testDom.js'

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function withContact(send, callback) {
  await withDraftDom(async (context) => {
    const { React, act, window, load, mount, input } = context
    const previousFetch = globalThis.fetch
    const requests = []
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/public/contact')
      assert.equal(options.method, 'POST')
      const body = JSON.parse(options.body)
      requests.push(body)
      return send(body, requests.length)
    }
    try {
      const { setLocale } = await load('/src/shared/i18n/store.js')
      setLocale('vi')
      const { default: Contact } = await load('/src/apps/marketing/Contact.jsx')
      const view = await mount(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/contact'] },
          React.createElement(Contact),
        ),
      )
      const field = (name) => view.container.querySelector(`[name="${name}"]`)
      async function change(name, value) {
        const element = field(name)
        assert.ok(element, `Missing contact field: ${name}`)
        if (element.tagName !== 'TEXTAREA') return input(element, value)
        await act(async () => {
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(
            element,
            value,
          )
          element.dispatchEvent(new window.Event('input', { bubbles: true }))
        })
      }
      async function fill(overrides = {}) {
        const values = {
          name: '  Test Visitor  ',
          email: 'Visitor@Example.test',
          phone: '+84 900 123 456',
          hotel: '  Test Hotel  ',
          message: '  Please send information about LOHA.  ',
          ...overrides,
        }
        for (const [name, value] of Object.entries(values)) await change(name, value)
      }
      async function submit() {
        await act(async () => {
          view.container
            .querySelector('form')
            .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
        })
      }
      const button = () => view.container.querySelector('button[type="submit"]')
      await callback({ ...context, ...view, requests, field, change, fill, submit, button })
    } finally {
      globalThis.fetch = previousFetch
    }
  })
}

test('contact sends the visitor phone to the public endpoint and waits for acceptance without duplicate posts', async () => {
  const delivery = deferred()
  await withContact(
    () => delivery.promise,
    async ({ container, act, requests, field, fill, submit, button, change }) => {
      assert.equal(field('phone').type, 'tel')
      assert.ok(container.querySelector('a[href="mailto:info@lohapms.com"]'))
      await fill()
      await submit()
      assert.equal(requests.length, 1)
      assert.deepEqual(requests[0], {
        name: 'Test Visitor',
        email: 'visitor@example.test',
        phone: '+84 900 123 456',
        hotel: 'Test Hotel',
        message: 'Please send information about LOHA.',
      })
      assert.ok(button().matches(':disabled'))
      assert.doesNotMatch(container.querySelector('[role="status"]')?.textContent || '', /Đã gửi/)
      await submit()
      assert.equal(requests.length, 1)
      await act(async () => delivery.resolve(Response.json({ sent: true })))
      assert.match(container.querySelector('[role="status"]').textContent, /gửi/i)
      assert.equal(container.querySelector('[role="alert"]'), null)
      assert.equal(field('message').value, '  Please send information about LOHA.  ')
      assert.ok(
        button().matches(':disabled'),
        'a successful request must not be accidentally sent again',
      )
      await change('hotel', 'Test Hotel Annex')
      assert.equal(button().matches(':disabled'), false)
    },
  )
})

test('contact keeps the draft on delivery failure and allows a successful retry', async () => {
  await withContact(
    (_body, attempt) =>
      attempt === 1
        ? Response.json(
            { error: { code: 'contact_unavailable', message: 'Contact service unavailable' } },
            { status: 503 },
          )
        : Response.json({ sent: true }),
    async ({ container, requests, field, fill, submit, button }) => {
      await fill()
      await submit()
      assert.equal(requests.length, 1)
      assert.ok(container.querySelector('[role="alert"]')?.textContent.trim())
      assert.equal(field('email').value, 'Visitor@Example.test')
      assert.equal(field('phone').value, '+84 900 123 456')
      assert.equal(field('message').value, '  Please send information about LOHA.  ')
      assert.equal(button().matches(':disabled'), false)
      await submit()
      assert.equal(requests.length, 2)
      assert.deepEqual(requests[1], requests[0])
      assert.equal(container.querySelector('[role="alert"]'), null)
      assert.match(container.querySelector('[role="status"]').textContent, /gửi/i)
    },
  )
})

test('contact rejects whitespace messages and malformed phone numbers before sending', async () => {
  await withContact(
    () => {
      throw new Error('Invalid inputs must not send mail')
    },
    async ({ requests, fill, change, submit }) => {
      await fill({ message: ' \n\t ' })
      await submit()
      assert.equal(requests.length, 0)
      await change('message', 'Please send a demo.')
      await change('phone', '09012345ABC')
      await submit()
      assert.equal(requests.length, 0)
    },
  )
})

test('contact permits an empty optional phone and hotel while keeping required fields', async () => {
  await withContact(
    () => Response.json({ sent: true }),
    async ({ container, requests, field, fill, submit }) => {
      assert.equal(field('phone').required, false)
      await fill({ phone: '', hotel: '' })
      await submit()
      assert.equal(requests.length, 1)
      assert.equal(requests[0].phone, '')
      assert.equal(requests[0].hotel, '')
      assert.equal(requests[0].email, 'visitor@example.test')
      assert.match(container.querySelector('[role="status"]').textContent, /gửi/i)
    },
  )
})

test('contact does not report success for a response without sent confirmation', async () => {
  await withContact(
    () => Response.json({ sent: false }),
    async ({ container, requests, fill, submit, button }) => {
      await fill()
      await submit()
      assert.equal(requests.length, 1)
      assert.ok(container.querySelector('[role="alert"]')?.textContent.trim())
      assert.doesNotMatch(container.querySelector('[role="status"]')?.textContent || '', /Đã gửi/)
      assert.equal(button().matches(':disabled'), false)
    },
  )
})
