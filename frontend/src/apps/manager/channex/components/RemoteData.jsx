import { tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Link2,
  Unlink,
} from 'lucide-react'
import {
  errorScreens,
  errorStatus,
  readableErrorMessage,
} from '../../../../shared/components/errorStatus'

export function EmptyState({ title, children }) {
  useI18n()
  return (
    <div className="channex-state" role="status">
      <span className="channex-state-icon">
        <Inbox size={24} aria-hidden="true" />
      </span>
      <h3>{labelUi(title)}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}

export function DataState({ query, label, children }) {
  useI18n()
  if (query.loading)
    return (
      <div className="channex-loading" role="status" aria-label={`Đang tải ${label}`}>
        <span />
        <span />
        <span />
      </div>
    )
  if (query.error)
    return (
      <div className="channex-state channex-error" role="alert">
        <AlertCircle size={24} aria-hidden="true" />
        <h3>
          {labelUi('Chưa tải được')} {labelUi(label)}
        </h3>
        <p>
          {readableErrorMessage(
            query.error.message,
            errorScreens[errorStatus(query.error)]?.description || 'Vui lòng thử lại sau.',
          )}
        </p>
        <button type="button" className="manager-button" onClick={query.refresh}>
          {labelUi('Thử tải lại')}
        </button>
      </div>
    )
  return children
}

export function TableWrap({ label, children }) {
  return (
    <div
      className="manager-table-wrap"
      role="region"
      aria-label={`${label}, có thể cuộn ngang`}
      tabIndex={0}
    >
      {children}
    </div>
  )
}

export function Pagination({ pagination, page, setPage, count, loading }) {
  const totalPages = Math.max(page, pagination?.totalPages || 1)
  return (
    <div className="channex-pagination">
      <span role="status">
        {labelUi('Trang')} {page}
        {pagination ? ` / ${totalPages}` : ''}
        {count != null ? ` · ${count} bản ghi` : ''}
        {pagination?.totalItems != null ? ` / ${pagination.totalItems}` : ''}
      </span>
      <div className="channex-actions">
        <button
          type="button"
          className="manager-button"
          disabled={loading || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={15} aria-hidden="true" />
          {labelUi('Trang trước')}
        </button>
        <button
          type="button"
          className="manager-button"
          disabled={loading || page >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          {labelUi('Trang sau')}
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export function RemoteId({ id }) {
  return (
    <details className="channex-remote-id">
      <summary>{labelUi('Mã Channex')}</summary>
      <code>{id}</code>
    </details>
  )
}

export function LocalHotelLinks({ hotel }) {
  if (!hotel)
    return (
      <span className="channex-local-status">
        <Unlink size={14} aria-hidden="true" />
        {labelUi('Chưa liên kết LOHA')}
      </span>
    )
  const path = `/manager/channex?hotel=${encodeURIComponent(hotel.tenantId)}`
  return (
    <div className="channex-local-link">
      <span className="channex-local-status channex-local-status--linked">
        <Link2 size={14} aria-hidden="true" />
        <strong>{hotel.name}</strong>
      </span>
      <div className="channex-actions channex-local-actions">
        <Link to={path}>
          {labelUi('Quản lý & đồng bộ PMS')}
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
        <Link to={path + '&tab=history'}>
          {labelUi('Lịch sử đồng bộ')}
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
