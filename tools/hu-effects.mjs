// 胡牌特效补字（DEC-20261101-胡牌特效补齐）。原版 dss 包没有金钩钓、报叫、龙对的特效，这里借原版现成的特效动画，
// 只把动画里那块字换掉：金钩钓借「金二十」（jinershi 的 zi），报叫借「天胡」（tianhu 的 zi），龙对借「大胡」（dahu 的 wenzi，
// 新津桌用不到大胡；不借对子胡，龙对总跟着暗四对一起播）。这里只出那块字的小图，尺寸和原版那块一样，样式照原版的字仿（魏碑粗体）；
// 热更新脚本运行时把原版动画复制一份，把那块字指到这张小图上（standalone.js hueEffects）。
// 用法：node tools/hu-effects.mjs（不装依赖：本机无头 Chrome 截透明 PNG，和 tools/sichuan-title.mjs 一样）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = join(project, 'client/public/extra/effects');
const font = "'Weibei SC','Weibei TC','Kaiti SC',serif";

// w、h 是原版那块字在图集里的大小（atlas 的 size），standalone.js HU_EFFECTS 里要一致。
const effects = [
  { name: 'jingoudiao', text: '金钩钓', w: 384, h: 137, size: 124, // 金二十：米白到金黄，粗褐边
    layers: [{ stroke: 14, color: '#6b2a12', dy: 2 }, { fill: 'linear-gradient(#fffbe6,#f6dc98 55%,#e2a54a)' }] },
  { name: 'baojiao', text: '报叫', w: 239, h: 124, size: 114, // 天胡：米白渐变，深色投影
    layers: [{ color: 'rgba(30,18,8,.85)', dx: 3, dy: 5, blur: 2 }, { fill: 'linear-gradient(#fffef4,#f7e7b8 50%,#e8c886)' }] },
  { name: 'longdui', text: '龙对', w: 255, h: 146, size: 128, // 大胡：上深红下橙，黄边厚底，最下一道深蓝
    layers: [{ color: '#1c2060', dy: 9 }, { color: '#ffc046', dy: 5 }, { fill: 'linear-gradient(#b8140f,#e8481c 45%,#ff9a32)' }] },
];

const layer = (effect, l) => {
  const base = `position:absolute;left:0;top:0;width:${effect.w}px;height:${effect.h}px;display:flex;align-items:center;justify-content:center;` +
    `font:700 ${effect.size}px/1 ${font};white-space:nowrap;letter-spacing:-2px;transform:translate(${l.dx || 0}px,${l.dy || 0}px);`;
  if (l.fill) return `<div style="${base}background:${l.fill};-webkit-background-clip:text;background-clip:text;color:transparent">${effect.text}</div>`;
  const stroke = l.stroke ? `-webkit-text-stroke:${l.stroke}px ${l.color};` : '';
  return `<div style="${base}color:${l.color};${stroke}${l.blur ? `filter:blur(${l.blur}px);` : ''}">${effect.text}</div>`;
};

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'dss-hu-effects-'));
try {
  for (const effect of effects) {
    const out = join(outDir, `${effect.name}.png`), page = join(work, `${effect.name}.html`);
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;width:${effect.w}px;height:${effect.h}px;overflow:hidden}</style></head>` +
      `<body><div style="position:relative;width:${effect.w}px;height:${effect.h}px">${effect.layers.map(l => layer(effect, l)).join('')}</div></body></html>`);
    rmSync(out, { force: true });
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--default-background-color=00000000', '--force-device-scale-factor=1',
      `--user-data-dir=${join(work, 'profile')}`, `--window-size=${effect.w},${effect.h}`, `--screenshot=${out}`, pathToFileURL(page).href,
    ], { stdio: 'ignore', timeout: 60000 });
    if (!existsSync(out)) throw new Error(`Chrome 没有生成 ${out}`);
    console.log(`${effect.text} → ${out}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
