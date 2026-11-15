// The public page: today's 2FA Login card and the month calendar. No sign-in needed.
// The database works out each day's duty list (public_calendar() in supabase/004_stable_history.sql) and
// returns only names and roles, so no leave data or account ids reach this page.
import { toISO, fromISO, addDays, todaySG, rosterMessage, whatsappLink, WHATSAPP_ICON, shortName } from './schedule.js';
import { createStore } from './connect.js';
import { engineerScene } from './engineer.js';
import { faceSvg } from './faces.js';
import { keepFresh } from './live.js';
import { swipeTabs } from './swipe.js';

const view = document.getElementById('view');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { month: todaySG().slice(0, 7) };

const icon = (d, size = 18, width = 2.4) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_PREV = icon('<path d="M15 5l-7 7 7 7"/>'), ICON_NEXT = icon('<path d="M9 5l7 7-7 7"/>');
const ICON_STAR = icon('<path d="M12 3l2.2 5.3 5.8.5-4.4 3.800 1.3 5.600L12 15.300 7.100 18.200l1.300-5.600L4 8.800l5.800-.5z"/>', 20, 2);
const ICON_WARN = icon('<path d="M12 3.5l9.500 16.500h-19z"/><path d="M12 10v4.500M12 17.300v.2"/>', 18, 2.2);
const ICON_LOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill="currentColor"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
/** A person's drawn face in a circle (src/faces.js). `extra` sits on its edge (a number badge, the padlock). */
const avatar = (name, cls = '', extra = '') => `<span class="av${cls ? ' ' + cls : ''}" aria-hidden="true">${faceSvg(name)}${extra}</span>`;

const cache = {};
let store;

function showError(e) {
  view.innerHTML = `<section class="panel"><h2>Can’t load the calendar</h2><p class="error">${esc(e.message)}</p><p class="muted">Try again in a moment.</p></section>`;
}
const switchedOff = '<section class="panel"><h2>The public calendar is switched off</h2><p class="muted">Sign in to see the duty roster, or ask an admin to switch the public calendar on.</p></section>';

/* ---------- Calendar Forecast: the month, weekdays only ---------- */

/** First and last day of the Monday-to-Sunday grid that covers `month`. */
function gridFor(month) {
  const [y, m] = month.split('-').map(Number);
  const first = month + '-01', last = toISO(new Date(y, m, 0, 12));
  return { first, last, start: addDays(first, -((fromISO(first).getDay() + 6) % 7)), end: addDays(last, (7 - fromISO(last).getDay()) % 7) };
}

async function show(month) {
  state.month = month;
  if (!(month in cache)) {
    const g = gridFor(month);
    cache[month] = await store.loadPublic(g.start, g.end);
  }
  const data = cache[month];
  if (!data) { view.innerHTML = switchedOff; return; }
  render(data);
}

function render(data) {
  const g = gridFor(state.month);
  const byDate = Object.fromEntries(data.days.map(d => [d.date, d]));
  const t = todaySG();
  const monthName = fromISO(g.first).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
  const team = data.people.length;

  // Every day lists everyone available, Primary first, so the month reads in one look. From today on, a
  // dashed slot stands for each person who is away. (Earlier days may simply have had a smaller team.)
  const cells = [];
  let anyone = false, someoneAway = false;
  for (let monday = g.start; monday <= g.end; monday = addDays(monday, 7)) {
    const week = [0, 1, 2, 3, 4].map(i => addDays(monday, i));
    // A week with no weekday in this month is left out (the 1st fell on a weekend, or the month ended on a Friday).
    if (!week.some(date => date.slice(0, 7) === state.month)) continue;
    for (const date of week) {
      const d = byDate[date], dt = fromISO(date);
      const out = date.slice(0, 7) !== state.month;
      const kind = d ? d.kind : 'unavailable';
      const cls = ['cell', out ? 'out' : date < t ? 'past' : '', date === t ? 'is-today' : '', kind === 'holiday' ? 'holiday' : kind === 'work' ? '' : 'empty'].filter(Boolean).join(' ');
      // Days from the months either side say which month they belong to.
      const num = out ? dt.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : dt.getDate();
      let body = '';
      if (kind === 'holiday') body = `${ICON_STAR}<span class="hol">${esc(d.holiday)}</span>`;
      else if (kind === 'work' && !d.duties.length) body = '<span class="nobody">No one available</span>';
      else if (kind === 'work') {
        const away = date >= t ? Math.max(0, team - d.duties.length) : 0;
        if (!out) { anyone = true; if (away) someoneAway = true; }
        body = `<ol class="duty-list">${d.duties.map(x => `<li${x.role === 'Primary' ? ' class="p"' : ''} title="${esc(x.role + ': ' + x.name)}"><span class="sr-only">${esc(x.role)}: </span><span class="full">${esc(x.name)}</span><span class="first">${esc(shortName(x.name, data.people))}</span></li>`).join('')}${'<li class="away" role="img" aria-label="Someone is away"></li>'.repeat(away)}</ol>`;
      }
      cells.push(`<li class="${cls}"><span class="num"><span class="sr-only">${dt.toLocaleDateString('en-SG', { weekday: 'long' })} </span>${num}</span>${body}</li>`);
    }
  }

  // The legend lists only what this month shows.
  const legend = anyone ? `<div class="legend" role="group" aria-label="Legend"><span class="key"><span class="pill">Primary</span>then the backups, in order</span>${someoneAway ? '<span class="key"><span class="slot" aria-hidden="true"></span>someone is away</span>' : ''}</div>` : '';
  const thisMonth = t.slice(0, 7), todayColumn = state.month === thisMonth ? fromISO(t).getDay() : -1;

  view.innerHTML = `
  <section class="panel cal-panel">
    <div class="cal-head">
      <h2>${monthName}</h2>
      <div class="month-nav">
        ${state.month === thisMonth ? '' : '<button class="btn small" id="this">This month</button>'}
        <button class="btn icon" id="prev" aria-label="Previous month">${ICON_PREV}</button>
        <button class="btn icon" id="next" aria-label="Next month">${ICON_NEXT}</button>
      </div>
    </div>
    ${legend}
    <div class="dows" aria-hidden="true">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => `<span${i + 1 === todayColumn ? ' class="now"' : ''}>${d.toUpperCase()}</span>`).join('')}</div>
    <ol class="cal">${cells.join('')}</ol>
  </section>`;

  // Changing month redraws the page; put focus back on the button that was pressed (issue #12).
  // "This month" goes away once you're there, so focus then moves to the next-month button.
  const go = (month, id) => show(month).then(() => { const b = document.getElementById(id) || document.getElementById('next'); if (b) b.focus({ preventScroll: true }); }).catch(showError);
  const [y, m] = state.month.split('-').map(Number);
  document.getElementById('prev').onclick = () => go(toISO(new Date(y, m - 2, 1, 12)).slice(0, 7), 'prev');
  document.getElementById('next').onclick = () => go(toISO(new Date(y, m, 1, 12)).slice(0, 7), 'next');
  const back = document.getElementById('this');
  if (back) back.onclick = () => go(thisMonth, 'this');
}

/* ---------- 2FA Login: today's Primary, the backups and what's next ---------- */

/** "Today", "Tomorrow" or "in 13 days", from `today` to `date` (both YYYY-MM-DD). */
function howSoon(today, date) {
  const days = Math.round((fromISO(date) - fromISO(today)) / 864e5);
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : 'in ' + days + ' days';
}

/** Today's duty at the top of the page, with a one-tap WhatsApp share. On a weekend or holiday, the next working day. */
async function renderToday() {
  const t = todaySG();
  // Two months ahead: enough for the next duty day and for the days nobody is available.
  const data = await store.loadPublic(t, addDays(t, 60));
  if (!data) { document.getElementById('today').innerHTML = switchedOff; return; }
  const td = data.days.find(d => d.date === t);
  const day = data.days.find(d => d.kind === 'work');   // today if it's a working day, otherwise the next one
  const working = !!td && td.kind === 'work';
  const fmt = iso => fromISO(iso).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
  const primary = day && day.duties[0];

  // The scene follows the time of day in Singapore, with the lights off on public holidays and on a
  // working day when nobody is available; ?scene=lunch (etc.) shows a particular one. Today's date is
  // on the sign on its wall.
  const scene = engineerScene(new URLSearchParams(location.search).get('scene') || (td && td.kind === 'holiday' ? 'holiday' : working && !primary ? 'nobody' : undefined));
  const sign = fmt(t).replace(',', '').toUpperCase();
  const why = working || !td ? '' : td.kind === 'holiday' ? 'Public holiday: ' + esc(td.holiday) + '.' : td.kind === 'weekend' ? 'It’s the weekend.' : 'The rotation hasn’t started yet.';

  let share = '';
  if (day) {
    const text = rosterMessage(day, location.href.split('#')[0].split('?')[0]);
    // With nobody to ask, the button no longer offers an OTP: it shares the same message, which says no one is available.
    share = `<a class="btn wa" href="${esc(whatsappLink(text))}" target="_blank" rel="noopener">${WHATSAPP_ICON}${primary ? 'Click for OTP on WhatsApp' : 'Tell the team on WhatsApp'}</a>`;
  }
  const who = !day ? '' : `<div class="hero-name"><span class="eyebrow${working && !primary ? ' warn' : ''}">${!working ? 'Next duty day · ' + fmt(day.date) : primary ? 'Primary · ask for OTP' : 'No duty cover today'}</span>
      ${primary ? `<p class="name">${esc(primary.name)}</p>${working ? '' : '<span class="hero-role">Primary · ask for OTP</span>'}` : '<p class="hero-none">No one is available for duty.</p>'}</div>`;
  const hero = `<section class="hero-card" aria-labelledby="today-h">
    <h2 class="sr-only" id="today-h">2FA Login, ${fmt(t)}</h2>
    <div class="hero-scene">${scene.svg}<span class="wall-date"><i></i>${sign}</span></div>
    <div class="hero-body">
      <div class="hero-who${primary ? '' : ' plain'}">${primary ? avatar(primary.name, 'big', `<span class="lock">${ICON_LOCK}</span>`) : ''}<p class="hero-caption" aria-hidden="true">${esc(scene.caption)}</p></div>
      ${working || !td ? '' : `<p class="hero-note">No duty today.${why ? ' ' + why : ''}</p>`}
      ${who}${share}
    </div>
  </section>`;

  // Everyone else on duty that day, in the order to try them.
  const secondaries = day ? day.duties.slice(1) : [];
  const backups = secondaries.length ? `<section class="panel sub" aria-labelledby="sec-h">
    <div class="sub-head"><h3 id="sec-h">${secondaries.length === 1 ? 'Secondary' : 'Secondaries'}</h3>${secondaries.length > 1 ? '<span>in backup order</span>' : ''}</div>
    <ol class="backups">${secondaries.map((x, i) => `<li>${avatar(x.name, '', `<b class="n">${i + 1}</b>`)}<span class="person"><span class="nm">${esc(x.name)}</span><span class="rl">${esc(x.role)}</span></span></li>`).join('')}</ol>
  </section>` : '';

  // Who is Primary over the next five working days, so people know who to ask next.
  const coming = day ? data.days.filter(d => d.kind === 'work' && d.date >= day.date).slice(0, 5) : [];
  const upNext = coming.length > 1 ? `<section class="panel sub" aria-labelledby="next-h">
    <div class="sub-head"><h3 id="next-h">Up next</h3><span>Primary each day</span></div>
    <ol class="strip">${coming.map(d => {
      const p = d.duties[0], dt = fromISO(d.date);
      const when = d.date === t ? 'Today' : dt.toLocaleDateString('en-SG', { weekday: 'short' }) + ' ' + dt.getDate();
      return `<li class="${d.date === t ? 'is-today' : ''}${p ? '' : ' none'}"${p ? ` title="${esc(p.name)}"` : ''}><span class="when">${when}</span>${p ? avatar(p.name) : '<span class="av" aria-hidden="true">–</span>'}<span class="nm">${p ? esc(shortName(p.name, data.people)) : 'No one'}</span></li>`;
    }).join('')}</ol>
  </section>` : '';

  // Upcoming working days when everyone is away. Only the dates: who is on leave stays private.
  // Left out when every working day is covered.
  const nobody = data.days.filter(d => d.kind === 'work' && !d.duties.length && d.date >= t);
  const gaps = nobody.length ? `<section class="panel gaps" aria-labelledby="gaps-h"><h3 id="gaps-h">${ICON_WARN}No one is available on:</h3>
    <ul class="gap-list">${nobody.map(d => `<li><span class="gap-date">${fromISO(d.date).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      <span class="gap-when">${howSoon(t, d.date)}</span></li>`).join('')}</ul></section>` : '';

  const side = backups + upNext + gaps;
  document.getElementById('today').innerHTML = `<div class="duty${side ? '' : ' solo'}">${hero}${side ? `<div class="duty-side">${side}</div>` : ''}</div>`;
}

/* Two tabs: today's 2FA Login card and the month calendar. The address remembers which (#calendar). */
function setTab(tab) {
  document.getElementById('today').hidden = tab !== 'today';
  view.hidden = tab !== 'calendar';
  document.querySelectorAll('[data-tab]').forEach(b => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
  history.replaceState(null, '', b.dataset.tab === 'calendar' ? '#calendar' : location.pathname + location.search);
  setTab(b.dataset.tab);
});
setTab(location.hash === '#calendar' ? 'calendar' : 'today');
swipeTabs(() => [document.getElementById('today'), view].find(el => !el.hidden));

try {
  store = await createStore();
  await show(state.month);
  renderToday().catch(() => { /* the month calendar still shows today */ });
  // Fresh duties when you come back to the page, every few minutes, and at midnight for the new day's card.
  keepFresh(async () => {
    Object.keys(cache).forEach(k => delete cache[k]);
    await renderToday();
    // Leave the month alone while someone is using its controls; it updates next time.
    if (!view.contains(document.activeElement)) await show(state.month);
  });
} catch (e) {
  showError(e);
}
