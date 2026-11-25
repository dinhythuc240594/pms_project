import test from 'node:test'
import assert from 'node:assert/strict'
import { airbnbReturn, airbnbResume } from './airbnbReturn.js'

const id = '11111111-1111-4111-8111-111111111111'
test('Airbnb return removes sensitive callback parameters and preserves unrelated filters', () => {
  assert.equal(airbnbReturn('?page=2'), null)
  assert.deepEqual(airbnbReturn(`?page=2&success=true&channel_id=${id}&token=.signed.state`), {
    kind: 'success',
    channelId: id,
    token: '.signed.state',
    cleanSearch: '?page=2',
  })
  assert.deepEqual(airbnbReturn('?success=false&token=secret'), {
    kind: 'failure',
    cleanSearch: '',
  })
})
test('Airbnb return rejects missing, duplicate or malformed callbacks without echoing them', () => {
  for (const search of [
    '?success=true',
    `?success=true&channel_id=${id}&token=x&token=y`,
    `?success=true&success=false&channel_id=${id}&token=x`,
    '?success=true&channel_id=../path&token=x',
    `?success=true&channel_id=${id}&token=%0A`,
    `?success=true&channel_id=${id}&token=${'a'.repeat(4097)}`,
    '?token=secret',
  ])
    assert.deepEqual(airbnbReturn(search), { kind: 'invalid', cleanSearch: '' })
})
test('Airbnb workspace resumes only from a consistent confirmed server response', () => {
  const response = {
    accountId: 'hotel:loha',
    propertyId: id,
    property: { id, name: 'LOHA' },
    channel: { id },
  }
  assert.deepEqual(airbnbResume(response), response)
  for (const value of [
    null,
    {},
    { ...response, accountId: 'https://foreign.test' },
    { ...response, property: { id: 'other', name: 'LOHA' } },
    { ...response, channel: {} },
    { ...response, property: { id, name: '' } },
  ])
    assert.throws(() => airbnbResume(value))
})
