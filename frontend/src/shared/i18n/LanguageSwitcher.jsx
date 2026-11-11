import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { languages } from './core.js';
import { useI18n } from './useI18n.js';
import './LanguageSwitcher.css';

export default function LanguageSwitcher({ compact = false }) {
  const { locale, setLocale, t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const openingIndex = useRef(0);
  const selected = languages.find(language => language.code === locale) || languages[0];

  useEffect(() => {
    if (!open) return undefined;
    rootRef.current?.querySelectorAll('[role="menuitemradio"]')[openingIndex.current]?.focus();
    const closeOutside = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function openOnArrow(event) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    openingIndex.current = event.key === 'ArrowUp' ? languages.length - 1 : 0;
    setOpen(true);
  }

  function handleMenuKey(event) {
    if (!open) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      // Anchor native Tab navigation before the focused menu item is removed.
      triggerRef.current?.focus();
      setOpen(false);
      return;
    }
    const items = [...rootRef.current.querySelectorAll('[role="menuitemradio"]')];
    const index = items.indexOf(document.activeElement);
    const destination = { ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1 }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    items[destination]?.focus();
  }

  function chooseLanguage(code) {
    setLocale(code);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return <div ref={rootRef} className={`loha-language-switcher${compact ? ' is-compact' : ''}${open ? ' is-open' : ''}`} data-i18n-ignore onKeyDown={handleMenuKey} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={triggerRef} type="button" className="loha-language-trigger" aria-label={`${t('language.label')}: ${selected.nativeName}`} title={t('language.label')} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onKeyDown={openOnArrow} onClick={() => { openingIndex.current = 0; setOpen(value => !value); }}>
      <span className="loha-language-icon"><Languages size={16} aria-hidden="true" /></span>
      <span className="loha-language-current" lang={selected.code}>{compact ? selected.shortName : selected.nativeName}</span>
      <ChevronDown className="loha-language-chevron" size={15} aria-hidden="true" />
    </button>
    {open && <div id={id} className="loha-language-menu" role="menu" aria-label={t('language.label')}>
      <span className="loha-language-menu-title">{t('language.label')}</span>
      {languages.map(language => <button key={language.code} type="button" className="loha-language-option" role="menuitemradio" tabIndex={-1} aria-checked={language.code === locale} lang={language.code} onClick={() => chooseLanguage(language.code)}>
        <span className="loha-language-code">{language.shortName}</span>
        <span>{language.nativeName}</span>
        <Check size={16} aria-hidden="true" />
      </button>)}
    </div>}
  </div>;
}
