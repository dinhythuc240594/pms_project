import { formatDate } from '../../../../shared/lib/date.js';
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import NightlyRates from './NightlyRates';
import { usePms } from '../../data/usePms';
import { today, addDays, money } from '../../data/model';
import '../../components/DomainForms.css';
import '../RatesInventory.css';

export default function RatesARI() {
  useI18n();
  const { roomTypes, rates, settings, access, saveRate } = usePms();
  const [error, setError] = useState(''), [busy, setBusy] = useState(''), [notice, setNotice] = useState('');
  const date = today(settings.timezone);
  const writable = access('settings.write', 'ARI_MANAGEMENT', true).allowed;
  const activeTypes = roomTypes.filter(type => type.active !== false);
  const confirmedNotice = notice && Boolean(rates.find(row => row.roomTypeId === notice.typeId && row.date === date)?.stopSell) === notice.stopped;
  async function toggle(type, stopped) {
    if (busy || !writable) return;
    setBusy(type.id); setError(''); setNotice('');
    try { await saveRate({ roomTypeId: type.id, start: date, end: addDays(date, 1), stopSell: !stopped }); setNotice({ typeId: type.id, stopped: !stopped, text: `${type.name}: đã ${stopped ? 'mở' : 'dừng'} bán hôm nay.` }); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  return <div className="pms-domain-page pms-rates-page">
    <header className="domain-toolbar rates-page-heading"><div><span className="rates-kicker">{tUi("nav.rates")}</span><h1>{tUi("nav.calendarRates")}</h1><p>{labelUi("Kiểm soát giá từng đêm và trạng thái bán của khách sạn.")}</p></div><Link className="rates-link-button" to="/id/ari"><CalendarDays size={16} aria-hidden="true" />{" "}{labelUi("Mở lịch đặt phòng")}</Link></header>
    {error && <p className="domain-error" role="alert">{error}</p>}{confirmedNotice && <p className="rates-notice is-success" role="status">{notice.text}</p>}
    <section className="domain-panel rates-table-panel"><div className="rates-section-heading"><div><h2>{labelUi("Trạng thái bán hôm nay")}</h2><p>{formatDate(date)} · Dừng bán sẽ chặn đặt phòng mới cho ngày này.</p></div></div>
      <div className="rates-scroll"><table><thead><tr><th scope="col">{tUi("common.roomType")}</th><th scope="col">Giá / đêm ({settings.currency})</th><th scope="col">{labelUi("Trạng thái bán")}</th><th scope="col">{tUi("common.actions")}</th></tr></thead><tbody>{activeTypes.map(type => {
        const rate = rates.find(row => row.roomTypeId === type.id && row.date === date);
        const stopped = Boolean(rate?.stopSell);
        return <tr key={type.id}><th scope="row">{type.name}<small className="rates-muted">{rate ? labelUi("Giá từng đêm") : tUi("nav.basicRates")}</small></th><td className="rates-price">{money(rate?.price ?? type.price, settings.currency)}</td><td><span className={`rates-badge ${stopped ? 'is-paused' : 'is-active'}`}>{stopped ? tUi("rates.stopSell") : labelUi("Đang bán")}</span></td><td><button className="rates-icon-button" disabled={Boolean(busy) || !writable} onClick={() => toggle(type, stopped)} aria-label={`${stopped ? 'Mở' : 'Dừng'} bán ${type.name} hôm nay`}>{busy === type.id ? tUi("common.saving") : stopped ? tUi("rates.openSell") : tUi("rates.stopSell")}</button></td></tr>;
      })}{!activeTypes.length && <tr><td colSpan={4} className="rates-empty">{labelUi("Chưa có loại phòng đang hoạt động.")}</td></tr>}</tbody></table></div>
    </section>
    <NightlyRates />
  </div>;
}
