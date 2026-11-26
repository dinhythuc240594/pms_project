import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

test('check-in policy drafts are protected across settings tab navigation until saved or discarded', async () => {
  await withDraftDom(async ({ React, act, load, mount, click, input }) => {
    const { createMemoryRouter, RouterProvider, Outlet, useSearchParams } =
      await import('react-router-dom')
    const { DraftGuardProvider, DraftRouteGuard } = await load(
      '/src/shared/drafts/DraftGuardProvider.jsx',
    )
    const { BusinessPolicies } = await load('/src/apps/pms/settings/pages/BusinessSettings.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const h = React.createElement,
      saves = []
    let nextSave = async () => {}
    const value = {
      tenantId: 'hotel-a',
      user: { id: 'owner-a' },
      authGeneration: 1,
      settings: { checkInTime: '14:00', checkOutTime: '12:00', policies: 'No smoking' },
      access: () => ({ allowed: true }),
      saveSettings: (data) => {
        saves.push(data)
        return nextSave(data)
      },
    }
    function Shell() {
      return h(
        DraftGuardProvider,
        null,
        h(DraftRouteGuard),
        h(PmsContext.Provider, { value }, h(Outlet)),
      )
    }
    function Page() {
      const [params] = useSearchParams()
      return params.get('tab') === 'policies'
        ? h(BusinessPolicies, { key: value.tenantId })
        : h('p', null, 'Other settings tab')
    }
    const policies = '/id/settings?section=business&tab=policies',
      profile = '/id/settings?section=business&tab=profile'
    const router = createMemoryRouter(
      [{ path: '/id', element: h(Shell), children: [{ path: 'settings', element: h(Page) }] }],
      { initialEntries: [policies] },
    )
    const view = await mount(h(RouterProvider, { router }))
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    const go = async (path) => {
      await act(async () => {
        router.navigate(path)
      })
      await settle()
    }
    const where = () => router.state.location.pathname + router.state.location.search
    const dialog = () => view.container.querySelector('.draft-confirmation')
    const button = (text) =>
      [...view.container.querySelectorAll('button')].find((node) => node.textContent === text)
    const field = () => view.container.querySelector('#policy-checkin')
    const form = () => view.container.querySelector('form')

    // A clean form, and a form edited back to its saved value, leave without a prompt.
    await go(profile)
    assert.equal(where(), profile)
    assert.equal(dialog(), null)
    await go(policies)
    await input(field(), '15:00')
    await input(field(), '14:00')
    await go(profile)
    assert.equal(where(), profile)
    assert.equal(dialog(), null)

    // Dirty (even invalid) time text blocks a settings query change; keeping edits retains the draft.
    await go(policies)
    await input(field(), '9:5')
    await go(profile)
    assert.equal(where(), policies)
    assert.ok(dialog(), 'dirty policy edits prompt before switching tab')
    await click(button('Tiếp tục sửa'))
    await settle()
    assert.equal(dialog(), null)
    assert.equal(where(), policies)
    assert.equal(field().value, '9:5')

    // Discarding proceeds with the single requested navigation and does not carry the draft back.
    await go(profile)
    assert.ok(dialog())
    await click(button('Bỏ bản nháp'))
    await settle()
    assert.equal(where(), profile)
    assert.equal(dialog(), null)
    await go(policies)
    assert.equal(field().value, '14:00')
    assert.equal(saves.length, 0)

    // A failed save keeps the form dirty.
    nextSave = async () => {
      throw new Error('Save rejected')
    }
    await input(field(), '15:00')
    await act(async () => form().requestSubmit())
    await settle()
    assert.equal(saves.length, 1)
    assert.match(view.container.querySelector('[role="alert"]').textContent, /Save rejected/)
    await go(profile)
    assert.equal(where(), policies)
    assert.ok(dialog(), 'failed saves remain protected')
    await click(button('Tiếp tục sửa'))
    await settle()
    assert.equal(field().value, '15:00')

    // While the write is pending, the draft cannot be discarded and navigation stays blocked.
    const pending = Promise.withResolvers()
    nextSave = () => pending.promise
    await act(async () => form().requestSubmit())
    assert.equal(saves.length, 2)
    await go(profile)
    assert.equal(where(), policies)
    assert.ok(dialog())
    assert.equal(button('Bỏ bản nháp').disabled, true)
    await click(button('Bỏ bản nháp'))
    await settle()
    assert.equal(where(), policies)
    await click(button('Tiếp tục sửa'))
    await settle()
    assert.equal(where(), policies)

    // A successful save moves the baseline, so leaving is clean.
    await act(async () => pending.resolve())
    await settle()
    assert.equal(saves[1].checkInTime, '15:00')
    assert.equal(field().value, '15:00')
    await go(profile)
    assert.equal(where(), profile)
    assert.equal(dialog(), null)
    assert.equal(saves.length, 2)
    router.dispose()
  })
})
