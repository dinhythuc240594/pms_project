import { useEffect } from 'react';
import { useI18n } from '../../../shared/i18n/useI18n.js';

// Keep the selected item visible without moving the page vertically.
export function useRevealActive(ref, selection) {
  const { locale } = useI18n();
  useEffect(() => {
    const rail = ref.current;
    const active = rail?.querySelector('[aria-pressed="true"], [aria-current="page"]');
    if (!active) return;
    const reveal = () => {
      if (rail.scrollWidth <= rail.clientWidth) return;
      const bounds = rail.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.left < bounds.left + 5) rail.scrollLeft += item.left - bounds.left - 5;
      else if (item.right > bounds.right - 5) rail.scrollLeft += item.right - bounds.right + 5;
    };
    reveal();
    window.addEventListener('resize', reveal);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
    observer?.observe(rail);
    observer?.observe(active);
    return () => { window.removeEventListener('resize', reveal); observer?.disconnect(); };
  }, [ref, selection, locale]);
}
