import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const adapterPath = fileURLToPath(new URL('../acceptance-client-adapter.js', import.meta.url));
const adapterSource = readFileSync(adapterPath, 'utf8');
const UUID_ONE = '11111111-1111-4111-8111-111111111111';
const UUID_TWO = '22222222-2222-4222-8222-222222222222';

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function createHarness(options = {}) {
  const jsbCalls = [];
  const consoleLogs = [];
  const receipts = [];
  const consoleCapture = {
    log: (...args) => {
      const line = args.map(value => typeof value === 'string' ? value : String(value)).join(' ');
      consoleLogs.push(line);
      const marker = 'DSS_ACCEPTANCE ';
      const markerIndex = line.indexOf(marker);
      if (markerIndex < 0) return;
      try {
        receipts.push({ source: 'console', value: JSON.parse(line.slice(markerIndex + marker.length)) });
      } catch (_) {
        // The assertion below will report a malformed receipt when one is required.
      }
    },
    warn: (...args) => consoleLogs.push(args.map(String).join(' ')),
    error: (...args) => consoleLogs.push(args.map(String).join(' ')),
  };
  const jsb = options.jsb || {
    reflection: {
      callStaticMethod: (...args) => {
        jsbCalls.push(args);
        const raw = args[args.length - 1];
        if (typeof raw !== 'string') return;
        try {
          receipts.push({ source: 'jsb', value: JSON.parse(raw) });
        } catch (_) {
          // Keep the raw call so the callback-shape assertion can report it.
        }
      },
    },
  };
  const sandbox = {
    console: consoleCapture,
    jsb,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    URL,
  };
  for (const key of ['cc', 'Standalone', 'StandaloneReplay', 'XMLHttpRequest', 'fetch', 'navigator', 'location']) {
    if (Object.prototype.hasOwnProperty.call(options, key)) sandbox[key] = options[key];
  }
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(adapterSource, sandbox, { filename: adapterPath });
  return {
    consoleLogs,
    jsbCalls,
    receipts,
    sandbox,
    dispatch(input) {
      return sandbox.LocalAcceptance.dispatch(input);
    },
  };
}

async function waitForReceipt(harness, id, timeoutMs = 1200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = harness.receipts.find(entry => entry.value && entry.value.id === id);
    if (found) return found.value;
    await delay(1);
  }
  throw new Error(`Timed out waiting for receipt ${id}; logs=${JSON.stringify(harness.consoleLogs)}`);
}

async function dispatchResult(harness, command, timeoutMs = 1200) {
  const id = typeof command === 'string' ? JSON.parse(command).id : command.id;
  const sync = harness.dispatch(command);
  if (sync !== false) {
    assert.equal(typeof sync, 'object');
    assert.equal(typeof sync.ok, 'boolean');
    assert.equal(sync.id, id);
    return { sync, receipt: sync };
  }
  const receipt = await waitForReceipt(harness, id, timeoutMs);
  assert.equal(receipt.id, id);
  assert.equal(typeof receipt.ok, 'boolean');
  return { sync, receipt };
}

function makeNode() {
  const component = { string: '' };
  return { component, getComponent: () => component };
}

function makeXhrSpy() {
  const requests = [];
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function open(method, url) {
    this.method = method;
    this.url = url;
    requests.push({ method, url });
  };
  XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader() {};
  XMLHttpRequest.prototype.send = function send(body) {
    this.body = body;
  };
  return { requests, XMLHttpRequest };
}

function makeFetchSpy() {
  const calls = [];
  return {
    calls,
    fetch: async (url, options = {}) => {
      calls.push({ method: options.method || 'GET', url: String(url) });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    },
  };
}

function assertNoPost(xhr, fetchSpy) {
  assert.equal(xhr.requests.some(request => String(request.method).toUpperCase() === 'POST'), false);
  assert.equal(fetchSpy.calls.some(call => String(call.method).toUpperCase() === 'POST'), false);
}

function makeCc({ config, getWindow, hallserver, server, gameserver, notification, frametype, msgEvent, framemodel, uimanager } = {}) {
  return {
    config: config || {},
    EditBox: function EditBox() {},
    mm: {
      framemodel: framemodel || { uid: 'acceptance-user' },
      frametype: frametype || {},
      gameserver: gameserver || {},
      hallserver: hallserver || {},
      msgEvent: msgEvent || {},
      notification: notification || {},
      server: server || {},
      uimanager: Object.assign({
        getWindow: getWindow || (() => null),
      }, uimanager),
    },
  };
}

function makeNotification() {
  const listeners = new Map();
  const add = (name, handler) => {
    const key = String(name);
    const handlers = listeners.get(key) || [];
    handlers.push(handler);
    listeners.set(key, handlers);
    return handler;
  };
  const remove = (name, handler) => {
    const key = String(name);
    const handlers = listeners.get(key) || [];
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
  return {
    emit(name, ...args) {
      for (const handler of [...(listeners.get(String(name)) || [])]) handler(...args);
    },
    off: remove,
    on: add,
    once(name, handler) {
      const wrapped = (...args) => {
        remove(name, wrapped);
        handler(...args);
      };
      return add(name, wrapped);
    },
  };
}

function makeAcceptanceJsb(extra = {}) {
  const calls = [];
  return {
    calls,
    reflection: {
      callStaticMethod: (...args) => {
        calls.push(args);
        const method = args[1];
        if (method === 'getLocationEvidence') {
          return JSON.stringify(extra.locationEvidence || {});
        }
        return null;
      },
    },
  };
}

test('dispatch accepts object and JSON string commands and rejects unknown actions without platform calls', () => {
  const platformCalls = [];
  const harness = createHarness({
    cc: makeCc({
      getWindow: (...args) => {
        platformCalls.push(args);
        return null;
      },
    }),
  });
  const objectResult = harness.dispatch({ action: 'does-not-exist', id: 'unknown-object' });
  assert.equal(objectResult.id, 'unknown-object');
  assert.equal(objectResult.ok, false);
  assert.equal(objectResult.error.code, 'UNKNOWN_ACTION');
  const stringResult = harness.dispatch(JSON.stringify({ action: 'does-not-exist', id: 'unknown-string' }));
  assert.equal(stringResult.id, 'unknown-string');
  assert.equal(stringResult.ok, false);
  assert.equal(stringResult.error.code, 'UNKNOWN_ACTION');
  assert.deepEqual(platformCalls, []);
  assert.deepEqual(harness.jsbCalls, []);
});

test('runtime readiness waits for the game scene instead of accepting UpdateUI', async () => {
  let controller = null;
  const harness = createHarness({
    cc: makeCc({ getWindow: name => name === 'HallUI' ? controller : null }),
  });
  harness.sandbox.__DSS_ACCEPTANCE_ADAPTER__ = {
    version: 'local-acceptance-v2',
    sha256: 'a'.repeat(64),
  };
  assert.equal(harness.dispatch({ id: 'scene-ready', action: 'runtime-ready', timeoutMs: 600 }), false);
  await delay(30);
  assert.equal(harness.receipts.some(entry => entry.value.id === 'scene-ready'), false);
  controller = {};
  const receipt = await waitForReceipt(harness, 'scene-ready');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.detail.adapter, 'local-acceptance-v2');
  assert.equal(receipt.detail.sha256, 'a'.repeat(64));
});

test('runtime readiness rejects a game scene when the driver identity is missing', async () => {
  const harness = createHarness({ cc: makeCc({ getWindow: () => ({}) }) });
  const result = await dispatchResult(harness, { id: 'scene-no-identity', action: 'runtime-ready', timeoutMs: 100 });
  assert.equal(result.receipt.ok, false);
  assert.equal(result.receipt.error.code, 'RUNTIME_NOT_READY');
});

test('runtime readiness fails when no playable or login scene appears', async () => {
  const harness = createHarness({ cc: makeCc() });
  const result = await dispatchResult(harness, { id: 'scene-timeout', action: 'runtime-ready', timeoutMs: 25 });
  assert.equal(result.receipt.ok, false);
  assert.equal(result.receipt.error.code, 'RUNTIME_NOT_READY');
});

test('registration locates the original LoginUI scene controller', async () => {
  const account = makeNode(), one = makeNode(), two = makeNode();
  let calls = 0;
  const controller = { views: {
    'accountReg/accountid/editbox': account,
    'accountReg/passworld1/editbox': one,
    'accountReg/passworld2/editbox': two,
  }, onClick_regbtn: () => { calls += 1; } };
  const cc = makeCc();
  cc.director = { getScene: () => ({ getChildByName: name => name === 'LoginUI'
    ? { getComponent: name => name === 'LoginUIController' ? controller : null } : null }) };
  const harness = createHarness({ cc });
  const result = await dispatchResult(harness, { id: 'scene-register', action: 'register', username: 'alice', password: 'test-secret' });
  assert.equal(result.receipt.ok, true);
  assert.equal(calls, 1);
  assert.equal(account.component.string, 'alice');
});

test('real asynchronous actions return literal false and later emit an id-correlated receipt', async () => {
  let live = true;
  let exitCalls = 0;
  const gameController = { onClickExitBtn: () => { exitCalls += 1; live = false; } };
  const harness = createHarness({
    cc: makeCc({ getWindow: name => name === 'dss_game' ? gameController : null }),
    Standalone: { hasLiveRoom: () => live },
  });
  const sync = harness.dispatch({ action: 'exit', id: 'async-exit' });
  assert.equal(sync, false);
  const receipt = await waitForReceipt(harness, 'async-exit');
  assert.equal(receipt.id, 'async-exit');
  assert.equal(typeof receipt.ok, 'boolean');
  assert.equal(receipt.ok, true);
  assert.equal(exitCalls, 1);
  assert.ok(harness.jsbCalls.length > 0 || harness.consoleLogs.some(line => line.startsWith('DSS_ACCEPTANCE ')));
  for (const call of harness.jsbCalls) {
    assert.equal(call.length, 4);
    assert.equal(typeof call[0], 'string');
    assert.equal(typeof call[1], 'string');
    assert.equal(typeof call[2], 'string');
    assert.equal(typeof call[3], 'string');
    assert.equal(JSON.parse(call[3]).id, 'async-exit');
  }
});

test('BUSY is enforced while an action is pending and cleared after its receipt', async () => {
  let live = true;
  const joined = [];
  const gameController = {
    onClickExitBtn: () => { live = false; },
  };
  const harness = createHarness({
    cc: makeCc({
      getWindow: name => name === 'dss_game' ? gameController : null,
      hallserver: { requestJoinRoom: code => joined.push(code) },
    }),
    Standalone: { hasLiveRoom: () => live },
  });
  assert.equal(harness.dispatch({ action: 'exit', id: 'busy-first' }), false);
  const busy = harness.dispatch({ action: 'joinRoom', id: 'busy-second', roomCode: '654321' });
  assert.equal(busy.ok, false);
  assert.equal(busy.error.code, 'BUSY');
  assert.deepEqual(joined, []);
  const first = await waitForReceipt(harness, 'busy-first');
  assert.equal(first.ok, true);
  const after = await dispatchResult(harness, { action: 'joinRoom', id: 'busy-after', roomCode: '654321' });
  assert.equal(after.receipt.ok, true);
  assert.deepEqual(joined, ['654321']);
});

test('missing platform interfaces become failure receipts instead of escaping dispatch', async () => {
  const harness = createHarness({ cc: makeCc() });
  const result = await dispatchResult(harness, { action: 'joinRoom', id: 'missing-interface', roomCode: '012345' });
  assert.equal(result.receipt.id, 'missing-interface');
  assert.equal(result.receipt.ok, false);
  assert.equal(typeof result.receipt.error, 'object');
});

test('receipt redaction is recursive across arrays and all secret key variants', async () => {
  const secrets = ['pw-value', 'token-value', 'session-value', 'credential-value', 'secret-value', 'api-key-value'];
  const harness = createHarness();
  const result = await dispatchResult(harness, {
    action: 'evidence',
    id: 'redaction',
    evidence: {
      username: 'visible-user',
      password: secrets[0],
      nested: [
        { token: secrets[1], session: { credential: secrets[3] } },
        { secret: secrets[4], apiKey: secrets[5] },
      ],
    },
  });
  const serialized = JSON.stringify(result.receipt);
  assert.ok(serialized.includes('[REDACTED]'));
  for (const secret of secrets) assert.equal(serialized.includes(secret), false);
  for (const line of [...harness.consoleLogs, ...harness.jsbCalls.map(call => String(call[call.length - 1]))]) {
    for (const secret of secrets) assert.equal(line.includes(secret), false);
  }
});

test('register drives LoginUI registration fields and onClick_regbtn without POSTing', async () => {
  const account = makeNode();
  const passwordOne = makeNode();
  const passwordTwo = makeNode();
  const regCalls = [];
  const controller = {
    onClick_regbtn: () => regCalls.push('reg'),
    views: {
      'accountReg/accountid/editbox': account,
      'accountReg/passworld1/editbox': passwordOne,
      'accountReg/passworld2/editbox': passwordTwo,
    },
  };
  const xhr = makeXhrSpy();
  const fetchSpy = makeFetchSpy();
  const harness = createHarness({
    cc: makeCc({ getWindow: name => name === 'LoginUI' || name === 'LoginUIController' ? controller : null }),
    XMLHttpRequest: xhr.XMLHttpRequest,
    fetch: fetchSpy.fetch,
  });
  const result = await dispatchResult(harness, {
    action: 'register',
    id: 'register-test',
    username: 'alice',
    password: 'register-secret',
    nickname: 'Alice',
  });
  assert.equal(result.receipt.ok, true);
  assert.equal(account.component.string, 'alice');
  assert.equal(passwordOne.component.string, 'register-secret');
  assert.equal(passwordTwo.component.string, 'register-secret');
  assert.deepEqual(regCalls, ['reg']);
  assertNoPost(xhr, fetchSpy);
});

test('login writes accountLogin fields and invokes onClick_toGame without POSTing', async () => {
  const account = makeNode();
  const password = makeNode();
  let submitted = 0;
  const controller = {
    onClick_toGame: () => { submitted += 1; },
    views: {
      'accountLogin/accountid/editbox': account,
      'accountLogin/passworld/editbox': password,
    },
  };
  const xhr = makeXhrSpy();
  const fetchSpy = makeFetchSpy();
  const harness = createHarness({
    cc: makeCc({ getWindow: name => name === 'LoginUI' || name === 'LoginUIController' ? controller : null }),
    XMLHttpRequest: xhr.XMLHttpRequest,
    fetch: fetchSpy.fetch,
  });
  const result = await dispatchResult(harness, {
    action: 'login',
    id: 'login-test',
    username: 'bob',
    password: 'login-secret',
  });
  assert.equal(result.receipt.ok, true);
  assert.equal(account.component.string, 'bob');
  assert.equal(password.component.string, 'login-secret');
  assert.equal(submitted, 1);
  assertNoPost(xhr, fetchSpy);
});

test('createRoom delegates to Standalone.createRoom and preserves explicit Qionglai 0/1 flags', async () => {
  const controller = {};
  const calls = [];
  const rules = { playerNum: 2, gameNum: 12 };
  const xhr = makeXhrSpy();
  const fetchSpy = makeFetchSpy();
  const harness = createHarness({
    cc: makeCc({ getWindow: name => name === 'dss_game' ? controller : null }),
    Standalone: { createRoom: (...args) => { calls.push(args); return true; } },
    XMLHttpRequest: xhr.XMLHttpRequest,
    fetch: fetchSpy.fetch,
  });
  const result = await dispatchResult(harness, {
    action: 'createRoom',
    id: 'create-room-test',
    rules,
    areaType: 8,
    variantIndex: 0,
  });
  assert.equal(result.receipt.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 3);
  assert.equal(calls[0][0], controller);
  assert.equal(calls[0][2], 8);
  for (const key of ['qlTianDiHu', 'qlHongHeiHu', 'qlHongHei50']) {
    assert.ok(Object.prototype.hasOwnProperty.call(calls[0][1], key));
    assert.ok(calls[0][1][key] === 0 || calls[0][1][key] === 1);
  }
  assert.equal(calls[0][1].qlTianDiHu, 0);
  assert.equal(calls[0][1].qlHongHeiHu, 1);
  assert.equal(calls[0][1].qlHongHei50, 1);
  assertNoPost(xhr, fetchSpy);
});

test('joinRoom delegates to hallserver.requestJoinRoom without POSTing', async () => {
  const joined = [];
  const xhr = makeXhrSpy();
  const fetchSpy = makeFetchSpy();
  const harness = createHarness({
    cc: makeCc({ hallserver: { requestJoinRoom: code => joined.push(code) } }),
    XMLHttpRequest: xhr.XMLHttpRequest,
    fetch: fetchSpy.fetch,
  });
  const result = await dispatchResult(harness, { action: 'joinRoom', id: 'join-room-test', roomCode: '012345' });
  assert.equal(result.receipt.ok, true);
  assert.deepEqual(joined, ['012345']);
  assertNoPost(xhr, fetchSpy);
});

test('exit invokes dss_game.onClickExitBtn and waits until hasLiveRoom becomes false', async () => {
  let live = true;
  let exits = 0;
  const harness = createHarness({
    cc: makeCc({ getWindow: name => name === 'dss_game' ? { onClickExitBtn: () => { exits += 1; live = false; } } : null }),
    Standalone: { hasLiveRoom: () => live },
  });
  const sync = harness.dispatch({ action: 'exit', id: 'exit-test' });
  assert.equal(sync, false);
  const receipt = await waitForReceipt(harness, 'exit-test');
  assert.equal(receipt.ok, true);
  assert.equal(exits, 1);
  assert.equal(live, false);
});

test('reconnect calls recoverWireRoom and polls hasLiveRoom until it reports a room', async () => {
  let polls = 0;
  let recoveries = 0;
  const harness = createHarness({
    cc: makeCc({ gameserver: { room_data: { roomId: UUID_ONE, roundId: UUID_TWO, stateVersion: 1 } } }),
    Standalone: {
      recoverWireRoom: () => { recoveries += 1; },
      hasLiveRoom: () => { polls += 1; return polls >= 3; },
    },
  });
  const sync = harness.dispatch({ action: 'reconnect', id: 'reconnect-test' });
  assert.equal(sync, false);
  const receipt = await waitForReceipt(harness, 'reconnect-test');
  assert.equal(receipt.ok, true);
  assert.equal(recoveries, 1);
  assert.ok(polls >= 3);
});

test('replay exits a live room first and then loads and attaches the replay controller', async () => {
  let live = true;
  const order = [];
  const sendCalls = [];
  const controller = {
    onClickExitBtn: () => { order.push('exit'); live = false; },
  };
  const harness = createHarness({
    cc: makeCc({
      getWindow: name => name === 'dss_game' ? controller : null,
      server: { send: (...args) => sendCalls.push(args) },
    }),
    Standalone: { hasLiveRoom: () => live },
    StandaloneReplay: {
      attach: () => { order.push('attach'); return true; },
      load: () => { order.push('load'); return true; },
    },
  });
  const sync = harness.dispatch({ action: 'animated-replay', id: 'replay-test', roomId: UUID_ONE, roundId: UUID_TWO });
  assert.equal(sync, false);
  const receipt = await waitForReceipt(harness, 'replay-test');
  assert.equal(receipt.ok, true);
  assert.deepEqual(order, ['exit', 'load', 'attach']);
  assert.deepEqual(sendCalls, []);
});

test('GPS requests location and polls until a finite, in-bounds, non-zero coordinate pair is available', async () => {
  let requestCalls = 0;
  const jsb = makeAcceptanceJsb();
  const harness = createHarness({
    jsb: {
      calls: jsb.calls,
      reflection: {
        callStaticMethod: (...args) => {
          jsb.calls.push(args);
          if (args[1] === 'getLocationEvidence') {
            const observedAt = Date.now();
            return JSON.stringify({
              available: true,
              provider: 'gps',
              permission: 'android.permission.ACCESS_FINE_LOCATION',
              observedAt,
              timestamp: observedAt,
              ageMs: Math.max(0, Date.now() - observedAt),
              accuracy: 5,
              latitude: 31.2304,
              longitude: 121.4737,
            });
          }
          return null;
        },
      },
    },
    cc: makeCc({
      gameserver: {
        requestLocation: () => { requestCalls += 1; },
      },
    }),
  });
  const sync = harness.dispatch({ action: 'gps', id: 'gps-valid', timeoutMs: 1500 });
  assert.equal(sync, false);
  const receipt = await waitForReceipt(harness, 'gps-valid', 2000);
  assert.equal(receipt.ok, true);
  assert.equal(requestCalls, 1);
  assert.equal(receipt.detail.latitude, 31.2304);
  assert.equal(receipt.detail.longitude, 121.4737);
  assert.ok(jsb.calls.some(args => args[1] === 'getLocationEvidence'));
});

test('GPS rejects null, NaN, Infinity, 0,0 and out-of-bounds coordinates', async () => {
  const cases = [
    [null, 121],
    [Number.NaN, 121],
    [Number.POSITIVE_INFINITY, 121],
    [0, 0],
    [91, 121],
    [-91, 121],
    [31, 181],
    [31, -181],
  ];
  for (const [index, [latitude, longitude]] of cases.entries()) {
    const harness = createHarness({
      cc: makeCc({
        gameserver: {
          getLatitude: () => latitude,
          getLongitude: () => longitude,
          requestLocation: () => {},
        },
      }),
    });
    const id = `gps-invalid-${index}`;
    const sync = harness.dispatch({ action: 'gps', id, timeoutMs: 60 });
    if (sync === false) {
      const receipt = await waitForReceipt(harness, id, 1500);
      assert.equal(receipt.ok, false, `${latitude},${longitude}`);
    } else {
      assert.equal(sync.ok, false, `${latitude},${longitude}`);
    }
  }
});

test('quick-voice uses the CommonFace panel and waits for HWNotifyChat without sending a packet', async () => {
  const notification = makeNotification();
  const panelItem = { id: 'face-1' };
  const clickPayloads = [];
  let chatButtonCalls = 0;
  let showWindowCalls = 0;
  let panelVisible = false;
  const sendCalls = [];
  const panel = {
    items: [null, panelItem],
    onClickText: payload => {
      clickPayloads.push(payload);
      setTimeout(() => {
        notification.emit(1041, { faceId: 1, targetSeat: 2 });
        notification.emit('HWNotifyChat', { faceId: 1, targetSeat: 2 });
      }, 0);
    },
  };
  const controller = {
    model: { selfSeat: 2 },
    onClickChatBtn: () => {
      chatButtonCalls += 1;
      panelVisible = true;
      cc.mm.uimanager.showWindow(cc.mm.config.resources, 'CommonFace', controller.model.selfSeat);
    },
  };
  const harness = createHarness({
    cc: makeCc({
      config: { resources: {} },
      frametype: { MSG_NOTICE_CMD: 1000 },
      getWindow: name => name === 'dss_game' ? controller : name === 'CommonFace' && panelVisible ? panel : null,
      msgEvent: { HWNotifyChat: 41 },
      notification,
      server: { send: (...args) => sendCalls.push(args) },
      uimanager: {
        showWindow: (...args) => {
          showWindowCalls += 1;
          panelVisible = args[1] === 'CommonFace';
        },
      },
    }),
  });
  const result = await dispatchResult(harness, {
    action: 'quick-voice',
    id: 'voice-test',
    mutualFaceId: 1,
    targetSeat: 2,
  }, 2000);
  assert.equal(result.receipt.ok, true);
  assert.equal(chatButtonCalls, 1);
  assert.equal(showWindowCalls, 1);
  assert.equal(clickPayloads.length, 1);
  assert.equal(clickPayloads[0].node, panelItem);
  assert.deepEqual(sendCalls, []);
});

test('quick-voice rejects a notification for a different target seat', async () => {
  const notification = makeNotification();
  const panelItem = { id: 'face-1' };
  let panelVisible = false;
  const panel = {
    items: [null, panelItem],
    onClickText: () => {
      setTimeout(() => {
        notification.emit(1041, { faceId: 1, targetSeat: 1 });
        notification.emit('HWNotifyChat', { faceId: 1, targetSeat: 1 });
      }, 0);
    },
  };
  const controller = {
    model: { selfSeat: 2 },
    onClickChatBtn: () => {
      panelVisible = true;
      cc.mm.uimanager.showWindow(cc.mm.config.resources, 'CommonFace', controller.model.selfSeat);
    },
  };
  const harness = createHarness({
    cc: makeCc({
      config: { resources: {} },
      frametype: { MSG_NOTICE_CMD: 1000 },
      getWindow: name => name === 'dss_game' ? controller : name === 'CommonFace' && panelVisible ? panel : null,
      msgEvent: { HWNotifyChat: 41 },
      notification,
      uimanager: {
        showWindow: (...args) => {
          panelVisible = args[1] === 'CommonFace';
        },
      },
    }),
  });
  const result = await dispatchResult(harness, {
    action: 'quick-voice',
    id: 'voice-wrong-seat',
    mutualFaceId: 1,
    targetSeat: 2,
  }, 2000);
  assert.equal(result.receipt.ok, false);
  assert.equal(result.receipt.error.code, 'VOICE_FAILED');
  assert.match(result.receipt.error.message, /targetSeat 2/);
});

test('standalone-network checks API and WS requests against the same host', async () => {
  const allowedCalls = [];
  const harness = createHarness({
    Standalone: {
      config: { apiBase: 'https://game.example/api', wsUrl: 'wss://game.example/ws' },
      allowedRequest: (url, isWs) => {
        allowedCalls.push([url, isWs]);
        return true;
      },
    },
  });
  const result = await dispatchResult(harness, { action: 'standalone-network', id: 'network-valid' });
  assert.equal(result.receipt.ok, true);
  assert.deepEqual(allowedCalls, [
    ['https://game.example/api/health', false],
    ['wss://game.example/ws', true],
  ]);

  const mismatch = createHarness({
    Standalone: {
      config: { apiBase: 'https://game.example/api', wsUrl: 'wss://other.example/ws' },
      allowedRequest: () => true,
    },
  });
  const mismatchResult = await dispatchResult(mismatch, { action: 'standalone-network', id: 'network-mismatch' });
  assert.equal(mismatchResult.receipt.ok, false);
});

test('documented action aliases are recognized instead of becoming UNKNOWN_ACTION', async () => {
  const aliases = [
    ['beans-credit', { expectedAmount: '1' }],
    ['create-and-join', { areaType: 8, rules: { qlTianDiHu: 0, qlHongHeiHu: 1, qlHongHei50: 1 } }],
    ['completed-round', { roomId: UUID_ONE }],
    ['animated-replay', { roomId: UUID_ONE, roundId: UUID_TWO }],
    ['quick-voice', { mutualFaceId: 1, targetSeat: 2 }],
    ['standalone-network', {}],
    ['auto-play', { enabled: true }],
    ['autoPlay', { enabled: true }],
  ];
  for (const [alias, fields] of aliases) {
    const harness = createHarness();
    const result = harness.dispatch({ ...fields, action: alias, id: `alias-${alias}` });
    if (result !== false) {
      assert.notEqual(result.error && result.error.code, 'UNKNOWN_ACTION', alias);
    } else {
      await delay(5);
      const receipt = harness.receipts.find(entry => entry.value && entry.value.id === `alias-${alias}`);
      if (receipt) assert.notEqual(receipt.value.error && receipt.value.error.code, 'UNKNOWN_ACTION', alias);
    }
  }
});
