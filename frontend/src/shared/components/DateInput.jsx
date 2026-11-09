import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { tr } from '../i18n/useI18n.js';
import { dateInputText, parseDateInput } from '../lib/date.js';
import './DateInput.css';

export default function DateInput({ value = '', onChange, onValidityChange, type = 'date', min, max, disabled, readOnly, style, ...props }) {
  const field = useRef(null), calendar = useRef(null);
  const validityCallback = useRef(onValidityChange);
  const [draft, setDraft] = useState(null);
  const text = draft?.value === value ? draft.text : dateInputText(value);
  const withTime = type === 'datetime-local', format = withTime ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy';
  const parsed = parseDateInput(text, withTime);
  const error = text && parsed === undefined ? tr('Ngày không hợp lệ.') + ` ${format}`
    : parsed && ((min && parsed < min) || (max && parsed > max)) ? tr('Ngày nằm ngoài khoảng cho phép.') : '';
  const valid = !error && (!props.required || Boolean(text));
  useEffect(() => { validityCallback.current = onValidityChange; }, [onValidityChange]);
  useEffect(() => { validityCallback.current?.(valid); }, [valid]);
  useEffect(() => { field.current?.setCustomValidity(error); }, [error]);
  function change(text, next) {
    const valid = next !== undefined && (!next || ((!min || next >= min) && (!max || next <= max)));
    setDraft({ value: valid ? next : value, text });
    if (valid) onChange?.(next);
  }
  return <span className="date-input-control">
    <input {...props} ref={field} type="text" value={text} placeholder={format} title={format} disabled={disabled} readOnly={readOnly} aria-invalid={Boolean(error) || props['aria-invalid'] || undefined} style={{ ...style, paddingRight: 40 }} onChange={event => change(event.target.value, parseDateInput(event.target.value, withTime))} />
    {!readOnly && <><input ref={calendar} className="date-input-native" type={type} value={value} min={min} max={max} disabled={disabled} tabIndex={-1} aria-hidden="true" onChange={event => change(dateInputText(event.target.value), event.target.value)} /><button type="button" className="date-input-picker" aria-label={tr('Chọn ngày')} title={format} disabled={disabled} onClick={() => calendar.current?.showPicker?.()}><CalendarDays size={16} aria-hidden="true" /></button></>}
  </span>;
}
