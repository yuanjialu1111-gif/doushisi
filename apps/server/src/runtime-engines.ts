import { EngineRegistry, type RuleEngine } from './engines.js';
import { createQionglaiEngine } from './game/qionglai-engine.js';
import { createYaanEngine } from './game/yaan-engine.js';
import { createXinjinEngine } from './game/xinjin-engine.js';
import { createAnyueEngine } from './game/anyue-engine.js';
import { createPujiangEngine } from './game/pujiang-engine.js';
import { createAbaEngine } from './game/aba-engine.js';
import { createScoreRegionEngine } from './game/score-region-engine.js';

export interface EvidenceArtifact { path: string; sha256: string }
export interface RuntimeEngineEntry {
  engine: RuleEngine;
  rulebook: EvidenceArtifact;
  cases: EvidenceArtifact;
}

// Entries are added only after a concrete rulebook and reference cases exist.
// Keep this list shared by the application and the release verifier.
export const runtimeEngineEntries: readonly RuntimeEngineEntry[] = Object.freeze([
  {
    engine: createYaanEngine('fb7d3f468ffe800f3332d7a6df19c379b74521474cf1943a2272115bbd82e2fd'),
    rulebook: { path: 'docs/rules/release/6-0/rulebook.json',
      sha256: '4577a8b12184d50df7833b149309f219223578465be8ea3b7f49c81e8786dd12' },
    cases: { path: 'docs/rules/release/6-0/cases.json',
      sha256: 'fb7d3f468ffe800f3332d7a6df19c379b74521474cf1943a2272115bbd82e2fd' },
  },
  {
    engine: createQionglaiEngine('155f1d2e8740e2c7632f087fd95f1f4aef6395f308adb3729e78398254ee11df'),
    rulebook: { path: 'docs/rules/release/8-0/rulebook.json',
      sha256: '636f096fe42b5d5b11a2c8ba9484a840b59d5d6cfe3d2fecb72f8bae0c19fb33' },
    cases: { path: 'docs/rules/release/8-0/cases.json',
      sha256: '155f1d2e8740e2c7632f087fd95f1f4aef6395f308adb3729e78398254ee11df' },
  },
  {
    engine: createXinjinEngine('39b1ab60f6ec0f451884346a0273449a5fe4872eb048ef3c7a4f20c0b521d06d'),
    rulebook: { path: 'docs/rules/release/4-0/rulebook.json',
      sha256: '414c826388655a4448134b20fecacd29a7a22410e61b8680c1426cc31b181ddf' },
    cases: { path: 'docs/rules/release/4-0/cases.json',
      sha256: '39b1ab60f6ec0f451884346a0273449a5fe4872eb048ef3c7a4f20c0b521d06d' },
  },
  {
    engine: createAnyueEngine('439618aec9ac83fbd0e72f4fd95e0cea0d37d72f14023d7daa1be5423d67aa09'),
    rulebook: { path: 'docs/rules/release/5-0/rulebook.json',
      sha256: 'd7d37a4d95cbf75e5d053f3e35f914e03da2aa17ca42e3dca589c5d72b56b9e8' },
    cases: { path: 'docs/rules/release/5-0/cases.json',
      sha256: '439618aec9ac83fbd0e72f4fd95e0cea0d37d72f14023d7daa1be5423d67aa09' },
  },
  {
    engine: createPujiangEngine('39f2924429452917ca952b757606f87c4d94fddb1aeb74c21db9a8f5f1dea540'),
    rulebook: { path: 'docs/rules/release/7-0/rulebook.json',
      sha256: '9bcf3a7e4eaeb218a3a3b96881a35a524f8844e8e6fa9200234830ad9fae5694' },
    cases: { path: 'docs/rules/release/7-0/cases.json',
      sha256: '39f2924429452917ca952b757606f87c4d94fddb1aeb74c21db9a8f5f1dea540' },
  },
  {
    engine: createAbaEngine('c8207b99490ee80e4f5c8373179850b8799c40551637c542a1beb0a7355ddda9', undefined, '9:0'),
    rulebook: { path: 'docs/rules/release/9-0/rulebook.json',
      sha256: '40f2f34da0f242deb165ac4b4d113680ddb966ccdb40bf6fa9c7a0a11e83922f' },
    cases: { path: 'docs/rules/release/9-0/cases.json',
      sha256: 'c8207b99490ee80e4f5c8373179850b8799c40551637c542a1beb0a7355ddda9' },
  },
  {
    engine: createAbaEngine('ce34b81bacd94d67c877eff97122dc04f56d3c43f808188693454efdd2378bee', undefined, '10:0'),
    rulebook: { path: 'docs/rules/release/10-0/rulebook.json',
      sha256: 'eb97fe503e5518f090c0f5362e4bda129ab334ae74d4a60475b9cc8dad307cbb' },
    cases: { path: 'docs/rules/release/10-0/cases.json',
      sha256: 'ce34b81bacd94d67c877eff97122dc04f56d3c43f808188693454efdd2378bee' },
  },
  {
    engine: createAbaEngine('80d562b3b22a7920fca148e4082ec12d73185d50a59bdbacd299ec45615745d6', undefined, '11:0'),
    rulebook: { path: 'docs/rules/release/11-0/rulebook.json',
      sha256: 'aa5543f1b2fe0ba25360f406af1dd7d52c77f3e5b80f78f994326c87a31aa5e2' },
    cases: { path: 'docs/rules/release/11-0/cases.json',
      sha256: '80d562b3b22a7920fca148e4082ec12d73185d50a59bdbacd299ec45615745d6' },
  },
  {
    engine: createAbaEngine('15f874b48c9e18838ada7c64b17e7453fc4344f8a0fc155b2ea2c08e985ea490', undefined, '12:0'),
    rulebook: { path: 'docs/rules/release/12-0/rulebook.json',
      sha256: '15f94d1c1632fcd5c2d3cd2ec0e421f2653192523dc1390bb8113789fa4a855d' },
    cases: { path: 'docs/rules/release/12-0/cases.json',
      sha256: '15f874b48c9e18838ada7c64b17e7453fc4344f8a0fc155b2ea2c08e985ea490' },
  },
  {
    engine: createScoreRegionEngine('f7c657b3bec37948a586329d58c75932d76765dd8e4a3761eb8abaedbb323596', '14:0'),
    rulebook: { path: 'docs/rules/release/14-0/rulebook.json',
      sha256: '32858d686f456f8d3f4ccff7e2d926428c306a5659942de18e809cbe5d65e2f4' },
    cases: { path: 'docs/rules/release/14-0/cases.json',
      sha256: 'f7c657b3bec37948a586329d58c75932d76765dd8e4a3761eb8abaedbb323596' },
  },
  {
    engine: createScoreRegionEngine('0058e9622b27326a61a1d428d26948a8ba184188396a7d522fe7eeb1e71a495a', '15:0'),
    rulebook: { path: 'docs/rules/release/15-0/rulebook.json',
      sha256: '21852af544f3e7dd7d8ebfd08057b62f85ff9b99cf428ffc2bf2ba6ae1dcb474' },
    cases: { path: 'docs/rules/release/15-0/cases.json',
      sha256: '0058e9622b27326a61a1d428d26948a8ba184188396a7d522fe7eeb1e71a495a' },
  },
  {
    engine: createScoreRegionEngine('fd0c03e36bd8c8c403c6d19b7dde4cc5ee4dcc5ca51f5bd4f8affdbabedb8adf', '16:0'),
    rulebook: { path: 'docs/rules/release/16-0/rulebook.json',
      sha256: '6050996b4cf7dd4e40190b8e10d941a698fb7ea9020303c720879a2e9aeb177d' },
    cases: { path: 'docs/rules/release/16-0/cases.json',
      sha256: 'fd0c03e36bd8c8c403c6d19b7dde4cc5ee4dcc5ca51f5bd4f8affdbabedb8adf' },
  },
  {
    engine: createScoreRegionEngine('59053a0b8f569439d62f58265b8c0ac7b956557f2127154f96a3427bc3487310', '19:0'),
    rulebook: { path: 'docs/rules/release/19-0/rulebook.json',
      sha256: 'b54695575a9bdcc83fa9bb9127b37e24ae6c936ec748a049df103486a5af6d11' },
    cases: { path: 'docs/rules/release/19-0/cases.json',
      sha256: '59053a0b8f569439d62f58265b8c0ac7b956557f2127154f96a3427bc3487310' },
  },
  {
    engine: createScoreRegionEngine('9da2603d07d2778e4c3fc2ade9c470cee8d422b843801eb67c8060a864fdf8af', '20:0'),
    rulebook: { path: 'docs/rules/release/20-0/rulebook.json',
      sha256: '410e3768853fd18cb63dcbb7f0b8c1546677918a67760d1be1618dc5e1ad06b7' },
    cases: { path: 'docs/rules/release/20-0/cases.json',
      sha256: '9da2603d07d2778e4c3fc2ade9c470cee8d422b843801eb67c8060a864fdf8af' },
  },
  {
    engine: createScoreRegionEngine('c616fbab43cbffb5545e2d2f3f853ed10d54199aa06945b14e08e0b785b66b60', '21:0'),
    rulebook: { path: 'docs/rules/release/21-0/rulebook.json',
      sha256: '8aaf6657215408b58e87a77f5b4389704112d2dbee653d3cdb77fd4c5e00ca70' },
    cases: { path: 'docs/rules/release/21-0/cases.json',
      sha256: 'c616fbab43cbffb5545e2d2f3f853ed10d54199aa06945b14e08e0b785b66b60' },
  },
  {
    engine: createScoreRegionEngine('75d38553601518f87b87b1791e95bcac85f386cc72cd6a59a41781b706d4ed7c', '22:0'),
    rulebook: { path: 'docs/rules/release/22-0/rulebook.json',
      sha256: 'df8d31735085eb829995ef12f9c58bad11119690840c6e2b6844358ba82a309f' },
    cases: { path: 'docs/rules/release/22-0/cases.json',
      sha256: '75d38553601518f87b87b1791e95bcac85f386cc72cd6a59a41781b706d4ed7c' },
  },
  {
    engine: createScoreRegionEngine('58b98066a613d5cfa1a1c0ceecd2370e44e55e452bcc58985f38693f27ac63aa', '23:0'),
    rulebook: { path: 'docs/rules/release/23-0/rulebook.json',
      sha256: 'd82faa4951ba433fc76ec3ac4f050f07968c0ee8bacf95e42139fc30a140eaa2' },
    cases: { path: 'docs/rules/release/23-0/cases.json',
      sha256: '58b98066a613d5cfa1a1c0ceecd2370e44e55e452bcc58985f38693f27ac63aa' },
  },
  {
    engine: createScoreRegionEngine('94c9a59b44bb35517bd4c2df29b197e56219fa37318b5cd9fbd45d12dc2e060e', '24:0'),
    rulebook: { path: 'docs/rules/release/24-0/rulebook.json',
      sha256: '4a0fca6d331deaa3d5849e1bbc9a2d700e12f6705993f8f85d7007dba61efbf9' },
    cases: { path: 'docs/rules/release/24-0/cases.json',
      sha256: '94c9a59b44bb35517bd4c2df29b197e56219fa37318b5cd9fbd45d12dc2e060e' },
  },
  {
    engine: createScoreRegionEngine('1f986926e2720e8f89dc33a729801457b391f36d353e0b338961637e6a11b6c6', '25:0'),
    rulebook: { path: 'docs/rules/release/25-0/rulebook.json',
      sha256: '5e5e5e43e5ff8f7070125224baa5200d844588a580cdd5c6aa7ef8d861e7d2ee' },
    cases: { path: 'docs/rules/release/25-0/cases.json',
      sha256: '1f986926e2720e8f89dc33a729801457b391f36d353e0b338961637e6a11b6c6' },
  },
  {
    engine: createScoreRegionEngine('0da337ca1df4907b8e13842b7fb0fc7b25a52e0a73fcaed8ca06c55668c88944', '26:0'),
    rulebook: { path: 'docs/rules/release/26-0/rulebook.json',
      sha256: '852b3aa8e72571e1736f9d9b7826d31201c0b4de82decf54b45928ceccc67139' },
    cases: { path: 'docs/rules/release/26-0/cases.json',
      sha256: '0da337ca1df4907b8e13842b7fb0fc7b25a52e0a73fcaed8ca06c55668c88944' },
  },
  {
    engine: createScoreRegionEngine('c4a3b3cc360b5b4d0d3a4ab7a0010e3416b406aa16bb07450578a6da657b8aae', '27:0'),
    rulebook: { path: 'docs/rules/release/27-0/rulebook.json',
      sha256: 'c9b1a7d61150006b91d233c41d258fbeebcf63b995d7d35ffa23b801a3a4a96e' },
    cases: { path: 'docs/rules/release/27-0/cases.json',
      sha256: 'c4a3b3cc360b5b4d0d3a4ab7a0010e3416b406aa16bb07450578a6da657b8aae' },
  },
]);

export function createRuntimeEngineRegistry(): EngineRegistry {
  return new EngineRegistry(runtimeEngineEntries.map(entry => entry.engine));
}

/**
 * Development-only preview registry. It is NOT release evidence and is kept
 * empty while every released key is already present in `runtimeEngineEntries`.
 * A key in the production registry must never be classified as preview-only.
 * Enable explicitly with `pnpm preview` for local play testing only. Production
 * entry points must never derive this registry from an environment variable.
 */
const previewEngineBuilders: Readonly<Record<string, () => RuleEngine>> = Object.freeze({});

function assertPreviewKeyIsNotRegistered(key: string): void {
  if (runtimeEngineEntries.some(entry => entry.engine.variantKey === key)) {
    throw new Error(`Preview engine key is already in the production registry: ${key}`);
  }
}

export const previewEngineKeys: readonly string[] = Object.freeze([]);

export function createPreviewEngineRegistry(): EngineRegistry {
  return new EngineRegistry(previewEngineKeys.map(key => {
    assertPreviewKeyIsNotRegistered(key);
    const create = previewEngineBuilders[key];
    if (!create) throw new Error(`No development preview engine is defined for ${key}`);
    return create();
  }));
}

export function createConfiguredEngineRegistry(): EngineRegistry {
  return createRuntimeEngineRegistry();
}
