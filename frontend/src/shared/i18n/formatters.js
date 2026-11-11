import { formatDate } from '../lib/date.js';

// ISO date values sent to APIs stay unchanged; these helpers format display text only.
export function shortDate(value) {
  return formatDate(value).slice(0, 5);
}
