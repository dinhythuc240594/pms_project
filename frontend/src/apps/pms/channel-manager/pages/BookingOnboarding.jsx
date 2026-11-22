import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Info } from 'lucide-react';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { channelErrorMessage, channelJobStatuses, onboardingConfirmReason } from '../presentation';

export default function BookingOnboarding({ pms, onboarding, connection, channelsPath, historyPath, disabledReason, disabled, onReconciled }) {
  useI18n();
  const [confirmedRevision, setConfirmedRevision] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const working = useRef(false), mounted = useRef(true), errorNotice = useRef(null);
  const revision = onboarding?.revision;
  const blocked = disabledReason || onboardingConfirmReason(onboarding);
  const reconciled = Boolean(connection.inventoryReconciledAt);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (error) errorNotice.current?.focus(); }, [error]);
  async function reconcile(event) {
    event.preventDefault();
    if (working.current || disabled || blocked || confirmedRevision !== revision) return;
    working.current = true; setBusy(true); setError('');
    try {
      await pms.requestTenant('/channels/onboarding/reconcile', { method: 'POST', body: { revision, confirm: true } });
      if (mounted.current) onReconciled();
    } catch (failure) { if (mounted.current) { setError(failure.message); setConfirmedRevision(null); } }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="ota-panel ota-booking-onboarding" aria-labelledby="ota-onboarding-title">
    <div className="ota-section-header"><div><h2 id="ota-onboarding-title">{tUi('channels.onboarding.title')}</h2><p>{tUi('channels.onboarding.description')}</p></div><span className={`ota-status ota-status--${reconciled ? 'succeeded' : 'warning'}`}>{tUi(reconciled ? 'channels.onboarding.reconciled' : 'channels.onboarding.required')}</span></div>
    <div className="ota-sync-action">
      <ol className="ota-onboarding-steps"><li>{tUi('channels.onboarding.loadStep')} <Link to={channelsPath}>{tUi('channels.onboarding.openChannels')} <ArrowRight size={14} aria-hidden="true" /></Link></li><li>{tUi('channels.onboarding.compareStep')} <Link to={historyPath}>{tUi('channels.onboarding.openHistory')}</Link></li></ol>
      {!!onboarding?.loads?.length && <ul className="ota-onboarding-loads" aria-label={tUi('channels.onboarding.requests')}>{onboarding.loads.map(job => <li key={job.id}><span>{tUi('channels.onboarding.loadLabel')} <span className={`ota-status ota-status--${job.status}`}>{job.status === 'succeeded' ? tUi('channels.onboarding.requested') : labelUi(channelJobStatuses[job.status] || 'Cần kiểm tra')}</span></span><details><summary>{tUi('channels.onboarding.channelDetails')}</summary><code>{job.channelId}</code></details>{job.errorCode && <p>{labelUi(channelErrorMessage(job.errorCode))}</p>}</li>)}</ul>}
      <p className="ota-action-hint">{tUi('channels.onboarding.asyncHint')}</p>
      {error && <div ref={errorNotice} tabIndex={-1} className="ota-notice ota-notice--error" role="alert"><Info size={18} aria-hidden="true" /><span>{error}</span></div>}
      {!reconciled && <form onSubmit={reconcile}><label className="ota-onboarding-confirm"><input type="checkbox" checked={Boolean(revision && confirmedRevision === revision)} disabled={busy || disabled || Boolean(blocked)} onChange={event => setConfirmedRevision(event.target.checked ? revision : null)} /><span>{tUi('channels.onboarding.confirmStatement')}</span></label><button type="submit" className="ota-button ota-button--primary" disabled={busy || disabled || Boolean(blocked) || !revision || confirmedRevision !== revision} aria-describedby="ota-onboarding-hint"><Check size={16} aria-hidden="true" />{tUi(busy ? 'common.saving' : 'channels.onboarding.confirm')}</button><p id="ota-onboarding-hint" className="ota-action-hint" role="status">{blocked ? labelUi(blocked) : tUi('channels.onboarding.confirmHint')}</p></form>}
    </div>
  </section>;
}
