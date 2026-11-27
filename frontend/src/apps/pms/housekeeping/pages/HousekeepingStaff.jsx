import DateInput from '../../../../shared/components/DateInput.jsx'
import { formatDate } from '../../../../shared/lib/date.js'
import { phoneInput, phonePattern } from '../../../../shared/lib/phone.js'
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Info,
  Link2,
  Pencil,
  Phone,
  Plus,
  Save,
  Search,
  User,
  UserPlus,
  Users,
} from 'lucide-react'
import { usePms } from '../../data/usePms'
import { today } from '../../data/model'
import { shiftCreationDates } from '../shiftSchedule'
import FormDialog from '../../components/FormDialog'
import '../../components/DomainForms.css'
import './HousekeepingStaff.css'

const blankStaff = () => ({ name: '', phone: '', userId: '', active: true })
const blankShift = (date) => ({
  staffId: '',
  date,
  startTime: '08:00',
  endTime: '16:00',
  note: '',
  active: true,
})

export default function HousekeepingStaff() {
  const pms = usePms()
  return <StaffWorkspace key={`${pms.tenantId}:${pms.settings.timezone}`} pms={pms} />
}

function StaffWorkspace({ pms }) {
  useI18n()
  const {
    housekeepingStaff: staff = [],
    housekeepingShifts: shifts = [],
    users = [],
    settings,
    tenantId,
    access,
    saveHousekeepingStaff,
    saveHousekeepingShift,
  } = pms
  const [search, setSearch] = useState('')
  const [staffForm, setStaffForm] = useState(blankStaff)
  const [staffEditorOpen, setStaffEditorOpen] = useState(false)
  const [shiftForm, setShiftForm] = useState(() => blankShift(today(settings.timezone)))
  const [shiftEditorOpen, setShiftEditorOpen] = useState(false)
  const [shiftPeriod, setShiftPeriod] = useState('day')
  const [date, setDate] = useState(today(settings.timezone))
  const [dateValid, setDateValid] = useState(true)
  const [loaded, setLoaded] = useState({ date: '', shifts: [], source: null, error: '' })
  const requests = useRef(pms.requestTenant)
  useEffect(() => {
    requests.current = pms.requestTenant
  }, [pms.requestTenant])
  useEffect(() => {
    let current = true
    if (!date || !dateValid)
      return () => {
        current = false
      }
    requests
      .current('/housekeeping/shifts?' + new URLSearchParams({ date }))
      .then((data) => {
        if (current) setLoaded({ date, shifts: data.shifts, source: shifts, error: '' })
      })
      .catch((err) => {
        if (current) setLoaded({ date, shifts: [], source: shifts, error: err.message })
      })
    return () => {
      current = false
    }
  }, [date, dateValid, tenantId, shifts])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const canManage = access('housekeeping.manage').allowed
  const accounts =
    pms.housekeepingAccounts ||
    users.filter(
      (account) =>
        account.active !== false &&
        account.memberships?.some(
          (member) =>
            member.tenantId === tenantId &&
            member.role === 'HOUSEKEEPING' &&
            member.active !== false,
        ),
    )
  const visibleStaff = staff.filter((row) =>
    `${row.name} ${row.phone}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')),
  )
  const shiftLoading = Boolean(date) && (loaded.date !== date || loaded.source !== shifts)
  const visibleShifts =
    dateValid && loaded.date === date && !shiftLoading
      ? [...loaded.shifts].sort((a, b) => a.startTime.localeCompare(b.startTime))
      : []
  const staffName = (id) => staff.find((row) => row.id === id)?.name || 'Nhân viên'
  const shiftDates = shiftCreationDates(shiftForm.date, shiftForm.id ? 'day' : shiftPeriod)
  async function save(action, message, after) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await action()
      after?.(result)
      setNotice(typeof message === 'function' ? message(result) : message)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  function editStaff(row) {
    setStaffForm(
      row
        ? {
            id: row.id,
            name: row.name,
            phone: row.phone,
            userId: row.userId || '',
            active: row.active,
          }
        : blankStaff(),
    )
    setError('')
    setNotice('')
    setStaffEditorOpen(true)
  }
  function closeStaffEditor() {
    if (busy) return
    setStaffEditorOpen(false)
    setStaffForm(blankStaff())
    setError('')
  }
  function editShift(row) {
    setShiftForm(row ? { ...row } : blankShift(date || today(settings.timezone)))
    setShiftPeriod('day')
    setError('')
    setNotice('')
    setShiftEditorOpen(true)
  }
  function closeShiftEditor() {
    if (busy) return
    setShiftEditorOpen(false)
    setShiftForm(blankShift(date || today(settings.timezone)))
    setShiftPeriod('day')
    setError('')
  }

  return (
    <div className="pms-domain-page hk-staff-page">
      <header className="hk-page-heading">
        <div className="hk-team-actions">
          <span className="hk-team-count">
            <Users size={16} aria-hidden="true" />
            {staff.length} {tUi('common.staffLower')}
          </span>
          {canManage && (
            <button type="button" className="primary" disabled={busy} onClick={() => editStaff()}>
              <UserPlus size={16} aria-hidden="true" />
              {tUi('hk.addStaff')}
            </button>
          )}
        </div>
      </header>
      {error && !staffEditorOpen && !shiftEditorOpen && (
        <p className="domain-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="hk-success" role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          {labelUi(notice)}
        </p>
      )}
      <div className="hk-team-grid">
        <section className="domain-panel hk-roster" aria-labelledby="hk-roster-title">
          <div className="hk-section-heading">
            <div>
              <h2 id="hk-roster-title">{tUi('hk.team')}</h2>
              <p>
                {staff.filter((row) => row.active).length} {tUi('hk.activeStaffCount')}
              </p>
            </div>
          </div>
          <label className="hk-search">
            <span className="hk-visually-hidden">{tUi('hk.searchStaff')}</span>
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tUi('hk.searchStaffPlaceholder')}
            />
          </label>
          {!visibleStaff.length && (
            <div className="hk-empty" role="status">
              <Users size={26} aria-hidden="true" />
              <strong>{staff.length ? tUi('hk.staffNotFound') : tUi('hk.noStaff')}</strong>
              <p>{staff.length ? tUi('hk.searchStaffHint') : tUi('hk.addStaffHint')}</p>
            </div>
          )}
          <div className="hk-staff-list">
            {visibleStaff.map((row) => (
              <article
                key={row.id}
                className={'hk-staff-row' + (staffForm.id === row.id ? ' is-editing' : '')}
                aria-label={'Nhân viên ' + row.name}
              >
                <div className="hk-person-heading">
                  <span className="hk-avatar">
                    <User size={20} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>{row.name}</h3>
                    <span className={'hk-status' + (row.active ? ' is-active' : '')}>
                      <span aria-hidden="true" />
                      {row.active ? tUi('common.active') : tUi('common.inactive')}
                    </span>
                  </div>
                </div>
                <div className="hk-person-details">
                  <p>
                    <Phone size={14} aria-hidden="true" />
                    {row.phone || tUi('hk.noPhone')}
                  </p>
                  <p>
                    <Link2 size={14} aria-hidden="true" />
                    {row.userId ? tUi('hk.accountLinked') : tUi('hk.accountNotLinked')}
                  </p>
                </div>
                {canManage && (
                  <div className="hk-person-actions">
                    <button
                      type="button"
                      className="hk-text-button"
                      disabled={busy}
                      aria-label={'Sửa thông tin ' + row.name}
                      onClick={() => editStaff(row)}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      {tUi('hk.editInfo')}
                    </button>
                    <button
                      type="button"
                      className={'hk-text-button' + (row.active ? ' hk-deactivate' : '')}
                      disabled={busy}
                      aria-label={(row.active ? 'Ngừng hoạt động ' : 'Kích hoạt ') + row.name}
                      onClick={() =>
                        save(
                          () => saveHousekeepingStaff({ id: row.id, active: !row.active }),
                          'Đã cập nhật trạng thái nhân viên.',
                        )
                      }
                    >
                      {row.active ? tUi('common.inactive') : tUi('common.activate')}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>
      {canManage && staffEditorOpen && (
        <FormDialog
          title={staffForm.id ? tUi('hk.editStaff') : tUi('hk.addStaff')}
          busy={busy}
          error={error}
          onClose={closeStaffEditor}
        >
          <p className="hk-staff-editor-hint">
            {staffForm.id ? tUi('hk.editStaffHint') : tUi('hk.newStaffHint')}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              save(
                () =>
                  saveHousekeepingStaff({
                    ...staffForm,
                    phone: phoneInput(staffForm.phone),
                    userId: staffForm.userId || null,
                  }),
                'Đã lưu nhân viên.',
                () => {
                  setStaffForm(blankStaff())
                  setStaffEditorOpen(false)
                },
              )
            }}
          >
            <fieldset disabled={busy}>
              <div className="hk-staff-fields">
                <label>
                  {tUi('common.name')}{' '}
                  <span className="hk-required" aria-hidden="true">
                    *
                  </span>
                  <input
                    required
                    pattern=".*\S.*"
                    maxLength={160}
                    value={staffForm.name}
                    onChange={(event) => setStaffForm({ ...staffForm, name: event.target.value })}
                    autoComplete="name"
                    placeholder={tUi('hk.staffName')}
                  />
                </label>
                <label>
                  {tUi('common.phone')}
                  <input
                    type="tel"
                    maxLength={40}
                    pattern={phonePattern}
                    value={staffForm.phone}
                    onChange={(event) => {
                      if (!/[^0-9+ .()-]/.test(event.target.value))
                        setStaffForm({ ...staffForm, phone: event.target.value })
                    }}
                    autoComplete="tel"
                    placeholder={tUi('hk.phoneExample')}
                  />
                </label>
                <label className="hk-wide">
                  {tUi('hk.workAccount')}
                  <select
                    aria-describedby="hk-account-help"
                    value={staffForm.userId}
                    onChange={(event) => setStaffForm({ ...staffForm, userId: event.target.value })}
                  >
                    <option value="">{tUi('hk.unlinked')}</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                    {staffForm.userId &&
                      !accounts.some((account) => account.id === staffForm.userId) && (
                        <option value={staffForm.userId}>{tUi('hk.linkedAccount')}</option>
                      )}
                  </select>
                </label>
                <p id="hk-account-help" className="hk-form-hint hk-wide">
                  <Info size={15} aria-hidden="true" />
                  {tUi('hk.accountHint')}
                </p>
                <label>
                  {tUi('common.status')}
                  <select
                    value={staffForm.active ? 'active' : 'inactive'}
                    onChange={(event) =>
                      setStaffForm({ ...staffForm, active: event.target.value === 'active' })
                    }
                  >
                    <option value="active">{tUi('common.active')}</option>
                    <option value="inactive">{tUi('common.inactive')}</option>
                  </select>
                </label>
              </div>
              <div className="hk-form-actions">
                <button type="button" onClick={closeStaffEditor}>
                  {tUi('common.cancel')}
                </button>
                <button className="primary" type="submit">
                  <Save size={16} aria-hidden="true" />{' '}
                  {busy ? tUi('common.saving') : tUi('hk.saveStaff')}
                </button>
              </div>
            </fieldset>
          </form>
        </FormDialog>
      )}
      <section className="domain-panel hk-shifts" aria-labelledby="hk-shifts-title">
        <div className="hk-section-heading hk-shifts-heading">
          <div>
            <h2 id="hk-shifts-title">{tUi('hk.shift')}</h2>
            <p>{tUi('hk.shiftsIntro')}</p>
          </div>
          <div className="hk-shifts-actions">
            <label className="hk-date-filter">
              {tUi('hk.shiftViewDate')}
              <DateInput required value={date} onChange={setDate} onValidityChange={setDateValid} />
            </label>
            {canManage && (
              <button
                type="button"
                className="primary"
                disabled={busy || !dateValid}
                onClick={() => editShift()}
              >
                <Plus size={16} aria-hidden="true" />
                {tUi('hk.addShift')}
              </button>
            )}
          </div>
        </div>
        {!dateValid && (
          <p className="domain-error" role="alert">
            {labelUi('Ngày không hợp lệ.')}
          </p>
        )}
        {!shiftLoading && loaded.error && (
          <p className="domain-error" role="alert">
            {loaded.error}
          </p>
        )}
        <div
          className="hk-table-scroll"
          role="region"
          aria-label={tUi('hk.shiftTable')}
          tabIndex={0}
        >
          <table>
            <caption className="hk-visually-hidden">
              {tUi('hk.shiftForDate')} {formatDate(date)}
            </caption>
            <thead>
              <tr>
                <th scope="col">{tUi('common.staff')}</th>
                <th scope="col">{tUi('hk.hours')}</th>
                <th scope="col">{tUi('common.notes')}</th>
                <th scope="col">{tUi('common.status')}</th>
                {canManage && <th scope="col">{tUi('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {visibleShifts.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{staffName(row.staffId)}</strong>
                  </td>
                  <td>
                    <span className="hk-time">
                      <Clock3 size={14} aria-hidden="true" />
                      {row.startTime} – {row.endTime}
                    </span>
                  </td>
                  <td className="hk-shift-note">{row.note || '—'}</td>
                  <td>
                    <span className={'hk-status' + (row.active ? ' is-active' : '')}>
                      <span aria-hidden="true" />
                      {row.active ? tUi('hk.applying') : tUi('hk.stopped')}
                    </span>
                  </td>
                  {canManage && (
                    <td>
                      <button
                        type="button"
                        className="hk-text-button"
                        disabled={busy}
                        aria-label={
                          'Sửa ca của ' + staffName(row.staffId) + ' lúc ' + row.startTime
                        }
                        onClick={() => editShift(row)}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        {tUi('hk.editShift')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!visibleShifts.length && (
                <tr>
                  <td colSpan={canManage ? 5 : 4}>
                    <div className="hk-empty" role="status">
                      <CalendarDays size={26} aria-hidden="true" />
                      <strong>
                        {shiftLoading
                          ? tUi('hk.loadingShiftList')
                          : loaded.error
                            ? tUi('hk.failedShifts')
                            : tUi('hk.noShifts')}
                      </strong>
                      <p>
                        {loaded.error
                          ? tUi('hk.retryDate')
                          : !shiftLoading && canManage
                            ? tUi('hk.addShiftHint')
                            : ''}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {canManage && shiftEditorOpen && (
        <FormDialog
          title={shiftForm.id ? tUi('hk.editShiftTitle') : tUi('hk.addShift')}
          busy={busy}
          error={error}
          onClose={closeShiftEditor}
        >
          <p className="hk-shift-editor-hint">{tUi('hk.shiftTimeHint')}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!shiftDates.length) return
              if (
                ![shiftForm.startTime, shiftForm.endTime].every((value) =>
                  /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value),
                ) ||
                shiftForm.endTime <= shiftForm.startTime
              ) {
                setError('Giờ kết thúc phải sau giờ bắt đầu, dùng HH:mm.')
                return
              }
              save(
                () =>
                  saveHousekeepingShift({
                    ...shiftForm,
                    ...(!shiftForm.id ? { period: shiftPeriod } : {}),
                  }),
                (result) =>
                  shiftForm.id
                    ? tUi('hk.shiftSaved')
                    : tUi('hk.shiftsCreated', { count: result.created ?? 1 }),
                () => {
                  setDate(shiftForm.date)
                  setShiftForm(blankShift(shiftForm.date))
                  setShiftPeriod('day')
                  setShiftEditorOpen(false)
                },
              )
            }}
          >
            <fieldset disabled={busy}>
              {!shiftForm.id && (
                <div className="hk-shift-period">
                  <span>{tUi('hk.shiftCreatePeriod')}</span>
                  <div
                    className="hk-shift-period-options"
                    role="group"
                    aria-label={tUi('hk.shiftCreatePeriod')}
                  >
                    {[
                      ['day', 'hk.shiftPeriodDay'],
                      ['week', 'hk.shiftPeriodWeek'],
                      ['month', 'hk.shiftPeriodMonth'],
                    ].map(([value, key]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={shiftPeriod === value}
                        onClick={() => setShiftPeriod(value)}
                      >
                        {tUi(key)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="hk-shift-fields">
                <label>
                  {tUi('hk.shiftStaff')}
                  <select
                    required
                    value={shiftForm.staffId}
                    onChange={(event) =>
                      setShiftForm({ ...shiftForm, staffId: event.target.value })
                    }
                  >
                    <option value="">{tUi('hk.chooseStaff')}</option>
                    {staff
                      .filter((row) => row.active || row.id === shiftForm.staffId)
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                          {!row.active ? ' ' + labelUi('(đã ngừng)') : ''}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {shiftForm.id ? tUi('hk.shiftDay') : tUi('hk.shiftStartDate')}
                  <DateInput
                    required
                    value={shiftForm.date}
                    onChange={(date) => setShiftForm({ ...shiftForm, date })}
                  />
                </label>
                <div className="hk-time-fields">
                  <label>
                    {tUi('hk.startTime')}
                    <input
                      type="text"
                      required
                      pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
                      placeholder="HH:mm"
                      title="HH:mm"
                      maxLength={5}
                      value={shiftForm.startTime}
                      onChange={(event) =>
                        setShiftForm({ ...shiftForm, startTime: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {tUi('hk.endTime')}
                    <input
                      type="text"
                      required
                      pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
                      placeholder="HH:mm"
                      title="HH:mm"
                      maxLength={5}
                      value={shiftForm.endTime}
                      onChange={(event) =>
                        setShiftForm({ ...shiftForm, endTime: event.target.value })
                      }
                    />
                  </label>
                </div>
                <label className="hk-note-field">
                  {tUi('hk.shiftNotes')}
                  <input
                    maxLength={500}
                    value={shiftForm.note}
                    onChange={(event) => setShiftForm({ ...shiftForm, note: event.target.value })}
                    placeholder={tUi('hk.shiftPlaceholder')}
                  />
                </label>
                <label>
                  {tUi('hk.applyShift')}
                  <select
                    value={shiftForm.active ? 'active' : 'inactive'}
                    onChange={(event) =>
                      setShiftForm({ ...shiftForm, active: event.target.value === 'active' })
                    }
                  >
                    <option value="active">{tUi('hk.applying')}</option>
                    <option value="inactive">{tUi('hk.stopped')}</option>
                  </select>
                </label>
              </div>
              {!shiftForm.id && shiftDates.length > 0 && (
                <>
                  <p className="hk-shift-period-summary" role="status">
                    {tUi('hk.shiftPeriodSummary', {
                      count: shiftDates.length,
                      start: formatDate(shiftDates[0]),
                      end: formatDate(shiftDates.at(-1)),
                    })}
                  </p>
                  <p className="hk-shift-period-hint">{tUi('hk.shiftPeriodHint')}</p>
                </>
              )}
              {!shiftDates.length && (
                <p className="domain-error" role="alert">
                  {tUi('hk.shiftPeriodDateError')}
                </p>
              )}
              <div className="hk-form-actions">
                <button type="button" onClick={closeShiftEditor}>
                  {tUi('common.cancel')}
                </button>
                <button type="submit" className="primary" disabled={!shiftDates.length}>
                  <Save size={16} aria-hidden="true" />
                  {busy ? tUi('common.saving') : tUi('hk.saveShift')}
                </button>
              </div>
            </fieldset>
          </form>
        </FormDialog>
      )}
    </div>
  )
}
