import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const yaml = require(process.env.YAML_MODULE || 'yaml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = yaml.parse(await readFile(join(root, 'compose.yaml'), 'utf8'), { uniqueKeys: true });
const services = config.services;
assert.equal(services.database.ports, undefined);
assert.equal(services['restore-drill-database'].ports, undefined);
assert.deepEqual(services.server.ports, ['127.0.0.1:3000:3000']);
assert.deepEqual(services['restore-drill'].networks, ['recovery']);
assert.deepEqual(services['restore-drill-database'].networks, ['recovery']);
assert.equal(services.database.networks, undefined);
assert.equal(services.backup.networks, undefined);
assert.equal(config.networks.recovery.internal, true);
assert.equal(services.backup.environment.PGUSER, 'dss_backup');
assert.deepEqual(services['restore-drill'].volumes, ['backups:/backups:ro', 'restore-reports:/reports']);
assert.ok(services['restore-drill-database'].volumes.every(volume => !volume.startsWith('database:')));
assert.ok(!JSON.stringify(services.backup).includes('docker.sock'));
assert.deepEqual(services.backup.healthcheck.test, ['CMD', 'node', '/operations/backup-cli.mjs', 'health']);
assert.ok(services.backup.environment.PGPASSWORD.includes('${DSS_BACKUP_PASSWORD:'));
const report = {
  at: new Date().toISOString(), parser: 'yaml 2.8.2', passed: true, dockerExecuted: false,
  checks: ['YAML syntax and unique keys', 'Database ports not published', 'Application bound to loopback', 'Recovery network internal and separated', 'Recovery data volume distinct', 'Backup archive read-only during recovery', 'Restricted backup database role', 'No Docker socket in backup container', 'Backup health command configured', 'Password supplied through environment reference'],
  limitations: ['Docker Compose model validation and image builds not executed', 'Linux container network and named-volume permissions require deployment checks'],
};
await mkdir(join(root, 'deploy/verification'), { recursive: true });
await writeFile(join(root, 'deploy/verification/compose-static.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
