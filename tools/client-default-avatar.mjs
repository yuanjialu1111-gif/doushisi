import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(project, 'apps/admin/package.json'));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { UserRound } = require('lucide-react');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const icon = renderToStaticMarkup(createElement(UserRound, { width: 80, height: 80, strokeWidth: 1.5, color: '#e8f2ef' }));
const target = resolve(project, 'client/public/standalone');
await mkdir(target, { recursive: true });
await sharp({ create: { width: 128, height: 128, channels: 4, background: '#4d7069' } })
  .composite([{ input: Buffer.from(icon), gravity: 'centre' }]).png().toFile(resolve(target, 'default-avatar.png'));
console.log('Default account avatar rendered from lucide-react UserRound (ISC license).');
