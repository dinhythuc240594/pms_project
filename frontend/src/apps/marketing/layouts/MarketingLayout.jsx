import { tr as labelUi, t as tUi, useI18n } from '../../../shared/i18n/useI18n.js';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import LohaBrand from '../../../shared/components/LohaBrand';
import LanguageSwitcher from '../../../shared/i18n/LanguageSwitcher.jsx';
import './MarketingLayout.css';
import '../Marketing.css';

const navigation = [
  ['/', 'Trang chủ'],
  ['/pricing', 'Bảng giá'],
  ['/blog', 'Blog'],
  ['/contact', 'Liên hệ'],
];

export default function MarketingLayout() {
  useI18n();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const headerRef = useRef(null);

  useEffect(() => {
    const header = headerRef.current;
    const updateHeight = () => header.parentElement.style.setProperty('--loha-header-height', `${header.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }, [location.pathname, location.hash]);

  function closeMenu() {
    setMenuOpen(false);
  }

  function closeMobileMenu() {
    closeMenu();
    menuButtonRef.current?.focus();
  }

  function handleHeaderKey(event) {
    if (event.key === 'Escape' && menuOpen) {
      closeMenu();
      menuButtonRef.current?.focus();
    }
  }

  return (
    <div className="loha-home">
      <a className="loha-skip-link" href="#loha-main">{tUi("nav.skip")}</a>
      <header ref={headerRef} className="loha-header" onKeyDown={handleHeaderKey}>
        <div className="loha-container loha-header-inner">
          <LohaBrand />
          <nav className="loha-desktop-nav" aria-label={labelUi("Điều hướng chính")}>
            {navigation.map(([to, name]) => <NavLink key={to} to={to} end onClick={closeMenu}>{name}</NavLink>)}
          </nav>
          <div className="loha-header-controls">
            <div className="loha-header-actions">
              <LanguageSwitcher compact />
              <Link className="loha-header-login" to="/id/login">{tUi("auth.signIn")}{' '}<ArrowUpRight size={16} aria-hidden="true" /></Link>
            </div>
            <button ref={menuButtonRef} className="loha-menu-button" type="button" aria-label={menuOpen ? tUi("nav.closeMenu") : labelUi("Mở menu")} aria-expanded={menuOpen} aria-controls="loha-mobile-nav" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>
        </div>
        <nav id="loha-mobile-nav" className="loha-mobile-nav" aria-label={labelUi("Điều hướng trên điện thoại")} hidden={!menuOpen} onClick={closeMobileMenu}>
          {navigation.map(([to, name]) => <NavLink key={to} to={to} end>{name}</NavLink>)}
          <Link to="/id/login">{tUi("auth.title")}{' '}<ArrowUpRight size={16} aria-hidden="true" /></Link>
        </nav>
      </header>

      <main id="loha-main" tabIndex={-1}>
        <Outlet />
        <section className="loha-start">
          <div className="loha-container loha-start-inner">
            <div><span className="loha-kicker">{labelUi("MỘT NGÀY LÀM VIỆC NHẸ NHÀNG HƠN")}</span><h2>{labelUi("Chào ngày mới.")}<br />{labelUi("Chào LOHA.")}</h2></div>
            <div><p>{labelUi("Đưa những công việc hằng ngày")}<br />{labelUi("về cùng một không gian.")}</p><Link className="loha-button loha-button-light" to="/id/login">{labelUi("Mở không gian làm việc")}{" "}<ArrowUpRight size={19} aria-hidden="true" /></Link></div>
          </div>
          <span className="loha-start-decoration" aria-hidden="true">L</span>
        </section>
      </main>

      <footer className="loha-footer">
        <div className="loha-container">
          <div className="loha-footer-top">
            <div><LohaBrand /><p>{tUi("errors.tagline")}</p></div>
            <nav aria-label={labelUi("Liên kết cuối trang")}>
              {navigation.map(([to, name]) => <Link key={to} to={to}>{name}</Link>)}
            </nav>
            <a className="loha-text-link" href="#loha-main">{labelUi("Về đầu trang")}{" "}<ArrowUpRight size={16} aria-hidden="true" /></a>
          </div>
          <div className="loha-footer-bottom"><span>© {new Date().getFullYear()} LOHA PMS.</span><span>{labelUi("Được xây dựng cho ngành hiếu khách.")}</span></div>
        </div>
      </footer>
    </div>
  );
}
