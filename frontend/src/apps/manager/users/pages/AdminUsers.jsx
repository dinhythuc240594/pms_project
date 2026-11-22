import { formatDateTime } from '../../../../shared/lib/date.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import React, { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Users, ShieldCheck, Search, Plus, Check, X, CheckCircle2, Edit3, RefreshCw } from 'lucide-react';
import { usePms } from '../../../pms/data/usePms';
import LegacyOverlay from '../../../pms/components/LegacyOverlay';
import { getThemeTokens } from '../../theme';
import { SYSTEM_ROLES, systemUserInput } from './systemUserForm';
import { emailPattern } from '../../../../shared/lib/validation.js';
import './AdminUsers.css';

const roleLabels = { SUPER_ADMIN: 'Super Admin', SYSTEM_MANAGER: 'System Manager' };
const rolePermissions = [
  { name: 'Quản trị khách sạn', manager: true },
  { name: 'Gói cước & thanh toán', manager: true },
  { name: 'Cấu hình tính năng riêng từng khách sạn', manager: true },
  { name: 'Nhân sự nội bộ & vai trò hệ thống', manager: false },
  { name: 'Cờ tính năng toàn hệ thống', manager: false },
  { name: 'Nhật ký kiểm toán toàn hệ thống', manager: false },
];
const emptyDraft = () => ({ name: '', email: '', password: '', globalRole: 'SYSTEM_MANAGER', active: true });
const displayDate = value => value ? formatDateTime(value) : '—';

export default function AdminUsers() {
  useI18n();
  const { searchQuery: globalSearch, isDarkMode, theme } = useOutletContext() || {};
  const t = theme || getThemeTokens(isDarkMode);
  const { user, listSystemUsers, saveSystemUser } = usePms();
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [newUser, setNewUser] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestScope = useRef(0);
  const canManage = user?.globalRole === 'SUPER_ADMIN' && user?.active !== false;
  const sessionKey = `${user?.id || ''}:${user?.globalRole || ''}:${user?.active !== false}`;

  useEffect(() => {
    const scope = ++requestScope.current;
    busyRef.current = false;
    Promise.resolve().then(() => {
      if (requestScope.current !== scope) return null;
      setUsers([]); setLoading(true); setListError(''); setSaveError(''); setToastMessage('');
      setIsAddUserModalOpen(false); setEditingUser(null); setNewUser(emptyDraft()); setBusy(false);
      return canManage ? listSystemUsers() : null;
    })
      .then(result => { if (requestScope.current === scope && result) setUsers(result.users); })
      .catch(err => { if (requestScope.current === scope) setListError(err.message || 'Không thể tải danh sách tài khoản.'); })
      .finally(() => { if (requestScope.current === scope) setLoading(false); });
    return () => { requestScope.current += 1; };
  }, [listSystemUsers, sessionKey, canManage, revision]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(''), 3500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const closeModal = () => {
    if (busyRef.current) return;
    setIsAddUserModalOpen(false); setEditingUser(null); setNewUser(emptyDraft()); setSaveError('');
  };
  const openModal = account => {
    if (busyRef.current || loading || !canManage) return;
    setEditingUser(account || null); setSaveError(''); setToastMessage('');
    setNewUser(account ? { name: account.name, email: account.email, password: '', globalRole: account.globalRole, active: account.active } : emptyDraft());
    setIsAddUserModalOpen(true);
  };
  const handleSaveUser = async event => {
    event.preventDefault();
    if (busyRef.current || !canManage) return;
    const scope = requestScope.current;
    busyRef.current = true; setBusy(true); setSaveError(''); setToastMessage('');
    try {
      const saved = await saveSystemUser(systemUserInput(newUser, editingUser?.id));
      if (requestScope.current !== scope) return;
      setUsers(previous => editingUser ? previous.map(account => account.id === saved.id ? saved : account) : [...previous, saved]);
      setToastMessage(editingUser ? `Đã cập nhật tài khoản [${saved.name}].` : `Đã tạo tài khoản [${saved.name}].`);
      setIsAddUserModalOpen(false); setEditingUser(null); setNewUser(emptyDraft());
    } catch (err) {
      if (requestScope.current === scope) setSaveError(err.message || 'Không thể lưu tài khoản. Vui lòng thử lại.');
    } finally {
      if (requestScope.current === scope) { busyRef.current = false; setBusy(false); }
    }
  };

  const effectiveSearch = (search || globalSearch || '').trim().toLowerCase();
  const filteredUsers = users.filter(account => `${account.name} ${account.email} ${account.globalRole} ${roleLabels[account.globalRole]}`.toLowerCase().includes(effectiveSearch));
  const editingSelf = editingUser?.id === user?.id;
  const inputStyle = { width: '100%', minWidth: 0, padding: '10px 12px', borderRadius: '6px', border: `1px solid ${t.border}`, backgroundColor: t.bgInput, color: t.textPrimary, fontSize: '13px', fontWeight: '600' };
  const labelStyle = { display: 'block', fontSize: '12px', fontWeight: '700', color: t.textPrimary, marginBottom: '6px' };
  const buttonStyle = { minHeight: '40px', padding: '10px 16px', borderRadius: '6px', border: `1px solid ${t.border}`, backgroundColor: t.bgInput, color: t.textPrimary, cursor: 'pointer', fontWeight: '700', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '8px' };
  const cellStyle = { padding: '16px 20px', whiteSpace: 'nowrap' };

  if (!canManage) return <div role="alert" style={{ color: t.textPrimary, backgroundColor: t.bgSurface, padding: '24px', borderRadius: '12px', border: `1px solid ${t.border}` }}>{labelUi("Chỉ Super Admin có quyền quản lý tài khoản hệ thống.")}</div>;

  return (
    <div className="manager-page admin-users-page">
      {toastMessage && (
        <div role="status" style={{ position: 'fixed', bottom: '30px', right: '30px', maxWidth: 'calc(100vw - 60px)', backgroundColor: t.isDark ? '#1E222B' : '#1E242B', color: '#FFFFFF', padding: '14px 22px', borderRadius: '16px', boxShadow: '0 10px 30px rgba(0,0,0,0.25)', fontSize: '13px', fontWeight: '800', zIndex: 100, display: 'flex', alignItems: 'center', gap: '10px', border: `1px solid ${t.border}` }}>
          <CheckCircle2 size={18} aria-hidden="true" /><span>{toastMessage}</span>
        </div>
      )}

      <div className="admin-users-toolbar">
        <div className="admin-users-tabs" role="group" aria-label={labelUi("Chọn nội dung quản lý nhân sự")}>
          {[
            { id: 'users', icon: Users, label: `Nhân sự nội bộ${loading ? '' : ` (${users.length})`}` },
            { id: 'matrix', icon: ShieldCheck, label: 'Ma trận phân quyền' },
          ].map(tab => (
            <button key={tab.id} type="button" aria-pressed={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
              <tab.icon size={16} aria-hidden="true" /><span>{tab.label}</span>
            </button>
          ))}
        </div>
        {activeTab === 'users' && (
          <button className="manager-button manager-button-primary" onClick={() => openModal()} disabled={loading || busy}>
            <Plus size={18} strokeWidth={2.5} aria-hidden="true" /><span>{labelUi("Thêm quản trị viên")}</span>
          </button>
        )}
      </div>

      {activeTab === 'users' && (
        <div className="manager-panel admin-users-list">
          <div className="admin-users-list-toolbar">
            <div className="admin-users-search">
              <Search size={16} color={t.textSecondary} aria-hidden="true" />
              <input type="search" aria-label={labelUi("Tìm nhân sự nội bộ")} placeholder={labelUi("Tìm theo tên, email, vai trò...")} value={search} onChange={event => setSearch(event.target.value)} style={{ border: 'none', backgroundColor: 'transparent', paddingLeft: '8px', minWidth: 0, fontSize: '13px', color: t.textPrimary, width: '100%', fontWeight: '500' }} />
            </div>
            <div style={{ fontSize: '12.5px', color: t.textSecondary }}>
              {!loading && !listError && <span>{labelUi("Hiển thị")}{" "}<strong>{filteredUsers.length}</strong> / {users.length} tài khoản</span>}
            </div>
          </div>
          <div className="manager-table-wrap" role="region" aria-label={labelUi("Danh sách nhân sự nội bộ")} tabIndex={0}>
            <table aria-busy={loading} style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: t.isDark ? '#222731' : '#F8FAFC', color: t.textSecondary, borderBottom: `1px solid ${t.border}` }}>
                  {['Nhân viên', 'Vai trò (Role)', 'Trạng thái', 'Ngày tạo', 'Thao tác'].map(label => <th key={label} scope="col" style={{ padding: '14px 20px', fontWeight: '700', whiteSpace: 'nowrap' }}>{labelUi(label)}</th>)}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={5} style={{ padding: '32px 24px', color: t.textSecondary }}><span role="status">{labelUi("Đang tải tài khoản từ máy chủ…")}</span></td></tr>}
                {!loading && listError && (
                  <tr><td colSpan={5} style={{ padding: '24px' }}>
                    <p role="alert" style={{ color: t.danger, margin: '0 0 12px' }}>{listError}</p>
                    <button disabled={busy} onClick={() => setRevision(value => value + 1)} style={buttonStyle}><RefreshCw size={15} aria-hidden="true" />{tUi("common.retry")}</button>
                  </td></tr>
                )}
                {!loading && !listError && filteredUsers.length === 0 && <tr><td colSpan={5} style={{ padding: '32px 24px', color: t.textSecondary }}><span role="status">{users.length ? labelUi("Không có tài khoản phù hợp với tìm kiếm.") : labelUi("Chưa có tài khoản hệ thống. Thêm quản trị viên để bắt đầu.")}</span></td></tr>}
                {!loading && !listError && filteredUsers.map(account => (
                  <tr key={account.id} style={{ borderBottom: `1px solid ${t.borderSubtle}`, transition: 'background-color 0.15s ease' }} onMouseEnter={event => { event.currentTarget.style.backgroundColor = t.bgSurfaceHover; }} onMouseLeave={event => { event.currentTarget.style.backgroundColor = 'transparent'; }}>
                    <td style={cellStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div aria-hidden="true" style={{ width: '38px', height: '38px', borderRadius: '12px', backgroundColor: t.aquaBg, color: t.aquaText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '600', fontSize: '14px', flexShrink: 0 }}>{account.name.charAt(0)}</div>
                        <div>
                          <div style={{ fontWeight: '800', color: t.textPrimary }}>{account.name}{account.id === user.id && <span style={{ marginLeft: '6px', fontSize: '11px', color: t.textSecondary }}>{labelUi("(Bạn)")}</span>}</div>
                          <div style={{ fontSize: '11px', color: t.textSecondary }}>{account.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={cellStyle}>
                      <span style={{ fontSize: '12px', fontWeight: '800', padding: '4px 10px', borderRadius: '10px', backgroundColor: account.globalRole === 'SUPER_ADMIN' ? t.aquaBg : t.bgInput, color: account.globalRole === 'SUPER_ADMIN' ? t.aquaText : t.textPrimary, border: `1px solid ${account.globalRole === 'SUPER_ADMIN' ? t.aquaBorder : t.border}`, display: 'inline-block' }}>{roleLabels[account.globalRole]}</span>
                    </td>
                    <td style={cellStyle}><span style={{ fontSize: '12px', fontWeight: '800', color: account.active ? t.success : t.textSecondary }}>{account.active ? tUi("common.active") : tUi("common.inactive")}</span></td>
                    <td style={{ ...cellStyle, fontSize: '12px', color: t.textSecondary }}>{displayDate(account.createdAt)}</td>
                    <td style={cellStyle}><button aria-label={`Chỉnh sửa tài khoản ${account.name}`} disabled={busy} onClick={() => openModal(account)} style={{ ...buttonStyle, padding: '8px 12px', fontSize: '12px' }}><Edit3 size={14} aria-hidden="true" />{labelUi("Chỉnh sửa")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'matrix' && (
        <div className="manager-panel admin-users-matrix">
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '800', color: t.textPrimary, margin: 0 }}>{labelUi("Ma trận phân quyền vai trò (Role-based access control)")}</h2>
            <p style={{ fontSize: '12px', color: t.textSecondary, margin: '4px 0 0' }}>{labelUi("Quyền cố định theo vai trò hệ thống. Bảng chỉ để xem; thay đổi vai trò trong thông tin tài khoản.")}</p>
          </div>
          <div role="region" aria-label={labelUi("Ma trận phân quyền nhân sự")} tabIndex={0} style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '620px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead><tr style={{ backgroundColor: t.isDark ? '#222731' : '#F8FAFC', borderBottom: `1px solid ${t.border}` }}>
                <th scope="col" style={{ padding: '16px 20px', fontWeight: '800', color: t.textPrimary }}>{labelUi("Chức năng & Hành động")}</th>
                {SYSTEM_ROLES.map(role => <th key={role} scope="col" style={{ padding: '16px 14px', fontWeight: '800', textAlign: 'center', color: t.aquaText }}>{roleLabels[role]}</th>)}
              </tr></thead>
              <tbody>{rolePermissions.map(permission => (
                <tr key={permission.name} style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
                  <td style={{ padding: '14px 20px', color: t.textPrimary, fontWeight: '600' }}>{permission.name}</td>
                  {SYSTEM_ROLES.map(role => {
                    const allowed = role === 'SUPER_ADMIN' || permission.manager;
                    return <td key={role} style={{ padding: '14px', textAlign: 'center' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: allowed ? t.aquaText : t.textSecondary }}>{allowed ? <Check size={16} strokeWidth={2.5} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}{allowed ? labelUi("Được phép") : labelUi("Không có quyền")}</span></td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {isAddUserModalOpen && (
        <LegacyOverlay title={editingUser ? `Chỉnh sửa tài khoản ${editingUser.name}` : labelUi("Thêm quản trị viên nội bộ")} onClose={closeModal} style={{ position: 'fixed', inset: 0, backgroundColor: t.bgModalBackdrop, backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div className="admin-users-dialog" style={{ backgroundColor: t.bgSurface, borderRadius: '16px', width: '100%', maxWidth: '680px', padding: '28px 32px', boxShadow: t.cardShadow, border: `1px solid ${t.border}`, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', gap: '12px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '800', color: t.textPrimary, margin: 0 }}>{editingUser ? `Chỉnh sửa tài khoản: ${editingUser.name}` : labelUi("Thêm quản trị viên nội bộ")}</h2>
                <p style={{ fontSize: '12px', color: t.textSecondary, margin: '4px 0 0' }}>{labelUi("Thông tin và vai trò được lưu trên máy chủ.")}</p>
              </div>
              <button aria-label={labelUi("Đóng hộp thoại")} disabled={busy} onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><X size={20} color={t.textSecondary} aria-hidden="true" /></button>
            </div>
            <form onSubmit={handleSaveUser} aria-busy={busy} style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {saveError && <p role="alert" style={{ color: t.danger, fontSize: '13px', margin: 0 }}>{saveError}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '12px' }}>
                <div>
                  <label htmlFor="system-user-name" style={labelStyle}>{tUi("hk.staffName")}{' '}<span style={{ color: t.danger }}>*</span></label>
                  <input id="system-user-name" type="text" required maxLength={160} disabled={busy} autoComplete="name" placeholder={labelUi("Ví dụ: Lê Tuấn Anh")} value={newUser.name} onChange={event => setNewUser(previous => ({ ...previous, name: event.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label htmlFor="system-user-email" style={labelStyle}>Email <span style={{ color: t.danger }}>*</span></label>
                  <input id="system-user-email" type="email" required maxLength={254} pattern={emailPattern} readOnly={!!editingUser} disabled={busy} autoComplete="off" placeholder="anh.lt@pmscloud.vn" value={newUser.email} onChange={event => setNewUser(previous => ({ ...previous, email: event.target.value }))} style={inputStyle} aria-describedby={editingUser ? 'system-user-email-help' : undefined} />
                  {editingUser && <p id="system-user-email-help" style={{ color: t.textSecondary, fontSize: '11px', margin: '6px 0 0' }}>{labelUi("Email đăng nhập không thể thay đổi.")}</p>}
                </div>
                <div>
                  <label htmlFor="system-user-role" style={labelStyle}>{labelUi("Vai trò hệ thống")}</label>
                  <select id="system-user-role" disabled={busy || editingSelf} value={newUser.globalRole} onChange={event => setNewUser(previous => ({ ...previous, globalRole: event.target.value }))} style={inputStyle} aria-describedby={editingSelf ? 'system-user-self-help' : undefined}>
                    {SYSTEM_ROLES.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="system-user-active" style={labelStyle}>{labelUi("Trạng thái tài khoản")}</label>
                  <select id="system-user-active" disabled={busy || editingSelf} value={newUser.active ? 'active' : 'inactive'} onChange={event => setNewUser(previous => ({ ...previous, active: event.target.value === 'active' }))} style={inputStyle} aria-describedby={editingSelf ? 'system-user-self-help' : 'system-user-active-help'}>
                    <option value="active">{tUi("common.active")}</option><option value="inactive">{tUi("common.inactive")}</option>
                  </select>
                </div>
              </div>
              <p id={editingSelf ? 'system-user-self-help' : 'system-user-active-help'} style={{ color: t.textSecondary, fontSize: '12px', margin: 0 }}>{editingSelf ? labelUi("Cần một Super Admin khác để đổi vai trò hoặc ngừng hoạt động tài khoản của bạn.") : labelUi("Ngừng hoạt động sẽ chặn đăng nhập và kết thúc các phiên đang mở; thông tin tài khoản vẫn được lưu.")}</p>
              {!editingUser && <div>
                <label htmlFor="system-user-password" style={labelStyle}>{labelUi("Mật khẩu ban đầu")}{" "}<span style={{ color: t.danger }}>*</span></label>
                <input id="system-user-password" type="password" required minLength={12} maxLength={128} disabled={busy} autoComplete="new-password" value={newUser.password} onChange={event => setNewUser(previous => ({ ...previous, password: event.target.value }))} style={inputStyle} aria-describedby="system-user-password-help" />
                <p id="system-user-password-help" style={{ fontSize: '11px', color: t.textSecondary, margin: '6px 0 0' }}>{labelUi("Từ 12 đến 128 ký tự.")}</p>
              </div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginTop: '8px', paddingTop: '14px', borderTop: `1px solid ${t.borderSubtle}` }}>
                <button type="button" disabled={busy} onClick={closeModal} style={buttonStyle}>{labelUi("Hủy bỏ")}</button>
                <button type="submit" disabled={busy} style={{ ...buttonStyle, padding: '10px 24px', border: 'none', backgroundColor: t.primary, color: '#FFFFFF', fontWeight: '800', opacity: busy ? 0.6 : 1, boxShadow: 'none' }}>{busy ? tUi("common.saving") : editingUser ? labelUi("Lưu cập nhật") : labelUi("Tạo tài khoản")}</button>
              </div>
            </form>
          </div>
        </LegacyOverlay>
      )}
    </div>
  );
}
