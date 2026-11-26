import { t as tUi, tr as labelUi } from '../../../../shared/i18n/useI18n.js'
import { formatDateTime } from '../../../../shared/lib/date.js'
import { ROLE_NAMES } from '../../../pms/data/access.js'

export default function OwnerAccountDetails({ account }) {
  return (
    <section
      className="customer-account-details"
      aria-label={labelUi('Chi tiết tài khoản quản lý khách sạn')}
    >
      <h4>{labelUi('Chi tiết tài khoản quản lý khách sạn')}</h4>
      <dl>
        <div>
          <dt>{labelUi('Họ tên')}</dt>
          <dd>{account.name}</dd>
        </div>
        <div>
          <dt>{labelUi('Email đăng nhập')}</dt>
          <dd>{account.email}</dd>
        </div>
        <div>
          <dt>{labelUi('Mã tài khoản')}</dt>
          <dd>{account.id}</dd>
        </div>
        <div>
          <dt>{labelUi('Trạng thái')}</dt>
          <dd>{account.active ? tUi('common.active') : labelUi('Đã khóa')}</dd>
        </div>
        <div>
          <dt>{labelUi('Ngày tạo tài khoản')}</dt>
          <dd>{account.createdAt ? formatDateTime(account.createdAt) : '—'}</dd>
        </div>
        <div>
          <dt>{labelUi('Vai trò tại khách sạn')}</dt>
          <dd>{labelUi('Chủ khách sạn (Owner)')}</dd>
        </div>
      </dl>
      {account.memberships && (
        <>
          <h5>{labelUi('Khách sạn đã tham gia')}</h5>
          {account.memberships.length ? (
            <ul>
              {account.memberships.map((membership) => (
                <li key={membership.tenantId}>
                  <strong>{membership.tenantName || membership.tenantId}</strong>
                  <span>
                    {labelUi(ROLE_NAMES[membership.role] || membership.role)} ·{' '}
                    {membership.active ? tUi('common.active') : labelUi('Tạm ngưng')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="customer-hint">{labelUi('Chưa tham gia khách sạn nào.')}</p>
          )}
        </>
      )}
    </section>
  )
}
