import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ordinaryRank, ordinaryMeldCandidates, ordinaryChiCompletions, ORDINARY_MELD_MODEL_VERSION, type OrdinaryMeldKind,
} from '../src/game/ordinary-melds.js';
import { decomposeCards } from '../src/game/combinations.js';

const cards = (codes: number[]) => codes.map((code, index) => ({ id: `c${index}`, code }));
const references = JSON.parse(readFileSync(new URL('../../../docs/rules/cases/ordinary-melds-v1.json', import.meta.url), 'utf8')) as {
  version: string;
  cases: { id: string; codes: number[]; kinds: OrdinaryMeldKind[]; expected: { kind: OrdinaryMeldKind; cardIds: string[] }[] }[];
};
assert.equal(references.version, ORDINARY_MELD_MODEL_VERSION);
for (const reference of references.cases) {
  test(`ordinary structure reference: ${reference.id}`, () => {
    const input = cards(reference.codes);
    const before = structuredClone(input);
    const result = ordinaryMeldCandidates(input, reference.kinds);
    assert.deepEqual(result.map(({ kind, cardIds }) => ({ kind, cardIds })), reference.expected);
    assert.deepEqual(input, before);
    assert.deepEqual(ordinaryMeldCandidates([...input].reverse(), [...reference.kinds].reverse()), result);
    assert.equal(new Set(result.map(group => group.id)).size, result.length);
    for (const group of result) assert.equal(new Set(group.cardIds).size, group.cardIds.length);
  });
}

test('all ordinary suits obey the independent complement table without changing rank into score', () => {
  const complements = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  for (let rank = 1; rank <= 13; rank++) {
    for (const suit of [1, 2, 3, 4]) {
      assert.equal(ordinaryRank(suit * 100 + rank), rank);
      for (const otherSuit of [1, 2, 3, 4]) {
        const hand = Array.from({ length: 13 }, (_, index) => ({ id: `rank-${index + 1}`, code: otherSuit * 100 + index + 1 }));
        assert.deepEqual(ordinaryChiCompletions(hand, { id: 'offered', code: suit * 100 + rank }),
          [{ sourceCardId: 'offered', companionCardId: `rank-${complements[rank - 1]}` }]);
      }
    }
  }
});

test('ordinary triples and quads enumerate distinct copies, not permutations', () => {
  const result = ordinaryMeldCandidates(cards([105, 205, 305, 405]), ['peng', 'gang']);
  assert.deepEqual(result.map(({ kind, cardIds }) => ({ kind, cardIds })), [
    { kind: 'peng', cardIds: ['c0', 'c1', 'c2'] },
    { kind: 'peng', cardIds: ['c0', 'c1', 'c3'] },
    { kind: 'peng', cardIds: ['c0', 'c2', 'c3'] },
    { kind: 'peng', cardIds: ['c1', 'c2', 'c3'] },
    { kind: 'gang', cardIds: ['c0', 'c1', 'c2', 'c3'] },
  ]);
  const sevens = ordinaryMeldCandidates(cards([107, 207, 307, 407]), ['chi', 'peng', 'gang']);
  assert.equal(sevens.filter(group => group.kind === 'chi').length, 6);
  assert.equal(sevens.filter(group => group.kind === 'peng').length, 4);
  assert.equal(sevens.filter(group => group.kind === 'gang').length, 1);
});

test('ordinary candidates feed exact cover without turning a three-card chi or concealed pong into a win', () => {
  const input = cards([105, 205, 309, 409]);
  const candidates = ordinaryMeldCandidates(input, ['chi']);
  const covers = decomposeCards(input.map(card => card.id), candidates, 2);
  const group = new Map(candidates.map(candidate => [candidate.id, candidate.cardIds]));
  assert.deepEqual(covers.map(cover => cover.map(id => group.get(id))), [
    [['c0', 'c2'], ['c1', 'c3']], [['c0', 'c3'], ['c1', 'c2']],
  ]);
  const invalidThree = cards([105, 205, 309]);
  assert.deepEqual(decomposeCards(invalidThree.map(card => card.id), ordinaryMeldCandidates(invalidThree, ['chi']), 1), []);
  const concealedPong = cards([105, 205, 305]);
  assert.deepEqual(decomposeCards(concealedPong.map(card => card.id), ordinaryMeldCandidates(concealedPong, ['chi']), 1), []);
});

test('offered-card choices preserve source identity, duplicate faces and one companion per choice', () => {
  const hand = cards([105, 105, 205, 409]);
  const before = structuredClone(hand);
  const offered = { id: 'source:9', code: 309 };
  assert.deepEqual(ordinaryChiCompletions(hand, offered), [
    { sourceCardId: 'source:9', companionCardId: 'c0' },
    { sourceCardId: 'source:9', companionCardId: 'c1' },
    { sourceCardId: 'source:9', companionCardId: 'c2' },
  ]);
  assert.deepEqual(hand, before);
  assert.deepEqual(ordinaryChiCompletions([], offered), []);
  assert.throws(() => ordinaryChiCompletions(hand, { id: 'c0', code: 309 }), { code: 'INVALID_COMBINATION_INPUT' });
});

test('special cards, invalid codes and duplicate physical IDs cannot silently enter ordinary matching', () => {
  for (const code of [0, 100, 114, 200, 414, 501, 1001, 1002, 1003, 1004, 1007, 1012, -1, 101.5, NaN, Infinity]) {
    assert.throws(() => ordinaryRank(code), { code: 'NON_ORDINARY_CARD' });
    assert.throws(() => ordinaryMeldCandidates(cards([105, code]), ['chi']), { code: 'NON_ORDINARY_CARD' });
    assert.throws(() => ordinaryChiCompletions(cards([105]), { id: 'offered', code }), { code: 'NON_ORDINARY_CARD' });
  }
  for (const input of [[{ id: '', code: 105 }], [{ id: 'same', code: 105 }, { id: 'same', code: 309 }]]) {
    assert.throws(() => ordinaryMeldCandidates(input, ['chi']), { code: 'INVALID_COMBINATION_INPUT' });
  }
  assert.throws(() => ordinaryMeldCandidates(cards([105, 309]), ['chi', 'chi']), { code: 'INVALID_COMBINATION_INPUT' });
  assert.throws(() => ordinaryMeldCandidates(cards([105, 309]), ['pair'] as unknown as OrdinaryMeldKind[]),
    { code: 'INVALID_COMBINATION_INPUT' });
});

test('candidate budgets fail explicitly and leave source cards untouched', () => {
  const input = cards([107, 207, 307, 407]);
  const before = structuredClone(input);
  assert.equal(ordinaryMeldCandidates(input, ['chi'], 6).length, 6);
  assert.throws(() => ordinaryMeldCandidates(input, ['chi'], 5), { code: 'COMBINATION_SEARCH_LIMIT' });
  assert.throws(() => ordinaryChiCompletions(input, { id: 'offered', code: 107 }, 3), { code: 'COMBINATION_SEARCH_LIMIT' });
  assert.deepEqual(input, before);
  for (const limit of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => ordinaryMeldCandidates(input, ['chi'], limit), { code: 'INVALID_COMBINATION_INPUT' });
    assert.throws(() => ordinaryChiCompletions(input, { id: 'offered', code: 107 }, limit), { code: 'INVALID_COMBINATION_INPUT' });
  }
});
