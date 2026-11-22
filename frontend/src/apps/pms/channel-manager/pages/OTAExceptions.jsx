import { useRef, useState } from 'react';
import { useDraftGuard } from '../../../../shared/drafts/DraftGuardProvider.jsx';
import FormDialog from '../../components/FormDialog';
import { useChannels } from '../useChannels';
import { channelCompletionAccess } from '../integration';
import { decimalInput } from '../../../../shared/lib/number.js';
import { formatDate } from '../../../../shared/lib/date.js';
import './OTAExceptions.css';

export function BookingReviewResolver({ pms, review, onClose, onResolved }) {
  const [form, setForm] = useState({ reservationId: pms.bookings?.find(row => row.pricingSnapshot?.channel?.bookingId === review.bookingId)?.id || '', providerTotal: review.details?.amount || '', expectedTotal: '', reason: '', confirm: false, intent: crypto.randomUUID(), dirty: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false);
  const guard = useDraftGuard({ dirty: form.dirty, pending: busy, onDiscard: onClose });
  const booking = pms.bookings?.find(row => row.id === form.reservationId);
  function change(name, value) { setForm(previous => ({ ...previous, [name]: value, dirty: true, intent: crypto.randomUUID() })); }
  function close() { if (!inFlight.current) guard.requestLeave(onClose); }
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || !booking || !form.confirm) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (!form.reason.trim()) throw new Error('Vui lòng nhập lý do.');
      const input = { reservationId: booking.id, expectedVersion: booking.version, providerTotal: decimalInput(form.providerTotal), expectedTotal: decimalInput(form.expectedTotal), reason: form.reason.trim(), confirm: true };
      if (pms.resolveChannelReview) await pms.resolveChannelReview(review.id, input, form.intent);
      else await pms.requestTenant(`/channels/booking-reviews/${encodeURIComponent(review.id)}/resolve`, { method: 'POST', body: input, intent: form.intent });
      onResolved();
    } catch (err) { setError(err.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <FormDialog title="Đối soát cập nhật OTA với booking PMS" busy={busy} error={error} onClose={close}>
    <form className="ota-exception-form" onSubmit={submit}>
      <p>Hoàn tất sửa ngày, phòng, thuế/phí và tiền trên booking PMS trước khi liên kết. Thao tác này lưu quyết định đối soát và xếp xác nhận nhận dữ liệu; không tự thu tiền hoặc sửa booking.</p>
      <p>Mã OTA: <strong>{review.details?.bookingCode || review.bookingId}</strong> · {formatDate(review.details?.arrivalDate)} → {formatDate(review.details?.departureDate)} · {review.details?.currency}</p>
      <FinancialDetails details={review.details} />
      <fieldset disabled={busy}>
        <label>Booking PMS đã kiểm tra<select required value={form.reservationId} onChange={event => { change('reservationId', event.target.value); change('expectedTotal', ''); }}>
          <option value="">Chọn booking đã nhập/điều chỉnh</option>{(pms.bookings || []).filter(row => row.currency === review.details?.currency).map(row => <option value={row.id} key={row.id}>{row.guest} · {row.rooms?.join(', ')} · {formatDate(row.checkIn)} → {formatDate(row.checkOut)} · {row.total} {row.currency}</option>)}
        </select></label>
        {booking && <p role="status">Tổng PMS hiện tại: <strong>{booking.total} {booking.currency}</strong>. Phần chênh lệch với OTA phải được giải thích dưới đây.</p>}
        <div className="ota-exception-grid">
          <label>Tổng tiền gốc OTA<input required inputMode="decimal" maxLength={20} pattern="[0-9]{1,15}([.][0-9]{1,4})?" value={form.providerTotal} onChange={event => change('providerTotal', event.target.value)} /></label>
          <label>Nhập lại tổng PMS đã đối chiếu<input required inputMode="decimal" maxLength={20} pattern="[0-9]{1,15}([.][0-9]{1,4})?" value={form.expectedTotal} onChange={event => change('expectedTotal', event.target.value)} /></label>
        </div>
        <label>Kết quả đối soát và lý do chênh lệch<textarea required maxLength={1000} rows={4} value={form.reason} onChange={event => change('reason', event.target.value)} /></label>
        <label className="ota-exception-check"><input required type="checkbox" checked={form.confirm} onChange={event => change('confirm', event.target.checked)} /><span>Tôi đã kiểm tra ngày/phòng, thuế/dịch vụ, khoản OTA thu hộ, hoa hồng và tổng tiền; booking PMS phản ánh đúng kết quả đối soát.</span></label>
      </fieldset>
      <div className="ota-exception-actions"><button type="button" className="ota-button" disabled={busy} onClick={close}>Đóng</button><button type="submit" className="ota-button ota-button--primary" disabled={busy || !booking || !form.confirm}>{busy ? 'Đang lưu…' : 'Lưu đối soát và xếp xác nhận'}</button></div>
    </form>
  </FormDialog>;
}

function FinancialDetails({ details = {} }) {
  const lines = [
    ...(details.services || []).map(line => ({ ...line, group: 'Dịch vụ' })),
    ...(details.taxes || []).map(line => ({ ...line, group: 'Thuế/phí' })),
    ...(details.collectedTaxes || []).map(line => ({ ...line, group: 'OTA thu hộ' })),
    ...(details.rooms || []).flatMap((room, index) => [
      ...(room.services || []).map(line => ({ ...line, group: `Phòng ${index + 1} · dịch vụ` })),
      ...(room.taxes || []).map(line => ({ ...line, group: `Phòng ${index + 1} · thuế/phí` })),
      ...(room.collectedTaxes || []).map(line => ({ ...line, group: `Phòng ${index + 1} · OTA thu hộ` })),
    ]),
  ];
  return <div className="ota-exception-financial"><p>Bên thu tiền: <strong>{details.paymentCollect === 'ota' ? 'OTA' : details.paymentCollect === 'property' ? 'Khách sạn' : 'Chưa xác định'}</strong> · Hoa hồng OTA: {details.otaCommission || 'Chưa cung cấp'}</p>
    {lines.length > 0 && <ul>{lines.map((line, index) => <li key={index}><strong>{line.group}: </strong>{line.name || line.type || 'Chưa có tên'} · {line.totalPrice || 'Cần kiểm tra số tiền'} {details.currency}{line.included && ' · đã gồm giá phòng'}{line.withheld && ' · OTA giữ lại'}</li>)}</ul>}
  </div>;
}

export function ChannelIncidents({ pms, refreshKey = 0 }) {
  const [status, setStatus] = useState('open'), [page, setPage] = useState(1), [selected, setSelected] = useState(null);
  const query = useChannels(pms.requestTenant, pms.tenantId, `/channels/incidents?status=${status}&page=${page}&pageSize=25`, true, refreshKey);
  const access = pms.access('channels.write', 'OTA_SYNC', true);
  const canResolve = channelCompletionAccess(pms, access);
  const items = query.data?.items || [], pagination = query.data?.pagination;
  return <section className="ota-panel ota-incidents" aria-labelledby="ota-incidents-title">
    <div className="ota-section-header"><div><h2 id="ota-incidents-title">Sự cố và cảnh báo từ kênh bán</h2><p>Thông báo từ OTA có thể đến sau khi Channex đã nhận giá. Kiểm tra trên kênh trước khi xác nhận đã xử lý.</p></div><button type="button" className="ota-button" disabled={query.loading} onClick={query.refresh}>Tải lại sự cố</button></div>
    <div className="ota-exception-filter"><label>Trạng thái<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="open">Cần xử lý</option><option value="resolved">Đã xử lý</option><option value="all">Tất cả</option></select></label></div>
    {query.loading ? <p className="ota-state" role="status">Đang tải sự cố kênh…</p> : query.error ? <p className="ota-state" role="alert">{query.error}</p> : !items.length ? <p className="ota-state">Không có sự cố phù hợp.</p> : <ul className="ota-incident-list">{items.map(row => <li key={row.id}>
      <div><strong>{row.channelName || 'Channex'} · {row.eventCode}</strong><p>{row.errorType || 'Kiểm tra thông báo trên Channex/OTA'}</p>{row.channelId && <small>Mã kênh: {row.channelId}</small>}{row.details?.start_date && <small>Từ ngày: {row.details.start_date} {row.details?.end_date && `→ ${row.details.end_date}`}</small>}<small>Người xử lý: {query.data.assignees?.find(person => person.id === row.assigneeId)?.name || 'Chưa giao'}</small>{row.resolvedAt && <p>Đã xử lý: {row.resolutionNote}</p>}</div>
      {canResolve && <button type="button" className="ota-button" onClick={() => setSelected(row)}>{row.resolvedAt ? 'Xem / mở lại' : 'Giao việc / xử lý'}</button>}
    </li>)}</ul>}
    {pagination && <div className="ota-review-pagination"><span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)} · {pagination.totalItems} sự cố</span><button type="button" className="ota-button" disabled={query.loading || page <= 1} onClick={() => setPage(value => value - 1)}>Trang trước</button><button type="button" className="ota-button" disabled={query.loading || page >= pagination.totalPages} onClick={() => setPage(value => value + 1)}>Trang sau</button></div>}
    {selected && <IncidentForm key={selected.id} pms={pms} incident={selected} assignees={query.data?.assignees || []} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); query.refresh(); }} />}
  </section>;
}

function IncidentForm({ pms, incident, assignees, onClose, onSaved }) {
  const [form, setForm] = useState({ action: incident.resolvedAt ? 'reopen' : 'resolve', assigneeId: incident.assigneeId || '', reason: '', verified: false, intent: crypto.randomUUID(), dirty: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false);
  const guard = useDraftGuard({ dirty: form.dirty, pending: busy, onDiscard: onClose });
  function change(name, value) { setForm(previous => ({ ...previous, [name]: value, dirty: true, intent: crypto.randomUUID() })); }
  function close() { if (!inFlight.current) guard.requestLeave(onClose); }
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    const input = { action: form.action, reason: form.reason, ...(form.action === 'assign' ? { assigneeId: form.assigneeId || null } : form.action === 'resolve' ? { verified: form.verified } : {}) };
    try {
      if (pms.channelIncidentAction) await pms.channelIncidentAction(incident.id, input, form.intent);
      else await pms.requestTenant(`/channels/incidents/${encodeURIComponent(incident.id)}/actions`, { method: 'POST', body: input, intent: form.intent });
      onSaved();
    } catch (err) { setError(err.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <FormDialog title="Xử lý sự cố kênh bán" busy={busy} error={error} onClose={close}>
    <form className="ota-exception-form" onSubmit={submit}><p>{incident.channelName} · {incident.errorType}</p><fieldset disabled={busy}>
      <label>Thao tác<select value={form.action} onChange={event => change('action', event.target.value)}><option value="resolve">Xác nhận đã xử lý</option><option value="assign">Giao người xử lý</option><option value="reopen">Mở lại sự cố</option></select></label>
      {form.action === 'assign' && <label>Người xử lý<select value={form.assigneeId} onChange={event => change('assigneeId', event.target.value)}><option value="">Chưa giao</option>{assignees.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>}
      <label>Kết quả kiểm tra / lý do<textarea required maxLength={1000} rows={4} value={form.reason} onChange={event => change('reason', event.target.value)} /></label>
      {form.action === 'resolve' && <label className="ota-exception-check"><input required type="checkbox" checked={form.verified} onChange={event => change('verified', event.target.checked)} /><span>Tôi đã kiểm tra giá, phòng trống hoặc kết quả liên quan trên kênh; sự cố đã được khắc phục.</span></label>}
    </fieldset><div className="ota-exception-actions"><button type="button" className="ota-button" disabled={busy} onClick={close}>Đóng</button><button type="submit" className="ota-button ota-button--primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu kết quả'}</button></div></form>
  </FormDialog>;
}
