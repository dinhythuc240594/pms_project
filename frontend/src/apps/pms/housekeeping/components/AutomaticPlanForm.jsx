import DateInput from '../../../../shared/components/DateInput.jsx';
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { shortDate } from '../planCalendar';
import { automaticDayPlans, automaticPlanDates } from '../automaticPlan';
import { useAutomaticShifts } from '../useAutomaticShifts';
import AutomaticDayPlan from './AutomaticDayPlan';

export default function AutomaticPlanForm({ initial, staff, rooms, requestTenant, knownShifts, knownShiftRange, shiftsSource, busy, onSave, onClose }) {
  useI18n();
  const datesId = useId(), staffId = useId();
  const [range, setRange] = useState({ start: initial.date, end: initial.date });
  const [omittedDates, setOmittedDates] = useState([]);
  const [staffIds, setStaffIds] = useState(() => staff.filter(row => row.active).map(row => row.id));
  const [configurations, setConfigurations] = useState({});
  const days = automaticPlanDates(range.start, range.end);
  const dates = days.filter(day => !omittedDates.includes(day));
  const activeStaff = staff.filter(row => row.active);
  const selectedStaff = activeStaff.filter(row => staffIds.includes(row.id));
  const eligibleRooms = rooms.filter(room => room.uuid && room.active !== false && !['maintenance', 'inspection'].includes(room.condition));
  const shiftQuery = useAutomaticShifts({ start: range.start, end: range.end, requestTenant, knownRange: knownShiftRange, knownShifts, source: shiftsSource });
  const dayPlans = automaticDayPlans(dates, selectedStaff.map(row => row.id), configurations);
  const roomError = dayPlans.some(plan => plan.roomIds && (!plan.roomIds.length || plan.roomIds.length > 500 || plan.roomIds.some(id => !eligibleRooms.some(room => room.uuid === id)))) ? tUi('hk.autoRoomSelectionError') : '';
  const shiftError = !shiftQuery.loading && dayPlans.some(plan => plan.shifts?.some(selection => selection.shiftId !== null && !shiftQuery.shifts.some(shift => shift.id === selection.shiftId && shift.active && shift.staffId === selection.staffId && shift.date === plan.date))) ? tUi('hk.autoInvalidShift') : '';
  const rangeError = !days.length ? tUi('hk.autoRangeError') : '';
  const selectionError = !dates.length ? tUi('hk.autoNoDates') : !selectedStaff.length ? tUi('hk.autoNoStaff') : selectedStaff.length > 100 ? tUi('hk.autoStaffLimit') : '';
  const blocked = Boolean(rangeError || selectionError || roomError || shiftError || shiftQuery.loading || shiftQuery.error);
  function changeRange(next) { setRange(next); setOmittedDates([]); }
  return <form data-workspace-draft onSubmit={event => {
    event.preventDefault();
    if (!busy && !blocked) onSave({ dates, staffIds: selectedStaff.map(row => row.id), ...(dayPlans.length ? { dayPlans } : {}) });
  }}>
    <p className="hk-plan-hint">{tUi('hk.autoIntro')}</p>
    <fieldset disabled={busy}>
      <div className="hk-plan-fields">
        <label>{tUi('common.fromDate')}<DateInput required value={range.start} onChange={start => changeRange({ ...range, start })} /></label>
        <label>{tUi('hk.autoEndDate')}<DateInput required min={range.start || undefined} value={range.end} onChange={end => changeRange({ ...range, end })} /></label>
      </div>
      <p className="hk-plan-hint">{tUi('hk.autoRangeHint')}</p>
      {rangeError && <p className="domain-error" role="alert">{rangeError}</p>}
      <div className="hk-auto-selection" role="group" aria-labelledby={datesId}>
        <div className="hk-auto-selection-heading"><h3 id={datesId}>{tUi('hk.autoDates')}</h3><div className="hk-plan-actions"><button type="button" disabled={!days.length} onClick={() => setOmittedDates([])}>{tUi('hk.autoSelectAll')}</button><button type="button" disabled={!days.length} onClick={() => setOmittedDates(days)}>{tUi('hk.autoClear')}</button></div></div>
        <div className="hk-auto-dates">{days.map(day => <button key={day} type="button" aria-pressed={!omittedDates.includes(day)} onClick={() => setOmittedDates(previous => previous.includes(day) ? previous.filter(value => value !== day) : [...previous, day])}>{shortDate(day)}</button>)}</div>
      </div>
      <div className="hk-auto-selection" role="group" aria-labelledby={staffId}>
        <div className="hk-auto-selection-heading"><h3 id={staffId}>{tUi('hk.autoStaff')}</h3><div className="hk-plan-actions"><button type="button" disabled={!activeStaff.length} onClick={() => setStaffIds(activeStaff.map(row => row.id))}>{tUi('hk.autoSelectAll')}</button><button type="button" disabled={!activeStaff.length} onClick={() => setStaffIds([])}>{tUi('hk.autoClear')}</button></div></div>
        <div className="hk-auto-staff">{activeStaff.map(row => <label key={row.id} className="hk-auto-staff-option"><input type="checkbox" checked={staffIds.includes(row.id)} onChange={event => setStaffIds(previous => event.target.checked ? [...previous, row.id] : previous.filter(value => value !== row.id))} /><span>{row.name}</span></label>)}</div>
        {!activeStaff.length && <p className="hk-plan-hint">{tUi('hk.assignmentNoStaff')} <Link to="/id/housekeeping/staff">{tUi('hk.staffAndShifts')}</Link></p>}
      </div>
      <div className="hk-auto-selection">
        <h3>{tUi('hk.autoDayConfiguration')}</h3>
        <p className="hk-plan-hint">{tUi('hk.autoDayConfigurationHint')}</p>
        {shiftQuery.loading && <p className="hk-plan-hint" role="status">{tUi('hk.loadingShifts')}</p>}
        {shiftQuery.error && <div className="domain-error" role="alert"><p>{shiftQuery.error}</p><button type="button" onClick={shiftQuery.refresh}>{tUi('hk.reloadShifts')}</button></div>}
        {dates.map(day => <AutomaticDayPlan key={day} date={day} configuration={configurations[day] || {}} staff={selectedStaff} rooms={eligibleRooms} shifts={shiftQuery.shifts} loading={shiftQuery.loading || Boolean(shiftQuery.error)} open={dates.length === 1} onChange={next => setConfigurations(previous => ({ ...previous, [day]: next }))} onApplyRooms={() => setConfigurations(previous => {
          const roomIds = previous[day]?.roomIds ?? null;
          return { ...previous, ...Object.fromEntries(dates.map(date => [date, { ...previous[date], roomIds: roomIds === null ? null : [...roomIds] }])) };
        })} />)}
      </div>
      <p className="hk-auto-summary" role="status">{tUi('hk.autoSummary', { days: dates.length, staff: selectedStaff.length })}</p>
      {!rangeError && selectionError && <p className="hk-plan-hint" role="status">{selectionError}</p>}
      {roomError && <p className="hk-plan-hint" role="status">{roomError}</p>}
      {!shiftQuery.error && shiftError && <p className="hk-plan-hint" role="status">{shiftError}</p>}
      <p className="hk-plan-hint">{tUi('hk.autoDistributionHint')}</p>
      <div className="hk-dialog-footer"><button type="button" onClick={onClose}>{tUi('common.cancel')}</button><button type="submit" className="primary" disabled={blocked}><Sparkles size={16} aria-hidden="true" />{busy ? tUi('common.creating') : tUi('hk.createPlan')}</button></div>
    </fieldset>
  </form>;
}
