import { phonePattern } from '../../../../shared/lib/phone.js'
import { emailPattern, taxIdPattern } from '../../../../shared/lib/validation.js'
import { useMemo, useRef, useState } from 'react'
import { Building2, CheckCircle2, Globe2, Save } from 'lucide-react'
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { usePms } from '../../data/usePms'
import { useDraftGuard } from '../../../../shared/drafts/DraftGuardProvider.jsx'
import './BusinessSettings.css'
import { businessProfileInput } from './businessProfileForm.js'
import { hotelTimezoneOptions } from './hotelTimezones.js'

const PROFILE_FIELDS = [
  ['phone', 'Số điện thoại liên hệ', 'tel', 40],
  ['contactEmail', 'Email liên hệ', 'email', 254],
  ['website', 'Website', 'url', 2048],
  ['logoUrl', 'URL logo (HTTPS)', 'url', 2048],
  ['taxCode', 'Mã số thuế', 'text', 80],
  ['bankName', 'Ngân hàng', 'text', 160],
  ['bankAccount', 'Số tài khoản ngân hàng', 'text', 80],
  ['bankAccountName', 'Tên chủ tài khoản', 'text', 160],
]

function ProfileSection({ icon: Icon, title, children }) {
  return (
    <section className="pms-business-panel">
      <div className="pms-business-panel-heading">
        <span className="pms-business-panel-icon">
          <Icon size={17} aria-hidden="true" />
        </span>
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  )
}

function FormNotice({ error, message }) {
  return (
    <>
      {error && (
        <p className="pms-business-notice is-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="pms-business-notice" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          {labelUi(message)}
        </p>
      )}
    </>
  )
}

export function BusinessProfile() {
  useI18n()
  const { settings, saveSettings, access } = usePms()
  const [draft, setDraft] = useState(() => ({
    ...Object.fromEntries(PROFILE_FIELDS.map(([key]) => [key, settings[key] || ''])),
    name: settings.name || '',
    address: settings.address || '',
    timezone: settings.timezone || 'Asia/Ho_Chi_Minh',
    defaultLanguage: settings.defaultLanguage || 'vi',
  }))
  const timezones = useMemo(() => hotelTimezoneOptions(draft.timezone), [draft.timezone])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [logoError, setLogoError] = useState('')
  const saving = useRef(false)
  const canWrite = access('settings.write').allowed
  const change = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setMessage('')
    setError('')
  }
  const save = async (event) => {
    event.preventDefault()
    if (saving.current || !canWrite) return
    saving.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await saveSettings(businessProfileInput(draft))
      setDraft((current) =>
        Object.fromEntries(Object.keys(current).map((key) => [key, result[key] ?? current[key]])),
      )
      setMessage('Đã lưu hồ sơ khách sạn.')
    } catch (err) {
      setError(err.message)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  let logoUrl = ''
  try {
    const value = draft.logoUrl.trim()
    const url = new URL(value)
    if (
      value.length <= 2048 &&
      /^https:\/\//i.test(value) &&
      ![...value].some(
        (char) =>
          /\s/.test(char) || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) &&
      !/^https:\/\/[^/?#]*@/i.test(value) &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password
    )
      logoUrl = value
  } catch {
    /* Preview appears only for a valid HTTPS URL. */
  }

  const renderFields = (fields) =>
    fields.map(([key, label, type, maximum]) => (
      <label className="pms-business-field" key={key}>
        <span>{labelUi(label)}</span>
        <input
          type={type}
          pattern={
            key === 'phone'
              ? phonePattern
              : key === 'contactEmail'
                ? emailPattern
                : key === 'taxCode'
                  ? taxIdPattern
                  : undefined
          }
          maxLength={maximum}
          value={draft[key]}
          onChange={(event) => {
            if (key !== 'phone' || !/[^0-9+ .()-]/.test(event.target.value))
              change(key, event.target.value)
          }}
          placeholder={key === 'logoUrl' ? 'https://...' : undefined}
        />
      </label>
    ))

  return (
    <form className="pms-business-settings" onSubmit={save} aria-busy={busy}>
      <header className="pms-business-heading">
        <h2>{tUi('settings.hotelProfile')}</h2>
      </header>

      <fieldset disabled={busy || !canWrite}>
        <ProfileSection icon={Building2} title={tUi('settings.profileTab')}>
          <div className="pms-business-form-grid">
            <label className="pms-business-field">
              <span>
                {tUi('settings.hotelName')}{' '}
                <span className="pms-business-required" aria-hidden="true">
                  *
                </span>
              </span>
              <input
                type="text"
                required
                maxLength={160}
                value={draft.name}
                onChange={(event) => change('name', event.target.value)}
              />
            </label>
            <label className="pms-business-field">
              <span>{tUi('settings.baseCurrency')}</span>
              <input type="text" value={settings.currency || 'VND'} readOnly />
            </label>
            <label className="pms-business-field pms-business-field-wide">
              <span>{tUi('common.address')}</span>
              <input
                type="text"
                maxLength={500}
                value={draft.address}
                onChange={(event) => change('address', event.target.value)}
              />
            </label>
            <label className="pms-business-field">
              <span>
                {tUi('settings.timezone')}{' '}
                <span className="pms-business-required" aria-hidden="true">
                  *
                </span>
              </span>
              <select
                required
                value={draft.timezone}
                onChange={(event) => change('timezone', event.target.value)}
              >
                {timezones.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </ProfileSection>

        <ProfileSection icon={Globe2} title={tUi('inventorySettings.contactInfo')}>
          <div className="pms-business-form-grid">{renderFields(PROFILE_FIELDS.slice(0, 4))}</div>
          {logoUrl &&
            (logoError === logoUrl ? (
              <p className="pms-business-hint" role="status">
                {tUi('settings.logoError')}
              </p>
            ) : (
              <div className="pms-business-logo-preview">
                <img
                  key={logoUrl}
                  src={logoUrl}
                  alt={`Logo ${draft.name || tUi('common.hotelLower')}`}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  onError={() => setLogoError(logoUrl)}
                />
              </div>
            ))}
          {draft.logoUrl.trim() && !logoUrl && (
            <p className="pms-business-hint">{tUi('settings.logoHint')}</p>
          )}
        </ProfileSection>

        <div className="pms-business-footer">
          <button type="submit" className="pms-business-save">
            <Save size={16} aria-hidden="true" />
            {busy ? tUi('common.saving') : tUi('profile.save')}
          </button>
        </div>
      </fieldset>
      <FormNotice error={error} message={message} />
      {!canWrite && (
        <p className="pms-business-readonly" role="status">
          {tUi('settings.profileReadOnly')}
        </p>
      )}
    </form>
  )
}

export function BusinessPolicies() {
  useI18n()
  const { settings, saveSettings, access } = usePms()
  // Baseline is the initial or last successfully saved policy; dirty compares against it.
  const [draft, setDraft] = useState(() => ({
    checkInTime: settings.checkInTime,
    checkOutTime: settings.checkOutTime,
    policies: settings.policies || '',
  }))
  const baseline = useRef(draft)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const canWrite = access('settings.write').allowed
  useDraftGuard({
    dirty: () =>
      ['checkInTime', 'checkOutTime', 'policies'].some(
        (key) => draft[key] !== baseline.current[key],
      ),
    pending: () => working.current,
    onDiscard: () => {
      setDraft(baseline.current)
      setMessage('')
      setError('')
    },
  })
  const save = async (event) => {
    event.preventDefault()
    if (working.current || !canWrite) return
    working.current = true
    setBusy(true)
    setMessage('')
    setError('')
    const submitted = { ...draft }
    try {
      if (
        ![submitted.checkInTime, submitted.checkOutTime].every((value) =>
          /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value),
        )
      )
        throw new Error('Giờ cần dạng HH:mm, từ 00:00 đến 23:59.')
      await saveSettings(submitted)
      baseline.current = submitted
      setMessage('Đã lưu chính sách nhận/trả phòng.')
    } catch (err) {
      setError(err.message)
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  return (
    <form className="pms-business-settings" onSubmit={save} aria-busy={busy} data-workspace-draft>
      <header className="pms-business-heading">
        <h2>{tUi('settings.checkInPolicy')}</h2>
      </header>
      <fieldset disabled={busy || !canWrite}>
        <section className="pms-business-panel">
          <div className="pms-business-form-grid">
            <label className="pms-business-field" htmlFor="policy-checkin">
              <span>
                {tUi('settings.checkInTime')}{' '}
                <span className="pms-business-required" aria-hidden="true">
                  *
                </span>
              </span>
              <input
                id="policy-checkin"
                type="text"
                pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
                maxLength={5}
                placeholder="HH:mm"
                title="HH:mm"
                required
                value={draft.checkInTime}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, checkInTime: event.target.value }))
                }
              />
            </label>
            <label className="pms-business-field" htmlFor="policy-checkout">
              <span>
                {tUi('settings.checkOutTime')}{' '}
                <span className="pms-business-required" aria-hidden="true">
                  *
                </span>
              </span>
              <input
                id="policy-checkout"
                type="text"
                pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
                maxLength={5}
                placeholder="HH:mm"
                title="HH:mm"
                required
                value={draft.checkOutTime}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, checkOutTime: event.target.value }))
                }
              />
            </label>
          </div>
        </section>
        <section className="pms-business-panel">
          <label className="pms-business-field" htmlFor="policy-content">
            <span>{tUi('settings.policyContent')}</span>
            <textarea
              id="policy-content"
              rows={8}
              maxLength={4000}
              value={draft.policies || ''}
              onChange={(event) =>
                setDraft((current) => ({ ...current, policies: event.target.value }))
              }
              aria-describedby="policy-content-hint"
            />
          </label>
          <p className="pms-business-hint" id="policy-content-hint">
            {tUi('settings.policyHint')}
          </p>
        </section>
        <div className="pms-business-footer">
          <button type="submit" className="pms-business-save">
            <Save size={16} aria-hidden="true" />
            {busy ? tUi('common.saving') : tUi('settings.savePolicy')}
          </button>
        </div>
      </fieldset>
      <FormNotice error={error} message={message} />
      {!canWrite && (
        <p className="pms-business-readonly" role="status">
          {tUi('settings.policyReadOnly')}
        </p>
      )}
    </form>
  )
}
