(function () {
  'use strict';
  var config = window.STANDALONE_CONFIG;
  var edition = window.STANDALONE_EDITION;
  if (!edition || !Array.isArray(edition.gameIds)) throw new Error('Missing regional edition configuration');
  var hasUrlParser = false;
  try { hasUrlParser = new URL('https://standalone.invalid/').origin === 'https://standalone.invalid'; } catch (_) {}
  function networkOrigin(value) {
    if (typeof value !== 'string' || /[\\\s]/.test(value)) return null;
    if (hasUrlParser) {
      try {
        var parsed = new URL(value);
        if (parsed.username || parsed.password || !/^(https?|wss?):$/.test(parsed.protocol)) return null;
        return parsed.origin;
      } catch (_) { return null; }
    }
    // JSB does not provide the browser URL API. Accept only an unambiguous authority.
    var match = /^(https?|wss?):\/\/(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?#]|$)/i.exec(value);
    if (!match || match[3] && (+match[3] < 1 || +match[3] > 65535)) return null;
    var scheme = match[1].toLowerCase(), port = match[3] ? String(+match[3]) : '';
    if (port === (/^(https|wss)$/.test(scheme) ? '443' : '80')) port = '';
    return scheme + '://' + match[2].toLowerCase() + (port ? ':' + port : '');
  }
  var apiOrigin = networkOrigin(config.apiBase), socketOrigin = networkOrigin(config.wsUrl);
  if (!apiOrigin || !socketOrigin) throw new Error('Invalid standalone network configuration');
  var pageOrigin = typeof location !== 'undefined' ? networkOrigin(location.href) : null;
  if (typeof document !== 'undefined' && document.head) {
    var policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: " + apiOrigin + "; font-src 'self' data:; media-src 'self' blob: " + apiOrigin + "; connect-src 'self' " + apiOrigin + ' ' + socketOrigin + "; frame-src 'self' " + apiOrigin + "; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'";
    document.head.appendChild(policy);
  }
  function allowedRequest(value, socket) {
    if (typeof value !== 'string' || /[\\\s]/.test(value)) return false;
    if (value.indexOf('//') === 0) value = (socket ? config.wsUrl : config.apiBase).split(':')[0] + ':' + value;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return !socket;
    var origin = networkOrigin(value);
    return !!origin && (socket ? origin === socketOrigin : origin === apiOrigin || origin === pageOrigin);
  }
  function requireRequest(value, socket) {
    if (!allowedRequest(value, socket)) throw new Error('External request blocked');
  }
  if (window.fetch) {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input.url;
      if (!allowedRequest(url, false)) return Promise.reject(new Error('External request blocked'));
      return nativeFetch.call(window, input, init);
    };
  }
  if (window.XMLHttpRequest) {
    var xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      requireRequest(url, false);
      return xhrOpen.apply(this, arguments);
    };
  }
  if (window.WebSocket) {
    var NativeWebSocket = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      requireRequest(url, true);
      return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (key) { window.WebSocket[key] = NativeWebSocket[key]; });
  }
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    var nativeBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) { return allowedRequest(url, false) && nativeBeacon.call(navigator, url, data); };
  }
  var Money = Decimal.clone({ precision: 128, toExpNeg: -128, toExpPos: 128 });
  function amount(value) {
    if (value == null) return new Money(0);
    if (typeof value === 'object' && typeof value.toString === 'function') value = value.toString();
    var decimal = new Money(value);
    if (!decimal.isFinite() || decimal.decimalPlaces() > 12) throw new Error('Invalid exact amount');
    return decimal;
  }

  function hide(views, names) { names.forEach(function (name) { if (views[name]) views[name].active = false; }); }
  function addBeanBalance(coin) {
    if (coin._standaloneBeanBalance) return coin._standaloneBeanBalance;
    var width = coin._standaloneBalanceWidth || coin.width || 156, height = coin.height || 48;
    var panel = new cc.Node('standaloneBeanBalance');
    panel.setContentSize(width, height);
    // The parent still keeps the original 199px node because the right-most
    // 43px used to be a top-up control.  This panel follows the retained
    // 156px bitmap crop with a left-center origin, so child positions are not
    // accidentally interpreted from the old node centre.
    panel.setAnchorPoint(0, 0.5);
    panel.setPosition(-coin.width * coin.anchorX, height * (0.5 - coin.anchorY));
    if (!coin._standaloneBalanceWidth) {
      var background = panel.addComponent(cc.Graphics);
      background.fillColor = cc.color(10, 74, 77, 255);
      background.roundRect(0, -height / 2, width, height, height / 2);
      background.fill();
    }
    var value = new cc.Node('beanValue');
    value.setAnchorPoint(1, 0.5);
    value.setPosition(width - 14, 0);
    value.setContentSize(Math.max(56, width - 68), height);
    var valueLabel = value.addComponent(cc.Label);
    valueLabel.fontSize = 25;
    valueLabel.lineHeight = 28;
    valueLabel.horizontalAlign = cc.Label.HorizontalAlign.RIGHT;
    valueLabel.verticalAlign = cc.Label.VerticalAlign.CENTER;
    valueLabel.enableWrapText = false;
    valueLabel.overflow = cc.Label.Overflow.SHRINK;
    value.color = cc.color(255, 255, 255);
    panel.addChild(value);
    coin.addChild(panel);
    coin._standaloneBeanBalance = { panel: panel, value: valueLabel };
    return coin._standaloneBeanBalance;
  }
  function useBeansAtTable(controller) {
    var scoreNode = controller.views && controller.views['buttom/scoreNode'];
    if (scoreNode) {
      var doudou = scoreNode.getChildByName('doudou'), score = scoreNode.getChildByName('score');
      if (doudou) {
        doudou.active = true;
        if (!doudou._standaloneBeanIcon) {
          // The self-seat sprite combines a coin with its whole balance bar.
          // Reuse the other seats' separate background and bean without
          // stretching the bean across the balance label.
          var icon = doudou.getComponent(cc.Sprite);
          var donor = controller.node.getComponentsInChildren(cc.Sprite).filter(function (sprite) {
            return sprite.node.name === 'gy_dou' && sprite.spriteFrame;
          })[0];
          var background = donor && donor.node.parent.getComponent(cc.Sprite);
          if (icon && donor && background && background.spriteFrame) {
            var size = doudou.getContentSize();
            icon.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            icon.spriteFrame = background.spriteFrame;
            doudou.setContentSize(size);
            var bean = new cc.Node('standaloneBeanIcon');
            var beanSprite = bean.addComponent(cc.Sprite), originalSize = donor.spriteFrame.getOriginalSize();
            beanSprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            beanSprite.spriteFrame = donor.spriteFrame;
            bean.setContentSize(size.height * originalSize.width / originalSize.height, size.height);
            bean.setPosition(-size.width * doudou.anchorX + bean.width / 2, size.height * (0.5 - doudou.anchorY));
            doudou.addChild(bean);
            doudou._standaloneBeanIcon = true;
          }
        }
      }
      if (score) score.active = false;
    }
  }
  var retainedAreaTypes = {};
  edition.gameIds.forEach(function (id) { retainedAreaTypes[id] = true; });
  // Expose every retained configuration whose runtime engine is registered and verified.
  var clientReadyAreaTypes = {};
  edition.gameIds.forEach(function (id) { clientReadyAreaTypes[id] = true; });
  var manualPlayerAreas = { 14: true, 15: true };
  var wireCursor = null, wirePending = null, wireLastAction = null, wireRecovering = false, wireCreateRoom = null, wirePendingRoomOptions = null;
  var wireDecisionId = null;
  var wireSequence = 0, wireNonce = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  function isGameRequest(command) { return command === 23 || command === 53; }
  function isProtectedRequest(command) { return isGameRequest(command) || command === 121 || command === 125; }
  function own(object, key) { return !!object && Object.prototype.hasOwnProperty.call(object, key); }
  function areaNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) && Math.floor(parsed) === parsed ? parsed : null;
  }
  function retainedArea(value) {
    var id = areaNumber(value);
    return id !== null && !!retainedAreaTypes[id] ? id : null;
  }
  function needsManualBaseBeans(rules, areaType) {
    var id = retainedArea(areaType);
    return id !== null;
  }
  function needsManualPlayerNum(areaType) {
    var id = areaNumber(areaType);
    return id !== null && !!manualPlayerAreas[id];
  }
  function playerNumber(value) {
    var parsed = Number(value);
    return parsed === 2 || parsed === 3 || parsed === 4 ? parsed : null;
  }
  // Keep the wire value as text. Number/Decimal would round an 80-digit integer.
  function positiveBaseBeans(value) {
    if (value === undefined || value === null) return null;
    var text = String(value).replace(/^\s+|\s+$/g, '');
    if (!/^(?:0|[1-9]\d{0,79})(?:\.\d{1,12})?$/.test(text)) return null;
    if (/^0(?:\.0{1,12})?$/.test(text)) return null;
    return text;
  }
  function promptRoom(message) {
    if (typeof cc !== 'undefined' && cc.mm && cc.mm.uimanager && cc.mm.uimanager.showTextPrompt) cc.mm.uimanager.showTextPrompt(message);
  }
  function validNode(node) {
    if (!node) return false;
    if (typeof cc === 'undefined' || !cc.isValid) return true;
    try { return cc.isValid(node, true); } catch (_) { return false; }
  }
  function resetNode(node) {
    if (typeof cc !== 'undefined' && cc.mm && cc.mm.uitools && cc.mm.uitools.restNode) cc.mm.uitools.restNode(node);
  }
  function destroyNode(node) {
    if (!node) return;
    try { if (node.removeFromParent) node.removeFromParent(true); } catch (_) {}
    try { if (node.destroy) node.destroy(); } catch (_) {}
  }
  function normalizeCurrencyText(value) {
    if (typeof value !== 'string' || !value) return value;
    return value.replace(/最终分数/g, '最终豆子变化').replace(/本局分数/g, '本局豆子变化')
      .replace(/房间积分/g, '本房豆子变化').replace(/算分方式/g, '豆子结算方式')
      .replace(/积分/g, '豆子').replace(/金币/g, '豆子').replace(/筹码/g, '豆子').replace(/豆豆/g, '豆子');
  }
  function normalizeCurrencyLabels(root) {
    if (!validNode(root)) return;
    var children = root.children || [];
    var label = root.getComponent && typeof cc !== 'undefined' && cc.Label ? root.getComponent(cc.Label) : null;
    if (label && typeof label.string === 'string') {
      var normalized = normalizeCurrencyText(label.string);
      if (normalized !== label.string) label.string = normalized;
    }
    for (var index = 0; index < children.length; index++) normalizeCurrencyLabels(children[index]);
  }
  function roomRuleTemplate(controller) {
    return controller && controller.views && controller.views['hall_room_center/left/ruleNode/view/ruleView'];
  }
  function roomOptionTemplate(controller) {
    var row = roomRuleTemplate(controller), rules = row && row.getChildByName && row.getChildByName('rules');
    return rules && rules.getChildByName && rules.getChildByName('item_type_1');
  }
  function setRuleLabel(row, text) {
    var label = row && row.getChildByName && row.getChildByName('label');
    var component = label && label.getComponent && typeof cc !== 'undefined' && cc.Label ? label.getComponent(cc.Label) : null;
    if (component) {
      component.string = text;
      component.overflow = cc.Label.Overflow.SHRINK;
      component.enableWrapText = false;
    }
  }
  function makeRoomRuleRow(controller, key, title) {
    var template = roomRuleTemplate(controller);
    if (!template || typeof cc === 'undefined' || !cc.instantiate) return null;
    var row = cc.instantiate(template);
    resetNode(row);
    row.name = 'standalone-' + key;
    row.active = true;
    setRuleLabel(row, title);
    if (row.height < 60) row.height = 60;
    var rules = row.getChildByName && row.getChildByName('rules');
    if (rules) {
      rules.removeAllChildren(true);
      rules.active = true;
      var rulesLayout = rules.getComponent && cc.Layout ? rules.getComponent(cc.Layout) : null;
      if (rulesLayout) rulesLayout.enabled = false;
    }
    var line = row.getChildByName && row.getChildByName('line');
    if (line) line.active = true;
    return row;
  }
  function makeInputItem(controller, row, initial) {
    var template = roomOptionTemplate(controller), item = template && cc.instantiate ? cc.instantiate(template) : new cc.Node('baseBeansInputItem');
    resetNode(item);
    item.name = 'baseBeansInputItem';
    item.active = true;
    item.setContentSize(330, 60);
    var label = item.getChildByName && item.getChildByName('label');
    if (label) label.active = false;
    var toggle = item.getChildByName && item.getChildByName('toggle');
    if (toggle) toggle.active = false;
    var help = item.getChildByName && item.getChildByName('wenhao');
    if (help) help.active = false;
    var inputNode = new cc.Node('baseBeansEditBox');
    var width = 285, height = 46;
    inputNode.setContentSize(width, height);
    inputNode.setAnchorPoint(0.5, 0.5);
    // Match the original rule-row offset: controls begin to the right of the label.
    inputNode.setPosition(0, 0);
    var background = inputNode.addComponent(cc.Graphics);
    background.fillColor = cc.color(255, 255, 255, 235);
    background.strokeColor = cc.color(185, 170, 150, 255);
    background.lineWidth = 2;
    background.roundRect(-width / 2, -height / 2, width, height, 8);
    background.fill();
    background.stroke();
    var edit = inputNode.addComponent(cc.EditBox);
    edit.maxLength = 93;
    function makeEditLabel(name, color, size) {
      var node = new cc.Node(name);
      node.setAnchorPoint(0, 1);
      node.setPosition(-width / 2 + 12, height / 2);
      node.setContentSize(width - 24, height);
      node.color = color;
      var label = node.addComponent(cc.Label);
      label.fontSize = size;
      label.lineHeight = 28;
      label.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
      label.verticalAlign = cc.Label.VerticalAlign.CENTER;
      label.enableWrapText = false;
      inputNode.addChild(node);
      return label;
    }
    // Bind the actual EditBox labels so focus, native IME and blur share one
    // visibility lifecycle; no independent text overlay remains.
    edit.textLabel = makeEditLabel('TEXT_LABEL', cc.color(90, 70, 60, 255), 22);
    edit.placeholderLabel = makeEditLabel('PLACEHOLDER_LABEL', cc.color(155, 137, 119, 255), 20);
    // Browser number inputs sanitize the intermediate "0." while Cocos copies
    // value on every keystroke. Text preserves exact decimals and long integers.
    edit.inputMode = cc.sys.isBrowser ? cc.EditBox.InputMode.SINGLE_LINE : cc.EditBox.InputMode.DECIMAL;
    inputNode.on('editing-did-began', function () {
      if (cc.sys.isBrowser && edit._impl && edit._impl._elem) edit._impl._elem.setAttribute('inputmode', 'decimal');
    });
    edit.textLabel.overflow = cc.Label.Overflow.SHRINK;
    edit.returnType = cc.EditBox.KeyboardReturnType.DONE;
    edit.placeholder = '请输入底分（豆子）';
    edit.string = initial || '';
    inputNode.on('editing-return', function () { edit.blur(); });
    item.addChild(inputNode);
    item.x = 250;
    item.y = 0;
    return { node: item, edit: edit };
  }
  function updatePlayerItems(controller, selected) {
    var items = controller && controller._standalonePlayerNumItems || [];
    for (var index = 0; index < items.length; index++) {
      var item = items[index], toggle = item.getChildByName && item.getChildByName('toggle'), toggleComponent = toggle && toggle.getComponent && cc.Toggle ? toggle.getComponent(cc.Toggle) : null;
      var value = item._standalonePlayerValue;
      if (toggleComponent) toggleComponent.isChecked = value === selected;
      var label = item.getChildByName && item.getChildByName('label'), labelComponent = label && label.getComponent && cc.Label ? label.getComponent(cc.Label) : null;
      if (labelComponent) labelComponent.color = value === selected ? cc.color(39, 160, 141) : cc.color(158, 138, 123);
    }
  }
  function choosePlayerNum(controller, value) {
    var selected = playerNumber(value);
    if (selected === null) return;
    controller._standalonePlayerNumDraft = selected;
    controller._rules.playerNum = selected;
    updatePlayerItems(controller, selected);
  }
  function addPlayerNumRow(controller) {
    var row = makeRoomRuleRow(controller, 'playerNum', '人数');
    if (!row) return null;
    var rules = row.getChildByName('rules'), template = roomOptionTemplate(controller), values = [2, 3, 4], items = [];
    for (var index = 0; index < values.length; index++) {
      var value = values[index], item = template && cc.instantiate ? cc.instantiate(template) : new cc.Node('playerNum-' + value);
      resetNode(item);
      item.name = 'playerNum-' + value;
      item.active = true;
      item._standalonePlayerValue = value;
      item.x = index * 220 + 45.84;
      item.y = 0;
      var label = item.getChildByName && item.getChildByName('label'), labelComponent = label && label.getComponent && cc.Label ? label.getComponent(cc.Label) : null;
      if (labelComponent) labelComponent.string = value + '人';
      var help = item.getChildByName && item.getChildByName('wenhao'); if (help) help.active = false;
      if (cc.mm && cc.mm.uitools && cc.mm.uitools.addBtnLister) cc.mm.uitools.addBtnLister(item, choosePlayerNum.bind(null, controller, value), controller);
      else if (item.on && cc.Node.EventType) item.on(cc.Node.EventType.TOUCH_END, choosePlayerNum.bind(null, controller, value));
      rules.addChild(item);
      items.push(item);
    }
    controller._standalonePlayerNumItems = items;
    var selected = playerNumber(controller._rules.playerNum);
    if (selected !== null) choosePlayerNum(controller, selected); else updatePlayerItems(controller, null);
    return row;
  }
  function removeCreateRoomRows(controller) {
    if (!controller) return;
    var content = controller._scrollview && controller._scrollview.content;
    ['standalone-baseBeans', 'standalone-playerNum'].forEach(function (name) {
      var row = content && content.getChildByName && content.getChildByName(name);
      if (row) destroyNode(row);
    });
    controller._standaloneBaseBeansInput = null;
    controller._standalonePlayerNumItems = [];
    controller._standaloneRoomInputSignature = null;
  }
  function prepareCreateRoom(controller) {
    if (!controller || !controller._scrollview || !controller._scrollview.content) return null;
    var area = retainedArea(controller._areaType), rules = controller._rules || (controller._rules = {});
    if (area === null) { removeCreateRoomRows(controller); return null; }
    var needBase = needsManualBaseBeans(rules, area), needPlayers = needsManualPlayerNum(area);
    var signature = String(area) + '|' + (needBase ? 'b' : '-') + '|' + (needPlayers ? 'p' : '-');
    var content = controller._scrollview.content;
    var baseRow = content.getChildByName && content.getChildByName('standalone-baseBeans');
    var playerRow = content.getChildByName && content.getChildByName('standalone-playerNum');
    if (controller._standaloneRoomInputSignature !== signature || needBase && !validNode(baseRow) || needPlayers && !validNode(playerRow)) {
      removeCreateRoomRows(controller);
      controller._standaloneRoomInputSignature = signature;
      if (needBase) {
        // These fields have no original defaults. Do not carry an old selection into a new room form.
        delete rules.baseBeans;
        controller._standaloneBaseBeansDraft = '';
        baseRow = makeRoomRuleRow(controller, 'baseBeans', '底分：');
        if (baseRow) {
          var input = makeInputItem(controller, baseRow, '');
          var baseRules = baseRow.getChildByName('rules');
          if (input && baseRules) {
            baseRules.addChild(input.node);
            controller._standaloneBaseBeansInput = input.edit;
            input.edit.node.on('text-changed', function () {
              controller._standaloneBaseBeansDraft = input.edit.string;
              controller._rules.baseBeans = input.edit.string;
            });
            input.edit.node.on('editing-did-ended', function () {
              controller._standaloneBaseBeansDraft = input.edit.string;
              controller._rules.baseBeans = input.edit.string;
            });
            content.addChild(baseRow);
          }
        }
      }
      if (needPlayers) {
        delete rules.playerNum;
        controller._standalonePlayerNumDraft = null;
        playerRow = addPlayerNumRow(controller);
        if (playerRow) content.addChild(playerRow);
      }
      var layout = content.getComponent && cc.Layout ? content.getComponent(cc.Layout) : null;
      if (layout && layout.updateLayout) layout.updateLayout();
    }
    if (needBase && controller._standaloneBaseBeansInput) {
      var draft = own(rules, 'baseBeans') ? rules.baseBeans : controller._standaloneBaseBeansDraft;
      if (draft !== undefined && draft !== null && controller._standaloneBaseBeansInput.string !== String(draft)) {
        controller._standaloneBaseBeansInput.string = String(draft);
      }
    }
    if (needPlayers) updatePlayerItems(controller, playerNumber(rules.playerNum));
    return { areaType: area, needBaseBeans: needBase, needPlayerNum: needPlayers, baseInput: controller._standaloneBaseBeansInput, playerNum: playerNumber(rules.playerNum) };
  }
  function prepareCreateRoomOptions(rules, areaType) {
    rules = rules || {};
    var area = retainedArea(areaType !== undefined ? areaType : rules.gameid !== undefined ? rules.gameid : rules.areaType), metadata = {};
    if (area === null) return { ok: false, reason: 'removed' };
    if (area === 8) {
      var qionglai = { version: edition.qionglaiVersion };
      for (var i = 0; i < edition.qionglaiOptions.length; i++) {
        var key = edition.qionglaiOptions[i].value;
        var value = rules[key];
        if (value === true) value = 1;
        if (value === false) value = 0;
        if (value !== 0 && value !== 1) return { ok: false, reason: 'qionglai' };
        qionglai[key] = value;
      }
      metadata.qionglai = qionglai;
    }
    if (needsManualBaseBeans(rules, area)) {
      var baseBeans = positiveBaseBeans(rules.baseBeans);
      if (baseBeans === null) return { ok: false, reason: 'baseBeans' };
      rules.baseBeans = baseBeans;
      metadata.baseBeans = baseBeans;
    }
    if (needsManualPlayerNum(area)) {
      var players = playerNumber(rules.playerNum);
      if (players === null) return { ok: false, reason: 'playerNum' };
      rules.playerNum = players;
      metadata.playerNum = players;
    }
    return { ok: true, metadata: Object.keys(metadata).length ? metadata : null };
  }
  function validateCreateRoom(controller) {
    var prepared = prepareCreateRoom(controller), rules = controller && controller._rules || {};
    if (!prepared) return true;
    if (prepared.needBaseBeans) {
      var base = positiveBaseBeans(prepared.baseInput ? prepared.baseInput.string : rules.baseBeans);
      if (base === null) {
        promptRoom('请输入正数底分（豆子）');
        if (prepared.baseInput && prepared.baseInput.focus) prepared.baseInput.focus();
        return false;
      }
      rules.baseBeans = base;
      controller._standaloneBaseBeansDraft = base;
    }
    if (prepared.needPlayerNum && playerNumber(rules.playerNum) === null) {
      promptRoom('请选择房间人数');
      return false;
    }
    return true;
  }
  function validateCreateRoomMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    var result = {}, keys = Object.keys(metadata);
    for (var index = 0; index < keys.length; index++) if (keys[index] !== 'baseBeans' && keys[index] !== 'playerNum' && keys[index] !== 'qionglai') return null;
    if (own(metadata, 'qionglai')) { if (!validQionglai(metadata.qionglai)) return null; result.qionglai = metadata.qionglai; }
    if (own(metadata, 'baseBeans')) { var base = positiveBaseBeans(metadata.baseBeans); if (base === null) return null; result.baseBeans = base; }
    if (own(metadata, 'playerNum')) { var players = playerNumber(metadata.playerNum); if (players === null) return null; result.playerNum = players; }
    return Object.keys(result).length ? result : null;
  }
  function validQionglai(value) {
    return value && value.version === edition.qionglaiVersion && Object.keys(value).length === 4 &&
      edition.qionglaiOptions.every(function (option) { return value[option.value] === 0 || value[option.value] === 1; });
  }
  function roomOptionPrompt(reason) {
    return reason === 'removed' ? '此游戏已移除，请选择斗十四地区玩法。' :
      reason === 'qionglai' ? '邛崃玩法选项不完整，请重新选择玩法。' :
      reason === 'playerNum' ? '请选择房间人数' : '请输入正数底分（豆子）';
  }
  function hookCreateRoomRequest(app) {
    if (!app || !app.hallserver || typeof app.hallserver.requestCreateRoom !== 'function') return;
    var request = app.hallserver.requestCreateRoom;
    if (request._standaloneCreateRoomWrapper) return;
    var wrapped = function (rules, areaType) {
      var prepared = prepareCreateRoomOptions(rules, areaType);
      if (!prepared.ok) {
        promptRoom(roomOptionPrompt(prepared.reason));
        return false;
      }
      wireCreateRoom = prepared.metadata;
      try { return request.apply(this, arguments); } catch (error) { wireCreateRoom = null; throw error; }
    };
    wrapped._standaloneCreateRoomWrapper = true;
    app.hallserver.requestCreateRoom = wrapped;
  }
  function validRoomCursor(state) {
    var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (state && state.roomId === null) return state.roundId === null && state.stateVersion === null;
    return state && typeof state.roomId === 'string' && uuid.test(state.roomId)
      && (state.roundId === null && state.stateVersion === null || typeof state.roundId === 'string' && uuid.test(state.roundId)
        && typeof state.stateVersion === 'number' && Number.isInteger(state.stateVersion) && state.stateVersion >= 0 && state.stateVersion <= 2147483646);
  }
  function validRoomOptionsResponse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var keys = Object.keys(value), required = ['baseBeans', 'baseBeansSource', 'playerNum', 'playerNumSource'];
    if (keys.some(function (key) { return required.indexOf(key) < 0 && key !== 'qionglai'; }) || required.some(function (key) { return !own(value, key); })) return null;
    if (value.qionglai !== undefined && !validQionglai(value.qionglai)) return null;
    if (typeof value.baseBeans !== 'string' || !/^(?:0|[1-9]\d{0,79})(?:\.\d{1,12})?$/.test(value.baseBeans)) return null;
    if (value.baseBeansSource !== 'manual' && value.baseBeansSource !== 'original-basicTimes') return null;
    if (playerNumber(value.playerNum) === null) return null;
    if (value.playerNumSource !== 'manual' && value.playerNumSource !== 'original') return null;
    var result = { baseBeans: value.baseBeans, baseBeansSource: value.baseBeansSource, playerNum: value.playerNum, playerNumSource: value.playerNumSource };
    if (value.qionglai) result.qionglai = value.qionglai;
    return result;
  }
  function sameRoomOptions(left, right) {
    return left && right && left.baseBeans === right.baseBeans && left.baseBeansSource === right.baseBeansSource
      && left.playerNum === right.playerNum && left.playerNumSource === right.playerNumSource
      && JSON.stringify(left.qionglai) === JSON.stringify(right.qionglai);
  }
  function roomCode(value) {
    var code = Number(value);
    return Number.isInteger(code) && /^\d{6}$/.test(String(code)) ? code : null;
  }
  function applyRoomOptionsToTableInfo(tableInfo, options) {
    if (!tableInfo || typeof tableInfo !== 'object' || Array.isArray(tableInfo)) throw new Error('Missing room table information');
    var code = roomCode(tableInfo.roomId);
    if (code === null || playerNumber(tableInfo.playerNum) !== options.playerNum) throw new Error('Frozen room options do not match the table');
    tableInfo.baseBeans = options.baseBeans;
    tableInfo.baseBeansSource = options.baseBeansSource;
    tableInfo.playerNum = options.playerNum;
    tableInfo.playerNumSource = options.playerNumSource;
    if (options.qionglai) {
      if (Number(tableInfo.areaType) !== 8) throw new Error('Qionglai options attached to another game');
      tableInfo.qionglai = options.qionglai;
      edition.qionglaiOptions.forEach(function (option) { tableInfo[option.value] = options.qionglai[option.value]; });
    }
    var hall = typeof cc !== 'undefined' && cc.mm && cc.mm.hallserver;
    var last = hall && hall.mLastRoomParam;
    if (last && roomCode(last.roomId) === code) {
      last.baseBeans = options.baseBeans;
      last.baseBeansSource = options.baseBeansSource;
      last.playerNum = options.playerNum;
      last.playerNumSource = options.playerNumSource;
      if (options.qionglai) {
        last.qionglai = options.qionglai;
        edition.qionglaiOptions.forEach(function (option) { last[option.value] = options.qionglai[option.value]; });
      }
    }
    return code;
  }
  function roomOptionsResponseCommand(command) {
    return command === 2 || command === 4 || command === 6 || command === 48;
  }
  function roomOptionsTableResponse(command) {
    return command === 4 || command === 6 || command === 48;
  }
  function applyRoomOptionsResponse(message) {
    var extension = message && message.extension, command = message && message.code;
    if (!extension) return;
    if (!roomOptionsResponseCommand(command)) {
      if (extension.roomOptions !== undefined) throw new Error('Room options are not valid for this response');
      return;
    }
    var state = extension.roomState;
    if (extension.roomOptions !== undefined && !validRoomOptionsResponse(extension.roomOptions)) throw new Error('Invalid frozen room options');
    if (extension.roomOptions === undefined && !roomOptionsTableResponse(command)) return;
    if (extension.roomOptions === undefined && !wirePendingRoomOptions) return;
    if (!validRoomCursor(state) || !state.roomId) throw new Error('Room options require an active room state');
    if (command === 2) {
      var tableId = roomCode(message.body && message.body.tableId), loginOptions = validRoomOptionsResponse(extension.roomOptions);
      if (tableId === null || !loginOptions) throw new Error('Room options do not match login state');
      wirePendingRoomOptions = { roomId: state.roomId, tableId: tableId, options: loginOptions };
      return;
    }
    var tableInfo = message.body && message.body.tableInfo, tableId = roomCode(tableInfo && tableInfo.roomId);
    if (tableId === null) throw new Error('Room options require table information');
    var options = validRoomOptionsResponse(extension.roomOptions);
    if (!options && wirePendingRoomOptions && wirePendingRoomOptions.roomId === state.roomId && wirePendingRoomOptions.tableId === tableId) options = wirePendingRoomOptions.options;
    if (!options) return;
    if (wirePendingRoomOptions && wirePendingRoomOptions.roomId === state.roomId && wirePendingRoomOptions.tableId === tableId
      && !sameRoomOptions(wirePendingRoomOptions.options, options)) throw new Error('Frozen room options changed during reconnect');
    applyRoomOptionsToTableInfo(tableInfo, options);
    wirePendingRoomOptions = null;
  }
  function toast(text) { cc.mm.uimanager.showTextPrompt(String(text)); }
  function apiRequest(method, path, body, contentType) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, config.apiBase + path, true);
      xhr.setRequestHeader('Authorization', 'Bearer ' + (cc.mm && cc.mm.framemodel && cc.mm.framemodel.token || ''));
      if (body !== undefined) xhr.setRequestHeader('Content-Type', contentType || 'application/json');
      xhr.timeout = 30000;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(data && data.error || { code: 'NETWORK', message: xhr.status ? '请求失败，请稍后再试。' : '网络连接失败，请稍后再试。' });
      };
      xhr.send(body === undefined ? null : contentType ? body : JSON.stringify(body));
    });
  }

  // 资料设置（R6、R8）：面板只用原版 CommonEditUI 和 HallSetUI 里的素材拼，不另造样式。
  var profileKit = null, profileKitQueue = null;
  function withProfileKit(done) {
    if (profileKit) return done(profileKit);
    if (profileKitQueue) return profileKitQueue.push(done);
    profileKitQueue = [done];
    cc.resources.load(['prefab/CommonEditUI', 'prefab/HallSetUI'], cc.Prefab, function (error, prefabs) {
      var queue = profileKitQueue; profileKitQueue = null;
      if (error) return toast('界面加载失败，请稍后再试。');
      profileKit = { edit: cc.instantiate(prefabs[0]), set: cc.instantiate(prefabs[1]) };
      queue.forEach(function (callback) { callback(profileKit); });
    });
  }
  function kitNode(kit, root, path) {
    var node = cc.instantiate(cc.find(path, kit[root]));
    node.active = true;
    var button = node.getComponent(cc.Button); if (button) button.clickEvents = [];
    return node;
  }
  function kitLabel(parent, text, x, y, size, color, anchorX) {
    var node = new cc.Node('label'), label = node.addComponent(cc.Label);
    label.string = text; label.fontSize = size; label.lineHeight = size + 8;
    node.color = color; node.anchorX = anchorX === undefined ? 0.5 : anchorX; node.setPosition(x, y);
    parent.addChild(node);
    return label;
  }
  function kitButton(kit, parent, text, x, y, onClick) {
    var node = kitNode(kit, 'edit', 'root/getcode');
    node.getChildByName('label').getComponent(cc.Label).string = text;
    node.setPosition(x, y); parent.addChild(node);
    node.on('click', onClick);
    return node;
  }
  function loadAvatar(url, node, size) {
    if (!url) return;
    if (url.charAt(0) === '/' && url.charAt(1) !== '/') url = apiOrigin + url;
    if (!allowedRequest(url, false)) return;
    node._standaloneAvatarUrl = url;
    cc.assetManager.loadRemote(url, { ext: '.jpg' }, function (error, texture) {
      if (error || !cc.isValid(node) || node._standaloneAvatarUrl !== url) return;
      node.getComponent(cc.Sprite).spriteFrame = new cc.SpriteFrame(texture);
      node.setContentSize(size, size);
    });
  }
  function avatarView(parent, x, y, size) {
    var holder = new cc.Node('standaloneAvatar');
    holder.setContentSize(size, size); holder.setPosition(x, y); parent.addChild(holder);
    var mask = holder.addComponent(cc.Mask); mask.type = cc.Mask.Type.ELLIPSE; mask.segements = 64;
    var picture = new cc.Node('picture');
    picture.setContentSize(size, size); holder.addChild(picture);
    var sprite = picture.addComponent(cc.Sprite); sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM; sprite.trim = false;
    var ring = new cc.Node('ring');
    ring.setPosition(x, y); parent.addChild(ring);
    var pen = ring.addComponent(cc.Graphics);
    pen.lineWidth = 4; pen.strokeColor = cc.color(255, 255, 255); pen.circle(0, 0, size / 2 + 1); pen.stroke();
    return function (url) { loadAvatar(url, picture, size); };
  }
  var base64Values = (function () {
    var values = new Int16Array(128).fill(-1), table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (var index = 0; index < table.length; index++) values[table.charCodeAt(index)] = index;
    return values;
  }());
  function base64Bytes(text) {
    text = String(text || '');
    var bytes = new Uint8Array(Math.ceil(text.length * 3 / 4)), buffer = 0, bits = 0, length = 0;
    for (var index = 0; index < text.length; index++) {
      var code = text.charCodeAt(index), value = code < 128 ? base64Values[code] : -1;
      if (value < 0) continue;
      buffer = (buffer << 6 | value) & 0xffffff; bits += 6;
      if (bits >= 8) { bits -= 8; bytes[length++] = buffer >> bits & 255; }
    }
    return bytes.subarray(0, length);
  }
  function imageType(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return 'application/octet-stream';
  }
  // 网页版先在本机缩到 512 像素以内再传；服务端还会重新压缩到 256 并去掉拍摄信息（R9）。
  function shrinkImage(file, done) {
    var url = URL.createObjectURL(file), image = new Image();
    image.onload = function () {
      URL.revokeObjectURL(url);
      var scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) { if (blob) done(blob); else toast('读取照片失败，请换一张。'); }, 'image/jpeg', 0.9);
    };
    image.onerror = function () { URL.revokeObjectURL(url); toast('这张图片打不开，请换一张 JPG 或 PNG 照片。'); };
    image.src = url;
  }
  var imagePicked = null;
  window.StandaloneNative = window.StandaloneNative || {};
  window.StandaloneNative.onImage = function (base64, error) {
    var done = imagePicked; imagePicked = null;
    if (!done || error === 'cancelled') return;
    if (error) return toast(error === 'permission' ? '没有相机或相册权限，请到手机设置里打开。' : '读取照片失败，请换一张。');
    done(base64Bytes(base64));
  };
  function pickImage(source, done) {
    if (cc.sys.isNative) {
      imagePicked = done;
      try { jsb.reflection.callStaticMethod('net/doushisi/standalone/StandaloneMedia', 'pick', '(Ljava/lang/String;)V', source); }
      catch (_) { imagePicked = null; toast('当前版本还不能选照片，请更新 APP。'); }
      return;
    }
    var input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/*'; input.style.display = 'none';
    if (source === 'camera') input.setAttribute('capture', 'user');
    input.onchange = function () {
      var file = input.files && input.files[0];
      input.parentNode.removeChild(input);
      if (file) shrinkImage(file, done);
    };
    document.body.appendChild(input);
    input.click();
  }

  var DEFAULT_AVATAR = '/client/standalone/default-avatar.png';
  var profileView = null, profileToken = null, profileRetryAt = 0, profilePanel = null;
  function applyProfile(view) {
    profileView = view;
    var model = cc.mm.framemodel;
    model.picUrl = view.avatarUrl;
    if (!view.needs.nickname) model.nick = view.nickname;
    model.sex = view.sex === 2 ? 1 : 0;
    var hall = cc.mm.uimanager.getWindow('HallUI');
    if (hall && hall.views && typeof hall.loadUserInfo === 'function') hall.loadUserInfo();
    var person = cc.mm.uimanager.getWindow('HallPersonUI');
    if (person && person.views && cc.isValid(person.node)) {
      if (person.views['bg/namelabel']) person.views['bg/namelabel'].getComponent(cc.Label).string = model.nick;
      if (person.views['bg/res_dating_hall_head']) cc.mm.uitools.loadRemote(model.picUrl, person.views['bg/res_dating_hall_head']);
    }
  }
  function closeProfilePanel() {
    if (profilePanel && cc.isValid(profilePanel)) profilePanel.destroy();
    profilePanel = null;
  }
  function uploadAvatar(data, done) {
    apiRequest('POST', '/api/me/avatar', data, data.type || imageType(data)).then(function (view) { applyProfile(view); done(view); }, function (error) { done(null); toast(error.message); });
  }
  function openProfilePanel(mode) {
    var setup = mode === 'setup';
    if (profilePanel && cc.isValid(profilePanel)) {
      if (profilePanel._standaloneMode === 'setup' || !setup) return;
      closeProfilePanel();
    }
    withProfileKit(function (kit) {
      if (profilePanel && cc.isValid(profilePanel) || !cc.Canvas.instance) return;
      var view = profileView || { nickname: '', sex: 0, needs: { avatar: true, nickname: true, sex: true } }, busy = false;
      var panel = new cc.Node('StandaloneProfileUI');
      panel._standaloneMode = mode;
      // 原版窗口都挂在场景根上，面板也挂这里，压在窗口上、在文字提示（1000）下面。
      panel.setContentSize(cc.Canvas.instance.node.getContentSize());
      panel.setPosition(cc.Canvas.instance.node.position);
      cc.director.getScene().addChild(panel, 900);
      profilePanel = panel;
      panel.addChild(kitNode(kit, 'edit', 'sprite_splash'));
      var width = setup ? 860 : 620, height = setup ? 540 : 470;
      var box = new cc.Node('root');
      box.setContentSize(width, height); panel.addChild(box);
      var frame = box.addComponent(cc.Sprite);
      frame.sizeMode = cc.Sprite.SizeMode.CUSTOM; frame.type = cc.Sprite.Type.SLICED;
      frame.spriteFrame = cc.find('root', kit.edit).getComponent(cc.Sprite).spriteFrame;
      box.setContentSize(width, height);
      box.addComponent(cc.BlockInputEvents);
      var title = kitNode(kit, 'edit', 'root/title_label');
      title.getComponent(cc.Label).string = setup ? '完善资料' : '换头像';
      title.setPosition(0, height / 2 - 41); box.addChild(title);
      var avatarX = setup ? -240 : 0, showAvatar = avatarView(box, avatarX, setup ? 60 : 50, 170);
      showAvatar(view.avatarUrl || DEFAULT_AVATAR);
      function choose(source) {
        if (busy) return;
        pickImage(source, function (data) {
          busy = true;
          uploadAvatar(data, function (next) {
            busy = false;
            if (!next) return;
            showAvatar(next.avatarUrl);
            toast('头像已更新');
          });
        });
      }
      kitButton(kit, box, '拍照', avatarX - 82, -95, function () { choose('camera'); });
      kitButton(kit, box, '相册', avatarX + 82, -95, function () { choose('album'); });
      var confirm = kitNode(kit, 'edit', 'root/create_club_btns');
      confirm.setPosition(0, -height / 2 + (setup ? 58 : 62)); box.addChild(confirm);
      if (!setup) {
        var close = kitNode(kit, 'edit', 'root/common_close');
        close.setPosition(width / 2 - 54, height / 2 - 37); box.addChild(close);
        close.on('click', closeProfilePanel);
        confirm.on('click', closeProfilePanel);
        return;
      }
      var nameTitle = kitNode(kit, 'edit', 'root/promplabel');
      nameTitle.getComponent(cc.Label).string = '昵称'; nameTitle.anchorX = 0; nameTitle.setPosition(-40, 90); box.addChild(nameTitle);
      var nameBox = kitNode(kit, 'edit', 'root/editbox');
      nameBox.width = 320; nameBox.setPosition(210, 90); box.addChild(nameBox);
      var edit = nameBox.getComponent(cc.EditBox);
      edit.maxLength = 7; edit.placeholder = '2–7 个字，不能和别人重名';
      edit.string = view.needs.nickname ? '' : view.nickname;
      var sexTitle = kitNode(kit, 'edit', 'root/promplabel');
      sexTitle.getComponent(cc.Label).string = '性别'; sexTitle.anchorX = 0; sexTitle.setPosition(-40, 0); box.addChild(sexTitle);
      var sexes = kitNode(kit, 'set', 'root/toggleContainer');
      sexes.setPosition(150, 0); box.addChild(sexes);
      var container = sexes.getComponent(cc.ToggleContainer), toggles = [sexes.getChildByName('toggle1').getComponent(cc.Toggle), sexes.getChildByName('toggle2').getComponent(cc.Toggle)];
      container.allowSwitchOff = view.sex !== 1 && view.sex !== 2;
      toggles[0].isChecked = view.sex === 1; toggles[1].isChecked = view.sex === 2;
      toggles.forEach(function (toggle) { toggle.node.on('toggle', function () { container.allowSwitchOff = false; }); });
      kitLabel(box, '头像只能拍照或从相册选；性别决定快捷语音用男声还是女声', 0, -150, 22, cc.color(141, 151, 187));
      confirm.on('click', function () {
        if (busy) return;
        var current = profileView || view, nickname = edit.string.trim(), sex = toggles[0].isChecked ? 1 : toggles[1].isChecked ? 2 : 0;
        if (current.needs.avatar) return toast('请先拍照或从相册选一张头像。');
        if (!nickname) return toast('请填写昵称。');
        if (!sex) return toast('请选择性别。');
        busy = true;
        apiRequest('PUT', '/api/me/profile', { nickname: nickname, sex: sex }).then(function (next) {
          busy = false;
          applyProfile(next);
          if (!next.complete) return toast(next.needs.avatar ? '请先拍照或从相册选一张头像。' : '资料还没填完整。');
          closeProfilePanel();
          toast('资料已保存');
        }, function (error) { busy = false; toast(error.message); });
      });
    });
  }
  // 每次登录先查资料，没设好就弹出不能关的设置面板（R6 AC1、AC2）。
  function checkProfile() {
    var token = cc.mm && cc.mm.framemodel && cc.mm.framemodel.token;
    if (!token || token === profileToken || Date.now() < profileRetryAt) return;
    profileToken = token;
    apiRequest('GET', '/api/me/profile').then(function (view) {
      if (profileToken !== token) return;
      applyProfile(view);
      if (!view.complete) openProfilePanel('setup');
    }, function () { if (profileToken === token) { profileToken = null; profileRetryAt = Date.now() + 5000; } });
  }
  function changeNickname() {
    var at = profileView && profileView.nicknameChangeableAt && new Date(profileView.nicknameChangeableAt);
    if (at && at.getTime() > Date.now()) return toast('昵称 30 天内只能改一次，' + at.getFullYear() + '年' + (at.getMonth() + 1) + '月' + at.getDate() + '日以后可以再改。');
    // 原版窗口点确定就自己关掉；没保存成功就提示原因并重新打开。
    cc.mm.uimanager.showWindow(cc.mm.config.resources, 'CommonEditUI', {
      type: 'edit', title: '修改昵称', prompt: '新昵称', warn: '2–7 个字，30 天内只能改一次', maxLength: 7, standaloneNickname: true,
      editSucCall: function (text) {
        apiRequest('PUT', '/api/me/profile', { nickname: String(text || '').trim() }).then(function (next) {
          applyProfile(next);
          toast('昵称已修改');
        }, function (error) { toast(error.message); setTimeout(changeNickname, 300); });
      }
    });
  }
  // 原版改名窗口总带着验证码那一行，改昵称用不到，藏掉并把输入框挪到中间。
  function patchNicknameWindow(edit) {
    if (!edit.views || !edit.body || !edit.body.standaloneNickname || edit._standaloneNickname) return;
    edit._standaloneNickname = true;
    hide(edit.views, ['root/authlabel', 'root/authcode', 'root/getcode', 'root/label']);
    edit.views['root/promplabel'].setPosition(-190, 25);
    var box = edit.views['root/editbox'];
    box.width = 340; box.setPosition(70, 25);
    box.children.forEach(function (child) { var widget = child.getComponent(cc.Widget); if (widget) widget.updateAlignment(); });
  }
  // 原版大厅弹出其他窗口时会暂停自己的定时钩子，所以窗口补丁直接挂在原版控制器的 loadUI / reLoad 后面。
  function afterLoadUI(className, patch) {
    var Controller = cc.js.getClassByName(className);
    if (!Controller || Controller.prototype._standaloneLoadUI) return;
    Controller.prototype._standaloneLoadUI = true;
    ['loadUI', 'reLoad'].forEach(function (name) {
      var original = Controller.prototype[name];
      if (typeof original !== 'function') return;
      Controller.prototype[name] = function () {
        var result = original.apply(this, arguments);
        patch(this);
        return result;
      };
    });
  }
  // 个人信息页：周卡和实名认证两行换成「换头像」「改昵称」（R8）。
  function patchPersonWindow(person) {
    if (!person.views || !person.views.bg || person._standaloneProfileEntries) return;
    person._standaloneProfileEntries = true;
    hide(person.views, ['bg/doushisi-gerenzhongxin-pic-zhouka', 'bg/timelabel', 'bg/tubiao', 'bg/btn_shouquan', 'bg/yirenzheng']);
    withProfileKit(function (kit) {
      if (!cc.isValid(person.node)) return;
      kitButton(kit, person.views.bg, '换头像', -407, -139, function () { openProfilePanel('avatar'); });
      kitButton(kit, person.views.bg, '改昵称', -407, -232, changeNickname);
    });
  }

  var disabledWindows = new Set(['HallShopUI', 'HallIAPUI', 'CommonSelectPayUI', 'HallWeekCardUI', 'HallMonthUI', 'HallActivityUI', 'DoubleHolidayUI', 'HallTipUI', 'H5DownloadUI', 'BigUpdateUI', 'ForceUpdateUI', 'EventRecallResultUI', 'EventRecallUI', 'HallLiQuanUI', 'HallMatchUI', 'FirstPayUI', 'JoinFriendFail', 'SupplementUI', 'HallFriendUI', 'RecallFriend', 'HallAuthentication']);
  window.Standalone = {
    supportsArea: function (id) {
      var area = areaNumber(id);
      return area !== null && !!retainedAreaTypes[area] && !!clientReadyAreaTypes[area];
    },
    qionglaiRuleSummary: function (rules) {
      if (!rules || Number(rules.areaType) !== 8) return '';
      var values = rules.qionglai || rules;
      return edition.qionglaiOptions.filter(function (option) { return values[option.value] === 1; })
        .map(function (option) { return option.name + '、'; }).join('');
    },
    restoreReplayRoomOptions: function (value, tableInfo) {
      var options = validRoomOptionsResponse(value);
      if (!options) throw new Error('Invalid replay room options');
      applyRoomOptionsToTableInfo(tableInfo, options);
    },
    config: config,
    hasLiveRoom: function () { return !!(wireCursor && wireCursor.roomId); },
    roomCursor: function () {
      if (!validRoomCursor(wireCursor) || !wireCursor.roomId) return null;
      return { roomId: wireCursor.roomId, roundId: wireCursor.roundId, stateVersion: wireCursor.stateVersion };
    },
    appendWireRequest: function (body, command) {
      var extension = { version: 2, decimalFields: [], capabilities: ['decision-window-v1', edition.qionglaiVersion] };
      if (command === 3 && wireCreateRoom) {
        var createRoom = validateCreateRoomMetadata(wireCreateRoom);
        wireCreateRoom = null;
        if (!createRoom) throw new Error('Invalid room creation metadata');
        extension.createRoom = createRoom;
      }
      if (isProtectedRequest(command)) {
        if (wireRecovering || !validRoomCursor(wireCursor) || !wireCursor.roomId || isGameRequest(command) && !wireCursor.roundId) throw new Error('Room state must be restored before this operation');
        var key = command + '|' + JSON.stringify(wireCursor) + '|' + (wireDecisionId || '') + '|' + Array.prototype.join.call(body, ',');
        if (wirePending && wirePending.key !== key) throw new Error('Previous operation is awaiting confirmation');
        var previous = wirePending || isGameRequest(command) && wireLastAction && wireLastAction.key === key && wireLastAction;
        extension.request = previous ? previous.request : { commandId: 'client-' + wireNonce + '-' + (++wireSequence), roomId: wireCursor.roomId };
        if (isGameRequest(command)) {
          extension.request.expectedRoundId = wireCursor.roundId;
          extension.request.expectedStateVersion = wireCursor.stateVersion;
          if (wireDecisionId) extension.request.decisionId = wireDecisionId;
        }
        wirePending = { key: key, command: command, request: extension.request, sentAt: Date.now() };
        if (isGameRequest(command)) wireLastAction = wirePending;
      }
      var appended = protobuf.Writer.create().uint32((60000 << 3) | 2).string(JSON.stringify(extension)).finish();
      var combined = new Uint8Array(body.length + appended.length);
      combined.set(body); combined.set(appended, body.length);
      return combined;
    },
    resetWireSession: function () {
      wireCursor = null; wirePending = null; wireLastAction = null; wireRecovering = false; wireCreateRoom = null; wirePendingRoomOptions = null;
      wireDecisionId = null;
    },
    receiveWireMessage: function (extension) {
      // Acknowledgements can arrive before animation delivery, but never advance its cursor.
      if (extension && extension.ack && wirePending && extension.ack.commandId === wirePending.request.commandId) wirePending = null;
    },
    distributeWireMessage: function (message) {
      var extension = message.extension, command = message.code;
      if (message.replayGeneration !== undefined) return !!window.StandaloneReplay && StandaloneReplay.isCurrent(message.replayGeneration);
      if (extension && extension.error) { this.protocolError(extension.error, command); return false; }
      if (command === 306 && extension && extension.replay) {
        if (!window.StandaloneReplay) throw new Error('Replay module is unavailable');
        void StandaloneReplay.load(extension.replay);
        return false;
      }
      var state = extension && extension.roomState;
      if (window.StandaloneReplay && StandaloneReplay.active() && (state && state.roomId || command === 2 && message.body.tableId)) {
        cc.mm.gameserver.clear();
        cc.mm.uimanager.closewindow('CommonRePlay');
      }
      if (state && state.roomId === null) { this.resetWireSession(); return true; }
      // Only rendered game state may advance a live decision, not heartbeat/presence/ack traffic.
      var isProjection = [11, 20, 25, 26, 27, 28, 48].indexOf(command) >= 0;
      if (state && (isProjection || !wireCursor || wireCursor.roundId === null && state.roundId === null)) {
        if (!validRoomCursor(state)) throw new Error('Invalid room state extension');
        if (wireCursor && state.roomId === wireCursor.roomId && state.roundId === wireCursor.roundId
          && state.stateVersion !== null && wireCursor.stateVersion !== null && state.stateVersion < wireCursor.stateVersion) return false;
        if (!wireCursor || JSON.stringify(state) !== JSON.stringify(wireCursor)) wireLastAction = null;
        wireCursor = { roomId: state.roomId, roundId: state.roundId, stateVersion: state.stateVersion };
        if (isProjection) wireDecisionId = extension.decisionId || null;
      }
      applyRoomOptionsResponse(message);
      if (command === 48) { wireRecovering = false; wirePending = null; wireLastAction = null; }
      return true;
    },
    recoverWireRoom: function () {
      if (wireRecovering) return;
      var server = cc.mm.server, game = cc.mm.gameserver, room = game.room_data;
      wireRecovering = true; wireCursor = null; wirePending = null; wireLastAction = null;
      wireDecisionId = null;
      server._msgActList.length = 0; server._colTime = 0; server._lastStageTime = 0;
      cc.mm.notification.emit(cc.mm.frametype.MSG_CLEAR_OPERATOR);
      if (room && room.roomId && server._ws.isConnent()) {
        server.send({ hwRequestEnterTableFinish: { roomId: room.roomId, lat: game.getLatitude(), lon: game.getLongitude() } }, 47, cc.mm.framemodel.uid);
      } else {
        server.selfClose = false;
        server.closeServer();
      }
    },
    wireSendFailure: function (command) {
      if (!isProtectedRequest(command)) return false;
      this.recoverWireRoom();
      return true;
    },
    wireHeartbeat: function () {
      if (wirePending && Date.now() - wirePending.sentAt > 10000) this.recoverWireRoom();
    },
    allowedRequest: allowedRequest,
    amount: function (value) { return amount(value).toFixed(); },
    addAmount: function (left, right) { var a = amount(left).toFixed(), b = amount(right).toFixed(), Exact = Money.clone({ precision: Math.max(a.length, b.length) + 16 }); return new Exact(a).plus(b).toFixed(); },
    subtractAmount: function (left, right) { var a = amount(left).toFixed(), b = amount(right).toFixed(), Exact = Money.clone({ precision: Math.max(a.length, b.length) + 16 }); return new Exact(a).minus(b).toFixed(); },
    divideAmount: function (left, right) { return amount(amount(left).div(amount(right))).toFixed(); },
    compareAmount: function (left, right) { return amount(left).comparedTo(amount(right)); },
    signedAmount: function (value) { var parsed = amount(value); return (parsed.gt(0) ? '+' : '') + parsed.toFixed(); },
    scoreLabel: function (node, value, signed) {
      var label = node.getComponent(cc.Label);
      if (!label) return;
      if (!node._standaloneScoreBounds) {
        var width = node.width, parent = node.parent;
        if (parent && parent.width > 0) {
          var left = node.x + parent.width * parent.anchorX, right = parent.width * (1 - parent.anchorX) - node.x;
          var available = Math.min(node.anchorX ? left / node.anchorX : Infinity, node.anchorX < 1 ? right / (1 - node.anchorX) : Infinity);
          if (available > 8 && isFinite(available)) width = available - 8;
        }
        // The hall balance background includes an icon on each side of its text area.
        if (parent && parent.name === 'hallcoin') width = Math.min(width, 94);
        node._standaloneScoreBounds = { width: width, height: node.height };
      }
      label.string = signed ? this.signedAmount(value) : this.amount(value);
      var bounds = node._standaloneScoreBounds;
      if (bounds.width > 0 && bounds.height > 0) {
        label.overflow = cc.Label.Overflow.SHRINK;
        label.enableWrapText = false;
        node.setContentSize(bounds.width, bounds.height);
      }
    },
    beanAmountLabel: function (node, value, signed) {
      this.scoreLabel(node, value, signed);
      var label = node && node.getComponent && node.getComponent(cc.Label);
      if (label) label.string += '豆';
    },
    createRoomOptions: function (controller) {
      return prepareCreateRoom(controller);
    },
    createRoom: function (controller, rules, areaType) {
      if (!validateCreateRoom(controller)) return false;
      var prepared = prepareCreateRoomOptions(rules, areaType);
      if (!prepared.ok) {
        promptRoom(roomOptionPrompt(prepared.reason));
        return false;
      }
      wireCreateRoom = prepared.metadata;
      try { return cc.mm.hallserver.requestCreateRoom(rules, areaType) !== false; }
      catch (error) { wireCreateRoom = null; throw error; }
    },
    applyWireExtension: function (body, decoded, response) {
      var reader = protobuf.Reader.create(body), extension;
      while (reader.pos < reader.len) {
        var tag = reader.uint32();
        if ((tag >>> 3) !== 60000) { reader.skipType(tag & 7); continue; }
        if ((tag & 7) !== 2 || extension) throw new Error('Invalid extension');
        var text = reader.string();
        if (text.length > 65536) throw new Error('Extension too large');
        extension = JSON.parse(text);
        if (!extension || typeof extension !== 'object' || Array.isArray(extension) || extension.version !== 2 || !Array.isArray(extension.decimalFields)) throw new Error('Unsupported protocol extension');
        if (response === true) {
          var responseFields = ['version', 'decimalFields', 'roomOptions', 'roomState', 'ack', 'replay', 'error', 'decisionId'];
          if (Object.keys(extension).some(function (key) { return responseFields.indexOf(key) < 0; })) throw new Error('Request-only protocol extension received as response');
          if (extension.roomOptions !== undefined && !validRoomOptionsResponse(extension.roomOptions)) throw new Error('Invalid frozen room options');
          if (extension.decisionId !== undefined && extension.decisionId !== null && (typeof extension.decisionId !== 'string' || !/^[\w:-]{1,100}$/.test(extension.decisionId))) throw new Error('Invalid response window');
        } else {
          if (extension.roomOptions !== undefined) throw new Error('Room options are response-only');
          if (extension.createRoom !== undefined && !validateCreateRoomMetadata(extension.createRoom)) throw new Error('Invalid room creation metadata');
        }
        if (extension.roomState && !validRoomCursor(extension.roomState)) throw new Error('Invalid room state extension');
        if (extension.ack && (typeof extension.ack.commandId !== 'string' || !/^[\w-]{8,100}$/.test(extension.ack.commandId))) throw new Error('Invalid command acknowledgement');
        extension.decimalFields.forEach(function (field) {
          if (!Array.isArray(field.path) || !field.path.length || field.path.length > 12 || typeof field.value !== 'string' || !/^-?\d+(\.\d+)?$/.test(field.value)) throw new Error('Invalid decimal field');
          var parent = decoded;
          field.path.forEach(function (key, index) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype' || typeof key !== 'string' && typeof key !== 'number') throw new Error('Invalid extension path');
            if (!parent || !Object.prototype.hasOwnProperty.call(parent, key)) throw new Error('Missing extension target');
            if (index === field.path.length - 1) parent[key] = field.value;
            else parent = parent[key];
          });
        });
      }
      return extension;
    },
    protocolError: function (error, command) {
      cc.mm.uimanager.showTextPrompt(String(error.message || '请求失败'));
      if (error.code === 'PROFILE_REQUIRED') profileToken = null;
      if ([24, 54, 122, 126].indexOf(command) >= 0) this.recoverWireRoom();
      if (command === 48 && wireRecovering) {
        wireRecovering = false;
        cc.mm.server.selfClose = false;
        cc.mm.server.closeServer();
      }
      if (command === cc.mm.msgEvent.HWResponseGameLogin || command === cc.mm.msgEvent.HWResponseRegister) {
        cc.mm.server.selfClose = true;
        cc.mm.server.closeServer();
        cc.mm.server.setReg(false);
        if (error.code === 'UNAUTHORIZED') cc.sys.localStorage.removeItem('GAME_TOKEN');
      }
    },
    isolateStorage: function () {
      var storage = window.localStorage;
      var prefix = config.storageNamespace;
      cc.sys.localStorage = {
        getItem: function (key) { return storage.getItem(prefix + key); },
        setItem: function (key, value) { storage.setItem(prefix + key, value); },
        removeItem: function (key) { storage.removeItem(prefix + key); },
        clear: function () { Object.keys(storage).filter(function (key) { return key.indexOf(prefix) === 0; }).forEach(function (key) { storage.removeItem(key); }); }
      };
      cc.sys.localStorage.removeItem('PASSWORD_ID');
      cc.sys.openURL = function () { return false; };
    },
    installApp: function (app) {
      Object.keys(app.gameconfig).forEach(function (key) {
        if (!retainedAreaTypes[key]) delete app.gameconfig[key];
      });
      var qionglai = app.gameconfig[8] && app.gameconfig[8][0];
      if (qionglai) {
        var options = qionglai.rule.config_playmethod.config;
        edition.qionglaiOptions.forEach(function (option) {
          if (!options.some(function (existing) { return existing.value === option.value; })) options.push(JSON.parse(JSON.stringify(option)));
        });
      }
      app.config.http_server = config.apiBase + '/';
      app.config.ws_server = config.wsUrl;
      app.gamefunc.numformat = window.Standalone.amount;
      app.gameserver.openTip = true;
      var clearGame = app.gameserver.clear;
      app.gameserver.clear = function () {
        if (window.StandaloneReplay) StandaloneReplay.clear();
        return clearGame.apply(this, arguments);
      };
      app.gameserver.getVersionCode = function () { return 100; };
      app.gameserver.requestLocation = function () {
        if (cc.sys.isNative) return jsb.reflection.callStaticMethod('org/cocos2dx/javascript/AppActivity', 'requestLocation', '()V');
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(function (position) {
          app.gameserver.locationLat = position.coords.latitude;
          app.gameserver.locationIng = position.coords.longitude;
        }, function () {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      };
      app.gameserver.playad = function (callback) { if (callback) callback(false); };
      app.hallserver.requestEmail = function () {};
      hookCreateRoomRequest(app);
      afterLoadUI('HallPersonUIController', patchPersonWindow);
      afterLoadUI('CommonEditUIController', patchNicknameWindow);
      var loadRemote = app.uitools.loadRemote;
      app.uitools.loadRemote = function (url, target) {
        if (url && url.charAt(0) === '/' && url.charAt(1) !== '/') url = apiOrigin + url;
        if (!url || !allowedRequest(url, false)) return;
        return loadRemote.call(this, url, target);
      };
      var assetLoadRemote = cc.assetManager.loadRemote;
      cc.assetManager.loadRemote = function (url) {
        requireRequest(url, false);
        return assetLoadRemote.apply(this, arguments);
      };
      if (cc.WebView) {
        var webUrl = Object.getOwnPropertyDescriptor(cc.WebView.prototype, 'url');
        if (webUrl && webUrl.set && webUrl.configurable) Object.defineProperty(cc.WebView.prototype, 'url', {
          configurable: true,
          enumerable: webUrl.enumerable,
          get: webUrl.get,
          set: function (url) { return webUrl.set.call(this, !url || url === 'about:blank' || allowedRequest(url, false) ? url : 'about:blank'); }
        });
      }
      var showWindow = app.uimanager.showWindow;
      app.uimanager.showWindow = function (bundle, name) {
        if (bundle === 'mj' || bundle === 'bzp' || disabledWindows.has(name) || /^Club|^Event|^HallMonth|^HallWeek|^HallShop/.test(name)) {
          // Some original click handlers switch the hall background before
          // opening a retired window. Restore it here as a safe backstop.
          var hall = app.uimanager.getWindow && app.uimanager.getWindow('HallUI');
          if (hall && typeof hall.showView === 'function') hall.showView();
          return;
        }
        return showWindow.apply(this, arguments);
      };
      var loadBundle = app.assets.loadBundle;
      if (loadBundle) app.assets.loadBundle = function (bundle) {
        if (bundle === 'mj' || bundle === 'bzp') throw new Error('Game mode removed');
        return loadBundle.apply(this, arguments);
      };
    },
    login: function (controller) {
      closeProfilePanel(); profileToken = null; profileView = null;
      hide(controller.views, ['wxlogin', 'userreg', 'accountLogin/closeLayoutBtn']);
      ['accountLogin/accountid/editbox', 'accountReg/accountid/editbox'].forEach(function (key) { controller.views[key].getComponent(cc.EditBox).maxLength = 32; });
      ['accountLogin/passworld/editbox', 'accountReg/passworld1/editbox', 'accountReg/passworld2/editbox'].forEach(function (key) { var edit = controller.views[key].getComponent(cc.EditBox); edit.maxLength = 128; edit.inputFlag = cc.EditBox.InputFlag.PASSWORD; });
      controller.views.accountLogin.active = true;
      controller.views.accountReg.active = false;
      var account = cc.sys.localStorage.getItem('ACCOUNT_ID');
      if (account) controller.views['accountLogin/accountid/editbox'].getComponent(cc.EditBox).string = account;
    },
    table: function (controller) {
      hide(controller.views, ['qifu-button', 'qifu-dikuang', 'buchongdou', 'invateBtn']);
      useBeansAtTable(controller);
      if (!controller._standaloneCurrencyNormalized) { normalizeCurrencyLabels(controller.node); controller._standaloneCurrencyNormalized = true; }
      if (window.StandaloneReplay && StandaloneReplay.active()) hide(controller.views, ['readyBtn', 'tg_bg', 'ntfOperate', 'sureTip', 'select', 'gy_btn_chat', 'menunode/gy_btn_tuoguan']);
    },
    friends: function (controller) {
      hide(controller.views, ['baoshan-pic-chendi/baoshan-button-yaoqing', 'baoshan-pic-chendi/baoshan-button-zhaohui']);
      controller.schedule(function () { cc.mm.hallserver.requestAllFriend(); }, 10);
    },
    renderFriends: function (controller, data) {
      if (data.gradeInfo && data.gradeInfo.length) return;
      var friends = data.friendAll || [], content = controller.views.scrollview.getComponent(cc.ScrollView).content;
      var previous = controller._standaloneFriendRows || {}, next = {};
      controller.views['baoshan-pic-chendi/baoshan-pic-tishi'].active = friends.length === 0;
      friends.forEach(function (friend, index) {
        var row = previous[friend.uid];
        if (!row || !cc.isValid(row)) {
          row = cc.instantiate(controller.views.item);
          content.addChild(row);
          row.active = true;
          ['kexuan', 'bukexuan', 'head_201'].forEach(function (name) { var node = row.getChildByName(name); if (node) node.active = false; });
        }
        next[friend.uid] = row;
        row.setSiblingIndex(index);
        row.getChildByName('idx').getComponent(cc.Label).string = friend.recordId;
        row.getChildByName('laiyuan').getComponent(cc.Label).string = friend.source;
        var state = row.getChildByName('state');
        state.getComponent(cc.Label).string = friend.online;
        state.color = friend.online === '在线' ? controller.views.item.getChildByName('state').color : cc.color(175, 194, 214);
        var head = row.getChildByName('hallHeadBtn'), nick = friend.nick || '';
        head.getChildByName('namelabel').getComponent(cc.Label).string = nick.length > 4 ? nick.substring(0, 4) + '..' : nick;
        if (row._standaloneHeadType !== friend.headType) {
          row._standaloneHeadType = friend.headType;
          cc.mm.uitools.changeHead(head.getChildByName('headcase'), friend.headType);
        }
        if (row._standalonePicUrl !== friend.picUrl) {
          row._standalonePicUrl = friend.picUrl;
          cc.mm.uitools.loadRemote(friend.picUrl, head.getChildByName('hallHead'));
        }
      });
      Object.keys(previous).forEach(function (uid) { if (!next[uid] && cc.isValid(previous[uid])) { previous[uid].removeFromParent(); previous[uid].destroy(); } });
      controller._standaloneFriendRows = next;
    },
    hall: function (controller) {
      checkProfile();
      if (!profileKit && !profileKitQueue) withProfileKit(function () {});
      var nickname = controller.views['hallHeadBtn/namelabel'];
      if (nickname && !nickname._standaloneNameBounds) {
        nickname._standaloneNameBounds = true;
        var nameLabel = nickname.getComponent(cc.Label);
        nameLabel.overflow = cc.Label.Overflow.SHRINK;
        nameLabel.enableWrapText = false;
        nickname.setContentSize(190, nickname.height);
      }
      hide(controller.views, ['hall_dengluyouli', 'hallads', 'hallDownBtns/hallActivityBtn', 'hallDownBtns/btns/hallshopbtn', 'hallDownBtns/btns/hallLiQuanpbtn', 'leftBtns/appDown', 'leftBtns/iapBtn', 'leftBtns/monthBtn', 'leftBtns/weekBtn', 'leftBtns/doubleholiday', 'leftBtns/dou-hall-pic-huodong-di', 'menunode/hall_btn_share', 'menunode/hall_btn_service', 'games/game_other/xuezhanmj', 'games/game_other/paodekuai', 'games/game_other/xuezhan', 'games/game_2/paodekuai', 'games/game_2/gouyu1', 'games/game_2/gouyu2']);
      Object.keys(controller.views).forEach(function (name) {
        if (/^games\/game_type_\d+\/dou14$/.test(name)) controller.views[name].active = false;
        var match = /^games\/game_type_(\d+)$/.exec(name);
        if (match && !retainedAreaTypes[match[1]]) controller.views[name].active = false;
      });
      hide(controller.views, ['games/game_2', 'games/game_other']);
      hide(controller.views, ['hallDownBtns/btns/hall_mail_btn', 'common_marquee']);
      var gameGroups = Object.keys(controller.views).filter(function (name) { return /^games\/game_type_\d+$/.test(name); });
      if (controller.views.games && controller.views.games.active && !gameGroups.some(function (name) { return controller.views[name].active; })) {
        var preferred = cc.mm.framemodel.xianName === '邛崃' ? 8 : 4;
        controller.views['games/game_type_' + preferred].active = true;
      }
      var create = cc.mm.uimanager.getWindow('CreateRoomUI');
      if (create) {
        hide(create.views, ['hall_room_center/left/createroom/dou-hall-pic-mianfei', 'hall_room_center/left/createroom/ad']);
        hookCreateRoomRequest(cc.mm);
        prepareCreateRoom(create);
      }
      var coin = controller.views.hallcoin;
      if (coin) {
        var button = coin.getComponent(cc.Button); if (button) { button.interactable = false; button.enabled = false; }
        var originalLabel = controller.views['hallcoin/label'];
        if (originalLabel) originalLabel.active = false;
        if (!coin._standaloneNoTopup) {
          var sprite = coin.getComponent(cc.Sprite), frame = sprite && sprite.spriteFrame;
          if (frame && frame.getOriginalSize().width === 199 && frame.getOriginalSize().height === 48 && !frame.isRotated()) {
            // The removed top-up button is baked into the last 43 pixels of the original bitmap.
            var rect = frame.getRect().clone(); rect.width = 156;
            var balanceBackground = new cc.Node('standaloneBalanceBackground');
            balanceBackground.setAnchorPoint(0, 0.5);
            balanceBackground.setPosition(-coin.width * coin.anchorX, coin.height * (0.5 - coin.anchorY));
            balanceBackground.addComponent(cc.Sprite).spriteFrame = new cc.SpriteFrame(frame.getTexture(), rect, false, cc.v2(0, 0), cc.size(156, 48));
            coin.addChild(balanceBackground); balanceBackground.setSiblingIndex(0);
            sprite.enabled = false;
            coin._standaloneBalanceWidth = 156;
            coin._standaloneNoTopup = true;
          }
        }
        var beanBalance = addBeanBalance(coin);
        beanBalance.value.string = this.amount(cc.mm && cc.mm.framemodel ? cc.mm.framemodel.goldNum : '0');
      }
      if (!controller._standaloneCurrencyNormalized) { normalizeCurrencyLabels(controller.node); controller._standaloneCurrencyNormalized = true; }
    }
  };
}());
