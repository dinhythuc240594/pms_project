import { formatDateTime } from '../../../shared/lib/date.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../shared/i18n/useI18n.js';
import { X, Building2, ShieldCheck, CheckCircle2, LockKeyhole } from 'lucide-react';
import { usePms } from '../data/usePms';

export default function UsageInfoModal({ isOpen, onClose }) {
  useI18n();
  const { tenant, quota, features, subscription } = usePms();
  if (!isOpen) return null;
  const suspended = tenant?.status?.toLowerCase() === 'suspended';
  const status = suspended ? 'Khách sạn tạm khóa' : !subscription ? 'Chưa gán gói' : subscription.effectiveActive ? 'Đang hoạt động' : 'Chỉ xem dữ liệu';
  return (
    <div className="pms-usage-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="pms-usage-card" aria-labelledby="pms-usage-title">
        <div className="pms-usage-heading"><div><p>LOHA PMS SYSTEM</p><h2 id="pms-usage-title">{tUi("header.usage")}</h2><span>{tenant?.name}</span></div><button type="button" aria-label={tUi("usage.close")} onClick={onClose}><X size={20} /></button></div>
        <div className="pms-usage-body">
          <div className="pms-usage-plan"><ShieldCheck size={24} aria-hidden="true" /><div><small>{tUi("usage.currentPlan")}</small><strong>{subscription?.planName || tUi("usage.noPlan")}</strong><span>{labelUi(status)}</span></div></div>
          <dl className="pms-usage-quota">
            <div><dt>{tUi("usage.rooms")}</dt><dd>{quota.rooms.used} <span>/ {quota.rooms.limit ?? subscription?.roomCount ?? tUi("usage.unregistered")}</span></dd></div>
            <div><dt>{tUi("usage.users")}</dt><dd>{quota.users.used} <span>/ {quota.users.limit === null ? tUi("usage.unlimited") : quota.users.limit}</span></dd></div>
            <div><dt>{tUi("usage.expiry")}</dt><dd>{subscription?.endDate ? formatDateTime(subscription.endDate).slice(0, 10) : subscription ? tUi("usage.noExpiry") : tUi("usage.noPlan")}</dd></div>
          </dl>
          <h3><Building2 size={17} aria-hidden="true" />{tUi("usage.features")}</h3>
          <ul className="pms-usage-features">{features.map(feature => <li key={feature.code || feature.id}><span aria-hidden="true">{feature.allowed ? <CheckCircle2 size={16} /> : <LockKeyhole size={16} />}</span><span>{labelUi(feature.name)}<small>{feature.allowed ? tUi("usage.enabled") : tUi("usage.disabled")}</small></span></li>)}</ul>
          {!features.length && <p className="pms-usage-empty">{tUi("usage.empty")}</p>}
        </div>
        <div className="pms-usage-footer"><button type="button" onClick={onClose}>{tUi("common.closeWindow")}</button></div>
      </section>
    </div>
  );
}
