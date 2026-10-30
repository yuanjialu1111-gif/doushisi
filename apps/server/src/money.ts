import { Decimal } from 'decimal.js';
import { AppError } from './errors.js';

Decimal.set({ precision: 120, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 120 });

export function amount(value: unknown): Decimal {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,79})(?:\.\d{1,12})?$/.test(value)) {
    throw new AppError('INVALID_AMOUNT', 'Amount must be an exact decimal string (at most 12 decimal places).');
  }
  return new Decimal(value);
}

export function money(value: Decimal.Value): string {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new AppError('INVALID_AMOUNT', 'Amount must be finite.');
  if (result.isZero()) return '0';
  return result.toFixed();
}

export { Decimal };

export const BEAN_SCALE = 1_000_000_000_000n;

/** Internal derived amounts are not restricted to the host's 80-digit input. */
export function beanUnits(value: unknown): bigint {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(value)) {
    throw new AppError('INVALID_AMOUNT', 'Expected exact beans with at most 12 decimal places.');
  }
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole!) * BEAN_SCALE + BigInt(fraction.padEnd(12, '0'));
  return negative ? -result : result;
}

export function unitsMoney(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % BEAN_SCALE).toString().padStart(12, '0').replace(/0+$/, '');
  return `${value < 0n ? '-' : ''}${magnitude / BEAN_SCALE}${fraction ? '.' + fraction : ''}`;
}

export const addMoney = (left: string, right: string): string => unitsMoney(beanUnits(left) + beanUnits(right));
export const internalMoney = (value: unknown): string => unitsMoney(beanUnits(value));
