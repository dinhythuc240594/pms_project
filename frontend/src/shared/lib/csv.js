function csvCell(value) {
  let text = String(value ?? '');
  let start = 0;
  while (start < text.length && (text.charCodeAt(start) < 32 || /\s/.test(text[start]))) start++;
  if (/^[=+\-@]/.test(text.slice(start)) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function csvContent(headers, rows) {
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(headers, rows, filename) {
  const url = URL.createObjectURL(new Blob([csvContent(headers, rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
