import vi from './locales/vi.json' with { type: 'json' };
import enUS from './locales/en-US.json' with { type: 'json' };
import zhCN from './locales/zh-CN.json' with { type: 'json' };
import legacyEnUS from './locales/legacy-en-US.json' with { type: 'json' };
import legacyZhCN from './locales/legacy-zh-CN.json' with { type: 'json' };

export const DEFAULT_LOCALE = 'vi';
export const LANGUAGE_STORAGE_KEY = 'loha-ui-language';
export const languages = [
  { code: 'vi', label: 'Vietnamese', nativeName: 'Tiếng Việt', shortName: 'VI', intlLocale: 'vi-VN' },
  { code: 'en-US', label: 'English (US)', nativeName: 'English (US)', shortName: 'EN', intlLocale: 'en-US' },
  { code: 'zh-CN', label: 'Chinese', nativeName: '中文（简体）', shortName: '中文', intlLocale: 'zh-CN' },
];
export const dictionaries = { vi, 'en-US': enUS, 'zh-CN': zhCN };
const legacyDictionaries = { 'en-US': legacyEnUS, 'zh-CN': legacyZhCN };
const sourceKeys = new Map(Object.entries(vi).map(([key, value]) => [value, key]));

function templateMatcher(source, target) {
  const names = [];
  const parts = [];
  let offset = 0;
  for (const match of source.matchAll(/\{([\w]+)\}/g)) {
    parts.push(source.slice(offset, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    parts.push('([\\s\\S]+?)');
    names.push(match[1]);
    offset = match.index + match[0].length;
  }
  if (!names.length) return null;
  parts.push(source.slice(offset).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return { pattern: new RegExp(`^${parts.join('')}$`), names, target };
}

const textCatalogs = Object.fromEntries(['en-US', 'zh-CN'].map(locale => {
  const exact = new Map();
  const templates = [];
  for (const [key, source] of Object.entries(vi)) {
    const target = dictionaries[locale][key];
    const matcher = templateMatcher(source, target);
    if (matcher) templates.push(matcher); else exact.set(source, target);
  }
  for (const [source, target] of Object.entries(legacyDictionaries[locale])) {
    if (sourceKeys.has(source)) continue;
    const matcher = templateMatcher(source, target);
    if (matcher) templates.push(matcher); else exact.set(source, target);
  }
  templates.sort((left, right) => right.pattern.source.length - left.pattern.source.length);
  return [locale, { exact, templates }];
}));

export function normalizeLocale(value) {
  const aliases = { vi: 'vi', 'vi-VN': 'vi', en: 'en-US', 'en-US': 'en-US', zh: 'zh-CN', 'zh-CN': 'zh-CN', 'zh-Hans': 'zh-CN' };
  return Object.hasOwn(aliases, value) ? aliases[value] : DEFAULT_LOCALE;
}

export function translate(locale, key, values = {}) {
  const dictionary = dictionaries[normalizeLocale(locale)];
  const pluralKey = values.count != null ? `${key}.${Number(values.count) === 1 ? 'one' : 'other'}` : key;
  const selectedKey = Object.hasOwn(vi, pluralKey) ? pluralKey : key;
  const template = Object.hasOwn(dictionary, selectedKey) ? dictionary[selectedKey] : Object.hasOwn(vi, selectedKey) ? vi[selectedKey] : key;
  if (typeof template !== 'string') return '';
  return template.replace(/\{([\w]+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}

// For existing, fixed UI metadata such as role labels. Never apply to guest/hotel names or input values.
export function translateLabel(locale, label) {
  return translateUiText(locale, label);
}

export function translateUiText(locale, source) {
  const normalized = normalizeLocale(locale);
  if (normalized === DEFAULT_LOCALE || typeof source !== 'string' || !source) return source;
  const catalog = textCatalogs[normalized];
  if (catalog.exact.has(source)) return catalog.exact.get(source);
  for (const template of catalog.templates) {
    const match = source.match(template.pattern);
    if (!match) continue;
    const values = Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]]));
    return template.target.replace(/\{([\w]+)\}/g, (placeholder, name) => values[name] ?? placeholder);
  }
  return source;
}

export function translateApiText(locale, source) {
  if (typeof source === 'string' && source.startsWith('i18n:')) {
    return translate(locale, source.slice('i18n:'.length));
  }
  return source;
}

// API data is opaque unless the server explicitly marks it as UI copy.
export function translateApiValue(locale, value) {
  if (typeof value === 'string') return translateApiText(locale, value);
  if (value && typeof value === 'object' && typeof value.$i18n === 'string') {
    return translate(locale, value.$i18n, value.values ?? {});
  }
  return value;
}

// Only use for known message envelopes, never names, notes, or other business data.
export function translateApiMessage(locale, value) {
  return typeof value === 'string' && !value.startsWith('i18n:')
    ? translateUiText(locale, value)
    : translateApiValue(locale, value);
}
