import { emailInput, emailPattern } from '../../../../shared/lib/validation.js';
import { catalogNumericInput } from './catalogForm.js';
import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, List, Pencil, Plus, RefreshCw, Save, Search, X } from 'lucide-react';
import { getIntlLocale } from '../../../../shared/i18n/store.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { AccessLink } from '../../../../shared/components/AccessControl';
import { usePms } from '../../data/usePms';
import { money } from '../../data/model';
import { useRevealActive } from '../../components/useRevealActive';
import './SettingsCatalogs.css';

function CatalogSwitch({ active, disabled, label, onToggle }) {
  return <button type="button" className="pms-catalog-switch" role="switch" aria-checked={active} aria-label={label} title={tUi('settings.toggleHint')} disabled={disabled} onClick={onToggle}><span aria-hidden="true" /></button>;
}

function CatalogStatus({ active }) {
  return <span className={`pms-catalog-status${active ? ' is-active' : ''}`}><span aria-hidden="true" />{tUi(active ? 'common.active' : 'common.inactive')}</span>;
}

function CatalogNotice({ error, message }) {
  return <>{error && <p className="pms-catalog-notice is-error" role="alert">{error}</p>}{message && <p className="pms-catalog-notice" role="status"><Check size={16} aria-hidden="true" />{message}</p>}</>;
}

function CatalogEmpty({ filtered, onClear }) {
  return <div className="pms-catalog-empty"><span><List size={25} aria-hidden="true" /></span><h3>{tUi(filtered ? 'inventorySettings.noResults' : 'inventorySettings.empty')}</h3><p>{tUi(filtered ? 'inventorySettings.noResultsHint' : 'settings.catalogEmptyHint')}</p>{filtered && <button type="button" className="pms-catalog-button" onClick={onClear}>{tUi('inventorySettings.clearFilters')}</button>}</div>;
}

function EditorFooter({ busy, editing, onCancel }) {
  return <div className="pms-catalog-editor-footer"><div><button type="button" className="pms-catalog-button" onClick={onCancel}>{tUi('common.cancel')}</button><button type="submit" className="pms-catalog-button is-primary"><Save size={16} aria-hidden="true" />{tUi(busy ? 'common.saving' : editing ? 'common.saveChanges' : 'common.save')}</button></div></div>;
}

function useEditorFocus(draft, busy) {
  const triggerRef = useRef(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!draft && !busy && restoreFocus.current) {
      restoreFocus.current = false;
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    }
  }, [draft, busy]);
  const rememberTrigger = trigger => { triggerRef.current = trigger; restoreFocus.current = false; };
  const requestRestore = () => { restoreFocus.current = true; };
  const cancelRestore = () => { restoreFocus.current = false; };
  return { rememberTrigger, requestRestore, cancelRestore };
}

export function MasterGrid({ catalog, title, description, fields, rows, transform, activation = false, searchable = false }) {
  useI18n();
  const pms = usePms();
  const formId = useId();
  const canWrite = pms.access('settings.write').allowed;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const { rememberTrigger, requestRestore } = useEditorFocus(draft, busy);
  const allRows = rows || pms[catalog] || [];
  const list = allRows.filter(row => !searchable || ((!category || row.category === category) && `${row.name} ${row.id}`.toLowerCase().includes(query.toLowerCase())));
  const categoryOptions = fields.find(field => field.key === 'category')?.options;
  const blank = () => Object.fromEntries(fields.map(field => [field.key, field.default ?? (field.type === 'number' ? 0 : '')]));

  const openEditor = (event, row) => {
    if (busyRef.current || !canWrite) return;
    rememberTrigger(event.currentTarget);
    setDraft(row ? { ...row } : blank());
    setEditing(Boolean(row)); setError(''); setMessage('');
  };
  const closeEditor = () => {
    requestRestore();
    setDraft(null); setEditing(false); setError('');
  };
  const save = async event => {
    event.preventDefault();
    if (busyRef.current || !canWrite || !draft) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const item = { ...draft };
      if (catalog === 'roomTypes' && !item.code?.trim()) {
        if (!editing || (pms[catalog] || []).find(row => row.id === item.id)?.code) throw new Error(tUi('settings.typeCodeRequired'));
        delete item.code;
      }
      for (const field of fields) if (field.type === 'number') item[field.key] = catalogNumericInput(field.key, item[field.key]);
      if (!editing && item.id && (pms[catalog] || []).some(row => row.id === item.id)) throw new Error(tUi('settings.duplicateCode'));
      if (!editing) delete item.id;
      await pms.saveMaster(catalog, transform ? transform(item) : item);
      closeEditor(); setMessage(tUi('settings.catalogSaved'));
    } catch (err) { setError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const toggle = async row => {
    if (busyRef.current || !canWrite) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await pms.toggleMaster(catalog, row.id);
      setDraft(current => current?.id === row.id ? { ...current, active: row.active === false } : current);
    } catch (err) { setError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const renderValue = (row, field) => {
    if (field.type === 'checkbox') return <input type="checkbox" checked={!!row[field.key]} aria-label={labelUi(field.label)} readOnly disabled />;
    if (field.key === 'price') return money(row[field.key] ?? 0, pms.settings?.currency);
    if (field.type === 'number') return Number(row[field.key] || 0).toLocaleString(getIntlLocale());
    if (field.key === 'category') return <span className="pms-catalog-category">{row[field.key] || '—'}</span>;
    if (field.key === 'code') return <span className="pms-catalog-code">{row.code || tUi('common.unsetCode')}</span>;
    return field.options?.find(option => option.value === row[field.key])?.label ?? row[field.key] ?? '—';
  };

  return <section className="pms-catalog" aria-labelledby={`${formId}-title`} aria-busy={busy}>
    <header className="pms-catalog-heading"><div><h2 id={`${formId}-title`}>{labelUi(title)}<span className="pms-catalog-count">{allRows.length}</span></h2><p>{description || tUi('settings.catalogDescription')}</p></div>{canWrite && <button type="button" className="pms-catalog-button is-primary" disabled={busy} onClick={event => openEditor(event)}><Plus size={16} aria-hidden="true" />{tUi('settings.catalogAdd')}</button>}</header>
    <CatalogNotice error={error} message={message} />
    {!canWrite && <p className="pms-catalog-readonly" role="status">{tUi('settings.catalogReadOnly')}</p>}

    {canWrite && draft && <form className="pms-catalog-editor" onSubmit={save} data-workspace-draft>
      <fieldset disabled={busy}>
        <div className="pms-catalog-editor-heading"><h3>{tUi(editing ? 'settings.catalogEdit' : 'settings.catalogAdd')}<span>{labelUi(title)}</span></h3><button type="button" className="pms-catalog-icon-button" aria-label={tUi('common.close')} onClick={closeEditor}><X size={18} aria-hidden="true" /></button></div>
        <div className="pms-catalog-form-grid">{fields.map((field, index) => <div className={`pms-catalog-field${field.key === 'roomNumbers' ? ' is-wide' : ''}${field.type === 'checkbox' ? ' is-checkbox' : ''}`} key={field.key}>
          <label htmlFor={`${formId}-${field.key}`}>{labelUi(field.label)}</label>
          {field.type === 'checkbox' ? <input id={`${formId}-${field.key}`} autoFocus={index === 0} type="checkbox" checked={!!draft[field.key]} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.checked }))} /> : field.options ? <select id={`${formId}-${field.key}`} autoFocus={index === 0} value={draft[field.key] ?? ''} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))}><option value="">{tUi('common.select')}</option>{field.options.map(option => <option key={option.value ?? option} value={option.value ?? option} disabled={option.disabled}>{option.label ?? option}</option>)}</select> : <input id={`${formId}-${field.key}`} autoFocus={index === 0} type={field.type === 'number' ? 'text' : field.type || 'text'} inputMode={field.type === 'number' ? field.key === 'capacity' ? 'numeric' : 'decimal' : undefined} required={field.type === 'number' || field.key === 'name'} pattern={field.type === 'number' ? field.key === 'capacity' ? '[0-9]+' : '[0-9]{1,15}([.][0-9]{1,4})?' : field.key === 'name' ? '.*\\S.*' : undefined} maxLength={field.key === 'code' ? 40 : field.key === 'name' ? 160 : field.type === 'number' ? 20 : undefined} readOnly={field.key === 'id' && editing} value={draft[field.key] ?? ''} placeholder={labelUi(field.label)} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} />}
        </div>)}</div>
        {activation && <div className="pms-catalog-editor-activation"><span>{tUi('common.activate')}</span><CatalogSwitch active={draft.active !== false} label={tUi('settings.enableCatalog')} onToggle={() => setDraft(current => ({ ...current, active: current.active === false }))} /></div>}
        <EditorFooter busy={busy} editing={editing} onCancel={closeEditor} />
      </fieldset>
    </form>}

    {searchable && <div className="pms-catalog-toolbar"><label className="pms-catalog-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label={tUi('settings.catalogSearch')} placeholder={tUi('settings.catalogSearch')} value={query} onChange={event => setQuery(event.target.value)} /></label>{categoryOptions && <select aria-label={tUi('settings.itemFilter')} value={category} onChange={event => setCategory(event.target.value)}><option value="">{tUi('common.allCategories')}</option>{categoryOptions.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}</select>}<span className="pms-catalog-results">{tUi('inventorySettings.results', { shown: list.length, total: allRows.length })}</span></div>}
    {list.length ? <div className="pms-catalog-table" role="region" aria-label={labelUi(title)} tabIndex={0}><table><thead><tr>{fields.map(field => <th scope="col" key={field.key}>{labelUi(field.label)}</th>)}<th scope="col">{tUi('common.status')}</th>{canWrite && <th scope="col" className="pms-catalog-actions-heading">{tUi('common.actions')}</th>}</tr></thead><tbody>
      {list.map(row => <tr key={row.id} className={row.active === false ? 'is-inactive' : undefined}>{fields.map(field => <td key={field.key} className={field.type === 'number' ? 'pms-catalog-number' : field.key === 'name' ? 'pms-catalog-name' : undefined}>{renderValue(row, field)}</td>)}<td><CatalogStatus active={row.active !== false} /></td>{canWrite && <td><div className="pms-catalog-row-actions"><button type="button" className="pms-catalog-edit" disabled={busy} aria-label={`${tUi('common.edit')} ${row.name || row.id}`} onClick={event => openEditor(event, row)}><Pencil size={15} aria-hidden="true" /><span>{tUi('common.edit')}</span></button><CatalogSwitch active={row.active !== false} disabled={busy} label={`${tUi(row.active === false ? 'common.on' : 'common.off')} ${row.name || row.id}`} onToggle={() => toggle(row)} /></div></td>}</tr>)}
    </tbody></table></div> : <CatalogEmpty filtered={Boolean(searchable && (query || category))} onClear={() => { setQuery(''); setCategory(''); }} />}
  </section>;
}

export function BookingSources() {
  useI18n();
  const formId = useId();
  const [filterType, setFilterType] = useState('Travel Agency');
  const typeTabsRef = useRef(null);
  useRevealActive(typeTabsRef, filterType);
  const { bookingSources: sources = [], saveMaster, toggleMaster, access } = usePms();
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const { rememberTrigger, requestRestore, cancelRestore } = useEditorFocus(draft, busy);
  const canWrite = access('settings.write').allowed;
  const filteredSources = sources.filter(source => source.type === filterType);
  const showCommissionAndEmail = ['OTA', 'Travel Agency', 'Corporate', 'Reference'].includes(filterType);

  const openEditor = (event, row) => {
    if (working.current || !canWrite) return;
    rememberTrigger(event.currentTarget);
    setDraft(row ? { ...row, email: row.email || '' } : { name: '', commission: 0, email: '' });
    setError(''); setMessage('');
  };
  const closeEditor = () => {
    requestRestore();
    setDraft(null); setError('');
  };
  const toggleSource = async row => {
    if (working.current || !canWrite) return;
    working.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await toggleMaster('bookingSources', row.id);
      setDraft(current => current?.id === row.id ? { ...current, active: row.active === false } : current);
      setMessage(tUi('settings.sourceStatusSaved'));
    } catch (err) { setError(err.message); }
    finally { working.current = false; setBusy(false); }
  };
  const save = async event => {
    event.preventDefault();
    if (working.current || !canWrite || !draft) return;
    working.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await saveMaster('bookingSources', { ...draft, type: filterType, commission: catalogNumericInput('commission', draft.commission), email: draft.email?.trim() ? emailInput(draft.email) : '' });
      closeEditor(); setMessage(tUi('settings.sourceSaved'));
    } catch (err) { setError(err.message); }
    finally { working.current = false; setBusy(false); }
  };

  return <section className="pms-catalog" aria-labelledby={`${formId}-title`} aria-busy={busy}>
    <header className="pms-catalog-heading"><div><h2 id={`${formId}-title`}>{tUi('settings.sourcesPartners')}<span className="pms-catalog-count">{sources.length}</span></h2><p>{tUi('settings.sourceIntro')}</p></div><div className="pms-catalog-heading-actions">{filterType === 'OTA' && <AccessLink to="/id/settings?section=channels" className="pms-catalog-button" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}><RefreshCw size={16} aria-hidden="true" />{tUi('nav.channelManagement')}</AccessLink>}{canWrite && <button type="button" className="pms-catalog-button is-primary" disabled={busy} onClick={event => openEditor(event)}><Plus size={16} aria-hidden="true" />{tUi('settings.catalogAdd')}</button>}</div></header>
    <div ref={typeTabsRef} className="pms-catalog-type-tabs" role="group" aria-label={tUi('common.type')}>{['Travel Agency', 'Corporate', 'OTA', 'Direct', 'Reference'].map(type => <button key={type} type="button" aria-pressed={filterType === type} disabled={busy} onClick={() => { cancelRestore(); setFilterType(type); setDraft(null); setError(''); setMessage(''); }}>{type}</button>)}</div>
    <CatalogNotice error={error} message={message} />
    {!canWrite && <p className="pms-catalog-readonly" role="status">{tUi('settings.sourceReadOnly')}</p>}

    {canWrite && draft && <form className="pms-catalog-editor" onSubmit={save} data-workspace-draft>
      <fieldset disabled={busy}>
        <div className="pms-catalog-editor-heading"><h3>{tUi(draft.id ? 'settings.catalogEdit' : 'settings.catalogAdd')}<span>{filterType}</span></h3><button type="button" className="pms-catalog-icon-button" aria-label={tUi('common.close')} onClick={closeEditor}><X size={18} aria-hidden="true" /></button></div>
        <div className="pms-catalog-form-grid">
          <div className="pms-catalog-field"><label htmlFor={`${formId}-name`}>{tUi('settings.sourceName')} <span aria-hidden="true">*</span></label><input id={`${formId}-name`} autoFocus type="text" required maxLength={160} value={draft.name} placeholder={tUi('settings.sourceName')} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></div>
          {showCommissionAndEmail && <><div className="pms-catalog-field"><label htmlFor={`${formId}-commission`}>{tUi('settings.commissionPercent')} <span aria-hidden="true">*</span></label><input id={`${formId}-commission`} type="text" inputMode="decimal" pattern="[0-9]{1,3}([.][0-9]{1,4})?" maxLength={8} required value={draft.commission} onChange={event => setDraft(current => ({ ...current, commission: event.target.value }))} /></div><div className="pms-catalog-field is-wide"><label htmlFor={`${formId}-email`}>{tUi('settings.sourceEmail')}</label><input id={`${formId}-email`} type="email" pattern={emailPattern} maxLength={254} value={draft.email} placeholder={tUi('settings.optionalEmail')} onChange={event => setDraft(current => ({ ...current, email: event.target.value }))} /></div></>}
        </div>
        <p className="pms-catalog-required-hint">{tUi('inventorySettings.requiredHint')}</p>
        <EditorFooter busy={busy} editing={Boolean(draft.id)} onCancel={closeEditor} />
      </fieldset>
    </form>}

    <div className="pms-catalog-list-heading"><span>{filterType}</span><span className="pms-catalog-results">{tUi('inventorySettings.results', { shown: filteredSources.length, total: sources.length })}</span></div>
    {filteredSources.length ? <div className="pms-catalog-table" role="region" aria-label={tUi('settings.sourcesPartners')} tabIndex={0}><table><thead><tr><th scope="col">{tUi('settings.partnerName')}</th>{showCommissionAndEmail && <><th scope="col">{tUi('settings.commissionPercent')}</th><th scope="col">{tUi('common.email')}</th></>}<th scope="col">{tUi('common.status')}</th>{canWrite && <th scope="col" className="pms-catalog-actions-heading">{tUi('common.actions')}</th>}</tr></thead><tbody>{filteredSources.map(source => <tr key={source.id} className={source.active === false ? 'is-inactive' : undefined}><td className="pms-catalog-name">{source.name}</td>{showCommissionAndEmail && <><td className="pms-catalog-number">{source.commission}%</td><td>{source.email || '—'}</td></>}<td><CatalogStatus active={source.active !== false} /></td>{canWrite && <td><div className="pms-catalog-row-actions"><button type="button" className="pms-catalog-edit" disabled={busy} aria-label={`${tUi('common.edit')} ${source.name}`} onClick={event => openEditor(event, source)}><Pencil size={15} aria-hidden="true" /><span>{tUi('common.edit')}</span></button><CatalogSwitch active={source.active !== false} disabled={busy} label={`${tUi(source.active === false ? 'common.on' : 'common.off')} ${source.name}`} onToggle={() => toggleSource(source)} /></div></td>}</tr>)}</tbody></table></div> : <CatalogEmpty filtered={false} />}
  </section>;
}
