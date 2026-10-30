(function () {
  'use strict';
  var current = null, generation = 0, loading = 0, loadSequence = 0;
  var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function copy(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(copy);
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = copy(value[key]); });
    return result;
  }
  function check(condition, message) { if (!condition) throw new Error(message); }
  function basePath(roomId, roundId) {
    check(uuid.test(roomId) && uuid.test(roundId), 'Invalid replay identity');
    return '/api/records/' + roomId + '/replay/' + roundId + '/original';
  }
  function fetchJson(path, token) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', Standalone.config.apiBase + path, true);
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.timeout = 15000;
      xhr.onerror = xhr.ontimeout = function () { reject(new Error('回放读取失败，请重试。')); };
      xhr.onload = function () {
        try {
          check(xhr.responseText.length <= 1048576, 'Replay page is too large');
          var data = JSON.parse(xhr.responseText);
          check(xhr.status >= 200 && xhr.status < 300, data.error && data.error.message || '回放暂不可用。');
          resolve(data);
        } catch (error) { reject(error); }
      };
      xhr.send();
    });
  }
  function validatePacket(packet, snapshot) {
    check(packet && Number.isInteger(packet.command) && packet.body && typeof packet.body === 'object'
      && !Array.isArray(packet.body) && Array.isArray(packet.decimalFields), 'Invalid replay packet');
    check(snapshot ? packet.command === 48 : packet.command === 126 || Object.keys(cc.mm.msgEvent).some(function (name) {
      return /^HWNotif|^HWNottif/.test(name) && cc.mm.msgEvent[name] === packet.command;
    }), 'Replay packet cannot invoke a client request');
  }
  function validateFrame(frame, expected, count) {
    check(frame && frame.index === expected && expected >= 0 && expected < count
      && typeof frame.sequence === 'string' && /^\d+$/.test(frame.sequence)
      && Number.isInteger(frame.stateVersion) && frame.stateVersion >= 0 && typeof frame.autoPlay === 'boolean'
      && Array.isArray(frame.packets) && frame.packets.length <= 100, 'Invalid replay frame');
    check(JSON.stringify(frame).length <= 262144, 'Replay frame is too large');
    validatePacket(frame.snapshot, true);
    frame.packets.forEach(function (packet) { validatePacket(packet, false); });
    return frame;
  }
  function validateManifest(manifest, reference) {
    var path = basePath(reference.roomId, reference.roundId);
    check(manifest && manifest.version === 1 && manifest.roomId === reference.roomId && manifest.roundId === reference.roundId
      && typeof manifest.ruleVersion === 'string' && typeof manifest.variantKey === 'string'
      && /^[0-9a-f]{64}$/.test(manifest.digest) && Number.isInteger(manifest.frameCount)
      && manifest.frameCount >= 1 && manifest.frameCount <= 10001 && manifest.framesUrl === path + '/frames'
      && manifest.limits && manifest.limits.maxPageFrames === 50 && manifest.limits.maxPageBytes === 1048576, 'Invalid replay manifest');
    validateFrame(manifest.initial, 0, manifest.frameCount);
    return manifest;
  }
  function alive(session) { return current === session && session.generation === generation; }
  function cacheFrame(session, frame) {
    session.cache.delete(frame.index); session.cache.set(frame.index, frame);
    while (session.cache.size > 128) {
      var oldest = session.cache.keys().next().value;
      if (oldest === 0) { session.cache.delete(0); session.cache.set(0, session.manifest.initial); }
      else session.cache.delete(oldest);
    }
  }
  function getFrame(session, index) {
    if (session.cache.has(index)) return Promise.resolve(session.cache.get(index));
    if (session.pending.has(index)) return session.pending.get(index);
    var manifest = session.manifest;
    var request = fetchJson(manifest.framesUrl + '?digest=' + manifest.digest + '&offset=' + index + '&limit=50', session.token).then(function (page) {
      check(alive(session), 'Replay was closed');
      check(page && page.version === 1 && page.digest === manifest.digest && page.frameCount === manifest.frameCount
        && page.offset === index && Array.isArray(page.frames) && page.frames.length >= 1 && page.frames.length <= 50
        && index + page.frames.length <= manifest.frameCount
        && page.nextOffset === (index + page.frames.length < manifest.frameCount ? index + page.frames.length : null), 'Replay page does not match its manifest');
      page.frames.forEach(function (frame, offset) { validateFrame(frame, index + offset, manifest.frameCount); });
      page.frames.forEach(function (frame) { cacheFrame(session, frame); });
      return session.cache.get(index);
    });
    session.pending.set(index, request);
    request.then(function () { session.pending.delete(index); }, function () { session.pending.delete(index); });
    return request;
  }
  function clearQueued(session) {
    var server = cc.mm.server;
    server._msgActList = server._msgActList.filter(function (message) { return message.replayGeneration !== session.generation; });
    server._colTime = 0; server._lastStageTime = 0;
  }
  function controls(session) {
    var controller = session.controller, ended = session.index >= session.manifest.frameCount - 1;
    var progress = session.manifest.frameCount === 1 ? 1 : session.index / (session.manifest.frameCount - 1);
    controller.views.slider.getComponent(cc.Slider).progress = progress;
    controller.views['slider/bar'].getComponent(cc.Sprite).fillRange = progress;
    controller.views.label.getComponent(cc.Label).string = 'x' + controller.speed;
    controller.views['bofang/zanting'].active = !controller.isPlay;
    controller.views['bofang/bofang'].active = controller.isPlay;
    controller.views.tohall.active = ended;
    controller.views.replay.active = ended;
  }
  function pauseWithError(session, error) {
    if (!alive(session)) return;
    session.busy = false;
    if (session.controller) {
      session.controller.isPlay = false; session.controller.unscheduleAllCallbacks(); controls(session);
    }
    cc.mm.uimanager.showTextPrompt(String(error.message || '回放读取失败，请重试。'));
  }
  function applySnapshot(session, frame) {
    clearQueued(session);
    ['dss_settle_UI', 'CommonBigResult'].forEach(function (name) { cc.mm.uimanager.closewindow(name); });
    var message = cc.mm.netTools.replayPacket(frame.snapshot);
    // Candidate buttons and automatic cancel requests belong to live play, not seeking.
    delete message.body.choice;
    if (message.body.gameStart) message.body.gameStart.seats.forEach(function (seat) {
      if (seat.seatIndex === message.body.seatIndex) seat.auto = frame.autoPlay;
    });
    cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + message.code, message.body, message.code);
    var auto = cc.mm.netTools.replayPacket({ command: frame.autoPlay ? 123 : 126, body: frame.autoPlay ? {} : { result: 1 }, decimalFields: [] });
    cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + auto.code, auto.body, auto.code);
    window.StandaloneReplay.didDispatch();
    session.index = frame.index;
  }
  function schedule(session, delay) {
    if (alive(session) && session.controller.isPlay && session.index < session.manifest.frameCount - 1) {
      session.controller.scheduleOnce(function () { step(session); }, delay === undefined ? session.controller.playtime / session.controller.speed : delay);
    }
  }
  function step(session) {
    if (!alive(session) || session.busy || !session.controller.isPlay) return;
    if (session.index >= session.manifest.frameCount - 1) { session.controller.isPlay = false; controls(session); return; }
    session.busy = true;
    var revision = session.revision;
    getFrame(session, session.index + 1).then(function (frame) {
      if (!alive(session) || revision !== session.revision) return;
      session.busy = false;
      if (!session.controller.isPlay) return;
      var packets = frame.packets;
      if (!packets.length || packets.some(function (packet) { return packet.command === 32; })) applySnapshot(session, frame);
      else {
        var messages = packets.map(function (packet) { return cc.mm.netTools.replayPacket(packet); });
        messages.forEach(function (message) {
          message.replayGeneration = session.generation;
          cc.mm.server._msgActList.push(message);
        });
        session.index = frame.index;
      }
      if (session.index >= session.manifest.frameCount - 1) session.controller.isPlay = false;
      controls(session);
      var delay = session.controller.playtime / session.controller.speed + packets.length * 0.05
        + packets.filter(function (packet) { return packet.command === 26; }).length * 0.8;
      schedule(session, delay);
    }).catch(function (error) { if (revision === session.revision) pauseWithError(session, error); });
  }
  function seek(session, progress, restart) {
    check(typeof progress === 'number' && isFinite(progress), 'Invalid replay position');
    var index = Math.round(Math.max(0, Math.min(1, progress)) * (session.manifest.frameCount - 1));
    var revision = ++session.revision;
    session.controller.unscheduleAllCallbacks(); clearQueued(session); session.busy = true;
    getFrame(session, index).then(function (frame) {
      if (!alive(session) || revision !== session.revision) return;
      session.busy = false; applySnapshot(session, frame);
      if (restart) session.controller.isPlay = true;
      if (index === session.manifest.frameCount - 1) session.controller.isPlay = false;
      controls(session); schedule(session);
    }).catch(function (error) { if (revision === session.revision) pauseWithError(session, error); });
  }
  window.StandaloneReplay = {
    active: function () { return !!current; },
    isCurrent: function (id) { return !!current && id === current.generation; },
    didDispatch: function () {
      if (!current) return;
      var table = cc.mm.uimanager.getWindow('dss_game');
      if (table) Standalone.table(table);
    },
    reauthenticated: function (token) {
      if (!current) return;
      current.token = token;
      if (current.controller) seek(current, current.index / Math.max(1, current.manifest.frameCount - 1), false);
    },
    blocks: function (command) {
      // The connection remains authenticated for replay pages and hall balance updates.
      return !!current && [1, 37, 305].indexOf(command) < 0;
    },
    clear: function () {
      var previous = current; current = null; generation++; loading = 0;
      if (previous) {
        if (previous.controller) previous.controller.unscheduleAllCallbacks();
        clearQueued(previous);
      }
    },
    load: function (reference) {
      var self = this;
      if (loading) return Promise.resolve(false);
      try {
        check(reference && reference.version === 1 && reference.manifestUrl === basePath(reference.roomId, reference.roundId), 'Invalid replay reference');
        check(!Standalone.hasLiveRoom(), '请先退出当前房间。');
      } catch (error) { cc.mm.uimanager.showTextPrompt(error.message); return Promise.resolve(false); }
      var requestId = ++loadSequence, ownedSession = null;
      loading = requestId;
      var token = cc.sys.localStorage.getItem('GAME_TOKEN'), requestedGeneration = generation;
      return fetchJson(reference.manifestUrl, token).then(function (manifest) {
        if (requestedGeneration !== generation) return false;
        validateManifest(manifest, reference);
        check(!Standalone.hasLiveRoom(), '请先退出当前房间。');
        var initial = cc.mm.netTools.replayPacket(manifest.initial.snapshot).body;
        check(initial.tableInfo && Array.isArray(initial.userInfo) && initial.userInfo.length >= 2 && initial.userInfo.length <= 4, 'Replay seats are incomplete');
        cc.mm.gameserver.clear();
        current = { generation: generation, manifest: manifest, token: token, index: 0, revision: 0,
          controller: null, cache: new Map([[0, manifest.initial]]), pending: new Map(), busy: false };
        ownedSession = current;
        initial.userInfo.forEach(function (user) { cc.mm.gameserver.pushUser(copy(user)); });
        cc.mm.gameserver.setActionList([], copy(initial.gameStart || {}), copy(initial.tableInfo));
        cc.mm.gameserver.checkData();
        return true;
      }).catch(function (error) {
        var relevant = requestedGeneration === generation || ownedSession && alive(ownedSession);
        if (ownedSession && alive(ownedSession)) cc.mm.gameserver.clear();
        if (relevant) cc.mm.uimanager.showTextPrompt(String(error.message || '回放读取失败，请重试。'));
        return false;
      }).then(function (result) { if (loading === requestId) loading = 0; return result; });
    },
    attach: function (controller) {
      if (!current) return false;
      var session = current;
      session.controller = controller; controller._standaloneReplaySession = session;
      controller.unscheduleAllCallbacks(); controller.isPlay = session.manifest.frameCount > 1;
      applySnapshot(session, session.manifest.initial); controls(session); schedule(session);
      return true;
    },
    handle: function (controller, action, value) {
      var session = controller._standaloneReplaySession;
      if (!session || !alive(session)) return false;
      if (action === 'continue') step(session);
      else if (action === 'seek') seek(session, value.progress, false);
      else if (action === 'restart') seek(session, 0, true);
      else if (action === 'home') { this.clear(); return false; }
      else if (action === 'toggle') {
        controller.isPlay = !controller.isPlay;
        controller.unscheduleAllCallbacks(); controls(session); schedule(session);
      } else if (action === 'slower' || action === 'faster') {
        controller.speed = Math.max(1, Math.min(controller.maxSpeed, controller.speed + (action === 'faster' ? 1 : -1)));
        controller.unscheduleAllCallbacks(); controls(session); schedule(session);
      }
      return true;
    }
  };
}());
