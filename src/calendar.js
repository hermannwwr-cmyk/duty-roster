// Public, read-only month calendar. No sign-in needed.
// The database works out each day's duty list (public_calendar() in supabase/003_private_data.sql) and
// returns only names and roles, so no leave data or account ids reach this page.
import { toISO, fromISO, addDays, todaySG, rosterMessage, whatsappLink, WHATSAPP_ICON, initials, avatarColor } from './schedule.js';
import { createStore } from './connect.js';

const view = document.getElementById('view');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortRole = r => r === 'Primary' ? 'P' : 'S' + r.split(' ')[1];
const longDate = iso => fromISO(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' });
const HL_KEY = 'duty-calendar-highlight';
const state = { month: todaySG().slice(0, 7), highlight: '' };
try { state.highlight = localStorage.getItem(HL_KEY) || ''; } catch (e) { /* storage blocked: no remembered highlight */ }

const cache = {};
let store;

function showError(e) {
  view.innerHTML = `<section class="panel"><h2>Can’t load the calendar</h2><p class="error">${esc(e.message)}</p><p class="muted">Try again in a moment.</p></section>`;
}

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
  if (!data) {
    view.innerHTML = '<section class="panel"><h2>The public calendar is switched off</h2><p class="muted">Sign in to see the duty roster, or ask an admin to switch the public calendar on.</p></section>';
    return;
  }
  render(data);
}

function render(data) {
  const g = gridFor(state.month);
  const byDate = Object.fromEntries(data.days.map(d => [d.date, d]));
  const people = data.people;
  if (state.highlight && !people.includes(state.highlight)) state.highlight = '';
  const hl = state.highlight;
  const t = todaySG();
  const monthName = fromISO(g.first).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });

  const cells = [];
  for (let date = g.start; date <= g.end; date = addDays(date, 1)) {
    const d = byDate[date];
    const dt = fromISO(date);
    const weekend = dt.getDay() === 0 || dt.getDay() === 6;
    const kind = d ? d.kind : 'unavailable';
    const cls = ['cell', date.slice(0, 7) !== state.month ? 'out' : '', weekend ? 'weekend' : '', kind === 'holiday' ? 'holiday' : '', date === t ? 'is-today' : ''].filter(Boolean).join(' ');
    const label = `<span class="num"><span class="dow-inline">${dt.toLocaleDateString('en-SG', { weekday: 'short' })} </span>${dt.getDate()}</span>`;
    let body = '';
    if (kind === 'holiday') body = `<span class="hol">${esc(d.holiday)}</span>`;
    else if (kind === 'work') body = '<ol class="duty">' + d.duties.map(x => `<li data-name="${esc(x.name)}" class="${x.role === 'Primary' ? 'p' : ''}${hl && x.name === hl ? ' hl' : ''}"><span class="r">${shortRole(x.role)}</span>${esc(x.name)}</li>`).join('') + '</ol>';
    cells.push(`<div class="${cls}">${label}${body}</div>`);
  }

  const notes = [];
  if (data.rota_start > g.first && data.rota_start <= g.end) notes.push('The rotation starts on ' + longDate(data.rota_start) + '.');
  else if (data.rota_start > g.end) notes.push('The rotation starts on ' + longDate(data.rota_start) + '.');
  if (data.from > g.start || data.to < g.end) notes.push('The public calendar shows ' + longDate(data.from) + ' to ' + longDate(data.to) + ' from this view. Sign in to see further ahead.');

  view.innerHTML = `
  <section class="panel">
    <div class="row-head">
      <div class="month">
        <button class="btn small" id="prev" aria-label="Previous month">◀</button>
        <strong>${monthName}</strong>
        <button class="btn small" id="next" aria-label="Next month">▶</button>
        <button class="btn small" id="this">This month</button>
      </div>
      <label class="field inline">Highlight
        <select id="hl"><option value="">Nobody</option>${people.map(n => `<option value="${esc(n)}"${n === hl ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      </label>
    </div>
    <p class="muted">Daily duty for working days. P is Primary, S1 is Secondary 1, and so on. Weekends and public holidays have no duty.${notes.length ? ' ' + notes.join(' ') : ''}</p>
    <div class="cal">
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('')}
      ${cells.join('')}
    </div>
  </section>`;

  // Changing month redraws the page; put focus back on the button that was pressed (issue #12).
  const go = (month, id) => show(month).then(() => { const b = document.getElementById(id); if (b) b.focus({ preventScroll: true }); }).catch(showError);
  const [y, m] = state.month.split('-').map(Number);
  document.getElementById('prev').onclick = () => go(toISO(new Date(y, m - 2, 1, 12)).slice(0, 7), 'prev');
  document.getElementById('next').onclick = () => go(toISO(new Date(y, m, 1, 12)).slice(0, 7), 'next');
  document.getElementById('this').onclick = () => go(t.slice(0, 7), 'this');
  // Highlighting only restyles the names, so the menu keeps focus while you arrow through it.
  document.getElementById('hl').onchange = e => {
    state.highlight = e.target.value;
    try { localStorage.setItem(HL_KEY, state.highlight); } catch (err) { /* not remembered */ }
    view.querySelectorAll('.duty li').forEach(li => li.classList.toggle('hl', !!state.highlight && li.dataset.name === state.highlight));
  };
}

/** Today's duty at the top of the page, with a one-tap WhatsApp share. On a weekend or holiday, the next working day. */
async function renderToday() {
  const t = todaySG();
  const data = await store.loadPublic(t, addDays(t, 21));
  if (!data) {
    document.getElementById('today').innerHTML = '<section class="panel"><h2>The public calendar is switched off</h2><p class="muted">Sign in to see the duty roster, or ask an admin to switch the public calendar on.</p></section>';
    return;
  }
  const td = data.days.find(d => d.date === t);
  const day = data.days.find(d => d.kind === 'work');
  const fmt = iso => fromISO(iso).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
  const list = d => `<dl class="summary">${d.duties.map(x => `<div class="${x.role === 'Primary' ? 'p' : ''}"><dt>${esc(x.role)}</dt><dd><span class="av" style="--av:${avatarColor(x.name)}" aria-hidden="true">${esc(initials(x.name))}</span>${esc(x.name)}</dd></div>`).join('')}</dl>`
    + (d.duties.length ? '' : '<p class="muted">No one is available for duty.</p>');
  let body;
  if (td && td.kind === 'work') body = list(td);
  else {
    const why = !td ? '' : td.kind === 'holiday' ? 'Public holiday: ' + esc(td.holiday) + '.' : td.kind === 'weekend' ? 'It’s the weekend.' : 'The rotation hasn’t started yet.';
    body = `<p class="muted">No duty today.${why ? ' ' + why : ''}</p>` + (day ? `<p class="summary-next">Next duty day · ${fmt(day.date)}</p>` + list(day) : '');
  }
  let share = '';
  if (day) {
    const text = rosterMessage(day, location.href.split('#')[0].split('?')[0]);
    share = `<div class="share"><a class="btn wa" href="${esc(whatsappLink(text))}" target="_blank" rel="noopener">${WHATSAPP_ICON}Request for OTP on WhatsApp</a></div>`;
  }
  document.getElementById('today').innerHTML = `<section class="panel" aria-labelledby="today-h"><h2 id="today-h">2FA Login · ${fmt(t)}</h2>${body}${share}</section>`;
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

try {
  store = await createStore();
  await show(state.month);
  renderToday().catch(() => { /* the month calendar below still shows today */ });
} catch (e) {
  showError(e);
}
