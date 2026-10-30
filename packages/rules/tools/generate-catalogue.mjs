import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFile = path.resolve(process.argv[2] ?? '../../work/game-rules.json');
const source = fs.readFileSync(sourceFile, 'utf8');
const sourceData = JSON.parse(source);
const retained = Object.fromEntries(Object.entries(sourceData).filter(([id]) => (+id >= 2 && +id <= 27) || +id === 101));
if (Object.keys(retained).length !== 27 || Object.values(retained).flat().length !== 28) throw new Error('Retained catalogue count mismatch');
fs.mkdirSync(path.join(packageDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(packageDir, 'src/original-catalogue.ts'), '// Generated from APK FrameGameConfig. See ../NOTICE.md.\nexport const originalCatalogue = ' + JSON.stringify(retained, null, 2) + ';\n');
fs.writeFileSync(path.join(packageDir, 'extraction-evidence.json'), JSON.stringify({
  source: 'work/game-rules.json; statically extracted from APK assets/assets/main/index.js FrameGameConfig',
  sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
  gameIdCount: 27, configurationCount: 28, evidenceStatus: 'unverified-gameplay',
  note: 'All option labels/tooltips/defaults are client evidence only. No original live rule cases supplied.'
}, null, 2) + '\n');
console.log(JSON.stringify({gameIds: Object.keys(retained).length, configurations: Object.values(retained).flat().length}));
