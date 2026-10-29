import { buildSchedule, checkpointFor, toISO, fromISO, addDays, todaySG, onRota, rosterMessage, whatsappLink, WHATSAPP_ICON, initials, avatarColor } from './schedule.js';
import { createStore } from './connect.js';
import { keepFresh } from './live.js';

const root = document.getElementById('root');
let store;
try { store = await createStore(); }
catch (e) {
  root.innerHTML = '<div class="auth"><div class="panel"><h2>Can’t load the app</h2><p class="muted">Part of the app couldn’t be downloaded. Check your internet connection, then <button class="btn small" type="button" id="reload">reload the page</button></p></div></div>';
  document.getElementById('reload').onclick = () => location.reload();
  throw e;
}

const state = { data: null, tab: 'roster', month: todaySG().slice(0, 7), authMode: 'signin', authError: '', authNote: '' };

/* ---------- Helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = todaySG;
function fmtDay(iso, opts) { return fromISO(iso).toLocaleDateString('en-SG', opts || { weekday: 'short', day: 'numeric', month: 'short' }); }
function fmtRange(a, b) { return a === b ? fmtDay(a) : fmtDay(a) + ' – ' + fmtDay(b); }
function shortRole(role) { return role === 'Primary' ? 'P' : 'S' + role.split(' ')[1]; }
let toastTimer;
/** Shows a short message and announces it to screen readers through the always-present #announce region. */
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  const a = document.getElementById('announce');
  a.textContent = '';
  setTimeout(() => { a.textContent = msg; }, 50);
}

/* Keyboard focus survives re-rendering (GitHub issue #12): remember the focused control by its id or
   data attribute, and afterwards focus the same control again, or the view's heading if it's gone. */
function focusKey(el) {
  if (!el || el === document.body || !root.contains(el)) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  const attr = [...el.attributes].find(a => a.name.startsWith('data-'));
  return attr ? '[' + attr.name + '="' + CSS.escape(attr.value) + '"]' : null;
}
function restoreFocus(key) {
  if (!key) return;
  const el = root.querySelector(key);
  const target = el && !el.disabled ? el : root.querySelector('#view h2');
  if (target) target.focus({ preventScroll: true });
}

/** Runs a change, then reloads. The control that started it is disabled meanwhile, so double clicks don't repeat it. */
async function act(fn, done) {
  const el = document.activeElement, key = focusKey(el);
  const busy = el && root.contains(el) && 'disabled' in el ? el : null;
  if (busy) { busy.disabled = true; busy.setAttribute('aria-busy', 'true'); }
  try { await fn(); if (done) toast(done); }
  catch (e) { toast(e.message || 'Something went wrong. Try again.'); }
  finally { await refresh(); restoreFocus(key); }
}

/* ---------- Rotation history (GitHub issue #7) ---------- */
const byRota = (a, b) => (a.rota_order - b.rota_order) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id));
function rotaParams(d) {
  return {
    members: d.profiles.filter(onRota).sort(byRota).map(p => ({ id: p.id, name: p.display_name })),
    people: d.profiles.map(p => ({ id: p.id, name: p.display_name })),
    checkpoints: d.checkpoints || [],
    leaves: d.leaves,
    holidays: Object.fromEntries(d.holidays.map(h => [h.date, h.name])),
    anchor: d.settings.rota_start
  };
}
/** After a change to who is on the rotation or their order, save it from today so earlier days keep their duties. */
async function recordRotaChange() {
  const d = await store.load();
  const order = d.profiles.filter(onRota).sort(byRota).map(p => p.id);
  const t = today();
  const cps = (d.checkpoints || []).slice().sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  const inEffect = cps.filter(c => c.effective_date <= t).pop() || cps[0];
  if (inEffect && inEffect.member_order.join() === order.join()) return;
  await store.saveCheckpoint(checkpointFor(rotaParams(d), t, order));
}

function scheduleFor(from, to) {
  return buildSchedule({ ...rotaParams(state.data), from, to });
}

/* ---------- Boot ---------- */
// Only the latest refresh draws, so a slow load can't draw the roster over the sign-in screen after signing out.
let refreshes = 0;
async function refresh() {
  const run = ++refreshes;
  try {
    const uid = await store.userId();
    if (run !== refreshes) return;
    if (!uid) { state.data = null; renderAuth(); return; }
    const data = await store.load();
    if (run !== refreshes) return;
    state.data = data;
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
    // Keep the header (and whatever has focus in it) unless who is signed in has changed.
    const view = root.querySelector('#view');
    if (view && view.dataset.user === userKey(state.data.me)) renderView();
    else renderApp();
  } catch (e) {
    if (run !== refreshes) return;
    root.innerHTML = '<div class="auth"><div class="panel"><h2>Can’t reach the database</h2><p class="error">' + esc(e.message) + '</p><p class="muted">Check the values in <code>config.js</code> and that <code>supabase/schema.sql</code> has been run.</p></div></div>';
  }
}
store.onAuthChange(refresh);
refresh();

/* ---------- Staying up to date ---------- */
// Typing in a form marks it unsaved; background refreshes wait until it's saved or the view is redrawn.
let unsaved = false;
root.addEventListener('input', () => { unsaved = true; });
const typing = () => unsaved || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
let lastDay = today();
keepFresh(async () => {
  // Follow the calendar into a new month if the page was showing the month that just ended.
  const t = today();
  if (t !== lastDay && state.month === lastDay.slice(0, 7)) state.month = t.slice(0, 7);
  lastDay = t;
  const key = focusKey(document.activeElement);
  await refresh();
  if (key) restoreFocus(key);
}, () => state.data !== null && !typing());

/* ---------- Sign in ---------- */
function renderAuth() {
  const demo = store.mode === 'demo';
  const signup = state.authMode === 'signup';
  root.innerHTML = `
  <div class="auth">
    <div><h1>2FA Login Request</h1><p class="muted">Daily duty rotation. Sign in to see your duties and add your leave.</p>
      <p><a href="calendar.html">View the duty calendar without signing in →</a></p></div>
    <div class="panel">
      <div class="switch" role="group" aria-label="Account">
        <button type="button" data-mode="signin" aria-pressed="${!signup}">Sign in</button>
        <button type="button" data-mode="signup" aria-pressed="${signup}">Create account</button>
      </div>
      <form id="auth-form">
        ${signup ? `<label class="field">Your name<input id="f-name" required autocomplete="name" value="${esc(state.authName || '')}"></label>` : ''}
        <label class="field">Email<input id="f-email" type="email" required autocomplete="email" value="${esc(state.authEmail || '')}"${state.authError ? ' aria-describedby="auth-error"' : ''}></label>
        <label class="field">Password<input id="f-pass" type="password" ${demo ? '' : 'required minlength="6"'} autocomplete="${signup ? 'new-password' : 'current-password'}"${state.authError ? ' aria-describedby="auth-error"' : ''}></label>
        ${state.authError ? '<p class="error" id="auth-error" role="alert" tabindex="-1">' + esc(state.authError) + '</p>' : ''}
        ${state.authNote ? '<p class="muted" role="status">' + esc(state.authNote) + '</p>' : ''}
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
    // Keep what was typed if the form has to be shown again with an error.
    state.authEmail = email;
    state.authName = signup ? document.getElementById('f-name').value.trim() : state.authName;
    state.authError = state.authNote = '';
    try {
      if (signup) {
        const r = await store.signUp(email, pass, document.getElementById('f-name').value.trim());
        if (r.needsConfirmation) { state.authMode = 'signin'; state.authNote = 'Check your email and click the confirmation link, then sign in.'; renderAuth(); }
      } else await store.signIn(email, pass);
    } catch (err) {
      state.authError = err.message; renderAuth();
      document.getElementById('auth-error').focus();
    }
  };
}

/* ---------- App shell ---------- */
function renderApp() {
  const { me } = state.data;
  const tabs = [['roster', 'Roster'], ['leave', 'Leave'], ['team', me.is_admin ? 'Team & settings' : 'Team']];
  root.innerHTML = `
  <header class="top"><div class="wrap">
    <span class="brand">2FA Login Request</span>
    <span class="who">Signed in as <b>${esc(me.display_name)}</b>${me.is_admin ? ' · admin' : ''}</span>
    <a class="btn small" href="calendar.html">Calendar</a>
    <button class="btn small" id="signout">Sign out</button>
    <nav class="tabs" aria-label="Sections">${tabs.map(([id, label]) => `<button type="button" data-tab="${id}"${state.tab === id ? ' aria-current="page"' : ''}>${label}</button>`).join('')}</nav>
  </div></header>
  ${store.mode === 'demo' ? '<div class="demo"><div class="wrap"><span><b>Demo mode.</b> Data is saved in this browser only. Add your Supabase details to <code>config.js</code> to share it with the team.</span><button class="btn link" id="reset-demo">Reset demo data</button></div></div>' : ''}
  <main class="wrap" id="view" data-user="${esc(userKey(me))}"></main>`;
  document.getElementById('signout').onclick = () => store.signOut();
  const reset = document.getElementById('reset-demo');
  if (reset) reset.onclick = () => store.reset();
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    state.tab = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(x => { if (x === b) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
    renderView();
  });
  renderView();
}
function userKey(me) { return me.id + '|' + me.display_name + '|' + me.is_admin; }
/** Redraws only the current section. Headings can take focus, as the fallback when a focused control disappears. */
function renderView() {
  unsaved = false;
  ({ roster: renderRoster, leave: renderLeave, team: renderTeam })[state.tab]();
  root.querySelectorAll('#view h2').forEach(h => h.setAttribute('tabindex', '-1'));
}

/* ---------- Roster ---------- */
const avatar = name => `<span class="av" style="--av:${avatarColor(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
/** Who holds each role on one working day, as a list: Primary, Secondary 1… then anyone on leave. */
function summary(day, meId) {
  const row = (cls, role, m) => `<div class="${cls}${m.id === meId ? ' me' : ''}"><dt>${role}</dt><dd>${avatar(m.name)}${esc(m.name)}${m.id === meId ? ' (you)' : ''}</dd></div>`;
  return `<dl class="summary">${day.duties.map(d => row(d.role === 'Primary' ? 'p' : '', esc(d.role), d.member)).join('')}${day.onLeave.map(m => row('away', 'On leave', m)).join('')}</dl>`
    + (day.duties.length ? '' : '<p class="muted">No one is available for duty.</p>');
}
function chip(duty, meId) {
  const me = duty.member.id === meId;
  return `<span class="chip${duty.role === 'Primary' ? ' p' : ''}${me ? ' me' : ''}"><span class="r">${shortRole(duty.role)}</span>${esc(duty.member.name)}</span>`;
}

function renderRoster() {
  const { me, settings } = state.data;
  const view = document.getElementById('view');
  const t = today();
  const [td] = scheduleFor(t, t);
  // The next working day's roster (today if it's a working day): summarised here and shared on WhatsApp.
  const shareDay = scheduleFor(t, addDays(t, 21)).find(d => d.kind === 'work');
  let mineToday, todaySummary;
  if (td.kind === 'work') {
    const mine = td.duties.find(d => d.member.id === me.id);
    mineToday = mine ? mine.role : td.onLeave.some(m => m.id === me.id) ? 'On leave' : 'No duty';
    todaySummary = summary(td, me.id);
  } else {
    mineToday = 'No duty';
    todaySummary = `<p class="muted">${td.kind === 'holiday' ? 'Public holiday: ' + esc(td.holiday) + '.' : td.kind === 'weekend' ? 'It’s the weekend.' : 'The rotation starts on ' + fmtDay(settings.rota_start) + '.'}</p>`
      + (shareDay ? `<p class="summary-next">Next duty day · ${fmtDay(shareDay.date)}</p>` + summary(shareDay, me.id) : '');
  }

  let shareHtml = '';
  if (shareDay) {
    const text = rosterMessage({ date: shareDay.date, duties: shareDay.duties.map(d => ({ role: d.role, name: d.member.name })) },
      new URL('calendar.html', location.href).href);
    shareHtml = `<div class="share"><a class="btn wa" id="share-wa" href="${esc(whatsappLink(text))}" target="_blank" rel="noopener">${WHATSAPP_ICON}Click me for OTP on WhatsApp</a>
      ${navigator.share ? '<button class="btn" type="button" id="share-other">Share another way</button>' : ''}</div>`;
    state.shareText = text;
  }

  const [y, m] = state.month.split('-').map(Number);
  const first = state.month + '-01', last = toISO(new Date(y, m, 0, 12));
  const days = scheduleFor(first, last).filter(d => d.kind === 'work' || d.kind === 'holiday');
  const before = first < settings.rota_start;
  const monthName = fromISO(first).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });

  view.innerHTML = `
  <section class="panel today" aria-label="2FA Login">
    <div class="mine"><span class="label">2FA Login · ${fmtDay(t)} · Your role</span><span class="role">${esc(mineToday)}</span></div>
    <div>${todaySummary}</div>
    ${shareHtml}
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
        <span class="chips">${d.duties.length ? '' : '<span class="nobody">No one available</span>'}${d.duties.map(x => chip(x, me.id)).join('')}${d.onLeave.map(x => `<span class="chip away"><span class="r">LEAVE</span>${esc(x.name)}</span>`).join('')}</span></div>`;
    }).join('') || '<p class="muted">No working days to show this month.</p>'}</div>
  </section>`;
  const other = document.getElementById('share-other');
  if (other) other.onclick = () => navigator.share({ text: state.shareText }).catch(() => {});
  // Changing month keeps focus on the button that was pressed.
  const go = month => { const key = focusKey(document.activeElement); state.month = month; renderView(); restoreFocus(key); };
  document.getElementById('prev').onclick = () => go(toISO(new Date(y, m - 2, 1, 12)).slice(0, 7));
  document.getElementById('next').onclick = () => go(toISO(new Date(y, m, 1, 12)).slice(0, 7));
  document.getElementById('this').onclick = () => go(today().slice(0, 7));
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
      ${l.user_id !== me.id && !me.is_admin ? ''
        // Leave that has begun is part of past duties, so it can be ended early but not removed (issue #7).
        : l.start_date < t ? `<button class="btn small" data-end="${l.id}">End early (back today)</button>`
        : `<button class="btn small danger" data-del="${l.id}">Remove</button>`}</div>`;
  view.innerHTML = `
  <section class="panel">
    <h2>Add leave</h2>
    <p class="muted">You’ll be left out of the roster on these days, and everyone else moves up.</p>
    <form class="form" id="leave-form">
      ${me.is_admin ? `<label class="field">Person<select id="l-who">${profiles.filter(onRota).map(p => `<option value="${p.id}"${p.id === me.id ? ' selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select></label>` : ''}
      <label class="field">From<input type="date" id="l-start" required value="${t}"${me.is_admin ? '' : ` min="${t}"`}></label>
      <label class="field">To<input type="date" id="l-end" required value="${t}" min="${t}"></label>
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
  view.querySelectorAll('[data-end]').forEach(b => b.onclick = () => act(() => store.updateLeave(Number(b.dataset.end), { end_date: addDays(t, -1) }), 'Leave ended. You’re back on the roster from today.'));
  document.getElementById('l-start').onchange = e => { document.getElementById('l-end').min = e.target.value; };
}

/* ---------- Team & settings ---------- */
function renderTeam() {
  const { me, profiles, holidays, settings } = state.data;
  const admin = me.is_admin;
  const view = document.getElementById('view');
  const t = today();
  const sorted = profiles.filter(p => p.approved !== false).sort(byRota);
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
      <div class="main">${admin || p.id === me.id ? `<input class="name-input" data-name="${p.id}" value="${esc(p.display_name)}" maxlength="60" aria-label="Name">` : `<b>${esc(p.display_name)}</b>`}
        ${p.email ? `<div class="muted">${esc(p.email)}</div>` : ''}</div>
      ${p.is_admin ? '<span class="tag">Admin</span>' : ''}${!p.active ? '<span class="tag leave">Inactive</span>' : ''}
      ${admin ? `<label class="check"><input type="checkbox" data-active="${p.id}"${p.active ? ' checked' : ''}> Active</label>
        <label class="check"><input type="checkbox" data-admin="${p.id}"${p.is_admin ? ' checked' : ''}${p.id === me.id ? ' disabled title="You can’t remove your own admin access"' : ''}> Admin</label>
        <button class="btn small" data-up="${p.id}" aria-label="Move ${esc(p.display_name)} up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="btn small" data-down="${p.id}" aria-label="Move ${esc(p.display_name)} down"${i === sorted.length - 1 ? ' disabled' : ''}>↓</button>` : ''}
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
  // Changes to who is on the rotation, or their order, take effect from today; earlier days keep their duties.
  view.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => act(async () => {
    await store.updateProfile(b.dataset.approve, { approved: true, rota_order: nextOrder });
    await recordRotaChange();
  }, 'Approved. They’re at the end of the rotation from today.'));
  view.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    if (!window.confirm('Remove ' + b.dataset.who + '? Their profile is deleted and they won’t see the roster.')) return;
    act(() => store.deleteProfile(b.dataset.remove), 'Removed.');
  });
  view.querySelectorAll('[data-active]').forEach(c => c.onchange = () => act(async () => {
    await store.updateProfile(c.dataset.active, { active: c.checked });
    await recordRotaChange();
  }, c.checked ? 'Back on the roster from today.' : 'Left out of the roster from today.'));
  view.querySelectorAll('[data-admin]').forEach(c => c.onchange = () => act(() => store.updateProfile(c.dataset.admin, { is_admin: c.checked }), 'Admin access updated.'));
  // The whole new order is saved in one step, so a failure can't leave two people in the same place (issue #9).
  const move = async (id, by) => {
    const list = sorted.slice(), i = list.findIndex(p => p.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await store.setRotaOrder(list.map(p => p.id));
    await recordRotaChange();
  };
  // The arrows are keyed by person, so focus follows the person being moved.
  view.querySelectorAll('[data-up]').forEach(b => b.onclick = () => act(() => move(b.dataset.up, -1), 'Order updated from today.'));
  view.querySelectorAll('[data-down]').forEach(b => b.onclick = () => act(() => move(b.dataset.down, 1), 'Order updated from today.'));
  const sf = document.getElementById('start-form');
  if (sf) sf.onsubmit = e => {
    e.preventDefault();
    const start = document.getElementById('s-start').value;
    if (!window.confirm('Restart the rotation on ' + fmtDay(start, { day: 'numeric', month: 'long', year: 'numeric' }) + '? Person 1 will be Primary on the first working day, and all earlier duty history is recalculated.')) return;
    act(() => store.resetRotation(start, sorted.filter(onRota).map(p => p.id)), 'Rotation restarted.');
  };
  const pc = document.getElementById('pub-cal');
  if (pc) pc.onchange = () => act(() => store.updateSettings({ public_calendar: pc.checked }), pc.checked ? 'Public calendar switched on.' : 'Public calendar switched off.');
  const hf = document.getElementById('hol-form');
  if (hf) hf.onsubmit = e => { e.preventDefault(); act(() => store.addHoliday(document.getElementById('h-date').value, document.getElementById('h-name').value.trim()), 'Holiday added.'); };
  view.querySelectorAll('[data-hdel]').forEach(b => b.onclick = () => act(() => store.deleteHoliday(b.dataset.hdel), 'Holiday removed.'));
}
