const enc = encodeURIComponent
const remote = '/channels/remote'

export function clientOtaSettingsPath(search = '', tab = 'channels') {
  const params = new URLSearchParams(search)
  params.set('section', 'channels')
  params.set('tab', tab)
  return '/id/settings?' + params
}

export function clientChannelOperations(requestTenant) {
  return {
    getChannexRemoteChannels: (_account, _property, page = 1) =>
      requestTenant(remote + '?' + new URLSearchParams({ page })),
    getChannexChannelAdapters: () => requestTenant(remote + '/adapters'),
    getChannexChannel: (_account, _property, id) => requestTenant(remote + '/' + enc(id)),
    probeChannexChannel: (_account, _property, action, input) =>
      requestTenant(remote + '/probe/' + enc(action), { method: 'POST', body: input }),
    saveChannexChannel: (_account, _property, { id, ...input }) =>
      requestTenant(remote + (id ? '/' + enc(id) : ''), {
        method: id ? 'PATCH' : 'POST',
        body: input,
      }),
    actionChannexChannel: (_account, _property, id, action, input) =>
      requestTenant(remote + '/' + enc(id) + (action === 'delete' ? '' : '/' + enc(action)), {
        method: action === 'delete' ? 'DELETE' : 'POST',
        body: input,
      }),
    createChannexAirbnbLink: (_account, _property, input) =>
      requestTenant(remote + '/airbnb-link', { method: 'POST', body: input }),
    getChannexAirbnbListings: (_account, _property, id) =>
      requestTenant(remote + '/' + enc(id) + '/airbnb/listings'),
    saveChannexAirbnbMapping: (_account, _property, id, input) =>
      requestTenant(remote + '/' + enc(id) + '/airbnb/mappings', { method: 'POST', body: input }),
    deleteChannexAirbnbMapping: (_account, _property, id, mappingId, input) =>
      requestTenant(remote + '/' + enc(id) + '/airbnb/mappings/' + enc(mappingId), {
        method: 'DELETE',
        body: input,
      }),
  }
}
