import { decimalInput } from '../../../../shared/lib/number.js';
import { formatDate } from '../../../../shared/lib/date.js';
import DateInput from '../../../../shared/components/DateInput.jsx';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { money, today } from '../../data/model';
import { usePms } from '../../data/usePms';
import { HOTEL_CURRENCY_CODES } from '../../../../shared/lib/currencies.js';
import { commissionRateLabel } from '../commissionPresentation';
import { useDraftGuard } from '../../../../shared/drafts/DraftGuardProvider.jsx';
import '../../components/DomainForms.css';

const statuses = { UNPAID: 'Chưa chi', PARTIAL: 'Chi một phần', PAID: 'Đã chi đủ', NEEDS_REVIEW: 'Cần đối soát', OVERPAID: 'Cần thu hồi' };
const formTitles = { settle: 'Chốt hoa hồng', pay: 'Chi hoa hồng', review: 'Đối soát lại hoa hồng', recover: 'Thu hồi hoa hồng' };

export default function Commissions() {
  const pms = usePms();
  return <CommissionPage key={`${pms.tenantId}:${pms.user?.id}:${pms.authGeneration}`} pms={pms} />;
}

function CommissionPage({ pms }) {
  useI18n();
  const { settings, workspaceRevision, funds = [], bookingSources = [], cashbookCategories = [] } = pms;
  const [filters, setFilters] = useState({ startDate: '', endDate: today(settings.timezone), currency: settings.currency, sourceId: '', status: '', page: 1, pageSize: 20 });
  const [result, setResult] = useState(null), [reload, setReload] = useState(0);
  const [form, setForm] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const current = useRef(pms), mounted = useRef(true), inFlight = useRef(false), opener = useRef(null);
  const canWrite = pms.access('cashbook.write').allowed;
  const filterKey = JSON.stringify(filters), requestKey = JSON.stringify([filterKey, workspaceRevision, reload]);
  const loaded = result?.key === requestKey, data = loaded ? result.data : null, loading = !loaded;
  const totalPages = Math.max(1, Math.ceil((data?.pagination?.totalItems || 0) / filters.pageSize));
  const currencies = [...new Set([settings.currency, ...HOTEL_CURRENCY_CODES, ...funds.map(fund => fund.currency)])].filter(Boolean);
  const selected = form?.mode === 'settle' ? data?.candidates.find(candidate => candidate.bookingId === form?.record.bookingId) : data?.items.find(item => item.id === form?.record.id);
  const activeFunds = funds.filter(fund => fund.active !== false && (fund.currency || settings.currency) === form?.record.currency);
  const expenseCategories = cashbookCategories.filter(category => category.active !== false && category.type === (form?.mode === 'recover' ? 'INCOME' : 'EXPENSE'));
  const blocked = (form?.mode === 'pay' && (selected?.needsReview || Number(selected?.balance) <= 0))
    || (form?.mode === 'recover' && (selected?.needsReview || Number(selected?.recoveryDue) <= 0))
    || (form?.mode === 'review' && (!form.preview || form.preview.blockedByOta));
  const guard = useDraftGuard({ dirty: Boolean(form?.dirty), pending: () => inFlight.current, onDiscard: () => { setForm(null); setError(''); } });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { current.current = pms; }, [pms]);
  useEffect(() => {
    let active = true;
    current.current.getCommissions(JSON.parse(filterKey)).then(data => {
      if (active) setResult({ key: requestKey, data, error: '' });
    }).catch(error => {
      if (active) setResult({ key: requestKey, data: null, error: error.message });
    });
    return () => { active = false; };
  }, [requestKey, filterKey]);

  async function open(mode, record, event) {
    opener.current = event.currentTarget;
    setError(''); setNotice('');
    const loadId = crypto.randomUUID();
    const previous = mode === 'review' && form?.mode === 'review' && form.record.id === record.id ? form : null;
    setForm({ mode, record, loadId, legacyPercent: '', confirmLegacyRate: false, amount: (mode === 'recover' ? record.recoveryDue : record.balance) || '', fundId: funds.find(fund => fund.active !== false && (fund.currency || settings.currency) === record.currency)?.id || '', categoryId: '', note: '', reason: previous?.reason || '', dirty: previous?.dirty || false, intent: crypto.randomUUID(), preview: null });
    if (mode === 'review') {
      try {
        const preview = await pms.getCommissionReview(record.id);
        if (mounted.current) setForm(value => value?.loadId !== loadId ? value : { ...value, preview, providerAmount: preview.evidence?.providerCommission?.providerAmount ?? preview.current.amount, allocations: Object.fromEntries(preview.charges.filter(line => line.allocatable).map(line => [line.id, previous?.allocations?.[line.id] ?? (line.kind === 'discount' ? line.amount : '0')])) });
      } catch (error) { if (mounted.current) setForm(previous => previous?.loadId !== loadId ? previous : { ...previous, previewError: error.message }); }
    }
  }
  function close() {
    if (inFlight.current) return;
    guard.requestLeave(() => { setForm(null); setError(''); opener.current?.focus(); });
  }
  function change(name, value) {
    setForm(previous => ({ ...previous, [name]: value, dirty: true, intent: crypto.randomUUID() }));
  }
  function filter(name, value) {
    setFilters(previous => ({ ...previous, [name]: value, page: 1 }));
  }
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || !canWrite || loading || !selected || blocked) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (form.mode === 'settle') {
        await pms.settleCommission({ bookingId: form.record.bookingId, ...(form.record.missingRate ? { legacyPercent: decimalInput(form.legacyPercent, { max: '100' }), confirmLegacyRate: form.confirmLegacyRate } : {}) });
      } else if (form.mode === 'review') {
        await pms.reviewCommission(form.record.id, { previewToken: form.preview.previewToken, allocations: Object.entries(form.allocations).map(([chargeId, roomAmount]) => { const amount = String(form.preview.charges.find(line => line.id === chargeId).amount); return { chargeId, roomAmount: decimalInput(roomAmount, { min: amount.startsWith('-') ? amount : '0', max: amount.startsWith('-') ? '0' : amount }) }; }), reason: form.reason, ...(form.record.calculationBasis === 'provider_amount' ? { providerAmount: decimalInput(form.providerAmount) } : {}) }, form.intent);
      } else if (form.mode === 'recover') {
        await pms.recoverCommission(form.record.id, { amount: decimalInput(form.amount, { min: '0.0001', max: selected.recoveryDue }), fundId: form.fundId, note: form.note, ...(form.categoryId ? { categoryId: form.categoryId } : {}) }, form.intent);
      } else {
        await pms.payCommission(form.record.id, { amount: decimalInput(form.amount, { min: '0.0001', max: selected.balance }), fundId: form.fundId, note: form.note, ...(form.categoryId ? { categoryId: form.categoryId } : {}) }, form.intent);
      }
      if (mounted.current) {
        setForm(null); setNotice(form.mode === 'settle' ? 'Đã chốt hoa hồng theo cơ sở tiền phòng.' : form.mode === 'review' ? 'Đã lưu kết quả đối soát và giữ nguyên lịch sử hoa hồng.' : form.mode === 'recover' ? 'Đã ghi phiếu thu hồi hoa hồng.' : 'Đã ghi phiếu chi hoa hồng.');
        setReload(value => value + 1); opener.current?.focus();
      }
    } catch (error) { if (mounted.current) setError(error.message); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function cashbookLink(payment, currency) {
    const fund = funds.find(fund => fund.id === payment.fundId);
    return `/id/cashflow/${fund?.type?.toUpperCase() === 'BANK' ? 'bank' : 'cash'}?${new URLSearchParams({ documentId: payment.cashDocumentId, currency })}`;
  }

  return <div className="pms-domain-page">
    <header className="domain-toolbar"><div><h1>{labelUi("Hoa hồng nguồn đặt phòng")}</h1><p>{labelUi("Chốt hoa hồng khi khách đã trả phòng, theo dõi khoản còn phải chi và phiếu chi.")}</p></div><button type="button" disabled={loading || busy} onClick={() => setReload(value => value + 1)}>{tUi("common.reload")}</button></header>
    <p>{labelUi('Đặt phòng có số hoa hồng OTA dùng đúng số tiền do kênh gửi. Các nguồn còn lại tính theo tỷ lệ đã lưu trên tiền phòng sau giảm, không gồm dịch vụ và thuế. Chiết khấu hóa đơn và các điều chỉnh khác cần đối soát trước khi chi.')}</p>
    {notice && <p role="status">{notice}</p>}
    {loaded && result.error && <p className="domain-error" role="alert">{result.error} <button type="button" onClick={() => setReload(value => value + 1)}>{tUi("common.retry")}</button></p>}
    <section className="domain-stats" aria-label={labelUi("Tổng hoa hồng")} aria-busy={loading}>{[['accrued', 'Đã chốt'], ['paid', 'Đã chi'], ['balance', 'Còn phải chi']].map(([key, label]) => <div key={key}>{labelUi(label)}<strong>{data?.summary ? money(data.summary[key], data.summary.currency) : '—'}</strong></div>)}</section>
    <section className="domain-panel" aria-label={labelUi("Bộ lọc hoa hồng")}><fieldset disabled={Boolean(form)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="domain-fields">
      <label>{tUi("common.fromDate")}<DateInput value={filters.startDate} onChange={value => filter('startDate', value)} /></label>
      <label>{labelUi("Đến ngày")}<DateInput min={filters.startDate || undefined} value={filters.endDate} onChange={value => filter('endDate', value)} /></label>
      <label>{tUi("common.currency")}<select value={filters.currency} onChange={event => filter('currency', event.target.value)}>{currencies.map(currency => <option key={currency}>{currency}</option>)}</select></label>
      <label>{tUi('settings.bookingSources')}<select value={filters.sourceId} onChange={event => filter('sourceId', event.target.value)}><option value="">{labelUi("Tất cả nguồn")}</option>{bookingSources.map(source => <option key={source.id} value={source.id}>{source.name}{source.active === false ? " " + labelUi("(ngừng dùng)") : ''}</option>)}</select></label>
      <label>{tUi("common.status")}<select value={filters.status} onChange={event => filter('status', event.target.value)}><option value="">{tUi("common.allStatuses")}</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{labelUi(label)}</option>)}</select></label>
    </div></fieldset>{form && <p>{labelUi("Đóng biểu mẫu để đổi bộ lọc.")}</p>}</section>

    {form && <section className="domain-panel" aria-labelledby="commission-form-title"><form onSubmit={submit} aria-busy={busy}>
      <h2 id="commission-form-title">{labelUi(formTitles[form.mode])} · {form.record.guestName}</h2>
      <p>{form.record.bookingId} · {form.record.sourceName}</p>
      {form.mode === 'settle' && selected?.needsReview && <p role="alert" className="domain-error">{labelUi("Lưu trú có chiết khấu hóa đơn chưa phân bổ hoặc điều chỉnh sau trả phòng. Chốt lưu cơ sở báo giá để đối soát; hệ thống chặn chi hoa hồng.")}</p>}
      {error && <p role="alert" className="domain-error">{error}</p>}
      {loading ? <p role="status">{labelUi("Đang cập nhật số liệu…")}</p> : !selected ? <p role="alert" className="domain-error">{labelUi("Khoản này không còn trong danh sách hiện tại. Đóng biểu mẫu để kiểm tra lại.")}</p> : form.mode !== 'review' && blocked && <p role="alert" className="domain-error">{selected.needsReview || selected.status === 'NEEDS_REVIEW' ? labelUi("Lưu trú có chiết khấu hóa đơn chưa phân bổ hoặc điều chỉnh sau trả phòng. Cần đối soát; hệ thống chặn chi thêm.") : labelUi("Khoản hoa hồng đã được chi đủ.")}</p>}
      <fieldset disabled={busy || !canWrite} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {form.mode === 'review' ? <>
          {!form.preview && <p role={form.previewError ? 'alert' : 'status'}>{form.previewError || 'Đang tải cơ sở đối soát…'}{form.previewError && <button type="button" onClick={event => open('review', form.record, event)}>{tUi('common.retry')}</button>}</p>}
          {form.preview && <>
            <button type="button" disabled={busy} onClick={event => open('review', form.record, event)}>Tải lại bản xem trước</button>
            <p>Tiền phòng theo giá đêm: <strong>{money(form.preview.roomSubtotal, form.record.currency)}</strong>. Phân bổ rõ phần phí/giảm giá thuộc tiền phòng; dịch vụ và thuế không tính hoa hồng.</p>
            {form.preview.blockedByOta && <p role="alert" className="domain-error">Cần xử lý booking OTA đang chờ trước khi đối soát hoa hồng.</p>}
            <div className="domain-fields">{form.preview.charges.map(line => line.allocatable ? <label key={line.id}>{line.description} · {money(line.amount, form.record.currency)}<span>Phần thuộc tiền phòng</span><input aria-label={`Phần tiền phòng ${line.description}`} type="text" inputMode="decimal" pattern="-?[0-9]{1,15}([.][0-9]{1,4})?" maxLength={21} min={Number(line.amount) < 0 ? line.amount : '0'} max={Number(line.amount) > 0 ? line.amount : '0'} required value={form.allocations[line.id]} onChange={event => change('allocations', { ...form.allocations, [line.id]: event.target.value })} /></label> : <p key={line.id}>{line.description}: {money(line.amount, form.record.currency)} · Không tính hoa hồng.</p>)}</div>
            {!!form.preview.refunds.length && <p>Đã hoàn cho khách: {form.preview.refunds.map(refund => money(refund.amount, form.record.currency)).join(', ')}. Đối chiếu với khoản giảm tiền tương ứng; không trừ hai lần.</p>}
            {form.record.calculationBasis === 'provider_amount' ? <label>Hoa hồng OTA đã xác nhận ({form.record.currency})<input type="text" inputMode="decimal" pattern="[0-9]{1,15}([.][0-9]{1,4})?" maxLength={20} min="0" step="0.0001" required value={form.providerAmount} onChange={event => change('providerAmount', event.target.value)} /></label> : <p>Giữ tỷ lệ đã chốt: <strong>{form.record.percent}%</strong>. Hệ thống tính lại trên tiền phòng sau phân bổ.</p>}
            <label>Lý do và kết quả đối soát<textarea required maxLength={1000} value={form.reason} onChange={event => change('reason', event.target.value)} /></label>
          </>}
        </> : form.mode === 'settle' ? <>
          {form.record.calculationBasis === 'provider_amount' ? <p>{labelUi('Theo số tiền OTA')}: <strong>{money(form.record.providerAmount, form.record.currency)}</strong></p> : form.record.missingRate ? <>
            <p>{labelUi("Đặt phòng cũ chưa lưu tỷ lệ hoa hồng. Nhập tỷ lệ đã xác nhận với nguồn đặt phòng trước khi chốt.")}</p>
            <div className="domain-fields"><label>{labelUi("Tỷ lệ hoa hồng (%)")}<input autoFocus type="text" inputMode="decimal" pattern="[0-9]{1,15}([.][0-9]{1,4})?" maxLength={20} required min="0" max="100" step="0.0001" value={form.legacyPercent} onChange={event => change('legacyPercent', event.target.value)} /></label></div>
            <label style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}><input type="checkbox" required checked={form.confirmLegacyRate} onChange={event => change('confirmLegacyRate', event.target.checked)} style={{ width: 'auto', minHeight: 0 }} />{labelUi("Tôi xác nhận tỷ lệ hoa hồng cho đặt phòng cũ này.")}</label>
          </> : <p>{labelUi("Tỷ lệ đã lưu khi đặt phòng:")}{" "}<strong>{form.record.percent}%</strong>{labelUi(". Hệ thống tính và lưu tiền phòng sau giảm giá tại thời điểm chốt.")}</p>}
        </> : <>
          <p>{labelUi("Cơ sở đã chốt:")}{" "}{form.record.calculationBasis === 'provider_amount' ? labelUi('Theo số tiền OTA') : <><strong>{money(form.record.roomNet, form.record.currency)}</strong> × {form.record.percent}%</>}. Hoa hồng: <strong>{money(form.record.amount, form.record.currency)}</strong>. {form.mode === 'recover' ? 'Cần thu hồi' : 'Còn phải chi'}: <strong>{money(form.mode === 'recover' ? selected?.recoveryDue ?? form.record.recoveryDue : selected?.balance ?? form.record.balance, form.record.currency)}</strong>.</p>
          <div className="domain-fields">
            <label>Số tiền ({form.record.currency})<input autoFocus type="text" inputMode="decimal" pattern="[0-9]{1,15}([.][0-9]{1,4})?" maxLength={20} required min="0.0001" max={form.mode === 'recover' ? selected?.recoveryDue ?? form.record.recoveryDue : selected?.balance ?? form.record.balance} step="0.0001" value={form.amount} onChange={event => change('amount', event.target.value)} /></label>
            <label>{form.mode === 'recover' ? 'Quỹ nhận lại' : labelUi("Quỹ chi")}<select required value={form.fundId} onChange={event => change('fundId', event.target.value)}><option value="">{labelUi("Chọn quỹ")}</option>{activeFunds.map(fund => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select></label>
            <label>{form.mode === 'recover' ? 'Danh mục thu' : labelUi("Danh mục chi")}<select value={form.categoryId} onChange={event => change('categoryId', event.target.value)}><option value="">{labelUi("Chưa phân loại")}</option>{expenseCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          </div>
          {!activeFunds.length && <p role="alert" className="domain-error">Chưa có quỹ đang hoạt động bằng {form.record.currency} để chi hoa hồng.</p>}
          <label>{tUi("common.notes")}<textarea required={form.mode === 'recover'} maxLength={500} value={form.note} onChange={event => change('note', event.target.value)} /></label>
        </>}
      </fieldset>
      <div className="domain-fields" style={{ marginTop: 16 }}><button type="button" disabled={busy} onClick={close}>{tUi("common.close")}</button><button className="primary" type="submit" autoFocus={form.mode === 'settle' && !form.record.missingRate} disabled={busy || !canWrite || loading || !selected || blocked || (['pay', 'recover'].includes(form.mode) && !activeFunds.some(fund => fund.id === form.fundId))}>{busy ? labelUi("Đang ghi nhận…") : form.mode === 'settle' ? labelUi("Chốt hoa hồng") : form.mode === 'review' ? 'Lưu kết quả đối soát' : form.mode === 'recover' ? 'Ghi phiếu thu hồi' : labelUi("Ghi phiếu chi")}</button></div>
    </form></section>}

    <section className="domain-panel" tabIndex={0} aria-labelledby="commissions-title" aria-busy={loading}><h2 id="commissions-title">{labelUi("Hoa hồng đã chốt")}</h2><table>
      <thead><tr>{['Đặt phòng / khách', 'Nguồn', 'Cơ sở hoa hồng', 'Tiền phòng sau giảm', 'Hoa hồng', 'Đã chi', 'Còn phải chi', 'Trạng thái', 'Chi tiết'].map(title => <th key={title} scope="col">{labelUi(title)}</th>)}</tr></thead>
      <tbody>{data?.items.map(record => <tr key={record.id}>
        <td>{record.guestName}<br />{record.bookingId}</td><td>{record.sourceName}</td><td>{labelUi(commissionRateLabel(record))}</td><td>{money(record.roomNet, record.currency)}</td><td>{money(record.amount, record.currency)}</td><td>{money(record.paid, record.currency)}</td><td>{money(record.balance, record.currency)}</td><td>{record.needsReview ? statuses.NEEDS_REVIEW : statuses[record.status] || record.status}</td>
        <td>{canWrite && <>
          <button type="button" disabled={busy || Boolean(form) || record.needsReview || Number(record.balance) <= 0} onClick={event => open('pay', record, event)}>{labelUi("Chi hoa hồng")}</button>
          <button type="button" disabled={busy || Boolean(form)} onClick={event => open('review', record, event)}>Đối soát lại</button>
          {Number(record.recoveryDue) > 0 && <button type="button" disabled={busy || Boolean(form) || record.needsReview} onClick={event => open('recover', record, event)}>Thu hồi hoa hồng</button>}
        </>}{record.needsReview && <p>{labelUi("Cần đối soát chiết khấu hoặc điều chỉnh lưu trú.")}</p>}
          <details><summary>{labelUi("Cơ sở và lịch sử chi")}</summary><p>Cơ sở tiền phòng: {money(record.roomNet, record.currency)} · {labelUi(commissionRateLabel(record))}.</p><p>Cơ sở tiền quy đổi đã chốt: {money(record.baseRoomNet, record.baseCurrency)}. Hoa hồng quy đổi: {money(record.baseAmount, record.baseCurrency)}.</p>
            {record.payments.length ? <ul>{record.payments.map(payment => <li key={payment.id}>{formatDate(payment.date)} · {money(payment.amount, record.currency)} · <Link to={cashbookLink(payment, record.currency)}>Phiếu {payment.cashDocumentId}</Link>{payment.reversed ? ' · Đã đảo phiếu' : ''}</li>)}</ul> : <p>{labelUi("Chưa có khoản chi.")}</p>}
            {!!record.recoveries?.length && <><p>Lịch sử thu hồi</p><ul>{record.recoveries.map(payment => <li key={payment.id}>{formatDate(payment.date)} · {money(payment.amount, record.currency)} · <Link to={cashbookLink(payment, record.currency)}>Phiếu {payment.cashDocumentId}</Link>{payment.reversed ? ' · Đã đảo phiếu' : ''}</li>)}</ul></>}
            {!!record.reviews?.length && <><p>Lịch sử đối soát · Hoa hồng gốc {money(record.originalAmount, record.currency)}</p><ul>{record.reviews.map(review => <li key={review.id}>{review.createdAt} · {money(review.amount, record.currency)} · {review.reason}</li>)}</ul></>}
            <p><Link to="/id/cashflow/cash">{labelUi("Mở sổ quỹ để đối soát hoặc đảo phiếu chi")}</Link></p></details></td>
      </tr>)}{!data?.items.length && <tr><td colSpan={9}>{loading ? labelUi("Đang tải hoa hồng…") : data ? labelUi("Chưa có hoa hồng đã chốt theo bộ lọc.") : labelUi("Chưa tải được dữ liệu.")}</td></tr>}</tbody>
    </table></section>

    <section className="domain-panel" tabIndex={0} aria-labelledby="commission-candidates-title" aria-busy={loading}><h2 id="commission-candidates-title">{labelUi("Đặt phòng đã trả phòng, chưa chốt")}</h2><table>
      <thead><tr>{['Đặt phòng / khách', 'Ngày trả phòng', 'Nguồn', 'Tiền tệ', 'Cơ sở hoa hồng', 'Thao tác'].map(title => <th key={title} scope="col">{labelUi(title)}</th>)}</tr></thead>
      <tbody>{data?.candidates.map(record => <tr key={record.bookingId}><td>{record.guestName}<br />{record.bookingId}</td><td>{formatDate(record.checkOut)}</td><td>{record.sourceName}</td><td>{record.currency}</td><td>{labelUi(commissionRateLabel(record))}{record.calculationBasis === 'provider_amount' && <> · {money(record.providerAmount, record.currency)}</>}</td><td>{canWrite ? <button type="button" disabled={busy || Boolean(form)} onClick={event => open('settle', record, event)}>{labelUi("Chốt hoa hồng")}</button> : labelUi("Chỉ xem")}</td></tr>)}{!data?.candidates.length && <tr><td colSpan={6}>{loading ? labelUi("Đang tải đặt phòng…") : data ? labelUi("Không có đặt phòng chưa chốt theo bộ lọc.") : labelUi("Chưa tải được dữ liệu.")}</td></tr>}</tbody>
    </table></section>
    <nav className="domain-fields" aria-label={labelUi("Phân trang hoa hồng")} style={{ marginTop: 16 }}>
      <span>{data?.pagination?.totalItems ?? ((data?.items.length || 0) + (data?.candidates.length || 0))} đặt phòng · Trang {filters.page}/{totalPages}. Tổng hoa hồng gồm toàn bộ kỳ đang lọc.</span>
      <button type="button" disabled={loading || busy || Boolean(form) || filters.page <= 1} onClick={() => setFilters(previous => ({ ...previous, page: previous.page - 1 }))}>{labelUi("Trang trước")}</button>
      <button type="button" disabled={loading || busy || Boolean(form) || filters.page >= totalPages} onClick={() => setFilters(previous => ({ ...previous, page: previous.page + 1 }))}>{labelUi("Trang sau")}</button>
    </nav>
  </div>;
}
