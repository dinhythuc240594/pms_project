import { tr as labelUi, useI18n } from '../../../shared/i18n/useI18n.js';
import React, { useEffect, useRef } from 'react';

let modalCount = 0;
let previousBodyOverflow;
let previousPageOverflow;

// Accessible behavior around the existing overlay; its original styles stay on the div.
export default function LegacyOverlay({ title, onClose, style, children, modal = false }) {
  useI18n();
  const ref = useRef(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    const root = ref.current;
    if (modal) {
      root.showModal();
      if (modalCount === 0) {
        previousBodyOverflow = document.body.style.overflow;
        previousPageOverflow = document.documentElement.style.overflow;
      }
      modalCount += 1;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }
    const controls = () => [...root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length);
    (controls()[0] || root).focus();
    function onKey(event) {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== root) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key === 'Tab') {
        const items = controls();
        const first = items[0], last = items[items.length - 1];
        if (!items.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); if (!items.length) root.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (modal) {
        root.close();
        modalCount -= 1;
        if (modalCount === 0) {
          document.body.style.overflow = previousBodyOverflow;
          document.documentElement.style.overflow = previousPageOverflow;
        }
      }
      previous?.focus({ preventScroll: true });
    };
  }, [modal]);
  const Container = modal ? 'dialog' : 'div';
  return <Container ref={ref} tabIndex={-1} className="pms-legacy-overlay" role="dialog" aria-modal="true" aria-label={labelUi(title)} style={modal ? { margin: 0, border: 0, maxWidth: 'none', maxHeight: 'none', width: '100%', height: '100%', ...style } : style} onCancel={event => { event.preventDefault(); onClose(); }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>{children}</Container>;
}
