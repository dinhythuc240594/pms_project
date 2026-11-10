// Parse calendar dates at UTC midnight without accepting Date's rollover behavior.
export function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
}

export function dateInputText(value) {
  if (!value) return '';
  const [date, time] = value.split('T');
  return date.split('-').reverse().join('/') + (time ? ` ${time.slice(0, 5)}` : '');
}

export function parseDateInput(text, withTime = false) {
  if (text === '') return '';
  const match = (withTime ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/ : /^(\d{2})\/(\d{2})\/(\d{4})$/).exec(text);
  if (!match) return undefined;
  const [, day, month, year, hour, minute] = match;
  const date = `${year}-${month}-${day}`;
  if (year === '0000' || !Number.isFinite(parseIsoDate(date))) return undefined;
  if (withTime && (Number(hour) > 23 || Number(minute) > 59)) return undefined;
  return date + (withTime ? `T${hour}:${minute}` : '');
}

export function formatDate(value, timeZone) {
  if (!value || typeof value !== 'string') return '—';
  if (timeZone && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone,
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.day}/${parts.month}/${parts.year}`;
  }
  const date = value.slice(0, 10);
  return parseDateInput(dateInputText(date)) === date ? dateInputText(date) : '—';
}

export function formatDateTime(value, timeZone) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '—';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}
