import { buildSchedule, toISO, fromISO, onRota } from './schedule.js';
import { createStore } from './connect.js';

const store = await createStore();

const root = document.getElementById('root');
const state = { data: null, tab: 'roster', month: toISO(new Date()).slice(0, 7), authMode: 'signin', authError: '', authNote: '' };

/* ---------- Helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => toISO(new Date());
function fmtDay(iso, opts) { return fromISO(iso).toLocaleDateString('en-SG', opts || { weekday: 'short', day: 'numeric', month: 'short' }); }
function fmtRange(a, b) { return a === b ? fmtDay(a) : fmtDay(a) + ' – ' + fmtDay(b); }
function shortRole(role) { return role === 'Primary' ? 'P' : 'S' + role.split(' ')[1]; }
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
async function act(fn, done) {
  try { await fn(); if (done) toast(done); await refresh(); }
  catch (e) { toast(e.message || 'Something went wrong. Try again.'); }
}

function scheduleFor(from, to) {
  const d = state.data;
  return buildSchedule({
    members: d.profiles.filter(onRota).map(p => ({ id: p.id, name: p.display_name })),
    leaves: d.leaves,
    holidays: Object.fromEntries(d.holidays.map(h => [h.date, h.name])),
    anchor: d.settings.rota_start,
    from, to
  });
}

/* ---------- Boot ---------- */
async function refresh() {
  try {
    const uid = await store.userId();
    if (!uid) { state.data = null; renderAuth(); return; }
    state.data = await store.load();
    if (!state.data.me) {
      root.innerHTML = '<div class="auth"><div class="panel"><h2>Your profile isn’t ready</h2><p class="muted">You’re signed in, but the database has no profile for you. Check that <code>supabase/schema.sql</code> ran in full, then sign in again.</p><button class="btn" id="out">Sign out</button></div></div>';
      document.getElementById('out').onclick = () => store.signOut();
      return;
    }
    if (state.data.me.approved === false) {
      root.innerHTML = '<div class="auth"><div class="panel"><h2>Waiting for approval</h2><p class="muted">Thanks for signing up, ' + esc(state.data.me.display_name) + '. An admin needs to approve your account before you can see the roster. Check back later.</p><div class="form"><button class="btn" id="check">Check again</button><button class="btn" id="out">Sign out</button></div></div></div>';
      document.getElementById('check').onclick = () => refresh();
      document.getElementById('out').onclick = () => store.signOut();
      return;
    }
    renderApp();
  } catch (e) {
    root.innerHTML = '<div class="auth"><div class="panel"><h2>Can’t reach the database</h2><p class="error">' + esc(e.message) + '</p><p class="muted">Check the values in <code>config.js</code> and that <code>supabase/schema.sql</code> has been run.</p></div></div>';
  }
}
store.onAuthChange(refresh);
refresh();

/* ---------- Sign in ---------- */
function renderAuth() {
  const demo = store.mode === 'demo';
  const signup = state.authMode === 'signup';
  root.innerHTML = `
  <div class="auth">
    <div><h1>Duty Roster</h1><p class="muted">Daily duty rotation. Sign in to see your duties and add your leave.</p>
      <p><a href="calendar.html">View the duty calendar without signing in →</a></p></div>
    <div class="panel">
      <div class="switch" role="group" aria-label="Account">
        <button type="button" data-mode="signin" aria-pressed="${!signup}">Sign in</button>
        <button type="button" data-mode="signup" aria-pressed="${signup}">Create account</button>
      </div>
      <form id="auth-form">
        ${signup ? '<label class="field">Your name<input id="f-name" required autocomplete="name"></label>' : ''}
        <label class="field">Email<input id="f-email" type="email" required autocomplete="email"></label>
        <label class="field">Password<input id="f-pass" type="password" ${demo ? '' : 'required minlength="6"'} autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
        ${state.authError ? '<p class="error">' + esc(state.authError) + '</p>' : ''}
        ${state.authNote ? '<p class="muted">' + esc(state.authNote) + '</p>' : ''}
        <button class="btn primary" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
      </form>
    </div>
    ${demo ? `<div class="panel"><h3>Demo mode</h3><p class="muted">No database is connected yet, so data stays in this browser. Any password works. Sign in as one of the example team (Alice is the admin):</p>
      <div class="people">${store.db.profiles.map(p => `<button class="btn" type="button" data-demo="${esc(p.email)}">Sign in as ${esc(p.display_name)}${p.is_admin ? ' (admin)' : ''}</button>`).join('')}</div></div>` : ''}
  </div>`;
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { state.authMode = b.dataset.mode; state.authError = state.authNote = ''; renderAuth(); });
  root.querySelectorAll('[data-demo]').forEach(b => b.onclick = () => store.signIn(b.dataset.demo));
  document.getElementById('auth-form').onsubmit = async e => {
    e.preventDefault();
    const email = document.getElementById('f-email').value.trim(), pass = document.getElementById('f-pass').value;
    state.authError = state.authNote = '';
    try {
      if (signup) {
        const r = await store.signUp(email, pass, document.getElementById('f-name').value.trim());
        if (r.needsConfirmation) { state.authMode = 'signin'; state.authNote = 'Check your email and click the confirmation link, then sign in.'; renderAuth(); }
      } else await store.signIn(email, pass);
    } catch (err) { state.authError = err.message; renderAuth(); }
  };
}

/* ---------- App shell ---------- */
function renderApp() {
  const { me } = state.data;
  const tabs = [['roster', 'Roster'], ['leave', 'Leave'], ['team', me.is_admin ? 'Team & settings' : 'Team']];
  root.innerHTML = `
  <header class="top"><div class="wrap">
    <span class="brand">Duty Roster</span>
    <span class="who">Signed in as <b>${esc(me.display_name)}</b>${me.is_admin ? ' · admin' : ''}</span>
    <a class="btn small" href="calendar.html">Calendar</a>
    <button class="btn small" id="signout">Sign out</button>
    <nav class="tabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${label}</button>`).join('')}</nav>
  </div></header>
  ${store.mode === 'demo' ? '<div class="demo"><div class="wrap"><span><b>Demo mode.</b> Data is saved in this browser only. Add your Supabase details to <code>config.js</code> to share it with the team.</span><button class="btn link" id="reset-demo">Reset demo data</button></div></div>' : ''}
  <main class="wrap" id="view"></main>`;
  document.getElementById('signout').onclick = () => store.signOut();
  const reset = document.getElementById('reset-demo');
  if (reset) reset.onclick = () => store.reset();
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; renderApp(); });
  ({ roster: renderRoster, leave: renderLeave, team: renderTeam })[state.tab]();
}

/* ---------- Roster ---------- */
function chip(duty, meId) {
  const me = duty.member.id === meId;
  return `<span class="chip${duty.role === 'Primary' ? ' p' : ''}${me ? ' me' : ''}"><span class="r">${shortRole(duty.role)}</span>${esc(duty.member.name)}</span>`;
}
function renderRoster() {
  const { me, settings } = state.data;
  const view = document.getElementById('view');
  const t = today();
  const [td] = scheduleFor(t, t);
  let mineToday, todayChips;
  if (td.kind === 'work') {
    const mine = td.duties.find(d => d.member.id === me.id);
    mineToday = mine ? mine.role : td.onLeave.some(m => m.id === me.id) ? 'On leave' : 'No duty';
    todayChips = `<div class="chips">${td.duties.map(d => chip(d, me.id)).join('')}${td.onLeave.map(m => `<span class="chip away"><span class="r">LEAVE</span>${esc(m.name)}</span>`).join('')}</div>`;
  } else {
    mineToday = 'No duty';
    todayChips = `<p class="muted">${td.kind === 'holiday' ? 'Public holiday: ' + esc(td.holiday) : td.kind === 'weekend' ? 'It’s the weekend.' : 'The rotation starts on ' + fmtDay(settings.rota_start) + '.'}</p>`;
  }

  const [y, m] = state.month.split('-').map(Number);
  const first = state.month + '-01', last = toISO(new Date(y, m, 0, 12));
  const days = scheduleFor(first, last).filter(d => d.kind === 'work' || d.kind === 'holiday');
  const before = first < settings.rota_start;
  const monthName = fromISO(first).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });

  view.innerHTML = `
  <section class="panel today" aria-label="Today">
    <div class="mine"><span class="label">Your duty today · ${fmtDay(t)}</span><span class="role">${esc(mineToday)}</span></div>
    <div>${todayChips}</div>
  </section>
  <section class="panel">
    <div class="row-head">
      <h2>Roster</h2>
      <div class="month">
        <button class="btn small" id="prev" aria-label="Previous month">◀</button>
        <strong>${monthName}</strong>
        <button class="btn small" id="next" aria-label="Next month">▶</button>
        <button class="btn small" id="this">This month</button>
      </div>
    </div>
    <p class="muted">Weekdays only. Weekends and public holidays have no duty. P is Primary, S1 is Secondary 1, and so on. People on leave are left out that day.</p>
    ${before ? `<p class="muted">The rotation starts on ${fmtDay(settings.rota_start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.</p>` : ''}
    <div class="cols" aria-hidden="true"><span>Date</span><span>Your role</span><span>Everyone</span></div>
    <div class="days">${days.map(d => {
      if (d.kind === 'holiday') return `<div class="day holiday${d.date === t ? ' is-today' : ''}"><span class="date">${fmtDay(d.date)}</span><span class="what">Public holiday</span><span class="what">${esc(d.holiday)}</span></div>`;
      const mine = d.duties.find(x => x.member.id === me.id);
      const away = d.onLeave.some(x => x.id === me.id);
      return `<div class="day${d.date === t ? ' is-today' : ''}"><span class="date">${fmtDay(d.date)}</span>
        <span class="yours${away ? ' off' : ''}">${mine ? esc(mine.role) : away ? 'On leave' : '–'}</span>
        <span class="chips">${d.duties.map(x => chip(x, me.id)).join('')}${d.onLeave.map(x => `<span class="chip away"><span class="r">LEAVE</span>${esc(x.name)}</span>`).join('')}</span></div>`;
    }).join('') || '<p class="muted">No working days to show this month.</p>'}</div>
  </section>`;
  const shift = n => { const d = new Date(y, m - 1 + n, 1, 12); state.month = toISO(d).slice(0, 7); renderRoster(); };
  document.getElementById('prev').onclick = () => shift(-1);
  document.getElementById('next').onclick = () => shift(1);
  document.getElementById('this').onclick = () => { state.month = today().slice(0, 7); renderRoster(); };
}

/* ---------- Leave ---------- */
function renderLeave() {
  const { me, profiles, leaves } = state.data;
  const view = document.getElementById('view');
  const t = today();
  const name = id => (profiles.find(p => p.id === id) || {}).display_name || 'Unknown';
  const upcoming = leaves.filter(l => l.end_date >= t);
  const mine = upcoming.filter(l => l.user_id === me.id);
  const leaveItem = l => `<div class="item"><div class="main"><span class="when">${fmtRange(l.start_date, l.end_date)}</span>
      ${l.user_id !== me.id ? ` · <b>${esc(name(l.user_id))}</b>` : ''}${l.note ? `<div class="muted">${esc(l.note)}</div>` : ''}</div>
      ${l.start_date <= t ? '<span class="tag leave">On leave now</span>' : ''}
      ${l.user_id === me.id || me.is_admin ? `<button class="btn small danger" data-del="${l.id}">Remove</button>` : ''}</div>`;
  view.innerHTML = `
  <section class="panel">
    <h2>Add leave</h2>
    <p class="muted">You’ll be left out of the roster on these days, and everyone else moves up.</p>
    <form class="form" id="leave-form">
      ${me.is_admin ? `<label class="field">Person<select id="l-who">${profiles.filter(onRota).map(p => `<option value="${p.id}"${p.id === me.id ? ' selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select></label>` : ''}
      <label class="field">From<input type="date" id="l-start" required value="${t}"></label>
      <label class="field">To<input type="date" id="l-end" required value="${t}"></label>
      <label class="field grow">Note (optional)<input id="l-note" maxlength="120" placeholder="e.g. Annual leave" aria-describedby="l-note-hint"></label>
      <button class="btn primary" type="submit">Add leave</button>
    </form>
    <p class="muted" id="l-note-hint">Only you and admins can see the note. Please don’t include medical details. Teammates see only the dates.</p>
  </section>
  <section class="panel"><h2>Your upcoming leave</h2>
    <div class="list">${mine.map(leaveItem).join('') || '<p class="muted">You have no leave booked.</p>'}</div></section>
  <section class="panel"><h2>Team leave</h2>
    <div class="list">${upcoming.filter(l => l.user_id !== me.id).map(leaveItem).join('') || '<p class="muted">No one else has leave booked.</p>'}</div></section>`;
  document.getElementById('leave-form').onsubmit = e => {
    e.preventDefault();
    const start = document.getElementById('l-start').value, end = document.getElementById('l-end').value;
    if (end < start) { toast('The end date is before the start date.'); return; }
    const who = document.getElementById('l-who');
    act(() => store.addLeave({ user_id: who ? who.value : me.id, start_date: start, end_date: end, note: document.getElementById('l-note').value.trim() || null }), 'Leave added. The roster has been updated.');
  };
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => act(() => store.deleteLeave(Number(b.dataset.del)), 'Leave removed.'));
}

/* ---------- Team & settings ---------- */
function renderTeam() {
  const { me, profiles, holidays, settings } = state.data;
  const admin = me.is_admin;
  const view = document.getElementById('view');
  const t = today();
  const sorted = profiles.filter(p => p.approved !== false).sort((a, b) => a.rota_order - b.rota_order);
  const pending = profiles.filter(p => p.approved === false);
  const upcomingHol = holidays.filter(h => h.date >= t.slice(0, 4) + '-01-01');
  view.innerHTML = `
  ${admin ? `<section class="panel">
    <h2>Waiting for approval</h2>
    <p class="muted">People who have signed up but can’t see the roster yet. Approve your teammates to add them to the end of the rotation. Remove anyone you don’t recognise.</p>
    <div class="list">${pending.map(p => `<div class="item"><div class="main"><b>${esc(p.display_name)}</b><div class="muted">${esc(p.email || '')}</div></div>
      <button class="btn small primary" data-approve="${p.id}">Approve</button>
      <button class="btn small danger" data-remove="${p.id}" data-who="${esc(p.display_name)}">Remove</button></div>`).join('') || '<p class="muted">No one is waiting.</p>'}</div>
  </section>` : ''}
  <section class="panel">
    <h2>Rotation order</h2>
    <p class="muted">Each working day the next person in this order becomes Primary, and everyone else follows. ${admin ? 'Use the arrows to change the order. Untick Active to leave someone out of the roster.' : 'Only admins can change the order.'}</p>
    <div class="list">${sorted.map((p, i) => `<div class="item">
      <span class="order">${i + 1}.</span>
      <div class="main">${admin || p.id === me.id ? `<input class="name-input" data-name="${p.id}" value="${esc(p.display_name)}" aria-label="Name">` : `<b>${esc(p.display_name)}</b>`}
        ${p.email ? `<div class="muted">${esc(p.email)}</div>` : ''}</div>
      ${p.is_admin ? '<span class="tag">Admin</span>' : ''}${!p.active ? '<span class="tag leave">Inactive</span>' : ''}
      ${admin ? `<label class="check"><input type="checkbox" data-active="${p.id}"${p.active ? ' checked' : ''}> Active</label>
        <label class="check"><input type="checkbox" data-admin="${p.id}"${p.is_admin ? ' checked' : ''}${p.id === me.id ? ' disabled title="You can’t remove your own admin access"' : ''}> Admin</label>
        <button class="btn small" data-up="${i}" aria-label="Move ${esc(p.display_name)} up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="btn small" data-down="${i}" aria-label="Move ${esc(p.display_name)} down"${i === sorted.length - 1 ? ' disabled' : ''}>↓</button>` : ''}
    </div>`).join('')}</div>
    <p class="muted">${admin ? 'New people appear under Waiting for approval when they create an account, and join the end of the rotation once approved.' : 'New people join the end of the rotation once an admin approves them.'} Only admins see everyone’s email.</p>
  </section>
  <section class="panel">
    <h2>Rotation start</h2>
    <p class="muted">The rotation counts working days from this date. The first working day on or after it starts with person 1.</p>
    ${admin ? `<form class="form" id="start-form"><label class="field">Start date<input type="date" id="s-start" required value="${settings.rota_start}"></label><button class="btn primary" type="submit">Save</button></form>`
      : `<p><b>${fmtDay(settings.rota_start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</b></p>`}
  </section>
  <section class="panel">
    <h2>Public calendar</h2>
    <p class="muted">A read-only month calendar that anyone with the link can open without an account. It shows each working day’s duty list (names and roles) from about 3 months ago to 6 months ahead. It doesn’t share emails, leave dates or notes, though someone missing from a day’s list may be away.</p>
    <p><a href="calendar.html">${esc(new URL('calendar.html', location.href).href)}</a></p>
    ${admin ? `<label class="check"><input type="checkbox" id="pub-cal"${settings.public_calendar !== false ? ' checked' : ''}> Anyone with the link can view the calendar</label>`
      : `<p>${settings.public_calendar !== false ? 'The public calendar is on.' : 'The public calendar is off.'}</p>`}
  </section>
  <section class="panel">
    <h2>Public holidays</h2>
    <p class="muted">No duty on these days. Singapore holidays for 2026 and 2027 are included${admin ? '. Add later years when they’re announced.' : '.'}</p>
    ${admin ? `<form class="form" id="hol-form"><label class="field">Date<input type="date" id="h-date" required></label><label class="field grow">Name<input id="h-name" required maxlength="60" placeholder="e.g. Polling Day"></label><button class="btn primary" type="submit">Add holiday</button></form>` : ''}
    <div class="list">${upcomingHol.map(h => `<div class="item"><span class="when">${fmtDay(h.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span><div class="main">${esc(h.name)}</div>${admin ? `<button class="btn small danger" data-hdel="${h.date}">Remove</button>` : ''}</div>`).join('') || '<p class="muted">No holidays listed.</p>'}</div>
  </section>`;

  view.querySelectorAll('[data-name]').forEach(inp => inp.onchange = () => {
    const v = inp.value.trim();
    if (!v) { toast('Name can’t be empty.'); return; }
    act(() => store.updateProfile(inp.dataset.name, { display_name: v }), 'Name saved.');
  });
  // Approved people join the end of the rotation.
  const nextOrder = Math.max(-1, ...sorted.map(p => p.rota_order)) + 1;
  view.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => act(() => store.updateProfile(b.dataset.approve, { approved: true, rota_order: nextOrder }), 'Approved. They’re now at the end of the rotation.'));
  view.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    if (!window.confirm('Remove ' + b.dataset.who + '? Their profile is deleted and they won’t see the roster.')) return;
    act(() => store.deleteProfile(b.dataset.remove), 'Removed.');
  });
  view.querySelectorAll('[data-active]').forEach(c => c.onchange = () => act(() => store.updateProfile(c.dataset.active, { active: c.checked }), c.checked ? 'Back on the roster.' : 'Left out of the roster.'));
  view.querySelectorAll('[data-admin]').forEach(c => c.onchange = () => act(() => store.updateProfile(c.dataset.admin, { is_admin: c.checked }), 'Admin access updated.'));
  const move = async (i, j) => {
    const list = sorted.slice();
    [list[i], list[j]] = [list[j], list[i]];
    for (let k = 0; k < list.length; k++) if (list[k].rota_order !== k) await store.updateProfile(list[k].id, { rota_order: k });
  };
  view.querySelectorAll('[data-up]').forEach(b => b.onclick = () => act(() => move(+b.dataset.up, +b.dataset.up - 1), 'Order updated.'));
  view.querySelectorAll('[data-down]').forEach(b => b.onclick = () => act(() => move(+b.dataset.down, +b.dataset.down + 1), 'Order updated.'));
  const sf = document.getElementById('start-form');
  if (sf) sf.onsubmit = e => { e.preventDefault(); act(() => store.updateSettings({ rota_start: document.getElementById('s-start').value }), 'Rotation start saved.'); };
  const pc = document.getElementById('pub-cal');
  if (pc) pc.onchange = () => act(() => store.updateSettings({ public_calendar: pc.checked }), pc.checked ? 'Public calendar switched on.' : 'Public calendar switched off.');
  const hf = document.getElementById('hol-form');
  if (hf) hf.onsubmit = e => { e.preventDefault(); act(() => store.addHoliday(document.getElementById('h-date').value, document.getElementById('h-name').value.trim()), 'Holiday added.'); };
  view.querySelectorAll('[data-hdel]').forEach(b => b.onclick = () => act(() => store.deleteHoliday(b.dataset.hdel), 'Holiday removed.'));
}
