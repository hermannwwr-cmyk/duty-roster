// Keeps an open page up to date: fresh data when you come back to it, every few minutes while it's
// open, and just after midnight Singapore time; and a "new version" notice after an update is published.

const EVERY = 5 * 60 * 1000;   // refresh this often while the page is open and visible
const MIN_GAP = 30 * 1000;     // coming back to the page refreshes only if the last refresh was longer ago

/** Milliseconds from `now` until the next midnight in Singapore (UTC+8, no daylight saving). */
export function msUntilSgMidnight(now = Date.now()) {
  const day = 24 * 60 * 60 * 1000, offset = 8 * 60 * 60 * 1000;
  return day - ((now + offset) % day);
}

/**
 * Calls `refresh` when the page becomes visible again, every 5 minutes while it is visible, and just
 * after midnight in Singapore. `canRefresh()` can say no (for example while someone is typing); the
 * refresh then waits for the next chance.
 */
export function keepFresh(refresh, canRefresh = () => true) {
  let last = Date.now(), running = false;
  const run = async force => {
    if (running || document.hidden || !canRefresh()) return;
    if (!force && Date.now() - last < MIN_GAP) return;
    running = true;
    try { await refresh(); last = Date.now(); } catch (e) { /* try again next time */ } finally { running = false; }
    checkForUpdate();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(false); });
  setInterval(() => run(true), EVERY);
  const atMidnight = () => setTimeout(() => { run(true); atMidnight(); }, msUntilSgMidnight() + 5000);
  atMidnight();
}

/* ---------- New version notice ---------- */

const versionOf = html => (String(html).match(/\?v=(\d{12})/) || [])[1] || null;
let shown = false;

/** Compares this page's version stamp (npm run stamp) with the published page's, and offers a reload if they differ. */
export async function checkForUpdate() {
  const running = versionOf(document.querySelector('script[type="module"][src*="?v="]')?.getAttribute('src'));
  if (shown || !running) return;
  try {
    const res = await fetch(location.pathname, { cache: 'no-store' });
    const latest = versionOf(await res.text());
    if (!latest || latest === running) return;
  } catch (e) { return; }
  shown = true;
  const bar = document.createElement('div');
  bar.className = 'update-bar'; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>A new version of the app is available.</span><button class="btn small primary" type="button">Reload</button>';
  bar.querySelector('button').onclick = () => location.reload();
  document.body.append(bar);
}
