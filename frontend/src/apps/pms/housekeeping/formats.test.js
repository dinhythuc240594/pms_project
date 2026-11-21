import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter } from 'react-router-dom'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

test('housekeeping staff uses day-first filters, blocks stale date actions and validates optional phone', async () => {
  await withDraftDom(async ({ React, load, mount, input, click, act, window }) => {
    const { default: Page } = await load('/src/apps/pms/housekeeping/pages/HousekeepingStaff.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const reads = [],
      saved = [],
      shifts = []
    const context = {
      tenantId: 'hotel-a',
      settings: { timezone: 'UTC' },
      housekeepingStaff: [{ id: 'staff-a', name: 'Existing staff', phone: '', active: true }],
      housekeepingShifts: [],
      users: [],
      access: () => ({ allowed: true }),
      requestTenant: async (path) => {
        reads.push(path)
        return { shifts: [] }
      },
      saveHousekeepingStaff: async (value) => {
        saved.push(value)
      },
      saveHousekeepingShift: async (value) => {
        shifts.push(value)
        return { created: 1 }
      },
    }
    const { container } = await mount(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(PmsContext.Provider, { value: context }, React.createElement(Page)),
      ),
    )
    const date = container.querySelector('input[placeholder="dd/MM/yyyy"]')
    assert.match(date.value, /^\d{2}\/\d{2}\/\d{4}$/)
    const readCount = reads.length
    await input(date, '31/02/2026')
    assert.equal(date.checkValidity(), false)
    assert.equal(reads.length, readCount)
    const addShift = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Thêm ca'),
    )
    assert.equal(addShift.disabled, true)
    await input(date, '01/02/2028')
    assert.ok(reads.at(-1).includes('2028-02-01'))
    await click(
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent.includes('Thêm nhân viên'),
      ),
    )
    const dialog = container.querySelector('dialog')
    await input(dialog.querySelector('input[autocomplete="name"]'), 'Test staff')
    const phone = dialog.querySelector('[type="tel"]')
    await input(phone, '0901234567')
    await input(phone, '0901234567A')
    assert.equal(phone.value, '0901234567')
    await input(phone, '1')
    await act(async () =>
      dialog
        .querySelector('form')
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    )
    assert.equal(saved.length, 0)
    await input(phone, '+84 900 123')
    await act(async () => dialog.querySelector('form').requestSubmit())
    assert.equal(saved[0].phone, '+84 900 123')
    await click(addShift)
    const shift = container.querySelector('dialog')
    await input(shift.querySelector('select'), 'staff-a')
    const [start, end] = shift.querySelectorAll('input[placeholder="HH:mm"]')
    assert.equal(start.value, '08:00')
    await input(start, '25:00')
    assert.equal(start.checkValidity(), false)
    await act(async () =>
      shift
        .querySelector('form')
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    )
    assert.equal(shifts.length, 0)
    await input(start, '14:00')
    await input(end, '13:00')
    await act(async () => shift.querySelector('form').requestSubmit())
    assert.equal(shifts.length, 0)
    await input(start, '08:30')
    await input(end, '16:00')
    await act(async () => shift.querySelector('form').requestSubmit())
    assert.equal(shifts[0].date, '2028-02-01')
    assert.equal(shifts[0].startTime, '08:30')
  })
})
