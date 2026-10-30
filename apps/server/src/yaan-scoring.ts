import { YAAN_INDEPENDENT_FANS, YAAN_PACKAGE_FANS, YAAN_SCORE_SOURCES, YAAN_SCORING_VERSION } from '@dss/rules';
import { requireCondition } from './errors.js';
import { amount, beanUnits, unitsMoney } from './money.js';

export interface YaanScoringOptions {
  qia20: 0 | 1;
  baoJiao: 0 | 1;
  anDui: 0 | 1;
  hongHei_50: 0 | 1;
  gangHua: 0 | 1;
  gangPao: 0 | 1;
  jinGouDiao: 0 | 1;
  chengFan: 0 | 1;
}

/** Internal facts from the eventual regional evaluator, not client declarations.
 * This component supplies amounts, not meld/dragon legality or fifty-point predicates.
 */
export interface YaanScoringFacts {
  legalWin: boolean;
  redPoints: number;
  baoJiao: boolean;
  concealedFourPairs: { dragons: number } | null;
  red50: boolean;
  black50: boolean;
  gangHua: boolean;
  gangPao: boolean;
  jinGouDiao: boolean;
  /** Effective matches after frozen server-only switches, absent from the create menu. */
  tianHu: boolean;
  diHu: boolean;
  redHu: boolean;
  blackHu: boolean;
}

export interface YaanScoreItem {
  pattern: keyof typeof YAAN_INDEPENDENT_FANS;
  count: number;
  fanEach: number;
  fan: string;
  reference: string;
}
interface ScoreBase { version: typeof YAAN_SCORING_VERSION; items: YaanScoreItem[] }
export type YaanScore =
  | ScoreBase & { status: 'not-winning'; reason: 'invalid-structure' }
  | ScoreBase & { status: 'unresolved'; missingRules: string[] }
  | ScoreBase & { status: 'scored'; totalFan: string; scoreUnits: string };

const switches = ['qia20', 'baoJiao', 'anDui', 'hongHei_50', 'gangHua', 'gangPao', 'jinGouDiao', 'chengFan'] as const;
const predicates = ['legalWin', 'baoJiao', 'red50', 'black50', 'gangHua', 'gangPao', 'jinGouDiao',
  'tianHu', 'diHu', 'redHu', 'blackHu'] as const;

export function scoreYaan(facts: YaanScoringFacts, options: YaanScoringOptions): YaanScore {
  requireCondition(options != null && switches.every(key => options[key] === 0 || options[key] === 1),
    'INVALID_ROOM_OPTIONS', 'All Yaan scoring options must be explicit.', 500);
  requireCondition(facts != null && predicates.every(key => typeof facts[key] === 'boolean') &&
    Number.isSafeInteger(facts.redPoints) && facts.redPoints >= 0 &&
    (facts.concealedFourPairs === null || facts.concealedFourPairs != null &&
      Number.isInteger(facts.concealedFourPairs.dragons) && facts.concealedFourPairs.dragons >= 0 &&
      facts.concealedFourPairs.dragons <= 2),
  'INVALID_RULE_FACTS', 'Yaan scoring requires complete server-evaluated facts.', 500);
  const items: YaanScoreItem[] = [];
  const base: ScoreBase = { version: YAAN_SCORING_VERSION, items };
  if (!facts.legalWin) return { ...base, status: 'not-winning', reason: 'invalid-structure' };
  function add(pattern: keyof typeof YAAN_INDEPENDENT_FANS, count = 1) {
    if (count === 0) return;
    const fanEach = YAAN_INDEPENDENT_FANS[pattern];
    items.push({ pattern, count, fanEach, fan: (BigInt(fanEach) * BigInt(count)).toString(),
      reference: YAAN_SCORE_SOURCES.options });
  }
  if (options.qia20 && facts.redPoints === 20) add('qia20');
  if (options.baoJiao && facts.baoJiao) add('baoJiao');
  if (options.anDui && facts.concealedFourPairs) {
    add('anDui');
    add('dragon', facts.concealedFourPairs.dragons);
  }
  if (options.hongHei_50 && facts.red50) add('red50');
  if (options.hongHei_50 && facts.black50) add('black50');
  for (const pattern of ['gangHua', 'gangPao', 'jinGouDiao'] as const) {
    if (options[pattern] && facts[pattern]) add(pattern);
  }
  for (const pattern of ['tianHu', 'diHu', 'redHu', 'blackHu'] as const) {
    if (facts[pattern]) add(pattern);
  }
  const total = items.reduce((sum, item) => sum + BigInt(item.fan), 0n);
  // Independent rule: a structurally valid Yaan win may score zero and is not
  // given Qionglai's own-flip three-fan exception.
  return { ...base, status: 'scored', totalFan: total.toString(),
    scoreUnits: (options.chengFan === 1 ? 2n ** total : 1n + total).toString() };
}

/** One formula amount only; no assumed payers, settlement or draw compensation. */
export function yaanBaseAmount(score: YaanScore, baseBeans: string): string {
  requireCondition(score?.version === YAAN_SCORING_VERSION && score.status === 'scored',
    'YAAN_SCORE_UNRESOLVED', 'Unresolved Yaan rules cannot produce a payment amount.', 409);
  requireCondition(amount(baseBeans).gt(0), 'INVALID_AMOUNT', 'A positive host-entered base is required.');
  return unitsMoney(beanUnits(baseBeans) * BigInt(score.scoreUnits));
}
