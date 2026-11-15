export const REVIEW_CHECKS = [
  ['facts', 'Thông tin khách sạn chính xác'],
  ['cta', 'Nút hành động dẫn đúng địa chỉ'],
  ['assets', 'Ảnh có quyền sử dụng và có mô tả'],
  ['responsive', 'Đã kiểm tra trên điện thoại và máy tính'],
  ['seo', 'Tiêu đề và mô tả tìm kiếm phù hợp'],
];

export const SECTION_NAMES = {
  hero: 'Mở đầu', about: 'Giới thiệu', rooms: 'Hạng phòng', amenities: 'Tiện ích',
  gallery: 'Thư viện ảnh', faq: 'Câu hỏi thường gặp', contact: 'Liên hệ',
};

export function reviewComplete(checklist) {
  return REVIEW_CHECKS.every(([key]) => checklist[key] === true);
}

export function newSection(type) {
  return { id: `${type}-${crypto.randomUUID().slice(0, 8)}`, type, heading: SECTION_NAMES[type], body: '', imageUrl: '', imageAlt: '', visible: true };
}

export function moveSection(document, index, direction) {
  const next = index + direction;
  // Hero remains the first visible section; the backend also validates this invariant.
  if (index <= 0 || next <= 0 || next >= document.sections.length) return document;
  const sections = [...document.sections];
  [sections[index], sections[next]] = [sections[next], sections[index]];
  return { ...document, sections };
}

export function createMarketingApi(request) {
  const intents = new Map();
  return {
    request,
    async mutation(path, body) {
      const fingerprint = path + JSON.stringify(body);
      if (!intents.has(fingerprint)) intents.set(fingerprint, crypto.randomUUID());
      const result = await request(path, { method: 'POST', body, intent: intents.get(fingerprint) });
      intents.delete(fingerprint);
      return result;
    },
  };
}

export function errorText(error) {
  const details = Array.isArray(error?.details) ? error.details.filter(item => typeof item === 'string') : [];
  return [error?.message || 'Không thể thực hiện thao tác.', ...details].join(' ');
}
