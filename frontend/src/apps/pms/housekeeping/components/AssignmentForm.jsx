import { useState } from 'react';
import { Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import { t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { shortDate, taskKind } from '../planCalendar';

export default function AssignmentForm({ tasks, staff, shifts, busy, onSave, onClose }) {
  useI18n();
  const [taskId, setTaskId] = useState(tasks[0]?.id || '');
  const [staffId, setStaffId] = useState(''), [shiftId, setShiftId] = useState('');
  const task = tasks.find(row => row.id === taskId);
  const activeStaff = staff.filter(row => row.active);
  const availableShifts = shifts.filter(row => row.active && row.staffId === staffId && row.date === task?.date);
  if (!tasks.length) return <>
    <p className="hk-plan-hint" role="status">{tUi('hk.assignmentEmpty')}</p>
    <div className="hk-dialog-footer"><button type="button" disabled={busy} onClick={onClose}>{tUi('common.close')}</button></div>
  </>;
  return <form data-workspace-draft onSubmit={event => {
    event.preventDefault();
    if (busy || !task || !activeStaff.some(row => row.id === staffId)) return;
    onSave(task, { staffId, shiftId: shiftId || null, revision: task.revision });
  }}>
    <p className="hk-plan-hint">{tUi('hk.assignmentIntro')}</p>
    <fieldset disabled={busy}>
      <div className="hk-plan-fields">
        <label className="hk-plan-wide">{tUi('hk.assignmentTask')}<select required value={taskId} onChange={event => { setTaskId(event.target.value); setShiftId(''); }}>
          <option value="">{tUi('hk.assignmentChooseTask')}</option>
          {tasks.map(row => <option key={row.id} value={row.id}>{tUi('common.room')} {row.room} · {shortDate(row.date)} · {taskKind(row)}</option>)}
        </select></label>
        <label>{tUi('hk.assignee')}<select required value={staffId} onChange={event => { setStaffId(event.target.value); setShiftId(''); }}><option value="">{tUi('hk.chooseStaff')}</option>{activeStaff.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>{tUi('hk.shift')}<select value={shiftId} disabled={!task || !staffId} onChange={event => setShiftId(event.target.value)}><option value="">{tUi('hk.noShift')}</option>{availableShifts.map(row => <option key={row.id} value={row.id}>{row.startTime} – {row.endTime}</option>)}</select></label>
      </div>
      {task?.note && <p className="hk-plan-hint hk-detail-note">{tUi('hk.notePrefix')} {task.note}</p>}
      <p className="hk-plan-hint">{tUi('hk.assignmentHint')}</p>
      {!activeStaff.length && <p className="hk-plan-hint" role="status">{tUi('hk.assignmentNoStaff')} <Link to="/id/housekeeping/staff">{tUi('hk.staffAndShifts')}</Link></p>}
      <div className="hk-dialog-footer"><button type="button" onClick={onClose}>{tUi('common.cancel')}</button><button type="submit" className="primary" disabled={!task || !activeStaff.length}><Save size={15} aria-hidden="true" />{busy ? tUi('common.saving') : tUi('hk.saveAssignment')}</button></div>
    </fieldset>
  </form>;
}
