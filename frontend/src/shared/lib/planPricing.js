const SCALE = 10000n;
const MAX_MONEY = 9999999999999999999n;
const THRESHOLDS = [30, 50, 100];

export function defaultPricingRules() {
  return { baseRooms: 15, extraRoomPrice: '0', extraRoomPriceYear: '0', adjustments: THRESHOLDS.map(aboveRooms => ({ aboveRooms, percent: '0' })) };
}

function decimalText(value, signed = false) {
  if (!['string', 'number'].includes(typeof value)) throw new Error('Giá và tỷ lệ phải là số hợp lệ.');
  const text = String(value).trim();
  if (!(signed ? /^[+-]?\d{1,4}(?:\.\d{1,4})?$/ : /^\d{1,15}(?:\.\d{1,4})?$/).test(text)) throw new Error('Giá và tỷ lệ dùng dấu chấm, tối đa 4 chữ số thập phân.');
  return text;
}

function units(text) {
  const negative = text.startsWith('-');
  const [integer, fraction = ''] = text.replace(/^[+-]/, '').split('.');
  return (BigInt(integer) * SCALE + BigInt(fraction.padEnd(4, '0'))) * (negative ? -1n : 1n);
}

function moneyText(value) {
  return `${value / SCALE}.${String(value % SCALE).padStart(4, '0')}`;
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

export function normalizePricingRules(value) {
  if (value == null) return defaultPricingRules();
  if (!exactKeys(value, ['baseRooms', 'extraRoomPrice', 'extraRoomPriceYear', 'adjustments'])) throw new Error('Điều kiện tính giá không hợp lệ.');
  const baseText = String(value.baseRooms).trim(), baseRooms = Number(baseText);
  if (!/^\d+$/.test(baseText) || !Number.isSafeInteger(baseRooms) || baseRooms < 1 || baseRooms > 1000000) throw new Error('Số phòng cơ bản phải là số nguyên từ 1 đến 1.000.000.');
  const extraRoomPrice = decimalText(value.extraRoomPrice), extraRoomPriceYear = decimalText(value.extraRoomPriceYear);
  if (!Array.isArray(value.adjustments) || value.adjustments.length !== 3) throw new Error('Cần đủ các mốc vượt 30, 50 và 100 phòng.');
  const adjustments = THRESHOLDS.map(aboveRooms => {
    const row = value.adjustments.find(item => item?.aboveRooms === aboveRooms);
    if (!exactKeys(row, ['aboveRooms', 'percent'])) throw new Error('Mốc số phòng không hợp lệ.');
    const percent = decimalText(row.percent, true), scaled = units(percent);
    if (scaled < -100n * SCALE || scaled > 1000n * SCALE) throw new Error('Tỷ lệ điều chỉnh phải từ -100% đến 1000%.');
    return { aboveRooms, percent };
  });
  return { baseRooms, extraRoomPrice, extraRoomPriceYear, adjustments };
}

export function defaultRegisteredRooms(plan) {
  const { baseRooms } = normalizePricingRules(plan?.pricingRules);
  return Math.min(baseRooms, plan?.maxRooms ?? baseRooms);
}

export function calculatePlanPrice(plan, roomCount, cycle = 'monthly') {
  if (!plan) throw new Error('Vui lòng chọn gói cước.');
  const countText = String(roomCount).trim(), count = Number(countText);
  if (!/^\d+$/.test(countText) || !Number.isSafeInteger(count) || count < 1 || count > 1000000) throw new Error('Số phòng đăng ký phải là số nguyên từ 1 đến 1.000.000.');
  if (plan.maxRooms != null && count > plan.maxRooms) throw new Error(`Gói này cho đăng ký tối đa ${plan.maxRooms} phòng.`);
  if (!['monthly', 'yearly'].includes(cycle)) throw new Error('Chu kỳ phải theo tháng hoặc theo năm.');
  const rules = normalizePricingRules(plan.pricingRules);
  const basePrice = decimalText((cycle === 'yearly' ? plan.priceYear : plan.price) ?? '0');
  const extraRoomPrice = cycle === 'yearly' ? rules.extraRoomPriceYear : rules.extraRoomPrice;
  const extraRooms = Math.max(0, count - rules.baseRooms);
  const adjustment = rules.adjustments.filter(row => count > row.aboveRooms).at(-1);
  const adjustmentPercent = adjustment?.percent ?? '0';
  const subtotal = units(basePrice) + BigInt(extraRooms) * units(extraRoomPrice);
  const denominator = 100n * SCALE;
  const amount = (subtotal * (denominator + units(adjustmentPercent)) + denominator / 2n) / denominator;
  if (amount > MAX_MONEY) throw new Error('Tổng giá gói vượt giới hạn số tiền cho phép.');
  return { amount: moneyText(amount), subtotal: moneyText(subtotal), basePrice, baseRooms: rules.baseRooms, extraRooms, extraRoomPrice, adjustmentPercent, aboveRooms: adjustment?.aboveRooms ?? null };
}
