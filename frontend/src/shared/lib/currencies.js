// Common hotel currencies verified against Channex's public staging catalog.
// Source: https://staging.channex.io/api/v1/currencies (2026-10-30).
// SaaS subscription/invoice currencies have a separate billing policy.
export const HOTEL_CURRENCIES = [
  { code: 'VND', label: 'VND — Đồng Việt Nam', locale: 'vi-VN' },
  { code: 'USD', label: 'USD — Đô la Mỹ', locale: 'en-US' },
  { code: 'EUR', label: 'EUR — Euro', locale: 'de-DE' },
  { code: 'GBP', label: 'GBP — Bảng Anh', locale: 'en-GB' },
  { code: 'JPY', label: 'JPY — Yên Nhật', locale: 'ja-JP' },
  { code: 'KRW', label: 'KRW — Won Hàn Quốc', locale: 'ko-KR' },
  { code: 'CNY', label: 'CNY — Nhân dân tệ Trung Quốc', locale: 'zh-CN' },
  { code: 'HKD', label: 'HKD — Đô la Hồng Kông', locale: 'zh-HK' },
  { code: 'SGD', label: 'SGD — Đô la Singapore', locale: 'en-SG' },
  { code: 'THB', label: 'THB — Baht Thái Lan', locale: 'th-TH' },
  { code: 'AUD', label: 'AUD — Đô la Úc', locale: 'en-AU' },
  { code: 'CAD', label: 'CAD — Đô la Canada', locale: 'en-CA' },
  { code: 'CHF', label: 'CHF — Franc Thụy Sĩ', locale: 'de-CH' },
  { code: 'NZD', label: 'NZD — Đô la New Zealand', locale: 'en-NZ' },
  { code: 'MYR', label: 'MYR — Ringgit Malaysia', locale: 'ms-MY' },
  { code: 'IDR', label: 'IDR — Rupiah Indonesia', locale: 'id-ID' },
  { code: 'PHP', label: 'PHP — Peso Philippines', locale: 'en-PH' },
  { code: 'INR', label: 'INR — Rupee Ấn Độ', locale: 'en-IN' },
  { code: 'AED', label: 'AED — Dirham UAE', locale: 'en-AE' },
  { code: 'TWD', label: 'TWD — Tân Đài tệ', locale: 'zh-TW' },
];

export const HOTEL_CURRENCY_CODES = HOTEL_CURRENCIES.map(currency => currency.code);
const supportedCodes = new Set(HOTEL_CURRENCY_CODES);

export function isHotelCurrency(value) {
  return supportedCodes.has(value);
}
