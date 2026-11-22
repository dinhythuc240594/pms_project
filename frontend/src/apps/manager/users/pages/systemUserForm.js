import { emailInput } from '../../../../shared/lib/validation.js';

export const SYSTEM_ROLES = ['SUPER_ADMIN', 'SYSTEM_MANAGER'];

export function systemUserInput(draft, id) {
  const name = draft.name.trim();
  if (!name || name.length > 160) throw new Error('Vui lòng nhập họ và tên từ 1 đến 160 ký tự.');
  if (!SYSTEM_ROLES.includes(draft.globalRole)) throw new Error('Vui lòng chọn vai trò hệ thống hợp lệ.');
  if (typeof draft.active !== 'boolean') throw new Error('Trạng thái tài khoản không hợp lệ.');
  const input = { name, globalRole: draft.globalRole, active: draft.active };
  if (id) return { id, ...input };
  const email = emailInput(draft.email);
  if (draft.password.length < 12 || draft.password.length > 128) throw new Error('Mật khẩu ban đầu cần từ 12 đến 128 ký tự.');
  return { ...input, email, password: draft.password };
}
