import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

test('Channex contact form blocks letters in phones and validates email before calling the provider', async () => {
  await withDraftDom(async ({ React, load, mount, input, act, window }) => {
    const { default: Editor } = await load(
      '/src/apps/manager/channex/components/CreatePropertyEditor.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const calls = []
    const context = {
      user: { globalRole: 'SUPER_ADMIN' },
      createChannexProperty: async (value) => {
        calls.push(value)
        return { property: { id: 'created' } }
      },
    }
    const { container } = await mount(
      React.createElement(
        PmsContext.Provider,
        { value: context },
        React.createElement(Editor, {
          account: { id: 'system:staging', configured: true },
          hotel: { name: 'Test hotel' },
          onCreated() {},
          onClose() {},
        }),
      ),
    )
    const phone = container.querySelector('input[type="tel"]'),
      email = container.querySelector('input[type="email"]')
    await input(phone, '0901234567')
    await input(phone, '0901234567A')
    assert.equal(phone.value, '0901234567')
    await input(email, 'invalid')
    await act(async () =>
      container
        .querySelector('form')
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    )
    assert.equal(calls.length, 0)
    assert.match(container.querySelector('[role="alert"]').textContent, /email/i)
    await input(email, 'a..b@example.test')
    assert.equal(email.checkValidity(), false)
    await input(email, 'valid@example.test')
    for (const value of ['123456', '1234567890123456']) {
      await input(phone, value)
      assert.equal(phone.checkValidity(), false, value)
      await act(async () =>
        container
          .querySelector('form')
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
      )
      assert.equal(calls.length, 0)
      assert.match(container.querySelector('[role="alert"]').textContent, /điện thoại/i)
    }
    await input(phone, '0901234567')
    await act(async () => container.querySelector('form').requestSubmit())
    assert.equal(calls.length, 1)
    assert.equal(calls[0].phone, '0901234567')
  })
})

test('catalog input errors leave room and rate forms editable for correction without a provider write', async () => {
  await withDraftDom(async ({ React, load, mount, input, act, window }) => {
    const { default: Editor } = await load('/src/apps/manager/channex/components/CatalogEditor.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    for (const kind of ['room', 'rate']) {
      const calls = [],
        save = async (...args) => {
          calls.push(args)
        }
      const view = await mount(
        React.createElement(
          PmsContext.Provider,
          { value: { saveChannexRoomType: save, saveChannexRatePlan: save } },
          React.createElement(Editor, {
            kind,
            item: {},
            account: { id: 'system:staging' },
            property: { id: 'property-a', currency: 'VND' },
            rooms: [{ id: 'room-a', name: 'Room A' }],
            onSaved() {},
            onClose() {},
          }),
        ),
      )
      const name = view.container.querySelector('input')
      await input(name, '   ')
      if (kind === 'rate')
        await input(view.container.querySelector('input[inputmode="decimal"]'), '123.4500')
      await act(async () =>
        view.container
          .querySelector('form')
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
      )
      assert.equal(calls.length, 0)
      assert.equal(view.container.querySelector('fieldset').disabled, false)
      await input(name, 'Valid name')
      await act(async () => view.container.querySelector('form').requestSubmit())
      assert.equal(calls.length, 1)
      if (kind === 'rate') assert.equal(calls[0][2].rate, '123.4500')
      await view.unmount()
    }
  })
})

test('Channex property form offers popular currencies and forwards the selected currency unchanged', async () => {
  await withDraftDom(async ({ React, load, mount, input, act }) => {
    const { default: Editor } = await load(
      '/src/apps/manager/channex/components/CreatePropertyEditor.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const calls = [],
      created = []
    const context = {
      user: { globalRole: 'SYSTEM_MANAGER' },
      createChannexProperty: async (value) => {
        calls.push(value)
        return { property: { id: 'created', currency: value.currency } }
      },
    }
    const { container } = await mount(
      React.createElement(
        PmsContext.Provider,
        { value: context },
        React.createElement(Editor, {
          account: { id: 'system:staging', configured: true },
          hotel: { name: 'Test hotel', currency: 'EUR' },
          onCreated(value) {
            created.push(value)
          },
          onClose() {},
        }),
      ),
    )
    const currency = container.querySelector('select')
    assert.equal(currency.value, 'EUR')
    const choices = [...currency.options].map((option) => option.value)
    for (const code of ['VND', 'USD', 'EUR', 'GBP', 'JPY', 'KRW', 'SGD', 'THB', 'AUD'])
      assert.ok(choices.includes(code), code)
    await input(currency, 'THB')
    await act(async () => container.querySelector('form').requestSubmit())
    assert.equal(calls.length, 1)
    assert.equal(calls[0].currency, 'THB')
    assert.equal(calls[0].accountId, 'system:staging')
    assert.equal(created[0].currency, 'THB')
  })
})
