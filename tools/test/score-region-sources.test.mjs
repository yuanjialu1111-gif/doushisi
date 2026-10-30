import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SCORE_REGION_SOURCES, SCORE_REGION_VERSIONS, freezeScoreRegionOptions } from '../../packages/rules/src/edition.ts';

const root = new URL('../../', import.meta.url);

test('every score-region configuration points at its own frozen rule source', async () => {
  assert.deepEqual(Object.keys(SCORE_REGION_SOURCES), Object.keys(SCORE_REGION_VERSIONS));
  for (const [variantKey, source] of Object.entries(SCORE_REGION_SOURCES)) {
    assert.equal(freezeScoreRegionOptions({}, variantKey).source, source);
    const [path] = source.split(':');
    const markdown = await readFile(new URL(path, root), 'utf8');
    assert.match(markdown, new RegExp(`\\(${variantKey}\\)`), `${source} must describe ${variantKey}`);
  }
});

test('red-region release cases do not reuse the 19-0 source', async () => {
  for (const directory of ['20-0', '21-0', '22-0', '23-0', '24-0', '25-0', '26-0', '27-0']) {
    const cases = JSON.parse(await readFile(new URL(`docs/rules/release/${directory}/cases.json`, root), 'utf8'));
    const sources = [];
    const visit = value => {
      if (typeof value === 'string') sources.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(cases);
    const expected = `docs/rules/variants/${directory}.md:2026-09-24`;
    assert.ok(sources.includes(expected), `${directory} must retain its own source provenance`);
    assert.ok(!sources.includes('docs/rules/19-0.md:2026-09-24'), `${directory} must not reuse 19-0`);
  }
});
