import { tr as labelUi } from '../i18n/useI18n.js';
import { Link } from 'react-router-dom';
import '../styles/loha.css';

export default function LohaBrand() {
  return (
    <Link className="loha-brand" to="/" aria-label={labelUi("LOHA — Trang chủ")}>
      <span className="loha-brand-mark" aria-hidden="true">L<span /></span>
      <span>LOHA<small>PMS SYSTEM</small></span>
    </Link>
  );
}
