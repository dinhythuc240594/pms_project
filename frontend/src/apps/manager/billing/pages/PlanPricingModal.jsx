import React, { useState } from 'react'
import { Calculator, X } from 'lucide-react'
import { t as tUi, tr as labelUi } from '../../../../shared/i18n/useI18n.js'
import {
  calculatePlanPrice,
  defaultRegisteredRooms,
  normalizePricingRules,
} from '../../../../shared/lib/planPricing.js'
import { money } from '../../../pms/data/model.js'
import LegacyOverlay from '../../../pms/components/LegacyOverlay.jsx'

export function planPricePreview(plan, rooms, cycle) {
  try {
    return { quote: calculatePlanPrice(plan, rooms, cycle), error: '' }
  } catch (error) {
    return { quote: null, error: error.message }
  }
}

export function PlanPriceBreakdown({ quote, currency }) {
  if (!quote) return null
  return (
    <dl className="manager-plan-price-breakdown" aria-label={labelUi('Chi tiết tính giá')}>
      <div>
        <dt>
          {labelUi('Giá cơ bản')} ({quote.baseRooms} {labelUi('phòng')})
        </dt>
        <dd>{money(quote.basePrice, currency)}</dd>
      </div>
      <div>
        <dt>
          {quote.extraRooms} {labelUi('phòng thêm')} × {money(quote.extraRoomPrice, currency)}
        </dt>
        <dd>
          {labelUi('Tạm tính')}: {money(quote.subtotal, currency)}
        </dd>
      </div>
      <div>
        <dt>
          {labelUi('Điều chỉnh')}
          {quote.aboveRooms ? ` (${labelUi('Vượt')} ${quote.aboveRooms} ${labelUi('phòng')})` : ''}
        </dt>
        <dd>{quote.adjustmentPercent}%</dd>
      </div>
      <div>
        <dt>{labelUi('Tổng tiền mỗi kỳ')}</dt>
        <dd>{money(quote.amount, currency)}</dd>
      </div>
    </dl>
  )
}

export default function PlanPricingModal({ plan, local = false, theme: t, onClose, onSave }) {
  const [rules, setRules] = useState(() => normalizePricingRules(plan.pricingRules))
  const [rooms, setRooms] = useState(() => defaultRegisteredRooms(plan))
  const [cycle, setCycle] = useState('monthly')
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const preview = planPricePreview({ ...plan, pricingRules: rules }, rooms, cycle)
  const save = async (event) => {
    event.preventDefault()
    if (busy) return
    setError('')
    try {
      const normalized = normalizePricingRules(rules)
      if (
        plan.code === 'FREE' &&
        [normalized.extraRoomPrice, normalized.extraRoomPriceYear].some(
          (value) => Number(value) !== 0,
        )
      )
        throw new Error('Gói FREE phải có giá phòng thêm bằng 0.')
      setBusy(true)
      await onSave(normalized)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const update = (key) => (event) => setRules((value) => ({ ...value, [key]: event.target.value }))
  return (
    <LegacyOverlay
      title={labelUi('Điều kiện tính giá gói cước')}
      onClose={() => {
        if (!busy) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 130,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: t.bgModalBackdrop,
        padding: 20,
      }}
    >
      <div
        className="manager-billing-dialog manager-plan-pricing-dialog"
        style={{
          background: t.bgSurface,
          color: t.textPrimary,
          border: `1px solid ${t.border}`,
          borderRadius: 16,
          padding: 24,
          maxWidth: 720,
          width: '100%',
          maxHeight: '90dvh',
          overflowY: 'auto',
        }}
      >
        <div className="manager-plan-pricing-heading">
          <h2>
            <Calculator size={20} aria-hidden="true" /> {labelUi('Điều kiện tính giá')}
            {plan.name ? `: ${plan.name}` : ''}
          </h2>
          <button
            type="button"
            className="manager-button"
            aria-label={labelUi('Đóng điều kiện tính giá')}
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          {labelUi(
            'Tổng tiền = (giá cơ bản + số phòng thêm × đơn giá phòng thêm) × (1 + tỷ lệ điều chỉnh / 100).',
          )}
        </p>
        <p>
          {labelUi(
            'Chỉ áp dụng tỷ lệ của mốc cao nhất đã vượt, trên toàn bộ tạm tính. Nhập số âm để giảm, số dương để tăng; 0 là giữ nguyên giá.',
          )}
        </p>
        {error && (
          <p role="alert" className="manager-invoice-error">
            {labelUi(error)}
          </p>
        )}
        <form onSubmit={save}>
          <fieldset disabled={busy} className="manager-plan-pricing-fields">
            <legend>{labelUi('Cấu hình giá theo số phòng')}</legend>
            <label>
              {labelUi('Số phòng cơ bản')}
              <input
                aria-label={labelUi('Số phòng cơ bản')}
                type="number"
                min="1"
                max="1000000"
                step="1"
                required
                value={rules.baseRooms}
                onChange={update('baseRooms')}
              />
              <small>
                {labelUi(
                  'Mặc định 15 phòng. Giá tháng và giá năm của gói là giá cho số phòng cơ bản này.',
                )}
              </small>
            </label>
            <div className="manager-invoice-form-row">
              {[
                ['extraRoomPrice', 'Giá mỗi phòng thêm / tháng'],
                ['extraRoomPriceYear', 'Giá mỗi phòng thêm / năm'],
              ].map(([key, label]) => (
                <label key={key}>
                  {labelUi(label)} ({plan.currency})
                  <input
                    aria-label={labelUi(label)}
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]{1,15}([.][0-9]{1,4})?"
                    maxLength={20}
                    required
                    value={rules[key]}
                    onChange={update(key)}
                  />
                </label>
              ))}
            </div>
            <div className="manager-plan-pricing-thresholds">
              {rules.adjustments.map((row, index) => (
                <label key={row.aboveRooms}>
                  {labelUi('Vượt')} {row.aboveRooms} {labelUi('phòng')} (%)
                  <input
                    aria-label={`${labelUi('Điều chỉnh khi vượt')} ${row.aboveRooms} ${labelUi('phòng')}`}
                    type="number"
                    min="-100"
                    max="1000"
                    step="0.0001"
                    required
                    value={row.percent}
                    onChange={(event) =>
                      setRules((value) => ({
                        ...value,
                        adjustments: value.adjustments.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, percent: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <small>
              {labelUi(
                'Ví dụ: đúng 30 phòng chưa áp dụng mốc 30; từ 31 phòng mới áp dụng. Các mốc 50 và 100 tương tự.',
              )}
            </small>
          </fieldset>
          <fieldset disabled={busy} className="manager-plan-pricing-fields">
            <legend>{labelUi('Tính thử giá gói')}</legend>
            <div className="manager-invoice-form-row">
              <label>
                {labelUi('Số phòng tính thử')}
                <input
                  aria-label={labelUi('Số phòng tính thử')}
                  type="number"
                  min="1"
                  max={plan.maxRooms ?? 1000000}
                  step="1"
                  value={rooms}
                  onChange={(event) => setRooms(event.target.value)}
                />
              </label>
              <label>
                {labelUi('Chu kỳ')}
                <select
                  aria-label={labelUi('Chu kỳ tính thử')}
                  value={cycle}
                  onChange={(event) => setCycle(event.target.value)}
                >
                  <option value="monthly">{labelUi('Theo tháng')}</option>
                  <option value="yearly">{labelUi('Theo năm')}</option>
                </select>
              </label>
            </div>
            {preview.error ? (
              <p role="status">{labelUi(preview.error)}</p>
            ) : (
              <PlanPriceBreakdown quote={preview.quote} currency={plan.currency} />
            )}
          </fieldset>
          <div className="manager-invoice-actions">
            <button type="button" className="manager-button" disabled={busy} onClick={onClose}>
              {tUi('common.cancel')}
            </button>
            <button type="submit" className="manager-button manager-button-primary" disabled={busy}>
              {busy
                ? tUi('common.saving')
                : local
                  ? labelUi('Áp dụng vào gói')
                  : labelUi('Lưu điều kiện tính giá')}
            </button>
          </div>
        </form>
      </div>
    </LegacyOverlay>
  )
}
