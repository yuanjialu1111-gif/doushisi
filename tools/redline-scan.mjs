// 红线扫描（DECISIONS.md「红线」）：原版编译包没被手改、源码里没有签名钥匙和私钥、本机资料没进仓库。
// 用法：node tools/redline-scan.mjs [--update-baseline]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(project, 'tools/redline-baseline.json');
const bundleRoot = join(project, 'client/public/assets');
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

const bundles = Object.fromEntries(readdirSync(bundleRoot).sort()
  .map(name => `client/public/assets/${name}/index.js`)
  .filter(path => existsSync(join(project, path)))
  .map(path => [path, sha256(join(project, path))]));

if (process.argv.includes('--update-baseline')) {
  writeFileSync(baselinePath, JSON.stringify({ note: '只在 client-prepare.mjs 重新生成原版补丁后更新', bundles }, null, 2) + '\n');
  console.log(`baseline updated: ${Object.keys(bundles).length} bundles`);
  process.exit(0);
}

const failures = [];
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).bundles;
for (const [path, hash] of Object.entries(baseline)) {
  if (bundles[path] !== hash) failures.push(`红线 4：原版编译包被改动 ${path}`);
}

const tracked = existsSync(join(project, '.git'))
  ? execFileSync('git', ['ls-files', '-z'], { cwd: project, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean)
  : [];
const forbiddenPath = [/\.(jks|keystore|p12|pfx)$/i, /^线上部署包\//, /(^|\/)\.local\//, /(^|\/)\.env$/];
const privateKey = /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;
for (const path of tracked) {
  if (forbiddenPath.some(pattern => pattern.test(path))) failures.push(`红线 1/3：不该进仓库的文件 ${path}`);
  const full = join(project, path);
  if (!existsSync(full) || statSync(full).size > 1 << 20) continue;
  if (path !== 'tools/redline-scan.mjs' && privateKey.test(readFileSync(full, 'latin1'))) failures.push(`红线 1：发现私钥 ${path}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`redline ok: ${Object.keys(baseline).length} bundles unchanged, ${tracked.length} tracked files scanned`);
