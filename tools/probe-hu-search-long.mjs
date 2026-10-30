#!/usr/bin/env node
// Temporary diagnostic probe (not release evidence). Focused long-running search for
// variants whose natural deals rarely produce an accepted win.
// Run with: pnpm --filter @dss/server exec tsx ../../tools/probe-hu-search-long.mjs 4:0 15000
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = value => JSON.stringify(value, null, 2) + '\n';

function rng(seed) {
  let state = seed >>> 0;
  return max => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return Math.floor(((value ^ (value >>> 14)) >>> 0) / 4294967296 * max);
  };
}

function terminal(snapshot) {
  const seen = new WeakSet();
  let found = null;
  const visit = node => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.phase === 'finished' && node.outcome?.reason) found = node.outcome.reason;
    for (const child of Object.values(node)) visit(child);
  };
  visit(snapshot);
  return found;
}

function winChoices(engine, snapshot, players) {
  const result = [];
  for (const userId of players) {
    let actions = [];
    try { actions = engine.interactions?.legalActions?.(snapshot, userId) ?? []; } catch { actions = []; }
    const view = (() => { try { return engine.view(structuredClone(snapshot), userId); } catch { return null; } })();
    const responses = view?.responses;
    for (const action of actions) {
      let win = action?.type === 'hu';
      if (!win && action?.type === 'respond' && action.choiceId && Array.isArray(responses?.options)) {
        const option = responses.options.find(item => item.id === action.choiceId);
        win = option?.type === 'hu' || option?.action?.type === 'hu';
      }
      if (win) result.push({ userId, action });
    }
  }
  return result;
}

function allActions(engine, snapshot, players) {
  const result = [];
  for (const userId of players) {
    let actions = [];
    try { actions = engine.interactions?.legalActions?.(snapshot, userId) ?? []; } catch { actions = []; }
    for (const action of actions) result.push({ userId, action });
  }
  if (result.length) return result;
  for (const userId of players) {
    const auto = engine.interactions?.autoPlay?.(snapshot, userId) ?? null;
    if (auto) result.push({ userId, action: auto.action });
  }
  return result;
}

function key(action) { return JSON.stringify(action); }

function play(engine, start, seed, beat = { steps: Infinity }, limit = 50) {
  const players = start.players.map(player => player.userId);
  const random = rng(seed);
  let best = null;
  const path = [];
  const dfs = snapshot => {
    const reason = terminal(snapshot);
    if (reason) {
      if (reason === 'hu' && path.length < beat.steps) best = { reason, steps: structuredClone(path) };
      return;
    }
    if (path.length >= limit) return;
    const wins = winChoices(engine, snapshot, players);
    if (wins.length) {
      const pick = wins[random(wins.length)];
      path.push(pick);
      let result;
      try { result = engine.apply(structuredClone(snapshot), pick.userId, structuredClone(pick.action)); }
      catch { path.pop(); return; }
      dfs(structuredClone(result.snapshot));
      path.pop();
      return;
    }
    const actions = allActions(engine, snapshot, players).filter(step => step.action?.type !== 'hu');
    const pool = actions.filter(step => ['respond', 'piao', 'begin', 'draw', 'discard'].includes(step.action?.type));
    const usable = pool.length ? pool : actions;
    const ordered = usable.map(step => ({ step, order: random(1000) })).sort((left, right) => left.order - right.order);
    for (const { step } of ordered) {
      path.push(step);
      let result;
      try { result = engine.apply(structuredClone(snapshot), step.userId, structuredClone(step.action)); }
      catch { path.pop(); continue; }
      const before = best;
      dfs(structuredClone(result.snapshot));
      path.pop();
      if (best && (!before || best.steps.length < before.steps.length)) return;
    }
  };
  dfs(structuredClone(start));
  return best;
}

async function main() {
  const wanted = process.argv[2] ?? '4:0';
  const maxAttempts = Number(process.argv[3] ?? 8000);
  const runtimeUrl = pathToFileURL(path.join(root, 'apps/server/src/runtime-engines.ts')).href;
  const { runtimeEngineEntries } = await import(runtimeUrl);
  const entry = runtimeEngineEntries.find(item => item.engine.variantKey === wanted);
  if (!entry) throw new Error(`Unknown variant ${wanted}`);
  const suite = JSON.parse(await readFile(path.join(root, entry.cases.path), 'utf8'));
  const seed = suite.cases[0];
  const players = seed.initialSnapshot.players.map(player => ({ userId: player.userId, seat: player.seat }));
  const rules = structuredClone(seed.initialSnapshot.rules);
  let best = null;
  let attempts = 0;
  for (; attempts < maxAttempts; attempts++) {
    const input = { players: structuredClone(players), ownerUserId: players[0].userId,
      rules: structuredClone(rules), number: 1, policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
    let snapshot;
    try { snapshot = entry.engine.create(input); } catch { continue; }
    const found = play(entry.engine, snapshot, 0x9e3779b9 ^ attempts, best ?? { steps: Infinity });
    if (found && (!best || found.steps.length < best.steps.length)) {
      best = found;
      process.stdout.write(JSON.stringify({ attempt: attempts, reason: found.reason, steps: found.steps.length }) + '\n');
      if (found.steps.length <= 24) break;
    }
  }
  const out = path.join(root, 'verification/raw/hu-search-long.json');
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, json({ schemaVersion: 1, kind: 'hu-search-long', variantKey: wanted, attempts, best }));
  process.stdout.write(json({ variantKey: wanted, attempts, best }) + '\n');
}

await main();
