const uuid = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)

export function airbnbReturn(search) {
  const params = new URLSearchParams(search)
  const keys = ['success', 'channel_id', 'token']
  if (!keys.some((key) => params.has(key))) return null
  const success = params.get('success'),
    channelId = params.get('channel_id'),
    token = params.get('token')
  const duplicate = keys.some((key) => params.getAll(key).length > 1)
  keys.forEach((key) => params.delete(key))
  const cleanSearch = params.toString() ? '?' + params.toString() : ''
  if (success === 'false' && !duplicate) return { kind: 'failure', cleanSearch }
  if (
    duplicate ||
    success !== 'true' ||
    !uuid(channelId) ||
    typeof token !== 'string' ||
    token.length < 1 ||
    token.length > 4096 ||
    !/^[\w.-]+$/.test(token)
  )
    return { kind: 'invalid', cleanSearch }
  return { kind: 'success', channelId, token, cleanSearch }
}

export function airbnbResume(data) {
  if (
    !data ||
    typeof data.accountId !== 'string' ||
    !/^(system:(staging|production)|hotel:[\w-]+)$/.test(data.accountId) ||
    !uuid(data.propertyId) ||
    data.property?.id !== data.propertyId ||
    typeof data.property?.name !== 'string' ||
    !data.property.name.trim() ||
    !uuid(data.channel?.id)
  )
    throw new Error('Kết quả xác nhận Airbnb chưa hợp lệ. Vui lòng tải lại danh sách kênh.')
  return data
}
