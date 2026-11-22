export const INVENTORY_KINDS = { all: 'Lịch sử biến động kho', opening: 'Tồn đầu kỳ', receipt: 'Phiếu nhập kho', issue: 'Phiếu xuất kho', transfer: 'Phiếu chuyển kho', count: 'Phiếu kiểm kê', reversal: 'Phiếu đảo kho', pos_issue: 'Xuất kho POS', pos_return: 'Hoàn kho POS' };

// Keep server decimals exact, including 8-digit cost values and large quantities.
export const quantityText = value => String(value ?? '0').replace(/\.(\d*?)0+$/, (_, digits) => digits ? `.${digits}` : '');
