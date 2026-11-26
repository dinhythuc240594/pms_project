import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Building2, LoaderCircle, X } from 'lucide-react'
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useDraftGuard } from '../../../../shared/drafts/DraftGuardProvider.jsx'
import { HOTEL_CURRENCIES, isHotelCurrency } from '../../../../shared/lib/currencies.js'
import { phoneInput, phonePattern } from '../../../../shared/lib/phone.js'
import {
  emailInput,
  emailPattern,
  taxIdInput,
  taxIdPattern,
} from '../../../../shared/lib/validation.js'
import { VIETNAM_PROVINCES, isVietnamProvince } from '../../../../shared/lib/vietnamProvinces.js'
import LegacyOverlay from '../../../pms/components/LegacyOverlay.jsx'
import { usePms } from '../../../pms/data/usePms.js'
import OwnerAccountDetails from './OwnerAccountDetails.jsx'
import { hotelDraft, hotelFields, hotelNotesLimit, hotelProfileInput } from './hotelProfileForm.js'
import './CreateHotelDialog.css'

const formId = 'hotel-create-form'
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(9,24,40,.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  overflow: 'hidden',
  boxSizing: 'border-box',
}
const initialDraft = { ...hotelDraft(), ownerName: '', ownerEmail: '', ownerPassword: '' }
const ownerFields = {
  ownerName: ['Họ tên Owner', 160],
  ownerEmail: ['Email đăng nhập Owner', 254],
  ownerPassword: ['Mật khẩu Owner', 128],
}
const fieldProps = {
  name: { required: true, pattern: '.*\\S.*' },
  currency: { required: true },
  contactEmail: { type: 'email', pattern: emailPattern },
  contactPhone: { type: 'tel', pattern: phonePattern },
  taxId: { inputMode: 'numeric', pattern: taxIdPattern },
  ownerName: { required: true, pattern: '.*\\S.*' },
  ownerEmail: { required: true, type: 'email', pattern: emailPattern, autoComplete: 'off' },
  ownerPassword: { required: true, type: 'password', minLength: 12, autoComplete: 'new-password' },
}
const helpers = {
  currency: 'manager.customers.create.currencyHint',
  ownerPassword: 'manager.customers.create.passwordHint',
  customerNotes: 'manager.customers.create.notesHint',
}
const profileFields = ['name', 'currency', 'city', 'address', 'taxId']
const contactFields = ['contactName', 'contactPhone', 'contactEmail']
const isActiveOwnerAccount = (account) =>
  account?.active === true &&
  account.memberships?.some(
    (membership) => membership.role === 'HOTEL_OWNER' && membership.active === true,
  )
const fieldId = (key) => `${formId}-${key}`
const hintId = (key) =>
  key === 'ownerUserId' ? 'customer-account-search-hint' : `${fieldId(key)}-hint`
const errorId = (key) => `${fieldId(key)}-error`
const fieldError = (key, values) => ({ key: `manager.customers.create.validation.${key}`, values })
const formatChecks = {
  contactEmail: [emailInput, 'contactEmailInvalid'],
  contactPhone: [phoneInput, 'phoneInvalid'],
  taxId: [taxIdInput, 'taxIdInvalid'],
  ownerEmail: [emailInput, 'ownerEmailInvalid'],
}

function validateField(key, control, selectedAccount) {
  const { value, maxLength, validity } = control
  if (key === 'ownerUserId')
    return isActiveOwnerAccount(selectedAccount) ? null : fieldError('ownerRequired')
  if (key === 'currency') return isHotelCurrency(value) ? null : fieldError('currencyInvalid')
  if (key === 'city') return !value || isVietnamProvince(value) ? null : fieldError('cityInvalid')
  if (maxLength > 0 && value.length > maxLength && key !== 'ownerPassword') {
    return fieldError('tooLong', { max: maxLength })
  }
  if (key === 'name' && !value.trim()) return fieldError('hotelNameRequired')
  if (key === 'ownerName' && !value.trim()) return fieldError('ownerNameRequired')
  if (key === 'ownerEmail' && !value) return fieldError('ownerEmailRequired')
  if (key === 'ownerPassword') {
    if (!value) return fieldError('passwordRequired')
    if (value.length < control.minLength || value.length > maxLength)
      return fieldError('passwordLength')
  }
  if (value && formatChecks[key]) {
    const [validate, error] = formatChecks[key]
    if (validity.typeMismatch || validity.patternMismatch) return fieldError(error)
    try {
      validate(value)
    } catch {
      return fieldError(error)
    }
  }
  return null
}

function apiErrorField(failure, activeFields, input) {
  if (activeFields.includes(failure.details?.field)) return failure.details.field
  const codeFields = {
    invalid_currency: 'currency',
    invalid_phone: 'contactPhone',
    invalid_tax_id: 'taxId',
    email_exists: 'ownerEmail',
    invalid_password: 'ownerPassword',
    invalid_owner: 'ownerUserId',
    not_found: 'ownerUserId',
    invalid_contact: failure.message?.match(/^(\w+) phải là chuỗi tối đa /)?.[1],
    invalid_name: input.ownerUserId ? 'name' : undefined,
    invalid_email: input.ownerUserId
      ? 'contactEmail'
      : input.contactEmail
        ? undefined
        : 'ownerEmail',
  }
  const field = codeFields[failure.code]
  return activeFields.includes(field) ? field : undefined
}

function apiFieldError(failure, key, control) {
  const messages = {
    email_exists: 'ownerEmailTaken',
    invalid_password: 'passwordLength',
    invalid_email: formatChecks[key]?.[1],
    invalid_phone: 'phoneInvalid',
    invalid_tax_id: 'taxIdInvalid',
    invalid_currency: 'currencyInvalid',
  }
  if (failure.code === 'invalid_contact' && control?.maxLength > 0) {
    return fieldError('tooLong', { max: control.maxLength })
  }
  return messages[failure.code] ? fieldError(messages[failure.code]) : failure.message
}

export default function CreateHotelDialog({ onClose, onSaved }) {
  useI18n()
  const { saveTenant, searchCustomerAccounts } = usePms()
  const [draft, setDraft] = useState(initialDraft)
  const [accountMode, setAccountMode] = useState('new')
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [accountSearch, setAccountSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [focusRequest, setFocusRequest] = useState(null)
  const formRef = useRef(null)
  const bodyRef = useRef(null)
  const errorRef = useRef(null)
  const saving = useRef(false)
  const existing = accountMode === 'existing'
  const dirty =
    existing ||
    Boolean(accountSearch || selectedAccount) ||
    Object.keys(initialDraft).some((key) => initialDraft[key] !== draft[key])
  const { requestLeave } = useDraftGuard({
    dirty,
    pending: () => saving.current,
    onDiscard: onClose,
  })

  useLayoutEffect(() => {
    bodyRef.current.scrollTop = 0
  }, [])
  useLayoutEffect(() => {
    if (!focusRequest) return
    const target = focusRequest.key
      ? formRef.current.elements.namedItem(focusRequest.key)
      : errorRef.current
    target?.scrollIntoView({ block: 'center' })
    target?.focus({ preventScroll: true })
  }, [focusRequest])

  function close() {
    if (!saving.current) requestLeave(onClose)
  }
  function clearFieldError(key) {
    setErrors((previous) => (previous[key] ? { ...previous, [key]: '' } : previous))
  }
  function changeField(key, value) {
    if (key === 'contactPhone' && /[^0-9+ .()-]/.test(value)) return
    setDraft((previous) => ({ ...previous, [key]: value }))
    clearFieldError(key)
  }
  function blurField(key, control) {
    if (saving.current) return
    const error = validateField(key, control, selectedAccount)
    if (error) setErrors((previous) => ({ ...previous, [key]: error }))
  }
  function changeMode(mode) {
    setAccountMode(mode)
    setAccountSearch('')
    setSelectedAccount(null)
    setSubmitError('')
    setDraft((previous) => ({ ...previous, ownerPassword: '' }))
    setErrors((previous) => ({
      ...previous,
      ownerName: '',
      ownerEmail: '',
      ownerPassword: '',
      ownerUserId: '',
    }))
  }
  function changeSearch(value) {
    setAccountSearch(value)
    setSelectedAccount(null)
    clearFieldError('ownerUserId')
  }
  function selectAccount(account) {
    setSelectedAccount(account)
    clearFieldError('ownerUserId')
  }
  async function submit(event) {
    event.preventDefault()
    if (saving.current) return
    const activeFields = [
      ...profileFields,
      ...contactFields,
      ...(existing ? ['ownerUserId'] : Object.keys(ownerFields)),
      'customerNotes',
    ]
    const nextErrors = {}
    const submitted = {}
    for (const key of activeFields) {
      const control = event.currentTarget.elements.namedItem(key)
      const error = validateField(key, control, selectedAccount)
      if (error) nextErrors[key] = error
      if (key !== 'ownerUserId') submitted[key] = control.value
    }
    setErrors(nextErrors)
    setSubmitError('')
    const firstError = Object.keys(nextErrors)[0]
    if (firstError) {
      setFocusRequest({ key: firstError })
      return
    }
    const { ownerName, ownerEmail, ownerPassword, ...profileDraft } = submitted
    const input = { ...hotelProfileInput(profileDraft), currency: profileDraft.currency }
    if (!input.contactName.trim()) delete input.contactName
    if (!input.contactEmail) delete input.contactEmail
    Object.assign(
      input,
      existing
        ? { ownerUserId: selectedAccount.id }
        : { ownerName: ownerName.trim(), ownerEmail: emailInput(ownerEmail), ownerPassword },
    )
    saving.current = true
    setBusy(true)
    try {
      await saveTenant(input)
      onSaved(
        existing
          ? 'Đã tạo khách sạn và gán tài khoản quản lý đã chọn. Cấp gói tại Gói cước & hóa đơn để bắt đầu.'
          : 'Đã tạo khách sạn và tài khoản Owner. Cấp gói tại Gói cước & hóa đơn để bắt đầu.',
      )
    } catch (failure) {
      const key = apiErrorField(failure, activeFields, input)
      const message =
        failure.message && !(failure instanceof TypeError)
          ? failure.message
          : tUi('manager.customers.create.submitError')
      if (key)
        setErrors({
          [key]: apiFieldError(failure, key, formRef.current?.elements.namedItem(key)) || message,
        })
      else setSubmitError(message)
      setFocusRequest({ key })
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  function controlProps(key) {
    const hasHint = (helpers[key] && !errors[key]) || key === 'ownerUserId'
    return {
      id: fieldId(key),
      name: key,
      'aria-invalid': errors[key] ? true : undefined,
      'aria-describedby':
        [hasHint && hintId(key), errors[key] && errorId(key)].filter(Boolean).join(' ') ||
        undefined,
    }
  }
  function feedback(key) {
    const error = errors[key]
    if (error)
      return (
        <p id={errorId(key)} className="hotel-create-field-error" role="alert">
          {typeof error === 'string' ? error : tUi(error.key, error.values)}
        </p>
      )
    return helpers[key] ? (
      <p id={hintId(key)} className="customer-hint">
        {tUi(helpers[key])}
      </p>
    ) : null
  }
  function renderField(key, wide = false) {
    const [label, maxLength] = hotelFields[key] || ownerFields[key]
    const props = {
      ...controlProps(key),
      ...fieldProps[key],
      value: draft[key],
      onChange: (event) => changeField(key, event.target.value),
      onBlur: (event) => blurField(key, event.currentTarget),
    }
    return (
      <div
        key={key}
        className={wide ? 'hotel-create-field hotel-create-field-wide' : 'hotel-create-field'}
      >
        <label>
          <span>{labelUi(label)}</span>
          {key === 'currency' ? (
            <select {...props}>
              {HOTEL_CURRENCIES.map(({ code, label }) => (
                <option key={code} value={code}>
                  {labelUi(label)}
                </option>
              ))}
            </select>
          ) : key === 'city' ? (
            <select {...props}>
              <option value="">{labelUi('Chọn tỉnh / thành phố')}</option>
              {VIETNAM_PROVINCES.map((province) => (
                <option key={province.code} value={province.name}>
                  {province.name}
                </option>
              ))}
            </select>
          ) : (
            <input {...props} maxLength={maxLength} />
          )}
        </label>
        {feedback(key)}
      </div>
    )
  }

  const title = labelUi('Thêm khách sạn')
  return (
    <LegacyOverlay modal title={title} onClose={close} style={overlayStyle}>
      <div className="customer-dialog hotel-create-dialog">
        <header className="customer-dialog-head">
          <div className="hotel-create-heading">
            <span>
              <Building2 size={22} aria-hidden="true" />
            </span>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="manager-icon-button"
            aria-label={tUi('common.closeWindow')}
            disabled={busy}
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <section className="customer-dialog-body" ref={bodyRef}>
          {submitError && (
            <p
              ref={errorRef}
              tabIndex={-1}
              className="customer-error hotel-create-submit-error"
              role="alert"
            >
              {submitError}
            </p>
          )}
          <form
            id={formId}
            ref={formRef}
            noValidate
            aria-busy={busy || undefined}
            onSubmit={submit}
          >
            <fieldset disabled={busy} className="customer-fieldset hotel-create-sections">
              <section
                className="hotel-create-section"
                aria-labelledby="hotel-create-profile-title"
              >
                <h3 id="hotel-create-profile-title">{tUi('manager.customers.create.profile')}</h3>
                <div className="customer-form-grid">
                  {profileFields.map((key) =>
                    renderField(key, key === 'name' || key === 'address'),
                  )}
                </div>
              </section>
              <section
                className="hotel-create-section"
                aria-labelledby="hotel-create-contact-title"
              >
                <h3 id="hotel-create-contact-title">{tUi('manager.customers.create.contact')}</h3>
                <div className="customer-form-grid">
                  {contactFields.map((key) => renderField(key))}
                </div>
              </section>
              <section className="hotel-create-section" aria-labelledby="hotel-create-owner-title">
                <h3 id="hotel-create-owner-title">{labelUi('Tài khoản quản lý khách sạn')}</h3>
                <fieldset
                  className="customer-account-modes customer-form-grid"
                  aria-labelledby="hotel-create-owner-title"
                >
                  <label>
                    <input
                      type="radio"
                      name="owner-account-mode"
                      value="existing"
                      checked={existing}
                      onChange={() => changeMode('existing')}
                    />
                    {labelUi('Đã có tài khoản')}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="owner-account-mode"
                      value="new"
                      checked={!existing}
                      onChange={() => changeMode('new')}
                    />
                    {tUi('manager.customers.create.newAccount')}
                  </label>
                </fieldset>
                {existing ? (
                  <HotelOwnerPicker
                    search={accountSearch}
                    selected={selectedAccount}
                    onSearch={changeSearch}
                    onSelect={selectAccount}
                    searchAccounts={searchCustomerAccounts}
                    inputProps={controlProps('ownerUserId')}
                    error={feedback('ownerUserId')}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        blurField('ownerUserId', formRef.current.elements.namedItem('ownerUserId'))
                      }
                    }}
                  />
                ) : (
                  <>
                    <p className="customer-hint">
                      {labelUi('Email đăng nhập và thông tin liên hệ có thể khác nhau.')}
                    </p>
                    <div className="customer-form-grid">
                      {Object.keys(ownerFields).map((key) => renderField(key))}
                    </div>
                  </>
                )}
              </section>
              <section
                className="hotel-create-section hotel-create-field"
                aria-labelledby="hotel-create-notes-title"
              >
                <h3 id="hotel-create-notes-title">
                  <label htmlFor={fieldId('customerNotes')}>
                    {tUi('manager.customers.create.notes')}
                  </label>
                </h3>
                <textarea
                  {...controlProps('customerNotes')}
                  rows={3}
                  maxLength={hotelNotesLimit}
                  value={draft.customerNotes}
                  onChange={(event) => changeField('customerNotes', event.target.value)}
                  onBlur={(event) => blurField('customerNotes', event.currentTarget)}
                />
                {feedback('customerNotes')}
              </section>
            </fieldset>
          </form>
        </section>
        <footer className="customer-dialog-footer">
          <button type="button" className="manager-button" disabled={busy} onClick={close}>
            {tUi('common.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className="manager-button manager-button-primary"
            disabled={busy}
          >
            {busy ? (
              <>
                <LoaderCircle size={16} className="hotel-create-spinner" aria-hidden="true" />
                <span role="status">{tUi('manager.customers.create.submitting')}</span>
              </>
            ) : (
              labelUi('Tạo khách sạn')
            )}
          </button>
        </footer>
      </div>
    </LegacyOverlay>
  )
}

function HotelOwnerPicker({
  search,
  selected,
  onSearch,
  onSelect,
  searchAccounts,
  inputProps,
  error,
  onBlur,
}) {
  const [results, setResults] = useState({ query: '', revision: 0, users: [], error: '' })
  const [revision, setRevision] = useState(0)
  const query = search.trim()
  const canSearch = query.length >= 2
  const searching = canSearch && (results.query !== query || results.revision !== revision)
  useEffect(() => {
    if (query.length < 2) return
    let cancelled = false
    const timer = setTimeout(() => {
      searchAccounts(query)
        .then((data) => {
          if (!cancelled)
            setResults({
              query,
              revision,
              users: (data.users || []).filter(isActiveOwnerAccount),
              error: '',
            })
        })
        .catch((failure) => {
          if (!cancelled) setResults({ query, revision, users: [], error: failure.message })
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, revision, searchAccounts])

  return (
    <div className="customer-account-picker hotel-create-field" onBlur={onBlur}>
      <label>
        <span>{labelUi('Tìm tài khoản theo tên hoặc email')}</span>
        <input
          {...inputProps}
          type="search"
          maxLength={254}
          autoComplete="off"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      {error}
      <p id={hintId('ownerUserId')} className="customer-hint">
        {tUi('manager.customers.ownerOnlyHint')}
      </p>
      {searching ? (
        <p role="status">{labelUi('Đang tìm tài khoản…')}</p>
      ) : (
        canSearch && (
          <>
            {results.error ? (
              <p className="customer-error" role="alert">
                {results.error}{' '}
                <button
                  type="button"
                  className="manager-button"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  {tUi('common.retry')}
                </button>
              </p>
            ) : results.users.length ? (
              <ul
                className="customer-account-results"
                aria-label={labelUi('Kết quả tìm tài khoản')}
              >
                {results.users.map((account) => (
                  <li key={account.id}>
                    <button
                      type="button"
                      className="customer-account-option"
                      aria-pressed={selected?.id === account.id}
                      onClick={() => onSelect(account)}
                    >
                      <strong>{account.name}</strong>
                      <span>{account.email}</span>
                      <small>
                        {selected?.id === account.id
                          ? labelUi('Đã chọn')
                          : labelUi('Chọn tài khoản')}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status">{tUi('manager.customers.create.noMatchingOwner')}</p>
            )}
          </>
        )
      )}
      {selected && <OwnerAccountDetails account={selected} />}
    </div>
  )
}
