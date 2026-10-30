import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(project, '..', '..');
const indexPath = resolve(project, 'docs/rules/research-next/source-index.json');
const index = JSON.parse(await readFile(indexPath, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');

// These anchors are deliberately limited to client-visible evidence. They do not
// authorize a regional engine or establish the missing server-side rules.
const anchors = [
  {
    id: 'client-chi-selects-two',
    source: 'outputs/apk-deep-analysis/modules/dss/dss_gameController.js',
    text: 'EN_COL_TYPE_CHI ? this.select_num = 2',
    boundary: 'client-action-selection',
  },
  {
    id: 'client-choice-selects-one',
    source: 'outputs/apk-deep-analysis/modules/dss/dss_gameController.js',
    text: 'a.isChoice && (this.select_num = 1);',
    boundary: 'client-action-selection',
  },
  {
    id: 'client-fire-eight-tens-label',
    source: 'outputs/apk-deep-analysis/modules/main/FrameGameConfig.js',
    text: 'name: "八个10天胡"',
    boundary: 'client-option-label',
  },
  {
    id: 'client-fire-six-tens-evidence',
    source: 'outputs/apk-deep-analysis/modules/main/FrameGameConfig.js',
    text: '6个10，6个7（4个7加大小王），6个4',
    boundary: 'client-option-tooltip',
  },
  {
    id: 'client-fire-eight-tens-evidence',
    source: 'outputs/apk-deep-analysis/modules/main/FrameGameConfig.js',
    text: '8个10，12个7（8个7加4个大小王），8个4',
    boundary: 'client-option-tooltip',
  },
  {
    id: 'client-lei-bo-action-text',
    source: 'outputs/apk-deep-analysis/modules/dss/dss_gameController.js',
    text: 'e.ownBaKeQiang && (i += "不能抢胡手上去巴的牌、");',
    boundary: 'client-rendered-description',
  },
  {
    id: 'client-lei-bo-play-ui-text',
    source: 'outputs/apk-deep-analysis/modules/main/CommonPlayUIController.js',
    text: 'e.ownBaKeQiang && (t += "不能抢胡手上去巴的牌、");',
    boundary: 'client-rendered-description',
  },
];

const checkedSources = [];
for (const source of [...index.originals, ...index.pages]) {
  const file = resolve(workspace, source.file);
  const bytes = await readFile(file);
  const actual = sha256(bytes);
  if (actual !== source.sha256) throw new Error(`Evidence source drift: ${source.file}`);
  if (bytes.byteLength !== source.bytes && source.bytes !== undefined) {
    throw new Error(`Evidence byte-count drift: ${source.file}`);
  }
  checkedSources.push({ file: source.file, sha256: actual, bytes: bytes.byteLength });
}

const checkedAnchors = [];
for (const anchor of anchors) {
  const file = resolve(workspace, anchor.source);
  const content = await readFile(file, 'utf8');
  if (!content.includes(anchor.text)) throw new Error(`Evidence anchor missing: ${anchor.id}`);
  checkedAnchors.push({ ...anchor, found: true });
}

const report = {
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  status: 'research-only-unapproved',
  sourceIndex: 'docs/rules/research-next/source-index.json',
  checkedSourceCount: checkedSources.length,
  checkedSources,
  checkedAnchors,
  limitations: [
    'Anchors prove extracted client strings and selection branches only.',
    'They do not prove original-server deck, Hu, scoring, settlement, or regional equivalence.',
    'D03, D04 and D05 remain awaiting user confirmation; no gameplay engine is enabled by this report.',
  ],
};
const output = resolve(project, 'docs/rules/research-next/evidence-verification.json');
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: true, checkedSources: checkedSources.length, checkedAnchors: checkedAnchors.length, output }));
