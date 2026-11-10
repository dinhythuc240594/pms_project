export const emailPattern = String.raw`(?=.{1,254}$)(?=[^@]{1,64}@)(?![.])(?![^@]*[.]{2})(?![^@]*[.]@)[a-zA-Z0-9!#$%&'*+\/=?^_\x60\{\|\}~.\-]+@[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(?:[.][a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*`;
export const taxIdPattern = String.raw`[0-9]+(?:-[0-9]{3})?`;

const emailExpression = new RegExp(`^(?:${emailPattern})$`, 'u');
const taxIdExpression = new RegExp(`^(?:${taxIdPattern})$`, 'u');

export function emailInput(value) {
  if (typeof value !== 'string' || !emailExpression.test(value.trim())) {
    throw new Error('Vui lòng nhập email hợp lệ, tối đa 254 ký tự.');
  }
  return value.trim().toLowerCase();
}

export function taxIdInput(value) {
  if (typeof value !== 'string' || value.trim().length > 40 || (value.trim() && !taxIdExpression.test(value.trim()))) {
    throw new Error('Mã số thuế gồm chữ số, có thể thêm dấu gạch ngang và 3 số chi nhánh; tối đa 40 ký tự.');
  }
  return value.trim();
}
