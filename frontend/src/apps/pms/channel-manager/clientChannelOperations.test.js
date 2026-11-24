import test from 'node:test'
import assert from 'node:assert/strict'
import { clientChannelOperations, clientOtaSettingsPath } from './clientChannelOperations.js'

test('legacy OTA links return to the settings tab without dropping Airbnb callback state', () => {
  const target = new URL(
    clientOtaSettingsPath('?success=true&channel_id=channel&token=callback-state&section=business'),
    'https://loha.test',
  )
  assert.equal(target.pathname, '/id/settings')
  assert.equal(target.searchParams.get('section'), 'channels')
  assert.equal(target.searchParams.get('tab'), 'channels')
  assert.equal(target.searchParams.get('token'), 'callback-state')
  assert.equal(target.searchParams.get('channel_id'), 'channel')
  assert.equal(clientOtaSettingsPath('', 'history'), '/id/settings?section=channels&tab=history')
})

test('client OTA operations stay on the tenant API and never forward a manager account or property', async () => {
  const calls = []
  const operations = clientChannelOperations(async (path, options) => {
    calls.push({ path, ...options })
    return { saved: true }
  })
  const input = { revision: 'rev-1', confirm: true }
  await operations.getChannexRemoteChannels('other-account', 'other-property', 2)
  await operations.getChannexChannelAdapters('other-account', 'other-property')
  await operations.getChannexChannel('other-account', 'other-property', 'channel/1')
  await operations.probeChannexChannel('other-account', 'other-property', 'test_connection', input)
  assert.deepEqual(
    await operations.saveChannexChannel('other-account', 'other-property', {
      id: 'channel-1',
      ...input,
    }),
    { saved: true },
  )
  await operations.saveChannexChannel('other-account', 'other-property', input)
  await operations.actionChannexChannel(
    'other-account',
    'other-property',
    'channel-1',
    'activate',
    input,
  )
  await operations.actionChannexChannel(
    'other-account',
    'other-property',
    'channel-1',
    'load_bookings',
    input,
  )
  await operations.actionChannexChannel(
    'other-account',
    'other-property',
    'channel-1',
    'delete',
    input,
  )
  await operations.createChannexAirbnbLink('other-account', 'other-property', input)
  await operations.getChannexAirbnbListings('other-account', 'other-property', 'channel-1')
  await operations.saveChannexAirbnbMapping('other-account', 'other-property', 'channel-1', input)
  await operations.deleteChannexAirbnbMapping(
    'other-account',
    'other-property',
    'channel-1',
    'mapping/1',
    input,
  )
  assert.deepEqual(calls, [
    { path: '/channels/remote?page=2' },
    { path: '/channels/remote/adapters' },
    { path: '/channels/remote/channel%2F1' },
    { path: '/channels/remote/probe/test_connection', method: 'POST', body: input },
    { path: '/channels/remote/channel-1', method: 'PATCH', body: input },
    { path: '/channels/remote', method: 'POST', body: input },
    { path: '/channels/remote/channel-1/activate', method: 'POST', body: input },
    { path: '/channels/remote/channel-1/load_bookings', method: 'POST', body: input },
    { path: '/channels/remote/channel-1', method: 'DELETE', body: input },
    { path: '/channels/remote/airbnb-link', method: 'POST', body: input },
    { path: '/channels/remote/channel-1/airbnb/listings' },
    { path: '/channels/remote/channel-1/airbnb/mappings', method: 'POST', body: input },
    {
      path: '/channels/remote/channel-1/airbnb/mappings/mapping%2F1',
      method: 'DELETE',
      body: input,
    },
  ])
  assert.ok(!JSON.stringify(calls).includes('other-account'))
  assert.ok(!JSON.stringify(calls).includes('other-property'))
})
