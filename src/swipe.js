// Swipe left or right on a phone to move to the next or previous tab. It just clicks that tab's
// button, so each page keeps its own tab logic. Then the new tab's content slides in from the side
// the finger came from (no slide for people who turn off animations).

const FIELD = 'input, textarea, select, [contenteditable], [data-noswipe]';

/**
 * Lets people swipe between the `[data-tab]` buttons. `content()` returns the element now showing;
 * `blocked()` can say no (for example while a form has unsaved input).
 */
export function swipeTabs(content, blocked = () => false) {
  let start = null;
  document.addEventListener('touchstart', e => {
    const t = e.touches[0];
    // One finger, not from a form field, and not from the screen edge (the phone's own back swipe).
    start = e.touches.length === 1 && !e.target.closest(FIELD) && t.clientX > 24 && t.clientX < innerWidth - 24
      ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!start) return;
    const t = e.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y;
    const quick = Date.now() - start.at < 700;
    start = null;
    // A clear sideways swipe: far enough, mostly horizontal, and not while someone is typing.
    if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (blocked() || (document.activeElement && document.activeElement.matches(FIELD))) return;
    if (getSelection && String(getSelection())) return;   // they were selecting text
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const now = tabs.findIndex(b => b.getAttribute('aria-current') === 'page');
    const next = tabs[now + (dx < 0 ? 1 : -1)];
    if (now < 0 || !next) return;
    next.click();
    const el = content();
    if (!el) return;
    el.classList.remove('slide-from-left', 'slide-from-right');
    void el.offsetWidth;   // restart the animation
    el.classList.add(dx < 0 ? 'slide-from-right' : 'slide-from-left');
    el.addEventListener('animationend', () => el.classList.remove('slide-from-left', 'slide-from-right'), { once: true });
    hideTip(true);
  }, { passive: true });
  showSwipeHints();
}

/* ---------- Telling people they can swipe (phones only) ---------- */

const phone = () => matchMedia('(max-width: 760px) and (pointer: coarse)').matches;

/**
 * Page dots under the header, one per tab with the current one filled, and a one-time tip.
 * The pages redraw their header now and then, so the dots are put back whenever the tabs change.
 */
function showSwipeHints() {
  const sync = () => {
    const nav = document.querySelector('nav.tabs'), header = nav && nav.closest('header');
    let dots = document.querySelector('.tab-dots');
    if (!nav || !phone()) { if (dots) dots.remove(); return; }
    const tabs = [...nav.querySelectorAll('[data-tab]')];
    if (!dots || dots.previousElementSibling !== header) {
      if (dots) dots.remove();
      dots = document.createElement('div');
      dots.className = 'tab-dots';
      dots.setAttribute('aria-hidden', 'true');
      header.after(dots);
    }
    const html = tabs.map(b => `<span${b.getAttribute('aria-current') === 'page' ? ' class="on"' : ''}></span>`).join('');
    if (dots.innerHTML !== html) dots.innerHTML = html;
    if (tabs.length > 1) showTip();
  };
  new MutationObserver(sync).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current'] });
  sync();
}

const TIP_SEEN = 'swipeTipSeen';
let tip = null;
/** Shown once per phone, a moment after the page opens; gone after a few seconds, a tap or a swipe. */
function showTip() {
  if (tip) return;
  try { if (localStorage.getItem(TIP_SEEN)) return; localStorage.setItem(TIP_SEEN, '1'); } catch { return; }
  tip = document.createElement('div');
  tip.className = 'swipe-tip';
  tip.setAttribute('role', 'status');
  tip.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.6-2.2L4.6 15.6a1.5 1.5 0 0 1 2.3-1.9L9 16"/>
    <path class="swipe-arrows" d="M3 5h4M3 5l1.5-1.5M3 5l1.5 1.5M21 5h-4m4 0-1.5-1.5M21 5l-1.5 1.5"/></svg>
    <span><b>Tip:</b> swipe left or right to change tabs</span>`;
  setTimeout(() => {
    document.body.append(tip);
    setTimeout(() => hideTip(), 6000);
    document.addEventListener('touchstart', () => setTimeout(() => hideTip(), 1500), { once: true, passive: true });
  }, 1200);
}
function hideTip(now) {
  if (!tip || !tip.isConnected) return;
  const el = tip;
  if (now) { el.remove(); return; }
  el.classList.add('out');
  setTimeout(() => el.remove(), 300);
}
