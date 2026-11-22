import { decimalInput } from '../../../../shared/lib/number.js';

export function catalogNumericInput(key, value) {
  if (key === 'capacity') return Number(decimalInput(value, { precision: 0, min: '1', max: '50' }));
  return decimalInput(value, { max: ['commission', 'tax'].includes(key) ? '100' : undefined });
}
