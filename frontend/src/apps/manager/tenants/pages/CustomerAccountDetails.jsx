import { Building2, UserRound, X } from 'lucide-react'
import LegacyOverlay from '../../../pms/components/LegacyOverlay.jsx'
import { ROLE_NAMES } from '../../../pms/data/access.js'
import { formatDateTime } from '../../../../shared/lib/date.js'
import { useI18n } from '../../../../shared/i18n/useI18n.js'
import './CustomerAccountDetails.css'

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  padding: 16,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(9,24,40,.6)',
}

export default function CustomerAccountDetails({ account, onClose }) {
  const { t, tr } = useI18n()
  const memberships = account.memberships || []
  const active = account.active === true
  const status = active ? t('common.active') : t('common.inactive')
  const fields = [
    [t('manager.customers.fullName'), account.name || '—'],
    [t('manager.customers.email'), account.email || '—'],
    [t('manager.customers.accountId'), account.id],
    [t('manager.customers.status'), status],
    [t('manager.customers.createdAt'), formatDateTime(account.createdAt)],
  ]

  return (
    <div className="customer-account-details-host" data-i18n-ignore>
      <LegacyOverlay
        modal
        title={t('manager.customers.detailsTitle')}
        onClose={onClose}
        style={overlayStyle}
      >
        <div className="customer-account-detail-panel">
          <header className="customer-account-detail-heading">
            <h2>{t('manager.customers.detailsTitle')}</h2>
            <button
              type="button"
              className="manager-icon-button"
              aria-label={t('common.closeWindow')}
              onClick={onClose}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <div className="customer-account-detail-body">
            <div className="customer-account-detail-identity">
              <span className="customer-account-detail-avatar" aria-hidden="true">
                <UserRound size={25} />
              </span>
              <div>
                <h3>{account.name || '—'}</h3>
                <p>{account.email || '—'}</p>
              </div>
              <span className={`customer-account-detail-status${active ? ' is-active' : ''}`}>
                <span aria-hidden="true" />
                {status}
              </span>
            </div>
            <dl className="customer-account-detail-fields">
              {fields.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <section
              className="customer-account-detail-hotels"
              aria-label={t('manager.customers.memberships')}
            >
              <div className="customer-account-detail-section-heading">
                <Building2 size={18} aria-hidden="true" />
                <h3>{t('manager.customers.memberships')}</h3>
                <span>{memberships.length}</span>
              </div>
              {memberships.length ? (
                <ul className="customer-account-detail-memberships">
                  {memberships.map((membership) => (
                    <li key={membership.tenantId}>
                      <div>
                        <strong>{membership.tenantName || membership.tenantId}</strong>
                        <span className="customer-account-detail-role">
                          {tr(ROLE_NAMES[membership.role] || membership.role)}
                        </span>
                      </div>
                      <div className="customer-account-detail-membership-state">
                        <small>{t('manager.customers.membershipStatus')}</small>
                        <span className={membership.active === true ? 'is-active' : 'is-revoked'}>
                          {membership.active === true
                            ? t('common.active')
                            : t('manager.customers.revoked')}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="customer-account-detail-empty">
                  <Building2 size={26} aria-hidden="true" />
                  <p>{t('manager.customers.noMemberships')}</p>
                </div>
              )}
            </section>
          </div>
          <footer className="customer-account-detail-footer">
            <button type="button" className="manager-button" onClick={onClose}>
              {t('common.close')}
            </button>
          </footer>
        </div>
      </LegacyOverlay>
    </div>
  )
}
