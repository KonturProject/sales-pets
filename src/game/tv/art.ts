import type { RoomTheme } from '@/art/manifest';

/**
 * Окно: рама, стекло и вид за окном. Вид обрезан по стеклу (`clipPath`), иначе пейзаж вылезает на стену.
 * `glass` — фигура стекла без заливки; `id` уникален на странице: декор каждой темы рисуется в одной комнате.
 */
const pane = (id: string, frame: string, glass: string, fill: string, view: string) =>
  `${frame}<clipPath id="pane-${id}">${glass}</clipPath>${glass.replace('/>', ` fill="${fill}"/>`)}<g clip-path="url(#pane-${id})">${view}</g>`;

/** Декор задней стены комнаты: внутренность `<svg viewBox="0 0 529 340">` (из макета rooms-and-walk). */
export const DECOR: Record<RoomTheme['decor'], string> = {
  savanna: `${pane('savanna', '<rect x="190" y="104" width="150" height="104" rx="8" fill="#8c6a47"/>', '<rect x="198" y="112" width="134" height="88" rx="4"/>', '#f2c08d',
    '<circle cx="265" cy="170" r="22" fill="#e99a6a"/><rect x="198" y="178" width="134" height="22" fill="#d9a46d"/><path d="M226 178v-26M212 154q14-10 30 0q-14-6-30 0" stroke="#6b4a2f" stroke-width="4" fill="#6b4a2f"/>')}
    <path d="M30 340q10-60 4-120M50 340q-6-50 10-100" stroke="#a37b4f" stroke-width="6" fill="none"/><ellipse cx="34" cy="220" rx="26" ry="10" fill="#9fae6c"/>`,
  pond: `${pane('pond', '<rect x="186" y="96" width="160" height="120" rx="60" fill="#8c6a47"/>', '<rect x="194" y="104" width="144" height="104" rx="52"/>', '#bcd7d2',
    '<path d="M194 176q30-14 66 0t78 0v32H194z" fill="#8fb7ae"/>')}
    ${[40, 60, 80, 450, 470].map((x) => `<path d="M${x} 340q-4-70 8-130" stroke="#7d9a68" stroke-width="5" fill="none"/><ellipse cx="${x + 8}" cy="212" rx="5" ry="16" fill="#8a6542"/>`).join('')}`,
  sun: `${pane('sun', '<rect x="196" y="100" width="140" height="110" rx="8" fill="#8c6a47"/>', '<rect x="204" y="108" width="124" height="94" rx="4"/>', '#dbe8ef', '<circle cx="266" cy="148" r="20" fill="#f1cf6a"/>')}
    ${[[40, 230], [470, 220]].map(([x, y]) => `<path d="M${x} 340v-${340 - y}" stroke="#6f8c55" stroke-width="5"/>${[...Array(10)].map((_, k) => `<ellipse cx="${x}" cy="${y - 20}" rx="7" ry="18" fill="#efc24d" transform="rotate(${k * 36} ${x} ${y})"/>`).join('')}<circle cx="${x}" cy="${y}" r="13" fill="#8a6542"/>`).join('')}`,
  night: `${pane('night', '<rect x="186" y="96" width="160" height="120" rx="8" fill="#3a3326"/>', '<rect x="194" y="104" width="144" height="104" rx="4"/>', '#2c3350',
    `<path d="M290 130a18 18 0 1 0 14 30a14 14 0 1 1-14-30z" fill="#f2e6b8"/>${[[214, 124], [236, 168], [258, 120], [318, 186], [222, 192]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="#f2e6b8"/>`).join('')}`)}
    ${[[60, 60], [460, 90], [110, 150], [420, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#f2e6b8" opacity=".7"/>`).join('')}`,
  library: `${[0, 1].map((s) => `<rect x="${s ? 404 : 14}" y="120" width="110" height="220" fill="#8c6a47"/>${[0, 1, 2].map((r) => [0, 1, 2, 3, 4].map((b) => `<rect x="${(s ? 410 : 20) + b * 20}" y="${130 + r * 70}" width="16" height="58" rx="2" fill="${['#a7836f', '#7e6b8f', '#b99a6b', '#6f8a7e', '#9b6a6a'][(b + r + s) % 5]}"/>`).join('')).join('')}`).join('')}
    ${pane('library', '<rect x="196" y="100" width="140" height="110" rx="70" fill="#8c6a47"/>', '<rect x="204" y="108" width="124" height="94" rx="62"/>', '#d9e0ea', '<circle cx="292" cy="140" r="12" fill="#f2e6b8"/>')}`,
  water: `${pane('water', '<circle cx="266" cy="156" r="58" fill="#8c6a47"/>', '<circle cx="266" cy="156" r="48"/>', '#cfe3ee', '<path d="M210 168q16-10 32 0t32 0t32 0t32 0v40H210z" fill="#86aac6"/>')}
    <rect x="20" y="236" width="130" height="10" rx="4" fill="#8c6a47"/><path d="M44 236q0-20 16-20t16 16h8q-4 8-12 6H44z" fill="#f1cf6a"/><circle cx="66" cy="220" r="2" fill="#2e2620"/>`,
};

export type Emote = 'ok' | 'joy' | 'sad' | 'bored' | 'sick' | 'star' | 'smile' | 'alert';

/** Значки в пузыре над питомцем — SVG 40×40, а не эмодзи: на браузере телевизора шрифта эмодзи может не быть. */
export const EMOTE: Record<Emote, string> = {
  ok: '<path d="M15 29a5 5 0 1 1-2-4V9l15-4v19a5 5 0 1 1-2-4V10l-11 3z" fill="#7a6e60"/>',
  joy: '<path d="M20 33 8 21a7 7 0 0 1 12-9 7 7 0 0 1 12 9z" fill="#d9786f"/>',
  sad: '<path d="M20 5c-6 10-10 15-10 21a10 10 0 0 0 20 0c0-6-4-11-10-21z" fill="#7fa6c9"/>',
  bored: '<text x="7" y="29" font-family="Arial, sans-serif" font-size="21" font-weight="800" fill="#7a6e60">Zz</text>',
  sick: '<rect x="17" y="4" width="7" height="24" rx="3.5" fill="#f4ede2" stroke="#9b6a6a" stroke-width="2"/><rect x="19" y="13" width="3" height="14" fill="#c96a5f"/><circle cx="20.5" cy="30" r="6" fill="#c96a5f"/>',
  star: '<path d="M20 4l4.7 10 10.8 1.2-8 7.3 2.3 10.7L20 27.8l-9.8 5.4 2.3-10.7-8-7.3 10.8-1.2z" fill="#e8b84a"/>',
  smile: '<circle cx="20" cy="20" r="15" fill="#f2c94c"/><circle cx="15" cy="17" r="2" fill="#3f372e"/><circle cx="25" cy="17" r="2" fill="#3f372e"/><path d="M13 23q7 7 14 0" stroke="#3f372e" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
  alert: '<rect x="16.5" y="4" width="7" height="20" rx="3.5" fill="#e0603f"/><circle cx="20" cy="32" r="4.2" fill="#e0603f"/>',
};

/** Растения переднего плана (макет): выезжают по краям экрана на прогулке и празднике. viewBox 0 0 300 360. */
export const PLANTS = {
  left: '<g fill="#7f9a6c"><ellipse cx="120" cy="150" rx="40" ry="120" transform="rotate(-25 120 150)"/><ellipse cx="170" cy="140" rx="34" ry="110" transform="rotate(18 170 140)"/><ellipse cx="80" cy="200" rx="30" ry="90" transform="rotate(-50 80 200)"/></g><g fill="#6b875a"><ellipse cx="200" cy="200" rx="28" ry="90" transform="rotate(45 200 200)"/></g><path d="M70 270h160l-22 90H92z" fill="#c48a5c"/><rect x="62" y="258" width="176" height="24" rx="8" fill="#d39b6b"/>',
  right: '<g fill="#8aa676"><ellipse cx="130" cy="160" rx="38" ry="115" transform="rotate(-20 130 160)"/><ellipse cx="180" cy="170" rx="30" ry="100" transform="rotate(25 180 170)"/></g><path d="M80 270h150l-20 90H100z" fill="#b98b66"/><rect x="72" y="258" width="166" height="24" rx="8" fill="#c99a72"/>',
};
