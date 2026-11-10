import { isFeatureVisible } from './featureVisibility.js';

export const planRoomLabel = plan => plan.maxRooms == null ? 'Số phòng theo đăng ký' : `Đăng ký tối đa ${plan.maxRooms} phòng`;

export const enabledPlanFeatures = (plan, labels = {}) => Object.entries(plan.features || {})
  .filter(([code, enabled]) => enabled === true && isFeatureVisible(code))
  .map(([code]) => ({ code, name: labels[code] || code }));

export const planDistribution = (counts, plans) => Object.entries(counts)
  .filter(([code]) => code !== 'unassigned')
  .map(([code, count]) => ({ code, count, name: plans.find(plan => plan.code === code)?.name || code }));

