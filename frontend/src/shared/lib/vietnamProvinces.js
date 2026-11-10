// Province-level codes from Decision 19/2025/QD-TTg, effective 1 July 2025.
// Base names keep the saved city value independent of province/city classification.
// Source: https://baochinhphu.vn/bang-danh-muc-va-ma-so-cua-34-tinh-thanh-moi-3321-don-vi-hanh-chinh-cap-xa-moi-102250704153652947.htm
export const VIETNAM_PROVINCES = [
  { code: '01', name: 'Hà Nội' },
  { code: '04', name: 'Cao Bằng' },
  { code: '08', name: 'Tuyên Quang' },
  { code: '11', name: 'Điện Biên' },
  { code: '12', name: 'Lai Châu' },
  { code: '14', name: 'Sơn La' },
  { code: '15', name: 'Lào Cai' },
  { code: '19', name: 'Thái Nguyên' },
  { code: '20', name: 'Lạng Sơn' },
  { code: '22', name: 'Quảng Ninh' },
  { code: '24', name: 'Bắc Ninh' },
  { code: '25', name: 'Phú Thọ' },
  { code: '31', name: 'Hải Phòng' },
  { code: '33', name: 'Hưng Yên' },
  { code: '37', name: 'Ninh Bình' },
  { code: '38', name: 'Thanh Hóa' },
  { code: '40', name: 'Nghệ An' },
  { code: '42', name: 'Hà Tĩnh' },
  { code: '44', name: 'Quảng Trị' },
  { code: '46', name: 'Huế' },
  { code: '48', name: 'Đà Nẵng' },
  { code: '51', name: 'Quảng Ngãi' },
  { code: '52', name: 'Gia Lai' },
  { code: '56', name: 'Khánh Hòa' },
  { code: '66', name: 'Đắk Lắk' },
  { code: '68', name: 'Lâm Đồng' },
  { code: '75', name: 'Đồng Nai' },
  { code: '79', name: 'Hồ Chí Minh' },
  { code: '80', name: 'Tây Ninh' },
  { code: '82', name: 'Đồng Tháp' },
  { code: '86', name: 'Vĩnh Long' },
  { code: '91', name: 'An Giang' },
  { code: '92', name: 'Cần Thơ' },
  { code: '96', name: 'Cà Mau' },
];

const provinceNames = new Set(VIETNAM_PROVINCES.map(province => province.name));

export function isVietnamProvince(value) {
  return provinceNames.has(value);
}
