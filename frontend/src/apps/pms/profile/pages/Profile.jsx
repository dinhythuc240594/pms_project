import { formatDateTime } from '../../../../shared/lib/date.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, Save, Shield, LogOut, Receipt } from 'lucide-react';
import { usePms } from '../../data/usePms';
import { profileName, passwordChangeInput } from './profileForm';
import OwnerBilling from './OwnerBilling.jsx';
import './Profile.css';

const emptyPasswords = { currentPassword: '', newPassword: '', confirm: '' };

export default function Profile() {
  const { authGeneration, user, tenantId } = usePms();
  return <ProfileWorkspace key={`${authGeneration}:${user?.id}:${tenantId}`} />;
}

function ProfileWorkspace() {
  useI18n();
  const { user, tenant, access, logout, changePassword, saveOwnProfile, getOwnSessions, revokeOtherSessions } = usePms();
  const canViewBilling = access('billing.view', undefined, false).allowed;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = ['security', 'orders'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'info';
  const [isEditing, setIsEditing] = useState(false), [name, setName] = useState(user?.name || '');
  const [passwords, setPasswords] = useState(emptyPasswords), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [sessions, setSessions] = useState(null), [sessionError, setSessionError] = useState(''), [revision, setRevision] = useState(0);
  const working = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (activeTab !== 'security') return;
    let current = true;
    getOwnSessions().then(data => { if (current) { setSessions(data.sessions || []); setSessionError(''); } })
      .catch(failure => { if (current) { setSessions([]); setSessionError(failure.message); } });
    return () => { current = false; };
  }, [activeTab, getOwnSessions, revision]);

  async function run(action, success) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); if (mounted.current) setMessage(success); }
    catch (failure) { if (mounted.current) setError(failure.message); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }

  function selectTab(tab) {
    setSearchParams(tab === 'info' ? {} : { tab }); setError(''); setMessage('');
  }

  function editProfile(editing) {
    setName(user?.name || ''); setIsEditing(editing); setError(''); setMessage('');
  }

  function saveProfile(event) {
    event.preventDefault();
    if (!isEditing) return;
    run(async () => {
      const result = await saveOwnProfile(profileName(name));
      if (mounted.current) { setName(result.user.name); setIsEditing(false); }
    }, 'Đã lưu thông tin cá nhân.');
  }

  function savePassword(event) {
    event.preventDefault();
    run(async () => {
      await changePassword(passwordChangeInput(passwords));
      if (mounted.current) { setPasswords(emptyPasswords); setSessions(null); setRevision(value => value + 1); }
    }, 'Đã đổi mật khẩu và đăng xuất các phiên khác.');
  }

  return <div className="pms-original pms-profile">
    <header className="pms-profile-heading"><h1>{tUi("nav.profile")}</h1><p>{tenant?.name} · {user?.name}</p></header>
    <section className="pms-profile-panel">
      <nav className="pms-profile-tabs" aria-label={tUi("nav.profile")}>
        <button type="button" aria-pressed={activeTab === 'info'} disabled={busy} onClick={() => selectTab('info')}><User size={18} aria-hidden="true" />{tUi("profile.info")}</button>
        <button type="button" aria-pressed={activeTab === 'security'} disabled={busy} onClick={() => selectTab('security')}><Shield size={18} aria-hidden="true" />{tUi("profile.password")}</button>
        {canViewBilling && <button type="button" aria-pressed={activeTab === 'orders'} disabled={busy} onClick={() => selectTab('orders')}><Receipt size={18} aria-hidden="true" />{tUi("profile.orders")}</button>}
      </nav>
      <div className="pms-profile-body">
        {error && <p className="pms-profile-feedback is-error" role="alert">{error}</p>}
        {message && <p className="pms-profile-feedback is-success" role="status">{labelUi(message)}</p>}
        {activeTab === 'info' && <form onSubmit={saveProfile} aria-busy={busy} data-workspace-draft>
          <div className="pms-profile-section-heading"><div><h2>{tUi("profile.info")}</h2><p>{tUi("profile.nameHint")}</p></div><button type="button" className="pms-profile-button" disabled={busy} onClick={() => editProfile(!isEditing)}>{isEditing ? tUi("common.cancelEdit") : tUi("profile.edit")}</button></div>
          <div className="pms-profile-fields">
            <label>{tUi("common.fullName")}<input type="text" required maxLength={160} autoComplete="name" value={isEditing ? name : user?.name || ''} readOnly={!isEditing} disabled={busy} onChange={event => setName(event.target.value)} /></label>
            <label>{tUi("auth.email")}<input type="email" autoComplete="email" value={user?.email || ''} readOnly aria-describedby="profile-email-hint" /></label>
          </div>
          <p className="pms-profile-hint" id="profile-email-hint">{tUi("profile.emailHint")}</p>
          <div className="pms-profile-actions">
            {isEditing && <button type="submit" className="pms-profile-button is-primary" disabled={busy}><Save size={18} aria-hidden="true" />{busy ? tUi("common.saving") : tUi("common.saveChanges")}</button>}
            <button type="button" className="pms-profile-button is-danger" disabled={busy} onClick={() => run(logout, '')}><LogOut size={18} aria-hidden="true" />{tUi("profile.currentLogout")}</button>
          </div>
        </form>}
        {activeTab === 'security' && <><form onSubmit={savePassword} aria-busy={busy} data-workspace-draft>
          <div className="pms-profile-section-heading"><div><h2>{tUi("profile.password")}</h2><p>{tUi("profile.passwordIntro")}</p></div></div>
          <div className="pms-profile-fields">
            <label>{tUi("profile.currentPassword")}<input type="password" required maxLength={128} autoComplete="current-password" value={passwords.currentPassword} disabled={busy} onChange={event => setPasswords(value => ({ ...value, currentPassword: event.target.value }))} /></label>
            <label>{tUi("profile.newPassword")}<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="profile-password-hint" value={passwords.newPassword} disabled={busy} onChange={event => setPasswords(value => ({ ...value, newPassword: event.target.value }))} /></label>
            <label>{tUi("profile.confirmPassword")}<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={passwords.confirm} disabled={busy} onChange={event => setPasswords(value => ({ ...value, confirm: event.target.value }))} /></label>
          </div>
          <p className="pms-profile-hint" id="profile-password-hint">{tUi("profile.passwordHint")}</p>
          <div className="pms-profile-actions"><button type="submit" className="pms-profile-button is-primary" disabled={busy}><Shield size={18} aria-hidden="true" />{busy ? tUi("common.updating") : tUi("profile.updatePassword")}</button></div>
        </form>
        <section className="pms-profile-actions" aria-label={tUi("profile.sessions")}>
          <div className="pms-profile-section-heading"><div><h2>{tUi("profile.session")}</h2><p>{tUi("profile.activeSessions")}</p></div></div>
          {sessionError && <p className="pms-profile-feedback is-error" role="alert">{sessionError}</p>}
          {!sessions ? <p role="status">{tUi("profile.loadingSessions")}</p> : <ul style={{ width: '100%', padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>{sessions.map((session, index) => <li key={session.createdAt + ':' + index} style={{ padding: 16, background: 'var(--bg-main)', borderRadius: 8 }}><strong>{session.current ? tUi("profile.currentSession") : tUi("profile.otherSession")}</strong><p>{tUi("profile.signedIn")}{' '}{formatDateTime(session.createdAt)}{' '}{tUi("profile.expires")}{' '}{formatDateTime(session.expiresAt)}</p></li>)}</ul>}
          <button type="button" className="pms-profile-button" disabled={busy || !sessions} onClick={() => { setSessions(null); setRevision(value => value + 1); }}>{tUi("profile.reloadSessions")}</button>
          <button type="button" className="pms-profile-button is-danger" disabled={busy || !sessions?.some(session => !session.current)} onClick={() => run(async () => { await revokeOtherSessions(); if (mounted.current) { setSessions(null); setRevision(value => value + 1); } }, 'Đã đăng xuất các phiên khác. Phiên hiện tại vẫn hoạt động.')}><LogOut size={16} aria-hidden="true" />{tUi("profile.revokeOthers")}</button>
        </section></>}
        {activeTab === 'orders' && (canViewBilling ? <OwnerBilling /> : <p className="pms-profile-feedback is-error" role="alert">{tUi('billing.denied')}</p>)}
      </div>
    </section>
  </div>;
}
