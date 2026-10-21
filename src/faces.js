// Avatars for people on the 2FA Login card, drawn from their name: the same name always gets the same
// avatar. Male-presenting (short haircuts, sometimes facial hair, collared shirt) with nothing that hints
// at ethnicity: everyone has the same face colour, which isn't a skin tone, and the same stylised hair
// colour. People are told apart by shirt and background colour, haircut, facial hair, eyes, mouth and
// glasses or a headset. Plain SVG; no names leave the page.

const FACE = '#e9e4ff', FACE_SHADE = '#d6cff7', HAIR = '#2b2f45', INK = '#1f1a2e';
const SHIRT = [['#6d5df5', '#5246d6'], ['#3b82f6', '#2563eb'], ['#14b8a6', '#0f766e'], ['#f59e0b', '#d97706'],
  ['#ec4899', '#be185d'], ['#22c55e', '#15803d'], ['#f97316', '#c2410c'], ['#64748b', '#475569']];
const BACK = ['#c7d2fe', '#bae6fd', '#a7f3d0', '#fde68a', '#fbcfe8', '#ddd6fe', '#fed7aa'];

/** A small, stable number stream from a name (FNV-1a, then xorshift). */
function picker(name) {
  let h = 2166136261;
  for (const c of String(name)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return n => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h % n; };
}

// Short haircuts, drawn over the top of the head (head is centred on 32, 30, about 13 wide).
const HAIRCUTS = [
  'M19 27c-1-10 5-16 13-16s14 6 13 16c-2-4-6-6-13-6s-11 2-13 6z',                                    // crew cut
  'M19 28c-1-11 5-17 14-17 8 0 13 6 12 15-5-1-9-3-12-7-2 4-7 7-14 9z',                                // side part
  'M19 27c0-9 4-14 10-15 2-3 8-4 11-1 4 2 6 7 5 15-2-4-6-6-13-6s-11 2-13 7z',                       // quiff
  'M19.5 26c0-8 5-13 12.5-13s12.5 5 12.5 13c-3-3-7-4-12.5-4s-9.5 1-12.5 4z',                          // buzz
];
const BEARDS = [
  '',
  `<path d="M26 39.5q6-3 12 0" fill="none" stroke="${HAIR}" stroke-width="2.4" stroke-linecap="round"/>`,         // moustache
  `<path d="M19.5 33c0 9 5 15 12.5 15s12.5-6 12.5-15c-2 4-4 6-6 6.5q-6.5-3-13 0c-2-.5-4-2.5-6-6.5z" fill="${HAIR}"/>`, // short beard
  `<path d="M20 34c1 8 6 13 12 13s11-5 12-13c-1 6-5 9-12 9s-11-3-12-9z" fill="${HAIR}" opacity=".22"/>`,            // stubble
];
const EYES = [
  `<circle cx="27" cy="30" r="2"/><circle cx="37" cy="30" r="2"/>`,
  `<path d="M24.8 31q2.2-2.6 4.4 0M34.8 31q2.2-2.6 4.4 0" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>`,
];
const MOUTHS = [
  `<path d="M28.5 41q3.5 2.8 7 0" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>`,
  `<path d="M28 40.5h8q-.8 4.2-4 4.2t-4-4.2z" fill="${INK}"/>`,
];
const EXTRAS = [
  '',
  '',
  `<g fill="none" stroke="${INK}" stroke-width="1.5"><rect x="22.5" y="26.5" width="8.5" height="7" rx="2.5"/><rect x="33" y="26.5" width="8.5" height="7" rx="2.5"/><path d="M31 29.5h2"/></g>`,
  `<path d="M18.5 29a13.5 13.5 0 0 1 27 0" fill="none" stroke="${INK}" stroke-width="2.2"/><rect x="16" y="27" width="5" height="8" rx="2.2" fill="${INK}"/>`,
];

/** An SVG avatar for `name`. `size` is in CSS pixels; the avatar fills a circle. */
export function faceSvg(name, size = 40) {
  const pick = picker(name);
  const [shirt, shade] = SHIRT[pick(SHIRT.length)], back = BACK[pick(BACK.length)];
  const hair = HAIRCUTS[pick(HAIRCUTS.length)], beard = BEARDS[pick(BEARDS.length)];
  const eyes = EYES[pick(EYES.length)], extra = EXTRAS[pick(EXTRAS.length)];
  // A light mouth on a full beard, so it still shows.
  let mouth = MOUTHS[pick(MOUTHS.length)];
  if (beard === BEARDS[2]) mouth = mouth.replaceAll(INK, FACE);
  return `<svg class="face" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="32" fill="${back}"/>
  <path d="M4 68c1-14 12-20 28-20s27 6 28 20z" fill="${shirt}"/>
  <rect x="26.5" y="40" width="11" height="11" rx="4" fill="${FACE_SHADE}"/>
  <path d="M24 48l8 7 8-7-3-2-5 4-5-4z" fill="#ffffff"/>
  <path d="M32 55v9" stroke="${shade}" stroke-width="1.6"/>
  <circle cx="18.5" cy="31" r="3" fill="${FACE_SHADE}"/><circle cx="45.5" cy="31" r="3" fill="${FACE_SHADE}"/>
  <path d="M19 28c0-10 5.5-15 13-15s13 5 13 15v4c0 9-5.5 16-13 16s-13-7-13-16z" fill="${FACE}"/>
  <path d="${hair}" fill="${HAIR}"/>
  ${beard}
  <g fill="${INK}">${eyes}</g>
  ${mouth}
  ${extra}
</svg>`;
}
