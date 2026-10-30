import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfiguredEngineRegistry, createRuntimeEngineRegistry } from '../src/runtime-engines.js';

test('production registry creation ignores preview environment variables', () => {
  const previous = process.env.DSS_ENGINE_PREVIEW;
  process.env.DSS_ENGINE_PREVIEW = '1';
  try {
    const configured = createConfiguredEngineRegistry();
    const runtime = createRuntimeEngineRegistry();
    assert.equal(configured.has('8:0'), true);
    assert.equal(runtime.has('8:0'), true);
    assert.equal(runtime.has('6:0'), true);
    assert.equal(runtime.has('27:0'), true);
    assert.equal(runtime.has('2:0'), false);
  } finally {
    if (previous === undefined) delete process.env.DSS_ENGINE_PREVIEW;
    else process.env.DSS_ENGINE_PREVIEW = previous;
  }
});

test('the production entry point does not import or enable the preview registry', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createPreviewEngineRegistry|DSS_ENGINE_PREVIEW|DSS_PREVIEW_ENGINES/);
});
