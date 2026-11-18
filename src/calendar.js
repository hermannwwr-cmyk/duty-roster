// The public page: today's 2FA Login card and the month calendar. No sign-in needed.
// The database works out each day's duty list (public_calendar() in supabase/004_stable_history.sql) and
// returns only names and roles, so no leave data or account ids reach this page.
import { toISO, fromISO, addDays, todaySG, rosterMessage, whatsappLink, WHATSAPP_ICON, shortName, officeHours, msUntilOfficeChange } from './schedule.js';
import { createStore } from './connect.js';
import { engineerScene, clockHands } from './engineer.js';
import { faceSvg } from './faces.js';
import { keepFresh } from './live.js';
import { swipeTabs } from './swipe.js';

const view = document.getElementById('view');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** `iso` itself on a weekday, otherwise the Monday after: the day the Forecast marks at a weekend. */
const nextWeekday = iso => { while ([0, 6].includes(fromISO(iso).getDay())) iso = addDays(iso, 1); return iso; };
/** `iso` itself on a weekday, otherwise the Friday before. */
const lastWeekday = iso => { while ([0, 6].includes(fromISO(iso).getDay())) iso = addDays(iso, -1); return iso; };
/** The month the Forecast calls "this month": the month of the next weekday, so a weekend at the end of a month shows the month about to start. */
const homeMonth = () => nextWeekday(todaySG()).slice(0, 7);
/** The month `n` months after `month` (both YYYY-MM). */
const shiftMonth = (month, n) => { const [y, m] = month.split('-').map(Number); return toISO(new Date(y, m - 1 + n, 1, 12)).slice(0, 7); };
/** "Mon, 16 Nov" */
const fmtDay = iso => fromISO(iso).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
/**
 * The days the public calendar has: public_calendar() answers from 90 days before today to 180 days after it
 * (publicCalendar() in schedule.js does the same in demo mode). Prev and Next stop at the months inside it.
 */
const dataWindow = (t = todaySG()) => ({ first: addDays(t, -90), last: addDays(t, 180) });
// state.month: the month the Forecast shows, or is on its way to (the one asked for last).
const state = { month: homeMonth() };

const icon = (d, size = 18, width = 2.4) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_PREV = icon('<path d="M15 5l-7 7 7 7"/>'), ICON_NEXT = icon('<path d="M9 5l7 7-7 7"/>');
const ICON_STAR = icon('<path d="M12 3l2.2 5.3 5.8.5-4.4 3.800 1.3 5.600L12 15.300 7.100 18.200l1.300-5.600L4 8.800l5.800-.5z"/>', 20, 2);
const ICON_WARN = icon('<path d="M12 3.5l9.500 16.500h-19z"/><path d="M12 10v4.500M12 17.300v.2"/>', 18, 2.2);
const ICON_LOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill="currentColor"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
/** A person's drawn face in a circle (src/faces.js). `extra` sits on its edge (a number badge, the padlock). */
const avatar = (name, cls = '', extra = '') => `<span class="av${cls ? ' ' + cls : ''}" aria-hidden="true">${faceSvg(name)}${extra}</span>`;

const cache = {};
let storeReady = null;
/** The data store, made on first use. If making it failed (the Supabase client didn't download, say), the next call tries again. */
function getStore() {
  if (!storeReady) storeReady = createStore().catch(e => { storeReady = null; throw e; });
  return storeReady;
}

const switchedOff = '<section class="panel"><h2>The public calendar is switched off</h2><p class="muted">Sign in to see the duty roster, or ask an admin to switch the public calendar on.</p></section>';
/** Says `text` to screen readers, through the page's polite live region (#announce in calendar.html). */
function announce(text) {
  const a = document.getElementById('announce');
  if (!a) return;
  a.textContent = '';
  setTimeout(() => { a.textContent = text; }, 50);
}
/** Moves keyboard focus to a heading that has just been drawn, without scrolling. */
function focusHeading(h) {
  if (!h) return;
  h.setAttribute('tabindex', '-1');
  h.focus({ preventScroll: true });
}
/** A "Try again" button: busy while it tries, so a second press doesn't ask twice. */
function onRetry(button, retry) {
  button.onclick = () => { button.disabled = true; button.setAttribute('aria-busy', 'true'); retry(); };
}

/* ---------- Calendar Forecast: the month, weekdays only ---------- */

/** First and last day of the Monday-to-Sunday grid that covers `month`. */
function gridFor(month) {
  const [y, m] = month.split('-').map(Number);
  const first = month + '-01', last = toISO(new Date(y, m, 0, 12));
  return { first, last, start: addDays(first, -((fromISO(first).getDay() + 6) % 7)), end: addDays(last, (7 - fromISO(last).getDay()) % 7) };
}

// The Forecast has been on screen once: its days arrive in a ripple the first time only, not at every refresh.
let calShown = false, drawnCal = '';   // drawnCal: what the Forecast last drew, without its motion class
let drawnMonth = null;                 // the month whose days are on screen (none while a failure shows)
let lastHome = state.month;            // "this month" when the Forecast last loaded, to follow it when the month changes

/** Draws `month`. `from` ('next' or 'prev') is the way it was reached, so the days slide in from that side.
 *  Resolves true once drawn, or false when another month was asked for while this one loaded (the answer is kept
 *  for later but not drawn). If loading fails, the Forecast says so, with Try again; but a routine refresh (`quiet`)
 *  leaves the month on screen as it is, and tries again next time. */
async function show(month, from, quiet = false) {
  state.month = month;
  let data = cache[month];
  if (!(month in cache)) {
    const g = gridFor(month);
    try {
      data = cache[month] = await (await getStore()).loadPublic(g.start, g.end);
    } catch (e) {
      if (state.month === month) { if (quiet && drawnMonth) state.month = drawnMonth; else drawMonthFailure(month); }
      throw e;
    }
  }
  if (state.month !== month) return false;
  if (!data) { view.innerHTML = switchedOff; drawnCal = ''; drawnMonth = month; return true; }
  render(data, month, from);
  return true;
}

/** The month's name, and the buttons that move between months. Prev and Next stop at the ends of the public calendar's days. */
function calHead(month) {
  const t = todaySG(), home = homeMonth(), win = dataWindow(t);
  // On a weekend at the end of a month the button leads to the month about to start, so it names that month.
  const homeLabel = home === t.slice(0, 7) ? 'This month' : fromISO(home + '-01').toLocaleDateString('en-SG', { month: 'long' });
  const prevOk = lastWeekday(addDays(month + '-01', -1)) >= win.first;
  const nextOk = nextWeekday(shiftMonth(month, 1) + '-01') <= win.last;
  return `<div class="cal-head">
      <h2>${fromISO(month + '-01').toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })}</h2>
      <div class="month-nav">
        ${month === home ? '' : `<button class="btn small" id="this">${homeLabel}</button>`}
        <button class="btn icon" id="prev" aria-label="Previous month"${prevOk ? '' : ' disabled'}>${ICON_PREV}</button>
        <button class="btn icon" id="next" aria-label="Next month"${nextOk ? '' : ' disabled'}>${ICON_NEXT}</button>
      </div>
    </div>`;
}

/** The month buttons drawn by calHead() for `month`. */
function wireNav(month) {
  const go = (to, id) => show(to, to > (drawnMonth || month) ? 'next' : 'prev').then(drew => {
    if (!drew) return;
    // Changing month redraws the page; put focus back on the button that was pressed (issue #12). "This month" goes
    // away once you're there, and Prev or Next switches off at the ends of the calendar, so focus moves to the other one.
    const b = [id, 'next', 'prev'].map(x => document.getElementById(x)).find(el => el && !el.disabled);
    if (b) b.focus({ preventScroll: true });
    // Screen readers hear the new month's name.
    const h = view.querySelector('.cal-head h2');
    if (h) announce(h.textContent);
  }, () => {
    if (state.month !== to) return;
    const retry = document.getElementById('retry-month');
    if (retry) retry.focus({ preventScroll: true });
    announce('Can’t load ' + fromISO(to + '-01').toLocaleDateString('en-SG', { month: 'long', year: 'numeric' }) + '. Check your connection, then try again.');
  });
  document.getElementById('prev').onclick = () => go(shiftMonth(month, -1), 'prev');
  document.getElementById('next').onclick = () => go(shiftMonth(month, 1), 'next');
  const back = document.getElementById('this');
  if (back) back.onclick = () => go(homeMonth(), 'this');
}

/** A month that didn't load: its name and the month buttons, a plain message, and Try again. */
function drawMonthFailure(month) {
  drawnCal = ''; drawnMonth = null;
  view.innerHTML = `<section class="panel cal-panel">
    ${calHead(month)}
    <div class="load-fail cal-fail"><p><b>Can’t load this month right now.</b> Check your connection, then try again.</p>
      <button class="btn" type="button" id="retry-month">Try again</button></div>
  </section>`;
  wireNav(month);
  onRetry(document.getElementById('retry-month'), () => show(month).then(drew => { if (drew) focusHeading(view.querySelector('.cal-head h2')); }, () => {
    const again = state.month === month && document.getElementById('retry-month');
    if (again) again.focus({ preventScroll: true });
  }));
}

/** The routine refresh of the Forecast. Someone on the current month moves on with the calendar when the month changes. */
async function refreshMonth() {
  // Leave the month alone while someone is using its controls; it updates next time.
  if (view.contains(document.activeElement)) return;
  const home = homeMonth();
  await show(state.month === lastHome ? home : state.month, undefined, true);
  lastHome = home;
}

function render(data, month, from) {
  const g = gridFor(month);
  const byDate = Object.fromEntries(data.days.map(d => [d.date, d]));
  const t = todaySG();
  const team = data.people.length;

  // Every day lists everyone available, Primary first, so the month reads in one look. From today on, a
  // dashed slot stands for each person who is away. (Earlier days may simply have had a smaller team.)
  // At the weekend today has no cell (the grid is weekdays only), so the next weekday is marked "Next" instead.
  const weekendToday = [0, 6].includes(fromISO(t).getDay());
  const nextDay = nextWeekday(t);
  const cells = [];
  let anyone = false, someoneAway = false, row = -1, mark = [0, 0];   // mark: the row and column of today's cell (or the "Next" one)
  let early = false, late = false;   // days on the grid before or after the days the public calendar answered for
  for (let monday = g.start; monday <= g.end; monday = addDays(monday, 7)) {
    const week = [0, 1, 2, 3, 4].map(i => addDays(monday, i));
    // A week with no weekday in this month is left out (the 1st fell on a weekend, or the month ended on a Friday).
    if (!week.some(date => date.slice(0, 7) === month)) continue;
    row++;
    for (const date of week) {
      if (data.from && date < data.from) early = true;
      if (data.to && date > data.to) late = true;
      if (date === t || weekendToday && date === nextDay) mark = [row, week.indexOf(date)];
      const d = byDate[date], dt = fromISO(date);
      const out = date.slice(0, 7) !== month;
      const kind = d ? d.kind : 'unavailable';
      const next = weekendToday && date === nextDay;
      const cls = ['cell', out ? 'out' : date < t ? 'past' : '', date === t ? 'is-today' : '', next ? 'is-next' : '', kind === 'holiday' ? 'holiday' : kind === 'work' ? (d.duties.length ? '' : 'gap') : 'empty'].filter(Boolean).join(' ');
      // Days from the months either side say which month they belong to.
      const num = out ? dt.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : dt.getDate();
      let body = '';
      if (kind === 'holiday') body = `${ICON_STAR}<span class="hol">${esc(d.holiday)}</span>`;
      else if (kind === 'work' && !d.duties.length) body = `${ICON_WARN}<span class="nobody">No one available</span>`;
      else if (kind === 'work') {
        const away = date >= t ? Math.max(0, team - d.duties.length) : 0;
        if (!out) { anyone = true; if (away) someoneAway = true; }
        body = `<ol class="duty-list">${d.duties.map(x => `<li${x.role === 'Primary' ? ' class="p"' : ''} title="${esc(x.role + ': ' + x.name)}"><span class="sr-only">${esc(x.role)}: </span><span class="full">${esc(x.name)}</span><span class="first">${esc(shortName(x.name, data.people))}</span></li>`).join('')}${'<li class="away" role="img" aria-label="Someone is away"></li>'.repeat(away)}</ol>`;
      }
      // Today says so in words next to its date, so it can't be missed.
      cells.push(`<li class="${cls}" style="--r:${row};--c:${week.indexOf(date)}"${date === t ? ' aria-current="date"' : ''}><span class="num"><span class="sr-only">${dt.toLocaleDateString('en-SG', { weekday: 'long' })} </span><span class="d">${num}</span>${date === t ? '<span class="today-tag">Today</span>' : next ? '<span class="today-tag next-tag">Next</span>' : ''}</span>${body}</li>`);
    }
  }

  // The legend lists only what this month shows.
  const legend = anyone ? `<div class="legend" role="group" aria-label="Legend"><span class="key"><span class="pill">Primary</span>then the backups, in order</span>${someoneAway ? '<span class="key"><span class="slot" aria-hidden="true"></span>someone is away</span>' : ''}</div>` : '';
  const thisMonth = nextDay.slice(0, 7), todayColumn = month === thisMonth ? fromISO(nextDay).getDay() : -1;
  const weekendNote = weekendToday && month === thisMonth ? `<p class="today-note">Today is ${fromISO(t).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })}. No duty at weekends.</p>` : '';
  // The public calendar answers for a window of days (see dataWindow); past its ends the grid is blank, so say where it ends.
  const edgeNote = late ? `<p class="cal-note">Duties are shown up to ${fmtDay(lastWeekday(data.to))}.</p>`
    : early ? `<p class="cal-note">Duties are shown from ${fmtDay(nextWeekday(data.from))}.</p>` : '';

  // A routine refresh that changes nothing leaves the page alone, so a glow in mid-swell isn't cut off.
  const motion = from ? ' from-' + from : calShown ? '' : ' enter';
  const html = motion => `
  <section class="panel cal-panel">
    ${calHead(month)}
    ${legend}${weekendNote}${edgeNote}
    <div class="dows" aria-hidden="true">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => `<span${i + 1 === todayColumn ? ' class="now"' : ''}>${d.toUpperCase()}</span>`).join('')}</div>
    <ol class="cal${motion}" style="--tr:${mark[0]};--tc:${mark[1]}">${cells.join('')}</ol>
  </section>`;
  if (!from && drawnMonth === month && view.querySelector('.cal') && html('') === drawnCal) { if (!view.hidden) calShown = true; return; }
  drawnCal = html(''); drawnMonth = month;
  view.innerHTML = html(motion);
  if (!view.hidden) calShown = true;
  wireNav(month);
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
 * Then the roles, and the Primary's name beside the face: on the narrowest cards (a phone with its text zoomed)
 * a role takes two lines rather than run into the next one, and a word of the name that doesn't fit is set smaller
 * rather than broken in the middle.
 */
function fitNames() {
  for (const list of document.querySelectorAll('#today .relay')) {
    list.classList.remove('short', 'tight', 'roles-2');
    // One or two Secondaries stand with their names beside them while the names fit; otherwise under them, like a longer rail.
    list.classList.toggle('pairs', list.children.length <= 2);
    const box = list.parentElement, style = getComputedStyle(box), rect = box.getBoundingClientRect();
    const start = rect.left + parseFloat(style.paddingLeft) - 1, edge = rect.right - parseFloat(style.paddingRight) + 1;
    // Where a label sits, from the layout rather than as drawn: on the first draw the entrance still holds each stop
    // scaled down, and the rail must choose then as it would on a redraw (a refresh that changes nothing doesn't redraw).
    const at = el => {
      const li = el.closest('li'), r = li.getBoundingClientRect();
      let x = 0, y = 0;
      for (let n = el; n && n !== li; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
      return { left: r.left + x, right: r.left + x + el.offsetWidth, top: r.top + y };
    };
    const cut = sel => [...list.querySelectorAll(sel)].some(el => { const r = at(el); return el.scrollWidth > el.clientWidth || r.right > edge || r.left < start; });
    if (list.classList.contains('pairs') && cut('.nm, .rl')) list.classList.remove('pairs');
    if (!list.classList.contains('pairs') && cut('.nm')) { list.classList.add('short'); if (cut('.nm-short')) list.classList.add('tight'); }
    // Roles with hardly any space between them read as one ("Secondary 1Secondary 2").
    const roles = [...list.querySelectorAll('.rl')].map(at);
    const crowded = roles.some((r, i) => i > 0 && Math.abs(r.top - roles[i - 1].top) < 2 && r.left - roles[i - 1].right < 3);
    if (!list.classList.contains('pairs') && crowded) list.classList.add('roles-2');
  }
  for (const name of document.querySelectorAll('#today .hero-name .name')) {
    name.style.fontSize = '';
    name.classList.add('measure');   // words don't break while measuring, so one that doesn't fit shows as overflow
    for (let size = parseFloat(getComputedStyle(name).fontSize); name.scrollWidth > name.clientWidth + 1 && size > 18;) {
      size = Math.floor(size * .92);
      name.style.fontSize = size + 'px';
    }
    name.classList.remove('measure');
  }
}
let fitting = 0;
addEventListener('resize', () => { cancelAnimationFrame(fitting); fitting = requestAnimationFrame(fitNames); });
document.fonts.ready.then(fitNames);
let drawn = false;   // the rail draws itself the first time only, not at every refresh

let todayData = null, todayLoaded = false, todaySeq = 0;
let drawnToday = null;   // what the card last drew: { body, scene }, without the clock's hands

/** Loads the days the card needs (today and the two months after it) and draws the card. If that fails while
 *  nothing has been drawn yet, the card says so, with Try again; a card already drawn stays as it is. */
async function loadToday() {
  const seq = ++todaySeq, t = todaySG();
  let data;
  try {
    data = await (await getStore()).loadPublic(t, addDays(t, 60));
  } catch (e) {
    if (seq === todaySeq && !todayLoaded) drawTodayFailure();
    throw e;
  }
  if (seq !== todaySeq) return;   // a newer request is on its way
  todayData = data; todayLoaded = true;
  drawToday();
}

/** Today's card didn't load: a plain message in the card, and Try again. */
function drawTodayFailure() {
  drawnToday = null;
  document.getElementById('today').innerHTML = `<div class="duty solo"><section class="hero-card load-fail" aria-labelledby="today-h">
    <div class="hero-body">
      <div class="hero-name"><h2 class="hero-none" id="today-h">Can’t load today’s 2FA Login</h2>
        <p class="muted">Check your connection, then try again.</p></div>
      <button class="btn" type="button" id="retry-today">Try again</button>
    </div>
  </section></div>`;
  onRetry(document.getElementById('retry-today'), () => loadToday().then(() => focusHeading(document.getElementById('today-h')), () => {
    const again = document.getElementById('retry-today');
    if (again) again.focus({ preventScroll: true });
  }));
}

/**
 * Today's duty at the top of the page, with a one-tap WhatsApp share. On a weekend or holiday, the next working day.
 * Drawn from the days last loaded, at the time it is now: the page calls it after each load and every minute.
 * What hasn't changed stays as it is.
 */
function drawToday() {
  const root = document.getElementById('today'), data = todayData;
  if (!data) {
    if (!drawnToday || drawnToday.body !== switchedOff) { root.innerHTML = switchedOff; drawnToday = { body: switchedOff, scene: '' }; }
    return;
  }
  const now = new Date(), t = todaySG();
  if (data.to && t > data.to) return;   // the days loaded have run out: wait for the next refresh
  const ahead = data.days.filter(d => d.date >= t);   // a minute past midnight, the days loaded still start yesterday
  const td = data.days.find(d => d.date === t);
  const working = !!td && td.kind === 'work';
  // Office hours are 9am to 6pm on working days. Outside them no one is on duty: before 9am the next
  // cover is today's, from 6pm it is the next working day's.
  const hours = officeHours();
  const closed = working && hours !== 'open';
  const day = closed && hours === 'after'
    ? ahead.find(d => d.kind === 'work' && d.date > t)
    : ahead.find(d => d.kind === 'work');   // today if it's a working day, otherwise the next one
  const fmt = fmtDay;
  const primary = day && day.duties[0];
  // Weekends, public holidays and days before the rotation starts have no duty at all.
  const offDay = !!td && !working;
  const noDutyNow = closed || offDay;
  const lead = noDutyNow ? null : primary;   // the big face is for whoever is on duty now

  // The scene follows the time of day in Singapore, with the lights off on public holidays and on a
  // working day when nobody is available; ?scene=lunch (etc.) shows a particular one. Today's date is
  // on the sign on its wall. Outside office hours its caption says when the next duty day starts.
  const back = !day ? '' : day.date === t ? '9am' : day.date === addDays(t, 1) ? '9am tomorrow'
    : day.date < addDays(t, 7) ? '9am ' + fromISO(day.date).toLocaleDateString('en-SG', { weekday: 'long' }) : '9am on ' + fmt(day.date);
  const scene = engineerScene(new URLSearchParams(location.search).get('scene') || (td && td.kind === 'holiday' ? 'holiday' : closed ? 'closed' : working && !primary ? 'nobody' : undefined), now, { back });
  const sign = fmt(t).replace(',', '').toUpperCase();
  const why = working || !td ? '' : td.kind === 'holiday' ? 'Public holiday: ' + esc(td.holiday) + '.' : td.kind === 'weekend' ? 'It’s the weekend.' : 'The rotation hasn’t started yet.';

  // The message is about the working day the card is about: today until midnight (after 6pm too, so an evening
  // message still names the day's duty), otherwise the next working day.
  const shareDay = closed && hours === 'after' ? td : day;
  let share = '';
  if (shareDay) {
    const text = rosterMessage(shareDay, location.href.split('#')[0].split('?')[0]);
    // With nobody to ask, the button no longer offers an OTP: it shares the same message, which says no one is available.
    // Outside office hours too: nobody can give an OTP now, so the button shares the roster instead.
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
  const sceneHtml = `${scene.svg}<span class="wall-date"><i></i>${sign}</span><p class="hero-caption" aria-hidden="true">${esc(scene.caption)}</p>`;
  const hero = inner => `<section class="hero-card${lead ? ' has-lead' : ''}" aria-labelledby="today-h">
    <h2 class="sr-only" id="today-h">2FA Login, ${fmt(t)}</h2>
    <div class="hero-scene">${inner}</div>
    <div class="hero-body">
      ${who}${share}
    </div>
  </section>`;

  // Up next: the Primary on each of the three working days after the one the card shows (the card already answers for
  // today), side by side, so people know who to ask next. Every 5 seconds a glint passes across them, left to right.
  const coming = day ? ahead.filter(d => d.kind === 'work' && d.date > day.date).slice(0, 3) : [];
  const upNext = coming.length ? `<section class="panel sub" aria-labelledby="next-h">
    <div class="sub-head"><h3 id="next-h">Up next</h3><span>Primary each day</span></div>
    <ol class="next-days">${coming.map((d, i) => {
      const p = d.duties[0], dt = fromISO(d.date);
      const when = d.date === addDays(t, 1) ? 'Tomorrow' : dt.toLocaleDateString('en-SG', { weekday: 'short' }) + ' ' + dt.getDate();
      return `<li class="next-duty${p ? '' : ' none'}" style="--i:${i}"${p ? ` title="${esc(p.name)}"` : ''}><span class="when"><i class="dot" aria-hidden="true"></i>${when}</span><span class="nm">${p ? esc(shortName(p.name, data.people)) : 'No one'}</span></li>`;
    }).join('')}</ol>
  </section>` : '';

  // Upcoming working days when everyone is away. Only the dates: who is on leave stays private.
  // Left out when every working day is covered.
  // From 6pm today is over, so the list starts tomorrow.
  const nobody = ahead.filter(d => d.kind === 'work' && !d.duties.length && d.date >= (closed && hours === 'after' ? addDays(t, 1) : t));
  const gaps = nobody.length ? `<section class="panel gaps" aria-labelledby="gaps-h"><h3 id="gaps-h">${ICON_WARN}No one is available on:</h3>
    <ul class="gap-list">${nobody.map(d => `<li><span class="gap-date">${fromISO(d.date).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      <span class="gap-when">${howSoon(t, d.date)}</span></li>`).join('')}</ul></section>` : '';

  const side = upNext + gaps;
  const page = inner => `<div class="duty${side ? '' : ' solo'}">${hero(inner)}${side ? `<div class="duty-side">${side}</div>` : ''}</div>`;

  // A refresh, or the minute ticking over, that changes nothing leaves the card alone: keyboard focus stays where it is
  // and nothing replays. The clock's hands move in place, and a new part of the day swaps the scene only.
  const hands = clockHands(now);
  const drawing = { body: page(''), scene: sceneHtml.split(hands).join('') };
  const shownScene = drawnToday && drawnToday.body === drawing.body && root.querySelector('.hero-scene');
  if (shownScene) {
    if (drawnToday.scene !== drawing.scene) shownScene.innerHTML = sceneHtml;
    else shownScene.querySelectorAll('.engineer .hands').forEach(el => el.setAttribute('d', hands));
    drawnToday = drawing;
    return;
  }
  // Something did change: draw the card again, without its entrance, and keep focus on the button if it was there.
  const onButton = !!document.activeElement && root.contains(document.activeElement) && document.activeElement.matches('a.btn.wa');
  root.innerHTML = page(sceneHtml);
  root.classList.toggle('enter', !drawn);
  drawn = true;
  drawnToday = drawing;
  if (onButton) root.querySelector('a.btn.wa')?.focus({ preventScroll: true });
  fitNames();
}

/** Every minute, on the minute: the wall clock's hands move, and the card keeps up with the time (the scene's part of
 *  the day, 9am and 6pm, midnight) from the days already loaded. */
function everyMinute() {
  setTimeout(() => { everyMinute(); if (todayLoaded) drawToday(); }, 60000 - Date.now() % 60000 + 50);
}

/* Two tabs: today's 2FA Login card and the month calendar. The address remembers which (#calendar). */
function setTab(tab) {
  document.getElementById('today').hidden = tab !== 'today';
  view.hidden = tab !== 'calendar';
  document.querySelectorAll('[data-tab]').forEach(b => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (tab === 'today') fitNames();   // names can't be measured while the tab is hidden
  // Coming back to the Forecast doesn't replay how its days arrived.
  if (tab === 'calendar') { if (view.querySelector('.cal')) calShown = true; } else if (calShown) view.querySelectorAll('.cal').forEach(el => el.classList.remove('enter', 'from-next', 'from-prev'));
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
  history.replaceState(null, '', b.dataset.tab === 'calendar' ? '#calendar' : location.pathname + location.search);
  setTab(b.dataset.tab);
});
setTab(location.hash === '#calendar' ? 'calendar' : 'today');
// A swipe brings the Forecast in with its own slide, so the ripple is left out then: one entrance per arrival.
swipeTabs(() => { const shown = [document.getElementById('today'), view].find(el => !el.hidden);
  if (shown === view) view.querySelectorAll('.cal.enter').forEach(el => el.classList.remove('enter'));
  return shown; });

// The card and the month load at the same time, each on its own, so one slow or failed request doesn't hold up the
// other. A failure shows its own message, with Try again; the routine refreshes below go on either way.
loadToday().catch(() => {});
show(state.month).catch(() => {});
everyMinute();
// Switch the card over on time at 9am and 6pm with fresh duties, rather than at the next routine refresh.
const atOfficeChange = () => setTimeout(() => { loadToday().catch(() => {}); atOfficeChange(); }, msUntilOfficeChange() + 2000);
atOfficeChange();
// Fresh duties when you come back to the page, every few minutes, and at midnight for the new day.
keepFresh(async () => {
  Object.keys(cache).forEach(k => delete cache[k]);
  const results = await Promise.allSettled([loadToday(), refreshMonth()]);
  const failed = results.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;
});
