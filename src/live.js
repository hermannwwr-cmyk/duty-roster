// Keeps an open page up to date: fresh data when you come back to it, every few minutes while it's
// open, and just after midnight Singapore time; and, after an update is published, the new version, loaded by
// itself at a safe moment (hidden, or nobody using it, and nothing half-done).

const EVERY = 5 * 60 * 1000;   // refresh this often while the page is open and visible
const MIN_GAP = 30 * 1000;     // coming back to the page refreshes only if the last refresh was longer ago
const STALLED = 25 * 1000;     // a refresh that hasn't finished by then no longer holds up the next one (a stalled connection)

/** Milliseconds from `now` until the next midnight in Singapore (UTC+8, no daylight saving). */
export function msUntilSgMidnight(now = Date.now()) {
  const day = 24 * 60 * 60 * 1000, offset = 8 * 60 * 60 * 1000;
  return day - ((now + offset) % day);
}

/**
 * Calls `refresh` when the page becomes visible again, every 5 minutes while it is visible, and just
 * after midnight in Singapore. `canRefresh()` can say no (for example while someone is typing); the
 * refresh then waits for the next chance. One refresh runs at a time, but one that hasn't finished
 * within 25 seconds (a stalled connection) is given up on, so the next one can run.
 */
export function keepFresh(refresh, canRefresh = () => true, safeToReload = () => true) {
  safe = safeToReload;
  let last = Date.now(), running = false;
  const run = async force => {
    if (running || document.hidden || !canRefresh()) return;
    if (!force && Date.now() - last < MIN_GAP) return;
    running = true;
    let timer;
    const stalled = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('No answer')), STALLED); });
    try { await Promise.race([refresh(), stalled]); last = Date.now(); } catch (e) { /* try again next time */ } finally { clearTimeout(timer); running = false; }
    checkForUpdate();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(false); });
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchmove']) addEventListener(type, () => { lastUse = Date.now(); }, { capture: true, passive: true });
  setInterval(() => run(true), EVERY);
  const atMidnight = () => setTimeout(() => { run(true); atMidnight(); }, msUntilSgMidnight() + 5000);
  atMidnight();
}

/* ---------- A new version ---------- */

const IDLE = 15 * 1000;            // "nobody using it": no tap, key or scroll for this long
const FALLBACK = 3 * 60 * 1000;    // still no safe moment after this long on screen: offer the old Reload bar
const TRIED = 'reloadedFor';       // sessionStorage: the version a reload was for, so a stale copy can't loop
const versionOf = html => (String(html).match(/\?v=(\d{12})/) || [])[1] || null;
let safe = () => true, lastUse = 0, latest = null, waitingSince = 0, poll = null, barShown = false;

const tried = () => { try { return sessionStorage.getItem(TRIED); } catch (e) { return null; } };
/** Reloads now if it's a safe moment: the page is hidden, or nobody has used it for a while; and nothing is half-done. */
export function reloadWhenSafe() {
  if (!latest || !safe()) return false;
  if (!document.hidden && Date.now() - lastUse < IDLE) return false;
  try { sessionStorage.setItem(TRIED, latest); } catch (e) {}
  location.reload();
  return true;
}
function waitForSafeMoment() {
  if (poll) return;
  waitingSince = Date.now();
  document.addEventListener('visibilitychange', () => { reloadWhenSafe(); });
  poll = setInterval(() => {
    if (reloadWhenSafe()) return;
    // Someone has kept using the page the whole time: let them choose, with the bar.
    if (!document.hidden && Date.now() - waitingSince > FALLBACK) showBar();
  }, 5000);
  reloadWhenSafe();
}
function showBar() {
  if (barShown) return;
  barShown = true;
  const bar = document.createElement('div');
  bar.className = 'update-bar'; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>A new version of the app is available.</span><button class="btn small primary" type="button">Reload</button>';
  bar.querySelector('button').onclick = () => location.reload();
  document.body.append(bar);
}

/**
 * Compares this page's version stamp (npm run stamp) with the published page's. When they differ, the page
 * reloads by itself at the first safe moment (see reloadWhenSafe), so nothing typed or being saved is lost.
 * If a reload for that version already happened and the page is still old (a stale cached copy), it offers
 * the Reload bar instead of reloading again.
 */
export async function checkForUpdate() {
  const running = versionOf(document.querySelector('script[type="module"][src*="?v="]')?.getAttribute('src'));
  if (latest || !running) return;
  let found;
  try {
    const res = await fetch(location.pathname, { cache: 'no-store' });
    found = versionOf(await res.text());
  } catch (e) { return; }
  if (!found || found === running) return;
  latest = found;
  if (tried() === found) { showBar(); return; }
  waitForSafeMoment();
}
