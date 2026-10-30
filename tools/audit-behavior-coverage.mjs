#!/usr/bin/env node
// Read-only audit of the formal reference suites. It does not modify cases.json or release
// evidence; it records which cases actually finish a round and which coverage labels are only
// declared. Run with: pnpm --filter @dss/server exec tsx ../../tools/audit-behavior-coverage.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { beanUnits } from '../apps/server/src/money.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = value => JSON.stringify(value, null, 2) + '\n';

function readPath(value, expression) {
  const parts = expression.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function finiteInteger(value) { return Number.isInteger(value) && value >= 0; }

// Walks an arbitrary result object and collects only terminal evidence. The walker deliberately
// does not depend on a particular engine's snapshot layout.
function terminalFacts(value) {
  const facts = { finishedPhases: 0, outcomes: [], settlements: [], confirmedScores: [] };
  const seen = new WeakSet();
  const visit = (node, trail) => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.phase === 'finished') facts.finishedPhases++;
    if (node.outcome && typeof node.outcome === 'object' && !Array.isArray(node.outcome)) {
      if (node.outcome.reason === 'hu' || node.outcome.reason === 'draw') facts.outcomes.push(node.outcome);
    }
    if (Array.isArray(node.settlement)) facts.settlements.push(node.settlement);
    if (Array.isArray(node.confirmedScores)) facts.confirmedScores.push(...node.confirmedScores);
    for (const [key, child] of Object.entries(node)) visit(child, trail + '.' + key);
  };
  visit(value, '');
  return facts;
}

function postingTotals(postings) {
  let total = 0n;
  for (const posting of postings) {
    if (posting === null || typeof posting !== 'object' || typeof posting.amount !== 'string') return null;
    try { total += beanUnits(posting.amount); } catch { return null; }
  }
  return total;
}

function selectTerminalFacts(result) {
  const facts = terminalFacts(result);
  const settlement = facts.settlements.at(-1) ?? null;
  const scoreBatch = facts.confirmedScores.at(-1) ?? null;
  const outcome = facts.outcomes.at(-1) ?? null;
  const settlementTotal = settlement === null ? null : postingTotals(settlement);
  const confirmedTotal = scoreBatch?.postings === undefined ? null : postingTotals(scoreBatch.postings);
  return {
    finished: facts.finishedPhases > 0 || outcome !== null || settlement !== null,
    reason: outcome?.reason ?? null,
    settlement,
    confirmedPostings: scoreBatch?.postings ?? null,
    settlementMatchesConfirmed: settlement !== null && scoreBatch?.postings !== undefined &&
      isDeepStrictEqual(settlement, scoreBatch.postings),
    settlementZeroSum: settlementTotal === 0n,
    confirmedZeroSum: confirmedTotal === 0n,
  };
}

function pathExists(value, expression) {
  return readPath(value, expression) !== undefined;
}

function collectCoverageLabels(cases) {
  const labels = new Map();
  for (const item of cases) {
    const covers = Array.isArray(item.covers) ? item.covers.filter(value => typeof value === 'string') : [];
    if (!labels.has(item.id)) labels.set(item.id, new Set());
    for (const cover of covers) labels.get(item.id).add(cover);
  }
  return labels;
}

async function main() {
  const runtimeUrl = pathToFileURL(path.join(root, 'apps/server/src/runtime-engines.ts')).href;
  const { runtimeEngineEntries } = await import(runtimeUrl);
  const report = {
    schemaVersion: 1,
    kind: 'behavior-coverage-audit',
    generatedAt: new Date().toISOString(),
    productionRegistry: { entries: runtimeEngineEntries.length },
    variants: [],
    summary: {
      cases: 0, casesFinished: 0, casesHu: 0, casesDraw: 0, casesWithSettlement: 0,
      casesWithConfirmedScores: 0, casesSettlementMatchesConfirmed: 0,
      settlementNotZeroSum: 0, confirmedScoresNotZeroSum: 0,
      coverageLabels: 0, coverageLabelsWithTerminalOrSettlementAssertion: 0,
      optionLabels: 0, optionLabelsExercisedByInitialRules: 0,
      optionLabelsWithDirectAssertion: 0, optionLabelsWithoutBehaviorAssertion: 0,
    },
    blockers: [],
  };
  const allLabels = new Set();

  for (const entry of runtimeEngineEntries) {
    const variantKey = entry.engine.variantKey;
    const suitePath = path.join(root, entry.cases.path);
    const suite = JSON.parse(await readFile(suitePath, 'utf8'));
    const cases = Array.isArray(suite.cases) ? suite.cases : [];
    const variant = { variantKey, ruleVersion: entry.engine.version, cases: [], summary: {
      cases: cases.length, casesFinished: 0, casesHu: 0, casesDraw: 0, casesWithSettlement: 0,
      casesWithConfirmedScores: 0, casesSettlementMatchesConfirmed: 0,
    } };

    for (const item of cases) {
      if (typeof item.id !== 'string' || !item.id) { report.blockers.push({ variantKey, code: 'INVALID_CASE_ID' }); continue; }
      let snapshot = structuredClone(item.initialSnapshot);
      const caseFacts = {
        id: item.id,
        steps: 0,
        applied: 0,
        failures: 0,
        terminal: null,
        covers: Array.isArray(item.covers) ? item.covers.filter(value => typeof value === 'string') : [],
      };
      let terminal = null;
      const steps = Array.isArray(item.steps) ? item.steps : [];
      for (const step of steps) {
        caseFacts.steps++;
        if (typeof step.actorId !== 'string' || !step || typeof step.action === 'undefined') {
          caseFacts.failures++;
          continue;
        }
        let result;
        try { result = entry.engine.apply(structuredClone(snapshot), step.actorId, structuredClone(step.action)); }
        catch { caseFacts.failures++; continue; }
        caseFacts.applied++;
        const candidate = selectTerminalFacts(result);
        if (candidate.finished) terminal = candidate;
        const expectedSnapshot = result?.snapshot === undefined ? null : result.snapshot;
        if (expectedSnapshot !== null) snapshot = structuredClone(expectedSnapshot);
      }
      caseFacts.terminal = terminal;
      if (terminal?.finished) {
        variant.summary.casesFinished++;
        report.summary.casesFinished++;
        if (terminal.reason === 'hu') { variant.summary.casesHu++; report.summary.casesHu++; }
        if (terminal.reason === 'draw') { variant.summary.casesDraw++; report.summary.casesDraw++; }
        if (terminal.settlement !== null) { variant.summary.casesWithSettlement++; report.summary.casesWithSettlement++; }
        if (terminal.confirmedPostings !== null) { variant.summary.casesWithConfirmedScores++; report.summary.casesWithConfirmedScores++; }
        if (terminal.settlementMatchesConfirmed) { variant.summary.casesSettlementMatchesConfirmed++; report.summary.casesSettlementMatchesConfirmed++; }
        if (terminal.settlement !== null && !terminal.settlementZeroSum) report.summary.settlementNotZeroSum++;
        if (terminal.confirmedPostings !== null && !terminal.confirmedZeroSum) report.summary.confirmedScoresNotZeroSum++;
      }
      variant.cases.push(caseFacts);
      report.summary.cases++;
      for (const cover of caseFacts.covers) allLabels.add(cover);
    }

    report.variants.push(variant);
  }

  report.summary.coverageLabels = allLabels.size;
  for (const cover of allLabels) {
    const direct = report.variants.some(variant => variant.cases.some(item => item.covers.includes(cover) &&
      item.terminal && (item.terminal.finished || item.terminal.settlement !== null)));
    if (direct) report.summary.coverageLabelsWithTerminalOrSettlementAssertion++;
  }
  report.summary.optionLabels = [...allLabels].filter(value => value.startsWith('option:')).length;

  const reportPath = path.join(root, 'verification/raw/behavior-coverage.json');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, json(report));
  process.stdout.write(JSON.stringify({ summary: report.summary, blockers: report.blockers.length, output: 'verification/raw/behavior-coverage.json' }, null, 2) + '\n');
}

await main();
