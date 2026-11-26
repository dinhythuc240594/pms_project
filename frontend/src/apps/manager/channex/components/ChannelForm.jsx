import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import { Check, Info, RadioTower, Save, ShieldCheck, X } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import {
  channelMappingInput,
  channelSettingsDraft,
  channelSettingsInput,
  uncertainChannelWrite,
} from '../channelForms'
import { environmentLabel } from '../presentation'
import { ChannelFields, ChannelMappings } from './ChannelFields'
import ChannelAirbnb from './ChannelAirbnb'

export default function ChannelForm({
  account,
  property,
  operations,
  canWrite = true,
  data,
  onClose,
  onSaved,
  onReload,
  onBusy,
}) {
  useI18n()
  const pms = usePms()
  const { probeChannexChannel, saveChannexChannel } = operations || pms
  const channel = data.channel,
    editing = Boolean(channel)
  const adapters = editing
    ? [data.adapter]
    : data.adapters.filter((item) => ['ota', 'meta'].includes(item.kind))
  const unavailableAdapters = data.unavailableAdapters || []
  const [code, setCode] = useState(channel?.code || ''),
    [name, setName] = useState(channel?.name || ''),
    [groupId, setGroupId] = useState(data.groups?.[0]?.id || '')
  const adapter = adapters.find((item) => item.code === code)
  const [settings, setSettings] = useState(() =>
    channelSettingsDraft(data.adapter?.fields, channel?.settings),
  )
  const [mappings, setMappings] = useState(() =>
    (channel?.mappings || []).map((row) => ({
      ...row,
      settings: channelSettingsDraft(data.adapter?.mappingFields, row.settings),
    })),
  )
  const [remote, setRemote] = useState(null),
    [tested, setTested] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false)
  const mounted = useRef(true),
    working = useRef(false),
    closeButton = useRef(null)
  const readonly = !canWrite || (editing && (channel.active || !channel.editable))
  useEffect(() => {
    mounted.current = true
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      mounted.current = false
    }
  }, [])
  function selectAdapter(value) {
    const next = adapters.find((item) => item.code === value)
    setCode(value)
    setSettings(channelSettingsDraft(next?.fields))
    setMappings([])
    setRemote(null)
    setTested(false)
    setError('')
  }
  function changeSettings(field, value) {
    setSettings((previous) => ({ ...previous, [field]: value }))
    setTested(false)
    setRemote(null)
  }
  async function run(callback, writes = false) {
    if (working.current || uncertain || !canWrite) return
    working.current = true
    setBusy(true)
    onBusy(true)
    setError('')
    try {
      await callback()
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message || 'Chưa hoàn tất thao tác.')
        if (writes) setUncertain(uncertainChannelWrite(failure))
      }
    } finally {
      working.current = false
      if (mounted.current) {
        setBusy(false)
        onBusy(false)
      }
    }
  }
  function input() {
    return {
      code,
      settings: channelSettingsInput(
        adapter?.fields,
        settings,
        editing ? channelSettingsDraft(adapter.fields, channel.settings) : undefined,
      ),
      ...(editing ? { channelId: channel.id, revision: channel.revision } : {}),
    }
  }
  async function testConnection() {
    await run(async () => {
      const result = await probeChannexChannel(account.id, property.id, 'test_connection', input())
      if (!result.success) throw new Error(result.message || 'Thông tin kết nối chưa đúng.')
      const mapping = await probeChannexChannel(account.id, property.id, 'mapping_details', input())
      if (mounted.current) {
        setRemote(mapping)
        setTested(true)
      }
    })
  }
  function save(event) {
    event.preventDefault()
    if (readonly || !adapter || (!editing && !tested)) return
    run(async () => {
      const changedSettings = channelSettingsInput(
        adapter.fields,
        settings,
        editing ? channelSettingsDraft(adapter.fields, channel.settings) : undefined,
      )
      const changedMappings = channelMappingInput(
        mappings,
        adapter.mappingFields,
        channel?.mappings,
      )
      const payload = { name: name.trim() }
      if (!editing || Object.keys(changedSettings).length) payload.settings = changedSettings
      if (!editing || changedMappings.length) payload.mappings = changedMappings
      if (editing) {
        payload.id = channel.id
        payload.revision = channel.revision
      } else {
        payload.code = code
        payload.groupId = groupId
      }
      const result = await saveChannexChannel(account.id, property.id, payload)
      if (mounted.current) {
        if (result.pending) setUncertain('pending')
        else
          onSaved(
            editing
              ? 'Đã lưu cấu hình kênh OTA.'
              : 'Đã tạo kết nối OTA. Kiểm tra và kích hoạt để bắt đầu đồng bộ.',
          )
      }
    }, true)
  }
  return (
    <>
      <div className="channex-editor-heading">
        <span className="channex-editor-icon">
          <RadioTower size={21} aria-hidden="true" />
        </span>
        <div>
          <span className="channex-editor-eyebrow">{labelUi('Kết nối kênh bán phòng')}</span>
          <h2>{editing ? channel.name : labelUi('Thêm kênh OTA')}</h2>
          <p>
            {property.name} · {environmentLabel(account.environment)}
          </p>
        </div>
        <button
          ref={closeButton}
          type="button"
          className="manager-icon-button"
          aria-label={labelUi('Đóng cấu hình kênh')}
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <form onSubmit={save}>
        {error && (
          <div className="channex-editor-error" role="alert">
            <p>{error}</p>
            {editing && !uncertain && (
              <button type="button" className="manager-button" onClick={onReload}>
                {labelUi('Đóng & tải lại cấu hình')}
              </button>
            )}
          </div>
        )}
        {uncertain && (
          <div className="channex-editor-error" role="status">
            <p>
              {uncertain === 'pending'
                ? labelUi(
                    'Channex đã nhận yêu cầu và đang xử lý. Tải lại danh sách để kiểm tra kết quả trước khi tạo hoặc gửi lại.',
                  )
                : labelUi('Kết quả lưu chưa xác định. Tải lại kênh để kiểm tra trước khi gửi lại.')}
            </p>
            <button type="button" className="manager-button" onClick={onReload}>
              {labelUi('Đóng & tải lại kênh')}
            </button>
          </div>
        )}
        <fieldset disabled={busy || uncertain} className="channex-editor-fields">
          {!editing && (
            <>
              <label>
                {labelUi('Kênh OTA')}
                <select
                  required
                  value={code}
                  onChange={(event) => selectAdapter(event.target.value)}
                >
                  <option value="" disabled>
                    {labelUi('Chọn kênh được Channex hỗ trợ')}
                  </option>
                  {adapters.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                  {unavailableAdapters.map((item) => (
                    <option key={item.code} value={item.code} disabled>
                      {item.name} · Chưa hỗ trợ cấu hình
                    </option>
                  ))}
                </select>
              </label>
              {unavailableAdapters.length > 0 && (
                <p className="channex-channel-note" role="status">
                  {labelUi(
                    'Một số kênh có cấu hình chưa được LOHA hỗ trợ và đang được khóa lựa chọn. Các kênh còn lại vẫn có thể kết nối.',
                  )}
                </p>
              )}
              {!adapters.length && (
                <p className="channex-channel-note" role="status">
                  {labelUi('Chưa có kênh OTA nào có thể cấu hình với nguồn này.')}
                </p>
              )}
            </>
          )}
          {adapter && (
            <>
              <fieldset disabled={readonly} className="channex-editor-fields">
                <label>
                  {labelUi('Tên kết nối')}
                  <input
                    required
                    maxLength={255}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={`Ví dụ: ${property.name} – ${adapter.name}`}
                  />
                </label>
                {!editing && (
                  <label>
                    {labelUi('Nhóm Channex')}
                    <select
                      required
                      value={groupId}
                      onChange={(event) => setGroupId(event.target.value)}
                    >
                      <option value="" disabled>
                        {labelUi('Chọn nhóm')}
                      </option>
                      {data.groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!adapter.oauth && (
                  <>
                    <div className="channex-editor-section">
                      <h3>{labelUi('Thông tin tài khoản OTA')}</h3>
                      <ChannelFields
                        fields={adapter.fields}
                        values={settings}
                        secrets={channel?.secrets}
                        onChange={changeSettings}
                      />
                      {editing && channel.mappings?.length > 0 && (
                        <p className="channex-channel-note">
                          {labelUi(
                            'Muốn đổi mã khách sạn hoặc thông tin tài khoản OTA: bỏ toàn bộ ghép nối trước khi lưu. Mật khẩu có thể đổi và giữ ghép nối.',
                          )}
                        </p>
                      )}
                    </div>
                    <div className="channex-channel-probe">
                      <button
                        type="button"
                        className="manager-button"
                        disabled={busy || readonly}
                        onClick={testConnection}
                      >
                        <ShieldCheck size={15} aria-hidden="true" />
                        {busy ? labelUi('Đang kiểm tra…') : labelUi('Kiểm tra & lấy phòng OTA')}
                      </button>
                      {tested && (
                        <span className="channex-status channex-status--active">
                          <Check size={12} aria-hidden="true" />
                          {labelUi('Kết nối hợp lệ')}
                        </span>
                      )}
                    </div>
                    <ChannelMappings
                      rows={mappings}
                      fields={adapter.mappingFields}
                      rateOptions={data.rateOptions}
                      remote={remote}
                      onChange={setMappings}
                    />
                  </>
                )}
              </fieldset>
              {readonly && (
                <p className="channex-editor-hint">
                  <Info size={15} aria-hidden="true" />
                  {!canWrite
                    ? labelUi(
                        'Bạn đang ở chế độ chỉ xem. Chủ khách sạn có thể thay đổi kết nối OTA.',
                      )
                    : !channel.editable
                      ? labelUi('Kết nối dùng chung nhiều khách sạn: chỉ xem tại màn hình này.')
                      : adapter.oauth
                        ? labelUi(
                            'Airbnb đang đồng bộ. Bỏ ghép các listing trước khi tắt đồng bộ; chỉ thêm listing khi kênh đã tắt.',
                          )
                        : labelUi(
                            'Kênh đang đồng bộ. Tắt đồng bộ trước khi sửa cấu hình và ghép nối.',
                          )}
                </p>
              )}
              {adapter.oauth && (
                <ChannelAirbnb
                  account={account}
                  property={property}
                  operations={operations}
                  canWrite={canWrite}
                  channel={channel}
                  name={name}
                  groupId={groupId}
                  rateOptions={data.rateOptions}
                  readonly={readonly}
                  onSaved={onSaved}
                  onReload={onReload}
                  onBusy={(value) => {
                    onBusy(value)
                    setBusy(value)
                  }}
                />
              )}
            </>
          )}
        </fieldset>
        <div className="channex-editor-actions">
          <button type="button" className="manager-button" disabled={busy} onClick={onClose}>
            {readonly ? tUi('common.close') : tUi('common.cancel')}
          </button>
          {adapter && !adapter.oauth && !readonly && (
            <button
              type="submit"
              className="manager-button manager-button-primary"
              disabled={busy || uncertain || (!editing && !tested)}
            >
              <Save size={15} aria-hidden="true" />
              {busy
                ? labelUi('Đang xử lý…')
                : editing
                  ? labelUi('Lưu cấu hình')
                  : labelUi('Tạo kết nối')}
            </button>
          )}
        </div>
      </form>
    </>
  )
}
