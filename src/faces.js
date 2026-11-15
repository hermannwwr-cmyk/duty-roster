// A drawn face for each person, made from their name: the same name always gets the same face.
// Plain SVG built here, so no names are sent to an outside avatar service.

// [skin, its shadow under the chin, the mouth]
const SKIN = [['#f6d3b8', '#e3b494', '#8a3b33'], ['#f0c4a0', '#dba682', '#8a3b33'], ['#dca57c', '#c58b62', '#7a2e2e'],
  ['#c08560', '#a56d49', '#6a2a24'], ['#9c6a48', '#855638', '#4d211b'], ['#7a4e36', '#653f2a', '#3a1a16']];
const HAIR = ['#1c1b2b', '#23182a', '#3a2a22', '#5a3a26', '#8a5a2b', '#b5532e', '#8d8d99', '#d0a144'];
const SHIRT = ['#f0846a', '#2fb39a', '#f2b544', '#4f8df0', '#9b83f2', '#ec6f9c', '#5cc47a', '#f0975a'];
// Light, cool backgrounds, so every face sits well on the dark page.
const BACK = ['#bfe9f2', '#c9d6fb', '#bfe0fb', '#c3ecd9', '#efe1c6', '#d9d2f7', '#cfeee9'];

// Hair styles. `back` is drawn behind the head, `locks` over the shoulders, `front` on top of the head.
const STYLES = [
  { back: '<path d="M15.5 33c-1.5-13.5 5.5-22.5 16.5-22.5S50 19.5 48.5 33l.5 11c.2 2.5-1.5 4-4 4H19c-2.5 0-4.2-1.5-4-4z"/>',            // bob with a fringe
    front: '<path d="M18.5 29.5c-.5-9.5 5-15.5 13.5-15.5S46 20 45.5 29.5c-4-.8-7.5-3.2-9.5-6.8-3.5 4-9.5 6.5-17.5 6.8z"/>' },
  { front: '<path d="M18.8 28c-1-9.5 4.5-14.5 13.2-14.5S46.2 18.5 45.2 28c-1.2-3.8-3.8-6-7.2-6.5H26c-3.4.5-6 2.7-7.2 6.5z"/>' },        // short crop
  { back: '<path d="M14.5 36c-2-15.5 5.5-25.5 17.5-25.5S51.5 20.5 49.5 36v22h-35z"/>',                                                // long, side parting
    locks: '<path d="M14.5 40v13c0 2 1.5 3.5 3.5 3.5h2.5V40zM49.5 40v13c0 2-1.5 3.5-3.5 3.5h-2.5V40z"/>',
    front: '<path d="M18.5 30.5c-1-10 4.5-16.5 13.5-16.5s14.5 6.5 13.5 16.5c-2-5-5.5-8-10-8.8-4 5-9.5 7.8-17 8.8z"/>' },
  { front: '<path d="M18.6 27.5c-2.8-2.3-2-6.8 1.4-7.8.3-3.8 4.6-5.8 7.8-3.9 2.3-2.7 6.8-2.6 8.9.2 3.4-1.3 7 1.3 6.9 4.9 3 1.4 3.3 5.6.8 7.6-1.3-3.3-4-5.3-7.4-5.6H26c-3.4.3-6.1 1.9-7.4 4.6z"/>' },   // curly top
  { back: '<circle cx="32" cy="10.5" r="6.5"/>',                                                                                       // bun
    front: '<path d="M18.6 29c-.8-9.5 4.8-15 13.4-15s14.2 5.5 13.4 15c-2.2-5.3-6.6-8.3-13.4-8.8-6.8.5-11.2 3.5-13.4 8.8z"/>' },
  { front: '<path d="M18.6 28.5c-.9-9.5 4.7-15 13.4-15 8.6 0 14.3 5.3 13.4 14.5-2.4-4-6.2-6.3-11.4-6.7-5 .2-10.4 2.8-15.4 7.2z"/>' }     // short, swept to one side
];
const EYES = [
  '<circle cx="26.8" cy="32.8" r="1.7"/><circle cx="37.2" cy="32.8" r="1.7"/>',
  '<path d="M24.6 33.4q2.2-2.5 4.4 0M35 33.4q2.2-2.5 4.4 0" fill="none" stroke="#1b2330" stroke-width="1.6" stroke-linecap="round"/>',
  '<ellipse cx="26.8" cy="32.8" rx="1.5" ry="2.1"/><ellipse cx="37.2" cy="32.8" rx="1.5" ry="2.1"/>'
];
const MOUTHS = [
  c => `<path d="M28.2 38.9q3.8 3 7.6 0" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
  c => `<path d="M27.6 38.4h8.8q-.8 4.4-4.4 4.4t-4.4-4.4z" fill="${c}"/><path d="M29 38.4h6v1.3h-6z" fill="#ffffff"/>`,
  c => `<path d="M29.2 39.4q2.800 1.800 5.600 0" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`
];

// A fixed starting point for the picker. Any number gives every name a stable face; this one was chosen so
// the five demo people come out close to the faces drawn for the design.
const SEED = 402826850;

/** A small, stable number stream from a name (FNV-1a, then xorshift). */
function picker(name) {
  let h = (2166136261 ^ SEED) >>> 0;
  for (const c of String(name).trim().toLowerCase()) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return n => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h % n; };
}

/** An SVG face for `name`. It fills its box; the page clips it to a circle. */
export function faceSvg(name) {
  const pick = picker(name);
  const [skin, shade, lips] = SKIN[pick(SKIN.length)];
  const hair = HAIR[pick(HAIR.length)], shirt = SHIRT[pick(SHIRT.length)], back = BACK[pick(BACK.length)];
  const style = STYLES[pick(STYLES.length)], eyes = EYES[pick(EYES.length)], mouth = MOUTHS[pick(MOUTHS.length)];
  const glasses = pick(4) === 0, blush = pick(2) === 0;
  return `<svg class="face" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect width="64" height="64" fill="${back}"/>
  <g fill="${hair}">${style.back || ''}</g>
  <path d="M8 66c.5-11.5 10-17.5 24-17.5S55.5 54.5 56 66z" fill="${shirt}"/>
  <g fill="${hair}">${style.locks || ''}</g>
  <path d="M27 40h10v9.5a5 5 0 0 1-10 0z" fill="${shade}"/>
  <circle cx="18.8" cy="32.5" r="2.9" fill="${skin}"/><circle cx="45.2" cy="32.5" r="2.9" fill="${skin}"/>
  <rect x="19" y="15" width="26" height="31" rx="13" fill="${skin}"/>
  <path d="M24.3 28.6q2.5-1.3 5 0M34.7 28.6q2.5-1.3 5 0" fill="none" stroke="#1b2330" stroke-width="1.1" stroke-linecap="round" opacity=".65"/>
  <g fill="${hair}">${style.front}</g>
  <g fill="#1b2330">${eyes}</g>
  ${blush ? '<circle cx="23.6" cy="37.4" r="2.4" fill="#f27b8a" opacity=".3"/><circle cx="40.4" cy="37.4" r="2.4" fill="#f27b8a" opacity=".3"/>' : ''}
  ${mouth(lips)}
  ${glasses ? '<g fill="none" stroke="#1b2330" stroke-width="1.3"><rect x="21.8" y="29" width="9.4" height="7.6" rx="3.4"/><rect x="32.8" y="29" width="9.4" height="7.6" rx="3.4"/><path d="M31.2 32.200h1.600"/></g>' : ''}
</svg>`;
}
