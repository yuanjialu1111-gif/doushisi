import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../client/public/assets/dss/index.js', import.meta.url), 'utf8');
function method(name, next, context) {
  const start = source.indexOf(name + ': function(');
  const end = source.indexOf(',\n' + next + ': function(', start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext('(' + source.slice(start + name.length + 2, end) + ')', context);
}
function harness() {
  const pending = [], rendered = [], created = [], effects = [];
  const face = { node: {}, setSkin() {}, setAnimation() {} };
  Object.defineProperty(face, 'skeletonData', { set(value) { rendered.push(value); } });
  const cc = {
    loader: { loadRes(path, type, callback) { pending.push(callback); } },
    isValid: value => !!value && !value.destroyed,
    instantiate(asset) {
      created.push(asset);
      const effect = { animations: [], removals: 0, destructions: 0, setPosition() {},
        runAction(actions) { this.arrived = actions.at(-1); },
        removeFromParent() { this.removals++; }, destroy() { this.destroyed = true; this.destructions++; } };
      effect.getComponent = () => ({ setCompleteListener(callback) { effect.completed = callback; }, setAnimation(...args) { effect.animations.push(args); } });
      effects.push(effect); return effect;
    },
    sequence(...actions) { return actions; }, moveTo() {}, callFunc(callback) { return callback; },
  };
  const context = { cc, sp: { Skeleton: 'skeleton' }, o: { playMagicFace() {} } };
  const player = { _model: {}, node: { getChildByName: () => ({ getComponent: () => face }) } };
  const game = { node: { addChild() {} }, model: {}, players: [{ _model: {} }, { _model: {} }], views: { 'palyers/pos0': { getPosition() {} }, 'palyers/pos1': { getPosition() {} } } };
  return { pending, rendered, created, effects, player, game, show: method('onShowFace', 'onShowText', context), move: method('_moveEffect', 'getLeft', context) };
}
test('a late earlier expression cannot replace the newer expression', () => {
  const h = harness();
  h.show.call(h.player, { message: 'res_dss_chat_0' });
  h.show.call(h.player, { message: 'res_dss_chat_1' });
  h.pending[1](null, 'new'); h.pending[0](null, 'old');
  assert.deepEqual(h.rendered, ['new']);
});
test('failed, destroyed and reseated expression owners never render', () => {
  for (const state of ['error', 'destroyed', 'reseated']) {
    const h = harness(); h.show.call(h.player, { message: 'res_dss_chat_0' });
    if (state === 'destroyed') h.player.node.destroyed = true;
    if (state === 'reseated') h.player._model = {};
    h.pending[0](state === 'error' ? new Error('missing') : null, 'asset');
    assert.deepEqual(h.rendered, []);
  }
});
test('interactions load only while their source, target and room still exist', () => {
  for (const state of ['valid', 'error', 'destroyed', 'new-room', 'new-target', 'new-source', 'reused-target']) {
    const h = harness(); h.move.call(h.game, 0, 1, 2);
    if (state === 'destroyed') h.game.node.destroyed = true;
    if (state === 'new-room') h.game.model = {};
    if (state === 'new-target') h.game.players[1] = {};
    if (state === 'new-source') h.game.players[0] = {};
    if (state === 'reused-target') h.game.players[1]._model = {};
    h.pending[0](state === 'error' ? new Error('missing') : null, 'prefab');
    assert.deepEqual(h.created, state === 'valid' ? ['prefab'] : []);
  }
});

test('an interaction that becomes stale during movement is removed without playing its animation', () => {
  for (const state of ['room-destroyed', 'new-room', 'target-left', 'source-left', 'reused-target', 'node-destroyed']) {
    const h = harness(); h.move.call(h.game, 0, 1, 2); h.pending[0](null, 'prefab');
    const effect = h.effects[0];
    if (state === 'room-destroyed') h.game.node.destroyed = true;
    if (state === 'new-room') h.game.model = {};
    if (state === 'target-left') delete h.game.players[1];
    if (state === 'source-left') delete h.game.players[0];
    if (state === 'reused-target') h.game.players[1]._model = {};
    if (state === 'node-destroyed') effect.destroy();
    effect.arrived();
    assert.deepEqual(effect.animations, [], state);
    assert.equal(effect.destructions, 1, state);
    effect.completed();
    assert.equal(effect.destructions, 1, state);
  }
});

test('a current interaction starts its original animation and removes itself only once', () => {
  const h = harness(); h.move.call(h.game, 0, 1, 2); h.pending[0](null, 'prefab');
  const effect = h.effects[0]; effect.arrived();
  assert.deepEqual(effect.animations, [[1, 'animation', false]]);
  effect.completed(); effect.completed();
  assert.equal(effect.removals, 1); assert.equal(effect.destructions, 1);
});
