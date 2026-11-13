import { formatDateTime } from '../../../../shared/lib/date.js';
import { emailPattern, emailInput } from '../../../../shared/lib/validation.js';
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import React, { useRef, useState } from 'react';
import { usePms } from '../../data/usePms';
import { FEATURES, ROLE_NAMES } from '../../data/access';
import { useInventoryQuery } from '../../inventory/useInventoryQuery';
import FormDialog from '../../components/FormDialog';
import { Search, Settings, SlidersHorizontal, ArrowRightLeft, Key, Edit2, Trash2, LogOut } from 'lucide-react';
import './UserManagement.css';

export default function UserManagement() {
  const { tenantId, user } = usePms();
  return <UserManagementContent key={`${tenantId}:${user?.id}`} />;
}

function UserManagementContent() {
  useI18n();
  const [activeTab, setActiveTab] = useState('list');

  const { users: accounts, tenantId, saveTenantUser, tenant } = usePms();
  const [event, setEvent] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const auditQuery = new URLSearchParams({ page: String(page), pageSize: '25', ...(event && { event }), ...(actor && { userId: actor }) });
  const history = useInventoryQuery(activeTab === 'history' ? `/audit?${auditQuery}` : null);
  const access = useInventoryQuery(activeTab === 'features' ? '/feature-overrides' : null);
  const [query, setQuery] = useState('');
  const blank = { name: '', email: '', password: '', confirmPassword: '', role: 'FRONT_DESK', active: true, existingAccount: false };
  const [draft, setDraft] = useState(blank);
  const [editorOpen, setEditorOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy,setBusy] = useState(false);
  const saving = useRef(false);
  const users = accounts.map(u => { const membership = u.memberships?.find(m => m.tenantId === tenantId); return { ...u, role: membership?.role || u.role || 'FRONT_DESK', active: membership ? membership.active : u.active, ipAccess: '—', hotelAccess: (u.memberships?.length || 1) + ' Hotel Access' }; }).filter(u => (u.name + u.email).toLowerCase().includes(query.toLowerCase()));
  const save = async input => { if(saving.current)return;saving.current=true;setBusy(true);setMessage('');setError('');try { if (!input.id && !input.existingAccount && (!input.password || input.password.length < 12 || input.password !== input.confirmPassword)) throw new Error('Mật khẩu tối thiểu 12 ký tự và xác nhận phải khớp.'); if (!input.id) { input = { ...input, email: emailInput(input.email) }; if (!input.existingAccount) { input.name = input.name.trim(); if (!input.name || input.name.length > 160) throw new Error('Họ và tên cần từ 1 đến 160 ký tự.'); if (input.password.length > 128) throw new Error('Mật khẩu cần từ 12 đến 128 ký tự.'); } } await saveTenantUser(input); setMessage('Đã lưu người dùng và quyền tại khách sạn hiện tại.'); setDraft(blank); setEditorOpen(false); } catch (err) { setError(err.message); } finally { saving.current=false;setBusy(false); } };
  function openEditor(input = blank) { setDraft(input); setError(''); setMessage(''); setEditorOpen(true); }
  function closeEditor() { if (saving.current) return; setEditorOpen(false); setDraft(blank); setError(''); }
  const toggleUser = id => { const target = users.find(u => u.id === id); save({ ...target, active: !target.active }); };

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: '4px', border: '1px solid #cbd5e1',
    backgroundColor: '#fff', fontSize: '14px', outline: 'none', color: '#0f172a', boxSizing: 'border-box'
  };

  const btnStyle = (bg, color) => ({
    padding: '8px 16px', borderRadius: '4px', border: '1px solid ' + (bg === '#fff' ? '#cbd5e1' : bg),
    fontWeight: 'bold', cursor: 'pointer', backgroundColor: bg, color: color, fontSize: '13px'
  });

  const tabStyle = (isActive) => ({
    padding: '12px 24px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold',
    fontSize: '14px', color: isActive ? '#3b82f6' : '#64748b',
    borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent', marginBottom: '-1px'
  });

  const iconBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: '4px' };
  const iconDangerStyle = { ...iconBtnStyle, color: '#ef4444' };

  return (
    <div style={{ padding: 0, width: '100%', minHeight: '100vh', fontFamily: 'var(--font-sans)', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginBottom: '24px' }}>{tUi("nav.users")}</h1>

      {error && !editorOpen && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}{message && <p role="status">{message}</p>}
      {/* TABS FULL WIDTH */}
      <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0', marginBottom: '24px' }}>
        <button disabled={busy} style={tabStyle(activeTab === 'list')} onClick={() => setActiveTab('list')}>{labelUi("Danh sách người dùng")}</button>
        <button disabled={busy} style={tabStyle(activeTab === 'history')} onClick={() => setActiveTab('history')}>{labelUi("Lịch sử hoạt động")}</button>
        <button disabled={busy} style={tabStyle(activeTab === 'features')} onClick={() => setActiveTab('features')}>{labelUi("Tính năng được cấp")}</button>
      </div>

      {activeTab === 'list' && (
        <div className="owner-users-grid" style={{ display: 'grid', gap: '24px' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', overflowX: 'auto', minWidth: 0 }}>
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '10px' }} />
                  <input aria-label={labelUi("Tìm người dùng khách sạn")} type="text" placeholder={labelUi("Tìm kiếm")} value={query} onChange={e => setQuery(e.target.value)} style={{ ...inputStyle, paddingLeft: '36px' }} />
                </div>
                <button style={btnStyle('#3b82f6', '#fff')}>{labelUi("Tìm Kiếm")}</button>
              </div>
              <button type="button" disabled={busy} onClick={() => openEditor()} style={{ ...btnStyle('#10b981', '#fff'), marginBottom: '16px' }}>+ {tUi('users.addAccount')}</button>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                    <th style={{ padding: '12px', width: '40px' }}>#</th>
                    <th style={{ padding: '12px' }}>{labelUi("Email/Họ và tên")}</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>IP Access</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>Hotel Access</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>{tUi("settings.roles")}</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>{labelUi("Tùy chọn")}</th>
                    <th style={{ padding: '12px', textAlign: 'center', width: '60px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '11px', color: '#10b981', fontWeight: 'bold' }}>
                        <span>ON</span>
                        <span style={{ color: '#94a3b8' }}>OFF</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, idx) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px' }}>{idx + 1}</td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ color: '#3b82f6', fontWeight: '500' }}>{u.email}</div>
                        <div style={{ color: '#475569', fontSize: '12px' }}>{u.name}</div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', color: '#64748b' }}>
                        <div>{labelUi("Chưa cấu hình IP")}</div>
                        <div>{u.ipAccess}</div><div>{ROLE_NAMES[u.role]}</div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', color: '#64748b' }}>
                        <div>{labelUi("Quyền tại khách sạn")}</div>
                        <div>{u.hotelAccess}</div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button disabled={busy} aria-label={`Phân quyền ${u.email}`} onClick={() => openEditor(u)} style={iconBtnStyle} title={labelUi("Cài đặt")}><Settings size={16} /></button>
                          <button disabled={busy} aria-label={`Phân quyền ${u.email}`} onClick={() => openEditor(u)} style={iconBtnStyle} title={labelUi("Quyền")}><SlidersHorizontal size={16} /></button>
                          <button disabled style={iconBtnStyle} title={labelUi("Chuyển khách sạn cần quản trị viên hệ thống")}><ArrowRightLeft size={16} /></button>
                        </div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button disabled style={iconBtnStyle} title={labelUi("Sửa thông tin và vai trò tại khách sạn hiện tại.")}><Key size={16} /></button>
                          <button disabled={busy} aria-label={`Sửa ${u.email}`} onClick={() => openEditor(u)} style={iconBtnStyle} title={labelUi("Sửa")}><Edit2 size={16} /></button>
                          <button disabled={busy} onClick={() => save({ ...u, active: false })} style={iconDangerStyle} title={labelUi("Ngừng quyền tại khách sạn này")}><Trash2 size={16} /></button>
                          <button disabled style={iconBtnStyle} title={labelUi("Đăng xuất từ xa cần backend")}><LogOut size={16} /></button>
                        </div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <button
                          type="button" role="switch" aria-label={`Kích hoạt ${u.email}`} aria-checked={u.active} disabled={busy} onClick={() => toggleUser(u.id)}
                          style={{ 
                            width: '36px', height: '20px', borderRadius: '20px', backgroundColor: u.active ? '#10b981' : '#cbd5e1', 
                            position: 'relative', cursor: 'pointer', transition: 'background-color 0.2s', margin: '0 auto', border: 0, padding: 0
                          }}
                        >
                          <div style={{ 
                            width: '16px', height: '16px', backgroundColor: '#fff', borderRadius: '50%', position: 'absolute', 
                            top: '2px', left: u.active ? '18px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' 
                          }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {editorOpen && <FormDialog title={draft.id ? tUi('users.editPermissions') : tUi('users.addAccount')} busy={busy} error={error} onClose={closeEditor}>
            <form onSubmit={event => { event.preventDefault(); save(draft); }}>
            <fieldset disabled={busy} data-workspace-draft style={{ display: 'flex', flexDirection: 'column', gap: '16px', border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              {!draft.id && <label><input type="checkbox" checked={draft.existingAccount} onChange={event => setDraft({ ...blank, existingAccount: event.target.checked })} /> Cấp quyền cho tài khoản đã có</label>}
              {!draft.existingAccount && <div>
                <label htmlFor="user-name" style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155', display: 'block', marginBottom: '8px' }}>{tUi('common.fullName')} *</label>
                <input id="user-name" required pattern=".*\S.*" maxLength={160} autoComplete="name" readOnly={!!draft.id} type="text" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={inputStyle} />
              </div>}
              
              <div>
                <label htmlFor="user-email" style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155', display: 'block', marginBottom: '8px' }}>Email *</label>
                <input id="user-email" required pattern={emailPattern} maxLength={254} autoComplete="email" readOnly={!!draft.id} type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} style={inputStyle} />
              </div>
              
              {!draft.existingAccount && <div>
                <label htmlFor="user-password" style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155', display: 'block', marginBottom: '8px' }}>{tUi('auth.password')} *</label>
                <input id="user-password" type="password" autoComplete="new-password" required={!draft.id} disabled={!!draft.id} minLength={12} maxLength={128} value={draft.password || ''} onChange={e=>setDraft(d=>({...d,password:e.target.value}))} style={inputStyle} />
              </div>}
              
              {!draft.existingAccount && <div>
                <label htmlFor="user-confirm-password" style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155', display: 'block', marginBottom: '8px' }}>{tUi('profile.confirmPassword')} *</label>
                <input id="user-confirm-password" type="password" autoComplete="new-password" required={!draft.id} disabled={!!draft.id} minLength={12} maxLength={128} value={draft.confirmPassword || ''} onChange={e=>setDraft(d=>({...d,confirmPassword:e.target.value}))} style={inputStyle} />
              </div>}

              <label style={{ fontSize: 13, fontWeight: 'bold', color: '#334155' }}>{labelUi("Vai trò")}<select aria-label={labelUi("Vai trò người dùng")} value={draft.role} onChange={e => setDraft(d => ({ ...d, role: e.target.value }))} style={inputStyle}>{['HOTEL_OWNER', 'FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTANT'].map(role => <option key={role} value={role}>{ROLE_NAMES[role]}</option>)}</select></label><p style={{ fontSize: 12, color: '#64748b' }}>{labelUi("Mật khẩu mới tối thiểu 12 ký tự, chỉ gửi tới máy chủ. Tài khoản đã có chỉ sửa vai trò và trạng thái; hồ sơ cá nhân và mật khẩu dùng luồng riêng.")}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                <input type="checkbox" id="activateNow" checked={draft.active} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <label htmlFor="activateNow" style={{ fontSize: '14px', color: '#334155', cursor: 'pointer', fontWeight: '500' }}>{labelUi("Kích hoạt ngay")}</label>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                <button type="submit" disabled={busy} style={btnStyle('#3b82f6', '#fff')}>{busy ? tUi('common.saving') : draft.id ? tUi('users.savePermissions') : tUi('users.addAccount')}</button>
                <button type="button" onClick={closeEditor} style={btnStyle('#f1f5f9', '#475569')}>{tUi('common.cancel')}</button>
              </div>
            </fieldset>
            </form>
          </FormDialog>}
        </div>
      )}

      {activeTab === 'history' && (
        <div style={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end', padding: '16px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="audit-event" style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>{tUi("common.actions")}</label>
              <select id="audit-event" style={inputStyle} value={event} onChange={e => { setEvent(e.target.value); setPage(1); }}>
                <option value="">{labelUi("Tất cả hoạt động")}</option>
                <option value="membership.created">{labelUi("Thêm người dùng")}</option>
                <option value="membership.updated">{labelUi("Cập nhật quyền người dùng")}</option>
                <option value="feature_override.upserted">{labelUi("Cấp tính năng")}</option>
                <option value="feature_override.deleted">{labelUi("Gỡ cấp tính năng")}</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>{labelUi("Khách sạn")}</label>
              <p style={{ margin: 0, padding: '10px 0', color: '#334155' }}>{tenant?.name}</p>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="audit-actor" style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>{labelUi("Người thực hiện")}</label>
              <select id="audit-actor" style={inputStyle} value={actor} onChange={e => { setActor(e.target.value); setPage(1); }}>
                <option value="">{labelUi("Tất cả người dùng")}</option>
                {accounts.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            </div>
            <div>
              <button disabled={history.loading} onClick={history.refresh} style={btnStyle('#3b82f6', '#fff')}>{tUi("common.reset")}</button>
            </div>
          </div>

          <div style={{ padding: '16px', color: '#64748b', fontSize: '14px', overflowX: 'auto' }}>
            {history.loading && <p role="status">{labelUi("Đang tải nhật ký…")}</p>}
            {history.error && <div role="alert"><p>{history.error}</p><button onClick={history.refresh} style={btnStyle('#fff', '#334155')}>{tUi("common.retry")}</button></div>}
            {history.data && <>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead><tr><th style={{ padding: 12 }}>{tUi("common.time")}</th><th style={{ padding: 12 }}>{labelUi("Người thực hiện")}</th><th style={{ padding: 12 }}>{tUi("common.actions")}</th><th style={{ padding: 12 }}>{labelUi("Đối tượng")}</th></tr></thead>
                <tbody>{history.data.auditLogs.map(log => <tr key={log.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 12 }}>{formatDateTime(log.createdAt, tenant?.timezone || 'Asia/Ho_Chi_Minh')}</td>
                  <td style={{ padding: 12 }}>{log.userName || log.userId || labelUi("Hệ thống")}</td>
                  <td style={{ padding: 12 }}>{({ 'membership.created': 'Thêm người dùng', 'membership.updated': 'Cập nhật quyền người dùng', 'feature_override.upserted': 'Cấp tính năng', 'feature_override.deleted': 'Gỡ cấp tính năng' })[log.event] || log.event}</td>
                  <td style={{ padding: 12 }}>{({ user: 'Người dùng', feature: tUi("manager.features") })[log.entityType] || log.entityType} · {log.entityId}</td>
                </tr>)}</tbody>
              </table>
              {!history.data.auditLogs.length && <p>{labelUi("Không có hoạt động khớp bộ lọc.")}</p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 16 }}>
                <span>{history.data.pagination.totalItems} hoạt động · Trang {page}</span>
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)} style={btnStyle('#fff', '#334155')}>{labelUi("Trang trước")}</button>
                <button disabled={page * 25 >= history.data.pagination.totalItems} onClick={() => setPage(p => p + 1)} style={btnStyle('#fff', '#334155')}>{labelUi("Trang sau")}</button>
              </div>
            </>}
          </div>
        </div>
      )}

      {activeTab === 'features' && <section style={{ backgroundColor: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', padding: 24 }}>
        <h2 style={{ fontSize: 18, color: '#0f172a' }}>Tính năng của {tenant?.name}</h2>
        <p style={{ color: '#64748b' }}>{labelUi("Trạng thái hiện tại được tính từ gói, quyền cấp riêng và cấu hình hệ thống. Liên hệ quản trị viên để thay đổi.")}</p>
        {access.loading && <p role="status">{labelUi("Đang tải tính năng…")}</p>}
        {access.error && <div role="alert"><p>{access.error}</p><button onClick={access.refresh} style={btnStyle('#fff', '#334155')}>{tUi("common.retry")}</button></div>}
        {access.data && <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
          <thead><tr><th style={{ padding: 12 }}>{tUi("manager.features")}</th><th style={{ padding: 12 }}>{labelUi("Trạng thái thao tác")}</th><th style={{ padding: 12 }}>{labelUi("Quyền cấp riêng")}</th></tr></thead>
          <tbody>{Object.entries(access.data.features).map(([code, enabled]) => {
            const grant = access.data.featureOverrides[code];
            return <tr key={code} style={{ borderTop: '1px solid #e2e8f0' }}>
              <td style={{ padding: 12 }}>{FEATURES.find(f => f.code === code)?.name || code}</td>
              <td style={{ padding: 12, color: enabled ? '#047857' : '#64748b' }}>{enabled ? labelUi("Đang bật") : labelUi("Đang khóa")}</td>
              <td style={{ padding: 12 }}>{grant ? <>{grant.isTrial ? labelUi("Dùng thử") : labelUi("Cấp riêng")} · {grant.enabled ? tUi("common.on") : tUi("common.off")}{grant.expiresAt && <> · Hạn cấp: {formatDateTime(grant.expiresAt, tenant?.timezone || 'Asia/Ho_Chi_Minh')}</>}{grant.notes && <div style={{ color: '#64748b', marginTop: 4 }}>{grant.notes}</div>}</> : labelUi("Theo gói và hệ thống")}</td>
            </tr>;
          })}</tbody>
        </table><button onClick={access.refresh} style={{ ...btnStyle('#fff', '#334155'), marginTop: 16 }}>{labelUi("Làm mới trạng thái")}</button></div>}
      </section>}
    </div>
  );
}
