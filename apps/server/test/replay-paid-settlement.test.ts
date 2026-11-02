import test from 'node:test';
import assert from 'node:assert/strict';
import { MSGEvent } from '@dss/protocol';
import { createApp } from '../src/app.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry, type RuleEngine, type EnginePlayer } from '../src/engines.js';

interface State { players: EnginePlayer[]; done: boolean }
// 只验证回放结算窗显示实际过账的豆子，不代表任何地方玩法：1 号座位赢，另一家按牌输 30 豆。
const postingsOf = (state: State) => state.players.map((player, index) => ({ userId: player.userId, amount: index ? '-30' : '30' }));
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'replay-paid-settlement-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'test-only-replay-paid-settlement' },
  create(input): State { return { players: input.players, done: false }; },
  apply(raw) {
    const state = raw as State; const settlement = postingsOf(state);
    return { snapshot: { ...state, done: true }, events: [], confirmedScores: [{ eventId: 'terminal', postings: settlement }], settlement };
  },
  view(raw) { return { done: (raw as State).done }; },
  interactions: { legalActions: () => [{ type: 'finish' }], deadlines: () => [], autoPlay: () => null },
  original: {
    decodeAction() { return { type: 'finish' }; },
    response() { return { body: { result: 1 } }; },
    enter(raw, userId) {
      const state = raw as State;
      return { body: { tableState: state.done ? 0 : 1, gameStart: { round: 1, seats: state.players.map(player => ({ seatIndex: player.seat,
        tilesOnHand: player.userId === userId ? [707] : [], tilesOnHandNum: 1 })) } } };
    },
    notifications(raw, _events, _userId, phase) {
      const state = raw as State;
      if (phase === 'start' || !state.done) return [];
      const postings = postingsOf(state);
      return [{ command: MSGEvent.HWNotifyGameOver, body: { result: 1, userScoreInfo: postings.map(posting => ({ uid: posting.userId, nick: posting.userId,
        seatIndex: state.players.find(player => player.userId === posting.userId)!.seat, score: posting.amount, changeScore: posting.amount })), bigResult: [] },
      decimalFields: postings.flatMap((posting, index) => [
        { path: ['hwNotifyGameOver', 'userScoreInfo', index, 'score'], value: posting.amount },
        { path: ['hwNotifyGameOver', 'userScoreInfo', index, 'changeScore'], value: posting.amount },
      ]) }];
    },
  },
};

test('回放结算窗这局输赢照现场显示实际扣的豆子（最多输光），不显示按牌算的', async t => {
  const db = await openDatabase(); await migrate(db);
  const { app, auth, rooms, ledger } = await createApp(db, { staticFiles: false, engines: new EngineRegistry([fixture]), scheduler: false, rateLimit: false });
  t.after(async () => { await app.close(); await db.close(); });
  const beans = await auth.create('paid_replay_beans', 'test-password-only', 'beans_admin');
  const [host, guest] = [await auth.create('paid_replay_host', 'test-password-only'), await auth.create('paid_replay_guest', 'test-password-only')];
  await ledger.adjust(beans, host.id, '100', 'paid replay fixture', `paid-replay-${host.id}`);
  await ledger.adjust(beans, guest.id, '10', 'paid replay fixture', `paid-replay-${guest.id}`);
  const token = (await auth.login('paid_replay_host', 'test-password-only')).token;
  // 房主付房费，guest 只有 10 豆：按牌输 30，实际只扣 10，房主只赢 10。
  const room = await rooms.create(host, '4:0', { baseBeans: '1', playerNum: 2, gameNum: 4, useCardType: 1 });
  await rooms.join(guest, room.code); await rooms.ready(host, room.id, true);
  const started = await rooms.ready(guest, room.id, true);
  await rooms.originalAction(host, room.id, 'paid-replay-finish', 23, { actType: 9 }, 0, started.roundId!);

  const get = (url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const manifest = (await get(`/api/records/${room.id}/replay/${started.roundId}/original`)).json();
  assert.ok(manifest.digest, JSON.stringify(manifest));
  const page = (await get(`${manifest.framesUrl}?offset=0&limit=50&digest=${manifest.digest}`)).json();
  const over = page.frames.flatMap((frame: any) => frame.packets).find((packet: any) => packet.command === MSGEvent.HWNotifyGameOver);
  assert.ok(over, '回放里要有结算窗');
  const shown = (field: string) => over.decimalFields.filter((item: any) => item.path[3] === field).map((item: any) => item.value);
  assert.deepEqual(shown('changeScore'), ['10', '-10']);
  assert.deepEqual(shown('score'), ['10', '-10']);
  assert.deepEqual(over.body.userScoreInfo.map((info: any) => info.nick), ['paid_replay_host', 'paid_replay_guest']);
});
