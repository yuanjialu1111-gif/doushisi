import fs from 'node:fs';
import crypto from 'node:crypto';

const root = process.cwd();
const runtimePath = 'apps/server/src/runtime-engines.ts';
const runtime = fs.readFileSync(runtimePath, 'utf8');
const start = runtime.indexOf('export const runtimeEngineEntries');
const open = runtime.indexOf('[', start);
const end = runtime.indexOf('\n]);', open);
if (start < 0 || open < 0 || end < 0) throw new Error('runtimeEngineEntries parse anchor missing');

const block = runtime.slice(open, end);
const entryPattern = /\{\s*engine:\s*([^\n]+),\s*rulebook:\s*\{\s*path:\s*'([^']+)',\s*sha256:\s*'([^']+)'\s*\},\s*cases:\s*\{\s*path:\s*'([^']+)',\s*sha256:\s*'([^']+)'\s*\},?\s*\}/g;
const fixedEngineKeys = { Xinjin: '4:0', Anyue: '5:0', Yaan: '6:0', Pujiang: '7:0', Qionglai: '8:0' };
const entries = [];

for (const match of block.matchAll(entryPattern)) {
  const engineLine = match[1];
  const factory = engineLine.match(/create([A-Za-z0-9]+)Engine/)?.[1];
  const explicitKey = [...engineLine.matchAll(/'([^']+)'/g)].map(item => item[1]).find(value => /^\d+:\d+$/.test(value));
  const variantKey = explicitKey ?? fixedEngineKeys[factory];
  if (!variantKey) throw new Error(`Cannot resolve variant key for ${engineLine}`);
  entries.push({
    variantKey,
    engineLine,
    rulebookPath: match[2],
    rulebookSha256: match[3],
    casesPath: match[4],
    casesSha256: match[5],
  });
}

if (entries.length !== 21) throw new Error(`Expected 21 runtime entries, got ${entries.length}`);
if (new Set(entries.map(entry => entry.variantKey)).size !== entries.length) throw new Error('Duplicate runtime variant key');

const plan = entries.map(entry => {
  const manifestPath = `docs/rules/release/${entry.variantKey.replace(':', '-')}/manifest.json`;
  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(entry.casesPath)).digest('hex');
  const actualRulebookSha256 = crypto.createHash('sha256').update(fs.readFileSync(entry.rulebookPath)).digest('hex');
  const constructorSha256 = entry.engineLine.match(/create[A-Za-z0-9]+Engine\('([0-9a-f]{64})'/)?.[1];
  if (!constructorSha256) throw new Error(`Constructor digest not found for ${entry.variantKey}`);
  if (manifest.variantKey !== entry.variantKey) throw new Error(`Manifest variant mismatch for ${entry.variantKey}`);
  if (manifest.cases.path !== entry.casesPath) throw new Error(`Manifest cases path mismatch for ${entry.variantKey}`);
  if (manifest.rulebook.path !== entry.rulebookPath) throw new Error(`Manifest rulebook path mismatch for ${entry.variantKey}`);
  return { ...entry, manifestPath, manifest, constructorSha256, actualSha256, actualRulebookSha256 };
});

const changes = plan.filter(item => item.actualRulebookSha256 !== item.rulebookSha256 ||
  item.actualRulebookSha256 !== item.manifest.rulebook.sha256 ||
  item.actualSha256 !== item.casesSha256 || item.actualSha256 !== item.manifest.cases.sha256 ||
  item.actualSha256 !== item.constructorSha256);

const report = {
  mode: process.argv.includes('--write') ? 'write' : 'dry-run',
  entries: plan.length,
  changed: changes.length,
  changes: changes.map(item => ({
    variantKey: item.variantKey,
    rulebookPath: item.rulebookPath,
    runtimeRulebookSha256: item.rulebookSha256,
    manifestRulebookSha256: item.manifest.rulebook.sha256,
    actualRulebookSha256: item.actualRulebookSha256,
    casesPath: item.casesPath,
    runtimeCasesSha256: item.casesSha256,
    manifestCasesSha256: item.manifest.cases.sha256,
    constructorSha256: item.constructorSha256,
    actualSha256: item.actualSha256,
  })),
};

console.log(JSON.stringify(report, null, 2));
if (!process.argv.includes('--write')) process.exit(0);

for (const item of plan) {
  item.manifest.rulebook.sha256 = item.actualRulebookSha256;
  item.manifest.cases.sha256 = item.actualSha256;
  fs.writeFileSync(item.manifestPath, JSON.stringify(item.manifest, null, 2) + '\n');
}

let nextRuntime = runtime;
for (const item of changes) {
  if (item.constructorSha256 !== item.actualSha256) {
    const nextEngineLine = item.engineLine.replace(/'([0-9a-f]{64})'/, `'${item.actualSha256}'`);
    if (nextEngineLine === item.engineLine) throw new Error(`Constructor replacement failed for ${item.variantKey}`);
    if (nextRuntime.split(item.engineLine).length - 1 !== 1) {
      throw new Error(`Runtime engine line occurrence mismatch for ${item.variantKey}`);
    }
    nextRuntime = nextRuntime.replace(item.engineLine, nextEngineLine);
  }

  if (item.actualRulebookSha256 !== item.rulebookSha256) {
    const rulebookPattern = new RegExp(`rulebook: \\{ path: '${item.rulebookPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s+sha256: '${item.rulebookSha256}' \\}`);
    if (!rulebookPattern.test(nextRuntime)) throw new Error(`Runtime rulebook binding not found for ${item.variantKey}`);
    nextRuntime = nextRuntime.replace(rulebookPattern, `rulebook: { path: '${item.rulebookPath}',\n      sha256: '${item.actualRulebookSha256}' }`);
  }

  if (item.actualSha256 !== item.casesSha256) {
    const casesPattern = new RegExp(`cases: \\{ path: '${item.casesPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s+sha256: '${item.casesSha256}' \\}`);
    if (!casesPattern.test(nextRuntime)) throw new Error(`Runtime cases binding not found for ${item.variantKey}`);
    nextRuntime = nextRuntime.replace(casesPattern, `cases: { path: '${item.casesPath}',\n      sha256: '${item.actualSha256}' }`);
  }
}
fs.writeFileSync(runtimePath, nextRuntime);
console.log(JSON.stringify({ written: changes.length, runtimePath }, null, 2));
