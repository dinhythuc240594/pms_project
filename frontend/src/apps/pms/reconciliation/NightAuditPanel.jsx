import { formatDate } from '../../../shared/lib/date.js';
import DateInput from '../../../shared/components/DateInput.jsx';
import { useEffect, useRef, useState } from 'react';
import { usePms } from '../data/usePms';
import { addDays, money, today } from '../data/model';
import { createIntentJournal } from '../data/api';
import { useDraftGuard } from '../../../shared/drafts/DraftGuardProvider';
import { useI18n } from '../../../shared/i18n/useI18n';

export default function NightAuditPanel() {
  const { tenantId, user, authGeneration } = usePms();
  return <NightAuditForm key={JSON.stringify([tenantId, user?.id, authGeneration])} />;
}

function NightAuditForm() {
  const { t } = useI18n();
  const { tenantId, user, authGeneration, settings, requestTenant, access, refreshWorkspace } = usePms();
  const [day, setDay] = useState(() => addDays(today(settings.timezone), -1));
  const [dayValid, setDayValid] = useState(true);
  const [loaded, setLoaded] = useState(null), [reason, setReason] = useState(''), [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false), [actionError, setError] = useState(''), [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [journal] = useState(() => createIntentJournal((() => { try { return sessionStorage; } catch { return undefined; } })()));
  const inFlight = useRef(false), scope = `${tenantId}:${user?.id}:${authGeneration}`, current = useRef(scope);
  const key = JSON.stringify([scope, day, revision]);
  const preview = dayValid && loaded?.key === key ? loaded.data : null;
  const error = actionError || (loaded?.key === key ? loaded.error : '');
  useEffect(() => { current.current = scope; return () => { current.current = null; }; }, [scope]);
  useDraftGuard({ dirty: reason.length > 0, pending: () => inFlight.current, onDiscard: () => { setReason(''); setAck(false); } });
  useEffect(() => {
    let mounted = true;
    if (!dayValid || !day) return;
    requestTenant('/reconciliation/night-audit?date=' + encodeURIComponent(day)).then(data => {
      if (mounted) setLoaded({ key, data, error: '' });
    }).catch(err => { if (mounted) setLoaded({ key, data: null, error: err.message }); });
    return () => { mounted = false; };
  }, [requestTenant, day, key, dayValid]);
  async function close(event) {
    event.preventDefault();
    if (inFlight.current || !dayValid || !preview || !ack || preview.periodLocked || preview.blockers.length) return;
    inFlight.current = true; setBusy(true); setError('');
    const operationScope = scope;
    try {
      const body = { date: day, previewToken: preview.previewToken, reason };
      const intent = await journal.acquire(`/api/tenants/${encodeURIComponent(tenantId)}/reconciliation/night-audit`, body, undefined, user?.id);
      if (current.current !== operationScope) return;
      const result = await requestTenant('/reconciliation/night-audit', { method: 'POST', body, intent: intent.key });
      journal.confirm(intent);
      if (current.current !== operationScope) return;
      setLoaded({ key, data: result, error: '' }); setReason(''); setNotice(t('nightAudit.saved'));
      await refreshWorkspace?.({ quiet: true }).catch(() => {});
    } catch (err) { if (current.current === operationScope) { setError(err.message); if (err.code === 'preview_changed') setLoaded(null); } }
    finally { inFlight.current = false; if (current.current === operationScope) setBusy(false); }
  }
  return <section className="day-reconciliation-section night-audit-panel" aria-labelledby="night-audit-heading" data-i18n-ignore>
    <h2 id="night-audit-heading">{t('nightAudit.title')}</h2><p className="day-reconciliation-notice">{t('nightAudit.policy')}</p>
    <div className="day-reconciliation-filter"><label>{t('reconciliation.date')}<DateInput required max={addDays(today(settings.timezone), -1)} value={day} disabled={busy} onValidityChange={setDayValid} onChange={value => { setDay(value); setNotice(''); setError(''); setAck(false); }} /></label><button type="button" disabled={busy || !dayValid} onClick={() => { setRevision(value => value + 1); setError(''); setAck(false); }}>{t('reconciliation.reload')}</button></div>
    {error && <p className="day-reconciliation-error" role="alert">{error}</p>}{notice && <p className="day-reconciliation-success" role="status">{notice}</p>}
    {preview && <>
      <p>{preview.periodLocked ? t('nightAudit.locked') : t('nightAudit.open')} · {preview.timezone}</p>
      <p className="day-reconciliation-notice">{t('nightAudit.recognitionStart', { date: formatDate(preview.recognitionStart) })}</p>
      <div className="day-reconciliation-cards">{preview.totals.map(total => <div className="day-reconciliation-card" key={`${total.currency}:${total.baseCurrency}`}><span>{t('nightAudit.revenue')}</span><strong>{money(total.amount, total.currency)}</strong><small>{money(total.baseAmount, total.baseCurrency)}</small></div>)}</div>
      {!preview.totals.length && <p>{t('nightAudit.noRevenue')}</p>}
      {preview.blockers.length > 0 && <div role="status"><h3>{t('nightAudit.blockers')}</h3><ul>{preview.blockers.map(row => <li key={row.bookingId || row.reviewId}>{row.guest || row.reviewId} · {row.status}</li>)}</ul></div>}
      <details><summary>{t('nightAudit.entries', { count: preview.entries.length })}</summary><ul>{preview.entries.map(row => <li key={`${row.sourceKind}:${row.sourceId}`}>{formatDate(row.sourceDate)} · {row.sourceKind} · {row.details.room || row.details.bookingId || row.sourceId} · {money(row.amount, row.currency)}{row.adjustment ? ` · ${t('nightAudit.adjustment')}` : ''}</li>)}</ul></details>
      {!preview.periodLocked && access('reconciliation.confirm').allowed && <form className="day-reconciliation-dialog" onSubmit={close}>
        <label>{t('nightAudit.reason')}<textarea required maxLength={1000} rows={3} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        <label className="day-reconciliation-ack"><input type="checkbox" required checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)} />{t('nightAudit.acknowledge')}</label>
        <button className="is-primary" type="submit" disabled={busy || !ack || !reason.trim() || preview.blockers.length > 0}>{busy ? t('common.loading') : t('nightAudit.close')}</button>
      </form>}
    </>}
  </section>;
}
