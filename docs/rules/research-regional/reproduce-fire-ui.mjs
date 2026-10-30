import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// Run from the shared workspace root; only the report in this directory is written.
const root = process.cwd();
const output = path.join(root, 'outputs/doushisi/docs/rules/research-regional/fire-ui-reproduction.json');
const controllerPath = 'outputs/apk-deep-analysis/modules/hall/CreateRoomUIController.js';
const configPath = 'outputs/apk-deep-analysis/modules/main/FrameGameConfig.js';
let definition;
const storage = new Map();
class Node {
  constructor(name = '') { this.name = name; this.active = true; this.children = []; this.width = 20; this.y = 0; this.components = new Map(); }
  getChildByName(name) {
    let result = this.children.find(child => child.name === name);
    if (!result) { result = new Node(name); this.addChild(result); }
    return result;
  }
  addChild(child, _z, name) { if (name) child.name = name; child.parent = this; this.children.push(child); }
  removeAllChildren() { this.children = []; }
  getComponent(type) {
    if (!this.components.has(type)) {
      let component;
      if (type === cc.Label) component = { string: '', _forceUpdateRenderData() {} };
      else if (type === cc.Toggle) component = { node: this, isChecked: false, check() { this.isChecked = true; }, uncheck() { this.isChecked = false; } };
      else if (type === cc.ScrollView) component = { content: new Node('content'), verticalScrollBar: {}, scrollToTop() {} };
      else throw new Error('Unsupported component');
      this.components.set(type, component);
    }
    return this.components.get(type);
  }
}
const submitted = [];
const cc = {
  _RF: { push() {}, pop() {} }, Class(value) { definition = value; },
  Label: { HorizontalAlign: { LEFT: 0 } }, Toggle: {}, ScrollView: {},
  instantiate(node) { return new Node(node.name); }, winSize: { width: 1334 }, color(...values) { return values; },
  sys: { isBrowser: false, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } },
  mm: { uitools: { restNode() {}, addBtnLister() {} }, framemodel: { shiName: 'Pengshui', xianName: 'Pengshui', areaType: [3] },
    gamefunc: { replaceCity: value => value }, hallserver: { requestCreateRoom(rules, areaType) { submitted.push({ areaType, rules: structuredClone(rules) }); } } },
};
const controllerModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, controllerPath), 'utf8'), { cc })(name => {
  if (name === 'UIController') return {};
  if (name === 'HallEventType') return {};
  if (name.endsWith('/hw_msg')) return { com: { huinan: { server: { proto: { ENAreaType: {} } } } } };
  throw new Error('Unexpected dependency ' + name);
}, controllerModule);
const configModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, configPath), 'utf8'), { cc })(() => { throw new Error('Unexpected config dependency'); }, configModule);
cc.mm.gameconfig = configModule.exports;
const fire = configModule.exports[3][0];
const snapshots = [];
function instance(saved) {
  storage.clear();
  if (saved) storage.set('game_last_room_data', JSON.stringify(saved));
  const views = new Proxy({}, { get(target, key) { return target[key] ??= new Node(key); } });
  return Object.assign(Object.create(definition), { views, _super() {}, toggles: {}, _rules: {}, _scrollview: views['hall_room_center/left/ruleNode'].getComponent(cc.ScrollView), changeCost() {} });
}
function select(game) { game.onClickGameBtn({ node: Object.assign(new Node('fire'), { data: structuredClone(fire) }) }); }
function toggle(game, key, value) {
  const node = game.toggles[key]?.find(item => item.node.groupIndex === value)?.node;
  assert.ok(node, 'Toggle must exist: ' + key + ':' + value);
  game.onClickToggle(node, key);
}
function findEightNode(game) {
  const visit = node => node.children.flatMap(child => [child, ...visit(child)]);
  return visit(game._scrollview.content).find(node => node.children.find(child => child.name === 'label')?.getComponent(cc.Label).string === fire.rule.config_playmethod.config.find(item => item.value === 'bage10tianhu').name);
}
function snapshot(game, scenario) {
  const eight = findEightNode(game);
  assert.ok(eight, 'Eight-tens option must exist');
  game.onClickCreateRoom();
  const value = { scenario, yifupai: game._rules.yifupai, bage10tianhu: game._rules.bage10tianhu,
    pointerPresent: !!game._tspx, eightOptionActive: eight.active, eightCheckboxChecked: !!eight.getChildByName('toggle').getComponent(cc.Toggle).isChecked,
    submittedRules: submitted.at(-1).rules };
  snapshots.push(value);
  return value;
}
const direct = instance();
select(direct);
snapshot(direct, 'Direct selection, default one deck');
toggle(direct, 'yifupai', false);
snapshot(direct, 'Direct selection, switched to two decks');
direct.onClickToggle(findEightNode(direct).getChildByName('toggle'), 'bage10tianhu');
snapshot(direct, 'Direct selection, two decks, unchecked eight-tens');
toggle(direct, 'yifupai', true);
snapshot(direct, 'Direct selection, switched back to one deck');

const savedRules = structuredClone(snapshots[1].submittedRules);
savedRules.gameid = 3;
const saved = instance(savedRules);
saved._lastRoomData = structuredClone(savedRules);
select(saved);
snapshot(saved, 'Direct selection after saved two-deck rules');

const initial = instance();
initial.onLoad();
snapshot(initial, 'Full original onLoad, default one deck');
toggle(initial, 'yifupai', false);
snapshot(initial, 'Full original onLoad, switched to two decks');

assert.equal(snapshots[0].eightOptionActive, false);
assert.equal(snapshots[1].bage10tianhu, true);
assert.equal(snapshots[2].bage10tianhu, true);
assert.equal(snapshots[2].eightCheckboxChecked, false);
assert.equal(snapshots[4].yifupai, true);
assert.equal(snapshots[4].bage10tianhu, true);
assert.equal(snapshots[5].pointerPresent, false);
assert.equal(snapshots[6].eightOptionActive, false);
assert.equal(snapshots[6].bage10tianhu, false);

const source = file => { const bytes = fs.readFileSync(path.join(root, file)); return { file, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; };
const report = { generatedAt: new Date().toISOString(), status: 'original-client-function-reproduction-only',
  scope: 'Runs original extracted controller and config factories with local Cocos node/storage stubs; no server, rendering, asset scripts or network. Full onLoad uses original loadGames. Submitted rules are captured at requestCreateRoom.',
  limitations: 'Node stubs do not reproduce native Cocos lifecycle/events/rendering. Does not establish server validation or deck composition. No changes to original or recovered client.',
  sources: [source(controllerPath), source(configPath)], assertionsPassed: 9, snapshots };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
