import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('ordinary structure reference is backed by the archived external text including its exposure restriction', async () => {
  const bytes = await readFile(new URL('../../../../work/research-next/wenda.html', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '80fc80c4869d1836236c03589050298b496b7c1aa8a85e060b2607b80a075835');
  const text = bytes.toString('utf8');
  for (const anchor of [
    '两张牌的数字加起来等于十四',
    '组合时黑红、黑黑、红红牌都可以进行',
    '3(4)张一样的牌可以形成一个组合',
    '碰牌组合必须放到桌面以后才算完成组合',
    '手中直接有四张数字一样的牌',
  ]) assert.ok(text.includes(anchor), anchor);
});

test('ordinary reference cases explicitly remain structures rather than regional win evidence', async () => {
  const reference = JSON.parse(await readFile(new URL('../../docs/rules/cases/ordinary-melds-v1.json', import.meta.url), 'utf8'));
  assert.equal(reference.version, 'dou14-ordinary-structures-v1');
  assert.match(reference.scope, /not regional legal actions or winning hands/);
  assert.equal(new Set(reference.cases.map(item => item.id)).size, reference.cases.length);
  assert.ok(reference.cases.some(item => item.id === 'peng-not-enabled-for-concealed-cover'));
  assert.ok(reference.cases.some(item => item.id === 'five-five-nine-only-two-pairs'));
});
