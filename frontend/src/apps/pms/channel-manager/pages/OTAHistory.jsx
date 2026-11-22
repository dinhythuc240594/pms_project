import DateInput from '../../../../shared/components/DateInput.jsx';
import { formatDate, formatDateTime } from '../../../../shared/lib/date.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock3, Download, History, Info, Link2, RefreshCw, RotateCcw, Upload } from 'lucide-react';
import { usePms } from '../../data/usePms';
import { useChannels } from '../useChannels';
import { channelHistoryFilters, channelHistoryPath, channelHistoryReducer, createChannelHistory } from '../jobHistory';
import { bookingReviewAmount, bookingReviewStay, channelErrorMessage, channelJobLabel, channelJobStatuses, channelJobSuccessMessage, syncBlockReason } from '../presentation';
import { BookingReviewResolver, ChannelIncidents } from './OTAExceptions';
import { channelCompletionAccess } from '../integration';
import '../ChannelManager.css';

const statuses = channelJobStatuses;
const jobIcons = { push_ari: Upload, pull_bookings: Download, load_bookings: Download, ack_revision: CheckCircle2, setup_webhook: Link2, pause_mapping: Link2 };
const jobKinds = { push_ari: 'Cập nhật giá & phòng trống', pull_bookings: 'Nhận & xử lý cập nhật đặt phòng', load_bookings: 'Yêu cầu tải đặt phòng cũ', ack_revision: 'Xác nhận đã nhận đặt phòng', setup_webhook: 'Thiết lập webhook', pause_mapping: 'Đóng bán & tạm dừng ghép nối' };
export default function OTAHistory() {
  const pms = usePms();
  return <HistoryWorkspace key={`${pms.tenantId}:${pms.user?.id}`} pms={pms} />;
}
export function HistoryWorkspace({ pms, ...props }) {
  return <HistoryContent key={`${pms.tenantId}:${pms.user?.id}`} pms={pms} {...props} />;
}
function HistoryContent({ pms, connectionPath = '/id/ota', historyPath = '/id/ota-history', embedded = false, query: sharedQuery }) {
  useI18n();
  const localQuery = useChannels(pms.requestTenant, pms.tenantId, '/channels', !sharedQuery);
  const query = sharedQuery || localQuery;
  const [historyState, changeHistory] = useReducer(channelHistoryReducer, undefined, createChannelHistory);
  const sharedRevision = sharedQuery?.revision;
  const observedSharedRevision = useRef(sharedRevision);
  const [filters, setFilters] = useState({ ...channelHistoryFilters });
  const [retryingId, setRetryingId] = useState(null), [selectedId, setSelectedId] = useState(null);
  const viewAccess = pms.access('channels.view', 'OTA_SYNC', false);
  const history = useChannels(pms.requestTenant, pms.tenantId, channelHistoryPath(historyState), viewAccess.allowed, historyState.revision);
  const jobDetails = useChannels(pms.requestTenant, pms.tenantId, `/channels/jobs/${encodeURIComponent(selectedId || '')}`, Boolean(selectedId) && viewAccess.allowed, historyState.revision);
  const historyPagination = history.data?.pagination;
  const [reviewPage, setReviewPage] = useState(1);
  const [resolvingReview, setResolvingReview] = useState(null);
  const reviews = useChannels(pms.requestTenant, pms.tenantId, `/channels/booking-reviews?page=${reviewPage}&pageSize=25`, true, query.revision);
  const reviewRows = reviews.data?.items || [];
  const pagination = reviews.data?.pagination;
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const active = useRef(true), inFlight = useRef(false), errorNotice = useRef(null), successNotice = useRef(null), detailsTrigger = useRef(null);
  const writeAccess = pms.access('channels.write', 'OTA_SYNC', true);
  const canResolveReview = channelCompletionAccess(pms, writeAccess);
  const accessMessage = writeAccess.reason === 'role' ? 'Bạn đang ở chế độ chỉ xem. Chủ khách sạn có thể cấu hình và đồng bộ OTA.' : writeAccess.message;
  const rows = history.data?.items || [];
  const hasFilters = Object.values(historyState.filters).some(Boolean);
  const busy = retryingId !== null;
  const displayTime = value => value ? formatDateTime(value, pms.settings.timezone) : '—';
  const displayDate = value => formatDate(value);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (error) errorNotice.current?.focus(); else if (message) successNotice.current?.focus(); }, [error, message]);
  useEffect(() => {
    if (sharedRevision === undefined || observedSharedRevision.current === sharedRevision) return;
    observedSharedRevision.current = sharedRevision;
    changeHistory({ type: 'refresh' });
  }, [sharedRevision]);
  function refreshQueries() { if (!sharedQuery) changeHistory({ type: 'refresh' }); query.refresh(); reviews.refresh(); }
  function refresh() { setError(''); setMessage(''); refreshQueries(); }
  function applyFilters(event) { event.preventDefault(); setSelectedId(null); changeHistory({ type: 'filter', filters }); }
  function clearFilters() { setFilters({ ...channelHistoryFilters }); setSelectedId(null); changeHistory({ type: 'filter', filters: channelHistoryFilters }); }
  function setFilter(key, value) { setFilters(previous => ({ ...previous, [key]: value })); }
  function closeDetails() { setSelectedId(null); detailsTrigger.current?.focus(); }
  async function retry(row) {
    if (inFlight.current || !writeAccess.allowed || syncBlockReason(query.data?.connection, query.data?.mappings || [], row.kind)) return;
    inFlight.current = true; setRetryingId(row.id); setError(''); setMessage('');
    try {
      await pms.requestTenant('/channels/jobs/' + encodeURIComponent(row.id) + '/retry', { method: 'POST', body: {} });
      if (active.current) { setMessage('Đã xếp hàng thử lại. Tải lại lịch sử để xem kết quả sau khi yêu cầu được xử lý.'); refreshQueries(); }
    } catch (err) { if (active.current) setError(err.message); }
    finally { inFlight.current = false; if (active.current) setRetryingId(null); }
  }
  return <div className={`ota-page ota-history${embedded ? ' ota-page--embedded' : ''}`}>
    <header className="ota-page-header">
      <div>{!embedded && <p className="ota-eyebrow">{labelUi("PHÂN PHỐI & BÁN PHÒNG")}</p>}{embedded ? <h2>{labelUi("Lịch sử đồng bộ")}</h2> : <h1>{labelUi("Lịch sử đồng bộ")}</h1>}<p>{labelUi("Theo dõi yêu cầu trao đổi giá, phòng trống và đặt phòng với Channex.")}</p></div>
      <div className="ota-page-actions"><button type="button" className="ota-button ota-button--secondary" disabled={busy || query.loading || history.loading || reviews.loading} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />{query.loading || history.loading || reviews.loading ? tUi("common.loading") : labelUi("Tải lại lịch sử")}</button></div>
    </header>
    {!embedded && <nav className="ota-tabs" aria-label={tUi("nav.channelManagement")}>
      <Link className="ota-tab" to={connectionPath}><Link2 size={16} aria-hidden="true" />{connectionPath === '/id/ota' ? labelUi("Kênh OTA") : labelUi("Kết nối Channex")}</Link>
      <Link className="ota-tab is-active" to={historyPath} aria-current="page"><Clock3 size={16} aria-hidden="true" />{labelUi("Lịch sử đồng bộ")}</Link>
    </nav>}
    {error && <div ref={errorNotice} tabIndex={-1} className="ota-notice ota-notice--error" role="alert"><AlertCircle size={18} aria-hidden="true" /><div><strong>{labelUi("Chưa thể thử lại yêu cầu")}</strong><p>{error}</p></div></div>}
    {message && <div ref={successNotice} tabIndex={-1} className="ota-notice ota-notice--success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><p>{message}</p></div>}
    {!writeAccess.allowed && <div className="ota-notice ota-notice--info" role="status"><Info size={18} aria-hidden="true" /><p>{accessMessage}</p></div>}
    <ChannelIncidents pms={pms} refreshKey={query.revision} />
    {resolvingReview && <BookingReviewResolver key={resolvingReview.id} pms={pms} review={resolvingReview} onClose={() => setResolvingReview(null)} onResolved={() => { setResolvingReview(null); setMessage('Đã lưu đối soát. Xác nhận sẽ gửi sau khi transaction hoàn tất.'); refreshQueries(); }} />}
    <section className="ota-panel" aria-labelledby="ota-review-title">
      <div className="ota-section-header"><div><h2 id="ota-review-title">{labelUi("Đặt phòng cần xử lý")}</h2><p>{labelUi("PMS chưa áp dụng các cập nhật này. Đối soát dữ liệu và tồn phòng trước khi thử lại; hệ thống không tự thử lại.")}</p>{reviewRows.length > 0 && <p className="ota-review-scroll-hint">{tUi('channels.review.scrollHint')}</p>}</div>{pagination && <span className="ota-history-count" role="status">{tUi('channels.review.count', { count: pagination.totalItems })}</span>}</div>
      {reviews.loading ? <div className="ota-state" role="status"><RefreshCw size={24} aria-hidden="true" /><p>{labelUi("Đang tải đặt phòng cần xử lý…")}</p></div>
        : reviews.error ? <div className="ota-state" role="alert"><h3>{labelUi("Chưa tải được đặt phòng cần xử lý")}</h3><p>{reviews.error}</p><button type="button" className="ota-button ota-button--secondary" onClick={reviews.refresh}>{labelUi("Thử tải lại")}</button></div>
        : !reviewRows.length ? <div className="ota-state"><CheckCircle2 size={24} aria-hidden="true" /><p>{reviewPage > 1 ? labelUi("Trang này không còn đặt phòng cần xử lý. Chọn trang trước để tiếp tục.") : labelUi("Không có đặt phòng đang chờ đối soát.")}</p></div>
        : <div className="ota-table-scroll" tabIndex={0} role="region" aria-label={labelUi("Đặt phòng cần xử lý, có thể cuộn ngang")}>
          <table className="ota-table ota-review-table" aria-label={labelUi("Đặt phòng Channex chưa được áp dụng vào PMS")}><thead><tr><th scope="col">{labelUi("Đặt phòng")}</th><th scope="col">{labelUi("Kỳ lưu trú & giá trị")}</th><th scope="col">{labelUi("Nguyên nhân")}</th><th scope="col">{tUi('common.actions')}</th></tr></thead><tbody>{reviewRows.map(row => {
            const details = row.details || {};
            const blocked = syncBlockReason(query.data?.connection, query.data?.mappings || [], 'pull_bookings');
            const pending = ['queued', 'processing'].includes(row.jobStatus);
            return <tr key={row.id}>
              <td><strong>{details.bookingCode || row.bookingId || labelUi("Chưa có mã đặt phòng")}</strong>{details.source && <small className="ota-cell-meta">Kênh: {details.source}</small>}<small className="ota-cell-meta">Mã Channex: {row.bookingId || '—'}</small><small className="ota-cell-meta">Mã cập nhật: {row.revisionId}</small><small className="ota-cell-meta">{({ new: 'Đặt phòng mới', modified: 'Thay đổi đặt phòng', cancelled: 'Hủy đặt phòng' })[row.providerStatus] || labelUi("Cập nhật đặt phòng")} · {displayTime(row.revisionAt || row.createdAt)}</small></td>
              <td><span>{bookingReviewStay(details)}</span><small className="ota-cell-meta">{bookingReviewAmount(details)}</small>{details.rooms?.length > 0 && <details className="ota-review-rooms"><summary>{tUi('channels.review.rooms', { count: details.rooms.length })}</summary><ul>{details.rooms.map((room, index) => <li key={index}><span>{tUi('channels.review.roomType', { id: room.roomTypeId || '—' })}</span><span>{tUi('channels.review.ratePlan', { id: room.ratePlanId || '—' })}</span>{room.occupancy && <span>{tUi('channels.review.occupancy', { adults: room.occupancy.adults ?? '—', children: room.occupancy.children ?? '—', infants: room.occupancy.infants ?? '—' })}</span>}</li>)}</ul></details>}</td>
              <td className="ota-result"><span className="ota-status ota-status--needs_review">{labelUi("Cần xử lý")}</span><p>{channelErrorMessage(row.errorCode)}</p>{pending && <small className="ota-cell-meta">{labelUi("Đã xếp hàng kiểm tra lại theo yêu cầu.")}{" "}{tUi('channels.refreshHint')}</small>}</td>
              <td>{writeAccess.allowed && row.jobId ? <div className="ota-retry-action"><button type="button" className="ota-button ota-button--secondary ota-button--small" disabled={busy || pending || Boolean(blocked) || query.loading} aria-describedby={blocked ? `ota-review-retry-${row.id}` : undefined} onClick={() => retry({ id: row.jobId, kind: 'pull_bookings' })}><RotateCcw size={14} aria-hidden="true" />{retryingId === row.jobId ? labelUi("Đang gửi…") : pending ? labelUi("Đã xếp hàng") : labelUi("Thử lại sau khi xử lý")}</button>{blocked && <small className="ota-cell-meta" id={`ota-review-retry-${row.id}`}>{blocked}</small>}</div> : <span className="ota-cell-meta">{writeAccess.allowed ? labelUi("Nhờ quản trị viên kiểm tra tác vụ gốc.") : labelUi("Chỉ xem")}</span>}{canResolveReview && !['SUPER_ADMIN', 'SYSTEM_MANAGER'].includes(pms.user?.globalRole) && <button type="button" className="ota-button ota-button--secondary ota-button--small" disabled={busy || pending} onClick={() => setResolvingReview(row)}>Đối soát với booking PMS</button>}</td>
            </tr>;
          })}</tbody></table>
        </div>}
      {pagination && <footer className="ota-history-footer ota-review-pagination"><span role="status">{tUi('channels.review.page', { page: pagination.page, pages: Math.max(1, pagination.totalPages), count: pagination.totalItems })}</span><nav aria-label={labelUi("Phân trang đặt phòng cần xử lý")}><button type="button" className="ota-button ota-button--secondary ota-button--small" disabled={busy || reviews.loading || reviewPage <= 1} onClick={() => setReviewPage(page => page - 1)}>{labelUi("Trang trước")}</button><button type="button" className="ota-button ota-button--secondary ota-button--small" disabled={busy || reviews.loading || reviewPage >= pagination.totalPages} onClick={() => setReviewPage(page => page + 1)}>{labelUi("Trang sau")}</button></nav></footer>}
    </section>
    <section className="ota-panel" aria-labelledby="ota-history-title">
      <div className="ota-section-header">
        <div><h2 id="ota-history-title">{labelUi("Lịch sử yêu cầu đồng bộ")}</h2><p>{labelUi("Tìm trong toàn bộ lịch sử của khách sạn. Ngày tạo theo múi giờ")} {pms.settings.timezone}.</p></div>
        {historyPagination && <span className="ota-history-count" role="status">{historyPagination.totalItems} {labelUi("yêu cầu")}</span>}
      </div>
      <form className="ota-history-filters" onSubmit={applyFilters} aria-label={labelUi("Bộ lọc lịch sử đồng bộ")}>
        <label className="ota-field" htmlFor="ota-history-status">{tUi("common.status")}<select id="ota-history-status" value={filters.status} onChange={event => setFilter('status', event.target.value)}><option value="">{tUi("common.allStatuses")}</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{labelUi(label)}</option>)}</select></label>
        <label className="ota-field" htmlFor="ota-history-kind">{labelUi("Loại yêu cầu")}<select id="ota-history-kind" value={filters.kind} onChange={event => setFilter('kind', event.target.value)}><option value="">{labelUi("Tất cả loại yêu cầu")}</option>{Object.entries(jobKinds).map(([value, label]) => <option key={value} value={value}>{labelUi(label)}</option>)}</select></label>
        <label className="ota-field" htmlFor="ota-history-date-from">{labelUi("Ngày tạo từ")}<DateInput id="ota-history-date-from" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={value => setFilter('dateFrom', value)} /></label>
        <label className="ota-field" htmlFor="ota-history-date-to">{labelUi("Đến hết ngày")}<DateInput id="ota-history-date-to" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={value => setFilter('dateTo', value)} /></label>
        <label className="ota-field" htmlFor="ota-history-revision">{labelUi("Mã cập nhật (chính xác)")}<input id="ota-history-revision" type="text" value={filters.revisionId} onChange={event => setFilter('revisionId', event.target.value)} placeholder={labelUi("Revision ID")} /></label>
        <div className="ota-history-filter-actions"><button type="submit" className="ota-button ota-button--primary" disabled={!viewAccess.allowed}>{labelUi("Áp dụng bộ lọc")}</button><button type="button" className="ota-button ota-button--secondary" onClick={clearFilters}>{labelUi("Xóa bộ lọc")}</button></div>
      </form>
      {!viewAccess.allowed ? <div className="ota-state" role="status"><Info size={24} aria-hidden="true" /><p>{viewAccess.message || labelUi('Bạn chưa có quyền xem lịch sử đồng bộ.')}</p></div>
        : history.loading ? <div className="ota-state ota-state--loading" role="status"><span className="ota-state-icon"><RefreshCw size={24} aria-hidden="true" /></span><h3>{labelUi("Đang tải lịch sử đồng bộ")}</h3><p>{labelUi("Đang tìm yêu cầu theo bộ lọc của khách sạn.")}</p></div>
        : history.error ? <div className="ota-state" role="alert"><span className="ota-state-icon"><AlertCircle size={24} aria-hidden="true" /></span><h3>{labelUi("Chưa tải được lịch sử")}</h3><p>{history.error}</p><button type="button" className="ota-button ota-button--secondary" onClick={refresh}>{labelUi("Thử tải lại")}</button></div>
        : !rows.length ? <div className="ota-state ota-state--empty"><span className="ota-state-icon"><History size={26} aria-hidden="true" /></span><h3>{hasFilters ? labelUi('Không có yêu cầu phù hợp') : labelUi('Chưa có lịch sử đồng bộ')}</h3><p>{hasFilters ? labelUi('Thay đổi ngày, trạng thái, loại yêu cầu hoặc mã cập nhật để tìm lại.') : labelUi('Gửi yêu cầu từ trang kết nối Channex. Quá trình xử lý và kết quả sẽ xuất hiện tại đây.')}</p>{hasFilters ? <button type="button" className="ota-button ota-button--secondary" onClick={clearFilters}>{labelUi("Xóa bộ lọc")}</button> : <Link className="ota-button ota-button--secondary" to={connectionPath}>{labelUi("Mở kết nối Channex")}</Link>}</div>
        : <div className="ota-table-scroll" tabIndex={0} role="region" aria-label={labelUi("Bảng lịch sử đồng bộ, có thể cuộn ngang")}>
          <table className="ota-table" aria-label={labelUi("Danh sách yêu cầu đồng bộ")}><thead><tr><th scope="col">{labelUi("Yêu cầu đồng bộ")}</th><th scope="col">{labelUi("Ngày tạo")}</th><th scope="col">{labelUi("Khoảng ngày")}</th><th scope="col">{tUi("common.status")}</th><th scope="col">{labelUi("Số lần xử lý")}</th><th scope="col">{labelUi("Kết quả")}</th><th scope="col">{tUi("common.actions")}</th></tr></thead><tbody>{rows.map(row => {
            const Icon = jobIcons[row.kind] || RefreshCw;
            const blocked = syncBlockReason(query.data?.connection, query.data?.mappings || [], row.kind);
            return <tr key={row.id}>
              <td><div className="ota-job-type"><span className="ota-job-icon"><Icon size={18} aria-hidden="true" /></span><strong>{channelJobLabel(row)}</strong></div>{row.revisionId && <small className="ota-cell-meta">Mã cập nhật: {row.revisionId}</small>}</td>
              <td><time dateTime={row.createdAt}>{displayTime(row.createdAt)}</time></td>
              <td>{row.start && row.end ? <><span>{displayDate(row.start)} → {displayDate(row.end)}</span><small className="ota-cell-meta">{labelUi("Không gồm ngày kết thúc")}</small></> : <span className="ota-cell-meta">{labelUi("Không áp dụng khoảng ngày")}</span>}</td>
              <td><span className={`ota-status ota-status--${Object.hasOwn(statuses, row.status) ? row.status : 'queued'}`}><span className="ota-status-dot" aria-hidden="true" />{statuses[row.status] || labelUi("Chưa rõ trạng thái")}</span></td>
              <td>{row.attempts} lần</td>
              <td className={`ota-result${row.status === 'failed' ? ' ota-result--error' : ''}`}>{row.errorCode ? <>{channelErrorMessage(row.errorCode)}{row.status === 'queued' && <small className="ota-cell-meta">{labelUi("Đã xếp hàng thử lại")}</small>}{row.status === 'needs_review' && <small className="ota-cell-meta">{labelUi("Xem danh sách đặt phòng cần xử lý ở trên. Hệ thống không tự thử lại.")}</small>}</> : row.status === 'succeeded' ? channelJobSuccessMessage(row) : row.status === 'processing' ? labelUi('Đang trao đổi dữ liệu với Channex') : labelUi('Chờ đến lượt xử lý')}{row.completedAt && <small className="ota-cell-meta">{labelUi("Kết thúc")} {displayTime(row.completedAt)}</small>}</td>
              <td><div className="ota-history-row-actions"><button type="button" className="ota-button ota-button--secondary ota-button--small" aria-expanded={selectedId === row.id} aria-controls="ota-job-details" onClick={event => { detailsTrigger.current = event.currentTarget; setSelectedId(selectedId === row.id ? null : row.id); }}>{labelUi("Chi tiết")}</button>{row.status === 'failed' && writeAccess.allowed && <div className="ota-retry-action"><button type="button" className="ota-button ota-button--secondary ota-button--small" disabled={busy || query.loading || Boolean(blocked)} aria-describedby={blocked ? `ota-retry-${row.id}` : undefined} onClick={() => retry(row)}><RotateCcw size={14} aria-hidden="true" />{retryingId === row.id ? labelUi("Đang gửi…") : tUi("common.retry")}</button>{blocked && <small className="ota-cell-meta" id={`ota-retry-${row.id}`}>{blocked}</small>}</div>}</div></td>
            </tr>;
          })}</tbody></table>
        </div>}
      {selectedId && viewAccess.allowed && <JobHistoryDetails key={selectedId} query={jobDetails} displayTime={displayTime} onClose={closeDetails} />}
      {historyPagination && <footer className="ota-history-footer ota-review-pagination"><span role="status">Trang {historyPagination.page} / {Math.max(1, historyPagination.totalPages)} · {historyPagination.totalItems} yêu cầu</span><nav aria-label="Phân trang lịch sử đồng bộ"><button type="button" className="ota-button ota-button--secondary ota-button--small" disabled={busy || history.loading || historyState.index <= 0} onClick={() => { setSelectedId(null); changeHistory({ type: 'previous' }); }}>Trang trước</button><button type="button" className="ota-button ota-button--secondary ota-button--small" disabled={busy || history.loading || !historyPagination.nextCursor || !historyPagination.currentCursor} onClick={() => { setSelectedId(null); changeHistory({ type: 'next', index: historyState.index, currentCursor: historyPagination.currentCursor, nextCursor: historyPagination.nextCursor }); }}>Trang sau</button></nav></footer>}
      {history.data && <footer className="ota-history-footer"><Info size={15} aria-hidden="true" /><p>Yêu cầu mới xuất hiện khi tải lại lịch sử. Các yêu cầu đang chờ sẽ được xử lý lần lượt. {tUi('channels.refreshHint')}</p></footer>}
    </section>
  </div>;
}

function JobHistoryDetails({ query, displayTime, onClose }) {
  const row = query.data;
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section id="ota-job-details" className="ota-job-details" aria-labelledby="ota-job-details-title">
    <div className="ota-section-header"><h3 id="ota-job-details-title" tabIndex={-1} ref={heading}>Chi tiết yêu cầu đồng bộ</h3><button type="button" className="ota-button ota-button--secondary ota-button--small" onClick={onClose}>Đóng chi tiết</button></div>
    {query.loading ? <p className="ota-state" role="status">Đang tải chi tiết yêu cầu…</p>
      : query.error ? <div className="ota-state" role="alert"><p>{query.error}</p><button type="button" className="ota-button ota-button--secondary" onClick={query.refresh}>{labelUi("Thử tải lại")}</button></div>
      : row && <dl className="ota-job-details-fields">
        <div><dt>Mã yêu cầu</dt><dd>{row.id}</dd></div>
        <div><dt>Loại yêu cầu</dt><dd>{channelJobLabel(row)}</dd></div>
        <div><dt>{tUi('common.status')}</dt><dd>{labelUi(statuses[row.status] || 'Chưa rõ trạng thái')}</dd></div>
        <div><dt>Mã cập nhật</dt><dd>{row.revisionId || '—'}</dd></div>
        <div><dt>Ngày tạo</dt><dd>{displayTime(row.createdAt)}</dd></div>
        <div><dt>Có thể xử lý từ</dt><dd>{displayTime(row.availableAt)}</dd></div>
        <div><dt>Hoàn tất</dt><dd>{displayTime(row.completedAt)}</dd></div>
        <div><dt>Số lần xử lý</dt><dd>{row.attempts}</dd></div>
        <div><dt>Kết quả</dt><dd>{row.errorCode ? channelErrorMessage(row.errorCode) : row.status === 'succeeded' ? channelJobSuccessMessage(row) : row.status === 'processing' ? labelUi("Đang trao đổi dữ liệu với Channex") : labelUi("Chờ đến lượt xử lý")}</dd></div>
      </dl>}
  </section>;
}
