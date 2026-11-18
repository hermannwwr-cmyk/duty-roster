import { buildSchedule, rotaChange, pastEdit, shouldHeal, byRota, rotaParams, rotaOrder, toISO, fromISO, addDays, todaySG, onRota, rosterMessage, whatsappLink, WHATSAPP_ICON, shortName, officeHours, msUntilOfficeChange } from './schedule.js';
import { createStore } from './connect.js';
import { faceSvg } from './faces.js';
import { keepFresh } from './live.js';
import { swipeTabs, typingIn } from './swipe.js';

const root = document.getElementById('root');
let store;
try { store = await createStore(); }
catch (e) {
  root.innerHTML = '<div class="auth"><div class="panel"><h2>Can’t load the app</h2><p class="muted">Part of the app couldn’t be downloaded. Check your internet connection, then <button class="btn small" type="button" id="reload">Reload the page</button>.</p></div></div>';
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
/** Shows a short message and announces it to screen readers through the always-present #announce region. */
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
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
  const time = new Date(ms).toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit' }).replace(/\s+(?=[ap]m)/i, '\u00a0');
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
// Forms whose change has just been saved: what is in them is on its way into the redraw, so it isn't unsaved input.
const saved = new Set();
const typedFields = () => [...root.querySelectorAll('#view input, #view select, #view textarea')].filter(f => edited(f) && !(f.form && saved.has(focusKey(f.form))));
const unsavedInput = () => typedFields().length > 0;

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
  const field = !form && typingIn(el) ? el : null;   // a text box saved on its own (a name, a work email)
  const job = { key: focusKey(el), form: form && focusKey(form), field: !!field, values: form ? valuesOf(form.elements) : field ? valuesOf([field]) : null, locked: new Set() };
  const focus = focusKey(active);
  formError(form || field, '');
  saving.add(job); lock(job);
  let error = null;
  try {
    await fn();
    // Saved: the redraw starts the form afresh (a lone field shows what was saved).
    if (job.form) saved.add(job.form); else if (field) field.defaultValue = field.value;
    if (done) toast(done);
  } catch (e) { error = offline(e) ? 'Not saved. Check your internet connection and try again.' : plain(e); }
  saving.delete(job);
  await refresh();
  await drawing;   // a newer refresh, started meanwhile, draws last
  unlock(job);
  // Saved, but the page couldn't be redrawn (the connection dropped): clear the form anyway, so it isn't sent twice.
  if (job.form && saved.delete(job.form) && state.offline) { const f = root.querySelector(job.form); if (f) f.reset(); }
  if (error) {
    // Not saved, and not reloaded either: draw again from what was last loaded, so ticks and lists show what is
    // really saved. Then put back what was typed, and give the reason once: next to the form or box, or as a toast.
    if (state.offline && state.data && root.querySelector('#view')) redraw();
    if (job.values) putBack(job.values);
    if (!formError(errorTarget(job), error)) toast(error);
  }
  // Focus goes back to where it was only if nothing has it now: someone may have moved on while it saved.
  if (!root.contains(document.activeElement)) restoreFocus(focus);
}

/* ---------- Rotation history (GitHub issue #7) ---------- */
// byRota, rotaParams and rotaOrder are in schedule.js, with the rules that use them.
// Writes to the rotation's history take turns, each on freshly loaded data, so two of them (an admin's change and
// the self-heal below, say) can't save checkpoints from the same stale picture.
let rotaTurn = Promise.resolve();
function inTurn(fn) { const run = rotaTurn.then(fn, fn); rotaTurn = run.catch(() => {}); return run; }
/** After a change to who is on the rotation or their order, save it from today: earlier days keep their duties,
 *  today's Primary stays Primary, and from 6pm so does the next working day's (rotaChange in schedule.js). */
function recordRotaChange() {
  return inTurn(async () => {
    const d = await store.load();
    for (const cp of rotaChange(rotaParams(d), today(), rotaOrder(d), { afterHours: officeHours() === 'after' })) await store.saveCheckpoint(cp);
  });
}
/* Self-heal: if an approval or deactivation was saved but its checkpoint wasn't (a dropped connection), or on a
   fresh install whose first admin isn't in the rotation yet, the rotation and the team disagree. After a complete
   load, an admin's page saves the missing change (shouldHeal in schedule.js decides), then redraws. A failed try
   is tried again on a later load, at most five tries a day; one that worked is never repeated for the same data. */
let healed = new Set(), healTries = 0, healDay = '', healing = false;
async function healRotation(d) {
  const t = today();
  if (t !== healDay) { healed = new Set(); healTries = 0; healDay = t; }
  let key;
  try {
    if (healing || healTries >= 5 || !shouldHeal(d, t, { afterHours: officeHours() === 'after' })) return;
    key = JSON.stringify([rotaOrder(d), d.checkpoints]);
    if (healed.has(key)) return;
  } catch (e) { return; }
  healing = true; healTries++;
  try { await recordRotaChange(); healed.add(key); }
  catch (e) { return; }
  finally { healing = false; }
  refresh({ background: true });   // reload holds the draw while someone types
}

/* ---------- Corrections to past days (admins) ---------- */
// Leave or a holiday changed on days before today would move every later day's duties, today's Primary included,
// after the team has been told. So the admin is told what changes and asked first, and a checkpoint saved on the day
// after the changed days keeps every later day as it was (pastEdit in schedule.js). Each correction is
// { first, last, ask, apply(data), write() }: the dates it touches, the question, and the change as made to a
// copy of the loaded data (to work out its effect) and to the store.
function pastEffect(d, c) {
  const after = JSON.parse(JSON.stringify(d));
  c.apply(after);
  return pastEdit(rotaParams(d), rotaParams(after), c.first, c.last, today());
}
const firstName = name => shortName(name, state.data.profiles.map(p => p.display_name));
const primaryOn = d => d && d.kind === 'work' && d.duties[0] ? d.duties[0].member : null;
/** "Today’s Primary stays Ben." and the like, for the questions below: the Primary on `day` before and after. */
function primaryLine(day, was, now) {
  if (!day) return '';
  const whose = day === today() ? 'Today’s Primary' : 'The Primary on ' + fmtDay(day);
  if (was && now) return whose + (was.id === now.id ? ' stays ' + firstName(was.name) : ' changes from ' + firstName(was.name) + ' to ' + firstName(now.name)) + '.';
  if (now) return whose + ' will be ' + firstName(now.name) + '.';
  if (was) return 'No one will be on duty ' + (day === today() ? 'today' : 'on ' + fmtDay(day)) + '.';
  return '';
}
function pastNote(e, c) {
  const ch = e.changed;
  const days = ch.length === 1 ? 'on ' + fmtDay(ch[0]) : ch.length === 2 ? 'on ' + fmtDay(ch[0]) + ' and ' + fmtDay(ch[1])
    : 'from ' + fmtDay(ch[0]) + ' to ' + fmtDay(ch[ch.length - 1]);
  return [c.ask, c.last < today() ? 'This changes duties ' + days + ' only.' : 'This changes past duties ' + days + '.', primaryLine(e.day, e.was, e.now)]
    .filter(Boolean).join(' ');
}
/** Like act(), for a change to leave or holidays: one that reaches back before today asks first and keeps later days. */
function actPast(c, done) {
  const past = state.data.me.is_admin && /^\d{4}-\d\d-\d\d$/.test(c.first) && /^\d{4}-\d\d-\d\d$/.test(c.last) && c.first < today();
  if (past) {
    const e = pastEffect(state.data, c);
    if (e.changed.length && !window.confirm(pastNote(e, c))) return;
  }
  return act(() => !past ? c.write() : inTurn(async () => {
    for (const cp of pastEffect(await store.load(), c).checkpoints) await store.saveCheckpoint(cp);
    await c.write();
  }), done);
}
const personName = id => (state.data.profiles.find(p => p.id === id) || {}).display_name || 'them';
const pastLeave = {
  add: row => ({ first: row.start_date, last: row.end_date, ask: row.user_id === state.data.me.id ? 'Add your leave?' : 'Add leave for ' + firstName(personName(row.user_id)) + '?',
    apply: d => { d.leaves.push({ ...row, id: -1 }); }, write: () => store.addLeave(row) })
};   // (Remove is offered only for leave that hasn't begun, so removing leave never touches past days.)
const pastHoliday = {
  add: (date, name) => ({ first: date, last: date, ask: 'Add ' + (name || 'this holiday') + '?',
    apply: d => { d.holidays = d.holidays.filter(h => h.date !== date).concat({ date, name }); }, write: () => store.addHoliday(date, name) }),
  remove: date => ({ first: date, last: date, ask: 'Remove ' + ((state.data.holidays.find(h => h.date === date) || {}).name || 'this holiday') + '?',
    apply: d => { d.holidays = d.holidays.filter(h => h.date !== date); }, write: () => store.deleteHoliday(date) })
};
/** The question before restarting the rotation on `start` with `order` (resetRotation in store.js). */
function restartNote(start, order) {
  const t = today();
  const when = fmtDay(start, start.slice(0, 4) === t.slice(0, 4) ? null : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (start > t) return 'Restart the rotation on ' + when + '? No one will be on duty until then, and earlier days will no longer show who was on duty.'
    + (order.length ? ' ' + firstName(personName(order[0])) + ' will be Primary first.' : '');
  // From a past date the days since are worked out again: say what happens to today's Primary (or the next working day's).
  const next = scheduleFor(t, addDays(t, 31)).find(d => d.kind === 'work');
  const after = next && buildSchedule({ ...rotaParams(state.data), checkpoints: [{ effective_date: start, member_order: order, next_primary: order[0] || null }], from: next.date, to: next.date })[0];
  return ['Restart the rotation from ' + when + '? Days before it are cleared, and duties from then on are worked out again.', next && primaryLine(next.date, primaryOn(next), primaryOn(after))]
    .filter(Boolean).join(' ');
}

function scheduleFor(from, to) {
  return buildSchedule({ ...rotaParams(state.data), from, to });
}

/* ---------- Boot ---------- */
// Only the latest refresh draws, so a slow load can't draw the roster over the sign-in screen after signing out.
// `drawing` is the latest one, for anyone who needs to wait until the screen is up to date.
// A background refresh (switching to a tab whose data is old, coming back online, the 5-minute one) doesn't redraw
// under someone typing: that would close a phone's keyboard. It keeps the new data (`pendingDraw`), and draws it as
// soon as they stop (drawWhenIdle, below), or at the next save or tab switch.
let refreshes = 0, drawing = Promise.resolve(), pendingDraw = false;
const refresh = opts => (drawing = reload(opts));
async function reload({ background = false } = {}) {
  const run = ++refreshes;
  try {
    const uid = await store.userId();
    if (run !== refreshes) return;
    // Signed out: the next person to sign in starts on the Roster at this month.
    if (!uid) { Object.assign(state, { data: null, offline: false, tab: 'roster', month: today().slice(0, 7), earlier: false }); renderAuth(); return; }
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
    // Held while someone types (drawn when they stop, drawWhenIdle), but a new day is drawn at once: the buttons carry its dates.
    if (background && view && typing() && view.dataset.user === userKey(me) && view.dataset.day === today()) pendingDraw = true;
    else if (view && view.dataset.user === userKey(me)) redraw();
    else renderApp();
    showOffline(null);
    healRotation(data);
  } catch (e) {
    if (run !== refreshes) return;
    state.offline = true;
    // After a good load, a failed refresh keeps what is on screen, with a note; only a first load that fails takes the screen.
    if (state.data && root.querySelector('#view')) showOffline(e);
    else cantLoad(e);
  }
}
store.onAuthChange(() => refresh());
refresh();

/** Draws the current tab again from the data in hand, keeping what was typed and the focused text box, with its caret. */
function redraw() {
  const typed = valuesOf(typedFields());
  const was = document.activeElement, key = root.querySelector('#view')?.contains(was) ? focusKey(was) : null;
  let caret = null;
  try { if (typingIn(was) && was.selectionStart != null) caret = [was.selectionStart, was.selectionEnd]; } catch (e) { /* not a text box */ }
  renderView();
  putBack(typed);
  if (!key) return;
  const now = root.querySelector(key);
  if (now && now.disabled) return;   // still saving: act() puts focus back when it is done
  restoreFocus(key);
  try { if (caret && document.activeElement === now) now.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text box */ }
}

/** Signs out, and shows the sign-in screen even when the sign-out request couldn't reach the server. */
async function signOut() {
  try { await store.signOut(); } catch (e) { /* the session is forgotten on this device all the same */ }
  refresh();
}

/** The screens for an account that can't see the roster yet: waiting for approval, or removed. */
function accountScreen(title, text, still) {
  root.innerHTML = `<div class="auth"><div class="panel"><h2>${title}</h2><p class="muted">${text}</p>
    <div class="form">${still ? '<button class="btn" type="button" id="check">Check again</button>' : ''}<button class="btn" type="button" id="out">Sign out</button></div></div></div>`;
  document.getElementById('out').onclick = signOut;
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
  document.getElementById('out').onclick = signOut;
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
  bar.innerHTML = `<p class="wrap"><span class="offline-text">${esc(text)}</span> <button class="btn link" type="button" id="retry">Try again</button></p>`;
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
window.addEventListener('online', () => { if (state.offline) refresh({ background: true }); });

/* ---------- Staying up to date ---------- */
// Background refreshes and swipes wait while there is typed input that isn't saved (a text field whose value differs
// from what was drawn), or while someone is in a text field. A focused tick or list doesn't hold them up.
const typing = () => unsavedInput() || typingIn(document.activeElement);
// Data that came in while someone was typing is drawn once they stop: when focus leaves the box, but never between the
// press and the release of a tap (redrawing then would swallow the tap), so after the click has gone through.
let pressing = false, idleTimer;
function drawWhenIdle(wait = 0) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (pendingDraw && !pressing && state.data && root.querySelector('#view') && !typing()) redraw(); }, wait);
}
root.addEventListener('focusout', () => drawWhenIdle());
document.addEventListener('pointerdown', () => { pressing = true; }, true);
for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => { pressing = false; if (pendingDraw) drawWhenIdle(400); }, true);
document.addEventListener('click', () => { if (pendingDraw) drawWhenIdle(); }, true);   // runs after the click's own handlers
let lastDay = today();
// Swipe left or right on a phone to change tab.
swipeTabs(() => document.getElementById('view'), typing);

// Switch the "Your role" card over on time at 9am and 6pm. A background refresh never redraws under someone typing
// (reload holds the draw until they stop), so it doesn't wait for them: a half-typed note left overnight can't freeze the page.
const atOfficeChange = () => setTimeout(() => { if (state.data) refresh({ background: true }); atOfficeChange(); }, msUntilOfficeChange() + 2000);
atOfficeChange();

keepFresh(async () => {
  // Follow the calendar into a new month if the page was showing the month that just ended.
  const t = today();
  if (t !== lastDay && state.month === lastDay.slice(0, 7)) state.month = t.slice(0, 7);
  lastDay = t;
  await refresh({ background: true });   // redraw() keeps focus where it was
}, () => state.data !== null);

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
  document.getElementById('signout').onclick = signOut;
  document.getElementById('acct-btn').onclick = () => toggleAccount();
  const reset = document.getElementById('reset-demo');
  if (reset) reset.onclick = () => store.reset();
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    state.tab = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(x => { if (x === b) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
    renderView();
    // Data more than a minute old is fetched again; the tab shows what was loaded meanwhile.
    if (Date.now() - state.loadedAt > STALE) refresh({ background: true });
  });
  renderView();
}
const STALE = 60 * 1000;
function userKey(me) { return me.id + '|' + me.display_name + '|' + me.is_admin; }
/** Redraws only the current section. Headings can take focus, as the fallback when a focused control disappears. */
function renderView() {
  pendingDraw = false;   // whatever came in while someone typed is on screen now
  const view = document.getElementById('view');
  if (view) view.dataset.day = today();   // the day this view's buttons were drawn for (see reload)
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
  // This month opens at this week: from this week's Monday (next Monday at the weekend) to at least next week's Friday,
  // running on into the next month, or starting in the last one, if need be. The month's earlier days wait behind
  // "Show earlier days". Other months show in full.
  const thisMonth = state.month === t.slice(0, 7), dow = fromISO(t).getDay();
  const weekStart = thisMonth ? addDays(t, dow === 6 ? 2 : dow === 0 ? 1 : 1 - dow) : first;
  const until = thisMonth && addDays(weekStart, 11) > last ? addDays(weekStart, 11) : last;
  const days = scheduleFor(weekStart < first ? weekStart : first, until).filter(d => d.kind === 'work' || d.kind === 'holiday');
  const before = first < settings.rota_start;
  const monthName = fromISO(first).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
  const earlier = days.filter(d => d.date < weekStart).length;
  const folded = earlier > 0 && !state.earlier;
  // Days from another month come under that month's name.
  let listMonth = state.month;
  const withMonths = d => { const mo = d.date.slice(0, 7), head = mo === listMonth ? '' : `<li class="month-break">${fromISO(d.date).toLocaleDateString('en-SG', { month: 'long' })}</li>`; listMonth = mo; return head + dayRow(d); };

  // One row per working day: the date, the Primary, then the backups in order, with your own role on the right.
  // Your own name is white and bold (not underlined, not cyan: cyan means only the Primary and today).
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
      ${p ? `<span class="lead">${avatar(p.member.name, 'sm')}<span class="nm${p.member.id === me.id ? ' me' : ''}"><span class="sr-only">Primary: </span>${esc(p.member.name)}${p.member.id === me.id ? '<span class="sr-only"> (you)</span>' : ''}</span></span>` : '<span class="nobody">No one available</span>'}
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
    ${days.length ? `<ol class="days" id="days">${days.map(withMonths).join('')}</ol>` : '<p class="muted">No working days to show this month.</p>'}
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
  // Questions and messages use first names (the full name when two people share one).
  const first = id => firstName(name(id));
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
    if (end < start) { formError(e.target, 'The end date is before the start date.'); return; }
    const who = document.getElementById('l-who');
    actPast(pastLeave.add({ user_id: who ? who.value : me.id, start_date: start, end_date: end, note: document.getElementById('l-note').value.trim() || null }), 'Leave added. The roster has been updated.');
  };
  // Someone else's leave is changed only after a question that names them (an admin's one tap is hard to undo).
  const leaveOf = b => leaves.find(l => String(l.id) === (b.dataset.del || b.dataset.end));
  const theirs = b => { const l = leaveOf(b); return l && l.user_id !== me.id ? l : null; };
  const leaveWhen = l => l.start_date === l.end_date ? 'on ' + fmtDay(l.start_date) : 'from ' + fmtDay(l.start_date) + ' to ' + fmtDay(l.end_date);
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const l = theirs(b);
    if (l && !window.confirm('Remove ' + first(l.user_id) + '’s leave ' + leaveWhen(l) + '? They’ll be back on the roster ' + (l.start_date === l.end_date ? 'that day.' : 'on those days.'))) return;
    act(() => store.deleteLeave(Number(b.dataset.del)), 'Leave removed.');
  });
  view.querySelectorAll('[data-end]').forEach(b => b.onclick = () => {
    const l = theirs(b);
    if (l && !window.confirm('End ' + first(l.user_id) + '’s leave early? They’ll be back on the roster from today.')) return;
    const ended = 'Leave ended. ' + (l ? first(l.user_id) + ' is back on the roster from today.' : 'You’re back on the roster from today.');
    act(() => store.updateLeave(Number(b.dataset.end), { end_date: addDays(today(), -1) }), ended);   // today, not the drawn day
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
  // Questions and messages use first names (the full name when two people share one).
  const first = firstName;
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
        ${admin ? `<input class="name-input work-input" type="email" data-work="${p.id}" value="${esc(p.work_email || '')}" maxlength="254" placeholder="Work Outlook email" aria-label="Work Outlook email for ${esc(p.display_name)}">` : ''}
        ${admin && p.id !== me.id ? `<button class="btn quiet" type="button" data-revoke="${p.id}" aria-label="Remove access for ${esc(p.display_name)}">Remove access</button>` : ''}</div>
      ${p.is_admin ? '<span class="tag">Admin</span>' : ''}${!p.active ? '<span class="tag leave">Inactive</span>' : ''}
      ${admin ? `<label class="check"><input type="checkbox" data-active="${p.id}"${p.active ? ' checked' : ''}> Active</label>
        <label class="check"><input type="checkbox" data-admin="${p.id}"${p.is_admin ? ' checked' : ''}${p.id === me.id ? ' disabled title="You can’t remove your own admin access"' : ''}> Admin</label>
        <button class="btn small" data-up="${p.id}" aria-label="Move ${esc(p.display_name)} up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="btn small" data-down="${p.id}" aria-label="Move ${esc(p.display_name)} down"${i === sorted.length - 1 ? ' disabled' : ''}>↓</button>` : ''}
    </div>`).join('')}</div>
    <p class="muted">${admin ? 'New people appear under Waiting for approval when they create an account, and join the end of the rotation once approved. The second box under each name is their work Outlook email: leave invites from it are added to their leave.' : 'New people join the end of the rotation once an admin approves them.'} Only admins see everyone’s email.</p>
  </section>
  ${admin && removed.length ? `<section class="panel">
    <h2>Removed</h2>
    <p class="muted">People whose access was removed. They can’t see the roster, and their past duties stay as they were. Giving access again doesn’t make them active or an admin: tick those again if they need them.</p>
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
    act(() => store.setWorkEmail(inp.dataset.work, v), v ? 'Work email saved for ' + first(who.display_name) + '.' : 'Work email removed for ' + first(who.display_name) + '.');
  });
  view.querySelectorAll('[data-name]').forEach(inp => inp.onchange = () => {
    const v = inp.value.trim();
    if (!v) { formError(inp, 'Name can’t be empty.'); return; }
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
    if (!window.confirm('Remove ' + first(b.dataset.who) + '? Their profile is deleted and they won’t see the roster.')) return;
    act(() => store.deleteProfile(b.dataset.remove), 'Removed.');
  });
  view.querySelectorAll('[data-active]').forEach(c => c.onchange = () => act(async () => {
    await store.updateProfile(c.dataset.active, { active: c.checked });
    await recordRotaChange();
  }, c.checked ? 'Back on the roster from today.' : 'Left out of the roster from today.'));
  // Someone who has left: no more access, and out of the rotation from today, the way unticking Active works (earlier
  // days keep their duties). Admin access goes too, as the database's admin rules don't look at approval.
  view.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => {
    const who = profiles.find(p => p.id === b.dataset.revoke);
    if (!who || !window.confirm('Remove ' + first(who.display_name) + '’s access? They won’t see the roster or anyone’s leave, and they’re left out of the roster from today.'
      + (who.is_admin ? ' Their admin access goes too.' : '') + ' Their past duties stay.')) return;
    await act(async () => {
      await store.updateProfile(who.id, { approved: false, active: false, is_admin: false });
      await recordRotaChange();
    }, first(who.display_name) + '’s access was removed.');
    // Focus follows them to the Removed list, where "Give access again" undoes it.
    const again = root.querySelector('[data-restore="' + CSS.escape(who.id) + '"]');
    if (again) again.focus();
  });
  // Back in the team, but not on the roster until Active is ticked (they join the end of the order).
  view.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => {
    const who = profiles.find(p => p.id === b.dataset.restore);
    act(() => store.updateProfile(who.id, { approved: true, rota_order: nextOrder }), first(who.display_name) + ' can see the roster again. Tick Active to put them back on it.');
  });
  // Admin access lets someone change everyone's leave and the team, so the tick asks first.
  view.querySelectorAll('[data-admin]').forEach(c => c.onchange = () => {
    const who = profiles.find(p => p.id === c.dataset.admin);
    const question = c.checked ? 'Make ' + first(who.display_name) + ' an admin? They’ll be able to change the team, everyone’s leave and the settings.'
      : 'Remove ' + first(who.display_name) + '’s admin access? They’ll still see the roster and add their own leave.';
    if (!window.confirm(question)) { c.checked = !c.checked; return; }
    act(() => store.updateProfile(c.dataset.admin, { is_admin: c.checked }), c.checked ? first(who.display_name) + ' is now an admin.' : first(who.display_name) + ' is no longer an admin.');
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
    const order = sorted.filter(onRota).map(p => p.id);
    if (!window.confirm(restartNote(start, order))) return;
    act(() => store.resetRotation(start, order), 'Rotation restarted.');
  };
  const invf = document.getElementById('inv-form');
  if (invf) invf.onsubmit = e => {
    e.preventDefault();
    const v = document.getElementById('inv-address').value.trim().toLowerCase() || null;
    act(() => store.updateSettings({ invite_address: v }), v ? 'Invite address saved.' : 'Invite address removed.');
  };
  view.querySelectorAll('[data-assign]').forEach(sel => sel.onchange = () => {
    const who = profiles.find(p => p.id === sel.value);
    if (!who || !window.confirm('Save ' + sel.dataset.from + ' as ' + first(who.display_name) + '’s work email? Their invites from it will become their leave.')) { sel.value = ''; return; }
    act(() => store.setWorkEmail(who.id, sel.dataset.from), 'Assigned. ' + first(who.display_name) + '’s leave is added on the next sync.');
  });
  view.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => act(() => store.dismissInvite(b.dataset.dismiss), 'Dismissed.'));
  const pc = document.getElementById('pub-cal');
  if (pc) pc.onchange = () => act(() => store.updateSettings({ public_calendar: pc.checked }), pc.checked ? 'Public calendar switched on.' : 'Public calendar switched off.');
  const hf = document.getElementById('hol-form');
  if (hf) hf.onsubmit = e => { e.preventDefault(); actPast(pastHoliday.add(document.getElementById('h-date').value, document.getElementById('h-name').value.trim()), 'Holiday added.'); };
  view.querySelectorAll('[data-hdel]').forEach(b => b.onclick = () => actPast(pastHoliday.remove(b.dataset.hdel), 'Holiday removed.'));
}
