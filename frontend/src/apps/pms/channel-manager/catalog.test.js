import test from 'node:test'
import assert from 'node:assert/strict'
import { mappingCatalogState } from './catalog.js'

const catalog = {
  roomTypes: [
    { id: 'remote-a', name: 'Couple' },
    { id: 'remote-b', name: 'Deluxe' },
  ],
  ratePlans: [
    { id: 'rate-a', roomTypeId: 'remote-a', supported: true },
    { id: 'rate-a-usd', roomTypeId: 'remote-a', supported: false },
    { id: 'rate-b', roomTypeId: 'remote-b', supported: true },
  ],
}
const draft = { roomTypeId: 'local-a', channexRoomTypeId: 'remote-a', channexRatePlanId: 'rate-a' }

test('rate choices belong to the selected remote room and require supported pricing', () => {
  const state = mappingCatalogState(catalog, [], draft)
  assert.deepEqual(
    state.ratePlans.map((rate) => [rate.id, rate.available]),
    [
      ['rate-a', true],
      ['rate-a-usd', false],
    ],
  )
  assert.equal(state.canSave, true)
  assert.equal(
    mappingCatalogState(catalog, [], { ...draft, channexRatePlanId: 'rate-b' }).canSave,
    false,
  )
  assert.equal(
    mappingCatalogState(catalog, [], { ...draft, channexRatePlanId: 'rate-a-usd' }).canSave,
    false,
  )
})

test('a remote target reserved by another local room cannot be chosen, even when paused', () => {
  const other = { ...draft, roomTypeId: 'local-b', active: false }
  const state = mappingCatalogState(catalog, [other], draft)
  assert.equal(state.roomTypes[0].available, false)
  assert.equal(state.ratePlans[0].available, false)
  assert.equal(state.canSave, false)
})

test('editing the current pair keeps its choices available and protects used identifiers', () => {
  const current = { ...draft, targetLocked: true }
  assert.equal(mappingCatalogState(catalog, [current], draft).canSave, true)
  assert.equal(
    mappingCatalogState(catalog, [current], {
      ...draft,
      channexRoomTypeId: 'remote-b',
      channexRatePlanId: 'rate-b',
    }).canSave,
    false,
  )
})

test('catalog failure never blocks pausing an unchanged saved target or unlocks new identifiers', () => {
  assert.equal(
    mappingCatalogState(null, [{ ...draft, targetLocked: true }], { ...draft, active: false })
      .canSave,
    true,
  )
  assert.equal(mappingCatalogState(null, [draft], { ...draft, active: false }).canSave, true)
  assert.equal(mappingCatalogState(null, [], draft).canSave, false)
  assert.equal(
    mappingCatalogState(null, [draft], { ...draft, channexRatePlanId: 'new-rate' }).canSave,
    false,
  )
  assert.equal(
    mappingCatalogState(catalog, [{ ...draft, pauseRequested: true }], draft).canSave,
    false,
  )
})

test('inbound choices accept explicitly selected derived plans for the same room and currency', () => {
  const rates = {
    ...catalog,
    ratePlans: [
      ...catalog.ratePlans.map((rate) => ({ ...rate, currency: 'VND' })),
      { id: 'derived', roomTypeId: 'remote-a', currency: 'VND', supported: false },
      { id: 'foreign', roomTypeId: 'remote-a', currency: 'USD', supported: false },
    ],
  }
  const state = mappingCatalogState(rates, [], { ...draft, inboundRatePlanIds: ['derived'] }, 'VND')
  assert.equal(state.canSave, true)
  assert.equal(
    state.inboundPlans.some((rate) => rate.id === 'derived'),
    true,
  )
  assert.equal(
    state.inboundPlans.some((rate) => rate.id === 'foreign'),
    false,
  )
  assert.equal(
    mappingCatalogState(rates, [], { ...draft, inboundRatePlanIds: ['rate-b'] }, 'VND').canSave,
    false,
  )
  assert.equal(
    mappingCatalogState(rates, [], { ...draft, inboundRatePlanIds: ['foreign'] }, 'VND').canSave,
    false,
  )
})

test('used inbound plans cannot be removed and additions need a current catalog', () => {
  const rates = {
    ...catalog,
    ratePlans: [
      ...catalog.ratePlans,
      { id: 'child', roomTypeId: 'remote-a', supported: false },
      { id: 'another', roomTypeId: 'remote-a', supported: false },
    ],
  }
  const current = { ...draft, targetLocked: true, inboundRatePlanIds: ['child'] }
  assert.equal(
    mappingCatalogState(rates, [current], { ...current, inboundRatePlanIds: [] }).canSave,
    false,
  )
  assert.equal(
    mappingCatalogState(rates, [current], { ...current, inboundRatePlanIds: ['child', 'another'] })
      .canSave,
    true,
  )
  assert.equal(mappingCatalogState(null, [current], { ...current, active: false }).canSave, true)
  assert.equal(
    mappingCatalogState(null, [current], { ...current, inboundRatePlanIds: ['child', 'another'] })
      .canSave,
    false,
  )
})
