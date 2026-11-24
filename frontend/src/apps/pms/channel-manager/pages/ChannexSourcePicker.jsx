import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useCallback, useState } from 'react'
import { Check, Plus, RefreshCw } from 'lucide-react'
import { usePms } from '../../data/usePms'
import { defaultChannexAccount, environmentLabel } from '../../../manager/channex/presentation'
import { useChannexQuery } from '../../../manager/channex/useChannexQuery'
import CreatePropertyEditor from '../../../manager/channex/components/CreatePropertyEditor'
import { canCreateChannexProperty, propertyChoices } from '../../../manager/channex/propertyForm'

export default function ChannexSourcePicker({ pms, disabled, storageAvailable, onConnect }) {
  const { getChannexAccounts } = usePms()
  const query = useChannexQuery(getChannexAccounts, 'accounts')
  const [selected, setSelected] = useState('')
  const accounts = (query.data?.accounts || []).filter(
    (account) => !account.id.startsWith('hotel:') || account.id === 'hotel:' + pms.tenantId,
  )
  const accountId = selected || defaultChannexAccount(accounts)
  const account = accounts.find((source) => source.id === accountId && source.configured)
  return (
    <div className="ota-source-picker">
      <h3>{labelUi('Chọn từ tài khoản Channex có sẵn')}</h3>
      <p>{labelUi('Chọn theo tên; hệ thống tự kiểm tra và liên kết với khách sạn PMS đang mở.')}</p>
      {query.loading ? (
        <p role="status">{labelUi('Đang tải tài khoản…')}</p>
      ) : query.error ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <button type="button" className="ota-button" onClick={query.refresh}>
            {labelUi('Tải lại tài khoản')}
          </button>
        </div>
      ) : (
        <>
          <label className="ota-field">
            {labelUi('Tài khoản Channex')}
            <select
              disabled={disabled}
              value={accountId}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="" disabled>
                {labelUi('Chọn tài khoản')}
              </option>
              {accounts.map((source) => (
                <option key={source.id} value={source.id} disabled={!source.configured}>
                  {source.label} · {environmentLabel(source.environment)}
                  {source.configured ? '' : ' ' + labelUi('· Chưa cấu hình')}
                </option>
              ))}
            </select>
          </label>
          {account ? (
            <PropertyChoice
              key={account.id}
              account={account}
              pms={pms}
              disabled={disabled || !storageAvailable}
              onConnect={onConnect}
            />
          ) : (
            <p>
              {labelUi(
                'Chưa có tài khoản sẵn sàng. Bạn có thể dùng nút Nhập mã & khóa API bên trên.',
              )}
            </p>
          )}
          {!storageAvailable && (
            <p role="status">
              {labelUi(
                'Cần bật lưu khóa an toàn trên máy chủ trước khi liên kết. Liên hệ quản trị viên.',
              )}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function PropertyChoice({ account, pms, disabled, onConnect }) {
  useI18n()
  const { getChannexProperties, tenants } = usePms()
  const [page, setPage] = useState(1),
    [propertyId, setPropertyId] = useState('')
  const [creating, setCreating] = useState(false),
    [created, setCreated] = useState(null)
  const request = useCallback(
    () => getChannexProperties(account.id, page),
    [getChannexProperties, account.id, page],
  )
  const query = useChannexQuery(request, 'properties')
  const properties = propertyChoices(query.data?.properties || [], created)
  const property = properties.find((row) => row.id === propertyId)
  const canCreate = canCreateChannexProperty(pms.user, account)
  const hotel = { ...tenants?.find((row) => row.id === pms.tenantId), ...pms.tenant }
  const linkedElsewhere = (row) => row.linkedHotel && row.linkedHotel.tenantId !== pms.tenantId
  function connect(event) {
    event.preventDefault()
    if (disabled || !property || linkedElsewhere(property)) return
    onConnect({ accountId: account.id, propertyId, active: true })
  }
  return (
    <>
      <form onSubmit={connect}>
        <fieldset disabled={disabled}>
          <label className="ota-field">
            {labelUi('Khách sạn trên Channex')}
            <select
              required
              disabled={query.loading || Boolean(query.error)}
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
            >
              <option value="">
                {query.loading
                  ? labelUi('Đang tải khách sạn…')
                  : labelUi('Chọn khách sạn tương ứng')}
              </option>
              {properties.map((row) => (
                <option key={row.id} value={row.id} disabled={Boolean(linkedElsewhere(row))}>
                  {row.name}
                  {row.city ? ` · ${row.city}` : ''}
                  {linkedElsewhere(row) ? ` · Đã liên kết ${row.linkedHotel.name}` : ''}
                </option>
              ))}
            </select>
          </label>
          {canCreate && (
            <div className="ota-property-create">
              <span>{labelUi('Chưa có khách sạn tương ứng trên Channex?')}</span>
              <button type="button" className="ota-button" onClick={() => setCreating(true)}>
                <Plus size={15} aria-hidden="true" />
                {labelUi('Tạo khách sạn trên Channex')}
              </button>
            </div>
          )}
          {created && (
            <p role="status">
              {labelUi('Đã tạo')} <strong>{created.name}</strong> trên{' '}
              {environmentLabel(account.environment)}. Bấm{' '}
              <strong>{labelUi('Liên kết & bật đồng bộ')}</strong>{' '}
              {labelUi('để kết nối với khách sạn PMS.')}
            </p>
          )}
          {query.error && <p role="alert">{query.error.message}</p>}
          {query.data && !properties.length && (
            <p>
              {labelUi(
                'Chưa có khách sạn trong tài khoản này. Kiểm tra tài khoản hoặc môi trường đã chọn.',
              )}
            </p>
          )}
          {property && (
            <p>
              {labelUi('Sẽ liên kết')} <strong>{property.name}</strong> (
              {environmentLabel(account.environment)}) với <strong>{pms.tenant?.name}</strong>.
              {property.currency !== (pms.settings.currency || 'VND') &&
                ' ' +
                  labelUi(
                    'Tiền tệ đang khác PMS; cần thống nhất tiền tệ gói giá trước khi ghép phòng.',
                  )}
            </p>
          )}
          <div className="ota-form-actions">
            <button
              type="button"
              className="ota-button"
              disabled={query.loading}
              onClick={query.refresh}
            >
              <RefreshCw size={15} aria-hidden="true" />
              {tUi('common.reload')}
            </button>
            <button
              type="button"
              className="ota-button"
              disabled={query.loading || page <= 1}
              onClick={() => {
                setPage((value) => value - 1)
                setPropertyId('')
              }}
            >
              {labelUi('Trang trước')}
            </button>
            <button
              type="button"
              className="ota-button"
              disabled={query.loading || page >= (query.data?.pagination?.totalPages || 1)}
              onClick={() => {
                setPage((value) => value + 1)
                setPropertyId('')
              }}
            >
              {labelUi('Trang sau')}
            </button>
            <button
              type="submit"
              className="ota-button ota-button--primary"
              disabled={query.loading || !property || Boolean(linkedElsewhere(property))}
            >
              <Check size={16} aria-hidden="true" />
              {labelUi('Liên kết & bật đồng bộ')}
            </button>
          </div>
        </fieldset>
      </form>
      {creating && canCreate && (
        <CreatePropertyEditor
          account={account}
          hotel={hotel}
          settings={pms.settings}
          onClose={() => setCreating(false)}
          onCreated={(row) => {
            setCreated(row)
            setPropertyId(row.id)
            setCreating(false)
          }}
          onReload={() => {
            setCreating(false)
            query.refresh()
          }}
        />
      )}
    </>
  )
}
