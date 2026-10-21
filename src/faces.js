// Avatars for people on the 2FA Login card, drawn from their name: the same name always gets the same
// avatar. Deliberately neutral: everyone wears a hoodie with the hood up (no hair) and has the same
// soft face colour (not a skin tone), so avatars say nothing about gender or ethnicity. People are told
// apart by hoodie and background colour, eyes, mouth and an accessory. Plain SVG; no names leave the page.

const FACE = '#e9e4ff';
const INK = '#1f1a2e';
const HOODIE = [['#6d5df5', '#5246d6'], ['#3b82f6', '#2563eb'], ['#14b8a6', '#0f766e'], ['#f59e0b', '#d97706'],
  ['#ec4899', '#be185d'], ['#22c55e', '#15803d'], ['#f97316', '#c2410c'], ['#8b5cf6', '#6d28d9']];
const BACK = ['#c7d2fe', '#bae6fd', '#a7f3d0', '#fde68a', '#fbcfe8', '#ddd6fe', '#fed7aa'];

/** A small, stable number stream from a name (FNV-1a, then xorshift). */
function picker(name) {
  let h = 2166136261;
  for (const c of String(name)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return n => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h % n; };
}

const EYES = [
  `<circle cx="27" cy="33" r="2.2"/><circle cx="37" cy="33" r="2.2"/>`,
  `<path d="M24.5 34q2.5-3 5 0M34.5 34q2.5-3 5 0" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`,
  `<ellipse cx="27" cy="33" rx="1.8" ry="2.6"/><ellipse cx="37" cy="33" rx="1.8" ry="2.6"/>`,
];
const MOUTHS = [
  `<path d="M28 40q4 3.5 8 0" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`,
  `<path d="M27.5 39.5h9q-1 5-4.5 5t-4.5-5z" fill="${INK}"/>`,
  `<path d="M29.5 41q2.5 1.6 5 0" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`,
];
// Accessories: none, headset, glasses, beanie over the hood.
const EXTRAS = [
  () => '',
  () => `<path d="M19 33a13 13 0 0 1 26 0" fill="none" stroke="${INK}" stroke-width="2.4"/><rect x="16.5" y="31" width="5" height="8" rx="2.2" fill="${INK}"/>
    <path d="M19.5 39q1 6 9 6" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/><circle cx="29" cy="45" r="1.6" fill="${INK}"/>`,
  () => `<g fill="none" stroke="${INK}" stroke-width="1.6"><circle cx="27" cy="33" r="4.4"/><circle cx="37" cy="33" r="4.4"/><path d="M31.4 33h1.2"/></g>`,
  hood => `<path d="M18 22a14 12 0 0 1 28 0v2H18z" fill="${hood}"/><rect x="17" y="21" width="30" height="5" rx="2.5" fill="#ffffff" opacity=".35"/><circle cx="32" cy="10" r="3.4" fill="${hood}"/>`,
];

/** An SVG avatar for `name`. `size` is in CSS pixels; the avatar fills a circle. */
export function faceSvg(name, size = 40) {
  const pick = picker(name);
  const [hoodie, shade] = HOODIE[pick(HOODIE.length)], back = BACK[pick(BACK.length)];
  const eyes = EYES[pick(EYES.length)], mouth = MOUTHS[pick(MOUTHS.length)], extra = EXTRAS[pick(EXTRAS.length)];
  return `<svg class="face" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="32" fill="${back}"/>
  <path d="M6 68c1-14 12-21 26-21s25 7 26 21z" fill="${hoodie}"/>
  <path d="M32 5c-13 0-21 9-21 22 0 10 4 17 10 21h22c6-4 10-11 10-21 0-13-8-22-21-22z" fill="${hoodie}"/>
  <ellipse cx="32" cy="35" rx="13.5" ry="14.5" fill="${shade}"/>
  <ellipse cx="32" cy="36" rx="12" ry="13" fill="${FACE}"/>
  <path d="M27 51l-1.5 8M37 51l1.5 8" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>
  <g fill="${INK}">${eyes}</g>
  ${mouth}
  ${extra(shade)}
</svg>`;
}
