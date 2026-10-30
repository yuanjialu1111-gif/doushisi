import test from 'node:test';
import assert from 'node:assert/strict';
import { ABA_INDEPENDENT_VERSIONS, getDefaultOptions } from '@dss/rules';
import { evaluateAbaWin, type AbaHand, type AbaWinContext } from '../src/game/aba-win.js';

const VARIANTS = ['9:0', '10:0', '11:0', '12:0'] as const;
const PLAYER_COUNTS = [2, 3, 4] as const;
const THRESHOLDS = [300, 400, 500] as const;

type VariantKey = keyof typeof ABA_INDEPENDENT_VERSIONS;
type Threshold = typeof THRESHOLDS[number];

// Four sum-14 pairs in every hand make the concealed structure independently checkable.
// The pair scores are the red-face values multiplied by ten: 14+14+2+0, 14+14+4+8, 14+14+14+8.
const EXACT_THRESHOLD: Record<Threshold, readonly number[]> = {
  300: [104, 110, 105, 109, 101, 113, 207, 407],
  400: [104, 110, 105, 109, 103, 111, 108, 206],
  500: [104, 110, 105, 109, 107, 307, 308, 206],
};

// Each legal hand is exactly ten structure points below the named threshold.
const BELOW_THRESHOLD: Record<Threshold, readonly number[]> = {
  300: [104, 110, 105, 109, 101, 213, 207, 407],
  400: [104, 110, 105, 109, 107, 207, 103, 111],
  500: [104, 110, 105, 109, 108, 106, 307, 207],
};

// Each legal hand is exactly ten structure points above the named threshold.
const ABOVE_THRESHOLD: Record<Threshold, readonly number[]> = {
  300: [104, 110, 105, 109, 102, 112, 207, 407],
  400: [104, 110, 105, 109, 107, 207, 106, 208],
  500: [104, 110, 108, 106, 107, 307, 309, 205],
};

// Red points total 580, but no four-group or four-pair structure exists.
const ILLEGAL_HIGH_RED = [108, 109, 110, 308, 309, 310, 101, 103] as const;

// High red faces arranged as runs that cannot form four legal groups or pairs.
// They must fail structure validation rather than be rescued by their raw score.
const ILLEGAL_RED_RUNS = [101, 102, 103, 104, 110, 111, 112, 310] as const;

function rulesFor(variantKey: VariantKey, playerNum: number, huRedScore: Threshold) {
  return {
    ...getDefaultOptions(variantKey),
    playerNum,
    huRedScore,
    baipiType: 1,
    aba: { rulesVersion: ABA_INDEPENDENT_VERSIONS[variantKey] },
  };
}

function hand(codes: readonly number[]): AbaHand {
  return {
    concealed: codes.map((code, index) => ({ id: `aba-matrix-${index}-${code}`, code })),
    melds: [],
    bonus: [],
  };
}

function originalHandContext(): AbaWinContext {
  return {
    winnerSeat: 1,
    dealerSeat: 1,
    source: 'original-hand',
    sourceSeat: null,
    incomingCardId: null,
    discardCount: 0,
  };
}

for (const variantKey of VARIANTS) {
  for (const playerNum of PLAYER_COUNTS) {
    for (const threshold of THRESHOLDS) {
      test(`ABA ${variantKey}, ${playerNum} players, threshold ${threshold}: legal boundary matrix`, () => {
        const context = originalHandContext();

        const below = evaluateAbaWin(hand(BELOW_THRESHOLD[threshold]), context,
          rulesFor(variantKey, playerNum, threshold), variantKey);
        assert.equal(below.status, 'not-winning', 'a legal hand below the threshold must not win');
        assert.equal(below.reason, 'shape', 'a threshold miss must be reported as a shape failure');

        const exact = evaluateAbaWin(hand(EXACT_THRESHOLD[threshold]), context,
          rulesFor(variantKey, playerNum, threshold), variantKey);
        assert.equal(exact.status, 'winning', 'a legal hand at the threshold must win');
        if (exact.status === 'winning') assert.equal(exact.structureScore, threshold);

        const above = evaluateAbaWin(hand(ABOVE_THRESHOLD[threshold]), context,
          rulesFor(variantKey, playerNum, threshold), variantKey);
        assert.equal(above.status, 'winning', 'a legal hand above the threshold must win');
        if (above.status === 'winning') assert.equal(above.structureScore, threshold + 10);
      });

      test(`ABA ${variantKey}, ${playerNum} players, threshold ${threshold}: red points cannot replace structure`, () => {
        const highRed = evaluateAbaWin(hand(ILLEGAL_HIGH_RED), originalHandContext(),
          rulesFor(variantKey, playerNum, threshold), variantKey);
        assert.equal(highRed.status, 'not-winning');
        assert.equal(highRed.reason, 'shape');
        assert.ok(highRed.redScore >= threshold, 'the rejected hand must still have enough red score');

        const redRuns = evaluateAbaWin(hand(ILLEGAL_RED_RUNS), originalHandContext(),
          rulesFor(variantKey, playerNum, threshold), variantKey);
        assert.equal(redRuns.status, 'not-winning');
        assert.equal(redRuns.reason, 'shape');
      });
    }
  }

  for (const threshold of THRESHOLDS) {
    test(`ABA ${variantKey}, threshold ${threshold}: score and ratio do not vary by player count`, () => {
      const results = PLAYER_COUNTS.map(playerNum => {
        const result = evaluateAbaWin(hand(EXACT_THRESHOLD[threshold]), originalHandContext(),
          rulesFor(variantKey, playerNum, threshold), variantKey);
        assert.equal(result.status, 'winning');
        return result;
      });
      const reference = results[0]!;
      for (const result of results) {
        assert.equal(result.structureScore, reference.structureScore);
        assert.deepEqual(result.scoreRatio, reference.scoreRatio);
      }
      assert.equal(reference.structureScore, threshold);
      assert.deepEqual(reference.scoreRatio, { numerator: String(threshold * 8), denominator: '1000' });
    });
  }
}
