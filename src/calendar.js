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
const STALLED = 25 * 1000;   // a request this old is given up on (its answer is still drawn if it ever comes and nothing newer has)
const wait = ms => new Promise(done => setTimeout(done, Math.max(0, ms)));

const icon = (d, size = 18, width = 2.4) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_PREV = icon('<path d="M15 5l-7 7 7 7"/>'), ICON_NEXT = icon('<path d="M9 5l7 7-7 7"/>');
const ICON_STAR = icon('<path d="M12 3l2.2 5.3 5.8.5-4.4 3.800 1.3 5.600L12 15.300 7.100 18.200l1.300-5.600L4 8.800l5.800-.5z"/>', 20, 2);
const ICON_WARN = icon('<path d="M12 3.5l9.500 16.500h-19z"/><path d="M12 10v4.500M12 17.300v.2"/>', 18, 2.2);
const ICON_LOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill="currentColor"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
/** A person's drawn face in a circle (src/faces.js). `extra` sits on its edge (a number badge, the padlock). */
const avatar = (name, cls = '', extra = '') => `<span class="av${cls ? ' ' + cls : ''}" aria-hidden="true">${faceSvg(name)}${extra}</span>`;

const cache = {};
let storeReady = null, storeBroken = false;
/** The data store, made on first use. */
function getStore() {
  if (!storeReady) storeReady = createStore().then(s => { storeBroken = false; return s; }, e => { storeReady = null; storeBroken = true; throw e; });
  return storeReady;
}
/**
 * Making the store failed: part of the page (the Supabase client, from a CDN) didn't download. The browser remembers a
 * failed download for as long as the page is open, so only reloading the page can try again. Reloads, and says so.
 */
function reloadIfBroken() {
  // Offline, a reload would only swap the page for the browser's own error page: say "Still can't connect" instead.
  if (!storeBroken || navigator.onLine === false) return false;
  location.reload();
  return true;
}
let rotaStart = null;   // the first day of the rotation, from the last answer: the Forecast has no duties before it

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
/**
 * A "Try again" button. It stays busy for at least a moment, so a quick failure doesn't look as if nothing happened, while
 * `retry()` loads and draws; if that fails, `again()` says it still can't connect. If part of the page didn't download,
 * it reloads the page instead.
 */
function onRetry(button, retry, again) {
  button.onclick = async () => {
    button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Trying…';
    if (reloadIfBroken()) return;
    const started = Date.now();
    try { await retry(); } catch (e) { await wait(600 - (Date.now() - started)); again(); }
  };
}

/* ---------- Calendar Forecast: the month, weekdays only ---------- */

/** First and last day of the Monday-to-Sunday grid that covers `month`. */
function gridFor(month) {
  const [y, m] = month.split('-').map(Number);
  const first = month + '-01', last = toISO(new Date(y, m, 0, 12));
  return { first, last, start: addDays(first, -((fromISO(first).getDay() + 6) % 7)), end: addDays(last, (7 - fromISO(last).getDay()) % 7) };
}

// The Forecast's month: the one chosen last (with Prev, Next or This month, or this month at the start), drawn or not, and
// "this month" when it was chosen, so the Forecast can follow the calendar. Each load takes a number, and only the latest
// is drawn; `busy` is when a chosen month started loading (0 once it has arrived or failed).
const cal = { month: homeMonth(), home: homeMonth(), seq: 0, busy: 0 };
let drawnMonth = null;   // the month whose days are on screen
let failedMonth = null;  // the month whose failure message is on screen
// The Forecast has been on screen once: its days arrive in a ripple the first time only, not at every refresh.
let calShown = false, drawnCal = '';   // drawnCal: what the Forecast last drew, without its motion class
const choosing = () => cal.busy && Date.now() - cal.busy < STALLED;

/** The days of `month`: from the cache, or loaded. */
async function monthData(month) {
  if (month in cache) return cache[month];
  const g = gridFor(month);
  const data = await (await getStore()).loadPublic(g.start, g.end);
  cache[month] = data;
  return data;
}

/** Shows `month`, chosen by the person (or this month, at the start). `from` ('next' or 'prev') is the way it was reached,
 *  so the days slide in from that side. Resolves true once drawn, or false if another month was chosen while it loaded.
 *  If it fails, the Forecast says so, with Try again (a failure already on screen for that month is left to Try again). */
async function show(month, from) {
  const seq = ++cal.seq;
  Object.assign(cal, { month, home: homeMonth(), busy: Date.now() });
  try {
    const data = await monthData(month);
    if (seq !== cal.seq) return false;
    drawMonth(data, month, from);
    return true;
  } catch (e) {
    if (seq === cal.seq && failedMonth !== month) drawMonthFailure(month);
    throw e;
  } finally {
    if (seq === cal.seq) cal.busy = 0;
  }
}

/**
 * The routine refresh. It never moves the Forecast to another month, except to follow the calendar: someone on this month
 * moves on with it when the month changes. A month someone has just chosen is left to arrive. If the refresh fails, what is
 * on screen stays (a month, or the failure message).
 */
async function refreshMonth() {
  if (choosing()) return;
  const month = cal.month === cal.home ? homeMonth() : cal.month;
  const seq = ++cal.seq;
  let data;
  try {
    data = await monthData(month);
  } catch (e) {
    if (seq === cal.seq && !drawnMonth && failedMonth !== month) drawMonthFailure(month);
    throw e;
  }
  if (seq !== cal.seq) return;
  Object.assign(cal, { month, home: homeMonth(), busy: 0 });
  drawMonth(data, month);
}

/** A month that failed to load tries again: when the card has just loaded, or the phone is back online. */
function retryMonth() {
  if (failedMonth && !choosing()) show(failedMonth).catch(() => {});
}

/** Puts `html` in the Forecast. Keyboard focus on one of its buttons (or its heading) moves to the new one of the same id. */
function putView(html) {
  const id = view.contains(document.activeElement) && document.activeElement.id;
  view.innerHTML = html;
  if (!id) return;
  const el = [id, 'next', 'prev'].map(x => document.getElementById(x)).find(x => x && view.contains(x) && !x.disabled);
  if (el && el.id === 'cal-h') focusHeading(el); else if (el) el.focus({ preventScroll: true }); else focusHeading(document.getElementById('cal-h'));
}

/** The Forecast's names: on phones, set a little smaller (.long-names in styles.css) only when one doesn't fit its day at
 *  the usual size. They can't be measured while the tab is hidden, so setTab() and a resize measure again. */
function fitForecast() {
  const grid = view.querySelector('.cal');
  if (!grid || view.hidden) return;
  grid.classList.remove('long-names');
  grid.classList.toggle('long-names', [...grid.querySelectorAll('.duty-list li:not(.away)')].some(li => li.scrollWidth > li.clientWidth + .5));
}

function drawMonth(data, month, from) {
  failedMonth = null;
  if (data && data.rota_start) rotaStart = data.rota_start;
  if (!data) { putView(switchedOff); drawnCal = ''; drawnMonth = month; return; }
  render(data, month, from);
}

/** The month's name, and the buttons that move between months. Prev stops at the first month with duties (the public
 *  calendar's window, or the rotation's start if later), and Next at the last month in the window. */
function calHead(month) {
  const t = todaySG(), home = homeMonth(), win = dataWindow(t);
  // On a weekend at the end of a month the button leads to the month about to start, so it names that month.
  const homeLabel = home === t.slice(0, 7) ? 'This month' : fromISO(home + '-01').toLocaleDateString('en-SG', { month: 'long' });
  const first = rotaStart && rotaStart > win.first ? rotaStart : win.first;
  const prevOk = lastWeekday(addDays(month + '-01', -1)) >= first;
  const nextOk = nextWeekday(shiftMonth(month, 1) + '-01') <= win.last;
  return `<div class="cal-head">
      <h2 id="cal-h">${fromISO(month + '-01').toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })}</h2>
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
    if (cal.month !== to) return;
    const retry = document.getElementById('retry-month');
    if (retry) retry.focus({ preventScroll: true });
    announce('Can’t load ' + fromISO(to + '-01').toLocaleDateString('en-SG', { month: 'long', year: 'numeric' }) + '. Check your connection, then try again.');
  });
  document.getElementById('prev').onclick = () => { if (!reloadIfBroken()) go(shiftMonth(month, -1), 'prev'); };
  document.getElementById('next').onclick = () => { if (!reloadIfBroken()) go(shiftMonth(month, 1), 'next'); };
  const back = document.getElementById('this');
  if (back) back.onclick = () => { if (!reloadIfBroken()) go(homeMonth(), 'this'); };
}

/** A month that didn't load: its name and the month buttons, a plain message, and Try again. `again`: Try again failed too. */
function drawMonthFailure(month, again = false) {
  drawnCal = ''; drawnMonth = null; failedMonth = month;
  putView(`<section class="panel cal-panel">
    ${calHead(month)}
    <div class="load-fail cal-fail"><p><b>Can’t load this month right now.</b> ${again ? 'Still can’t connect. ' : ''}Check your connection, then try again.</p>
      <button class="btn" type="button" id="retry-month">Try again</button></div>
  </section>`);
  wireNav(month);
  onRetry(document.getElementById('retry-month'), async () => {
    if (await show(month)) focusHeading(document.getElementById('cal-h'));
  }, () => {
    if (failedMonth !== month || cal.month !== month) return;
    drawMonthFailure(month, true);
    document.getElementById('retry-month').focus({ preventScroll: true });
    announce('Still can’t connect.');
  });
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
  // The first day with duties: where the public calendar's window starts (see dataWindow), or the rotation's start if later.
  const startsLate = !!data.rota_start && data.rota_start > (data.from || '');
  const first = startsLate ? data.rota_start : data.from;
  let early = false, late = false;   // days on the grid before the first day with duties, or after the window's end
  for (let monday = g.start; monday <= g.end; monday = addDays(monday, 7)) {
    const week = [0, 1, 2, 3, 4].map(i => addDays(monday, i));
    // A week with no weekday in this month is left out (the 1st fell on a weekend, or the month ended on a Friday).
    if (!week.some(date => date.slice(0, 7) === month)) continue;
    row++;
    for (const date of week) {
      if (first && date < first) early = true;
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
  // Before the first day with duties, or past the window's end, the grid is blank, so say where the duties start or end.
  const edgeNote = late ? `<p class="cal-note">Duties are shown up to ${fmtDay(lastWeekday(data.to))}.</p>`
    : early ? `<p class="cal-note">${startsLate ? 'The rotation starts on' : 'Duties are shown from'} ${fmtDay(nextWeekday(first))}.</p>` : '';
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
  putView(html(motion));
  fitForecast();
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
 * The narrowest phones fit 3 stops on a row, phones 4 and wider cards 6, and a phone with its text zoomed 2;
 * styles.css picks by the card's width, and --s marks the stops that start a row, so the line knows where to
 * turn into the next one.
 */
function relay(list, people) {
  const n = list.length, rows = { t: perRow(n, 2), n: perRow(n, 3), p: perRow(n, 4), w: perRow(n, 6) };
  const wraps = i => Object.entries(rows).map(([k, c]) => i % c === 0 ? `--s${k}:1;` : '').join('');
  return `<h3 class="sr-only" id="sec-h">${n === 1 ? 'Secondary' : 'Secondaries, in backup order'}</h3>
    <ol class="backups relay${n <= 2 ? ' pairs' : ''}" aria-labelledby="sec-h" style="--ct:${rows.t};--cn:${rows.n};--cp:${rows.p};--cw:${rows.w}">${list.map((x, i) =>
    `<li style="--i:${i};${wraps(i)}" title="${esc(x.name)}"><i class="rail" aria-hidden="true"></i>${avatar(x.name, '', `<b class="n">${i + 1}</b>`)}<span class="person"><span class="nm">${esc(x.name)}</span><span class="nm-short" aria-hidden="true">${esc(shortName(x.name, people))}</span><span class="rl">${esc(x.role)}</span></span></li>`).join('')}</ol>`;
}

/**
 * Full names under the stops where every one fits: on its line, and without passing the edges the rail is
 * measured to (the button's left and right edges). Otherwise first names for the whole rail, so they match.
 * A first name that still doesn't fit (on a phone with its text zoomed), and a word of the Primary's name that doesn't
 * fit beside the face, are set smaller rather than broken in the middle. Up next shows its three days side by side
 * while each day and name fits its tile, and one under another otherwise.
 */
function fitNames() {
  for (const list of document.querySelectorAll('#today .relay')) {
    list.classList.remove('short', 'tight');
    fitWords([...list.querySelectorAll('.nm-short')], Infinity);
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
    fitWords([...list.querySelectorAll('.nm-short')], list.classList.contains('tight') ? 9 : Infinity);
  }
  for (const name of document.querySelectorAll('#today .hero-name .name')) fitWords([name], 14);
  for (const days of document.querySelectorAll('#today .next-days')) {
    days.classList.remove('stack');
    const over = sel => [...days.children].some(tile => {
      const s = getComputedStyle(tile), room = tile.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      return [...tile.querySelectorAll(sel)].some(el => el.scrollWidth > room + 1);
    });
    // Only on the narrowest screens. A day that doesn't fit stacks the tiles from 340px down; a very long first name only
    // below 300px, so on real phones it ends in "…", as it always has, rather than tripling Up next's height.
    days.classList.toggle('stack', matchMedia('(max-width: 340px)').matches && over('.when') || matchMedia('(max-width: 300px)').matches && over('.nm'));
  }
}
/**
 * Sets `els` smaller together, a step at a time, until no word in them is wider than its box, but no smaller than `min`
 * pixels (Infinity: only clears an earlier size). Words don't break while measuring, so one that doesn't fit overflows.
 */
function fitWords(els, min) {
  els.forEach(el => { el.style.fontSize = ''; });
  if (!els.length || min === Infinity) return;
  els.forEach(el => el.classList.add('measure'));
  // The text's width against its box's, to the fraction of a pixel (a word a pixel too wide still breaks).
  const over = () => els.some(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width > el.getBoundingClientRect().width + .25; });
  for (let size = parseFloat(getComputedStyle(els[0]).fontSize); size > min && over();) {
    size = Math.max(min, Math.floor(size * .92));
    els.forEach(el => { el.style.fontSize = size + 'px'; });
  }
  els.forEach(el => el.classList.remove('measure'));
}
let fitting = 0;
addEventListener('resize', () => { cancelAnimationFrame(fitting); fitting = requestAnimationFrame(() => { fitNames(); fitForecast(); }); });
document.fonts.ready.then(fitNames);
let drawn = false;   // the rail draws itself the first time only, not at every refresh

let todayData = null, todaySeq = 0;
let todayState = 'loading';   // what the card shows: 'loading', 'failed' (the message with Try again) or 'drawn'
let drawnToday = null;        // what the card last drew: { body, scene }, without the clock's hands

/** Loads the days the card needs (today and the two months after it) and draws the card. If that fails while nothing
 *  has been drawn yet, the card says so, with Try again; a card already drawn, or the message, stays as it is. */
async function loadToday() {
  const seq = ++todaySeq, t = todaySG();
  let data;
  try {
    data = await (await getStore()).loadPublic(t, addDays(t, 60));
  } catch (e) {
    if (seq === todaySeq && todayState === 'loading') drawTodayFailure();
    throw e;
  }
  if (seq !== todaySeq) return;   // a newer request is on its way
  todayData = data; todayState = 'drawn';
  if (data && data.rota_start) rotaStart = data.rota_start;
  drawToday();
  retryMonth();   // the connection is back, so a month that failed to load tries again too
}

/** Today's card didn't load: a plain message in the card, and Try again. `again`: Try again failed too. */
function drawTodayFailure(again = false) {
  todayState = 'failed'; drawnToday = null;
  document.getElementById('today').innerHTML = `<div class="duty solo"><section class="hero-card load-fail" aria-labelledby="today-h">
    <div class="hero-body">
      <div class="hero-name"><h2 class="hero-none" id="today-h">Can’t load today’s 2FA Login</h2>
        <p class="muted">${again ? 'Still can’t connect. ' : ''}Check your connection, then try again.</p></div>
      <button class="btn" type="button" id="retry-today">Try again</button>
    </div>
  </section></div>`;
  onRetry(document.getElementById('retry-today'), async () => {
    await loadToday();
    if (todayState !== 'drawn') throw new Error('still failing');
    focusHeading(document.getElementById('today-h'));
  }, () => {
    if (todayState !== 'failed') return;
    drawTodayFailure(true);
    document.getElementById('retry-today').focus({ preventScroll: true });
    announce('Still can’t connect.');
  });
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
  // on the sign on its wall. Outside office hours its caption says when the office opens: the next duty day, unless
  // nobody is available that day.
  const opens = !primary ? '' : day.date === t ? '9am' : day.date === addDays(t, 1) ? '9am tomorrow'
    : day.date < addDays(t, 7) ? '9am ' + fromISO(day.date).toLocaleDateString('en-SG', { weekday: 'long' }) : '9am on ' + fmt(day.date);
  const scene = engineerScene(new URLSearchParams(location.search).get('scene') || (td && td.kind === 'holiday' ? 'holiday' : closed ? 'closed' : working && !primary ? 'nobody' : undefined), now, { opens });
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
  setTimeout(() => { everyMinute(); if (todayState === 'drawn') drawToday(); }, 60000 - Date.now() % 60000 + 50);
}

/* Two tabs: today's 2FA Login card and the month calendar. The address remembers which (#calendar). */
function setTab(tab) {
  document.getElementById('today').hidden = tab !== 'today';
  view.hidden = tab !== 'calendar';
  document.querySelectorAll('[data-tab]').forEach(b => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (tab === 'today') fitNames(); else fitForecast();   // names can't be measured while their tab is hidden
  // Coming back to a tab doesn't replay how it arrived: the card's entrance (the card isn't drawn again when nothing has
  // changed, so it would keep its .enter) and the Forecast's ripple each play once.
  if (tab !== 'today') document.getElementById('today').classList.remove('enter');
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
show(cal.month).catch(() => {});
everyMinute();
// Switch the card over on time at 9am and 6pm with fresh duties, rather than at the next routine refresh.
const atOfficeChange = () => setTimeout(() => { loadToday().catch(() => {}); atOfficeChange(); }, msUntilOfficeChange() + 2000);
atOfficeChange();
/** Fresh duties for the card and the month. If part of the page didn't download, only a reload can fix it (while online). */
async function refreshAll() {
  if (storeBroken) { if (navigator.onLine !== false) location.reload(); return; }
  Object.keys(cache).forEach(k => delete cache[k]);
  const results = await Promise.allSettled([loadToday(), refreshMonth()]);
  const failed = results.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;
}
// Fresh duties when you come back to the page, every few minutes, at midnight for the new day, and when the phone is back online.
keepFresh(refreshAll);
addEventListener('online', () => { refreshAll().catch(() => {}); });
