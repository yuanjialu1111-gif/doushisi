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
  // 大厅和开房只露新津斗十四（DEC-20261031-单玩法去地区）；老房间、战绩、回放仍按上面全部玩法处理。
  // 旧安装包自带的配置没有 visibleGameIds，按新津算。
  var visibleAreaTypes = {};
  (edition.visibleGameIds || [4]).forEach(function (id) { visibleAreaTypes[id] = true; });
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
    if (rules.publicLobby) metadata.visibility = 'public';
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
    for (var index = 0; index < keys.length; index++) if (['baseBeans', 'playerNum', 'qionglai', 'visibility'].indexOf(keys[index]) < 0) return null;
    if (own(metadata, 'qionglai')) { if (!validQionglai(metadata.qionglai)) return null; result.qionglai = metadata.qionglai; }
    if (own(metadata, 'baseBeans')) { var base = positiveBaseBeans(metadata.baseBeans); if (base === null) return null; result.baseBeans = base; }
    if (own(metadata, 'playerNum')) { var players = playerNumber(metadata.playerNum); if (players === null) return null; result.playerNum = players; }
    if (own(metadata, 'visibility')) { if (metadata.visibility !== 'public') return null; result.visibility = 'public'; }
    return Object.keys(result).length ? result : null;
  }
  function validQionglai(value) {
    return value && value.version === edition.qionglaiVersion && Object.keys(value).length === 4 &&
      edition.qionglaiOptions.every(function (option) { return value[option.value] === 0 || value[option.value] === 1; });
  }
  function roomOptionPrompt(reason) {
    return reason === 'removed' ? '这个玩法已经下线，现在只有四川斗十四。' :
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
  // 新 APK 才有自带的选图、定位类（nativeApi >= 1）；旧 APK 里直接调会报错。
  function hasNativeApi() { return cc.sys.isNative && !!config && config.nativeApi >= 1; }
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
      if (!hasNativeApi()) return toast('当前版本还不能选照片，请更新 APP。');
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
  // 开房第三轮下线（CreateRoomUI 不再打开）；玩法规则里的「开启GPS定位」照旧去掉（R11）。
  function withoutLocationOption(rule) {
    var result = {};
    Object.keys(rule || {}).forEach(function (key) { if (key !== 'config_location') result[key] = rule[key]; });
    return result;
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
    if (!person.views || !person.views.bg) return;
    // 原版窗口 1100 宽、关闭键再往外 30：4:3 屏放不下会裁掉关闭键，窄屏时整体缩到放得下。
    var room = cc.Canvas.instance ? cc.Canvas.instance.node.width : 1334;
    person.views.bg.scale = Math.min(1, (room - 24) / 1112);
    refreshPersonStats(person);
    if (person._standaloneProfileEntries) return;
    person._standaloneProfileEntries = true;
    hide(person.views, ['bg/doushisi-gerenzhongxin-pic-zhouka', 'bg/timelabel', 'bg/tubiao', 'bg/btn_shouquan', 'bg/yirenzheng',
      'bg/doushisi-geren-icon-dashi', 'bg/doushisi-gerenzhongxin-pic-touxiangkuang', 'bg/scrollview',
      'bg/doushisi-gerenzhongxin-pic-xunzhang-di', 'bg/buttom']);
    // 空圆圈（原勋章位）、勋章空条和右上三行小字去掉，换成三张大战绩卡铺满上半块（11-01 样式稿第二版 A）。
    person._standaloneStats = statTiles(person.views.bg, 143, 95, 762, 310, 24, 66, 26);
    withProfileKit(function (kit) {
      if (!cc.isValid(person.node)) return;
      kitButton(kit, person.views.bg, '换头像', -407, -139, function () { openProfilePanel('avatar'); });
      kitButton(kit, person.views.bg, '改昵称', -407, -232, changeNickname);
    });
  }

  // 第二轮 S6 的真实战绩：对局数、胜场、胜率；勋章第三轮整块去掉。
  function refreshPersonStats(person) {
    if (person._standaloneStatsBusy) return;
    person._standaloneStatsBusy = true;
    apiRequest('GET', '/api/me/profile-stats').then(function (view) {
      person._standaloneStatsBusy = false;
      if (!cc.isValid(person.node) || !person.views) return;
      var model = cc.mm.framemodel;
      model.gameNum = view.rounds; model.winNum = view.wins; model.winRate = view.winRate;
      fillStatTiles(person._standaloneStats, view);
    }, function () { person._standaloneStatsBusy = false; });
  }
  // 三张战绩卡（对局数 / 总胜局 / 胜率）：白底圆角、顶上一道色条、大数字。个人中心和牌桌上点头像的信息窗共用。
  var STAT_TILES = [['rounds', '对局数', '#4a7be0'], ['wins', '总胜局', '#e0564a'], ['winRate', '胜率', '#e09a1a']];
  function statTiles(parent, x, y, width, height, gap, numberSize, labelSize) {
    var box = new cc.Node('standaloneStatTiles'); box.setPosition(x, y); parent.addChild(box);
    var tile = (width - gap * 2) / 3, radius = Math.round(height * 0.07), labels = {};
    STAT_TILES.forEach(function (entry, index) {
      var left = -width / 2 + index * (tile + gap), pen = lobbyPen(box, 'tile' + index);
      fillRound(pen, left, -height / 2 - 4, tile, height, radius, cc.color(40, 80, 150, 30));
      // 整块先涂色条的颜色，再盖白底（白底顶边方角），顶上露出 8 像素一道色条，外圆角不破。
      fillRound(pen, left, -height / 2, tile, height, radius, rgb(entry[2]));
      fillRound(pen, left, -height / 2, tile, height - 8, radius, rgb('#ffffff'));
      pen.rect(left, -height / 2 + radius, tile, height - 8 - radius); pen.fill();
      var center = left + tile / 2;
      labels[entry[0]] = lobbyLabel(box, '-', center, height * 0.1, numberSize, rgb(entry[2]), 0.5, true);
      lobbyLabel(box, entry[1], center, -height * 0.22, labelSize, rgb('#5a6b8c'), 0.5, false);
    });
    return labels;
  }
  function fillStatTiles(labels, view) {
    if (!labels) return;
    STAT_TILES.forEach(function (entry) { if (cc.isValid(labels[entry[0]])) labels[entry[0]].string = String(view[entry[0]]); });
  }

  // 位置只用来给大厅「附近」排档位（R10）：放在请求体里发，服务端只存在内存里；拿不到就不发，大厅照常用。
  var locationSentAt = 0, locationAsking = false, locationTimer = null;
  function readPosition(done) {
    var game = cc.mm.gameserver;
    if (cc.sys.isNative) {
      try { game.requestLocation(); } catch (_) { return done(); }
      return setTimeout(function () {
        var lat = Number(game.getLatitude()), lon = Number(game.getLongitude());
        if (isFinite(lat) && isFinite(lon) && (lat || lon)) done(lat, lon); else done();
      }, 3000);
    }
    if (!navigator.geolocation) return done();
    navigator.geolocation.getCurrentPosition(function (position) {
      game.locationLat = position.coords.latitude;
      game.locationIng = position.coords.longitude;
      done(position.coords.latitude, position.coords.longitude);
    }, function () { done(); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }
  function reportLocation() {
    if (locationAsking || Date.now() - locationSentAt < 120000 || !(cc.mm && cc.mm.framemodel && cc.mm.framemodel.token)) return;
    locationAsking = true; locationSentAt = Date.now();
    readPosition(function (lat, lon) {
      locationAsking = false;
      if (lat !== undefined) apiRequest('POST', '/api/me/location', { lat: lat, lon: lon }).catch(function () {});
    });
  }
  function startLocationReports() {
    reportLocation();
    if (!locationTimer) locationTimer = setInterval(reportLocation, 120000);
  }

  // 大厅（R1、R2、R4、R5；第二轮 S2 换成 A2 样式）：「好友约局」打开原版娱乐场窗口，中间换成公开桌。
  // 界面只露一个玩法时收起左边玩法列表、桌卡铺满整屏；多于一种时左边列表仍当筛选。
  var LOBBY_ALL = '全部玩法';
  // 尺寸照样式稿第二版 docs/plan/斗十四-大厅样式-v2.html：稿子按 16:9 画，1cqw = 1334 / 100 = 13.34。
  // 桌卡区上沿离顶 7.6cqw、离底 8cqw 放两排，列距、行距 1.5cqw；头像、空位圆座都是 3.5cqw。
  var LOBBY_TOP = 375 - 101, LOBBY_AREA = 542, LOBBY_GAP_X = 20, LOBBY_GAP_Y = 20, LOBBY_SEAT = 46, LOBBY_EMPTY = 46, LOBBY_BAR_Y = 322;
  function lobbyLabel(parent, text, x, y, size, color, anchorX, bold) {
    var label = kitLabel(parent, text, x, y, size, color, anchorX);
    label.enableBold = !!bold;
    return label;
  }
  // 稿子里白字带的深蓝投影（text-shadow 0 0.15cqw）。
  function lobbyShadow(label) {
    if (!cc.LabelShadow) return label;
    var shadow = label.node.addComponent(cc.LabelShadow);
    shadow.color = cc.color(20, 35, 70, 140); shadow.offset = cc.v2(0, -2); shadow.blur = 2;
    return label;
  }
  function rgb(hex, alpha) {
    var value = parseInt(hex.slice(1), 16);
    return cc.color(value >> 16, value >> 8 & 255, value & 255, alpha === undefined ? 255 : Math.round(alpha * 255));
  }
  function lobbyPen(parent, name, x, y) {
    var node = new cc.Node(name);
    node.setPosition(x || 0, y || 0); parent.addChild(node);
    return node.addComponent(cc.Graphics);
  }
  function fillRound(pen, x, y, width, height, radius, color) {
    pen.fillColor = color; pen.roundRect(x, y, width, height, radius); pen.fill();
  }
  function strokeRound(pen, x, y, width, height, radius, color, lineWidth) {
    pen.lineWidth = lineWidth; pen.strokeColor = color; pen.roundRect(x, y, width, height, radius); pen.stroke();
  }
  // Graphics 没有虚线：沿圆角矩形取点，画 6 空 4 分段描边。
  function dashedRound(pen, x, y, width, height, radius, color, lineWidth) {
    var points = [], corners = [[x + width - radius, y + height - radius, 0], [x + radius, y + height - radius, 90], [x + radius, y + radius, 180], [x + width - radius, y + radius, 270]];
    corners.forEach(function (corner) {
      for (var step = 0; step <= 6; step++) {
        var angle = (corner[2] + step * 15) * Math.PI / 180;
        points.push([corner[0] + Math.cos(angle) * radius, corner[1] + Math.sin(angle) * radius]);
      }
    });
    points.push(points[0]);
    pen.lineWidth = lineWidth; pen.strokeColor = color;
    var drawing = true, rest = 6;
    for (var index = 1; index < points.length; index++) {
      var from = points[index - 1], dx = points[index][0] - from[0], dy = points[index][1] - from[1];
      var length = Math.sqrt(dx * dx + dy * dy), done = 0;
      while (done < length) {
        var piece = Math.min(rest, length - done);
        if (drawing) {
          pen.moveTo(from[0] + dx * done / length, from[1] + dy * done / length);
          pen.lineTo(from[0] + dx * (done + piece) / length, from[1] + dy * (done + piece) / length);
        }
        done += piece; rest -= piece;
        if (rest <= 0) { drawing = !drawing; rest = drawing ? 6 : 4; }
      }
    }
    pen.stroke();
  }
  // cc.Mask 只有矩形和椭圆两种形状；圆角方头像用矩形遮罩，把遮罩画成圆角矩形。要在节点挂上场景前调用。
  function roundMask(node, radius) {
    var mask = node.addComponent(cc.Mask);
    mask._updateGraphics = function () {
      if (!this.enabledInHierarchy) return;
      var size = this.node._contentSize, anchor = this.node._anchorPoint, pen = this._graphics;
      pen.clear(false);
      pen.roundRect(-size.width * anchor.x, -size.height * anchor.y, size.width, size.height, radius);
      if (cc.game.renderType === cc.game.RENDER_TYPE_CANVAS) pen.stroke(); else pen.fill();
      this.setVertsDirty();
    };
    mask.type = cc.Mask.Type.RECT;
    return mask;
  }
  function roundAvatar(parent, x, y, size, radius, url) {
    var clip = new cc.Node('standaloneRoundAvatar');
    clip.setContentSize(size, size); clip.setPosition(x, y);
    roundMask(clip, radius);
    var placeholder = lobbyPen(clip, 'placeholder');
    placeholder.fillColor = cc.color(255, 255, 255, 90); placeholder.rect(-size / 2, -size / 2, size, size); placeholder.fill();
    var picture = new cc.Node('picture');
    picture.setContentSize(size, size); clip.addChild(picture);
    var sprite = picture.addComponent(cc.Sprite); sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM; sprite.trim = false;
    parent.addChild(clip);
    loadAvatar(url || DEFAULT_AVATAR, picture, size);
    return clip;
  }
  function labelWidth(label) {
    if (label._forceUpdateRenderData) label._forceUpdateRenderData();
    return label.node.width;
  }
  // 圆角小标签（状态、距离、性别）。left/top 是标签左上角；anchorX 为 1 时 left 当右边缘用。
  // tall 给了就按这个高度画（桌卡上的状态、距离标签 2.1cqw 高）；background 可以是 [上色, 下色] 两段。
  // 中文字在 Label 框里画得偏上（苹方等字体），小标签和按钮里的字按字号往下挪一点才居中。
  var TEXT_DROP = 0.16;
  function lobbyPill(parent, text, left, top, size, background, color, anchorX, icon, tall) {
    var pen = lobbyPen(parent, 'standalonePill');
    var label = lobbyLabel(pen.node, text, 0, -TEXT_DROP * size, size, color, 0, true);
    var height = tall || size + 8, padding = tall ? tall * 0.42 : size * 0.7, iconWidth = icon ? size : 0;
    var width = labelWidth(label) + padding * 2 + iconWidth;
    var x = anchorX === 1 ? left - width : left;
    pen.node.setPosition(x, top - height / 2);
    if (Array.isArray(background)) {
      fillRound(pen, 0, -height / 2, width, height, height / 2, background[1]);
      fillRound(pen, 1.5, -height * 0.05, width - 3, height * 0.5, height * 0.25, background[0]);
    } else fillRound(pen, 0, -height / 2, width, height, height / 2, background);
    label.node.x = padding + iconWidth;
    if (icon) icon(pen, padding + size * 0.4, 0, size, color);
    pen.node.width = width;
    return pen.node;
  }
  function pinIcon(pen, x, y, size, color) {
    var radius = size * 0.36, top = y + size * 0.12;
    pen.fillColor = color;
    pen.circle(x, top, radius); pen.fill();
    pen.moveTo(x - radius * 0.86, top - radius * 0.5); pen.lineTo(x, y - size * 0.5); pen.lineTo(x + radius * 0.86, top - radius * 0.5); pen.close(); pen.fill();
    pen.fillColor = rgb('#ffffff'); pen.circle(x, top, radius * 0.4); pen.fill();
  }
  function seatName(text) {
    text = String(text || '');
    return text.length > 4 ? text.substring(0, 3) + '…' : text;
  }
  // 大厅里豆子数挪到右上角「空位 N」左边（样式稿）：首页的豆子框收起来，大厅自己画一个；回首页时原版 showView 会把它放出来。
  function openLobby(hall) {
    hall.hideView();
    if (hall.hideCoinView) hall.hideCoinView(false);
    hall.onClickBgBtn();
    cc.mm.uimanager.showWindow(cc.mm.config.hall, 'HallAmuseUI');
  }
  function lobbySelect(controller, node) {
    if (controller._lastTouchBtn && cc.isValid(controller._lastTouchBtn)) controller._lastTouchBtn.getChildByName('selectImg').active = false;
    node.getChildByName('selectImg').active = true;
    controller._lastTouchBtn = node;
  }
  function lobbyVariant(data) {
    return data && !data.standaloneAll && data.gameId !== 2 ? data.gameId + ':0' : null;
  }
  function installLobby() {
    var Controller = cc.js.getClassByName('HallAmuseUIController');
    if (!Controller || Controller.prototype._standaloneLobbyInstalled) return;
    Controller.prototype._standaloneLobbyInstalled = true;
    var loadGames = Controller.prototype.loadGames, onClickGameBtn = Controller.prototype.onClickGameBtn;
    // 原版按地区列出全部玩法，这里只留界面可见的；不止一种时最上面加一项「全部玩法」，每次打开默认选它。
    Controller.prototype.loadGames = function () {
      var result = loadGames.apply(this, arguments);
      this._gameBtns = this._gameBtns.filter(function (node) {
        if (visibleAreaTypes[node.data && node.data.gameId]) return true;
        node.destroy();
        return false;
      });
      if (this._gameBtns.length < 2) {
        if (this._gameBtns.length) this.onClickGameBtn({ node: this._gameBtns[0] });
        return result;
      }
      var all = cc.instantiate(this.views.baseGameBtn);
      cc.mm.uitools.restNode(all);
      all.data = { name: LOBBY_ALL, gameId: 0, standaloneAll: true };
      all.getChildByName('label').getComponent(cc.Label).string = LOBBY_ALL;
      all.getChildByName('selectImg').getChildByName('label').getComponent(cc.Label).string = LOBBY_ALL;
      all.getChildByName('selectImg').active = false;
      this.views['games/scrollview/view/content'].insertChild(all, 0);
      cc.mm.uitools.addBtnLister(all, this.onClickGameBtn.bind(this), this);
      this._gameBtns.unshift(all);
      this.onClickGameBtn({ node: all });
      return result;
    };
    Controller.prototype.onClickGameBtn = function (event) {
      if (event.node.data && event.node.data.standaloneAll) { lobbySelect(this, event.node); this._areaType = 0; }
      else onClickGameBtn.apply(this, arguments);
      var lobby = this._standaloneLobby || (this._standaloneLobby = {});
      lobby.variant = lobbyVariant(event.node.data);
      lobbyRefresh(this, true);
    };
    Controller.prototype.onClickQuickBtn = function () { lobbyQuickStart(this); };
    afterLoadUI('HallAmuseUIController', patchLobby);
  }
  function patchLobby(controller) {
    var lobby = controller._standaloneLobby || (controller._standaloneLobby = {});
    startLocationReports();
    hide(controller.views, ['games/qiehuan']);
    closeLobbyPlayer(lobby);
    // 每 2 秒问一次有没有变化。用普通定时器：窗口复用时原版会停掉组件定时器，
    // 浏览器窗口被遮挡时游戏帧也会降频；大厅不显示或已销毁就不发请求。
    function poll() {
      clearInterval(lobby.timer);
      lobby.timer = setInterval(function () {
        if (!cc.isValid(controller.node)) return clearInterval(lobby.timer);
        if (!controller.node.activeInHierarchy) return;
        if (layoutLobby(controller)) renderLobby(controller);
        lobbyRefresh(controller, false);
      }, 2000);
      lobbyRefresh(controller, true);
    }
    if (lobby.box) { poll(); return; }
    if (!controller.views || !controller.views.left) return;
    hide(controller.views, ['fireReward', 'games/label', 'left/gamaname', 'left/select_1', 'left/select_2', 'left/select_3', 'left/select_4', 'left/select_5', 'backBtn/yulechang-yuke']);
    var title = lobbyLabel(controller.views.backBtn, '大厅', 30, 0, 36, rgb('#ffffff'), 0.5, true);
    var outline = title.node.addComponent(cc.LabelOutline); outline.color = cc.color(32, 86, 168); outline.width = 2;
    // 原版橙色快速开始收起，换成右下角的金色胶囊（样式稿第二版 .quick）。
    controller.views['left/quick_start'].active = false;
    lobby.tab = 'all';
    // 桌卡区挂在整个窗口上，按窗口宽度排版（layoutLobby），不再跟着原版右侧区域缩放。
    lobby.box = new cc.Node('standaloneLobbyBox'); controller.node.addChild(lobby.box);
    // 标签：全部 / 附近 / 底分 1、2、5……（第三轮 R4），底分标签按桌上有的底分在 renderLobby 里补。
    lobby.tabs = [lobbyTab(controller, 'all', '全部'), lobbyTab(controller, 'nearby', '附近')];
    // 右上角「空位 N」，数字黄色；左边是我的豆子。
    var countNode = new cc.Node('standaloneLobbyCount'); countNode.anchorX = 1; lobby.box.addChild(countNode);
    lobby.count = countNode.addComponent(cc.RichText);
    lobby.count.fontSize = 20; lobby.count.lineHeight = 26; lobby.count.horizontalAlign = cc.macro.TextAlignment.RIGHT;
    lobby.beans = lobbyPen(lobby.box, 'standaloneLobbyBeans');
    lobby.beansLabel = lobbyShadow(lobbyLabel(lobby.beans.node, '', 0, 0, 21, rgb('#ffffff'), 1, true));
    var scrollNode = new cc.Node('standaloneLobbyTables'); lobby.box.addChild(scrollNode);
    var view = new cc.Node('view'); view.addComponent(cc.Mask); scrollNode.addChild(view);
    var content = new cc.Node('content'); content.anchorY = 1; view.addChild(content);
    var scroll = scrollNode.addComponent(cc.ScrollView);
    scroll.content = content; scroll.horizontal = false; scroll.vertical = true; scroll.inertia = true; scroll.elastic = true; scroll.brake = 0.75;
    lobby.scroll = scrollNode; lobby.view = view; lobby.content = content; lobby.cards = {};
    // 右边细滚动条：桌子多于一屏才画（样式稿右沿 0.7cqw、上沿 8cqw、高 34cqw）。
    lobby.bar = lobbyPen(lobby.box, 'standaloneLobbyBar');
    scrollNode.on('scrolling', function () { drawLobbyBar(lobby); });
    // 空状态放在深色玻璃底板上，雪景背景上也看得清。
    var emptyPen = lobbyPen(lobby.box, 'standaloneLobbyEmpty', 0, 40);
    fillRound(emptyPen, -320, -60, 640, 120, 24, cc.color(20, 30, 60, 150));
    strokeRound(emptyPen, -320, -60, 640, 120, 24, cc.color(255, 255, 255, 107), 1.5);
    lobby.empty = lobbyLabel(emptyPen.node, '', 0, 0, 26, rgb('#ffffff'), 0.5, true);
    // 加入房间、创建房间去掉（第三轮 R1）；底部两句提示也去掉（11-01 反馈），只留右下角快速开始。
    hide(controller.views, ['left/joinbtn', 'left/createroom']);
    lobby.quick = lobbyQuickButton(controller);
    layoutLobby(controller);
    poll();
  }
  // 快速开始（样式稿第二版 .quick）：18cqw × 5.4cqw 金色胶囊，上浅下深、底下一道深橙边、白色细描边，左边闪电。
  // Graphics 没有渐变：按 2 像素一条横切胶囊，每条按胶囊在这一高度的宽度画，颜色从浅黄过渡到橙（叠圆角条会在上角露毛边）。
  function lobbyQuickButton(controller) {
    var width = 240, height = 72, radius = height / 2;
    var pen = lobbyPen(controller._standaloneLobby.box, 'standaloneQuickStart');
    pen.node.setContentSize(width, height);
    fillRound(pen, -width / 2 + 4, -radius - 14, width - 8, height, radius, cc.color(120, 50, 0, 70));
    fillRound(pen, -width / 2, -radius - 6, width, height, radius, rgb('#b85f00'));
    var stops = [[0, '#fff0a6'], [0.38, '#ffcf3f'], [1, '#f59a0c']], strip = 2;
    var halfAt = function (y) { return width / 2 - radius + Math.sqrt(Math.max(0, radius * radius - y * y)); };
    for (var top = radius; top > -radius; top -= strip) {
      var bottom = Math.max(-radius, top - strip - 0.6), t = (radius - top) / height, k = t <= 0.38 ? 0 : 1, a = stops[k], b = stops[k + 1], u = (t - a[0]) / (b[0] - a[0]);
      var from = rgb(a[1]), to = rgb(b[1]), up = halfAt(top), down = halfAt(bottom);
      pen.fillColor = cc.color(from.r + (to.r - from.r) * u, from.g + (to.g - from.g) * u, from.b + (to.b - from.b) * u);
      pen.moveTo(-up, top); pen.lineTo(up, top); pen.lineTo(down, bottom); pen.lineTo(-down, bottom); pen.close(); pen.fill();
    }
    strokeRound(pen, -width / 2 + 1, -radius + 1, width - 2, height - 2, radius - 1, cc.color(255, 255, 255, 150), 2);
    var label = lobbyLabel(pen.node, '快速开始', 0, -3, 31, rgb('#6a2f00'), 0, true);
    var icon = 32, gap = 10, total = icon + gap + labelWidth(label), x = -total / 2;
    label.node.x = x + icon + gap;
    // 闪电（24×24 的路径按 32 放大）。
    var scale = icon / 24, point = function (px, py) { return [x + px * scale, (12 - py) * scale]; };
    pen.fillColor = rgb('#7a3500');
    [[13.5, 2], [4, 14], [10.5, 14], [9, 22], [20, 9], [13.2, 9]].forEach(function (p, i) { var at = point(p[0], p[1]); if (i) pen.lineTo(at[0], at[1]); else pen.moveTo(at[0], at[1]); });
    pen.close(); pen.fill();
    var button = pen.node.addComponent(cc.Button); button.transition = cc.Button.Transition.SCALE; button.zoomScale = 0.94;
    cc.mm.uitools.addBtnLister(pen.node, function () { lobbyQuickStart(controller); }, controller);
    return pen.node;
  }
  // 标签 3.4cqw 高、左右 1.8cqw、字 1.6cqw，两头全圆，标签之间留 1cqw。
  function lobbyTab(controller, key, text) {
    var lobby = controller._standaloneLobby, pen = lobbyPen(lobby.box, 'standaloneLobbyTab');
    pen.node.setContentSize(100, 45);
    pen.node.addComponent(cc.Button).transition = cc.Button.Transition.SCALE;
    var label = lobbyShadow(lobbyLabel(pen.node, text, 0, 0, 21, rgb('#ffffff'), 0.5, true));
    cc.mm.uitools.addBtnLister(pen.node, function () { if (lobby.tab !== key) lobby.content.y = lobby.view.height / 2; lobby.tab = key; closeLobbyPlayer(lobby); renderLobby(controller); }, controller);
    return { key: key, node: pen.node, pen: pen, label: label, natural: labelWidth(label) + 48 };
  }
  // 豆子框：深蓝半透明圆角，左边金豆，右边数字（样式稿 .beans），右边缘对齐节点原点。
  function drawLobbyBeans(lobby, text) {
    var pen = lobby.beans, label = lobby.beansLabel, height = 43;
    label.string = text;
    var width = 8 + 35 + 9 + labelWidth(label) + 19;
    pen.clear();
    fillRound(pen, -width, -height / 2, width, height, height / 2, cc.color(15, 30, 60, 140));
    var x = -width + 8 + 17.5;
    pen.fillColor = rgb('#b9780a'); pen.ellipse(x, 0, 17.5, 13.5); pen.fill();
    pen.fillColor = rgb('#f2b51c'); pen.ellipse(x - 1.5, 1.5, 14.5, 11); pen.fill();
    pen.fillColor = rgb('#fff3a8'); pen.ellipse(x - 5, 4, 6, 4.5); pen.fill();
    label.node.x = -19;
    pen.node.width = width;
  }
  function groupDigits(text) {
    var parts = String(text).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function drawLobbyBar(lobby) {
    var pen = lobby.bar, view = lobby.view.height, content = lobby.content.height;
    pen.clear();
    if (!(content > view + 1)) return;
    var top = lobby.areaTop, track = lobby.areaTop - lobby.areaBottom, width = 5, x = lobby.barX - width / 2;
    var handle = Math.max(40, track * view / content);
    var ratio = Math.max(0, Math.min(1, (lobby.content.y - view / 2) / (content - view)));
    fillRound(pen, x, top - track, width, track, width / 2, cc.color(255, 255, 255, 64));
    fillRound(pen, x, top - handle - (track - handle) * ratio, width, handle, width / 2, cc.color(255, 255, 255, 191));
  }
  // 底分标签跟着桌上有的底分走，从小到大；没有的藏掉。
  function lobbyBaseTabs(controller, tables) {
    var lobby = controller._standaloneLobby, seen = {};
    tables.forEach(function (table) { seen[table.baseBeans] = true; });
    var bases = Object.keys(seen).sort(function (a, b) { return Number(a) - Number(b); }).slice(0, 5);
    bases.forEach(function (base) {
      var key = 'base:' + base;
      if (!lobby.tabs.some(function (tab) { return tab.key === key; })) lobby.tabs.push(lobbyTab(controller, key, '底分 ' + base));
    });
    lobby.tabs.sort(function (a, b) {
      var order = function (tab) { return tab.key === 'all' ? -2 : tab.key === 'nearby' ? -1 : Number(tab.key.slice(5)); };
      return order(a) - order(b);
    });
    lobby.tabs.forEach(function (tab) {
      tab.node.active = tab.key === 'all' || (tab.key === 'nearby' ? !!(lobby.data && lobby.data.hasLocation) : bases.indexOf(tab.key.slice(5)) >= 0);
    });
    if (!lobby.tabs.some(function (tab) { return tab.key === lobby.tab && tab.node.active; })) lobby.tab = 'all';
  }
  // 按窗口宽度排：一屏两排，至少三列（16:9、4:3 都是三列），特别宽的屏每张卡够 420 宽再加列。
  // 返回 true 表示列数、卡宽或卡高变了，要重画桌卡。
  function layoutLobby(controller) {
    var lobby = controller._standaloneLobby, width = controller.node.width, half = width / 2;
    if (!lobby || !lobby.box) return false;
    var buttons = controller._gameBtns || [], single = buttons.length < 2;
    if (controller.views.games) controller.views.games.active = !single;
    // 桌卡区左 3cqw、右 4.2cqw（右边留给滚动条），顶栏右边缘 3cqw。
    var left = single ? -half + 40 : -half + 290, right = half - 56, headRight = half - 40, areaWidth = right - left;
    var columns = Math.max(3, Math.min(5, Math.floor((areaWidth + LOBBY_GAP_X) / (420 + LOBBY_GAP_X))));
    var cardWidth = Math.floor((areaWidth - LOBBY_GAP_X * (columns - 1)) / columns);
    var center = (left + right) / 2, top = LOBBY_TOP, bottom = LOBBY_TOP - LOBBY_AREA;
    // 顶栏从右往左：「空位 N」、豆子框；标签接在「大厅」后面，排到豆子框前。放不下就略缩，
    // 再放不下挪到桌卡区上面单独一排，桌卡区往下让、卡变矮。
    var countWidth = lobby.count.node.width || 70, beansWidth = lobby.beans.node.width || 120;
    lobby.count.node.setPosition(headRight, LOBBY_BAR_Y);
    lobby.beans.node.setPosition(headRight - countWidth - 19, LOBBY_BAR_Y);
    var tabs = lobby.tabs.filter(function (tab) { return tab.node.active; }), gap = 13;
    var natural = tabs.reduce(function (sum, tab) { return sum + tab.natural; }, 0) + gap * Math.max(0, tabs.length - 1);
    var tabLeft = -half + 261, room = headRight - countWidth - 19 - beansWidth - 16 - tabLeft;
    var scale = Math.min(1, room / natural), tabY = LOBBY_BAR_Y;
    if (scale < 0.85) { tabY = top - 25; top -= 60; tabLeft = left; scale = Math.min(1, areaWidth * 0.75 / natural); }
    var x = tabLeft;
    tabs.forEach(function (tab) {
      tab.width = Math.floor(tab.natural * scale); tab.node.setContentSize(tab.width, 45);
      tab.node.setPosition(x + tab.width / 2, tabY);
      x += tab.width + gap * scale;
    });
    var cardHeight = Math.floor((top - bottom - LOBBY_GAP_Y) / 2);
    lobby.scroll.setContentSize(areaWidth, top - bottom); lobby.scroll.setPosition(center, (top + bottom) / 2);
    lobby.view.setContentSize(areaWidth, top - bottom);
    // 保住已经滑下去的位置：大厅每 2 秒拉一次，桌子有变化就重排，以前每次都把列表拉回最上面，手机上一滑就弹回去（玩家反馈）。
    var offset = lobby.viewTop === undefined ? 0 : Math.max(0, lobby.content.y - lobby.viewTop);
    lobby.viewTop = (top - bottom) / 2; lobby.content.width = areaWidth; lobby.content.y = lobby.viewTop + offset;
    lobby.empty.node.parent.x = center;
    // 滚动条离右边 2.4cqw；快速开始贴右下角，离右 3cqw、离底 1.5cqw。
    lobby.barX = half - 32 - 2.5; lobby.areaTop = top; lobby.areaBottom = bottom;
    lobby.quick.setPosition(headRight - 120, -375 + 26 + 36);
    var changed = lobby.columns !== columns || lobby.cardWidth !== cardWidth || lobby.cardHeight !== cardHeight;
    lobby.columns = columns; lobby.cardWidth = cardWidth; lobby.cardHeight = cardHeight; lobby.areaWidth = areaWidth;
    return changed;
  }
  function lobbyRefresh(controller, reset) {
    var lobby = controller._standaloneLobby;
    if (!lobby || !lobby.content || !cc.isValid(controller.node)) return;
    if (reset) lobby.version = null;
    if (lobby.loading) { lobby.again = lobby.again || reset; return; }
    lobby.loading = true;
    var variant = lobby.variant, query = [];
    if (variant) query.push('variant=' + encodeURIComponent(variant));
    if (lobby.version) query.push('since=' + encodeURIComponent(lobby.version));
    apiRequest('GET', '/api/lobby/tables' + (query.length ? '?' + query.join('&') : '')).then(function (data) {
      lobby.loading = false;
      if (!cc.isValid(controller.node)) return;
      if (lobby.again || lobby.variant !== variant) { lobby.again = false; return lobbyRefresh(controller, true); }
      if (data.unchanged) return;
      lobby.version = data.version; lobby.data = data; lobby.failed = false;
      renderLobby(controller);
    }, function () {
      lobby.loading = false;
      if (!cc.isValid(controller.node) || lobby.data) return;
      lobby.failed = true;
      renderLobby(controller);
    });
  }
  function drawLobbyTab(tab, on) {
    // 选中：上黄下橙、底下一道 0.25cqw 深橙边、浅黄描边；没选中：深蓝半透明、白描边。
    var pen = tab.pen, width = tab.width || 100, half = width / 2, height = 45, radius = height / 2;
    pen.clear();
    if (on) {
      fillRound(pen, -half, -radius - 3, width, height, radius, rgb('#c77700'));
      fillRound(pen, -half, -radius, width, height, radius, rgb('#f6a91f'));
      fillRound(pen, -half + 2, -2, width - 4, radius, radius - 2, rgb('#ffe27a', 0.85));
      strokeRound(pen, -half, -radius, width, height, radius, rgb('#fff3c4'), 1.6);
    } else {
      fillRound(pen, -half, -radius, width, height, radius, cc.color(22, 44, 88, 128));
      strokeRound(pen, -half, -radius, width, height, radius, cc.color(255, 255, 255, 89), 1.6);
    }
    tab.label.node.color = on ? rgb('#6a3500') : rgb('#ffffff');
    var shadow = tab.label.getComponent(cc.LabelShadow);
    if (shadow) shadow.enabled = !on;
  }
  function renderLobby(controller) {
    var lobby = controller._standaloneLobby, data = lobby.data || { tables: [], variants: [], hasLocation: false };
    lobbyBaseTabs(controller, data.tables);
    layoutLobby(controller);
    lobby.tabs.forEach(function (tab) { drawLobbyTab(tab, tab.key === lobby.tab); });
    var tables = data.tables.slice();
    if (lobby.tab === 'nearby') tables = tables.filter(function (table) { return table.nearby; }).sort(function (a, b) { return a.nearby.rank - b.nearby.rank; });
    else if (lobby.tab.indexOf('base:') === 0) tables = tables.filter(function (table) { return 'base:' + table.baseBeans === lobby.tab; });
    var open = tables.reduce(function (sum, table) { return sum + (table.state === 'playing' ? 0 : Math.max(0, table.playerCount - table.seats.length)); }, 0);
    lobby.count.string = lobby.data ? '<outline color=#14203c width=1><b><color=#ffffff>空位 </color><color=#ffe27a>' + open + '</color></b></outline>' : '';
    var beans = data.beans !== undefined ? data.beans : cc.mm.framemodel && cc.mm.framemodel.goldNum;
    drawLobbyBeans(lobby, groupDigits(beanText(Number(beans) || 0)));
    lobby.beans.node.active = !!lobby.data;
    layoutLobby(controller);
    lobby.empty.string = lobby.failed ? '大厅加载失败，稍后会自动重试' : !lobby.data ? '正在加载…'
      : tables.length ? '' : lobby.tab === 'nearby' ? '附近暂时没有人在玩，去「全部」看看'
      : '这个玩法暂时没有桌子，稍后再来看看';
    lobby.empty.node.parent.active = !!lobby.empty.string;
    var next = {}, columns = lobby.columns, cardWidth = lobby.cardWidth, cardHeight = lobby.cardHeight;
    tables.forEach(function (table, index) {
      var signature = JSON.stringify([table, cardWidth, cardHeight, lobbyEnough(data, table)]), card = lobby.cards[table.code];
      if (!card || !cc.isValid(card) || card._standaloneSignature !== signature) {
        if (card && cc.isValid(card)) card.destroy();
        card = lobbyCard(controller, table, cardWidth, cardHeight);
        card._standaloneSignature = signature;
        lobby.content.addChild(card);
      }
      card.setPosition(-lobby.areaWidth / 2 + cardWidth / 2 + index % columns * (cardWidth + LOBBY_GAP_X),
        -cardHeight / 2 - Math.floor(index / columns) * (cardHeight + LOBBY_GAP_Y));
      next[table.code] = card;
    });
    Object.keys(lobby.cards).forEach(function (code) { if (!next[code] && cc.isValid(lobby.cards[code])) lobby.cards[code].destroy(); });
    lobby.cards = next;
    var rows = Math.ceil(tables.length / columns);
    lobby.content.height = Math.max(lobby.view.height, rows * cardHeight + Math.max(0, rows - 1) * LOBBY_GAP_Y);
    // 桌子变少时别停在内容外面。
    lobby.content.y = Math.min(lobby.content.y, lobby.view.height / 2 + lobby.content.height - lobby.view.height);
    drawLobbyBar(lobby);
  }
  // 进行中的桌子绿桌压暗（样式稿 saturate(.75) brightness(.9)）。
  function feltColor(hex, playing) {
    var color = rgb(hex);
    if (!playing) return color;
    var grey = 0.3 * color.r + 0.59 * color.g + 0.11 * color.b;
    var mix = function (value) { return Math.round(((value - grey) * 0.75 + grey) * 0.9); };
    return cc.color(mix(color.r), mix(color.g), mix(color.b));
  }
  // 俯视绿桌（样式稿第二版 .felt）：卡宽、卡高各 42%，圆角 1.4cqw，木框 0.45cqw #8a5a2e、金色内线，
  // 中间偏上亮 #3aa56b、四周暗 #1f7448（Graphics 没有渐变，用几层圆角叠出来）。
  function lobbyFelt(card, table, width, height, playing) {
    var pen = lobbyPen(card, 'standaloneFelt'), x = -width / 2, y = -height / 2, radius = 19, frame = 6;
    fillRound(pen, x + 1, y - 4, width - 2, height, radius, cc.color(0, 0, 0, 90));
    fillRound(pen, x, y, width, height, radius, feltColor('#8a5a2e', playing));
    var dark = rgb('#1f7448'), light = rgb('#3aa56b'), steps = 12, inner = width - frame * 2, innerHeight = height - frame * 2;
    for (var index = 0; index < steps; index++) {
      var t = index / (steps - 1), inset = frame + index * Math.min(inner, innerHeight) * 0.028, lift = index * 0.5;
      var hex = '#' + [dark.r + (light.r - dark.r) * t, dark.g + (light.g - dark.g) * t, dark.b + (light.b - dark.b) * t]
        .map(function (value) { return ('0' + Math.round(value).toString(16)).slice(-2); }).join('');
      fillRound(pen, x + inset, y + inset + lift, width - inset * 2, height - inset * 2, Math.max(6, radius - frame - index * 0.8), feltColor(hex, playing));
    }
    strokeRound(pen, x + frame + 1.2, y + frame + 1.2, width - frame * 2 - 2.4, height - frame * 2 - 2.4, radius - frame, feltColor('#d9a35f', playing), 2.4);
    // 「底分 N」1.9cqw 粗体，下面一行 1cqw；打牌中写「第几场 · 第几局」；连着打过的桌多一行黄字「第 N 场」（第三轮 R4）。
    var seq = table.matchSeq || 1, third = !playing && seq > 1;
    lobbyShadow(lobbyLabel(pen.node, '底分 ' + table.baseBeans, 0, third ? 16 : 8, 25, rgb('#ffffff'), 0.5, true));
    lobbyShadow(lobbyLabel(pen.node, playing ? '第 ' + seq + ' 场 · ' + table.currentRound + ' / ' + table.rounds + ' 局' : table.rounds + ' 局 · 门槛 ' + table.threshold + ' 豆',
      0, third ? -6 : -14, 13, cc.color(255, 255, 255, 230), 0.5, false));
    if (third) lobbyShadow(lobbyLabel(pen.node, '第 ' + seq + ' 场', 0, -22, 13, rgb('#ffe27a'), 0.5, true));
  }
  // 座位按顺时针从上方排：4 人上右下左，3 人上右左，2 人上下。样式稿第二版上下在卡高 15% / 85%，左右在卡宽 14% / 86%，都收在卡里。
  function lobbySeatSpots(count, width, height) {
    var side = width * 0.36, vertical = height * 0.35;
    var top = [0, vertical], right = [side, 0], bottom = [0, -vertical], left = [-side, 0];
    return count >= 4 ? [top, right, bottom, left] : count === 3 ? [top, right, left] : [top, bottom];
  }
  // 我的豆子够不够这桌门槛；服务端没给豆子时当够，入座时服务端还会再查。
  function lobbyEnough(data, table) {
    return data.beans === undefined || Number(data.beans) >= Number(table.threshold);
  }
  function beanText(value) { return String(Math.round(value * 100) / 100); }
  // 空位是小圆座，只留「＋」：点哪个坐哪个（第三轮 R3；第二版样式去掉虚线框和「坐下」字）。
  // 差 1 人的桌空位金色、外圈光轻轻闪；豆子不够门槛半透明，点了提示差多少。
  function lobbyEmptySeat(controller, card, table, seatNo, x, y) {
    var lobby = controller._standaloneLobby, size = LOBBY_EMPTY, half = size / 2;
    var enough = lobbyEnough(lobby.data || {}, table), go = enough && table.playerCount - table.seats.length === 1;
    var seat = new cc.Node('standaloneEmptySeat');
    seat.setContentSize(size, size); seat.setPosition(x, y); card.addChild(seat);
    if (go) {
      var glow = lobbyPen(seat, 'glow');
      for (var ring = 4; ring >= 1; ring--) { glow.fillColor = cc.color(255, 200, 80, 34); glow.circle(0, 0, half + ring * 4); glow.fill(); }
      cc.tween(glow.node).repeatForever(cc.tween().to(0.8, { opacity: 70 }, { easing: 'sineInOut' }).to(0.8, { opacity: 255 }, { easing: 'sineInOut' })).start();
    }
    var empty = lobbyPen(seat, 'face');
    empty.fillColor = go ? cc.color(255, 210, 90, 77) : cc.color(255, 255, 255, 36); empty.circle(0, 0, half); empty.fill();
    empty.lineWidth = go ? 2.4 : 1.6; empty.strokeColor = go ? rgb('#ffd25a') : cc.color(255, 255, 255, 115); empty.circle(0, 0, half - 0.8); empty.stroke();
    // 「＋」用两道圆头线画，不用字（字形偏上，圆里不居中）。
    empty.lineWidth = 2.6; empty.lineCap = cc.Graphics.LineCap.ROUND; empty.strokeColor = go ? rgb('#fff3c4') : cc.color(255, 255, 255, 217);
    empty.moveTo(-9, 0); empty.lineTo(9, 0); empty.moveTo(0, -9); empty.lineTo(0, 9); empty.stroke();
    if (!enough) seat.opacity = 115;
    var button = seat.addComponent(cc.Button); button.transition = cc.Button.Transition.SCALE; button.zoomScale = 0.92;
    cc.mm.uitools.addBtnLister(seat, function () {
      if (!lobbyEnough(lobby.data || {}, table)) {
        return toast('豆子不够：底分 ' + table.baseBeans + ' 要 ' + table.threshold + ' 豆，你还差 ' + beanText(Number(table.threshold) - Number(lobby.data.beans)) + ' 豆');
      }
      lobbySit(controller, table.code, seatNo);
    }, controller);
  }
  function lobbySit(controller, code, seatNo) {
    var lobby = controller._standaloneLobby;
    if (lobby.sitting) return;
    lobby.sitting = true;
    apiRequest('POST', '/api/lobby/sit', { code: String(code), seat: seatNo }).then(function (result) {
      lobby.sitting = false;
      lobby.joiningAt = 0;
      lobbyJoin(lobby, result.code);
    }, function (error) {
      lobby.sitting = false;
      toast(error.message);
      lobbyRefresh(controller, true);
    });
  }
  function lobbySeat(controller, card, player, x, y) {
    var size = LOBBY_SEAT, half = size / 2;
    var seat = new cc.Node('standaloneLobbySeat');
    seat.setContentSize(size, size); seat.setPosition(x, y); card.addChild(seat);
    var shadow = lobbyPen(seat, 'shadow', 0, -3);
    fillRound(shadow, -half - 1, -half - 1, size + 2, size + 2, 12, cc.color(0, 0, 0, 64));
    var clip = roundAvatar(seat, 0, 0, size, 11, player.avatarUrl);
    // 头像底下一条深色名字条（1.3cqw 高），右上角性别符号（样式稿第二版 .seat.who）。
    var strip = lobbyPen(clip, 'nameStrip');
    strip.fillColor = cc.color(0, 0, 0, 140); strip.rect(-half, -half, size, 18); strip.fill();
    lobbyLabel(clip, seatName(player.nickname), 0, -half + 9, 12, rgb('#ffffff'), 0.5, false);
    var sex = { 1: ['♂', '#a8d4ff'], 2: ['♀', '#ffb3d1'] }[player.sex];
    if (sex) lobbyShadow(lobbyLabel(clip, sex[0], half - 3, half - 8, 12, rgb(sex[1]), 1, true));
    var ring = lobbyPen(seat, 'ring');
    strokeRound(ring, -half, -half, size, size, 11, rgb('#ffffff'), 2.4);
    // 头像自己是按钮：点头像看信息卡，不会当成点桌子入座。
    var button = seat.addComponent(cc.Button); button.transition = cc.Button.Transition.SCALE; button.zoomScale = 0.94;
    cc.mm.uitools.addBtnLister(seat, function () { openLobbyPlayer(controller, seat, player); }, controller);
  }
  // 桌卡（样式稿第二版 .card）：深色磨砂底（背景图不再透出来抢眼），圆角 1.6cqw，白 22% 细边；
  // 打牌中底更深；差 1 人的桌金边加一圈淡金光。
  function lobbyCard(controller, table, width, height) {
    var playing = table.state === 'playing', missing = table.playerCount - table.seats.length, hot = !playing && missing === 1;
    var card = new cc.Node('standaloneLobbyCard');
    card.setContentSize(width, height);
    var glass = lobbyPen(card, 'glass'), radius = 21;
    fillRound(glass, -width / 2 + 3, -height / 2 - 7, width - 6, height, radius, cc.color(8, 18, 40, 70));
    if (hot) fillRound(glass, -width / 2 - 2, -height / 2 - 2, width + 4, height + 4, radius + 2, cc.color(255, 180, 60, 90));
    fillRound(glass, -width / 2, -height / 2, width, height, radius, playing ? cc.color(14, 28, 60, 205) : cc.color(16, 32, 68, 178));
    strokeRound(glass, -width / 2, -height / 2, width, height, radius, hot ? cc.color(255, 196, 80, 191) : cc.color(255, 255, 255, 56), hot ? 1.8 : 1.3);
    lobbyFelt(card, table, Math.round(width * 0.42), Math.round(height * 0.42), playing);
    var bySeat = {};
    table.seats.forEach(function (seat) { bySeat[seat.seat] = seat; });
    lobbySeatSpots(table.playerCount, width, height).forEach(function (spot, index) {
      if (bySeat[index + 1]) lobbySeat(controller, card, bySeat[index + 1], spot[0], spot[1]);
      else if (!playing) lobbyEmptySeat(controller, card, table, index + 1, spot[0], spot[1]);
    });
    // 状态：差 1 人橙 / 差 N 人绿 / 空桌淡白 / 打牌中暗色（第三轮 R4）。标签离卡边 1.2cqw、高 2.2cqw、字 1.15cqw。
    var empty = !playing && table.seats.length === 0, pillLeft = -width / 2 + 16, pillTop = height / 2 - 16;
    var pill = lobbyPill(card, playing ? '打牌中' : empty ? '空桌' : '差 ' + missing + ' 人', pillLeft, pillTop, 15,
      playing ? cc.color(0, 0, 0, 89) : empty ? cc.color(255, 255, 255, 41) : hot ? [rgb('#ffb340'), rgb('#ff7a00')] : rgb('#2f9e62'),
      playing ? rgb('#c9d4e6') : empty ? rgb('#dfe8f7') : rgb('#ffffff'), 0, null, 29);
    if (hot) lobbyShadow(pill.getChildByName('label').getComponent(cc.Label));
    // 有人的桌子都显示离我多远（S2-AC3），只给档位不给米数；我没开定位时服务端不给。
    if (table.nearby) lobbyPill(card, table.nearby.band, width / 2 - 16, height / 2 - 16, 15, cc.color(255, 255, 255, 242), rgb('#1f6fc4'), 1, pinIcon, 29);
    // 桌的基础玩法（玩家反馈第六条）：左下几个王，右下翻法和封顶（DEC-20261108-翻法封顶每桌选）。
    var ruleBottom = -height / 2 + 14 + 24, ruleBg = cc.color(0, 0, 0, 77), ruleFg = rgb('#ffe9b8');
    if (table.wangNum) lobbyPill(card, table.wangNum + ' 个王', -width / 2 + 14, ruleBottom, 13, ruleBg, ruleFg, 0, null, 24);
    if (table.fanText) lobbyPill(card, table.fanText.replace('、', ' · '), width / 2 - 14, ruleBottom, 13, ruleBg, ruleFg, 1, null, 24);
    return card;
  }
  // 点头像弹的信息卡（S2-AC2）：昵称、性别、对外数字 ID；点别处关闭。
  var SEX_TAGS = { 1: ['男', '#4a90e2'], 2: ['女', '#e8679a'] };
  function closeLobbyPlayer(lobby) {
    if (lobby && lobby.player && cc.isValid(lobby.player)) lobby.player.destroy();
    if (lobby) lobby.player = null;
  }
  function openLobbyPlayer(controller, seat, player) {
    var lobby = controller._standaloneLobby, host = controller.node;
    closeLobbyPlayer(lobby);
    var layer = new cc.Node('standaloneLobbyPlayer');
    layer.setContentSize(host.width, host.height); host.addChild(layer);
    layer.on(cc.Node.EventType.TOUCH_END, function () { closeLobbyPlayer(lobby); });
    lobby.player = layer;
    var width = 270, height = 112, half = host.width / 2, at = layer.convertToNodeSpaceAR(seat.convertToWorldSpaceAR(cc.v2(0, 0)));
    var toRight = at.x + LOBBY_SEAT / 2 + 14 + width <= half - 10;
    var x = toRight ? at.x + LOBBY_SEAT / 2 + 14 + width / 2 : at.x - LOBBY_SEAT / 2 - 14 - width / 2;
    var y = Math.max(-375 + height / 2 + 10, Math.min(375 - height / 2 - 10, at.y));
    var panel = lobbyPen(layer, 'panel', x, y);
    panel.node.setContentSize(width, height);
    panel.node.addComponent(cc.BlockInputEvents);
    fillRound(panel, -width / 2, -height / 2 - 6, width, height, 16, cc.color(20, 30, 70, 70));
    fillRound(panel, -width / 2, -height / 2, width, height, 16, rgb('#fffaf0'));
    var arrowY = Math.max(-height / 2 + 18, Math.min(height / 2 - 18, at.y - y)), edge = toRight ? -width / 2 : width / 2, tip = toRight ? edge - 10 : edge + 10;
    panel.fillColor = rgb('#fffaf0');
    panel.moveTo(edge, arrowY + 10); panel.lineTo(tip, arrowY); panel.lineTo(edge, arrowY - 10); panel.close(); panel.fill();
    var avatarX = -width / 2 + 14 + 42;
    var frame = lobbyPen(panel.node, 'frame', avatarX, 0);
    fillRound(frame, -44, -44, 88, 88, 16, rgb('#f0dfbd'));
    roundAvatar(panel.node, avatarX, 0, 84, 14, player.avatarUrl);
    var textX = avatarX + 42 + 12;
    var name = lobbyLabel(panel.node, shortName(player.nickname, 5), textX, 18, 19, rgb('#5a3200'), 0, true);
    var sex = SEX_TAGS[player.sex];
    if (sex) lobbyPill(panel.node, sex[0], textX + labelWidth(name) + 8, 18 + 2 + 11, 14, rgb(sex[1]), rgb('#ffffff'), 0, null, 22);
    var id = new cc.Node('uid'), rich = id.addComponent(cc.RichText);
    id.anchorX = 0; rich.fontSize = 14; rich.lineHeight = 20; rich.horizontalAlign = cc.macro.TextAlignment.LEFT;
    rich.string = '<color=#8d7a62>ID </color><b><color=#5a3200>' + (player.uid || '—') + '</color></b>';
    id.setPosition(textX, -16); panel.node.addChild(id);
    panel.node.scale = 0.9; panel.node.opacity = 0;
    cc.tween(panel.node).to(0.12, { scale: 1, opacity: 255 }).start();
  }
  function shortName(text, length) {
    text = String(text || '');
    return text.length > length ? text.substring(0, length) + '…' : text;
  }
  // 从大厅桌退出后回到大厅桌列表；好友房仍回主大厅（DEC-20261030-退桌回大厅桌列表）。
  var lobbyReturn = null;
  function lobbyJoin(lobby, code) {
    if (lobby.joiningAt && Date.now() - lobby.joiningAt < 2000) return;
    lobby.joiningAt = Date.now();
    lobbyReturn = { code: String(code), entered: false };
    cc.mm.hallserver.requestJoinRoom(String(code));
  }
  function noteLobbyTable() {
    var room = cc.mm.gameserver && cc.mm.gameserver.room_data;
    if (!lobbyReturn || lobbyReturn.entered || !room || !room.roomId) return;
    if (String(room.roomId) === lobbyReturn.code) lobbyReturn.entered = true;
    else lobbyReturn = null;
  }
  function returnToLobby(hall) {
    if (!lobbyReturn || !lobbyReturn.entered || window.Standalone.hasLiveRoom() || !hall.node.activeInHierarchy) return;
    lobbyReturn = null;
    openLobby(hall);
  }
  // 一场打完接着打（第三轮 R5）：最后一局的小结算停 4 秒自动翻到大结算；大结算「再来一局」当「继续」，
  // 下面写倒计时，到点没点算离开；豆子不够门槛时按钮变灰、写「豆子不够，回大厅」。「返回大厅」放掉座位回大厅桌列表。
  // 继续 = 原版清桌后按房号重新进房（服务端保留的座位不变）；座位留多久以服务端为准（GET /api/lobby/hold）。
  function patchFinalSettle(settle) {
    var look = settle.views && settle.views.lookBtn;
    if (!look || !look.active) return;
    clearTimeout(settle._standaloneLookTimer);
    settle._standaloneLookTimer = setTimeout(function () {
      if (cc.isValid(settle.node) && settle.node.activeInHierarchy && look.active) settle.onClickLook();
    }, 4000);
  }
  function patchBigResult(view) {
    var again = view.views && view.views.gy_btn_zlyj, leave = view.views && view.views.common_btn_blue;
    if (!again || !leave || view._standaloneHoldBody === view.body) return;
    view._standaloneHoldBody = view.body;
    view._standaloneLeaving = false;
    clearInterval(view._standaloneHoldTimer);
    view._standaloneHold = null;
    if (!view._standaloneHoldHooked) {
      view._standaloneHoldHooked = true;
      again.off('click'); leave.off('click');
      cc.mm.uitools.addBtnLister(again, function () { continueMatch(view); }, view);
      cc.mm.uitools.addBtnLister(leave, function () { leaveMatch(view); }, view);
      view._standaloneHoldNote = lobbyLabel(view.node, '', 0, 0, 20, rgb('#ffffff'), 0.5, true);
      var outline = view._standaloneHoldNote.node.addComponent(cc.LabelOutline); outline.color = cc.color(20, 30, 60, 160); outline.width = 2;
    }
    var note = view._standaloneHoldNote, button = again.getComponent(cc.Button);
    // 按钮贴着屏幕底边，倒计时写在按钮上方和「共 N 局」条之间的空隙里。
    var at = view.node.convertToNodeSpaceAR(again.convertToWorldSpaceAR(cc.v2(0, again.height * (1 - again.anchorY) + 6)));
    note.node.setPosition(at.x, at.y);
    note.string = '';
    again.active = false;
    apiRequest('GET', '/api/lobby/hold').then(function (data) {
      if (!cc.isValid(view.node) || view._standaloneHoldBody !== view.body) return;
      var hold = data.hold;
      view._standaloneHold = hold;
      if (!hold) return;
      again.active = true;
      if (button) button.interactable = hold.enough;
      var sprite = again.getComponent(cc.Sprite);
      if (sprite) sprite.setMaterial(0, cc.Material.getBuiltinMaterial(hold.enough ? '2d-sprite' : '2d-gray-sprite'));
      var deadline = Date.now() + hold.seconds * 1000;
      function tick() {
        if (!cc.isValid(view.node)) return clearInterval(view._standaloneHoldTimer);
        var left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        note.string = hold.enough ? left + ' 秒内不点算离开' : '豆子不够，回大厅（' + left + '）';
        if (left <= 0) leaveMatch(view);
      }
      tick();
      view._standaloneHoldTimer = setInterval(tick, 250);
    }, function () {});
  }
  function continueMatch(view) {
    var hold = view._standaloneHold;
    if (!hold || !hold.enough) return;
    clearInterval(view._standaloneHoldTimer);
    view._standaloneHold = null;
    view._ntfGameAgain();
    lobbyReturn = { code: String(hold.code), entered: false };
    cc.mm.hallserver.requestJoinRoom(String(hold.code));
  }
  function leaveMatch(view) {
    if (view._standaloneLeaving) return;
    view._standaloneLeaving = true;
    clearInterval(view._standaloneHoldTimer);
    var hold = view._standaloneHold;
    view._standaloneHold = null;
    // 先放掉座位再回首页，不然原版会按「还在房里」把人拉回牌桌；回到首页后由 returnToLobby 打开大厅桌列表。
    function exit() {
      view._standaloneLeaving = false;
      if (!cc.isValid(view.node)) return;
      lobbyReturn = { code: hold ? String(hold.code) : '', entered: true };
      view.onClickExitBtn();
    }
    if (!hold) return exit();
    apiRequest('POST', '/api/lobby/hold/release').then(exit, exit);
  }
  // 快速开始（R4）：服务端挑好桌并入座，返回房号；再走原版输房号进房，和点桌子是同一条路。
  function lobbyQuickStart(controller) {
    var lobby = controller._standaloneLobby || {};
    if (lobby.starting) return;
    lobby.starting = true;
    apiRequest('POST', '/api/lobby/quick-start', lobby.variant ? { variant: lobby.variant } : {}).then(function (result) {
      lobby.starting = false;
      lobby.joiningAt = 0;
      lobbyJoin(lobby, result.code);
    }, function (error) { lobby.starting = false; toast(error.message); });
  }
  // 大厅首页的「好友约局」卡改成打开大厅；开房、输房号在大厅底部。
  function patchHallLobbyEntry(controller) {
    installLobby();
    Object.keys(controller.views).forEach(function (name) {
      if (!/^games\/game_type_\d+\/haoyou$/.test(name)) return;
      var node = controller.views[name];
      if (node._standaloneLobbyEntry) return;
      node._standaloneLobbyEntry = true;
      node.off('click');
      cc.mm.uitools.addBtnLister(node, function () { openLobby(controller); }, controller);
    });
  }
  // 这张卡是骨骼动画，「好友约局」画在贴图里。换成照原卡重画的「进入大厅」图（tools/extra-art.mjs），
  // 图从服务器取，取不到就保留原卡。图的中心比骨骼原点高 2。
  var ENTER_LOBBY_CARD = '/client/extra/hall/enter-lobby.png';
  function patchEnterLobbyCard(controller) {
    Object.keys(controller.views).forEach(function (name) {
      if (!/^games\/game_type_\d+\/haoyou$/.test(name)) return;
      var node = controller.views[name];
      if (node._standaloneEnterCard) return;
      node._standaloneEnterCard = true;
      cc.assetManager.loadRemote(apiOrigin + ENTER_LOBBY_CARD, { ext: '.png' }, function (error, texture) {
        if (error || !cc.isValid(node)) return;
        var skeleton = node.getComponent(sp.Skeleton);
        if (skeleton) skeleton.enabled = false;
        var card = new cc.Node('standaloneEnterLobby');
        card.addComponent(cc.Sprite).spriteFrame = new cc.SpriteFrame(texture);
        card.setPosition(0, 2);
        node.addChild(card);
      });
    });
  }
  // 第二轮 S7：互动表情 13–20（点赞、鼓掌、烟花、比心、666、敬茶、催一下、慢慢来），
  // 图是 tools/extra-art.mjs 画的，从服务器取；动画用 cc.tween 写，不走原版 prefab/com_prop_。
  var EXTRA_EMOTE_FIRST = 13, EXTRA_EMOTE_LAST = 20, EXTRA_EMOTE_DIR = '/client/extra/emotes/';
  var extraEmoteFrames = {};
  function extraEmoteFrame(id, done) {
    if (extraEmoteFrames[id]) return done(extraEmoteFrames[id]);
    cc.assetManager.loadRemote(apiOrigin + EXTRA_EMOTE_DIR + id + '.png', { ext: '.png' }, function (error, texture) {
      if (error || !texture) return;
      extraEmoteFrames[id] = extraEmoteFrames[id] || new cc.SpriteFrame(texture);
      done(extraEmoteFrames[id]);
    });
  }
  // 牌桌上点别人头像的资料窗：原 11 个按钮 btn_1–btn_11（编号 = 尾号 + 1，即 2–12）后面接 8 个，
  // 横向滚动照原版。原版 addEvent 在 onLoad 里已经跑完，新按钮自己挂点击，仍走原版 onClickItemBtn。
  function patchInteractionPanel(info) {
    patchPlayerInfoStats(info);
    var content = info.views && info.views['root/items/view/content'];
    var sample = content && content.getChildByName('btn_11');
    if (!sample || info._standaloneExtraEmotes) return;
    info._standaloneExtraEmotes = true;
    for (var id = EXTRA_EMOTE_FIRST; id <= EXTRA_EMOTE_LAST; id++) (function (id) {
      var item = cc.instantiate(sample);
      item.name = 'btn_' + (id - 1);
      content.addChild(item);
      var icon = item.getChildByName('btn_0'), sprite = icon.getComponent(cc.Sprite);
      sprite.spriteFrame = null;
      extraEmoteFrame(id, function (frame) {
        if (!cc.isValid(icon)) return;
        sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
        icon.setContentSize(76, 76);
      });
      cc.mm.uitools.addBtnLister(item, info.onClickItemBtn.bind(info), info);
    })(id);
    var layout = content.getComponent(cc.Layout);
    if (layout) layout.updateLayout();
  }
  // 牌桌上点头像的信息窗：成就墙（勋章第三轮已下线，原来压着「暂未开启」）、右上空圆圈和三行小字去掉，
  // 换成和个人中心一样的三张战绩卡放在头像下面；窗口从 600 高缩到 540，上半往下收 30、表情往上收 30（样式稿第二版）。
  function patchPlayerInfoStats(info) {
    var views = info.views, root = views && views.root;
    if (!root) return;
    if (!info._standaloneStats) {
      hide(views, ['root/doushisi-gerenzhongxin-pic-xunzhang-di', 'root/doushisi-geren-icon-dashi', 'root/doushisi-gerenzhongxin-pic-chendi2', 'root/buttom']);
      ['res_dating_hall_head', 'headcase', 'namelabel', 'userid', 'useridlabel', 'sexLabel', 'label', 'douzishu'].forEach(function (name) {
        if (views['root/' + name]) views['root/' + name].y -= 30;
      });
      ['doushisi-gerenzhongxin-pic-biaoqing', 'doushisi-gerenzhongxin-pic-mianfei'].forEach(function (name) {
        if (views['root/' + name]) views['root/' + name].y += 30;
      });
      // 关闭键贴顶、表情条贴底都由 Widget 跟着窗口高度走；表情条上沿跟着少 60，高度保持 120。
      var items = views['root/items'] && views['root/items'].getComponent(cc.Widget);
      if (items) items.top -= 60;
      root.height = 540;
      info._standaloneStats = statTiles(root, 0, 0, 870, 140, 24, 50, 24);
    }
    var target = info.target || {};
    fillStatTiles(info._standaloneStats, { rounds: target.gameNum, wins: target.winNum, winRate: target.winRate });
  }
  // 超时由服务端代打，不进托管。原版只在托管时把「服务端替我出的牌」从手里拿掉、收起出牌，
  // 不托管时那张牌留在手里还能拖，等下一手只能吃/过时一拖就被服务端拒（11-01 本机试玩）。
  // 这里照托管的路子补上；并且只有这一手的选项里有出牌，手牌才能拖出去。
  // 报叫：服务端要「报叫并打出哪张」，原版点「报」只发个空的报叫。改成点「报」后把不能报叫的牌锁住，
  // 再出的那张按报叫发（选项里的 deathCard 就是不能报叫的牌）。
  var ACTION_CHUPAI = 3, ACTION_KOU = 18, ACTION_BAO_TING = 12;
  var handPlayedCard = null, declareChoice = null, declaring = false;
  function selfAtTable() {
    var table = cc.mm.uimanager.getWindow('dss_game');
    return table && table.model && typeof table.model.getSelf === 'function' ? { table: table, self: table.model.getSelf() } : null;
  }
  // 原版头像收到「我的豆子变了」时，别人的头像也走 else 分支把我的豆子写到自己身上，四家都显示我的豆子（11-01 测试台）。
  // 只让本人的头像更新；原版进桌时已按引用注册过，已有的头像重新注册一次。
  var USER_DATA_CHANGE = 'HWNotifyUserDataChange';
  function ownBeansOnly(table) {
    var Player = cc.js.getClassByName('dss_playerController');
    if (!Player) return;
    var original = Player.prototype._standaloneUserDataChange || Player.prototype._noticeUserDataChange;
    if (!Player.prototype._standaloneUserDataChange) {
      Player.prototype._standaloneUserDataChange = original;
      Player.prototype._noticeUserDataChange = function (data) {
        if (this._model && data && data.uid == this._model.uid) return original.apply(this, arguments);
      };
    }
    var type = cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent[USER_DATA_CHANGE];
    table.node.getComponentsInChildren('dss_playerController').forEach(function (head) {
      if (head._standaloneOwnBeans) return;
      head._standaloneOwnBeans = true;
      cc.mm.notification.off(type, original, head);
      cc.mm.notification.off(type, head._noticeUserDataChange, head);
      cc.mm.notification.on(type, head._noticeUserDataChange, head);
    });
  }
  // 四川斗十四的房间规则写全（DEC-20261101-房间规则写全）：原版按开房选项拼，现在的番型（金二十、暗四对、全红…）大多不是开房选项，
  // 列不出来，报叫还写成 1 番（11-01 测试台）。这里换成固定的完整规则，付费方式（AA/房主）和底分照原版拼出来的取。
  var AREA_XINJIN = 4;
  var XINJIN_FAN_TEXT = '天胡、地胡、报叫、金二十、暗四对、全红、全黑、红五十、黑五十、金钩钓各3番，龙对每个再加3番；鬼每张1番，碰、偷每组1番，杠、巴每组2番';
  function xinjinRule(text, room) {
    var pay = /^场次规则: (房主、|AA、)/.exec(text), base = /、([^、]+分)$/.exec(text);
    // 房费每局由大赢家付（DEC-20261112-大赢家付房费），不再写 AA / 房主。
    return '场次规则: 大赢家付房费、' + (Number(room.wangNum) || 3) + '个王、红20' + /* 几人桌都红 20 起胡（DEC-20261112-都红20起胡） */
      '起胡、' + xinjinFanWords(room) + '、点炮包赔、自摸自吃' + (base ? '、' + base[1] : '') + '；' + XINJIN_FAN_TEXT;
  }
  // 翻法、封顶每张桌自己选（DEC-20261108-翻法封顶每桌选）：chengFan 1 跟斗翻 / 0 梯坎翻，maxFan 99 不封顶 / 3、4、5 番封顶。
  function xinjinFanWords(room) {
    var cap = Number(room && room.maxFan);
    return (room && Number(room.chengFan) === 0 ? '梯坎翻' : '跟斗翻') + '、' + ([3, 4, 5].indexOf(cap) >= 0 ? cap + '番封顶' : '不封顶');
  }
  function xinjinRuleText() {
    ['CommonPlayUIController', 'dss_gameController'].forEach(function (name) {
      var Controller = cc.js.getClassByName(name);
      if (!Controller || Controller.prototype._standaloneXinjinRule || typeof Controller.prototype.getRule !== 'function') return;
      Controller.prototype._standaloneXinjinRule = true;
      var getRule = Controller.prototype.getRule;
      Controller.prototype.getRule = function () {
        var text = getRule.apply(this, arguments), room = cc.mm.hallserver && cc.mm.hallserver.mLastRoomParam;
        return room && Number(room.areaType) === AREA_XINJIN && typeof text === 'string' ? xinjinRule(text, room) : text;
      };
    });
    // 房间信息弹框原来只够两行（22 号字、居中在人数下面），写全要四行：字改 16 号，从人数下面往下排，到弹框底不出框。
    var PlayUI = cc.js.getClassByName('CommonPlayUIController');
    if (!PlayUI || PlayUI.prototype._standaloneXinjinRuleLayout || typeof PlayUI.prototype.showPlay !== 'function') return;
    PlayUI.prototype._standaloneXinjinRuleLayout = true;
    var showPlay = PlayUI.prototype.showPlay;
    PlayUI.prototype.showPlay = function () {
      var result = showPlay.apply(this, arguments), room = cc.mm.hallserver && cc.mm.hallserver.mLastRoomParam;
      var node = this.views && this.views['view/ruleLabel'], label = node && node.getComponent(cc.Label);
      if (label && room && Number(room.areaType) === AREA_XINJIN) {
        if (!node._standaloneRuleLayout) node._standaloneRuleLayout = { y: node.y, anchorY: node.anchorY, fontSize: label.fontSize, lineHeight: label.lineHeight };
        label.fontSize = 16; label.lineHeight = 20; node.anchorY = 1; node.y = -55;
      } else if (node && node._standaloneRuleLayout) {
        var old = node._standaloneRuleLayout;
        label.fontSize = old.fontSize; label.lineHeight = old.lineHeight; node.anchorY = old.anchorY; node.y = old.y;
      }
      return result;
    };
  }
  // 只留一个玩法，叫「四川斗十四」（DEC-20261101-四川斗十四）。原版桌上房间信息、大结算、小结算、分享文字按地区拼名字（新津、彭山、眉山…），这里统一换掉。
  var EDITION_NAME = '四川斗十四';
  function sichuanName() {
    ['CommonPlayUIController', 'CommonBigResultController', 'dss_gameController', 'dss_settle_UIController'].forEach(function (name) {
      var Controller = cc.js.getClassByName(name);
      if (!Controller || Controller.prototype._standaloneSichuanName || typeof Controller.prototype.getNameStr !== 'function') return;
      Controller.prototype._standaloneSichuanName = true;
      var getNameStr = Controller.prototype.getNameStr;
      Controller.prototype.getNameStr = function () {
        var text = getNameStr.apply(this, arguments), room = cc.mm.hallserver && cc.mm.hallserver.mLastRoomParam;
        return room && Number(room.areaType) === AREA_XINJIN ? EDITION_NAME : text;
      };
    });
    // 牌桌中间的游戏名水印：原版按地区异步换图（新津桌是「成都斗十四」）。原图组件关掉，上面盖一张「四川斗十四」
    // （tools/sichuan-title.mjs 用原版字拼的），原版异步换图落在关掉的组件上也看不到；图取不到就保留原版。
    var Game = cc.js.getClassByName('dss_gameController');
    if (!Game || Game.prototype._standaloneSichuanTitle || typeof Game.prototype.loadgetName !== 'function') return;
    Game.prototype._standaloneSichuanTitle = true;
    var loadgetName = Game.prototype.loadgetName;
    Game.prototype.loadgetName = function () {
      var result = loadgetName.apply(this, arguments), node = this.views && this.views.game_name_sprite;
      if (!node || !cc.isValid(node)) return result;
      var sichuan = Number(this.model && this.model.areaType) === AREA_XINJIN, overlay = node.getChildByName('standaloneSichuanTitle');
      if (!sichuan) {
        if (overlay) overlay.destroy();
        node.getComponent(cc.Sprite).enabled = true;
        return result;
      }
      if (overlay) return result;
      cc.assetManager.loadRemote(apiOrigin + SICHUAN_TITLE, { ext: '.png' }, function (error, texture) {
        if (error || !cc.isValid(node) || node.getChildByName('standaloneSichuanTitle')) return;
        node.getComponent(cc.Sprite).enabled = false;
        var title = new cc.Node('standaloneSichuanTitle');
        title.addComponent(cc.Sprite).spriteFrame = new cc.SpriteFrame(texture);
        node.addChild(title);
      });
      return result;
    };
  }
  var SICHUAN_TITLE = '/client/extra/table/sichuan-title.png';
  // 胡牌特效（DEC-20261101-胡牌特效补齐）：原版按地区挑特效，新津桌（四川斗十四）红五十、黑五十、金钩钓、报叫、龙对都不播。
  // 红五十、黑五十用原版自带的；金钩钓、报叫、龙对原版没有，借原版一段动画（金二十、天胡、大胡），把动画里那块字
  // 指到 tools/hu-effects.mjs 出的字图上（字图当图集的新一页）。字图没取到就不播，不影响别的特效。
  var HU_EFFECTS = { 26: 'hongwushi', 27: 'heiwushi', 28: 'jingoudiao', 11: 'baojiao', 110: 'longdui' };
  // 金二十那块字是贴着字形的网格，换了字会被裁掉，复制时换成同位置的整块矩形（网格 x = 388u − 186.39，y = 61.86 − 139v，中心 7.61, −7.64）。
  var HU_EFFECT_ART = { jingoudiao: { base: 'jinershi', region: 'zi', quad: { x: 7.61, y: -7.64, width: 388, height: 139 } },
    baojiao: { base: 'tianhu', region: 'zi' }, longdui: { base: 'dahu', region: 'wenzi' } };
  var huEffectTextures = {};
  function huEffects() {
    Object.keys(HU_EFFECT_ART).forEach(function (name) {
      if (huEffectTextures[name] !== undefined) return;
      huEffectTextures[name] = null;
      cc.assetManager.loadRemote(apiOrigin + '/client/extra/effects/' + name + '.png', { ext: '.png' }, function (error, texture) {
        if (error) huEffectTextures[name] = undefined; else huEffectTextures[name] = texture;
      });
    });
    var Player = cc.js.getClassByName('dss_playerController');
    if (!Player || Player.prototype._standaloneHuEffects || typeof Player.prototype.addHuEffect !== 'function') return;
    Player.prototype._standaloneHuEffects = true;
    var addHuEffect = Player.prototype.addHuEffect;
    Player.prototype.addHuEffect = function (cardType, list, areaType) {
      var result = addHuEffect.apply(this, arguments), name = HU_EFFECTS[cardType];
      if (Number(areaType) !== AREA_XINJIN || !name || result.indexOf(name) >= 0 || !huEffectData(name)) return result;
      result.push(name);
      return result;
    };
  }
  function huEffectData(name) {
    var resmap = cc.mm.dss && cc.mm.dss.resmap, art = HU_EFFECT_ART[name];
    if (!resmap || resmap.has(name) || !art) return resmap && resmap.has(name);
    var base = resmap.get(art.base), texture = huEffectTextures[name];
    if (!base || !texture) return false;
    // 图集里去掉原来那块字，加一页只有这块字的：大小、留边（orig、offset）照原样。
    var lines = String(base.atlasText).split(/\r?\n/), kept = [], orig = null, offset = null, skipping = false;
    lines.forEach(function (line) {
      if (skipping && /^\s+\S/.test(line)) {
        var field = line.trim().split(': ');
        if (field[0] === 'orig') orig = field[1];
        if (field[0] === 'offset') offset = field[1];
        return;
      }
      skipping = line === art.region;
      if (!skipping) kept.push(line);
    });
    if (!orig || !offset) return false;
    var page = name + '.png', w = texture.width, h = texture.height, data = new sp.SkeletonData();
    data._uuid = 'standalone-hu-effect-' + name;
    data.name = name;
    var json = base.skeletonJson;
    if (art.quad) {
      json = JSON.parse(JSON.stringify(json));
      var skins = Array.isArray(json.skins) ? json.skins : Object.keys(json.skins || {}).map(function (key) { return { attachments: json.skins[key] }; });
      skins.forEach(function (skin) {
        Object.keys(skin.attachments || {}).forEach(function (slot) {
          var attachment = skin.attachments[slot][art.region];
          if (attachment && attachment.type === 'mesh') skin.attachments[slot][art.region] = { x: art.quad.x, y: art.quad.y, width: art.quad.width, height: art.quad.height };
        });
      });
    }
    data.skeletonJson = json;
    data.atlasText = kept.join('\n').replace(/\s+$/, '') + '\n\n' + page + '\nsize: ' + w + ',' + h + '\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n' +
      art.region + '\n  rotate: false\n  xy: 0, 0\n  size: ' + w + ', ' + h + '\n  orig: ' + orig + '\n  offset: ' + offset + '\n  index: -1\n';
    data.textures = base.textures.concat([texture]);
    data.textureNames = base.textureNames.concat([page]);
    resmap.set(name, data);
    return true;
  }
  function followServerPlays() {
    var Select = cc.js.getClassByName('dss_selectController');
    if (!Select || Select.prototype._standaloneServerPlays) return;
    Select.prototype._standaloneServerPlays = true;
    var sendCard = Select.prototype.sendCard;
    Select.prototype.sendCard = function (card) {
      if (!this._isKoupai) handPlayedCard = card.value;
      if (!declaring || this._isKoupai) return sendCard.apply(this, arguments);
      declaring = false;
      var server = cc.mm.server, own = Object.prototype.hasOwnProperty.call(server, 'send'), send = server.send;
      server.send = function (message) {
        if (message && message.hwRequestDoAction) message.hwRequestDoAction.actType = ACTION_BAO_TING;
        return send.apply(this, arguments);
      };
      try { return sendCard.apply(this, arguments); } finally { if (own) server.send = send; else delete server.send; }
    };
    var Game = cc.js.getClassByName('dss_gameController');
    var onClickOperator = Game.prototype.onClickOperator;
    Game.prototype.onClickOperator = function (event) {
      if (!event || !event.node || event.node.groupIndex !== ACTION_BAO_TING || !declareChoice) return onClickOperator.apply(this, arguments);
      var select = this.node.getComponentInChildren('dss_selectController');
      if (!select || !select._model) return;
      declaring = true;
      select._model.deathCard = (declareChoice.deathCard || []).slice();
      select.changeUnlockState();
      this.views['ntfOperate/actionBtn_bao'].active = false;
    };
    // 多种碰、偷、杠挑中一组后，原版把这组单独再走一遍，丢了 isColAllCard，阿坝、分数区又会让人从手里另挑。
    var dealSelect = Game.prototype._dealSelectLogic;
    Game.prototype._dealSelectLogic = function (actType, choice) {
      var offered = this.operatorList && this.operatorList[actType];
      if (choice && offered && offered.isColAllCard) choice.isColAllCard = true;
      return dealSelect.apply(this, arguments);
    };
    var notice = cc.mm.frametype.MSG_NOTICE_CMD;
    cc.mm.notification.on(notice + cc.mm.msgEvent.HWNotifySeatOperationChoice, function (body) {
      if (cc.mm.gameserver.isReplay() || !body || !body.choices || !body.choices.length) return;
      declaring = false;
      var canPlay = body.choices.some(function (choice) { return choice.actType === ACTION_CHUPAI || choice.actType === ACTION_KOU; });
      // 起手报叫（发完牌一起弹「报」「过」）不带出牌：点「报」照原版直接发报叫，不锁牌。
      declareChoice = canPlay ? body.choices.filter(function (choice) { return choice.actType === ACTION_BAO_TING; })[0] || null : null;
      if (canPlay) handPlayedCard = null;
      else cc.mm.notification.emit('NOTICE_STATE_PLAY');
    });
    cc.mm.notification.on(notice + cc.mm.msgEvent.HWNotifyActionFlow, function (body) {
      var action = body && body.action, at = selfAtTable();
      if (!action || action.actType !== ACTION_CHUPAI || !at || !at.self || action.seatIndex !== at.self.seatIndex) return;
      if (handPlayedCard === action.destCard) { handPlayedCard = null; return; }
      if (at.self.auto || cc.mm.gameserver.isReplay()) return;
      at.self.deathCard = [];
      cc.mm.notification.emit('NOTICE_STATE_PLAY');
      cc.mm.notification.emit(cc.mm.frametype.NTF_PLAY_BACK_OUT_CARD, action.destCard);
      var tip = at.table.views && at.table.views['doushisi-dapai-tishi-shoujia-di'];
      if (tip) tip.active = false;
    });
  }
  // 收到 13–20：从发的人头像飞到对方头像，放大、抖两下、停一会儿淡出。12 以内照原版。
  function patchTableEmotes(table) {
    if (table._standaloneExtraEmotes || typeof table._moveEffect !== 'function') return;
    table._standaloneExtraEmotes = true;
    var original = table._moveEffect;
    table._moveEffect = function (from, to, id) {
      if (id >= EXTRA_EMOTE_FIRST && id <= EXTRA_EMOTE_LAST) return playExtraEmote(this, from, to, id);
      return original.apply(this, arguments);
    };
  }
  function playExtraEmote(table, from, to, id) {
    var start = table.views['palyers/pos' + from], end = table.views['palyers/pos' + to];
    if (!start || !end) return;
    extraEmoteFrame(id, function (frame) {
      if (!cc.isValid(table.node, true) || !cc.isValid(start) || !cc.isValid(end)) return;
      var node = new cc.Node('standaloneEmote' + id), sprite = node.addComponent(cc.Sprite);
      sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = frame;
      node.setContentSize(120, 120);
      // 自己的头像贴着屏幕下沿，放大后会被裁掉：落点离屏幕边至少留出放大后的半个图。
      var screen = cc.Canvas.instance.node, margin = 82;
      var place = function (seat, clamp) {
        var world = seat.parent.convertToWorldSpaceAR(seat.getPosition());
        if (clamp) world = cc.v2(Math.max(margin, Math.min(screen.width - margin, world.x)), Math.max(margin, Math.min(screen.height - margin, world.y)));
        return table.node.convertToNodeSpaceAR(world);
      };
      node.setPosition(place(start, false));
      node.scale = 0.55;
      table.node.addChild(node);
      var target = place(end, true);
      cc.tween(node)
        .to(0.5, { x: target.x, y: target.y, scale: 0.85 }, { easing: 'quadOut' })
        .to(0.16, { scale: 1.3 }, { easing: 'backOut' })
        .to(0.06, { angle: 12 }).to(0.1, { angle: -12 }).to(0.1, { angle: 10 }).to(0.1, { angle: -8 }).to(0.06, { angle: 0 })
        .delay(0.6)
        .to(0.3, { opacity: 0, scale: 1.5 })
        .call(function () { node.destroy(); })
        .start();
    });
  }
  // 「更多」小窗按旧的底部按钮排法摆在固定位置；商城、邮件藏掉后「更多」挪到了最右边，
  // 所以每次弹出前把小窗的箭头对准「更多」。最右边的分隔线后面已经没有按钮，也藏掉。
  var HALL_MENU_ARROW = 17; // 箭头尖离小窗右边的距离，按设计分辨率量
  function patchHallMenu(controller) {
    var menu = controller.views.menunode, more = controller.views['hallDownBtns/btns/hallmensbtn'];
    if (!menu || !more || more._standaloneMenuAlign) return;
    more._standaloneMenuAlign = true;
    hide(controller.views, ['menunode/hall_btn_statement/baoshan-hall-pic-more-di-fenge']);
    more.off('click');
    cc.mm.uitools.addBtnLister(more, function () {
      var widget = menu.getComponent(cc.Widget), box = more.getBoundingBoxToWorld();
      if (widget) widget.enabled = false;
      var right = menu.parent.convertToNodeSpaceAR(cc.v2(box.x + box.width / 2 + HALL_MENU_ARROW, 0)).x;
      menu.x = right - (1 - menu.anchorX) * menu.width * menu.scaleX;
      controller.onClickMenuBtn();
    }, controller);
  }
  // 开房和大厅左上角的「切换地区」按钮藏掉。
  function patchCreateRoomWindow(controller) {
    hide(controller.views, ['hall_room_center/games/qiehuan']);
  }

  var disabledWindows = new Set(['HallShopUI', 'HallIAPUI', 'CommonSelectPayUI', 'HallWeekCardUI', 'HallMonthUI', 'HallActivityUI', 'DoubleHolidayUI', 'HallTipUI', 'H5DownloadUI', 'BigUpdateUI', 'ForceUpdateUI', 'EventRecallResultUI', 'EventRecallUI', 'HallLiQuanUI', 'HallMatchUI', 'FirstPayUI', 'JoinFriendFail', 'SupplementUI', 'HallFriendUI', 'FriendListUI', 'CreateRoomUI', 'RecallFriend', 'HallAuthentication', 'HallMapUI']);
  window.Standalone = {
    supportsArea: function (id) {
      var area = areaNumber(id);
      return area !== null && !!retainedAreaTypes[area] && !!clientReadyAreaTypes[area] && !!visibleAreaTypes[area];
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
      var extension = { version: 2, decimalFields: [], capabilities: ['decision-window-v1', edition.qionglaiVersion, 'extra-emotes-v1'] };
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
      Object.keys(app.gameconfig).forEach(function (key) {
        (app.gameconfig[key] || []).forEach(function (variant) { variant.rule = withoutLocationOption(variant.rule); });
      });
      // 战绩、玩法说明、开房按这个名字显示。
      (app.gameconfig[AREA_XINJIN] || []).forEach(function (variant) { variant.name = EDITION_NAME; });
      sichuanName();
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
        if (cc.sys.isNative && hasNativeApi()) return jsb.reflection.callStaticMethod('net/doushisi/standalone/StandaloneLocation', 'requestPermission', '()V');
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
      afterLoadUI('CommonPlayerInfoController', patchInteractionPanel);
      afterLoadUI('CommonBigResultController', patchBigResult);
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
      // 原版邀请键（复制分享文字）藏起来；好友、邀请第三轮已下线。
      patchTableEmotes(controller);
      followServerPlays();
      ownBeansOnly(controller);
      xinjinRuleText();
      sichuanName();
      huEffects();
      // 原版 onLoad 就把「报」绑在当时的 onClickOperator 上，早于上面改原型：每页第一张桌点「报」走的是原版，被服务端拒。重新绑一次。
      var baoButton = controller.views['ntfOperate/actionBtn_bao'];
      if (baoButton && !controller._standaloneBaoButton) {
        controller._standaloneBaoButton = true;
        baoButton.off('click');
        cc.mm.uitools.addBtnLister(baoButton, controller.onClickOperator.bind(controller), controller);
      }
      afterLoadUI('dss_settle_UIController', patchFinalSettle);
      // 牌桌不显示距离（R11 AC1）：原版进房时会重新打开定位按钮，透明度清零免得闪一下。
      var locationButton = controller.views.locationbtn;
      if (locationButton) { locationButton.opacity = 0; locationButton.active = false; }
      useBeansAtTable(controller);
      if (!(window.StandaloneReplay && StandaloneReplay.active())) noteLobbyTable();
      if (!controller._standaloneCurrencyNormalized) { normalizeCurrencyLabels(controller.node); controller._standaloneCurrencyNormalized = true; }
      if (window.StandaloneReplay && StandaloneReplay.active()) hide(controller.views, ['readyBtn', 'tg_bg', 'ntfOperate', 'sureTip', 'select', 'gy_btn_chat', 'menunode/gy_btn_tuoguan']);
    },
    // 好友第三轮下线：好友窗口不再打开（disabledWindows），原版好友列表的两个钩子留空。
    friends: function () {},
    renderFriends: function () {},
    hall: function (controller) {
      checkProfile();
      patchHallLobbyEntry(controller);
      returnToLobby(controller);
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
        if (match && !visibleAreaTypes[match[1]]) controller.views[name].active = false;
      });
      hide(controller.views, ['games/game_2', 'games/game_other']);
      // 地区固定新津，首页不再有「切换」入口；第三轮去掉好友（R1），底栏「好友」键一起藏掉。
      hide(controller.views, ['hallDownBtns/btns/hall_mail_btn', 'hallDownBtns/btns/hall-button-haoyou', 'common_marquee', 'common_location']);
      var gameGroups = Object.keys(controller.views).filter(function (name) { return /^games\/game_type_\d+$/.test(name); });
      if (controller.views.games && controller.views.games.active && !gameGroups.some(function (name) { return controller.views[name].active; })) {
        var preferred = gameGroups.filter(function (name) { return visibleAreaTypes[name.split('_').pop()]; })[0];
        if (preferred) controller.views[preferred].active = true;
      }
      patchHallMenu(controller);
      patchEnterLobbyCard(controller);
      var create = cc.mm.uimanager.getWindow('CreateRoomUI');
      if (create) {
        hide(create.views, ['hall_room_center/left/createroom/dou-hall-pic-mianfei', 'hall_room_center/left/createroom/ad']);
        patchCreateRoomWindow(create);
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
