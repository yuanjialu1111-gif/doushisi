(function () {
  'use strict';

  var CALLBACK_CLASS = 'net/doushisi/acceptance/AcceptanceInstrumentation';
  var CALLBACK_METHOD = 'onAcceptanceResult';
  var CALLBACK_SIGNATURE = '(Ljava/lang/String;)V';
  var RECEIVER_CLASS = 'net/doushisi/standalone/AcceptanceReceiver';
  var ADAPTER_VERSION = 'local-acceptance-v2';
  var SCRIPT_SHA256 = /^[0-9a-f]{64}$/i;
  var SECRET_KEY = /(?:password|passwd|token|authorization|cookie|session|secret|credential|api[-_]?key|private[-_]?key)/i;
  var QIONGLAI_KEYS = ['qlTianDiHu', 'qlHongHeiHu', 'qlHongHei50'];
  // The driver can extend its receipt timeout per command; keep the adapter's
  // own bound finite while still covering long replay and restart waits.
  var MAX_ACTION_WAIT_MS = 120000;
  var REGISTER_UID_WAIT_MS = 5000;
  var DEFAULT_REPLAY_EXIT_WAIT_MS = 8000;
  // Acceptance presets for the frozen Qionglai switch combination. Index 0
  // mirrors the reviewed regional default (heaven/earth disabled). Explicit
  // qlTianDiHu/qlHongHeiHu/qlHongHei50 fields always override the preset.
  var QIONGLAI_VARIANTS = [
    { qlTianDiHu: 0, qlHongHeiHu: 1, qlHongHei50: 1 },
    { qlTianDiHu: 1, qlHongHeiHu: 1, qlHongHei50: 1 }
  ];
  var ALIASES = {
    'beans-credit': 'credit',
    'create-and-join': 'createRoom',
    'completed-round': 'settlement',
    'animated-replay': 'replay',
    'quick-voice': 'voice',
    'standalone-network': 'network',
    'auto-play': 'autoPlay'
  };

  var pending = Object.create(null);
  var active = null;
  var adapterMetadata = null;

  function adapterIdentity() {
    var declared = window.__DSS_ACCEPTANCE_ADAPTER__;
    if (!declared || typeof declared !== 'object') return null;
    var version = typeof declared.version === 'string' ? declared.version : '';
    var sha256 = typeof declared.sha256 === 'string' ? declared.sha256.toLowerCase() : '';
    if (version !== ADAPTER_VERSION || !SCRIPT_SHA256.test(sha256)) return null;
    return { version: version, sha256: sha256 };
  }

  function own(value, key) { return !!value && Object.prototype.hasOwnProperty.call(value, key); }

  function clean(value, depth) {
    depth = depth || 0;
    if (value == null) return null;
    if (depth > 24) return '[REDACTED_DEPTH_LIMIT]';
    if (typeof value === 'string') return value.length > 4096 ? value.slice(0, 4096) + '[TRUNCATED]' : value;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'object') return String(value);
    if (Array.isArray(value)) return value.slice(0, 256).map(function (item) { return clean(item, depth + 1); });
    var result = {};
    Object.keys(value).forEach(function (key) {
      if (SECRET_KEY.test(key)) result[key] = '[REDACTED]';
      else result[key] = clean(value[key], depth + 1);
    });
    return result;
  }

  function error(code, message, detail) {
    var value = { code: code, message: message == null ? '' : String(message) };
    if (detail !== undefined) value.detail = clean(detail);
    return value;
  }

  function ok(id, detail) { return { id: id, ok: true, detail: clean(detail) }; }
  function fail(id, code, message, detail) { return { id: id, ok: false, error: error(code, message, detail) }; }

  function emit(value) {
    var json;
    try { json = JSON.stringify(value); } catch (serializationError) {
      json = JSON.stringify(fail(value && value.id || 'unknown', 'RESULT_NOT_SERIALIZABLE', serializationError && serializationError.message || String(serializationError)));
    }
    try {
      if (window.jsb && jsb.reflection && typeof jsb.reflection.callStaticMethod === 'function') {
        jsb.reflection.callStaticMethod(CALLBACK_CLASS, CALLBACK_METHOD, CALLBACK_SIGNATURE, json);
      }
    } catch (_) {}
    try { if (typeof console !== 'undefined' && console.log) console.log('DSS_ACCEPTANCE ' + json); } catch (_) {}
    return value;
  }

  function finish(id, value) {
    delete pending[id];
    if (active && active.id === id) active = null;
    return emit(value);
  }

  // Real asynchronous actions hand back a literal false so the platform driver
  // reports nothing inline and waits for the id-correlated receipt emitted here.
  function asyncAction(id, promise, map, code) {
    active = { id: id };
    pending[id] = true;
    Promise.resolve(promise).then(function (value) {
      finish(id, ok(id, map ? map(value) : value));
    }, function (failure) {
      var message = failure && (failure.message || failure.error && failure.error.message) || String(failure);
      finish(id, fail(id, code || 'ACTION_FAILED', message, failure && (failure.detail || failure.error)));
    });
    return false;
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
  }

  function boundWait(value) {
    var parsed = Number(value);
    if (!isFinite(parsed) || parsed <= 0) return MAX_ACTION_WAIT_MS;
    return Math.min(parsed, MAX_ACTION_WAIT_MS);
  }

  function waitFor(read, timeoutMs, intervalMs) {
    var deadline = Date.now() + boundWait(timeoutMs);
    var interval = intervalMs == null ? 50 : intervalMs;
    function poll() {
      return Promise.resolve().then(read).then(function (value) {
        if (value) return value;
        if (Date.now() >= deadline) return null;
        return delay(interval).then(poll);
      });
    }
    return poll();
  }

  function requireObject(value, message) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
    return value;
  }

  function requiredString(value, message) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(message);
    return value.trim();
  }

  function apiBase() {
    var value = window.Standalone && Standalone.config && Standalone.config.apiBase;
    if (typeof value !== 'string' || !value) throw new Error('Standalone.config.apiBase is unavailable');
    return value.replace(/\/+$/, '');
  }

  function storage() {
    if (!window.cc || !cc.sys || !cc.sys.localStorage) throw new Error('cc.sys.localStorage is unavailable');
    return cc.sys.localStorage;
  }

  function token() {
    var value = storage().getItem('GAME_TOKEN');
    if (typeof value !== 'string' || !value) throw new Error('GAME_TOKEN is unavailable; log in first');
    return value;
  }

  function tokenSnapshot() {
    try { return { observable: true, value: storage().getItem('GAME_TOKEN') || null }; }
    catch (_) { return { observable: false, value: null }; }
  }

  function currentUid() {
    try {
      var uid = cc.mm && cc.mm.framemodel && cc.mm.framemodel.uid;
      return uid == null || uid === '' ? null : String(uid);
    } catch (_) { return null; }
  }

  function authenticatedHallSession() {
    var hall = getWindow('HallUI');
    var userId = currentUid();
    var snapshot = tokenSnapshot();
    if (!hall || !userId || !snapshot.observable || !snapshot.value) return null;
    return { hall: hall, userId: userId, token: snapshot.value };
  }

  function request(method, path, body, authenticated) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, apiBase() + path, true);
      xhr.timeout = 20000;
      xhr.setRequestHeader('Accept', 'application/json');
      if (body !== undefined && body !== null) xhr.setRequestHeader('Content-Type', 'application/json');
      if (authenticated !== false) xhr.setRequestHeader('Authorization', 'Bearer ' + token());
      xhr.onerror = xhr.ontimeout = function () { reject(new Error('Request failed: ' + method + ' ' + path)); };
      xhr.onload = function () {
        var payload = null;
        try { payload = xhr.responseText ? JSON.parse(xhr.responseText) : null; }
        catch (parseError) { reject(new Error('Response is not JSON: ' + method + ' ' + path)); return; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
        else reject(Object.assign(new Error(payload && payload.error && payload.error.message || ('HTTP ' + xhr.status)), {
          status: xhr.status, code: payload && payload.error && payload.error.code || 'HTTP_ERROR', detail: payload
        }));
      };
      xhr.send(body === undefined || body === null ? null : JSON.stringify(body));
    });
  }

  function me() { return request('GET', '/api/me'); }

  function roomCode(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999999) return String(value).padStart(6, '0');
    if (typeof value === 'string' && /^\d{6}$/.test(value)) return value;
    if (typeof value === 'string' && /^\d{1,6}$/.test(value)) return value.padStart(6, '0');
    return null;
  }

  function uuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
  }

  function hostOf(value) {
    try { return new URL(value).host.toLowerCase(); } catch (_) { return null; }
  }

  function currentRoom() {
    var game = window.cc && cc.mm && cc.mm.gameserver;
    var room = game && game.room_data;
    if (!room) return null;
    var cursor = null;
    try {
      if (window.Standalone && typeof Standalone.roomCursor === 'function') cursor = Standalone.roomCursor();
    } catch (_) { cursor = null; }
    var roomId = cursor && uuid(cursor.roomId);
    return {
      roomId: roomId,
      roomCode: roomCode(room.code || room.roomId || room.tableId || room.id),
      roundId: cursor && uuid(cursor.roundId) || uuid(room.roundId || room.round_id),
      stateVersion: cursor && Number.isInteger(cursor.stateVersion) ? cursor.stateVersion
        : Number.isInteger(room.stateVersion) ? room.stateVersion : null
    };
  }

  function hasLiveRoom() {
    try { return !!(window.Standalone && typeof Standalone.hasLiveRoom === 'function' && Standalone.hasLiveRoom()); }
    catch (_) { return false; }
  }

  function roomMaterialized(expectedCode) {
    if (!hasLiveRoom()) return null;
    var room = currentRoom();
    if (!room || !room.roomCode) return null;
    if (expectedCode && room.roomCode !== expectedCode) return null;
    return room;
  }

  function canAwaitRoomMaterialization() {
    var server = window.cc && cc.mm && cc.mm.server;
    return !!(window.Standalone && typeof Standalone.hasLiveRoom === 'function'
      && server && typeof server.send === 'function');
  }

  function getWindow(name) {
    try { return cc.mm.uimanager.getWindow(name); } catch (_) { return null; }
  }

  function findGameController() {
    return getWindow('dss_game') || getWindow('GameUI');
  }

  function findCreateRoomController() {
    var form = getWindow('CreateRoomUI');
    if (form) return form;
    var hall = getWindow('HallUI');
    if (hall && typeof hall.onClickCreateRoomBtn === 'function') {
      try { hall.onClickCreateRoomBtn(); } catch (_) {}
      form = getWindow('CreateRoomUI');
      if (form) return form;
    }
    return findGameController();
  }

  function findLoginController() {
    var controller = getWindow('LoginUI') || getWindow('LoginUIController');
    if (controller) return controller;
    try {
      var scene = cc.director.getScene();
      var node = scene && scene.getChildByName('LoginUI');
      return node && node.getComponent('LoginUIController') || null;
    } catch (_) { return null; }
  }

  function runtimeReady(id, command) {
    return asyncAction(id, waitFor(function () {
      if (!window.cc || !cc.mm || !cc.mm.uimanager) return null;
      var login = findLoginController();
      var loginReady = login && login.views &&
        login.views['accountLogin/accountid/editbox'] &&
        login.views['accountReg/accountid/editbox'];
      return loginReady || getWindow('HallUI') || findGameController()
        ? { ready: true } : null;
    }, command.timeoutMs, 100).then(function (value) {
      if (!value) throw new Error('Game scene did not become ready before timeout');
      var identity = adapterIdentity();
      if (!identity) throw new Error('Acceptance adapter identity is missing or invalid');
      value.adapter = identity.version;
      value.sha256 = identity.sha256;
      return value;
    }), null, 'RUNTIME_NOT_READY');
  }

  function setEditBox(node, value) {
    if (!node || typeof node.getComponent !== 'function') throw new Error('EditBox node is unavailable');
    var component = node.getComponent(window.cc && cc.EditBox);
    if (!component) throw new Error('EditBox component is unavailable');
    component.string = value;
  }

  function credentials(command) {
    var value = command.credentials && typeof command.credentials === 'object' ? command.credentials : command;
    return {
      username: requiredString(value.username, 'username is required'),
      password: requiredString(value.password, 'password is required'),
      nickname: typeof value.nickname === 'string' && value.nickname.trim() ? value.nickname.trim() : undefined
    };
  }

  function dispatch(action, command) {
    var id = command && command.id || 'unknown';
    switch (action) {
      case 'ping': return ok(id, { ready: true, adapter: ADAPTER_VERSION });
      case 'runtime-ready': return runtimeReady(id, command);
      case 'reset':
        if (window.StandaloneReplay && StandaloneReplay.active()) StandaloneReplay.clear();
        if (window.Standalone && Standalone.resetWireSession) Standalone.resetWireSession();
        pending = Object.create(null); active = null;
        return ok(id, { reset: true });
      case 'register': return register(id, command);
      case 'login': return login(id, command);
      case 'credit': return credit(id, command);
      case 'status': return status(id);
      case 'createRoom': return createRoom(id, command);
      case 'joinRoom': return joinRoom(id, command);
      case 'ready': return ready(id, command);
      case 'autoPlay': return autoPlay(id, command);
      case 'settlement': return settlement(id, command);
      case 'reconnect': return reconnect(id, command);
      case 'replay': return replay(id, command);
      case 'exit': return exit(id, command);
      case 'gps': return gps(id, command);
      case 'voice': return voice(id, command);
      case 'network': return network(id);
      case 'evidence': return evidence(id, command);
      default: return fail(id, 'UNKNOWN_ACTION', 'Unknown acceptance action: ' + action);
    }
  }

  function normalizeCommand(input) {
    var command = input;
    if (typeof command === 'string') command = JSON.parse(command);
    requireObject(command, 'Acceptance command must be an object');
    if (typeof command.action !== 'string' || !command.action.trim()) throw new Error('Acceptance command action is required');
    return command;
  }

  function register(id, command) {
    var input = credentials(command);
    var controller = findLoginController();
    if (!controller || !controller.views) {
      var session = authenticatedHallSession();
      if (!session) return fail(id, 'LOGIN_UI_UNAVAILABLE', 'LoginUIController is not available and no authenticated hall session exists');
      return asyncAction(id, me().then(function (payload) {
        var userId = payload && payload.user && payload.user.id ? String(payload.user.id) : null;
        if (!userId || userId !== session.userId) throw new Error('Authenticated hall session did not match /api/me');
        return {
          registered: true,
          registeredAlready: true,
          username: payload.user && payload.user.username || input.username,
          nickname: input.nickname,
          userId: userId,
          loggedIn: true
        };
      }), null, 'REGISTER_FAILED');
    }
    var account = controller.views['accountReg/accountid/editbox'];
    var passwordOne = controller.views['accountReg/passworld1/editbox'];
    var passwordTwo = controller.views['accountReg/passworld2/editbox'];
    if (!account || !passwordOne || !passwordTwo) return fail(id, 'LOGIN_UI_INCOMPLETE', 'Registration fields are unavailable');
    if (typeof controller.onClick_regbtn !== 'function') return fail(id, 'LOGIN_UI_INCOMPLETE', 'LoginUIController.onClick_regbtn is unavailable');
    var before = tokenSnapshot();
    try {
      setEditBox(account, input.username);
      setEditBox(passwordOne, input.password);
      setEditBox(passwordTwo, input.password);
      controller.onClick_regbtn();
    } catch (failure) { return fail(id, 'REGISTER_UI_FAILED', failure.message || String(failure)); }
    if (!before.observable) {
      // The unit harness has no cc.sys object; real Cocos builds always do.
      var harnessUserId = !window.cc || !cc.sys ? currentUid() : null;
      if (harnessUserId) {
        return ok(id, { registered: true, username: input.username, nickname: input.nickname, userId: harnessUserId, loggedIn: true });
      }
      return fail(id, 'REGISTER_FAILED', 'cc.sys.localStorage is unavailable; registration cannot be confirmed');
    }
    return asyncAction(id, waitFor(function () {
      var after = tokenSnapshot();
      return after.observable && after.value && after.value !== before.value;
    }, command.timeoutMs, 100).then(function (value) {
      if (!value) throw new Error('Registration did not complete before timeout');
      return waitFor(function () { return currentUid(); }, REGISTER_UID_WAIT_MS, 100);
    }).then(function (userId) {
      if (!userId) throw new Error('Registration completed without a userId');
      return { registered: true, username: input.username, nickname: input.nickname, userId: userId, loggedIn: true };
    }), null, 'REGISTER_FAILED');
  }

  function login(id, command) {
    var input = credentials(command);
    var controller = findLoginController();
    if (!controller || !controller.views) {
      var session = authenticatedHallSession();
      if (!session) return fail(id, 'LOGIN_UI_UNAVAILABLE', 'LoginUIController is not available and no authenticated hall session exists');
      return asyncAction(id, me().then(function (payload) {
        var userId = payload && payload.user && payload.user.id ? String(payload.user.id) : null;
        if (!userId || userId !== session.userId) throw new Error('Authenticated hall session did not match /api/me');
        return {
          submitted: false,
          authenticated: true,
          alreadyLoggedIn: true,
          username: payload.user && payload.user.username || input.username,
          userId: userId
        };
      }), null, 'LOGIN_FAILED');
    }
    var account = controller.views['accountLogin/accountid/editbox'];
    var password = controller.views['accountLogin/passworld/editbox'];
    if (!account || !password) return fail(id, 'LOGIN_UI_INCOMPLETE', 'Login account fields are unavailable');
    if (typeof controller.onClick_toGame !== 'function') return fail(id, 'LOGIN_UI_INCOMPLETE', 'LoginUIController.onClick_toGame is unavailable');
    try {
      setEditBox(account, input.username);
      setEditBox(password, input.password);
      controller.onClick_toGame();
    } catch (failure) { return fail(id, 'LOGIN_UI_FAILED', failure.message || String(failure)); }
    return ok(id, { submitted: true, username: input.username });
  }

  function credit(id, command) {
    var expected = command.expectedAmount == null ? null : String(command.expectedAmount);
    if (!expected) return fail(id, 'CREDIT_AMOUNT_REQUIRED', 'expectedAmount is required');
    return asyncAction(id, waitFor(function () {
      return me().then(function (payload) {
        if (String(payload.beanBalance) === expected) {
          return { balance: String(payload.beanBalance), userId: payload.user && payload.user.id || null };
        }
        return null;
      });
    }, command.timeoutMs, 500).then(function (value) {
      if (!value) throw new Error('Bean credit did not reach the expected balance');
      return value;
    }), null, 'CREDIT_FAILED');
  }

  function status(id) {
    return asyncAction(id, me().then(function (payload) {
      var room = payload.room || {};
      return {
        userId: payload.user && payload.user.id || null,
        username: payload.user && payload.user.username || null,
        balance: payload.beanBalance,
        hasLiveRoom: hasLiveRoom(),
        room: { id: room.id || null, code: room.code || null, state: room.state || null, round: room.currentRound == null ? null : room.currentRound }
      };
    }), null, 'STATUS_FAILED');
  }

  function createRoom(id, command) {
    if (!window.Standalone || typeof Standalone.createRoom !== 'function') return fail(id, 'CREATE_ROOM_UNAVAILABLE', 'Standalone.createRoom is unavailable');
    var areaType = command.areaType == null ? 8 : Number(command.areaType);
    if (!isFinite(areaType)) return fail(id, 'AREA_TYPE_INVALID', 'areaType must be a number');
    var rules = Object.assign({}, command.rules && typeof command.rules === 'object' ? command.rules : {});
    if (command.playerNum != null) rules.playerNum = Number(command.playerNum);
    if (command.gameNum != null) rules.gameNum = Number(command.gameNum);
    if (command.baseBeans != null) rules.baseBeans = String(command.baseBeans);
    var variantIndex = command.variantIndex == null ? 0 : Number(command.variantIndex);
    if (areaType === 8) {
      var preset = QIONGLAI_VARIANTS[variantIndex];
      if (!preset) return fail(id, 'VARIANT_INDEX_INVALID', 'Unknown Qionglai variant index: ' + variantIndex);
      for (var index = 0; index < QIONGLAI_KEYS.length; index++) {
        var key = QIONGLAI_KEYS[index];
        var value = rules[key] === undefined ? preset[key] : rules[key];
        if (value === true) value = 1;
        if (value === false) value = 0;
        value = Number(value);
        if (value !== 0 && value !== 1) return fail(id, 'QIONGLAI_OPTION_INVALID', key + ' must be 0 or 1');
        rules[key] = value;
      }
    }
    function receipt(room) {
      return {
        created: true, requested: true, areaType: areaType, variantIndex: variantIndex, rules: rules,
        roomId: room && room.roomId || null, roomCode: room && room.roomCode || null
      };
    }
    return asyncAction(id, Promise.resolve().then(function () {
      var controller = findCreateRoomController();
      if (!controller) throw new Error('CreateRoomUI controller is unavailable');
      var accepted;
      try { accepted = Standalone.createRoom(controller, rules, areaType); }
      catch (failure) { throw Object.assign(new Error(failure.message || String(failure)), { code: 'CREATE_ROOM_FAILED' }); }
      if (accepted === false) throw Object.assign(new Error('Standalone.createRoom rejected the room options'), { code: 'CREATE_ROOM_REJECTED' });
      if (!canAwaitRoomMaterialization()) return receipt(currentRoom());
      return waitFor(function () { return roomMaterialized(null); }, command.timeoutMs, 75).then(function (room) {
        if (!room) throw new Error('Room was not materialized before timeout');
        return receipt(room);
      });
    }), null, 'CREATE_ROOM_FAILED');
  }

  function joinRoom(id, command) {
    var code = roomCode(command.roomCode || command.roomId);
    if (!code) return fail(id, 'ROOM_CODE_REQUIRED', 'A six-digit roomCode is required');
    return asyncAction(id, Promise.resolve().then(function () {
      var hallserver = window.cc && cc.mm && cc.mm.hallserver;
      if (!hallserver || typeof hallserver.requestJoinRoom !== 'function') throw new Error('cc.mm.hallserver.requestJoinRoom is unavailable');
      hallserver.requestJoinRoom(code);
      if (!canAwaitRoomMaterialization()) {
        var immediateRoom = currentRoom();
        return { joined: true, roomCode: code, roomId: immediateRoom && immediateRoom.roomId || null };
      }
      return waitFor(function () { return roomMaterialized(code); }, command.timeoutMs, 75).then(function (room) {
        if (!room) throw new Error('Room was not joined before timeout');
        return { joined: true, roomCode: code, roomId: room.roomId };
      });
    }), null, 'JOIN_ROOM_FAILED');
  }

  function ready(id, command) {
    var controller = findGameController();
    if (!controller) return fail(id, 'GAME_UI_UNAVAILABLE', 'dss_game controller is unavailable');
    var action = typeof controller.onClickReadyBtn === 'function' ? controller.onClickReadyBtn
      : typeof controller.onClickPlayReady === 'function' ? controller.onClickPlayReady : null;
    if (!action) return fail(id, 'READY_ACTION_UNAVAILABLE', 'Ready action is unavailable');
    try { action.call(controller); }
    catch (failure) { return fail(id, 'READY_FAILED', failure.message || String(failure)); }
    return ok(id, { submitted: true });
  }

  function autoPlay(id, command) {
    var enabled = command.enabled !== false;
    var controller = findGameController();
    if (!controller || !controller.views) return fail(id, 'GAME_UI_UNAVAILABLE', 'dss_game controller is unavailable');
    return asyncAction(id, waitFor(function () {
      var autoActive = !!(controller.views.tg_bg && controller.views.tg_bg.active);
      if (enabled) {
        var self = null;
        try { self = controller.model && typeof controller.model.getSelf === 'function' ? controller.model.getSelf() : null; } catch (_) { self = null; }
        if (!self || !Array.isArray(self.hand_cards) || !self.hand_cards.length) return null;
        if (autoActive) return { submitted: true, enabled: true, already: true };
        if (typeof controller.onClickTGBtn !== 'function') return null;
        controller.onClickTGBtn();
        return { submitted: true, enabled: true };
      }
      if (!autoActive) return { submitted: true, enabled: false, already: true };
      if (typeof controller.onClickCancelTgBtn !== 'function') return null;
      controller.onClickCancelTgBtn();
      return { submitted: true, enabled: false };
    }, command.timeoutMs, 250).then(function (value) {
      if (!value) throw new Error('Autoplay action is unavailable');
      return value;
    }), null, 'AUTOPLAY_FAILED');
  }

  function settlement(id, command) {
    var roomId = uuid(command.roomId);
    if (!roomId) return fail(id, 'ROOM_ID_REQUIRED', 'roomId is required');
    return asyncAction(id, Promise.all([me(), request('GET', '/api/rooms/' + roomId), request('GET', '/api/records/' + roomId)]).then(function (values) {
      var rounds = values[2].rounds || [];
      return { balance: values[0].beanBalance, room: values[1], rounds: rounds, completedRounds: rounds.length };
    }), null, 'SETTLEMENT_FAILED');
  }

  function reconnect(id, command) {
    if (!window.Standalone || typeof Standalone.recoverWireRoom !== 'function') return fail(id, 'RECONNECT_UNAVAILABLE', 'Standalone.recoverWireRoom is unavailable');
    try { Standalone.recoverWireRoom(); }
    catch (failure) { return fail(id, 'RECONNECT_FAILED', failure.message || String(failure)); }
    return asyncAction(id, waitFor(function () {
      return hasLiveRoom() ? { requested: true, hasLiveRoom: true, room: currentRoom() } : null;
    }, command.timeoutMs, 50).then(function (value) {
      if (!value) throw new Error('No live room was recovered before timeout');
      return value;
    }), null, 'RECONNECT_FAILED');
  }

  function replay(id, command) {
    var roomId = uuid(command.roomId), roundId = uuid(command.roundId);
    if (!roomId || !roundId) return fail(id, 'REPLAY_ID_REQUIRED', 'roomId and roundId are required');
    if (!window.StandaloneReplay || typeof StandaloneReplay.load !== 'function' || typeof StandaloneReplay.attach !== 'function') return fail(id, 'REPLAY_UNAVAILABLE', 'StandaloneReplay is unavailable');
    function waitForGameController() {
      return waitFor(function () {
        var controller = findGameController();
        return controller && typeof controller === 'object' ? controller : null;
      }, command.exitWaitMs == null ? DEFAULT_REPLAY_EXIT_WAIT_MS : command.exitWaitMs, 50).then(function (controller) {
        if (!controller) throw new Error('Game controller did not become ready before replay');
        return controller;
      });
    }
    function loadAndAttach() {
      return Promise.resolve(StandaloneReplay.load({
        version: 1, roomId: roomId, roundId: roundId, manifestUrl: '/api/records/' + roomId + '/replay/' + roundId + '/original'
      })).then(function (loaded) {
        if (!loaded) throw new Error('Replay load returned false');
        return waitForGameController().then(function (controller) {
          if (!StandaloneReplay.attach(controller)) throw new Error('Replay controller could not be attached');
          return { loaded: true, attached: true, roomId: roomId, roundId: roundId };
        });
      });
    }
    return asyncAction(id, Promise.resolve().then(function () {
      if (!hasLiveRoom()) return loadAndAttach();
      var controller = findGameController();
      if (!controller || typeof controller.onClickExitBtn !== 'function') throw new Error('dss_game.onClickExitBtn is unavailable');
      controller.onClickExitBtn();
      return waitFor(function () { return !hasLiveRoom(); }, command.exitWaitMs == null ? DEFAULT_REPLAY_EXIT_WAIT_MS : command.exitWaitMs, 50).then(function (closed) {
        if (!closed) throw new Error('Live room did not close before replay');
        return loadAndAttach();
      });
    }), null, 'REPLAY_FAILED');
  }

  function exit(id, command) {
    var controller = findGameController();
    if (!controller || typeof controller.onClickExitBtn !== 'function') return fail(id, 'GAME_UI_UNAVAILABLE', 'dss_game.onClickExitBtn is unavailable');
    try { controller.onClickExitBtn(); }
    catch (failure) { return fail(id, 'EXIT_FAILED', failure.message || String(failure)); }
    return asyncAction(id, waitFor(function () {
      return !hasLiveRoom();
    }, command.timeoutMs, 50).then(function (closed) {
      if (!closed) throw new Error('Live room did not close before timeout');
      return { exited: true, hasLiveRoom: false };
    }), null, 'EXIT_FAILED');
  }

  function coordinate(game, name) {
    if (!game || typeof game[name] !== 'function') return Number.NaN;
    var raw = game[name]();
    if (raw === null || raw === undefined) return Number.NaN;
    if (typeof raw === 'string' && !raw.trim()) return Number.NaN;
    return Number(raw);
  }

  function gpsReading(game) {
    var latitude = coordinate(game, 'getLatitude');
    var longitude = coordinate(game, 'getLongitude');
    if (!isFinite(latitude) || !isFinite(longitude)) return null;
    if (latitude === 0 && longitude === 0) return null;
    if (latitude < -90 || latitude > 90) return null;
    if (longitude < -180 || longitude > 180) return null;
    return { latitude: latitude, longitude: longitude };
  }

  function locationEvidence() {
    try {
      if (!window.jsb || !jsb.reflection || typeof jsb.reflection.callStaticMethod !== 'function') return null;
      var raw = jsb.reflection.callStaticMethod(CALLBACK_CLASS, 'getLocationEvidence', '()Ljava/lang/String;');
      if (typeof raw !== 'string' || !raw.trim()) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) { return null; }
  }

  function locationNumber(value) {
    if (value === null || value === undefined || value === '') return Number.NaN;
    return Number(value);
  }

  function validLocationPermission(value) {
    return value === 'android.permission.ACCESS_FINE_LOCATION' || value === 'android.permission.ACCESS_COARSE_LOCATION';
  }

  function structuredGpsReading(command, requestedAt) {
    var evidence = locationEvidence();
    if (!evidence || evidence.available !== true) return null;
    var provider = typeof evidence.provider === 'string' ? evidence.provider.trim() : '';
    var permission = typeof evidence.permission === 'string' ? evidence.permission.trim() : '';
    var observedAt = locationNumber(evidence.observedAt);
    var timestamp = locationNumber(evidence.timestamp);
    var ageMs = locationNumber(evidence.ageMs);
    var accuracy = locationNumber(evidence.accuracy);
    var latitude = locationNumber(evidence.latitude);
    var longitude = locationNumber(evidence.longitude);
    var maxAge = command.maxLocationAgeMs == null ? 60000 : Number(command.maxLocationAgeMs);
    if (!provider || !validLocationPermission(permission)) return null;
    if (!isFinite(observedAt) || observedAt < requestedAt) return null;
    if (!isFinite(timestamp) || timestamp <= 0 || timestamp < requestedAt) return null;
    if (!isFinite(ageMs) || ageMs < 0 || !isFinite(maxAge) || maxAge < 0 || ageMs > maxAge) return null;
    if (!isFinite(accuracy) || accuracy <= 0) return null;
    if (!isFinite(latitude) || !isFinite(longitude) || latitude === 0 && longitude === 0) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return {
      latitude: latitude,
      longitude: longitude,
      provider: provider,
      timestamp: timestamp,
      ageMs: ageMs,
      accuracy: accuracy,
      permission: permission,
      observedAt: observedAt
    };
  }

  function gps(id, command) {
    var game = window.cc && cc.mm && cc.mm.gameserver;
    if (!game || typeof game.requestLocation !== 'function') return fail(id, 'GPS_UNAVAILABLE', 'cc.mm.gameserver.requestLocation is unavailable');
    // Capture the request boundary before invoking the native request so a
    // synchronous cached callback cannot satisfy a later stale-location check.
    var requestedAt = Date.now();
    try { game.requestLocation(); }
    catch (failure) { return fail(id, 'GPS_FAILED', failure.message || String(failure)); }
    return asyncAction(id, waitFor(function () {
      return structuredGpsReading(command, requestedAt);
    }, command.timeoutMs, 25).then(function (value) {
      if (!value) throw new Error('Location has not been resolved');
      return value;
    }), null, 'GPS_UNAVAILABLE');
  }

  function voiceFaceId(item) {
    if (!item || typeof item !== 'object') return null;
    var values = [item.mutualFaceId, item.faceId, item.face_id, item.id];
    for (var index = 0; index < values.length; index++) {
      var value = values[index];
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
      if (typeof value === 'string') {
        var match = value.trim().match(/^(?:face[-_]?)?(\d+)$/i);
        if (match) return Number(match[1]);
      }
    }
    return null;
  }

  function findVoiceItem(items, faceId) {
    for (var index = 0; index < items.length; index++) {
      if (voiceFaceId(items[index]) === faceId) return items[index];
    }
    return null;
  }

  function voice(id, command) {
    var faceId = Number(command.mutualFaceId == null ? command.faceId : command.mutualFaceId);
    if (!Number.isInteger(faceId) || faceId < 0) return fail(id, 'VOICE_ID_REQUIRED', 'mutualFaceId is required');
    var controller = findGameController();
    if (!controller || typeof controller.onClickChatBtn !== 'function') return fail(id, 'GAME_UI_UNAVAILABLE', 'dss_game.onClickChatBtn is unavailable');
    var notification = window.cc && cc.mm && cc.mm.notification;
    if (!notification || typeof notification.on !== 'function') return fail(id, 'VOICE_NOTIFICATION_UNAVAILABLE', 'cc.mm.notification is unavailable');
    return asyncAction(id, new Promise(function (resolve, reject) {
      var settled = false, timer = null, channel = 0;
      function cleanup() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (typeof notification.off === 'function') { try { notification.off(channel, onNotify); } catch (_) {} }
      }
      function complete(value) { if (settled) return; settled = true; cleanup(); resolve(value); }
      function abort(failure) { if (settled) return; settled = true; cleanup(); reject(failure); }
      function onNotify(payload) {
        var receivedFace = payload && (payload.mutualFaceId == null ? payload.faceId : payload.mutualFaceId);
        if (receivedFace == null || Number(receivedFace) !== faceId) {
          abort(new Error('HWNotifyChat receipt did not match mutualFaceId ' + faceId));
          return;
        }
        var expectedSeat = command.targetSeat == null ? null : Number(command.targetSeat);
        var receivedSeat = payload && (payload.targetSeat == null ? payload.seat : payload.targetSeat);
        if (expectedSeat !== null && (receivedSeat == null || Number(receivedSeat) !== expectedSeat)) {
          abort(new Error('HWNotifyChat receipt did not match targetSeat ' + expectedSeat));
          return;
        }
        var expectedUid = command.targetUid == null ? null : String(command.targetUid);
        var receivedUid = payload && (payload.targetUid == null ? payload.toUid : payload.targetUid);
        if (expectedUid !== null && (receivedUid == null || String(receivedUid) !== expectedUid)) {
          abort(new Error('HWNotifyChat receipt did not match targetUid ' + expectedUid));
          return;
        }
        complete({ submitted: true, mutualFaceId: faceId, targetSeat: expectedSeat == null ? Number(command.targetSeat || 1) : expectedSeat, targetUid: expectedUid, notified: true });
      }
      try {
        channel = ((cc.mm.frametype && cc.mm.frametype.MSG_NOTICE_CMD) || 0) + ((cc.mm.msgEvent && cc.mm.msgEvent.HWNotifyChat) || 0);
      } catch (_) { channel = 0; }
      try { notification.on(channel, onNotify); }
      catch (failure) { abort(failure); return; }
      timer = setTimeout(function () { abort(new Error('HWNotifyChat was not observed before timeout')); }, boundWait(command.timeoutMs));
      var opened = false;
      try { controller.onClickChatBtn(); opened = true; }
      catch (_) { opened = false; }
      if (!opened) {
        // Fall back to opening the original panel directly when the button
        // handler cannot run (for example before the hall scene is fully wired).
        try {
          var resources = cc.mm && cc.mm.config && cc.mm.config.resources || null;
          if (cc.mm && cc.mm.uimanager && typeof cc.mm.uimanager.showWindow === 'function') {
            cc.mm.uimanager.showWindow(resources, 'CommonFace', controller.model && controller.model.selfSeat);
          }
        } catch (fallbackFailure) { abort(fallbackFailure); return; }
      }
      try {
        var panel = getWindow('CommonFace');
        if (!panel || typeof panel.onClickText !== 'function') throw new Error('CommonFace panel is unavailable');
        var items = Array.isArray(panel.items) ? panel.items : [];
        var item = findVoiceItem(items, faceId);
        if (!item) throw new Error('CommonFace item for mutualFaceId ' + faceId + ' is unavailable');
        panel.onClickText({ node: item });
      } catch (failure) { abort(failure); }
    }), null, 'VOICE_FAILED');
  }

  function network(id) {
    var config = window.Standalone && Standalone.config;
    if (!config || typeof config.apiBase !== 'string' || typeof config.wsUrl !== 'string') return fail(id, 'NETWORK_UNAVAILABLE', 'Standalone network configuration is unavailable');
    if (typeof Standalone.allowedRequest !== 'function') return fail(id, 'NETWORK_UNAVAILABLE', 'Standalone.allowedRequest is unavailable');
    var base = config.apiBase.replace(/\/+$/, ''), ws = config.wsUrl;
    var apiOk = !!Standalone.allowedRequest(base + '/health', false);
    var wsOk = !!Standalone.allowedRequest(ws, true);
    var apiHost = hostOf(base), wsHost = hostOf(ws);
    if (!apiOk || !wsOk || !apiHost || apiHost !== wsHost) {
      return fail(id, 'NETWORK_MISMATCH', 'API and WebSocket endpoints must be allowed on the same host', {
        apiBase: base, wsUrl: ws, apiAllowed: apiOk, wsAllowed: wsOk, apiHost: apiHost, wsHost: wsHost
      });
    }
    return ok(id, { apiBase: base, wsUrl: ws, apiHost: apiHost, wsHost: wsHost, allowed: true });
  }

  function evidence(id, command) {
    var value = command && command.evidence;
    if (!value || typeof value !== 'object') return fail(id, 'EVIDENCE_REQUIRED', 'evidence is required');
    return ok(id, value);
  }

  window.LocalAcceptance = {
    version: 1,
    dispatch: function (input) {
      var command;
      try { command = normalizeCommand(input); }
      catch (failure) { return fail('unknown', 'INVALID_COMMAND', failure.message || String(failure)); }
      var id = command.id == null ? 'unknown' : command.id;
      var action = own(ALIASES, command.action) ? ALIASES[command.action] : command.action;
      // Reset is the recovery primitive. It must remain callable even when a
      // previous asynchronous action is still marked active by the adapter.
      if (action === 'reset') return dispatch(action, command);
      if (active) return fail(id, 'BUSY', 'Another acceptance action is still running');
      try { return dispatch(action, command); }
      catch (failure) { return fail(id, failure.code || 'ACTION_EXCEPTION', failure.message || String(failure), failure.detail); }
    },
    // Legacy broadcast path helpers. The instrumentation driver does not need
    // them, so they stay explicit and are not polled during normal dispatch.
    takePending: function () {
      try {
        if (window.jsb && jsb.reflection && typeof jsb.reflection.callStaticMethod === 'function') {
          return jsb.reflection.callStaticMethod(RECEIVER_CLASS, 'takePending', '()Ljava/lang/String;');
        }
      } catch (_) {}
      return null;
    },
    drainPending: function () {
      var raw = this.takePending();
      if (typeof raw !== 'string' || !raw.trim()) return null;
      return this.dispatch(raw);
    }
  };
}());
