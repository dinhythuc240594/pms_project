import DateInput from '../../../../shared/components/DateInput.jsx'
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, FileInput, RefreshCw } from 'lucide-react'
import { formatDate } from '../../../../shared/lib/date.js'
import { usePms } from '../../data/usePms'
import { today } from '../../data/model'
import { dateRangeParams } from '../../../../shared/lib/dateRangeQuery.js'
import { useInventoryQuery } from '../useInventoryQuery'
import InventoryDocuments from '../InventoryDocuments'
import { quantityText } from '../values'
import '../../components/DomainForms.css'
import '../Inventory.css'

// Client-side paging of the rows already returned by /inventory/stock; the backend is not paginated.
const PAGE_SIZE = 50
const TABS = [
  { id: 'stock', label: 'Tồn kho' },
  { id: 'history', label: 'Lịch sử phiếu kho' },
]

export default function InventoryStock() {
  const pms = usePms()
  return <StockWorkspace key={`${pms.tenantId}:${pms.user?.id}`} pms={pms} />
}

function StockWorkspace({ pms }) {
  useI18n()
  const ids = useId()
  const todayDate = today(pms.settings.timezone)
  const [filters, setFilters] = useState({ warehouseId: '', start: '', end: todayDate })
  const [search, setSearch] = useState(''),
    [lowOnly, setLowOnly] = useState(false),
    [version, setVersion] = useState(0)
  const [detailed, setDetailed] = useState(false),
    [page, setPage] = useState(1)
  // History stays mounted (hidden) so its own filters, page and open dialogs survive tab switches.
  // It receives the report warehouse only when its tab is opened, never live and never the report dates.
  const [tab, setTab] = useState('stock'),
    [historySeed, setHistorySeed] = useState(undefined)
  const tabRefs = useRef({})
  const masters = useInventoryQuery('/inventory/masters', version)
  const query = dateRangeParams(filters)
  const report = useInventoryQuery('/inventory/stock?' + query, version)
  const allRows = report.data?.rows || []
  const needle = search.trim().toLocaleLowerCase('vi')
  // Search and the low-stock filter cover the full returned report; row.lowStock is the server's closing-stock flag.
  const rows = allRows.filter(
    (row) =>
      (!lowOnly || row.lowStock) &&
      `${row.item} ${row.sku}`.toLocaleLowerCase('vi').includes(needle),
  )
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  if (report.data && page > pageCount) setPage(pageCount)
  const currentPage = Math.min(page, pageCount)
  const firstIndex = (currentPage - 1) * PAGE_SIZE
  const pageRows = rows.slice(firstIndex, firstIndex + PAGE_SIZE)
  const summary = report.data?.summary
  const historicalEnd = Boolean(filters.end) && filters.end < todayDate
  const endLabel = filters.end ? formatDate(filters.end) : labelUi('ngày kết thúc báo cáo')
  const columnCount = detailed ? 12 : 6
  function filter(field, value) {
    setFilters((previous) => ({ ...previous, [field]: value }))
    setPage(1)
  }
  function selectTab(next) {
    if (next === 'history' && tab !== 'history') setHistorySeed(filters.warehouseId)
    setTab(next)
  }
  function tabKey(event) {
    const index = TABS.findIndex((item) => item.id === event.currentTarget.dataset.tab)
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 }[
      event.key
    ]
    if (target === undefined) return
    event.preventDefault()
    const next = TABS[(target + TABS.length) % TABS.length].id
    selectTab(next)
    tabRefs.current[next]?.focus()
  }
  const tabId = (id) => `${ids}-tab-${id}`,
    panelId = (id) => `${ids}-panel-${id}`
  return (
    <div className="pms-domain-page pms-inventory">
      <header className="domain-toolbar domain-toolbar--actions">
        <div className="inventory-toolbar-actions">
          <button
            type="button"
            className="inventory-icon-button"
            onClick={() => setVersion((value) => value + 1)}
          >
            <RefreshCw size={16} aria-hidden="true" /> {labelUi('Tải lại báo cáo')}
          </button>
          <Link
            className="inventory-link-button inventory-icon-button"
            to={
              '/id/inventory/in' +
              (filters.warehouseId
                ? '?' + new URLSearchParams({ warehouseId: filters.warehouseId })
                : '')
            }
          >
            <FileInput size={16} aria-hidden="true" />
            {tUi('nav.stockIn')}
          </Link>
        </div>
      </header>
      {masters.error && (
        <div className="domain-error" role="alert">
          <p>{masters.error}</p>
          <button type="button" onClick={masters.refresh}>
            {labelUi('Tải lại danh mục kho')}
          </button>
        </div>
      )}
      {report.loading && <p role="status">{labelUi('Đang tải số lượng và giá trị tồn kho…')}</p>}
      {report.error && (
        <div className="domain-error" role="alert">
          <p>{report.error}</p>
          <button type="button" onClick={report.refresh}>
            {labelUi('Thử lại báo cáo')}
          </button>
        </div>
      )}
      {summary?.reconciled === false && (
        <p className="domain-error" role="alert">
          {labelUi(
            'Sổ biến động chưa khớp với tồn hiện tại. Tải lại và đối chiếu các phiếu kho trước khi ghi giao dịch mới.',
          )}
        </p>
      )}
      <div
        className="inventory-tabs"
        role="tablist"
        aria-label={labelUi('Tồn kho và lịch sử phiếu kho')}
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[item.id] = node
            }}
            type="button"
            role="tab"
            id={tabId(item.id)}
            data-tab={item.id}
            aria-controls={panelId(item.id)}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => selectTab(item.id)}
            onKeyDown={tabKey}
          >
            {labelUi(item.label)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={panelId('stock')}
        aria-labelledby={tabId('stock')}
        hidden={tab !== 'stock'}
      >
        <section className="domain-panel">
          <div className="domain-fields">
            <label>
              {labelUi('Kho báo cáo')}
              <select
                value={filters.warehouseId}
                onChange={(event) => filter('warehouseId', event.target.value)}
              >
                <option value="">{labelUi('Tất cả kho')}</option>
                {(masters.data?.warehouses || []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labelUi('Từ ngày báo cáo')}
              <DateInput value={filters.start} onChange={(value) => filter('start', value)} />
            </label>
            <label>
              {labelUi('Đến ngày báo cáo')}
              <DateInput
                min={filters.start || undefined}
                max={todayDate}
                value={filters.end}
                onChange={(value) => filter('end', value)}
              />
            </label>
            <label>
              {tUi('inventory.searchItems')}
              <input
                type="search"
                placeholder={labelUi('Tên hoặc SKU')}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
              />
            </label>
            <label className="inventory-checkbox">
              <input
                type="checkbox"
                checked={lowOnly}
                onChange={(event) => {
                  setLowOnly(event.target.checked)
                  setPage(1)
                }}
              />{' '}
              {labelUi('Chỉ xem tồn thấp')}
            </label>
            <label className="inventory-checkbox">
              <input
                type="checkbox"
                checked={detailed}
                onChange={(event) => setDetailed(event.target.checked)}
              />{' '}
              {labelUi('Hiện số liệu kỳ và giá trị')}
            </label>
          </div>
          <p className="inventory-hint">
            {labelUi(
              'Cảnh báo tồn thấp tính theo tồn cuối kỳ tại ngày kết thúc báo cáo; cột Tồn hiện tại phản ánh dữ liệu mới nhất. Ngày báo cáo không được chuyển sang phiếu nhập kho.',
            )}
          </p>
          {historicalEnd && (
            <p className="inventory-hint inventory-low" role="note">
              Ngày kết thúc báo cáo {endLabel} là ngày trong quá khứ: cảnh báo tồn thấp tính theo
              tồn cuối kỳ tại ngày đó và có thể khác Tồn hiện tại.
            </p>
          )}
        </section>
        {summary && (
          <>
            <div className="domain-stats">
              <div>
                {labelUi('Mặt hàng / kho')}
                <strong>{summary.rowCount}</strong>
              </div>
              <div>
                {labelUi('Tồn cuối kỳ dưới mức tối thiểu')}
                <strong>{summary.lowStockCount}</strong>
              </div>
              {detailed && (
                <div>
                  Giá trị tồn cuối kỳ ({summary.currency})
                  <strong>{quantityText(summary.valuation)}</strong>
                </div>
              )}
            </div>
            <section className="domain-panel">
              <div
                className="inventory-scroll"
                role="region"
                aria-label={labelUi('Bảng tồn kho')}
                tabIndex={0}
              >
                <table>
                  <caption>
                    {rows.length} dòng phù hợp
                    {rows.length !== allRows.length
                      ? ` trên ${allRows.length} dòng của báo cáo`
                      : ''}
                    {rows.length
                      ? `, đang hiển thị ${firstIndex + 1}–${firstIndex + pageRows.length}`
                      : ''}
                    . Cảnh báo theo tồn cuối kỳ tại {endLabel}
                    {detailed ? '; tồn cuối kỳ và giá vốn theo ngày kết thúc đã chọn' : ''}; tồn
                    hiện tại phản ánh dữ liệu mới nhất.
                  </caption>
                  <thead>
                    <tr>
                      <th>Kho</th>
                      <th>{labelUi('Mặt hàng')}</th>
                      <th>SKU</th>
                      <th>{labelUi('Đơn vị')}</th>
                      {detailed && (
                        <>
                          <th>{tUi('inventory.opening')}</th>
                          <th>{labelUi('Nhập trong kỳ')}</th>
                          <th>{labelUi('Xuất trong kỳ')}</th>
                          <th>{labelUi('Tồn cuối kỳ')}</th>
                        </>
                      )}
                      <th>{labelUi('Tồn hiện tại')}</th>
                      {detailed && (
                        <>
                          <th>{labelUi('Giá vốn TB cuối kỳ')}</th>
                          <th>Giá trị cuối kỳ ({summary.currency})</th>
                        </>
                      )}
                      <th>{labelUi('Cảnh báo')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr key={`${row.warehouseId}:${row.itemId}`}>
                        <td>{row.warehouse}</td>
                        <td>{row.item}</td>
                        <td>{row.sku || '—'}</td>
                        <td>{row.unit || '—'}</td>
                        {detailed && (
                          <>
                            <td>{quantityText(row.openingQuantity)}</td>
                            <td>{quantityText(row.received)}</td>
                            <td>{quantityText(row.issued)}</td>
                            <td>{quantityText(row.closingQuantity)}</td>
                          </>
                        )}
                        <td>{quantityText(row.quantity)}</td>
                        {detailed && (
                          <>
                            <td>{quantityText(row.unitCost)}</td>
                            <td>{quantityText(row.costValue)}</td>
                          </>
                        )}
                        <td className={row.lowStock ? 'inventory-low' : undefined}>
                          {row.lowStock
                            ? `Tồn thấp · mức tối thiểu ${quantityText(row.minStock)}`
                            : 'Đủ mức tối thiểu'}
                        </td>
                      </tr>
                    ))}
                    {!pageRows.length && (
                      <tr>
                        <td colSpan={columnCount}>
                          {allRows.length
                            ? labelUi('Không có dòng nào khớp tìm kiếm hoặc bộ lọc tồn thấp.')
                            : labelUi(
                                'Chưa có số liệu phù hợp. Ghi tồn đầu kỳ hoặc phiếu nhập để bắt đầu theo dõi hàng hóa.',
                              )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="domain-toolbar inventory-pager">
                <span>
                  {' '}
                  {rows.length} dòng · Trang {currentPage} / {pageCount}
                </span>
                <div>
                  <button
                    type="button"
                    className="inventory-icon-button"
                    aria-label={labelUi('Trang báo cáo trước')}
                    disabled={currentPage <= 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="inventory-icon-button"
                    aria-label={labelUi('Trang báo cáo sau')}
                    disabled={currentPage >= pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
      <div
        role="tabpanel"
        id={panelId('history')}
        aria-labelledby={tabId('history')}
        hidden={tab !== 'history'}
      >
        <p className="inventory-hint">
          {labelUi(
            'Khoảng ngày và phân trang của lịch sử phiếu độc lập với báo cáo tồn kho. Khi mở tab này, kho đang xem chỉ được áp dụng nếu bạn chưa tự chọn kho khác cho lịch sử.',
          )}
        </p>
        <InventoryDocuments
          kind="all"
          embedded
          contextWarehouseId={historySeed}
          onChanged={() => setVersion((value) => value + 1)}
        />
      </div>
    </div>
  )
}
