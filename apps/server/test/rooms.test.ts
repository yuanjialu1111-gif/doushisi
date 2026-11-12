import { supportsNewRoom } from '@dss/rules';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, type Actor } from '../src/auth.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine, type RoundInput } from '../src/engines.js';
import { appendOperation, LedgerService } from '../src/ledger.js';
import { Decimal } from '../src/money.js';
import { PolicyService } from '../src/policies.js';
import { RoomService, roundFee } from '../src/rooms.js';
import { getFixtureOptions as getDefaultOptions } from './fixture-options.js';

const code = (expected: string) => (error: unknown) => {
  assert.equal((error as { code?: string }).code, expected);
  return true;
};

interface TestSnapshot { players: EnginePlayer[]; number: number; actions: number; finished: boolean }
interface TestAction { type: 'touch' | 'settle' | 'invalid_sum' | 'missing_player'; delta?: string }

// This fixture verifies room and accounting infrastructure, not any regional card rule.
// It is deliberately defined in this test file and never registered by production code.
const fixtureEngine: RuleEngine = {
  variantKey: '4:0', version: 'test-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'test-only-infrastructure-fixture-no-gameplay-evidence' },
  create(input: RoundInput): TestSnapshot { return { players: input.players, number: input.number, actions: 0, finished: false }; },
  apply(raw, userId, rawAction) {
    const snapshot = raw as TestSnapshot;
    const action = rawAction as TestAction;
    assert.ok(snapshot.players.some(player => player.userId === userId));
    const next = { ...snapshot, actions: snapshot.actions + 1 };
    if (action.type === 'touch') return { snapshot: next, events: [{ type: 'touched' }] };
    const delta = new Decimal(action.delta ?? '0.1');
    const settlement = snapshot.players.map((player, index) => ({ userId: player.userId, amount: index === 0 ? delta.toFixed() : delta.negated().toFixed() }));
    if (action.type === 'invalid_sum') settlement[1]!.amount = '0';
    if (action.type === 'missing_player') settlement.pop();
    return { snapshot: { ...next, finished: true }, events: [{ type: 'settled' }], confirmedScores: [{ eventId: 'terminal-score', postings: settlement }], settlement };
  },
  view(raw, userId) { const state = raw as TestSnapshot; return { number: state.number, actions: state.actions, viewer: userId }; },
};

test('room fees, authoritative settlement and recovery invariants against PGlite', async t => {
  const db = await openDatabase();
  try {
    await migrate(db);
    const auth = new AuthService(db);
    const ledger = new LedgerService(db);
    const policies = new PolicyService(db);
    const engines = new EngineRegistry([fixtureEngine]);
    const rooms = new RoomService(db, engines, policies);
    rooms.opensVariant = supportsNewRoom; // 其他地区代码留着不启用（DEC-20261101-四川斗十四），测试打开跑它的规则。
    const beans = await auth.create('beans_roomtests', 'test-password-only', 'beans_admin');
    const dealer = await auth.create('dealer_roomtests', 'test-password-only', 'deal_admin');
    let serial = 0;
    async function pair(balances = ['10', '10'], feeMode = 2, gameNum = 4) {
      const prefix = `roomtest_${++serial}`;
      const players = [await auth.create(`${prefix}_first`, 'test-password-only'), await auth.create(`${prefix}_second`, 'test-password-only')];
      for (let i = 0; i < players.length; i++) if (balances[i] !== '0') await ledger.adjust(beans, players[i]!.id, balances[i]!, 'test opening balance', `${prefix}-opening-${i}`);
      const room = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum, useCardType: feeMode });
      await rooms.join(players[1]!, room.code);
      return { players, room };
    }
    async function start(players: Actor[], roomId: string) {
      await rooms.ready(players[0]!, roomId, true);
      return rooms.ready(players[1]!, roomId, true);
    }
    async function operationCount(roomId: string, kind: string) {
      return (await db.query('SELECT count(*)::integer AS count FROM ledger_operations WHERE room_id=$1 AND kind=$2', [roomId, kind])).rows[0]!.count;
    }

    await t.test('房费每局结算时由大赢家付：赢够 20 倍底分扣 4 倍底分，不够不扣，开局不扣（DEC-20261112-大赢家付房费）；S3-AC4 同桌打完不自动加好友', async () => {
      const { players, room } = await pair();
      assert.equal(await ledger.balance(players[0]!.id), '10');
      for (let round = 1; round <= 4; round++) {
        const playing = await start(players, room.id);
        assert.equal(playing.currentRound, round);
        assert.equal(playing.state, 'playing');
        // 开局不扣：底分 0.1 每局赢 0.1，不够 2（20 倍底分），整场都不扣房费。
        assert.equal(await operationCount(room.id, 'room_fee'), 0);
        const result = await rooms.action(players[0]!, room.id, `aa-settlement-${round}`, { type: 'settle', delta: '0.1' }, playing.stateVersion!, playing.roundId!);
        assert.equal(result.state, round === 4 ? 'closed' : 'between_rounds');
      }
      assert.equal(await ledger.balance(players[0]!.id), '10.4');
      assert.equal(await ledger.balance(players[1]!.id), '9.6');
      assert.equal(await operationCount(room.id, 'round_settlement'), 4);
      assert.equal(await operationCount(room.id, 'room_fee'), 0);
      const scores = (await rooms.view(room.id, players[0]!.id)).members;
      assert.equal(new Decimal(scores[0]!.score).toFixed(), '0.4');
      assert.equal(new Decimal(scores[1]!.score).toFixed(), '-0.4');
      const friends = await db.query('SELECT user_id,friend_id FROM friends WHERE user_id = $1 OR user_id = $2', [players[0]!.id, players[1]!.id]);
      assert.equal(friends.rows.length, 0, 'S3-AC4 同桌打完不自动加好友');
      assert.equal(await rooms.current(players[0]!.id), null);
      // 赢正好 2（20 倍底分）扣 0.4（4 倍底分），只扣赢家，输赢分数不含房费；房主付、AA 都一样。
      for (const feeMode of [2, 1]) {
        const big = await pair(['10', '10'], feeMode);
        const playing = await start(big.players, big.room.id);
        await rooms.action(big.players[1]!, big.room.id, `big-win-${feeMode}`, { type: 'settle', delta: '2' }, playing.stateVersion!, playing.roundId!);
        assert.equal(await ledger.balance(big.players[0]!.id), '11.6');
        assert.equal(await ledger.balance(big.players[1]!.id), '8');
        const fees = await db.query("SELECT e.user_id,e.amount::text FROM ledger_entries e JOIN ledger_operations o ON e.operation_id=o.id WHERE o.room_id=$1 AND o.kind='room_fee'", [big.room.id]);
        assert.deepEqual(fees.rows.map(row => [row.user_id, new Decimal(row.amount).toFixed()]), [[big.players[0]!.id, '-0.4']]);
        assert.equal(new Decimal((await rooms.view(big.room.id, big.players[0]!.id)).members[0]!.score).toFixed(), '2');
      }
    });

    await t.test('上线前开局已经扣过房费的房间，这一场打完不再收大赢家房费', async () => {
      const legacy = await pair(['10', '10']);
      await db.transaction(tx => appendOperation(tx, { key: `room-fee:${legacy.room.id}`, kind: 'room_fee', roomId: legacy.room.id, reason: 'Room creation fee',
        postings: legacy.players.map(player => ({ userId: player.id, amount: '-1' })) }));
      const playing = await start(legacy.players, legacy.room.id);
      await rooms.action(legacy.players[0]!, legacy.room.id, 'legacy-big-win', { type: 'settle', delta: '2' }, playing.stateVersion!, playing.roundId!);
      assert.equal(await ledger.balance(legacy.players[0]!.id), '11');
      assert.equal(await operationCount(legacy.room.id, 'room_fee'), 1);
    });

    await t.test('房费按底分算、并列大赢家平摊（DEC-20261112-大赢家付房费）', () => {
      const won = (amounts: string[]) => amounts.map((amount, index) => ({ userId: `u${index}`, amount }));
      const fee = (base: string, amounts: string[]) => roundFee(base, won(amounts)).map(item => [item.userId, new Decimal(item.amount).toFixed()]);
      assert.deepEqual(fee('1', ['20', '-10', '-10']), [['u0', '-4']]);
      assert.deepEqual(fee('1', ['19.99', '-10', '-9.99']), []);
      assert.deepEqual(fee('2', ['40', '-40']), [['u0', '-8']]);
      assert.deepEqual(fee('2', ['39', '-39']), []);
      assert.deepEqual(fee('5', ['-50', '150', '-100']), [['u1', '-20']]);
      assert.deepEqual(fee('5', ['99', '-99']), []);
      assert.deepEqual(fee('3', ['60', '-60']), [['u0', '-12']]);
      assert.deepEqual(fee('1', ['30', '30', '-60']), [['u0', '-2'], ['u1', '-2']]);
      assert.deepEqual(fee('1', ['20', '20', '20', '-60']), [['u0', '-1.34'], ['u1', '-1.33'], ['u2', '-1.33']]);
      assert.deepEqual(fee('1', ['0', '0']), []);
    });

    await t.test('开局要每人豆子大于 0；开不了时房间、账、发牌策略记录一起回滚', async () => {
      const { players, room } = await pair(['10', '0']);
      await assert.rejects(start(players, room.id), code('INSUFFICIENT_BALANCE'));
      assert.equal(await ledger.balance(players[0]!.id), '10');
      const unchanged = await rooms.view(room.id, players[0]!.id);
      assert.equal(unchanged.currentRound, 0);
      assert.equal(unchanged.state, 'waiting');
      assert.equal(await operationCount(room.id, 'room_fee'), 0);
      const audit = await db.query("SELECT count(*)::integer AS count FROM audit_events WHERE details->>'roomId'=$1", [room.id]);
      assert.equal(audit.rows[0]!.count, 0);
      await ledger.adjust(beans, players[1]!.id, '0.1', 'positive balance', 'positive-top-up');
      await rooms.ready(players[1]!, room.id, true);
      assert.equal(await ledger.balance(players[0]!.id), '10');
      assert.equal(await ledger.balance(players[1]!.id), '0.1');
    });

    await t.test('action retry is idempotent and rejects reuse by changed payload or another member', async () => {
      const { players, room } = await pair();
      const started = await start(players, room.id);
      await Promise.all(Array.from({ length: 6 }, () => rooms.action(players[0]!, room.id, 'identical-touch-command', { type: 'touch' }, 0, started.roundId!)));
      assert.equal(((await rooms.view(room.id, players[0]!.id)).game as { actions: number }).actions, 1);
      await assert.rejects(rooms.action(players[0]!, room.id, 'identical-touch-command', { type: 'settle' }, 0, started.roundId!), code('IDEMPOTENCY_CONFLICT'));
      await assert.rejects(rooms.action(players[1]!, room.id, 'identical-touch-command', { type: 'touch' }, 0, started.roundId!), code('IDEMPOTENCY_CONFLICT'));
      const result = await rooms.action(players[0]!, room.id, 'idempotent-settlement', { type: 'settle', delta: '0.125' }, 1, started.roundId!);
      const replay = await rooms.action(players[0]!, room.id, 'idempotent-settlement', { type: 'settle', delta: '0.125' }, 1, started.roundId!);
      assert.equal(replay.state, result.state);
      assert.equal(await operationCount(room.id, 'round_settlement'), 1);
      assert.equal(await ledger.balance(players[0]!.id), '10.125');
      assert.equal(await ledger.balance(players[1]!.id), '9.875');
      const recovered = new RoomService(db, new EngineRegistry([fixtureEngine]), new PolicyService(db));
      recovered.opensVariant = supportsNewRoom;
      assert.equal((await recovered.current(players[1]!.id))?.currentRound, 1);
      assert.deepEqual((await recovered.view(room.id, players[0]!.id)).members, replay.members);
    });

    await t.test('invalid engine settlements roll back events and snapshot, preserving all balances', async () => {
      const { players, room } = await pair();
      const started = await start(players, room.id);
      for (const type of ['invalid_sum', 'missing_player'] as const) {
        await assert.rejects(rooms.action(players[0]!, room.id, `corrupt-settlement-${type}`, { type }, 0, started.roundId!), code('INVALID_SETTLEMENT'));
      }
      const current = await rooms.view(room.id, players[0]!.id);
      assert.equal(current.state, 'playing');
      assert.equal((current.game as { actions: number }).actions, 0);
      assert.equal(await operationCount(room.id, 'round_settlement'), 0);
      assert.equal(await ledger.balance(players[0]!.id), '10');
      assert.equal(await ledger.balance(players[1]!.id), '10');
      const events = await db.query('SELECT count(*)::integer AS count FROM game_events WHERE room_id=$1', [room.id]);
      assert.equal(events.rows[0]!.count, 1);
    });

    await t.test('automatic settlement stops at zero (the winner gets only what was there), manual deductions cannot go below it, and the private room closes (DEC-20261102-私人房输光散房)', async () => {
      const { players, room } = await pair(['2', '2']);
      const started = await start(players, room.id);
      await rooms.action(players[0]!, room.id, 'negative-settlement', { type: 'settle', delta: '-3.25' }, 0, started.roundId!);
      assert.equal(await ledger.balance(players[0]!.id), '0');
      // 赢家拿到 2（输家只有 2），够 20 倍底分，付 0.4 房费。
      assert.equal(await ledger.balance(players[1]!.id), '3.6');
      await assert.rejects(ledger.adjust(beans, players[0]!.id, '-0.1', 'cannot deepen debt', 'negative-manual-deduct'), code('INSUFFICIENT_BALANCE'));
      // 输光了下一局开不了，房间直接散；补了豆子也不能接着开。
      assert.equal((await rooms.view(room.id, players[0]!.id)).state, 'closed');
      await ledger.adjust(beans, players[0]!.id, '0.001', 'positive next round', 'positive-next-balance');
      await assert.rejects(rooms.ready(players[1]!, room.id, true), code('INVALID_ROOM_STATE'));
      assert.equal(await operationCount(room.id, 'room_fee'), 1);
    });

    await t.test('policy edits during play preserve the frozen round policy and affect only the following deal', async () => {
      const { players, room } = await pair();
      await policies.update(dealer, players[0]!.id, true, '100', 'certain first deal', 'first-round-policy', 0);
      const first = await start(players, room.id);
      const snapshot = (await db.query('SELECT policy_snapshot FROM rounds WHERE id=$1', [first.roundId])).rows[0]!.policy_snapshot;
      assert.equal(snapshot.selectedUserId, players[0]!.id);
      assert.equal(snapshot.triggered, true);
      await policies.update(dealer, players[0]!.id, false, '100', 'disable next deal', 'disable-next-policy', 1);
      assert.deepEqual((await db.query('SELECT policy_snapshot FROM rounds WHERE id=$1', [first.roundId])).rows[0]!.policy_snapshot, snapshot);
      await rooms.action(players[0]!, room.id, 'policy-test-settlement', { type: 'settle' }, 0, first.roundId!);
      const next = await start(players, room.id);
      const nextPolicy = (await db.query('SELECT policy_snapshot FROM rounds WHERE id=$1', [next.roundId])).rows[0]!.policy_snapshot;
      assert.equal(nextPolicy.selectedUserId, null);
      assert.equal(nextPolicy.triggered, false);
    });

    await t.test('unverified engines and pregame owner cancellation never charge beans', async () => {
      const { players, room } = await pair();
      const unverified = new RoomService(db, new EngineRegistry(), policies);
      unverified.opensVariant = supportsNewRoom;
      await unverified.ready(players[0]!, room.id, true);
      await assert.rejects(unverified.ready(players[1]!, room.id, true), code('RULES_NOT_VERIFIED'));
      assert.equal(await operationCount(room.id, 'room_fee'), 0);
      await rooms.leave(players[0]!, room.id);
      assert.equal((await rooms.view(room.id, players[0]!.id)).state, 'closed');
      assert.equal(await ledger.balance(players[0]!.id), '10');
      assert.equal(await ledger.balance(players[1]!.id), '10');
    });

    await t.test('wallet, room and round bean projections remain separate', async () => {
      const { players, room } = await pair();
      const started = await start(players, room.id);
      const before = await rooms.view(room.id, players[0]!.id);
      assert.deepEqual(before.members.map(member => ({ beanBalance: member.beanBalance, roomBeanDelta: member.roomBeanDelta, roundBeanDelta: member.roundBeanDelta })), [
        { beanBalance: '10', roomBeanDelta: '0', roundBeanDelta: '0' },
        { beanBalance: '10', roomBeanDelta: '0', roundBeanDelta: '0' },
      ]);
      await ledger.adjust(beans, players[0]!.id, '1.25', 'in-room bean projection check', 'room-projection-topup');
      const adjusted = await rooms.view(room.id, players[0]!.id);
      assert.equal(adjusted.members[0]!.beanBalance, '11.25');
      assert.equal(adjusted.members[0]!.roomBeanDelta, '0');
      assert.equal(adjusted.members[0]!.score, '0');
      await rooms.action(players[0]!, room.id, 'room-projection-settlement', { type: 'settle', delta: '0.125' }, started.stateVersion!, started.roundId!);
      const settled = await rooms.view(room.id, players[0]!.id);
      assert.equal(settled.members[0]!.beanBalance, '11.375');
      assert.equal(settled.members[0]!.roomBeanDelta, '0.125');
      assert.equal(settled.members[1]!.roomBeanDelta, '-0.125');
      assert.equal(settled.members[0]!.score, settled.members[0]!.roomBeanDelta);
      assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_name='room_members' AND column_name='score'")).rows[0]!.count, 0);
      assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM ledger_operations WHERE room_id=$1 AND kind=\'round_settlement\'', [room.id])).rows[0]!.count, 1);
    });

    await t.test('manual base beans and player count are frozen only where the original controls are unresolved', async () => {
      const player = await auth.create(`roomtest_manual_base_${++serial}`, 'test-password-only');
      const defaults = getDefaultOptions('4:0');
      const room = await rooms.create(player, '4:0', { ...defaults, baseBeans: '0.125' });
      assert.equal(room.baseBeans, '0.125');
      assert.equal(room.baseBeansSource, 'manual');
      assert.equal(room.rules.baseBeans, '0.125');
      await assert.rejects(rooms.create(await auth.create(`roomtest_manual_base_bad_${++serial}`, 'test-password-only'), '4:0', { ...defaults, baseBeans: '0' }), { code: 'INVALID_ROOM_OPTIONS' });
      const manualPlayers = await auth.create(`roomtest_manual_players_${++serial}`, 'test-password-only');
      const noPlayerDefault = getDefaultOptions('14:0');
      const manualRoom = await rooms.create(manualPlayers, '14:0', { ...noPlayerDefault, playerNum: 3, baseBeans: '1.5' });
      assert.equal(manualRoom.playerCount, 3);
      assert.equal(manualRoom.playerNumSource, 'manual');
      assert.equal(manualRoom.rules.playerNum, 3);
      await assert.rejects(rooms.create(await auth.create(`roomtest_manual_players_bad_${++serial}`, 'test-password-only'), '14:0', { ...noPlayerDefault, baseBeans: '1.5' }), { code: 'RULE_DEFAULT_NOT_VERIFIED' });
    });
  } finally { await db.close(); }
});
