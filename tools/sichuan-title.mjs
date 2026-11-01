// 牌桌中间的游戏名水印「四川斗十四」（DEC-20261101-四川斗十四）。原版 dss 包只有各地区的图（成都、汶川…），
// 这里拿原图拼：「斗十四」照搬成都图原位，第一格放成都图自己的「四」，第二格放汶川图的「川」（原位），字体颜色和原版一样。
// 用法：node tools/sichuan-title.mjs（不装依赖：用本机无头 Chrome 截成透明 PNG，和 tools/extra-art.mjs 一样）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// dss 包 res/frames/doushisi-game-bg-wenzi-chengdu（325×73）、-wenchuan（326×73）的贴图，只读。
const chengdu = join(project, 'client/public/assets/dss/native/5f/5fe1fc2b-9fc4-4888-ace3-72f6b7c703a4.png');
const wenchuan = join(project, 'client/public/assets/dss/native/03/03106a76-5615-4648-83d9-8ea786460fd6.png');
const out = join(project, 'client/public/extra/table/sichuan-title.png');
const W = 325, H = 73;

for (const file of [chengdu, wenchuan]) if (!existsSync(file)) throw new Error(`找不到原版贴图 ${file}`);
// 原图字的列范围（透明度 > 20）：成都 成1–57 都60–122 斗132–187 十200–260 四270–323；汶川 川71–119。
const piece = (file, from, width, left) => `<div style="position:absolute;left:${left}px;top:0;width:${width}px;height:${H}px;background:url('${pathToFileURL(file).href}') -${from}px 0 no-repeat"></div>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;width:${W}px;height:${H}px;overflow:hidden}</style></head>
<body><div style="position:relative;width:${W}px;height:${H}px">${piece(chengdu, 126, 199, 126)}${piece(chengdu, 270, 54, 3)}${piece(wenchuan, 71, 49, 71)}</div></body></html>`;

mkdirSync(dirname(out), { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'dss-sichuan-title-'));
rmSync(out, { force: true });
try {
  const page = join(work, 'page.html');
  writeFileSync(page, html);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--default-background-color=00000000', '--force-device-scale-factor=1',
    `--user-data-dir=${join(work, 'profile')}`, `--window-size=${W},${H}`, `--screenshot=${out}`, pathToFileURL(page).href,
  ], { stdio: 'ignore', timeout: 60000 });
  if (!existsSync(out)) throw new Error(`Chrome 没有生成 ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`牌桌水印 四川斗十四 → ${out}`);
