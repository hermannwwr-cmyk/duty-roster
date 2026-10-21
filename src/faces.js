// Cartoon faces for people on the 2FA Login card, drawn from their name: the same name always
// gets the same face. Plain SVG built here, so no names are sent to an outside avatar service.

const SKIN = ['#f5d0b5', '#eab896', '#d9a27a', '#c08560', '#9a6643', '#6f4630'];
const HAIR = ['#1f1a2e', '#3b2416', '#6b3f1f', '#a0662f', '#d9a441', '#8d8d99', '#b4432f'];
const SHIRT = ['#6d5df5', '#3b82f6', '#14b8a6', '#f59e0b', '#ec4899', '#22c55e', '#f97316'];
const BACK = ['#c7d2fe', '#bae6fd', '#a7f3d0', '#fde68a', '#fbcfe8', '#ddd6fe', '#fed7aa'];

/** A small, stable number stream from a name (FNV-1a, then xorshift). */
function picker(name) {
  let h = 2166136261;
  for (const c of String(name)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return n => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h % n; };
}

// Hair drawn behind the head (long styles) and on top of it.
const HAIR_BACK = [
  '',
  '',
  '<path d="M17 32c-2-14 6-23 15-23s17 9 15 23v14H17z"/>',             // long
  '<path d="M18 30c0-12 6-20 14-20s14 8 14 20v8c-3 2-6 3-6 3V30H24v11s-3-1-6-3z"/>', // bob
  '',
];
const HAIR_FRONT = [
  '<path d="M18 28c0-11 6-17 14-17s14 6 14 17c-4-5-9-7-14-7s-10 2-14 7z"/>',                  // short
  '<path d="M18 27l3-11 4 5 3-8 4 7 4-7 3 8 4-5 3 11c-4-3-9-5-14-5s-10 2-14 5z"/>',            // spiky
  '<path d="M18 29c0-12 6-19 14-19s14 7 14 19c-2-6-7-9-11-9-3 3-9 5-17 9z"/>',                 // long, side part
  '<path d="M18 29c0-12 6-19 14-19s14 7 14 19c-5-4-9-6-14-6s-9 2-14 6z"/>',                    // bob fringe
  '<circle cx="32" cy="9" r="6"/><path d="M18 28c0-11 6-17 14-17s14 6 14 17c-4-5-9-7-14-7s-10 2-14 7z"/>', // bun
];
const EYES = [
  '<circle cx="26.5" cy="32" r="1.9"/><circle cx="37.5" cy="32" r="1.9"/>',
  '<path d="M24 32.5q2.5-2.6 5 0M35 32.5q2.5-2.6 5 0" fill="none" stroke="#1f1a2e" stroke-width="1.6" stroke-linecap="round"/>',
  '<ellipse cx="26.5" cy="32" rx="1.6" ry="2.2"/><ellipse cx="37.5" cy="32" rx="1.6" ry="2.2"/>',
];
const MOUTH = [
  '<path d="M27.5 39.5q4.5 3.5 9 0" fill="none" stroke="#7a2e2e" stroke-width="1.7" stroke-linecap="round"/>',
  '<path d="M27 38.5h10q-1 5-5 5t-5-5z" fill="#7a2e2e"/><path d="M28.5 38.5h7v1.5h-7z" fill="#fff"/>',
  '<path d="M29 40q3 1.8 6 0" fill="none" stroke="#7a2e2e" stroke-width="1.7" stroke-linecap="round"/>',
];

/** An SVG cartoon face for `name`. `size` is in CSS pixels; the face fills a circle. */
export function faceSvg(name, size = 40) {
  const pick = picker(name);
  const skin = SKIN[pick(SKIN.length)], hair = HAIR[pick(HAIR.length)];
  const shirt = SHIRT[pick(SHIRT.length)], back = BACK[pick(BACK.length)];
  const style = pick(HAIR_FRONT.length), eyes = EYES[pick(EYES.length)], mouth = MOUTH[pick(MOUTH.length)];
  const glasses = pick(4) === 0, blush = pick(2) === 0;
  return `<svg class="face" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="32" fill="${back}"/>
  <g>
    <g fill="${hair}">${HAIR_BACK[style] || ''}</g>
    <path d="M8 66c1-12 11-18 24-18s23 6 24 18z" fill="${shirt}"/>
    <rect x="28" y="42" width="8" height="8" rx="3" fill="${skin}"/>
    <circle cx="17.5" cy="33" r="3" fill="${skin}"/><circle cx="46.5" cy="33" r="3" fill="${skin}"/>
    <ellipse cx="32" cy="31" rx="14" ry="15.5" fill="${skin}"/>
    <g fill="${hair}">${HAIR_FRONT[style]}</g>
    <g fill="#1f1a2e">${eyes}</g>
    ${blush ? '<circle cx="23.5" cy="37" r="2.2" fill="#f472b6" opacity=".35"/><circle cx="40.5" cy="37" r="2.2" fill="#f472b6" opacity=".35"/>' : ''}
    ${mouth}
    ${glasses ? '<g fill="none" stroke="#1f1a2e" stroke-width="1.4"><circle cx="26.5" cy="32" r="4.4"/><circle cx="37.5" cy="32" r="4.4"/><path d="M30.9 32h2.2"/></g>' : ''}
  </g>
</svg>`;
}
