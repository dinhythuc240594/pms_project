import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Link2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import { useChannexQuery } from '../useChannexQuery'
import { uncertainChannelWrite } from '../channelForms'
import { DataState } from './RemoteData'

export default function ChannelAirbnb({
  account,
  property,
  operations,
  canWrite = true,
  channel,
  name,
  groupId,
  rateOptions,
  readonly,
  onSaved,
  onReload,
  onBusy,
}) {
  useI18n()
  const pms = usePms()
  const {
    createChannexAirbnbLink,
    getChannexAirbnbListings,
    saveChannexAirbnbMapping,
    deleteChannexAirbnbMapping,
  } = operations || pms
  const [link, setLink] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false)
  const url = link?.name === name && link?.groupId === groupId ? link.url : ''
  const [listingId, setListingId] = useState(''),
    [ratePlanId, setRatePlanId] = useState(''),
    [removal, setRemoval] = useState(null)
  const mounted = useRef(true),
    working = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const request = useCallback(
    () =>
      channel
        ? getChannexAirbnbListings(account.id, property.id, channel.id)
        : Promise.resolve({ listings: [] }),
    [getChannexAirbnbListings, account.id, property.id, channel],
  )
  const query = useChannexQuery(request, 'listings')
  async function run(callback, write = false) {
    if (working.current || uncertain || !canWrite) return
    working.current = true
    setBusy(true)
    onBusy(true)
    setError('')
    try {
      await callback()
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message || 'Chưa hoàn tất thao tác Airbnb.')
        if (write) setUncertain(uncertainChannelWrite(failure))
      }
    } finally {
      working.current = false
      if (mounted.current) {
        setBusy(false)
        onBusy(false)
      }
    }
  }
  function ownerLink() {
    run(async () => {
      if (!name.trim() || (!channel && !groupId))
        throw new Error('Nhập tên kết nối và chọn nhóm Channex trước.')
      const input = {
        name: name.trim(),
        returnOrigin: window.location.origin,
        ...(channel ? { channelId: channel.id } : { groupId }),
      }
      const result = await createChannexAirbnbLink(account.id, property.id, input)
      const destination = new URL(result.url)
      if (destination.protocol !== 'https:')
        throw new Error('Đường dẫn xác thực Airbnb chưa hợp lệ.')
      if (mounted.current) setLink({ url: destination.href, name, groupId })
    })
  }
  function saveMapping() {
    run(async () => {
      if (!listingId || !ratePlanId) throw new Error('Chọn listing Airbnb và gói giá Channex.')
      const result = await saveChannexAirbnbMapping(account.id, property.id, channel.id, {
        listingId,
        ratePlanId,
        revision: channel.revision,
      })
      if (mounted.current) {
        if (result.status === 'pending') setUncertain('pending')
        else onSaved('Đã ghép listing Airbnb với gói giá Channex.')
      }
    }, true)
  }
  function unmap() {
    run(async () => {
      const result = await deleteChannexAirbnbMapping(
        account.id,
        property.id,
        channel.id,
        removal.id,
        { revision: channel.revision, confirm: true },
      )
      if (mounted.current) {
        if (result.status === 'pending') setUncertain('pending')
        else onSaved('Đã bỏ ghép listing Airbnb. Kiểm tra trạng thái bán phòng trên Airbnb.')
      }
    }, true)
  }
  return (
    <div className="channex-editor-section channex-airbnb">
      <h3>{labelUi('Liên kết tài khoản Airbnb')}</h3>
      <p className="channex-channel-note">
        {labelUi(
          'Chủ tài khoản Airbnb cần đăng nhập và cấp quyền trực tiếp. LOHA không yêu cầu mật khẩu Airbnb.',
        )}
      </p>
      <p className="channex-channel-note">
        {labelUi(
          'Mở liên kết trên trình duyệt đang đăng nhập LOHA để tự trở về đúng khách sạn. Nếu chủ tài khoản cấp quyền trên trình duyệt khác, tải lại danh sách kênh tại đây sau khi hoàn tất.',
        )}
      </p>
      {error && (
        <div className="channex-editor-error" role="alert">
          <p>{error}</p>
          {channel && !uncertain && (
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
                  'Airbnb đã nhận yêu cầu và đang xử lý. Tải lại kênh để kiểm tra ghép nối trước khi gửi thêm thao tác.',
                )
              : labelUi('Kết quả ghép nối chưa xác định. Tải lại kênh trước khi gửi lại.')}
          </p>
          <button type="button" className="manager-button" onClick={onReload}>
            {labelUi('Đóng & tải lại')}
          </button>
        </div>
      )}
      {!readonly && (
        <div className="channex-channel-probe">
          <button
            type="button"
            className="manager-button"
            disabled={busy || uncertain}
            onClick={ownerLink}
          >
            <ShieldCheck size={15} aria-hidden="true" />
            {busy
              ? labelUi('Đang xử lý…')
              : channel
                ? labelUi('Liên kết lại tài khoản')
                : labelUi('Tạo liên kết xác thực')}
          </button>
          {url && !busy && (
            <a className="manager-button manager-button-primary" href={url}>
              <ArrowUpRight size={15} aria-hidden="true" />
              {labelUi('Mở Airbnb & cấp quyền')}
            </a>
          )}
        </div>
      )}
      {channel && (
        <>
          <div className="channex-table-heading">
            <h3>Listing Airbnb</h3>
            <button
              type="button"
              className="manager-button"
              disabled={busy || query.loading}
              onClick={query.refresh}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {labelUi('Tải listing')}
            </button>
          </div>
          <DataState query={query} label="listing Airbnb">
            <div className="channex-editor-grid">
              <label>
                Listing Airbnb
                <select
                  value={listingId}
                  disabled={readonly || busy || uncertain}
                  onChange={(event) => setListingId(event.target.value)}
                >
                  <option value="">{labelUi('Chọn listing')}</option>
                  {(query.data?.listings || []).map((listing) => (
                    <option key={listing.id} value={listing.id}>
                      {listing.name}
                      {listing.capacity ? ` · ${listing.capacity} khách` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labelUi('Gói giá Channex')}
                <select
                  value={ratePlanId}
                  disabled={readonly || busy || uncertain}
                  onChange={(event) => setRatePlanId(event.target.value)}
                >
                  <option value="">{labelUi('Chọn gói giá')}</option>
                  {rateOptions.map((rate) => (
                    <option key={rate.id} value={rate.id}>
                      {rate.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </DataState>
          {!readonly && (
            <button
              type="button"
              className="manager-button"
              disabled={
                busy ||
                uncertain ||
                !listingId ||
                !ratePlanId ||
                query.loading ||
                Boolean(query.error)
              }
              onClick={saveMapping}
            >
              <Link2 size={15} aria-hidden="true" />
              {labelUi('Ghép listing')}
            </button>
          )}
          <div className="channex-channel-current-mappings">
            <h3>{labelUi('Listing đã ghép')}</h3>
            {!(channel.mappings || []).length && (
              <p className="channex-channel-note">{labelUi('Chưa có listing được ghép.')}</p>
            )}
            {(channel.mappings || []).map((mapping) => (
              <div className="channex-channel-mapping-head" key={mapping.id}>
                <div>
                  <strong>
                    {rateOptions.find((rate) => rate.id === mapping.ratePlanId)?.name ||
                      mapping.ratePlanId}
                  </strong>
                  <small>
                    {query.data?.listings?.find(
                      (listing) => listing.id === mapping.settings?.listing_id,
                    )?.name ||
                      mapping.settings?.listing_id ||
                      'Listing Airbnb'}
                  </small>
                </div>
                {canWrite && channel.editable && (
                  <button
                    type="button"
                    className="manager-button channex-channel-delete"
                    disabled={busy || uncertain}
                    onClick={() => setRemoval(mapping)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {labelUi('Bỏ ghép')}
                  </button>
                )}
              </div>
            ))}
          </div>
          {removal && (
            <div className="channex-editor-error" role="alert">
              <p>
                {labelUi(
                  'Bỏ ghép sẽ dừng trao đổi dữ liệu của listing này; phòng trên Airbnb vẫn có thể đang mở bán.',
                )}
              </p>
              <div className="channex-actions">
                <button
                  type="button"
                  className="manager-button"
                  disabled={busy}
                  onClick={() => setRemoval(null)}
                >
                  {tUi('common.cancel')}
                </button>
                <button
                  type="button"
                  className="manager-button channex-channel-danger"
                  disabled={busy || uncertain}
                  onClick={unmap}
                >
                  {labelUi('Xác nhận bỏ ghép')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
