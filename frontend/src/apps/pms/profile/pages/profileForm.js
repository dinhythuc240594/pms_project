export function profileName(value) {
  const name = value.trim();
  if (!name || name.length > 160) throw new Error('Họ và tên cần từ 1 đến 160 ký tự.');
  return name;
}

export function passwordChangeInput({ currentPassword, newPassword, confirm }) {
  if (!currentPassword) throw new Error('Vui lòng nhập mật khẩu hiện tại.');
  if (newPassword.length < 12 || newPassword.length > 128) throw new Error('Mật khẩu mới cần từ 12 đến 128 ký tự.');
  if (newPassword !== confirm) throw new Error('Mật khẩu xác nhận không khớp.');
  return { currentPassword, newPassword };
}
