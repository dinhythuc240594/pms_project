export const subscriptionStatusLabels = {
  active: 'Đang hiệu lực',
  expiring: 'Sắp hết hạn (7 ngày)',
  expired: 'Hết hạn',
  cancelled: 'Đã hủy',
  inactive: 'Gói ngừng cung cấp',
  future: 'Chưa bắt đầu',
  unassigned: 'Chưa cấp gói',
}

export function subscriptionState(subscription, now = Date.now()) {
  if (!subscription) return 'unassigned'
  if (subscription.blockedReason) return subscription.blockedReason
  if (subscription.status !== 'active') return subscription.status
  if (Date.parse(subscription.startDate) > now) return 'future'
  const end = Date.parse(subscription.endDate)
  if (end <= now) return 'expired'
  if (end <= now + 7 * 24 * 60 * 60 * 1000) return 'expiring'
  return 'active'
}

export function matchesSubscriptionState(subscription, filter, now = Date.now()) {
  if (filter === 'all' || filter === 'ALL') return true
  const state = subscriptionState(subscription, now)
  return state === filter || (filter === 'active' && state === 'expiring')
}
