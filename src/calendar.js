// The public page: today's 2FA Login card and the month calendar. No sign-in needed.
// The database works out each day's duty list (public_calendar() in supabase/004_stable_history.sql) and
// returns only names and roles, so no leave data or account ids reach this page.
import { toISO, fromISO, addDays, todaySG, rosterMessage, whatsappLink, WHATSAPP_ICON, shortName, officeHours, msUntilOfficeChange } from './schedule.js';
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
  // At the weekend today has no cell (the grid is weekdays only), so the next weekday is marked "Next" instead.
  const weekendToday = [0, 6].includes(fromISO(t).getDay());
  let nextDay = t; while ([0, 6].includes(fromISO(nextDay).getDay())) nextDay = addDays(nextDay, 1);
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
      const next = weekendToday && date === nextDay;
      const cls = ['cell', out ? 'out' : date < t ? 'past' : '', date === t ? 'is-today' : '', next ? 'is-next' : '', kind === 'holiday' ? 'holiday' : kind === 'work' ? '' : 'empty'].filter(Boolean).join(' ');
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
      // Today says so in words next to its date, so it can't be missed.
      cells.push(`<li class="${cls}"${date === t ? ' aria-current="date"' : ''}><span class="num"><span class="sr-only">${dt.toLocaleDateString('en-SG', { weekday: 'long' })} </span><span class="d">${num}</span>${date === t ? '<span class="today-tag">Today</span>' : next ? '<span class="today-tag next-tag">Next</span>' : ''}</span>${body}</li>`);
    }
  }

  // The legend lists only what this month shows.
  const legend = anyone ? `<div class="legend" role="group" aria-label="Legend"><span class="key"><span class="pill">Primary</span>then the backups, in order</span>${someoneAway ? '<span class="key"><span class="slot" aria-hidden="true"></span>someone is away</span>' : ''}</div>` : '';
  const thisMonth = t.slice(0, 7), todayColumn = state.month === nextDay.slice(0, 7) ? fromISO(nextDay).getDay() : -1;
  const weekendNote = weekendToday && state.month === thisMonth ? `<p class="today-note">Today is ${fromISO(t).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })}. No duty at weekends.</p>` : '';

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
    ${legend}${weekendNote}
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

/** Stops on one row of the rail when at most `max` fit, keeping the rows even (5 people with room for 4 → 3 + 2). */
const perRow = (n, max) => Math.ceil(n / Math.ceil(n / max));

/**
 * The Secondaries as stops on one rail, in the order to try them: a face on the line with its number,
 * then the name and the role. The rail starts at the Primary's face (the .stem next to it).
 * The narrowest phones fit 3 stops on a row, phones 4 and wider cards 6; styles.css picks by the card's
 * width, and --s marks the stops that start a row, so the line knows where to turn into the next one.
 */
function relay(list, people) {
  const n = list.length, rows = { n: perRow(n, 3), p: perRow(n, 4), w: perRow(n, 6) };
  const wraps = i => Object.entries(rows).map(([k, c]) => i % c === 0 ? `--s${k}:1;` : '').join('');
  return `<h3 class="sr-only" id="sec-h">${n === 1 ? 'Secondary' : 'Secondaries, in backup order'}</h3>
    <ol class="backups relay${n <= 2 ? ' pairs' : ''}" aria-labelledby="sec-h" style="--cn:${rows.n};--cp:${rows.p};--cw:${rows.w}">${list.map((x, i) =>
    `<li style="--i:${i};${wraps(i)}" title="${esc(x.name)}"><i class="rail" aria-hidden="true"></i>${avatar(x.name, '', `<b class="n">${i + 1}</b>`)}<span class="person"><span class="nm">${esc(x.name)}</span><span class="nm-short" aria-hidden="true">${esc(shortName(x.name, people))}</span><span class="rl">${esc(x.role)}</span></span></li>`).join('')}</ol>`;
}

/**
 * Full names under the stops where every one fits: on its line, and without passing the edges the rail is
 * measured to (the button's left and right edges). Otherwise first names for the whole rail, so they match.
 */
function fitNames() {
  for (const list of document.querySelectorAll('#today .relay')) {
    list.classList.remove('short', 'tight');
    // One or two Secondaries stand with their names beside them while the names fit; otherwise under them, like a longer rail.
    list.classList.toggle('pairs', list.children.length <= 2);
    const box = list.parentElement, style = getComputedStyle(box), rect = box.getBoundingClientRect();
    const start = rect.left + parseFloat(style.paddingLeft) - 1, edge = rect.right - parseFloat(style.paddingRight) + 1;
    const cut = sel => [...list.querySelectorAll(sel)].some(el => { const r = el.getBoundingClientRect(); return el.scrollWidth > el.clientWidth || r.right > edge || r.left < start; });
    if (list.classList.contains('pairs') && cut('.nm, .rl')) list.classList.remove('pairs');
    if (!list.classList.contains('pairs') && cut('.nm')) { list.classList.add('short'); if (cut('.nm-short')) list.classList.add('tight'); }
  }
}
let fitting = 0;
addEventListener('resize', () => { cancelAnimationFrame(fitting); fitting = requestAnimationFrame(fitNames); });
document.fonts.ready.then(fitNames);
let drawn = false;   // the rail draws itself the first time only, not at every refresh

/** Today's duty at the top of the page, with a one-tap WhatsApp share. On a weekend or holiday, the next working day. */
async function renderToday() {
  const t = todaySG();
  // Two months ahead: enough for the next duty day and for the days nobody is available.
  const data = await store.loadPublic(t, addDays(t, 60));
  if (!data) { document.getElementById('today').innerHTML = switchedOff; return; }
  const td = data.days.find(d => d.date === t);
  const working = !!td && td.kind === 'work';
  // Office hours are 9am to 6pm on working days. Outside them no one is on duty: before 9am the next
  // cover is today's, from 6pm it is the next working day's.
  const hours = officeHours();
  const closed = working && hours !== 'open';
  const day = closed && hours === 'after'
    ? data.days.find(d => d.kind === 'work' && d.date > t)
    : data.days.find(d => d.kind === 'work');   // today if it's a working day, otherwise the next one
  const fmt = iso => fromISO(iso).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
  const primary = day && day.duties[0];
  // Weekends, public holidays and days before the rotation starts have no duty at all.
  const offDay = !!td && !working;
  const noDutyNow = closed || offDay;
  const lead = noDutyNow ? null : primary;   // the big face is for whoever is on duty now

  // The scene follows the time of day in Singapore, with the lights off on public holidays and on a
  // working day when nobody is available; ?scene=lunch (etc.) shows a particular one. Today's date is
  // on the sign on its wall.
  const scene = engineerScene(new URLSearchParams(location.search).get('scene') || (td && td.kind === 'holiday' ? 'holiday' : closed ? 'closed' : working && !primary ? 'nobody' : undefined));
  const sign = fmt(t).replace(',', '').toUpperCase();
  const why = working || !td ? '' : td.kind === 'holiday' ? 'Public holiday: ' + esc(td.holiday) + '.' : td.kind === 'weekend' ? 'It’s the weekend.' : 'The rotation hasn’t started yet.';

  let share = '';
  if (day) {
    const text = rosterMessage(day, location.href.split('#')[0].split('?')[0]);
    // With nobody to ask, the button no longer offers an OTP: it shares the same message, which says no one is available.
    // Outside office hours too: nobody can give an OTP now, so it shares the next day's roster instead.
    share = `<a class="btn wa" href="${esc(whatsappLink(text))}" target="_blank" rel="noopener">${WHATSAPP_ICON}${primary && !noDutyNow ? 'Click for OTP on WhatsApp' : 'Tell the team on WhatsApp'}</a>`;
  }
  // Outside office hours: say no one is on duty now, then who is next and from when.
  const nextWhen = !day ? '' : day.date === t ? '9am today' : day.date === addDays(t, 1) ? '9am tomorrow' : '9am ' + fmt(day.date);
  // Everyone else on duty that day shares the card with the Primary: one rail that starts at the Primary's
  // face and runs through each Secondary, in the order to try them.
  const secondaries = primary ? day.duties.slice(1) : [];
  const rail = secondaries.length ? relay(secondaries, data.people) : '';
  const stem = rail ? '<i class="stem" aria-hidden="true"></i>' : '';
  // A long name, or one with a long word in it, is set a little smaller, so it stays on one or two lines beside the face.
  const fit = name => { const word = Math.max(...name.split(/\s+/).map(w => w.length)); return name.length > 18 || word > 12 ? ' longer' : name.length > 11 || word > 9 ? ' long' : ''; };
  // Weekends and holidays read the same way: say why there is no duty, then who is next (a quieter, smaller rail).
  const who = noDutyNow ? `<div class="hero-name"><span class="eyebrow warn">${closed ? 'Outside office hours' : 'No duty today'}</span>
      <p class="hero-none">${closed ? 'No one is on duty now.' : why}</p>${closed ? '<span class="hero-role">Office hours are 9am to 6pm on working days.</span>' : ''}</div>
    ${day ? `<div class="next-cover"><span class="eyebrow">Next on duty · ${nextWhen}</span>
      ${primary ? `<div class="who-line">${stem}${avatar(primary.name)}<span class="person"><span class="nm">${esc(primary.name)}</span><span class="rl">Primary · ask for OTP</span></span></div>${rail}` : '<p class="hero-note">No one is available that day.</p>'}</div>` : ''}`
    : !day ? '' : lead ? `<div class="hero-lead">${stem}${avatar(lead.name, 'big', `<span class="lock">${ICON_LOCK}</span>`)}
      <div class="hero-name"><span class="eyebrow">${working ? 'Primary · ask for OTP' : 'Next duty day · ' + fmt(day.date)}</span>
        <p class="name${fit(lead.name)}">${esc(lead.name)}</p>${working ? '' : '<span class="hero-role">Primary · ask for OTP</span>'}</div></div>${rail}`
    : `<div class="hero-name"><span class="eyebrow${working ? ' warn' : ''}">${working ? 'No duty cover today' : 'Next duty day · ' + fmt(day.date)}</span>
      <p class="hero-none">No one is available for duty.</p></div>`;
  // The scene's caption sits on its floor, like a subtitle, beside the Primary's face when there is one.
  const hero = `<section class="hero-card${lead ? ' has-lead' : ''}" aria-labelledby="today-h">
    <h2 class="sr-only" id="today-h">2FA Login, ${fmt(t)}</h2>
    <div class="hero-scene">${scene.svg}<span class="wall-date"><i></i>${sign}</span><p class="hero-caption" aria-hidden="true">${esc(scene.caption)}</p></div>
    <div class="hero-body">
      ${who}${share}
    </div>
  </section>`;

  // Who is Primary over the next three working days, so people know who to ask next.
  const coming = day ? data.days.filter(d => d.kind === 'work' && d.date >= day.date).slice(0, 3) : [];
  const upNext = coming.length > 1 ? `<section class="panel sub" aria-labelledby="next-h">
    <div class="sub-head"><h3 id="next-h">Up next</h3><span>Primary each day</span></div>
    <ol class="strip upnext">${coming.map(d => {
      const p = d.duties[0], dt = fromISO(d.date);
      const when = d.date === t ? 'Today' : dt.toLocaleDateString('en-SG', { weekday: 'short' }) + ' ' + dt.getDate();
      return `<li class="${d.date === t ? 'is-today' : ''}${p ? '' : ' none'}"${p ? ` title="${esc(p.name)}"` : ''}><span class="when">${when}</span><span class="nm">${p ? esc(shortName(p.name, data.people)) : 'No one'}</span></li>`;
    }).join('')}</ol>
  </section>` : '';

  // Upcoming working days when everyone is away. Only the dates: who is on leave stays private.
  // Left out when every working day is covered.
  // From 6pm today is over, so the list starts tomorrow.
  const nobody = data.days.filter(d => d.kind === 'work' && !d.duties.length && d.date >= (closed && hours === 'after' ? addDays(t, 1) : t));
  const gaps = nobody.length ? `<section class="panel gaps" aria-labelledby="gaps-h"><h3 id="gaps-h">${ICON_WARN}No one is available on:</h3>
    <ul class="gap-list">${nobody.map(d => `<li><span class="gap-date">${fromISO(d.date).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      <span class="gap-when">${howSoon(t, d.date)}</span></li>`).join('')}</ul></section>` : '';

  const side = upNext + gaps;
  const root = document.getElementById('today');
  root.innerHTML = `<div class="duty${side ? '' : ' solo'}">${hero}${side ? `<div class="duty-side">${side}</div>` : ''}</div>`;
  root.classList.toggle('enter', !drawn);
  drawn = true;
  fitNames();
}

/* Two tabs: today's 2FA Login card and the month calendar. The address remembers which (#calendar). */
function setTab(tab) {
  document.getElementById('today').hidden = tab !== 'today';
  view.hidden = tab !== 'calendar';
  document.querySelectorAll('[data-tab]').forEach(b => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (tab === 'today') fitNames();   // names can't be measured while the tab is hidden
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
  // Switch the card over on time at 9am and 6pm, rather than at the next routine refresh.
  const atOfficeChange = () => setTimeout(() => { renderToday().catch(() => {}); atOfficeChange(); }, msUntilOfficeChange() + 2000);
  atOfficeChange();
  keepFresh(async () => {
    Object.keys(cache).forEach(k => delete cache[k]);
    await renderToday();
    // Leave the month alone while someone is using its controls; it updates next time.
    if (!view.contains(document.activeElement)) await show(state.month);
  });
} catch (e) {
  showError(e);
}
