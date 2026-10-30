import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintBinaries, fingerprintSources, releaseSubject } from './build-fingerprint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.includes('--subject')) {
  const subject = await releaseSubject(root);
  process.stdout.write(subject.sha256);
  process.exit(0);
}
const [sources, binaries] = await Promise.all([fingerprintSources(root), fingerprintBinaries(root)]);
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ sources: sources.sha256, binaries: binaries.sha256 }));
} else {
  process.stdout.write(sources.sha256);
}
