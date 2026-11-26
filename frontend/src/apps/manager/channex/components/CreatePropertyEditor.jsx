import { tr as labelUi } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import { Building2, Info, Plus, RefreshCw, X } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import LegacyOverlay from '../../../pms/components/LegacyOverlay'
import { environmentLabel } from '../presentation'
import {
  canCreateChannexProperty,
  channexPropertyDraft,
  channexPropertyInput,
} from '../propertyForm'
import { uncertainChannelWrite } from '../channelForms'
import '../pages/ManagerChannex.css'
import '../ChannexSurface.css'
import { phonePattern } from '../../../../shared/lib/phone.js'
import { emailPattern } from '../../../../shared/lib/validation.js'
import { HOTEL_CURRENCIES } from '../../../../shared/lib/currencies.js'

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 120,
  background: 'rgba(9,24,40,.48)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
}

export default function CreatePropertyEditor({
  account,
  hotel,
  settings,
  onClose,
  onCreated,
  onReload,
}) {
  const { user, createChannexProperty } = usePms()
  const [draft, setDraft] = useState(() => channexPropertyDraft(hotel, settings))
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false)
  const mounted = useRef(true),
    submitting = useRef(false),
    nameInput = useRef(null),
    errorNotice = useRef(null)
  useEffect(() => {
    mounted.current = true
    nameInput.current?.focus()
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (error) errorNotice.current?.focus()
  }, [error])
  const allowed = canCreateChannexProperty(user, account)
  const close = () => {
    if (!submitting.current) onClose()
  }
  const update = (field, value) => setDraft((previous) => ({ ...previous, [field]: value }))
  async function create(event) {
    event.preventDefault()
    if (!allowed || submitting.current || uncertain) return
    let input
    try {
      input = channexPropertyInput(account.id, draft)
    } catch (failure) {
      setError(failure.message)
      return
    }
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const result = await createChannexProperty(input)
      if (!result?.property?.id) throw new Error('Channex chưa trả thông tin khách sạn vừa tạo.')
      if (mounted.current) onCreated(result.property)
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message || 'Chưa tạo được khách sạn.')
        setUncertain(uncertainChannelWrite(failure))
      }
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }
  if (!allowed) return null
  return (
    <LegacyOverlay
      modal
      title={labelUi('Tạo khách sạn trên Channex')}
      onClose={close}
      style={overlayStyle}
    >
      <div className="channex-editor">
        <div className="channex-editor-heading">
          <span className="channex-editor-icon">
            <Building2 size={21} aria-hidden="true" />
          </span>
          <div>
            <span className="channex-editor-eyebrow">
              {account.label} · {environmentLabel(account.environment)}
            </span>
            <h2>{labelUi('Tạo khách sạn trên Channex')}</h2>
            <p>
              {labelUi(
                'Tạo Property bằng tài khoản hệ thống, sau đó liên kết với khách sạn PMS đang mở.',
              )}
            </p>
          </div>
          <button
            type="button"
            className="manager-icon-button"
            aria-label={labelUi('Đóng tạo khách sạn Channex')}
            disabled={busy}
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={create} aria-busy={busy}>
          {error && (
            <p ref={errorNotice} tabIndex={-1} className="channex-editor-error" role="alert">
              {error}
            </p>
          )}
          {uncertain && (
            <div className="channex-editor-error">
              <p>
                {labelUi(
                  'Kết quả tạo chưa xác định. Kiểm tra danh sách khách sạn trên Channex trước khi tạo lại để tránh trùng.',
                )}
              </p>
              <button type="button" className="manager-button" onClick={onReload}>
                {labelUi('Đóng & tải lại danh sách')}
              </button>
            </div>
          )}
          <fieldset disabled={busy || uncertain} className="channex-editor-fields">
            <label>
              {labelUi('Tên khách sạn')}
              <input
                ref={nameInput}
                required
                maxLength={255}
                value={draft.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder={labelUi('Ví dụ: An Nhiên Riverside')}
              />
            </label>
            <div className="channex-editor-grid">
              <label>
                {labelUi('Tiền tệ')}
                <select
                  required
                  value={draft.currency}
                  onChange={(event) => update('currency', event.target.value)}
                >
                  {HOTEL_CURRENCIES.map(({ code, label }) => (
                    <option key={code} value={code}>
                      {labelUi(label)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labelUi('Múi giờ')}
                <input
                  required
                  maxLength={100}
                  value={draft.timezone}
                  onChange={(event) => update('timezone', event.target.value)}
                  placeholder="Asia/Ho_Chi_Minh"
                />
              </label>
            </div>
            <div className="channex-editor-grid">
              <label>
                {labelUi('Mã quốc gia')}
                <input
                  minLength={2}
                  maxLength={2}
                  pattern="[A-Z]{2}"
                  value={draft.country}
                  onChange={(event) => update('country', event.target.value.toUpperCase())}
                  placeholder="VN"
                />
              </label>
              <label>
                {labelUi('Tỉnh / Thành phố')}
                <input
                  maxLength={255}
                  value={draft.city}
                  onChange={(event) => update('city', event.target.value)}
                />
              </label>
            </div>
            <label>
              {labelUi('Địa chỉ')}
              <input
                maxLength={255}
                value={draft.address}
                onChange={(event) => update('address', event.target.value)}
              />
            </label>
            <div className="channex-editor-grid">
              <label>
                {labelUi('Email liên hệ')}
                <input
                  type="email"
                  maxLength={254}
                  pattern={emailPattern}
                  value={draft.email}
                  onChange={(event) => update('email', event.target.value)}
                />
              </label>
              <label>
                {labelUi('Điện thoại')}
                <input
                  type="tel"
                  maxLength={32}
                  pattern={phonePattern}
                  title={labelUi(
                    'Số điện thoại cần từ 7 đến 15 chữ số, chỉ cho phép dấu + ở đầu và dấu cách, chấm, gạch ngang, ngoặc đơn.',
                  )}
                  value={draft.phone}
                  onChange={(event) => {
                    if (!/[^0-9+ .()-]/.test(event.target.value))
                      update('phone', event.target.value)
                  }}
                />
              </label>
            </div>
            <p className="channex-editor-hint">
              <Info size={15} aria-hidden="true" />
              Chỉ tạo khách sạn trên {environmentLabel(account.environment)}. Loại phòng, gói giá và
              liên kết PMS được thiết lập ở bước tiếp theo.
            </p>
          </fieldset>
          <div className="channex-editor-actions">
            <button type="button" className="manager-button" disabled={busy} onClick={close}>
              {labelUi('Hủy')}
            </button>
            <button
              type="submit"
              className="manager-button manager-button-primary"
              disabled={busy || uncertain}
            >
              {busy ? (
                <RefreshCw size={15} className="ota-spin" aria-hidden="true" />
              ) : (
                <Plus size={15} aria-hidden="true" />
              )}
              {busy ? labelUi('Đang tạo…') : labelUi('Tạo trên Channex')}
            </button>
          </div>
        </form>
      </div>
    </LegacyOverlay>
  )
}
