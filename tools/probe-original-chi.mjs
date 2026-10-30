import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '../../..');
const evidence = JSON.parse(await fs.readFile(path.join(root, 'outputs/apk-deep-analysis/rules/algorithm-excerpts.json'), 'utf8'));
const method = evidence.snippets.find(item => item.module === 'dss_gameController' && item.method === '_ntfOperatorChi');
assert.ok(method);
const source = await fs.readFile(path.join(root, method.source));
const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
assert.equal(sourceSha256, evidence.sources.find(item => item.file === method.source).sha256);
assert.ok(source.toString('utf8').includes(method.code));
const cases = [
  { id: 'two-server-candidates', cards: [[105, 109], [105, 209]], expected: { count: 1, choices: [109, 209], sent: [] } },
  { id: 'single-two-card-server-candidate', cards: [[105, 109]], expected: { count: 1, choices: [], sent: [[105, 109]] } },
  { id: 'ui-does-not-validate-complement', cards: [[105, 102]], expected: { count: 1, choices: [], sent: [[105, 102]] } },
];
const results = cases.map(example => {
  const program = `
    const sent = [], selected = [];
    const n = {huinan:{server:{proto:{MsgData:function(){}, HWRequestDoAction:function(){}}}}};
    const cc = {mm:{server:{send:function(message){sent.push(message.hwRequestDoAction.cards);}},
      msgEvent:{HWRequestDoAction:1}, framemodel:{uid:1}}};
    const owner = {views:{'select/gy_word3':{active:false}}, model:{getSelfSeat:()=>1},
      _showSelectCards:function(_, values){selected.push(...values);}};
    const method = ${method.code};
    method.call(owner, 9, {destCard:105, colInfo:cards.map(values=>({cards:values,destCard:105,colType:1}))});
    ({count:owner.select_num, choices:selected, sent});
  `;
  const actual = JSON.parse(JSON.stringify(vm.runInNewContext(program, { cards: structuredClone(example.cards) },
    { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } })));
  assert.deepEqual(actual, example.expected, example.id);
  return { ...example, actual, passed: true };
});
const report = { capturedAt: new Date().toISOString(), source: method.source, sourceSha256, originalLine: method.line,
  method: method.method, scope: 'Original client method with synthetic server candidates. Does not establish that any candidate is legal or that a round can be played.',
  conclusion: 'The dedicated chi UI selects one cards[1] value or forwards the full server candidate. getCardNum(CHI)=2 cannot establish that two held cards are required.',
  cases: results, passed: true };
await fs.writeFile(path.join(root, 'outputs/doushisi/docs/rules/chi-client-evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, cases: results.length, originalLine: method.line, gameplayVerified: false }));
