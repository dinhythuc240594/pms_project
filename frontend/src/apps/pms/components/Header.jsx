import { t as tUi, tr as labelUi, useI18n } from '../../../shared/i18n/useI18n.js';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronDown, Info, KeyRound, LogOut, Menu, Settings, ShieldCheck, UserRound, Users } from 'lucide-react';
import { AccessLink as Link } from '../../../shared/components/AccessControl';
import LegacyOverlay from './LegacyOverlay';
import UsageInfoModal from './UsageInfoModal';
import NotificationBell from './NotificationBell';
import { usePms } from '../data/usePms';
import { ROLE_NAMES } from '../data/access';
import LanguageSwitcher from '../../../shared/i18n/LanguageSwitcher.jsx';
import { useDraftNavigation } from '../../../shared/drafts/DraftGuardProvider';

export default function Header({ onOpenNavigation }) {
  useI18n();
  const { logout, user, role, tenant, isManager, subscription, settingsPath } = usePms();
  const [profileOpen, setProfileOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const profileRef = useRef(null);
  const triggerRef = useRef(null);
  const navigate = useNavigate();
  const { requestLeave } = useDraftNavigation();
  const initials = (user?.name || user?.email || 'L').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  useEffect(() => {
    if (!profileOpen) return;
    const closeOutside = event => { if (!profileRef.current?.contains(event.target)) setProfileOpen(false); };
    const closeEscape = event => { if (event.key === 'Escape') { setProfileOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, [profileOpen]);
  function handleLogout() {
    requestLeave(async () => {
      setSigningOut(true);
      try { await logout(); navigate('/id/login'); }
      catch { /* Provider displays the server error and keeps the session. */ }
      finally { setSigningOut(false); }
    });
  }
  function openUsage() { setProfileOpen(false); setUsageOpen(true); }
  const links = [
    { to: '/id/profile', label: 'Hồ sơ cá nhân', icon: UserRound },
    { to: '/id/profile?tab=security', label: 'Đổi mật khẩu', icon: KeyRound },
    { to: settingsPath, label: 'Cài đặt hệ thống', icon: Settings },
    { to: '/id/users', label: 'Quản lý người dùng', icon: Users },
  ];
  return (
    <header className="pms-topbar">
      <div className="pms-topbar-context"><button type="button" className="pms-topbar-icon pms-menu-trigger" aria-label={tUi("header.openHotelMenu")} aria-haspopup="dialog" aria-controls="pms-mobile-navigation" onClick={onOpenNavigation}><Menu size={20} /></button><Building2 className="pms-context-icon" size={20} aria-hidden="true" /><div><span>{tUi("header.workspace")}</span><strong title={tenant?.name}>{tenant?.name || 'LOHA PMS'}</strong></div></div>
      <div className="pms-topbar-actions">
        <div className="pms-topbar-language"><LanguageSwitcher compact /></div>
        <NotificationBell />
        <button type="button" className="pms-plan-button" onClick={openUsage} aria-label={tUi("header.planInfo")}><ShieldCheck size={16} /><span>{subscription?.planName || tUi("header.plan")}</span><ChevronDown size={14} /></button>
        <div className="pms-account" ref={profileRef}>
          <button type="button" className="pms-account-trigger" ref={triggerRef} aria-label={tUi("header.accountMenu")} aria-expanded={profileOpen} aria-controls={profileOpen ? 'pms-account-menu' : undefined} onClick={() => setProfileOpen(!profileOpen)}><span className="pms-account-avatar">{initials}</span><span className="pms-account-copy"><strong>{user?.name}</strong><small>{labelUi(ROLE_NAMES[role])}</small></span><ChevronDown size={15} aria-hidden="true" /></button>
          {profileOpen && <div id="pms-account-menu" className="pms-account-menu"><div className="pms-account-identity"><strong>{user?.name}</strong><span>{user?.email}</span><small>{labelUi(ROLE_NAMES[role])}</small></div>
            <div className="pms-account-language"><LanguageSwitcher /></div>
            {isManager && <Link to="/manager/tenants" onClick={() => setProfileOpen(false)}><ShieldCheck size={17} />{tUi("header.admin")}</Link>}
            {links.map(({ to, label, icon: Icon }) => <Link key={to} to={to} onClick={() => setProfileOpen(false)}><Icon size={17} aria-hidden="true" />{labelUi(label)}</Link>)}
            <button type="button" onClick={openUsage}><Info size={17} />{tUi("header.usage")}</button><button type="button" className="pms-account-logout" onClick={handleLogout} disabled={signingOut}><LogOut size={17} />{signingOut ? tUi("header.loggingOut") : tUi("header.logout")}</button>
          </div>}
        </div>
      </div>
      {usageOpen && <LegacyOverlay title={tUi("header.usage")} onClose={() => setUsageOpen(false)}><UsageInfoModal isOpen onClose={() => setUsageOpen(false)} /></LegacyOverlay>}
    </header>
  );
}
