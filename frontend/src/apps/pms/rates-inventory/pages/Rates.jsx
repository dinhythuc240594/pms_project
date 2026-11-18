import { decimalInput } from '../../../../shared/lib/number.js';
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, Save, Users } from 'lucide-react';
import { usePms } from '../../data/usePms';
import { money } from '../../data/model';
import { quantityText } from '../../inventory/values';
import PricingManagement from './PricingManagement';
import '../../components/DomainForms.css';
import '../RatesInventory.css';

export default function Rates() {
  useI18n();
  const { roomTypes, rooms, saveMaster, access, settings } = usePms();
  const { tab } = useParams();
  const [prices, setPrices] = useState({}), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const writable = access('settings.write', 'ARI_MANAGEMENT', true).allowed;
  const activeTypes = roomTypes.filter(type => type.active !== false);
  async function save(event, type) {
    event.preventDefault();
    if (busy || !writable) return;
    setBusy(type.id); setError(''); setMessage('');
    try {
      await saveMaster('roomTypes', { ...type, price: decimalInput(prices[type.id] ?? type.price) });
      setPrices(old => { const next = { ...old }; delete next[type.id]; return next; });
      setMessage(`Đã lưu giá cơ bản của ${type.name}.`);
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  if (tab === 'advanced') return <PricingManagement catalog="rules" />;
  return <div className="pms-domain-page pms-rates-page">
    <header className="domain-toolbar rates-page-heading"><div><span className="rates-kicker">{tUi("nav.rates")}</span><h1>{tUi("nav.basicRates")}</h1><p>{labelUi("Quản lý giá niêm yết mỗi đêm theo loại phòng.")}</p></div><Link className="rates-link-button" to="/id/matrix-rate"><CalendarDays size={16} aria-hidden="true" />{" "}{labelUi("Xem giá theo ngày")}</Link></header>
    <div className="rates-summary"><span><strong>{activeTypes.length}</strong>{" "}{labelUi("loại phòng đang hoạt động")}</span><span>{labelUi("Đơn vị giá:")}{" "}<strong>{settings.currency}</strong></span></div>
    {!writable && <p className="rates-notice" role="status">{labelUi("Bạn có quyền xem giá. Chỉ người được cấp quyền quản lý cấu hình mới có thể thay đổi.")}</p>}
    {error && <p className="domain-error" role="alert">{error}</p>}{message && <p className="rates-notice is-success" role="status">{message}</p>}
    <section className="domain-panel rates-table-panel"><div className="rates-section-heading"><div><h2>{labelUi("Giá niêm yết theo loại phòng")}</h2><p>{labelUi("Giá từng ngày và quy tắc nâng cao được xét khi báo giá.")}</p></div><span className="rates-badge">{labelUi("Giá / đêm")}</span></div>
      <div className="rates-scroll"><table><thead><tr><th scope="col">{tUi("common.roomType")}</th><th scope="col">{tUi("common.capacity")}</th><th scope="col">{labelUi("Giá hiện tại")}</th><th scope="col">Cập nhật giá ({settings.currency})</th></tr></thead><tbody>
        {activeTypes.map(type => <tr key={type.id}><th scope="row"><strong>{type.name}</strong><small className="rates-muted">{rooms.filter(room => room.active !== false && room.typeId === type.id).length}{' '}{tUi("common.roomsLower")}</small></th><td><span className="rates-capacity"><Users size={14} aria-hidden="true" /> {type.capacity} người</span></td><td className="rates-price">{money(type.price, settings.currency)}</td><td><form className="rates-inline-price" onSubmit={event => save(event, type)}><input aria-label={`Giá ${type.name}`} required type="text" inputMode="decimal" pattern="[0-9]{1,15}([.][0-9]{1,4})?" maxLength={20} disabled={!writable || Boolean(busy)} value={prices[type.id] ?? quantityText(type.price)} onChange={event => setPrices(old => ({ ...old, [type.id]: event.target.value }))} /><button className="rates-icon-button" type="submit" disabled={!writable || Boolean(busy) || prices[type.id] === undefined}><Save size={15} aria-hidden="true" /> {busy === type.id ? tUi("common.saving") : labelUi("Lưu giá")}</button></form></td></tr>)}
        {!activeTypes.length && <tr><td colSpan={4} className="rates-empty">{labelUi("Chưa có loại phòng đang hoạt động. Thêm loại phòng trong Cấu hình để thiết lập giá.")}</td></tr>}
      </tbody></table></div><p className="rates-table-note">{labelUi("Thay đổi áp dụng cho báo giá mới. Đặt phòng đã tạo giữ nguyên giá đã chốt.")}</p>
    </section>
  </div>;
}
