export function commissionRateLabel(record) {
  if (record.calculationBasis === 'provider_amount') return 'Theo số tiền OTA';
  return record.missingRate || record.percent == null ? 'Chưa có tỷ lệ · cần xác nhận' : `${record.percent}%`;
}
