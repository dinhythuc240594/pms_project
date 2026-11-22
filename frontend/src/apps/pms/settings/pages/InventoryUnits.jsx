import { useEffect, useId, useRef, useState } from 'react';
import { Check, Pencil, Plus, Ruler, Save, Search, X } from 'lucide-react';
import { t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { usePms } from '../../data/usePms';

export default function InventoryUnits() {
  useI18n();
  const pms = usePms();
  const formId = useId();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const triggerRef = useRef(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!draft && !busy && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [draft, busy]);
  const canWrite = pms.access('settings.write').allowed;
  const units = pms.units || [];
  const rows = units.filter(row => {
    const matchesQuery = `${row.name} ${row.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesQuery && (status === 'all' || (row.active !== false) === (status === 'active'));
  });

  function openEditor(row, event) {
    triggerRef.current = event.currentTarget;
    restoreFocus.current = false;
    setDraft(row ? { ...row } : { name: '' });
    setError('');
    setNotice('');
  }

  function closeEditor() {
    restoreFocus.current = true;
    setDraft(null);
    setError('');
  }

  async function save(event) {
    event.preventDefault();
    if (inFlight.current || !canWrite || !draft?.name.trim()) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      await pms.saveMaster('units', { ...draft, name: draft.name.trim() });
      closeEditor();
      setNotice(tUi('inventorySettings.saved'));
    } catch (err) { setError(err.message); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function toggle(row) {
    if (inFlight.current || !canWrite) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      await pms.toggleMaster('units', row.id);
      setDraft(current => current?.id === row.id ? { ...current, active: row.active === false } : current);
      setNotice(tUi('inventorySettings.saved'));
    } catch (err) { setError(err.message); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="inventory-units" aria-labelledby={`${formId}-title`} aria-busy={busy}>
    <header className="inventory-units-heading">
      <div><h2 id={`${formId}-title`}>{tUi('inventory.unit')}<span className="inventory-units-count">{units.length}</span></h2><p>{tUi('inventorySettings.unitsDescription')}</p></div>
      {canWrite && <button type="button" className="inventory-units-button inventory-units-primary" disabled={busy} onClick={event => openEditor(null, event)}><Plus size={16} aria-hidden="true" />{tUi('inventorySettings.addUnit')}</button>}
    </header>

    {error && <p className="inventory-units-notice is-error" role="alert">{error}</p>}
    {notice && <p className="inventory-units-notice" role="status"><Check size={16} aria-hidden="true" />{notice}</p>}
    {!canWrite && <p className="inventory-units-readonly" role="status">{tUi('inventorySettings.readOnly')}</p>}

    {canWrite && draft && <form className="inventory-units-editor" onSubmit={save} data-workspace-draft>
      <fieldset disabled={busy}>
        <div className="inventory-units-editor-heading"><h3>{tUi(draft.id ? 'inventorySettings.editUnit' : 'inventorySettings.addUnit')}</h3><button type="button" className="inventory-units-icon-button" aria-label={tUi('common.close')} onClick={closeEditor}><X size={18} aria-hidden="true" /></button></div>
        <label htmlFor={`${formId}-name`}>{tUi('inventorySettings.unitName')} <span aria-hidden="true">*</span></label>
        <input id={`${formId}-name`} autoFocus required maxLength={160} value={draft.name} placeholder={tUi('inventorySettings.unitPlaceholder')} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />
        <div className="inventory-units-editor-footer"><span>{tUi('inventorySettings.requiredHint')}</span><div><button type="button" className="inventory-units-button" onClick={closeEditor}>{tUi('common.cancel')}</button><button type="submit" className="inventory-units-button inventory-units-primary" disabled={!draft.name.trim()}><Save size={16} aria-hidden="true" />{busy ? tUi('common.saving') : tUi('inventorySettings.save')}</button></div></div>
      </fieldset>
    </form>}

    <div className="inventory-units-toolbar">
      <label className="inventory-units-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label={tUi('inventorySettings.searchUnits')} placeholder={tUi('inventorySettings.searchUnits')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label={tUi('inventorySettings.statusFilter')} value={status} onChange={event => setStatus(event.target.value)}><option value="all">{tUi('common.allStatuses')}</option><option value="active">{tUi('common.active')}</option><option value="inactive">{tUi('common.inactive')}</option></select>
      <span className="inventory-units-results">{tUi('inventorySettings.results', { shown: rows.length, total: units.length })}</span>
    </div>
    {rows.length ? <div className="inventory-units-table" role="region" aria-label={tUi('inventory.unit')} tabIndex={0}><table>
      <thead><tr><th scope="col">{tUi('inventorySettings.unitName')}</th><th scope="col">{tUi('common.status')}</th>{canWrite && <th scope="col" className="inventory-units-actions-heading">{tUi('common.actions')}</th>}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} className={row.active === false ? 'is-inactive' : undefined}>
        <td><div className="inventory-units-name"><span className="inventory-units-row-icon"><Ruler size={17} aria-hidden="true" /></span><strong>{row.name}</strong></div></td>
        <td><span className={`inventory-units-status ${row.active !== false ? 'is-active' : ''}`}><span aria-hidden="true" />{tUi(row.active !== false ? 'common.active' : 'common.inactive')}</span></td>
        {canWrite && <td><div className="inventory-units-row-actions"><button type="button" className="inventory-units-edit" disabled={busy} aria-label={`${tUi('common.edit')} ${row.name}`} onClick={event => openEditor(row, event)}><Pencil size={15} aria-hidden="true" /><span>{tUi('common.edit')}</span></button><button type="button" className="inventory-units-switch" role="switch" aria-checked={row.active !== false} aria-label={tUi('inventorySettings.toggle', { name: row.name })} title={tUi('inventorySettings.toggleHint')} disabled={busy} onClick={() => toggle(row)}><span aria-hidden="true" /></button></div></td>}
      </tr>)}</tbody>
    </table></div> : <div className="inventory-units-empty"><span><Ruler size={26} aria-hidden="true" /></span><h3>{tUi(units.length ? 'inventorySettings.noResults' : 'inventorySettings.empty')}</h3><p>{tUi(units.length ? 'inventorySettings.noResultsHint' : 'inventorySettings.emptyHint')}</p>{units.length > 0 && <button type="button" className="inventory-units-button" onClick={() => { setQuery(''); setStatus('all'); }}>{tUi('inventorySettings.clearFilters')}</button>}</div>}
  </section>;
}
