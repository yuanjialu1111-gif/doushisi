import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGanluoOfficialCases, buildSettlementEvidence, buildXuzhouOptionCases, createFixtureRules, sha256 }
  from './red-region-evidence-fixtures.mjs';
import { createOptionProbe, mergeEvidenceCases } from './option-evidence.mjs';
import { createScoreRegionEngine } from '../apps/server/src/game/score-region-engine.ts';
import { freezeScoreRegionOptions, getDefaultOptions, getRoomSpec } from '../packages/rules/src/index.ts';
import { approvalSha256, rulebookContentSha256 } from './rulebook-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = value => JSON.stringify(value, null, 2) + '\n';
const variants = [
  { key: '20:0', directory: '20-0', source: 'docs/rules/variants/20-0.md', deckAfterDiscard: 38 },
  { key: '21:0', directory: '21-0', source: 'docs/rules/variants/21-0.md' },
  { key: '22:0', directory: '22-0', source: 'docs/rules/variants/22-0.md' },
  { key: '23:0', directory: '23-0', source: 'docs/rules/variants/23-0.md' },
  { key: '24:0', directory: '24-0', source: 'docs/rules/variants/24-0.md' },
  { key: '25:0', directory: '25-0', source: 'docs/rules/variants/25-0.md', deckAfterDiscard: 36 },
  { key: '26:0', directory: '26-0', source: 'docs/rules/variants/26-0.md', specialResponse: true },
  { key: '27:0', directory: '27-0', source: 'docs/rules/variants/27-0.md', deckAfterDiscard: 36 },
];

const settlementVariants = new Set(['23:0', '25:0', '26:0', '27:0']);
function fixtureReference(id, fixture, covers, assertions) {
  assert.ok(fixture.actions.length > 0, `${id}: fixture must execute at least one action`);
  return {
    id, initialSnapshot: fixture.initialSnapshot, covers,
    steps: fixture.actions.map((item, index) => ({
      actorId: item.userId, action: item.action,
      assert: index === fixture.actions.length - 1 ? assertions : { 'snapshot.variantKey': '23:0' },
    })),
  };
}

function rebuildXuzhouCases(officialCases, rulebookDigest) {
  const engine = createScoreRegionEngine('pending-reference-digest', '23:0', () => 0);
  const fixtures = buildXuzhouOptionCases();
  const baseRules = createFixtureRules('23:0');
  const optionCases = createOptionProbe(engine, {
    variantKey: '23:0',
    baseRules,
    fields: getRoomSpec('23:0').fields,
    freeze: (raw, key) => freezeScoreRegionOptions(raw, key),
  });
  const generated = [
    ...optionCases,
    fixtureReference('option-piao-type-2', fixtures.piaoType2, ['option:piaoType=2'], {
      'snapshot.phase': 'finished', 'snapshot.outcome.reason': 'hu',
      'snapshot.players.0.piao': 1, 'snapshot.players.1.piao': 1,
    }),
    fixtureReference('option-ba-no-guo', fixtures.baNoGuo, ['option:baNoGuo=1'], {
      'snapshot.phase': 'finished', 'snapshot.outcome.reason': 'hu',
      'snapshot.players.1.melds.0.kind': 'ba',
    }),
    fixtureReference('option-guo-zhang-no-caozuo', fixtures.guoZhangNoCaozuo,
      ['option:guoZhangNoCaozuo=1'], {
        'snapshot.players.0.passedClaimFaces.0.rank': 7,
        'snapshot.players.0.passedClaimFaces.0.handRevision': 0,
      }),
    fixtureReference('option-gang-duo-zhang', fixtures.gangDuoZhang, ['option:gangDuoZhang=1'], {
      'snapshot.phase': 'finished', 'snapshot.outcome.reason': 'hu',
      'snapshot.players.0.melds.0.cardIds.length': 6,
    }),
  ];
  return { ...mergeEvidenceCases(officialCases, generated, {
    ownedPrefixes: ['option-'],
  }), rulebookDigest };
}

/** Legacy hand-written suites declared a whole option matrix per behavioural case. */
function stripLegacyOptionDeclarations(officialCases, generated) {
  return mergeEvidenceCases(officialCases, generated, { ownedPrefixes: ['option-'] });
}

async function syncXuzhouBinding(output, manifest, casesText) {
  const digest = sha256(casesText);
  const previousDigest = manifest.cases.sha256;
  if (previousDigest === digest) return;
  manifest.cases.sha256 = digest;
  manifest.generatedAt = new Date().toISOString();
  await writeFile(join(output, 'manifest.json'), json(manifest));
  const runtimePath = join(root, 'apps/server/src/runtime-engines.ts');
  const runtime = await readFile(runtimePath, 'utf8');
  const engineBinding = `createScoreRegionEngine('${previousDigest}', '23:0')`;
  const casesBinding = `cases: { path: 'docs/rules/release/23-0/cases.json',\n      sha256: '${previousDigest}' }`;
  assert.equal(runtime.split(engineBinding).length, 2, '23:0 engine evidence binding');
  assert.equal(runtime.split(casesBinding).length, 2, '23:0 cases evidence binding');
  const nextRuntime = runtime
    .replace(engineBinding, `createScoreRegionEngine('${digest}', '23:0')`)
    .replace(casesBinding, `cases: { path: 'docs/rules/release/23-0/cases.json',\n      sha256: '${digest}' }`);
  await writeFile(runtimePath, nextRuntime);
}

async function main() {
  for (const variant of variants) {
    const output = join(root, `docs/rules/release/${variant.directory}`);
    const [rulebookText, approvalText, casesText, manifestText] = await Promise.all([
    readFile(join(output, 'rulebook.json'), 'utf8'),
    readFile(join(output, 'approval.json'), 'utf8'),
    readFile(join(output, 'cases.json'), 'utf8'),
    readFile(join(output, 'manifest.json'), 'utf8'),
    ]);
    const rulebook = JSON.parse(rulebookText);
    const approval = JSON.parse(approvalText);
    const manifest = JSON.parse(manifestText);
    let officialCases = JSON.parse(casesText);

    assert.equal(manifest.variantKey, variant.key, `${variant.key} manifest variant`);
  assert.equal(rulebook.variantKey, variant.key, `${variant.key} rulebook variant`);
  assert.equal(approval.variantKey, variant.key, `${variant.key} approval variant`);
  assert.equal(officialCases.variantKey, variant.key, `${variant.key} cases variant`);
  assert.equal(rulebook.status, 'approved', `${variant.key} rulebook status`);
  assert.equal(rulebook.basis, 'user-approved', `${variant.key} rulebook basis`);
  assert.equal(manifest.ruleVersion, rulebook.ruleVersion, `${variant.key} manifest rulebook version`);
  assert.equal(manifest.ruleVersion, approval.ruleVersion, `${variant.key} manifest approval version`);
  assert.equal(officialCases.ruleVersion, manifest.ruleVersion, `${variant.key} cases version`);
  assert.equal(rulebook.approval?.path, `docs/rules/release/${variant.directory}/approval.json`,
    `${variant.key} approval path`);
  assert.equal(rulebook.approval?.sha256, approvalSha256(approval), `${variant.key} approval digest`);
  assert.equal(approval.rulebookSha256, rulebookContentSha256(rulebook), `${variant.key} approval content binding`);
  assert.equal(manifest.rulebook.sha256, sha256(rulebookText), `${variant.key} rulebook digest`);
  assert.equal(manifest.cases.sha256, sha256(casesText), `${variant.key} cases digest`);
    assert.equal(officialCases.rulebookDigest, manifest.rulebook.sha256, `${variant.key} cases rulebook binding`);

    let officialCasesText = casesText;
    if (variant.key === '23:0') {
      officialCases = rebuildXuzhouCases(officialCases, manifest.rulebook.sha256);
      officialCasesText = json(officialCases);
      await writeFile(join(output, 'cases.json'), officialCasesText);
      await syncXuzhouBinding(output, manifest, officialCasesText);
    } else if (['20:0', '21:0', '22:0', '24:0', '25:0', '26:0', '27:0'].includes(variant.key)) {
      const defaults = getDefaultOptions(variant.key);
      const baseRules = { ...defaults, gameNum: 4, playerNum: defaults.playerNum ?? 4, baseBeans: '0.125' };
      const engine = createScoreRegionEngine(manifest.cases.sha256, variant.key, () => 0);
      const generated = createOptionProbe(engine, {
        variantKey: variant.key,
        baseRules,
        fields: getRoomSpec(variant.key).fields,
        freeze: (raw, key) => freezeScoreRegionOptions(raw, key),
        compatibleOverrides: (key, field, value) => key === '20:0'
          ? {
              ...(field === 'maxFan' && value === 99 ? { chaoFanJiaDi: 0 } : {}),
              ...(field === 'playerNum' && value === 3 ? { daXiaoJia: 0 } : {}),
            }
          : {},
      });
      if (variant.key === '26:0') generated.push(...buildGanluoOfficialCases());
      officialCases = stripLegacyOptionDeclarations(officialCases, generated);
      officialCasesText = json(officialCases);
      await writeFile(join(output, 'cases.json'), officialCasesText);
      const digest = sha256(officialCasesText);
      manifest.cases.sha256 = digest;
      manifest.generatedAt = new Date().toISOString();
      await writeFile(join(output, 'manifest.json'), json(manifest));
    }

    if (!settlementVariants.has(variant.key)) {
      console.log(JSON.stringify({ variantKey: variant.key, settlementCases: 'not-applicable', output }));
      continue;
    }

    const settlement = buildSettlementEvidence(variant.key, {
    ruleVersion: manifest.ruleVersion,
    officialCasesSha256: sha256(officialCasesText),
    rulebookDigest: sha256(rulebookText),
    });
  assert.equal(settlement.variantKey, variant.key, `${variant.key} settlement variant`);
  assert.equal(settlement.ruleVersion, manifest.ruleVersion, `${variant.key} settlement rule version`);
  assert.equal(settlement.officialCasesSha256, manifest.cases.sha256, `${variant.key} settlement cases digest`);
  assert.equal(settlement.rulebookDigest, manifest.rulebook.sha256, `${variant.key} settlement rulebook digest`);
  assert.equal(settlement.blocked.length, 0, `${variant.key} settlement evidence must not be blocked`);
  assert.equal(JSON.stringify(settlement).includes('implementation-blocked'), false,
    `${variant.key} settlement evidence contains an implementation-blocked status`);
    await writeFile(join(output, 'settlement-cases.json'), json(settlement));
    console.log(JSON.stringify({ variantKey: variant.key, ruleVersion: manifest.ruleVersion,
      officialCasesSha256: settlement.officialCasesSha256, settlementCases: settlement.cases.length, output }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
