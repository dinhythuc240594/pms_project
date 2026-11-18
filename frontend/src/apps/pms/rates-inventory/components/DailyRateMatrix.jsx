import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { shortDate as dateLabel } from '../../../../shared/i18n/formatters.js';
import { useId, useState } from 'react';
import { Check, ChevronDown, ChevronRight, LockKeyhole, Square, SquareCheck, SquareMinus, Tag } from 'lucide-react';
import { money, today } from '../../data/model';

const weekdays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const keyFor = (typeId, date) => `${typeId}:${date}`;

function priceLabel(value, currency) {
  if (value == null) return '—';
  const formatted = money(value, currency);
  const suffix = ' ' + (currency === 'VND' ? '₫' : currency);
  return formatted.endsWith(suffix) ? formatted.slice(0, -suffix.length) : formatted;
}

export default function DailyRateMatrix({ types, days, rates, availability, settings, selected, writable, busy, onToggle, onSelectRow }) {
  useI18n();
  const [collapsed, setCollapsed] = useState(new Set());
  const gridId = useId();
  const currentDate = today(settings.timezone);
  const ratesByKey = new Map(rates.map(row => [keyFor(row.roomTypeId, row.date), row]));
  const stockByKey = new Map(availability.map(row => [keyFor(row.roomTypeId, row.date), row]));
  const allCollapsed = types.length > 0 && types.every(type => collapsed.has(type.id));
  const dayInfo = days.map(date => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return { date, weekday, className: `${weekday === 0 || weekday === 6 ? 'is-weekend' : ''}${date === currentDate ? ' is-today' : ''}`.trim() };
  });
  function toggleGroup(typeId) {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(typeId)) next.delete(typeId); else next.add(typeId);
      return next;
    });
  }
  return <div className="rates-scroll rates-matrix-scroll" tabIndex={0} role="region" aria-label={tUi("rates.region")}>
    <table className="rates-matrix" style={{ '--rates-day-count': days.length }} aria-label={tUi('rates.tableAria', { currency: settings.currency })}>
      <colgroup><col className="rates-label-column" />{days.map(date => <col className="rates-date-column" key={date} />)}</colgroup>
      <thead><tr><th scope="col"><button type="button" className="rates-group-toggle rates-toggle-all" disabled={busy || !types.length} aria-expanded={!allCollapsed} aria-label={allCollapsed ? tUi("rates.expandAll") : tUi("rates.collapseAll")} onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(types.map(type => type.id)))}>{allCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}<span>{tUi("rates.roomRate")}</span></button></th>{dayInfo.map(({ date, weekday, className }) => <th key={date} scope="col" className={className} aria-current={date === currentDate ? 'date' : undefined}><strong>{dateLabel(date)}</strong><small>{labelUi(weekdays[weekday])}</small></th>)}</tr></thead>
      {types.map((type, typeIndex) => {
        const expanded = !collapsed.has(type.id);
        const selectedCount = days.filter(date => selected.has(keyFor(type.id, date))).length;
        const allSelected = days.length > 0 && selectedCount === days.length;
        const SelectionIcon = allSelected ? SquareCheck : selectedCount ? SquareMinus : Square;
        const cells = dayInfo.map(day => {
          const key = keyFor(type.id, day.date);
          const rate = ratesByKey.get(key), stock = stockByKey.get(key);
          const stopped = Boolean(rate?.stopSell || stock?.stopSell);
          const count = Number.isInteger(stock?.available) && stock.available >= 0 ? stock.available : null;
          const state = stopped || count === 0 ? 'is-paused' : count === null ? 'is-unknown' : count <= 2 ? 'is-low' : 'is-active';
          return { ...day, key, rate, count, stopped, state, price: rate?.price ?? type.price };
        });
        const priceRowId = `${gridId}-price-${typeIndex}`;
        return <tbody key={type.id}>
          <tr className="rates-room-row"><th scope="rowgroup"><button type="button" className="rates-group-toggle" disabled={busy} aria-label={`${expanded ? tUi("rates.collapse") : tUi("rates.expand")} ${type.name}`} aria-expanded={expanded} aria-controls={expanded ? priceRowId : undefined} onClick={() => toggleGroup(type.id)}>{expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}<span>{type.name}</span>{selectedCount > 0 && <small className="rates-group-selected">{selectedCount}{' '}{tUi("rates.selectedCells")}</small>}</button></th>{cells.map(cell => <td key={cell.date} className={`rates-availability-cell ${cell.className} ${cell.state}`} title={`${type.name}, ${dateLabel(cell.date)}: ${cell.count === null ? tUi("common.noAvailability") : tUi('rates.stockCount', { count: cell.count })}${cell.stopped ? ' · ' + tUi('rates.stopSell') : ''}`}><span>A:{cell.count ?? '—'}</span>{cell.stopped && <LockKeyhole size={11} aria-label={tUi("rates.stopSell")} />}</td>)}</tr>
          {expanded && <tr id={priceRowId} className="rates-price-row"><th scope="row">{writable ? <button type="button" className="rates-row-select" disabled={busy} aria-pressed={selectedCount > 0 && !allSelected ? 'mixed' : allSelected} aria-label={tUi('rates.rowAria', { action: allSelected ? tUi('rates.deselectRow') : tUi('rates.selectRow'), room: type.name })} onClick={() => onSelectRow(type)}><SelectionIcon size={15} aria-hidden="true" /><Tag size={14} aria-hidden="true" /><span>{tUi("rates.pmsPrice")}</span><small>{allSelected ? tUi("rates.deselectRow") : tUi("rates.selectRow")}</small></button> : <span className="rates-price-row-label"><Tag size={14} aria-hidden="true" />{tUi("rates.pmsPrice")}</span>}</th>{cells.map(cell => <td key={cell.date} className={`rates-price-cell ${cell.className}${cell.stopped ? ' is-stopped' : ''}`}><button type="button" className="rates-cell" aria-pressed={selected.has(cell.key)} aria-label={`${type.name}, ${dateLabel(cell.date)}, ${cell.price == null ? tUi("rates.noPriceLower") : money(cell.price, settings.currency)}${cell.stopped ? ', ' + tUi('rates.stopSell') : ''}`} title={`${dateLabel(cell.date)} · ${cell.price == null ? tUi("rates.noPrice") : money(cell.price, settings.currency)} · ${cell.rate?.id ? tUi("rates.dailyOverride") : tUi("nav.basicRates")}${cell.stopped ? ' · ' + tUi('rates.stopSell') : ''}`} disabled={busy || !writable} onClick={() => onToggle(cell.key)}><span className="rates-cell-price">{priceLabel(cell.price, settings.currency)}</span>{selected.has(cell.key) && <Check size={11} aria-hidden="true" />}</button></td>)}</tr>}
        </tbody>;
      })}
      {!types.length && <tbody><tr><td colSpan={days.length + 1} className="rates-empty">{tUi("rates.noTypes")}</td></tr></tbody>}
    </table>
  </div>;
}
