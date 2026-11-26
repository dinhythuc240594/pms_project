import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useCallback, useState } from 'react'
import {
  Check,
  ChevronRight,
  Download,
  Link2,
  Plus,
  Power,
  RadioTower,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import { useChannexQuery } from '../useChannexQuery'
import { DataState, EmptyState, Pagination, RemoteId } from './RemoteData'
import ChannelEditor from './ChannelEditor'
import ChannelLifecycle from './ChannelLifecycle'

export default function ChannelsView({
  account,
  property,
  operations,
  canWrite = true,
  onChanged,
}) {
  useI18n()
  const pms = usePms()
  const { getChannexRemoteChannels } = operations || pms
  const [page, setPage] = useState(1),
    [dialog, setDialog] = useState(null),
    [message, setMessage] = useState('')
  const request = useCallback(
    () => getChannexRemoteChannels(account.id, property.id, page),
    [getChannexRemoteChannels, account.id, property.id, page],
  )
  const query = useChannexQuery(request, 'channels')
  const rows = query.data?.channels || []
  function open(kind, channel) {
    if (!canWrite && (kind !== 'edit' || !channel)) return
    setMessage('')
    setDialog({ kind, channel })
  }
  function saved(text) {
    setDialog(null)
    setMessage(text)
    query.refresh()
    onChanged?.(text)
  }
  function reload() {
    setDialog(null)
    query.refresh()
    onChanged?.()
  }
  return (
    <section
      className="channex-channels-view"
      aria-label={labelUi('Kênh OTA từ Channex')}
      aria-busy={query.loading}
    >
      <div className="channex-section-heading">
        <div className="channex-actions">
          <button
            type="button"
            className="manager-button channex-refresh"
            disabled={query.loading}
            onClick={query.refresh}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {tUi('common.reload')}
          </button>
          {canWrite && (
            <button
              type="button"
              className="manager-button manager-button-primary"
              onClick={() => open('edit')}
            >
              <Plus size={16} aria-hidden="true" />
              {labelUi('Thêm kênh OTA')}
            </button>
          )}
        </div>
      </div>
      {message && (
        <p className="channex-success" role="status">
          <Check size={16} aria-hidden="true" />
          {message}
        </p>
      )}
      <DataState query={query} label="kênh OTA">
        {!rows.length ? (
          <EmptyState title={labelUi('Chưa kết nối kênh OTA')}>
            {labelUi('Thêm kênh, kiểm tra thông tin và ghép gói giá trước khi kích hoạt.')}
          </EmptyState>
        ) : (
          <ul className="channex-channel-list">
            {rows.map((channel) => (
              <li key={channel.id} className="channex-channel-card">
                <div className="channex-channel-card-heading">
                  <span className="channex-channel-icon">
                    <RadioTower size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <h4>{channel.name || channel.code}</h4>
                    <p>
                      {channel.code}
                      <span>·</span>
                      {channel.currency || labelUi('Chưa xác định tiền tệ')}
                    </p>
                  </div>
                  <span
                    className={`channex-status channex-status--${channel.active ? 'active' : 'neutral'}`}
                  >
                    {channel.active ? labelUi('Đang đồng bộ') : labelUi('Chưa kích hoạt')}
                  </span>
                </div>
                <div className="channex-channel-card-meta">
                  <span>
                    <Link2 size={14} aria-hidden="true" />
                    {channel.mappedRateCount ?? '—'} gói giá đã ghép
                  </span>
                  {channel.propertyCount > 1 && (
                    <span>{channel.propertyCount} khách sạn · chỉ xem</span>
                  )}
                  <RemoteId id={channel.id} />
                </div>
                <div className="channex-channel-card-actions">
                  <button
                    type="button"
                    className="manager-button"
                    onClick={() => open('edit', channel)}
                  >
                    <Settings2 size={15} aria-hidden="true" />
                    {!canWrite || channel.active || channel.propertyCount > 1
                      ? labelUi('Xem cấu hình')
                      : labelUi('Cấu hình & ghép nối')}
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                  {canWrite && channel.propertyCount <= 1 && (
                    <>
                      {channel.supportsLoadFutureReservations && (
                        <button
                          type="button"
                          className="manager-button"
                          onClick={() => open('load_bookings', channel)}
                        >
                          <Download size={15} aria-hidden="true" />
                          {tUi('channels.onboarding.loadAction')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="manager-button"
                        onClick={() => open(channel.active ? 'deactivate' : 'activate', channel)}
                      >
                        <Power size={15} aria-hidden="true" />
                        {channel.active ? labelUi('Tắt đồng bộ') : labelUi('Kiểm tra & kích hoạt')}
                      </button>
                      {!channel.active && (
                        <button
                          type="button"
                          className="manager-icon-button channex-channel-delete"
                          aria-label={`Xóa kênh ${channel.name || channel.code}`}
                          onClick={() => open('delete', channel)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DataState>
      <Pagination
        pagination={query.data?.pagination}
        page={page}
        setPage={setPage}
        count={query.loading || query.error ? null : rows.length}
        loading={query.loading}
      />
      {dialog?.kind === 'edit' && (
        <ChannelEditor
          account={account}
          property={property}
          operations={operations}
          canWrite={canWrite}
          item={dialog.channel}
          onClose={() => setDialog(null)}
          onSaved={saved}
          onReload={reload}
        />
      )}
      {canWrite && dialog && dialog.kind !== 'edit' && (
        <ChannelLifecycle
          account={account}
          property={property}
          operations={operations}
          item={dialog.channel}
          action={dialog.kind}
          onClose={() => setDialog(null)}
          onSaved={saved}
          onReload={reload}
        />
      )}
    </section>
  )
}
