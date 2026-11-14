import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { t as tUi, useI18n } from '../../../shared/i18n/useI18n.js';
import './FormDialog.css';

export default function FormDialog({ title, busy, error, onClose, children }) {
  useI18n();
  const ref = useRef(null), titleId = useId();
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement;
    dialog.showModal();
    dialog.querySelector('input:not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])')?.focus();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  function close() { if (!busy) onClose(); }
  return <dialog ref={ref} className="pms-form-dialog" aria-labelledby={titleId} aria-busy={busy || undefined}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="pms-form-dialog-surface">
      <header className="pms-form-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" aria-label={tUi('common.closeWindow')} disabled={busy} onClick={close}><X size={18} aria-hidden="true" /></button></header>
      {error && <p className="pms-form-dialog-error" role="alert">{error}</p>}
      {children}
    </div>
  </dialog>;
}
