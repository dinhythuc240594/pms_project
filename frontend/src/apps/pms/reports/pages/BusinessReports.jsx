import DateInput from '../../../../shared/components/DateInput.jsx';
import { formatDate } from '../../../../shared/lib/date.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, CalendarDays, CircleDollarSign, Download, Info } from 'lucide-react';
import { AccessLink } from '../../../../shared/components/AccessControl';
import { downloadCsv } from '../../../../shared/lib/csv';
import { usePms } from '../../data/usePms';
import { money } from '../../data/model';
import { useReportPeriod } from './reportPeriod.js';

const revenueColumns = [['label', 'Nhóm'], ['bookings', 'Booking'], ['nights', 'Đêm phòng'], ['servedNights', 'Đêm đã phục vụ'], ['forecastRoomRevenue', 'Tiền phòng dự kiến', true], ['roomRevenue', 'Tiền phòng đã phục vụ', true]];
const businessReports = {
  source: { title: 'Doanh thu theo nguồn', columns: revenueColumns },
  room: { title: 'Doanh thu theo phòng', columns: revenueColumns },
  roomType: { title: 'Doanh thu theo hạng phòng', columns: revenueColumns },
  cancellations: { title: 'Hủy phòng', columns: [['date', 'Ngày hủy'], ['source', 'Nguồn'], ['bookings', 'Booking hủy'], ['nights', 'Đêm phòng hủy'], ['cancelledRoomValue', 'Giá trị phòng hủy', true]] },
  nationality: { title: 'Khách theo quốc tịch', columns: [['nationality', 'Quốc tịch'], ['guests', 'Khách duy nhất'], ['bookings', 'Booking'], ['guestNights', 'Đêm khách']] },
  // discounts: { title: 'Voucher & Khuyến mãi', columns: [['kind', 'Loại'], ['label', 'Tên'], ['code', 'Mã voucher'], ['bookings', 'Booking'], ['discountAmount', 'Số tiền giảm', true]] },
};

const discountNames = { voucher: 'Voucher', earlybird: 'Đặt sớm', lastminute: 'Đặt sát ngày', staypay: 'Ở dài ngày' };

export default function BusinessReports({ report }) {
  const { apiText } = useI18n();
  const { settings, getBusinessReport, tenantId, authGeneration, workspaceRevision } = usePms();
  const navigate = useNavigate();
  // Own keys only: inherited names (toString, constructor, __proto__...) and disabled reports are unsupported.
  const config = typeof report === 'string' && Object.hasOwn(businessReports, report) ? businessReports[report] : null;
  const supported = Boolean(config);
  const { start, end, valid, minEnd, setStart, setEnd, setStartValid, setEndValid, target, preventInvalid } = useReportPeriod(settings.timezone);
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);
  const currency = settings.currency;
  const requestKey = [report, start, end, currency, revision, tenantId, authGeneration, workspaceRevision].join(':');
  const data = valid && result?.key === requestKey ? result.data : null;
  const error = result?.key === requestKey ? result.error : '';
  const loading = Boolean(valid && result?.key !== requestKey);
  const hasMoney = report !== 'nationality';
  const noteKeys = ['period', 'groupTotals', report, ...(hasMoney ? ['moneyBasis'] : []), ...(['source', 'room', 'roomType'].includes(report) ? ['forecastRoomRevenue', 'roomRevenue', 'bookings'] : [])];

  useEffect(() => {
    let mounted = true;
    if (valid && supported) getBusinessReport(report, start, end, currency, 'base')
      .then(data => { if (mounted) setResult({ key: requestKey, data, error: '' }); })
      .catch(err => { if (mounted) setResult({ key: requestKey, data: null, error: err.message }); });
    return () => { mounted = false; };
  }, [report, start, end, currency, valid, supported, getBusinessReport, requestKey]);

  const display = (value, key, isMoney) => {
    if (isMoney) return money(value, currency);
    if (key === 'date') return formatDate(value);
    const displayed = key === 'kind' ? (discountNames[value] || value) : apiText(value);
    return displayed || (value === 0 ? 0 : '—');
  };
  const exportRows = () => downloadCsv(
    [...config.columns.map(([, label]) => label), ...(hasMoney ? ['Tiền tệ', 'Cơ sở tiền tệ'] : [])],
    data.rows.map(row => [...config.columns.map(([key]) => row[key] ?? ''), ...(hasMoney ? [data.currency, data.basis] : [])]),
    `bao-cao-${report}-${start}-${end}.csv`,
  );

  if (!supported) return <UnsupportedReport valid={valid} to={target('/id/reports/source')} />;

  return <div className="pms-original pms-reports">
    <header className="pms-reports-header"><div><h1>{config.title}</h1><p>{labelUi("Phân tích dữ liệu của khách sạn theo khoảng thời gian.")}</p></div><span className="pms-reports-demo" role="status"><Info size={14} aria-hidden="true" />{loading ? tUi("common.loading") : data ? labelUi("Dữ liệu máy chủ") : labelUi("Chưa tải dữ liệu")}</span></header>
    <nav className="pms-reports-tabs" aria-label={labelUi("Loại báo cáo")}>
      <AccessLink to={target('/id/reports/revenue')} onClick={preventInvalid} aria-disabled={!valid}><CircleDollarSign size={18} aria-hidden="true" />{labelUi("Doanh thu phòng")}</AccessLink>
      <AccessLink to={target('/id/reports/occupancy')} onClick={preventInvalid} aria-disabled={!valid}><BarChart3 size={18} aria-hidden="true" />{tUi("nav.occupancy")}</AccessLink>
      <AccessLink to={target('/id/reports/source')} onClick={preventInvalid} aria-disabled={!valid} aria-current="page"><BarChart3 size={18} aria-hidden="true" />{tUi("nav.advancedReports")}</AccessLink>
    </nav>
    <section className="pms-reports-filter" aria-label={labelUi("Bộ lọc báo cáo")}>
      <div className="pms-reports-filter-title"><CalendarDays size={18} aria-hidden="true" />{labelUi("Khoảng thời gian")}</div>
      <div className="pms-reports-date-fields">
        <label htmlFor="business-report-type">{tUi("nav.reports")}<select id="business-report-type" value={report} disabled={!valid} onChange={event => navigate(target('/id/reports/' + event.target.value))}>{Object.entries(businessReports).map(([key, value]) => <option key={key} value={key}>{value.title}</option>)}</select></label>
        <label htmlFor="business-report-start">{tUi("common.fromDate")}<DateInput id="business-report-start" value={start} onChange={setStart} onValidityChange={setStartValid} aria-invalid={!valid} aria-describedby={!valid ? 'business-report-error' : undefined} /></label>
        <label htmlFor="business-report-end">{labelUi("Đến ngày")}<DateInput id="business-report-end" min={minEnd} value={end} onChange={setEnd} onValidityChange={setEndValid} aria-invalid={!valid} aria-describedby={!valid ? 'business-report-error business-report-note' : 'business-report-note'} /></label>
      </div>
      <p id="business-report-note" className="pms-reports-filter-note">Không bao gồm ngày kết thúc. {report === 'nationality' ? labelUi("Gồm khách của mọi loại tiền tệ.") : labelUi("Số liệu cập nhật khi đổi bộ lọc.")}</p>
    </section>
    {!valid && <p id="business-report-error" role="alert" className="pms-reports-error">{labelUi("Chọn khoảng ngày từ 1 đến 366 ngày.")}</p>}
    {error && <p role="alert" className="pms-reports-error">{error} <button type="button" onClick={() => setRevision(value => value + 1)}>{tUi("common.retry")}</button></p>}
    <section className="pms-reports-table-card" aria-label={config.title} aria-busy={loading}>
      <div className="pms-reports-table-heading"><h2>{config.title}</h2><button type="button" className="pms-reports-export" onClick={exportRows} disabled={!data || !data.rows.length}><Download size={16} aria-hidden="true" />{tUi("common.exportCsv")}</button></div>
      <div className="pms-reports-table-scroll" tabIndex={0} role="region" aria-label={'Bảng ' + config.title.toLowerCase()}><table>
        <thead><tr>{config.columns.map(([key, label, isMoney]) => <th key={key} scope="col" className={isMoney || ['bookings', 'nights', 'servedNights', 'guests', 'guestNights'].includes(key) ? 'pms-reports-number' : undefined}>{labelUi(label)}</th>)}</tr></thead>
        <tbody>{data?.rows.map((row, index) => <tr key={[row.id, row.label, row.date, row.source, row.nationality, row.code, index].join(':')}>{config.columns.map(([key, , isMoney]) => <td key={key} className={isMoney || typeof row[key] === 'number' ? 'pms-reports-number' : undefined}>{display(row[key], key, isMoney)}</td>)}</tr>)}{!data?.rows.length && <tr><td colSpan={config.columns.length} className="pms-reports-empty">{!valid ? labelUi("Chọn khoảng ngày hợp lệ để xem báo cáo.") : loading ? tUi("dashboard.loading") : data ? labelUi("Không có dữ liệu trong kỳ.") : tUi("dashboard.failed")}</td></tr>}</tbody>
      </table></div>
    </section>
    {data && <div className="pms-reports-note"><Info size={16} aria-hidden="true" /><span>{noteKeys.map(key => apiText(data.definitions[key])).filter(Boolean).join(' ')}</span></div>}
  </div>;
}

// No data, table, export or report selector: nothing here may pass for a real report.
// The single recovery link stays usable even for an invalid period; it carries the invalid
// dates and period_invalid marker so the supported page shows its date controls and blocks reads.
function UnsupportedReport({ valid, to }) {
  useI18n();
  return <div className="pms-original pms-reports pms-reports-unsupported">
    <header className="pms-reports-header"><div>
      <h1>{labelUi("Báo cáo không khả dụng")}</h1>
      <p role="status">{labelUi("Loại báo cáo trong đường dẫn này chưa được hỗ trợ hoặc đã tắt. Không có dữ liệu nào được tải hay hiển thị.")}</p>
    </div></header>
    {!valid && <p role="alert" className="pms-reports-error">{labelUi("Khoảng ngày trong đường dẫn không hợp lệ. Sửa ngày ở trang báo cáo trước khi xem số liệu.")}</p>}
    <p className="pms-reports-note"><Info size={16} aria-hidden="true" /><span>
      <AccessLink className="pms-reports-recovery-link" to={to}><BarChart3 size={16} aria-hidden="true" />{labelUi("Quay lại báo cáo nâng cao")}</AccessLink>
    </span></p>
  </div>;
}
