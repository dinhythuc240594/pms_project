import LohaBrand from './LohaBrand';
import { t, useI18n } from '../i18n/useI18n.js';
import './RequestActivity.css';
import './LohaLoading.css';

export default function LohaLoading({ message, fullPage = false }) {
  useI18n();
  const Container = fullPage ? 'main' : 'section';
  return <Container className={`loha-loading${fullPage ? ' loha-loading-full' : ''}`} role="status" aria-live="polite" aria-atomic="true">
    <div className="loha-loading-content">
      <LohaBrand />
      <div className="loha-loading-indicator" aria-hidden="true"><span className="loha-request-spinner" /></div>
      <p className="loha-loading-title">{message}</p>
      <p className="loha-loading-hint">{t('system.preparingWorkspace')}</p>
    </div>
  </Container>;
}
