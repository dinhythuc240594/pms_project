import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter } from 'react-router-dom'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

test('housekeeping has no dead bulk selectors or filter button and keeps live filters and task links', async () => {
  await withDraftDom(async ({ React, load, mount, click, input }) => {
    const { default: Housekeeping } = await load(
      '/src/apps/pms/housekeeping/pages/Housekeeping.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const date = new Date().toISOString().slice(0, 10),
      at = `${date}T10:00:00Z`
    const context = {
      settings: { timezone: 'UTC' },
      rooms: [
        { id: '101', typeId: 'standard', condition: 'dirty' },
        { id: '102', typeId: 'standard', condition: 'clean' },
      ],
      bookings: [],
      roomTypes: [{ id: 'standard', name: 'Standard' }],
      housekeepingTasks: [
        { id: 'task-a', room: '101', date, status: 'pending', note: 'Needs assignment' },
      ],
      housekeepingStaff: [],
      housekeepingLog: [
        { id: 'l1', room: '101', condition: 'dirty', createdAt: at, actor: 'Staff A' },
        { id: 'l2', room: '102', condition: 'clean', createdAt: at, actor: 'Staff B' },
      ],
      housekeepingWorkLogs: [],
      access: () => ({ allowed: true }),
      runAction: async (_key, _feature, action) => action(),
    }
    const view = await mount(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          PmsContext.Provider,
          { value: context },
          React.createElement(Housekeeping),
        ),
      ),
    )
    const headers = () => [...view.container.querySelectorAll('thead th')]
    assert.equal(headers().length, 6)
    assert.equal(view.container.querySelectorAll('input[type="checkbox"]').length, 0)
    for (const row of view.container.querySelectorAll('tbody tr'))
      assert.equal(row.children.length, 6)
    const taskLink = view.container.querySelector('a.hk-room-task-link')
    const params = new URL(taskLink.href).searchParams
    assert.equal(params.get('task'), 'task-a')
    assert.equal(params.get('date'), date)
    await click(
      [...view.container.querySelectorAll('button')].find((button) =>
        button.textContent.includes('Lịch sử'),
      ),
    )
    assert.equal(headers().length, 5)
    assert.equal(
      [...view.container.querySelectorAll('button')].some(
        (button) => button.textContent.trim() === 'Lọc',
      ),
      false,
    )
    assert.equal(view.container.querySelectorAll('tbody tr').length, 2)
    const room = [...view.container.querySelectorAll('select')].find((select) =>
      [...select.options].some((option) => option.value === 'R-101'),
    )
    await input(room, 'R-101')
    assert.equal(view.container.querySelectorAll('tbody tr').length, 1)
    assert.match(view.container.querySelector('tbody').textContent, /Staff A/)
    assert.doesNotMatch(view.container.querySelector('tbody').textContent, /Staff B/)
  })
})
