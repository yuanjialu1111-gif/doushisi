import assert from 'node:assert/strict';
import { getDefaultOptions, freezeScoreRegionOptions } from '../packages/rules/src/index.ts';
import { createScoreRegionEngine } from '../apps/server/src/game/score-region-engine.ts';

function rules(key, overrides = {}) {
  const base = { ...getDefaultOptions(key), playerNum: 2, gameNum: 4, baseBeans: '0.125', ...overrides };
  return { ...base, scoreRegion: freezeScoreRegionOptions(base, key) };
}
function engineFor(key, overrides = {}) {
  const engine = createScoreRegionEngine(`probe:${key}`, key, () => 0);
  const snapshot = engine.create({ players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a', number: 1, rules: rules(key, overrides),
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } });
  return { engine, snapshot };
}
function cardPools(snapshot) {
  const byCode = new Map();
  for (const card of snapshot.cards.pack) byCode.set(card.code, [...(byCode.get(card.code) ?? []), card]);
  return byCode;
}
function allocator(snapshot) {
  const pools = cardPools(snapshot); const used = new Set();
  return codes => codes.map((code, index) => {
    const card = (pools.get(code) ?? []).find(candidate => !used.has(candidate.id));
    assert.ok(card, `missing ${code} at ${index}`); used.add(card.id); return card;
  });
}
function automaticBonus(snapshot, code) {
  if (['25:0', '27:0'].includes(snapshot.variantKey)) return code === 1003 && snapshot.rules.wangNum === 0;
  if (['23:0', '26:0'].includes(snapshot.variantKey)) return [1001, 1002, 1003].includes(code) && snapshot.rules.wangNum === 0;
  return false;
}
function setZones(snapshot, { handA, handB, meldsA = [], meldsB = [], bonusesA = [], bonusesB = [],
  table = [], discards = [], deck = null }) {
  const next = structuredClone(snapshot);
  const zones = [
    { id: 'deck', visibility: 'hidden', cards: [] },
    { id: 'table', visibility: 'public', cards: [...table] },
    { id: 'discards', visibility: 'public', cards: [...discards] },
    ...next.players.flatMap(player => [
      { id: `hand:${player.userId}`, visibility: 'private', ownerId: player.userId,
        cards: player.userId === 'a' ? [...handA] : [...handB] },
      { id: `melds:${player.userId}`, visibility: 'public', ownerId: player.userId,
        cards: (player.userId === 'a' ? meldsA : meldsB).flatMap(meld => meld.cardIds) },
      { id: `bonus:${player.userId}`, visibility: 'public', ownerId: player.userId,
        cards: player.userId === 'a' ? [...bonusesA] : [...bonusesB] },
    ]),
  ];
  const placed = new Set(zones.flatMap(zone => zone.cards));
  const nextDeck = deck ?? next.cards.pack.map(card => card.id).filter(id => !placed.has(id));
  zones[0].cards = [...nextDeck];
  const all = zones.flatMap(zone => zone.cards);
  assert.equal(all.length, next.cards.pack.length, 'zone count');
  assert.equal(new Set(all).size, next.cards.pack.length, 'zone unique');
  next.cards.zones = zones;
  return next;
}
function setMelds(snapshot, melds) {
  const next = structuredClone(snapshot);
  for (const player of next.players) player.melds = (melds[player.userId] ?? []).map(meld => ({ ...meld }));
  return next;
}
function action(engine, snapshot, userId, predicate, label) {
  const found = engine.interactions.legalActions(snapshot, userId).find(predicate);
  assert.ok(found, label); return found;
}
function apply(engine, snapshot, userId, selected, label) {
  const result = engine.apply(snapshot, userId, selected);
  assert.ok(result.snapshot, label); return result;
}
function finish(engine, snapshot, steps, label) {
  let current = snapshot; let result = null;
  for (const step of steps) {
    const selected = typeof step.action === 'function' ? step.action(current) : step.action;
    result = apply(engine, current, step.userId, selected, `${label}:${step.name}`);
    current = result.snapshot;
  }
  assert.equal(current.phase, 'finished', `${label}:phase`);
  assert.ok(result?.settlement, `${label}:settlement`);
  return { result, current };
}
function choose(snapshot, used, count) {
  const result = [];
  for (const card of snapshot.cards.pack) {
    if (used.has(card.id) || automaticBonus(snapshot, card.code)) continue;
    result.push(card.id); if (result.length === count) return result;
  }
  assert.fail('not enough opponent cards');
}
function responseDiscard(engine, snapshot, incomingCode, handA, pattern, label) {
  const take = allocator(snapshot);
  const incoming = take([incomingCode])[0];
  const a = take(handA);
  const used = new Set([incoming, ...a].map(card => card.id));
  const b = [incoming.id, ...choose(snapshot, used, 7)];
  let next = setZones(snapshot, { handA: a.map(card => card.id), handB: b });
  next.phase = 'discard'; next.activeId = 'b'; next.source = null; next.serial = 0; next.claims = null; next.outcome = null;
  const discard = action(engine, next, 'b', item => item.type === 'discard' && item.cardId === incoming.id, `${label}:discard`);
  const result = finish(engine, next, [
    { userId: 'b', action: discard, name: 'discard' },
    { userId: 'a', action: current => action(engine, current, 'a', item => item.type === 'respond' && item.choiceId !== null &&
      current.claims.offers.find(offer => offer.id === item.choiceId)?.action?.type === 'hu', `${label}:hu`), name: 'hu' },
  ], label);
  const winner = result.current.outcome.winners.find(item => item.userId === 'a');
  assert.ok(winner?.win.items.some(item => item.pattern === pattern), `${label}:${pattern}`);
  return result;
}

function replacementResponse(engine, snapshot, handA, gangCodes, incomingCode, pattern, label) {
  const take = allocator(snapshot);
  const gang = take(gangCodes);
  const incoming = take([incomingCode])[0];
  const a = take(handA);
  const used = new Set([...gang, incoming, ...a].map(card => card.id));
  const filler = snapshot.cards.pack.find(card => !used.has(card.id) && !automaticBonus(snapshot, card.code)).id;
  const handB = [...gang.map(card => card.id), filler];
  let next = setZones(snapshot, { handA: a.map(card => card.id), handB,
    deck: [incoming.id, ...snapshot.cards.pack.map(card => card.id).filter(id => id !== incoming.id && id !== filler && !a.some(c => c.id === id))] });
  next.phase = 'discard'; next.activeId = 'b'; next.source = null; next.serial = 0; next.claims = null; next.outcome = null;
  const gangAction = action(engine, next, 'b', item => item.type === 'gang' && item.cardIds.length === 4 &&
    item.cardIds.every(id => gang.some(card => card.id === id)), `${label}:gang`);
  const result = finish(engine, next, [
    { userId: 'b', action: gangAction, name: 'gang' },
    { userId: 'a', action: current => action(engine, current, 'a', item => item.type === 'respond' && item.choiceId !== null &&
      current.claims.offers.find(offer => offer.id === item.choiceId)?.action?.type === 'hu', `${label}:hu`), name: 'hu' },
  ], label);
  const winner = result.current.outcome.winners.find(item => item.userId === 'a');
  assert.ok(winner?.win.items.some(item => item.pattern === pattern), `${label}:${pattern}`);
  return result;
}

const results = [];
for (const key of ['25:0', '27:0']) {
  const overrides = { da_7hong_7hei: 1, daShaQiangHu: 0, qiang_7Hu: 0, yiDianZhu: 0, menQing: 0, haiDiLao: 0, ziQiangHu: 0 };
  const { engine, snapshot } = engineFor(key, overrides);
  const take = allocator(snapshot);
  const pair = take([110, 204]);
  const meldCodes = [[105,205,305,405],[106,206,306,406],[107,207,307,407]];
  const meldCards = meldCodes.map(codes => take(codes));
  const melds = meldCards.map(cards => ({ kind: 'gang', cardIds: cards.map(card => card.id) }));
  const used = new Set([...pair, ...meldCards.flat()].map(card => card.id));
  const b = choose(snapshot, used, 8);
  const incoming = b[0];
  let next = setMelds(setZones(snapshot, { handA: pair.map(card => card.id), handB: b, meldsA: melds }), { a: melds });
  next.phase = 'discard'; next.activeId = 'b'; next.source = null; next.serial = 0; next.claims = null; next.outcome = null;
  next.rules.__discards = 0;
  const discard = action(engine, next, 'b', item => item.type === 'discard' && item.cardId === incoming, `${key}:seven discard`);
  const r = finish(engine, next, [{ userId:'b', action:discard, name:'discard' }, { userId:'a', action: current => action(engine,current,'a',item => item.type==='respond' && item.choiceId!==null && current.claims.offers.find(o=>o.id===item.choiceId)?.action?.type==='hu', `${key}:seven hu`), name:'hu' }], `${key}:seven`);
  const winner = r.current.outcome.winners.find(item => item.userId === 'a');
  results.push({ key, case:'sevenRedSevenBlack', pattern:winner.win.items.map(x=>x.pattern), scoreUnits:winner.win.scoreUnits });
}

for (const key of ['25:0', '27:0']) {
  const overrides = { da_7hong_7hei: 0, daShaQiangHu: 1, qiang_7Hu: 0, yiDianZhu: 0, menQing: 0 };
  const { engine, snapshot } = engineFor(key, overrides);
  const r = replacementResponse(engine, snapshot, [110,204,109,405,108,406,207], [101,201,301,401], 107, 'qiangHu', `${key}:qiang-hu`);
  const winner = r.current.outcome.winners.find(item => item.userId === 'a');
  results.push({ key, case:'qiangHu', scoreUnits:winner.win.scoreUnits });
}

for (const key of ['25:0', '27:0']) {
  const overrides = { da_7hong_7hei: 0, daShaQiangHu: 0, qiang_7Hu: 1, yiDianZhu: 0, menQing: 0 };
  const { engine, snapshot } = engineFor(key, overrides);
  const r = replacementResponse(engine, snapshot, [110,204,109,405,108,406,207], [101,201,301,401], 107, 'qiang7', `${key}:qiang-seven`);
  const winner = r.current.outcome.winners.find(item => item.userId === 'a');
  results.push({ key, case:'qiang7', scoreUnits:winner.win.scoreUnits });
}

for (const key of ['25:0', '27:0']) {
  const overrides = { da_7hong_7hei: 0, yiDianZhu: 1, menQing: 0 };
  const { engine, snapshot } = engineFor(key, overrides);
  const r = responseDiscard(engine, snapshot, 110, [210,209,405,208,406,207,407], 'oneRed', `${key}:one-red`);
  const winner = r.current.outcome.winners.find(item => item.userId === 'a');
  results.push({ key, case:'oneRed', scoreUnits:winner.win.scoreUnits });
}

{
  const key='26:0'; const overrides={ wangNum:3, qiWangNum:8, maxFan:4, anDui:1, siGuiYi:0, gangPao:0, gangHua:0 };
  const {engine,snapshot}=engineFor(key,overrides);
  const r=responseDiscard(engine,snapshot,310,[105,205,305,405,109,209,110],'anDui',`${key}:an-dui`);
  const winner=r.current.outcome.winners.find(item=>item.userId==='a');
  results.push({key,case:'anDui',scoreUnits:winner.win.scoreUnits});
}
console.log(JSON.stringify(results,null,2));
