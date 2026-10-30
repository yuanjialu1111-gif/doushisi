import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { originalCatalogue } from '../../packages/rules/src/original-catalogue.ts';
import { YAAN_PACKAGE_FANS } from '../../packages/rules/src/yaan.ts';
import { extractPackageRuleEvidence } from '../package-rule-evidence.mjs';

const require = createRequire(new URL('../../packages/protocol/package.json', import.meta.url));
const { parse } = require('@babel/parser');
const packageRoot = new URL('../../../apk-deep-analysis/modules/', import.meta.url);
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(item => walk(item, visit)); return; }
  visit(node);
  for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) walk(value, visit);
}

test('Yaan known fan amounts come from configuration 6:0 and unknown fans remain unassigned', async () => {
  const source = await readFile(new URL('main/FrameGameConfig.js', packageRoot), 'utf8');
  const [variant] = extractPackageRuleEvidence(source, originalCatalogue, ['6:0']);
  const field = key => variant.options.filter(option => option.field === key);
  assert.equal(field('qia20')[0].explanation, '刚好红20点算1番');
  assert.equal(field('baoJiao')[0].label, '报叫三番');
  assert.equal(field('anDui')[0].label, '暗四对三番');
  assert.equal(field('anDui')[0].explanation, '每个龙加3番');
  assert.equal(field('jinGouDiao')[0].explanation, '碰光，手里只留一张牌');
  assert.deepEqual(YAAN_PACKAGE_FANS, { qia20: 1, baoJiao: 3, anDui: 3, dragon: 3 });
  assert.equal(field('maxFan').length, 0);
  assert.equal(field('keSuHu').length, 0);
  assert.equal(field('chengFan').find(option => option.originalValue === 1).explanation, '1*2(各番数之和)，如4番就是16分');
  assert.equal(field('chengFan').find(option => option.originalValue === 0).explanation, '1+所有番数，如4番算5分');
});

test('both original UI summaries scope the three Yaan fan amounts to the YAH20 branch', async () => {
  for (const file of ['main/CommonPlayUIController.js', 'dss/dss_gameController.js']) {
    const source = await readFile(new URL(file, packageRoot), 'utf8');
    const descriptions = [];
    walk(parse(source), node => {
      if (node.type !== 'IfStatement' || node.test.type !== 'BinaryExpression' || node.test.operator !== '==' ||
        node.test.right.type !== 'MemberExpression' || node.test.right.property.name !== 'EN_AREA_TYPE_PKDDS_YAH20') return;
      walk(node.consequent, child => {
        if (child.type === 'LogicalExpression' && child.operator === '&&' && child.left.type === 'MemberExpression' &&
          ['qia20', 'baoJiao', 'anDui'].includes(child.left.property.name) && child.right.type === 'AssignmentExpression' &&
          child.right.right.type === 'StringLiteral') descriptions.push([child.left.property.name, child.right.right.value]);
      });
    });
    assert.deepEqual(descriptions, [
      ['qia20', '金二十一番、'], ['anDui', '暗四对三番、'], ['baoJiao', '报叫三番、'],
    ], file);
  }
});
