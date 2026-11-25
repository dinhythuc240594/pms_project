import test from 'node:test'
import assert from 'node:assert/strict'
import { planFormInput, registeredRoomCount } from './planForm.js'
import {
  enabledPlanFeatures,
  planDistribution,
  planRoomLabel,
} from '../../../../shared/config/pricingPlans.js'

const customPlan = {
  code: ' business ',
  name: ' Business ',
  price: '999999999999999.9999',
  priceYear: '0.0000',
  currency: ' usd ',
  maxRooms: '',
  maxUsers: '5',
  features: { OTA_SYNC: true, POS_SALES: false },
  active: true,
}

test('custom plan form retains exact decimal prices and distinguishes plan ceilings from registration', () => {
  const input = planFormInput(customPlan)
  assert.equal(input.code, 'BUSINESS')
  assert.equal(input.name, 'Business')
  assert.equal(input.currency, 'USD')
  assert.equal(input.price, customPlan.price)
  assert.equal(input.priceYear, '0.0000')
  assert.equal(input.maxRooms, null)
  assert.equal(input.maxUsers, 5)
  assert.equal(input.pricingRules.baseRooms, 15)
  assert.equal(planRoomLabel(input), 'Số phòng theo đăng ký')
  assert.equal(planRoomLabel({ maxRooms: 10 }), 'Đăng ký tối đa 10 phòng')
})

test('plan inputs reject invalid codes, money and quota fields without rounding them', () => {
  for (const code of ['2', 'TOO_LONG_CODE_X', 'A-B'])
    assert.throws(() => planFormInput({ ...customPlan, code }))
  for (const price of ['-1', '1e3', '1,5', '1.00001', ''])
    assert.throws(() => planFormInput({ ...customPlan, price }))
  assert.throws(() => planFormInput({ ...customPlan, maxUsers: '2.5' }))
  assert.throws(() => planFormInput({ ...customPlan, name: '' }))
})

test('room registrations require explicit positive whole count within plan ceiling', () => {
  assert.equal(registeredRoomCount('10', null), 10)
  assert.equal(registeredRoomCount('10', 10), 10)
  for (const count of ['', '0', '-1', '1.5', '1e3', '1000001', '9007199254740992'])
    assert.throws(() => registeredRoomCount(count))
  assert.throws(() => registeredRoomCount('11', 10))
})

test('FREE keeps its zero prices and ceilings while unsupported currencies are rejected', () => {
  const free = {
    ...customPlan,
    code: 'FREE',
    price: '0',
    priceYear: '0',
    maxRooms: '30',
    maxUsers: '5',
  }
  assert.equal(planFormInput(free).maxRooms, 30)
  assert.throws(() => planFormInput({ ...free, price: '0.0001' }))
  assert.throws(
    () =>
      planFormInput({
        ...free,
        pricingRules: { ...planFormInput(free).pricingRules, extraRoomPrice: '1' },
      }),
    /giá phòng thêm/,
  )
  assert.throws(() => planFormInput({ ...free, maxRooms: '' }))
  assert.throws(() => planFormInput({ ...customPlan, currency: 'EUR' }))
})

test('marketing lists only current enabled features, including custom plans, without inherited static features', () => {
  const labels = { OTA_SYNC: 'Đồng bộ OTA', POS_SALES: 'Dịch vụ & POS' }
  assert.deepEqual(enabledPlanFeatures(customPlan, labels), [
    { code: 'OTA_SYNC', name: 'Đồng bộ OTA' },
  ])
  assert.deepEqual(
    enabledPlanFeatures({ ...customPlan, features: { OTA_SYNC: false, POS_SALES: true } }, labels),
    [{ code: 'POS_SALES', name: 'Dịch vụ & POS' }],
  )
  assert.deepEqual(
    enabledPlanFeatures({ features: { UNKNOWN: true, POS_SALES: 'true' } }, labels),
    [{ code: 'UNKNOWN', name: 'UNKNOWN' }],
  )
})

test('plan distribution retains custom, archived and unknown plan counts without inventing two tiers', () => {
  assert.deepEqual(
    planDistribution({ FREE: 0, BUSINESS: 2, OLD: 1, LEGACY: 1, unassigned: 3 }, [
      { code: 'FREE', name: 'Miễn phí' },
      { code: 'BUSINESS', name: 'Business' },
      { code: 'OLD', name: 'Gói cũ', deleted: true },
    ]),
    [
      { code: 'FREE', count: 0, name: 'Miễn phí' },
      { code: 'BUSINESS', count: 2, name: 'Business' },
      { code: 'OLD', count: 1, name: 'Gói cũ' },
      { code: 'LEGACY', count: 1, name: 'LEGACY' },
    ],
  )
})

test('legacy plans without codes require a valid one-time code without leaking editing metadata', () => {
  assert.throws(() => planFormInput({ ...customPlan, id: 'legacy', code: null }), /Mã gói/)
  const input = planFormInput({ ...customPlan, id: 'legacy', code: 'LEGACY', originalCode: null })
  assert.equal(input.id, 'legacy')
  assert.equal(input.code, 'LEGACY')
  assert.equal('originalCode' in input, false)
})

test('restoring a legacy plan submits a valid code and deleted false without local flags', () => {
  const input = planFormInput({
    ...customPlan,
    id: 'legacy',
    code: 'LEGACY',
    deleted: true,
    restoring: true,
    originalCode: null,
  })
  assert.equal(input.code, 'LEGACY')
  assert.equal(input.deleted, false)
  assert.equal('restoring' in input, false)
  assert.equal('originalCode' in input, false)
  assert.equal('deleted' in planFormInput({ ...customPlan, id: 'coded', deleted: true }), false)
})
