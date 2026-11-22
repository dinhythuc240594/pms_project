import DateInput from '../../../../shared/components/DateInput.jsx';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, List, Plus, RefreshCw, Sparkles, UserRound, Users } from 'lucide-react';
import { usePms } from '../../data/usePms';
import { addDays, today } from '../../data/model';
import { calendarWeek, isClosed, shortDate, taskKind, taskStatuses } from '../planCalendar';
import PlanDialog from '../components/PlanDialog';
import ManualTaskForm from '../components/ManualTaskForm';
import TaskDetail from '../components/TaskDetail';
import AssignmentForm from '../components/AssignmentForm';
import AutomaticPlanForm from '../components/AutomaticPlanForm';
import { dateRangeParams } from '../../../../shared/lib/dateRangeQuery.js';
import '../../components/DomainForms.css';
import './HousekeepingPlan.css';

const weekdayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const emptyTasks = [];

function TaskButton({ task, staff, shifts, busy, onOpen, list = false }) {
  useI18n();
  const shift = shifts.find(row => row.id === task.shiftId);
  return <button type="button" className={`hk-calendar-task is-${task.status}`} disabled={busy} aria-label={tUi('hk.taskAria', { room: task.room, status: labelUi(taskStatuses[task.status]), date: shortDate(task.date) })} onClick={() => onOpen(task)}>
    <span className="hk-calendar-task-top"><strong>{tUi("common.room")}{' '}{task.room}</strong><span className={`hk-task-status is-${task.status}`}>{labelUi(taskStatuses[task.status])}</span></span>
    <span>{taskKind(task)}</span>
    {list && <span><UserRound size={12} aria-hidden="true" />{staff.find(row => row.id === task.staffId)?.name || tUi("hk.unassigned")} · {shortDate(task.date)}</span>}
    {shift && <span><Clock3 size={12} aria-hidden="true" />{shift.startTime} – {shift.endTime}</span>}
    {task.note && <span className="hk-calendar-note">{task.note}</span>}
  </button>;
}

export default function HousekeepingPlan() {
  const pms = usePms();
  return <PlanWorkspace key={`${pms.tenantId}:${pms.settings.timezone}`} pms={pms} />;
}

function PlanWorkspace({ pms }) {
  useI18n();
  const { settings, tenantId, rooms = [], housekeepingStaff = [], housekeepingTasks = emptyTasks, housekeepingShifts = emptyTasks,
    access, requestTenant, generateHousekeepingPlan, createHousekeepingTask, assignHousekeepingTask, updateHousekeepingTask } = pms;
  const currentDate = today(settings.timezone);
  const [date, setDate] = useState(currentDate), [view, setView] = useState('calendar');
  const [dateValid, setDateValid] = useState(true);
  const [status, setStatus] = useState(''), [staffFilter, setStaffFilter] = useState('');
  const [loaded, setLoaded] = useState({ start: '', tasks: [], shifts: [], source: null, shiftsSource: null, reload: -1, error: '' });
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0), [dialog, setDialog] = useState(null);
  const canManage = access('housekeeping.manage').allowed, canWrite = access('housekeeping.complete').allowed;
  const { start, end, days } = calendarWeek(date);
  const requests = useRef(requestTenant);
  useEffect(() => { requests.current = requestTenant; }, [requestTenant]);
  useEffect(() => {
    let active = true;
    if (!dateValid) return () => { active = false; };
    const params = dateRangeParams({ start, end });
    Promise.all([requests.current('/housekeeping/tasks?' + params), requests.current('/housekeeping/shifts?' + params)])
      .then(([data, shifts]) => { if (active) setLoaded({ start, tasks: data.tasks, shifts: shifts.shifts, source: housekeepingTasks, shiftsSource: housekeepingShifts, reload, error: '' }); })
      .catch(err => { if (active) setLoaded({ start, tasks: [], shifts: [], source: housekeepingTasks, shiftsSource: housekeepingShifts, reload, error: err.message }); });
    return () => { active = false; };
  }, [start, end, dateValid, tenantId, housekeepingTasks, housekeepingShifts, reload]);

  const loading = loaded.start !== start || loaded.source !== housekeepingTasks || loaded.shiftsSource !== housekeepingShifts || loaded.reload !== reload;
  const tasks = !loading ? loaded.tasks : emptyTasks;
  const shifts = !loading ? loaded.shifts : emptyTasks;
  const unassignedTasks = tasks.filter(task => !task.staffId && !isClosed(task));
  const visible = tasks.filter(task => (view === 'list' || task.staffId) && (!status || task.status === status) && (!staffFilter || task.staffId === staffFilter));
  const staffRows = housekeepingStaff.filter(row => row.active || tasks.some(task => task.staffId === row.id));
  const people = [...staffRows];
  // Keep historical assignments visible even when their staff record is no longer in the roster.
  for (const task of tasks) if (task.staffId && !people.some(row => row.id === task.staffId)) people.push({ id: task.staffId, name: 'Nhân viên đã ngừng hoạt động' });
  const visiblePeople = people.filter(row => !staffFilter || row.id === staffFilter);
  const failure = error || (!loading && loaded.error);
  function openDialog(next) { setError(''); setDialog(next); }
  function closeDialog() { if (!busyRef.current) { setDialog(null); setError(''); } }
  async function act(action, message) {
    if (busyRef.current || !dateValid) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await action();
      setNotice(typeof message === 'function' ? message(result) : message);
      if (result?.date) setDate(result.date);
      setDialog(null); setReload(value => value + 1);
    } catch (err) { setError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const openTask = task => openDialog({ mode: 'task', task });
  const addTask = (day = date, staffId = '') => openDialog({ mode: 'manual', date: day, staffId });

  return <div className="pms-domain-page hk-plan-page">
    <header className="hk-plan-heading"><div><span className="hk-plan-kicker">{tUi("nav.housekeeping")}</span><h1>{tUi("nav.housekeepingPlan")}</h1><p>{canManage ? tUi("hk.planIntro") : tUi("hk.ownPlanIntro")}</p></div><div className="hk-plan-actions">{canManage && <><Link className="hk-plan-link" to="/id/housekeeping/staff"><Users size={16} aria-hidden="true" />{tUi("hk.staffAndShifts")}</Link><button type="button" disabled={!dateValid || busy || loading || Boolean(loaded.error)} onClick={() => openDialog({ mode: 'assignment' })}><UserRound size={16} aria-hidden="true" />{tUi('hk.assignment')}{!loading && ` (${unassignedTasks.length})`}</button><button type="button" disabled={!dateValid || busy || loading || Boolean(loaded.error)} onClick={() => openDialog({ mode: 'auto', date })}><Sparkles size={16} aria-hidden="true" />{tUi("hk.auto")}</button><button type="button" className="primary" disabled={busy || !dateValid} onClick={() => addTask()}><Plus size={16} aria-hidden="true" />{tUi("hk.manual")}</button></>}</div></header>
    <section className="hk-plan-stats" aria-label={tUi("hk.weekSummary")}><div><CalendarDays size={18} aria-hidden="true" /><span>{tUi("hk.tasks")}<strong>{loading ? '—' : tasks.length}</strong></span></div><div><Users size={18} aria-hidden="true" /><span>{tUi("hk.unassigned")}<strong>{loading ? '—' : unassignedTasks.length}</strong></span></div><div><Clock3 size={18} aria-hidden="true" /><span>{tUi("hk.inspection")}<strong>{loading ? '—' : tasks.filter(task => task.status === 'inspection').length}</strong></span></div><div><CheckCircle2 size={18} aria-hidden="true" /><span>{tUi("hk.completed")}<strong>{loading ? '—' : tasks.filter(task => task.status === 'completed').length}</strong></span></div></section>
    <section className="domain-panel hk-plan-board">
      <div className="hk-plan-controls"><div className="hk-week-nav"><button type="button" className="hk-icon-button" disabled={busy || !dateValid} aria-label={tUi("hk.previousWeek")} onClick={() => setDate(addDays(date, -7))}><ChevronLeft size={17} aria-hidden="true" /></button><button type="button" disabled={busy || !dateValid} onClick={() => setDate(currentDate)}>{tUi("common.today")}</button><button type="button" className="hk-icon-button" disabled={busy || !dateValid} aria-label={tUi("hk.nextWeek")} onClick={() => setDate(addDays(date, 7))}><ChevronRight size={17} aria-hidden="true" /></button><strong>{shortDate(start)} – {shortDate(addDays(end, -1))}/{addDays(end, -1).slice(0, 4)}</strong></div><div className="hk-view-toggle" role="group" aria-label={tUi("hk.planView")}><button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><CalendarDays size={15} aria-hidden="true" />{tUi("hk.calendar")}</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={15} aria-hidden="true" />{tUi("common.list")}</button></div></div>
      <div className="hk-plan-filters"><label>{tUi("hk.weekDate")}<DateInput required value={date} disabled={busy} onValidityChange={setDateValid} onChange={value => { if (value) { setDate(value); setNotice(''); } }} /></label><label>{tUi("common.staff")}<select value={staffFilter} disabled={busy || !dateValid} onChange={event => setStaffFilter(event.target.value)}><option value="">{tUi("common.allStaff")}</option>{people.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>{tUi("common.status")}<select value={status} onChange={event => setStatus(event.target.value)}><option value="">{tUi("common.allStatuses")}</option>{Object.entries(taskStatuses).map(([value, label]) => <option key={value} value={value}>{labelUi(label)}</option>)}</select></label><button type="button" disabled={!dateValid || busy || loading} onClick={() => { setError(''); setReload(value => value + 1); }}><RefreshCw size={15} aria-hidden="true" />{tUi("common.reload")}</button></div>
      <div className="hk-plan-legend">{Object.entries(taskStatuses).map(([value, label]) => <span key={value}><i className={`is-${value}`} />{labelUi(label)}</span>)}<span>{loading ? tUi("common.loading") : tUi('hk.taskCount', { count: visible.length })}</span></div>
      {failure && !dialog && <div className="domain-error" role="alert"><p>{failure}</p><button type="button" disabled={!dateValid || busy || loading} onClick={() => { setError(''); setReload(value => value + 1); }}>{tUi("hk.reloadTasks")}</button></div>}
      {notice && <p className="hk-plan-notice" role="status"><CheckCircle2 size={16} aria-hidden="true" />{notice}</p>}
      {!dateValid ? <p className="domain-error" role="alert">{labelUi("Ngày không hợp lệ.")}</p> : loading ? <p className="hk-plan-empty" role="status">{tUi("hk.loadingCalendar")}</p> : !loaded.error && <>
        {view === 'calendar' ? <div className="hk-calendar-scroll" role="region" aria-label={tUi("hk.calendarLabel")} tabIndex={0}><table className="hk-calendar"><thead><tr><th scope="col">{tUi("hk.staffDate")}</th>{days.map((day, index) => <th key={day} scope="col" className={day === currentDate ? 'is-today' : index > 4 ? 'is-weekend' : ''} aria-current={day === currentDate ? 'date' : undefined}><span>{labelUi(weekdayLabels[index])}</span><strong>{shortDate(day)}</strong></th>)}</tr></thead><tbody>{visiblePeople.map(person => {
          const personTasks = visible.filter(task => task.staffId === person.id);
          return <tr key={person.id}><th scope="row"><span className="hk-calendar-person"><UserRound size={17} aria-hidden="true" /><strong>{person.name}</strong></span><small>{tUi('hk.personCount', { count: personTasks.length, open: personTasks.filter(task => !isClosed(task)).length })}</small></th>{days.map(day => {
            const dayTasks = personTasks.filter(task => task.date === day);
            const dayShifts = shifts.filter(shift => shift.active && shift.staffId === person.id && shift.date === day);
            return <td key={day} className={day === currentDate ? 'is-today' : ''}>{dayShifts.map(shift => <span key={shift.id} className="hk-calendar-shift"><Clock3 size={11} aria-hidden="true" />{shift.startTime}–{shift.endTime}</span>)}{dayTasks.map(task => <TaskButton key={task.id} task={task} staff={housekeepingStaff} shifts={shifts} busy={busy} onOpen={openTask} />)}{!dayTasks.length && <span className="hk-calendar-free">{dayShifts.length ? tUi("hk.noTasks") : '—'}</span>}{canManage && person.active !== false && <button type="button" className="hk-calendar-add" disabled={busy || !housekeepingStaff.some(row => row.id === person.id && row.active)} aria-label={tUi('hk.addForPerson', { date: shortDate(day), name: person.name })} onClick={() => addTask(day, person.id)}><Plus size={13} aria-hidden="true" />{tUi("hk.addTask")}</button>}</td>;
          })}</tr>;
        })}</tbody></table>{!visiblePeople.length && <p className="hk-plan-empty">{tUi("hk.noStaffWeek")}</p>}</div> : <div className="hk-plan-task-list">{visible.map(task => <TaskButton key={task.id} task={task} staff={housekeepingStaff} shifts={shifts} busy={busy} onOpen={openTask} list />)}{!visible.length && <p className="hk-plan-empty">{tUi("hk.noMatchingWeek")}</p>}</div>}
        <p className="hk-plan-hint hk-board-hint">{canManage ? tUi("hk.calendarHint") : tUi("hk.ownCalendarHint")}{' '}{tUi("hk.shiftHint")}</p>
      </>}
    </section>
    {dialog && <PlanDialog title={dialog.mode === 'task' ? tUi('hk.taskTitle', { room: dialog.task.room }) : dialog.mode === 'manual' ? tUi("hk.manualTitle") : dialog.mode === 'assignment' ? tUi('hk.assignment') : tUi("hk.autoTitle")} busy={busy} error={error} onClose={closeDialog}>
      {dialog.mode === 'assignment' && <AssignmentForm tasks={unassignedTasks} staff={housekeepingStaff} shifts={shifts} busy={busy} onClose={closeDialog} onSave={(task, input) => act(() => assignHousekeepingTask(task.id, input), tUi('hk.assignedSuccess', { room: task.room }))} />}
      {dialog.mode === 'manual' && <ManualTaskForm initial={dialog} rooms={rooms} staff={housekeepingStaff} requestTenant={requestTenant} shiftsSource={housekeepingShifts} busy={busy} onClose={closeDialog} onSave={input => act(() => createHousekeepingTask(input), tUi('hk.manualSuccess'))} />}
      {dialog.mode === 'auto' && <AutomaticPlanForm initial={dialog} staff={housekeepingStaff} rooms={rooms} requestTenant={requestTenant} knownShifts={shifts} knownShiftRange={!loading && !loaded.error ? { start, end } : null} shiftsSource={housekeepingShifts} busy={busy} onClose={closeDialog} onSave={input => act(() => generateHousekeepingPlan(input), result => tUi('hk.autoBatchSuccess', { created: result.created, assigned: result.assigned, days: result.dates.length }))} />}
      {dialog.mode === 'task' && <TaskDetail task={dialog.task} staff={housekeepingStaff} shifts={shifts} canManage={canManage} canApprove={access('housekeeping.manage', undefined, false).allowed && canWrite} canWrite={canWrite} busy={busy} act={act} assignTask={assignHousekeepingTask} updateTask={updateHousekeepingTask} timeZone={settings.timezone} onClose={closeDialog} />}
    </PlanDialog>}
  </div>;
}
