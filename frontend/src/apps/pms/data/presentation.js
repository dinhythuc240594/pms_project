import { money, statusLabels } from './model.js';
import { formatDate, formatDateTime } from '../../../shared/lib/date.js';
export const timestamp = formatDateTime;
export function bookingEvent(row,currency='VND') {
  const data=row.details||{},event=row.event||row.action;
  const labels={'reservation.created':'Tạo đặt phòng','reservation.updated':'Cập nhật đặt phòng','reservation.payment':'Thu tiền','reservation.refund':'Hoàn tiền','reservation.charge':'Thêm dịch vụ / khoản phí','reservation.note':'Thêm ghi chú','reservation.adjustment':'Điều chỉnh sau checkout','reservation.pos':'Ghi hóa đơn POS','reservation.pos_cancel':'Hủy chi phí POS'};
  const statusName={IN_HOUSE:'Nhận phòng',CHECKED_OUT:'Trả phòng',CANCELLED:'Hủy đặt phòng',CONFIRMED:'Xác nhận đặt phòng',NO_SHOW:'Khách không đến'};
  const label=event==='reservation.status'?statusName[data.to]||'Đổi trạng thái':labels[event]||'Cập nhật đặt phòng';
  const details=[];
  if(data.from||data.to)details.push([statusLabels[data.from],statusLabels[data.to]].filter(Boolean).join(' → '));
  if(data.rooms?.length)details.push('Phòng '+data.rooms.join(', '));
  if(data.checkIn&&data.checkOut)details.push(formatDate(data.checkIn)+' → '+formatDate(data.checkOut));
  if(data.amount!==undefined)details.push(money(data.amount,currency));
  if(data.fund)details.push('Quỹ: '+data.fund);
  if(data.description)details.push(data.description);
  if(data.reason)details.push(data.reason);
  if(data.stayChanged)details.push('Đã đổi lịch lưu trú / phòng');
  return {label,detail:details.join(' · ')||'Đã ghi nhận trên máy chủ'};
}
