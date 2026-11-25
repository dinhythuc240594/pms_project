import test from 'node:test'
import assert from 'node:assert/strict'
import { subscriptionState, matchesSubscriptionState } from './subscriptionStatus.js'

const now = Date.parse('2026-10-10T04:00:00Z')
const active = {
  status: 'active',
  blockedReason: null,
  startDate: '2026-10-01T04:00:00Z',
  endDate: null,
}

test('missing subscriptions and indefinite plans have distinct states', () => {
  assert.equal(subscriptionState(null, now), 'unassigned')
  assert.equal(subscriptionState(undefined, now), 'unassigned')
  assert.equal(subscriptionState(active, now), 'active')
})

test('API access restrictions take precedence over date-based reminders', () => {
  for (const blockedReason of ['inactive', 'cancelled', 'future', 'expired']) {
    assert.equal(
      subscriptionState({ ...active, blockedReason, endDate: '2026-10-12T04:00:00Z' }, now),
      blockedReason,
    )
  }
  for (const status of ['expired', 'cancelled'])
    assert.equal(subscriptionState({ ...active, status }, now), status)
})

test('expiry uses exact instants and an inclusive next-seven-day window', () => {
  for (const endDate of ['2026-10-10T03:59:59.999Z', '2026-10-10T11:00:00+07:00']) {
    assert.equal(subscriptionState({ ...active, endDate }, now), 'expired')
  }
  for (const endDate of ['2026-10-10T04:00:00.001Z', '2026-10-17T11:00:00+07:00']) {
    assert.equal(subscriptionState({ ...active, endDate }, now), 'expiring')
  }
  assert.equal(subscriptionState({ ...active, endDate: '2026-10-17T04:00:00.001Z' }, now), 'active')
})

test('future start dates take precedence and become active at their exact start', () => {
  assert.equal(
    subscriptionState(
      { ...active, startDate: '2026-10-10T04:00:00.001Z', endDate: '2026-10-12T04:00:00Z' },
      now,
    ),
    'future',
  )
  assert.equal(
    subscriptionState({ ...active, startDate: '2026-10-10T11:00:00+07:00' }, now),
    'active',
  )
})

test('active filter includes expiring subscriptions; specific filters remain separate', () => {
  const expiring = { ...active, endDate: '2026-10-11T04:00:00Z' }
  assert.equal(matchesSubscriptionState(expiring, 'active', now), true)
  assert.equal(matchesSubscriptionState(expiring, 'expiring', now), true)
  assert.equal(matchesSubscriptionState(expiring, 'expired', now), false)
  assert.equal(matchesSubscriptionState(active, 'expiring', now), false)
  assert.equal(matchesSubscriptionState(null, 'unassigned', now), true)
  assert.equal(matchesSubscriptionState(null, 'active', now), false)
  for (const filter of ['all', 'ALL'])
    assert.equal(matchesSubscriptionState(null, filter, now), true)
})
