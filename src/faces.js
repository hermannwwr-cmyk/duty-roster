// Simple cartoon faces for people on the 2FA Login card, drawn from their name: the same name always
// gets the same face. Deliberately neutral: a coloured face with no skin tone, hair or clothing, told
// apart by colour, eyes, mouth and the odd pair of glasses. Plain SVG, so no names leave the page.

const FACE = ['#a78bfa', '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#22d3ee', '#fb923c', '#c084fc', '#4ade80', '#f87171'];
const INK = '#1f1a2e';

/** A small, stable number stream from a name (FNV-1a, then xorshift). */
function picker(name) {
  let h = 2166136261;
  for (const c of String(name)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return n => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h % n; };
}

const EYES = [
  `<circle cx="23" cy="28" r="3.2"/><circle cx="41" cy="28" r="3.2"/>`,                                       // dots
  `<path d="M19 29q4-5 8 0M37 29q4-5 8 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`, // smiling
  `<ellipse cx="23" cy="28" rx="2.6" ry="3.8"/><ellipse cx="41" cy="28" rx="2.6" ry="3.8"/>`,                  // tall
  `<circle cx="23" cy="28" r="3.2"/><path d="M37 28.5h8" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`, // wink
];
const MOUTHS = [
  `<path d="M24 40q8 7 16 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`,       // smile
  `<path d="M23 39h18q-2 9-9 9t-9-9z" fill="${INK}"/>`,                                                       // big grin
  `<path d="M27 42q5 3 10 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`,        // small smile
  `<ellipse cx="32" cy="42" rx="3.4" ry="4" fill="${INK}"/>`,                                                 // "oh"
];

/** An SVG cartoon face for `name`. `size` is in CSS pixels. */
export function faceSvg(name, size = 40) {
  const pick = picker(name);
  const face = FACE[pick(FACE.length)], eyes = EYES[pick(EYES.length)], mouth = MOUTHS[pick(MOUTHS.length)];
  const glasses = pick(4) === 0, cheeks = pick(2) === 0;
  return `<svg class="face" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="32" fill="${face}"/>
  <circle cx="32" cy="32" r="32" fill="url(#face-shine)"/>
  <defs><radialGradient id="face-shine" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
  ${cheeks ? '<circle cx="16" cy="38" r="4" fill="#ffffff" opacity=".3"/><circle cx="48" cy="38" r="4" fill="#ffffff" opacity=".3"/>' : ''}
  <g fill="${INK}">${eyes}</g>
  ${glasses ? `<g fill="none" stroke="${INK}" stroke-width="2.2"><circle cx="23" cy="28" r="7"/><circle cx="41" cy="28" r="7"/><path d="M30 28h4"/></g>` : ''}
  ${mouth}
</svg>`;
}
