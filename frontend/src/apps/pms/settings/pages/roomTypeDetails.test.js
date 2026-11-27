import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

async function withRoomTypes(overrides, callback) {
  await withDraftDom(async (tools) => {
    const { React, load, mount, act, window } = tools
    const { default: RoomTypesGrid } = await load('/src/apps/pms/settings/pages/RoomTypesGrid.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const store = await load('/src/shared/i18n/store.js')
    const previousLocale = store.getLocale()
    await act(async () => store.setLocale('vi'))
    const calls = []
    const value = {
      settings: { currency: 'VND' },
      access: () => ({ allowed: true }),
      roomTypes: [],
      rooms: [],
      bedTypes: [],
      saveMaster: async (...args) => {
        calls.push(args)
        return { id: 'new-bed', ...args[1] }
      },
      ...overrides,
    }
    const view = await mount(
      React.createElement(PmsContext.Provider, { value }, React.createElement(RoomTypesGrid)),
    )
    const submit = async () =>
      act(async () =>
        view.container
          .querySelector('form')
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
      )
    try {
      await callback({ ...tools, ...view, calls, submit })
    } finally {
      await view.unmount()
      await act(async () => store.setLocale(previousLocale))
    }
  })
}

test('room type form selects configured floors and beds and submits room numbers with their selections', async () => {
  await withRoomTypes(
    {
      rooms: [
        { id: '101', floor: '10' },
        { id: '201', floor: '2' },
      ],
      bedTypes: [
        { id: 'queen', name: 'Queen' },
        { id: 'old', name: 'Old bed', active: false },
      ],
    },
    async ({ container, click, input, calls, submit }) => {
      await click(container.querySelector('.pms-catalog-heading button'))
      const floor = container.querySelector('select[id$="-floor"]')
      assert.deepEqual(
        [...floor.options].map((option) => option.value),
        ['', '2', '10'],
      )
      const bed = container.querySelector('select[id$="-bedTypeId"]')
      assert.equal(bed.querySelector('option[value="old"]').disabled, true)
      await input(container.querySelector('input[id$="-code"]'), 'DLX')
      await input(container.querySelector('input[id$="-name"]'), 'Deluxe')
      await input(container.querySelector('input[id$="-roomNumbers"]'), 'R201, 202')
      await input(floor, '2')
      await input(bed, 'queen')
      await submit()
      assert.equal(calls.length, 1)
      assert.equal(calls[0][0], 'roomTypes')
      assert.deepEqual(calls[0][1], {
        code: 'DLX',
        name: 'Deluxe',
        roomNumbers: ['201', '202'],
        floor: '2',
        bedTypeId: 'queen',
        capacity: 2,
        price: '0',
      })
      assert.equal(container.querySelector('form'), null)
    },
  )
})

test('inline floor and bed creation preserves the room draft across errors and selects newly saved options', async () => {
  let attempts = 0
  const writes = []
  await withRoomTypes(
    {
      saveMaster: async (catalog, row) => {
        writes.push([catalog, row])
        if (catalog === 'bedTypes' && ++attempts === 1) throw new Error('Bed could not be saved')
        return { id: 'new-bed', ...row }
      },
    },
    async ({ container, click, input, submit }) => {
      await click(container.querySelector('.pms-catalog-heading button'))
      await input(container.querySelector('input[id$="-code"]'), 'PENT')
      await input(container.querySelector('input[id$="-name"]'), 'Penthouse')
      await click(container.querySelector('button[aria-label="Thêm mới: Tầng"]'))
      await input(container.querySelector('.pms-catalog-create-option input'), ' Roof ')
      assert.equal(container.querySelector('button[type="submit"]').disabled, true)
      await submit()
      assert.equal(writes.length, 0)
      await click(container.querySelector('.pms-catalog-create-option .is-primary'))
      assert.equal(container.querySelector('select[id$="-floor"]').value, 'Roof')
      assert.equal(writes.length, 0)
      await click(container.querySelector('button[aria-label="Thêm mới: Loại giường"]'))
      await input(container.querySelector('.pms-catalog-create-option input'), 'King')
      await click(container.querySelector('.pms-catalog-create-option .is-primary'))
      assert.match(container.querySelector('[role="alert"]').textContent, /Bed could not be saved/)
      assert.equal(container.querySelector('input[id$="-name"]').value, 'Penthouse')
      assert.equal(container.querySelector('.pms-catalog-create-option input').value, 'King')
      await click(container.querySelector('.pms-catalog-create-option .is-primary'))
      assert.equal(container.querySelector('select[id$="-bedTypeId"]').value, 'new-bed')
      assert.equal(container.querySelector('button[type="submit"]').disabled, false)
      await submit()
      assert.deepEqual(
        writes.map(([catalog]) => catalog),
        ['bedTypes', 'bedTypes', 'roomTypes'],
      )
      assert.equal(writes[2][1].floor, 'Roof')
      assert.equal(writes[2][1].bedTypeId, 'new-bed')
    },
  )
})

test('inline creation reuses existing names and refuses inactive duplicates', async () => {
  await withRoomTypes(
    {
      bedTypes: [
        { id: 'queen', name: 'Queen' },
        { id: 'old', name: 'Old bed', active: false },
      ],
    },
    async ({ container, click, input, calls }) => {
      await click(container.querySelector('.pms-catalog-heading button'))
      const addBed = () => container.querySelector('button[aria-label="Thêm mới: Loại giường"]')
      await click(addBed())
      await input(container.querySelector('.pms-catalog-create-option input'), ' queen ')
      await click(container.querySelector('.pms-catalog-create-option .is-primary'))
      assert.equal(container.querySelector('select[id$="-bedTypeId"]').value, 'queen')
      assert.equal(calls.length, 0)
      await click(addBed())
      await input(container.querySelector('.pms-catalog-create-option input'), 'OLD BED')
      await click(container.querySelector('.pms-catalog-create-option .is-primary'))
      assert.match(container.querySelector('[role="alert"]').textContent, /ngừng sử dụng/)
      assert.equal(calls.length, 0)
      assert.equal(container.querySelector('select[id$="-bedTypeId"]').value, 'queen')
    },
  )
})

const existingType = {
  id: 'rt-a',
  code: 'STD',
  name: 'Standard',
  floor: '2',
  bedTypeId: 'queen',
  capacity: 2,
  price: '100.0000',
}
const existingRoom = { id: '101', typeId: 'rt-a', floor: '10' }

test('editing a room type preserves per-room floors when the default is unchanged', async () => {
  await withRoomTypes(
    {
      roomTypes: [existingType],
      rooms: [existingRoom],
      bedTypes: [{ id: 'queen', name: 'Queen', active: false }],
    },
    async ({ container, click, input, calls, submit }) => {
      await click(container.querySelector('.pms-catalog-edit'))
      assert.equal(container.querySelector('select[id$="-floor"]').value, '2')
      assert.equal(container.querySelector('select[id$="-bedTypeId"]').value, 'queen')
      await input(container.querySelector('input[id$="-price"]'), '250')
      await submit()
      assert.equal(calls.length, 1)
      assert.equal(Object.hasOwn(calls[0][1], 'floor'), false)
      assert.equal(calls[0][1].bedTypeId, 'queen')
      assert.deepEqual(calls[0][1].roomNumbers, ['101'])
      assert.equal(existingRoom.floor, '10')
    },
  )
})

test('room type floor and bed can be cleared explicitly', async () => {
  await withRoomTypes(
    {
      roomTypes: [existingType],
      rooms: [existingRoom],
      bedTypes: [{ id: 'queen', name: 'Queen' }],
    },
    async ({ container, click, input, calls, submit }) => {
      await click(container.querySelector('.pms-catalog-edit'))
      await input(container.querySelector('select[id$="-floor"]'), '')
      await input(container.querySelector('select[id$="-bedTypeId"]'), '')
      await submit()
      assert.equal(calls[0][1].floor, null)
      assert.equal(calls[0][1].bedTypeId, null)
    },
  )
})

test('read-only users can view room type details without add or edit actions', async () => {
  await withRoomTypes(
    {
      access: () => ({ allowed: false }),
      roomTypes: [existingType],
      bedTypes: [{ id: 'queen', name: 'Queen' }],
    },
    async ({ container }) => {
      assert.match(container.querySelector('tbody').textContent, /Queen/)
      assert.equal(container.querySelector('.pms-catalog-heading button'), null)
      assert.equal(container.querySelector('.pms-catalog-edit'), null)
      assert.equal(container.querySelector('form'), null)
    },
  )
})
