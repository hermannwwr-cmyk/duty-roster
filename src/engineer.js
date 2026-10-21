// An infra engineer through the day: an animated illustration for the top of the 2FA Login card.
// Six scenes, picked by the time in Singapore. Plain SVG and CSS (see .engineer in styles.css);
// everything holds still for people who turn off animations.

/**
 * What the scene shows now in Singapore: 'weekend' on Saturdays and Sundays, otherwise the part of
 * the day (morning, lunch, afternoon, evening, afterwork or sleeping). `weekdays: false` ignores the day.
 */
export function periodAt(now = new Date(), { weekdays = true } = {}) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  if (weekdays && (get('weekday') === 'Sat' || get('weekday') === 'Sun')) return 'weekend';
  const m = Number(get('hour')) * 60 + Number(get('minute'));
  if (m >= 23 * 60 || m < 6 * 60) return 'sleeping';
  if (m < 12 * 60) return 'morning';
  if (m < 14 * 60) return 'lunch';
  if (m < 17 * 60 + 30) return 'afternoon';
  if (m < 19 * 60) return 'evening';
  return 'afterwork';
}

const SKIN = '#c98b63', SKIN_DARK = '#b97b55', HAIR = '#1f1a2e', HOODIE = '#6d5df5', HOODIE_LIGHT = '#7c6ff7', HOODIE_DARK = '#5246d6';
const PANTS = '#1e293b', LINE = '#e8ecf8';

/* ---------- Shared pieces ---------- */

function sky(period) {
  const skies = {
    morning: ['#fde68a', '#93c5fd'], lunch: ['#bae6fd', '#7dd3fc'], afternoon: ['#7dd3fc', '#38bdf8'],
    evening: ['#fb923c', '#7c3aed'], afterwork: ['#1e1b4b', '#312e81'], sleeping: ['#0b1020', '#1e1b4b']
  };
  const [top, bottom] = skies[period];
  const light = { morning: '<circle class="rise" cx="44" cy="52" r="9" fill="#fbbf24"/>',
    lunch: '<circle cx="58" cy="28" r="8" fill="#fde047"/>',
    afternoon: '<circle cx="34" cy="26" r="8" fill="#fde047"/><path class="drift" d="M46 40h18a5 5 0 0 0-6-6 6 6 0 0 0-11 2 4 4 0 0 0-1 4z" fill="#ffffff" opacity=".9"/>',
    evening: '<circle class="set" cx="40" cy="48" r="10" fill="#fdba74"/>',
    afterwork: '<path d="M60 24a9 9 0 1 0 6 12 7 7 0 0 1-6-12z" fill="#fef3c7"/>',
    sleeping: '<path d="M60 24a9 9 0 1 0 6 12 7 7 0 0 1-6-12z" fill="#fef3c7"/>' + [[24, 26], [36, 44], [48, 30], [26, 48]].map(([x, y], i) =>
      `<circle class="twinkle" style="animation-delay:${i * 0.6}s" cx="${x}" cy="${y}" r="1.2" fill="#ffffff"/>`).join('') }[period];
  return `
  <defs><linearGradient id="eng-sky-${period}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
    <clipPath id="eng-win-${period}"><rect x="16" y="14" width="58" height="44" rx="3"/></clipPath></defs>
  <rect x="16" y="14" width="58" height="44" rx="3" fill="url(#eng-sky-${period})"/>
  <g clip-path="url(#eng-win-${period})">${light}</g>
  <rect x="16" y="14" width="58" height="44" rx="3" fill="none" stroke="#2a3560" stroke-width="3"/>
  <path d="M45 14v44M16 36h58" stroke="#2a3560" stroke-width="2"/>`;
}

function rack(dim) {
  return `
  <rect x="268" y="40" width="76" height="120" rx="6" fill="#141d36" stroke="#2a3560" stroke-width="2"/>
  <g${dim ? ' opacity=".55"' : ''}>${[0, 1, 2, 3, 4].map(i => `
    <rect x="276" y="${50 + i * 21}" width="60" height="15" rx="3" fill="#1c2748"/>
    <circle class="led" style="animation-delay:${(i * 0.37) % 1.3}s" cx="284" cy="${57.5 + i * 21}" r="2.6" fill="${i % 2 ? '#8b9cff' : '#34d399'}"/>
    <circle class="led slow" style="animation-delay:${(i * 0.61) % 1.9}s" cx="292" cy="${57.5 + i * 21}" r="2.6" fill="#34d399"/>
    <path d="M302 ${54 + i * 21}h26M302 ${58 + i * 21}h26M302 ${62 + i * 21}h18" stroke="#2f3c6b" stroke-width="1.6" stroke-linecap="round"/>`).join('')}
  </g>
  <g class="lock">
    <circle cx="306" cy="20" r="13" fill="#4f46e5" opacity=".25" class="lock-pulse"/>
    <path d="M300 18v-4a6 6 0 0 1 12 0v4" fill="none" stroke="#c4b5fd" stroke-width="2.4"/>
    <rect x="297" y="17" width="18" height="13" rx="3" fill="#c4b5fd"/>
    <circle cx="306" cy="23" r="2" fill="#1e1b4b"/>
  </g>`;
}

const floor = '<line x1="12" y1="160" x2="348" y2="160" stroke="#26304d" stroke-width="2" stroke-linecap="round"/>';

/** The head facing right, centred on (92, 62); move it with `at`. */
function head({ at = [0, 0], headset = true, eyes = 'open', mouth = 'none' } = {}) {
  const eye = { open: `<circle class="blink" cx="100" cy="62" r="1.5" fill="${HAIR}"/>`,
    closed: `<path d="M97 63q3 2 6 0" fill="none" stroke="${HAIR}" stroke-width="1.5" stroke-linecap="round"/>`,
    happy: `<path d="M97 62q3-3 6 0" fill="none" stroke="${HAIR}" stroke-width="1.5" stroke-linecap="round"/>` }[eyes];
  const mouths = { none: '', yawn: '<ellipse class="yawn" cx="102" cy="70" rx="2.6" ry="3.4" fill="#7a2e2e"/>',
    smile: `<path d="M98 69q3 2.5 6 0" fill="none" stroke="#7a2e2e" stroke-width="1.4" stroke-linecap="round"/>`,
    chew: '<ellipse class="chew" cx="102" cy="70" rx="2.2" ry="1.4" fill="#7a2e2e"/>' };
  return `<g transform="translate(${at[0]} ${at[1]})">
    <circle cx="92" cy="62" r="14" fill="${SKIN}"/>
    <path d="M78 63c-1-12 8-19 18-17 7 1 11 6 11 9-5-2-11-1-15 2-3 3-4 6-6 9-3 0-6-1-8-3z" fill="${HAIR}"/>
    ${eye}${mouths[mouth]}
    ${headset ? `<path d="M80 57a14 14 0 0 1 24-3" fill="none" stroke="${LINE}" stroke-width="2.6" stroke-linecap="round"/>
    <rect x="77" y="58" width="7" height="10" rx="3" fill="${LINE}"/>
    <path d="M82 67c3 6 10 7 18 6" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round"/><circle cx="101" cy="73" r="1.8" fill="${LINE}"/>` : ''}
  </g>`;
}

/* ---------- Desk scenes (morning, lunch, afternoon, evening) ---------- */

function desk({ screen, mug = true, steam = true, bowl = false }) {
  return `
  <rect x="112" y="118" width="140" height="8" rx="3" fill="#2a3560"/>
  <rect x="120" y="126" width="6" height="34" rx="2" fill="#222c4d"/>
  <rect x="238" y="126" width="6" height="34" rx="2" fill="#222c4d"/>
  <rect x="158" y="52" width="72" height="52" rx="5" fill="#0b1020" stroke="#3b4a80" stroke-width="3"/>
  ${screen}
  <rect x="190" y="104" width="8" height="12" fill="#2f3c6b"/>
  <rect x="180" y="115" width="28" height="3" rx="1.5" fill="#3b4a80"/>
  <rect x="${bowl ? 210 : 146}" y="114" width="30" height="4" rx="1.5" fill="#3b4a80"/>
  ${mug ? `<rect x="236" y="104" width="11" height="14" rx="2.5" fill="#8b9cff"/>
  <path d="M247 107.5a3.5 3.5 0 0 1 0 7" fill="none" stroke="#8b9cff" stroke-width="2.2"/>` : ''}
  ${mug && steam ? `<path class="steam" d="M239 100c-2-3 2-5 0-8" fill="none" stroke="#a3adca" stroke-width="1.6" stroke-linecap="round"/>
  <path class="steam late" d="M244 100c-2-3 2-5 0-8" fill="none" stroke="#a3adca" stroke-width="1.6" stroke-linecap="round"/>` : ''}
  ${bowl ? `<path d="M134 106h30a15 12 0 0 1-30 0z" fill="#f97316"/><path d="M137 106h24" stroke="#fde68a" stroke-width="3" stroke-linecap="round"/>
  <path class="steam" d="M143 101c-2-3 2-5 0-8" fill="none" stroke="#a3adca" stroke-width="1.6" stroke-linecap="round"/>
  <path class="steam late" d="M153 101c-2-3 2-5 0-8" fill="none" stroke="#a3adca" stroke-width="1.6" stroke-linecap="round"/>` : ''}
  <rect x="54" y="76" width="9" height="48" rx="4" fill="#26305a"/>
  <rect x="58" y="118" width="46" height="7" rx="3.5" fill="#26305a"/>
  <rect x="78" y="125" width="5" height="25" fill="#222c4d"/>
  <path d="M62 152h38" stroke="#222c4d" stroke-width="4" stroke-linecap="round"/>
  <circle cx="64" cy="156" r="3" fill="#2f3c6b"/><circle cx="98" cy="156" r="3" fill="#2f3c6b"/>`;
}

const seatedBody = `
    <rect x="110" y="117" width="10" height="36" rx="5" fill="${PANTS}"/>
    <rect x="108" y="150" width="22" height="7" rx="3.5" fill="${LINE}"/>
    <rect x="76" y="111" width="44" height="12" rx="6" fill="${PANTS}"/>
    <rect x="66" y="80" width="32" height="42" rx="13" fill="${HOODIE}"/>
    <rect x="87" y="72" width="9" height="10" rx="3" fill="${SKIN}"/>`;

const typingArms = (cls = '') => ({
  back: `<path class="arm back${cls}" d="M92 90 L112 104 L146 110" fill="none" stroke="${HOODIE_DARK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="arm back${cls}" cx="148" cy="110" r="4.2" fill="${SKIN_DARK}"/>`,
  front: `<path class="arm front${cls}" d="M88 92 L108 106 L144 114" fill="none" stroke="${HOODIE_LIGHT}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="arm front${cls}" cx="146" cy="114" r="4.4" fill="${SKIN}"/>`
});

const codeScreen = `<clipPath id="eng-screen"><rect x="163" y="57" width="62" height="42" rx="2"/></clipPath>
  <g clip-path="url(#eng-screen)"><g class="code">
    ${[0, 1].map(k => [[34, '#8b9cff'], [22, '#34d399'], [44, '#c4b5fd'], [28, '#8b9cff'], [16, '#f9a8d4'], [38, '#34d399'], [26, '#c4b5fd']]
      .map(([w, c], j) => `<rect x="${j % 3 === 1 ? 172 : 165}" y="${60 + (k * 7 + j) * 7}" width="${w}" height="3" rx="1.5" fill="${c}" opacity=".85"/>`).join('')).join('')}
  </g></g>
  <rect class="cursor" x="165" y="93" width="6" height="4" rx="1" fill="${LINE}"/>`;

function morning() {
  const arms = typingArms();
  return sky('morning') + floor + rack() + desk({ screen: codeScreen }) +
    `<g class="breathe">${seatedBody}${arms.back}${head()}${arms.front}</g>`;
}

function lunch() {
  const screen = `<text x="194" y="76" text-anchor="middle" font-size="8" font-weight="700" fill="#c4b5fd">Lunch break</text>
  <text x="194" y="88" text-anchor="middle" font-size="7" fill="#a3adca">Back at 2pm</text>`;
  return sky('lunch') + floor + rack() + desk({ screen, steam: false, bowl: true }) +
    `<g class="breathe">${seatedBody}
    <path d="M92 90 L110 106 L132 108" fill="none" stroke="${HOODIE_DARK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="134" cy="108" r="4.2" fill="${SKIN_DARK}"/>
    ${head({ mouth: 'chew' })}
    <g class="eat">
      <path d="M88 92 L106 104 L126 92" fill="none" stroke="${HOODIE_LIGHT}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="128" cy="91" r="4.4" fill="${SKIN}"/>
      <path d="M127 89l14 12M130 88l14 11" stroke="#a16207" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M140 100c1 3 0 6-1 8" fill="none" stroke="#fde68a" stroke-width="1.6" stroke-linecap="round"/>
    </g></g>`;
}

function afternoon() {
  const arms = typingArms(' fast');
  const screen = `${[0, 1, 2, 3, 4, 5].map(i => `<rect class="bar" style="animation-delay:${i * 0.23}s" x="${166 + i * 10}" y="64" width="6" height="32" rx="1.5" fill="${i % 2 ? '#8b9cff' : '#34d399'}"/>`).join('')}
  <path d="M164 97h60" stroke="#3b4a80" stroke-width="1.2"/>`;
  return sky('afternoon') + floor + rack() + desk({ screen }) +
    `<g class="breathe">${seatedBody}${arms.back}${head()}${arms.front}</g>`;
}

function evening() {
  const screen = `<text x="194" y="74" text-anchor="middle" font-size="7.5" font-weight="700" fill="#c4b5fd">Shutting down…</text>
  <rect x="172" y="82" width="44" height="5" rx="2.5" fill="#26305a"/>
  <rect class="progress" x="172" y="82" width="44" height="5" rx="2.5" fill="#8b9cff"/>`;
  return sky('evening') + floor + rack() + desk({ screen, steam: false }) +
    `<g class="breathe">${seatedBody}
    <g class="stretch">
      <path d="M90 88 L86 64 L92 42" fill="none" stroke="${HOODIE_DARK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="93" cy="39" r="4.2" fill="${SKIN_DARK}"/>
    </g>
    ${head({ headset: false, eyes: 'closed', mouth: 'yawn' })}
    <g class="stretch late">
      <path d="M94 88 L104 66 L104 42" fill="none" stroke="${HOODIE_LIGHT}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="104" cy="39" r="4.4" fill="${SKIN}"/>
    </g></g>`;
}

/* ---------- After work: on the sofa with the on-call phone ---------- */

function afterwork() {
  return sky('afterwork') + floor + rack(true) + `
  <defs><radialGradient id="eng-lamp"><stop offset="0" stop-color="#fde68a" stop-opacity=".32"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient></defs>
  <circle class="lamp-glow" cx="226" cy="66" r="62" fill="url(#eng-lamp)"/>
  <path d="M216 52h20l6 16h-32z" fill="#fde68a"/><rect x="224" y="68" width="4" height="88" fill="#3b4a80"/><rect x="214" y="155" width="24" height="4" rx="2" fill="#3b4a80"/>
  <rect x="40" y="92" width="152" height="36" rx="12" fill="#4c3d8a"/>
  <rect x="44" y="118" width="144" height="24" rx="8" fill="#3b2f6b"/>
  <rect x="30" y="104" width="22" height="40" rx="9" fill="#4c3d8a"/><rect x="180" y="104" width="22" height="40" rx="9" fill="#4c3d8a"/>
  <rect x="48" y="142" width="6" height="16" fill="#26305a"/><rect x="178" y="142" width="6" height="16" fill="#26305a"/>
  <g class="breathe">
    <rect x="128" y="120" width="40" height="12" rx="6" fill="${PANTS}"/>
    <rect x="158" y="124" width="10" height="32" rx="5" fill="${PANTS}"/>
    <rect x="156" y="152" width="22" height="7" rx="3.5" fill="${LINE}"/>
    <rect x="108" y="88" width="32" height="40" rx="13" fill="${HOODIE}"/>
    <rect x="125" y="80" width="9" height="10" rx="3" fill="${SKIN}"/>
    ${head({ at: [38, 16], headset: false, eyes: 'happy', mouth: 'smile' })}
    <path d="M126 98 L140 112 L150 104" fill="none" stroke="${HOODIE_LIGHT}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="148" y="92" width="9" height="15" rx="2" fill="#111827"/>
    <rect class="phone" x="149.5" y="93.5" width="6" height="12" rx="1" fill="#8b9cff"/>
    <circle class="tap" cx="151" cy="106" r="3.6" fill="${SKIN}"/>
  </g>`;
}

/* ---------- Sleeping: in bed, phone on loud on the nightstand ---------- */

function sleeping() {
  return sky('sleeping') + floor + rack(true) + `
  <rect x="34" y="86" width="12" height="74" rx="4" fill="#2a3560"/>
  <rect x="40" y="118" width="196" height="16" rx="5" fill="#2a3560"/>
  <rect x="226" y="108" width="12" height="52" rx="4" fill="#2a3560"/>
  <rect x="48" y="134" width="6" height="24" fill="#222c4d"/><rect x="220" y="134" width="6" height="24" fill="#222c4d"/>
  <rect x="46" y="108" width="182" height="14" rx="5" fill="#c7d2fe"/>
  <ellipse cx="72" cy="104" rx="20" ry="8" fill="${LINE}"/>
  ${head({ at: [-18, 34], headset: false, eyes: 'closed' }).replace('<g transform="translate(-18 34)">', '<g transform="translate(-18 34) rotate(-12 92 62)">')}
  <path class="blanket" d="M84 110c2-12 24-16 46-14s58 0 76-2 22 6 22 16v6H84z" fill="${HOODIE}"/>
  <path d="M110 104c30-4 70-4 110-6" fill="none" stroke="${HOODIE_LIGHT}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
  <g class="zzz" fill="#c7d2fe" font-weight="800">
    <text x="92" y="74" font-size="10">z</text><text x="102" y="62" font-size="13">z</text><text x="114" y="48" font-size="16">Z</text>
  </g>
  <rect x="242" y="128" width="22" height="32" rx="3" fill="#26305a"/><rect x="246" y="138" width="14" height="2" rx="1" fill="#3b4a80"/>
  <ellipse class="phone-glow" cx="253" cy="124" rx="13" ry="7" fill="#8b9cff" opacity=".45"/>
  <rect x="245" y="123" width="16" height="5" rx="1.5" fill="#111827"/><rect class="phone" x="246.5" y="124" width="13" height="3" rx="1" fill="#c7d2fe"/>`;
}

/* ---------- Weekend: nobody in, room lights off ---------- */

function weekend() {
  // The window still follows the time of day; the room itself is dark.
  const outside = periodAt(new Date(), { weekdays: false });
  const daytime = ['morning', 'lunch', 'afternoon'].includes(outside);
  const screen = '<circle class="standby" cx="224" cy="99" r="1.4" fill="#34d399"/>';
  return floor + desk({ screen, steam: false }) + `
  <rect x="0" y="0" width="360" height="172" fill="#05070f" opacity=".55"/>
  ${sky(outside)}
  <path d="M16 58h58l40 102H24z" fill="${daytime ? '#fde68a' : '#c7d2fe'}" opacity="${daytime ? '.07' : '.05'}"/>
  <rect x="106" y="62" width="10" height="16" rx="2" fill="#1c2748" stroke="#2a3560"/><rect x="109.5" y="70" width="3" height="5" rx="1" fill="#3b4a80"/>
  ${rack(true)}`;
}

const SCENES = {
  morning: [morning, 'Good morning! Coffee first, then the servers.'],
  lunch: [lunch, 'Lunch break. Back at 2pm.'],
  afternoon: [afternoon, 'Afternoon: deep in the dashboards.'],
  evening: [evening, 'Wrapping up for the day.'],
  afterwork: [afterwork, 'Off duty, still on call.'],
  sleeping: [sleeping, 'Sleeping. Phone on loud, just in case.'],
  weekend: [weekend, 'Weekend: lights off. The servers keep watch.']
};

/** The illustration and its caption for a part of the day (default: now in Singapore). */
export function engineerScene(period = periodAt()) {
  const [draw, caption] = SCENES[period] || SCENES.morning;
  return { period, caption, svg: `<svg class="engineer scene-${period}" viewBox="0 0 360 172" role="img" aria-label="${caption}">${draw()}</svg>` };
}
