import DateInput from '../../../../shared/components/DateInput.jsx';
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileInput, RefreshCw } from 'lucide-react';
import { usePms } from '../../data/usePms';
import { today } from '../../data/model';
import { dateRangeParams } from '../../../../shared/lib/dateRangeQuery.js';
import { useInventoryQuery } from '../useInventoryQuery';
import InventoryDocuments from '../InventoryDocuments';
import { quantityText } from '../values';
import '../../components/DomainForms.css';
import '../Inventory.css';

export default function InventoryStock() {
  const pms = usePms();
  return <StockWorkspace key={`${pms.tenantId}:${pms.user?.id}`} pms={pms} />;
}

function StockWorkspace({ pms }) {
  useI18n();
  const [filters, setFilters] = useState({ warehouseId: '', start: '', end: today(pms.settings.timezone) });
  const [search, setSearch] = useState(''), [lowOnly, setLowOnly] = useState(false), [version, setVersion] = useState(0);
  const masters = useInventoryQuery('/inventory/masters', version);
  const query = dateRangeParams(filters);
  const report = useInventoryQuery('/inventory/stock?' + query, version);
  const rows = (report.data?.rows || []).filter(row => (!lowOnly || row.lowStock) && `${row.item} ${row.sku}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));
  const summary = report.data?.summary;
  function filter(field, value) { setFilters(previous => ({ ...previous, [field]: value })); }
  return <div className="pms-domain-page pms-inventory">
    <header className="domain-toolbar"><div><h1>{labelUi("Tồn kho & Nhập xuất tồn")}</h1><p>{labelUi("Theo dõi số lượng đầu kỳ, tăng giảm trong kỳ và tồn hiện tại của từng kho.")}</p></div><div className="inventory-toolbar-actions"><button type="button" className="inventory-icon-button" onClick={() => setVersion(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />{" "}{labelUi("Tải lại báo cáo")}</button><Link className="inventory-link-button inventory-icon-button" to="/id/inventory/in"><FileInput size={16} aria-hidden="true" />{tUi("nav.stockIn")}</Link></div></header>
    <section className="domain-panel"><div className="domain-fields"><label>{labelUi("Kho báo cáo")}<select value={filters.warehouseId} onChange={event => filter('warehouseId', event.target.value)}><option value="">{labelUi("Tất cả kho")}</option>{(masters.data?.warehouses || []).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>{labelUi("Từ ngày báo cáo")}<DateInput value={filters.start} onChange={value => filter('start', value)} /></label><label>{labelUi("Đến ngày báo cáo")}<DateInput min={filters.start || undefined} max={today(pms.settings.timezone)} value={filters.end} onChange={value => filter('end', value)} /></label><label>{tUi("inventory.searchItems")}<input type="search" placeholder={labelUi("Tên hoặc SKU")} value={search} onChange={event => setSearch(event.target.value)} /></label><label className="inventory-checkbox"><input type="checkbox" checked={lowOnly} onChange={event => setLowOnly(event.target.checked)} />{" "}{labelUi("Chỉ xem tồn thấp")}</label></div></section>
    {masters.error && <p className="domain-error" role="alert">{masters.error}</p>}
    {report.loading && <p role="status">{labelUi("Đang tải số lượng và giá trị tồn kho…")}</p>}
    {report.error && <div className="domain-error" role="alert"><p>{report.error}</p><button type="button" onClick={report.refresh}>{labelUi("Thử lại báo cáo")}</button></div>}
    {summary && <><div className="domain-stats"><div>{labelUi("Mặt hàng / kho")}<strong>{summary.rowCount}</strong></div><div>{labelUi("Tồn cuối kỳ dưới mức tối thiểu")}<strong>{summary.lowStockCount}</strong></div><div>Giá trị tồn cuối kỳ ({summary.currency})<strong>{quantityText(summary.valuation)}</strong></div></div>
      {summary.reconciled === false && <p className="domain-error" role="alert">{labelUi("Sổ biến động chưa khớp với tồn hiện tại. Tải lại và đối chiếu các phiếu kho trước khi ghi giao dịch mới.")}</p>}
      <section className="domain-panel"><div className="inventory-scroll"><table><caption>{rows.length} dòng phù hợp. Tồn cuối kỳ và giá vốn theo ngày kết thúc đã chọn; tồn hiện tại phản ánh dữ liệu mới nhất.</caption><thead><tr><th>Kho</th><th>{labelUi("Mặt hàng")}</th><th>SKU</th><th>{labelUi("Đơn vị")}</th><th>{tUi("inventory.opening")}</th><th>{labelUi("Nhập trong kỳ")}</th><th>{labelUi("Xuất trong kỳ")}</th><th>{labelUi("Tồn cuối kỳ")}</th><th>{labelUi("Tồn hiện tại")}</th><th>{labelUi("Giá vốn TB cuối kỳ")}</th><th>Giá trị cuối kỳ ({summary.currency})</th><th>{labelUi("Cảnh báo")}</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.warehouseId}:${row.itemId}`}><td>{row.warehouse}</td><td>{row.item}</td><td>{row.sku || '—'}</td><td>{row.unit || '—'}</td><td>{quantityText(row.openingQuantity)}</td><td>{quantityText(row.received)}</td><td>{quantityText(row.issued)}</td><td>{quantityText(row.closingQuantity)}</td><td>{quantityText(row.quantity)}</td><td>{quantityText(row.unitCost)}</td><td>{quantityText(row.costValue)}</td><td className={row.lowStock ? 'inventory-low' : undefined}>{row.lowStock ? `Tồn thấp · mức tối thiểu ${quantityText(row.minStock)}` : 'Đủ mức tối thiểu'}</td></tr>)}{!rows.length && <tr><td colSpan={12}>{labelUi("Chưa có số liệu phù hợp. Ghi tồn đầu kỳ hoặc phiếu nhập để bắt đầu theo dõi hàng hóa.")}</td></tr>}</tbody></table></div></section>
    </>}
    <InventoryDocuments kind="all" embedded onChanged={() => setVersion(value => value + 1)} />
  </div>;
}
