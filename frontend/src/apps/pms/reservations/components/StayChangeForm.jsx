import DateInput from '../../../../shared/components/DateInput.jsx';
import { formatDate } from '../../../../shared/lib/date.js';
import { useEffect, useRef, useState } from 'react';
import { usePms } from '../../data/usePms';
import { bookingRooms, money, today } from '../../data/model';
import { useDraftGuard } from '../../../../shared/drafts/DraftGuardProvider';
import { useI18n } from '../../../../shared/i18n/useI18n';

export default function StayChangeForm(props) {
  const { tenantId, user, authGeneration } = usePms();
  return <StayChangeEditor key={JSON.stringify([tenantId, user?.id, authGeneration, props.booking.id])} {...props} />;
}

function StayChangeEditor({ booking, group, onDone, onCancel }) {
  const { t } = useI18n();
  const pms = usePms();
  const [draft, setDraft] = useState(() => ({ rooms: bookingRooms(booking), checkOut: booking.checkOut, effectiveDate: today(pms.settings.timezone), expectedVersion: booking.version }));
  const [reason, setReason] = useState(''), [confirmedOta, setConfirmedOta] = useState(false);
  const [preview, setPreview] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const section = useRef(null);
  const inFlight = useRef(false), intent = useRef(null), dirty = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { requestLeave } = useDraftGuard({ group, dirty: () => dirty.current || Boolean(section.current?.querySelector('.date-input-control [aria-invalid="true"]')), pending: () => inFlight.current, onDiscard: () => { dirty.current = false; } });
  const change = value => { dirty.current = true; setDraft(value); setPreview(null); intent.current = null; setError(''); };
  async function act(confirm) {
    const invalid = section.current?.querySelector('[aria-invalid="true"]');
    if (invalid) { invalid.reportValidity(); return; }
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (confirm) {
        const body = { ...draft, previewToken: preview.previewToken, reason, confirmOta: confirmedOta };
        if (!intent.current) intent.current = crypto.randomUUID();
        await pms.confirmStayChange(booking.id, body, intent.current);
        if (!mounted.current) return;
        dirty.current = false; onDone();
      } else {
        const input = { ...draft, expectedVersion: booking.version };
        const result = await pms.previewStayChange(booking.id, input);
        if (!mounted.current) return;
        setDraft(input); setPreview(result);
      }
    } catch (err) { if (mounted.current) { setError(err.message); if (['preview_changed', 'stale_booking'].includes(err.code)) setPreview(null); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const total = value => money(value, booking.currency);
  return <section ref={section} className="booking-detail-confirmation stay-change-form" aria-label={t('stayChange.title')} data-i18n-ignore>
    <h3>{t('stayChange.title')}</h3><p className="booking-detail-help">{t('stayChange.policy')}</p>
    <form className="booking-detail-form" onSubmit={event => { event.preventDefault(); act(false); }}>
      <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'contents' }}>
        {draft.rooms.map((number, index) => <label className="booking-detail-field" key={index}><span>{t('stayChange.room')} {index + 1}</span><select className="booking-detail-input" value={number} onChange={event => change({ ...draft, rooms: draft.rooms.map((value, at) => at === index ? event.target.value : value) })}>
          {pms.rooms.filter(room => room.active !== false).map(room => <option key={room.uuid || room.id} value={room.number || room.id}>{room.number || room.id}</option>)}
        </select></label>)}
        <label className="booking-detail-field"><span>{t('stayChange.effectiveDate')}</span><DateInput className="booking-detail-input" value={draft.effectiveDate} readOnly /></label>
        <label className="booking-detail-field"><span>{t('stayChange.checkOut')}</span><DateInput className="booking-detail-input" min={draft.effectiveDate} value={draft.checkOut} required onChange={checkOut => change({ ...draft, checkOut })} /></label>
        <button className="booking-detail-button" type="submit">{busy ? t('common.loading') : t('stayChange.preview')}</button>
      </fieldset>
    </form>
    {error && <p className="booking-detail-error" role="alert">{error}</p>}
    {preview && <form onSubmit={event => { event.preventDefault(); act(true); }}>
      <dl className="booking-detail-summary"><div><dt>{t('stayChange.previous')}</dt><dd>{total(preview.previousTotal)}</dd></div><div><dt>{t('stayChange.total')}</dt><dd>{total(preview.total)}</dd></div><div><dt>{t('stayChange.difference')}</dt><dd>{total(preview.difference)}</dd></div><div><dt>{t('stayChange.balance')}</dt><dd>{total(preview.balance)}</dd></div></dl>
      <details><summary>{t('stayChange.nights')}</summary><ul>{preview.nightlyRates.map(rate => <li key={`${rate.room}:${rate.date}`}>{formatDate(rate.date)} · {rate.room} · {total(rate.price)}</li>)}</ul></details>
      {Number(preview.refundRequired) > 0 && <p role="status">{t('stayChange.refundFirst', { amount: total(preview.refundRequired) })}</p>}
      {preview.checkoutNow && Number(preview.balance) > 0 && <p role="status">{t('stayChange.payFirst', { amount: total(preview.balance) })}</p>}
      <label className="booking-detail-field"><span>{t('stayChange.reason')}</span><textarea className="booking-detail-input" required maxLength={1000} value={reason} disabled={busy} onChange={event => { dirty.current = true; intent.current = null; setReason(event.target.value); }} /></label>
      {preview.otaLinked && <label className="booking-detail-help"><input type="checkbox" required checked={confirmedOta} disabled={busy} onChange={event => { intent.current = null; setConfirmedOta(event.target.checked); }} /> {t('stayChange.ota')}</label>}
      <div className="booking-detail-form-actions"><button className="booking-detail-button booking-detail-button--primary" type="submit" disabled={busy || !reason.trim() || Number(preview.refundRequired) > 0 || preview.checkoutNow && Number(preview.balance) !== 0 || preview.otaLinked && !confirmedOta}>{t('stayChange.confirm')}</button></div>
    </form>}
    <button className="booking-detail-button" type="button" disabled={busy} onClick={() => requestLeave(onCancel)}>{t('common.close')}</button>
  </section>;
}
