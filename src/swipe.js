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
  }, { passive: true });
  showSwipeHints(content);
}

/* ---------- Telling people they can swipe (phones only) ---------- */

const phone = () => matchMedia('(max-width: 760px) and (pointer: coarse)').matches;

/** Waits for the tabs to appear (the signed-in app draws them after sign-in), then peeks once. */
function showSwipeHints(content) {
  const check = () => {
    if (!phone()) { watch.disconnect(); return; }   // nothing to swipe on a computer
    const tabs = [...document.querySelectorAll('nav.tabs [data-tab]')];
    if (tabs.length < 2) return;
    watch.disconnect();
    peek(content, tabs);
  };
  const watch = new MutationObserver(check);
  watch.observe(document.body, { subtree: true, childList: true });
  check();
}

const PEEK_SEEN = 'swipePeekSeen';
let peeked = false;
/**
 * Once per phone: the page slides a little to the left and springs back, with the edge of the next
 * tab (a slim card with an arrow) peeking in from the right, as if it were just off screen.
 */
function peek(content, tabs) {
  if (peeked || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  peeked = true;
  try { if (localStorage.getItem(PEEK_SEEN)) return; localStorage.setItem(PEEK_SEEN, '1'); } catch { return; }
  const now = tabs.findIndex(b => b.getAttribute('aria-current') === 'page');
  const next = tabs[now + 1] || tabs[now - 1];
  if (!next) return;
  const fromRight = tabs.indexOf(next) > now;
  setTimeout(() => {
    const el = content();
    if (!el) return;
    const edge = document.createElement('div');
    edge.className = 'peek-edge ' + (fromRight ? 'right' : 'left');
    edge.setAttribute('aria-hidden', 'true');
    edge.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${fromRight ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'}"/></svg>`;
    document.body.append(edge);
    // Out quickly, a short pause, then a softer spring back. The easing is per step, not overall.
    const d = fromRight ? -1 : 1, out = 'cubic-bezier(.2, .8, .2, 1)', back = 'cubic-bezier(.5, 0, .2, 1)';
    const steps = (from, to) => [{ transform: from, easing: out }, { transform: to, offset: .35 }, { transform: to, offset: .55, easing: back }, { transform: from }];
    el.animate(steps('none', `translateX(${d * 56}px)`), 1400);
    edge.animate(steps(`translateX(${-d * 100}%)`, 'none'), 1400)
      .finished.then(() => edge.remove());
  }, 900);
}

