// Public, read-only month calendar. No sign-in needed.
import { buildSchedule, toISO, fromISO, addDays } from './schedule.js';
import { createStore } from './connect.js';

const view = document.getElementById('view');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortRole = r => r === 'Primary' ? 'P' : 'S' + r.split(' ')[1];
const HL_KEY = 'duty-calendar-highlight';
const state = { month: toISO(new Date()).slice(0, 7), highlight: '' };
try { state.highlight = localStorage.getItem(HL_KEY) || ''; } catch (e) {}

let data;
try {
  const store = await createStore();
  data = await store.loadPublic();
} catch (e) {
  view.innerHTML = `<section class="panel"><h2>Can’t load the calendar</h2><p class="error">${esc(e.message)}</p><p class="muted">Try again in a moment.</p></section>`;
  throw e;
}

if (!data) {
  view.innerHTML = '<section class="panel"><h2>The public calendar is switched off</h2><p class="muted">Sign in to see the duty roster, or ask an admin to switch the public calendar on.</p></section>';
} else {
  render();
}

function render() {
  const members = data.members.map(m => ({ id: m.id, name: m.display_name }));
  if (state.highlight && !members.some(m => m.id === state.highlight)) state.highlight = '';
  const [y, m] = state.month.split('-').map(Number);
  const first = state.month + '-01', last = toISO(new Date(y, m, 0, 12));
  // Grid runs Monday to Sunday, padded to whole weeks.
  const gridStart = addDays(first, -((fromISO(first).getDay() + 6) % 7));
  const gridEnd = addDays(last, (7 - fromISO(last).getDay()) % 7);
  const days = buildSchedule({
    members, leaves: data.leaves, anchor: data.rota_start, from: gridStart, to: gridEnd,
    holidays: Object.fromEntries(data.holidays.map(h => [h.date, h.name]))
  });
  const t = toISO(new Date());
  const monthName = fromISO(first).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
  const hl = state.highlight;

  const cell = d => {
    const dt = fromISO(d.date);
    const cls = ['cell', d.date.slice(0, 7) !== state.month ? 'out' : '', d.kind === 'weekend' ? 'weekend' : '', d.kind === 'holiday' ? 'holiday' : '', d.date === t ? 'is-today' : ''].filter(Boolean).join(' ');
    const label = `<span class="num"><span class="dow-inline">${dt.toLocaleDateString('en-SG', { weekday: 'short' })} </span>${dt.getDate()}</span>`;
    let body = '';
    if (d.kind === 'holiday') body = `<span class="hol">${esc(d.holiday)}</span>`;
    else if (d.kind === 'work') body = '<ol class="duty">' + d.duties.map(x => `<li class="${x.role === 'Primary' ? 'p' : ''}${hl && x.member.id === hl ? ' hl' : ''}"><span class="r">${shortRole(x.role)}</span>${esc(x.member.name)}</li>`).join('') + '</ol>';
    return `<div class="${cls}">${label}${body}</div>`;
  };

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
        <select id="hl"><option value="">Nobody</option>${members.map(p => `<option value="${esc(p.id)}"${p.id === hl ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </label>
    </div>
    <p class="muted">Daily duty for working days. P is Primary, S1 is Secondary 1, and so on. Weekends and public holidays have no duty.${data.rota_start > last ? ' The rotation starts on ' + fromISO(data.rota_start).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }) + '.' : ''}</p>
    <div class="cal">
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('')}
      ${days.map(cell).join('')}
    </div>
  </section>`;

  const shift = n => { state.month = toISO(new Date(y, m - 1 + n, 1, 12)).slice(0, 7); render(); };
  document.getElementById('prev').onclick = () => shift(-1);
  document.getElementById('next').onclick = () => shift(1);
  document.getElementById('this').onclick = () => { state.month = t.slice(0, 7); render(); };
  document.getElementById('hl').onchange = e => {
    state.highlight = e.target.value;
    try { localStorage.setItem(HL_KEY, state.highlight); } catch (err) {}
    render();
  };
}
