import { useEffect, useRef } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/useI18n.js';
import { embedPath } from './context';
import './Chatbot.css';

export default function ChatbotSidebar({ open, tenantId, onClose }) {
  const { t } = useI18n();
  const closeRef = useRef(null);
  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);
  return <aside id="pms-chatbot-sidebar" className="pms-chatbot-sidebar" aria-labelledby="pms-chatbot-title" hidden={!open} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); onClose(); } }}>
    <div className="pms-chatbot-heading"><h2 id="pms-chatbot-title"><MessageSquare size={18} aria-hidden="true" />{t('chatbot.title')}</h2><button ref={closeRef} type="button" onClick={onClose} aria-label={t('chatbot.close')}><X size={19} aria-hidden="true" /></button></div>
    <iframe title={t('chatbot.frameTitle')} src={embedPath(tenantId)} referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'" />
  </aside>;
}
