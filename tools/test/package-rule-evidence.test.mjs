import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPackageRuleEvidence } from '../package-rule-evidence.mjs';

test('rule evidence is parsed without executing the APK and preserves regional source lines', () => {
  const variant = { name: 'fixture', gameId: 8, rule: { options: { multiple: 1, config: [
    { name: 'example', value: 'exampleFlag', default: 1, wenhao: 'explicit fixture explanation' },
  ] } } };
  const catalogue = { 8: [variant] };
  const source = `dangerousSideEffect();\nmodule.exports = ${JSON.stringify(catalogue)};\nthrow Error('must not execute');`;
  const [result] = extractPackageRuleEvidence(source, catalogue, ['8:0']);
  assert.equal(result.fullGameImplemented, false);
  assert.equal(result.options[0].sourceLine, 2);
  assert.equal(result.options[0].explanation, 'explicit fixture explanation');
  assert.equal(result.options[0].field, 'exampleFlag');
  assert.throws(() => extractPackageRuleEvidence(source, { 8: [{ ...variant, name: 'changed' }] }, ['8:0']), /drift/);
  assert.throws(() => extractPackageRuleEvidence('module.exports = { 8: getRemoteRules() };', catalogue, ['8:0']), /Non-literal/);
  const negative = { ...variant, gameId: -8 };
  assert.equal(extractPackageRuleEvidence(`module.exports = {8: [${JSON.stringify(negative)}]};`, { 8: [negative] }, ['8:0']).length, 1);
});
