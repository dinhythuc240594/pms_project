import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Globe, FileText } from 'lucide-react';
import { usePms } from '../../data/usePms';
import { createMarketingApi, errorText } from '../api';
import '../styles.css';

function Pages({ request, tenant }) {
  const navigate = useNavigate();
  const api = useMemo(() => createMarketingApi(request), [request]);
  const [pages, setPages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [name, setName] = useState('Trang giới thiệu');
  const [templateId, setTemplateId] = useState('hotel');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const alive = useRef(true);
  const writing = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    Promise.all([request('/pages', { signal: controller.signal }), request('/templates', { signal: controller.signal })])
      .then(([list, library]) => { if (alive.current) { setPages(list.pages); setHasMore(list.hasMore); setTemplates(library.templates); } })
      .catch(e => { if (!controller.signal.aborted && alive.current) setError(errorText(e)); })
      .finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; controller.abort(); };
  }, [request]);
  async function create(event) {
    event.preventDefault();
    if (writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try {
      const result = await api.mutation('/pages', { name, templateId });
      if (alive.current) navigate(`/id/marketing/pages/${encodeURIComponent(result.id)}/edit`);
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { writing.current = false; if (alive.current) setBusy(false); }
  }
  async function more() {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try {
      const result = await request(`/pages?offset=${pages.length}`);
      if (alive.current) { setPages(previous => [...previous, ...result.pages.filter(page => !previous.some(old => old.id === page.id))]); setHasMore(result.hasMore); }
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { writing.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="marketing-module">
    <header className="mk-header"><div><p className="mk-eyebrow">MARKETING · {tenant?.name}</p><h1>Trang giới thiệu</h1><p>Tạo trang cho khách sạn, xem trước và duyệt trước khi xuất bản.</p></div><Link className="mk-button" to="/id/marketing/brand">Hồ sơ thương hiệu</Link></header>
    {error && <div className="mk-error" role="alert">{error}</div>}
    <form className="mk-create" onSubmit={create}>
      <label>Tên trang<input value={name} maxLength={160} required onChange={e => setName(e.target.value)} /></label>
      <label>Bắt đầu từ<select value={templateId} onChange={e => setTemplateId(e.target.value)}>{templates.length ? templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="hotel">Giới thiệu khách sạn</option>}<option value="custom">Yêu cầu riêng / trang trống</option></select></label>
      <button className="mk-button mk-primary" disabled={busy || loading} type="submit"><Plus size={17} />{busy ? 'Đang tạo…' : 'Tạo trang mới'}</button>
    </form>
    {loading ? <p role="status">Đang tải danh sách…</p> : !pages.length ? <div className="mk-empty"><FileText size={28} /><h2>Chưa có trang giới thiệu</h2><p>Chọn mẫu ở trên để tạo bản nháp đầu tiên.</p></div> : <div className="mk-page-list">{pages.map(page => <article key={page.id} className="mk-page-card"><div className="mk-page-icon"><Globe size={23} /></div><div className="mk-page-info"><h2>{page.name}</h2><p>Bản nháp v{page.revisionNumber} · {page.publishedReleaseId ? 'Đang công khai' : 'Chưa xuất bản'}</p>{page.publishedUrl && <a href={page.publishedUrl} target="_blank" rel="noreferrer">Xem trang công khai</a>}</div><Link className="mk-button" to={`/id/marketing/pages/${encodeURIComponent(page.id)}/edit`}>Chỉnh sửa</Link></article>)}</div>}
    {hasMore && <button className="mk-button" type="button" onClick={more} disabled={busy}>Tải thêm trang</button>}
  </div>;
}

export default function MarketingPages() {
  const { marketingRequest, tenant, tenantId, authGeneration } = usePms();
  return <Pages key={`${tenantId}:${authGeneration}`} request={marketingRequest} tenant={tenant} />;
}
