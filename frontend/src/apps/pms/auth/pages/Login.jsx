import { emailPattern } from '../../../../shared/lib/validation.js';
import { t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePms } from '../../data/usePms';
import { systemUser } from '../../data/api';
import { ArrowRight, CircleAlert, Eye, EyeOff, LoaderCircle } from 'lucide-react';

/**
 * COMPONENT: Login (Trang Đăng Nhập Hệ Thống)
 * Giao diện đồng bộ LOHA; giữ luồng đăng nhập và chuyển trang theo vai trò.
 */
export default function Login() {
  useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login, loading, loadError } = usePms();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Hàm xử lý sự kiện submit Form Đăng nhập
  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const account = await login(email, password, remember);
      setPassword('');
      const requested = params.get('next');
      const role = account.memberships?.find(m => m.active !== false)?.role;
      const home = systemUser(account) ? '/manager/dashboard' : role === 'HOUSEKEEPING' ? '/id/housekeeping/status' : role === 'ACCOUNTANT' ? '/id/cashflow' : '/id/dashboard';
      const safe = requested && /^\/(id|manager)(\/|$)/.test(requested) && !requested.startsWith('/id/login');
      navigate(safe ? requested : home, { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="loha-auth-heading">
        <span className="loha-auth-kicker">{tUi("auth.workspace")}</span>
        <h1>{tUi("auth.title")}</h1>
        <p>{tUi("auth.intro")}</p>
      </div>

      <form className="loha-auth-form" onSubmit={handleLogin} aria-busy={busy || loading}>
        {(error || loadError) && <div id="loha-login-error" className="loha-auth-error" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{error || loadError}</span></div>}
        <div className="loha-auth-field">
          <label htmlFor="loha-login-email">{tUi("auth.email")}</label>
          <input id="loha-login-email" name="email" type="email" pattern={emailPattern} maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={e => setEmail(e.target.value)} placeholder="ban@khachsan.vn" aria-describedby={error || loadError ? 'loha-login-error' : undefined} />
        </div>
        <div className="loha-auth-field">
          <label htmlFor="loha-login-password">{tUi("auth.password")}</label>
          <div className="loha-auth-password">
            <input id="loha-login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={tUi("auth.passwordPlaceholder")} aria-describedby={error || loadError ? 'loha-login-error' : undefined} />
            <button className="loha-auth-password-toggle" type="button" aria-label={showPassword ? tUi("auth.hidePassword") : tUi("auth.showPassword")} aria-pressed={showPassword} aria-controls="loha-login-password" onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <label className="loha-auth-remember">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          <span>{tUi("auth.remember")}</span>
        </label>
        <button className="loha-button loha-button-primary loha-auth-submit" type="submit" disabled={busy || loading}>
          {busy ? tUi("auth.signingIn") : loading ? tUi("auth.checking") : tUi("auth.signIn")}
          {busy || loading ? <LoaderCircle className="loha-auth-spinner" size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
        </button>
        <p className="loha-auth-forgot"><strong>{tUi("auth.forgot")}</strong>{tUi("auth.help")}</p>
      </form>
    </>
  );
}
