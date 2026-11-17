import { LogOut } from 'lucide-react';
import { decimalInput } from '../../../../shared/lib/number.js';
import { phonePattern } from '../../../../shared/lib/phone.js';
import { emailPattern } from '../../../../shared/lib/validation.js';
import { formatDate } from '../../../../shared/lib/date.js';
import { bookingGuestInput } from '../bookingDraft.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import React, { useEffect, useRef, useState } from 'react';
import { usePms } from '../../data/usePms';
import { timestamp, bookingEvent } from '../../data/presentation';
import { money as formatMoney } from '../../data/model';
import { useDraftGuard } from '../../../../shared/drafts/DraftGuardProvider';
const cell = { padding: 12, borderBottom: '1px solid #e5e7eb', textAlign: 'left', color: '#374151' };
export default function BookingTabs({ tab, booking, draftGroup, onPendingChange, isParentPending, onCheckout }) {
  useI18n();
  const money=value=>formatMoney(value,booking.currency);
  const { services, paymentMethods, funds, settings, access, addCharge, addPayment, refundPayment, addNote, updateBooking, adjustBooking, refreshWorkspace } = usePms();
  const bookingFunds = funds.filter(row => (row.currency || settings.currency) === booking.currency);
  const [form, setForm] = useState({});
  const [guests, setGuests] = useState(() => booking.guests || []);
  const [guestVersion, setGuestVersion] = useState(booking.version), [guestDirty, setGuestDirty] = useState(false), [conflict, setConflict] = useState(false);
  useEffect(() => { if (!guestDirty) { setGuests(booking.guests || []); setGuestVersion(booking.version); } }, [booking.guests, booking.version, guestDirty]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const section = useRef(null);
  const intent = useRef(crypto.randomUUID());
  const numericInput = key => decimalInput(form[key], { min: key === 'unitPrice' ? '0' : '0.0001', ...(key === 'quantity' ? { max: '99999999.9999' } : {}) });
  const dirty = useRef(false), inFlight = useRef(false);
  const autoService = useRef({});
  useDraftGuard({
    group: draftGroup,
    dirty: () => dirty.current,
    pending: () => inFlight.current,
    onDiscard: () => { dirty.current = false; autoService.current = {}; setForm({}); setGuests(booking.guests || []); setGuestVersion(booking.version); setGuestDirty(false); setConflict(false); setError(''); },
  });
  const update = (key, value) => { if (inFlight.current || isParentPending?.()) return; if (key === 'serviceId') { pickService(value); return; } delete autoService.current[key]; dirty.current = true; setForm(f => ({ ...f, [key]: value })); intent.current = crypto.randomUUID(); setNotice(''); setError(''); };
  function pickService(id) {
    if (inFlight.current || isParentPending?.()) return;
    const service = services.find(row => row.id === id && row.active !== false);
    let price = '', priceError = '';
    if (service) {
      try { price = decimalInput(service.price); }
      catch { priceError = 'Giá dịch vụ chưa hợp lệ. Vui lòng nhập đơn giá.'; }
    }
    const defaults = { description: service?.name || '', quantity: service ? '1' : '', unitPrice: price };
    const next = { ...form, serviceId: service?.id || '' }, generated = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (!String(form[key] ?? '').trim() || Object.hasOwn(autoService.current, key) && form[key] === autoService.current[key]) {
        next[key] = value;
        if (service) generated[key] = value;
      }
    }
    autoService.current = generated;
    dirty.current = true; intent.current = crypto.randomUUID(); setForm(next); setNotice(''); setError(priceError && !String(next.unitPrice ?? '').trim() ? priceError : '');
  }
  const run = async (fn, fields) => { if (inFlight.current || isParentPending?.()) return; inFlight.current = true; onPendingChange?.(true); setBusy(true); setError(''); setNotice(''); try { await fn(); const remaining = fields ? Object.fromEntries(Object.entries(form).filter(([key]) => !fields.includes(key))) : {}; dirty.current = Object.keys(remaining).length > 0; autoService.current = {}; setNotice('Đã lưu.'); setForm(remaining); setGuestDirty(false); setConflict(false); intent.current = crypto.randomUUID(); } catch(err) { setError(err.message); setConflict(['stale_booking','stale_guest'].includes(err.code)); } finally { inFlight.current = false; setBusy(false); onPendingChange?.(false); } };
  const editGuests = update => { if (inFlight.current || isParentPending?.()) return; dirty.current = true; setGuestDirty(true); setGuests(update); };
  const canWrite = access(['thanhtoán','dịchvụ'].includes(tab) ? 'payments.write' : 'reservations.write').allowed && (tab !== 'kháchhàng' || (access('guests.write').allowed && ['CONFIRMED','IN_HOUSE'].includes(booking.status)));
  const field = (key, label, type = 'text', required = true) => <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#4b5563' }}>{labelUi(label)}<input aria-label={labelUi(label)} className="booking-detail-input" type={type === 'number' ? 'text' : type} inputMode={type === 'number' ? 'decimal' : undefined} pattern={type === 'number' ? '[0-9]{1,15}([.][0-9]{1,4})?' : undefined} maxLength={type === 'number' ? 20 : undefined} value={form[key] || ''} onChange={e => update(key, e.target.value)} required={required} disabled={busy || isParentPending?.()} /></label>;
  const select = (key, label, rows) => <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>{labelUi(label)}<select aria-label={labelUi(label)} className="booking-detail-input" value={form[key] || ''} disabled={busy || isParentPending?.()} onChange={e => update(key, e.target.value)}><option value="">{labelUi("Chọn…")}</option>{rows.filter(r => r.active !== false).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>;
  const table = (headers, rows) => <div className="booking-detail-table-wrap" tabIndex={0} role="region" aria-label={headers.join(', ')}><table role="table" style={{ width: '100%', borderCollapse: 'collapse' }}><thead role="rowgroup"><tr role="row">{headers.map(h => <th role="columnheader" scope="col" key={h} style={cell}>{h}</th>)}</tr></thead><tbody role="rowgroup">{rows.length ? rows.map((row,i) => <tr role="row" key={i}>{row.map((value,j) => <td role="cell" data-label={headers[j]} key={j} style={cell}>{value}</td>)}</tr>) : <tr role="row"><td role="cell" colSpan={headers.length} style={cell}>{labelUi("Chưa có dữ liệu.")}</td></tr>}</tbody></table></div>;
  return <section ref={section} className="booking-detail-section">
    {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}{notice && <p role="status" style={{ color: '#059669' }}>{notice}</p>}
    {conflict && <button type="button" className="booking-detail-button" disabled={busy || isParentPending?.()} onClick={() => run(refreshWorkspace)}>Tải bản mới và bỏ thay đổi chưa lưu</button>}
    {tab === 'kháchhàng' && <>
      {guests.map((guest,index) => <div key={guest.id || index} className="booking-detail-guests-row">
        {['name','phone','email'].map(key => <input key={key} type={{name:'text',phone:'tel',email:'email'}[key]} required={key === 'name'} pattern={key === 'phone' ? phonePattern : key === 'email' ? emailPattern : '.*\\S.*'} maxLength={key === 'phone' ? 40 : key === 'email' ? 254 : 160} aria-label={key+' khách '+(index+1)} className="booking-detail-input" value={guest[key] || ''} placeholder={{name:tUi("common.name"),phone:'Điện thoại',email:'Email'}[key]} disabled={busy || isParentPending?.() || !canWrite} onChange={e => { if (key === 'phone' && /[^0-9+ .()-]/.test(e.target.value)) return; editGuests(list => list.map((g,i) => i === index ? {...g,[key]:e.target.value} : g)); }} />)}
        <button type="button" className="booking-detail-button booking-detail-button--danger" disabled={busy || isParentPending?.() || !canWrite || guests.length === 1} onClick={() => editGuests(list => list.filter((_,i) => i !== index))}>{labelUi("Xóa")}</button>
      </div>)}
      <div className="booking-detail-form-actions">
        <button type="button" className="booking-detail-button" disabled={busy || isParentPending?.() || !canWrite} onClick={() => editGuests(list => [...list,{name:'',phone:'',email:''}])}>{labelUi("+ Thêm khách")}</button>
        <button type="button" className="booking-detail-button booking-detail-button--primary" disabled={busy || isParentPending?.() || !canWrite} onClick={() => { const invalid = section.current.querySelector('input:invalid'); if (invalid) { invalid.reportValidity(); return; } run(() => updateBooking(booking.id,{guests: guests.map(bookingGuestInput),expectedVersion:guestVersion})); }}>{labelUi("Lưu khách lưu trú")}</button>
      </div>
    </>}
    {tab === 'dịchvụ' && <>
      {table(['Dịch vụ / Khoản phí','SL','Đơn giá','Thành tiền'],(booking.charges || []).map(row => [row.description,row.quantity,money(row.unitPrice),money(row.amount ?? Number(row.quantity)*Number(row.unitPrice))]))}
      <form onSubmit={e => { e.preventDefault(); run(() => addCharge(booking.id,{...form,type:form.type||'service',quantity:numericInput('quantity'),unitPrice:numericInput('unitPrice')},intent.current)); }} className="booking-detail-form">
        <fieldset disabled={busy || isParentPending?.() || !canWrite || booking.status === 'CHECKED_OUT' || booking.status === 'CANCELLED'} style={{border:0,padding:0,display:'contents'}}>
          {select('serviceId','Dịch vụ',services)}{field('description','Nội dung khoản phí')}{field('quantity','Số lượng','number')}{field('unitPrice','Đơn giá','number')}
          {select('type','Loại khoản phí',[{id:'service',name:'Dịch vụ'},{id:'fee',name:'Phụ thu'},{id:'tax',name:'Thuế'},{id:'discount',name:'Giảm giá'}])}
          <button className="booking-detail-button booking-detail-button--primary" type="submit">{labelUi("Thêm khoản phí")}</button>
        </fieldset>
      </form>
    </>}
    {tab === 'giáphòng' && <>{table(['Phòng','Ngày','Giá từng đêm'],(booking.nightlyRates||[]).map(row=>[row.room,formatDate(row.date),money(row.price)]))}<p>{labelUi("Giá đã chốt tại thời điểm đặt phòng. Tổng:")}{" "}<strong>{money((booking.nightlyRates||[]).reduce((sum,row)=>sum+Number(row.price),0))}</strong></p></>}
    {tab === 'thanhtoán' && <>
      <p>{labelUi("Đã thanh toán:")}{" "}<strong>{money(booking.paid)}</strong>{" "}{labelUi("· Số dư:")}{" "}<strong>{money(booking.balance)}</strong></p>
      {booking.status === 'IN_HOUSE' && access('reservations.checkout', 'RESERVATION_VIEW').allowed && onCheckout && <button type="button" className="booking-detail-button booking-detail-button--success" disabled={busy || isParentPending?.() || Number(booking.balance) !== 0} title={Number(booking.balance) !== 0 ? labelUi("Cần thanh toán hết số dư trước khi trả phòng") : ''} onClick={onCheckout}><LogOut size={16} aria-hidden="true" />{labelUi("Trả phòng (Check-out)")}</button>}
      {table(['Thời gian','Phương thức','Số tiền','Hoàn tiền'],(booking.payments||[]).map(row=>[timestamp(row.createdAt, settings.timezone),row.method||row.methodName||paymentMethods.find(m=>m.id===row.methodId)?.name,money(row.amount),money(row.refunded ?? row.refundedAmount ?? 0)]))}
      {table(['Hoàn tiền lúc','Số tiền','Lý do','Người thực hiện'],(booking.payments||[]).flatMap(p=>(p.refunds||[]).map(r=>[timestamp(r.createdAt, settings.timezone),money(r.amount),r.reason,r.actor])))}
      <form onSubmit={e=>{e.preventDefault();run(()=>addPayment(booking.id,{...form,amount:numericInput('amount')},intent.current), ['amount','methodId','fundId','note']);}} className="booking-detail-form"><fieldset disabled={busy||isParentPending?.()||!canWrite||Number(booking.balance)<=0||booking.status==='CHECKED_OUT'||booking.status==='CANCELLED'} style={{border:0,padding:0,display:'contents'}}>{field('amount','Số tiền thanh toán','number')}{select('methodId','Phương thức thanh toán',paymentMethods)}{select('fundId','Quỹ nhận tiền',bookingFunds)}{field('note','Ghi chú thanh toán','text',false)}<button className="booking-detail-button booking-detail-button--primary" type="submit">{labelUi("Ghi nhận thanh toán")}</button></fieldset></form>
      <form onSubmit={e=>{e.preventDefault();run(()=>refundPayment(booking.id,form.paymentId,{amount:numericInput('refundAmount'),reason:form.reason},intent.current), ['paymentId','refundAmount','reason']);}} className="booking-detail-form"><fieldset disabled={busy||isParentPending?.()||!canWrite||booking.status==='CHECKED_OUT'} style={{border:0,padding:0,display:'contents'}}>{select('paymentId','Giao dịch cần hoàn tiền',(booking.payments||[]).map(p=>({id:p.id,name:timestamp(p.createdAt, settings.timezone)+' · '+money(p.amount)})))}{field('refundAmount','Số tiền hoàn','number')}{field('reason','Lý do hoàn tiền')}<button className="booking-detail-button booking-detail-button--danger" type="submit">{labelUi("Hoàn tiền")}</button></fieldset></form>
    </>}
    {tab === 'thanhtoán' && booking.status==='CHECKED_OUT' && access('finance.adjust').allowed && <form onSubmit={e=>{e.preventDefault();const credit=form.adjustType!=='debit';run(()=>adjustBooking(booking.id,{type:credit?'credit':'debit',amount:numericInput('adjustAmount'),reason:form.adjustReason,...(credit?{paymentId:form.adjustPaymentId}:{methodId:form.adjustMethodId,fundId:form.adjustFundId})}), ['adjustType','adjustAmount','adjustReason','adjustPaymentId','adjustMethodId','adjustFundId']);}} className="booking-detail-form"><h3 style={{gridColumn:'1/-1'}}>{labelUi("Điều chỉnh sau checkout")}</h3><fieldset disabled={busy||isParentPending?.()} style={{border:0,padding:0,display:'contents'}}>{select('adjustType','Loại điều chỉnh',[{id:'credit',name:'Giảm tiền và hoàn'},{id:'debit',name:'Thu bổ sung'}])}{field('adjustAmount','Số tiền điều chỉnh','number')}{field('adjustReason','Lý do điều chỉnh')}{form.adjustType==='debit'?<>{select('adjustMethodId','Phương thức thu bổ sung',paymentMethods)}{select('adjustFundId','Quỹ thu bổ sung',bookingFunds)}</>:select('adjustPaymentId','Khoản thu gốc',(booking.payments||[]).map(row=>({id:row.id,name:timestamp(row.createdAt, settings.timezone)+' · '+money(row.amount)})))}<button type="submit" className="booking-detail-button booking-detail-button--primary">{labelUi("Ghi điều chỉnh và giao dịch đối ứng")}</button></fieldset></form>}
    {tab === 'ghichú' && <>{table(['Thời gian','Người ghi','Ghi chú'],(booking.notes||[]).map(row=>[timestamp(row.createdAt, settings.timezone),row.actor||row.authorName||row.userName||row.createdBy,row.text||row.body||row.content]))}<form onSubmit={e=>{e.preventDefault();run(()=>addNote(booking.id,{text:form.text}));}} className="booking-detail-form booking-detail-form--note">{field('text','Ghi chú mới')}<button type="submit" className="booking-detail-button booking-detail-button--primary" disabled={busy||isParentPending?.()||!canWrite}>{labelUi("Thêm ghi chú")}</button></form></>}
    {tab === 'lịchsử' && table(['Thời gian','Người thực hiện','Thao tác','Chi tiết'],(booking.history||[]).map(row=>[timestamp(row.createdAt||row.at, settings.timezone),row.actor||row.userName||'—',bookingEvent(row,booking.currency).label,bookingEvent(row,booking.currency).detail]))}
  </section>;
}
