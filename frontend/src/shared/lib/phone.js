export const phonePattern = String.raw`(?=(?:[^0-9]*[0-9]){7,15}[^0-9]*$)[+]?[0-9 .\(\)\-]+`;

const phoneExpression = new RegExp(`^(?:${phonePattern})$`, 'u');

export function isValidPhone(value) {
  return typeof value === 'string' && (!value.trim() || phoneExpression.test(value.trim()));
}

export function phoneInput(value) {
  if (!isValidPhone(value)) {
    throw new Error('Số điện thoại cần từ 7 đến 15 chữ số, chỉ cho phép dấu + ở đầu và dấu cách, chấm, gạch ngang, ngoặc đơn.');
  }
  return value.trim();
}
