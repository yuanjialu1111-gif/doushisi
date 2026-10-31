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
  // 开房面板：「开启GPS定位」换成「公开到大厅」，放在原来的位置，汶川听用等按位置插入的行不错位（R3、R11）。
  var PUBLIC_LOBBY_TIP = '公开后大厅里的人能直接入座，房费固定AA';
  function withPublicLobbyOption(rule) {
    var result = {}, placed = false;
    var lobby = { name: '大厅:', multiple: 1, maxCell: 3, config: [{ name: '公开到大厅', value: 'publicLobby', default: 0, wenhao: PUBLIC_LOBBY_TIP }] };
    Object.keys(rule || {}).forEach(function (key) {
      if (key === 'config_location') { result.config_lobby = lobby; placed = true; } else result[key] = rule[key];
    });
    if (!placed) result.config_lobby = lobby;
    return result;
  }
  // 勾了公开就把房费切到 AA；公开时再点「房主」也切回 AA，并提示原因。
  function installPublicLobbyToggle() {
    var Controller = cc.js.getClassByName('CreateRoomUIController');
    if (!Controller || Controller.prototype._standalonePublicLobby) return;
    Controller.prototype._standalonePublicLobby = true;
    afterLoadUI('CreateRoomUIController', patchCreateRoomWindow);
    var onClickToggle = Controller.prototype.onClickToggle;
    Controller.prototype.onClickToggle = function (toggle, key) {
      var result = onClickToggle.apply(this, arguments);
      var rules = this._rules || {}, aa = (this.toggles && this.toggles.useCardType || []).filter(function (item) { return item.node.groupIndex === 2; })[0];
      if (rules.publicLobby && aa && (key === 'publicLobby' || key === 'useCardType' && rules.useCardType !== 2)) {
        if (rules.useCardType !== 2) onClickToggle.call(this, aa.node, 'useCardType');
        promptRoom(PUBLIC_LOBBY_TIP);
      }
      return result;
    };
    // 房内不再定位（R11）：上次存下的开房选项里可能还有 openGps，原版会因此在网页上先要定位、还把经度读错（R10 AC4）。
    var onClickCreateRoom = Controller.prototype.onClickCreateRoom;
    Controller.prototype.onClickCreateRoom = function () {
      if (this._rules) delete this._rules.openGps;
      return onClickCreateRoom.apply(this, arguments);
    };
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
      'bg/doushisi-geren-icon-dashi', 'bg/doushisi-gerenzhongxin-pic-touxiangkuang', 'bg/scrollview/view', 'bg/scrollview/doushisi-gerenzhongxin-pic-jiantou']);
    var frames = person.views['bg/scrollview'] && person.views['bg/scrollview'].getComponent(cc.ScrollView);
    if (frames) frames.enabled = false;
    withProfileKit(function (kit) {
      if (!cc.isValid(person.node)) return;
      kitButton(kit, person.views.bg, '换头像', -407, -139, function () { openProfilePanel('avatar'); });
      kitButton(kit, person.views.bg, '改昵称', -407, -232, changeNickname);
    });
  }

  // 第二轮 S6：真实战绩和勋章。头像框一栏换成原版「成就墙」，6 个勋章按条件点亮，没亮的变灰带进度；
  // 等级圆圈里摆最高的一枚已点亮勋章。勋章图是原版 resources 里的贴图（没有路径，按 uuid 取）。
  var MEDAL_ART = {
    qiantu: '913f86ab-c3df-4604-b249-b3e1a082684d', baisheng: '2c38674a-95b5-4989-9f9b-7a8a4f226c52',
    qiansheng: '0591f2bb-405b-4dfa-b934-830eff1f5556', fujia: '67d02c81-a993-4246-ba54-cfac3304edda',
    baiwan: '5c7d2f14-5094-4d73-8d7e-c41f2125cfb0', qianwan: '2e550078-18db-4bdf-8e4f-b8900b72e659',
    wall: '41897e62-0be0-4fcf-9cde-7e9679566657'
  };
  var medalFrames = {};
  function medalSprite(parent, key, x, y, scale, gray) {
    var node = new cc.Node('medal-' + key), sprite = node.addComponent(cc.Sprite);
    node.setPosition(x, y); node.scale = scale; parent.addChild(node);
    if (gray) sprite.setMaterial(0, cc.Material.getBuiltinMaterial('2d-gray-sprite'));
    function apply(frame) { if (cc.isValid(node)) sprite.spriteFrame = frame; }
    if (medalFrames[key]) apply(medalFrames[key]);
    else cc.assetManager.loadAny({ uuid: MEDAL_ART[key], bundle: 'resources' }, function (error, frame) {
      if (error) return;
      medalFrames[key] = frame; apply(frame);
    });
    return node;
  }
  function lockBadge(parent, x, y) {
    var pen = lobbyPen(parent, 'lock', x, y);
    pen.fillColor = rgb('#6a7890'); pen.circle(0, 0, 14); pen.fill();
    pen.lineWidth = 3; pen.strokeColor = rgb('#dce9f8'); pen.circle(0, 0, 14); pen.stroke();
    fillRound(pen, -6, -7, 12, 9, 2, cc.Color.WHITE);
    pen.lineWidth = 2.5; pen.strokeColor = cc.Color.WHITE; pen.arc(0, 2, 4, 0, Math.PI, true); pen.stroke();
  }
  function medalColumn(parent, medal, x) {
    medalSprite(parent, medal.key, x, 36, 0.6, !medal.lit);
    if (!medal.lit) lockBadge(parent, x + 30, 10);
    lobbyLabel(parent, medal.name, x, -16, 20, rgb('#3a5a8a'), 0.5, true);
    if (medal.lit) return lobbyLabel(parent, '已点亮', x, -46, 17, rgb('#25a55a'), 0.5, true);
    var pen = lobbyPen(parent, 'progress', x, -40), ratio = Math.max(0, Math.min(1, medal.value / medal.need));
    fillRound(pen, -50, -5, 100, 10, 5, rgb('#c3d4ea'));
    if (ratio > 0) fillRound(pen, -50, -5, Math.max(10, 100 * ratio), 10, 5, rgb('#ff8a1e'));
    lobbyLabel(parent, medal.hint, x, -60, 15, rgb('#6a86ad'), 0.5);
  }
  function paintMedals(person, view) {
    var bg = person.views.bg;
    ['standalone-medal-wall', 'standalone-medal-head', 'standalone-medal-best'].forEach(function (name) {
      var old = bg.getChildByName(name) || (person.views['bg/scrollview'] && person.views['bg/scrollview'].getChildByName(name));
      if (old) old.destroy();
    });
    var head = new cc.Node('standalone-medal-head'); head.setPosition(-149, 60); bg.addChild(head);
    medalSprite(head, 'wall', 0, 0, 1, false);
    lobbyLabel(head, '已点亮 ' + view.lit + ' / ' + view.medals.length, 20, -2, 18, rgb('#6a86ad'), 0, true);
    var row = new cc.Node('standalone-medal-wall');
    (person.views['bg/scrollview'] || bg).addChild(row);
    view.medals.forEach(function (medal, index) { medalColumn(row, medal, -312 + index * 125); });
    var best = null;
    view.medals.forEach(function (medal) { if (medal.lit) best = medal; });
    var showcase = new cc.Node('standalone-medal-best'); showcase.setPosition(-84, 193); bg.addChild(showcase);
    medalSprite(showcase, best ? best.key : 'qiantu', 0, 14, 1.05, !best);
    var tag = lobbyPen(showcase, 'tag', 0, -62), text = lobbyLabel(tag.node, best ? best.name : '还没有勋章', 0, 0, 18, cc.Color.WHITE, 0.5, true);
    var half = labelWidth(text) / 2 + 13;
    fillRound(tag, -half, -13, half * 2, 26, 13, best ? rgb('#e8434a') : rgb('#8a98b0'));
  }
  function refreshPersonStats(person) {
    if (person._standaloneStatsBusy) return;
    person._standaloneStatsBusy = true;
    apiRequest('GET', '/api/me/profile-stats').then(function (view) {
      person._standaloneStatsBusy = false;
      if (!cc.isValid(person.node) || !person.views) return;
      var model = cc.mm.framemodel;
      model.gameNum = view.rounds; model.winNum = view.wins; model.winRate = view.winRate;
      [['bg/buttom/countlabel', view.rounds], ['bg/buttom/winlabel', view.wins], ['bg/buttom/gailvlabel', view.winRate]].forEach(function (entry) {
        if (person.views[entry[0]]) person.views[entry[0]].getComponent(cc.Label).string = String(entry[1]);
      });
      paintMedals(person, view);
    }, function () { person._standaloneStatsBusy = false; });
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
  var LOBBY_CARD_HEIGHT = 248, LOBBY_GAP_X = 22, LOBBY_GAP_Y = 16, LOBBY_SEAT = 66;
  function lobbyLabel(parent, text, x, y, size, color, anchorX, bold) {
    var label = kitLabel(parent, text, x, y, size, color, anchorX);
    label.enableBold = !!bold;
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
  function lobbyPill(parent, text, left, top, size, background, color, anchorX, icon) {
    var pen = lobbyPen(parent, 'standalonePill');
    var label = lobbyLabel(pen.node, text, 0, 0, size, color, 0, true);
    var height = size + 8, padding = size * 0.7, iconWidth = icon ? size : 0;
    var width = labelWidth(label) + padding * 2 + iconWidth;
    var x = anchorX === 1 ? left - width : left;
    pen.node.setPosition(x, top - height / 2);
    fillRound(pen, 0, -height / 2, width, height, height / 2, background);
    label.node.x = padding + iconWidth;
    if (icon) icon(pen, padding + size * 0.4, 0, size, color);
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
    return text.length > 3 ? text.substring(0, 3) + '…' : text;
  }
  function openLobby(hall) {
    hall.hideView();
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
    var quick = controller.views['left/quick_start'];
    quick.active = true;
    controller.views['left/quick_start/label'].getComponent(cc.Label).string = '快速开始';
    quick.off('click');
    cc.mm.uitools.addBtnLister(quick, function () { lobbyQuickStart(controller); }, controller);
    lobby.tab = 'all';
    // 桌卡区挂在整个窗口上，按窗口宽度排版（layoutLobby），不再跟着原版右侧区域缩放。
    lobby.box = new cc.Node('standaloneLobbyBox'); controller.node.addChild(lobby.box);
    lobby.tabs = [['all', '全部'], ['nearby', '附近']].map(function (entry) {
      var pen = lobbyPen(lobby.box, 'standaloneLobbyTab');
      pen.node.setContentSize(122, 52);
      pen.node.addComponent(cc.Button).transition = cc.Button.Transition.SCALE;
      var label = lobbyLabel(pen.node, entry[1], 0, 0, 25, rgb('#ffffff'), 0.5, true);
      cc.mm.uitools.addBtnLister(pen.node, function () { lobby.tab = entry[0]; closeLobbyPlayer(lobby); renderLobby(controller); }, controller);
      return { key: entry[0], node: pen.node, pen: pen, label: label };
    });
    lobby.count = lobbyLabel(lobby.box, '', 0, 0, 24, rgb('#ffffff'), 1, true);
    var countOutline = lobby.count.node.addComponent(cc.LabelOutline); countOutline.color = cc.color(20, 30, 60, 120); countOutline.width = 2;
    var scrollNode = new cc.Node('standaloneLobbyTables'); lobby.box.addChild(scrollNode);
    var view = new cc.Node('view'); view.addComponent(cc.Mask); scrollNode.addChild(view);
    var content = new cc.Node('content'); content.anchorY = 1; view.addChild(content);
    var scroll = scrollNode.addComponent(cc.ScrollView);
    scroll.content = content; scroll.horizontal = false; scroll.vertical = true; scroll.inertia = true; scroll.elastic = true; scroll.brake = 0.75;
    lobby.scroll = scrollNode; lobby.view = view; lobby.content = content; lobby.cards = {};
    // 空状态放在深色玻璃底板上，雪景背景上也看得清。
    var emptyPen = lobbyPen(lobby.box, 'standaloneLobbyEmpty', 0, 40);
    fillRound(emptyPen, -320, -60, 640, 120, 24, cc.color(20, 30, 60, 150));
    strokeRound(emptyPen, -320, -60, 640, 120, 24, cc.color(255, 255, 255, 107), 1.5);
    lobby.empty = lobbyLabel(emptyPen.node, '', 0, 0, 26, rgb('#ffffff'), 0.5, true);
    // 底部三个按钮搬进桌卡区，压在桌卡上面，跟着窗口宽度居中。
    lobby.bottom = ['left/quick_start', 'left/joinbtn', 'left/createroom'].map(function (name) { return controller.views[name]; }).filter(Boolean);
    lobby.bottom.forEach(function (node) { node.parent = lobby.box; });
    layoutLobby(controller);
    poll();
  }
  // 按窗口宽度排：一屏两排，每排能放下几张宽 290 以上的桌卡就放几张（16:9 四张，16:10、4:3 三张）。
  // 返回 true 表示列数或卡宽变了，要重画桌卡。
  function layoutLobby(controller) {
    var lobby = controller._standaloneLobby, width = controller.node.width, half = width / 2;
    if (!lobby || !lobby.box) return false;
    var buttons = controller._gameBtns || [], single = buttons.length < 2;
    if (controller.views.games) controller.views.games.active = !single;
    var left = single ? -half + 40 : -half + 290, right = half - 40, areaWidth = right - left;
    var columns = Math.max(2, Math.min(5, Math.floor((areaWidth + LOBBY_GAP_X) / (290 + LOBBY_GAP_X))));
    var cardWidth = Math.floor((areaWidth - LOBBY_GAP_X * (columns - 1)) / columns);
    var center = (left + right) / 2, top = 375 - 108, bottom = -375 + 130;
    // 大厅顶栏的豆子框离右边约 340、宽约 160；4:3 这类窄屏把两个标签缩窄并贴近返回键，不压到它。
    var tabWidth = Math.max(96, Math.min(122, Math.floor((width - 500 - 268 - 24) / 2))), tabLeft = tabWidth < 122 ? -half + 268 : -half + 290;
    lobby.tabs.forEach(function (tab, index) {
      tab.width = tabWidth; tab.node.setContentSize(tabWidth, 52);
      tab.node.setPosition(tabLeft + tabWidth / 2 + index * (tabWidth + 12), 326);
    });
    lobby.count.node.setPosition(right, 326);
    lobby.scroll.setContentSize(areaWidth, top - bottom); lobby.scroll.setPosition(center, (top + bottom) / 2);
    lobby.view.setContentSize(areaWidth, top - bottom);
    lobby.content.width = areaWidth; lobby.content.y = (top - bottom) / 2;
    lobby.empty.node.parent.x = center;
    // 按钮原图宽 339、245、245，间隔 34；放不下时一起缩小。
    var widths = [339, 245, 245], total = 339 + 245 + 245 + 34 * 2, scale = Math.min(1, (areaWidth - 20) / total), x = center - total * scale / 2;
    lobby.bottom.forEach(function (node, index) {
      node.scale = scale;
      node.setPosition(x + widths[index] * scale / 2, -295);
      x += (widths[index] + 34) * scale;
    });
    var changed = lobby.columns !== columns || lobby.cardWidth !== cardWidth;
    lobby.columns = columns; lobby.cardWidth = cardWidth; lobby.areaWidth = areaWidth;
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
    var pen = tab.pen, width = tab.width || 122, half = width / 2;
    pen.clear();
    if (on) {
      fillRound(pen, -half, -30, width, 52, 14, rgb('#c97a10'));
      fillRound(pen, -half, -26, width, 52, 14, rgb('#ffb21f'));
      fillRound(pen, -half + 4, -2, width - 8, 24, 11, rgb('#ffe25a', 0.75));
      strokeRound(pen, -half, -26, width, 52, 14, rgb('#fff3b0'), 2);
    } else {
      fillRound(pen, -half, -26, width, 52, 14, cc.color(40, 70, 140, 140));
      strokeRound(pen, -half, -26, width, 52, 14, cc.color(255, 255, 255, 90), 2);
    }
    tab.label.node.color = on ? rgb('#8a3b00') : rgb('#ffffff');
  }
  function renderLobby(controller) {
    var lobby = controller._standaloneLobby, data = lobby.data || { tables: [], variants: [], hasLocation: false };
    layoutLobby(controller);
    if (!data.hasLocation && lobby.tab === 'nearby') lobby.tab = 'all';
    lobby.tabs.forEach(function (tab) {
      tab.node.active = tab.key === 'all' || data.hasLocation;
      drawLobbyTab(tab, tab.key === lobby.tab);
    });
    var tables = data.tables.slice();
    if (lobby.tab === 'nearby') tables = tables.filter(function (table) { return table.nearby; }).sort(function (a, b) { return a.nearby.rank - b.nearby.rank; });
    lobby.count.string = lobby.data ? '共 ' + tables.length + ' 桌' : '';
    lobby.empty.string = lobby.failed ? '大厅加载失败，稍后会自动重试' : !lobby.data ? '正在加载…'
      : tables.length ? '' : lobby.tab === 'nearby' ? '附近暂时没有人在玩，去「全部」看看'
      // 有大厅桌模板才能快速开一桌；没有就引导去创建房间约朋友。
      : data.variants.some(function (item) { return !lobby.variant || item.key === lobby.variant; }) ? '这个玩法暂时没有公开桌，点「快速开始」开一桌'
      : '这个玩法还没有大厅桌，点「创建房间」约朋友来玩';
    lobby.empty.node.parent.active = !!lobby.empty.string;
    var next = {}, columns = lobby.columns, cardWidth = lobby.cardWidth;
    tables.forEach(function (table, index) {
      var signature = JSON.stringify([table, cardWidth]), card = lobby.cards[table.code];
      if (!card || !cc.isValid(card) || card._standaloneSignature !== signature) {
        if (card && cc.isValid(card)) card.destroy();
        card = lobbyCard(controller, table, cardWidth);
        card._standaloneSignature = signature;
        lobby.content.addChild(card);
      }
      card.setPosition(-lobby.areaWidth / 2 + cardWidth / 2 + index % columns * (cardWidth + LOBBY_GAP_X),
        -LOBBY_CARD_HEIGHT / 2 - Math.floor(index / columns) * (LOBBY_CARD_HEIGHT + LOBBY_GAP_Y));
      next[table.code] = card;
    });
    Object.keys(lobby.cards).forEach(function (code) { if (!next[code] && cc.isValid(lobby.cards[code])) lobby.cards[code].destroy(); });
    lobby.cards = next;
    var rows = Math.ceil(tables.length / columns);
    lobby.content.height = Math.max(lobby.view.height, rows * LOBBY_CARD_HEIGHT + Math.max(0, rows - 1) * LOBBY_GAP_Y);
  }
  // 进行中的桌子绿桌压灰（饱和度 0.35、亮度 0.88），和效果图一致。
  function feltColor(hex, playing) {
    var color = rgb(hex);
    if (!playing) return color;
    var grey = 0.3 * color.r + 0.59 * color.g + 0.11 * color.b;
    var mix = function (value) { return Math.round(((value - grey) * 0.35 + grey) * 0.88); };
    return cc.color(mix(color.r), mix(color.g), mix(color.b));
  }
  // 俯视绿桌：木框 8、金色内线，中间亮四周暗（Graphics 没有渐变，用几层圆角叠出来）。
  function lobbyFelt(card, table, width, height, playing) {
    var pen = lobbyPen(card, 'standaloneFelt'), x = -width / 2, y = -height / 2;
    fillRound(pen, x + 2, y - 7, width - 4, height, 30, cc.color(40, 20, 0, 75));
    fillRound(pen, x, y, width, height, 30, feltColor('#a3672c', playing));
    var dark = rgb('#1a6347'), light = rgb('#43b184'), steps = 14;
    for (var index = 0; index < steps; index++) {
      var t = index / (steps - 1), inset = 8 + index * 2.6, lift = index * 0.7;
      var hex = '#' + [dark.r + (light.r - dark.r) * t, dark.g + (light.g - dark.g) * t, dark.b + (light.b - dark.b) * t]
        .map(function (value) { return ('0' + Math.round(value).toString(16)).slice(-2); }).join('');
      fillRound(pen, x + inset, y + inset + lift, width - inset * 2, height - inset * 2, Math.max(8, 22 - index * 1.1), feltColor(hex, playing));
    }
    strokeRound(pen, x + 9, y + 9, width - 18, height - 18, 21, feltColor('#e6b866', playing), 2);
    var base = new cc.Node('base'), rich = base.addComponent(cc.RichText);
    rich.fontSize = 34; rich.lineHeight = 40; rich.horizontalAlign = cc.macro.TextAlignment.CENTER;
    rich.string = '<b><color=#ffffff><size=16>底分 </size>' + table.baseBeans + '</color></b>';
    base.setPosition(0, 12); pen.node.addChild(base);
    lobbyLabel(pen.node, table.rounds + ' 局 · 门槛 ' + table.threshold + ' 豆', 0, -22, 14, playing ? cc.color(214, 224, 218) : rgb('#d9f5e8'), 0.5, true);
  }
  // 座位按顺时针从上方排：4 人上右下左，3 人上右左，2 人上下。
  function lobbySeatSpots(count, width) {
    var side = width / 2 - 10 - LOBBY_SEAT / 2, vertical = LOBBY_CARD_HEIGHT / 2 - 6 - LOBBY_SEAT / 2;
    var top = [0, vertical], right = [side, 0], bottom = [0, -vertical], left = [-side, 0];
    return count >= 4 ? [top, right, bottom, left] : count === 3 ? [top, right, left] : [top, bottom];
  }
  function lobbySeat(controller, card, player, x, y) {
    var size = LOBBY_SEAT, half = size / 2;
    if (!player) {
      var empty = lobbyPen(card, 'standaloneEmptySeat', x, y);
      fillRound(empty, -half, -half, size, size, 12, cc.color(20, 40, 60, 110));
      fillRound(empty, -half, -half, size, size, 12, cc.color(255, 255, 255, 40));
      dashedRound(empty, -half, -half, size, size, 12, cc.color(255, 255, 255, 230), 2.5);
      lobbyLabel(empty.node, '+', 0, 9, 26, rgb('#ffffff'), 0.5);
      lobbyLabel(empty.node, '空位', 0, -15, 12, rgb('#ffffff'), 0.5, true);
      return;
    }
    var seat = new cc.Node('standaloneLobbySeat');
    seat.setContentSize(size, size); seat.setPosition(x, y); card.addChild(seat);
    var shadow = lobbyPen(seat, 'shadow', 0, -3);
    fillRound(shadow, -half - 1, -half - 1, size + 2, size + 2, 13, cc.color(0, 0, 0, 80));
    var clip = roundAvatar(seat, 0, 0, size, 12, player.avatarUrl);
    var strip = lobbyPen(clip, 'nameStrip');
    strip.fillColor = cc.color(0, 0, 0, 140); strip.rect(-half, -half, size, 21); strip.fill();
    lobbyLabel(clip, seatName(player.nickname), 0, -half + 10.5, 13, rgb('#ffffff'), 0.5, true);
    var ring = lobbyPen(seat, 'ring');
    strokeRound(ring, -half, -half, size, size, 12, rgb('#ffffff'), 2.5);
    // 头像自己是按钮：点头像看信息卡，不会当成点桌子入座。
    var button = seat.addComponent(cc.Button); button.transition = cc.Button.Transition.SCALE; button.zoomScale = 0.94;
    cc.mm.uitools.addBtnLister(seat, function () { openLobbyPlayer(controller, seat, player); }, controller);
  }
  function lobbyCard(controller, table, width) {
    var lobby = controller._standaloneLobby, playing = table.state === 'playing', height = LOBBY_CARD_HEIGHT;
    var card = new cc.Node('standaloneLobbyCard');
    card.setContentSize(width, height);
    var glass = lobbyPen(card, 'glass');
    fillRound(glass, -width / 2, -height / 2, width, height, 24, cc.color(255, 255, 255, 41));
    strokeRound(glass, -width / 2, -height / 2, width, height, 24, cc.color(255, 255, 255, 107), 1.5);
    lobbyFelt(card, table, width - 108, height - 116, playing);
    var bySeat = {};
    table.seats.forEach(function (seat) { bySeat[seat.seat] = seat; });
    lobbySeatSpots(table.playerCount, width).forEach(function (spot, index) { lobbySeat(controller, card, bySeat[index + 1], spot[0], spot[1]); });
    var missing = table.playerCount - table.seats.length;
    lobbyPill(card, playing ? '进行中 ' + table.currentRound + '/' + table.rounds : missing ? '缺 ' + missing + ' 人' : '已坐满',
      -width / 2 + 12, height / 2 - 12, 14, playing ? rgb('#e0702a') : missing ? rgb('#2e9b5f') : rgb('#4a6fa5'), rgb('#ffffff'), 0);
    // 有人的桌子都显示离我多远（S2-AC3），只给档位不给米数；我没开定位时服务端不给。
    if (table.nearby) lobbyPill(card, table.nearby.band, width / 2 - 12, height / 2 - 12, 14, cc.color(255, 255, 255, 242), rgb('#1f6fc4'), 1, pinIcon);
    var button = card.addComponent(cc.Button); button.transition = cc.Button.Transition.SCALE; button.zoomScale = 0.97;
    cc.mm.uitools.addBtnLister(card, function () {
      if (playing) return toast('这桌已经开局了，换一桌吧。');
      if (!missing) return toast('这桌已经坐满了，换一桌吧。');
      lobbyJoin(lobby, table.code);
    }, controller);
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
    if (sex) lobbyPill(panel.node, sex[0], textX + labelWidth(name) + 6, 18 + 10.5, 13, rgb(sex[1]), rgb('#ffffff'), 0);
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

  // 好友页（第二轮 S3）：原版「我的好友」窗口只留背景和返回键，上面搭 好友 / 申请 标签、我的 ID、找朋友。
  // 对外只用数字 ID，数据都走 /api/social/；窗口显示时每 5 秒刷新一次。
  var FRIEND_STATUS = { idle: ['在线 · 空闲', '#4be08a'], playing: ['游戏中', '#ffb547'], offline: ['离线', '#b8c2d6'] };
  var FRIEND_SOURCE = { search: '搜索添加', recent: '最近同桌', table: '同桌对局' };
  // 待确认 16：好友申请附言只能从这 4 句里选（服务端只收编号 0–3），也可以不带。
  var FRIEND_NOTES = ['一起打牌认识的', '想约你打牌', '牌友，加一下', '以后常一起玩'];
  var FRIEND_REQUEST_STATE = { pending: ['等对方同意', '#ffb547'], accepted: ['已同意 · 已成为好友', '#4be08a'], rejected: ['对方已拒绝', '#b8c2d6'], expired: ['已过期', '#b8c2d6'] };
  var FRIEND_CARD_HEIGHT = 92, FRIEND_ROW_HEIGHT = 78, FRIEND_GAP = 12;
  var FRIEND_BUTTONS = { yellow: ['#d98a00', '#ffc72c', '#ffe27a', '#7a3a00'], orange: ['#d9560b', '#ff8a1f', '#ffb15c', '#ffffff'],
    green: ['#1f9a4a', '#33c26a', '#6be096', '#ffffff'], blue: ['#1f6fd1', '#3d9bff', '#7cc0ff', '#ffffff'], grey: ['#b8bfcc', '#e8ebf1', '#f6f7fa', '#5b6475'] };
  function installFriends() { afterLoadUI('FriendListUIController', patchFriends); }
  function friendButton(parent, text, x, y, width, height, style, onClick, controller) {
    var colors = FRIEND_BUTTONS[style], pen = lobbyPen(parent, 'standaloneFriendButton', x, y), radius = Math.min(14, height / 2);
    pen.node.setContentSize(width, height);
    fillRound(pen, -width / 2, -height / 2 - 4, width, height, radius, rgb(colors[0]));
    fillRound(pen, -width / 2, -height / 2, width, height, radius, rgb(colors[1]));
    var shine = height / 2 - 3;
    fillRound(pen, -width / 2 + 4, 0, width - 8, shine, Math.min(radius - 3, shine / 2), rgb(colors[2], 0.55));
    var label = lobbyLabel(pen.node, text, 0, 0, Math.round(height * 0.42), rgb(colors[3]), 0.5, true);
    if (onClick) {
      var button = pen.node.addComponent(cc.Button); button.transition = cc.Button.Transition.SCALE; button.zoomScale = 0.94;
      cc.mm.uitools.addBtnLister(pen.node, onClick, controller);
    }
    return { node: pen.node, label: label };
  }
  function friendBadge(parent, x, y) {
    var pen = lobbyPen(parent, 'standaloneBadge', x, y), label = lobbyLabel(pen.node, '', 0, 0, 15, rgb('#ffffff'), 0.5, true);
    pen.node.active = false;
    return function (count) {
      pen.clear(); pen.node.active = count > 0;
      if (!count) return;
      label.string = count > 99 ? '99+' : String(count);
      var width = Math.max(24, labelWidth(label) + 12);
      fillRound(pen, -width / 2, -12, width, 24, 12, rgb('#ff3b30'));
      strokeRound(pen, -width / 2, -12, width, 24, 12, rgb('#ffffff'), 2);
    };
  }
  function twoDigits(value) { return value < 10 ? '0' + value : String(value); }
  function friendAgo(value) {
    var time = new Date(value).getTime();
    if (!time) return '';
    var minutes = Math.floor((Date.now() - time) / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return minutes + ' 分钟前';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' 小时前';
    var days = Math.floor(hours / 24);
    if (days === 1) return '昨天';
    if (days < 7) return days + ' 天前';
    var date = new Date(time);
    return twoDigits(date.getMonth() + 1) + '-' + twoDigits(date.getDate());
  }
  function copyText(text) {
    if (cc.sys.isNative && window.jsb && jsb.copyTextToClipboard) { jsb.copyTextToClipboard(text); toast('复制成功'); }
    else cc.mm.gameserver.setClipboard(text);
  }
  function friendRich(parent, text, x, y, size, anchorX) {
    var node = new cc.Node('standaloneRich'), rich = node.addComponent(cc.RichText);
    node.anchorX = anchorX === undefined ? 0 : anchorX; rich.fontSize = size; rich.lineHeight = size + 8;
    rich.string = text; node.setPosition(x, y); parent.addChild(node);
    return rich;
  }
  // 「我的 ID 100023 复制」：深色圆角条，点「复制」放进剪贴板。
  function friendIdPill(parent, controller) {
    var pen = lobbyPen(parent, 'standaloneMyId');
    var caption = lobbyLabel(pen.node, '我的 ID', 16, 0, 16, rgb('#c9d4ee'), 0, false);
    var number = lobbyLabel(pen.node, '', 0, 0, 18, rgb('#ffffff'), 0, true);
    var copy = lobbyPen(pen.node, 'copy');
    copy.node.setContentSize(54, 30);
    var copyLabel = lobbyLabel(copy.node, '复制', 0, 0, 15, rgb('#ffffff'), 0.5, true);
    var button = copy.node.addComponent(cc.Button); button.transition = cc.Button.Transition.SCALE; button.zoomScale = 0.92;
    var state = { uid: '', node: pen.node, width: 0 };
    cc.mm.uitools.addBtnLister(copy.node, function () { if (state.uid) copyText(state.uid); }, controller);
    state.set = function (uid) {
      if (state.uid === uid) return;
      state.uid = uid;
      number.string = uid;
      var captionWidth = labelWidth(caption), textWidth = captionWidth + 8 + labelWidth(number), width = 16 + textWidth + 10 + 54 + 8;
      number.node.x = 16 + captionWidth + 8;
      state.width = width;
      pen.clear();
      fillRound(pen, 0, -20, width, 40, 20, cc.color(14, 24, 60, 150));
      copy.clear(); fillRound(copy, -27, -14, 54, 28, 14, cc.color(255, 255, 255, 60));
      copy.node.setPosition(16 + textWidth + 10 + 27, 0);
      copyLabel.node.color = rgb('#ffffff');
    };
    return state;
  }
  function searchIcon(pen, x, y, color) {
    pen.lineWidth = 3.5; pen.strokeColor = color;
    pen.circle(x - 2, y + 2, 8); pen.stroke();
    pen.moveTo(x + 4, y - 4); pen.lineTo(x + 10, y - 10); pen.stroke();
  }
  function patchFriends(controller) {
    if (!controller.views || !controller.views.backBtn) return;
    var friends = controller._standaloneFriends || (controller._standaloneFriends = { tab: 'friends', items: {} });
    hide(controller.views, ['baoshan-pic-chendi', 'scrollview', 'item']);
    closeFriendSearch(friends);
    function poll() {
      clearInterval(friends.timer);
      friends.timer = setInterval(function () {
        if (!cc.isValid(controller.node)) return clearInterval(friends.timer);
        if (!controller.node.activeInHierarchy) return;
        if (layoutFriends(controller)) renderFriends(controller);
        friendsRefresh(controller);
        if (friends.tab === 'messages') chatRefresh(controller);
      }, 5000);
      friendsRefresh(controller);
    }
    installSocial();
    if (social.pulse) { friends.unread = social.pulse.unread; friends.unreadFrom = social.pulse.unreadFrom; social.pulsedAt = 0; }
    if (friends.box) { friends.tab = 'friends'; renderFriends(controller); poll(); return; }
    friends.box = new cc.Node('standaloneFriendsBox'); controller.node.addChild(friends.box);
    friends.tabs = [['friends', '好友'], ['requests', '申请'], ['messages', '消息']].map(function (entry) {
      var pen = lobbyPen(friends.box, 'standaloneFriendTab');
      pen.node.setContentSize(122, 52);
      pen.node.addComponent(cc.Button).transition = cc.Button.Transition.SCALE;
      var label = lobbyLabel(pen.node, entry[1], 0, 0, 25, rgb('#ffffff'), 0.5, true);
      var badge = friendBadge(pen.node, 52, 22);
      cc.mm.uitools.addBtnLister(pen.node, function () {
        friends.tab = entry[0]; renderFriends(controller);
        if (entry[0] === 'messages') chatRefresh(controller, true);
      }, controller);
      return { key: entry[0], node: pen.node, pen: pen, label: label, badge: badge };
    });
    friends.find = friendButton(friends.box, '', 0, 0, 176, 54, 'orange', function () { openFriendSearch(controller); }, controller);
    friends.find.label.string = '找朋友'; friends.find.label.node.x = 14;
    searchIcon(friends.find.node.getComponent(cc.Graphics), -48, 0, rgb('#ffffff'));
    friends.myId = friendIdPill(friends.box, controller);
    friends.summary = friendRich(friends.box, '', 0, 0, 20);
    var scrollNode = new cc.Node('standaloneFriendList'); friends.box.addChild(scrollNode);
    var view = new cc.Node('view'); view.addComponent(cc.Mask); scrollNode.addChild(view);
    var content = new cc.Node('content'); content.anchorY = 1; view.addChild(content);
    var scroll = scrollNode.addComponent(cc.ScrollView);
    scroll.content = content; scroll.horizontal = false; scroll.vertical = true; scroll.inertia = true; scroll.elastic = true; scroll.brake = 0.75;
    friends.scroll = scrollNode; friends.view = view; friends.content = content;
    var emptyPen = lobbyPen(friends.box, 'standaloneFriendEmpty', 0, 20);
    fillRound(emptyPen, -340, -60, 680, 120, 24, cc.color(20, 30, 60, 150));
    strokeRound(emptyPen, -340, -60, 680, 120, 24, cc.color(255, 255, 255, 107), 1.5);
    friends.empty = lobbyLabel(emptyPen.node, '', 0, 0, 24, rgb('#ffffff'), 0.5, true);
    layoutFriends(controller);
    renderFriends(controller);
    poll();
  }
  // 标签贴着返回键；右上「找朋友」。窄屏（4:3 这类）把「我的 ID」挪到第二行右边，免得和标签挤。
  function layoutFriends(controller) {
    var friends = controller._standaloneFriends, width = controller.node.width, half = width / 2;
    if (!friends || !friends.box) return false;
    var left = -half + 36, right = half - 36, areaWidth = right - left, narrow = width < 1150;
    var tabWidth = narrow ? 104 : 122, tabLeft = -half + 290;
    friends.tabs.forEach(function (tab, index) {
      tab.width = tabWidth; tab.node.setContentSize(tabWidth, 52);
      tab.node.setPosition(tabLeft + tabWidth / 2 + index * (tabWidth + 12), 330);
    });
    friends.find.node.setPosition(right - 88, 330);
    friends.myId.node.setPosition(narrow ? right - friends.myId.width : right - 176 - 18 - friends.myId.width, narrow ? 272 : 330);
    friends.myId.narrow = narrow;
    friends.summary.node.setPosition(left + 4, 272);
    var top = 375 - 130, bottom = -375 + 18;
    friends.scroll.setContentSize(areaWidth, top - bottom); friends.scroll.setPosition(0, (top + bottom) / 2);
    friends.view.setContentSize(areaWidth, top - bottom);
    friends.content.width = areaWidth; friends.content.y = (top - bottom) / 2;
    var changed = friends.areaWidth !== areaWidth;
    friends.areaWidth = areaWidth;
    return changed;
  }
  function friendsRefresh(controller, force) {
    var friends = controller._standaloneFriends;
    if (!friends || !friends.box || !cc.isValid(controller.node)) return;
    if (friends.loading) { friends.again = friends.again || force; return; }
    friends.loading = true;
    Promise.all([apiRequest('GET', '/api/social/friends'), apiRequest('GET', '/api/social/requests')]).then(function (results) {
      friends.loading = false;
      if (!cc.isValid(controller.node)) return;
      if (friends.again) { friends.again = false; return friendsRefresh(controller); }
      var signature = JSON.stringify(results);
      friends.failed = false;
      if (signature === friends.signature) return;
      friends.signature = signature; friends.data = results[0]; friends.requests = results[1];
      renderFriends(controller);
    }, function () {
      friends.loading = false;
      if (!cc.isValid(controller.node) || friends.data) return;
      friends.failed = true;
      renderFriends(controller);
    });
  }
  function renderFriends(controller) {
    var friends = controller._standaloneFriends, data = friends.data, requests = friends.requests || { incoming: [], outgoing: [] };
    if (!friends.box) return;
    layoutFriends(controller);
    friends.tabs.forEach(function (tab) {
      drawLobbyTab(tab, tab.key === friends.tab);
      tab.badge(tab.key === 'requests' ? requests.incoming.length : tab.key === 'messages' ? friends.unread || 0 : 0);
    });
    if (data) friends.myId.set(data.myUid);
    friends.myId.node.active = !!data;
    if (data) layoutFriends(controller);
    var list = data ? data.friends : [];
    if (friends.tab === 'friends') {
      var online = list.filter(function (friend) { return friend.status !== 'offline'; }).length;
      friends.summary.string = data ? '<outline color=#14203c width=2><b><color=#ffffff>好友 ' + list.length + ' / ' + data.limit + '</color><color=#c9d4ee> · </color><color=#4be08a>在线 ' + online + '</color></b></outline>' : '';
    } else if (friends.tab === 'requests') friends.summary.string = '<outline color=#14203c width=2><color=#dfe6f5><size=16>申请 7 天没人处理自动过期 · 被拒绝后 24 小时内不能再申请同一个人</size></color></outline>';
    else friends.summary.string = '<outline color=#14203c width=2><color=#dfe6f5><size=16>和好友聊天只能发常用语和表情 · 消息保留 30 天</size></color></outline>';
    friends.summary.node.active = !(friends.myId.narrow && friends.tab === 'requests');
    friends.empty.string = friends.failed ? '好友加载失败，稍后会自动重试' : !data ? '正在加载…'
      : friends.tab === 'friends' && !list.length ? '还没有好友，点右上角「找朋友」搜 ID 加好友' : '';
    var chatting = friends.tab === 'messages';
    friends.empty.node.parent.active = !chatting && !!friends.empty.string;
    friends.scroll.active = !chatting;
    if (friends.chat && cc.isValid(friends.chat.root)) friends.chat.root.active = chatting;
    if (chatting) renderChat(controller);
    var content = friends.content, width = friends.areaWidth, keep = {}, height = 0;
    function place(key, signature, build, x, y) {
      var item = friends.items[key];
      if (!item || item.signature !== signature || !cc.isValid(item.node)) {
        if (item && cc.isValid(item.node)) item.node.destroy();
        item = friends.items[key] = { signature: signature, node: build() };
        content.addChild(item.node);
      }
      item.node.setPosition(x, y);
      keep[key] = true;
    }
    if (data && friends.tab === 'friends') {
      var cardWidth = Math.floor((width - 22) / 2);
      list.forEach(function (friend, index) {
        var column = index % 2, row = Math.floor(index / 2);
        var unread = friends.unreadFrom && friends.unreadFrom[friend.uid] || 0;
        place('friend:' + friend.uid, JSON.stringify([friend, cardWidth, unread]), function () { return friendCard(controller, friend, cardWidth, unread); },
          -width / 2 + cardWidth / 2 + column * (cardWidth + 22), -row * (FRIEND_CARD_HEIGHT + FRIEND_GAP) - FRIEND_CARD_HEIGHT / 2);
      });
      height = Math.ceil(list.length / 2) * (FRIEND_CARD_HEIGHT + FRIEND_GAP);
    }
    if (data && friends.tab === 'requests') {
      var y = 0;
      place('head:in', JSON.stringify(['in', requests.incoming.length, width]), function () { return friendSection('收到的申请', requests.incoming.length, width); }, 0, y - 18);
      y -= 40;
      if (!requests.incoming.length) {
        place('none:in', 'none' + width, function () { return friendNote('暂时没有新的好友申请', width); }, 0, y - 22); y -= 48;
      }
      requests.incoming.forEach(function (request) {
        place('in:' + request.id, JSON.stringify([request, width]), function () { return friendRequestRow(controller, request, width, true); }, 0, y - FRIEND_ROW_HEIGHT / 2);
        y -= FRIEND_ROW_HEIGHT + 10;
      });
      y -= 8;
      place('head:out', JSON.stringify(['out', width]), function () { return friendSection('我发出的', 0, width); }, 0, y - 18);
      y -= 40;
      if (!requests.outgoing.length) {
        place('none:out', 'none' + width, function () { return friendNote('最近 7 天没有发出过申请', width); }, 0, y - 22); y -= 48;
      }
      requests.outgoing.forEach(function (request) {
        place('out:' + request.id, JSON.stringify([request, width]), function () { return friendRequestRow(controller, request, width, false); }, 0, y - FRIEND_ROW_HEIGHT / 2);
        y -= FRIEND_ROW_HEIGHT + 10;
      });
      height = -y;
    }
    Object.keys(friends.items).forEach(function (key) {
      if (keep[key]) return;
      if (cc.isValid(friends.items[key].node)) friends.items[key].node.destroy();
      delete friends.items[key];
    });
    content.height = Math.max(friends.view.height, height);
  }
  function friendSection(title, count, width) {
    var node = new cc.Node('standaloneFriendSection');
    var label = lobbyLabel(node, title, -width / 2 + 4, 0, 21, rgb('#ffffff'), 0, true);
    var outline = label.node.addComponent(cc.LabelOutline); outline.color = cc.color(20, 30, 60, 120); outline.width = 2;
    if (count) friendBadge(node, -width / 2 + 4 + labelWidth(label) + 20, 0)(count);
    return node;
  }
  function friendNote(text, width) {
    var node = new cc.Node('standaloneFriendNote');
    var pen = lobbyPen(node, 'glass');
    fillRound(pen, -width / 2, -20, width, 40, 14, cc.color(20, 30, 60, 90));
    lobbyLabel(node, text, 0, 0, 17, rgb('#c9d4ee'), 0.5, false);
    return node;
  }
  function friendGlass(node, width, height) {
    var glass = lobbyPen(node, 'glass');
    fillRound(glass, -width / 2, -height / 2, width, height, 18, cc.color(28, 44, 100, 150));
    strokeRound(glass, -width / 2, -height / 2, width, height, 18, cc.color(255, 255, 255, 80), 1.5);
  }
  // 头像 + 昵称 + 性别标签，返回昵称右侧的 x，方便接着放东西。
  function friendIdentity(node, user, x, size, nameY, nameSize) {
    roundAvatar(node, x + size / 2, 0, size, size * 0.19, user.avatarUrl);
    var ring = lobbyPen(node, 'ring', x + size / 2, 0);
    strokeRound(ring, -size / 2, -size / 2, size, size, size * 0.19, cc.color(255, 255, 255, 200), 2);
    var textX = x + size + 14;
    var name = lobbyLabel(node, shortName(user.nickname, 6), textX, nameY, nameSize, rgb('#ffffff'), 0, true);
    var sex = SEX_TAGS[user.sex];
    if (sex) lobbyPill(node, sex[0], textX + labelWidth(name) + 8, nameY + 10.5, 13, rgb(sex[1]), rgb('#ffffff'), 0);
    return { textX: textX, ring: ring };
  }
  function friendCard(controller, friend, width, unread) {
    var height = FRIEND_CARD_HEIGHT, card = new cc.Node('standaloneFriendCard');
    card.setContentSize(width, height);
    friendGlass(card, width, height);
    var who = friendIdentity(card, friend, -width / 2 + 14, 64, 22, 22), status = FRIEND_STATUS[friend.status] || FRIEND_STATUS.offline;
    who.ring.fillColor = rgb(status[1]); who.ring.circle(26, -26, 7); who.ring.fill();
    who.ring.lineWidth = 2; who.ring.strokeColor = rgb('#ffffff'); who.ring.circle(26, -26, 7); who.ring.stroke();
    lobbyLabel(card, 'ID ' + friend.uid + ' · ' + (FRIEND_SOURCE[friend.source] || FRIEND_SOURCE.search), who.textX, -4, 15, rgb('#c9d4ee'), 0, false);
    var text = friend.status === 'playing' && friend.round ? '游戏中 · 第 ' + friend.round.current + '/' + friend.round.total + ' 局' : status[0];
    lobbyLabel(card, text, who.textX, -27, 15, rgb(status[1]), 0, true);
    var talk = friendButton(card, '发消息', width / 2 - 16 - 56, 0, 112, 44, 'yellow', function () { openFriendChat(controller, friend.uid); }, controller);
    friendBadge(talk.node, 52, 20)(unread || 0);
    card._standaloneFriend = friend;
    return card;
  }
  function friendRequestRow(controller, request, width, incoming) {
    var height = FRIEND_ROW_HEIGHT, row = new cc.Node('standaloneFriendRequest');
    row.setContentSize(width, height);
    friendGlass(row, width, height);
    var note = incoming && FRIEND_NOTES[request.note];
    var who = friendIdentity(row, request.user, -width / 2 + 16, 52, note ? 22 : 14, 20);
    var how = incoming ? (request.source === 'recent' ? '最近同桌' : '通过 ID 搜到你') + ' · ' + friendAgo(request.createdAt) : friendAgo(request.createdAt) + ' 发出';
    lobbyLabel(row, 'ID ' + request.user.uid + ' · ' + how, who.textX, note ? -1 : -15, 15, rgb('#c9d4ee'), 0, false);
    if (note) lobbyLabel(row, '附言：' + note, who.textX, -23, 15, rgb('#ffd27a'), 0, false);
    if (incoming) {
      friendButton(row, '拒绝', width / 2 - 16 - 96 - 12 - 48, 2, 96, 44, 'grey', function () { friendDecide(controller, request, false); }, controller);
      friendButton(row, '同意', width / 2 - 16 - 48, 2, 96, 44, 'green', function () { friendDecide(controller, request, true); }, controller);
    } else {
      var state = FRIEND_REQUEST_STATE[request.status] || FRIEND_REQUEST_STATE.expired;
      var pill = lobbyPen(row, 'state'), label = lobbyLabel(pill.node, state[0], 0, 0, 16, rgb(state[1]), 0.5, true);
      var pillWidth = labelWidth(label) + 28;
      pill.node.setPosition(width / 2 - 20 - pillWidth / 2, 0);
      fillRound(pill, -pillWidth / 2, -17, pillWidth, 34, 17, cc.color(10, 20, 50, 110));
      strokeRound(pill, -pillWidth / 2, -17, pillWidth, 34, 17, rgb(state[1], 0.7), 1.5);
    }
    return row;
  }
  function friendDecide(controller, request, accept) {
    var friends = controller._standaloneFriends;
    if (friends.deciding) return;
    friends.deciding = true;
    apiRequest('POST', '/api/social/requests/' + request.id + '/decide', { accept: accept }).then(function (result) {
      friends.deciding = false;
      toast(result.status === 'accepted' ? '你们已经是好友了' : result.status === 'rejected' ? '已拒绝' : '这条申请已经过期了');
      friendsRefresh(controller, true);
    }, function (error) { friends.deciding = false; toast(error.message); friendsRefresh(controller, true); });
  }
  // 申请前先选一句附言（或不带），选完才发。
  function pickFriendNote(controller, done) {
    var host = controller.node, layer = new cc.Node('standaloneFriendNote');
    layer.setContentSize(host.width, host.height); host.addChild(layer);
    layer.addComponent(cc.BlockInputEvents);
    var dim = lobbyPen(layer, 'dim');
    dim.fillColor = cc.color(10, 20, 40, 120); dim.rect(-host.width / 2, -host.height / 2, host.width, host.height); dim.fill();
    var width = 420, height = 96 + FRIEND_NOTES.length * 62 + 72, half = height / 2;
    var panel = lobbyPen(layer, 'panel');
    panel.node.setContentSize(width, height);
    fillRound(panel, -width / 2, -half - 6, width, height, 22, cc.color(20, 30, 70, 90));
    fillRound(panel, -width / 2, -half, width, height, 22, rgb('#fff8ea'));
    strokeRound(panel, -width / 2, -half, width, height, 22, rgb('#f3d9a6'), 2);
    lobbyLabel(panel.node, '选一句附言', 0, half - 38, 26, rgb('#8a5a1a'), 0.5, true);
    function pick(note) { layer.destroy(); done(note); }
    FRIEND_NOTES.forEach(function (text, index) {
      friendButton(panel.node, text, 0, half - 96 - index * 62, 300, 50, 'yellow', function () { pick(index); }, controller);
    });
    friendButton(panel.node, '不带附言', -78, -half + 44, 140, 46, 'grey', function () { pick(null); }, controller);
    friendButton(panel.node, '取消', 78, -half + 44, 140, 46, 'grey', function () { layer.destroy(); }, controller);
    panel.node.scale = 0.92; panel.node.opacity = 0;
    cc.tween(panel.node).to(0.14, { scale: 1, opacity: 255 }).start();
  }
  function friendApply(controller, uid, source, done, incoming) {
    if (incoming) return sendFriendApply(controller, uid, source, null, done);
    pickFriendNote(controller, function (note) { sendFriendApply(controller, uid, source, note, done); });
  }
  function sendFriendApply(controller, uid, source, note, done) {
    apiRequest('POST', '/api/social/requests', { uid: String(uid), source: source, note: note }).then(function (result) {
      toast(result.autoAccepted ? '对方也申请过你，你们已经是好友了' : '申请已发出，等对方同意');
      friendsRefresh(controller, true);
      if (done) done(result);
    }, function (error) { toast(error.message); });
  }
  // 私聊与邀请（第二轮 S4）：消息只有常用语、表情、邀请卡三种，没有打字框（S4-AC1）。
  // 每 5 秒拉一次 /api/social/pulse，管大厅好友键红点和收邀请弹窗；牌局进行中不拉（S4-AC3）。
  var SOCIAL_PHRASES = ['不好意思我要离开一会儿', '不要吵了，不要吵了', '不要走决战到天亮', '大家好很高兴见到各位', '底牌亮出来绝对吓死你', '风水轮流转，底裤都输光了',
    '和你合作真是太愉快了', '快点啊，等的花儿都谢了', '你的牌打的也太好了', '我早就猜出你的牌了', '再见了，我会想念大家的', '怎么又断线，网络怎么差',
    '来一把？', '马上来', '等我一下', '今天不打了', '谢谢', '好的'];
  var SOCIAL_PHRASE_ORDER = [12, 13, 14, 15, 16, 17, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  var SOCIAL_FACES = 15;
  var LIGHT_STATUS = { idle: ['在线 · 空闲', '#25a55a'], playing: ['游戏中', '#e0702a'], offline: ['离线', '#9aa4b8'] };
  var INVITE_STATE = { pending: ['等对方回应', '#e0702a'], joined: ['已入座', '#25a55a'], rejected: ['已拒绝', '#9aa4b8'], expired: ['已过期', '#9aa4b8'], full: ['桌已满', '#e0702a'] };
  var CHAT_TOP = 245, CHAT_BOTTOM = -357, CHAT_HEADER = 72, CHAT_BAR = 120, CHAT_ROW = 86;
  var social = { offset: 0, shown: {}, invited: {}, table: null }, faceCache = {};
  function socialNow() { return Date.now() + social.offset; }
  function socialLeft(expiresAt) { return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - socialNow()) / 1000)); }
  function socialStatus(user, map) {
    var status = map[user.status] || map.offline;
    return user.status === 'playing' && user.round ? '游戏中 · 第 ' + user.round.current + '/' + user.round.total + ' 局' : status[0];
  }
  function myAvatar() { return profileView && profileView.avatarUrl || cc.mm.framemodel && cc.mm.framemodel.picUrl; }
  function liveRoomCode() {
    var room = cc.mm.gameserver && cc.mm.gameserver.room_data;
    return room && room.roomId ? String(room.roomId) : '';
  }
  function seatedCount(model) {
    var valid = typeof model.getValidPlayer === 'function' ? model.getValidPlayer() : null;
    return valid && valid.length !== undefined ? valid.length : Number(valid) || 0;
  }
  function tableController() {
    var table = social.table;
    if (!(table && cc.isValid(table.node)) && window.Standalone.hasLiveRoom()) {
      var scene = cc.director.getScene();
      table = social.table = scene && scene.getComponentInChildren('dss_gameController');
    }
    return table && cc.isValid(table.node) && table.node.activeInHierarchy ? table : null;
  }
  function installSocial() {
    if (!social.timer) social.timer = setInterval(socialTick, 1000);
  }
  function socialTick() {
    try { watchTableInvite(); tickInviteDrawer(); tickInvitePopup(); } catch (error) { console.error(error); }
    if (social.pulsing || Date.now() - (social.pulsedAt || 0) < 5000) return;
    if (!cc.mm || !cc.mm.framemodel || !cc.mm.framemodel.token) return;
    var table = tableController();
    if (table && table.model && table.model.isStart) return;
    social.pulsing = true; social.pulsedAt = Date.now();
    apiRequest('GET', '/api/social/pulse').then(function (data) {
      social.pulsing = false;
      if (data) applyPulse(data);
    }, function () { social.pulsing = false; });
  }
  function applyPulse(data) {
    social.offset = new Date(data.now).getTime() - Date.now() || 0;
    social.pulse = data;
    var hall = cc.mm.uimanager.getWindow('HallUI'), button = hall && hall.views && hall.views['hallDownBtns/btns/hall-button-haoyou'];
    if (button && cc.isValid(button)) {
      if (!button._standaloneBadge) button._standaloneBadge = friendBadge(button, 24, 30);
      button._standaloneBadge(data.requests + data.unread);
    }
    var list = cc.mm.uimanager.getWindow('FriendListUI');
    if (list && list._standaloneFriends && list._standaloneFriends.box && cc.isValid(list.node)) friendsPulse(list, data);
    data.invites.forEach(function (invite) {
      if (!invite.popup || social.shown[invite.id] || !canPopInvite()) return;
      social.shown[invite.id] = true;
      openInvitePopup(invite);
    });
  }
  function canPopInvite() {
    var hall = cc.mm.uimanager.getWindow('HallUI');
    return !!(hall && cc.isValid(hall.node) && hall.node.activeInHierarchy && !window.Standalone.hasLiveRoom() && !tableController()
      && !(social.popup && cc.isValid(social.popup.layer)));
  }
  function friendsPulse(controller, data) {
    var friends = controller._standaloneFriends, signature = JSON.stringify([data.unread, data.unreadFrom]);
    if (friends.unreadSignature === signature) return;
    friends.unreadSignature = signature; friends.unread = data.unread; friends.unreadFrom = data.unreadFrom;
    if (!controller.node.activeInHierarchy) return;
    renderFriends(controller);
    if (friends.tab === 'messages') chatRefresh(controller);
  }
  // 整屏的层：挂在场景上，盖住大厅或牌桌（和原版文字提示同一套做法）。
  function sceneLayer(name, zIndex) {
    var canvas = cc.Canvas.instance.node, layer = new cc.Node(name);
    layer.setContentSize(canvas.getContentSize()); layer.setPosition(canvas.position);
    cc.director.getScene().addChild(layer, zIndex);
    layer.addComponent(cc.BlockInputEvents);
    return layer;
  }
  function closeMark(parent, x, y, color, onClick) {
    var close = lobbyPen(parent, 'close', x, y);
    close.node.setContentSize(44, 44);
    close.fillColor = color; close.circle(0, 0, 18); close.fill();
    close.lineWidth = 3.5; close.strokeColor = rgb('#ffffff');
    close.moveTo(-7, -7); close.lineTo(7, 7); close.moveTo(-7, 7); close.lineTo(7, -7); close.stroke();
    var button = close.node.addComponent(cc.Button); button.transition = cc.Button.Transition.SCALE;
    cc.mm.uitools.addBtnLister(close.node, onClick);
    return close.node;
  }
  function faceNode(parent, ref, scale) {
    var node = new cc.Node('standaloneFace');
    node.setScale(scale); parent.addChild(node);
    var skeleton = node.addComponent(sp.Skeleton);
    function apply(data) {
      if (!cc.isValid(node)) return;
      skeleton.skeletonData = data; skeleton.setSkin('default'); skeleton.setAnimation(0, 'animation', true);
    }
    if (faceCache[ref]) apply(faceCache[ref]);
    else cc.loader.loadRes('faces/res_dss_chat_' + ref, sp.SkeletonData, function (error, data) {
      if (error || !data) return;
      faceCache[ref] = data; apply(data);
    });
    return node;
  }
  function verticalScroll(parent, width, height) {
    var node = new cc.Node('scroll'); node.setContentSize(width, height); parent.addChild(node);
    var view = new cc.Node('view'); view.setContentSize(width, height); view.addComponent(cc.Mask); node.addChild(view);
    var content = new cc.Node('content'); content.anchorY = 1; content.setContentSize(width, height); content.y = height / 2; view.addChild(content);
    var scroll = node.addComponent(cc.ScrollView);
    scroll.content = content; scroll.horizontal = false; scroll.vertical = true; scroll.inertia = true; scroll.elastic = true; scroll.brake = 0.75;
    return { node: node, view: view, content: content, scroll: scroll };
  }
  function horizontalScroll(parent, width, height) {
    var node = new cc.Node('scroll'); node.setContentSize(width, height); parent.addChild(node);
    var view = new cc.Node('view'); view.setContentSize(width, height); view.addComponent(cc.Mask); node.addChild(view);
    var content = new cc.Node('content'); content.anchorX = 0; content.setContentSize(width, height); content.x = -width / 2; view.addChild(content);
    var scroll = node.addComponent(cc.ScrollView);
    scroll.content = content; scroll.horizontal = true; scroll.vertical = false; scroll.inertia = true; scroll.elastic = true; scroll.brake = 0.75;
    return { node: node, view: view, content: content, scroll: scroll };
  }
  function statusDot(parent, x, y, color) {
    var dot = lobbyPen(parent, 'dot', x, y);
    dot.fillColor = rgb(color); dot.circle(0, 0, 7); dot.fill();
    dot.lineWidth = 2; dot.strokeColor = rgb('#ffffff'); dot.circle(0, 0, 7); dot.stroke();
  }
  function chatClock(time) {
    var date = new Date(time), now = new Date(socialNow());
    var clock = twoDigits(date.getHours()) + ':' + twoDigits(date.getMinutes());
    var day = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
    return { day: day, clock: clock, date: twoDigits(date.getMonth() + 1) + '-' + twoDigits(date.getDate()) };
  }
  function chatTime(value) { var t = chatClock(value); return t.day === 0 ? t.clock : t.day === 1 ? '昨天' : t.date; }
  function chatStamp(value) { var t = chatClock(value); return (t.day === 0 ? '今天' : t.day === 1 ? '昨天' : t.date) + ' ' + t.clock; }
  function chatPreview(message) {
    if (!message) return '还没聊过，打个招呼吧';
    if (message.kind === 'phrase') return SOCIAL_PHRASES[message.ref] || '[消息]';
    if (message.kind === 'face') return '[表情]';
    var room = message.invite && message.invite.room;
    return '[邀请] ' + (room ? room.name + ' 房号 ' + room.code : '');
  }

  // 收邀请弹窗（S4-AC3）：只在大厅、没在房间里时弹；「加入」先问服务端，再走原版输房号进房。
  function closeInvitePopup() {
    if (social.popup && cc.isValid(social.popup.layer)) social.popup.layer.destroy();
    social.popup = null;
  }
  function inviteRoomLines(room) {
    var seated = room.seated || 0, total = room.playerCount || 0;
    return [(room.name || '新津斗十四') + ' · 房号 ' + room.code,
      '底分 ' + room.baseBeans + ' · ' + room.rounds + ' 局' + (room.threshold ? ' · 门槛 ' + room.threshold + ' 豆' : ''),
      '已有 ' + seated + ' 人，还差 ' + Math.max(0, total - seated) + ' 人'];
  }
  function openInvitePopup(invite) {
    closeInvitePopup();
    var layer = sceneLayer('standaloneInvitePopup', 950), size = layer.getContentSize();
    var dim = lobbyPen(layer, 'dim');
    dim.fillColor = cc.color(10, 20, 40, 150); dim.rect(-size.width / 2, -size.height / 2, size.width, size.height); dim.fill();
    var width = 560, height = 500, half = height / 2;
    var panel = lobbyPen(layer, 'panel');
    panel.node.setContentSize(width, height);
    fillRound(panel, -width / 2, -half - 8, width, height, 24, cc.color(20, 30, 70, 90));
    fillRound(panel, -width / 2, -half, width, height, 24, rgb('#fffaf0'));
    fillRound(panel, -width / 2, half - 64, width, 64, 24, rgb('#2f9a6c'));
    panel.fillColor = rgb('#2f9a6c'); panel.rect(-width / 2, half - 64, width, 30); panel.fill();
    fillRound(panel, -width / 2 + 6, half - 30, width - 12, 24, 12, rgb('#5cc596', 0.5));
    var title = lobbyLabel(panel.node, '好友邀请', 0, half - 32, 28, rgb('#ffffff'), 0.5, true);
    var outline = title.node.addComponent(cc.LabelOutline); outline.color = rgb('#1f7653'); outline.width = 2;
    closeMark(panel.node, width / 2 - 38, half - 32, cc.color(10, 60, 40, 80), closeInvitePopup);
    var from = invite.from || {};
    var frame = lobbyPen(panel.node, 'frame', 0, 120);
    fillRound(frame, -48, -48, 96, 96, 20, rgb('#f0dfbd'));
    roundAvatar(panel.node, 0, 120, 92, 18, from.avatarUrl);
    var name = lobbyLabel(panel.node, shortName(from.nickname, 8), 0, 50, 24, rgb('#5a3200'), 0.5, true), sex = SEX_TAGS[from.sex];
    if (sex) { var nameWidth = labelWidth(name); name.node.x = -18; lobbyPill(panel.node, sex[0], -18 + nameWidth / 2 + 8, 50 + 10.5, 14, rgb(sex[1]), rgb('#ffffff'), 0); }
    lobbyLabel(panel.node, '邀请你一起打牌', 0, 18, 18, rgb('#8d7a62'), 0.5, false);
    var box = lobbyPen(panel.node, 'room', 0, -62), lines = inviteRoomLines(invite.room || {});
    fillRound(box, -240, -56, 480, 112, 18, rgb('#fff1d2'));
    strokeRound(box, -240, -56, 480, 112, 18, rgb('#f3d9a6'), 2);
    lobbyLabel(box.node, lines[0], 0, 30, 20, rgb('#5a3200'), 0.5, true);
    lobbyLabel(box.node, lines[1], 0, 0, 16, rgb('#8d7a62'), 0.5, false);
    lobbyLabel(box.node, lines[2], 0, -30, 16, rgb('#e0702a'), 0.5, true);
    var popup = social.popup = { layer: layer, invite: invite };
    friendButton(panel.node, '忽略', -150, -166, 200, 60, 'grey', function () {
      closeInvitePopup();
      rejectInvite(invite);
    });
    popup.join = friendButton(panel.node, '加入', 110, -166, 280, 60, 'orange', function () {
      closeInvitePopup();
      acceptInvite(invite);
    });
    lobbyLabel(panel.node, '正在打牌时不弹窗，邀请会放进「消息」里', 0, -224, 14, rgb('#b9a98c'), 0.5, false);
    panel.node.scale = 0.92; panel.node.opacity = 0;
    cc.tween(panel.node).to(0.14, { scale: 1, opacity: 255 }).start();
    tickInvitePopup();
  }
  function tickInvitePopup() {
    var popup = social.popup;
    if (!popup || !cc.isValid(popup.layer)) return;
    if (tableController()) return closeInvitePopup();
    var left = socialLeft(popup.invite.expiresAt);
    if (!left) { closeInvitePopup(); return toast('邀请已过期'); }
    popup.join.label.string = '加入 ' + left + 's';
  }
  function acceptInvite(invite, done) {
    if (social.accepting) return;
    social.accepting = true;
    apiRequest('POST', '/api/social/invites/' + invite.id + '/accept').then(function (result) {
      social.accepting = false;
      if (done) done(result);
      if (!result.ok) return toast(result.result === 'full' ? '这桌已经满了，下次早点来' : '邀请已过期');
      cc.mm.hallserver.requestJoinRoom(String(result.code));
    }, function (error) {
      social.accepting = false;
      toast(error.message);
      if (done) done(null);
    });
  }
  function rejectInvite(invite, done) {
    apiRequest('POST', '/api/social/invites/' + invite.id + '/reject').then(function () { if (done) done(); }, function (error) { toast(error.message); if (done) done(); });
  }

  // 牌桌「邀请好友」（S4-AC2）：没开局、还有空座时，在原版邀请键的位置放黄色按钮，点开右侧抽屉。
  function watchTableInvite() {
    var table = tableController(), views = table && table.views, model = table && table.model, anchor = views && views.invateBtn;
    var replay = window.StandaloneReplay && StandaloneReplay.active();
    var open = !!(anchor && model && !replay && !model.isStart && window.Standalone.hasLiveRoom() && seatedCount(model) < model.playerNum);
    if (!open) {
      if (table && table._standaloneInvite && cc.isValid(table._standaloneInvite)) table._standaloneInvite.active = false;
      return closeInviteDrawer();
    }
    var button = table._standaloneInvite;
    if (!button || !cc.isValid(button)) button = table._standaloneInvite = friendButton(anchor.parent, '邀请好友', 0, 0, 236, 76, 'yellow', openInviteDrawer).node;
    button.setPosition(anchor.x + (0.5 - anchor.anchorX) * anchor.width * anchor.scaleX, anchor.y + (0.5 - anchor.anchorY) * anchor.height * anchor.scaleY);
    button.active = true;
  }
  function closeInviteDrawer() {
    if (social.drawer && cc.isValid(social.drawer.layer)) social.drawer.layer.destroy();
    social.drawer = null;
  }
  function dashedRect(pen, x, y, width, height, color) {
    pen.lineWidth = 2; pen.strokeColor = color;
    function line(x1, y1, x2, y2) {
      var length = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)), steps = Math.floor(length / 13);
      for (var i = 0; i <= steps; i++) {
        var a = i * 13 / length, b = Math.min(1, (i * 13 + 7) / length);
        pen.moveTo(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a); pen.lineTo(x1 + (x2 - x1) * b, y1 + (y2 - y1) * b);
      }
    }
    line(x, y, x + width, y); line(x + width, y, x + width, y + height); line(x + width, y + height, x, y + height); line(x, y + height, x, y);
    pen.stroke();
  }
  function openInviteDrawer() {
    var table = tableController();
    if (!table) return;
    closeInviteDrawer();
    var layer = sceneLayer('standaloneInviteDrawer', 900), size = layer.getContentSize(), width = 480, height = size.height, half = height / 2;
    var dim = lobbyPen(layer, 'dim');
    dim.node.setContentSize(size.width, height);
    dim.fillColor = cc.color(10, 20, 40, 110); dim.rect(-size.width / 2, -half, size.width, height); dim.fill();
    dim.node.addComponent(cc.Button);
    cc.mm.uitools.addBtnLister(dim.node, closeInviteDrawer, null, false);
    var panel = lobbyPen(layer, 'panel', size.width / 2 - width / 2, 0);
    panel.node.setContentSize(width, height);
    panel.node.addComponent(cc.BlockInputEvents);
    fillRound(panel, -width / 2 - 8, -half, width + 40, height, 24, cc.color(10, 20, 50, 70));
    fillRound(panel, -width / 2, -half, width + 40, height, 24, rgb('#fffaf0'));
    var left = -width / 2 + 28;
    lobbyLabel(panel.node, '邀请好友', left, half - 46, 28, rgb('#5a3200'), 0, true);
    var drawer = social.drawer = { layer: layer, tab: 'online', rows: {}, data: null };
    drawer.sub = lobbyLabel(panel.node, '', left, half - 82, 17, rgb('#e0702a'), 0, true);
    closeMark(panel.node, width / 2 - 42, half - 50, cc.color(140, 90, 20, 70), closeInviteDrawer);
    drawer.tabs = [['online', -101], ['all', 101]].map(function (entry) {
      var pen = lobbyPen(panel.node, 'tab', entry[1], half - 126);
      pen.node.setContentSize(196, 44);
      pen.node.addComponent(cc.Button).transition = cc.Button.Transition.SCALE;
      var label = lobbyLabel(pen.node, '', 0, 0, 18, rgb('#7a3a00'), 0.5, true);
      cc.mm.uitools.addBtnLister(pen.node, function () { drawer.tab = entry[0]; renderInviteDrawer(); });
      return { key: entry[0], pen: pen, label: label };
    });
    var top = half - 160, bottom = -half + 100;
    drawer.list = verticalScroll(panel.node, 440, top - bottom);
    drawer.list.node.y = (top + bottom) / 2;
    drawer.empty = lobbyLabel(panel.node, '', 0, (top + bottom) / 2 + 60, 18, rgb('#a38b6d'), 0.5, false);
    var footer = lobbyPen(panel.node, 'footer', 0, -half + 54);
    fillRound(footer, -216, -34, 432, 68, 16, rgb('#fff4dc'));
    dashedRect(footer, -212, -30, 424, 60, rgb('#e6c88c'));
    var code = liveRoomCode();
    var tip = friendRich(footer.node, '<color=#8d7a62>好友不在线？把房号发给他 </color><b><color=#5a3200>' + code + '</color></b>', -200, 0, 16);
    tip.node.anchorX = 0;
    friendButton(footer.node, '复制房号', 200 - 60, 0, 120, 40, 'yellow', function () {
      var current = tableController();
      if (current && typeof current.onClickInvateBtn === 'function') current.onClickInvateBtn();
      else if (code) copyText(code);
    });
    panel.node.x += width;
    cc.tween(panel.node).to(0.18, { x: size.width / 2 - width / 2 }, { easing: 'quadOut' }).start();
    renderInviteDrawer();
    inviteDrawerRefresh();
  }
  function tickInviteDrawer() {
    var drawer = social.drawer;
    if (!drawer || !cc.isValid(drawer.layer)) return;
    if (Date.now() - (drawer.loadedAt || 0) >= 5000) inviteDrawerRefresh();
    renderInviteDrawer();
  }
  function inviteDrawerRefresh() {
    var drawer = social.drawer;
    if (!drawer || drawer.loading) return;
    drawer.loading = true; drawer.loadedAt = Date.now();
    apiRequest('GET', '/api/social/friends').then(function (data) {
      drawer.loading = false;
      if (social.drawer !== drawer) return;
      drawer.data = data;
      renderInviteDrawer();
    }, function () { drawer.loading = false; });
  }
  function renderInviteDrawer() {
    var drawer = social.drawer;
    if (!drawer || !cc.isValid(drawer.layer)) return;
    var table = tableController(), model = table && table.model;
    drawer.sub.string = '房号 ' + liveRoomCode() + ' · 还差 ' + (model ? Math.max(0, model.playerNum - seatedCount(model)) : 0) + ' 人';
    var order = { idle: 0, playing: 1, offline: 2 }, all = drawer.data ? drawer.data.friends.slice() : [];
    all.sort(function (a, b) { return (a.status in order ? order[a.status] : 2) - (b.status in order ? order[b.status] : 2); });
    var online = all.filter(function (friend) { return friend.status !== 'offline'; });
    drawer.tabs[0].label.string = '在线好友 ' + online.length;
    drawer.tabs[1].label.string = '全部好友 ' + all.length;
    drawer.tabs.forEach(function (tab) {
      var on = tab.key === drawer.tab;
      tab.pen.clear();
      fillRound(tab.pen, -98, -22, 196, 44, 22, on ? rgb('#ffc72c') : rgb('#f3e6c8'));
      tab.label.node.color = on ? rgb('#7a3a00') : rgb('#a38b6d');
    });
    var list = drawer.tab === 'online' ? online : all, content = drawer.list.content, keep = {}, y = 0;
    list.forEach(function (friend) {
      var left = social.invited[friend.uid] ? socialLeft(social.invited[friend.uid]) : 0, signature = JSON.stringify([friend, left > 0]);
      var row = drawer.rows[friend.uid];
      if (!row || row.signature !== signature || !cc.isValid(row.node)) {
        if (row && cc.isValid(row.node)) row.node.destroy();
        row = drawer.rows[friend.uid] = inviteRow(friend, left > 0);
        row.signature = signature;
        content.addChild(row.node);
      }
      row.node.setPosition(0, y - 40);
      if (row.countdown) row.countdown.string = '已邀请 ' + left + 's';
      keep[friend.uid] = true;
      y -= 80;
    });
    Object.keys(drawer.rows).forEach(function (uid) {
      if (keep[uid]) return;
      if (cc.isValid(drawer.rows[uid].node)) drawer.rows[uid].node.destroy();
      delete drawer.rows[uid];
    });
    content.height = Math.max(drawer.list.view.height, -y);
    drawer.empty.string = !drawer.data ? '正在加载…' : list.length ? '' : drawer.tab === 'online' ? '现在没有在线的好友' : '还没有好友，去大厅「好友」里找朋友';
  }
  function inviteRow(friend, invited) {
    var width = 440, node = new cc.Node('standaloneInviteRow'), status = LIGHT_STATUS[friend.status] || LIGHT_STATUS.offline;
    node.setContentSize(width, 80);
    var line = lobbyPen(node, 'line');
    line.fillColor = rgb('#f0e2c4'); line.rect(-width / 2 + 8, -40, width - 16, 1.5); line.fill();
    roundAvatar(node, -width / 2 + 8 + 29, 0, 58, 12, friend.avatarUrl);
    statusDot(node, -width / 2 + 8 + 52, -22, status[1]);
    var textX = -width / 2 + 8 + 58 + 14;
    var name = lobbyLabel(node, shortName(friend.nickname, 6), textX, 13, 20, rgb('#5a3200'), 0, true), sex = SEX_TAGS[friend.sex];
    if (sex) lobbyPill(node, sex[0], textX + labelWidth(name) + 8, 13 + 10.5, 13, rgb(sex[1]), rgb('#ffffff'), 0);
    lobbyLabel(node, socialStatus(friend, LIGHT_STATUS), textX, -14, 15, rgb(status[1]), 0, true);
    var row = { node: node };
    if (friend.status === 'offline') node.opacity = 130;
    else if (invited) row.countdown = friendButton(node, '', width / 2 - 8 - 64, 0, 128, 42, 'grey').label;
    else friendButton(node, '邀请', width / 2 - 8 - 50, 0, 100, 42, 'blue', function () { inviteFriend(friend); });
    return row;
  }
  function inviteFriend(friend) {
    apiRequest('POST', '/api/social/invites', { uid: String(friend.uid) }).then(function (result) {
      social.offset = new Date(result.now).getTime() - Date.now() || social.offset;
      social.invited[friend.uid] = result.expiresAt;
      toast(result.status === 'playing' ? '对方正在打牌，邀请放进了他的消息里' : '邀请已发出，等对方加入');
      renderInviteDrawer();
    }, function (error) { toast(error.message); });
  }

  // 「消息」标签（S4-AC1、S4-AC4、S4-AC5）：左边会话列表，右边对话；底下只有常用语和表情两排可点。
  function chatBox(controller) {
    var friends = controller._standaloneFriends;
    if (!friends.chat || !cc.isValid(friends.chat.root)) {
      friends.chat = { root: new cc.Node('standaloneChat'), selected: null, conversations: null, thread: null };
      friends.box.addChild(friends.chat.root);
    }
    return friends.chat;
  }
  function openFriendChat(controller, uid) {
    var friends = controller._standaloneFriends, chat = chatBox(controller);
    friends.tab = 'messages';
    if (chat.selected !== String(uid)) { chat.selected = String(uid); chat.thread = null; }
    renderFriends(controller);
    chatRefresh(controller, true);
  }
  function chatRefresh(controller, force) {
    var friends = controller._standaloneFriends, chat = friends.chat;
    if (!chat || !cc.isValid(controller.node)) return;
    if (chat.loading) { chat.again = chat.again || force; return; }
    chat.loading = true;
    var uid = chat.selected;
    (uid ? apiRequest('GET', '/api/social/messages?uid=' + encodeURIComponent(uid)) : Promise.resolve(null)).then(function (thread) {
      return apiRequest('GET', '/api/social/conversations').then(function (list) { return [thread, list]; });
    }).then(function (results) {
      chat.loading = false; chat.failed = false;
      if (!cc.isValid(controller.node)) return;
      if (chat.again) { chat.again = false; return chatRefresh(controller); }
      chat.conversations = results[1].conversations;
      if (uid && uid === chat.selected) chat.thread = results[0];
      if (uid && friends.unreadFrom && friends.unreadFrom[uid]) social.pulsedAt = 0;
      if (!chat.selected && chat.conversations.length) {
        chat.selected = String(chat.conversations[0].user.uid);
        renderChat(controller);
        return chatRefresh(controller);
      }
      if (friends.tab === 'messages') renderChat(controller);
    }, function () {
      chat.loading = false; chat.failed = true;
      if (cc.isValid(controller.node) && friends.tab === 'messages') renderChat(controller);
    });
  }
  function buildChat(controller, chat, areaWidth) {
    chat.root.removeAllChildren();
    var height = CHAT_TOP - CHAT_BOTTOM, listWidth = Math.min(380, Math.floor(areaWidth * 0.33)), gap = 20, panelWidth = areaWidth - listWidth - gap;
    var left = -areaWidth / 2, half = height / 2;
    chat.root.setPosition(0, (CHAT_TOP + CHAT_BOTTOM) / 2);
    chat.size = { listWidth: listWidth, panelWidth: panelWidth, height: height };
    var listNode = new cc.Node('list'); listNode.setPosition(left + listWidth / 2, 0); chat.root.addChild(listNode);
    friendGlass(listNode, listWidth, height);
    chat.list = verticalScroll(listNode, listWidth - 20, height - 20);
    chat.listEmpty = lobbyLabel(listNode, '', 0, 40, 18, rgb('#dfe6f5'), 0.5, true);
    var panel = lobbyPen(chat.root, 'panel', left + listWidth + gap + panelWidth / 2, 0);
    panel.node.setContentSize(panelWidth, height);
    fillRound(panel, -panelWidth / 2, -half - 6, panelWidth, height, 20, cc.color(10, 20, 60, 70));
    fillRound(panel, -panelWidth / 2, -half, panelWidth, height, 20, rgb('#fffaf0'));
    fillRound(panel, -panelWidth / 2, -half, panelWidth, CHAT_BAR, 20, rgb('#fdf4e0'));
    panel.fillColor = rgb('#fdf4e0'); panel.rect(-panelWidth / 2, -half + CHAT_BAR - 24, panelWidth, 24); panel.fill();
    panel.fillColor = rgb('#f0e2c4');
    panel.rect(-panelWidth / 2, half - CHAT_HEADER, panelWidth, 1.5); panel.rect(-panelWidth / 2, -half + CHAT_BAR, panelWidth, 1.5); panel.fill();
    chat.header = new cc.Node('header'); chat.header.setPosition(0, half - CHAT_HEADER / 2); panel.node.addChild(chat.header);
    var messageHeight = height - CHAT_HEADER - CHAT_BAR - 4;
    chat.messages = verticalScroll(panel.node, panelWidth - 8, messageHeight);
    chat.messages.node.y = (half - CHAT_HEADER + (-half + CHAT_BAR)) / 2;
    chat.note = lobbyLabel(panel.node, '', 0, chat.messages.node.y, 18, rgb('#b9a98c'), 0.5, true);
    chat.bar = new cc.Node('bar'); chat.bar.setPosition(0, -half + CHAT_BAR / 2); panel.node.addChild(chat.bar);
    buildChatBar(controller, chat, panelWidth);
    chat.listSignature = chat.threadSignature = chat.headerSignature = null;
  }
  function buildChatBar(controller, chat, width) {
    var inner = width - 44, phrases = horizontalScroll(chat.bar, inner, 40), x = 0;
    phrases.node.y = 27;
    SOCIAL_PHRASE_ORDER.forEach(function (ref) {
      var chip = lobbyPen(phrases.content, 'chip'), label = lobbyLabel(chip.node, SOCIAL_PHRASES[ref], 0, 0, 15, rgb('#8a5a1a'), 0.5, true);
      var chipWidth = labelWidth(label) + 28;
      chip.node.setContentSize(chipWidth, 34); chip.node.setPosition(x + chipWidth / 2, 0);
      fillRound(chip, -chipWidth / 2, -17, chipWidth, 34, 17, rgb('#fff0cc'));
      strokeRound(chip, -chipWidth / 2, -17, chipWidth, 34, 17, rgb('#f0d49a'), 1.5);
      var button = chip.node.addComponent(cc.Button); button.transition = cc.Button.Transition.SCALE; button.zoomScale = 0.94;
      cc.mm.uitools.addBtnLister(chip.node, function () { chatSend(controller, 'phrase', ref); }, controller);
      x += chipWidth + 10;
    });
    phrases.content.width = Math.max(inner, x - 10);
    var faces = horizontalScroll(chat.bar, inner, 58);
    faces.node.y = -25;
    for (var ref = 0; ref < SOCIAL_FACES; ref++) (function (ref) {
      var holder = lobbyPen(faces.content, 'face', ref * 64 + 28, 0);
      holder.node.setContentSize(56, 56);
      fillRound(holder, -28, -28, 56, 56, 28, rgb('#fff0cc'));
      strokeRound(holder, -28, -28, 56, 56, 28, rgb('#f0d49a'), 1.5);
      faceNode(holder.node, ref, 0.72);
      var button = holder.node.addComponent(cc.Button); button.transition = cc.Button.Transition.SCALE; button.zoomScale = 0.9;
      cc.mm.uitools.addBtnLister(holder.node, function () { chatSend(controller, 'face', ref); }, controller);
    })(ref);
    faces.content.width = Math.max(inner, SOCIAL_FACES * 64 - 8);
    chat.barNote = lobbyLabel(chat.bar, '', 0, 0, 18, rgb('#a38b6d'), 0.5, true);
    chat.barItems = [phrases.node, faces.node];
  }
  function chatConversations(controller, chat) {
    var friends = controller._standaloneFriends, list = (chat.conversations || []).slice();
    if (chat.selected && !list.some(function (item) { return String(item.user.uid) === chat.selected; })) {
      var user = chat.thread && String(chat.thread.user.uid) === chat.selected ? chat.thread.user
        : (friends.data && friends.data.friends || []).filter(function (friend) { return String(friend.uid) === chat.selected; })[0];
      if (user) list.unshift({ user: user, last: null, unread: 0 });
    }
    return list;
  }
  function renderChat(controller) {
    var friends = controller._standaloneFriends, chat = chatBox(controller);
    if (chat.areaWidth !== friends.areaWidth) { chat.areaWidth = friends.areaWidth; buildChat(controller, chat, friends.areaWidth); }
    var items = chatConversations(controller, chat), selected = items.filter(function (item) { return String(item.user.uid) === chat.selected; })[0];
    var thread = chat.thread && String(chat.thread.user.uid) === chat.selected ? chat.thread : null, user = thread ? thread.user : selected && selected.user;
    var listSignature = JSON.stringify([items, chat.selected]);
    if (listSignature !== chat.listSignature) {
      chat.listSignature = listSignature;
      var content = chat.list.content, width = chat.list.view.width;
      content.removeAllChildren();
      items.forEach(function (item, index) {
        var row = chatListRow(controller, chat, item, width);
        row.setPosition(0, -index * (CHAT_ROW + 4) - CHAT_ROW / 2);
        content.addChild(row);
      });
      content.height = Math.max(chat.list.view.height, items.length * (CHAT_ROW + 4));
    }
    chat.listEmpty.string = !chat.conversations ? (chat.failed ? '消息加载失败\n稍后自动重试' : '正在加载…') : items.length ? '' : '还没有消息';
    chat.header.active = chat.messages.node.active = chat.bar.active = !!user;
    if (user) renderChatHeader(chat, user);
    if (thread) renderChatThread(controller, chat, thread);
    else if (chat.threadSignature) { chat.threadSignature = null; chat.messages.content.removeAllChildren(); }
    chat.note.string = !user ? (chat.conversations ? '在「好友」里点好友卡片上的「发消息」开始聊天' : '') : !thread ? '正在加载…'
      : thread.messages.length ? '' : '还没聊过，点下面的常用语或表情打个招呼';
    var blocked = !!(thread && thread.user.isFriend === false);
    chat.barItems.forEach(function (node) { node.active = !blocked; });
    chat.barNote.string = blocked ? '你们已经不是好友了，不能再发消息' : '';
  }
  function chatListRow(controller, chat, item, width) {
    var row = new cc.Node('standaloneChatRow'), height = CHAT_ROW, user = item.user, status = FRIEND_STATUS[user.status] || FRIEND_STATUS.offline;
    row.setContentSize(width, height);
    var pen = lobbyPen(row, 'bg');
    if (String(user.uid) === chat.selected) {
      fillRound(pen, -width / 2, -height / 2, width, height, 14, rgb('#ffe25a', 0.22));
      fillRound(pen, -width / 2, -height / 2 + 10, 5, height - 20, 2.5, rgb('#ffd84a'));
    }
    var avatarX = -width / 2 + 14 + 30;
    roundAvatar(row, avatarX, 0, 60, 11, user.avatarUrl);
    var ring = lobbyPen(row, 'ring', avatarX, 0);
    strokeRound(ring, -30, -30, 60, 60, 11, cc.color(255, 255, 255, 200), 2);
    statusDot(row, avatarX + 25, -25, status[1]);
    var textX = -width / 2 + 14 + 60 + 14, room = width / 2 - 14 - textX;
    lobbyLabel(row, shortName(user.nickname, 6), textX, 14, 20, rgb('#ffffff'), 0, true);
    lobbyLabel(row, shortName(chatPreview(item.last), Math.max(4, Math.floor((room - 34) / 15))), textX, -14, 15, rgb('#cfe0ff'), 0, true);
    if (item.last) lobbyLabel(row, chatTime(item.last.createdAt), width / 2 - 14, 24, 13, rgb('#aab6cf'), 1, true);
    friendBadge(row, width / 2 - 26, -16)(item.unread);
    var button = row.addComponent(cc.Button); button.transition = cc.Button.Transition.NONE;
    cc.mm.uitools.addBtnLister(row, function () {
      if (chat.selected === String(user.uid)) return;
      chat.selected = String(user.uid); chat.thread = null;
      renderChat(controller);
      chatRefresh(controller, true);
    }, controller);
    return row;
  }
  function renderChatHeader(chat, user) {
    var width = chat.size.panelWidth, signature = JSON.stringify([user.uid, user.nickname, user.avatarUrl, user.sex, user.status, user.round, width]);
    if (signature === chat.headerSignature) return;
    chat.headerSignature = signature;
    var header = chat.header, x = -width / 2 + 22, status = LIGHT_STATUS[user.status] || LIGHT_STATUS.offline;
    header.removeAllChildren();
    roundAvatar(header, x + 24, 0, 48, 10, user.avatarUrl);
    var name = lobbyLabel(header, shortName(user.nickname, 8), x + 48 + 12, 11, 22, rgb('#5a3200'), 0, true), sex = SEX_TAGS[user.sex];
    if (sex) lobbyPill(header, sex[0], x + 60 + labelWidth(name) + 8, 11 + 10.5, 13, rgb(sex[1]), rgb('#ffffff'), 0);
    lobbyLabel(header, '● ' + socialStatus(user, LIGHT_STATUS), x + 60, -15, 15, rgb(status[1]), 0, true);
    lobbyLabel(header, '只能发常用语和表情', width / 2 - 22, 0, 15, rgb('#b9a98c'), 1, false);
  }
  function renderChatThread(controller, chat, thread) {
    var content = chat.messages.content, width = chat.messages.view.width;
    var signature = JSON.stringify([thread.messages, thread.user.avatarUrl, width]);
    if (signature === chat.threadSignature) return;
    chat.threadSignature = signature;
    content.removeAllChildren();
    var y = -10, last = 0;
    if (thread.more) { lobbyLabel(content, '只显示最近 50 条', 0, y - 10, 13, rgb('#c9b998'), 0.5, false); y -= 30; }
    thread.messages.forEach(function (message) {
      var time = new Date(message.createdAt).getTime();
      if (time - last > 5 * 60000) { lobbyLabel(content, chatStamp(time), 0, y - 10, 13, rgb('#b9a98c'), 0.5, true); y -= 32; }
      last = time;
      var node = chatMessage(controller, message, thread.user, width);
      node.setPosition(0, y - node.height / 2);
      content.addChild(node);
      y -= node.height + 14;
    });
    content.height = Math.max(chat.messages.view.height, -y);
    chat.messages.scroll.scrollToBottom(0);
  }
  function chatMessage(controller, message, user, width) {
    var node = new cc.Node('standaloneChatMessage'), side = message.fromMe ? 1 : -1, avatar = 44;
    var body = chatBody(controller, message, Math.min(380, width - 2 * (20 + avatar + 10) - 40));
    var height = Math.max(avatar, body.height);
    node.setContentSize(width, height);
    roundAvatar(node, side * (width / 2 - 20 - avatar / 2), height / 2 - avatar / 2, avatar, 9, message.fromMe ? myAvatar() : user.avatarUrl);
    var edge = side * (width / 2 - 20 - avatar - 10);
    body.setPosition(edge - side * body.width / 2, height / 2 - body.height / 2);
    node.addChild(body);
    return node;
  }
  function chatBody(controller, message, maxWidth) {
    var body = new cc.Node('body');
    if (message.kind === 'face') {
      body.setContentSize(84, 84);
      faceNode(body, message.ref, 1.15);
      return body;
    }
    if (message.kind === 'invite') return chatInviteCard(controller, message, maxWidth);
    var pen = body.addComponent(cc.Graphics), mine = message.fromMe;
    var label = lobbyLabel(body, SOCIAL_PHRASES[message.ref] || '[消息]', 0, 0, 18, rgb('#3a2a10'), 0.5, true);
    var textWidth = labelWidth(label);
    if (textWidth > maxWidth - 32) {
      label.overflow = cc.Label.Overflow.RESIZE_HEIGHT; label.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
      label.node.width = textWidth = maxWidth - 32;
      if (label._forceUpdateRenderData) label._forceUpdateRenderData(true);
    }
    var width = textWidth + 32, height = Math.max(44, label.node.height + 18);
    body.setContentSize(width, height);
    fillRound(pen, -width / 2, -height / 2, width, height, 16, rgb(mine ? '#ffe27a' : '#ffffff'));
    strokeRound(pen, -width / 2, -height / 2, width, height, 16, rgb(mine ? '#f3cc4a' : '#eedfc0'), 1.5);
    return body;
  }
  function chatInviteCard(controller, message, maxWidth) {
    var invite = message.invite || {}, room = invite.room || {}, mine = message.fromMe, width = Math.min(330, maxWidth);
    var join = !mine && invite.state === 'pending', height = 40 + 12 + 74 + 10 + (join ? 44 : 30) + 14, half = height / 2;
    var card = new cc.Node('standaloneInviteCard'), pen = card.addComponent(cc.Graphics), lines = inviteRoomLines(room);
    card.setContentSize(width, height);
    fillRound(pen, -width / 2, -half, width, height, 16, rgb('#ffffff'));
    fillRound(pen, -width / 2, half - 40, width, 40, 16, rgb('#2a8a60'));
    pen.fillColor = rgb('#2a8a60'); pen.rect(-width / 2, half - 40, width, 20); pen.fill();
    strokeRound(pen, -width / 2, -half, width, height, 16, rgb('#e6cf9c'), 2);
    var x = -width / 2 + 14;
    fillRound(pen, x + 4, half - 30, 13, 18, 3, cc.color(255, 255, 255, 140));
    fillRound(pen, x, half - 31, 13, 18, 3, rgb('#ffffff'));
    lobbyLabel(card, mine ? '我发出的邀请' : '邀请你一起打牌', x + 26, half - 20, 17, rgb('#ffffff'), 0, true);
    var top = half - 40 - 12;
    lobbyLabel(card, lines[0], x, top - 12, 18, rgb('#5a3200'), 0, true);
    lobbyLabel(card, lines[1], x, top - 38, 15, rgb('#8d7a62'), 0, false);
    lobbyLabel(card, lines[2], x, top - 62, 15, rgb('#e0702a'), 0, true);
    var bottomY = -half + 14 + (join ? 22 : 15);
    if (join) friendButton(card, '加入房间', 0, bottomY, width - 28, 44, 'orange', function () {
      acceptInvite(invite, function () { chatRefresh(controller, true); });
    }, controller);
    else {
      var state = INVITE_STATE[invite.state] || INVITE_STATE.expired, pill = lobbyPen(card, 'state', x, bottomY);
      var label = lobbyLabel(pill.node, state[0], 14, 0, 15, rgb(state[1]), 0, true), pillWidth = labelWidth(label) + 28;
      fillRound(pill, 0, -15, pillWidth, 30, 15, rgb(state[1], 0.12));
      strokeRound(pill, 0, -15, pillWidth, 30, 15, rgb(state[1], 0.6), 1.5);
    }
    return card;
  }
  function chatSend(controller, kind, ref) {
    var chat = controller._standaloneFriends.chat;
    if (!chat || !chat.selected || Date.now() - (chat.sentAt || 0) < 800) return;
    chat.sentAt = Date.now();
    var uid = chat.selected;
    apiRequest('POST', '/api/social/messages', { uid: uid, kind: kind, ref: ref }).then(function (result) {
      if (chat.selected === uid && chat.thread && String(chat.thread.user.uid) === uid) {
        chat.thread.messages = chat.thread.messages.concat([result.message]);
        renderChat(controller);
      }
      chatRefresh(controller, true);
    }, function (error) { toast(error.message); });
  }

  // 找朋友弹窗：输数字 ID 搜人、申请；下面列最近同桌（S3-AC1、S3-AC4）。
  function closeFriendSearch(friends) {
    if (friends && friends.search && cc.isValid(friends.search.layer)) friends.search.layer.destroy();
    if (friends) friends.search = null;
  }
  function friendInput(parent, x, y, width, height, prefix, placeholder) {
    var node = new cc.Node('standaloneFriendInput');
    node.setContentSize(width, height); node.setPosition(x, y);
    var pen = node.addComponent(cc.Graphics);
    fillRound(pen, -width / 2, -height / 2, width, height, 14, rgb('#ffffff'));
    strokeRound(pen, -width / 2, -height / 2, width, height, 14, rgb('#f0c060'), 2.5);
    var prefixLabel = lobbyLabel(node, prefix, -width / 2 + 18, 0, 18, rgb('#a38b6d'), 0, false);
    var start = -width / 2 + 18 + labelWidth(prefixLabel) + 12;
    var edit = node.addComponent(cc.EditBox);
    function editLabel(name, color, size) {
      var child = new cc.Node(name);
      child.setAnchorPoint(0, 1); child.setPosition(start, height / 2); child.setContentSize(width / 2 - start - 14, height);
      child.color = color;
      var label = child.addComponent(cc.Label);
      label.fontSize = size; label.lineHeight = size + 6; label.enableWrapText = false;
      label.horizontalAlign = cc.Label.HorizontalAlign.LEFT; label.verticalAlign = cc.Label.VerticalAlign.CENTER;
      node.addChild(child);
      return label;
    }
    edit.textLabel = editLabel('TEXT_LABEL', rgb('#4a2a00'), 28);
    edit.placeholderLabel = editLabel('PLACEHOLDER_LABEL', rgb('#c4b39c'), 20);
    edit.textLabel.enableBold = true;
    edit.maxLength = 10;
    edit.inputMode = cc.sys.isBrowser ? cc.EditBox.InputMode.SINGLE_LINE : cc.EditBox.InputMode.NUMERIC;
    edit.returnType = cc.EditBox.KeyboardReturnType.SEARCH;
    edit.placeholder = placeholder;
    node.on('editing-did-began', function () {
      if (cc.sys.isBrowser && edit._impl && edit._impl._elem) edit._impl._elem.setAttribute('inputmode', 'numeric');
    });
    parent.addChild(node);
    return edit;
  }
  function openFriendSearch(controller) {
    var friends = controller._standaloneFriends, host = controller.node;
    closeFriendSearch(friends);
    var layer = new cc.Node('standaloneFriendSearch');
    layer.setContentSize(host.width, host.height); host.addChild(layer);
    layer.addComponent(cc.BlockInputEvents);
    var dim = lobbyPen(layer, 'dim');
    dim.fillColor = cc.color(10, 20, 40, 150); dim.rect(-host.width / 2, -host.height / 2, host.width, host.height); dim.fill();
    var width = 640, height = 530, half = height / 2;
    var panel = lobbyPen(layer, 'panel', 0, -6);
    panel.node.setContentSize(width, height);
    fillRound(panel, -width / 2, -half - 8, width, height, 24, cc.color(20, 30, 70, 90));
    fillRound(panel, -width / 2, -half, width, height, 24, rgb('#fff8ea'));
    fillRound(panel, -width / 2, half - 64, width, 64, 24, rgb('#ffb13b'));
    panel.fillColor = rgb('#ffb13b'); panel.rect(-width / 2, half - 64, width, 30); panel.fill();
    fillRound(panel, -width / 2 + 6, half - 30, width - 12, 24, 12, rgb('#ffd27a', 0.6));
    var title = lobbyLabel(panel.node, '找朋友', 0, half - 32, 28, rgb('#ffffff'), 0.5, true);
    var titleOutline = title.node.addComponent(cc.LabelOutline); titleOutline.color = rgb('#d97a10'); titleOutline.width = 2;
    var close = lobbyPen(panel.node, 'close', width / 2 - 38, half - 32);
    close.node.setContentSize(44, 44);
    close.fillColor = cc.color(140, 70, 0, 70); close.circle(0, 0, 18); close.fill();
    close.lineWidth = 3.5; close.strokeColor = rgb('#ffffff');
    close.moveTo(-7, -7); close.lineTo(7, 7); close.moveTo(-7, 7); close.lineTo(7, -7); close.stroke();
    var closeButton = close.node.addComponent(cc.Button); closeButton.transition = cc.Button.Transition.SCALE;
    cc.mm.uitools.addBtnLister(close.node, function () { closeFriendSearch(friends); }, controller);
    var search = friends.search = { layer: layer, panel: panel.node };
    var edit = search.edit = friendInput(panel.node, -width / 2 + 24 + 220, half - 112, 440, 58, '对方 ID', '输入对方的数字 ID');
    function run() {
      var uid = String(edit.string || '').replace(/\D/g, '');
      if (!uid) return toast('请输入对方的数字 ID');
      edit.string = uid;
      showFriendResult(controller, { loading: true });
      apiRequest('GET', '/api/social/search?uid=' + uid).then(function (data) {
        if (friends.search === search) showFriendResult(controller, { user: data.user });
      }, function (error) { if (friends.search === search) showFriendResult(controller, { error: error.message }); });
    }
    search.run = run;
    friendButton(panel.node, '搜索', width / 2 - 24 - 72, half - 112, 144, 58, 'blue', run, controller);
    edit.node.on('editing-return', run);
    search.result = new cc.Node('result'); search.result.setPosition(0, half - 220); panel.node.addChild(search.result);
    showFriendResult(controller, null);
    var recentTitle = friendRich(panel.node, '<b><color=#8a5a1a>最近同桌</color></b><color=#b39a7a><size=15>  · 一起打过牌、还不是好友</size></color>', -width / 2 + 26, half - 318, 19);
    recentTitle.node.anchorX = 0;
    search.recent = new cc.Node('recent'); search.recent.setPosition(0, half - 398); panel.node.addChild(search.recent);
    lobbyLabel(search.recent, '正在加载…', 0, 0, 17, rgb('#b39a7a'), 0.5, false);
    var footer = new cc.Node('footer'); footer.setPosition(0, -half + 26); panel.node.addChild(footer);
    var mine = friends.data && friends.data.myUid || '';
    var mineRich = friendRich(footer, '<color=#8a7560>我的 ID </color><b><color=#5a3200>' + mine + '</color></b>', 0, 0, 17);
    if (mineRich._updateRichText) mineRich._updateRichText();
    var copy = friendButton(footer, '复制', 0, 0, 56, 28, 'yellow', function () { if (mine) copyText(mine); }, controller);
    var tip = lobbyLabel(footer, '把 ID 发给朋友，对方就能搜到你', 0, 0, 15, rgb('#a38b6d'), 0, false);
    var total = mineRich.node.width + 10 + 56 + 10 + labelWidth(tip), x = -total / 2;
    mineRich.node.x = x; copy.node.x = x + mineRich.node.width + 10 + 28; tip.node.x = x + mineRich.node.width + 10 + 56 + 10;
    footer.active = !!mine;
    panel.node.scale = 0.92; panel.node.opacity = 0;
    cc.tween(panel.node).to(0.14, { scale: 1, opacity: 255 }).start();
    loadFriendRecent(controller);
  }
  function showFriendResult(controller, state) {
    var friends = controller._standaloneFriends, search = friends.search;
    if (!search || !cc.isValid(search.result)) return;
    var box = search.result, width = 592, height = 128;
    box.removeAllChildren();
    var pen = lobbyPen(box, 'box');
    fillRound(pen, -width / 2, -height / 2, width, height, 18, rgb('#fff1d6'));
    strokeRound(pen, -width / 2, -height / 2, width, height, 18, rgb('#f3d9a6'), 2);
    var user = state && state.user;
    if (!user) {
      var text = !state ? '输入对方的数字 ID，点「搜索」' : state.loading ? '正在搜索…' : state.error ? state.error : '没有找到这个 ID 的玩家，检查一下数字';
      lobbyLabel(box, text, 0, 0, 19, rgb(state && !state.loading ? '#c0641a' : '#a38b6d'), 0.5, !!state && !state.loading);
      return;
    }
    var x = -width / 2 + 20;
    var frame = lobbyPen(box, 'frame', x + 44, 0);
    fillRound(frame, -46, -46, 92, 92, 18, rgb('#f0dfbd'));
    roundAvatar(box, x + 44, 0, 88, 16, user.avatarUrl);
    var textX = x + 88 + 18;
    var name = lobbyLabel(box, shortName(user.nickname, 6), textX, 30, 24, rgb('#5a3200'), 0, true);
    var sex = SEX_TAGS[user.sex];
    if (sex) lobbyPill(box, sex[0], textX + labelWidth(name) + 8, 30 + 10.5, 14, rgb(sex[1]), rgb('#ffffff'), 0);
    lobbyLabel(box, 'ID ' + user.uid, textX, 0, 16, rgb('#8d7a62'), 0, false);
    var together = user.self ? '这是你自己' : user.together && user.together.rounds
      ? '一起打过 ' + user.together.rounds + ' 局 · ' + friendAgo(user.together.lastAt) : '还没一起打过牌';
    lobbyLabel(box, together, textX, -28, 16, rgb('#c0641a'), 0, false);
    if (user.self) return;
    var buttonX = width / 2 - 20 - 85;
    if (user.isFriend) friendButton(box, '已是好友', buttonX, 0, 170, 54, 'grey');
    else if (user.requested) friendButton(box, '已申请', buttonX, 0, 170, 54, 'grey');
    else friendButton(box, user.incoming ? '同意申请' : '申请加好友', buttonX, 0, 170, 54, user.incoming ? 'green' : 'orange', function () {
      friendApply(controller, user.uid, 'search', function (result) {
        user.isFriend = !!result.autoAccepted; user.requested = !result.autoAccepted; user.incoming = false;
        showFriendResult(controller, { user: user });
      }, user.incoming);
    }, controller);
  }
  function loadFriendRecent(controller) {
    var friends = controller._standaloneFriends, search = friends.search;
    apiRequest('GET', '/api/social/recent').then(function (data) {
      if (friends.search === search) showFriendRecent(controller, data.players);
    }, function () {
      if (friends.search !== search || !cc.isValid(search.recent)) return;
      search.recent.removeAllChildren();
      lobbyLabel(search.recent, '最近同桌加载失败', 0, 0, 17, rgb('#b39a7a'), 0.5, false);
    });
  }
  function showFriendRecent(controller, players) {
    var friends = controller._standaloneFriends, search = friends.search, box = search && search.recent;
    if (!box || !cc.isValid(box)) return;
    box.removeAllChildren();
    if (!players.length) return lobbyLabel(box, '最近 7 天还没有一起打过牌的人', 0, 0, 17, rgb('#b39a7a'), 0.5, false);
    var areaWidth = 592, itemWidth = 106, gap = 9, height = 122;
    var scrollNode = new cc.Node('scroll'); scrollNode.setContentSize(areaWidth, height); box.addChild(scrollNode);
    var view = new cc.Node('view'); view.setContentSize(areaWidth, height); view.addComponent(cc.Mask); scrollNode.addChild(view);
    var content = new cc.Node('content'); content.anchorX = 0; content.setContentSize(Math.max(areaWidth, players.length * (itemWidth + gap) - gap), height);
    content.x = -areaWidth / 2; view.addChild(content);
    var scroll = scrollNode.addComponent(cc.ScrollView);
    scroll.content = content; scroll.horizontal = true; scroll.vertical = false; scroll.inertia = true; scroll.elastic = true;
    players.forEach(function (player, index) {
      var item = new cc.Node('player'); item.setContentSize(itemWidth, height);
      item.setPosition(index * (itemWidth + gap) + itemWidth / 2, 0); content.addChild(item);
      var pen = lobbyPen(item, 'card');
      fillRound(pen, -itemWidth / 2, -height / 2, itemWidth, height, 16, rgb('#ffffff'));
      strokeRound(pen, -itemWidth / 2, -height / 2, itemWidth, height, 16, rgb('#f3d9a6'), 1.5);
      roundAvatar(item, 0, 26, 54, 11, player.avatarUrl);
      lobbyLabel(item, shortName(player.nickname, 4), 0, -14, 15, rgb('#5a3200'), 0.5, true);
      function draw() {
        if (item._standaloneAction && cc.isValid(item._standaloneAction)) item._standaloneAction.destroy();
        item._standaloneAction = player.requested ? friendButton(item, '已申请', 0, -42, 80, 28, 'grey').node
          : friendButton(item, player.incoming ? '同意' : '加好友', 0, -42, 80, 28, player.incoming ? 'green' : 'orange', function () {
            friendApply(controller, player.uid, 'recent', function (result) {
              if (result.autoAccepted) return loadFriendRecent(controller);
              player.requested = true; draw();
            }, player.incoming);
          }, controller).node;
      }
      draw();
    });
  }

  var disabledWindows = new Set(['HallShopUI', 'HallIAPUI', 'CommonSelectPayUI', 'HallWeekCardUI', 'HallMonthUI', 'HallActivityUI', 'DoubleHolidayUI', 'HallTipUI', 'H5DownloadUI', 'BigUpdateUI', 'ForceUpdateUI', 'EventRecallResultUI', 'EventRecallUI', 'HallLiQuanUI', 'HallMatchUI', 'FirstPayUI', 'JoinFriendFail', 'SupplementUI', 'HallFriendUI', 'RecallFriend', 'HallAuthentication', 'HallMapUI']);
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
        (app.gameconfig[key] || []).forEach(function (variant) { variant.rule = withPublicLobbyOption(variant.rule); });
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
      // 原版邀请键（复制分享文字）藏起来，同一位置换成「邀请好友」抽屉（第二轮 S4）。
      social.table = controller;
      installSocial();
      patchTableEmotes(controller);
      // 牌桌不显示距离（R11 AC1）：原版进房时会重新打开定位按钮，透明度清零免得闪一下。
      var locationButton = controller.views.locationbtn;
      if (locationButton) { locationButton.opacity = 0; locationButton.active = false; }
      useBeansAtTable(controller);
      if (!(window.StandaloneReplay && StandaloneReplay.active())) noteLobbyTable();
      if (!controller._standaloneCurrencyNormalized) { normalizeCurrencyLabels(controller.node); controller._standaloneCurrencyNormalized = true; }
      if (window.StandaloneReplay && StandaloneReplay.active()) hide(controller.views, ['readyBtn', 'tg_bg', 'ntfOperate', 'sureTip', 'select', 'gy_btn_chat', 'menunode/gy_btn_tuoguan']);
    },
    // 原版好友列表（同桌自动加的那套）不再画，换成 patchFriends 搭的好友页（第二轮 S3）。
    friends: function (controller) {
      installFriends();
      patchFriends(controller);
    },
    renderFriends: function (controller, data) {
      if (controller._standaloneFriends || data.gradeInfo && data.gradeInfo.length) return;
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
      // 地区固定新津，首页不再有「切换」入口。
      hide(controller.views, ['hallDownBtns/btns/hall_mail_btn', 'common_marquee', 'common_location']);
      var gameGroups = Object.keys(controller.views).filter(function (name) { return /^games\/game_type_\d+$/.test(name); });
      if (controller.views.games && controller.views.games.active && !gameGroups.some(function (name) { return controller.views[name].active; })) {
        var preferred = gameGroups.filter(function (name) { return visibleAreaTypes[name.split('_').pop()]; })[0];
        if (preferred) controller.views[preferred].active = true;
      }
      patchHallMenu(controller);
      patchEnterLobbyCard(controller);
      // 开房面板的类在大厅包里，大厅出来时已注册；要赶在面板第一次绑定按钮之前装上。
      installPublicLobbyToggle();
      installFriends();
      installSocial();
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
