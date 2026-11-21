import { t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { shortDate } from '../planCalendar'

export default function AutomaticDayPlan({
  date,
  configuration,
  staff,
  rooms,
  shifts,
  loading,
  onChange,
  onApplyRooms,
  open,
}) {
  useI18n()
  const selectedRooms = Array.isArray(configuration.roomIds)
  function chooseShift(staffId, value) {
    onChange({ ...configuration, shifts: { ...configuration.shifts, [staffId]: value } })
  }
  return (
    <details className="hk-auto-day" open={open || undefined}>
      <summary>
        <strong>{shortDate(date)}</strong>
        <span>
          {selectedRooms
            ? tUi('hk.autoRoomCount', { count: configuration.roomIds.length })
            : tUi('hk.autoRoomsAutomatic')}
        </span>
      </summary>
      <div className="hk-auto-day-content">
        <label>
          {tUi('hk.autoDayRooms')}
          <select
            value={selectedRooms ? 'selected' : 'automatic'}
            onChange={(event) =>
              onChange({ ...configuration, roomIds: event.target.value === 'selected' ? [] : null })
            }
          >
            <option value="automatic">{tUi('hk.autoRoomsAutomatic')}</option>
            <option value="selected">{tUi('hk.autoRoomsSelected')}</option>
          </select>
        </label>
        {selectedRooms && (
          <>
            <div className="hk-auto-selection-heading">
              <span>{tUi('hk.autoChooseRooms')}</span>
              <div className="hk-plan-actions">
                <button
                  type="button"
                  onClick={() =>
                    onChange({ ...configuration, roomIds: rooms.map((room) => room.uuid) })
                  }
                >
                  {tUi('hk.autoSelectAll')}
                </button>
                <button type="button" onClick={() => onChange({ ...configuration, roomIds: [] })}>
                  {tUi('hk.autoClear')}
                </button>
              </div>
            </div>
            <div className="hk-auto-rooms">
              {rooms.map((room) => (
                <label key={room.uuid} className="hk-auto-room-option">
                  <input
                    type="checkbox"
                    checked={configuration.roomIds.includes(room.uuid)}
                    onChange={(event) =>
                      onChange({
                        ...configuration,
                        roomIds: event.target.checked
                          ? [...configuration.roomIds, room.uuid]
                          : configuration.roomIds.filter((id) => id !== room.uuid),
                      })
                    }
                  />
                  <span>
                    {tUi('common.room')} {room.id}
                  </span>
                </label>
              ))}
            </div>
            {!rooms.length && <p className="hk-plan-hint">{tUi('hk.autoNoAvailableRooms')}</p>}
            {configuration.roomIds.some((id) => !rooms.some((room) => room.uuid === id)) && (
              <p className="hk-plan-hint" role="status">
                {tUi('hk.autoRoomsChanged')}
              </p>
            )}
            <p className="hk-plan-hint">{tUi('hk.autoSelectedRoomsHint')}</p>
          </>
        )}
        <div className="hk-plan-actions">
          <button type="button" onClick={onApplyRooms}>
            {tUi('hk.autoCopyRooms')}
          </button>
        </div>
        <h4>{tUi('hk.autoDayShifts')}</h4>
        <div className="hk-plan-fields">
          {staff.map((person) => {
            const options = shifts.filter(
              (shift) => shift.active && shift.staffId === person.id && shift.date === date,
            )
            const value = configuration.shifts?.[person.id] || 'auto'
            const missing =
              !['auto', 'none'].includes(value) && !options.some((shift) => shift.id === value)
            return (
              <label key={person.id}>
                {person.name}
                <select
                  disabled={loading}
                  value={value}
                  onChange={(event) => chooseShift(person.id, event.target.value)}
                >
                  <option value="auto">{tUi('hk.autoShiftAutomatic')}</option>
                  <option value="none">{tUi('hk.noShift')}</option>
                  {options.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.startTime} – {shift.endTime}
                    </option>
                  ))}
                  {missing && (
                    <option value={value}>
                      {loading ? tUi('hk.loadingShifts') : tUi('hk.autoInvalidShift')}
                    </option>
                  )}
                </select>
              </label>
            )
          })}
        </div>
      </div>
    </details>
  )
}
