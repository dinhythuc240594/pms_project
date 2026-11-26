import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import { BedDouble, Info, Save, ShieldCheck, Tag, X } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import LegacyOverlay from '../../../pms/components/LegacyOverlay'
import { channexCatalogInput, environmentLabel } from '../presentation'
import { uncertainChannelWrite } from '../channelForms'

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
const roomFields = [
  ['adults', 'Người lớn', 1, 50],
  ['children', 'Trẻ em', 0, 50],
  ['infants', 'Em bé', 0, 50],
]

export default function CatalogEditor({
  kind,
  item,
  account,
  property,
  rooms,
  onClose,
  onSaved,
  onReload,
}) {
  useI18n()
  const { saveChannexRoomType, saveChannexRatePlan } = usePms()
  const editing = Boolean(item.id),
    isRoom = kind === 'room'
  const title = `${editing ? 'Sửa' : 'Thêm'} ${isRoom ? 'loại phòng' : 'gói giá'}`
  const [draft, setDraft] = useState(() =>
    isRoom
      ? {
          name: item.name || '',
          countOfRooms: item.countOfRooms ?? 1,
          adults: item.adults ?? 2,
          children: item.children ?? 0,
          infants: item.infants ?? 0,
        }
      : {
          name: item.name || '',
          roomTypeId: item.roomTypeId || rooms[0]?.id || '',
          currency: item.currency || property.currency || '',
          rate: item.rate ?? '',
        },
  )
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false)
  const mounted = useRef(true),
    submitting = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const close = () => {
    if (!submitting.current) onClose()
  }
  const update = (field, value) => setDraft((previous) => ({ ...previous, [field]: value }))
  async function save(event) {
    event.preventDefault()
    if (submitting.current || uncertain) return
    let input
    try {
      input = { ...(editing ? { id: item.id } : {}), ...channexCatalogInput(kind, draft, editing) }
    } catch (failure) {
      setError(failure.message)
      return
    }
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      await (isRoom ? saveChannexRoomType : saveChannexRatePlan)(account.id, property.id, input)
      if (mounted.current)
        onSaved(
          `Đã ${editing ? 'cập nhật' : 'tạo'} ${isRoom ? 'loại phòng' : 'gói giá'} trên Channex.`,
        )
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message || 'Chưa lưu được. Vui lòng thử lại.')
        setUncertain(uncertainChannelWrite(failure))
      }
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <LegacyOverlay modal title={labelUi(title)} onClose={close} style={overlayStyle}>
      <div className="channex-editor">
        <div className="channex-editor-heading">
          <span className="channex-editor-icon">
            {isRoom ? (
              <BedDouble size={21} aria-hidden="true" />
            ) : (
              <Tag size={21} aria-hidden="true" />
            )}
          </span>
          <div>
            <span className="channex-editor-eyebrow">{labelUi('Danh mục Channex')}</span>
            <h2>{labelUi(title)}</h2>
            <p>
              {property.name} · {environmentLabel(account.environment)}
            </p>
          </div>
          <button
            type="button"
            className="manager-icon-button"
            aria-label={`Đóng ${title.toLocaleLowerCase('vi')}`}
            disabled={busy}
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={save}>
          {error && (
            <p className="channex-editor-error" role="alert">
              {error}
            </p>
          )}
          {uncertain && (
            <div className="channex-editor-error">
              <p>
                {labelUi(
                  'Kết quả lưu chưa xác định. Tải lại danh mục để kiểm tra trước khi gửi lại.',
                )}
              </p>
              <button type="button" className="manager-button" onClick={onReload}>
                {labelUi('Đóng & tải lại danh mục')}
              </button>
            </div>
          )}
          <fieldset disabled={busy || uncertain} className="channex-editor-fields">
            <label>
              {labelUi('Tên')} {isRoom ? labelUi('loại phòng') : labelUi('gói giá')}
              <input
                required
                maxLength={255}
                placeholder={
                  isRoom ? labelUi('Ví dụ: Deluxe, Couple…') : labelUi('Ví dụ: Couple Standard')
                }
                value={draft.name}
                onChange={(event) => update('name', event.target.value)}
              />
            </label>
            {isRoom ? (
              <>
                <label>
                  {tUi('rooms.number')}
                  <input
                    type="number"
                    required
                    min={1}
                    max={10000}
                    step={1}
                    disabled={Boolean(item.mapped)}
                    value={draft.countOfRooms}
                    onChange={(event) => update('countOfRooms', event.target.value)}
                  />
                </label>
                <div className="channex-editor-section">
                  <h3>{labelUi('Sức chứa mỗi phòng')}</h3>
                  <div className="channex-editor-grid channex-editor-occupancy">
                    {roomFields.map(([field, label, min, max]) => (
                      <label key={field}>
                        {labelUi(label)}
                        <input
                          type="number"
                          required
                          min={min}
                          max={max}
                          step={1}
                          disabled={Boolean(item.mapped)}
                          value={draft[field]}
                          onChange={(event) => update(field, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                {item.mapped && (
                  <p className="channex-editor-hint">
                    <ShieldCheck size={15} aria-hidden="true" />
                    {labelUi(
                      'Loại phòng đã liên kết LOHA: chỉ đổi tên để giữ nguyên sức chứa và số phòng.',
                    )}
                  </p>
                )}
              </>
            ) : (
              <>
                {!editing ? (
                  <div className="channex-editor-grid">
                    <label>
                      {tUi('common.roomType')}
                      <select
                        required
                        value={draft.roomTypeId}
                        onChange={(event) => update('roomTypeId', event.target.value)}
                      >
                        <option value="" disabled>
                          {labelUi('Chọn loại phòng')}
                        </option>
                        {rooms.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {tUi('common.currency')}
                      <input
                        required
                        pattern="[A-Z]{3}"
                        maxLength={3}
                        value={draft.currency}
                        onChange={(event) => update('currency', event.target.value.toUpperCase())}
                        placeholder="VND, USD…"
                      />
                    </label>
                  </div>
                ) : (
                  <p className="channex-editor-hint">
                    <BedDouble size={15} aria-hidden="true" />
                    {rooms.find((room) => room.id === item.roomTypeId)?.name ||
                      item.roomTypeId} · {item.currency}
                  </p>
                )}
                <label>
                  {labelUi('Giá mặc định')}
                  <span className="channex-editor-price">
                    <input
                      required
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]{1,15}(\.[0-9]{1,4})?"
                      maxLength={20}
                      value={draft.rate}
                      onChange={(event) => update('rate', event.target.value)}
                      placeholder={labelUi('Ví dụ: 1200000 hoặc 89.50')}
                    />
                    <span aria-hidden="true">{draft.currency}</span>
                  </span>
                </label>
                <p className="channex-editor-hint">
                  <Info size={15} aria-hidden="true" />
                  {labelUi(
                    'Theo phòng, giá thủ công. Thay đổi giá mặc định không tự cập nhật giá từng ngày.',
                  )}
                </p>
              </>
            )}
          </fieldset>
          <div className="channex-editor-actions">
            <button type="button" className="manager-button" disabled={busy} onClick={close}>
              {tUi('common.cancel')}
            </button>
            <button
              type="submit"
              className="manager-button manager-button-primary"
              disabled={busy || uncertain}
            >
              <Save size={15} aria-hidden="true" />
              {busy ? tUi('common.saving') : labelUi('Lưu trên Channex')}
            </button>
          </div>
        </form>
      </div>
    </LegacyOverlay>
  )
}
