import { t as tUi, tr as labelUi, useI18n } from '../i18n/useI18n.js';
import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, RefreshCw, ShieldAlert, Unplug, FileQuestion, LogIn, CircleAlert } from 'lucide-react';
import { usePms } from '../../apps/pms/data/usePms';
import LohaBrand from './LohaBrand';
import { errorScreens, readableErrorMessage } from './errorStatus';
import './LohaErrorPage.css';

export default function LohaErrorPage({ status = 500, message, onRetry, onClose, children, fullPage = false }) {
  useI18n();
  const { user, isManager, role } = usePms();
  const location = useLocation(), navigate = useNavigate();
  const [busy, setBusy] = useState(false), [retryError, setRetryError] = useState('');
  const running = useRef(false);
  const screen = errorScreens[status] || errorScreens[500];
  const description = readableErrorMessage(message, screen.description);
  const Icon = status === 403 ? ShieldAlert : status === 404 ? FileQuestion : status === 503 ? Unplug : status === 401 ? LogIn : CircleAlert;
  const home = !user ? '/' : isManager ? '/manager/dashboard' : role === 'HOUSEKEEPING' ? '/id/housekeeping/status' : role === 'ACCOUNTANT' ? '/id/cashflow' : '/id/dashboard';
  const login = '/id/login' + (status === 401 ? `?next=${encodeURIComponent(location.pathname + location.search)}` : '');
  async function retry() {
    if (running.current) return;
    running.current = true; setBusy(true); setRetryError('');
    try { await onRetry(); } catch (error) { setRetryError(readableErrorMessage(error.message, screen.description)); }
    finally { running.current = false; setBusy(false); }
  }
  const Container = fullPage ? 'main' : 'section';
  const Heading = fullPage ? 'h1' : 'h2';
  return <Container className={`loha-error-page${fullPage ? ' loha-error-full' : ''}`} aria-label={tUi('errors.status', { status })}>
    <div className="loha-error-brand"><LohaBrand /><span>{tUi("errors.brand")}</span></div>
    <div className="loha-error-content" role="alert">
      <div className="loha-error-visual" aria-hidden="true"><span>{status}</span><div><Icon size={32} strokeWidth={1.6} /></div></div>
      <p className="loha-error-eyebrow">LOHA PMS · {status}</p>
      <Heading>{labelUi(screen.title)}</Heading>
      <p className="loha-error-description">{labelUi(description)}</p>
      {retryError && <p className="loha-error-retry-message">{retryError}</p>}
      <div className="loha-error-actions">
        {status === 401 ? <Link className="loha-error-button loha-error-primary" to={login} onClick={onClose}>{tUi("errors.signIn")}{' '}<LogIn size={17} aria-hidden="true" /></Link> : onRetry ? <button type="button" className="loha-error-button loha-error-primary" disabled={busy} onClick={retry}><RefreshCw size={17} aria-hidden="true" />{busy ? tUi("errors.retrying") : tUi("common.retry")}</button> : <Link className="loha-error-button loha-error-primary" to={home} onClick={onClose}>{user ? tUi("errors.workspace") : tUi("auth.home")}<ArrowRight size={17} aria-hidden="true" /></Link>}
        {onRetry && <Link className="loha-error-button" to={home} onClick={onClose}>{tUi("errors.home")}{' '}<ArrowRight size={17} aria-hidden="true" /></Link>}
        {onClose ? <button type="button" className="loha-error-button" disabled={busy} onClick={onClose}>{tUi("errors.close")}</button> : <button type="button" className="loha-error-button" onClick={() => window.history.state?.idx > 0 ? navigate(-1) : navigate(home, { replace: true })}><ArrowLeft size={17} aria-hidden="true" />{tUi("errors.back")}</button>}
        {status === 403 && <Link className="loha-error-text-link" to="/id/login" onClick={onClose}>{tUi("errors.switchAccount")}</Link>}
      </div>
      {children && <div className="loha-error-extra">{children}</div>}
    </div>
    <p className="loha-error-footer">{tUi("errors.tagline")}</p>
  </Container>;
}
