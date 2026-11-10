export function decimalInput(value, { precision = 4, min = '0', max = `999999999999999${precision ? '.' + '9'.repeat(precision) : ''}` } = {}) {
  const text = value == null ? '' : String(value).trim();
  if (!new RegExp(`^-?\\d{1,15}${precision ? `(?:\\.\\d{1,${precision}})?` : ''}$`).test(text)) {
    throw new Error(`Nhập số hợp lệ, tối đa ${precision} chữ số thập phân; không dùng dấu phẩy hoặc dạng 1e3.`);
  }
  const scaled = amount => {
    const [whole, fraction = ''] = String(amount).split('.');
    return BigInt(whole.replace('-', '') + fraction.padEnd(precision, '0')) * (whole.startsWith('-') ? -1n : 1n);
  };
  const lower = scaled(min), upper = scaled(max), number = scaled(text);
  if ((lower >= 0n && text.startsWith('-')) || number < lower || number > upper) {
    throw new Error(`Giá trị phải từ ${min} đến ${max}.`);
  }
  return text;
}
