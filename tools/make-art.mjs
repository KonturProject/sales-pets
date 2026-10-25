// Генерирует свои SVG-ассеты прототипа: яйца групп (3 фазы), комната, гнездо, кучка, мухи, аптечка, игрушка, надгробие.
// Запуск: node tools/make-art.mjs  → public/assets/**
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/assets';
const write = (rel, svg) => {
  const file = join(OUT, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, svg.trim() + '\n', 'utf8');
};
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ключ файла → цвет яйца (приглушённые тона), пятна светлее/темнее основы
const EGGS = {
  sr1: { base: '#c9605a', spot: '#f1c9b8', dark: '#8f3a38' },
  sr2: { base: '#7fae7a', spot: '#d7e8c8', dark: '#4f7a4f' },
  sr3: { base: '#e0c067', spot: '#f7ecc4', dark: '#a98a33' },
  sr5: { base: '#3d3f45', spot: '#a5a7ad', dark: '#1f2024', crack: '#e6dfd2' },
  sr6: { base: '#9a82b8', spot: '#e0d6ee', dark: '#66508a' },
  sr9: { base: '#6f97c4', spot: '#d3e2f2', dark: '#43688f' },
};

const EGG_PATH = 'M100 10 C150 10 185 120 185 165 C185 220 148 250 100 250 C52 250 15 220 15 165 C15 120 50 10 100 10 Z';
const CRACK1 = 'M104 36 L90 62 L110 78 L94 104';
const CRACK2 = 'M104 36 L90 62 L110 78 L94 104 L116 126 L98 152 M110 78 L136 92 L128 116 M94 104 L66 118 L72 142';

function egg(key, colors, phase) {
  const rand = rng(key.charCodeAt(2) * 977 + 13);
  let spots = '';
  for (let i = 0; i < 22; i++) {
    const x = 28 + rand() * 144;
    const y = 30 + rand() * 210;
    const r = 2.2 + rand() * 4.5;
    const fill = rand() > 0.5 ? colors.spot : colors.dark;
    spots += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.8).toFixed(1)}" fill="${fill}" opacity="0.75"/>`;
  }
  const crack = phase === 0 ? '' : `<path d="${phase === 1 ? CRACK1 : CRACK2}" fill="none" stroke="${colors.crack ?? '#2f2622'}" stroke-width="${phase === 1 ? 4 : 5}" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
  return svg(200, 260, `
<defs><clipPath id="e"><path d="${EGG_PATH}"/></clipPath></defs>
<path d="${EGG_PATH}" fill="${colors.base}"/>
<g clip-path="url(#e)">${spots}<ellipse cx="70" cy="90" rx="22" ry="40" fill="#ffffff" opacity="0.18" transform="rotate(18 70 90)"/></g>
<path d="${EGG_PATH}" fill="none" stroke="${colors.dark}" stroke-width="3" opacity="0.5"/>
${crack}`);
}

for (const [key, colors] of Object.entries(EGGS)) {
  for (const phase of [0, 1, 2]) write(`eggs/${key}-${phase}.svg`, egg(key, colors, phase));
}

write('room.svg', svg(1600, 900, `
<rect width="1600" height="900" fill="#e8dfd0"/>
<rect y="0" width="1600" height="600" fill="#e3d8c6"/>
<rect y="560" width="1600" height="40" fill="#d3c4ab"/>
<rect y="600" width="1600" height="300" fill="#cbb89a"/>
<g fill="#bfa987" opacity="0.5"><rect y="660" width="1600" height="3"/><rect y="740" width="1600" height="3"/><rect y="830" width="1600" height="3"/></g>
<rect x="640" y="90" width="320" height="260" rx="14" fill="#f4efe4"/>
<rect x="658" y="108" width="284" height="224" rx="8" fill="#bcd3dc"/>
<rect x="796" y="108" width="8" height="224" fill="#f4efe4"/><rect x="658" y="216" width="284" height="8" fill="#f4efe4"/>
<ellipse cx="800" cy="760" rx="520" ry="70" fill="#b9a384" opacity="0.35"/>`));

write('nest.svg', svg(240, 90, `
<ellipse cx="120" cy="58" rx="112" ry="28" fill="#9d8157"/>
<ellipse cx="120" cy="50" rx="100" ry="22" fill="#bda374"/>
<ellipse cx="120" cy="46" rx="78" ry="14" fill="#a68a5e"/>
<g stroke="#8a6f48" stroke-width="3" stroke-linecap="round" opacity="0.8"><path d="M28 52 Q60 40 96 54"/><path d="M130 56 Q170 40 212 52"/><path d="M60 68 Q120 78 182 66"/></g>`));

write('pile.svg', svg(80, 70, `
<ellipse cx="40" cy="60" rx="34" ry="9" fill="#6f5440"/>
<path d="M12 58 Q10 42 40 40 Q70 42 68 58 Z" fill="#8a6a4f"/>
<path d="M22 42 Q22 28 40 27 Q58 28 58 42 Z" fill="#9a7757"/>
<path d="M32 28 Q34 14 42 8 Q44 18 50 28 Z" fill="#a98563"/>
<path d="M24 50 Q40 44 58 50" fill="none" stroke="#6f5440" stroke-width="2" opacity="0.5"/>`));

write('flies.svg', svg(120, 60, `
<g fill="#3a3a3a"><ellipse cx="24" cy="30" rx="4" ry="2.6"/><ellipse cx="66" cy="18" rx="4" ry="2.6"/><ellipse cx="94" cy="42" rx="4" ry="2.6"/></g>
<g fill="#dfe8ee" opacity="0.8"><ellipse cx="22" cy="26" rx="4" ry="2.4"/><ellipse cx="27" cy="26" rx="4" ry="2.4"/><ellipse cx="64" cy="14" rx="4" ry="2.4"/><ellipse cx="69" cy="14" rx="4" ry="2.4"/><ellipse cx="92" cy="38" rx="4" ry="2.4"/><ellipse cx="97" cy="38" rx="4" ry="2.4"/></g>`));

write('medkit.svg', svg(64, 64, `
<rect x="8" y="18" width="48" height="38" rx="8" fill="#f4efe4" stroke="#b9ae9b" stroke-width="2"/>
<path d="M24 18 V12 Q24 8 28 8 H36 Q40 8 40 12 V18" fill="none" stroke="#b9ae9b" stroke-width="3"/>
<rect x="29" y="26" width="6" height="22" rx="2" fill="#c9605a"/><rect x="21" y="34" width="22" height="6" rx="2" fill="#c9605a"/>`));

write('toy.svg', svg(64, 64, `
<circle cx="32" cy="32" r="24" fill="#6f97c4"/>
<path d="M10 28 Q32 14 54 28 L52 36 Q32 24 12 36 Z" fill="#e0c067"/>
<path d="M14 46 Q32 54 50 46 Q44 56 32 56 Q20 56 14 46 Z" fill="#c9605a" opacity="0.9"/>
<ellipse cx="24" cy="22" rx="7" ry="4" fill="#fff" opacity="0.35" transform="rotate(-30 24 22)"/>`));

write('grave.svg', svg(120, 150, `
<ellipse cx="60" cy="136" rx="48" ry="10" fill="#8a7d68" opacity="0.5"/>
<path d="M22 134 V58 Q22 16 60 16 Q98 16 98 58 V134 Z" fill="#b8b2a6" stroke="#8d877b" stroke-width="3"/>
<path d="M60 40 V84 M44 56 H76" stroke="#8d877b" stroke-width="7" stroke-linecap="round"/>
<path d="M30 134 q8 -10 14 0 M80 134 q8 -12 14 0" stroke="#7f9a6b" stroke-width="4" fill="none" stroke-linecap="round"/>`));

console.log('ok');
