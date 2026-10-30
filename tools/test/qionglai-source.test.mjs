import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { originalCatalogue } from '../../packages/rules/src/original-catalogue.ts';
import { QIONGLAI_PACKAGE_FANS, QIONGLAI_SCORING_VERSION, freezeQionglaiOptions,
  QIONGLAI_PACK_VERSION, QIONGLAI_PACK_APPROVAL, QIONGLAI_WANG_COUNTS,
  QIONGLAI_INDEPENDENT_VERSION, QIONGLAI_INDEPENDENT_FANS } from '../../packages/rules/src/edition.ts';
import { extractPackageRuleEvidence } from '../package-rule-evidence.mjs';

const require = createRequire(new URL('../../packages/protocol/package.json', import.meta.url));
const { parse } = require('@babel/parser');
const packageRoot = new URL('../../../apk-deep-analysis/modules/', import.meta.url);

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
  visit(node);
  for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) walk(value, visit);
}

test('Qionglai package fan amounts correspond to the exact original configuration, not another region', async () => {
  const source = await readFile(new URL('main/FrameGameConfig.js', packageRoot), 'utf8');
  const [variant] = extractPackageRuleEvidence(source, originalCatalogue, ['8:0']);
  const option = field => {
    const matches = variant.options.filter(item => item.field === field);
    assert.equal(matches.length, 1);
    return matches[0];
  };
  assert.equal(option('qia20').explanation, '刚好红20点算3番');
  assert.equal(option('jinGouDiao').explanation, '碰光，手里剩1张胡单吊算3番');
  assert.equal(option('anDui').label, '暗四对3番');
  assert.equal(option('anDui').explanation, '对子胡，每个龙另外加3番');
  assert.equal(option('siGuiYi').explanation, '不是杠，胡牌中能凑够四同张的加1番');
  assert.equal(option('keSuHu').explanation, '至少1番才能胡，但平胡自己翻到胡牌可胡算3番');
  assert.deepEqual(QIONGLAI_PACKAGE_FANS, {
    qia20: 3, jinGouDiao: 3, anDui: 3, dragon: 3, siGuiYi: 1, keSuHu: 3, redHu: 3, blackHu: 4,
  });
  assert.deepEqual(variant.options.filter(item => item.field === 'maxFan').map(item => item.originalValue), [4, 5, 6, 99]);
  const formula = variant.options.filter(item => item.field === 'chengFan');
  assert.equal(formula.find(item => item.originalValue === 1).explanation, '1*2(各番数之和)，如4番就是16分');
  assert.equal(formula.find(item => item.originalValue === 0).explanation, '1+所有番数，如4番算5分');
  const declaration = variant.options.filter(item => item.field === 'baoJiaoYingbao');
  assert.equal(declaration.find(item => item.originalValue === 1).explanation, '不包括胡牌已有红20点');
  assert.equal(declaration.find(item => item.originalValue === 0).explanation, '包括胡牌够红20点');
});

test('Qionglai color evidence is inside its regional branch and guarded by the color switch', async () => {
  const source = await readFile(new URL('main/CommonPlayUIController.js', packageRoot), 'utf8');
  const regions = [];
  walk(parse(source), node => {
    if (node.type !== 'IfStatement' || node.test.type !== 'LogicalExpression' || node.test.operator !== '||') return;
    const tests = [node.test.left, node.test.right];
    if (!tests.every(part => part.type === 'BinaryExpression' && part.operator === '==' &&
      part.left.type === 'MemberExpression' && part.left.property.name === 'areaType' &&
      part.right.type === 'MemberExpression')) return;
    const names = tests.map(part => part.right.property.name);
    if (names.includes('EN_AREA_TYPE_PKDDS_CDQL')) {
      assert.deepEqual(names, ['EN_AREA_TYPE_PKDDS_CDPJ', 'EN_AREA_TYPE_PKDDS_CDQL']);
      regions.push(node.consequent);
    }
  });
  assert.ok(regions.length > 0);
  const descriptions = [];
  walk(regions, node => {
    if (node.type === 'LogicalExpression' && node.operator === '&&' &&
      node.left.type === 'MemberExpression' && node.left.property.name === 'quanHongHei' &&
      node.right.type === 'AssignmentExpression' && node.right.operator === '+=' &&
      node.right.right.type === 'StringLiteral') descriptions.push(node.right.right.value);
  });
  assert.deepEqual(descriptions, ['全红3番、全黑4番、']);
});

test('new Qionglai metadata distinguishes independent amounts from package-backed colors', () => {
  const first = freezeQionglaiOptions({ qlTianDiHu: 1, qlHongHeiHu: 1, qlHongHei50: 1 });
  assert.equal(first.fanVersion, QIONGLAI_INDEPENDENT_VERSION);
  assert.notEqual(first.fanVersion, QIONGLAI_SCORING_VERSION);
  assert.deepEqual(first.fanTable, QIONGLAI_INDEPENDENT_FANS);
  assert.match(first.fanSources.independent, /QIONGLAI-INDEPENDENT/);
  first.fanTable.redHu = 100;
  first.fanSources.colors = 'changed-local-copy';
  const second = freezeQionglaiOptions({ qlTianDiHu: 1, qlHongHeiHu: 1, qlHongHei50: 1 });
  assert.equal(second.fanTable.redHu, 3);
  assert.match(second.fanSources.colors, /EN_AREA_TYPE_PKDDS_CDQL/);
});

test('approved Qionglai pack keeps all six original king compositions and independent reference totals', async () => {
  const source = await readFile(new URL('main/FrameGameConfig.js', packageRoot), 'utf8');
  const [variant] = extractPackageRuleEvidence(source, originalCatalogue, ['8:0']);
  assert.deepEqual(variant.options.filter(option => option.field === 'wangNum').map(option =>
    [option.originalValue, option.explanation]), [
    [3, '1小王、1大王、1白板'], [6, '2小王、2大王、2白板'],
    [9, '3小王、3大王、3白板'], [12, '4小王、4大王、4白板'],
    [15, '5小王、5大王、5白板'], [18, '6小王、6大王、6白板'],
  ]);
  const cases = JSON.parse(await readFile(new URL('../../docs/rules/cases/qionglai-pack-v1.json', import.meta.url), 'utf8'));
  assert.equal(cases.approval, QIONGLAI_PACK_APPROVAL);
  assert.equal(cases.version, QIONGLAI_PACK_VERSION);
  assert.equal(cases.variantKey, '8:0');
  assert.deepEqual(cases.cases.map(item => item.wangNum), QIONGLAI_WANG_COUNTS);
  assert.deepEqual(cases.cases.map(item => item.total), [55, 58, 61, 64, 67, 70]);
  const metadata = freezeQionglaiOptions({});
  assert.equal(metadata.packVersion, QIONGLAI_PACK_VERSION);
  assert.equal(metadata.packSource, QIONGLAI_PACK_APPROVAL);
});
