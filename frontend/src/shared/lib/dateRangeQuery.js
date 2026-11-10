export function dateRangeParams(filters = {}, { startKey = 'start', endKey = 'end' } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value === '' || value == null) continue;
    const name = key === startKey ? 'start_date' : key === endKey ? 'end_date' : key;
    if ((name === 'start_date' || name === 'end_date') && params.has(name) && params.get(name) !== String(value)) {
      throw new Error(`Bộ lọc ${name} có nhiều giá trị không khớp.`);
    }
    params.set(name, value);
  }
  return params;
}
