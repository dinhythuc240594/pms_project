import { t as tUi, useI18n } from '../i18n/useI18n.js';
import { usePms } from '../../apps/pms/data/usePms';
import './RequestActivity.css';

export default function RequestActivity() {
  useI18n();
  const { pendingRequests } = usePms();
  if (!pendingRequests?.reads && !pendingRequests?.writes) return null;
  return <div className="loha-request-activity" role="status" aria-live="polite" aria-atomic="true">
    <span className="loha-request-spinner" aria-hidden="true" />
    <span>{pendingRequests.writes ? tUi("system.processing") : tUi("system.loadingData")}</span>
  </div>;
}
