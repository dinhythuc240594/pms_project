import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Clock3, Info, Link2, Settings2, ShieldCheck } from 'lucide-react'
import { usePms } from '../../data/usePms'
import ChannelsView from '../../../manager/channex/components/ChannelsView'
import { airbnbReturn } from '../../../manager/channex/airbnbReturn'
import { useChannels } from '../useChannels'
import { clientChannelOperations } from '../clientChannelOperations'
import { connectionStatus } from '../presentation'
import '../../../manager/channex/pages/ManagerChannex.css'
import '../ChannelManager.css'
import './ClientChannels.css'

export default function ClientChannels({ embedded = false }) {
  const pms = usePms()
  return (
    <ClientChannelWorkspace
      key={`${pms.tenantId}:${pms.authGeneration}`}
      pms={pms}
      embedded={embedded}
    />
  )
}

export function ClientChannelWorkspace({
  pms,
  embedded,
  query: sharedQuery,
  settingsPath = '/id/settings?section=channels&tab=connection',
  historyPath = '/id/settings?section=channels&tab=history',
}) {
  useI18n()
  const { requestTenant, tenantId } = pms
  const localQuery = useChannels(requestTenant, tenantId, '/channels', !sharedQuery)
  const query = sharedQuery || localQuery
  const operations = useMemo(() => clientChannelOperations(requestTenant), [requestTenant])
  const [callback] = useState(() => airbnbReturn(window.location.search))
  const [, setParams] = useSearchParams()
  const callbackCleaned = useRef(false)
  const [oauth, setOauth] = useState(null),
    [retry, setRetry] = useState(0)
  const [channelMessage, setChannelMessage] = useState('')
  const access = pms.access('channels.write', 'OTA_SYNC', true),
    canWrite = access.allowed
  const canOpenSettings = embedded || pms.routeAccess?.('/id/settings').allowed
  const connection = query.data?.connection,
    status = connectionStatus(connection)
  useEffect(() => {
    if (!callback || callbackCleaned.current) return
    callbackCleaned.current = true
    const clean = new URLSearchParams(callback.cleanSearch)
    clean.set('tab', 'channels')
    setParams(clean, { replace: true })
  }, [callback, setParams])
  useEffect(() => {
    if (callback?.kind !== 'success' || !canWrite) return
    let current = true
    requestTenant('/channels/remote/airbnb-confirm', {
      method: 'POST',
      body: { channelId: callback.channelId, token: callback.token },
    })
      .then((result) => {
        if (result.channel?.id !== callback.channelId)
          throw new Error(
            'Thông tin xác nhận Airbnb chưa hợp lệ. Tải lại danh sách kênh để kiểm tra.',
          )
        if (current) setOauth({ confirmed: true })
      })
      .catch((error) => {
        if (current) setOauth({ error })
      })
    return () => {
      current = false
    }
  }, [callback, canWrite, requestTenant, retry])
  const oauthPending = callback?.kind === 'success' && canWrite && !oauth
  return (
    <div className="ota-page client-channels">
      <header className="ota-page-header">
        <div>
          {embedded ? (
            <h2>{labelUi('Kênh OTA')}</h2>
          ) : (
            <>
              <p className="ota-eyebrow">{labelUi('PHÂN PHỐI & BÁN PHÒNG')}</p>
              <h1>{labelUi('Kênh OTA')}</h1>
            </>
          )}
          <p>
            Quản lý Booking.com, Airbnb và các kênh bán của{' '}
            {pms.tenant?.name || labelUi('khách sạn đang chọn')}.
          </p>
        </div>
        {!embedded && canOpenSettings && (
          <div className="ota-page-actions">
            <Link className="ota-button ota-button--secondary" to={settingsPath}>
              <Settings2 size={16} aria-hidden="true" />
              {labelUi('Cài đặt kết nối')}
            </Link>
            <Link className="ota-button ota-button--secondary" to={historyPath}>
              <Clock3 size={16} aria-hidden="true" />
              {labelUi('Lịch sử đồng bộ')}
            </Link>
          </div>
        )}
      </header>
      {!canWrite && (
        <div className="ota-notice ota-notice--info" role="status">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            {access.reason === 'role'
              ? labelUi(
                  'Bạn đang ở chế độ chỉ xem. Chủ khách sạn có thể liên kết và thay đổi kênh OTA.',
                )
              : access.message}
          </span>
        </div>
      )}
      {callback && callback.kind !== 'success' && (
        <div className="ota-notice ota-notice--error" role="alert">
          <Info size={18} aria-hidden="true" />
          <span>
            {callback.kind === 'failure'
              ? labelUi('Chưa hoàn tất cấp quyền Airbnb. Mở lại kết nối để thử lại.')
              : labelUi('Thông tin quay về từ Airbnb chưa hợp lệ. Bắt đầu lại luồng liên kết.')}
          </span>
        </div>
      )}
      {oauth?.error && (
        <div className="ota-notice ota-notice--error" role="alert">
          <Info size={18} aria-hidden="true" />
          <span>{oauth.error.message || labelUi('Chưa xác nhận được cấp quyền Airbnb.')}</span>
          <button
            className="ota-button ota-button--small"
            onClick={() => {
              setOauth(null)
              setRetry((value) => value + 1)
            }}
          >
            {labelUi('Xác nhận lại')}
          </button>
        </div>
      )}
      {oauth?.confirmed && (
        <div className="ota-notice ota-notice--success" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>
            {labelUi(
              'Đã xác nhận quyền Airbnb. Mở cấu hình kênh để ghép listing với gói giá trước khi kích hoạt.',
            )}
          </span>
        </div>
      )}
      {channelMessage && (
        <div className="ota-notice ota-notice--success" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>{channelMessage}</span>
        </div>
      )}
      {query.error && (
        <div className="ota-notice ota-notice--error" role="alert">
          <Info size={18} aria-hidden="true" />
          <span>{query.error}</span>
          <button className="ota-button ota-button--small" onClick={query.refresh}>
            {tUi('common.retry')}
          </button>
        </div>
      )}
      {query.loading || oauthPending ? (
        <div className="ota-state ota-state--loading" role="status">
          <p>
            {oauthPending
              ? labelUi('Đang xác nhận quyền Airbnb…')
              : labelUi('Đang tải kết nối của khách sạn…')}
          </p>
        </div>
      ) : (
        query.data && (
          <>
            <section className="ota-panel">
              <div className="ota-section-header">
                <div className="ota-provider">
                  <span className="ota-provider-logo" aria-hidden="true">
                    <Link2 size={26} />
                  </span>
                  <div>
                    <div className="ota-title-line">
                      <h2>{pms.tenant?.name || labelUi('Khách sạn đang chọn')}</h2>
                      <span className={`ota-status ota-status--${status.tone}`}>
                        <span className="ota-status-dot" />
                        {status.label}
                      </span>
                    </div>
                    <p>
                      {connection?.environment === 'production'
                        ? 'Channex Production'
                        : connection?.environment === 'staging'
                          ? 'Channex Staging'
                          : labelUi('Channex chưa được cấu hình')}
                    </p>
                  </div>
                </div>
              </div>
              {!connection?.credentialsConfigured ? (
                <div className="ota-onboarding">
                  <div>
                    <h3>{labelUi('Thiết lập Channex trước khi liên kết OTA')}</h3>
                    <p>
                      {labelUi(
                        'Mở Kết nối & ghép phòng để liên kết khách sạn, sau đó thêm các kênh bán phòng tại đây.',
                      )}
                    </p>
                    {canOpenSettings && (
                      <Link className="ota-button ota-button--primary" to={settingsPath}>
                        {labelUi('Thiết lập kết nối')}
                      </Link>
                    )}
                  </div>
                </div>
              ) : (
                <ChannelsView
                  account={{ id: tenantId, environment: connection.environment }}
                  property={{
                    id: connection.propertyId,
                    name: pms.tenant?.name || 'Khách sạn đang chọn',
                  }}
                  operations={operations}
                  canWrite={canWrite}
                  onChanged={(text) => {
                    setChannelMessage(text || '')
                    query.refresh()
                  }}
                />
              )}
            </section>
          </>
        )
      )}
    </div>
  )
}
