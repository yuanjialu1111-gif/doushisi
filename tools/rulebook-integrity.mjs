import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function rulebookContentSha256(rulebook) {
  if (rulebook === null || typeof rulebook !== 'object' || Array.isArray(rulebook)) {
    throw new TypeError('A rulebook object is required.');
  }
  const content = structuredClone(rulebook);
  if (content.approval !== null && typeof content.approval === 'object' && !Array.isArray(content.approval)) {
    delete content.approval.sha256;
  }
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

export function approvalSha256(approval) {
  return createHash('sha256').update(JSON.stringify(approval, null, 2) + '\n').digest('hex');
}
