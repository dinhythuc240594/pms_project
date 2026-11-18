import { decimalInput } from '../../../../shared/lib/number.js';
import DateInput from '../../../../shared/components/DateInput.jsx';
import { formatDate } from '../../../../shared/lib/date.js';
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { usePms } from '../../data/usePms';
import { today, addDays, nights, money as formatMoney } from '../../data/model';
import { useInventoryQuery } from '../../inventory/useInventoryQuery';
import { rateRangeError } from '../rateRange';
import { dateRangeParams } from '../../../../shared/lib/dateRangeQuery.js';
import '../../components/DomainForms.css';
import '../RatesInventory.css';

export default function NightlyRates() {
  const { tenantId, user } = usePms();
  return <NightlyEditor key={`${tenantId}:${user?.id}`} />;
}

function NightlyEditor() {
  useI18n();
  const { roomTypes, rooms, roomBlocks, settings, access, saveRate, addBlock, deleteBlock } = usePms();
  const activeTypes = roomTypes.filter(type => type.active !== false);
  const activeRooms = rooms.filter(room => room.active !== false);
  const [range, setRange] = useState({ start: today(settings.timezone), end: addDays(today(settings.timezone), 7) });
  const [rate, setRate] = useState({ roomTypeId: activeTypes[0]?.id || '', price: '', stopSell: false });
  const [block, setBlock] = useState({ room: activeRooms[0]?.id || '', reason: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [feedbackGroup, setFeedbackGroup] = useState('rates');
  const [startValid, setStartValid] = useState(true), [endValid, setEndValid] = useState(true);
  const rangeError = !startValid || !endValid ? labelUi("Ngày không hợp lệ.") : rateRangeError(range);
  const query = useInventoryQuery(rangeError ? null : '/rates?' + dateRangeParams(range));
  const rows = query.data?.rates || [];
  const canWrite = access('settings.write', 'ARI_MANAGEMENT', true).allowed;

  async function run(action, message, requiresRange = true, group = 'rates') {
    if (busy || !canWrite || (requiresRange && rangeError)) return;
    setBusy(true); setError(''); setNotice(''); setFeedbackGroup(group);
    try { await action(); query.refresh(); setNotice(message); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section className="rates-nightly" aria-label={labelUi("Giá theo ngày và khóa phòng")}>
    <section className="domain-panel">
      <div className="rates-section-heading"><div><h2>{labelUi("Giá theo ngày")}</h2><p>{labelUi("Áp dụng giá riêng hoặc dừng bán một loại phòng trong khoảng ngày đã chọn.")}</p></div></div>
      <div className="domain-fields rates-date-range">
        <label>{tUi("common.fromDate")}<DateInput aria-label={labelUi("Giá từ ngày")} required disabled={busy} value={range.start} onChange={start => setRange(old => ({ ...old, start }))} onValidityChange={setStartValid} /></label>
        <label>{labelUi("Đến ngày (không gồm ngày này)")}<DateInput aria-label={labelUi("Giá đến ngày")} required disabled={busy} min={range.start ? addDays(range.start, 1) : undefined} max={range.start ? addDays(range.start, 366) : undefined} value={range.end} onChange={end => setRange(old => ({ ...old, end }))} onValidityChange={setEndValid} /></label>
      </div>
      {rangeError ? <p className="domain-error" role="alert">{rangeError}</p> : <p className="rates-muted">Áp dụng cho {nights(range.start, range.end)} đêm. Ngày kết thúc không nằm trong khoảng áp dụng.</p>}
      {((feedbackGroup === 'rates' && error) || query.error) && <p className="domain-error" role="alert">{feedbackGroup === 'rates' && error ? error : query.error}</p>}
      {feedbackGroup === 'rates' && notice && <p className="rates-notice" role="status">{notice}</p>}
      {!canWrite && <p className="rates-notice">{labelUi("Bạn có quyền xem. Cần quyền quản lý để thay đổi giá hoặc khóa phòng.")}</p>}
      <form onSubmit={event => { event.preventDefault(); run(() => saveRate({ ...range, ...rate, price: decimalInput(rate.price) }), 'Đã cập nhật giá và trạng thái bán trong khoảng ngày đã chọn.'); }}>
        <fieldset className="rates-form-section" disabled={busy || !canWrite || Boolean(rangeError) || query.loading || Boolean(query.error) || !activeTypes.length}>
          <div className="rates-form-grid">
            <label>{tUi("common.roomType")}<select aria-label={labelUi("Loại phòng áp dụng giá")} required value={rate.roomTypeId} onChange={event => setRate(old => ({ ...old, roomTypeId: event.target.value }))}>{!activeTypes.length && <option value="">{labelUi("Chưa có loại phòng")}</option>}{activeTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <label>Giá / đêm ({settings.currency})<input aria-label={labelUi("Giá từng đêm")} required type="text" inputMode="decimal" pattern="[0-9]{1,15}([.][0-9]{1,4})?" maxLength={20} placeholder={labelUi("Nhập giá áp dụng")} value={rate.price} onChange={event => setRate(old => ({ ...old, price: event.target.value }))} /></label>
          </div>
          <div className="rates-form-actions"><label className="rates-checkbox"><input type="checkbox" checked={rate.stopSell} onChange={event => setRate(old => ({ ...old, stopSell: event.target.checked }))} />{labelUi("Dừng bán loại phòng trong khoảng ngày này")}</label><button type="submit" className="primary">{busy ? tUi("common.saving") : labelUi("Áp dụng giá theo ngày")}</button></div>
        </fieldset>
      </form>
      {query.loading ? <p className="rates-empty" role="status">{labelUi("Đang tải giá theo ngày…")}</p> : !rangeError && !query.error && <details className="rates-details"><summary>Xem giá áp dụng theo ngày ({rows.length} dòng)</summary><div className="rates-scroll"><table><thead><tr><th>{tUi("common.roomType")}</th><th>{labelUi("Ngày áp dụng")}</th><th>{labelUi("Giá / đêm")}</th><th>{labelUi("Trạng thái bán")}</th></tr></thead><tbody>{rows.length ? rows.map(row => <tr key={row.roomTypeId + row.date}><td>{roomTypes.find(type => type.id === row.roomTypeId)?.name || labelUi("Loại phòng không còn hoạt động")}</td><td>{formatDate(row.date)}</td><td>{formatMoney(row.price, settings.currency)}</td><td><span className={`rates-badge ${row.stopSell ? 'is-paused' : 'is-active'}`}>{row.stopSell ? tUi("rates.stopSell") : labelUi("Đang bán")}</span></td></tr>) : <tr><td colSpan="4" className="rates-empty">{labelUi("Chưa thiết lập giá theo ngày trong khoảng này. Giá cơ bản vẫn áp dụng.")}</td></tr>}</tbody></table></div></details>}
      {query.error && <button type="button" disabled={busy} onClick={query.refresh}>{labelUi("Tải lại giá")}</button>}
    </section>
    <section className="domain-panel">
      <div className="rates-section-heading"><div><h2>{labelUi("Khóa phòng")}</h2><p>{labelUi("Tạm ngừng nhận đặt phòng cho một phòng cụ thể. Khoảng ngày áp dụng giống phần giá theo ngày phía trên.")}</p></div></div>
      {feedbackGroup === 'blocks' && error && <p className="domain-error" role="alert">{error}</p>}
      {feedbackGroup === 'blocks' && notice && <p className="rates-notice" role="status">{notice}</p>}
      <form onSubmit={event => { event.preventDefault(); run(() => addBlock({ ...range, ...block }), 'Đã khóa phòng trong khoảng ngày đã chọn.', true, 'blocks'); }}>
        <fieldset className="rates-form-section" disabled={busy || !canWrite || Boolean(rangeError) || query.loading || Boolean(query.error) || !activeRooms.length}>
          <div className="rates-form-grid">
            <label>{labelUi("Phòng cần khóa")}<select aria-label={labelUi("Phòng cần khóa")} required value={block.room} onChange={event => setBlock(old => ({ ...old, room: event.target.value }))}>{!activeRooms.length && <option value="">{labelUi("Chưa có phòng")}</option>}{activeRooms.map(room => <option key={room.id} value={room.id}>{tUi("common.room")}{' '}{room.id}</option>)}</select></label>
            <label>{labelUi("Lý do khóa phòng")}<input aria-label={labelUi("Lý do khóa phòng")} required pattern=".*\S.*" maxLength="500" placeholder={labelUi("Ví dụ: bảo trì hoặc sửa chữa")} value={block.reason} onChange={event => setBlock(old => ({ ...old, reason: event.target.value }))} /></label>
          </div>
          <div className="rates-form-actions"><span className="rates-muted">{labelUi("Phòng có đặt chỗ trong khoảng này sẽ không thể khóa.")}</span><button type="submit" className="primary">{busy ? tUi("common.saving") : labelUi("Khóa phòng")}</button></div>
        </fieldset>
      </form>
      <div className="rates-section-heading"><h3>{labelUi("Các khoảng khóa phòng")}</h3><span className="rates-muted">{roomBlocks.length} khoảng đã cấu hình</span></div>
      <div className="rates-scroll"><table><thead><tr><th>{tUi("common.room")}</th><th>{tUi("common.fromDate")}</th><th>{tUi("rates.endExclusive")}</th><th>{labelUi("Lý do")}</th><th>{tUi("common.actions")}</th></tr></thead><tbody>{roomBlocks.length ? roomBlocks.map(row => <tr key={row.id}><td>{tUi("common.room")}{' '}{row.room}</td><td>{formatDate(row.start)}</td><td>{formatDate(row.end)}</td><td>{row.reason}</td><td><button type="button" disabled={busy || !canWrite} onClick={() => run(() => deleteBlock(row.id), `Đã mở khóa phòng ${row.room}.`, false, 'blocks')} aria-label={`Mở khóa phòng ${row.room} từ ${row.start} đến ${row.end}`}>{labelUi("Mở khóa")}</button></td></tr>) : <tr><td colSpan="5" className="rates-empty">{labelUi("Chưa có phòng bị khóa. Các phòng vẫn nhận đặt chỗ theo tình trạng hiện tại.")}</td></tr>}</tbody></table></div>
    </section>
  </section>;
}
