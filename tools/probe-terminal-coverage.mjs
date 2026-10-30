#!/usr/bin/env node
// Temporary diagnostic probe (not release evidence). It replays every production engine's
// first formal reference snapshot with a deterministic pass-first policy and reports whether
// the engine can be driven to a terminal outcome without choosing `hu`.
// Run with: pnpm --filter @dss/server exec tsx ../../tools/probe-terminal-coverage.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = value => JSON.stringify(value, null, 2) + '\n';

function findTerminal(snapshot) {
  const seen = new WeakSet();
  let found = null;
  const visit = node => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.phase === 'finished') {
      const reason = node.outcome?.reason;
      if (reason === 'hu' || reason === 'draw') found = { reason, node };
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(snapshot);
  return found;
}

function actionRank(action) {
  if (action === null || typeof action !== 'object') return 99;
  const type = action.type;
  if (type === 'respond') return action.choiceId === null ? 0 : 6;
  if (type === 'piao') return 1;
  if (type === 'begin') return 2;
  if (type === 'draw') return 3;
  if (type === 'discard') return 4;
  if (type === 'declare') return 90;
  if (type === 'hu') return 100;
  return 50;
}

function chooseStep(engine, snapshot, players) {
  const choices = [];
  for (const userId of players) {
    let actions = [];
    try { actions = engine.interactions?.legalActions?.(snapshot, userId) ?? []; }
    catch { actions = []; }
    for (const action of actions) choices.push({ userId, action, rank: actionRank(action) });
  }
  choices.sort((left, right) => left.rank - right.rank);
  const step = choices[0];
  if (step) return { userId: step.userId, action: step.action, via: 'legal' };
  for (const userId of players) {
    const auto = engine.interactions?.autoPlay?.(snapshot, userId) ?? null;
    if (auto) return { userId, action: auto.action, via: 'auto' };
  }
  return null;
}

async function main() {
  const runtimeUrl = pathToFileURL(path.join(root, 'apps/server/src/runtime-engines.ts')).href;
  const { runtimeEngineEntries } = await import(runtimeUrl);
  const report = { schemaVersion: 1, kind: 'terminal-coverage-probe', generatedAt: new Date().toISOString(), variants: [] };
  for (const entry of runtimeEngineEntries) {
    const suite = JSON.parse(await readFile(path.join(root, entry.cases.path), 'utf8'));
    const seed = suite.cases[0];
    const players = seed.initialSnapshot.players.map(player => player.userId);
    let snapshot = structuredClone(seed.initialSnapshot);
    const steps = [];
    let terminal = findTerminal(snapshot);
    let failure = null;
    for (let index = 0; index < 4000 && !terminal; index++) {
      const step = chooseStep(entry.engine, snapshot, players);
      if (!step) { failure = 'NO_ACTION'; break; }
      let result;
      try { result = entry.engine.apply(structuredClone(snapshot), step.userId, structuredClone(step.action)); }
      catch (error) { failure = `${step.userId} ${JSON.stringify(step.action)}: ${error?.message ?? error}`; break; }
      steps.push({ userId: step.userId, action: step.action, via: step.via });
      snapshot = structuredClone(result.snapshot);
      terminal = findTerminal(snapshot);
    }
    report.variants.push({ variantKey: entry.engine.variantKey, seedCaseId: seed.id, steps: steps.length,
      terminalReason: terminal?.reason ?? null, failure,
      settlement: terminal?.node?.outcome?.payments?.postings ?? terminal?.node?.settlement ?? null,
      sequence: terminal ? steps : undefined });
  }
  const outPath = path.join(root, 'verification/raw/terminal-coverage-probe.json');
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, json(report));
  process.stdout.write(json(report.variants.map(({ variantKey, steps, terminalReason, failure }) =>
    ({ variantKey, steps, terminalReason, failure }))) + '\n');
}

await main();
