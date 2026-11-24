import test from 'node:test'
import assert from 'node:assert/strict'
import { operationAge, operationsNeedAttention, workerState } from './operationsPresentation.js'

test('unknown ages stay unknown while a fresh heartbeat can be zero seconds old', () => {
  assert.equal(operationAge(null), 'Chưa có dữ liệu')
  assert.equal(operationAge(0), '0 giây')
  assert.equal(operationAge(125), '2 phút')
  assert.equal(operationAge(7201), '2 giờ')
})

test('only required missing workers raise the operational warning', () => {
  assert.equal(workerState({ required: false, instances: [], status: 'missing' }), 'Chưa cần chạy')
  assert.equal(
    operationsNeedAttention({ workers: { channels: { required: false, status: 'missing' } } }),
    false,
  )
  assert.equal(
    operationsNeedAttention({ workers: { housekeeping: { required: true, status: 'stale' } } }),
    true,
  )
  assert.equal(operationsNeedAttention({ channels: { openReviewCount: 2 } }), true)
  assert.equal(operationsNeedAttention({ channels: { counts: { failed: 1 } } }), true)
})
