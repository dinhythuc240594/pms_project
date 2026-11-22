import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BedDouble, Check, MapPin, Pencil, Save, Search, X } from 'lucide-react';
import { usePms } from '../../data/usePms.js';
import { t, useI18n } from '../../../../shared/i18n/useI18n.js';
import './RoomLocations.css';

export default function RoomLocations() {
  useI18n();
  const { rooms, roomTypes, saveMaster, access } = usePms();
  const formId = useId();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const triggerRef = useRef(null);
  const restoreFocus = useRef(false);
  const searchRef = useRef(null);
  const firstFieldRef = useRef(null);
  const canWrite = access('settings.write').allowed;
  const list = rooms.filter(room => [room.id, room.floor, room.area].some(value => String(value ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const editedRoom = draft?.id;

  useEffect(() => {
    if (editedRoom) firstFieldRef.current?.focus();
  }, [editedRoom]);

  useEffect(() => {
    if (!draft && !busy && restoreFocus.current) {
      restoreFocus.current = false;
      (triggerRef.current?.isConnected ? triggerRef.current : searchRef.current)?.focus();
    }
  }, [draft, busy]);

  const edit = (room, event) => {
    if (saving.current || !canWrite) return;
    triggerRef.current = event.currentTarget;
    restoreFocus.current = false;
    setDraft({ id: room.id, floor: room.floor ?? '', area: room.area ?? '' });
    setError(''); setMessage('');
  };
  const cancel = () => {
    if (saving.current) return;
    restoreFocus.current = true;
    setDraft(null); setError('');
  };
  const save = async event => {
    event.preventDefault();
    if (!draft || saving.current || !canWrite) return;
    saving.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await saveMaster('rooms', { id: draft.id, floor: draft.floor.trim() || null, area: draft.area.trim() || null });
      restoreFocus.current = true;
      setDraft(null); setMessage(t('settings.roomLocationSaved'));
    } catch (err) { setError(err.message); }
    finally { saving.current = false; setBusy(false); }
  };

  return <section className="room-locations" aria-labelledby={`${formId}-title`} aria-busy={busy}>
    <header className="room-locations-heading">
      <div><h2 id={`${formId}-title`}>{t('rooms.configureLocations')}<span className="room-locations-count">{rooms.length}</span></h2><p>{t('settings.roomLocationHint')}</p></div>
      <Link className="room-locations-link" to="/id/settings?section=rooms&tab=room_types">{t('settings.roomTypes')}<ArrowUpRight size={15} aria-hidden="true" /></Link>
    </header>

    {error && <p role="alert" className="room-locations-notice is-error">{error}</p>}
    {message && <p role="status" className="room-locations-notice"><Check size={16} aria-hidden="true" />{message}</p>}
    {!canWrite && <p role="status" className="room-locations-readonly">{t('inventorySettings.readOnly')}</p>}

    {draft && <form className="room-locations-editor" onSubmit={save} data-workspace-draft>
      <fieldset disabled={busy}>
        <div className="room-locations-editor-heading"><h3><MapPin size={16} aria-hidden="true" />{t('settings.editRoomLocation', { id: draft.id })}</h3><button type="button" className="room-locations-icon-button" aria-label={t('common.close')} onClick={cancel}><X size={18} aria-hidden="true" /></button></div>
        <div className="room-locations-form-grid">
          {['area', 'floor'].map((field, index) => <label key={field} className="room-locations-field">{t(`rooms.${field}`)}
            <input ref={index === 0 ? firstFieldRef : undefined} maxLength={120} list={`${formId}-${field}`} value={draft[field]} disabled={!canWrite} aria-describedby={`${formId}-clear-hint`} onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} />
            <datalist id={`${formId}-${field}`}>{[...new Set(rooms.map(room => room[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(value => <option key={value} value={value} />)}</datalist>
          </label>)}
        </div>
        <div className="room-locations-editor-footer">
          <p id={`${formId}-clear-hint`}>{t('settings.roomLocationClearHint')}</p>
          <div className="room-locations-editor-actions"><button type="button" className="room-locations-button" onClick={cancel}>{t('common.cancel')}</button><button type="submit" disabled={!canWrite} className="room-locations-button is-primary"><Save size={16} aria-hidden="true" />{t(busy ? 'common.saving' : 'common.saveChanges')}</button></div>
        </div>
      </fieldset>
    </form>}

    <div className="room-locations-toolbar">
      <label className="room-locations-search"><Search size={17} aria-hidden="true" /><input ref={searchRef} type="search" aria-label={t('settings.roomLocationSearch')} placeholder={t('settings.roomLocationSearch')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <span className="room-locations-results">{t('inventorySettings.results', { shown: list.length, total: rooms.length })}</span>
    </div>
    <div className="room-locations-table" role="region" aria-label={t('rooms.configureLocations')} tabIndex={0}>
      <table>
        <thead><tr>{['rooms.number', 'common.roomType', 'rooms.area', 'rooms.floor', 'common.actions'].map(key => <th key={key} scope="col" className={key === 'common.actions' ? 'room-locations-actions-heading' : undefined}>{t(key)}</th>)}</tr></thead>
        <tbody>{list.map(room => <tr key={room.uuid || room.id} className={room.active === false ? 'is-inactive' : undefined}>
          <td><div className="room-locations-room"><span className="room-locations-room-icon"><BedDouble size={17} aria-hidden="true" /></span><div><strong data-i18n-ignore>{room.id}</strong>{room.active === false && <small>{t('settings.roomLocationInactive')}</small>}</div></div></td>
          <td data-i18n-ignore>{roomTypes.find(type => type.id === room.typeId)?.name || '—'}</td>
          <td>{room.area ? <span data-i18n-ignore>{room.area}</span> : <span className="room-locations-unassigned">{t('rooms.unassignedArea')}</span>}</td>
          <td>{room.floor ? <span data-i18n-ignore>{room.floor}</span> : <span className="room-locations-unassigned">{t('rooms.unassignedFloor')}</span>}</td>
          <td><div className="room-locations-row-actions"><button type="button" disabled={busy || !canWrite} className="room-locations-edit" onClick={event => edit(room, event)} aria-label={t('settings.editRoomLocation', { id: room.id })}><Pencil size={15} aria-hidden="true" /><span>{t('common.edit')}</span></button></div></td>
        </tr>)}
        {!list.length && <tr><td className="room-locations-empty" colSpan={5}><MapPin size={24} aria-hidden="true" /><p>{t(rooms.length ? 'rooms.noMatch' : 'rooms.none')}</p></td></tr>}</tbody>
      </table>
    </div>
  </section>;
}
