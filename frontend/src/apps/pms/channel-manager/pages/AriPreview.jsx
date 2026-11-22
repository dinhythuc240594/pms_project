import { useState } from 'react';
import { Eye, Info } from 'lucide-react';
import { tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { money } from '../../data/model';
import { syncRangeError } from '../integration';
import { useChannels } from '../useChannels';
import { dateRangeParams } from '../../../../shared/lib/dateRangeQuery.js';

export default function AriPreview({ pms, range, connection, mappings, disabled, refreshKey }) {
  useI18n();
  const [requested, setRequested] = useState('');
  const path = '/channels/ari-preview?' + dateRangeParams(range);
  const reason = syncRangeError(range.start, range.end)
    || (!connection?.active || !connection?.credentialsConfigured ? 'Bật kết nối Channex để xem trước.' : '')
    || (!connection?.inventoryReconciledAt ? 'Đối chiếu booking và tồn phòng trước khi xem giá gửi.' : '')
    || (!mappings.some(row => row.active) ? 'Ghép loại phòng trước khi xem giá gửi.' : '');
  const preview = useChannels(pms.requestTenant, `${pms.tenantId}:${connection?.environment}:${connection?.propertyId}`, path, requested === path && !reason, refreshKey);
  return <div className="ota-ari-preview">
    <button type="button" className="ota-button ota-button--secondary" disabled={disabled || Boolean(reason) || preview.loading} aria-describedby="ota-preview-hint" onClick={() => { setRequested(path); preview.refresh(); }}><Eye size={16} aria-hidden="true" />{labelUi(preview.loading ? 'Đang tải giá gửi…' : 'Xem trước giá gửi OTA')}</button>
    <p id="ota-preview-hint" className="ota-action-hint">{labelUi(reason || 'Xem đúng giá theo từng ngày và gói nhận giá. Thao tác này không gửi giá lên Channex.')}</p>
    {preview.error && <p className="ota-notice ota-notice--error" role="alert"><Info size={16} aria-hidden="true" />{preview.error}</p>}
    {preview.data && <>
      {preview.data.inventoryHeld && <p className="ota-notice ota-notice--info" role="status">{labelUi('Còn cập nhật đặt phòng OTA chưa xử lý hoặc cần đối soát. Các lượt đồng bộ giữ đóng bán cho đến khi dữ liệu được xác minh.')}</p>}
      <p className="ota-notice ota-notice--info" role="status">{labelUi(preview.data.warning)}</p>
      <p className="ota-action-hint">{labelUi('Dữ liệu tại thời điểm tải; tác vụ gửi sẽ kiểm tra lại giá và tồn phòng.')}</p>
      <p className="ota-review-scroll-hint">{labelUi('Vuốt ngang để xem đủ giá và gói giá.')}</p>
      <div className="ota-table-scroll" tabIndex={0} role="region" aria-label={labelUi('Giá và tồn phòng sẽ gửi OTA')}><table className="ota-table ota-review-table">
        <thead><tr>{['Ngày', 'Loại phòng', 'Giá gửi', 'Nguồn giá', 'Phòng trống', 'Trạng thái', 'Đích Channex'].map(title => <th key={title} scope="col">{labelUi(title)}</th>)}</tr></thead>
        <tbody>{preview.data.rows.map(row => <tr key={`${row.channexRatePlanId}:${row.date}`}>
          <td>{row.date}</td><td>{row.roomTypeName}</td><td>{row.rate == null ? labelUi('Không gửi giá') : money(row.rate, row.currency)}</td><td>{labelUi(row.priceSource === 'daily' ? 'Giá theo ngày' : 'Giá cơ bản')}</td><td>{row.availability}</td><td>{labelUi(row.stopSell ? 'Đóng bán' : 'Mở bán')}</td><td><details><summary>{labelUi('Phòng và gói giá')}</summary><p>{labelUi('Phòng')}: <code>{row.channexRoomTypeId}</code></p><p>{labelUi('Gói giá')}: <code>{row.channexRatePlanId}</code></p></details></td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </div>;
}
