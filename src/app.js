import { buildSchedule, checkpointFor, toISO, fromISO, addDays, todaySG, onRota, rosterMessage, whatsappLink, WHATSAPP_ICON, shortName, officeHours, msUntilOfficeChange } from './schedule.js';
import { createStore } from './connect.js';
import { faceSvg } from './faces.js';
import { keepFresh } from './live.js';
import { swipeTabs, typingIn } from './swipe.js';

const root = document.getElementById('root');
let store;
try { store = await createStore(); }
catch (e) {
  root.innerHTML = '<div class="auth"><div class="panel"><h2>Can’t load the app</h2><p class="muted">Part of the app couldn’t be downloaded. Check your internet connection, then <button class="btn small" type="button" id="reload">reload the page</button></p></div></div>';
  document.getElementById('reload').onclick = () => location.reload();
  throw e;
}

const state = { data: null, loadedAt: 0, offline: false, tab: 'roster', month: todaySG().slice(0, 7), earlier: false, authMode: 'signin', authError: '', authNote: '' };

/* ---------- Helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = todaySG;
function fmtDay(iso, opts) { return fromISO(iso).toLocaleDateString('en-SG', opts || { weekday: 'short', day: 'numeric', month: 'short' }); }
function fmtRange(a, b) { return a === b ? fmtDay(a) : fmtDay(a) + ' – ' + fmtDay(b); }
function shortRole(role) { return role === 'Primary' ? 'P' : 'S' + role.split(' ')[1]; }
/** A short role ("P", "S1") on screen, read out in full ("Primary", "Secondary 1"). */
const roleLabel = (role, after = '') => `<span aria-hidden="true">${shortRole(role)}</span><span class="sr-only">${role}${after}</span>`;
let toastTimer;
/** Shows a short message and announces it to screen readers through the always-present #announce region
 *  (unless `quiet`, when the same words are already announced next to the form). */
function toast(msg, quiet = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  if (quiet) return;
  const a = document.getElementById('announce');
  a.textContent = '';
  setTimeout(() => { a.textContent = msg; }, 50);
}
// What browsers say when a request never reached the server: Chrome "Failed to fetch", Safari "Load failed",
// Firefox "NetworkError when attempting to fetch resource".
const NO_CONNECTION = /failed to fetch|load failed|networkerror|network request failed|fetch failed|network connection was lost|appears to be offline/i;
const offline = e => NO_CONNECTION.test((e && e.message) || '') || navigator.onLine === false;
/** An error in plain words: a dropped connection says so, instead of "Failed to fetch". */
function plain(e) {
  if (offline(e)) return 'Can’t connect. Check your internet connection and try again.';
  return (e && e.message) || 'Something went wrong. Try again.';
}
/** "10:42 am", or "Mon 16 Nov, 6:12 pm" when it wasn't today, in Singapore time. */
function clockTime(ms) {
  const time = new Date(ms).toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit' });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date(ms));
  return day === today() ? time : fmtDay(day) + ', ' + time;
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

/* ---------- Typed input ---------- */
const FIELDS = 'input, select, textarea';
/** A text field or list whose value differs from what was drawn: typed in and not saved yet. Ticks save at once, so they never count. */
function edited(f) {
  if (f.type === 'checkbox' || f.type === 'radio') return false;
  if (f.tagName === 'SELECT') {
    let drawn = 0;
    for (let i = 0; i < f.options.length; i++) if (f.options[i].defaultSelected) drawn = i;
    return f.selectedIndex !== drawn;
  }
  return f.value !== f.defaultValue;
}
/** The values of `fields` by focus key, to put back after a redraw. */
function valuesOf(fields) {
  return [...fields].filter(f => f.matches && f.matches(FIELDS) && f.type !== 'checkbox' && focusKey(f)).map(f => [focusKey(f), f.value]);
}
/** Puts typed values back into the fields that now carry the same keys. */
function putBack(values) {
  values.forEach(([key, v]) => {
    const f = root.querySelector(key);
    if (!f || f.value === v) return;
    f.value = v;
    f.dispatchEvent(new Event('input', { bubbles: true }));   // so fields that follow it (the leave's end date) catch up
  });
}
const unsavedInput = () => [...root.querySelectorAll('#view input, #view select, #view textarea')].some(edited);

/* ---------- Saving changes ---------- */
// The control a change came from: the submit button (e.submitter), or the tapped button, tick or field. Safari
// doesn't focus a button when it is tapped, so document.activeElement can't be trusted to say which one it was.
let trigger = null;
for (const type of ['click', 'change', 'submit']) root.addEventListener(type, e => {
  const form = type === 'submit' ? e.target : null;
  const el = form ? e.submitter || form.querySelector('[type=submit]') : e.target.closest('button, input, select, textarea') || e.target;
  const t = trigger = { el, form };
  setTimeout(() => { if (trigger === t) trigger = null; });   // only for the event it came from
}, true);

// Changes being saved. A redraw while one is on its way (another change finished first) keeps its control and
// form disabled, and the values being saved in them, so it can't be sent twice.
const saving = new Set();
function lock(job) {
  const form = job.form && root.querySelector(job.form), el = job.key && root.querySelector(job.key);
  if (job.values) putBack(job.values);
  [...(form ? form.elements : []), el].forEach(x => {
    if (!x || !('disabled' in x) || x.disabled) return;
    x.disabled = true; job.locked.add(x);
  });
  if (el) el.setAttribute('aria-busy', 'true');
}
function unlock(job) {
  job.locked.forEach(x => { x.disabled = false; x.removeAttribute('aria-busy'); });
  job.locked.clear();
}
/** Shows a rejected change's reason next to its form (or field), where it is read out at once. */
function formError(target, msg) {
  if (!target) return false;
  const old = target.nextElementSibling;
  if (old && old.classList.contains('form-error')) old.remove();
  if (!msg) return true;
  const p = document.createElement('p');
  p.className = 'error form-error'; p.setAttribute('role', 'alert'); p.textContent = msg;
  target.after(p);
  return true;
}
const errorTarget = job => (job.form && root.querySelector(job.form)) || (job.field && root.querySelector(job.key)) || null;

/**
 * Runs a change, then reloads. The control it came from (and its form's fields) are disabled meanwhile, so a
 * double tap doesn't repeat it. If it is refused, what was typed stays, with the reason next to the form.
 */
async function act(fn, done) {
  const t = trigger; trigger = null;
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const el = t && root.contains(t.el) ? t.el : active;
  const form = (t && t.form) || (el && el.form) || null;
  const field = !form && el && el.matches(FIELDS) && el.type !== 'checkbox' ? el : null;
  const job = { key: focusKey(el), form: form && focusKey(form), field: !!field, values: form ? valuesOf(form.elements) : field ? valuesOf([field]) : null, locked: new Set() };
  const focus = focusKey(active);
  formError(form || field, '');
  saving.add(job); lock(job);
  let error = null;
  try {
    await fn();
    // Saved: the form is cleared, so its values aren't kept as unsaved input by the redraw.
    if (form) form.reset(); else if (field) field.defaultValue = field.value;
    if (done) toast(done);
  } catch (e) { error = plain(e); toast(error, !!(form || field)); }
  saving.delete(job);
  await refresh();
  await drawing;   // a newer refresh, started meanwhile, draws last
  unlock(job);
  if (error) { if (job.values) putBack(job.values); formError(errorTarget(job), error); }
  restoreFocus(focus);
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
// `drawing` is the latest one, for anyone who needs to wait until the screen is up to date.
let refreshes = 0, drawing = Promise.resolve();
const refresh = () => (drawing = reload());
async function reload() {
  const run = ++refreshes;
  try {
    const uid = await store.userId();
    if (run !== refreshes) return;
    if (!uid) { state.data = null; state.offline = false; renderAuth(); return; }
    const data = await store.load();
    if (run !== refreshes) return;
    state.data = data; state.loadedAt = Date.now(); state.offline = false;
    const { me } = data;
    // A sign-up an admin removed has a login but no profile; someone whose access was removed is neither approved nor active.
    if (!me) return accountScreen('Your account was removed', 'Ask your admin if this is a mistake.');
    if (me.approved === false && me.active === false) return accountScreen('Your access was removed', 'Ask your admin if this is a mistake.', 'Nothing has changed yet.');
    if (me.approved === false) return accountScreen('Waiting for approval', 'Thanks for signing up, ' + esc(me.display_name) + '. An admin needs to approve your account before you can see the roster. Check back later.', 'Still waiting for approval.');
    // Keep the header (and whatever has focus in it) unless who is signed in has changed, and keep anything typed and not saved yet.
    const view = root.querySelector('#view');
    if (view && view.dataset.user === userKey(me)) {
      const typed = valuesOf([...root.querySelectorAll('#view input, #view select, #view textarea')].filter(edited));
      renderView();
      putBack(typed);
    } else renderApp();
    showOffline(null);
  } catch (e) {
    if (run !== refreshes) return;
    state.offline = true;
    // After a good load, a failed refresh keeps what is on screen, with a note; only a first load that fails takes the screen.
    if (state.data && root.querySelector('#view')) showOffline(e);
    else cantLoad(e);
  }
}
store.onAuthChange(refresh);
refresh();

/** The screens for an account that can't see the roster yet: waiting for approval, or removed. */
function accountScreen(title, text, still) {
  root.innerHTML = `<div class="auth"><div class="panel"><h2>${title}</h2><p class="muted">${text}</p>
    <div class="form">${still ? '<button class="btn" type="button" id="check">Check again</button>' : ''}<button class="btn" type="button" id="out">Sign out</button></div></div></div>`;
  document.getElementById('out').onclick = () => store.signOut();
  const check = document.getElementById('check');
  if (check) check.onclick = () => retry(check, still);
}
/** A first load that failed: plain words, Try again and Sign out. Anything but a dropped connection also shows the details. */
function cantLoad(e) {
  const net = offline(e);
  root.innerHTML = `<div class="auth"><div class="panel"><h2>Can’t load the roster</h2>
    <p class="muted">${net ? 'Check your internet connection, then try again.' : 'Something went wrong. Try again in a moment.'}</p>
    ${net ? '' : `<p class="muted details">Details: ${esc(e && e.message)}</p>`}
    <div class="form"><button class="btn primary" type="button" id="retry">Try again</button><button class="btn" type="button" id="out">Sign out</button></div></div></div>`;
  document.getElementById('retry').onclick = () => retry(document.getElementById('retry'), 'Still can’t connect.');
  document.getElementById('out').onclick = async () => { try { await store.signOut(); } finally { refresh(); } };
}
/** After a good load: a small note under the header while the latest changes can't be fetched. Empty (and hidden) otherwise. */
function showOffline(e) {
  const bar = document.getElementById('offline');
  if (!bar) return;
  if (!e) {
    if (!bar.firstChild) return;
    const hadFocus = bar.contains(document.activeElement);
    bar.textContent = '';
    if (hadFocus) restoreFocus('#view h2');
    return;
  }
  const text = (offline(e) ? 'Can’t connect.' : 'Can’t load the latest changes.') + ' Showing what was loaded at ' + clockTime(state.loadedAt) + '.';
  const words = bar.querySelector('.offline-text');
  if (words) { if (words.textContent !== text) words.textContent = text; return; }
  bar.innerHTML = `<div class="wrap"><span class="offline-text">${esc(text)}</span><button class="btn small" type="button" id="retry">Try again</button></div>`;
  bar.querySelector('#retry').onclick = () => retry(bar.querySelector('#retry'), 'Still can’t connect.');
}
/** Try again / Check again: busy while it loads, and says so when nothing changed. */
async function retry(btn, still) {
  const hadFocus = document.activeElement === btn;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  await refresh(); await drawing;
  const same = document.getElementById(btn.id);
  if (same) { same.disabled = false; same.removeAttribute('aria-busy'); }
  if (state.offline || (btn.id === 'check' && same)) { toast(state.offline ? 'Still can’t connect.' : still); if (same) same.focus(); }
  else if (hadFocus && !same) restoreFocus('#view h2');
}
// Back online: catch up at once rather than at the next 5-minute refresh.
window.addEventListener('online', () => { if (state.offline) refresh(); });

/* ---------- Staying up to date ---------- */
// Background refreshes and swipes wait while there is typed input that isn't saved (a text field whose value differs
// from what was drawn), or while someone is in a text field. A focused tick or list doesn't hold them up.
const typing = () => unsavedInput() || typingIn(document.activeElement);
let lastDay = today();
// Swipe left or right on a phone to change tab.
swipeTabs(() => document.getElementById('view'), typing);

// Switch the "Your role" card over on time at 9am and 6pm (it waits while someone is typing).
const atOfficeChange = () => setTimeout(() => { if (state.data && !typing()) refresh(); atOfficeChange(); }, msUntilOfficeChange() + 2000);
atOfficeChange();

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
        <button class="btn primary" type="submit" id="f-submit">${signup ? 'Create account' : 'Sign in'}</button>
      </form>
    </div>
    ${demo ? `<div class="panel"><h3>Demo mode</h3><p class="muted">No database is connected yet, so data stays in this browser. Any password works. Sign in as one of the example team (Alice is the admin):</p>
      <div class="people">${store.db.profiles.map(p => `<button class="btn" type="button" data-demo="${esc(p.email)}">Sign in as ${esc(p.display_name)}${p.is_admin ? ' (admin)' : ''}</button>`).join('')}</div></div>` : ''}
  </div>`;
  // Switching between Sign in and Create account redraws the form; focus stays on the switch that was pressed.
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { state.authMode = b.dataset.mode; state.authError = state.authNote = ''; renderAuth(); restoreFocus('[data-mode="' + b.dataset.mode + '"]'); });
  root.querySelectorAll('[data-demo]').forEach(b => b.onclick = () => store.signIn(b.dataset.demo));
  document.getElementById('auth-form').onsubmit = async e => {
    e.preventDefault();
    const email = document.getElementById('f-email').value.trim(), pass = document.getElementById('f-pass').value;
    // Keep what was typed if the form has to be shown again with an error.
    state.authEmail = email;
    state.authName = signup ? document.getElementById('f-name').value.trim() : state.authName;
    state.authError = state.authNote = '';
    const go = document.getElementById('f-submit');
    go.disabled = true; go.setAttribute('aria-busy', 'true');
    try {
      if (signup) {
        const r = await store.signUp(email, pass, document.getElementById('f-name').value.trim());
        if (r.needsConfirmation) { state.authMode = 'signin'; state.authNote = 'Check your email and click the confirmation link, then sign in.'; renderAuth(); }
      } else await store.signIn(email, pass);
    } catch (err) {
      state.authError = plain(err); renderAuth();
      document.getElementById('auth-error').focus();
    } finally { go.disabled = false; go.removeAttribute('aria-busy'); }
  };
}

/* ---------- App shell ---------- */
const ICON_CALENDAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>';
const ICON_SIGNOUT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/></svg>';
/** The account menu under your face in the header: who is signed in, Calendar and Sign out. */
function toggleAccount(open) {
  const btn = document.getElementById('acct-btn'), menu = document.getElementById('acct-menu');
  if (!btn || !menu) return;
  open = open ?? menu.hidden;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('a, button').focus();
}
// Close it on a tap elsewhere or Escape.
document.addEventListener('click', e => { if (!e.target.closest('.acct')) toggleAccount(false); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('acct-menu')?.hidden === false) { toggleAccount(false); document.getElementById('acct-btn').focus(); }
});
function renderApp() {
  const { me } = state.data;
  const tabs = [['roster', 'Roster'], ['leave', 'Leave'], ['team', me.is_admin ? '<span class="tab-long">Team & settings</span><span class="tab-short">Team</span>' : 'Team']];
  root.innerHTML = `
  <header class="top"><div class="wrap">
    <nav class="tabs" aria-label="Sections">${tabs.map(([id, label]) => `<button type="button" data-tab="${id}"${state.tab === id ? ' aria-current="page"' : ''}>${label}</button>`).join('')}</nav>
    <div class="acct top-end">
      <button type="button" class="acct-btn" id="acct-btn" aria-haspopup="true" aria-expanded="false" aria-controls="acct-menu"
        aria-label="Account: ${esc(me.display_name)}">${faceSvg(me.display_name)}</button>
      <div class="acct-menu" id="acct-menu" hidden>
        <p class="acct-head">Signed in as<b>${esc(me.display_name)}</b>${me.is_admin ? '<span class="acct-role">Admin</span>' : ''}</p>
        <a href="calendar.html">${ICON_CALENDAR}Calendar</a>
        <button type="button" id="signout">${ICON_SIGNOUT}Sign out</button>
      </div>
    </div>
  </div></header>
  ${store.mode === 'demo' ? '<div class="demo"><div class="wrap"><span><b>Demo mode.</b> Data is saved in this browser only. Add your Supabase details to <code>config.js</code> to share it with the team.</span><button class="btn link" id="reset-demo">Reset demo data</button></div></div>' : ''}
  <div class="offline" id="offline" role="status"></div>
  <main class="wrap" id="view" data-user="${esc(userKey(me))}"></main>`;
  document.getElementById('signout').onclick = () => store.signOut();
  document.getElementById('acct-btn').onclick = () => toggleAccount();
  const reset = document.getElementById('reset-demo');
  if (reset) reset.onclick = () => store.reset();
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    state.tab = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(x => { if (x === b) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
    renderView();
    // Data more than a minute old is fetched again; the tab shows what was loaded meanwhile.
    if (Date.now() - state.loadedAt > STALE) refresh();
  });
  renderView();
}
const STALE = 60 * 1000;
function userKey(me) { return me.id + '|' + me.display_name + '|' + me.is_admin; }
/** Redraws only the current section. Headings can take focus, as the fallback when a focused control disappears. */
function renderView() {
  ({ roster: renderRoster, leave: renderLeave, team: renderTeam })[state.tab]();
  root.querySelectorAll('#view h2').forEach(h => h.setAttribute('tabindex', '-1'));
  saving.forEach(lock);
}

/* ---------- Roster ---------- */
const icon = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON_PREV = icon('M15 5l-7 7 7 7'), ICON_NEXT = icon('M9 5l7 7-7 7');
/** A person's drawn face in a circle (src/faces.js). */
const avatar = (name, cls = '') => `<span class="av${cls ? ' ' + cls : ''}" aria-hidden="true">${faceSvg(name)}</span>`;
/** One working day's line-up as a strip: the Primary, each Secondary in order, then anyone on leave. Screen readers
 *  hear each tile as "Secondary 1: Ben (you)", not "S1 Ben". */
function lineup(day, meId, names) {
  const cell = (cls, label, m) => `<li class="${cls}${m.id === meId ? ' me' : ''}" title="${esc(m.name)}"><span class="when">${label}</span>${avatar(m.name)}
    <span class="nm">${esc(shortName(m.name, names))}${m.id === meId ? '<span class="sr-only"> (you)</span>' : ''}</span></li>`;
  return `<ol class="strip lineup">${day.duties.map(d => cell(d.role === 'Primary' ? 'p' : '', roleLabel(d.role, ': '), d.member)).join('')}${day.onLeave.map(m => cell('away', '<span aria-hidden="true">Leave</span><span class="sr-only">On leave: </span>', m)).join('')}</ol>`
    + (day.duties.length ? '' : '<p class="muted">No one is available for duty.</p>');
}

function renderRoster() {
  const { me, settings, profiles } = state.data;
  const view = document.getElementById('view');
  const t = today();
  const names = profiles.map(p => p.display_name);
  const [td] = scheduleFor(t, t);
  // Office hours are 9am to 6pm on working days (same rule as calendar.js). From 6pm the card moves on
  // to the next working day; before 9am it still shows today, with a note that no one is on duty yet.
  const hours = officeHours();
  const closed = td.kind === 'work' && hours !== 'open';
  const nextShift = closed && hours === 'after';
  // The day shown in the line-up and shared on WhatsApp: today if it's a working day (until 6pm), otherwise the next one.
  const shareDay = scheduleFor(t, addDays(t, 21)).find(d => d.kind === 'work' && (!nextShift || d.date > t));
  let mineToday, note = '', headDate = t;
  const closedNote = '<p class="muted"><b class="warn-text">Outside office hours.</b> No one is on duty now. Office hours are 9am to 6pm on working days.</p>';
  if (td.kind === 'work' && !nextShift) {
    const mine = td.duties.find(d => d.member.id === me.id);
    mineToday = mine ? mine.role : td.onLeave.some(m => m.id === me.id) ? 'On leave' : 'No duty';
    if (closed) note = closedNote;
  } else if (nextShift && shareDay) {
    const mine = shareDay.duties.find(d => d.member.id === me.id);
    mineToday = mine ? mine.role : shareDay.onLeave.some(m => m.id === me.id) ? 'On leave' : 'No duty';
    headDate = shareDay.date;
    note = closedNote;
  } else if (nextShift) {
    mineToday = 'No duty'; note = closedNote;
  } else {
    mineToday = 'No duty';
    note = `<p class="muted">${td.kind === 'holiday' ? 'Public holiday: ' + esc(td.holiday) + '.' : td.kind === 'weekend' ? 'It’s the weekend.' : 'The rotation starts on ' + fmtDay(settings.rota_start) + '.'}</p>`
      + (shareDay ? `<p class="eyebrow">Next duty day · ${fmtDay(shareDay.date)}</p>` : '');
  }
  const shown = td.kind === 'work' && !nextShift ? td : shareDay;
  // The day the WhatsApp message is about: on a working day it is today's, even after 6pm (the owner's choice), with the
  // usual ask; on other days, the next working day's.
  const msgDay = td.kind === 'work' ? td : shareDay;

  let shareHtml = '';
  if (msgDay) {
    // The Primary isn't asked for an OTP by their own button: theirs tells the team who is on duty.
    const ask = msgDay.duties.length > 0 && msgDay.duties[0].member.id !== me.id;
    const text = rosterMessage({ date: msgDay.date, duties: msgDay.duties.map(d => ({ role: d.role, name: d.member.name })) },
      new URL('calendar.html', location.href).href, { ask });
    // With nobody to ask, the button shares the news instead of offering an OTP (same wording as calendar.js).
    shareHtml = `<div class="share"><a class="btn wa" id="share-wa" href="${esc(whatsappLink(text))}" target="_blank" rel="noopener">${WHATSAPP_ICON}${ask && !closed && td.kind === 'work' ? 'Click for OTP on WhatsApp' : 'Tell the team on WhatsApp'}</a>
      ${navigator.share ? '<button class="btn ghost" type="button" id="share-other">Share another way</button>' : ''}</div>`;
    state.shareText = text;
  }

  const [y, m] = state.month.split('-').map(Number);
  const first = state.month + '-01', last = toISO(new Date(y, m, 0, 12));
  const days = scheduleFor(first, last).filter(d => d.kind === 'work' || d.kind === 'holiday');
  const before = first < settings.rota_start;
  const monthName = fromISO(first).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
  // This month opens at this week's Monday; the days before it wait behind "Show earlier days". Other months show in full.
  const weekStart = addDays(t, -((fromISO(t).getDay() + 6) % 7));
  const earlier = state.month === t.slice(0, 7) ? days.filter(d => d.date < weekStart).length : 0;
  const folded = earlier > 0 && !state.earlier;

  // One row per working day: the date, the Primary, then the backups in order, with your own role on the right.
  // You are marked in white with a steel ring or underline: cyan means only the Primary and today.
  const dayRow = d => {
    const dt = fromISO(d.date);
    const li = kind => `<li class="day${kind}${d.date === t ? ' is-today' : ''}"${folded && d.date < weekStart ? ' hidden' : ''}>`;
    const date = `<span class="date"><span class="dow">${d.date === t ? 'Today' : dt.toLocaleDateString('en-SG', { weekday: 'short' })}</span><span class="dnum">${dt.getDate()}</span></span>`;
    if (d.kind === 'holiday') return `${li(' holiday')}${date}<span class="who"><span class="what">Public holiday</span><span class="then">${esc(d.holiday)}</span></span></li>`;
    const mine = d.duties.find(x => x.member.id === me.id);
    const away = d.onLeave.some(x => x.id === me.id);
    const [p, ...rest] = d.duties;
    const short = member => member.id === me.id ? `<b class="me">${esc(shortName(member.name, names))}<span class="sr-only"> (you)</span></b>` : esc(shortName(member.name, names));
    return `${li('')}${date}<span class="who">
      ${p ? `<span class="lead">${avatar(p.member.name, 'sm')}<span class="nm"><span class="sr-only">Primary: </span>${esc(p.member.name)}</span>${p.member.id === me.id ? '<span class="you">You</span>' : ''}</span>` : '<span class="nobody">No one available</span>'}
      ${rest.length ? `<span class="then">then ${rest.map(x => short(x.member)).join(' → ')}</span>` : ''}
      ${d.onLeave.length ? `<span class="tags">${d.onLeave.map(x => `<span class="tag leave">${esc(shortName(x.name, names))} on leave</span>`).join('')}</span>` : ''}</span>
      ${mine ? `<span class="badge${mine.role === 'Primary' ? ' p' : ''}"><span class="sr-only">Your role: </span>${mine.role === 'Primary' ? 'Primary' : roleLabel(mine.role)}</span>` : away ? '<span class="badge off"><span class="sr-only">You are on </span>Leave</span>' : ''}</li>`;
  };

  view.innerHTML = `
  <section class="panel role-card" aria-label="2FA Login">
    <div class="role-head"><span class="eyebrow">Your role · ${fmtDay(headDate)}</span><span class="role">${esc(mineToday)}</span></div>
    ${note}
    ${shown ? lineup(shown, me.id, names) : ''}
    ${shareHtml}
  </section>
  <section class="panel roster-panel">
    <div class="row-head">
      <h2>Roster</h2>
      <div class="month">
        ${state.month === t.slice(0, 7) ? '' : '<button class="btn small" id="this">This month</button>'}
        <span class="month-step"><button class="btn icon" id="prev" aria-label="Previous month">${ICON_PREV}</button>
        <strong>${monthName}</strong>
        <button class="btn icon" id="next" aria-label="Next month">${ICON_NEXT}</button></span>
      </div>
    </div>
    <p class="muted">Weekdays only. Weekends and public holidays have no duty. Each day shows the Primary, then the backups in order. People on leave are left out that day.</p>
    ${before ? `<p class="muted">The rotation starts on ${fmtDay(settings.rota_start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.</p>` : ''}
    ${earlier ? `<button class="btn small earlier" type="button" id="earlier" aria-expanded="${!folded}" aria-controls="days">${folded ? 'Show earlier days' : 'Hide earlier days'}</button>` : ''}
    ${days.length ? `<ol class="days" id="days">${days.map(dayRow).join('')}</ol>` : '<p class="muted">No working days to show this month.</p>'}
  </section>`;
  const other = document.getElementById('share-other');
  if (other) other.onclick = () => navigator.share({ text: state.shareText }).catch(() => {});
  const more = document.getElementById('earlier');
  if (more) more.onclick = () => { state.earlier = !state.earlier; renderView(); restoreFocus('#earlier'); };
  // Changing month keeps focus on the button that was pressed, and folds this month's earlier days again.
  const go = month => { const key = focusKey(document.activeElement); state.month = month; state.earlier = false; renderView(); restoreFocus(key); };
  document.getElementById('prev').onclick = () => go(toISO(new Date(y, m - 2, 1, 12)).slice(0, 7));
  document.getElementById('next').onclick = () => go(toISO(new Date(y, m, 1, 12)).slice(0, 7));
  const back = document.getElementById('this');
  if (back) back.onclick = () => go(today().slice(0, 7));
}

/* ---------- Leave ---------- */
function renderLeave() {
  const { me, profiles, leaves, settings } = state.data;
  const view = document.getElementById('view');
  const t = today();
  const name = id => (profiles.find(p => p.id === id) || {}).display_name || 'Unknown';
  const upcoming = leaves.filter(l => l.end_date >= t);
  const mine = upcoming.filter(l => l.user_id === me.id);
  const leaveItem = l => `<div class="item"><div class="main"><span class="when">${fmtRange(l.start_date, l.end_date)}</span>
      ${l.user_id !== me.id ? ` · <b>${esc(name(l.user_id))}</b>` : ''}${l.note ? `<div class="muted">${esc(l.note)}</div>` : ''}</div>
      ${l.from_invite ? '<span class="tag">From invite</span>' : ''}${l.start_date <= t ? '<span class="tag leave">On leave now</span>' : ''}
      ${l.from_invite ? '<span class="muted invite-hint">Change or cancel the invite in Outlook</span>'
        // Invite leave follows the invite: removing it here would come back on the next sync.
        : l.user_id !== me.id && !me.is_admin ? ''
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
      <button class="btn primary" type="submit" id="l-add">Add leave</button>
    </form>
    <p class="muted" id="l-note-hint">Only you and admins can see the note. Please don’t include medical details. Teammates see only the dates.</p>
  </section>
  ${invitePanel(me, settings)}
  <section class="panel"><h2>Your upcoming leave</h2>
    <div class="list">${mine.map(leaveItem).join('') || '<p class="muted">You have no leave booked.</p>'}</div></section>
  <section class="panel"><h2>Team leave</h2>
    <div class="list">${upcoming.filter(l => l.user_id !== me.id).map(leaveItem).join('') || '<p class="muted">No one else has leave booked.</p>'}</div></section>`;
  document.getElementById('leave-form').onsubmit = e => {
    e.preventDefault();
    const start = document.getElementById('l-start').value, end = document.getElementById('l-end').value;
    if (end < start) { formError(e.target, 'The end date is before the start date.'); toast('The end date is before the start date.', true); return; }
    const who = document.getElementById('l-who');
    act(() => store.addLeave({ user_id: who ? who.value : me.id, start_date: start, end_date: end, note: document.getElementById('l-note').value.trim() || null }), 'Leave added. The roster has been updated.');
  };
  // Someone else's leave is changed only after a question that names them (an admin's one tap is hard to undo).
  const leaveOf = b => leaves.find(l => String(l.id) === (b.dataset.del || b.dataset.end));
  const theirs = b => { const l = leaveOf(b); return l && l.user_id !== me.id ? l : null; };
  const leaveWhen = l => l.start_date === l.end_date ? 'on ' + fmtDay(l.start_date) : 'from ' + fmtDay(l.start_date) + ' to ' + fmtDay(l.end_date);
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const l = theirs(b);
    if (l && !window.confirm('Remove ' + name(l.user_id) + '’s leave ' + leaveWhen(l) + '? They’ll be back on the roster on those days.')) return;
    act(() => store.deleteLeave(Number(b.dataset.del)), 'Leave removed.');
  });
  view.querySelectorAll('[data-end]').forEach(b => b.onclick = () => {
    const l = theirs(b);
    if (l && !window.confirm('End ' + name(l.user_id) + '’s leave early? They’ll be back on the roster from today.')) return;
    const ended = 'Leave ended. ' + (l ? name(l.user_id) + ' is back on the roster from today.' : 'You’re back on the roster from today.');
    act(() => store.updateLeave(Number(b.dataset.end), { end_date: addDays(t, -1) }), ended);
  });
  // The end date can't be before the start (also when a typed start is put back after a redraw).
  const startField = document.getElementById('l-start');
  startField.oninput = startField.onchange = () => { document.getElementById('l-end').min = startField.value || t; };
  const wf = document.getElementById('work-form');
  if (wf) wf.onsubmit = e => {
    e.preventDefault();
    const v = document.getElementById('w-email').value.trim();
    act(() => store.setWorkEmail(me.id, v), v ? 'Work email saved. Invites from it will now add your leave.' : 'Work email removed.');
  };
}

/* ---------- Leave from Outlook invites (supabase/011_leave_invites.sql) ---------- */
function invitePanel(me, settings) {
  const address = settings.invite_address;
  // Members see it once an admin has set it up.
  if (!address && !me.is_admin) return '';
  return `<section class="panel">
    <h2>Leave from Outlook invites</h2>
    ${address ? `<p class="muted">Invite <b class="copyable">${esc(address)}</b> to your all-day out-of-office event in Outlook. Your leave appears here within about 15 minutes, moves if you move the invite, and goes away if you cancel it.</p>`
      : '<p class="muted">Set the invite address in Team & settings to turn this on.</p>'}
    <form class="form" id="work-form">
      <label class="field grow">Your work email (the one you send invites from)<input type="email" id="w-email" maxlength="254" autocomplete="email" value="${esc(me.work_email || '')}" placeholder="${esc(me.email || 'name@company.com')}"></label>
      <button class="btn primary" type="submit" id="w-save">Save</button>
    </form>
    <p class="muted">Only you and admins can see it. Leave it empty if you send invites from the email you sign in with.</p>
  </section>`;
}

/* ---------- Team & settings ---------- */
function renderTeam() {
  const { me, profiles, holidays, settings, unmatched = [] } = state.data;
  const admin = me.is_admin;
  const view = document.getElementById('view');
  const t = today();
  const sorted = profiles.filter(p => p.approved !== false).sort(byRota);
  // New sign-ups wait for approval. People whose access was removed are neither approved nor active: they are listed
  // apart, without a delete button, because deleting someone who was ever on the rotation would rewrite past duties.
  const pending = profiles.filter(p => p.approved === false && p.active !== false);
  const removed = profiles.filter(p => p.approved === false && p.active === false);
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
    <p class="muted">Each working day the next person in this order becomes Primary, and everyone else follows. ${admin ? 'Use the arrows to change the order. Untick Active to leave someone out of the roster. Remove access for someone who has left.' : 'Only admins can change the order.'}</p>
    <div class="list">${sorted.map((p, i) => `<div class="item">
      <span class="order">${i + 1}.</span>
      <div class="main">${admin || p.id === me.id ? `<input class="name-input" data-name="${p.id}" value="${esc(p.display_name)}" maxlength="60" aria-label="Name">` : `<b>${esc(p.display_name)}</b>`}
        ${p.email ? `<div class="muted">${esc(p.email)}</div>` : ''}
        ${admin ? `<input class="name-input work-input" type="email" data-work="${p.id}" value="${esc(p.work_email || '')}" maxlength="254" placeholder="Work Outlook email" aria-label="Work Outlook email for ${esc(p.display_name)}">` : ''}</div>
      ${p.is_admin ? '<span class="tag">Admin</span>' : ''}${!p.active ? '<span class="tag leave">Inactive</span>' : ''}
      ${admin ? `<label class="check"><input type="checkbox" data-active="${p.id}"${p.active ? ' checked' : ''}> Active</label>
        <label class="check"><input type="checkbox" data-admin="${p.id}"${p.is_admin ? ' checked' : ''}${p.id === me.id ? ' disabled title="You can’t remove your own admin access"' : ''}> Admin</label>
        <button class="btn small" data-up="${p.id}" aria-label="Move ${esc(p.display_name)} up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="btn small" data-down="${p.id}" aria-label="Move ${esc(p.display_name)} down"${i === sorted.length - 1 ? ' disabled' : ''}>↓</button>
        ${p.id === me.id ? '' : `<button class="btn small danger" data-revoke="${p.id}" aria-label="Remove access for ${esc(p.display_name)}">Remove access</button>`}` : ''}
    </div>`).join('')}</div>
    <p class="muted">${admin ? 'New people appear under Waiting for approval when they create an account, and join the end of the rotation once approved. The second box under each name is their work Outlook email: leave invites from it are added to their leave.' : 'New people join the end of the rotation once an admin approves them.'} Only admins see everyone’s email.</p>
  </section>
  ${admin && removed.length ? `<section class="panel">
    <h2>Removed</h2>
    <p class="muted">People whose access was removed. They can’t see the roster, and their past duties stay as they were.</p>
    <div class="list">${removed.map(p => `<div class="item"><div class="main"><b>${esc(p.display_name)}</b>${p.email ? `<div class="muted">${esc(p.email)}</div>` : ''}</div>
      <button class="btn small" data-restore="${p.id}" aria-label="Give access again to ${esc(p.display_name)}">Give access again</button></div>`).join('')}</div>
  </section>` : ''}
  <section class="panel">
    <h2>Rotation start</h2>
    <p class="muted">The rotation counts working days from this date. The first working day on or after it starts with person 1.</p>
    ${admin ? `<form class="form" id="start-form"><label class="field">Start date<input type="date" id="s-start" required value="${settings.rota_start}"></label><button class="btn primary" type="submit" id="s-save">Save</button></form>`
      : `<p><b>${fmtDay(settings.rota_start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</b></p>`}
  </section>
  <section class="panel">
    <h2>Public calendar</h2>
    <p class="muted">A read-only month calendar that anyone with the link can open without an account. It shows each working day’s duty list (names and roles) from about 3 months ago to 6 months ahead. It doesn’t share emails, leave dates or notes, though someone missing from a day’s list may be away.</p>
    <p class="url"><a href="calendar.html">${esc(new URL('calendar.html', location.href).href)}</a></p>
    ${admin ? `<label class="check"><input type="checkbox" id="pub-cal"${settings.public_calendar !== false ? ' checked' : ''}> Anyone with the link can view the calendar</label>`
      : `<p>${settings.public_calendar !== false ? 'The public calendar is on.' : 'The public calendar is off.'}</p>`}
  </section>
  ${admin ? `<section class="panel">
    <h2>Leave from calendar invites</h2>
    <p class="muted">The shared Google account people invite to their out-of-office events. Its Apps Script (<code>scripts/leave-invites.gs</code>) turns the invites into leave every 15 minutes.</p>
    <form class="form" id="inv-form"><label class="field grow">Invite address<input type="email" id="inv-address" maxlength="254" value="${esc(settings.invite_address || '')}" placeholder="ourteam.leave@gmail.com"></label><button class="btn primary" type="submit" id="inv-save">Save</button></form>
    <h3>Invites from unknown senders</h3>
    <p class="muted">These came from addresses that don’t match anyone. Assign one to a person to save it as their work email; their leave is added on the next sync.</p>
    <div class="list">${unmatched.map(u => `<div class="item"><div class="main"><b>${esc(u.organizer)}</b>
        <div class="muted">${esc(u.title || 'Invite')} · ${fmtRange(u.start_date, u.end_date)}</div></div>
      <select class="assign" data-assign="${esc(u.uid)}" data-from="${esc(u.organizer)}" aria-label="Assign ${esc(u.organizer)} to"><option value="">Assign to…</option>${profiles.filter(onRota).map(p => `<option value="${p.id}">${esc(p.display_name)}</option>`).join('')}</select>
      <button class="btn small" data-dismiss="${esc(u.uid)}">Dismiss</button></div>`).join('') || '<p class="muted">None.</p>'}</div>
  </section>` : ''}
  <section class="panel">
    <h2>Public holidays</h2>
    <p class="muted">No duty on these days. Singapore holidays for 2026 and 2027 are included${admin ? '. Add later years when they’re announced.' : '.'}</p>
    ${admin ? `<form class="form" id="hol-form"><label class="field">Date<input type="date" id="h-date" required></label><label class="field grow">Name<input id="h-name" required maxlength="60" placeholder="e.g. Polling Day"></label><button class="btn primary" type="submit" id="h-add">Add holiday</button></form>` : ''}
    <div class="list">${upcomingHol.map(h => `<div class="item"><span class="when">${fmtDay(h.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span><div class="main">${esc(h.name)}</div>${admin ? `<button class="btn small danger" data-hdel="${h.date}">Remove</button>` : ''}</div>`).join('') || '<p class="muted">No holidays listed.</p>'}</div>
  </section>`;

  // Admins set anyone's work Outlook email; invites from it become that person's leave.
  view.querySelectorAll('[data-work]').forEach(inp => inp.onchange = () => {
    const who = profiles.find(p => p.id === inp.dataset.work), v = inp.value.trim();
    act(() => store.setWorkEmail(inp.dataset.work, v), v ? 'Work email saved for ' + who.display_name + '.' : 'Work email removed for ' + who.display_name + '.');
  });
  view.querySelectorAll('[data-name]').forEach(inp => inp.onchange = () => {
    const v = inp.value.trim();
    if (!v) { formError(inp, 'Name can’t be empty.'); toast('Name can’t be empty.', true); return; }
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
  // Someone who has left: no more access, and out of the rotation from today, the way unticking Active works (earlier
  // days keep their duties). Admin access goes too, as the database's admin rules don't look at approval.
  view.querySelectorAll('[data-revoke]').forEach(b => b.onclick = () => {
    const who = profiles.find(p => p.id === b.dataset.revoke);
    if (!who || !window.confirm('Remove ' + who.display_name + '’s access? They won’t see the roster or anyone’s leave, and they’re left out of the roster from today. Their past duties stay.')) return;
    act(async () => {
      await store.updateProfile(who.id, { approved: false, active: false, is_admin: false });
      await recordRotaChange();
    }, who.display_name + '’s access was removed.');
  });
  // Back in the team, but not on the roster until Active is ticked (they join the end of the order).
  view.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => {
    const who = profiles.find(p => p.id === b.dataset.restore);
    act(() => store.updateProfile(who.id, { approved: true, rota_order: nextOrder }), who.display_name + ' can see the roster again. Tick Active to put them back on it.');
  });
  // Admin access lets someone change everyone's leave and the team, so the tick asks first.
  view.querySelectorAll('[data-admin]').forEach(c => c.onchange = () => {
    const who = profiles.find(p => p.id === c.dataset.admin);
    const question = c.checked ? 'Make ' + who.display_name + ' an admin? They’ll be able to change the team, everyone’s leave and the settings.'
      : 'Remove ' + who.display_name + '’s admin access? They’ll still see the roster and add their own leave.';
    if (!window.confirm(question)) { c.checked = !c.checked; return; }
    act(() => store.updateProfile(c.dataset.admin, { is_admin: c.checked }), c.checked ? who.display_name + ' is now an admin.' : who.display_name + ' is no longer an admin.');
  });
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
  const invf = document.getElementById('inv-form');
  if (invf) invf.onsubmit = e => {
    e.preventDefault();
    const v = document.getElementById('inv-address').value.trim().toLowerCase() || null;
    act(() => store.updateSettings({ invite_address: v }), v ? 'Invite address saved.' : 'Invite address removed.');
  };
  view.querySelectorAll('[data-assign]').forEach(sel => sel.onchange = () => {
    const who = profiles.find(p => p.id === sel.value);
    if (!who || !window.confirm('Save ' + sel.dataset.from + ' as ' + who.display_name + '’s work email? Their invites from it will become their leave.')) { sel.value = ''; return; }
    act(() => store.setWorkEmail(who.id, sel.dataset.from), 'Assigned. ' + who.display_name + '’s leave is added on the next sync.');
  });
  view.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => act(() => store.dismissInvite(b.dataset.dismiss), 'Dismissed.'));
  const pc = document.getElementById('pub-cal');
  if (pc) pc.onchange = () => act(() => store.updateSettings({ public_calendar: pc.checked }), pc.checked ? 'Public calendar switched on.' : 'Public calendar switched off.');
  const hf = document.getElementById('hol-form');
  if (hf) hf.onsubmit = e => { e.preventDefault(); act(() => store.addHoliday(document.getElementById('h-date').value, document.getElementById('h-name').value.trim()), 'Holiday added.'); };
  view.querySelectorAll('[data-hdel]').forEach(b => b.onclick = () => act(() => store.deleteHoliday(b.dataset.hdel), 'Holiday removed.'));
}
