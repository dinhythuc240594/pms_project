import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, Power, Trash2, X } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import LegacyOverlay from '../../../pms/components/LegacyOverlay'
import { useChannexQuery } from '../useChannexQuery'
import { uncertainChannelWrite } from '../channelForms'
import { DataState } from './RemoteData'

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 120,
  background: 'rgba(9,24,40,.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
}
const descriptions = {
  activate:
    'Kích hoạt sẽ gửi giá, phòng trống và nhận đặt phòng qua kênh này. Kiểm tra toàn bộ ghép nối trước khi xác nhận.',
  deactivate:
    'Tắt đồng bộ chỉ dừng trao đổi dữ liệu. Phòng trên OTA vẫn có thể đang mở bán; thao tác này không đóng bán.',
  delete:
    'Xóa kết nối và ghép nối của kênh đang tắt. Thao tác này không xóa tài khoản OTA và không đóng bán phòng trên OTA.',
}
const titles = {
  activate: 'Kiểm tra & kích hoạt',
  deactivate: 'Tắt đồng bộ',
  delete: 'Xóa kết nối OTA',
}

export default function ChannelLifecycle({
  account,
  property,
  operations,
  item,
  action,
  onClose,
  onSaved,
  onReload,
}) {
  useI18n()
  const pms = usePms()
  const { getChannexChannel, actionChannexChannel } = operations || pms
  const request = useCallback(async () => {
    const detail = await getChannexChannel(account.id, property.id, item.id)
    if (action === 'activate')
      return {
        ...detail,
        readiness: await actionChannexChannel(account.id, property.id, item.id, 'readiness', {
          revision: detail.channel.revision,
        }),
      }
    return detail
  }, [getChannexChannel, actionChannexChannel, account.id, property.id, item.id, action])
  const query = useChannexQuery(request)
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false)
  const mounted = useRef(true),
    working = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const close = () => {
    if (!working.current) onClose()
  }
  const channel = query.data?.channel
  const loadingBookings = action === 'load_bookings'
  const title = loadingBookings ? tUi('channels.onboarding.loadAction') : titles[action]
  const ready =
    action === 'activate'
      ? query.data?.readiness?.ready === true
      : !loadingBookings || channel?.supportsLoadFutureReservations === true
  async function submit(event) {
    event.preventDefault()
    if (working.current || uncertain || !confirmed || !ready || !channel?.editable) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      const result = await actionChannexChannel(account.id, property.id, item.id, action, {
        revision: channel.revision,
        confirm: true,
      })
      if (mounted.current) {
        if (result.pending) setUncertain('pending')
        else
          onSaved(
            loadingBookings
              ? tUi(
                  result.job?.status === 'succeeded'
                    ? 'channels.onboarding.requestedBefore'
                    : 'channels.onboarding.queued',
                )
              : action === 'activate'
                ? 'Đã yêu cầu kích hoạt kênh OTA.'
                : action === 'delete'
                  ? 'Đã xóa kết nối kênh OTA.'
                  : 'Đã yêu cầu tắt đồng bộ kênh OTA. Kiểm tra mở bán trực tiếp tại OTA.',
          )
      }
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message || 'Chưa hoàn tất thao tác.')
        setUncertain(uncertainChannelWrite(failure))
      }
    } finally {
      working.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <LegacyOverlay title={title} onClose={close} style={overlayStyle}>
      <div className="channex-editor">
        <div className="channex-editor-heading">
          <span className="channex-editor-icon">
            <AlertTriangle size={21} aria-hidden="true" />
          </span>
          <div>
            <h2>{title}</h2>
            <p>
              {item.name || item.code} · {property.name}
            </p>
          </div>
          <button
            type="button"
            className="manager-icon-button"
            aria-label={labelUi('Đóng xác nhận kênh OTA')}
            disabled={busy}
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <DataState query={query} label="điều kiện kết nối">
          <form onSubmit={submit}>
            <p className="channex-editor-hint">
              <AlertTriangle size={16} aria-hidden="true" />
              {loadingBookings ? tUi('channels.onboarding.loadDescription') : descriptions[action]}
            </p>
            {error && (
              <div className="channex-editor-error" role="alert">
                <p>{error}</p>
                {!uncertain && (
                  <button type="button" className="manager-button" onClick={onReload}>
                    {labelUi('Đóng & tải lại kênh')}
                  </button>
                )}
              </div>
            )}
            {uncertain && (
              <div className="channex-editor-error" role="status">
                <p>
                  {uncertain === 'pending'
                    ? labelUi(
                        'Channex đã nhận yêu cầu và đang xử lý. Tải lại để kiểm tra trạng thái trước khi gửi thêm thao tác.',
                      )
                    : labelUi('Kết quả chưa xác định. Tải lại kênh trước khi gửi yêu cầu khác.')}
                </p>
                <button type="button" className="manager-button" onClick={onReload}>
                  {labelUi('Đóng & tải lại')}
                </button>
              </div>
            )}
            {action === 'activate' && (
              <div className="channex-channel-readiness">
                {ready ? (
                  <p className="channex-status channex-status--active">
                    {labelUi('Đủ điều kiện kích hoạt')}
                  </p>
                ) : (
                  <>
                    <h3>{labelUi('Chưa thể kích hoạt')}</h3>
                    <ul>
                      {(
                        query.data?.readiness?.issues || ['Cần kiểm tra lại cấu hình và ghép nối.']
                      ).map((issue, index) => (
                        <li key={index}>{issue}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {!channel?.editable && (
              <p className="channex-editor-error">
                {labelUi('Kết nối dùng chung nhiều khách sạn: chỉ xem.')}
              </p>
            )}
            {loadingBookings && !ready && (
              <p className="channex-editor-error">{tUi('channels.onboarding.unsupported')}</p>
            )}
            <label className="channex-channel-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || uncertain || !ready}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                {loadingBookings
                  ? tUi('channels.onboarding.loadConfirmation')
                  : labelUi('Tôi đã kiểm tra ghép nối và hiểu tác động của thao tác này.')}
              </span>
            </label>
            <div className="channex-editor-actions">
              <button type="button" className="manager-button" disabled={busy} onClick={close}>
                {tUi('common.cancel')}
              </button>
              <button
                type="submit"
                className={`manager-button ${action === 'delete' ? 'channex-channel-danger' : 'manager-button-primary'}`}
                disabled={busy || uncertain || !confirmed || !ready || !channel?.editable}
              >
                {action === 'delete' ? (
                  <Trash2 size={15} aria-hidden="true" />
                ) : loadingBookings ? (
                  <Download size={15} aria-hidden="true" />
                ) : (
                  <Power size={15} aria-hidden="true" />
                )}
                {busy ? labelUi('Đang xử lý…') : title}
              </button>
            </div>
          </form>
        </DataState>
      </div>
    </LegacyOverlay>
  )
}
