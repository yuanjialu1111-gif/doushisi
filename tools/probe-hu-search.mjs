#!/usr/bin/env node
// Temporary diagnostic probe (not release evidence). It asks each production engine to deal
// many deterministic rounds and replays them with an "accept any available win" policy, so a
// genuine winning sequence can be frozen into the formal reference suite.
// Run with: pnpm --filter @dss/server exec tsx ../../tools/probe-hu-search.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = value => JSON.stringify(value, null, 2) + '\n';

function rngFactory(seed) {
  let state = seed >>> 0;
  return max => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return Math.floor(((value ^ (value >>> 14)) >>> 0) / 4294967296 * max);
  };
}

function terminalOf(snapshot) {
  const seen = new WeakSet();
  let found = null;
  const visit = node => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.phase === 'finished' && (node.outcome?.reason === 'hu' || node.outcome?.reason === 'draw')) {
      found = node.outcome.reason;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(snapshot);
  return found;
}

function isWinChoice(action) {
  if (action === null || typeof action !== 'object') return false;
  if (action.type === 'hu') return true;
  if (action.type === 'respond' && action.win === true) return true;
  return false;
}

// A respond action carries only a choiceId, so resolve it against the response window before
// deciding whether it represents a win.
function describeChoices(engine, snapshot, userId) {
  let actions = [];
  try { actions = engine.interactions?.legalActions?.(snapshot, userId) ?? []; }
  catch { actions = []; }
  const view = (() => { try { return engine.view(structuredClone(snapshot), userId); } catch { return null; } })();
  const responses = view && typeof view === 'object' ? view.responses : null;
  return actions.map(action => {
    let win = isWinChoice(action);
    if (!win && action?.type === 'respond' && action.choiceId && Array.isArray(responses?.options)) {
      const option = responses.options.find(item => item.id === action.choiceId);
      if (option && (option.type === 'hu' || option.action?.type === 'hu')) win = true;
    }
    return { userId, action, win };
  });
}

function rank(action) {
  const type = action?.type;
  if (type === 'respond') return action.choiceId === null ? 0 : 5;
  if (type === 'piao') return 1;
  if (type === 'begin') return 2;
  if (type === 'draw') return 3;
  if (type === 'discard') return 4;
  if (type === 'declare') return 90;
  if (type === 'hu') return 100;
  return 50;
}

function pick(engine, snapshot, players, acceptWin) {
  const choices = players.flatMap(userId => describeChoices(engine, snapshot, userId));
  if (acceptWin) {
    const win = choices.find(choice => choice.win);
    if (win) return { userId: win.userId, action: win.action };
  }
  const usable = choices.filter(choice => !choice.win).sort((left, right) => rank(left.action) - rank(right.action));
  if (usable.length) return { userId: usable[0].userId, action: usable[0].action };
  for (const userId of players) {
    const auto = engine.interactions?.autoPlay?.(snapshot, userId) ?? null;
    if (auto) return { userId, action: auto.action };
  }
  return null;
}

function replay(engine, snapshot, acceptWin, limit = 600) {
  const players = snapshot.players.map(player => player.userId);
  const steps = [];
  let current = structuredClone(snapshot);
  let reason = terminalOf(current);
  let failure = null;
  while (!reason && steps.length < limit) {
    const step = pick(engine, current, players, acceptWin);
    if (!step) { failure = 'NO_ACTION'; break; }
    let result;
    try { result = engine.apply(structuredClone(current), step.userId, structuredClone(step.action)); }
    catch (error) { failure = `${step.userId} ${JSON.stringify(step.action)}: ${error?.message ?? error}`; break; }
    steps.push({ userId: step.userId, action: step.action });
    current = structuredClone(result.snapshot);
    reason = terminalOf(current);
  }
  return { reason, steps, failure, snapshot: current };
}

async function main() {
  const runtimeUrl = pathToFileURL(path.join(root, 'apps/server/src/runtime-engines.ts')).href;
  const { runtimeEngineEntries } = await import(runtimeUrl);
  const report = { schemaVersion: 1, kind: 'hu-search-probe', generatedAt: new Date().toISOString(), variants: [] };
  for (const entry of runtimeEngineEntries) {
    const suite = JSON.parse(await readFile(path.join(root, entry.cases.path), 'utf8'));
    const seed = suite.cases[0];
    const baseRules = structuredClone(seed.initialSnapshot.rules);
    const players = seed.initialSnapshot.players.map(player => ({ userId: player.userId, seat: player.seat }));
    const record = { variantKey: entry.engine.variantKey, attempts: 0, hu: null, draw: null, failures: [] };
    let firstDraw = null;
    for (let attempt = 0; attempt < 240 && !record.hu; attempt++) {
      record.attempts++;
      const input = { players: structuredClone(players), ownerUserId: players[0].userId,
        rules: structuredClone(baseRules), number: 1,
        policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
      let snapshot;
      try { snapshot = entry.engine.create(input, undefined); }
      catch {
        try {
          const original = entry.engine.create.length;
          snapshot = original >= 2 ? entry.engine.create(input, undefined) : entry.engine.create(input);
        } catch (error) { record.failures.push(`create: ${error?.message ?? error}`); break; }
      }
      const played = replay(entry.engine, snapshot, true);
      if (played.reason === 'hu') record.hu = { attempt, steps: played.steps.length, sequence: played.steps };
      else if (!firstDraw) firstDraw = { attempt, steps: played.steps.length, reason: played.reason, failure: played.failure };
      if (played.failure) record.failures.push(played.failure);
    }
    record.draw = firstDraw;
    report.variants.push(record);
  }
  const outPath = path.join(root, 'verification/raw/hu-search-probe.json');
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, json(report));
  process.stdout.write(json(report.variants.map(variant => ({ variantKey: variant.variantKey, attempts: variant.attempts,
    huSteps: variant.hu?.steps ?? null, huAttempt: variant.hu?.attempt ?? null, draw: variant.draw,
    failures: variant.failures.slice(0, 2) }))) + '\n');
}

await main();
