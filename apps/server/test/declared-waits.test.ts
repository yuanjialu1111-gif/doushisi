import test from 'node:test';
import assert from 'node:assert/strict';
import { declaredWaitMatches } from '../src/game/score-region-round.js';

test('a declared win only matches the locked wait faces', () => {
  assert.equal(declaredWaitMatches([108, 308], 108), true);
  assert.equal(declaredWaitMatches([108, 308], 408), false);
  assert.equal(declaredWaitMatches([], 108), false);
  assert.equal(declaredWaitMatches(null, 108), false);
  assert.equal(declaredWaitMatches([108], null), false);
});
