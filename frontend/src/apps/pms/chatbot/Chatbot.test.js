import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'
import { conversationInput, embedPath } from './context.js'
import { dictionaries } from '../../../shared/i18n/core.js'

async function withChatDom(callback) {
  return withDraftDom(async (env) => {
    const { setLocale } = await env.load('/src/shared/i18n/store.js')
    setLocale('vi')
    await callback(env)
  })
}

test('chatbot labels exist consistently in all supported languages', () => {
  const expected = Object.keys(dictionaries.vi)
    .filter((key) => key.startsWith('chatbot.'))
    .sort()
  assert.ok(expected.length > 0)
  for (const dictionary of Object.values(dictionaries)) {
    assert.deepEqual(
      Object.keys(dictionary)
        .filter((key) => key.startsWith('chatbot.'))
        .sort(),
      expected,
    )
    for (const key of expected)
      assert.ok(typeof dictionary[key] === 'string' && dictionary[key].trim())
  }
})

test('chat context is bounded and the iframe targets an owned route', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(4000),
  }))
  const input = conversationInput(messages, 'Question', 'vi')
  assert.equal(input.messages[0].role, 'user')
  assert.equal(input.messages.at(-1).content, 'Question')
  assert.ok(input.messages.length <= 12)
  assert.ok(input.messages.reduce((sum, item) => sum + item.content.length, 0) <= 16000)
  assert.equal(embedPath('hotel a'), '/id/chatbot/embed?tenant=hotel+a')
})

test('header opens a right iframe, close returns focus, reopen preserves it and tenant change resets it', async () => {
  await withChatDom(async ({ React, load, mount, click, document }) => {
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { MemoryRouter } = await import('react-router-dom')
    const { default: Workspace } = await load('/src/apps/pms/chatbot/ChatbotWorkspace.jsx')
    const requestTenant = async () => ({ items: [], unreadCount: 0, nextBefore: null })
    function Harness() {
      const [tenantId, update] = React.useState('hotel-a')
      const value = {
        tenantId,
        tenant: { id: tenantId, name: tenantId },
        hotels: [{ id: tenantId, name: tenantId }],
        selectTenant: async () => {},
        user: { id: 'user', name: 'Owner' },
        role: 'HOTEL_OWNER',
        requestTenant,
        access: () => ({ allowed: true }),
        settingsPath: '/id/settings',
        logout: async () => {},
      }
      return React.createElement(
        PmsContext.Provider,
        { value },
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(
            Workspace,
            { key: tenantId, tenantId },
            React.createElement(
              'main',
              { id: 'pms-main-content' },
              'PMS content',
              React.createElement(
                'button',
                { type: 'button', 'data-switch-tenant': true, onClick: () => update('hotel-b') },
                'Switch hotel',
              ),
            ),
          ),
        ),
      )
    }
    const mounted = await mount(React.createElement(Harness))
    const trigger = () => mounted.container.querySelector('[aria-label="Mở trợ lý Codex"]')
    assert.equal(mounted.container.querySelector('iframe'), null)
    await click(trigger())
    const frame = mounted.container.querySelector('iframe')
    assert.equal(frame.getAttribute('src'), '/id/chatbot/embed?tenant=hotel-a')
    assert.equal(trigger().getAttribute('aria-expanded'), 'true')
    await click(mounted.container.querySelector('[aria-label="Đóng trợ lý"]'))
    assert.equal(document.activeElement, trigger())
    assert.equal(mounted.container.querySelector('#pms-chatbot-sidebar').hidden, true)
    await click(trigger())
    assert.equal(mounted.container.querySelector('iframe'), frame)
    await click(mounted.container.querySelector('[data-switch-tenant]'))
    assert.equal(mounted.container.querySelector('iframe'), null)
    await click(trigger())
    assert.equal(
      mounted.container.querySelector('iframe').getAttribute('src'),
      '/id/chatbot/embed?tenant=hotel-b',
    )
    assert.notEqual(mounted.container.querySelector('iframe'), frame)
  })
})

test('conversation sends user input once and renders the answer as inert text', async () => {
  await withChatDom(async ({ React, act, load, mount, click, window }) => {
    const { ChatConversation } = await load('/src/apps/pms/chatbot/ChatbotEmbed.jsx')
    const calls = []
    const request = async (path, options) => {
      if (path.endsWith('/config')) return { available: true }
      calls.push(options)
      return { reply: { role: 'assistant', content: '<script>alert("unsafe")</script>' } }
    }
    const mounted = await mount(React.createElement(ChatConversation, { request }))
    const textarea = mounted.container.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(
        textarea,
        'Explain the PMS',
      )
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await click(mounted.container.querySelector('button[type="submit"]'))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].body.messages.at(-1).content, 'Explain the PMS')
    assert.ok(calls[0].intent)
    assert.match(mounted.container.textContent, /<script>alert/)
    assert.equal(mounted.container.querySelector('script'), null)
  })
})

test('checking a failed request preserves its intent and does not append the user message twice', async () => {
  await withChatDom(async ({ React, act, load, mount, click, window }) => {
    const { ChatConversation } = await load('/src/apps/pms/chatbot/ChatbotEmbed.jsx')
    const keys = []
    const request = async (path, options) => {
      if (path.endsWith('/config')) return { available: true }
      keys.push(options.intent)
      if (keys.length === 1) throw new Error('Connection interrupted')
      return { reply: { role: 'assistant', content: 'Recovered answer' } }
    }
    const mounted = await mount(React.createElement(ChatConversation, { request }))
    const textarea = mounted.container.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(
        textarea,
        'A question',
      )
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await click(mounted.container.querySelector('button[type="submit"]'))
    await click(
      [...mounted.container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Kiểm tra lại yêu cầu',
      ),
    )
    assert.equal(keys[0], keys[1])
    assert.equal(mounted.container.querySelectorAll('.is-user').length, 1)
    assert.match(mounted.container.textContent, /Recovered answer/)
  })
})

test('an unconfigured assistant disables sending and never fabricates a response', async () => {
  await withChatDom(async ({ React, load, mount }) => {
    const { ChatConversation } = await load('/src/apps/pms/chatbot/ChatbotEmbed.jsx')
    const calls = []
    const request = async (path) => {
      calls.push(path)
      return { available: false }
    }
    const mounted = await mount(React.createElement(ChatConversation, { request }))
    assert.equal(mounted.container.querySelector('button[type="submit"]').disabled, true)
    assert.match(mounted.container.textContent, /Trợ lý chưa được quản trị viên bật/)
    assert.deepEqual(calls, ['/chatbot/config'])
    assert.equal(mounted.container.querySelectorAll('.is-assistant').length, 0)
  })
})
