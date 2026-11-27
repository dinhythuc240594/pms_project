const HIDDEN_FEATURE_CODES = new Set(['MULTI_CURRENCY', 'VOUCHER_PROMO'])

export const isFeatureVisible = (code) => !HIDDEN_FEATURE_CODES.has(code)
