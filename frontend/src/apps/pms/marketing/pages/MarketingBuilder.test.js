import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

function documentFixture(name = 'Hotel A') {
  return {
    schemaVersion: 1,
    locale: 'vi',
    slug: 'gioi-thieu',
    seo: { title: name, description: 'Confirmed description' },
    brand: { name, theme: 'calm-blue' },
    cta: { label: 'Liên hệ', url: 'tel:+84901234567' },
    sections: [
      {
        id: 'hero-main',
        type: 'hero',
        heading: name,
        body: 'Welcome',
        imageUrl: '',
        imageAlt: '',
        visible: true,
      },
    ],
  }
}

async function withBuilder(callback) {
  const dom = new JSDOM('<!doctype html><html><body><div id="test-root"></div></body></html>', {
    url: 'http://localhost/id/marketing/pages/page-a/edit',
  })
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  let server, root
  try {
    server = await createServer({
      configFile: false,
      plugins: [react()],
      server: { middlewareMode: true, watch: null },
      appType: 'custom',
    })
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter, Routes, Route } = await import('react-router-dom')
    const { PmsContext } = await server.ssrLoadModule('/src/apps/pms/data/usePms.js')
    const { default: Builder } = await server.ssrLoadModule(
      '/src/apps/pms/marketing/pages/MarketingBuilder.jsx',
    )
    const container = dom.window.document.getElementById('test-root')
    root = createRoot(container)
    const render = async (value) =>
      React.act(async () => {
        root.render(
          React.createElement(
            PmsContext.Provider,
            { value },
            React.createElement(
              MemoryRouter,
              { initialEntries: ['/id/marketing/pages/page-a/edit'] },
              React.createElement(
                Routes,
                null,
                React.createElement(Route, {
                  path: '/id/marketing/pages/:pageId/edit',
                  element: React.createElement(Builder),
                }),
              ),
            ),
          ),
        )
      })
    const settle = () =>
      React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
      })
    const click = async (button) => {
      assert.ok(button)
      await React.act(async () => button.click())
      await settle()
    }
    await callback({ container, render, settle, click })
  } finally {
    if (root) {
      const { act } = await import('react')
      await act(async () => root.unmount())
    }
    if (server) await server.close()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

test('builder requires checklist approval before publication and sends the approved snapshot', async () => {
  await withBuilder(async ({ container, render, settle, click }) => {
    const calls = []
    let page = {
      id: 'page-a',
      name: 'Trang của Hotel A',
      version: 2,
      revisionNumber: 1,
      workingRevisionId: 'rev-a',
      publishedReleaseId: null,
      publishedUrl: null,
      review: null,
      document: documentFixture(),
    }
    const request = async (path, options = {}) => {
      calls.push({ path, ...options })
      if (path === '/pages/page-a') return structuredClone(page)
      if (path === '/templates')
        return {
          templates: [{ id: 'hotel', name: 'Giới thiệu', prompt: 'Write using confirmed facts' }],
          aiAvailable: false,
        }
      if (path.endsWith('/preview')) return { html: '<h1>Hotel A</h1>' }
      if (path.endsWith('/review-requests'))
        return {
          artifactId: 'artifact-a',
          manifestHash: 'hash-a',
          html: '<h1>Hotel A approved snapshot</h1>',
          publicPath: '/p/hotel-a/gioi-thieu',
        }
      if (path.endsWith('/reviews')) {
        page = {
          ...page,
          version: 3,
          review: {
            id: 'approval-a',
            decision: 'approved',
            artifactId: 'artifact-a',
            manifestHash: 'hash-a',
          },
        }
        return structuredClone(page)
      }
      if (path.endsWith('/publish')) {
        page = {
          ...page,
          version: 4,
          publishedReleaseId: 'release-a',
          publishedRevisionId: 'rev-a',
          publishedUrl: '/p/hotel-a/gioi-thieu',
        }
        return structuredClone(page)
      }
      throw new Error('Unexpected request: ' + path)
    }
    await render({
      marketingRequest: request,
      tenantId: 'hotel-a',
      tenant: { name: 'Hotel A' },
      authGeneration: 1,
    })
    await settle()
    const button = (text) =>
      [...container.querySelectorAll('button')].find((item) => item.textContent === text)
    assert.equal(button('Tạo toàn trang').disabled, true)
    await click(button('Xem trước & duyệt'))
    assert.equal(button('Xuất bản v1').disabled, true)
    assert.match(container.querySelector('iframe').getAttribute('srcdoc'), /approved snapshot/)
    for (const check of container.querySelectorAll('.mk-checklist input')) await click(check)
    await click(button('Duyệt v1'))
    assert.equal(button('Xuất bản v1').disabled, false)
    await click(button('Xuất bản v1'))
    const publication = calls.find((call) => call.path.endsWith('/publish'))
    assert.equal(publication.body.approvalId, 'approval-a')
    assert.equal(publication.body.manifestHash, 'hash-a')
    assert.ok(publication.intent)
    assert.match(container.textContent, /Đã xuất bản phiên bản v1/)
  })
})

test('switching tenant discards pending view results from the previous hotel', async () => {
  await withBuilder(async ({ container, render, settle }) => {
    let finishOld
    const oldRequest = (path) =>
      path === '/templates'
        ? Promise.resolve({ templates: [], aiAvailable: false })
        : new Promise((resolve) => {
            finishOld = resolve
          })
    const newPage = {
      id: 'page-a',
      name: 'Trang Hotel B',
      version: 2,
      revisionNumber: 1,
      workingRevisionId: 'rev-b',
      publishedReleaseId: null,
      document: documentFixture('Hotel B'),
    }
    const nextRequest = async (path) =>
      path === '/templates'
        ? { templates: [], aiAvailable: false }
        : path.endsWith('/preview')
          ? { html: '<h1>Hotel B</h1>' }
          : newPage
    await render({
      marketingRequest: oldRequest,
      tenantId: 'hotel-a',
      tenant: { name: 'Hotel A' },
      authGeneration: 1,
    })
    await settle()
    assert.equal(typeof finishOld, 'function')
    await render({
      marketingRequest: nextRequest,
      tenantId: 'hotel-b',
      tenant: { name: 'Hotel B' },
      authGeneration: 1,
    })
    await settle()
    finishOld({ ...newPage, name: 'Private Hotel A content', document: documentFixture('Hotel A') })
    await settle()
    assert.match(container.textContent, /Trang Hotel B/)
    assert.doesNotMatch(container.textContent, /Private Hotel A content/)
  })
})
