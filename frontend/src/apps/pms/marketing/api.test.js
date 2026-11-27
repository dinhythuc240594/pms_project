import assert from 'node:assert/strict'
import test from 'node:test'
import { createMarketingApi, moveSection, reviewComplete } from './api.js'
import { routePolicy } from '../data/access.js'
import { permitted } from '../data/api.js'

test('all five human review confirmations are required', () => {
  assert.equal(reviewComplete({ facts: true, cta: true, assets: true, responsive: true }), false)
  assert.equal(
    reviewComplete({ facts: true, cta: true, assets: true, responsive: true, seo: true }),
    true,
  )
})

test('uncertain publication retries retain the idempotency key', async () => {
  const keys = []
  const api = createMarketingApi(async (_path, options) => {
    keys.push(options.intent)
    if (keys.length === 1) throw new Error('Connection lost')
    return { publishedReleaseId: 'release' }
  })
  await assert.rejects(api.mutation('/pages/a/publish', { expectedVersion: 4 }))
  assert.deepEqual(await api.mutation('/pages/a/publish', { expectedVersion: 4 }), {
    publishedReleaseId: 'release',
  })
  assert.equal(keys[0], keys[1])
})

test('different mutation payloads do not reuse the same intent', async () => {
  const keys = []
  const api = createMarketingApi(async (_path, options) => {
    keys.push(options.intent)
    throw new Error('Lost')
  })
  await assert.rejects(api.mutation('/pages/a/publish', { expectedVersion: 4 }))
  await assert.rejects(api.mutation('/pages/a/publish', { expectedVersion: 5 }))
  assert.notEqual(keys[0], keys[1])
})

test('hero cannot be moved and keyboard moves retain section contents', () => {
  const document = { sections: [{ id: 'hero' }, { id: 'about' }, { id: 'contact' }] }
  assert.equal(moveSection(document, 0, 1), document)
  assert.equal(moveSection(document, 1, -1), document)
  assert.deepEqual(
    moveSection(document, 1, 1).sections.map((item) => item.id),
    ['hero', 'contact', 'about'],
  )
  assert.deepEqual(
    document.sections.map((item) => item.id),
    ['hero', 'about', 'contact'],
  )
})

test('marketing routes use their own owner permission and feature', () => {
  assert.deepEqual(routePolicy('/id/marketing/pages/a/edit'), {
    action: 'marketing.view',
    feature: 'AI_MARKETING_PAGES',
  })
  const tenant = { id: 'hotel', status: 'ACTIVE' }
  const user = (role) => ({
    id: 'user',
    globalRole: 'USER',
    memberships: [{ tenantId: 'hotel', role }],
  })
  assert.equal(permitted(user('HOTEL_OWNER'), tenant, 'marketing.view').allowed, true)
  for (const role of ['FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTANT'])
    assert.equal(permitted(user(role), tenant, 'marketing.view').allowed, false)
  assert.equal(
    permitted(
      { id: 'system', globalRole: 'SUPER_ADMIN', memberships: [] },
      tenant,
      'marketing.view',
    ).allowed,
    false,
  )
})
