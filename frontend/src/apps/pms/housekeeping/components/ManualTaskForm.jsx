import DateInput from '../../../../shared/components/DateInput.jsx';
import { t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

export default function ManualTaskForm({ initial, rooms, staff, requestTenant, shiftsSource, busy, onSave, onClose }) {
  useI18n();
  const [form, setForm] = useState({ date: initial.date, room: '', staffId: initial.staffId || '', shiftId: '', note: '' });
  const [loaded, setLoaded] = useState({ date: '', shifts: [], error: '' });
  const [retry, setRetry] = useState(0);
  const request = useRef(requestTenant);
  useEffect(() => { request.current = requestTenant; }, [requestTenant]);
  useEffect(() => {
    let active = true;
    if (form.date) request.current('/housekeeping/shifts?' + new URLSearchParams({ date: form.date }))
      .then(data => { if (active) setLoaded({ date: form.date, shifts: data.shifts, error: '' }); })
      .catch(err => { if (active) setLoaded({ date: form.date, shifts: [], error: err.message }); });
    return () => { active = false; };
  }, [form.date, shiftsSource, retry]);
  const loading = Boolean(form.date) && loaded.date !== form.date;
  const shifts = loaded.shifts.filter(row => row.active && row.staffId === form.staffId && row.date === form.date);
  const setField = (field, value) => setForm(previous => ({ ...previous, [field]: value, ...(['date', 'staffId'].includes(field) ? { shiftId: '' } : {}) }));
  return <form onSubmit={event => { event.preventDefault(); onSave({ ...form, staffId: form.staffId || null, shiftId: form.shiftId || null }); }} data-workspace-draft>
    <p className="hk-plan-hint">{tUi("hk.manualIntro")}</p>
    <fieldset disabled={busy}>
      <div className="hk-plan-fields">
        <label>{tUi("hk.workDate")}<DateInput required value={form.date} onChange={value => setField('date', value)} /></label>
        <label>{tUi("hk.roomToClean")}<select required value={form.room} onChange={event => setField('room', event.target.value)}><option value="">{tUi("hk.chooseRoom")}</option>{rooms.filter(room => room.active !== false && !['maintenance', 'inspection'].includes(room.condition)).map(room => <option key={room.uuid || room.id} value={room.id}>{tUi("common.room")}{' '}{room.id}</option>)}</select></label>
        <label>{tUi("hk.assignee")}<select value={form.staffId} onChange={event => setField('staffId', event.target.value)}><option value="">{tUi("hk.unassigned")}</option>{staff.filter(row => row.active).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>{tUi("hk.shift")}<select value={form.shiftId} disabled={!form.staffId || loading || Boolean(loaded.error)} onChange={event => setField('shiftId', event.target.value)}><option value="">{loading ? tUi("hk.loadingShifts") : tUi("hk.noShift")}</option>{shifts.map(row => <option key={row.id} value={row.id}>{row.startTime} – {row.endTime}</option>)}</select></label>
        <label className="hk-plan-wide">{tUi("hk.taskNote")}<textarea rows={3} maxLength={1000} placeholder={tUi("hk.notePlaceholder")} value={form.note} onChange={event => setField('note', event.target.value)} /></label>
      </div>
      {loaded.error && <p className="domain-error" role="alert">{loaded.error} <button type="button" onClick={() => { setLoaded({ date: '', shifts: [], error: '' }); setRetry(value => value + 1); }}>{tUi("hk.reloadShifts")}</button></p>}
      <p className="hk-plan-hint">{tUi("hk.manualHint")}</p>
      <div className="hk-dialog-footer"><button type="button" onClick={onClose}>{tUi("common.cancel")}</button><button type="submit" className="primary" disabled={loading || Boolean(loaded.error)}><Plus size={16} aria-hidden="true" />{busy ? tUi("common.creating") : tUi("hk.createTask")}</button></div>
    </fieldset>
  </form>;
}
