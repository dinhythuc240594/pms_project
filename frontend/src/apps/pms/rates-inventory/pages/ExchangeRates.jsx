import { decimalInput } from '../../../../shared/lib/number.js';
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { usePms } from '../../data/usePms';
import { HOTEL_CURRENCY_CODES } from '../../../../shared/lib/currencies.js';
import { timestamp } from '../../data/presentation';
import { useInventoryQuery } from '../../inventory/useInventoryQuery';
import { quantityText } from '../../inventory/values';
import '../../components/DomainForms.css';
import '../RatesInventory.css';

export default function ExchangeRates() {
  const { tenantId, user, settings } = usePms();
  return <ExchangeEditor key={`${tenantId}:${user?.id}:${settings.currency}`} />;
}
function ExchangeEditor() {
  useI18n();
  const { saveExchangeRate, settings, access } = usePms();
  const query = useInventoryQuery('/pricing');
  const rows = query.data?.exchangeRates || [];
  const [currency, setCurrency] = useState(settings.currency === 'VND' ? 'USD' : 'VND');
  const [rate, setRate] = useState(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const writable = access('settings.write', 'MULTI_CURRENCY', true).allowed;
  const currentRate = rate ?? quantityText(rows.find(row => row.currency === currency)?.rate ?? '');

  async function save(event) {
    event.preventDefault();
    if (busy || !writable) return;
    setBusy(true); setError(''); setMessage('');
    try { await saveExchangeRate({ currency, rate: decimalInput(currentRate, { precision: 8, min: '0.00000001', max: '99999999999.99999999' }) }); setRate(null); query.refresh(); setMessage('Đã lưu tỷ giá cho giao dịch mới. Giao dịch cũ giữ tỷ giá đã chốt.'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="pms-domain-page pms-rates-page">
    <header className="rates-page-heading"><div><span className="rates-kicker">{tUi("nav.rates")}</span><h1>{tUi("nav.exchangeRates")}</h1><p>Quản lý quy đổi ngoại tệ sang tiền tệ cơ sở {settings.currency} của khách sạn.</p></div></header>
    {(error || query.error) && <p className="domain-error" role="alert">{error || query.error}</p>}
    {message && <p className="rates-notice" role="status">{message}</p>}
    {!writable && <p className="rates-notice">{labelUi("Bạn có quyền xem. Cần quyền quản lý và tính năng đa tiền tệ để cập nhật tỷ giá.")}</p>}
    <section className="domain-panel">
      <div className="rates-section-heading"><div><h2>{labelUi("Tỷ giá hiện tại")}</h2><p>{labelUi("1 đơn vị ngoại tệ tương đương giá trị quy đổi bên dưới.")}</p></div><span className="rates-badge">Cơ sở: {settings.currency}</span></div>
      {query.loading ? <p className="rates-empty" role="status">{labelUi("Đang tải tỷ giá…")}</p> : <div className="rates-scroll"><table><thead><tr><th>{tUi("common.currency")}</th><th>Tỷ giá sang {settings.currency}</th><th>{labelUi("Cập nhật gần nhất")}</th></tr></thead><tbody><tr><td><strong>{settings.currency}</strong><span className="rates-muted">{" "}{labelUi("· Tiền tệ cơ sở")}</span></td><td>1</td><td>—</td></tr>{rows.filter(row => row.currency !== settings.currency).map(row => <tr key={row.currency}><td><strong>{row.currency}</strong></td><td>{quantityText(row.rate)}</td><td>{timestamp(row.updatedAt, settings.timezone)}</td></tr>)}{!query.error && !rows.some(row => row.currency !== settings.currency) && <tr><td colSpan="3" className="rates-empty">{labelUi("Chưa cấu hình tỷ giá ngoại tệ. Thêm tỷ giá để quy đổi khi đặt phòng.")}</td></tr>}</tbody></table></div>}
      {query.error && <button type="button" onClick={query.refresh}>{labelUi("Tải lại tỷ giá")}</button>}
    </section>
    <section className="domain-panel">
      <div className="rates-section-heading"><div><h2>{labelUi("Cập nhật tỷ giá")}</h2><p>{labelUi("Tỷ giá mới chỉ áp dụng cho giao dịch phát sinh sau khi lưu.")}</p></div></div>
      <form onSubmit={save}><fieldset className="rates-form-section" disabled={!writable || busy || query.loading || Boolean(query.error)}>
        <div className="rates-form-grid"><label>{labelUi("Tiền tệ cần quy đổi")}<select value={currency} onChange={event => { setCurrency(event.target.value); setRate(null); }}>{HOTEL_CURRENCY_CODES.filter(code => code !== settings.currency).map(code => <option key={code}>{code}</option>)}</select></label><label>1 {currency} bằng bao nhiêu {settings.currency}?<input type="number" min="0.00000001" max="99999999999.99999999" step="0.00000001" required placeholder={`Nhập giá trị theo ${settings.currency}`} value={currentRate} onChange={event => setRate(event.target.value)} /></label></div>
        <div className="rates-form-actions"><span className="rates-muted">{labelUi("Giá trị phải lớn hơn 0. Tỷ giá của tiền tệ cơ sở luôn bằng 1.")}</span><button type="submit" className="primary">{busy ? tUi("common.saving") : labelUi("Lưu tỷ giá")}</button></div>
      </fieldset></form>
    </section>
  </div>;
}
