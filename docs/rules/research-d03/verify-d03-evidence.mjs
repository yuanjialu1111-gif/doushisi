import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This is an evidence checker, not a rules implementation.  It only hashes and
// reads original extracted files; it does not execute Cocos code or use the network.
const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '../../../../..');
const output = resolve(here, 'evidence-verification.json');
const sourceApk = process.env.D03_APK_PATH
  ?? 'E:/codex/xwechat_files/wxid_9q7z8f89g9fg12_dd9a/msg/file/2026-09/296902a8-126e-4274-859f-3068efa490d6.apk.1.1';

const sourceApkSha256 = 'a9e8e06e2ce5a70b125d6d166df7de16e655e6affd793d8a8f923d7d70549d5f';
const sources = [
  {
    file: 'work/apk/assets/assets/dss/index.js',
    sha256: '52680e5a2fb2c2934f4ae0829ad1604c53a7fe066939144e7c0d070c929838be',
  },
  {
    file: 'work/apk/assets/assets/main/index.js',
    sha256: 'e99623ba8f071a6692df390c612e622f67f0c3465097a7332b2e06231130cb97',
  },
  {
    file: 'work/apk/assets/assets/dss/config.json',
    sha256: '25f64acb7fd4ed3c13fee0c827945e041005fa2c7ebf29513601fb5f3927f102',
  },
  {
    file: 'work/apk/assets/assets/dss/import/7c/7c953d7a-1743-4d67-afb2-3c28aa7df5db.json',
    sha256: 'd0b69982816849dfaf28d703579580ae37e2fb1802592061012eef40c988f11b',
  },
  {
    file: 'outputs/apk-deep-analysis/modules/dss/dss_gameModel.js',
    sha256: '3d4b87d7b7201fe12a0579f260d4d0c9f0ea0196e96ea1e4d7851c78936452da',
  },
  {
    file: 'outputs/apk-deep-analysis/modules/dss/dss_tools.js',
    sha256: 'd8a9398b785971520461a36e89d5006d5ea3e28914fcef99a7360610818ac308',
  },
  {
    file: 'outputs/apk-deep-analysis/modules/main/FrameGameConfig.js',
    sha256: 'd3bd17bf6ad48f75c7f82c0de158d597f5d1b5346b7991eedcebf850f20c66b4',
  },
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const workspacePath = file => resolve(workspace, file);
const displayPath = file => relative(workspace, file).replaceAll('\\', '/');

async function readChecked(source) {
  const file = workspacePath(source.file);
  const bytes = await readFile(file);
  const actual = sha256(bytes);
  if (actual !== source.sha256) {
    throw new Error(`Source drift: ${source.file}; expected ${source.sha256}, got ${actual}`);
  }
  return { ...source, bytes: bytes.byteLength, actualSha256: actual, content: bytes.toString('utf8') };
}

function anchor(source, id, text, occurrence = 0) {
  let index = -1;
  let searchFrom = 0;
  for (let found = 0; found <= occurrence; found += 1) {
    index = source.content.indexOf(text, searchFrom);
    if (index < 0) throw new Error(`Missing evidence anchor ${id} in ${source.file}`);
    searchFrom = index + text.length;
  }
  return {
    id,
    file: source.file,
    occurrence,
    line: source.content.slice(0, index).split('\n').length,
    utf8ByteOffset: Buffer.byteLength(source.content.slice(0, index), 'utf8'),
    text,
  };
}

function visit(value, visitor) {
  if (Array.isArray(value)) {
    visitor(value);
    for (const item of value) visit(item, visitor);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) visit(item, visitor);
  }
}

function expectedOrdinaryFaceNames() {
  return Array.from({ length: 4 }, (_, suit) => (
    Array.from({ length: 13 }, (_, rank) => `${suit + 1}${String(rank + 1).padStart(2, '0')}`)
  )).flat();
}

const checked = await Promise.all(sources.map(readChecked));
const byFile = new Map(checked.map(item => [item.file, item]));
const dss = byFile.get('work/apk/assets/assets/dss/index.js');
const main = byFile.get('work/apk/assets/assets/main/index.js');
const model = byFile.get('outputs/apk-deep-analysis/modules/dss/dss_gameModel.js');
const frameConfig = byFile.get('outputs/apk-deep-analysis/modules/main/FrameGameConfig.js');
const atlas = JSON.parse(byFile.get('work/apk/assets/assets/dss/import/7c/7c953d7a-1743-4d67-afb2-3c28aa7df5db.json').content);

const arrays = [];
visit(atlas, value => arrays.push(value));
const assetNames = arrays.find(value => (
  value.includes('101') && value.includes('413') && value.includes('1001') && value.includes('1012')
));
if (!assetNames) throw new Error('Unable to find card SpriteAtlas names');

const ordinaryFaceNames = assetNames.filter(name => /^(?:[1-4](?:0[1-9]|1[0-3]))$/.test(name));
const expectedOrdinary = expectedOrdinaryFaceNames();
if (ordinaryFaceNames.length !== 52 || ordinaryFaceNames.join(',') !== expectedOrdinary.join(',')) {
  throw new Error(`Unexpected ordinary face namespace: ${ordinaryFaceNames.join(',')}`);
}
const specialSpriteNames = [ '1001', '1002', '1003', '1004', '1007', '1012' ];
for (const name of specialSpriteNames) {
  if (!assetNames.includes(name)) throw new Error(`Missing special SpriteAtlas name ${name}`);
}
const numericSpriteNames = assetNames.filter(name => /^\d+$/.test(name));
if (numericSpriteNames.length !== 59) throw new Error(`Expected 59 numeric SpriteAtlas names, got ${numericSpriteNames.length}`);

const anchors = [
  anchor(frameConfig, 'fire-game-configuration', '3: [ {\nname: "火十四",\ngameId: 3,'),
  anchor(frameConfig, 'fire-one-deck-tooltip', 'wenhao: "6个10，6个7（4个7加大小王），6个4"'),
  anchor(frameConfig, 'fire-two-deck-tooltip', 'wenhao: "8个10，12个7（8个7加4个大小王），8个4"'),
  anchor(frameConfig, 'fire-white-card-wild-tooltip', 'wenhao: "白皮当癞子可以替换成任意牌"'),
  anchor(frameConfig, 'fire-eight-tens-tooltip', 'wenhao: "庄家起手8个10天胡算100分"', 1),
  anchor(dss, 'special-card-value-display-helper', 'return 1001 == Number(e) ? 14 : 1002 == Number(e) ? 15 : 1003 == Number(e) ? 16 : Number(e) % 100;'),
  anchor(dss, 'salt-yin-display-substitution', 'return t != s.EN_AREA_TYPE_PKDDS_ZTYJ || !a || 107 != e && 207 != e && 307 != e && 407 != e ? cc.mm.dss.resmap.get(String(e)) : cc.mm.dss.resmap.get(String(1004));'),
  anchor(model, 'server-card-info-populates-client-counts', 'for (var i in t) this.tipsCards[t[i].cardValue] = t[i].num;'),
  anchor(main, 'card-info-protobuf-fields', 'e.prototype.cardValue = 0;\ne.prototype.num = 0;'),
];

const archive = existsSync(sourceApk)
  ? await readFile(sourceApk)
  : null;
if (archive && sha256(archive) !== sourceApkSha256) {
  throw new Error(`Original APK hash mismatch at ${sourceApk}`);
}

const report = {
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  status: 'evidence-insufficient-for-d03-deck-definition',
  scope: 'Static, local APK evidence only. No original client module was executed, no server was contacted, and no rules or engines were changed.',
  originalApk: {
    path: sourceApk,
    expectedSha256: sourceApkSha256,
    verified: Boolean(archive),
    bytes: archive?.byteLength ?? null,
  },
  checkedSources: checked.map(({ content, ...source }) => source),
  anchors,
  spriteAtlas: {
    file: 'work/apk/assets/assets/dss/import/7c/7c953d7a-1743-4d67-afb2-3c28aa7df5db.json',
    numericSpriteNameCount: numericSpriteNames.length,
    ordinaryFaceNameCount: ordinaryFaceNames.length,
    ordinaryFaceNames,
    specialSpriteNames,
  },
  findings: [
    'The client ships 52 ordinary face-resource names: 101–113, 201–213, 301–313, and 401–413.',
    'The client also ships six special numeric sprite names: 1001, 1002, 1003, 1004, 1007, and 1012.',
    'The Fire Fourteen room UI contains one-deck/two-deck tooltips, a white-card-as-wildcard tooltip, and an eight-tens opening-hand tooltip.',
    'The gameplay client receives per-card counts as server-originated CardInfo(cardValue, num) and uses them for its remaining-card display.',
    'For one area option, the client substitutes four normal 7 resources with sprite 1004 only while rendering; it does not change the card input value.',
  ],
  nonFindings: [
    'No observed GameStart.cardInfo payload records the card values or multiplicities selected by an original server.',
    'No static source anchor enumerates a complete physical deck, total deck size, or the multiplicity of each ordinary or special card for every room configuration.',
    'The SpriteAtlas is a display-resource namespace. It cannot establish a physical card count, wildcard legality outside the labelled option, or a regional deck definition.',
    'The D03 candidates “52 ordinary physical cards plus additions” and “Ya’an default 62 cards” remain unverified and must not be registered as original rules from this evidence.',
  ],
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  passed: true,
  status: report.status,
  ordinaryFaceNameCount: ordinaryFaceNames.length,
  numericSpriteNameCount: numericSpriteNames.length,
  anchors: anchors.length,
  output: displayPath(output),
}));
