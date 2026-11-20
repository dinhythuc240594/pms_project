import DateInput from '../../../../shared/components/DateInput.jsx';
import { formatDate, formatDateTime } from '../../../../shared/lib/date.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { BarChart3, BedDouble, CalendarDays, CircleDollarSign, Info, Moon } from 'lucide-react';
import { usePms } from '../../data/usePms';
import { today, addDays, nights, money as formatMoney } from '../../data/model';
import './Reports.css';
import { AccessLink as Link } from '../../../../shared/components/AccessControl';
import BusinessReports from './BusinessReports';

export default function Reports() {
  const report = useLocation().pathname.split('/').at(-1);
  return ['source', 'room', 'roomType', 'cancellations', 'nationality', 'discounts'].includes(report) ? <BusinessReports report={report} /> : <BasicReports />;
}

function BasicReports() {
  const { apiText } = useI18n();
  const { rooms, roomTypes, settings, getRevenueReport, getFinancialReport, workspaceRevision } = usePms();
  const occupancy = useLocation().pathname.endsWith('/occupancy');
  const currency = settings.currency;
  const money=value=>formatMoney(value,currency);
  const activeRooms=rooms.filter(r=>r.active!==false);
  const [start, setStart] = useState(today(settings.timezone));
  const [end, setEnd] = useState(addDays(today(settings.timezone), 7));
  const [startValid, setStartValid] = useState(true), [endValid, setEndValid] = useState(true);
  const valid = startValid && endValid && start && end && nights(start, end) > 0 && nights(start, end) <= 366;
  const dates = valid ? Array.from({ length: nights(start, end) }, (_, i) => addDays(start, i)) : [];
  
  const [data,setData]=useState(null), [loading,setLoading]=useState(false), [error,setError]=useState(''), [revision,setRevision]=useState(0);
  
  useEffect(() => {
    let mounted = true;
    setData(null);setError('');setLoading(Boolean(valid));
    if (valid) {
      Promise.all([getRevenueReport(start,end,currency,'base'),getFinancialReport(start,end,currency,'base')]).then(([forecast,financial])=>{
        if(mounted)setData({forecast:forecast.rows,financial});
      }).catch(err=>{if(mounted)setError(err.message);}).finally(()=>{if(mounted)setLoading(false);});
    }
    return () => { mounted = false; };
  }, [valid, start, end, currency, getRevenueReport, getFinancialReport, revision, workspaceRevision]);

  const rows = dates.map(date => {
    const row = data?.forecast.find(r => r.date.split('T')[0] === date);
    return row || { date, reserved: 0, reservedRooms: 0, nights: 0, amount: '0.0000' };
  });
  const totalAmount = data?.financial.summary.forecastRoomRevenue;
  const financialRows=new Map(data?.financial.rows.map(row=>[row.date,row])||[]);
  const totalNights = rows.reduce((sum, row) => sum + row.nights, 0);
  const averageOccupancy = valid && activeRooms.length
    ? `${(rows.reduce((sum, row) => sum + row.reservedRooms, 0) / (activeRooms.length * rows.length) * 100).toFixed(1)}%`
    : '—';

  return (
    <div className="pms-original pms-reports">
      <header className="pms-reports-header">
        <div>
          <h1>{occupancy ? tUi("nav.occupancy") : labelUi("Báo cáo doanh thu phòng")}</h1>
          <p>{labelUi("Theo dõi doanh thu và công suất phòng theo khoảng thời gian.")}</p>
        </div>
        <span className="pms-reports-demo" role="status"><Info size={14} aria-hidden="true" /> {loading?tUi("common.loading"):data?labelUi("Dữ liệu máy chủ"):labelUi("Chưa tải dữ liệu")}</span>
      </header>

      <nav className="pms-reports-tabs" aria-label={labelUi("Loại báo cáo")}>
        <Link to="/id/reports/revenue" aria-current={!occupancy ? 'page' : undefined}>
          <CircleDollarSign size={18} aria-hidden="true" />{" "}{labelUi("Doanh thu phòng")}</Link>
        <Link to="/id/reports/occupancy" aria-current={occupancy ? 'page' : undefined}>
          <BarChart3 size={18} aria-hidden="true" />{' '}{tUi("nav.occupancy")}</Link>
        <Link to="/id/reports/source"><BarChart3 size={18} aria-hidden="true" />{' '}{tUi("nav.advancedReports")}</Link>
      </nav>

      <section className="pms-reports-filter" aria-label={labelUi("Bộ lọc thời gian")}>
        <div className="pms-reports-filter-title"><CalendarDays size={18} aria-hidden="true" />{" "}{labelUi("Khoảng thời gian")}</div>
        <div className="pms-reports-date-fields">
          <label htmlFor="report-start">{tUi("common.fromDate")}<DateInput id="report-start" value={start} onChange={setStart} onValidityChange={setStartValid} aria-invalid={!valid} aria-describedby={!valid ? 'report-date-error' : undefined} />
          </label>
          <label htmlFor="report-end">{labelUi("Đến ngày")}<DateInput id="report-end" min={start ? addDays(start, 1) : undefined} value={end} onChange={setEnd} onValidityChange={setEndValid} aria-invalid={!valid} aria-describedby={!valid ? 'report-date-error report-date-note' : 'report-date-note'} />
          </label>
        </div>
        <p id="report-date-note" className="pms-reports-filter-note">{labelUi("Không bao gồm ngày kết thúc. Số liệu cập nhật khi đổi ngày.")}</p>
      </section>

      {!valid && <p id="report-date-error" role="alert" className="pms-reports-error">{labelUi("Chọn khoảng ngày từ 1 đến 366 ngày.")}</p>}
      {error&&<p role="alert" className="pms-reports-error">{error} <button onClick={()=>setRevision(v=>v+1)}>{tUi("common.retry")}</button></p>}

      <div className="pms-reports-summary">
        <SummaryCard
          icon={occupancy ? <BedDouble size={20} aria-hidden="true" /> : <CircleDollarSign size={20} aria-hidden="true" />}
          label={occupancy ? 'Tổng số phòng' : 'Tiền phòng dự kiến'}
          value={occupancy ? activeRooms.length : data ? money(totalAmount) : '—'}
          description={occupancy ? 'Tại khách sạn đang chọn' : 'Trong khoảng thời gian đã chọn'}
        />
        <SummaryCard
          icon={occupancy ? <BarChart3 size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
          label={occupancy ? 'Công suất đặt phòng trung bình' : 'Tổng số đêm phòng'}
          value={data?(occupancy ? averageOccupancy : totalNights):'—'}
          description={occupancy ? 'Số phòng đã đặt / đang ở, gồm mọi tiền tệ' : 'Không gồm booking đã hủy hoặc không đến'}
        />
        <SummaryCard
          icon={<CalendarDays size={20} aria-hidden="true" />}
          label="Thời gian báo cáo"
          value={valid ? `${rows.length} ngày` : '—'}
          description={valid ? `${formatDate(start)} – ${formatDate(addDays(end, -1))}` : 'Chọn khoảng ngày hợp lệ'}
        />
      </div>

      {data&&<div className="pms-reports-summary" aria-label={labelUi("Chỉ số tài chính")}>
        <SummaryCard icon={<CircleDollarSign size={20}/>} label={tUi("nightAudit.revenue")} value={money(data.financial.summary.recognizedRevenue || 0)} description={tUi("nightAudit.reportDefinition")}/>
        <SummaryCard icon={<CircleDollarSign size={20}/>} label={tUi("dashboard.revenue")} value={money(data.financial.summary.realizedRevenue)} description="Hóa đơn lưu trú/POS đã chốt trong kỳ"/>
        <SummaryCard icon={<CircleDollarSign size={20}/>} label="Thực thu từ khách" value={money(data.financial.summary.netReceipts)} description="Tiền khách thanh toán trừ hoàn tiền trong kỳ"/>
        <SummaryCard icon={<BedDouble size={20}/>} label="Giá phòng trung bình (ADR)" value={money(data.financial.summary.adr)} description={`${data.financial.summary.servedNights} đêm đã phục vụ, trước ngày kinh doanh hiện tại`}/>
        <SummaryCard icon={<CircleDollarSign size={20}/>} label="Tiền cọc hiện tại" value={money(data.financial.snapshot.deposits)} description="Đã thu cho các booking chưa nhận phòng"/>
        <SummaryCard icon={<CircleDollarSign size={20}/>} label="Công nợ hiện tại" value={money(data.financial.snapshot.debt)} description="Số tiền còn phải thu của booking/POS đang có dư nợ"/>
        <SummaryCard icon={<CalendarDays size={20}/>} label="Thời điểm số dư hiện tại" value={formatDateTime(data.financial.snapshot.asOf, settings.timezone).slice(11)} description={formatDateTime(data.financial.snapshot.asOf, settings.timezone).slice(0, 10)}/>
      </div>}

      <section className="pms-reports-table-card" aria-labelledby="report-table-title">
        <div className="pms-reports-table-heading">
          <h2 id="report-table-title">{labelUi("Chi tiết theo ngày")}</h2>
          {valid && <span className="pms-reports-count">{rows.length} ngày</span>}
        </div>
        <div className="pms-reports-table-scroll" tabIndex={0} role="region" aria-label={labelUi("Bảng báo cáo theo ngày")}>
          <table>
            <thead>
              <tr>
                <th scope="col">{tUi("common.date")}</th>
                <th scope="col" className="pms-reports-number">{occupancy ? labelUi("Phòng đã đặt / đang ở") : labelUi("Số đêm phòng")}</th>
                <th scope="col" className="pms-reports-number">{occupancy ? labelUi("Công suất đặt phòng") : labelUi("Tiền phòng dự kiến")}</th>
                {!occupancy&&<><th scope="col" className="pms-reports-number">{tUi("dashboard.revenue")}</th><th scope="col" className="pms-reports-number">{labelUi("Thực thu từ khách")}</th></>}
              </tr>
            </thead>
            <tbody>
              {data&&rows.map(row => (
                <tr key={row.date}>
                  <td><time dateTime={row.date}>{formatDate(row.date)}</time></td>
                  <td className="pms-reports-number">{occupancy ? `${row.reservedRooms} / ${activeRooms.length}` : row.nights}</td>
                  <td className="pms-reports-number pms-reports-value">
                    {occupancy ? <span className="pms-reports-occupancy">{activeRooms.length ? `${(row.reservedRooms / activeRooms.length * 100).toFixed(1)}%` : '—'}</span> : money(row.amount)}
                  </td>
                  {!occupancy&&<><td className="pms-reports-number">{money(financialRows.get(row.date)?.realizedRevenue||'0')}</td><td className="pms-reports-number">{money(financialRows.get(row.date)?.netReceipts||'0')}</td></>}
                </tr>
              ))}
              {!data&&<tr><td colSpan={occupancy?3:5} className="pms-reports-empty">{!valid?labelUi("Chọn khoảng ngày hợp lệ để xem báo cáo."):loading?tUi("dashboard.loading"):tUi("dashboard.failed")}</td></tr>}
            </tbody>
            {data && <tfoot><tr>
              <th scope="row">{occupancy ? labelUi("Trung bình trong kỳ") : labelUi("Tổng cộng")}</th>
              <td className="pms-reports-number">{occupancy ? `${activeRooms.length} phòng` : totalNights}</td>
              <td className="pms-reports-number pms-reports-value">{occupancy ? averageOccupancy : money(totalAmount)}</td>
              {!occupancy&&<><td className="pms-reports-number">{money(data.financial.summary.realizedRevenue)}</td><td className="pms-reports-number">{money(data.financial.summary.netReceipts)}</td></>}
            </tr></tfoot>}
          </table>
        </div>
      </section>

      {data&&<section className="pms-reports-summary" aria-label={labelUi("Đối soát sổ quỹ")} style={{marginTop:16}}>
        <SummaryCard label="Số dư đầu kỳ" value={money(data.financial.summary.opening)} description="Tổng số dư ledger trước ngày bắt đầu"/>
        <SummaryCard label="Thu vào quỹ" value={money(data.financial.summary.income)} description="Các bút toán tăng quỹ trong kỳ"/>
        <SummaryCard label="Chi ra quỹ" value={money(data.financial.summary.outflow)} description="Các bút toán giảm quỹ trong kỳ"/>
        <SummaryCard label="Số dư cuối kỳ" value={money(data.financial.summary.closing)} description="Đầu kỳ + thu − chi; chuyển quỹ được đối ứng"/>
      </section>}

      {occupancy && <section className="pms-reports-room-types" aria-label={labelUi("Hạng phòng")}>
        <span>{labelUi("Hạng phòng")}</span>
        {roomTypes.map(type => <span className="pms-reports-room-type" key={type.id}>{type.name} <strong>{rooms.filter(room => room.typeId === type.id).length}</strong></span>)}
      </section>}

      <p className="pms-reports-note"><Info size={16} aria-hidden="true" /><span>{labelUi("Doanh thu phòng dự kiến theo giá từng đêm đã chốt; chưa gồm dịch vụ, thuế và thanh toán. Số tiền hiển thị theo tiền tệ của khách sạn, dùng tỷ giá đã lưu trên từng giao dịch.")}</span></p>
      {data&&<div className="pms-reports-note"><Info size={16} aria-hidden="true"/><span>{Object.values(data.financial.definitions||{}).map(apiText).join(' ')}</span></div>}
    </div>
  );
}

function SummaryCard({ icon, label, value, description }) {
  useI18n();
  return <div className="pms-reports-summary-card">
    <div className="pms-reports-summary-top"><span>{labelUi(label)}</span><span className="pms-reports-summary-icon">{icon}</span></div>
    <strong className="pms-reports-summary-value">{value}</strong>
    <p>{description}</p>
  </div>;
}
