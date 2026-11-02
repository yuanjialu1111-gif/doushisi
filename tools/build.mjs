import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { fingerprintSources, fingerprintBinaries } from './build-fingerprint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A global pnpm install reports its bin symlink (e.g. runtime/bin/pnpm); follow it to the real pnpm.mjs.
const manager = (() => { const execpath = process.env.npm_execpath; try { return execpath && realpathSync(execpath); } catch { return execpath; } })();
if (!manager || !/\.(?:c?js|mjs)$/.test(manager)) throw new Error('Run this build using pnpm build.');
const before = await fingerprintSources(root);
const status = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [manager, '-r', '--if-present', 'build'], { cwd: root, stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
if (status !== 0) process.exit(status);
const after = await fingerprintSources(root);
if (after.sha256 !== before.sha256) throw new Error('Source files changed during the build. Rebuild the stable source tree.');
const binaries = await fingerprintBinaries(root);
await fs.mkdir(path.join(root, 'verification'), { recursive: true });
await fs.writeFile(path.join(root, 'verification/build-manifest.json'), JSON.stringify({ version: 1,
  builtAt: new Date().toISOString(), sources: after, binaries }, null, 2) + '\n');
console.log('Build fingerprint: ' + after.sha256);
