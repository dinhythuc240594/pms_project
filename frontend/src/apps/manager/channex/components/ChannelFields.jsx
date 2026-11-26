import { tr as labelUi } from '../../../../shared/i18n/useI18n.js'
import { Plus, Trash2 } from 'lucide-react'
import { channelSettingsDraft, otaMappingOptions, visibleChannelFields } from '../channelForms'

export function ChannelFields({ fields, values, secrets = [], onChange, mapping }) {
  return (
    <div className="channex-editor-grid">
      {visibleChannelFields(fields, values).map((field) => {
        const options = otaMappingOptions(field, values, mapping)
        const dropdown =
          field.type === 'select' ||
          Boolean(mapping?.rooms && ['room_type_code', 'rate_plan_code'].includes(field.key)) ||
          options.length > 0
        return (
          <label
            key={field.key}
            className={field.type === 'boolean' ? 'channex-channel-toggle' : ''}
          >
            {field.type === 'boolean' ? (
              <>
                <input
                  type="checkbox"
                  checked={values[field.key] === true}
                  onChange={(event) => onChange(field.key, event.target.checked)}
                />
                <span>{field.label}</span>
              </>
            ) : (
              <>
                {field.label}
                {dropdown ? (
                  <select
                    value={values[field.key] ?? ''}
                    onChange={(event) => onChange(field.key, event.target.value)}
                  >
                    <option value="">Chọn {field.label.toLocaleLowerCase()}</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    {values[field.key] &&
                      !options.some(
                        (option) => String(option.value) === String(values[field.key]),
                      ) && <option value={values[field.key]}>Đã lưu: {values[field.key]}</option>}
                  </select>
                ) : (
                  <input
                    type={field.secret ? 'password' : field.type === 'integer' ? 'number' : 'text'}
                    autoComplete={field.secret ? 'new-password' : 'off'}
                    step={field.type === 'integer' ? 1 : undefined}
                    maxLength={1000}
                    value={values[field.key] ?? ''}
                    placeholder={
                      secrets.includes(field.key)
                        ? labelUi('Đã lưu · để trống để giữ nguyên')
                        : field.label
                    }
                    onChange={(event) => onChange(field.key, event.target.value)}
                  />
                )}
                {secrets.includes(field.key) && (
                  <small>{labelUi('Thông tin bảo mật đã lưu, không hiển thị lại.')}</small>
                )}
              </>
            )}
          </label>
        )
      })}
    </div>
  )
}

export function ChannelMappings({ rows, fields, rateOptions, remote, onChange }) {
  function update(index, field, value) {
    const next = rows.map((row, position) => {
      if (position !== index) return row
      const settings = { ...row.settings, [field]: value }
      if (field === 'room_type_code') {
        settings.rate_plan_code = ''
        settings.occupancy = ''
      }
      if (field === 'rate_plan_code') {
        const rate = remote?.rooms
          ?.find((room) => room.id === settings.room_type_code)
          ?.rates?.find((plan) => plan.id === value)
        if (rate) {
          if (rate.pricingType) settings.pricing_type = rate.pricingType
          settings.readonly = rate.readonly === true
          settings.occupancy = rate.occupancies?.[0] ?? ''
        }
      }
      return { ...row, settings }
    })
    onChange(next)
  }
  return (
    <div className="channex-editor-section">
      <div className="channex-table-heading">
        <h3>{labelUi('Ghép gói giá với OTA')}</h3>
        <button
          type="button"
          className="manager-button"
          disabled={!rateOptions.length}
          onClick={() =>
            onChange([...rows, { ratePlanId: '', settings: channelSettingsDraft(fields) }])
          }
        >
          <Plus size={14} aria-hidden="true" />
          {labelUi('Thêm ghép nối')}
        </button>
      </div>
      {!rows.length && (
        <p className="channex-channel-note">
          {labelUi('Chọn gói giá Channex và phòng/gói giá tương ứng trên OTA.')}
        </p>
      )}
      {rows.map((row, index) => (
        <div
          className={`channex-channel-mapping${row.removed ? ' is-removed' : ''}`}
          key={row.id || index}
        >
          <div className="channex-channel-mapping-head">
            <strong>Ghép nối {index + 1}</strong>
            <button
              type="button"
              className="manager-icon-button"
              aria-label={
                row.removed ? `Khôi phục ghép nối ${index + 1}` : `Bỏ ghép nối ${index + 1}`
              }
              onClick={() =>
                onChange(
                  row.id
                    ? rows.map((entry, position) =>
                        position === index ? { ...entry, removed: !entry.removed } : entry,
                      )
                    : rows.filter((_, position) => position !== index),
                )
              }
            >
              {row.removed ? labelUi('Khôi phục') : <Trash2 size={15} aria-hidden="true" />}
            </button>
          </div>
          {row.removed ? (
            <p className="channex-channel-note">{labelUi('Ghép nối này sẽ được xóa khi lưu.')}</p>
          ) : (
            <>
              <label>
                {labelUi('Gói giá Channex')}
                <select
                  required
                  disabled={Boolean(row.id)}
                  value={row.ratePlanId}
                  onChange={(event) =>
                    onChange(
                      rows.map((entry, position) =>
                        position === index ? { ...entry, ratePlanId: event.target.value } : entry,
                      ),
                    )
                  }
                >
                  <option value="" disabled>
                    {labelUi('Chọn gói giá')}
                  </option>
                  {rateOptions.map((rate) => (
                    <option key={rate.id} value={rate.id}>
                      {rate.name}
                      {rate.occupancy != null ? ` · ${rate.occupancy} khách` : ''}
                    </option>
                  ))}
                </select>
                {row.id && (
                  <small>
                    {labelUi('Muốn đổi gói giá: bỏ ghép nối này và thêm ghép nối mới.')}
                  </small>
                )}
              </label>
              <ChannelFields
                fields={fields}
                values={row.settings}
                secrets={row.secrets}
                mapping={remote}
                onChange={(field, value) => update(index, field, value)}
              />
            </>
          )}
        </div>
      ))}
    </div>
  )
}
