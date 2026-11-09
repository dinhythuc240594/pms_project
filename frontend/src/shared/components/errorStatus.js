export const errorScreens = {
  401: { title: 'Phiên đăng nhập đã kết thúc', description: 'Đăng nhập lại để tiếp tục sử dụng không gian làm việc.' },
  403: { title: 'Bạn chưa có quyền truy cập', description: 'Tài khoản hiện tại không được phép mở nội dung này. Liên hệ quản trị viên nếu bạn cần được cấp quyền.' },
  404: { title: 'Không tìm thấy trang này', description: 'Đường dẫn có thể đã thay đổi hoặc trang bạn cần không còn tồn tại.' },
  500: { title: 'Có lỗi khi xử lý yêu cầu', description: 'LOHA chưa thể hoàn tất yêu cầu này. Bạn có thể thử lại hoặc quay về không gian làm việc.' },
  503: { title: 'Dịch vụ tạm thời gián đoạn', description: 'Chưa thể kết nối với hệ thống. Kiểm tra kết nối mạng và thử lại sau ít phút.' },
};

export function readableErrorMessage(message, fallback) {
  return message && !/Failed to fetch|NetworkError|Network request failed|Load failed|ERR_CONNECTION|^Yêu cầu thất bại\s*\(\d{3}\)\.?$/i.test(message.trim()) ? message : fallback;
}

export function errorStatus(error, fallback = 500) {
  if (error?.status === 403 && error.code === 'csrf_failed') return null;
  const status = typeof error === 'number' ? error : error?.status;
  if (errorScreens[status]) return Number(status);
  if (status === 502 || status === 504) return 503;
  if (status >= 500) return 500;
  if (status >= 400) return null;
  if (error?.reason === 'session') return 401;
  if (['role', 'tenant', 'feature', 'expired', 'suspended'].includes(error?.reason)) return 403;
  const message = typeof error === 'string' ? error : error?.message || '';
  const code = message.match(/\((401|403|404|500|502|503|504)\)/)?.[1];
  if (code) return errorStatus(Number(code), fallback);
  if (/Failed to fetch|NetworkError|Network request failed|Load failed|ERR_CONNECTION/i.test(message)) return 503;
  return fallback;
}
