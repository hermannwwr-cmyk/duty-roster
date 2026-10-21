// Public, read-only month calendar. No sign-in needed.
// The database works out each day's duty list (public_calendar() in supabase/003_private_data.sql) and
// returns only names and roles, so no leave data or account ids reach this page.
import { toISO, fromISO, addDays, todaySG, rosterMessage, whatsappLink } from './schedule.js';
import { createStore } from './connect.js';

const view = document.getElementById('view');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortRole = r => r === 'Primary' ? 'P' : 'S' + r.split(' ')[1];
const longDate = iso => fromISO(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' });
const HL_KEY = 'duty-calendar-highlight';
const state = { month: todaySG().slice(0, 7), highlight: '', feedFor: '' };
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
  </section>
  <section class="panel" id="subscribe">
    <h2>Duties in your phone calendar</h2>
    <p class="muted">No account needed. Pick your name and subscribe once: your duty days appear in Google Calendar, Apple Calendar, Samsung Calendar or Outlook as all-day events, and update by themselves when the roster changes (Google can take up to a day; iPhone checks every few hours).</p>
    <div class="form">
      <label class="field">Whose duties
        <select id="feed-for"><option value="">Everyone</option>${people.map(n => `<option value="${esc(n)}"${n === state.feedFor ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      </label>
    </div>
    <div class="share" id="feed"></div>
  </section>`;
  if (state.feedFor && !people.includes(state.feedFor)) state.feedFor = '';
  renderFeed();
  document.getElementById('feed-for').onchange = e => { state.feedFor = e.target.value; renderFeed(); };

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

/** The subscribe buttons for the chosen person, or for everyone. */
function renderFeed() {
  const box = document.getElementById('feed');
  const url = store.publicFeedUrl(state.feedFor);
  if (!url) { box.innerHTML = '<p class="muted">Phone calendar links work once the app is connected to Supabase.</p>'; return; }
  const webcal = url.replace(/^https:/, 'webcal:');
  box.innerHTML = `<a class="btn primary" href="${esc('https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal))}" target="_blank" rel="noopener">Google Calendar</a>
    <a class="btn primary" href="${esc(webcal)}">iPhone / Apple Calendar</a>
    <button class="btn" type="button" id="feed-copy">Copy link (Samsung, Outlook)</button>
    <p class="muted" style="flex-basis:100%">${state.feedFor ? 'If your name changes on the roster, subscribe again with your new name.' : 'Each working day shows everyone’s roles.'}</p>`;
  document.getElementById('feed-copy').onclick = () => navigator.clipboard.writeText(url).then(
    () => toast('Link copied. In your calendar app, choose Add calendar > From URL and paste it.'),
    () => toast('Couldn’t copy. Long-press the Google or iPhone button to copy its link instead.'));
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

/** Adds a one-tap "Share on WhatsApp" button for the next working day's roster to the header. */
async function addShareButton() {
  const t = todaySG();
  const data = await store.loadPublic(t, addDays(t, 21));
  const day = data && data.days.find(d => d.kind === 'work');
  if (!day) return;
  const text = rosterMessage(day, location.href.split('#')[0].split('?')[0]);
  const label = day.date === t ? 'today’s' : fromISO(day.date).toLocaleDateString('en-SG', { weekday: 'long' }) + '’s';
  const a = document.createElement('a');
  a.className = 'btn small wa'; a.href = whatsappLink(text); a.target = '_blank'; a.rel = 'noopener';
  a.textContent = 'Share ' + label + ' roster on WhatsApp';
  const signIn = document.querySelector('.cal-top a');
  signIn.parentNode.insertBefore(a, signIn);
}

try {
  store = await createStore();
  await show(state.month);
  addShareButton().catch(() => { /* sharing is optional */ });
} catch (e) {
  showError(e);
}
