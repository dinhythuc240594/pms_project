import { DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, languages, normalizeLocale, translate, translateLabel } from './core.js';

function readLocale() {
  try { return normalizeLocale(globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY)); }
  catch { return DEFAULT_LOCALE; }
}
let locale = readLocale();
const listeners = new Set();
export const getLocale = () => locale;
export const getIntlLocale = () => languages.find(language => language.code === locale).intlLocale;
export const t = (key, values) => translate(locale, key, values);
export const tr = label => translateLabel(locale, label);

function applyLocale(next) {
  const changed = locale !== next;
  locale = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (changed) for (const listener of listeners) listener();
}
export function setLocale(value) {
  const next = normalizeLocale(value);
  try { globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Language remains available in memory. */ }
  applyLocale(next);
}
function syncLocale(event) {
  if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) applyLocale(readLocale());
}
export function subscribeLocale(listener) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', syncLocale);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', syncLocale);
  };
}
applyLocale(locale);
