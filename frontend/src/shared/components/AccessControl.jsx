import { t as tUi, useI18n } from '../i18n/useI18n.js';
import React from 'react';
import { Link, Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { usePms } from '../../apps/pms/data/usePms';
import LegacyOverlay from '../../apps/pms/components/LegacyOverlay';
import LohaErrorPage from './LohaErrorPage';
import LohaLoading from './LohaLoading';
import { errorStatus } from './errorStatus';
function ContactUpgrade({ onClick }) {
  useI18n();
  return <Link className="loha-error-text-link" to="/contact" onClick={onClick}>{tUi("errors.contact")}</Link>;
}
export function AccessMessage({ result }) {
  return <LohaErrorPage status={errorStatus(result, 403) || 403} message={result.message}>{['feature', 'expired'].includes(result.reason) && <ContactUpgrade />}</LohaErrorPage>;
}
export function RouteGuard() {
  useI18n();
  const { routeAccess, loading, workspaceLoading, loadError, loadErrorStatus, retry } = usePms();
  const context = useOutletContext();
  const location = useLocation();
  if (loading || workspaceLoading) return <LohaLoading message={tUi("system.loadingHotel")} />;
  if (loadError) return <LohaErrorPage status={errorStatus({ status: loadErrorStatus, message: loadError }) || 500} message={loadError} onRetry={() => retry()} />;
  const result = routeAccess(location.pathname + location.search);
  if (result.reason === 'session') return <Navigate to={`/id/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return result.allowed ? <Outlet context={context} /> : <AccessMessage result={result} />;
}
export function LayoutGuard({ children, manager = false }) {
  useI18n();
  const { user, routeAccess, loading, loadError, loadErrorStatus, retry } = usePms();
  const location = useLocation();
  if (loading) return <LohaLoading fullPage message={tUi("system.checkingSession")} />;
  if (!user && loadError) return <LohaErrorPage fullPage status={errorStatus({ status: loadErrorStatus, message: loadError }) || 500} message={loadError} onRetry={() => retry()} />;
  if (!user) return <Navigate to={`/id/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (manager) {
    const result = routeAccess('/manager');
    if (!result.allowed) return <LohaErrorPage fullPage status={errorStatus(result, 403)} message={result.message} />;
  }
  return children;
}
export function AccessDialog() {
  useI18n();
  const { accessDialog, closeAccess } = usePms();
  if (!accessDialog) return null;
  const status = errorStatus(accessDialog, accessDialog.reason === 'error' ? 500 : null);
  return <LegacyOverlay modal title={status ? `Thông báo ${status}` : tUi("errors.notification")} onClose={closeAccess} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#0f172a99', display: 'grid', placeItems: 'center', padding: 12 }}><div className="loha-error-dialog">{status ? <LohaErrorPage status={status} message={accessDialog.message} onClose={closeAccess}>{['feature', 'expired'].includes(accessDialog.reason) && <ContactUpgrade onClick={closeAccess} />}</LohaErrorPage> : <section className="loha-error-page"><div className="loha-error-content" role="alert"><h2>{tUi("errors.notification")}</h2><p className="loha-error-description">{accessDialog.message}</p><div className="loha-error-actions">{['feature', 'expired', 'quota'].includes(accessDialog.reason) && <ContactUpgrade onClick={closeAccess} />}<button className="loha-error-button loha-error-primary" type="button" onClick={closeAccess}>{tUi("errors.close")}</button></div></div></section>}</div></LegacyOverlay>;
}
export function AccessLink({ to, children, onClick, style, ...props }) {
  useI18n();
  const { routeAccess, showAccess } = usePms();
  const result = routeAccess(to);
  return <Link {...props} to={to} data-locked={!result.allowed} title={!result.allowed ? result.message : props.title} style={{ ...style, opacity: result.allowed ? 1 : 0.55 }} onClick={e => { if (!result.allowed) { e.preventDefault(); showAccess(result); } else onClick?.(e); }}>{children}{!result.allowed && <span aria-label={tUi("nav.locked")} style={{ marginLeft: 'auto', fontSize: 12 }}>🔒</span>}</Link>;
}
