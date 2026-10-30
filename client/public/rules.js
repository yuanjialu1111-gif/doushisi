(function () {
  'use strict';

  var EXPECTED_KEYS = [
    '4:0', '5:0', '6:0', '7:0', '8:0', '9:0', '10:0', '11:0',
    '12:0', '14:0', '15:0', '16:0', '19:0', '20:0', '21:0',
    '22:0', '23:0', '24:0', '25:0', '26:0', '27:0',
  ];

  var TOPICS = [
    { id: 'deck', label: '牌组与特殊牌', keys: ['deck'], note: '发布规则书中的牌组摘要。' },
    { id: 'deal', label: '庄家与发牌', keys: [], note: '批准规则书未单列庄家与发牌摘要。' },
    { id: 'turns', label: '摸打、偷牌与补牌', keys: [], note: '批准规则书未单列摸打、偷牌与补牌摘要。' },
    { id: 'melds', label: '吃碰杠', keys: [], note: '批准规则书未单列吃碰杠操作摘要。' },
    { id: 'priority', label: '响应优先级', keys: [], note: '批准规则书未单列响应优先级摘要。' },
    { id: 'win', label: '判胡', keys: ['win'], note: '发布规则书中的成牌与判胡摘要。' },
    { id: 'colors', label: '红黑点', keys: [], related: /红|黑|red|black|point/i, note: '批准规则书未单列红黑点摘要。' },
    { id: 'fan', label: '番型与计分', keys: ['scoring'], note: '发布规则书中的番型、计分或结构分摘要。' },
    { id: 'payments', label: '付款', keys: ['payments'], note: '发布规则书中的付款与分摊摘要。' },
    { id: 'draw', label: '流局', keys: [], note: '批准规则书未单列流局摘要。' },
    { id: 'chajiao', label: '查叫', keys: [], note: '批准规则书未单列查叫摘要。' },
    { id: 'autoplay', label: '托管', keys: [], note: '批准规则书未单列托管摘要。' },
    { id: 'declaration', label: '报听与声明', keys: ['declaration'], note: '发布规则书中的声明与听牌锁定摘要。' },
    { id: 'gold-hook', label: '金钩钓', keys: ['goldHook'], note: '发布规则书中的金钩钓摘要。' },
    { id: 'piao', label: '漂分', keys: ['piao'], note: '发布规则书中的漂分摘要。' },
  ];

  var KNOWN_SUMMARY_KEYS = Object.create(null);
  TOPICS.forEach(function (topic) {
    topic.keys.forEach(function (key) { KNOWN_SUMMARY_KEYS[key] = true; });
  });

  var state = {
    configurations: [],
    filtered: [],
    selectedKey: '',
    compareKey: '',
    query: '',
  };

  var elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function create(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function summaryText(rulebook, keys) {
    var summary = rulebook && rulebook.summary ? rulebook.summary : {};
    for (var i = 0; i < keys.length; i += 1) {
      var value = summary[keys[i]];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
  }

  function relatedSummaryText(rulebook, pattern) {
    var summary = rulebook && rulebook.summary ? rulebook.summary : {};
    var keys = Object.keys(summary);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var value = summary[key];
      if (typeof value === 'string' && pattern.test(key + ' ' + value)) return value;
    }
    return '';
  }

  function formatValue(value) {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    try { return JSON.stringify(value); } catch (_error) { return String(value); }
  }

  function configMatches(config, query) {
    if (!query) return true;
    var rulebook = config.rulebook || {};
    var haystack = [config.key, config.directory, rulebook.title, rulebook.ruleVersion, rulebook.status,
      rulebook.basis].concat(Object.keys(rulebook.summary || {}), Object.values(rulebook.summary || {}))
      .filter(function (value) { return typeof value === 'string'; }).join(' ').toLowerCase();
    return haystack.indexOf(query.toLowerCase()) !== -1;
  }

  function findConfig(key) {
    for (var i = 0; i < state.configurations.length; i += 1) {
      if (state.configurations[i].key === key) return state.configurations[i];
    }
    return null;
  }

  function setStatus(message, kind) {
    elements.dataState.textContent = message;
    elements.dataState.className = 'source-state' + (kind ? ' is-' + kind : '');
  }

  function fillSelect(select, includeEmpty) {
    clear(select);
    if (includeEmpty) {
      var empty = create('option', '', '不比较');
      empty.value = '';
      select.appendChild(empty);
    }
    state.configurations.forEach(function (config) {
      var option = create('option', '', config.key + ' · ' + (config.rulebook.title || ''));
      option.value = config.key;
      select.appendChild(option);
    });
  }

  function renderConfigList() {
    clear(elements.configList);
    elements.configCount.textContent = state.filtered.length + ' / ' + state.configurations.length;
    if (!state.filtered.length) {
      elements.configList.appendChild(create('p', 'empty-list', '没有匹配的配置'));
      return;
    }
    state.filtered.forEach(function (config) {
      var item = create('button', 'config-item');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', config.key === state.selectedKey ? 'true' : 'false');
      item.dataset.key = config.key;
      item.appendChild(create('span', 'config-item-key', config.key));
      var copy = create('span');
      copy.appendChild(create('span', 'config-item-name', config.rulebook.title || config.key));
      copy.appendChild(create('span', 'config-item-version', config.rulebook.ruleVersion || ''));
      item.appendChild(copy);
      item.addEventListener('click', function () { selectConfig(config.key); });
      elements.configList.appendChild(item);
    });
  }

  function renderCoverageBadges(rulebook) {
    clear(elements.coverageBadges);
    var coverage = Array.isArray(rulebook.requiredCoverage) ? rulebook.requiredCoverage : [];
    if (!coverage.length) {
      elements.coverageBadges.appendChild(create('span', 'coverage-badge', '未列覆盖项'));
      return;
    }
    coverage.forEach(function (item) {
      elements.coverageBadges.appendChild(create('span', 'coverage-badge', item));
    });
  }

  function renderTopics(rulebook) {
    clear(elements.topicGrid);
    TOPICS.forEach(function (topic) {
      var value = summaryText(rulebook, topic.keys);
      var source = topic.keys.join(', ');
      if (!value && topic.related) {
        value = relatedSummaryText(rulebook, topic.related);
        source = value ? 'summary（关联原文）' : '';
      }
      var card = create('article', 'topic-card ' + (value ? 'has-summary' : 'no-summary'));
      var header = create('header');
      header.appendChild(create('h3', '', topic.label));
      header.appendChild(create('span', 'topic-state', value ? '摘要' : '待开房规则'));
      card.appendChild(header);
      card.appendChild(create('p', '', value || (topic.note + ' 请以开房规则与结算为准。')));
      if (value && source) card.appendChild(create('div', 'summary-source', '来源：summary.' + source));
      elements.topicGrid.appendChild(card);
    });
  }

  function renderOtherSummary(rulebook) {
    clear(elements.otherSummaryList);
    var summary = rulebook.summary || {};
    var keys = Object.keys(summary).filter(function (key) { return !KNOWN_SUMMARY_KEYS[key]; });
    elements.otherSummary.hidden = keys.length === 0;
    keys.forEach(function (key) {
      var item = create('div', 'other-summary-item');
      item.appendChild(create('strong', '', 'summary.' + key));
      item.appendChild(create('p', '', formatValue(summary[key])));
      elements.otherSummaryList.appendChild(item);
    });
  }

  function renderRule() {
    var config = findConfig(state.selectedKey);
    if (!config) return;
    var rulebook = config.rulebook || {};
    elements.configKey.textContent = config.key;
    elements.configStatus.textContent = rulebook.status === 'approved' ? '已批准' : (rulebook.status || '未知状态');
    elements.configTitle.textContent = rulebook.title || config.key;
    elements.configVersion.textContent = rulebook.ruleVersion || '未标注';
    renderCoverageBadges(rulebook);
    renderTopics(rulebook);
    renderOtherSummary(rulebook);
  }

  function renderComparison() {
    var left = findConfig(state.selectedKey);
    var right = findConfig(state.compareKey);
    if (!left || !right || left.key === right.key) {
      elements.comparisonSection.hidden = true;
      return;
    }
    elements.comparisonSection.hidden = false;
    elements.comparisonCaption.textContent = left.key + ' ↔ ' + right.key;
    clear(elements.comparisonHead);
    elements.comparisonHead.appendChild(create('span', '', '字段'));
    elements.comparisonHead.appendChild(create('span', '', left.key));
    elements.comparisonHead.appendChild(create('span', '', right.key));

    clear(elements.comparisonList);
    var leftSummary = left.rulebook.summary || {};
    var rightSummary = right.rulebook.summary || {};
    var keys = Object.keys(leftSummary).concat(Object.keys(rightSummary)).filter(function (key, index, all) {
      return all.indexOf(key) === index;
    }).sort();
    keys.forEach(function (key) {
      var leftValue = formatValue(leftSummary[key]);
      var rightValue = formatValue(rightSummary[key]);
      var different = leftValue !== rightValue;
      var row = create('div', 'comparison-row' + (different ? ' is-different' : ''));
      row.appendChild(create('div', 'comparison-field', 'summary.' + key));
      var leftCell = create('div', 'comparison-value' + (leftValue ? '' : ' is-empty'), leftValue || '未提供');
      var rightCell = create('div', 'comparison-value' + (rightValue ? '' : ' is-empty'), rightValue || '未提供');
      row.appendChild(leftCell);
      row.appendChild(rightCell);
      elements.comparisonList.appendChild(row);
    });
  }

  function updateUrl() {
    if (!window.history || !window.history.replaceState) return;
    var params = new URLSearchParams();
    if (state.selectedKey) params.set('config', state.selectedKey);
    if (state.compareKey) params.set('compare', state.compareKey);
    if (state.query) params.set('q', state.query);
    var query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? '?' + query : ''));
  }

  function render() {
    renderConfigList();
    renderRule();
    renderComparison();
    updateUrl();
  }

  function selectConfig(key) {
    if (!findConfig(key)) return;
    state.selectedKey = key;
    elements.configSelect.value = key;
    render();
  }

  function readInitialState() {
    var params = new URLSearchParams(window.location.search);
    var requested = params.get('config') || '';
    var compare = params.get('compare') || '';
    state.query = params.get('q') || '';
    if (findConfig(requested)) state.selectedKey = requested;
    if (findConfig(compare) && compare !== state.selectedKey) state.compareKey = compare;
  }

  function wireControls() {
    elements.configSelect.addEventListener('change', function () { selectConfig(elements.configSelect.value); });
    elements.compareSelect.addEventListener('change', function () {
      state.compareKey = elements.compareSelect.value;
      renderComparison();
      updateUrl();
    });
    elements.searchInput.addEventListener('input', function () {
      state.query = elements.searchInput.value.trim();
      state.filtered = state.configurations.filter(function (config) { return configMatches(config, state.query); });
      renderConfigList();
      updateUrl();
    });
    elements.resetButton.addEventListener('click', function () {
      state.query = '';
      state.compareKey = '';
      state.filtered = state.configurations.slice();
      elements.searchInput.value = '';
      elements.compareSelect.value = '';
      selectConfig(state.configurations[0].key);
    });
  }

  function validateSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.configurations)) throw new Error('规则数据缺少 configurations。');
    var keys = snapshot.configurations.map(function (config) { return config.key; });
    if (keys.length !== EXPECTED_KEYS.length || EXPECTED_KEYS.some(function (key) { return keys.indexOf(key) === -1; })) {
      throw new Error('规则数据不是完整的 21 项发布配置。');
    }
    snapshot.configurations.forEach(function (config) {
      if (!config.rulebook || config.rulebook.status !== 'approved' || config.rulebook.basis !== 'user-approved') {
        throw new Error(config.key + ' 不是已批准发布规则书。');
      }
      if (config.rulebook.variantKey !== config.key) throw new Error(config.key + ' 的 variantKey 不匹配。');
    });
  }

  function initialize(snapshot) {
    validateSnapshot(snapshot);
    state.configurations = snapshot.configurations.slice().sort(function (left, right) {
      return EXPECTED_KEYS.indexOf(left.key) - EXPECTED_KEYS.indexOf(right.key);
    });
    state.filtered = state.configurations.slice();
    readInitialState();
    if (!state.selectedKey) state.selectedKey = state.configurations[0].key;
    fillSelect(elements.configSelect, false);
    fillSelect(elements.compareSelect, true);
    elements.configSelect.value = state.selectedKey;
    elements.compareSelect.value = state.compareKey;
    elements.searchInput.value = state.query;
    elements.configSelect.disabled = false;
    elements.compareSelect.disabled = false;
    elements.searchInput.disabled = false;
    elements.resetButton.disabled = false;
    elements.loadingPanel.hidden = true;
    elements.ruleView.hidden = false;
    setStatus('已载入 ' + state.configurations.length + ' 项发布规则书摘要', 'ready');
    wireControls();
    render();
  }

  function showError(error) {
    elements.loadingPanel.hidden = true;
    elements.errorPanel.hidden = false;
    elements.errorMessage.textContent = error && error.message ? error.message : '无法读取规则数据。';
    setStatus('发布规则数据不可用', 'error');
  }

  function boot() {
    elements = {
      dataState: byId('data-state'),
      configSelect: byId('config-select'),
      compareSelect: byId('compare-select'),
      searchInput: byId('search-input'),
      resetButton: byId('reset-button'),
      configList: byId('config-list'),
      configCount: byId('config-count'),
      loadingPanel: byId('loading-panel'),
      errorPanel: byId('error-panel'),
      errorMessage: byId('error-message'),
      ruleView: byId('rule-view'),
      configKey: byId('config-key'),
      configStatus: byId('config-status'),
      configTitle: byId('config-title'),
      configVersion: byId('config-version'),
      coverageBadges: byId('coverage-badges'),
      topicGrid: byId('topic-grid'),
      otherSummary: byId('other-summary'),
      otherSummaryList: byId('other-summary-list'),
      comparisonSection: byId('comparison-section'),
      comparisonCaption: byId('comparison-caption'),
      comparisonHead: byId('comparison-head'),
      comparisonList: byId('comparison-list'),
    };
    fetch('rules-data.json', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('无法读取 rules-data.json（HTTP ' + response.status + '）。');
        return response.json();
      })
      .then(initialize)
      .catch(showError);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
