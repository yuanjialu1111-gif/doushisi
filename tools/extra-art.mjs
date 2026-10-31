// 斗十四第二轮新增美术：8 个牌桌互动表情（13–20）和大厅首页「进入大厅」入口卡。
// 用法：node tools/extra-art.mjs [--preview=/绝对路径/art-preview.png]
// 不装依赖：SVG 写在本文件里，用本机无头 Chrome 截成透明 PNG。
// 「进入大厅」卡：底框和扑克牌闪电直接取原版 hall 包 spine「haoyou」的贴图（只读），
// 按骨骼静止姿态摆位，只把标题「好友约局」重画成「进入大厅」。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const emoteDir = join(project, 'client/public/extra/emotes');
const hallDir = join(project, 'client/public/extra/hall');
// hall 包 res/spine/haoyou 的贴图（uuid 236a2db9-…，420×473，atlas 见同包 a487b2a5-….atlas）。
const haoyouAtlas = join(project, 'client/public/assets/hall/native/23/236a2db9-618e-480b-81c7-9003a7e640c1.png');

const OL = '#4a2511'; // 统一深色描边
const FONT_CN = "'PingFang SC','Hiragino Sans GB','Heiti SC',sans-serif";

function render(html, width, height, out) {
  const work = mkdtempSync(join(tmpdir(), 'dss-extra-art-'));
  rmSync(out, { force: true });
  try {
    const page = join(work, 'page.html');
    writeFileSync(page, html);
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--allow-file-access-from-files', '--default-background-color=00000000', '--force-device-scale-factor=1',
      `--user-data-dir=${join(work, 'profile')}`, `--window-size=${width},${height}`,
      `--screenshot=${out}`, pathToFileURL(page).href,
    ], { stdio: 'ignore', timeout: 60000 });
    if (!existsSync(out)) throw new Error(`Chrome 没有生成 ${out}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// 读 Chrome 截出的 PNG（8 位 RGBA、不隔行），返回不透明像素的外框，用来自动居中和自检留白。
function alphaBox(file) {
  const png = readFileSync(file);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) throw new Error(`${file} 不是 8 位 RGBA 不隔行 PNG`);
  const idat = [];
  for (let at = 8; at < png.length;) {
    const size = png.readUInt32BE(at), type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + size));
    at += size + 12;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? pixels[y * stride + i - 4] : 0, up = y ? pixels[(y - 1) * stride + i] : 0;
      const corner = i >= 4 && y ? pixels[(y - 1) * stride + i - 4] : 0;
      let value = row[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + i] = value & 255;
    }
  }
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[y * stride + x * 4 + 3] <= 8) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { width, height, left, top, right, bottom, corner: pixels[3] };
}

const page = (body, width, height) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;width:${width}px;height:${height}px;overflow:hidden}
svg{display:block}</style></head><body>${body}</body></html>`;

// 先画整组形状的粗描边，再盖填充：叠在一起的形状共用一圈外轮廓。
const sil = (shapes, fill, ow = 5) =>
  `<g fill="${OL}" stroke="${OL}" stroke-width="${ow * 2}" stroke-linejoin="round" stroke-linecap="round">${shapes}</g><g fill="${fill}">${shapes}</g>`;
const spark = (x, y, r, fill = '#fff27a') =>
  sil(`<path d="M${x} ${y - r}Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z"/>`, fill, 3);
const shine = (d, w = 7, o = 0.75) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" opacity="${o}"/>`;
const line = (d, w = 4, color = OL) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const defs = `<defs>
<linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4a8"/><stop offset=".45" stop-color="#ffd447"/><stop offset="1" stop-color="#ffa21f"/></linearGradient>
<linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd0ff"/><stop offset="1" stop-color="#2f7ff0"/></linearGradient>
<linearGradient id="red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a80"/><stop offset="1" stop-color="#e5393a"/></linearGradient>
<linearGradient id="heart" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#ff9a9a"/><stop offset=".5" stop-color="#ff4256"/><stop offset="1" stop-color="#d81b3c"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7a6"/><stop offset=".5" stop-color="#ffd12e"/><stop offset="1" stop-color="#ff8f00"/></linearGradient>
<linearGradient id="porcelain" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9e6f7"/></linearGradient>
<linearGradient id="shell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".55" stop-color="#ffaa3b"/><stop offset="1" stop-color="#e2711d"/></linearGradient>
<linearGradient id="slug" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4ff9a"/><stop offset="1" stop-color="#78c94a"/></linearGradient>
<linearGradient id="txtYellow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#fff0a0"/><stop offset="1" stop-color="#ffc92e"/></linearGradient>
<linearGradient id="txtGreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e6ffc4"/><stop offset="1" stop-color="#a6e664"/></linearGradient>
<radialGradient id="glow" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#fff6a8"/><stop offset="1" stop-color="#ffc21f"/></radialGradient>
</defs>`;

// 粗圆字：深色外描边 + 填色同色加粗，圆角连接。
function label(text, { x = 128, y, size, fill, family = FONT_CN, spacing = 0, rotate = 0, length }) {
  const fit = length ? ` textLength="${length}" lengthAdjust="spacingAndGlyphs"` : '';
  const base = `x="${x}" y="${y}" text-anchor="middle" font-family="${family}" font-weight="900" font-size="${size}" letter-spacing="${spacing}"${fit}`;
  const t = rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : '';
  return `<g${t}>
<text ${base} fill="${OL}" stroke="${OL}" stroke-width="${size * 0.26}" stroke-linejoin="round" opacity=".45" transform="translate(0 ${size * 0.06})">${text}</text>
<text ${base} fill="${OL}" stroke="${OL}" stroke-width="${size * 0.22}" stroke-linejoin="round">${text}</text>
<text ${base} fill="${fill}" stroke="${fill}" stroke-width="${size * 0.04}" stroke-linejoin="round">${text}</text>
</g>`;
}

const emotes = {
  // 13 点赞：袖口 + 竖大拇指
  13: () => `
${sil('<rect x="30" y="116" width="54" height="110" rx="12"/>', 'url(#blue)')}
${shine('M44 132V210', 6, 0.55)}
${sil(`<rect x="96" y="30" width="50" height="112" rx="25" transform="rotate(-8 121 86)"/>
<rect x="78" y="106" width="96" height="120" rx="22"/>
<rect x="126" y="104" width="96" height="34" rx="17"/><rect x="126" y="134" width="90" height="32" rx="16"/>
<rect x="126" y="162" width="84" height="32" rx="16"/><rect x="126" y="190" width="74" height="34" rx="17"/>`, 'url(#skin)')}
${line('M146 136H204M146 164H198M146 192H190', 4)}
${line('M98 120Q116 112 132 118', 4)}
${shine('M110 52Q105 80 109 102')}
${shine('M150 113H196', 5, 0.6)}
${spark(212, 52, 18)}${spark(56, 70, 13)}`,

  // 14 鼓掌：两只手掌正要拍上，中间一团「啪」的爆点，两侧抖动线
  14: () => {
    const hand = `<rect x="-34" y="-84" width="68" height="132" rx="34"/><ellipse cx="30" cy="14" rx="15" ry="30" transform="rotate(-28 30 14)"/>`;
    const one = (t) => `<g transform="${t}">
${sil('<rect x="-38" y="44" width="76" height="30" rx="9"/>', 'url(#red)')}
${sil(hand, 'url(#skin)')}
${line('M-17 -70V-38M0 -74V-40M17 -70V-38', 3.5)}
${shine('M-22 -58Q-26 -18 -22 22', 7, 0.7)}
</g>`;
    let burst = '';
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8, r = i % 2 ? 13 : 31;
      burst += `${i ? 'L' : 'M'}${(128 + Math.sin(a) * r).toFixed(1)} ${(56 - Math.cos(a) * r).toFixed(1)}`;
    }
    return `
${one('translate(76 150) rotate(16) scale(.92)')}
${one('translate(180 150) rotate(-16) scale(-.92 .92)')}
${sil(`<path d="${burst}Z"/>`, 'url(#glow)', 4)}
${line('M30 64Q20 86 26 110M44 52Q32 80 38 106', 5)}
${line('M226 64Q236 86 230 110M212 52Q224 80 218 106', 5)}
${spark(128, 130, 10, '#ffffff')}`;
  },

  // 15 烟花：彩色花瓣放射 + 中心亮球
  15: () => {
    const colors = ['#ff5a5a', '#ffd23f', '#4db8ff', '#7be36b', '#ff7ad9', '#ffa53f'];
    let rays = '', dots = '', minor = '';
    for (let i = 0; i < 12; i++) {
      const a = i * 30, c = colors[i % colors.length];
      rays += `<g transform="translate(128 128) rotate(${a})">${sil('<path d="M0 -28C14 -46 15 -70 0 -86C-15 -70 -14 -46 0 -28Z"/>', c, 4)}</g>`;
      dots += `<g transform="translate(128 128) rotate(${a})">${sil(`<circle cx="0" cy="-97" r="${i % 2 ? 5 : 7.5}"/>`, c, 3.5)}</g>`;
      minor += `<g transform="translate(128 128) rotate(${a + 15})">${line('M0 -36V-58', 8)}${line('M0 -36V-58', 3.5, '#fff6b8')}</g>`;
    }
    return `${minor}${rays}${dots}
${sil('<circle cx="128" cy="128" r="25"/>', 'url(#glow)', 4)}
${shine('M117 118Q121 112 128 111', 5, 0.9)}
${spark(36, 40, 12)}${spark(222, 218, 12, '#ffffff')}`;
  },

  // 16 比心：拇指食指交叉 + 冒出的红心
  16: () => `
${sil('<g transform="translate(178 74) rotate(14) scale(.86)"><path d="M0 30C0 30 -50 0 -50 -25C-50 -45 -35 -55 -22 -55C-10 -55 0 -45 0 -38C0 -45 10 -55 22 -55C35 -55 50 -45 50 -25C50 0 0 30 0 30Z"/></g>', 'url(#heart)')}
<g transform="translate(178 74) rotate(14) scale(.86)">${shine('M-36 -30Q-36 -44 -24 -46', 8, 0.85)}</g>
${spark(212, 168, 12, '#ffd6e0')}${spark(54, 64, 11, '#ffffff')}
${line('M136 104L148 96M130 86L138 72', 5)}
${sil('<rect x="-15" y="-74" width="30" height="86" rx="15" transform="translate(92 168) rotate(24)"/>', 'url(#skin)')}
${sil('<rect x="44" y="150" width="108" height="84" rx="32"/>', 'url(#skin)')}
${line('M62 182Q98 174 142 184M62 208Q98 200 142 210', 4)}
${sil('<rect x="-16" y="-76" width="32" height="88" rx="16" transform="translate(134 172) rotate(-30)"/>', 'url(#skin)')}
${shine('M56 168Q52 194 58 218', 6, 0.6)}
${shine('M122 150Q110 128 104 114', 6, 0.7)}`,

  // 17 666：金色粗圆字
  17: () => `
${spark(40, 54, 16)}${spark(222, 196, 14)}${spark(214, 48, 9, '#ffffff')}
<g transform="rotate(-8 128 132)">
<text x="128" y="172" text-anchor="middle" font-family="'Arial Rounded MT Bold','PingFang SC',sans-serif" font-size="118" letter-spacing="-6" fill="${OL}" stroke="${OL}" stroke-width="30" stroke-linejoin="round" opacity=".45" transform="translate(0 7)">666</text>
<text x="128" y="172" text-anchor="middle" font-family="'Arial Rounded MT Bold','PingFang SC',sans-serif" font-size="118" letter-spacing="-6" fill="${OL}" stroke="${OL}" stroke-width="24" stroke-linejoin="round">666</text>
<text x="128" y="172" text-anchor="middle" font-family="'Arial Rounded MT Bold','PingFang SC',sans-serif" font-size="118" letter-spacing="-6" fill="url(#gold)" stroke="url(#gold)" stroke-width="4" stroke-linejoin="round">666</text>
<clipPath id="top666"><rect x="0" y="0" width="256" height="122"/></clipPath>
<text x="128" y="172" text-anchor="middle" font-family="'Arial Rounded MT Bold','PingFang SC',sans-serif" font-size="118" letter-spacing="-6" fill="#ffffff" opacity=".35" clip-path="url(#top666)">666</text>
</g>`,

  // 18 敬茶：盖碗茶（茶托 + 茶碗 + 茶盖）+ 热气
  18: () => `
${line('M92 76C82 64 102 54 92 40C86 32 92 26 96 22', 11)}${line('M92 76C82 64 102 54 92 40C86 32 92 26 96 22', 5, '#ffffff')}
${line('M164 76C154 64 174 54 164 40C158 32 164 26 168 22', 11)}${line('M164 76C154 64 174 54 164 40C158 32 164 26 168 22', 5, '#ffffff')}
${sil('<ellipse cx="128" cy="212" rx="98" ry="22"/>', '#b9cdea')}
${sil('<ellipse cx="128" cy="206" rx="90" ry="15"/>', 'url(#porcelain)', 2.5)}
${line('M62 210Q128 226 194 210', 4, '#2d6be0')}
${sil(`<path d="M62 128C66 172 92 196 104 200L152 200C164 196 190 172 194 128Z"/><rect x="100" y="194" width="56" height="14" rx="4"/>`, 'url(#porcelain)')}
${line('M70 152Q128 170 186 152', 6, '#2d6be0')}
<g fill="#2d6be0"><circle cx="128" cy="178" r="7"/><circle cx="116" cy="180" r="5"/><circle cx="140" cy="180" r="5"/><circle cx="96" cy="170" r="4"/><circle cx="160" cy="170" r="4"/></g>
${sil(`<path d="M58 130C62 98 96 86 128 86C160 86 194 98 198 130Z"/><ellipse cx="128" cy="130" rx="72" ry="10"/>
<rect x="112" y="64" width="32" height="26" rx="8"/><ellipse cx="128" cy="64" rx="19" ry="7"/>`, 'url(#porcelain)')}
${line('M70 116Q128 102 186 116', 6, '#2d6be0')}
${line('M115 76H141', 5, '#2d6be0')}
${shine('M76 120Q86 100 108 94', 6, 0.9)}
${shine('M74 140Q80 164 96 180', 6, 0.8)}`,

  // 19 催一下：响铃闹钟 + 「快点!」
  19: () => `
${line('M36 82Q26 104 36 126M22 74Q8 104 22 134', 6)}
${line('M220 82Q230 104 220 126M234 74Q248 104 234 134', 6)}
${sil('<rect x="-7" y="-18" width="14" height="30" rx="5" transform="translate(84 156) rotate(36)"/><rect x="-7" y="-18" width="14" height="30" rx="5" transform="translate(172 156) rotate(-36)"/>', '#c62828', 4)}
${sil('<path d="M48 64A34 30 -35 0 1 102 30Z"/><path d="M208 64A34 30 35 0 0 154 30Z"/>', 'url(#gold)')}
${sil('<rect x="123" y="26" width="10" height="20" rx="3"/><circle cx="128" cy="24" r="8"/>', 'url(#gold)', 4)}
${sil('<circle cx="128" cy="100" r="62"/>', 'url(#red)')}
${sil('<circle cx="128" cy="100" r="46"/>', '#fffaf0', 3)}
${line('M128 62V70M128 130V138M90 100H98M158 100H166', 4)}
${line('M128 100L128 72M128 100L106 88', 6)}
<circle cx="128" cy="100" r="6" fill="${OL}"/>
${shine('M84 70Q96 52 116 46', 7, 0.8)}
${label('快点!', { y: 228, size: 56, fill: 'url(#txtYellow)', length: 170 })}`,

  // 20 慢慢来：蜗牛 + 「慢慢来」
  20: () => `
${sil(`<path d="M34 170C34 154 60 146 92 146L180 146C206 146 222 128 224 110C226 92 214 84 200 86C182 88 176 104 172 120L160 142L92 142C60 142 34 150 34 170Z"/>
<rect x="34" y="140" width="186" height="34" rx="17"/>`, 'url(#slug)')}
${line('M190 92L180 62M208 94L214 64', 5)}
${sil('<circle cx="180" cy="60" r="10"/><circle cx="215" cy="62" r="10"/>', '#ffffff', 3.5)}
<circle cx="182" cy="62" r="4.5" fill="${OL}"/><circle cx="217" cy="64" r="4.5" fill="${OL}"/>
${line('M196 118Q206 126 214 116', 4)}
<ellipse cx="188" cy="112" rx="7" ry="4" fill="#ff8a8a" opacity=".7"/>
${sil('<circle cx="110" cy="108" r="56"/>', 'url(#shell)')}
${line('M110 108m-6 0a6 6 0 1 1 12 0a14 14 0 1 1 -28 0a24 24 0 1 1 48 0a34 34 0 1 1 -68 0', 5)}
${shine('M72 82Q84 62 108 58', 7, 0.8)}
${shine('M42 160Q46 152 56 150', 5, 0.6)}
${label('慢慢来', { y: 230, size: 56, fill: 'url(#txtGreen)', length: 188 })}`,
};

// 「进入大厅」卡。原 spine：skeleton 221.35×407.24；底框 xinjin-dikuang 原图 231×412（裁后 223×408，offset 4,4），
// 网格 1:1 不变形，原图左上角在骨骼坐标 (-115.37, 208.07)，所以卡片 PNG 取 231×412，
// 中心在骨骼原点 (+0.13, +2.07)。扑克牌闪电 shandian（atlas 里旋转 90° 存放）静止姿态左上 (18.68, 86.56)≈(19, 87)；
// 标题 dou14-rukou-title1 183×52，中心在 (113.89, 345.92)。
const CARD_W = 231, CARD_H = 412;
function cardHtml() {
  const atlas = pathToFileURL(haoyouAtlas).href;
  const title = '进入大厅';
  const t = `x="114" y="361" text-anchor="middle" font-family="${FONT_CN}" font-weight="900" font-size="42" textLength="174" lengthAdjust="spacingAndGlyphs"`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" style="position:absolute;left:0;top:0">
<defs><filter id="soft" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter></defs>
<text ${t} fill="#650707" stroke="#650707" stroke-width="9" stroke-linejoin="round" opacity=".7" filter="url(#soft)" transform="translate(0 3.5)">${title}</text>
<text ${t} fill="#fff990" stroke="#fff990" stroke-width="8.5" stroke-linejoin="round">${title}</text>
<text ${t} fill="#e8db80" stroke="#e8db80" stroke-width="5" stroke-linejoin="round" transform="translate(0 .6)">${title}</text>
<text ${t} fill="#763f2d" stroke="#763f2d" stroke-width="2.6" stroke-linejoin="round">${title}</text>
</svg>`;
  // 底框：atlas (2,63) 223×408 → 卡片 (4,0)。扑克牌：atlas (227,2) 占 191×193，顺时针转 90° 还原成 193×191 放到 (19,87)。
  return page(`<div style="position:relative;width:${CARD_W}px;height:${CARD_H}px">
<div style="position:absolute;left:4px;top:0;width:223px;height:408px;background:url('${atlas}') -2px -63px no-repeat"></div>
<div style="position:absolute;left:20px;top:86px;width:191px;height:193px;background:url('${atlas}') -227px -2px no-repeat;transform:rotate(90deg)"></div>
${svg}</div>`, CARD_W, CARD_H);
}

const emoteNames = { 13: '点赞', 14: '鼓掌', 15: '烟花', 16: '比心', 17: '666', 18: '敬茶', 19: '催一下', 20: '慢慢来' };

function previewHtml() {
  const src = (p) => pathToFileURL(p).href;
  const row = (bg, fg) => `<section style="background:${bg};color:${fg};display:flex;gap:24px;padding:16px;align-items:flex-start">
<img src="${src(join(hallDir, 'enter-lobby.png'))}" width="${CARD_W}" height="${CARD_H}">
<div style="display:grid;grid-template-columns:repeat(8,256px);gap:12px">
${Object.keys(emoteNames).map((id) => `<div style="text-align:center"><img src="${src(join(emoteDir, `${id}.png`))}" width="256" height="256" style="display:block;outline:1px dashed ${fg}33"><div style="height:84px;display:flex;align-items:center;justify-content:center;gap:12px"><img src="${src(join(emoteDir, `${id}.png`))}" width="64" height="64"><span style="font:600 18px ${FONT_CN}">${id} ${emoteNames[id]}</span></div></div>`).join('')}
</div></section>`;
  return page(`<div style="width:2419px">${row('#1b2433', '#ffffff')}${row('#f4ecdc', '#3a2a1a')}</div>`, 2419, 888);
}

mkdirSync(emoteDir, { recursive: true });
mkdirSync(hallDir, { recursive: true });
// 表情先试画一遍量出实际外框，再整体缩放平移到 256×256 正中、四周留 16px（缩放限制在 0.85–1.12，描边粗细基本不变）。
const SIZE = 256, PAD = 16;
const emoteSvg = (body, transform = '') =>
  page(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${defs}<g transform="${transform}">${body}</g></svg>`, SIZE, SIZE);
const probeDir = mkdtempSync(join(tmpdir(), 'dss-extra-probe-'));
try {
  for (const [id, draw] of Object.entries(emotes)) {
    const body = draw(), probe = join(probeDir, `${id}.png`), out = join(emoteDir, `${id}.png`);
    render(emoteSvg(body), SIZE, SIZE, probe);
    const box = alphaBox(probe), w = box.right - box.left + 1, h = box.bottom - box.top + 1;
    const scale = Math.min(1.12, Math.max(0.85, Math.min((SIZE - PAD * 2) / w, (SIZE - PAD * 2) / h)));
    const tx = SIZE / 2 - scale * (box.left + box.right + 1) / 2, ty = SIZE / 2 - scale * (box.top + box.bottom + 1) / 2;
    render(emoteSvg(body, `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})`), SIZE, SIZE, out);
    const fit = alphaBox(out);
    const margins = [fit.left, fit.top, SIZE - 1 - fit.right, SIZE - 1 - fit.bottom];
    console.log(`表情 ${id} ${emoteNames[id]} → ${out}（缩放 ${scale.toFixed(2)}，留白 左${margins[0]} 上${margins[1]} 右${margins[2]} 下${margins[3]}）`);
    if (fit.corner !== 0 || Math.min(...margins) < 12) throw new Error(`表情 ${id} 留白不够或底色不透明`);
  }
} finally {
  rmSync(probeDir, { recursive: true, force: true });
}
if (!existsSync(haoyouAtlas)) throw new Error(`找不到原版贴图 ${haoyouAtlas}`);
const card = join(hallDir, 'enter-lobby.png');
render(cardHtml(), CARD_W, CARD_H, card);
console.log(`入口卡 进入大厅 → ${card}`);

const previewArg = process.argv.find((arg) => arg.startsWith('--preview='));
if (previewArg) {
  const out = resolve(previewArg.slice('--preview='.length));
  mkdirSync(dirname(out), { recursive: true });
  render(previewHtml(), 2419, 888, out);
  console.log(`预览 → ${out}`);
}
