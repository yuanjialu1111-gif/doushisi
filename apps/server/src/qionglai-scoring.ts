import {
  QIONGLAI_PACKAGE_FANS, QIONGLAI_SCORING_VERSION, QIONGLAI_FAN_SOURCES, type QionglaiSwitches,
} from '@dss/rules';
import { requireCondition } from './errors.js';
import { amount, beanUnits, unitsMoney } from './money.js';
import { qionglaiPatterns, type QionglaiFacts, type QionglaiPattern } from './qionglai-patterns.js';

export interface QionglaiScoringOptions extends QionglaiSwitches {
  qia20: 0 | 1;
  jinGouDiao: 0 | 1;
  anDui: 0 | 1;
  siGuiYi: 0 | 1;
  keSuHu: 0 | 1;
  maxFan: 4 | 5 | 6 | 99;
  chengFan: 0 | 1;
}

/** All facts come from the server's structural win evaluator, never a wire action.
 * legalWin excludes only the minimum-fan gate evaluated in this module.
 * Pair/quad identity, wildcard use and dragon recognition are NOT inferred here.
 */
export interface QionglaiScoringFacts extends QionglaiFacts {
  winSource: 'own-flip' | 'other';
  /** No incoming card is removed from an original-hand win. */
  concealedBeforeWin: number;
  exposedMeldKinds: readonly ('chi' | 'peng' | 'gang' | 'ba')[];
  concealedFourPairs: { dragons: number } | null;
  nonKongQuadCount: number;
}

export type QionglaiScorePattern = keyof typeof QIONGLAI_PACKAGE_FANS | QionglaiPattern;
export interface QionglaiScoreItem {
  pattern: QionglaiScorePattern;
  count: number;
  fanEach: number;
  fan: string;
  reference: string;
}
interface ScoreBase { version: typeof QIONGLAI_SCORING_VERSION; items: QionglaiScoreItem[] }
export type QionglaiScore =
  | ScoreBase & { status: 'not-winning'; reason: 'invalid-structure' | 'minimum-fan' }
  | ScoreBase & { status: 'unresolved'; missingRules: string[] }
  | ScoreBase & { status: 'scored'; totalFan: string; cappedFan: string; scoreUnits: string };

const toggles = ['qia20', 'jinGouDiao', 'anDui', 'siGuiYi', 'keSuHu',
  'qlTianDiHu', 'qlHongHeiHu', 'qlHongHei50'] as const;
const whole = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function validate(facts: QionglaiScoringFacts, options: QionglaiScoringOptions) {
  requireCondition(options != null && toggles.every(key => options[key] === 0 || options[key] === 1) &&
    [4, 5, 6, 99].includes(options.maxFan) && [0, 1].includes(options.chengFan),
  'INVALID_ROOM_OPTIONS', 'All Qionglai scoring options must be explicit.', 500);
  requireCondition(facts != null && typeof facts.legalWin === 'boolean' &&
    ['own-flip', 'other'].includes(facts.winSource) &&
    ['original-hand', 'ordinary-discard', 'other'].includes(facts.phase) &&
    (facts.sourceSeat === null || Number.isInteger(facts.sourceSeat) && facts.sourceSeat >= 1 && facts.sourceSeat <= 4) &&
    whole(facts.concealedBeforeWin) && whole(facts.nonKongQuadCount) &&
    Array.isArray(facts.exposedMeldKinds) && facts.exposedMeldKinds.every(kind => ['chi', 'peng', 'gang', 'ba'].includes(kind)) &&
    Array.isArray(facts.handAndMelds) && facts.handAndMelds.every(card =>
      card != null && ['ordinary', 'wild', 'bonus'].includes(card.kind)) &&
    (facts.concealedFourPairs === null || facts.concealedFourPairs != null &&
      whole(facts.concealedFourPairs.dragons) && facts.concealedFourPairs.dragons <= 2 &&
      facts.concealedBeforeWin === (facts.phase === 'original-hand' ? 8 : 7) && facts.exposedMeldKinds.length === 0),
  'INVALID_RULE_FACTS', 'Qionglai scoring needs complete, consistent server facts.', 500);
}

export function scoreQionglai(facts: QionglaiScoringFacts, options: QionglaiScoringOptions): QionglaiScore {
  validate(facts, options);
  const additions = qionglaiPatterns(facts, options);
  const items: QionglaiScoreItem[] = [];
  const base: ScoreBase = { version: QIONGLAI_SCORING_VERSION, items };
  if (!facts.legalWin) return { ...base, status: 'not-winning', reason: 'invalid-structure' };
  function add(pattern: keyof typeof QIONGLAI_PACKAGE_FANS, count = 1, reference: string = QIONGLAI_FAN_SOURCES.options) {
    if (count === 0) return;
    const fanEach = QIONGLAI_PACKAGE_FANS[pattern];
    items.push({ pattern, count, fanEach, fan: (BigInt(fanEach) * BigInt(count)).toString(), reference });
  }
  const missingRules: string[] = [];
  if (options.qia20 && facts.redPoints === 20) add('qia20');
  if (options.jinGouDiao && facts.concealedBeforeWin === 1 && facts.exposedMeldKinds.length > 0) {
    if (facts.exposedMeldKinds.every(kind => kind === 'peng')) add('jinGouDiao');
    else if (!facts.exposedMeldKinds.includes('chi')) missingRules.push('jinGouDiao:gang-or-ba');
  }
  if (options.anDui && facts.concealedFourPairs) {
    add('anDui');
    add('dragon', facts.concealedFourPairs.dragons);
  }
  if (options.siGuiYi) {
    if (facts.nonKongQuadCount === 1) add('siGuiYi');
    // The package gives one-quad +1, but does not specify repeated awards.
    if (facts.nonKongQuadCount > 1) missingRules.push('siGuiYi:multiple-quads');
  }
  for (const pattern of additions) {
    if (pattern === 'redHu' || pattern === 'blackHu') add(pattern, 1, QIONGLAI_FAN_SOURCES.colors);
    else missingRules.push(`${pattern}:fan`);
  }
  if (missingRules.length) return { ...base, status: 'unresolved', missingRules };
  let total = items.reduce((sum, item) => sum + BigInt(item.fan), 0n);
  if (total === 0n) {
    if (!options.keSuHu || facts.winSource !== 'own-flip') {
      return { ...base, status: 'not-winning', reason: 'minimum-fan' };
    }
    add('keSuHu');
    total = BigInt(QIONGLAI_PACKAGE_FANS.keSuHu);
  }
  const capped = options.maxFan === 99 || total <= BigInt(options.maxFan) ? total : BigInt(options.maxFan);
  return { ...base, status: 'scored', totalFan: total.toString(), cappedFan: capped.toString(),
    scoreUnits: (options.chengFan === 1 ? 2n ** capped : 1n + capped).toString() };
}

/** Only the declared red-point threshold, not the complete legal bao-jiao action. */
export function qionglaiBaoJiaoPointRequirement(
  redPointsBeforeWin: number, winningCardRedPoints: number, baoJiaoYingbao: 0 | 1,
): boolean {
  requireCondition(whole(redPointsBeforeWin) && whole(winningCardRedPoints), 'INVALID_RULE_FACTS', 'Invalid red-point facts.', 500);
  requireCondition(baoJiaoYingbao === 0 || baoJiaoYingbao === 1, 'INVALID_ROOM_OPTIONS', 'An explicit declaration mode is required.', 500);
  return BigInt(redPointsBeforeWin) + (baoJiaoYingbao === 0 ? BigInt(winningCardRedPoints) : 0n) >= 20n;
}

/** Amount for one score unit payment; this does not choose the liable players. */
export function qionglaiBaseAmount(score: QionglaiScore, baseBeans: string): string {
  requireCondition(score.version === QIONGLAI_SCORING_VERSION && score.status === 'scored',
    'QIONGLAI_SCORE_UNRESOLVED', 'Only a resolved winning score can be converted to beans.', 409);
  requireCondition(amount(baseBeans).gt(0), 'INVALID_AMOUNT', 'A positive host-entered base is required.');
  return unitsMoney(beanUnits(baseBeans) * BigInt(score.scoreUnits));
}
