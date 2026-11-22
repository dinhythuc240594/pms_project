import { formatDateTime } from '../../../shared/lib/date.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { usePms } from '../../pms/data/usePms';
import { operationAge, operationsNeedAttention, workerState } from './operationsPresentation.js';
import './OperationsPanel.css';

export default function OperationsPanel() {
  const { requestSystem } = usePms();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  useEffect(() => {
    let current = true;
    requestSystem('/api/admin/operations').then(data => {
      if (current) setResult({ revision, data });
    }).catch(error => { if (current) setResult({ revision, error: error.message }); });
    return () => { current = false; };
  }, [requestSystem, revision]);
  const loading = result?.revision !== revision;
  const data = loading ? null : result?.data;
  const channels = data?.channels;
  const checkedAt = data?.checkedAt && Number.isFinite(Date.parse(data.checkedAt))
    ? formatDateTime(data.checkedAt) : null;
  return <section className="manager-panel operations-panel" aria-labelledby="operations-title" aria-busy={loading}>
    <div className="dashboard-panel-heading"><div><h3 id="operations-title">Tình trạng vận hành</h3><p>{checkedAt ? `Ghi nhận lúc ${checkedAt}. Tải lại để xem trạng thái mới.` : 'Theo dõi trạng thái phản hồi của các tác vụ nền.'}</p></div><button type="button" className="manager-button" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Tải lại vận hành</button></div>
    {loading ? <p className="operations-message" role="status">Đang kiểm tra vận hành…</p> : result?.error ? <p className="operations-message operations-warning" role="alert">Không tải được trạng thái: {result.error}. Chọn Tải lại vận hành để thử lại.</p> : data && <>
      {operationsNeedAttention(data) && <p className="operations-message operations-warning" role="status">Cần kiểm tra tác vụ nền chưa phản hồi.</p>}
      <dl className="operations-workers">{[['channels', 'Đồng bộ OTA'], ['housekeeping', 'Lập kế hoạch buồng']].map(([kind, label]) => {
        const worker = data.workers[kind];
        const latestSuccess = worker.instances.map(row => row.lastSuccessAgeSeconds).filter(Number.isFinite).sort((a, b) => a - b)[0];
        return <div key={kind}><dt>{label}</dt><dd className={worker.required && worker.status !== 'ok' ? 'operations-warning' : ''}>{workerState(worker)}</dd><dd>Hoàn tất vòng gần nhất: {operationAge(latestSuccess)}</dd>{worker.uncoveredTenantCount > 0 && <dd>{worker.uncoveredTenantCount} khách sạn chưa được phủ bởi tác vụ đang phản hồi.</dd>}</div>;
      })}</dl>
      {channels && <dl className="operations-queue">
        <div><dt>Đang chờ / đang chạy</dt><dd>{channels.counts.queued} / {channels.counts.processing}</dd></div>
        <div><dt>Tác vụ chờ lâu nhất</dt><dd>{channels.counts.queued + channels.counts.processing ? operationAge(channels.oldestPendingAgeSeconds) : 'Không có tác vụ chờ'}</dd></div>
        <div><dt>Tác vụ thất bại</dt><dd>{channels.counts.failed}</dd></div>
        <div><dt>Booking cần kiểm tra</dt><dd>{channels.openReviewCount}</dd></div>
        <div><dt>Booking cần kiểm tra lâu nhất</dt><dd>{channels.openReviewCount ? operationAge(channels.oldestReviewAgeSeconds) : 'Không có booking chờ kiểm tra'}</dd></div>
        <div><dt>Khách sạn chờ gửi lại tồn/giá</dt><dd>{channels.dirtyTenantCount ?? 'Chưa có dữ liệu'}</dd></div>
        <div><dt>Tồn/giá chờ gửi lâu nhất</dt><dd>{channels.dirtyTenantCount ? operationAge(channels.oldestDirtyAgeSeconds) : 'Không có tồn/giá chờ gửi'}</dd></div>
      </dl>}
      <Link to="/manager/channex" className="dashboard-panel-footer">Mở tích hợp Channex để kiểm tra các khách sạn</Link>
    </>}
  </section>;
}
