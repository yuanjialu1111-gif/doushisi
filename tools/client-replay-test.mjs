import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(project, 'client/public/standalone-replay.js'), 'utf8');
const roomId = '13ab7a47-f46b-4c0c-84f7-5b187fbca2d9';
const roundId = '208923d8-e29e-4ddd-9f51-399fc480c43e';
const path = `/api/records/${roomId}/replay/${roundId}/original`;
const digest = 'a'.repeat(64);
const reference = { version: 1, roomId, roundId, manifestUrl: path };
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
function packet(command, body = {}) { return { command, body, decimalFields: [] }; }
function frame(index, options = {}) {
  return { index, sequence: String(index), stateVersion: index, at: '2026-09-08T00:00:00.000Z', autoPlay: false,
    snapshot: packet(48, { fixtureIndex: index, seatIndex: 1, choice: { action: 'must not be restored' },
      tableInfo: { roomId: 123456, playerNum: 2 }, userInfo: [{ uid: '1001', seatIndex: 1 }, { uid: '1002', seatIndex: 2 }],
      gameStart: { seats: [{ seatIndex: 1, auto: false }, { seatIndex: 2, auto: true }] } }),
    packets: [packet(25, { fixtureIndex: index })], ...options };
}
function manifest(count = 4, options = {}) {
  return { version: 1, roomId, roundId, ruleVersion: 'fixture-v1', variantKey: '2:0', digest, frameCount: count,
    framesUrl: path + '/frames', initial: frame(0), limits: { maxPageFrames: 50, maxPageBytes: 1048576 }, ...options };
}
function page(offset, frames, count = 4, options = {}) {
  return { version: 1, digest, frameCount: count, offset, frames, nextOffset: offset + frames.length < count ? offset + frames.length : null, ...options };
}
function harness() {
  const requests = [], emissions = [], prompts = [], closedWindows = [], pushedUsers = [], generatedPackets = [];
  const render = { selfAuto: false, otherAuto: true, snapshotIndex: null };
  let liveRoom = false, startupError = false, checks = 0, clears = 0;
  class XMLHttpRequest {
    constructor() { this.headers = {}; this.status = 0; this.responseText = ''; }
    open(method, url, asynchronous) { this.method = method; this.url = url; this.asynchronous = asynchronous; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send() { requests.push(this); }
    reply(value, status = 200) { this.status = status; this.responseText = JSON.stringify(value); this.onload(); }
    fail() { this.onerror(); }
  }
  const context = { XMLHttpRequest, Standalone: { config: { apiBase: 'https://game.example' }, hasLiveRoom: () => liveRoom } };
  context.window = context;
  const component = function () {};
  const server = { _msgActList: [], _colTime: 0, _lastStageTime: 0 };
  context.cc = { Slider: component, Sprite: component, Label: component,
    sys: { localStorage: { getItem: key => key === 'GAME_TOKEN' ? 'fixture-token' : null } }, mm: {
      server, msgEvent: { HWNotifyActionFlow: 25, HWNotifyNextOperation: 26, HWNotifyGameOver: 28, HWNotifyPlayerDealCard: 32, HWNotifyAuto: 123, HWResponseCancelAuto: 126 },
      frametype: { MSG_NOTICE_CMD: 'command-' }, framemodel: { uid: '1001' },
      uimanager: { showTextPrompt: text => prompts.push(text), closewindow: name => closedWindows.push(name), getWindow: () => null },
      netTools: { replayPacket: value => { generatedPackets.push(clone(value)); return { code: value.command, body: clone(value.body) }; } },
      notification: { emit: (name, body, command) => {
        emissions.push({ name, body: clone(body), command });
        if (command === 48) {
          render.snapshotIndex = body.fixtureIndex;
          render.selfAuto = !!body.gameStart.seats[0].auto;
          render.otherAuto = !!body.gameStart.seats[1].auto;
        }
        if (command === 123) render.selfAuto = true;
        if (command === 126) render.selfAuto = false;
      } },
      gameserver: {
        clear: () => { clears++; context.StandaloneReplay.clear(); pushedUsers.length = 0; },
        pushUser: user => pushedUsers.push(user), setActionList: () => {},
        checkData: () => { checks++; if (startupError) throw new Error('fixture startup failed'); },
      },
    } };
  vm.runInNewContext(source, context, { filename: 'standalone-replay.js' });
  const api = context.StandaloneReplay;
  function controller() {
    const pending = [], views = {};
    for (const key of ['slider', 'slider/bar', 'label', 'bofang/zanting', 'bofang/bofang', 'tohall', 'replay']) {
      const value = { progress: 0, fillRange: 0, string: '' };
      views[key] = { active: false, getComponent: () => value };
    }
    return { views, speed: 1, playtime: 2, maxSpeed: 8, isPlay: false, pending, cancellations: 0,
      scheduleOnce(callback, delay) { pending.push({ callback, delay }); },
      unscheduleAllCallbacks() { this.cancellations++; pending.length = 0; },
      runNext() { const next = pending.shift(); assert.ok(next, 'A replay step should be scheduled'); next.callback(); return next.delay; },
    };
  }
  async function load(value = manifest()) {
    const result = api.load(clone(reference));
    requests.at(-1).reply(value);
    assert.equal(await result, true);
    return value;
  }
  return { context, api, requests, emissions, prompts, server, render, closedWindows, pushedUsers, generatedPackets, controller, load,
    setLiveRoom: value => { liveRoom = value; }, setStartupError: value => { startupError = value; }, counts: () => ({ checks, clears }) };
}

test('manifest binds identity, authentication, version and bounded replay metadata', async () => {
  const h = harness();
  assert.equal(await h.api.load({ ...reference, roundId: '../bad' }), false);
  assert.equal(h.requests.length, 0);
  h.setLiveRoom(true);
  assert.equal(await h.api.load(reference), false);
  assert.equal(h.requests.length, 0);
  h.setLiveRoom(false);
  await h.load();
  assert.equal(h.requests[0].url, 'https://game.example' + path);
  assert.equal(h.requests[0].method, 'GET');
  assert.equal(h.requests[0].headers.Authorization, 'Bearer fixture-token');
  assert.equal(h.requests[0].timeout, 15000);
  assert.equal(h.pushedUsers.length, 2);
  assert.equal(h.api.active(), true);
  assert.deepEqual(h.counts(), { checks: 1, clears: 1 });
});

test('invalid manifests never create a replay or enter the original room renderer', async t => {
  const cases = {
    identity: { roomId: roundId }, version: { version: 2 }, digest: { digest: 'x'.repeat(64) },
    remotePage: { framesUrl: 'https://other.example/frames' }, wrongRoundPage: { framesUrl: path.replace(roundId, roomId) + '/frames' },
    noFrames: { frameCount: 0 }, tooManyFrames: { frameCount: 10002 }, wrongLimits: { limits: { maxPageFrames: 100, maxPageBytes: 1048576 } },
    initialIndex: { initial: frame(1) }, requestSnapshot: { initial: frame(0, { snapshot: packet(53) }) },
    invalidAutoPlay: { initial: frame(0, { autoPlay: 'yes' }) }, incompleteSeats: { initial: frame(0, { snapshot: packet(48, { tableInfo: {}, userInfo: [] }) }) },
  };
  for (const [name, changes] of Object.entries(cases)) await t.test(name, async () => {
    const h = harness(), result = h.api.load(reference);
    h.requests[0].reply(manifest(4, changes));
    assert.equal(await result, false);
    assert.equal(h.api.active(), false);
    assert.equal(h.counts().checks, 0);
    assert.equal(h.prompts.length, 1);
  });
});

test('page responses must match the digest, offset, frame sequence and declared length', async t => {
  const cases = {
    digest: value => { value.digest = 'b'.repeat(64); }, version: value => { value.version = 2; },
    offset: value => { value.offset = 2; }, count: value => { value.frameCount = 9; },
    nextOffset: value => { value.nextOffset = 3; }, empty: value => { value.frames = []; },
    frameIndex: value => { value.frames[0].index = 2; }, frameVersion: value => { value.frames[0].stateVersion = -1; },
    requestPacket: value => { value.frames[0].packets = [packet(53)]; }, tooManyPackets: value => { value.frames[0].packets = Array.from({ length: 101 }, () => packet(25)); },
    oversizedFrame: value => { value.frames[0].snapshot.body.padding = 'x'.repeat(262145); },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async () => {
    const h = harness(); await h.load();
    const c = h.controller(); h.api.attach(c); c.runNext();
    const response = page(1, [frame(1)]); change(response);
    h.requests[1].reply(response); await flush();
    assert.equal(c.isPlay, false);
    assert.equal(c.pending.length, 0);
    assert.equal(h.server._msgActList.length, 0);
    assert.equal(h.render.snapshotIndex, 0);
    assert.equal(h.prompts.length, 1);
    assert.equal(h.requests[1].url, 'https://game.example' + path + '/frames?digest=' + digest + '&offset=1&limit=50');
  });
});

test('a cached page plays in order without one network request per frame', async () => {
  const h = harness(); await h.load(manifest(52));
  const c = h.controller(); h.api.attach(c); c.runNext();
  h.requests[1].reply(page(1, Array.from({ length: 50 }, (_, index) => frame(index + 1)), 52));
  await flush();
  for (let index = 2; index <= 50; index++) { c.runNext(); await flush(); }
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.server._msgActList.map(message => message.body.fixtureIndex), Array.from({ length: 50 }, (_, index) => index + 1));
  assert.ok(h.server._msgActList.every(message => h.api.isCurrent(message.replayGeneration)));
  c.runNext();
  assert.ok(h.requests[2].url.includes('offset=51'));
  h.requests[2].reply(page(51, [frame(51)], 52)); await flush();
  assert.equal(c.isPlay, false);
  assert.equal(c.views.slider.getComponent().progress, 1);
  assert.equal(c.views.tohall.active, true);
  assert.equal(c.views.replay.active, true);
});

test('pause cancels scheduled work and a pending response cannot advance a paused replay', async () => {
  const h = harness(); await h.load();
  const c = h.controller(); h.api.attach(c); c.runNext();
  assert.equal(h.api.handle(c, 'toggle'), true);
  assert.equal(c.isPlay, false);
  h.requests[1].reply(page(1, [frame(1)])); await flush();
  assert.equal(h.server._msgActList.length, 0);
  assert.equal(c.views.slider.getComponent().progress, 0);
  assert.equal(c.pending.length, 0);
  h.api.handle(c, 'toggle'); c.runNext(); await flush();
  assert.equal(h.server._msgActList[0].body.fixtureIndex, 1);
  assert.equal(h.requests.length, 2);
});

test('speed changes replace the timer, clamp to original limits and retain progress', async () => {
  const h = harness(); await h.load();
  const c = h.controller(); h.api.attach(c);
  assert.equal(c.pending[0].delay, 2);
  for (let index = 0; index < 12; index++) h.api.handle(c, 'faster');
  assert.equal(c.speed, 8); assert.equal(c.pending.length, 1); assert.equal(c.pending[0].delay, 0.25);
  assert.equal(c.views.label.getComponent().string, 'x8');
  for (let index = 0; index < 12; index++) h.api.handle(c, 'slower');
  assert.equal(c.speed, 1); assert.equal(c.pending.length, 1); assert.equal(c.pending[0].delay, 2);
  assert.equal(c.views.slider.getComponent().progress, 0);
  h.api.handle(c, 'toggle'); h.api.handle(c, 'faster');
  assert.equal(c.pending.length, 0, 'Changing speed must not unpause playback');
});

test('the newest seek wins even when page requests complete in reverse order', async () => {
  const h = harness(); await h.load(manifest(5));
  const c = h.controller(); h.api.attach(c); h.api.handle(c, 'toggle');
  h.api.handle(c, 'seek', { progress: 0.25 });
  h.api.handle(c, 'seek', { progress: 0.75 });
  h.requests[2].reply(page(3, [frame(3)], 5)); await flush();
  assert.equal(h.render.snapshotIndex, 3);
  h.requests[1].reply(page(1, [frame(1)], 5)); await flush();
  assert.equal(h.render.snapshotIndex, 3);
  assert.equal(c.views.slider.getComponent().progress, 0.75);
  assert.equal(c.isPlay, false);
  assert.equal(c.pending.length, 0);
  assert.ok(h.emissions.filter(event => event.command === 48).every(event => !Object.hasOwn(event.body, 'choice')));
});

test('seeking invalidates an in-flight animation step and coalesces identical frame requests', async () => {
  const h = harness(); await h.load(manifest(5));
  const c = h.controller(); h.api.attach(c); c.runNext();
  h.api.handle(c, 'seek', { progress: 0.75 }); h.api.handle(c, 'seek', { progress: 0.75 });
  assert.equal(h.requests.length, 3);
  h.requests[1].reply(page(1, [frame(1)], 5)); await flush();
  assert.equal(h.server._msgActList.length, 0);
  h.requests[2].reply(page(3, [frame(3)], 5)); await flush();
  assert.equal(h.render.snapshotIndex, 3);
  assert.equal(c.pending.length, 1);
});

test('exit removes only this replay queue and ignores late requests and old controls', async () => {
  const h = harness(); await h.load();
  const c = h.controller(); h.api.attach(c); c.runNext();
  const liveMessage = { code: 37, body: { fixture: 'live' } };
  h.server._msgActList.push(liveMessage, { replayGeneration: c._standaloneReplaySession.generation, code: 25 });
  h.server._colTime = 5; h.server._lastStageTime = 7;
  assert.equal(h.api.handle(c, 'home'), false, 'The original home controller must continue closing the window');
  assert.equal(h.api.active(), false); assert.equal(c.pending.length, 0);
  assert.deepEqual(h.server._msgActList, [liveMessage]);
  assert.equal(h.server._colTime, 0); assert.equal(h.server._lastStageTime, 0);
  const emitted = h.emissions.length;
  h.requests[1].reply(page(1, [frame(1)])); await flush();
  assert.equal(h.emissions.length, emitted); assert.equal(h.prompts.length, 0);
  assert.equal(h.api.handle(c, 'continue'), false);
  assert.equal(h.api.isCurrent(c._standaloneReplaySession.generation), false);
});

test('all gameplay writes remain blocked throughout replay and are restored after exit', async () => {
  const h = harness(); await h.load();
  for (const command of [1, 37, 305]) assert.equal(h.api.blocks(command), false);
  for (const command of [13, 17, 19, 23, 47, 53, 121, 125, 306, 999]) assert.equal(h.api.blocks(command), true, String(command));
  const c = h.controller(); h.api.attach(c); h.api.handle(c, 'toggle');
  assert.equal(h.api.blocks(53), true);
  h.api.clear();
  for (const command of [13, 23, 53, 121, 125]) assert.equal(h.api.blocks(command), false);
});

test('restart restores the initial snapshot without replaying old animations', async () => {
  const h = harness(); await h.load(manifest(2));
  const c = h.controller(); h.api.attach(c); c.runNext();
  h.requests[1].reply(page(1, [frame(1)], 2)); await flush();
  assert.equal(c.isPlay, false); assert.equal(h.server._msgActList.length, 1);
  h.api.handle(c, 'restart'); await flush();
  assert.equal(h.render.snapshotIndex, 0); assert.equal(h.server._msgActList.length, 0);
  assert.equal(c.isPlay, true); assert.equal(c.pending.length, 1);
  assert.equal(c.views.tohall.active, false);
  assert.equal(h.requests.length, 2);
});

test('snapshot-only and deal replacement frames apply an authoritative snapshot', async () => {
  for (const packets of [[], [packet(32)]]) {
    const h = harness(); await h.load(manifest(2));
    const c = h.controller(); h.api.attach(c); c.runNext();
    h.requests[1].reply(page(1, [frame(1, { packets })], 2)); await flush();
    assert.equal(h.render.snapshotIndex, 1);
    assert.equal(h.server._msgActList.length, 0);
    assert.ok(h.closedWindows.includes('dss_settle_UI') && h.closedWindows.includes('CommonBigResult'));
  }
});

test('self autoplay restores from each snapshot without changing another seat', async () => {
  const h = harness(); await h.load(manifest(3, { initial: frame(0, { autoPlay: true }) }));
  const c = h.controller(); h.api.attach(c);
  assert.equal(h.render.selfAuto, true, 'Initial frame.autoPlay must restore the viewer state');
  assert.equal(h.render.otherAuto, true);
  h.api.handle(c, 'seek', { progress: 0.5 });
  h.requests[1].reply(page(1, [frame(1, { autoPlay: false })], 3)); await flush();
  assert.equal(h.render.selfAuto, false); assert.equal(h.render.otherAuto, true);
  h.api.handle(c, 'restart'); await flush();
  assert.equal(h.render.selfAuto, true); assert.equal(h.render.otherAuto, true);
});

test('a failed original room startup releases the replay write lock', async () => {
  const h = harness(); h.setStartupError(true);
  const result = h.api.load(reference); h.requests[0].reply(manifest());
  assert.equal(await result, false);
  assert.equal(h.api.active(), false, 'A failed startup must not leave an unusable active replay');
  assert.equal(h.api.blocks(53), false);
});

test('closing an old pending load cannot unlock a newer pending load', async () => {
  const h = harness();
  const first = h.api.load(reference);
  h.api.clear();
  const second = h.api.load(reference);
  h.requests[0].reply(manifest());
  assert.equal(await first, false);
  const third = h.api.load(reference);
  assert.equal(h.requests.length, 2, 'Only the current generation may release loading');
  assert.equal(await third, false);
  h.requests[1].reply(manifest());
  assert.equal(await second, true);
});
