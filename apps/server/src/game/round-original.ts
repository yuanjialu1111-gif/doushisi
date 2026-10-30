import { isDeepStrictEqual } from 'node:util';
import { MSGEvent } from '@dss/protocol';
import { requireCondition } from '../errors.js';
import type { EngineOriginalAdapter, EngineOriginalBody, EngineOriginalPacket } from '../engines.js';

const ACT = {
  unknown: 1, deal: 2, discard: 3, pass: 4, hu: 5, gang: 6, tou: 7,
  peng: 8, chi: 9, next: 10, declare: 12, piao: 13, piaoPass: 14,
} as const;
const COL = {
  gangAn: 1, gangMing: 2, gangBa: 3, gangKou: 4, gangWan: 5, tou: 6, peng: 7, chi: 8,
} as const;

interface RoundPlayer { userId: string; seat: number; melds: { kind: string; cardIds: string[] }[]; piao?: number | null }
interface RoundState {
  version: string; number: number; serial: number; phase: string; activeId: string; dealerId: string;
  players: RoundPlayer[];
  cards: { pack: { id: string; code: number }[]; zones: { id: string; cards: string[] }[] };
  claims: { id: string; offers: { id: string; userId: string; action: unknown }[] } | null;
  outcome?: { reason: string; payments: { postings: { userId: string; amount: string }[] } } | null;
  startEvents?: unknown[];
}
type Move = Record<string, unknown> & { type: string; cardId?: string; cardIds?: string[]; value?: number; decisionId?: string };
interface Decoded {
  type: 'original'; actType: number; colType: number; destCard: number; cards: number[]; decisionId?: string;
}

export interface RoundAdapterOptions {
  label: string;
  decisionPrefix: string;
  legalActions(state: unknown, userId: string): Move[];
  supportsPiao?: boolean;
}

export function createRoundOriginalAdapter(options: RoundAdapterOptions): EngineOriginalAdapter {
  const state = (snapshot: unknown) => snapshot as RoundState;
  const ids = (s: RoundState, zone: string) => s.cards.zones.find(item => item.id === zone)!.cards;
  const physical = (s: RoundState, id: string) => {
    const card = s.cards.pack.find(item => item.id === id);
    requireCondition(card, 'INVALID_ORIGINAL_PROJECTION', 'A referenced card is missing from the frozen pack.', 500);
    return card;
  };
  const seatOf = (s: RoundState, userId: string) => s.players.find(player => player.userId === userId)!.seat;
  const codeFor = (s: RoundState, id: string) => physical(s, id).code;
  const decisionFor = (s: RoundState) => `${options.decisionPrefix}:${s.number}:${s.serial}`;

  function column(s: RoundState, userId: string, action: Move) {
    if (action.type === 'discard' || action.type === 'declare') return {
      seatIndex: seatOf(s, userId), actType: action.type === 'declare' ? ACT.declare : ACT.discard,
      colType: 1, cards: [codeFor(s, action.cardId as string)],
    };
    if (['chi', 'peng', 'gang', 'tou'].includes(action.type)) return {
      seatIndex: seatOf(s, userId),
      actType: action.type === 'chi' ? ACT.chi : action.type === 'peng' ? ACT.peng
        : action.type === 'tou' ? ACT.tou : ACT.gang,
      colType: action.type === 'chi' ? COL.chi : action.type === 'peng' ? COL.peng
        : action.type === 'tou' ? COL.tou : COL.gangMing,
      cards: (action.cardIds as string[]).map(id => codeFor(s, id)),
    };
    if (action.type === 'ba') return { seatIndex: seatOf(s, userId), actType: ACT.gang,
      colType: COL.gangBa, cards: [codeFor(s, action.cardId as string)] };
    return null;
  }

  function signature(s: RoundState, userId: string, action: Move): Decoded | null {
    const decisionId = action.decisionId;
    if (action.type === 'respond') {
      const offer = s.claims?.offers.find(candidate => candidate.id === (action as { choiceId?: string }).choiceId);
      if (!offer) return { type: 'original', actType: ACT.pass, colType: 0, destCard: 0, cards: [], decisionId };
      const move = offer.action as Move;
      if (move.type === 'hu') return { type: 'original', actType: ACT.hu, colType: 0, destCard: 0, cards: [], decisionId };
      const col = column(s, userId, move);
      return col ? { type: 'original', actType: col.actType, colType: col.colType, destCard: 0, cards: col.cards, decisionId } : null;
    }
    if (action.type === 'hu') return { type: 'original', actType: ACT.hu, colType: 0, destCard: 0, cards: [], decisionId };
    if (action.type === 'piao') return { type: 'original', actType: action.value === 1 ? ACT.piao : ACT.piaoPass,
      colType: 0, destCard: 0, cards: [], decisionId };
    if (action.type === 'begin' || action.type === 'draw') return null;
    const col = column(s, userId, action);
    return col ? { type: 'original', actType: col.actType, colType: col.colType,
      destCard: col.cards[0] ?? 0, cards: col.cards, decisionId } : null;
  }

  function choices(s: RoundState, userId: string) {
    const result: Record<string, unknown>[] = [];
    for (const action of options.legalActions(s, userId)) {
      if (action.type === 'begin' || action.type === 'draw') continue;
      if (action.type === 'piao') {
        result.push({ seatIndex: seatOf(s, userId), actType: action.value === 1 ? ACT.piao : ACT.piaoPass });
        continue;
      }
      if (action.type === 'respond') {
        const offer = s.claims?.offers.find(candidate => candidate.id === (action as { choiceId?: string }).choiceId);
        if (!offer) continue;
        const move = offer.action as Move;
        if (move.type === 'hu') result.push({ seatIndex: seatOf(s, userId), actType: ACT.hu, destCard: 0 });
        else {
          const col = column(s, userId, move);
          if (col) result.push({ ...col, destCard: col.cards[0] ?? 0, destCardIsOwn: false,
            colInfo: [{ ...col, destCard: col.cards[0] ?? 0, destCardIsOwn: false }] });
        }
        result.push({ seatIndex: seatOf(s, userId), actType: ACT.pass, destCard: 0 });
        continue;
      }
      if (action.type === 'hu') { result.push({ seatIndex: seatOf(s, userId), actType: ACT.hu, destCard: 0 }); continue; }
      const col = column(s, userId, action);
      if (col) result.push(col);
    }
    return result;
  }

  function gameOver(s: RoundState): EngineOriginalBody {
    const outcome = s.outcome!;
    return { body: { result: outcome.reason === 'hu' ? 1 : 2,
      userScoreInfo: outcome.payments.postings.map(posting => ({
        uid: posting.userId, nick: posting.userId, seatIndex: seatOf(s, posting.userId),
        score: posting.amount, changeScore: posting.amount,
      })), smallResult: null, bigResult: [] },
    decimalFields: outcome.payments.postings.flatMap((posting, index) => [
      { path: ['hwNotifyGameOver', 'userScoreInfo', index, 'score'], value: posting.amount },
      { path: ['hwNotifyGameOver', 'userScoreInfo', index, 'changeScore'], value: posting.amount },
    ]) };
  }

  function enterBody(snapshot: unknown, userId: string): EngineOriginalBody {
    const s = state(snapshot);
    const self = s.players.find(player => player.userId === userId)!;
    return { body: { tableState: s.phase === 'finished' ? 2 : 1, seatIndex: self.seat,
      leftCardNum: ids(s, 'deck').length, dealer: seatOf(s, s.dealerId), round: s.number, xiaoSeat: 0,
      gameStart: {
        dealer: seatOf(s, s.dealerId), leftTileNum: ids(s, 'deck').length, round: s.number, xiaoSeat: 0,
        seats: s.players.map(player => ({
          seatIndex: player.seat,
          tilesOnHand: player.userId === userId ? ids(s, `hand:${player.userId}`).map(id => codeFor(s, id)) : [],
          tilesOnHandNum: ids(s, `hand:${player.userId}`).length,
          outCol: player.melds.map(meld => ({
            seatIndex: player.seat,
            actType: meld.kind === 'gang' || meld.kind === 'ba' ? ACT.gang : meld.kind === 'peng' ? ACT.peng
              : meld.kind === 'tou' ? ACT.tou : ACT.chi,
            colType: meld.kind === 'ba' ? COL.gangBa : meld.kind === 'gang' ? COL.gangMing
              : meld.kind === 'peng' ? COL.peng : meld.kind === 'tou' ? COL.tou : COL.chi,
            cards: meld.cardIds.map(id => codeFor(s, id)),
          })),
          protectCards: ids(s, `bonus:${player.userId}`).map(id => codeFor(s, id)),
          redPoint: 0, blackPoint: 0, auto: false, isPiao: player.piao === 1,
        })),
        cardInfo: [],
      } } };
  }

  return {
    decodeAction(command, body, decisionId): unknown {
      if (command === 53) {
        requireCondition(decisionId, 'DECISION_REQUIRED', `A server decision ID is required for ${options.label} piao.`, 426);
        requireCondition(options.supportsPiao, 'UNSUPPORTED_ORIGINAL_COMMAND', `${options.label} has no piao command.`, 409);
        return { type: 'original', actType: Number(body.piaoStatus) === 1 ? ACT.piao : ACT.piaoPass,
          colType: 0, destCard: 0, cards: [], decisionId };
      }
      const actType = Number(body.actType);
      requireCondition([ACT.pass, ACT.hu, ACT.discard, ACT.declare, ACT.chi, ACT.peng, ACT.gang, ACT.tou].includes(actType as never) ||
        options.supportsPiao && [ACT.piao, ACT.piaoPass].includes(actType as never),
      'INVALID_ORIGINAL_ACTION', `Unsupported ${options.label} action type.`, 409);
      return { type: 'original', actType, colType: Number(body.colType) || 0,
        destCard: Number(body.destCard) || 0,
        cards: Array.isArray(body.cards) ? body.cards.map(Number) : [], decisionId };
    },
    resolveAction(snapshot: unknown, userId: string, decoded: unknown) {
      const s = state(snapshot), wanted = decoded as Decoded;
      requireCondition(wanted?.type === 'original' && Number.isInteger(wanted.actType) &&
        Number.isInteger(wanted.colType) && Number.isInteger(wanted.destCard) && Array.isArray(wanted.cards) &&
        (wanted.decisionId === undefined || wanted.decisionId === decisionFor(s)),
      'STALE_CLAIM_WINDOW', 'The decoded original action no longer belongs to this decision.', 409);
      const match = options.legalActions(s, userId).find(candidate => {
        const sig = signature(s, userId, candidate);
        return sig && sig.actType === wanted.actType && sig.colType === wanted.colType &&
          isDeepStrictEqual([...sig.cards].sort(), [...wanted.cards].sort());
      });
      requireCondition(match, 'INVALID_ACTION', 'The original client choice is not available.', 409);
      return match;
    },
    response() { return { body: { result: 1 } }; },
    enter(snapshot, userId) { return enterBody(snapshot, userId); },
    notifications(snapshot, events, userId, phase): EngineOriginalPacket[] {
      const s = state(snapshot);
      if (phase === 'start') return [{ command: MSGEvent.HWNotifyGameStart,
        body: (enterBody(snapshot, userId).body as { gameStart: Record<string, unknown> }).gameStart }];
      const packets: EngineOriginalPacket[] = [];
      const visible = events.length ? events : s.startEvents ?? [];
      for (const raw of visible as { type: string; [key: string]: unknown }[]) {
        if (raw.type === 'round-ended') { packets.push({ command: MSGEvent.HWNotifyGameOver, ...gameOver(s) }); continue; }
        if (raw.type === 'discard') {
          const card = raw.card as { code: number };
          packets.push({ command: MSGEvent.HWNotifyActionFlow, body: { action: {
            seatIndex: seatOf(s, String(raw.userId)), actType: ACT.discard, destCard: card.code,
            destCardIsOwn: userId === raw.userId, leftCardNum: ids(s, 'deck').length,
            tilesOnHandNum: ids(s, `hand:${raw.userId}`).length - 1,
          } } });
          continue;
        }
        if (raw.type === 'meld') {
          const meld = raw as unknown as { kind: string; userId: string; cards: { code: number }[] };
          const codes = meld.cards.map(card => card.code);
          const actType = meld.kind === 'chi' ? ACT.chi : meld.kind === 'peng' ? ACT.peng
            : meld.kind === 'tou' ? ACT.tou : ACT.gang;
          const colType = meld.kind === 'chi' ? COL.chi : meld.kind === 'peng' ? COL.peng
            : meld.kind === 'tou' ? COL.tou : meld.kind === 'ba' ? COL.gangBa : COL.gangMing;
          packets.push({ command: MSGEvent.HWNotifyActionFlow, body: { action: {
            seatIndex: seatOf(s, meld.userId), actType, destCard: codes[0] ?? 0,
            colInfo: [{ seatIndex: seatOf(s, meld.userId), actType, colType, cards: codes,
              destCard: codes[0] ?? 0, destCardIsOwn: userId === meld.userId }],
            tilesOnHandNum: ids(s, `hand:${meld.userId}`).length,
          } } });
          continue;
        }
        if (raw.type === 'replacement' && raw.userId !== userId) continue;
        if (raw.type === 'flip' || raw.type === 'replacement') {
          packets.push({ command: MSGEvent.HWNotifyPlayerDealCard, body: {
            seatIndex: seatOf(s, String(raw.userId)),
            value: Number((raw.card as { code?: number } | undefined)?.code ?? 0),
            isFanPai: raw.type === 'flip', leftCardNum: ids(s, 'deck').length,
            tilesOnHandNum: ids(s, `hand:${raw.userId}`).length, pointNum: 0, blackPoint: 0, isShangShou: false } });
        }
        if (raw.type === 'bonus') packets.push({ command: MSGEvent.HWNotifyPlayerDealCard, body: {
          seatIndex: seatOf(s, String(raw.userId)), value: (raw.card as { code: number }).code,
          isFanPai: false, leftCardNum: ids(s, 'deck').length,
          tilesOnHandNum: ids(s, `hand:${raw.userId}`).length, isShangShou: false } });
      }
      const own = choices(s, userId);
      if (own.length) packets.push({ command: MSGEvent.HWNotifySeatOperationChoice, body: { choices: own } });
      if (s.phase !== 'finished' && s.activeId !== userId) packets.push({ command: MSGEvent.HWNotifyNextOperation,
        body: { seatIndex: seatOf(s, s.activeId), leftCardNum: ids(s, 'deck').length, autoIntoSecond: 0 } });
      return packets;
    },
  };
}
