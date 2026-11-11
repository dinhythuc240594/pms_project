import { useSyncExternalStore } from 'react';
import { DEFAULT_LOCALE, translateApiValue } from './core.js';
import { getIntlLocale, getLocale, setLocale, subscribeLocale, t, tr } from './store.js';

export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => DEFAULT_LOCALE);
  const apiText = value => translateApiValue(locale, value);
  return { locale, intlLocale: getIntlLocale(), setLocale, t, tr, apiText };
}
export { t, tr };
