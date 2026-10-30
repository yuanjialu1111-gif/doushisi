import { isDeepStrictEqual } from 'node:util';
import type { EngineResult, RoundContext } from './engines.js';
import { requireCondition } from './errors.js';

export function validateNextRoundContext(result: EngineResult): RoundContext | null {
  if (result.nextRoundContext === undefined) return null;
  requireCondition(result.settlement !== undefined, 'INVALID_ROUND_CONTEXT',
    'Continuation can only be committed with a final settlement.', 500);
  if (result.nextRoundContext === null) return null;
  const value = result.nextRoundContext;
  requireCondition(typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype, 'INVALID_ROUND_CONTEXT',
  'Continuation must be a JSON object.', 500);
  let serialized: string | undefined;
  let copy: RoundContext | undefined;
  try {
    serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) <= 65536) copy = JSON.parse(serialized);
  } catch { /* Invalid engine output must roll back the whole action. */ }
  requireCondition(copy !== undefined && isDeepStrictEqual(value, copy), 'INVALID_ROUND_CONTEXT',
    'Continuation must be lossless JSON of at most 64 KiB.', 500);
  return copy;
}
