// An infra engineer through the day: the animated illustration at the top of the 2FA Login card.
// One room, lit by the time in Singapore: six weekday scenes, and the lights off on weekends and
// public holidays. Plain SVG and CSS (see .engineer in styles.css); everything holds still for
// people who turn off animations.

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

const SKIN = '#f0c4a0', SKIN_DARK = '#dba682', HAIR = '#1c1b2b', INK = '#1b2330', LINE = '#e6f4f8', PANTS = '#2d4f66';
// The hoodie follows the theme: --hoodie, --hoodie-light and --hoodie-dark in styles.css.
const HOODIE = 'var(--hoodie, #f0846a)', HOODIE_LIGHT = 'var(--hoodie-light, #f59a80)', HOODIE_DARK = 'var(--hoodie-dark, #d96f57)';

/* ---------- The window: a sky for each part of the day ---------- */

const CLOUD = 'M72 42h24a6.5 6.5 0 0 0-7.5-7 8 8 0 0 0-14.5 2.2A5 5 0 0 0 72 42z';
const MOON = '<path d="M90 30a11 11 0 1 0 8.5 16.5A9 9 0 0 1 90 30z" fill="#fef3c7"/>';
const stars = twinkle => [[36, 32, 1.1], [54, 44, .9], [40, 60, 1], [76, 62, .9], [102, 64, 1]].map(([x, y, r], i) =>
  `<circle${twinkle ? ` class="twinkle" style="animation-delay:${(i * 0.6).toFixed(1)}s"` : ''} cx="${x}" cy="${y}" r="${r}" fill="#ffffff"/>`).join('');
// stops: the sky from top to bottom. city: the skyline's colour and strength. light: what comes through the window.
const SKY = {
  morning: { stops: ['#6fc2f2', '#bfe4f4', '#ffe2a6'], city: ['#3a7ea6', .6], light: '#ffe7b0', beam: .2,
    draw: `<g class="rise"><circle cx="46" cy="68" r="19" fill="#ffd166" opacity=".3"/><circle cx="46" cy="68" r="11" fill="#ffd166"/></g><path d="${CLOUD}" fill="#ffffff" opacity=".9"/>` },
  lunch: { stops: ['#4fb4f0', '#8fd0f5', '#cdecfb'], city: ['#3a7ea6', .55], light: '#fff3c4', beam: .17,
    draw: '<circle cx="86" cy="36" r="15" fill="#ffe066" opacity=".3"/><circle cx="86" cy="36" r="9" fill="#ffe066"/>' },
  afternoon: { stops: ['#5ab8f0', '#a8dbf5', '#e4f1dc'], city: ['#3a7ea6', .55], light: '#ffe7b0', beam: .17,
    draw: `<circle cx="94" cy="44" r="15" fill="#ffd166" opacity=".3"/><circle cx="94" cy="44" r="9" fill="#ffd166"/><g transform="translate(-38 -2)"><path class="drift" d="${CLOUD}" fill="#ffffff" opacity=".9"/></g>` },
  evening: { stops: ['#4d43a3', '#c95f94', '#fbab6e'], city: ['#33296b', .85], light: '#ffb27a', beam: .2,
    draw: `<g class="set"><circle cx="60" cy="77" r="21" fill="#ffb057" opacity=".35"/><circle cx="60" cy="77" r="12" fill="#ffb057"/></g><path d="${CLOUD}" fill="#ffd9c8" opacity=".75"/>` },
  afterwork: { stops: ['#121a4c', '#27307a', '#4b3f8f'], city: ['#0c1436', .92], light: '#bcd7ff', beam: .07, night: true, draw: MOON + stars(false) },
  sleeping: { stops: ['#081028', '#12245a', '#1d3672'], city: ['#0a1634', .95], light: '#bcd7ff', beam: .13, night: true, draw: MOON + stars(true) }
};

function defs(sky) {
  return `<defs>
  <linearGradient id="eng-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16405a"/><stop offset="1" stop-color="#0e2b3b"/></linearGradient>
  <linearGradient id="eng-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#081b25"/><stop offset="1" stop-color="#0b1e29"/></linearGradient>
  <linearGradient id="eng-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky.stops[0]}"/><stop offset=".6" stop-color="${sky.stops[1]}"/><stop offset="1" stop-color="${sky.stops[2]}"/></linearGradient>
  <linearGradient id="eng-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky.light}" stop-opacity="${sky.beam}"/><stop offset="1" stop-color="${sky.light}" stop-opacity=".02"/></linearGradient>
  <radialGradient id="eng-glow" cx="66" cy="54" r="120" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${sky.light}" stop-opacity="${sky.night ? .05 : .16}"/><stop offset="1" stop-color="${sky.light}" stop-opacity="0"/></radialGradient>
  <radialGradient id="eng-lamp" cx="283" cy="96" r="78" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fde68a" stop-opacity=".4"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient>
  <clipPath id="eng-win"><rect x="22" y="20" width="88" height="68" rx="6"/></clipPath>
  </defs>`;
}

const walls = `<rect width="358" height="196" fill="url(#eng-wall)"/><rect width="358" height="196" fill="url(#eng-glow)"/>
  <rect y="150" width="358" height="46" fill="url(#eng-floor)"/><rect y="150" width="358" height="1.5" fill="#235066"/>`;

function windowPane(sky) {
  return `<rect x="22" y="20" width="88" height="68" rx="6" fill="url(#eng-sky)"/>
  <g clip-path="url(#eng-win)">${sky.draw}
    <path d="M22 88V77h8v-7h7v11h6V65h9v15h7v-9h8v11h7V69h8v13h6v-8h8v9h4v5z" fill="${sky.city[0]}" opacity="${sky.city[1]}"/>
    ${sky.night ? '<path d="M46 70h2v2h-2zM47 76h2v2h-2zM61 75h2v2h-2zM85 73h2v2h-2zM86 79h2v2h-2zM33 81h2v2h-2zM98 78h2v2h-2z" fill="#fde68a" opacity=".85"/>' : ''}
  </g>
  <rect x="22" y="20" width="88" height="68" rx="6" fill="none" stroke="#2a6079" stroke-width="3"/>
  <path d="M66 20v68M22 54h88" fill="none" stroke="#2a6079" stroke-width="2"/>
  <rect x="17" y="87" width="98" height="5" rx="2.5" fill="#2a6079"/>`;
}

const beam = sky => `<path d="M24 92h88l62 58H56z" fill="url(#eng-beam)"/><path d="M56 150h118l20 46H68z" fill="${sky.light}" opacity="${(sky.beam / 5).toFixed(3)}"/>`;

/* ---------- The room ---------- */

/** The wall clock's two hands, as one path, at the time in Singapore. The page moves them in place every minute. */
export function clockHands(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find(p => p.type === 'hour').value), m = Number(parts.find(p => p.type === 'minute').value);
  const hand = (degrees, length) => { const a = degrees * Math.PI / 180; return `l${(Math.sin(a) * length).toFixed(1)} ${(-Math.cos(a) * length).toFixed(1)}`; };
  return `M154 34${hand(m * 6, 7.5)}M154 34${hand((h % 12) * 30 + m / 2, 5.3)}`;
}

/** The wall clock shows the real time in Singapore. */
function clock(now) {
  return `<circle cx="154" cy="34" r="11.5" fill="#0b2431" stroke="#2f6a85" stroke-width="2"/>
  <path class="hands" d="${clockHands(now)}" fill="none" stroke="${LINE}" stroke-width="1.7" stroke-linecap="round"/>
  <circle cx="154" cy="34" r="1.3" fill="#7dd3fc"/>`;
}

const plant = `<path d="M48 127c-2-12-10-19-17-19 0 9 6 17 17 19z" fill="#249a84"/><path d="M48 127c2-15 10-23 19-23 0 11-8 20-19 23z" fill="#1c8371"/>
  <path d="M48 127c-4-14-1-27 3-32 5 7 5 21-3 32z" fill="#33b79c"/><path d="M37 129h22l-2.5 21h-17z" fill="#d9825f"/><rect x="34.5" y="125" width="27" height="5.5" rx="2.5" fill="#eb9d7c"/>`;

const chair = `<rect x="96" y="82" width="9" height="46" rx="4.5" fill="#1d4a61"/><rect x="100" y="123" width="46" height="7" rx="3.5" fill="#1d4a61"/>
  <rect x="120" y="130" width="5" height="15" fill="#163c4e"/><path d="M105 147h35" fill="none" stroke="#163c4e" stroke-width="4" stroke-linecap="round"/>
  <circle cx="106" cy="149.5" r="2.8" fill="#2a6079"/><circle cx="139" cy="149.5" r="2.8" fill="#2a6079"/>`;

const shadow = '<ellipse cx="206" cy="152.5" rx="116" ry="3" fill="#000000" opacity=".28"/>';
const deskLegs = '<rect x="166" y="124" width="6" height="26" fill="#17394a"/><rect x="280" y="124" width="6" height="26" fill="#17394a"/>';
const deskTop = '<rect x="158" y="117" width="134" height="7" rx="3" fill="#2a6079"/>';
const keyboard = '<rect x="168" y="112.5" width="32" height="4.5" rx="2" fill="#3a7690"/>';
const monitor = screen => `<rect x="202" y="54" width="70" height="50" rx="5" fill="#06131b" stroke="#3a7690" stroke-width="2.5"/>${screen}
  <rect x="233" y="104" width="8" height="10.5" fill="#2a6079"/><rect x="223" y="113.5" width="28" height="3.5" rx="1.7" fill="#3a7690"/>`;

const SCREEN = {
  code: `${[[210, 65, 20, '#38bdf8'], [210, 72.5, 34, '#9bb8c4'], [217, 80, 24, '#fbbf24'], [217, 87.5, 16, '#5eead4'], [210, 95, 28, '#38bdf8']].map(([x, y, w, c]) =>
    `<path d="M${x} ${y}h${w}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`).join('')}<rect class="cursor" x="243" y="92.5" width="5" height="5" rx="1" fill="${LINE}"/>`,
  // Lunch at the desk: duty goes on, so nothing on the screen says "away".
  lunch: `<text x="237" y="77" text-anchor="middle" font-size="8" font-weight="700" fill="#7dd3fc">Lunchtime</text>
    <text x="237" y="89" text-anchor="middle" font-size="7" fill="#9bb8c4">Still on duty</text>`,
  bars: `${[0, 1, 2, 3, 4, 5].map(i => `<rect class="bar" style="animation-delay:${(i * 0.23).toFixed(2)}s" x="${(211 + i * 9.2).toFixed(1)}" y="66" width="6" height="30" rx="1.5" fill="${i % 2 ? '#38bdf8' : '#5eead4'}"/>`).join('')}
    <path d="M209 97.5h56" fill="none" stroke="#2f6a85" stroke-width="1.2"/>`,
  shutdown: `<text x="237" y="75" text-anchor="middle" font-size="7.5" font-weight="700" fill="#7dd3fc">Shutting down…</text>
    <rect x="215" y="83" width="44" height="5" rx="2.5" fill="#123445"/><rect class="progress" x="215" y="83" width="44" height="5" rx="2.5" fill="#38bdf8"/>`,
  off: ''
};
const standby = '<circle class="standby" cx="266.5" cy="99" r="1.6" fill="#5eead4"/>';

const mug = steam => `<rect x="276" y="104.5" width="10" height="12.5" rx="2.5" fill="${LINE}"/><path d="M286 107.5a3.2 3.2 0 0 1 0 6.4" fill="none" stroke="${LINE}" stroke-width="2"/>
  ${steam ? '<path class="steam" d="M279 100c-2-3 2-5 0-8" fill="none" stroke="#9bb8c4" stroke-width="1.5" stroke-linecap="round"/><path class="steam late" d="M284 100c-2-3 2-5 0-8" fill="none" stroke="#9bb8c4" stroke-width="1.5" stroke-linecap="round"/>' : ''}`;
const bowl = `<path d="M176 105h30a15 12 0 0 1-30 0z" fill="#f08a4b"/><path d="M179 105h24" fill="none" stroke="#fde68a" stroke-width="3" stroke-linecap="round"/>
  <path class="steam" d="M186 100c-2-3 2-5 0-8" fill="none" stroke="#9bb8c4" stroke-width="1.5" stroke-linecap="round"/><path class="steam late" d="M196 100c-2-3 2-5 0-8" fill="none" stroke="#9bb8c4" stroke-width="1.5" stroke-linecap="round"/>`;
const lamp = `<rect x="0" y="0" width="358" height="196" fill="url(#eng-lamp)" class="lamp-glow"/>
  <path d="M276 117h14" fill="none" stroke="#3a7690" stroke-width="3.5" stroke-linecap="round"/><path d="M283 117V90" fill="none" stroke="#3a7690" stroke-width="2.5"/><path d="M273 91h20l-4-13h-12z" fill="#fde68a"/>`;
const phoneOnDesk = `<ellipse class="phone-glow" cx="212" cy="108" rx="17" ry="8" fill="#38bdf8" opacity=".3"/>
  <rect x="203" y="112.5" width="18" height="4.5" rx="1.5" fill="#0b1620"/><rect class="phone" x="204.5" y="113.4" width="15" height="2.2" rx="1" fill="#7dd3fc"/>`;

const LEDS = [0, 1, 2, 3, 4].map(i => {
  const y = (62.5 + i * 18).toFixed(1), colours = [['#5eead4', '#38bdf8'], ['#5eead4', '#5eead4'], ['#fbbf24', '#5eead4'], ['#5eead4', '#38bdf8'], ['#38bdf8', '#5eead4']][i];
  return [[312.5, colours[0], 'led', (i * 0.37) % 1.3], [319, colours[1], 'led slow', (i * 0.61) % 1.9]].map(([x, c, cls, delay]) => ({ x, y, c, cls, delay: delay.toFixed(2) }));
}).flat();
const rackBody = `<rect x="300" y="48" width="46" height="102" rx="5" fill="#0a202b" stroke="#2a6079" stroke-width="2"/>
  ${[0, 1, 2, 3, 4].map(i => `<rect x="306" y="${56 + i * 18}" width="34" height="13" rx="3" fill="#123445"/><path d="M326 ${60.5 + i * 18}h10M326 ${64.5 + i * 18}h7" fill="none" stroke="#2f6a85" stroke-width="1.5" stroke-linecap="round"/>`).join('')}`;
/** The server lights. `glow` adds a halo, for when the room is dark. */
const rackLeds = glow => LEDS.map(l => (glow ? `<circle cx="${l.x}" cy="${l.y}" r="5" fill="${l.c}" opacity=".2"/>` : '')
  + `<circle class="${l.cls}" style="animation-delay:${l.delay}s" cx="${l.x}" cy="${l.y}" r="2.2" fill="${l.c}"/>`).join('');
const padlock = `<circle class="lock-pulse" cx="323" cy="26" r="13" fill="#38bdf8" opacity=".3"/><circle cx="323" cy="26" r="14" fill="#38bdf8" opacity=".16"/>
  <path d="M317.5 24v-4a5.5 5.5 0 0 1 11 0v4" fill="none" stroke="#7dd3fc" stroke-width="2.4"/><rect x="314.5" y="23" width="17" height="12.5" rx="3" fill="#7dd3fc"/><circle cx="323" cy="29" r="1.9" fill="#082f49"/>`;

/* ---------- The engineer, seated and facing right ---------- */

const arm = (d, colour, width, hand, skin) => `<path d="${d}" fill="none" style="stroke:${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${hand[0]}" cy="${hand[1]}" r="${width / 2}" fill="${skin}"/>`;
const POSES = {
  typing: { headset: true, eyes: 'open', mouth: 'smile',
    back: `<g class="arm back">${arm('M124 97l22 14.5 22 1.8', HOODIE_DARK, 8, [170.5, 113.3], SKIN_DARK)}</g>`,
    front: `<g class="arm front">${arm('M127 95l22 14.5 23 2.3', HOODIE_LIGHT, 9, [175, 112], SKIN)}</g>` },
  eating: { headset: true, eyes: 'open', mouth: 'chew',
    back: arm('M124 97l22 13 24 1', HOODIE_DARK, 8, [172, 111], SKIN_DARK),
    front: `<g class="eat">${arm('M129 94L147 106 167 94', HOODIE_LIGHT, 9, [169, 93], SKIN)}
      <path d="M168 91l14 12M171 90l14 11" fill="none" stroke="#c2853a" stroke-width="1.6" stroke-linecap="round"/><path d="M181 102c1 3 0 6-1 8" fill="none" stroke="#fde68a" stroke-width="1.6" stroke-linecap="round"/></g>` },
  stretch: { headset: false, eyes: 'closed', mouth: 'yawn',
    back: `<g class="stretch">${arm('M131 90L124 68 122 50', HOODIE_DARK, 8, [122, 47], SKIN_DARK)}</g>`,
    front: `<g class="stretch late">${arm('M135 90L143 72 144 55', HOODIE_LIGHT, 8.5, [144, 52], SKIN)}</g>` },
  phone: { headset: false, eyes: 'happy', mouth: 'smile', back: '',
    front: `${arm('M126 94l14 14 10-8', HOODIE_LIGHT, 8.5, [150, 100], SKIN)}
      <rect x="147" y="85" width="9" height="15" rx="2" fill="#0b1620"/><rect class="phone" x="148.5" y="86.5" width="6" height="12" rx="1" fill="#7dd3fc"/><circle class="tap" cx="150" cy="100.5" r="3.6" fill="${SKIN}"/>` }
};
const EYES = { open: `<circle class="blink" cx="141.8" cy="64.5" r="1.5" fill="${INK}"/>`,
  closed: `<path d="M139 65.2q2.8 2 5.6 0" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>`,
  happy: `<path d="M139 65.2q2.8-2.8 5.6 0" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>` };
const MOUTHS = { smile: '<path d="M139.8 70.8q2.6 1.9 5 0" fill="none" stroke="#8a3b33" stroke-width="1.4" stroke-linecap="round"/>',
  yawn: '<ellipse class="yawn" cx="143" cy="72" rx="2.6" ry="3.4" fill="#7a2e2e"/>', chew: '<ellipse class="chew" cx="143" cy="72" rx="2.2" ry="1.4" fill="#7a2e2e"/>' };

/** The engineer in one pose: `body` goes behind the desk, `front` (the near arm) goes over it. */
function person(pose) {
  const p = POSES[pose];
  const body = `<rect x="116" y="113" width="44" height="12" rx="6" fill="${PANTS}"/><rect x="150" y="117" width="10.5" height="30" rx="5" fill="${PANTS}"/><rect x="148" y="143.5" width="22" height="7" rx="3.5" fill="${LINE}"/>
    ${p.back}
    <rect x="107" y="82" width="33" height="43" rx="13" style="fill:${HOODIE}"/><path d="M109 92c-2.5-6 2-11 8.5-10l9 3.5-10 9.5z" style="fill:${HOODIE_DARK}"/>
    <rect x="127.5" y="74" width="9.5" height="11" rx="3" fill="${SKIN_DARK}"/><circle cx="133" cy="64" r="14" fill="${SKIN}"/>
    <path d="M146.5 58.5c-1-6.5-7-10.500-14.500-10.500-9 0-15.500 7-14.500 17 .5 5 1.500 9.500 3.500 13.500h7c-1.500-4-1.500-8.500.5-12 2.500-4.500 8-7.500 18-8z" fill="${HAIR}"/>
    ${EYES[p.eyes]}${MOUTHS[p.mouth]}
    ${p.headset ? `<path d="M121.5 59a14 14 0 0 1 23.500-4" fill="none" stroke="${LINE}" stroke-width="2.6" stroke-linecap="round"/><rect x="118.5" y="59.5" width="7" height="10.5" rx="3.2" fill="${LINE}"/>
    <path d="M123.5 69.5c3 6 9.500 7.200 17 6" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round"/><circle cx="141.5" cy="75.3" r="1.8" fill="${LINE}"/>` : ''}`;
  return { body: `<g class="breathe">${body}</g>`, front: `<g class="breathe">${p.front}</g>` };
}

/* ---------- The scenes ---------- */

/** A working scene: lights on, the engineer at the desk. */
function atDesk(period, now, { pose, screen, steam = false, lunch = false }) {
  const sky = SKY[period], who = person(pose);
  return defs(sky) + walls + windowPane(sky) + beam(sky) + clock(now) + shadow + plant + chair + deskLegs + who.body + deskTop
    + monitor(SCREEN[screen]) + (lunch ? bowl : keyboard) + mug(steam) + who.front + rackBody + rackLeds(false) + padlock;
}

/** After work: the room dim, a lamp on, and the on-call phone in hand. */
function afterwork(now) {
  const sky = SKY.afterwork, who = person('phone');
  return defs(sky) + walls + clock(now) + shadow + plant + chair + deskLegs + deskTop + monitor(SCREEN.off) + keyboard + rackBody
    + '<rect width="358" height="196" fill="#020a12" opacity=".32"/>' + windowPane(sky) + beam(sky) + lamp + who.body + who.front + standby + rackLeds(true) + padlock;
}

/** Lights off: asleep at night, or nobody in on weekends and public holidays. The window still follows the time of day. */
function lightsOff(now, asleep) {
  const sky = SKY[asleep ? 'sleeping' : periodAt(now, { weekdays: false })];
  return defs(sky) + walls + clock(now) + shadow + plant + chair + deskLegs + deskTop + monitor(SCREEN.off) + keyboard + mug(false) + rackBody
    + '<rect width="358" height="196" fill="#020a12" opacity=".5"/>' + windowPane(sky) + beam(sky) + standby + (asleep ? phoneOnDesk : '') + rackLeds(true) + padlock;
}

const SCENES = {
  morning: [now => atDesk('morning', now, { pose: 'typing', screen: 'code', steam: true }), 'Good morning! Coffee first, then the servers.'],
  // Duty runs 9am to 6pm, lunch included: the caption beside the Primary's face mustn't sound as if they're away.
  lunch: [now => atDesk('lunch', now, { pose: 'eating', screen: 'lunch', lunch: true }), 'Lunch at the desk. Still happy to help.'],
  afternoon: [now => atDesk('afternoon', now, { pose: 'typing', screen: 'bars', steam: true }), 'Afternoon: deep in the dashboards.'],
  evening: [now => atDesk('evening', now, { pose: 'stretch', screen: 'shutdown' }), 'Wrapping up for the day.'],
  afterwork: [afterwork, 'Off duty, still on call.'],
  sleeping: [now => lightsOff(now, true), 'Sleeping. Phone on loud, just in case.'],
  weekend: [now => lightsOff(now, false), 'Weekend: lights off. The servers keep watch.'],
  holiday: [now => lightsOff(now, false), 'Public holiday: lights off. The servers keep watch.'],
  // A working day when everyone is away: nobody at the desk.
  nobody: [now => lightsOff(now, false), 'No one on duty today. The servers keep watch.'],
  // A working day outside office hours (before 9am or from 6pm): the window still follows the time of day.
  // `opens` says when the next duty day starts ('9am', '9am tomorrow', '9am Monday', '9am on Tue, 24 Nov'), so a
  // Friday evening or the eve of a holiday doesn't promise 9am tomorrow. It is the office that opens, not a person
  // who comes back: with nobody available that day, the caption says only that the office is closed.
  closed: [now => lightsOff(now, false), ({ opens }) => opens ? `Office closed. Opens at ${opens}.` : 'Office closed.']
};

/**
 * The illustration and its caption for a part of the day (default: the part of the day `now` falls in, in
 * Singapore). `options.opens` finishes the caption outside office hours: when the next duty day starts.
 */
export function engineerScene(period, now = new Date(), options = {}) {
  if (!SCENES[period]) period = period ? 'morning' : periodAt(now);
  const [draw, text] = SCENES[period];
  const caption = typeof text === 'function' ? text(options) : text;
  return { period, caption, svg: `<svg class="engineer scene-${period}" viewBox="0 0 358 196" role="img" aria-label="${caption.replace(/"/g, '&quot;')}">${draw(now)}</svg>` };
}
