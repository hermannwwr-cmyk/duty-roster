// Public, read-only month calendar. No sign-in needed.
// The database works out each day's duty list (public_calendar() in supabase/003_private_data.sql) and
// returns only names and roles, so no leave data or account ids reach this page.
import { toISO, fromISO, addDays, todaySG, rosterMessage, whatsappLink, WHATSAPP_ICON } from './schedule.js';
import { createStore } from './connect.js';
import { engineerScene } from './engineer.js';
import { keepFresh } from './live.js';
import { faceSvg } from './faces.js';

const view = document.getElementById('view');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortRole = r => r === 'Primary' ? 'P' : 'S' + r.split(' ')[1];
const state = { month: todaySG().slice(0, 7) };

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
  const t = todaySG();
  const monthName = fromISO(g.first).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });

  const cells = [];
  for (let date = g.start; date <= g.end; date = addDays(date, 1)) {
    const d = byDate[date];
    const dt = fromISO(date);
    if (dt.getDay() === 0 || dt.getDay() === 6) continue;  // weekends have no duty, so they get no column
    const kind = d ? d.kind : 'unavailable';
    const cls = ['cell', date.slice(0, 7) !== state.month ? 'out' : '', kind === 'holiday' ? 'holiday' : '', date === t ? 'is-today' : ''].filter(Boolean).join(' ');
    const label = `<span class="num"><span class="dow-inline">${dt.toLocaleDateString('en-SG', { weekday: 'short' })} </span>${dt.getDate()}</span>`;
    let body = '';
    if (kind === 'holiday') body = `<span class="hol">${esc(d.holiday)}</span>`;
    else if (kind === 'work') body = '<ol class="duty">' + d.duties.map(x => `<li class="${x.role === 'Primary' ? 'p' : ''}"><span class="r">${shortRole(x.role)}</span><span class="n" title="${esc(x.name)}"><span class="full">${esc(x.name)}</span><span class="first">${esc(x.name.trim().split(/\s+/)[0])}</span></span></li>`).join('') + '</ol>';
    cells.push(`<div class="${cls}">${label}${body}</div>`);
  }

  // The legend lists only what this month shows: as many roles as its busiest day, and holidays if any.
  const monthDays = data.days.filter(d => d.date.slice(0, 7) === state.month);
  const roles = Math.max(0, ...monthDays.filter(d => d.kind === 'work').map(d => d.duties.length));
  const legend = Array.from({ length: roles }, (_, i) => `<li><span class="r${i ? '' : ' p'}">${i ? 'S' + i : 'P'}</span>${i ? 'Secondary ' + i : 'Primary'}</li>`)
    .concat(monthDays.some(d => d.kind === 'holiday') ? ['<li><span class="swatch"></span>Public holiday</li>'] : []).join('');

  view.innerHTML = `
  <section class="panel">
    <div class="row-head">
      <div class="month">
        <button class="btn small" id="prev" aria-label="Previous month">◀</button>
        <strong>${monthName}</strong>
        <button class="btn small" id="next" aria-label="Next month">▶</button>
        <button class="btn small" id="this">This month</button>
      </div>
    </div>
    ${legend ? `<ul class="legend" aria-label="Legend">${legend}</ul>` : ''}
    <div class="cal">
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => `<div class="dow">${d}</div>`).join('')}
      ${cells.join('')}
    </div>
  </section>`;

  // Changing month redraws the page; put focus back on the button that was pressed (issue #12).
  const go = (month, id) => show(month).then(() => { const b = document.getElementById(id); if (b) b.focus({ preventScroll: true }); }).catch(showError);
  const [y, m] = state.month.split('-').map(Number);
  document.getElementById('prev').onclick = () => go(toISO(new Date(y, m - 2, 1, 12)).slice(0, 7), 'prev');
  document.getElementById('next').onclick = () => go(toISO(new Date(y, m, 1, 12)).slice(0, 7), 'next');
  document.getElementById('this').onclick = () => go(t.slice(0, 7), 'this');
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
  const list = d => `<dl class="summary">${d.duties.map(x => `<div class="${x.role === 'Primary' ? 'p' : ''}"><dt>${esc(x.role)}</dt><dd><span class="av face-av">${faceSvg(x.name)}</span>${esc(x.name)}</dd></div>`).join('')}</dl>`
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
  // The scene follows the time of day in Singapore, with the lights off on public holidays;
  // ?scene=lunch (etc.) shows a particular one.
  const scene = engineerScene(new URLSearchParams(location.search).get('scene') || (td && td.kind === 'holiday' ? 'holiday' : undefined));
  document.getElementById('today').innerHTML = `<div class="hero">${scene.svg}<p class="hero-caption" aria-hidden="true">${esc(scene.caption)}</p></div><section class="panel" aria-labelledby="today-h"><h2 id="today-h">2FA Login · ${fmt(t)}</h2>${body}${share}</section>`;
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
