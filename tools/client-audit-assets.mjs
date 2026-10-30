import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] || join(project, '../../work/apk/assets/assets'));
const target = join(project, 'client/public/assets');
const sha = data => createHash('sha256').update(data).digest('hex');
const report = { at: new Date().toISOString(), source, bundles: [], patchedFonts: [], removedUpdateCacheFiles: 0, mismatches: [], note: 'Byte identity confirms retained resources except explicitly validated decimal glyph additions and the retired native hot-update cache; it does not certify gameplay or original screenshot equivalence.' };
const fontManifest = JSON.parse(await readFile(join(project, 'client/decimal-font-manifest.json'), 'utf8'));
const fonts = new Set(fontManifest.map(entry => `dss/import/${entry.id.slice(0, 2)}/${entry.id}.json`));
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await files(join(directory, entry.name)));
    else result.push(join(directory, entry.name));
  }
  return result;
}
for (const bundle of ['main', 'internal', 'resources', 'hall', 'dss']) {
  const row = { bundle, unchangedResourceFiles: 0, unchangedBytes: 0, patchedController: ['main', 'hall', 'dss'].includes(bundle) };
  for (const path of await files(join(source, bundle))) {
    const name = relative(source, path);
    if (name.replaceAll('\\', '/').startsWith('main/native/')) { report.removedUpdateCacheFiles++; continue; }
    if (row.patchedController && name.replaceAll('\\', '/') === `${bundle}/index.js`) continue;
    const original = await readFile(path), recovered = await readFile(join(target, name));
    if (sha(original) !== sha(recovered) && fonts.has(name.replaceAll('\\', '/'))) {
      const before = JSON.parse(original), after = JSON.parse(recovered);
      const point = after[5][0][3].fontDefDictionary[46];
      assert.ok(point?.rect.width > 0 && point.rect.height > 0);
      assert.equal(before[5][0][3].fontDefDictionary[46], undefined);
      delete after[5][0][3].fontDefDictionary[46];
      assert.deepEqual(after, before, 'Only the missing decimal glyph may change');
      report.patchedFonts.push({ path: name.replaceAll('\\', '/'), originalSha256: sha(original), patchedSha256: sha(recovered), addedCharacter: '.' });
    } else if (sha(original) !== sha(recovered)) report.mismatches.push(name);
    else { row.unchangedResourceFiles++; row.unchangedBytes += original.length; }
  }
  report.bundles.push(row);
}
await writeFile(join(project, 'client/validation/asset-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert.equal(report.mismatches.length, 0);
