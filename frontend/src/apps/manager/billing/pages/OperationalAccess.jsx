import DateInput from '../../../../shared/components/DateInput.jsx'
import { formatDateTime } from '../../../../shared/lib/date.js'
import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { tr as labelUi } from '../../../../shared/i18n/useI18n.js'
import { usePms } from '../../../pms/data/usePms.js'
import LegacyOverlay from '../../../pms/components/LegacyOverlay.jsx'

const localTime = (date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

export default function OperationalAccess({ tenant, onClose, onSaved }) {
  const { getOperationalAccess, saveOperationalAccess } = usePms()
  const [access, setAccess] = useState(null),
    [loading, setLoading] = useState(true)
  const [until, setUntil] = useState(() => localTime(new Date(Date.now() + 86400000)))
  const [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const intent = useRef(crypto.randomUUID()),
    pending = useRef(false)
  useEffect(() => {
    let cancelled = false
    getOperationalAccess(tenant.id)
      .then((result) => {
        if (!cancelled) setAccess(result.access)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [getOperationalAccess, tenant.id])
  const save = async (event, revoke = false) => {
    event.preventDefault()
    if (pending.current) return
    setError('')
    setMessage('')
    if (!reason.trim()) {
      setError(labelUi('Cần nhập lý do vận hành tạm hoặc thu hồi.'))
      return
    }
    const deadline = new Date(until)
    if (
      !revoke &&
      (!Number.isFinite(deadline.getTime()) ||
        deadline <= new Date() ||
        deadline.getTime() > Date.now() + 7 * 86400000)
    ) {
      setError(labelUi('Thời hạn vận hành phải trong 7 ngày tới.'))
      return
    }
    pending.current = true
    setBusy(true)
    try {
      const result = await saveOperationalAccess(
        tenant.id,
        { until: revoke ? null : deadline.toISOString(), reason: reason.trim() },
        intent.current,
      )
      setAccess(result.access)
      intent.current = crypto.randomUUID()
      setReason('')
      setMessage(
        labelUi(revoke ? 'Đã thu hồi quyền vận hành tạm.' : 'Đã cấp quyền hoàn tất vận hành tạm.'),
      )
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <LegacyOverlay
      title={labelUi('Vận hành tạm khi hết hạn')}
      onClose={() => {
        if (!pending.current) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15,23,42,.55)',
        padding: 20,
      }}
    >
      <div className="manager-billing-dialog manager-invoice-dialog" aria-busy={busy || loading}>
        <div className="manager-invoice-dialog-heading">
          <h2>{labelUi('Vận hành tạm khi hết hạn')}</h2>
          <button
            type="button"
            className="manager-button"
            disabled={busy}
            aria-label={labelUi('Đóng vận hành tạm')}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p>{tenant.name}</p>
        <p>
          {labelUi(
            'Chỉ hoàn tất lưu trú, thu/hoàn tiền hiện có, dọn phòng và nhận booking OTA. Không mở tạo booking trực tiếp, bán hàng mới hoặc đổi cấu hình. Hạn tối đa 7 ngày; thuê bao thương mại không được gia hạn tự động.',
          )}
        </p>
        {loading && <p role="status">{labelUi('Đang tải…')}</p>}
        {access && (
          <p role="status">
            {access.active
              ? labelUi('Đang được vận hành tạm đến')
              : labelUi('Quyết định gần nhất đã hết hiệu lực hoặc bị thu hồi')}{' '}
            {access.until ? formatDateTime(access.until) : ''}
            <br />
            {access.reason}
          </p>
        )}
        {error && (
          <p role="alert" className="manager-invoice-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="manager-invoice-success">
            {message}
          </p>
        )}
        <form className="manager-invoice-form" onSubmit={save}>
          <fieldset disabled={busy || loading}>
            <label>
              {labelUi('Hạn vận hành tạm')}
              <DateInput
                type="datetime-local"
                required
                value={until}
                onChange={(value) => {
                  setUntil(value)
                  intent.current = crypto.randomUUID()
                }}
              />
            </label>
            <label>
              {labelUi('Lý do')}
              <textarea
                required
                maxLength={1000}
                rows={3}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value)
                  intent.current = crypto.randomUUID()
                }}
              />
            </label>
            <div className="manager-invoice-actions">
              <button
                type="submit"
                className="manager-button manager-button-primary"
                disabled={busy || loading}
              >
                {labelUi('Cấp vận hành tạm')}
              </button>
              {access?.active && (
                <button
                  type="button"
                  className="manager-button"
                  disabled={busy || loading}
                  onClick={(event) => save(event, true)}
                >
                  {labelUi('Thu hồi quyền vận hành tạm')}
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </div>
    </LegacyOverlay>
  )
}
