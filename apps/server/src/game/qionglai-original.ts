import { MSGEvent } from '@dss/protocol';
import { requireCondition } from '../errors.js';
import type { EngineOriginalAdapter, EngineOriginalBody, EngineOriginalPacket, OriginalActionContext } from '../engines.js';
import { isDeepStrictEqual } from 'node:util';
import type { QionglaiAction } from './qionglai-round.js';
import { qionglaiLegalActions } from './qionglai-round.js';
import type { QionglaiEngineSnapshot } from './qionglai-engine.js';

const ACT = {
  unknown: 1, deal: 2, discard: 3, pass: 4, hu: 5, gang: 6, tou: 7,
  peng: 8, chi: 9, next: 10, declare: 12,
} as const;
const COL = {
  gangAn: 1, gangMing: 2, gangBa: 3, tou: 6, peng: 7, chi: 8, gangKou: 4, gangWan: 5,
} as const;

interface OriginalState extends QionglaiEngineSnapshot {}
interface OriginalAction { type: 'original'; actType: number; colType: number; destCard: number; cards: number[]; decisionId: string }

const cards = (s: OriginalState, zone: string) => s.cards.zones.find(item => item.id === zone)!.cards;
const physical = (s: OriginalState, id: string) => {
  const card = s.cards.pack.find(item => item.id === id);
  requireCondition(card, 'INVALID_ORIGINAL_PROJECTION', 'A referenced card is missing from the frozen pack.', 500);
  return card;
};
const seat = (s: OriginalState, userId: string) => s.players.find(player => player.userId === userId)!.seat;
const codeFor = (s: OriginalState, id: string) => physical(s, id).code;
const zoneCodes = (s: OriginalState, zone: string) => cards(s, zone).map(id => physical(s, id).code);
const sameFace = (s: OriginalState, userId: string, code: number) =>
  cards(s, `hand:${userId}`).filter(id => physical(s, id).code === code);
const action = (s: OriginalState, userId: string, actionValue: QionglaiAction) => {
  requireCondition(qionglaiLegalActions(s, userId).some(candidate => JSON.stringify(candidate) === JSON.stringify(actionValue)),
    'INVALID_ORIGINAL_PROJECTION', 'The original client choice is not a current server action.', 409);
  return actionValue;
};

function column(s: OriginalState, userId: string, actionValue: QionglaiAction) {
  if (actionValue.type === 'discard' || actionValue.type === 'declare') return {
    seatIndex: seat(s, userId), actType: actionValue.type === 'declare' ? ACT.declare : ACT.discard,
    colType: 1, cards: [codeFor(s, actionValue.cardId)],
  };
  if (actionValue.type === 'chi' || actionValue.type === 'peng' || actionValue.type === 'gang' || actionValue.type === 'tou') {
    const values = actionValue.cardIds.map(id => codeFor(s, id));
    return { seatIndex: seat(s, userId), actType: actionValue.type === 'chi' ? ACT.chi
      : actionValue.type === 'peng' ? ACT.peng : actionValue.type === 'tou' ? ACT.tou : ACT.gang,
    colType: actionValue.type === 'chi' ? COL.chi : actionValue.type === 'peng' ? COL.peng
      : actionValue.type === 'tou' ? COL.tou : COL.gangMing,
    cards: values };
  }
  if (actionValue.type === 'ba') return { seatIndex: seat(s, userId), actType: ACT.gang,
    colType: COL.gangBa, cards: [codeFor(s, actionValue.cardId)] };
  return null;
}

function originalSignature(s: OriginalState, userId: string, actionValue: QionglaiAction): OriginalAction | null {
  const decisionId = actionValue.decisionId;
  if (actionValue.type === 'respond') {
    const offer = s.claims?.offers.find(candidate => candidate.id === actionValue.choiceId);
    if (!offer) return { type: 'original', actType: ACT.pass, colType: 0, destCard: 0, cards: [], decisionId };
    const move = offer.action as QionglaiAction;
    if (move.type === 'hu') return { type: 'original', actType: ACT.hu, colType: 0, destCard: s.source?.cardId ? codeFor(s, s.source.cardId) : 0, cards: [], decisionId };
    const col = column(s, userId, move);
    return col ? { type: 'original', actType: col.actType, colType: col.colType, destCard: s.source?.cardId ? codeFor(s, s.source.cardId) : 0,
      cards: col.cards, decisionId } : null;
  }
  if (actionValue.type === 'hu') return { type: 'original', actType: ACT.hu, colType: 0,
    destCard: s.source?.cardId ? codeFor(s, s.source.cardId) : 0, cards: [], decisionId };
  const col = column(s, userId, actionValue);
  return col ? { type: 'original', actType: col.actType, colType: col.colType, destCard: col.cards[0] ?? 0, cards: col.cards, decisionId } : null;
}

function choices(s: OriginalState, userId: string) {
  const result: Record<string, unknown>[] = [];
  for (const item of qionglaiLegalActions(s, userId)) {
    if (item.type === 'begin' || item.type === 'draw') continue;
    if (item.type === 'respond') {
      const offer = s.claims?.offers.find(offer => offer.id === item.choiceId);
      if (!offer) continue;
      const move = offer.action as QionglaiAction;
      if (move.type === 'hu') result.push({ seatIndex: seat(s, userId), actType: ACT.hu, destCard: s.source?.cardId ? codeFor(s, s.source.cardId) : 0 });
      else {
        const col = column(s, userId, move);
        if (col) result.push({ ...col, destCard: s.source?.cardId ? codeFor(s, s.source.cardId) : 0, destCardIsOwn: false });
      }
      result.push({ seatIndex: seat(s, userId), actType: ACT.pass, destCard: s.source?.cardId ? codeFor(s, s.source.cardId) : 0 });
      continue;
    }
    if (item.type === 'hu') {
      result.push({ seatIndex: seat(s, userId), actType: ACT.hu,
        destCard: s.source?.cardId ? codeFor(s, s.source.cardId) : 0 });
      continue;
    }
    const col = column(s, userId, item);
    if (col) result.push(col);
  }
  return result;
}

function gameOver(state: OriginalState): EngineOriginalBody {
  const outcome = state.outcome!;
  return { body: { result: outcome.reason === 'hu' ? 1 : 2, userScoreInfo: outcome.payments.postings.map(posting => ({
    uid: posting.userId, nick: posting.userId, seatIndex: seat(state, posting.userId), score: posting.amount, changeScore: posting.amount,
  })), smallResult: null, bigResult: [] },
  decimalFields: outcome.payments.postings.flatMap((posting, index) => [
    { path: ['hwNotifyGameOver', 'userScoreInfo', index, 'score'], value: posting.amount },
    { path: ['hwNotifyGameOver', 'userScoreInfo', index, 'changeScore'], value: posting.amount },
  ]) };
}

function enterBody(snapshot: unknown, userId: string): EngineOriginalBody {
  const state = snapshot as OriginalState;
  const self = state.players.find(player => player.userId === userId)!;
  return { body: { tableState: state.phase === 'finished' ? 2 : 1, seatIndex: self.seat, leftCardNum: cards(state, 'deck').length,
    dealer: seat(state, state.dealerId), round: state.number, xiaoSeat: 0, gameStart: {
      dealer: seat(state, state.dealerId), leftTileNum: cards(state, 'deck').length, round: state.number, xiaoSeat: 0,
      seats: state.players.map(player => ({
        seatIndex: player.seat, tilesOnHand: player.userId === userId
          ? cards(state, `hand:${player.userId}`).map(id => physical(state, id).code) : [],
        tilesOnHandNum: cards(state, `hand:${player.userId}`).length,
        outCol: player.melds.map(meld => ({ seatIndex: player.seat, actType: meld.kind === 'gang' || meld.kind === 'ba' ? ACT.gang : meld.kind === 'peng' ? ACT.peng : meld.kind === 'tou' ? ACT.tou : ACT.chi,
          colType: meld.kind === 'gang' || meld.kind === 'ba' ? (meld.kind === 'ba' ? COL.gangBa : COL.gangMing) : meld.kind === 'peng' ? COL.peng : meld.kind === 'tou' ? COL.tou : COL.chi,
          cards: meld.cardIds.map(id => codeFor(state, id)) })),
        protectCards: cards(state, `bonus:${player.userId}`).map(id => physical(state, id).code),
        redPoint: 0, blackPoint: 0, auto: false, isPiao: false,
      })),
      cardInfo: [],
    } } };
}

export function createQionglaiOriginalAdapter(): EngineOriginalAdapter {
  return {
    decodeAction(command, body, decisionIdValue): unknown {
      requireCondition(command === 23, 'UNSUPPORTED_ORIGINAL_COMMAND', 'Only original action command 23 is accepted.', 409);
      const actType = Number(body.actType);
      const decisionId = decisionIdValue;
      requireCondition(decisionId, 'DECISION_REQUIRED', 'A server decision ID is required for Qionglai actions.', 426);
      if (![ACT.pass, ACT.hu, ACT.discard, ACT.declare, ACT.chi, ACT.peng, ACT.gang, ACT.tou].includes(actType as never))
        throw Object.assign(new Error('Unsupported Qionglai action type.'), { code: 'INVALID_ORIGINAL_ACTION' });
      const destCard = Number(body.destCard);
      const values = Array.isArray(body.cards) ? body.cards.map(Number) : [];
      return { type: 'original', actType, colType: Number(body.colType) || 0, destCard, cards: values, decisionId };
    },
    resolveAction(snapshot: unknown, userId: string, decoded: unknown) {
      const state = snapshot as OriginalState;
      const wanted = decoded as OriginalAction;
      requireCondition(wanted?.type === 'original' && Number.isInteger(wanted.actType) && Number.isInteger(wanted.colType) &&
        Number.isInteger(wanted.destCard) && Array.isArray(wanted.cards) && wanted.decisionId === `ql:${state.number}:${state.serial}`,
      'STALE_CLAIM_WINDOW', 'The decoded original action no longer belongs to this decision.', 409);
      const match = qionglaiLegalActions(state, userId).find(candidate => {
        const signature = originalSignature(state, userId, candidate);
        return signature && signature.actType === wanted.actType && signature.colType === wanted.colType &&
          signature.destCard === wanted.destCard && isDeepStrictEqual([...signature.cards].sort(), [...wanted.cards].sort());
      });
      requireCondition(match, 'INVALID_ACTION', 'The original client choice is not available.', 409);
      return match;
    },
    response(_command, _body, _snapshot, _userId) { return { body: { result: 1 } }; },
    enter(snapshot: unknown, userId: string) { return enterBody(snapshot, userId); },
    notifications(snapshot: unknown, events: readonly unknown[], userId: string, phase): EngineOriginalPacket[] {
      const state = snapshot as OriginalState;
      if (phase === 'start') return [{ command: MSGEvent.HWNotifyGameStart, body: (enterBody(snapshot, userId).body as { gameStart: Record<string, unknown> }).gameStart }];
      const packets: EngineOriginalPacket[] = [];
      const visibleEvents = events.length ? events : state.startEvents ?? [];
      for (const event of visibleEvents as { type: string; [key: string]: unknown }[]) {
        if (event.type === 'round-ended') {
          packets.push({ command: MSGEvent.HWNotifyGameOver, ...gameOver(state) });
          continue;
        }
        if (event.type === 'discard') {
          const card = event.card as { code: number };
          packets.push({ command: MSGEvent.HWNotifyActionFlow, body: { action: {
            seatIndex: seat(state, String(event.userId)), actType: ACT.discard, destCard: card.code,
            destCardIsOwn: userId === event.userId, leftCardNum: cards(state, 'deck').length,
            // The flow packet describes the post-discard hand the client should render.
            tilesOnHandNum: cards(state, `hand:${event.userId}`).length - 1,
          } } });
          continue;
        }
        if (event.type === 'meld') {
          const meld = event as unknown as { kind: string; userId: string; cards: { code: number }[] };
          const codes = meld.cards.map(card => card.code);
          const actType = meld.kind === 'chi' ? ACT.chi : meld.kind === 'peng' ? ACT.peng
            : meld.kind === 'tou' ? ACT.tou : ACT.gang;
          const colType = meld.kind === 'chi' ? COL.chi : meld.kind === 'peng' ? COL.peng
            : meld.kind === 'tou' ? COL.tou : meld.kind === 'ba' ? COL.gangBa : COL.gangMing;
          packets.push({ command: MSGEvent.HWNotifyActionFlow, body: { action: {
            seatIndex: seat(state, meld.userId), actType, destCard: codes[0] ?? 0,
            colInfo: [{ seatIndex: seat(state, meld.userId), actType, colType, cards: codes,
              destCard: codes[0] ?? 0, destCardIsOwn: userId === meld.userId }],
            tilesOnHandNum: cards(state, `hand:${meld.userId}`).length,
          } } });
          continue;
        }
        if (event.type === 'replacement' && event.userId !== userId) continue;
        if (event.type === 'flip' || event.type === 'replacement') {
          packets.push({ command: MSGEvent.HWNotifyPlayerDealCard, body: { seatIndex: seat(state, String(event.userId)), value: Number((event.card as { code?: number } | undefined)?.code ?? 0),
            isFanPai: event.type === 'flip', leftCardNum: cards(state, 'deck').length, tilesOnHandNum: cards(state, `hand:${event.userId}`).length,
            // 补的牌进本人手里：原版只认 isShangShou 才把牌加进手牌（11-01 本机试玩）。
            pointNum: 0, blackPoint: 0, isShangShou: event.type === 'replacement' } });
        }
        if (event.type === 'bonus') packets.push({ command: MSGEvent.HWNotifyPlayerDealCard, body: { seatIndex: seat(state, String(event.userId)),
          value: (event.card as { code: number }).code, isFanPai: false, leftCardNum: cards(state, 'deck').length,
          tilesOnHandNum: cards(state, `hand:${event.userId}`).length, isShangShou: false } });
      }
      const ownChoices = choices(state, userId);
      if (ownChoices.length) packets.push({ command: MSGEvent.HWNotifySeatOperationChoice, body: { choices: ownChoices } });
      if (state.phase !== 'finished' && state.activeId !== userId) packets.push({ command: MSGEvent.HWNotifyNextOperation,
        body: { seatIndex: seat(state, state.activeId), leftCardNum: cards(state, 'deck').length, autoIntoSecond: 0 } });
      return packets;
    },
  };
}
