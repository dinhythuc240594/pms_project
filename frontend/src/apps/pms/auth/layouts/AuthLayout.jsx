import { t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { Link, Outlet } from 'react-router-dom';
import { ArrowLeft, BedDouble } from 'lucide-react';
import LohaBrand from '../../../../shared/components/LohaBrand';
import LanguageSwitcher from '../../../../shared/i18n/LanguageSwitcher.jsx';
import './AuthLayout.css';

export default function AuthLayout() {
  useI18n();
  return (
    <div className="loha-home loha-auth">
      <aside className="loha-auth-aside" aria-label="LOHA">
        <div className="loha-auth-brand-row">
          <LohaBrand />
          <Link className="loha-auth-back" to="/"><ArrowLeft size={15} aria-hidden="true" />{tUi("auth.home")}</Link>
        </div>
        <div className="loha-auth-story">
          <span className="loha-auth-kicker">{tUi("auth.tagline")}</span>
          <p className="loha-auth-story-title">{tUi("auth.operate")}<br />{tUi("auth.welcome")}<br /><em>{tUi("auth.wholehearted")}</em></p>
          <p className="loha-auth-story-copy">{tUi("auth.story")}</p>
          <div className="loha-auth-photo">
            <img src="https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=1000&q=80" alt={tUi("auth.image")} width="1000" height="750" />
            <div><span>LOHA PMS SYSTEM</span>{tUi("auth.behind")}</div>
          </div>
        </div>
        <p className="loha-auth-aside-footer"><BedDouble size={18} aria-hidden="true" />{tUi("auth.builtFor")}</p>
      </aside>
      <main className="loha-auth-panel">
        <div className="loha-auth-form-wrap"><div className="loha-auth-language"><LanguageSwitcher /></div><Outlet /></div>
        <footer className="loha-auth-panel-footer">
          <span>© {new Date().getFullYear()} LOHA PMS.</span>
          <nav aria-label={tUi("auth.info")}><Link to="/pricing">{tUi("auth.price")}</Link><Link to="/contact">{tUi("auth.contact")}</Link></nav>
        </footer>
      </main>
    </div>
  );
}
