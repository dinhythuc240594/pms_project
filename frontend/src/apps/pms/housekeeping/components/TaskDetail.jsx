import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { CheckCircle2, Play, Save, Send } from 'lucide-react';
import { timestamp } from '../../data/presentation';
import { isClosed, shortDate, taskKind, taskStatuses } from '../planCalendar';

export default function TaskDetail({ task, staff, shifts, canManage, canApprove = canManage, canWrite, busy, act, assignTask, updateTask, timeZone, onClose }) {
  useI18n();
  const [staffId, setStaffId] = useState(task.staffId || '');
  const [shiftId, setShiftId] = useState(task.shiftId || '');
  const [note, setNote] = useState(task.note || '');
  const worker = staff.find(row => row.id === task.staffId);
  const availableShifts = shifts.filter(row => row.active && row.staffId === staffId && row.date === task.date);
  const changeStatus = status => act(() => updateTask(task.id, { status, note, revision: task.revision }), tUi('hk.statusSuccess', { room: task.room, status: labelUi(taskStatuses[status]) }));
  return <div className="hk-task-detail" data-workspace-draft>
    <div className="hk-detail-meta"><span className={`hk-task-status is-${task.status}`}>{labelUi(taskStatuses[task.status])}</span><span>{shortDate(task.date)} · {taskKind(task)}</span></div>
    <p>{tUi("hk.staffPrefix")}{' '}<strong>{worker?.name || tUi("hk.unassigned")}</strong></p>
    {task.startedAt && <p>{tUi("hk.startedPrefix")}{' '}{timestamp(task.startedAt, timeZone)}</p>}
    {task.completedAt && <p>{tUi("hk.completedPrefix")}{' '}{timestamp(task.completedAt, timeZone)}</p>}
    {!isClosed(task) && canManage && <form onSubmit={event => { event.preventDefault(); act(() => assignTask(task.id, { staffId: staffId || null, shiftId: shiftId || null, revision: task.revision }), tUi(staffId ? 'hk.assignedSuccess' : 'hk.unassignedSuccess', { room: task.room })); }}>
      <fieldset disabled={busy}>
        <div className="hk-plan-fields"><label>{tUi("hk.assignee")}<select value={staffId} onChange={event => { setStaffId(event.target.value); setShiftId(''); }}><option value="">{tUi("hk.unassigned")}</option>{staff.filter(row => row.active).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}{staffId && !staff.some(row => row.active && row.id === staffId) && <option value={staffId}>{tUi("hk.inactiveStaff")}</option>}</select></label>
        <label>{tUi("hk.shift")}<select value={shiftId} onChange={event => setShiftId(event.target.value)} disabled={!staffId}><option value="">{tUi("hk.noShift")}</option>{availableShifts.map(row => <option key={row.id} value={row.id}>{row.startTime} – {row.endTime}</option>)}</select></label></div>
        <p className="hk-plan-hint">{tUi("hk.assignmentHint")}</p>
        <button type="submit" className="primary"><Save size={15} aria-hidden="true" />{tUi("hk.saveAssignment")}</button>
      </fieldset>
    </form>}
    {isClosed(task) ? task.note && <p className="hk-detail-note">{tUi("hk.notePrefix")}{' '}{task.note}</p> : canWrite && <>
      <label>{tUi("hk.workNotes")}<textarea maxLength={1000} rows={3} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
      <div className="hk-plan-actions">
        {task.status === 'pending' && <button type="button" className="primary" disabled={busy} onClick={() => changeStatus('in_progress')}><Play size={15} aria-hidden="true" />{tUi("hk.startCleaning")}</button>}
        {task.status === 'in_progress' && <button type="button" className="success" disabled={busy} onClick={() => changeStatus('inspection')}><Send size={15} aria-hidden="true" />{tUi("hk.sendInspection")}</button>}
        {task.status === 'inspection' && canApprove && <><button type="button" className="success" disabled={busy} onClick={() => changeStatus('completed')}><CheckCircle2 size={15} aria-hidden="true" />{tUi("hk.confirmClean")}</button><button type="button" disabled={busy} onClick={() => changeStatus('in_progress')}>{tUi("hk.rework")}</button></>}
        {canManage && <button type="button" className="hk-danger-button" disabled={busy} onClick={() => changeStatus('cancelled')}>{tUi("hk.cancelTask")}</button>}
      </div>
      <p className="hk-plan-hint">{task.status === 'inspection' && !canApprove ? tUi("hk.inspectionHint") : tUi("hk.workDateHint")}{' '}{tUi("hk.noteSaveHint")}</p>
    </>}
    <div className="hk-dialog-footer"><button type="button" disabled={busy} onClick={onClose}>{tUi("common.close")}</button></div>
  </div>;
}
