import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../../client/public/runtime-config.js', import.meta.url), 'utf8');
for (const origin of ['http://192.168.0.100:3000', 'http://127.0.0.1:52741', 'https://game.example:8443', 'http://[::1]:3123']) {
  test('browser endpoints follow page origin ' + origin, () => {
    const location = new URL(origin);
    const sandbox = { window: {}, location };
    vm.runInNewContext(source, sandbox);
    const config = sandbox.window.STANDALONE_CONFIG;
    assert.equal(config.apiBase, origin);
    assert.equal(config.wsUrl, (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/original');
    assert.equal(config.protocolVersion, 2);
    assert.equal(config.storageNamespace, 'doushisi-standalone-v1:');
  });
}

