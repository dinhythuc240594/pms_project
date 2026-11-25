import { formatDateTime } from '../../../../shared/lib/date.js'
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  KeyRound,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import { passwordChangeInput, profileName } from '../../../pms/profile/pages/profileForm'
import './AdminProfile.css'

const dateText = (value) => formatDateTime(value)
const emptyPasswords = { currentPassword: '', newPassword: '', confirm: '' }

export default function AdminProfile() {
  const { authGeneration } = usePms()
  return <ProfileWorkspace key={authGeneration} />
}

function ProfileWorkspace() {
  useI18n()
  const { user, saveOwnProfile, changePassword, getOwnSessions, revokeOtherSessions } = usePms()
  const [name, setName] = useState(user?.name || '')
  const [passwords, setPasswords] = useState(emptyPasswords)
  const [sessionData, setSessionData] = useState({ revision: -1, rows: [], error: '' })
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState('')
  const [feedback, setFeedback] = useState({})
  const working = useRef(false)
  useEffect(() => {
    let cancelled = false
    getOwnSessions()
      .then((data) => {
        if (!cancelled) setSessionData({ revision, rows: data.sessions || [], error: '' })
      })
      .catch((failure) => {
        if (!cancelled) setSessionData({ revision, rows: [], error: failure.message })
      })
    return () => {
      cancelled = true
    }
  }, [getOwnSessions, revision])
  const loading = sessionData.revision !== revision
  const sessions = loading ? [] : sessionData.rows
  const sessionError = loading ? '' : sessionData.error
  const busy = Boolean(pending)

  async function run(section, action, success) {
    if (working.current) return
    working.current = true
    setPending(section)
    setFeedback((previous) => ({ ...previous, [section]: null }))
    try {
      await action()
      setFeedback((previous) => ({ ...previous, [section]: { message: success } }))
    } catch (failure) {
      setFeedback((previous) => ({ ...previous, [section]: { error: failure.message } }))
    } finally {
      working.current = false
      setPending('')
    }
  }

  function saveProfile(event) {
    event.preventDefault()
    run(
      'info',
      async () => {
        const result = await saveOwnProfile(profileName(name))
        setName(result.user.name)
      },
      tUi('profile.saved'),
    )
  }

  function savePassword(event) {
    event.preventDefault()
    run(
      'password',
      async () => {
        await changePassword(passwordChangeInput(passwords))
        setPasswords(emptyPasswords)
        setRevision((value) => value + 1)
      },
      tUi('profile.passwordSaved'),
    )
  }

  function renderFeedback(section) {
    const status = feedback[section]
    return (
      status && (
        <p
          className={`manager-profile-feedback${status.error ? ' is-error' : ''}`}
          role={status.error ? 'alert' : 'status'}
        >
          {!status.error && <CheckCircle2 size={16} aria-hidden="true" />}
          {labelUi(status.error || status.message)}
        </p>
      )
    )
  }

  return (
    <div className="manager-page manager-self-profile">
      <section
        className="manager-panel manager-profile-card"
        aria-labelledby="manager-profile-info"
      >
        <header className="manager-profile-section-heading">
          <span className="manager-profile-section-icon">
            <UserRound size={20} aria-hidden="true" />
          </span>
          <div>
            <h3 id="manager-profile-info">{tUi('profile.info')}</h3>
            <p>{tUi('profile.nameHint')}</p>
          </div>
        </header>
        <form onSubmit={saveProfile} aria-busy={pending === 'info'}>
          <div className="manager-profile-fields">
            <label>
              {tUi('common.fullName')}
              <input
                name="name"
                autoComplete="name"
                required
                maxLength={160}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              {tUi('auth.email')}
              <input
                name="email"
                autoComplete="email"
                readOnly
                type="email"
                value={user?.email || ''}
                aria-describedby="manager-profile-email-hint"
              />
            </label>
          </div>
          <p className="manager-profile-hint" id="manager-profile-email-hint">
            {tUi('profile.emailHint')}
          </p>
          <footer className="manager-profile-card-actions">
            {renderFeedback('info')}
            <button
              className="manager-button manager-button-primary"
              type="submit"
              disabled={busy || !name.trim() || name.trim() === user?.name}
            >
              <Save size={16} aria-hidden="true" />
              {pending === 'info' ? tUi('common.saving') : tUi('profile.save')}
            </button>
          </footer>
        </form>
      </section>

      <section
        className="manager-panel manager-profile-card"
        aria-labelledby="manager-profile-password"
      >
        <header className="manager-profile-section-heading">
          <span className="manager-profile-section-icon">
            <KeyRound size={20} aria-hidden="true" />
          </span>
          <div>
            <h3 id="manager-profile-password">{tUi('profile.password')}</h3>
            <p>{tUi('profile.passwordIntro')}</p>
          </div>
        </header>
        <form onSubmit={savePassword} aria-busy={pending === 'password'}>
          <div className="manager-profile-fields manager-profile-password-fields">
            <label>
              {tUi('profile.currentPassword')}
              <input
                name="currentPassword"
                required
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={passwords.currentPassword}
                disabled={busy}
                onChange={(event) =>
                  setPasswords((value) => ({ ...value, currentPassword: event.target.value }))
                }
              />
            </label>
            <label>
              {tUi('profile.newPassword')}
              <input
                name="newPassword"
                required
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                aria-describedby="manager-profile-password-hint"
                value={passwords.newPassword}
                disabled={busy}
                onChange={(event) =>
                  setPasswords((value) => ({ ...value, newPassword: event.target.value }))
                }
              />
            </label>
            <label>
              {tUi('profile.confirmPassword')}
              <input
                name="confirm"
                required
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={passwords.confirm}
                disabled={busy}
                onChange={(event) =>
                  setPasswords((value) => ({ ...value, confirm: event.target.value }))
                }
              />
            </label>
          </div>
          <p className="manager-profile-hint" id="manager-profile-password-hint">
            {tUi('profile.passwordHint')}
          </p>
          <footer className="manager-profile-card-actions">
            {renderFeedback('password')}
            <button className="manager-button manager-button-primary" type="submit" disabled={busy}>
              <ShieldCheck size={16} aria-hidden="true" />
              {pending === 'password' ? tUi('common.updating') : tUi('profile.updatePassword')}
            </button>
          </footer>
        </form>
      </section>

      <section
        className="manager-panel manager-profile-card manager-profile-sessions"
        aria-labelledby="manager-profile-sessions"
      >
        <header className="manager-profile-section-heading">
          <span className="manager-profile-section-icon">
            <ShieldCheck size={20} aria-hidden="true" />
          </span>
          <div>
            <h3 id="manager-profile-sessions">{tUi('profile.session')}</h3>
            <p>{tUi('profile.activeSessions')}</p>
          </div>
          <button
            className="manager-button"
            type="button"
            disabled={busy || loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {tUi('profile.reloadSessions')}
          </button>
        </header>
        {sessionError && (
          <p className="manager-profile-feedback is-error" role="alert">
            {sessionError}
          </p>
        )}
        {loading ? (
          <p className="manager-profile-session-state" role="status">
            {tUi('profile.loadingSessions')}
          </p>
        ) : (
          !sessionError &&
          (sessions.length ? (
            <ul className="manager-session-list">
              {sessions.map((session, index) => (
                <li key={session.createdAt + ':' + index}>
                  <span
                    className={`manager-profile-session-icon${session.current ? ' is-current' : ''}`}
                  >
                    <ShieldCheck size={20} aria-hidden="true" />
                  </span>
                  <div className="manager-profile-session-copy">
                    <strong>
                      {session.current
                        ? tUi('profile.currentSession')
                        : tUi('profile.otherSession')}
                    </strong>
                    <small>
                      {tUi('profile.signedIn')}{' '}
                      <time dateTime={session.createdAt}>{dateText(session.createdAt)}</time>
                    </small>
                  </div>
                  <small className="manager-profile-session-expiry">
                    {labelUi('Hết hạn')}{' '}
                    <time dateTime={session.expiresAt}>{dateText(session.expiresAt)}</time>
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="manager-profile-session-state" role="status">
              {tUi('profile.noSessions')}
            </p>
          ))
        )}
        <footer className="manager-profile-card-actions">
          {renderFeedback('sessions')}
          <button
            className="manager-button manager-profile-revoke"
            type="button"
            disabled={busy || loading || !sessions.some((row) => !row.current)}
            onClick={() =>
              run(
                'sessions',
                async () => {
                  await revokeOtherSessions()
                  setRevision((value) => value + 1)
                },
                tUi('profile.revoked'),
              )
            }
          >
            <LogOut size={16} aria-hidden="true" />
            {pending === 'sessions' ? tUi('common.updating') : tUi('profile.revokeOthers')}
          </button>
        </footer>
      </section>
    </div>
  )
}
