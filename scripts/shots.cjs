// Screenshots of the pages in a real browser, in demo mode, for showing the owner a change before it is
// published: every state of the 2FA Login card (team sizes, long names, each scene of the day, outside
// office hours, weekends, holidays, nobody available) at phone, small-phone, tablet and desktop widths,
// and before-and-after pictures of any of them.
//
//   node scripts/shots.cjs --out <folder>
//
// It needs Playwright (already installed in Claude Code cloud sessions; it is not a dependency of the
// site). Nothing is served on a port: the browser is handed the files straight from disk, with an empty
// config.js, so it never touches the real database and several runs can go at once. The clock is pinned
// (Monday 16 November 2026 for most states), so the pictures don't depend on the day it runs.
//
// Each picture is <state>-<view>.png. It also writes metrics.json and an overview sheet per view, and
// prints one line per picture: Secondaries on the card, where the WhatsApp button ends, the card's height,
// sideways scrolling and browser errors. It ends with an error if any picture scrolls sideways or the
// browser reported an error.
//
//   --out <folder>      where the pictures go (required; use a folder outside the project)
//   --root <folder>     shoot another copy of the site instead of this one. For "before" pictures:
//                       mkdir <folder> && git archive origin/main | tar -x -C <folder>
//   --compare <folder>  also write compare-<state>-<view>.png: the same picture from <folder> ("Before")
//                       beside this one ("After"), under a heading
//   --page <name>       login (the 2FA Login tab, the default), forecast, signin, roster, leave or team
//   --only a,b          just these states            --views phone,desk   just these widths
//   --all               every state at each width (a plain run shoots every state on a phone and a few at the other widths;
//                       pages other than login shoot the ordinary working day only)
//   --redraw            shoot after the page's 5-minute refresh has redrawn the card (no entrance animation)
//   --at <ms>           freeze the card's animations at that moment after drawing, so pictures can be compared
//   --still             as seen by people who turn off animations
//   --as <n>            which demo person signs in for roster, leave and team (0, the default, is the admin)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const arg = name => { const i = process.argv.indexOf('--' + name); return i < 0 ? undefined : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const list = name => typeof arg(name) === 'string' ? arg(name).split(',') : null;
const ROOT = path.resolve(typeof arg('root') === 'string' ? arg('root') : path.join(__dirname, '..'));
const ORIGIN = 'http://roster.test';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap">';

// Singapore is UTC+8. Monday 16 November 2026 is an ordinary working day; Monday 9 November is a public holiday.
const AT = { open: '2026-11-16T01:30:00Z', lunch: '2026-11-16T04:30:00Z', afternoon: '2026-11-16T07:00:00Z', evening: '2026-11-16T09:45:00Z',
  before: '2026-11-16T00:30:00Z', after: '2026-11-16T10:30:00Z', weekend: '2026-11-15T03:00:00Z', holiday: '2026-11-09T02:00:00Z' };
const DEMO = ['Alice Tan', 'Ben Lim', 'Chloe Ng', 'Dev Kumar', 'Elena Goh'];
const away = (people, date) => people.map((n, i) => ({ id: 900 + i, user_id: 'demo-' + n, start_date: date, end_date: date, note: '' }));
// Each state: when it is, and what the demo data holds. The rotation starts on Friday 30 October 2026 with the
// five demo people, so Alice is Primary on 16 November. `team` replaces them (its first name is Primary that day).
const STATES = {
  'open-4': { at: AT.open, title: 'Working day, team of five', about: '9:30am. A Primary and four Secondaries.' },
  'open-2': { at: AT.open, leaves: away([3, 4], '2026-11-16'), title: 'Working day, team of three', about: '9:30am. A Primary and two Secondaries.' },
  'open-1': { at: AT.open, leaves: away([2, 3, 4], '2026-11-16'), title: 'Working day, one Secondary', about: '9:30am. A Primary and one Secondary.' },
  'open-0': { at: AT.open, leaves: away([1, 2, 3, 4], '2026-11-16'), title: 'Working day, Primary alone', about: '9:30am. Everyone else is away.' },
  'open-6': { at: AT.open, team: [...DEMO, 'Farid Rahman', 'Grace Wong'], title: 'Working day, team of seven', about: '9:30am. A Primary and six Secondaries.' },
  'long': { at: AT.open, team: ['Muhammad Hafiz bin Abdullah', 'Christopher Ramanathan', 'Siti Nurhaliza Osman', 'Wei Jie Tan'], title: 'Long names', about: '9:30am. A team of four with long names.' },
  'short': { at: AT.open, team: ['Hana', 'Jo', 'PK'], title: 'Very short names', about: '9:30am. A team of three with one-word names.' },
  'lunch': { at: AT.lunch, title: 'Lunchtime', about: '12:30pm, team of five.' },
  'afternoon': { at: AT.afternoon, title: 'Afternoon', about: '3pm, team of five.' },
  'evening': { at: AT.evening, title: 'Late afternoon', about: '5:45pm, still office hours, team of five.' },
  'before': { at: AT.before, title: 'Before 9am', about: '8:30am: outside office hours. Next on duty is today at 9am.' },
  'after': { at: AT.after, title: 'After 6pm', about: '6:30pm: outside office hours. Next on duty is tomorrow.' },
  'after-2': { at: AT.after, leaves: away([3, 4], '2026-11-17'), title: 'After 6pm, team of three tomorrow', about: '6:30pm. Tomorrow has a Primary and two Secondaries.' },
  'weekend': { at: AT.weekend, title: 'Weekend', about: 'Sunday, 11am. Next on duty is Monday.' },
  'holiday': { at: AT.holiday, title: 'Public holiday', about: 'Monday 9 November, 10am. No duty today.' },
  'nobody': { at: AT.open, leaves: away([0, 1, 2, 3, 4], '2026-11-16'), title: 'Nobody available today', about: '9:30am on a working day. Everyone is away.' },
  'nobody-next': { at: AT.after, leaves: away([0, 1, 2, 3, 4], '2026-11-17'), title: 'After 6pm, nobody available tomorrow', about: '6:30pm. Everyone is away tomorrow.' }
};
const VIEWS = {
  phone: { width: 390, height: 844, scale: 2 },    // most phones
  narrow: { width: 320, height: 660, scale: 2 },   // the smallest phones
  p360: { width: 360, height: 780, scale: 2 },     // many Android phones
  p375: { width: 375, height: 812, scale: 2 },     // smaller iPhones
  p412: { width: 412, height: 915, scale: 2 },     // large Android phones
  tablet: { width: 820, height: 1180, scale: 1 },  // one column, with a wide card
  desk: { width: 1280, height: 800, scale: 1 }     // a laptop
};
// What a plain run shoots: every state on a phone, and the states that stress the layout at the other widths.
const DEFAULT_VIEWS = ['phone', 'narrow', 'tablet', 'desk'];
const MATRIX = { phone: Object.keys(STATES), narrow: ['open-4', 'open-6', 'long', 'after'], tablet: ['open-4'], desk: ['open-4', 'open-2', 'open-0', 'open-6', 'long', 'after', 'nobody'] };
const PAGES = { login: '/calendar.html', forecast: '/calendar.html', signin: '/index.html', roster: '/index.html', leave: '/index.html', team: '/index.html' };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uri = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

(async () => {
  const OUT = typeof arg('out') === 'string' ? path.resolve(arg('out')) : null;
  const pageName = typeof arg('page') === 'string' ? arg('page') : 'login';
  const only = list('only'), views = list('views') || DEFAULT_VIEWS, before = typeof arg('compare') === 'string' ? path.resolve(arg('compare')) : null;
  const wrong = [!OUT && 'Say where the pictures go: --out <folder>', !PAGES[pageName] && 'Unknown page: ' + pageName + '. Pages: ' + Object.keys(PAGES).join(', '),
    ...(only || []).filter(s => !STATES[s]).map(s => 'Unknown state: ' + s + '. States: ' + Object.keys(STATES).join(', ')),
    ...views.filter(v => !VIEWS[v]).map(v => 'Unknown view: ' + v + '. Views: ' + Object.keys(VIEWS).join(', '))].filter(Boolean);
  if (wrong.length) { console.error(wrong.join('\n')); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const serve = route => {
    const file = decodeURIComponent(new URL(route.request().url()).pathname).replace(/\/$/, '/index.html');
    if (file === '/config.js') return route.fulfill({ contentType: 'text/javascript', body: "export const SUPABASE_URL = ''; export const SUPABASE_ANON_KEY = '';" });
    const full = path.join(ROOT, path.normalize(file));
    if (!full.startsWith(ROOT) || !fs.existsSync(full)) return route.fulfill({ status: 404, body: 'Not found' });
    return route.fulfill({ contentType: TYPES[path.extname(full)] || 'application/octet-stream', body: fs.readFileSync(full), headers: { 'cache-control': 'no-store' } });
  };
  /** Draws a page of pictures (a sheet, or a before-and-after) and saves it as one PNG. */
  const compose = async (html, file, width, scale) => {
    const c = await browser.newContext({ viewport: { width, height: 200 }, deviceScaleFactor: scale });
    const p = await c.newPage();
    await p.setContent(`<!doctype html><meta charset="utf-8">${FONTS}<style>
      body { margin: 0; padding: 32px; width: max-content; background: #030c11; color: #e6f4f8; font: 16px/1.45 "Plus Jakarta Sans", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
      h1 { margin: 0; font-size: 30px; font-weight: 800; letter-spacing: -.02em; } p { margin: 8px 0 0; color: #9bb8c4; font-size: 18px; }
      .g { display: grid; gap: 28px 24px; align-items: start; margin-top: 24px; } figure { margin: 0; }
      figcaption { margin-bottom: 10px; color: #9bb8c4; font-size: 14px; } figcaption b { display: block; color: #7dd3fc; font: 700 14px "JetBrains Mono", monospace; letter-spacing: .08em; text-transform: uppercase; }
      img { display: block; width: 100%; border-radius: 16px; box-shadow: 0 0 0 1px #1d3a48; }</style>${html}`);
    await p.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map(i => i.decode().catch(() => {}))]));
    await p.screenshot({ path: file, fullPage: true }); await c.close();
  };

  const shots = [];
  for (const view of views) {
    const v = VIEWS[view];
    const states = only || (arg('all') ? Object.keys(STATES) : pageName === 'login' && MATRIX[view] ? MATRIX[view] : ['open-4']);
    for (const name of states) {
      const st = STATES[name];
      const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale, hasTouch: v.width < 880, reducedMotion: arg('still') ? 'reduce' : 'no-preference' });
      await ctx.route(ORIGIN + '/**', serve);
      await ctx.addInitScript(() => { try { localStorage.setItem('swipePeekSeen', '1'); } catch (e) {} });
      // Seed the demo data on Friday 30 October 2026, when the rotation starts, then set this state up.
      let p = await ctx.newPage();
      await p.clock.install({ time: new Date('2026-10-30T01:30:00Z') });
      await p.goto(ORIGIN + '/calendar.html'); await p.clock.runFor(1200); await p.waitForTimeout(300);
      await p.evaluate(({ team, leaves }) => {
        const db = JSON.parse(localStorage.getItem('duty-roster-demo'));
        db.leaves = leaves || []; db.nextId = 1; db.session = null;
        if (team) {
          db.profiles = team.map((nm, i) => ({ id: 'demo-' + i, email: 'p' + i + '@example.com', display_name: nm, rota_order: i, active: true, is_admin: i === 0 }));
          db.checkpoints = [{ effective_date: '2026-11-16', member_order: db.profiles.map(x => x.id), next_primary: 'demo-0' }];
          db.settings.rota_start = '2026-11-16';
        }
        localStorage.setItem('duty-roster-demo', JSON.stringify(db));
      }, { team: st.team || null, leaves: st.leaves || null });
      await p.close();

      p = await ctx.newPage();
      const errors = [];
      p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      p.on('pageerror', e => errors.push(e.message));
      p.on('dialog', d => d.accept());
      await p.clock.install({ time: new Date(st.at) });
      await p.goto(ORIGIN + PAGES[pageName]); await p.clock.runFor(1500); await p.waitForTimeout(500);
      if (pageName === 'forecast') { await p.click('[data-tab=calendar]'); await p.waitForTimeout(500); }
      if (['roster', 'leave', 'team'].includes(pageName)) {
        await p.locator('[data-demo]').nth(Number(arg('as')) || 0).click(); await p.waitForTimeout(700);
        await p.click(`[data-tab=${pageName}]`); await p.waitForTimeout(500);
      }
      if (arg('redraw')) { await p.clock.runFor(5 * 60 * 1000 + 2000); await p.waitForTimeout(500); }
      if (typeof arg('at') === 'string') await p.evaluate(t => document.getAnimations().forEach(a => { const el = a.effect && a.effect.target;
        if (el && el.closest && el.closest('.hero-card') && !el.closest('.engineer')) { a.pause(); a.currentTime = t; } }), Number(arg('at')));
      await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(250);
      const m = await p.evaluate(() => {
        const r = sel => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY), height: Math.round(b.height), width: Math.round(b.width) }; };
        const de = document.documentElement;
        return { sidewaysScroll: de.scrollWidth > de.clientWidth, pageHeight: de.scrollHeight, card: r('.hero-card'), button: r('a.btn.wa'),
          backups: document.querySelectorAll('.hero-card .backups li').length, backupsOutsideCard: document.querySelectorAll('.duty-side .backups li').length,
          webFont: document.fonts.check('800 20px "Plus Jakarta Sans"') };
      });
      const file = `${name}-${view}.png`;
      await p.screenshot({ path: path.join(OUT, file), fullPage: true });
      await ctx.close();
      shots.push({ state: name, view, file, title: st.title, about: st.about, ...m, errors });
      const card = pageName === 'login' ? `Secondaries on the card: ${m.backups}${m.backupsOutsideCard ? ' (+' + m.backupsOutsideCard + ' outside it)' : ''} | button ends at ${m.button ? m.button.bottom + 'px' : '(none)'} | card ${m.card ? m.card.height + 'px' : '(none)'} | ` : '';
      console.log(`${file.padEnd(24)} ${card}page ${m.pageHeight}px${m.sidewaysScroll ? ' | SCROLLS SIDEWAYS' : ''}${m.webFont ? '' : ' | web font missing'}${errors.length ? ' | ERRORS: ' + errors.join(' ; ') : ''}`);
      // The same picture from the other folder beside this one.
      if (before && fs.existsSync(path.join(before, file))) {
        const w = v.width < 880 ? v.width : 640;
        await compose(`<h1>${esc(st.title)}</h1><p>${esc(st.about)}</p><div class="g" style="grid-template-columns: repeat(2, ${w}px)">
          <figure><figcaption><b>Before</b></figcaption><img src="${uri(path.join(before, file))}"></figure>
          <figure><figcaption><b>After</b></figcaption><img src="${uri(path.join(OUT, file))}"></figure></div>`, path.join(OUT, 'compare-' + file), 2 * w + 88, v.width < 880 ? 2 : 1.5);
      } else if (before) console.log(' '.repeat(25) + 'no picture of this name in ' + before + ' to compare with');
    }
  }
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(shots, null, 1));

  // An overview sheet per view: every picture of that width side by side, each under its name.
  for (const view of views) {
    const items = shots.filter(x => x.view === view);
    if (!items.length) continue;
    const wide = VIEWS[view].width >= 880, w = wide ? 640 : 300, cols = Math.min(items.length, wide ? 2 : 6);
    await compose(`<div class="g" style="grid-template-columns: repeat(${cols}, ${w}px); margin-top: 0">${items.map(x =>
      `<figure><figcaption><b>${esc(x.state)}</b>${esc(x.title)}. ${esc(x.about)}</figcaption><img src="${uri(path.join(OUT, x.file))}"></figure>`).join('')}</div>`, path.join(OUT, `sheet-${view}.png`), cols * (w + 24) + 64, 1);
  }
  await browser.close();
  const bad = shots.filter(x => x.sidewaysScroll || x.errors.length);
  console.log(`\n${shots.length} pictures in ${OUT}` + (bad.length ? `: ${bad.length} with problems (sideways scrolling or browser errors)` : ': no sideways scrolling, no browser errors'));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('The screenshot run itself broke:', e); process.exit(1); });
