import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const snapshotPath = path.join(root, 'client/public/rules-data.json');
const generatedFrom = 'docs/rules/release/*/rulebook.json';
// Explicit release allowlist: never discover drafts, research, or pending variants.
const expectedKeys = Object.freeze([
  '4:0', '5:0', '6:0', '7:0', '8:0', '9:0', '10:0',
  '11:0', '12:0', '14:0', '15:0', '16:0', '19:0', '20:0',
  '21:0', '22:0', '23:0', '24:0', '25:0', '26:0', '27:0',
]);

function assertExactKeys(configurations) {
  assert.ok(Array.isArray(configurations), 'configurations must be an array');
  assert.equal(configurations.length, 21, 'exactly 21 configurations are required');
  assert.deepEqual(
    configurations.map(configuration => configuration.key).sort(),
    [...expectedKeys].sort(),
    'configuration keys must match the release allowlist without duplicates or omissions',
  );
}

function assertApproved(rulebook, key) {
  assert.equal(rulebook.status, 'approved', `${key}: rulebook must be approved`);
  assert.equal(rulebook.basis, 'user-approved', `${key}: basis must be user-approved`);
  assert.equal(rulebook.variantKey, key, `${key}: variantKey must match key`);
}

async function readReleaseConfigurations() {
  return Promise.all(expectedKeys.map(async key => {
    const directory = key.replace(':', '-');
    const sourcePath = `docs/rules/release/${directory}/rulebook.json`;
    const bytes = await readFile(path.join(root, sourcePath));
    return {
      key,
      directory,
      sourcePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rulebook: JSON.parse(bytes.toString('utf8')),
    };
  }));
}

const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 1 && args[0] === '--generate'),
  'Usage: node tools/test/rules-page.test.mjs [--generate]',
);
const releaseConfigurations = await readReleaseConfigurations();

if (args[0] === '--generate') {
  // Validate every source before overwriting the existing snapshot.
  assertExactKeys(releaseConfigurations);
  for (const { key, rulebook } of releaseConfigurations) assertApproved(rulebook, key);
  await writeFile(snapshotPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedFrom,
    configurations: releaseConfigurations,
  }, null, 2)}\n`, 'utf8');
  console.log('Generated client/public/rules-data.json from 21 approved release rulebooks.');
} else {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));

  test('release sources contain exactly the 21 approved configurations', () => {
    assertExactKeys(releaseConfigurations);
    for (const { key, rulebook } of releaseConfigurations) assertApproved(rulebook, key);
  });

  test('rules snapshot has the expected schema and release provenance', () => {
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.generatedFrom, generatedFrom);
  });

  test('rules snapshot has no extra, missing, or duplicate configurations', () => {
    assertExactKeys(snapshot.configurations);
  });

  for (const source of releaseConfigurations) {
    test(`rules snapshot ${source.key} preserves the complete approved release rulebook`, () => {
      assert.ok(Array.isArray(snapshot.configurations), 'configurations must be an array');
      const matches = snapshot.configurations.filter(configuration => configuration.key === source.key);
      assert.equal(matches.length, 1, `${source.key}: exactly one snapshot entry is required`);
      const [configuration] = matches;
      assertApproved(configuration.rulebook, source.key);
      assert.equal(configuration.directory, source.directory);
      assert.equal(configuration.sourcePath, source.sourcePath);
      assert.equal(configuration.sha256, source.sha256, `${source.key}: raw source byte hash differs`);
      assert.deepEqual(configuration.rulebook, source.rulebook, `${source.key}: full rulebook differs`);
    });
  }
}
