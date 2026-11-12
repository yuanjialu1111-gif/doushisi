import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';
import { EngineRegistry, type RuleEngine, type EnginePlayer } from '../src/engines.js';
import { roundTransfers } from '../src/transfers.js';

interface State { players: EnginePlayer[]; accepted: string[]; finished: boolean }
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'response-test-only',
  evidence: { status: 'verified', referenceDigest: 'synthetic-response-window-infrastructure-only' },
  create: input => ({ players: input.players, accepted: [], finished: false }),
  apply(raw, userId) {
    const state = raw as State;
    const next = { ...state, accepted: [...state.accepted, userId] };
    next.finished = next.accepted.length === state.players.length;
    const batch = roundTransfers([{ id: 'payment', payerId: state.players[1]!.userId, payeeId: state.players[0]!.userId,
      numerator: '5', denominator: '10000000000000' }], state.players.map(p => p.userId));
    return { snapshot: next, events: [], ...(next.finished ? { confirmedScores: [{ eventId: 'final', ...batch }], settlement: batch.postings } : {}) };
  },
  view: raw => raw,
  interactions: {
    responseWindow: (raw, userId) => (raw as State).accepted.includes(userId) ? null : 'test-window:1',
    legalActions: (raw, userId) => (raw as State).accepted.includes(userId) ? [] : [{ respond: true }],
    deadlines: () => [], autoPlay: () => null,
  },
};

test('same-window replies accept the observed opening version, survive retry and replay exact transfers', async () => {
  const db = await openDatabase(); await migrate(db);
  const services = await createApp(db, { staticFiles: false, scheduler: false, engines: new EngineRegistry([fixture]) });
  const { auth, ledger, rooms, replays } = services;
  try {
    const admin = await auth.create('window_admin', 'test-password-only', 'beans_admin');
    const a = await auth.create('window_first', 'test-password-only'), b = await auth.create('window_second', 'test-password-only');
    for (const p of [a, b]) await ledger.adjust(admin, p.id, '10', 'Window test funding', 'fund-window-' + p.id);
    const room = await rooms.create(a, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
    await rooms.join(b, room.code); await rooms.ready(a, room.id, true);
    const started = await rooms.ready(b, room.id, true);
    assert.equal(started.responseWindow?.id, 'test-window:1');
    await assert.rejects(rooms.action(a, room.id, 'missing-decision', { respond: true }, 0, started.roundId!), { code: 'DECISION_REQUIRED' });
    await rooms.action(a, room.id, 'first-response', { respond: true }, 0, started.roundId!, undefined, 'test-window:1');
    await assert.rejects(rooms.action(a, room.id, 'second-new-response', { respond: true }, 1, started.roundId!, undefined, 'test-window:1'), { code: 'DECISION_EXPIRED' });
    await assert.rejects(rooms.action(b, room.id, 'wrong-window-response', { respond: true }, 0, started.roundId!, undefined, 'test-window:2'), { code: 'DECISION_EXPIRED' });
    // Recreate the service to ensure pending responses come from stored state.
    const restored = new (rooms.constructor as typeof import('../src/rooms.js').RoomService)(db, rooms.engines, services.policies);
    await restored.action(b, room.id, 'last-response', { respond: true }, 0, started.roundId!, undefined, 'test-window:1');
    await restored.action(b, room.id, 'last-response', { respond: true }, 0, started.roundId!, undefined, 'test-window:1');
    assert.equal(await ledger.balance(a.id), '10.000000000001');
    assert.equal(await ledger.balance(b.id), '9.999999999999');
    assert.equal((await replays.read(a, room.id, started.roundId!)).frames.at(-1)!.stateVersion, 2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM round_score_events')).rows[0]!.n, 1);
  } finally { await services.app.close(); await db.close(); }
});
