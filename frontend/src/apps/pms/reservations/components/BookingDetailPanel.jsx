import DateInput from '../../../../shared/components/DateInput.jsx';
import { formatDate, formatDateTime } from '../../../../shared/lib/date.js';
import { phonePattern } from '../../../../shared/lib/phone.js';
import { emailPattern } from '../../../../shared/lib/validation.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import React, { useEffect, useId, useRef, useState } from 'react';
import { usePms } from '../../data/usePms';
import { nights, statusLabels, money as formatMoney, moneyAmount, bookingRooms, today } from '../../data/model';
import BookingTabs from './BookingTabs';
import StayChangeForm from './StayChangeForm';
import { openBookingDocument } from '../bookingDocument';
import { bookingEditInput } from '../bookingDraft';
import LegacyOverlay from '../../components/LegacyOverlay';
import { useDraftGuard } from '../../../../shared/drafts/DraftGuardProvider';
import { AccessMessage } from '../../../../shared/components/AccessControl';
import { X, Printer, Save, User, Calendar, CreditCard, Clock, Phone, Mail, ChevronDown, LogIn, LogOut, UserX, CircleX } from 'lucide-react';
import './BookingDetailPanel.css';

const tabs = [
  ['details', 'Chi tiết'], ['kháchhàng', 'Khách hàng'], ['dịchvụ', 'Dịch vụ'],
  ['giáphòng', 'Giá phòng'], ['thanhtoán', 'Thanh toán'], ['ghichú', 'Ghi chú'], ['lịchsử', 'Lịch sử'],
];
const editDraft = booking => ({ ...booking, email: booking?.guests?.[0]?.email || '', identity: booking?.guests?.[0]?.identityNumber || '', nationality: booking?.guests?.[0]?.nationality || '' });

export default function BookingDetailPanel({ bookingId, onClose }) {
  useI18n();
  const [activeTab, setActiveTab] = useState('details');
  const [visitedTabs, setVisitedTabs] = useState([]);
  const draftGroup = useId();
  const { bookings, rooms, changeStatus, updateBooking, roomTypes, access, bookingSources, settings, tenant, refreshWorkspace } = usePms();
  const booking = bookings.find(b => b.id === bookingId);
  const [draft, setDraft] = useState(() => editDraft(booking));
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false), [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmNoShow, setConfirmNoShow] = useState(false);
  const [stayChange, setStayChange] = useState(false);
  const bodyRef = useRef(null);
  const dirtyRef = useRef(false), inFlight = useRef(false);
  const { requestLeave } = useDraftGuard({
    group: draftGroup,
    dirty: () => dirtyRef.current || Boolean(bodyRef.current?.querySelector('.date-input-control [aria-invalid="true"]')),
    pending: () => inFlight.current,
    onDiscard: () => { dirtyRef.current = false; setDirty(false); setDraft(editDraft(booking)); setError(''); setConflict(false); },
  });
  const close = () => requestLeave(onClose);
  const confirmationRef = useRef(null);
  useEffect(() => {
    if (!dirty) setDraft(editDraft(booking));
  }, [booking, dirty]);
  useEffect(() => {
    if (confirmCancel || confirmNoShow) confirmationRef.current?.scrollIntoView({ block: 'nearest' });
  }, [confirmCancel, confirmNoShow]);
  if (!booking) return null;
  const money=value=>formatMoney(value,booking.currency);
  const visibility = access('reservations.view', 'RESERVATION_VIEW');
  if (!visibility.allowed) return <LegacyOverlay title={tUi("nav.bookings")} onClose={close} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: '#0f172a99', display: 'grid', placeItems: 'center', padding: 20 }}><div className="pms-access-dialog"><AccessMessage result={visibility} /><button onClick={close}>{tUi("common.close")}</button></div></LegacyOverlay>;
  const roomType = roomTypes.find(t => t.id === rooms.find(r => r.id === booking.room)?.typeId);
  const update = (key, value) => { if (inFlight.current) return; dirtyRef.current = true; setDraft(d => ({ ...d, [key]: value })); setDirty(true); setNotice(''); };
  const selectTab = id => { setActiveTab(id); if (id !== 'details') setVisitedTabs(list => list.includes(id) ? list : [...list, id]); bodyRef.current?.scrollTo({ top: 0 }); };
  const showError = err => { setError(err.message); setConflict(['stale_booking','stale_guest'].includes(err.code)); };
  async function act(status) { if (inFlight.current) return; inFlight.current = true; setBusy(true); try { await changeStatus(booking.id, status, draft.version); setError(''); setConflict(false); setConfirmCancel(false); setConfirmNoShow(false); } catch (err) { showError(err); } finally { inFlight.current = false; setBusy(false); } }
  async function save() { if (inFlight.current || [...bodyRef.current.querySelectorAll('input,select,textarea')].some(field => !field.disabled && !field.closest('[hidden]') && !field.reportValidity())) return; inFlight.current = true; setBusy(true); try { await updateBooking(booking.id, bookingEditInput(draft)); dirtyRef.current = false; setDirty(false); setConflict(false); setNotice('Đã lưu thay đổi.'); setError(''); } catch (err) { showError(err); } finally { inFlight.current = false; setBusy(false); } }
  async function reload() { if (inFlight.current) return; inFlight.current = true; setBusy(true); try { await refreshWorkspace(); dirtyRef.current = false; setDirty(false); setConflict(false); setError(''); setNotice('Đã tải bản mới. Các thay đổi chưa lưu đã bỏ.'); } catch (err) { showError(err); } finally { inFlight.current = false; setBusy(false); } }

  return (
    <LegacyOverlay modal title={'Đặt phòng ' + booking.id} onClose={close} style={{ position: 'fixed', inset: 0, backgroundColor: '#0f172a80', zIndex: 1100, display: 'flex', justifyContent: 'flex-end' }}>
      <div className="booking-detail-panel">
        <header className="booking-detail-header">
          <div className="booking-detail-heading">
            <div className="booking-detail-identity">
              <div className="booking-detail-avatar" aria-hidden="true">{booking.guest.charAt(0)}</div>
              <div className="booking-detail-title">
                <span className="booking-detail-eyebrow">{labelUi("Chi tiết đặt phòng")}</span>
                <div className="booking-detail-title-row">
                  <h2>{booking.guest}</h2>
                  <span className={'booking-detail-status status-' + booking.status.toLowerCase()}>{statusLabels[booking.status]}</span>
                </div>
              </div>
            </div>
            <div className="booking-detail-header-actions">
              <button type="button" className="booking-detail-button booking-detail-button--icon" aria-label={tUi("common.close")} onClick={close}><X size={20} aria-hidden="true" /></button>
            </div>
          </div>
          <nav className="booking-detail-tabs" aria-label={labelUi("Mục chi tiết đặt phòng")}>
            {tabs.map(([id, label]) => <button type="button" key={id} className={activeTab === id ? 'is-active' : ''} aria-pressed={activeTab === id} onClick={() => selectTab(id)}>{labelUi(label)}</button>)}
          </nav>
          <label className="booking-detail-tab-picker"><span>{labelUi("Nội dung đặt phòng")}</span><select className="booking-detail-input" aria-label={labelUi("Nội dung đặt phòng")} value={activeTab} onChange={e => selectTab(e.target.value)}>{tabs.map(([id, label]) => <option key={id} value={id}>{labelUi(label)}</option>)}</select></label>
        </header>
        <div className="booking-detail-body" ref={bodyRef}>
          {activeTab === 'details' && <>
          <div className="booking-detail-summary">
            <div className="booking-detail-meta">
              <span>{labelUi("Mã:")}{" "}<strong>{booking.id}</strong></span>
              <span><Calendar size={14} aria-hidden="true" />{formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}</span>
              <span><Clock size={14} aria-hidden="true" />{nights(booking.checkIn, booking.checkOut)} đêm</span>
              <span>{labelUi("Phòng")}{" "}<strong>{bookingRooms(booking).join(', ')}</strong></span>
            </div>
            <div className={'booking-detail-balance' + (Number(booking.balance) > 0 ? ' is-outstanding' : '')}><span>{labelUi("Công nợ / Số dư")}</span><strong>{money(booking.balance)}</strong></div>
          </div>
          <div className="booking-detail-lifecycle">
            {booking.status === 'CONFIRMED' && access('reservations.write', 'RESERVATION_VIEW').allowed && <>
              <button type="button" className="booking-detail-button booking-detail-button--success" disabled={busy} onClick={() => act('IN_HOUSE')}><LogIn size={16} aria-hidden="true" />{labelUi("Nhận phòng (Check-in)")}</button>
              <div className="booking-detail-secondary-actions">
                <button type="button" className="booking-detail-button booking-detail-button--warning" disabled={busy || booking.checkIn > today(settings.timezone)} title={booking.checkIn > today(settings.timezone) ? labelUi("Chỉ ghi nhận từ ngày nhận phòng theo múi giờ khách sạn") : ''} onClick={() => { setConfirmNoShow(true); setConfirmCancel(false); }}><UserX size={16} aria-hidden="true" />{labelUi("Khách không đến (No-show)")}</button>
                <button type="button" className="booking-detail-button booking-detail-button--danger" disabled={busy} onClick={() => { setConfirmCancel(true); setConfirmNoShow(false); }}><CircleX size={16} aria-hidden="true" />{labelUi("Hủy đặt phòng")}</button>
              </div>
            </>}
            {booking.status === 'IN_HOUSE' && access('reservations.checkout', 'RESERVATION_VIEW').allowed && <button type="button" className="booking-detail-button booking-detail-button--success" disabled={busy || Number(booking.balance) !== 0} title={Number(booking.balance) !== 0 ? labelUi("Cần thanh toán hết số dư trước khi trả phòng") : ''} onClick={() => act('CHECKED_OUT')}><LogOut size={16} aria-hidden="true" />{labelUi("Trả phòng (Check-out)")}</button>}
          </div>
          {booking.status === 'CONFIRMED' && booking.checkIn > today(settings.timezone) && <p className="booking-detail-help">{labelUi("Chỉ ghi nhận khách không đến từ ngày nhận phòng theo múi giờ khách sạn.")}</p>}
          {booking.status === 'IN_HOUSE' && Number(booking.balance) !== 0 && <p className="booking-detail-help">{labelUi("Cần thanh toán hết số dư trước khi trả phòng.")}</p>}
          {confirmCancel && <div ref={confirmationRef} className="booking-detail-confirmation" role="group" aria-label={labelUi("Xác nhận hủy đặt phòng")}><p>{labelUi("Xác nhận hủy booking? Phòng sẽ được mở bán lại.")}</p><div className="booking-detail-form-actions"><button type="button" className="booking-detail-button" disabled={busy} onClick={() => setConfirmCancel(false)}>{labelUi("Giữ booking")}</button><button type="button" className="booking-detail-button booking-detail-button--danger" disabled={busy} onClick={() => act('CANCELLED')}>{labelUi("Xác nhận hủy")}</button></div></div>}
          {confirmNoShow && booking.status === 'CONFIRMED' && <div ref={confirmationRef} className="booking-detail-confirmation" role="group" aria-label={labelUi("Xác nhận khách không đến")}><p>{labelUi("Xác nhận khách không đến? Phòng sẽ được mở bán lại. Giá đã chốt và các giao dịch cũ được giữ nguyên; tính phí, thu tiền hoặc hoàn tiền cần xử lý riêng.")}</p><div className="booking-detail-form-actions"><button type="button" className="booking-detail-button" disabled={busy} onClick={() => setConfirmNoShow(false)}>{labelUi("Giữ booking")}</button><button type="button" className="booking-detail-button booking-detail-button--warning" disabled={busy} onClick={() => act('NO_SHOW')}>{labelUi("Xác nhận khách không đến")}</button></div></div>}
          {booking.status === 'NO_SHOW' && <p className="booking-detail-message" role="status">Đã ghi nhận khách không đến{booking.noShowAt ? ' lúc ' + formatDateTime(booking.noShowAt, settings.timezone) : ''}. Giá đã chốt và các giao dịch cũ được giữ nguyên; xử lý khoản phí, thu tiền hoặc hoàn tiền tại các mục tương ứng.</p>}
          {booking.status === 'IN_HOUSE' && access('reservations.write', 'RESERVATION_VIEW').allowed && <button type="button" className="booking-detail-button" disabled={busy || dirty} onClick={() => setStayChange(true)}>{tUi('stayChange.title')}</button>}
          {stayChange && booking.status === 'IN_HOUSE' && <StayChangeForm key={booking.id} booking={booking} group={draftGroup} onDone={() => { setStayChange(false); setNotice(tUi('stayChange.saved')); }} onCancel={() => setStayChange(false)} />}
          <div className="booking-detail-grid">
            <div className="booking-detail-column">
              <Card title={labelUi("Thông tin khách hàng")} icon={<User size={17} />}>
                <div className="booking-detail-fields">
                  <Field bookingStatus={booking.status} busy={busy} label="Họ tên khách (*)" value={draft.guest || ''} onChange={value => update('guest', value)} />
                  <Field bookingStatus={booking.status} busy={busy} label="CCCD/CMND/Hộ chiếu" placeholder={labelUi("Nhập giấy tờ tùy thân...")} value={draft.identity || ''} onChange={value => update('identity', value)} />
                  <Field bookingStatus={booking.status} busy={busy} label="Điện thoại" type="tel" value={draft.phone || ''} onChange={value => update('phone', value)} icon={<Phone size={15} />} />
                  <Field bookingStatus={booking.status} busy={busy} label="Email" type="email" value={draft.email || ''} onChange={value => update('email', value)} icon={<Mail size={15} />} />
                  <Field bookingStatus={booking.status} busy={busy} label="Quốc tịch" value={draft.nationality || ''} onChange={value => update('nationality', value)} type="select" options={[...new Set([draft.nationality||'', 'Malaysia', 'Vietnam', 'USA'])]} />
                </div>
              </Card>
            </div>
            <div className="booking-detail-column">
              <Card><div className="booking-detail-options">
                {['Đặt phòng theo giờ', 'Miễn phí tiền phòng (FOC)', 'Bữa sáng'].map(label => <label key={label}><input type="checkbox" disabled title={labelUi("Chưa triển khai")} />{labelUi(label)}</label>)}
              </div></Card>
              <Card title={labelUi("Chi tiết lưu trú")} icon={<Calendar size={17} />}>
                <div className="booking-detail-field-grid">
                  <Field bookingStatus={booking.status} busy={busy} label="Trạng thái (*)" value={statusLabels[booking.status]} type="select" options={[statusLabels[booking.status]]} disabled />
                  <Field bookingStatus={booking.status} busy={busy} label="Ngày đặt" defaultValue={booking.createdAt?.slice(0, 10) || booking.checkIn} type="date" disabled />
                </div>
                <div className="booking-detail-stay-dates">
                  <div className="booking-detail-date-pair">
                    <Field bookingStatus={booking.status} busy={busy} label="Ngày nhận (*)" value={draft.checkIn} onChange={value => update('checkIn', value)} type="date" disabled={booking.status !== 'CONFIRMED'} />
                    <Field bookingStatus={booking.status} busy={busy} label="Giờ" value={settings.checkInTime || '14:00'} disabled />
                  </div>
                  <div className="booking-detail-night-count"><span>{labelUi("Số đêm")}</span><strong>{nights(draft.checkIn, draft.checkOut) || 0}</strong></div>
                  <div className="booking-detail-date-pair">
                    <Field bookingStatus={booking.status} busy={busy} label="Ngày trả (*)" value={draft.checkOut} onChange={value => update('checkOut', value)} type="date" disabled={booking.status !== 'CONFIRMED'} />
                    <Field bookingStatus={booking.status} busy={busy} label="Giờ" value={settings.checkOutTime || '12:00'} disabled />
                  </div>
                </div>
                <div className="booking-detail-field-grid booking-detail-field-grid--three">
                  {['Người lớn', 'Trẻ em', 'Em bé'].map(label => <Field key={label} bookingStatus={booking.status} busy={busy} label={label} value="Chưa triển khai" disabled />)}
                </div>
              </Card>
              <Card title={labelUi("Nguồn & Giá phòng")} icon={<CreditCard size={17} />}>
                <div className="booking-detail-field-grid">
                  <Field bookingStatus={booking.status} busy={busy} label="Nguồn đặt (*)" value={draft.source} onChange={value => update('source', value)} type="select" options={[...new Set([draft.source, ...bookingSources.filter(s => s.active !== false).map(s => s.name)])]} />
                  <Field bookingStatus={booking.status} busy={busy} label="Kênh / Mã kênh" value={booking.source} disabled />
                  <Field bookingStatus={booking.status} busy={busy} label="Loại phòng (*)" value={roomType?.name} type="select" options={[roomType?.name]} disabled />
                  <div className="booking-detail-field"><span>{labelUi("Phòng ở")}</span><div className="booking-detail-room-options">{rooms.filter(r => r.active !== false || bookingRooms(booking).includes(r.id)).map(r => <label key={r.id}><input type="checkbox" disabled={busy || booking.status !== 'CONFIRMED' || !access('reservations.write').allowed} checked={bookingRooms(draft).includes(r.id)} onChange={e => update('rooms', e.target.checked ? [...bookingRooms(draft), r.id] : bookingRooms(draft).filter(id => id !== r.id))} />{r.id}</label>)}</div></div>
                  <Field bookingStatus={booking.status} busy={busy} label="Phòng RTC (*)" value={roomType?.name} type="select" options={[roomType?.name]} disabled />
                  <label className="booking-detail-field"><span>{labelUi("Tiền phòng / ngày")}</span><div className="booking-detail-money-input"><input className="booking-detail-input" type="text" value={moneyAmount((booking.nightlyRates||[]).reduce((sum,row)=>sum+Number(row.price),0) / nights(booking.checkIn, booking.checkOut), booking.currency)} readOnly /><span>{booking.currency==='VND'?'₫':booking.currency}</span></div></label>
                </div>
              </Card>
            </div>
          </div></>}
          {visitedTabs.map(tab => <div key={tab} hidden={activeTab !== tab}><BookingTabs tab={tab} booking={booking} draftGroup={draftGroup} /></div>)}
        </div>
        <footer className="booking-detail-footer">
          {error && <p className="booking-detail-message is-error" role="alert">{error}</p>}
          {conflict && <button type="button" className="booking-detail-button" disabled={busy} onClick={reload}>Tải bản mới và bỏ thay đổi chưa lưu</button>}
          {notice && <p className="booking-detail-message is-success" role="status">{notice}</p>}
          <div className="booking-detail-footer-actions">
            <button type="button" className="booking-detail-button" aria-label={labelUi("Xem và in phiếu đặt phòng")} disabled={busy} onClick={() => { try { openBookingDocument(booking, tenant, settings); setError(''); } catch (failure) { setError(failure.message); } }}><Printer size={16} aria-hidden="true" />{labelUi("In phiếu")}</button>
            {activeTab === 'details' && <button type="button" className="booking-detail-button booking-detail-button--primary" disabled={busy || !['CONFIRMED','IN_HOUSE'].includes(booking.status) || !access('reservations.write', 'RESERVATION_VIEW').allowed} onClick={save}><Save size={16} aria-hidden="true" />{busy ? labelUi("Đang xử lý…") : tUi('common.saveChanges')}</button>}
          </div>
        </footer>
      </div>
    </LegacyOverlay>
  );
}

const Card = ({ title, icon, children }) => {
  useI18n();
  return <section className="booking-detail-card">
    {title && <div className="booking-detail-card-heading">{icon && <span aria-hidden="true">{icon}</span>}<h3>{labelUi(title)}</h3></div>}
    <div className="booking-detail-card-body">{children}</div>
  </section>;
};

const Field = ({ label, defaultValue, value, onChange, placeholder, type = 'text', options, icon, disabled, bookingStatus, busy }) => {
  useI18n();
  const { access } = usePms();
  disabled = disabled || busy || (bookingStatus && !['CONFIRMED','IN_HOUSE'].includes(bookingStatus)) || !access('reservations.write', 'RESERVATION_VIEW').allowed;
  return <label className="booking-detail-field">
    <span>{labelUi(label)}</span>
    <div className={'booking-detail-control' + (icon ? ' has-icon' : '')}>
      {icon && <span className="booking-detail-field-icon" aria-hidden="true">{icon}</span>}
      {type === 'select' ? <select className="booking-detail-input" aria-label={labelUi(label)} value={value} defaultValue={value === undefined ? defaultValue : undefined} onChange={e => onChange?.(e.target.value)} disabled={disabled}>{options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select> : type === 'date' ? <DateInput className="booking-detail-input" aria-label={labelUi(label)} value={value ?? defaultValue ?? ''} onChange={onChange} disabled={disabled} /> : <input className="booking-detail-input" type={type} pattern={type === 'tel' ? phonePattern : type === 'email' ? emailPattern : undefined} maxLength={type === 'tel' ? 40 : type === 'email' ? 254 : 160} aria-label={labelUi(label)} value={value} onChange={e => { if (type !== 'tel' || !/[^0-9+ .()-]/.test(e.target.value)) onChange?.(e.target.value); }} defaultValue={value === undefined ? defaultValue : undefined} placeholder={placeholder} disabled={disabled} />}
      {type === 'select' && <ChevronDown size={15} className="booking-detail-select-arrow" aria-hidden="true" />}
    </div>
  </label>;
};
