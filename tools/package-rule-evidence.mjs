import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'packages/protocol/package.json'));
const { parse } = require('@babel/parser');
const digest = value => createHash('sha256').update(value).digest('hex');

function literal(node, locations, path = []) {
  locations.set(JSON.stringify(path), node.loc.start.line);
  if (['StringLiteral', 'BooleanLiteral', 'NumericLiteral'].includes(node.type)) return node.value;
  if (node.type === 'NullLiteral') return null;
  if (node.type === 'UnaryExpression' && ['-', '+', '!'].includes(node.operator)) {
    const value = literal(node.argument, new Map(), path);
    assert.ok(typeof value === 'number' || typeof value === 'boolean', 'Unary rule constants must be numeric or boolean');
    return node.operator === '!' ? !value : node.operator === '-' ? -value : +value;
  }
  if (node.type === 'ArrayExpression') return node.elements.map((item, index) => {
    assert.ok(item, 'Sparse arrays are not static rule data');
    return literal(item, locations, [...path, String(index)]);
  });
  if (node.type === 'ObjectExpression') {
    const entries = node.properties.map(property => {
      assert.equal(property.type, 'ObjectProperty');
      assert.equal(property.computed, false);
      const key = String(property.key.type === 'Identifier' ? property.key.name : property.key.value);
      assert.ok(key !== 'undefined' && !['__proto__', 'constructor', 'prototype'].includes(key));
      return [key, literal(property.value, locations, [...path, key])];
    });
    assert.equal(new Set(entries.map(([key]) => key)).size, entries.length, 'Duplicate static keys are ambiguous');
    return Object.fromEntries(entries);
  }
  throw new Error(`Non-literal rule expression: ${node.type}`);
}

export function extractPackageRuleEvidence(source, catalogue, retainedKeys) {
  let exported;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' &&
      !node.left.computed && node.left.property.name === 'exports' && node.right.type === 'ObjectExpression') {
      assert.equal(exported, undefined, 'Multiple exports need explicit selection');
      exported = node.right;
    }
    for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) visit(value);
  }
  visit(parse(source));
  assert.ok(exported, 'Static FrameGameConfig export was not found');
  const locations = new Map();
  const original = literal(exported, locations);
  return retainedKeys.map(variantKey => {
    const [id, index] = variantKey.split(':');
    const variant = original[id]?.[Number(index)];
    assert.deepEqual(variant, catalogue[id]?.[Number(index)], `Extracted catalogue drift: ${variantKey}`);
    const options = Object.entries(variant.rule).flatMap(([groupId, group]) => group.config.map((option, optionIndex) => {
      const objectPath = [id, index, 'rule', groupId, 'config', String(optionIndex)];
      return {
        field: group.multiple ? option.value : group.param, label: option.name, originalValue: option.value,
        default: Boolean(option.default), explanation: option.wenhao ?? null, groupId,
        sourceLine: locations.get(JSON.stringify(objectPath)), objectPath,
        evidenceKind: option.wenhao ? 'explicit-option-description' : 'option-label-and-value',
      };
    }));
    return { variantKey, name: variant.name, options, fullGameImplemented: false };
  });
}

export async function main() {
  const { originalCatalogue } = await import('../packages/rules/src/original-catalogue.ts');
  const { RETAINED_VARIANT_KEYS } = await import('../packages/rules/src/edition.ts');
  const sourceFile = resolve(root, '../apk-deep-analysis/modules/main/FrameGameConfig.js');
  const source = await readFile(sourceFile, 'utf8');
  const variants = extractPackageRuleEvidence(source, originalCatalogue, RETAINED_VARIANT_KEYS);
  const report = {
    schemaVersion: 1, source: '../apk-deep-analysis/modules/main/FrameGameConfig.js', sourceSha256: digest(source),
    catalogueSha256: digest(await readFile(join(root, 'packages/rules/src/original-catalogue.ts'))),
    scope: 'package descriptions and option values; not complete server rules or a gameplay acceptance',
    configurations: variants.length,
    explicitDescriptions: variants.flatMap(variant => variant.options).filter(option => option.explanation).length,
    totalOptions: variants.reduce((sum, variant) => sum + variant.options.length, 0),
    variants,
  };
  const output = join(root, 'docs/rules/package-source-index.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ configurations: report.configurations, totalOptions: report.totalOptions,
    explicitDescriptions: report.explicitDescriptions, sourceMatchesCatalogue: true, output }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
