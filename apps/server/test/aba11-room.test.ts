import test from 'node:test';
import assert from 'node:assert/strict';
import { ABA11_INDEPENDENT_VERSION, getDefaultOptions, supportsNewRoom } from '@dss/rules';
import { AuthService } from '../src/auth.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry } from '../src/engines.js';
import { createAbaEngine, type AbaEngineSnapshot } from '../src/game/aba-engine.js';
import type { AbaAction, viewAbaRound } from '../src/game/aba-round.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { ReplayService } from '../src/replays.js';
import { RoomService } from '../src/rooms.js';

type GameView = ReturnType<typeof viewAbaRound>;

// The same seed in every mode makes the matrix reproducible. The first deal
// contains a white face, so external-white coverage cannot pass by chance.
function seededRandom() {
  let seed = 0xaba110;
  return (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
}

function assertPrivateProjection(game: GameView, viewerId: string) {
  assert.equal(game.cards.reduce((sum, zone) => sum + zone.count, 0), 56);
  for (const zone of game.cards) {
    if (zone.id === 'deck' || zone.id.startsWith('hand:') && zone.ownerId !== viewerId) {
      assert.equal(zone.cards, undefined, `${zone.id} must not leak on reconnect or replay`);
    }
  }
}

function assertPhysicalSnapshot(snapshot: AbaEngineSnapshot, baipiType: number, quanXing: number) {
  assert.equal(snapshot.version, ABA11_INDEPENDENT_VERSION);
  assert.equal(snapshot.variantKey, '11:0');
  assert.equal(snapshot.rules.baipiType, baipiType);
  assert.equal(snapshot.rules.quanXing, quanXing);
  assert.equal((snapshot.rules.aba as { baipiType: number }).baipiType, baipiType);
  assert.equal(snapshot.cards.pack.length, 56);
  const whiteIds = snapshot.cards.pack.filter(card => card.code === 1003).map(card => card.id);
  assert.equal(whiteIds.length, 2);
  const placed = snapshot.cards.zones.flatMap(zone => zone.cards);
  assert.equal(placed.length, 56);
  assert.equal(new Set(placed).size, 56, 'No physical card may be duplicated');
  assert.deepEqual([...placed].sort(), snapshot.cards.pack.map(card => card.id).sort());
  if (baipiType !== 1) {
    for (const zone of snapshot.cards.zones.filter(zone => zone.id.startsWith('bonus:'))) {
      assert.ok(zone.cards.every(id => !whiteIds.includes(id)), 'External white faces are not bonus points');
    }
    if (snapshot.source?.kind === 'white') {
      assert.equal(snapshot.phase, 'response');
      const sourceId = snapshot.source.cardId!;
      assert.ok(whiteIds.includes(sourceId));
      const white = snapshot.cards.zones.find(zone => zone.id === `white:${snapshot.source!.userId}`);
      assert.ok(white?.cards.includes(sourceId), 'A revealed white stays in its public owner zone until resolution');
      assert.ok(snapshot.claims?.offers.length, 'A white response must offer real server actions');
      if (baipiType === 2) {
        assert.ok(snapshot.claims!.offers.every(offer => offer.userId === snapshot.source!.userId),
          'Owner-only white faces must never offer another player a claim');
      }
    }
  }
}

function assertWinningScoreFromPhysicalCards(snapshot: AbaEngineSnapshot) {
  const points = (id: string) => {
    const code = snapshot.cards.pack.find(card => card.id === id)!.code;
    if ([1001, 1002, 1003].includes(code)) return { red: 0, black: 0 };
    const rank = code % 100;
    const value = rank >= 11 ? 1 : rank;
    return [1, 3].includes(Math.floor(code / 100)) ? { red: value, black: 0 } : { red: 0, black: value };
  };
  const redSum = (ids: string[]) => ids.reduce((sum, id) => sum + points(id).red, 0);
  for (const winner of snapshot.outcome!.winners) {
    const melds = snapshot.players.find(player => player.userId === winner.userId)!.melds;
    const concealed = winner.win.concealedGroups.flat();
    const physical = [...concealed, ...melds.flatMap(meld => meld.cardIds)];
    assert.equal(new Set(physical).size, physical.length, 'One white face cannot occupy two winning positions');
    assert.equal(winner.win.redPoints, redSum(physical), 'Only actual ordinary red cards contribute red points');
    assert.equal(winner.win.blackPoints, physical.reduce((sum, id) => sum + points(id).black, 0),
      'Only actual ordinary black cards contribute black points');
    const bonus = snapshot.cards.zones.find(zone => zone.id === `bonus:${winner.userId}`)!.cards;
    const structureScore = redSum(concealed) * 10 + melds.reduce((sum, meld) => sum +
      redSum(meld.cardIds) * (['gang', 'ba'].includes(meld.kind) ? 15 : 10), 0) + bonus.length * 100;
    assert.equal(winner.win.structureScore, structureScore, 'External whites cannot add fictitious structure or bonus points');
  }
}

for (const baipiType of [1, 2, 3] as const) for (const quanXing of [0, 1] as const) {
test(`11:0 baipiType=${baipiType} quanXing=${quanXing} opens, freezes, reconnects and completes four real rounds`, async () => {
  const db = await openDatabase();
  try {
    await migrate(db);
    const auth = new AuthService(db), ledger = new LedgerService(db);
    const admin = await auth.create('aba11_room_admin', 'test-password-only', 'beans_admin');
    const players = [await auth.create('aba11_room_one', 'test-password-only'),
      await auth.create('aba11_room_two', 'test-password-only'), await auth.create('aba11_room_three', 'test-password-only'),
      await auth.create('aba11_room_four', 'test-password-only')];
    for (const player of players) await ledger.adjust(admin, player.id, '500', 'Aba 11 room test', `aba11-room-${player.id}`);
    const random = seededRandom();
    const registry = () => new EngineRegistry([createAbaEngine('aba11-room-production-test', random, '11:0')]);
    // Freeze the clock, not the game: all decisions still run through RoomService
    // with real state versions, response IDs, durable events and settlement.
    const now = () => 1_800_000_000_000;
    let rooms = new RoomService(db, registry(), new PolicyService(db), now);
    rooms.opensVariant = supportsNewRoom; // 其他地区代码留着不启用（DEC-20261101-四川斗十四），测试打开跑它的规则。
    const defaults = getDefaultOptions('11:0');
    assert.equal(defaults.baipiType, 1);
    assert.equal(defaults.quanXing, 1);
    assert.equal(defaults.diHu, 0);
    assert.equal(defaults.cheLong, 1);
    const options = { ...defaults, baseBeans: '0.125', baipiType, quanXing, gameNum: 4, playerNum: 4 };
    const room = await rooms.create(players[0]!, '11:0', options);
    assert.equal(room.state, 'waiting');
    assert.equal(room.variantKey, '11:0');
    assert.equal(room.ruleVersion, ABA11_INDEPENDENT_VERSION);
    assert.equal(room.rules.aba.rulesVersion, ABA11_INDEPENDENT_VERSION);
    assert.equal(room.rules.baipiType, baipiType);
    assert.equal(room.rules.aba.baipiType, baipiType);
    assert.equal(room.rules.quanXing, quanXing);
    assert.equal(room.baseBeans, '0.125');
    assert.equal(room.baseBeansSource, 'manual');
    const frozenRules = structuredClone(room.rules);
    // Neither the caller's mutable options nor a returned view can rewrite the
    // persisted configuration used by later rounds and reconnects.
    Object.assign(options, { baipiType: baipiType === 1 ? 3 : 1, quanXing: 1 - quanXing, baseBeans: '9' });
    room.rules.baipiType = 99;
    room.rules.aba.baipiType = 99;
    room.rules.quanXing = 99;
    assert.deepEqual((await rooms.view(room.id, players[0]!.id)).rules, frozenRules);
    await rooms.join(players[1]!, room.code);
    await rooms.join(players[2]!, room.code);
    await rooms.join(players[3]!, room.code);
    await rooms.ready(players[0]!, room.id, true);
    await rooms.ready(players[1]!, room.id, true);
    await rooms.ready(players[2]!, room.id, true);
    let view = await rooms.ready(players[3]!, room.id, true);
    assert.equal(view.state, 'playing');
    const started = new Set<string>();
    const whiteWindows = new Set<string>();
    const whitePasses = new Set<string>();
    const whiteClaims = new Set<string>();
    const sharedWhiteOffers = new Set<string>();
    const sharedWhiteClaims = new Set<string>();
    const reconnected = new Set<string>();
    const partialReconnected = new Set<string>();
    const reconnect = async () => {
      const previous = await Promise.all(players.map(player => rooms.view(room.id, player.id)));
      rooms = new RoomService(db, registry(), new PolicyService(db), now);
      rooms.opensVariant = supportsNewRoom;
      for (const [index, player] of players.entries()) {
        const current = await rooms.current(player.id);
        assert.deepEqual(current, previous[index], 'Recreated services must restore the exact durable player view');
        assert.deepEqual(await rooms.join(player, room.code), current, 'An existing member may re-enter a playing room');
        assertPrivateProjection(current!.game as GameView, player.id);
      }
    };
    let guard = 0;
    while (view.state !== 'closed') {
      assert.ok(guard++ < 1500, `Aba 11 room must terminate: mode=${baipiType}, quanXing=${quanXing}, round=${view.currentRound}`);
      if (view.state === 'between_rounds') {
        await rooms.ready(players[0]!, room.id, true);
        await rooms.ready(players[1]!, room.id, true);
        await rooms.ready(players[2]!, room.id, true);
        view = await rooms.ready(players[3]!, room.id, true);
        continue;
      }
      assert.deepEqual(view.rules, frozenRules);
      assert.ok(view.roundId);
      if (!started.has(view.roundId)) {
        started.add(view.roundId);
        await reconnect();
      }
      const row = (await db.query('SELECT snapshot FROM rounds WHERE id=$1', [view.roundId])).rows[0]!;
      const snapshot = row.snapshot as AbaEngineSnapshot;
      assertPhysicalSnapshot(snapshot, baipiType, quanXing);
      const whiteWindow = snapshot.source?.kind === 'white' ? snapshot.claims!.id : null;
      if (whiteWindow) {
        whiteWindows.add(whiteWindow);
        if (snapshot.claims!.offers.some(offer => offer.userId !== snapshot.source!.userId)) {
          sharedWhiteOffers.add(whiteWindow);
        }
        if (!reconnected.has(whiteWindow)) {
          await reconnect();
          reconnected.add(whiteWindow);
        }
      }
      const turn = await Promise.all(players.map(async player => ({ player, view: await rooms.view(room.id, player.id) })));
      const active = turn.find(item => item.view.responseWindow !== null) ??
        turn.find(item => Array.isArray(item.view.legalActions) && item.view.legalActions.length > 0);
      assert.ok(active, 'Aba 11 room must expose an action or response window');
      const legal = active.view.legalActions as AbaAction[];
      // Round one passes white windows; later rounds consume an offered white
      // meld. Both paths must preserve the pack and finish through the ledger.
      const claim = whiteWindow && view.currentRound > 1
        ? legal.find(candidate => candidate.type === 'respond' && candidate.choiceId !== null) : undefined;
      const action = claim ?? legal.find(candidate => candidate.type === 'respond' && candidate.choiceId === null)
        ?? legal.find(candidate => candidate.type === 'hu') ?? legal.find(candidate => candidate.type === 'discard') ?? legal[0]!;
      assert.ok(action);
      const beforeVersion = active.view.stateVersion!;
      const beforeRoundId = active.view.roundId!;
      view = await rooms.action(active.player, room.id, `aba11-room-${guard}`, action, beforeVersion, beforeRoundId,
        undefined, active.view.responseWindow ? action.decisionId : undefined);
      if (whiteWindow) {
        const after = (await db.query('SELECT snapshot FROM rounds WHERE id=$1', [beforeRoundId])).rows[0]!.snapshot as AbaEngineSnapshot;
        assertPhysicalSnapshot(after, baipiType, quanXing);
        const whiteId = snapshot.source!.cardId!;
        const claimedZone = after.cards.zones.find(zone => zone.id.startsWith('melds:') && zone.cards.includes(whiteId));
        const whiteWinner = after.outcome?.winners.find(winner => winner.win.wildcardUses.some(use => use.cardId === whiteId));
        if (claimedZone || whiteWinner) {
          whiteClaims.add(whiteWindow);
          if ((claimedZone?.ownerId ?? whiteWinner!.userId) !== snapshot.source!.userId) sharedWhiteClaims.add(whiteWindow);
        } else if (after.cards.zones.find(zone => zone.id === 'discards')!.cards.includes(whiteId)) {
          whitePasses.add(whiteWindow);
        }
        if (after.claims?.id === whiteWindow && after.claims.replies.length > 0 && !partialReconnected.has(whiteWindow)) {
          await reconnect();
          partialReconnected.add(whiteWindow);
        }
      }
      if (view.state === 'playing') assert.equal(view.stateVersion, beforeVersion + 1);
    }
    assert.equal(view.currentRound, 4);
    assert.equal(started.size, 4);
    assert.deepEqual(view.rules, frozenRules);
    if (baipiType !== 1) {
      assert.ok(whiteWindows.size > 0, 'The real room must exercise an external white response');
      assert.ok(whitePasses.size > 0, 'The real room must exercise passing an external white');
      assert.ok(whiteClaims.size > 0, 'The real room must exercise claiming an external white');
    }
    if (baipiType === 2) assert.equal(sharedWhiteOffers.size, 0);
    if (baipiType === 3) {
      assert.ok(sharedWhiteOffers.size > 0, 'Shared white faces must offer another player a legal response');
      assert.ok(sharedWhiteClaims.size > 0, 'Another player must actually consume a shared white');
      assert.ok(partialReconnected.size > 0, 'Reconnect must preserve already-submitted replies in a shared window');
    }
    const settlements = await db.query("SELECT round_id,count(*)::int AS n FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement' GROUP BY round_id", [room.id]);
    assert.equal(settlements.rows.length, 4);
    assert.ok(settlements.rows.every(row => row.n === 1), 'Each real round settles exactly once');
    const rounds = await db.query('SELECT id,number,state,snapshot,initial_snapshot,next_round_context,end_reason FROM rounds WHERE room_id=$1 ORDER BY number', [room.id]);
    assert.equal(rounds.rows.length, 4);
    assert.deepEqual(rounds.rows.map(round => round.number), [1, 2, 3, 4]);
    const replays = new ReplayService(db, registry());
    for (const [index, round] of rounds.rows.entries()) {
      assert.equal(round.state, 'settled');
      assert.equal(round.end_reason, 'completed', 'No mocked or dissolved rounds count as completion');
      assert.equal(round.next_round_context?.version, ABA11_INDEPENDENT_VERSION);
      assert.equal(round.next_round_context.completedRound, round.number);
      if (index > 0) assert.equal(round.initial_snapshot.dealerId, rounds.rows[index - 1]!.next_round_context.nextDealerId);
      assertPhysicalSnapshot(round.initial_snapshot as AbaEngineSnapshot, baipiType, quanXing);
      assertPhysicalSnapshot(round.snapshot as AbaEngineSnapshot, baipiType, quanXing);
      assertWinningScoreFromPhysicalCards(round.snapshot as AbaEngineSnapshot);
      const replay = await replays.read(players[0]!, room.id, round.id);
      assert.equal(replay.variantKey, '11:0');
      assert.equal(replay.ruleVersion, ABA11_INDEPENDENT_VERSION);
      assert.deepEqual(replay.rules, frozenRules);
      assert.ok(replay.frames.length > 1, 'Replay must rebuild actual player actions, not just an initial frame');
      assert.equal((replay.frames.at(-1)!.game as GameView).phase, 'finished');
      for (const frame of replay.frames) assertPrivateProjection(frame.game as GameView, players[0]!.id);
    }
    for (const player of players) assert.equal(await rooms.current(player.id), null);
  } finally { await db.close(); }
});
}
