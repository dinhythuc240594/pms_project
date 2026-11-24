import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useSearchParams } from 'react-router-dom'
import { useRef } from 'react'
import {
  ArrowRight,
  BedDouble,
  CheckCircle2,
  Clock3,
  Info,
  LayoutDashboard,
  Link2,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import LinkedChannexTools from '../../../manager/channex/components/LinkedChannexTools'
import { useChannels } from '../useChannels'
import { useRevealActive } from '../../components/useRevealActive'
import { integrationState, integrationTab } from '../integration'
import { connectionStatus } from '../presentation'
import { ChannelWorkspace } from './OTA'
import { HistoryWorkspace } from './OTAHistory'
import { ClientChannelWorkspace } from './ClientChannels'
import '../IntegrationWorkspace.css'

const tabs = [
  ['overview', 'Tổng quan & hướng dẫn', LayoutDashboard],
  ['connection', 'Kết nối & ghép phòng', BedDouble],
  ['channels', 'Kênh bán phòng', Link2],
  ['history', 'Lịch sử đồng bộ', Clock3],
]

export default function IntegrationWorkspace({
  pms,
  basePath = '/id/settings?section=channels',
  embedded = false,
  initialTab = 'overview',
  hideHeading = false,
}) {
  useI18n()
  const [params, setParams] = useSearchParams()
  const manager = ['SUPER_ADMIN', 'SYSTEM_MANAGER'].includes(pms.user?.globalRole)
  const requested = params.get('tab') || initialTab
  const tab =
    params.has('success') || params.has('channel_id') || params.has('token')
      ? 'channels'
      : manager && requested === 'advanced'
        ? 'advanced'
        : integrationTab(requested)
  const tabsRef = useRef(null)
  useRevealActive(tabsRef, tab)
  const visibleTabs = manager
    ? [...tabs, ['advanced', 'Dữ liệu Channex nâng cao', Settings2]]
    : tabs
  const query = useChannels(pms.requestTenant, pms.tenantId)
  const state = integrationState(query.data || {})
  const status = connectionStatus(query.data?.connection)
  const path = (value) => basePath + (basePath.includes('?') ? '&' : '?') + 'tab=' + value
  function selectTab(value) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('tab', value)
      return next
    })
  }
  const props = {
    pms,
    embedded: true,
    query,
    connectionPath: path('connection'),
    historyPath: path('history'),
    channelsPath: path('channels'),
  }
  return (
    <div className="ota-integration">
      <header className="ota-integration-heading">
        {!hideHeading && (
          <div>
            {embedded ? <h2>{tUi('nav.channels')}</h2> : <h1>{tUi('nav.channels')}</h1>}
            <p>
              Kết nối, quản lý kênh bán và đồng bộ với PMS của{' '}
              {pms.tenant?.name || labelUi('khách sạn đang chọn')}.
            </p>
          </div>
        )}
        <div className="ota-page-actions">
          {query.data && (
            <span className={`ota-status ota-status--${status.tone}`}>
              {status.label}
              {query.data.connection &&
                ` · ${query.data.connection.environment === 'production' ? 'Vận hành' : 'Thử nghiệm'}`}
            </span>
          )}
          <button
            type="button"
            className="ota-button ota-button--secondary"
            disabled={query.loading || pms.pendingRequests?.writes > 0}
            onClick={query.refresh}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {query.loading ? tUi('common.loading') : tUi('common.reload')}
          </button>
        </div>
      </header>
      <nav
        ref={tabsRef}
        className="ota-integration-tabs"
        aria-label={labelUi('Channex và kênh OTA')}
      >
        {visibleTabs.map(([id, label, Icon]) => (
          <button
            type="button"
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            className={tab === id ? 'is-active' : ''}
            onClick={() => selectTab(id)}
          >
            <Icon size={16} aria-hidden="true" />
            {labelUi(label)}
          </button>
        ))}
      </nav>
      {tab === 'overview' && (
        <>
          {query.loading ? (
            <p role="status" className="ota-state">
              {labelUi('Đang kiểm tra trạng thái kết nối…')}
            </p>
          ) : query.error ? (
            <div className="ota-notice ota-notice--error" role="alert">
              <Info size={18} aria-hidden="true" />
              <span>{query.error}</span>
              <button type="button" className="ota-button" onClick={query.refresh}>
                {tUi('common.retry')}
              </button>
            </div>
          ) : (
            query.data && (
              <>
                <section
                  className="ota-integration-summary"
                  aria-label={labelUi('Tình trạng đồng bộ')}
                >
                  <article>
                    <ShieldCheck size={20} aria-hidden="true" />
                    <div>
                      <strong>
                        {state.connected
                          ? labelUi('Đã xác minh kết nối')
                          : labelUi('Chưa kết nối Channex')}
                      </strong>
                      <p>
                        {state.connected
                          ? query.data.connection.active
                            ? query.data.connection.inventoryReconciledAt
                              ? labelUi('Sẵn sàng trao đổi dữ liệu')
                              : tUi('channels.onboarding.required')
                            : labelUi('Kết nối đang tạm dừng')
                          : labelUi('Bắt đầu bằng việc liên kết khách sạn')}
                      </p>
                    </div>
                  </article>
                  <article>
                    <BedDouble size={20} aria-hidden="true" />
                    <div>
                      <strong>
                        {state.mapped}/{state.total} loại phòng đã ghép
                      </strong>
                      <p>
                        {state.total
                          ? labelUi('Chỉ các ghép nối đang bật được gửi giá')
                          : labelUi('Thêm loại phòng PMS để bắt đầu')}
                      </p>
                    </div>
                  </article>
                  <article>
                    <RefreshCw size={20} aria-hidden="true" />
                    <div>
                      <strong>{state.pending.length} yêu cầu đang xử lý</strong>
                      <p>
                        {state.bookingReviewCount
                          ? tUi('channels.review.count', { count: state.bookingReviewCount })
                          : state.failed.length
                            ? `${state.failed.length} yêu cầu cần kiểm tra`
                            : state.latest?.status === 'succeeded'
                              ? labelUi('Lần đồng bộ gần nhất thành công')
                              : tUi('channels.refreshHint')}
                      </p>
                    </div>
                  </article>
                </section>
                <section
                  className="ota-panel ota-integration-guide"
                  aria-labelledby="ota-guide-title"
                >
                  <div>
                    <h3 id="ota-guide-title">{labelUi('Thiết lập theo từng bước')}</h3>
                    <p>
                      {labelUi(
                        'Giá và phòng trống đi từ PMS lên Channex; đặt phòng mới, thay đổi và hủy đi từ Channex về PMS.',
                      )}
                    </p>
                  </div>
                  <ol>
                    <li>
                      <span>
                        {state.connected ? <CheckCircle2 size={20} aria-hidden="true" /> : '1'}
                      </span>
                      <div>
                        <strong>{labelUi('Kết nối khách sạn')}</strong>
                        <p>
                          {labelUi(
                            'Chọn khách sạn từ tài khoản có sẵn, hoặc nhập thông tin Channex một lần.',
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="ota-button"
                        onClick={() => selectTab('connection')}
                      >
                        {state.connected ? labelUi('Xem kết nối') : labelUi('Bắt đầu')}
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    </li>
                    <li>
                      <span>
                        {state.mapped > 0 ? <CheckCircle2 size={20} aria-hidden="true" /> : '2'}
                      </span>
                      <div>
                        <strong>{labelUi('Ghép phòng theo tên')}</strong>
                        <p>
                          {labelUi('Chọn loại phòng PMS, loại phòng Channex và gói giá tương ứng.')}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="ota-button"
                        onClick={() => selectTab('connection')}
                      >
                        {labelUi('Ghép phòng')}
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    </li>
                    <li>
                      <span>3</span>
                      <div>
                        <strong>{labelUi('Liên kết kênh bán phòng')}</strong>
                        <p>
                          {labelUi(
                            'Thêm Booking.com, Airbnb và các kênh khác; kiểm tra trước khi kích hoạt.',
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="ota-button"
                        onClick={() => selectTab('channels')}
                      >
                        {labelUi('Quản lý kênh')}
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    </li>
                    <li>
                      <span>
                        {state.ready ? <CheckCircle2 size={20} aria-hidden="true" /> : '4'}
                      </span>
                      <div>
                        <strong>{tUi('channels.onboarding.title')}</strong>
                        <p>{tUi('channels.onboarding.guide')}</p>
                      </div>
                      <button
                        type="button"
                        className="ota-button"
                        onClick={() => selectTab('connection')}
                      >
                        {tUi('channels.onboarding.open')}
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    </li>
                  </ol>
                  <div className="ota-integration-actions">
                    <button
                      type="button"
                      className="ota-button ota-button--primary"
                      onClick={() => selectTab(state.next)}
                    >
                      {state.ready
                        ? labelUi('Quản lý kênh bán phòng')
                        : labelUi('Tiếp tục thiết lập')}
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ota-button"
                      onClick={() => selectTab('history')}
                    >
                      {labelUi('Xem kết quả đồng bộ')}
                    </button>
                  </div>
                </section>
                {state.bookingReviewCount > 0 && (
                  <div className="ota-notice ota-notice--info" role="status">
                    <Info size={18} aria-hidden="true" />
                    <span>
                      {tUi('channels.review.notice', { count: state.bookingReviewCount })}
                    </span>
                    <button
                      type="button"
                      className="ota-button ota-button--small"
                      onClick={() => selectTab('history')}
                    >
                      {labelUi('Xem đặt phòng cần xử lý')}
                    </button>
                  </div>
                )}
                {state.failed.length > 0 && (
                  <div className="ota-notice ota-notice--info" role="status">
                    <Info size={18} aria-hidden="true" />
                    <span>
                      {labelUi(
                        'Có yêu cầu chưa hoàn tất. Mở lịch sử để xem nguyên nhân và thử lại.',
                      )}
                    </span>
                    <button
                      type="button"
                      className="ota-button ota-button--small"
                      onClick={() => selectTab('history')}
                    >
                      {labelUi('Kiểm tra')}
                    </button>
                  </div>
                )}
              </>
            )
          )}
        </>
      )}
      {tab === 'connection' && <ChannelWorkspace {...props} />}
      {tab === 'channels' && (
        <ClientChannelWorkspace {...props} settingsPath={path('connection')} />
      )}
      {tab === 'history' && <HistoryWorkspace {...props} />}
      {tab === 'advanced' &&
        (query.loading ? (
          <p role="status">{labelUi('Đang tải kết nối…')}</p>
        ) : query.data?.connection?.credentialsConfigured ? (
          <LinkedChannexTools pms={pms} connection={query.data.connection} />
        ) : (
          <div className="ota-notice ota-notice--info">
            <Info size={18} aria-hidden="true" />
            <span>
              {query.error ||
                labelUi('Liên kết khách sạn Channex trước khi mở phòng, gói giá và đặt phòng.')}
            </span>
            <button type="button" className="ota-button" onClick={() => selectTab('connection')}>
              {labelUi('Mở kết nối')}
            </button>
          </div>
        ))}
    </div>
  )
}
