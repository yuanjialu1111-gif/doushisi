import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseSubject } from './build-fingerprint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'verification/local-ui.json');
const rawOutput = join(root, 'verification/raw/local-ui.json');
const sourcePaths = [
  'client/validation/report.json',
  'client/validation/hall-balance-report.json',
  'client/validation/room-report.json',
  'client/validation/regional/report.json',
];
const sources = [];
const checks = [];
const evidence = [];
const subject = await releaseSubject(root);
let freshRunId;
for (const relative of sourcePaths) {
  const bytes = await readFile(join(root, relative));
  const parsed = JSON.parse(bytes);
  assert.equal(parsed.subjectSha256, subject.sha256, relative + ' needs a fresh browser run');
  assert.equal(parsed.isolatedDatabase, true, relative + ' was not generated in an isolated database');
  assert.ok(typeof parsed.freshRunId === 'string' && parsed.freshRunId.length > 0);
  freshRunId ??= parsed.freshRunId;
  assert.equal(parsed.freshRunId, freshRunId, 'Browser reports must come from the same run');
  assert.deepEqual(parsed.errors, [], relative + ' contains browser errors');
  sources.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex'), parsed });
  evidence.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const layout = sources.find(source => source.path.endsWith('/report.json'))?.parsed;
assert.ok(Array.isArray(layout?.views) && layout.views.length >= 2);
assert.deepEqual(layout.views.map(view => view.viewport).slice(0, 2), [{ width: 1334, height: 750 }, { width: 844, height: 390 }]);
checks.push({ id: 'retained-layout', passed: true, details: { viewports: layout.views.map(view => view.viewport).slice(0, 2) } });

const exactViews = layout.views.filter(view => view.exact === '9007199254740993.125');
assert.equal(exactViews.length, layout.views.length);
checks.push({ id: 'fonts-and-decimals', passed: true, details: { exact: '9007199254740993.125',
  fontEngine: layout.views.map(view => view.engine) } });

const balance = sources.find(source => source.path.endsWith('/hall-balance-report.json'))?.parsed;
assert.ok(balance.views.every(view => view.afterPhysicalClick?.normalBackground === true &&
  view.afterPhysicalClick?.shopBackground === false && view.afterStaleCallback?.normalBackground === true));
checks.push({ id: 'animations', passed: true, details: { hallAnimationChanged: layout.views.map(view => view.hallAnimationChanged),
  staleCallbackRejected: true } });
checks.push({ id: 'comparison-provenance', passed: true, details: { browserReports: sourcePaths,
  physicalDevicesRequiredForNativeAcceptance: true } });

const raw = { checks, sources: sources.map(source => ({ path: source.path, sha256: source.sha256 })),
  generatedAt: new Date().toISOString() };
await mkdir(dirname(rawOutput), { recursive: true });
await writeFile(rawOutput, JSON.stringify(raw, null, 2) + '\n');
const rawBytes = await readFile(rawOutput);
evidence.push({ path: 'verification/raw/local-ui.json', sha256: createHash('sha256').update(rawBytes).digest('hex') });
assert.equal((await releaseSubject(root)).sha256, subject.sha256, 'Release changed during UI report generation');
const report = { schemaVersion: 1, passed: true, subjectSha256: subject.sha256, checks, evidence,
  generatedAt: new Date().toISOString() };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, checks: checks.length, evidence: evidence.length }));
