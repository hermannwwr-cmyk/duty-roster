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
}
