export function operationAge(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Chưa có dữ liệu'
  if (seconds < 60) return `${Math.floor(seconds)} giây`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút`
  return `${Math.floor(seconds / 3600)} giờ`
}

export function workerState(worker) {
  if (!worker?.required && !worker?.instances?.length) return 'Chưa cần chạy'
  return (
    {
      ok: 'Đang phản hồi',
      missing: 'Chưa ghi nhận',
      stale: 'Quá hạn phản hồi',
      partial: 'Chưa phủ đủ khách sạn',
    }[worker?.status] || 'Chưa xác định'
  )
}

export function operationsNeedAttention(data) {
  if (!data) return false
  return (
    Object.values(data.workers || {}).some((worker) => worker.required && worker.status !== 'ok') ||
    (data.channels?.counts?.failed || 0) > 0 ||
    (data.channels?.openReviewCount || 0) > 0
  )
}
