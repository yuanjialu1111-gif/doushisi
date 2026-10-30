import { getDefaultOptions, type RegionContext } from '@dss/rules';
import { encodeFrame } from '@dss/protocol';
import { encodeOriginalResponse } from '../src/original-wire.js';

// Existing synthetic accounting cases use four-round rooms. The original
// regional default remains untouched in the actual catalogue.
export function getFixtureOptions(key: string, region?: RegionContext) {
  return { ...getDefaultOptions(key, region), ...(key === '4:0' ? { gameNum: 4 } : {}) };
}
export function encodeFixtureFrame(head: Parameters<typeof encodeFrame>[0], data: Parameters<typeof encodeFrame>[1]) {
  if (head.cmd === 3 && head.protoVersion === 2 && (data.hwRequestCreateTable as any)?.areaType === 4) {
    return encodeOriginalResponse(3, data.hwRequestCreateTable as Record<string, unknown>, head.uid ?? '', { createRoom: { baseBeans: '0.1' } });
  }
  return encodeFrame(head, data);
}
