import { isDeepStrictEqual } from 'node:util';
import { MSGEvent } from '@dss/protocol';
import { requireCondition } from '../errors.js';
import type { EngineOriginalAdapter, EngineOriginalBody, EngineOriginalPacket } from '../engines.js';
import { originalChoices, originalRequest, type OriginalChoiceItem } from './original-choices.js';

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
  outcome?: { reason: string; payments: { postings: { userId: string; amount: string }[] };
    winners?: { userId: string }[]; sourceCardId?: string | null } | null;
  rules?: Record<string, unknown>;
  startEvents?: unknown[];
}
type Move = Record<string, unknown> & { type: string; cardId?: string; cardIds?: string[]; value?: number; decisionId?: string };
interface Decoded {
  type: 'original'; actType: number; colType: number; destCard: number; cards: number[]; decisionId?: string;
}

/** 原版小结算（dss_settle_UI）里每家的番型、番数和红黑点；只有提供它的玩法才弹小结算。 */
export interface RoundBrand { cardType: number[]; fanNum: number; pointNum: number; blackPoint: number }
export interface RoundAdapterOptions {
  label: string;
  decisionPrefix: string;
  legalActions(state: unknown, userId: string): Move[];
  supportsPiao?: boolean;
  settlement?(state: unknown, userId: string): RoundBrand;
  /** 当前手牌的红点、黑点；只发给本人，别人的手牌红点不外露。 */
  points?(state: unknown, userId: string): { red: number; black: number };
  /** 每张能打的牌打出去后能胡哪些（chuCard 0 是当前这手），出牌选项带上，原版亮可胡提示（E7）。 */
  jiaoTishi?(state: unknown, userId: string): { chuCard: number; huInfo: { huCard: number; num: number; fanNum: number }[] }[];
  /** 牌桌上倒计时显示的秒数（原版读 autoIntoSecond，0 就显示 0），和托管超时一致（E8）。 */
  turnSeconds?(state: unknown): number;
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
  /** 原版客户端从动作、发牌、进桌里读红点、黑点更新底部显示（发牌消息里红点叫 pointNum）；不是本人就给 0。 */
  const pointsFor = (s: RoundState, actorId: string, viewerId: string) => {
    if (!options.points || actorId !== viewerId) return { redPoint: 0, blackPoint: 0 };
    const points = options.points(s, viewerId);
    return { redPoint: points.red, blackPoint: points.black };
  };

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
    const seatIndex = seatOf(s, userId), hand = ids(s, `hand:${userId}`), items: OriginalChoiceItem[] = [];
    for (const action of options.legalActions(s, userId)) {
      if (action.type === 'begin' || action.type === 'draw') continue;
      if (action.type === 'piao') {
        items.push({ kind: 'other', choice: { seatIndex, actType: action.value === 1 ? ACT.piao : ACT.piaoPass } });
        continue;
      }
      if (action.type === 'respond') {
        const offer = s.claims?.offers.find(candidate => candidate.id === (action as { choiceId?: string }).choiceId);
        if (!offer) { items.push({ kind: 'other', choice: { seatIndex, actType: ACT.pass, destCard: 0 } }); continue; }
        const move = offer.action as Move;
        if (move.type === 'hu') items.push({ kind: 'other', choice: { seatIndex, actType: ACT.hu, destCard: 0 } });
        else {
          const col = column(s, userId, move);
          const incomingId = move.cardIds?.find(id => !hand.includes(id));
          const incoming = incomingId ? codeFor(s, incomingId) : undefined;
          if (col) items.push({ kind: 'meld', column: col, destCard: incoming ?? col.cards[0] ?? 0, incoming });
        }
        items.push({ kind: 'other', choice: { seatIndex, actType: ACT.pass, destCard: 0 } });
        continue;
      }
      if (action.type === 'hu') { items.push({ kind: 'other', choice: { seatIndex, actType: ACT.hu, destCard: 0 } }); continue; }
      const col = column(s, userId, action);
      if (!col) continue;
      if (action.type === 'discard' || action.type === 'declare') items.push({ kind: action.type, code: col.cards[0]! });
      else items.push({ kind: 'meld', column: col, destCard: col.cards[0] ?? 0 });
    }
    const result = originalChoices(seatIndex, hand.map(id => codeFor(s, id)), items);
    // 出牌选项带上可胡提示（原版收到出牌选项时重置提示表）。
    const tips = options.jiaoTishi ? options.jiaoTishi(s, userId).filter(tip => tip.chuCard !== 0) : [];
    if (tips.length) for (const item of result) if (item.actType === ACT.discard) item.jiaoTishi = tips;
    return result;
  }

  function meldColumns(s: RoundState, player: RoundPlayer) {
    return player.melds.map((meld, index) => ({
      id: player.seat * 10 + index + 1, seatIndex: player.seat,
      actType: meld.kind === 'gang' || meld.kind === 'ba' ? ACT.gang : meld.kind === 'peng' ? ACT.peng : meld.kind === 'tou' ? ACT.tou : ACT.chi,
      colType: meld.kind === 'ba' ? COL.gangBa : meld.kind === 'gang' ? COL.gangMing : meld.kind === 'peng' ? COL.peng : meld.kind === 'tou' ? COL.tou : COL.chi,
      cards: meld.cardIds.map(id => codeFor(s, id)),
    }));
  }

  /** 每局小结算：手牌（赢家带胡的那张）、摆出的牌、鬼、番型、番数、红黑点（E2）。昵称由连接层按房间成员补上。 */
  function smallResult(s: RoundState) {
    const outcome = s.outcome!;
    const winners = new Set((outcome.winners ?? []).map(winner => winner.userId));
    const huCard = outcome.sourceCardId ? codeFor(s, outcome.sourceCardId) : 0;
    return { resetCard: [], resetCardNum: 0, huType: 0, userBrand: outcome.payments.postings.map(posting => {
      const player = s.players.find(item => item.userId === posting.userId)!;
      const hand = ids(s, `hand:${player.userId}`).map(id => codeFor(s, id));
      const won = winners.has(player.userId);
      const brand = options.settlement!(s, player.userId);
      return { seatIndex: player.seat, tilesOnHand: won && huCard ? [...hand, huCard] : hand, chuList: [],
        protectCards: ids(s, `bonus:${player.userId}`).map(id => codeFor(s, id)), baijiaoCard: [], huCard: won ? huCard : 0,
        colInfo: meldColumns(s, player), destIndex: 0, cardType: brand.cardType, fanNum: brand.fanNum, huOrder: won ? 1 : 0,
        pointNum: brand.pointNum, baoTing: false, blackPoint: brand.blackPoint, scoreInfo: [], chaoGuoFanNum: 0 };
    }) };
  }

  function gameOver(s: RoundState): EngineOriginalBody {
    const outcome = s.outcome!;
    return { body: { result: outcome.reason === 'hu' ? 1 : 2,
      userScoreInfo: outcome.payments.postings.map(posting => ({
        uid: posting.userId, nick: posting.userId, seatIndex: seatOf(s, posting.userId),
        score: posting.amount, changeScore: posting.amount,
      })), smallResult: options.settlement ? smallResult(s) : null, bigResult: [],
      ...(options.settlement ? { isHuang: outcome.reason !== 'hu', round: s.number, allRound: Number(s.rules?.gameNum ?? 0),
        dealerSeat: seatOf(s, s.dealerId), xiaoSeat: 0 } : {}) },
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
          ...pointsFor(s, player.userId, userId), auto: false, isPiao: player.piao === 1,
        })),
        cardInfo: [],
      } } };
  }

  /** 这一手的选项和倒计时。自己有按钮时钟在自己（以前不发给自己，轮到自己钟还停在上一家，11-01 测试台）；
   *  没按钮时钟在当前那家，别人能不能吃碰不外露。原版钟在选项之后摆，跟着按钮宽度挪位置。 */
  function turnPackets(s: RoundState, userId: string): EngineOriginalPacket[] {
    const own = choices(s, userId);
    const packets: EngineOriginalPacket[] = own.length ? [{ command: MSGEvent.HWNotifySeatOperationChoice, body: { choices: own } }] : [];
    if (s.phase !== 'finished') packets.push({ command: MSGEvent.HWNotifyNextOperation,
      body: { seatIndex: own.length ? seatOf(s, userId) : seatOf(s, s.activeId), leftCardNum: ids(s, 'deck').length, autoIntoSecond: options.turnSeconds?.(s) ?? 0 } });
    return packets;
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
      return { type: 'original', ...originalRequest(body), decisionId };
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
    ...(options.jiaoTishi ? { jiaoTishi: (snapshot: unknown, userId: string) =>
      options.jiaoTishi!(state(snapshot), userId).find(tip => tip.chuCard === 0)?.huInfo ?? [] } : {}),
    enter(snapshot, userId) { return enterBody(snapshot, userId); },
    notifications(snapshot, events, userId, phase): EngineOriginalPacket[] {
      const s = state(snapshot);
      if (phase === 'start') {
        // 开局庄家先出牌：只发开局不发选项，庄家看不到出牌提示和倒计时，15 秒后被托管打掉一张（10-31 本机试玩）。
        // 开局摸鬼补牌已经体现在开局手牌和鬼牌区里，这里不再重播。
        const packets: EngineOriginalPacket[] = [{ command: MSGEvent.HWNotifyGameStart,
          body: (enterBody(snapshot, userId).body as { gameStart: Record<string, unknown> }).gameStart }];
        packets.push(...turnPackets(s, userId));
        return packets;
      }
      const packets: EngineOriginalPacket[] = [];
      // 只播这一步的事件。以前没事件（比如有人点「过」）时会把开局摸鬼、偷牌重播一遍，
      // 客户端手里多出牌、冒出点了是空的「偷」按钮（10-31 本机试玩）。开局的选项已随开局一起发。
      const visible = events as { type: string; [key: string]: unknown }[];
      // 某一刻的鬼牌区：最终的鬼减去本批之后才摸到的鬼。
      const protectAt = (playerId: string, index: number) => {
        const codes = ids(s, `bonus:${playerId}`).map(id => codeFor(s, id));
        for (const later of visible.slice(index + 1)) if (later.type === 'bonus' && later.userId === playerId) {
          const at = codes.indexOf((later.card as { code: number }).code); if (at >= 0) codes.splice(at, 1);
        }
        return codes;
      };
      for (const [index, raw] of visible.entries()) {
        if (raw.type === 'round-ended') {
          // 先播原版「胡」动作，再弹结算（E1）；原版结算窗自己会等 1.5 秒或番型特效播完。
          if (options.settlement) for (const winner of s.outcome?.winners ?? []) packets.push({ command: MSGEvent.HWNotifyActionFlow, body: { action: {
            seatIndex: seatOf(s, winner.userId), actType: ACT.hu, destCard: s.outcome?.sourceCardId ? codeFor(s, s.outcome.sourceCardId) : 0,
            destCardIsOwn: userId === winner.userId, leftCardNum: ids(s, 'deck').length,
            tilesOnHandNum: ids(s, `hand:${winner.userId}`).length, huNumber: 1,
            // 原版按胡动作的番型播特效：全红→红胡、全黑→黑胡、天胡、地胡。
            cardType: options.settlement!(s, winner.userId).cardType } } });
          packets.push({ command: MSGEvent.HWNotifyGameOver, ...gameOver(s) }); continue;
        }
        if (raw.type === 'discard') {
          const card = raw.card as { code: number };
          // 报叫：先播原版报叫（语音、火焰、「报」字），再照常出牌（E6）。
          if (raw.declared) packets.push({ command: MSGEvent.HWNotifyActionFlow, body: { action: {
            seatIndex: seatOf(s, String(raw.userId)), actType: ACT.declare, destCard: card.code, destCardIsOwn: userId === raw.userId } } });
          packets.push({ command: MSGEvent.HWNotifyActionFlow, body: { action: {
            seatIndex: seatOf(s, String(raw.userId)), actType: ACT.discard, destCard: card.code,
            destCardIsOwn: userId === raw.userId, leftCardNum: ids(s, 'deck').length,
            tilesOnHandNum: ids(s, `hand:${raw.userId}`).length - 1, ...pointsFor(s, String(raw.userId), userId),
          } } });
          continue;
        }
        if (raw.type === 'meld') {
          const meld = raw as unknown as { kind: string; userId: string; cards: { id: string; code: number }[]; addedCardId?: string };
          // 组合带上和小结算一样的 id：原版按 id 认组合，不带的话第二个组合被当成第一个跳过（手里牌也不拿掉）。
          // 巴是往已有组合上加一张：新 id + addToId 指向那个组合，只带加上去的牌。
          const owner = s.players.find(p => p.userId === meld.userId)!;
          const added = meld.kind === 'ba' ? meld.addedCardId ?? meld.cards.at(-1)?.id : undefined;
          const meldIndex = owner.melds.findIndex(m => m.cardIds.includes(added ?? meld.cards[0]?.id ?? ''));
          const columnId = owner.seat * 10 + meldIndex + 1;
          const codes = added ? [codeFor(s, added)] : meld.cards.map(card => card.code);
          const column = meldIndex < 0 ? {} : added ? { id: 1000 + columnId, addToId: columnId } : { id: columnId };
          const actType = meld.kind === 'chi' ? ACT.chi : meld.kind === 'peng' ? ACT.peng
            : meld.kind === 'tou' ? ACT.tou : ACT.gang;
          const colType = meld.kind === 'chi' ? COL.chi : meld.kind === 'peng' ? COL.peng
            : meld.kind === 'tou' ? COL.tou : meld.kind === 'ba' ? COL.gangBa : COL.gangMing;
          packets.push({ command: MSGEvent.HWNotifyActionFlow, body: { action: {
            seatIndex: seatOf(s, meld.userId), actType, destCard: codes[0] ?? 0,
            colInfo: [{ ...column, seatIndex: seatOf(s, meld.userId), actType, colType, cards: codes,
              destCard: codes[0] ?? 0, destCardIsOwn: userId === meld.userId }],
            tilesOnHandNum: ids(s, `hand:${meld.userId}`).length, ...pointsFor(s, meld.userId, userId),
            // 原版偷、杠动作都会用 protectCard 覆盖鬼牌区，要带上已有的鬼。
            ...(actType === ACT.tou || actType === ACT.gang ? { protectCard: protectAt(meld.userId, index), useCard: [] } : {}),
          } } });
          continue;
        }
        if (raw.type === 'replacement' && raw.userId !== userId) continue;
        if (raw.type === 'flip' || raw.type === 'replacement') {
          packets.push({ command: MSGEvent.HWNotifyPlayerDealCard, body: {
            seatIndex: seatOf(s, String(raw.userId)),
            value: Number((raw.card as { code?: number } | undefined)?.code ?? 0),
            isFanPai: raw.type === 'flip', leftCardNum: ids(s, 'deck').length,
            tilesOnHandNum: ids(s, `hand:${raw.userId}`).length, pointNum: pointsFor(s, String(raw.userId), userId).redPoint,
            // 摸鬼后补的牌进本人手里：原版只认 isShangShou 才把牌加进手牌，否则只亮一下，手里少一张（11-01 本机试玩）。
            blackPoint: pointsFor(s, String(raw.userId), userId).blackPoint, isShangShou: raw.type === 'replacement',
            // 进手的牌原版还要 isShua 才重画手牌（protobuf 默认 false）；不带的话偷、摸鬼后手里还显示旧牌（11-01 测试台）。
            ...(raw.type === 'replacement' ? { isShua: true } : {}) } });
        }
        if (raw.type === 'bonus') packets.push({ command: MSGEvent.HWNotifyPlayerDealCard, body: {
          seatIndex: seatOf(s, String(raw.userId)), value: (raw.card as { code: number }).code,
          isFanPai: false, leftCardNum: ids(s, 'deck').length,
          tilesOnHandNum: ids(s, `hand:${raw.userId}`).length, isShangShou: false } });
        // 摸到鬼：原版「偷」动作把它从手里挪到鬼牌区，播偷字横幅和语音（E4）。
        if (raw.type === 'bonus') packets.push({ command: MSGEvent.HWNotifyActionFlow, body: { action: {
          seatIndex: seatOf(s, String(raw.userId)), actType: ACT.tou, destCard: (raw.card as { code: number }).code,
          destCardIsOwn: userId === raw.userId, protectCard: protectAt(String(raw.userId), index),
          useCard: [(raw.card as { code: number }).code], colInfo: [], leftCardNum: ids(s, 'deck').length } } });
      }
      packets.push(...turnPackets(s, userId));
      return packets;
    },
  };
}
