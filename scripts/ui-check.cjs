// A functional check of both pages in a real browser, in demo mode: it clicks through every action
// (leave, team changes, holidays, settings, sign-up and approval, month and tab navigation, swiping,
// a day when nobody is available, and outside office hours), lets the clock run (refreshes, 6pm, noon,
// midnight), and has the public page's requests fail or answer late (a stand-in src/connect.js)
// and checks what the roster and the public page show afterwards. Run it before publishing a change
// to a page, script or styles.css:
//
//   node scripts/ui-check.cjs
//
// It needs Playwright (already installed in Claude Code cloud sessions; it is not a dependency of the
// site). It serves this folder itself with an empty config.js, so it never touches the real database,
// and it pins the clock to Monday 16 November 2026, 09:30 in Singapore, so the results don't depend on
// the day it runs.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/\/$/, '/index.html');
  if (file === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end("export const SUPABASE_URL = ''; export const SUPABASE_ANON_KEY = '';"); }
  const full = path.join(ROOT, path.normalize(file));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => { res.writeHead(err ? 404 : 200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(err ? 'Not found' : data); });
});
let BASE = '';
const NOW = '2026-11-16T01:30:00Z';   // Monday 16 Nov 2026, 09:30 in Singapore
const results = []; const errors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '   <<< ' + detail)); };
(async () => {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  BASE = 'http://127.0.0.1:' + server.address().port;
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await c.addInitScript(() => { try { localStorage.setItem('swipePeekSeen', '1'); } catch {} });
  // `prep(page)` runs before the page loads (to serve a stand-in file, say).
  const open = async (url, now = NOW, prep) => {
    const p = await c.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(url + ': ' + m.text()); });
    p.on('pageerror', e => errors.push(url + ': ' + e.message));
    p.on('dialog', d => d.accept());
    if (prep) await prep(p);
    await p.clock.install({ time: new Date(now) });
    await p.goto(BASE + url); await p.clock.runFor(1200); await p.waitForTimeout(600);
    return p;
  };
  const settle = p => p.waitForTimeout(450);
  const toast = async p => {
    for (let i = 0; i < 20; i++) {
      const text = await p.evaluate(() => { const t = document.getElementById('toast'); const v = t ? t.textContent : ''; if (v && t) t.textContent = ''; return v; });
      if (text) return text;
      await p.waitForTimeout(100);
    }
    return '';
  };
  const says = async (name, p, expected) => { const got = await toast(p); check(name, typeof expected === 'string' ? got === expected : expected.test(got), 'said: ' + JSON.stringify(got)); };
  // Seed: the rotation starts Fri 30 Oct with Alice, and there is no leave.
  let p = await open('/calendar.html', '2026-10-30T01:30:00Z');
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('duty-roster-demo')); db.leaves = []; db.nextId = 1; localStorage.setItem('duty-roster-demo', JSON.stringify(db)); });
  await p.close();

  const { rosterMessage } = await import(pathToFileURL(path.join(ROOT, 'src/schedule.js')).href);
  const dayRow = (p, n) => p.locator('.days .day').filter({ has: p.locator('.dnum', { hasText: new RegExp('^' + n + '$') }) });
  const cell = (p, n) => p.locator('.cal .cell:not(.out)').filter({ has: p.locator('.num .d', { hasText: new RegExp('^' + n + '$') }) });
  const names = async loc => (await loc.locator('.duty-list li:not(.away) .full').allTextContents());
  const signIn = async (p, who) => { await p.click(`[data-demo="${who}@example.com"]`); await settle(p); };
  const signOut = async p => { await p.click('#acct-btn'); await p.click('#signout'); await settle(p); };
  const tab = async (p, t) => { await p.click(`[data-tab=${t}]`); await settle(p); };
  // A stand-in for src/connect.js (pass it to open() as `prep`). Like the real one in Supabase mode, making the store
  // downloads the client from the CDN, here a stand-in that is served while `cdn.down` is false and fails as a dropped
  // connection while it is true (the browser then keeps that failure for as long as the page is open, as it does for
  // real). The store is the demo store, which the check can reach as __store (to change the data under a page that is
  // open), and which fails on demand: each load (__failLoads), or answers late (__delay: milliseconds by the first day
  // asked for, on the page's clock). __asked counts the loads.
  const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm', cdn = { down: false, asked: 0 };
  await c.route(CDN, route => { cdn.asked++; return cdn.down ? route.abort('internetdisconnected')
    : route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: 'export const createClient = () => ({});' }); });
  const flaky = p => p.route('**/src/connect.js*', route => route.fulfill({ contentType: 'text/javascript', body: `import { DemoStore } from './store.js';
    export async function createStore() {
      await import('${CDN}');
      const store = globalThis.__store = new DemoStore(), load = store.loadPublic.bind(store);
      store.loadPublic = async (from, to) => {
        globalThis.__asked = (globalThis.__asked || 0) + 1;
        const wait = (globalThis.__delay || {})[from];
        if (wait) await new Promise(done => setTimeout(done, wait));
        if (globalThis.__failLoads) throw new Error('Failed to fetch');
        return load(from, to);
      };
      return store;
    }` }));

  /* ---------- A. The public page ---------- */
  let pub = await open('/calendar.html');
  // The compact top bar: 48px tall, each tab answers taps over the bar's height, and at 320px nothing in the pill is cut off.
  const bar = await pub.evaluate(() => { const t = document.querySelector('.top').getBoundingClientRect(), tab = document.querySelector('[data-tab=calendar]').getBoundingClientRect();
    return { h: Math.round(t.height), tap: document.elementFromPoint(tab.left + tab.width / 2, t.top + 4)?.closest('[data-tab]')?.dataset.tab, below: document.elementFromPoint(tab.left + tab.width / 2, t.bottom + 2)?.closest('.top') === null }; });
  await pub.setViewportSize({ width: 320, height: 700 }); await pub.waitForTimeout(150);
  const fits320 = await pub.evaluate(() => { const t = document.querySelector('.tabs'), s = document.querySelector('.signin').getBoundingClientRect(); return t.scrollWidth <= t.clientWidth && t.getBoundingClientRect().right <= s.left; });
  await pub.setViewportSize({ width: 390, height: 844 }); await pub.waitForTimeout(150);
  check('A0 top bar: 48px tall, tabs answer taps across its height but not below it, and it fits at 320px', bar.h === 48 && bar.tap === 'calendar' && bar.below && fits320, JSON.stringify({ ...bar, fits320 }));
  check('A1 public: today\'s Primary is shown', (await pub.locator('.hero-name .name').innerText()) === 'Alice Tan');
  check('A2 public: four Secondaries in order', (await pub.locator('.backups .nm').allTextContents()).join() === 'Ben Lim,Chloe Ng,Dev Kumar,Elena Goh');
  check('A2b public: the Secondaries are on the Primary\'s card, numbered, each with a name and a role', await pub.locator('.hero-card ol.backups li').count() === 4 && await pub.locator('.duty-side .backups').count() === 0
    && (await pub.locator('.backups .n').allTextContents()).join() === '1,2,3,4' && (await pub.locator('.backups .rl').allTextContents()).join() === 'Secondary 1,Secondary 2,Secondary 3,Secondary 4');
  check('A2c public: the button can be tapped without scrolling', await pub.evaluate(() => document.querySelector('a.btn.wa').getBoundingClientRect().bottom + scrollY <= 640));
  check('A3 public: Up next shows the Primary on the next three working days, from tomorrow', (await pub.locator('.next-duty .nm').allTextContents()).join() === 'Ben,Chloe,Dev'
    && (await pub.locator('.next-duty .when').first().textContent()) === 'Tomorrow');
  const want = rosterMessage({ date: '2026-11-16', duties: ['Alice Tan', 'Ben Lim', 'Chloe Ng', 'Dev Kumar', 'Elena Goh'].map((name, i) => ({ role: i ? 'Secondary ' + i : 'Primary', name })) }, BASE + '/calendar.html');
  const got = decodeURIComponent((await pub.locator('a.btn.wa').getAttribute('href')).replace('https://wa.me/?text=', ''));
  check('A4 public: WhatsApp button carries the exact message', got === want, JSON.stringify(got));
  check('A5 public: WhatsApp opens in a new tab', (await pub.locator('a.btn.wa').getAttribute('target')) === '_blank');
  await tab(pub, 'calendar');
  check('A6 calendar: today lists all five, Primary first', (await names(cell(pub, 16))).join() === 'Alice Tan,Ben Lim,Chloe Ng,Dev Kumar,Elena Goh' && (await cell(pub, 16).locator('.duty-list li.p .full').innerText()) === 'Alice Tan');
  check('A6b calendar: today is labelled "Today" and marked as the current date', (await cell(pub, 16).locator('.today-tag').innerText()).toLowerCase() === 'today' && (await cell(pub, 16).getAttribute('aria-current')) === 'date' && await pub.locator('.cal .today-tag').count() === 1);
  check('A7 calendar: the address remembers the tab', pub.url().endsWith('#calendar'));
  await pub.click('#next'); await settle(pub);
  check('A8 calendar: next month, focus stays on the button', (await pub.locator('.cal-head h2').innerText()) === 'December 2026' && (await pub.evaluate(() => document.activeElement.id)) === 'next');
  check('A9 calendar: "This month" appears away from this month', await pub.locator('#this').count() === 1);
  await pub.click('#this'); await settle(pub);
  check('A10 calendar: "This month" returns and goes away', (await pub.locator('.cal-head h2').innerText()) === 'November 2026' && await pub.locator('#this').count() === 0);
  await pub.click('#prev'); await settle(pub);
  check('A11 calendar: previous month shows October with its duties', (await pub.locator('.cal-head h2').innerText()) === 'October 2026' && (await names(cell(pub, 30))).length === 5);
  await pub.close();

  /* ---------- B. A member (Chloe) adds and removes leave ---------- */
  let app = await open('/index.html');
  check('B0 sign-in screen shows, with the demo people', (await app.locator('.auth h1').innerText()) === '2FA Login Request' && await app.locator('[data-demo]').count() === 5);
  await signIn(app, 'chloe');
  check('B1 roster: your role today', (await app.locator('.role-head .role').innerText()) === 'Secondary 2');
  check('B2 roster: line-up of five with your tile marked', await app.locator('.lineup li').count() === 5 && (await app.locator('.lineup li.me .nm').innerText()).startsWith('Chloe'));
  check('B3 roster: non-admin sees no admin controls on Team', await (async () => { await tab(app, 'team'); const n = await app.locator('[data-up], [data-active], #hol-form, #start-form, [data-approve]').count(); return n === 0; })());
  await tab(app, 'leave');
  check('B4 leave: members cannot pick a past start date', (await app.locator('#l-start').getAttribute('min')) === '2026-11-16' && await app.locator('#l-who').count() === 0);
  await app.fill('#l-start', '2026-11-18'); await app.fill('#l-end', '2026-11-18'); await app.fill('#l-note', 'Test leave');
  await app.click('#leave-form button[type=submit]');
  await says('B5 leave: adding leave confirms', app, 'Leave added. The roster has been updated.');
  await settle(app);
  check('B6 leave: it is listed with a Remove button', await app.locator('[data-del]').count() === 1);
  await tab(app, 'roster');
  const r18 = dayRow(app, 18);
  check('B7 roster: that day shows you on leave and the others moved up', (await r18.locator('.badge').innerText()).includes('Leave') && (await r18.locator('.tag.leave').innerText()) === 'Chloe on leave' && (await r18.locator('.then').innerText()) === 'then Elena → Alice → Ben', await r18.innerText());
  pub = await open('/calendar.html#calendar');
  check('B8 public calendar: that day lists four people and one dashed slot', (await names(cell(pub, 18))).join() === 'Dev Kumar,Elena Goh,Alice Tan,Ben Lim' && await cell(pub, 18).locator('.duty-list li.away').count() === 1 && await pub.locator('.legend .slot').count() === 1);
  check('B9 public page: no leave wording or notes reach it', !/leave|Test leave/i.test(await pub.locator('body').innerText()));
  await pub.close();
  // A member trying to book the past is refused, as the database would refuse it.
  await tab(app, 'leave');
  await app.evaluate(() => { for (const id of ['l-start', 'l-end']) { const f = document.getElementById(id); f.removeAttribute('min'); f.value = '2026-11-10'; } });
  await app.click('#leave-form button[type=submit]');
  await says('B10 leave: a past date is refused, with the reason', app, /^Leave can only be added from today onwards/); await settle(app);
  check('B10b leave: nothing was added', await app.locator('[data-del]').count() === 1);
  await app.click('[data-del]');
  await says('B11 leave: removing leave confirms', app, 'Leave removed.'); await settle(app);
  await tab(app, 'roster');
  check('B12 roster: the day is back to normal (you are Primary again)', (await dayRow(app, 18).locator('.badge').innerText()).includes('Primary') && await dayRow(app, 18).locator('.tag.leave').count() === 0, await dayRow(app, 18).innerText());
  // Month navigation in the app.
  await app.click('#next'); await settle(app);
  check('B13 roster: next month, focus stays on the button', (await app.locator('.month strong').innerText()) === 'December 2026' && (await app.evaluate(() => document.activeElement.id)) === 'next' && await app.locator('#this').count() === 1);
  await app.click('#this'); await settle(app);
  check('B14 roster: "This month" returns', (await app.locator('.month strong').innerText()) === 'November 2026');
  // The account menu.
  await app.click('#acct-btn');
  const opened = await app.locator('#acct-menu').isVisible() && (await app.locator('.acct-head b').innerText()) === 'Chloe Ng';
  await app.keyboard.press('Escape');
  check('B15 account menu: opens, shows who you are, Escape closes it and returns focus', opened && !(await app.locator('#acct-menu').isVisible()) && (await app.evaluate(() => document.activeElement.id)) === 'acct-btn');
  await signOut(app);

  /* ---------- C. An admin (Alice): leave for others, ending leave early ---------- */
  await signIn(app, 'alice');
  check('C0 admin: role today is Primary', (await app.locator('.role-head .role').innerText()) === 'Primary');
  await tab(app, 'leave');
  await app.selectOption('#l-who', 'demo-1'); await app.fill('#l-start', '2026-11-13'); await app.fill('#l-end', '2026-11-17');
  await app.click('#leave-form button[type=submit]');
  await says('C1 admin: can record leave for someone else, starting in the past', app, 'Leave added. The roster has been updated.'); await settle(app);
  check('C2 leave list: marked "On leave now" with "End early"', await app.locator('.tag.leave', { hasText: 'On leave now' }).count() === 1 && await app.locator('[data-end]').count() === 1 && await app.locator('[data-del]').count() === 0);
  await tab(app, 'roster');
  check('C3 roster: today\'s line-up shows Ben on leave', (await app.locator('.lineup li.away .nm').innerText()).startsWith('Ben') && await app.locator('.lineup li:not(.away)').count() === 4);
  await tab(app, 'leave'); await app.click('[data-end]');
  await says('C4 leave: ending early confirms', app, /^Leave\ ended\./); await settle(app);
  await tab(app, 'roster');
  check('C5 roster: Ben is back today, and still shown on leave on Friday 13', await app.locator('.lineup li.away').count() === 0 && await app.locator('.lineup li').count() === 5 && (await dayRow(app, 13).locator('.tag.leave').innerText()) === 'Ben on leave');

  /* ---------- D. Team changes take effect from today; earlier days keep their duties ---------- */
  const past = async () => (await dayRow(app, 12).locator('.who').innerText()).replace(/\s+/g, ' ');
  const before12 = await past(), beforeToday = (await app.locator('.lineup .nm').allTextContents()).join();
  await tab(app, 'team');
  await app.click('[data-up="demo-2"]');
  await says('D1 team: reordering confirms', app, 'Order updated from today.'); await settle(app);
  check('D2 team: the order list shows the change', (await app.locator('[data-name]').evaluateAll(els => els.map(e => e.value).join())) === 'Alice Tan,Chloe Ng,Ben Lim,Dev Kumar,Elena Goh');
  await tab(app, 'roster');
  check('D3 roster: an earlier day is unchanged by the reorder', (await past()) === before12, await past());
  check('D4 roster: the order from today follows the new order', (await app.locator('.lineup .nm').allTextContents()).join() !== beforeToday, (await app.locator('.lineup .nm').allTextContents()).join());
  await tab(app, 'team'); await app.click('[data-down="demo-2"]'); await toast(app); await settle(app);
  check('D5 team: moving back restores the order', (await app.locator('[data-name]').evaluateAll(els => els.map(e => e.value).join())) === 'Alice Tan,Ben Lim,Chloe Ng,Dev Kumar,Elena Goh');
  await app.uncheck('[data-active="demo-3"]');
  await says('D6 team: deactivating confirms', app, 'Left out of the roster from today.'); await settle(app);
  await tab(app, 'roster');
  check('D7 roster: Dev is out from today but kept on earlier days', !(await app.locator('.lineup .nm').allTextContents()).join().includes('Dev') && (await past()).includes('Dev'));
  pub = await open('/calendar.html#calendar');
  check('D8 public calendar: four people today and no dashed slot (inactive is not "away")', (await names(cell(pub, 16))).length === 4 && await cell(pub, 16).locator('.duty-list li.away').count() === 0 && (await names(cell(pub, 12))).length === 5);
  await pub.close();
  await tab(app, 'team'); await app.check('[data-active="demo-3"]');
  await says('D9 team: reactivating confirms', app, 'Back on the roster from today.'); await settle(app);
  await app.fill('[data-name="demo-1"]', 'Benjamin Lim'); await app.locator('[data-name="demo-1"]').dispatchEvent('change');
  await says('D10 team: renaming confirms', app, 'Name saved.'); await settle(app);
  await tab(app, 'roster');
  check('D11 roster: the new name shows', (await app.locator('.lineup').innerText()).includes('Benjamin'));
  await tab(app, 'team'); await app.fill('[data-name="demo-1"]', 'Ben Lim'); await app.locator('[data-name="demo-1"]').dispatchEvent('change'); await toast(app); await settle(app);

  /* ---------- E. Holidays, the public switch, and restarting the rotation ---------- */
  await app.fill('#h-date', '2026-11-19'); await app.fill('#h-name', 'Test Day'); await app.click('#hol-form button[type=submit]');
  await says('E1 holidays: adding confirms', app, 'Holiday added.'); await settle(app);
  await tab(app, 'roster');
  check('E2 roster: the holiday row shows', (await dayRow(app, 19).innerText()).includes('Test Day') && await app.locator('.days .day.holiday').count() === 2);
  pub = await open('/calendar.html#calendar');
  check('E3 public calendar: the holiday shows', (await cell(pub, 19).innerText()).includes('Test Day') && await cell(pub, 19).locator('.duty-list').count() === 0);
  await pub.close();
  await tab(app, 'team'); await app.click('[data-hdel="2026-11-19"]');
  await says('E4 holidays: removing confirms', app, 'Holiday removed.'); await settle(app);
  await app.uncheck('#pub-cal');
  await says('E5 settings: switching the public calendar off confirms', app, 'Public calendar switched off.'); await settle(app);
  pub = await open('/calendar.html');
  const off1 = await pub.locator('#today').innerText(); await tab(pub, 'calendar'); const off2 = await pub.locator('#view').innerText();
  check('E6 public page: both tabs say it is switched off, with no names', /switched off/.test(off1) && /switched off/.test(off2) && !/Alice|Ben|Chloe/.test(off1 + off2));
  await pub.close();
  await app.check('#pub-cal'); await toast(app); await settle(app);
  await app.fill('#s-start', '2026-11-02'); await app.click('#start-form button[type=submit]');
  await says('E7 settings: restarting the rotation asks, then confirms', app, 'Rotation restarted.'); await settle(app);
  await tab(app, 'roster');
  check('E8 roster: person 1 is Primary on the new start date', (await dayRow(app, 2).locator('.lead .nm').innerText()).includes('Alice Tan'), await dayRow(app, 2).innerText());
  await signOut(app);

  /* ---------- F. A new person signs up, waits, and is approved ---------- */
  await app.click('[data-mode="signup"]'); await app.fill('#f-name', 'Zed Tester'); await app.fill('#f-email', 'zed@example.com'); await app.fill('#f-pass', 'secret1');
  await app.click('#auth-form button[type=submit]'); await settle(app);
  check('F1 sign-up: the new person waits for approval and sees no roster', (await app.locator('.auth h2').innerText()) === 'Waiting for approval' && await app.locator('.lineup, .days').count() === 0);
  await app.click('#out'); await settle(app);
  await signIn(app, 'alice'); await tab(app, 'team');
  check('F2 team: the admin sees them waiting', (await app.locator('[data-approve]').count()) === 1 && (await app.locator('#view').innerText()).includes('Zed Tester'));
  await app.click('[data-approve]');
  await says('F3 team: approving confirms', app, /^Approved\./); await settle(app);
  await tab(app, 'roster');
  check('F4 roster: six people in the line-up, including the new one', await app.locator('.lineup li').count() === 6 && (await app.locator('.lineup').innerText()).includes('Zed'), await app.locator('.lineup').innerText());
  await tab(app, 'team');
  check('F4b team: the new person is last in the rotation order', (await app.locator('[data-name]').evaluateAll(els => els.map(e => e.value).join())) === 'Alice Tan,Ben Lim,Chloe Ng,Dev Kumar,Elena Goh,Zed Tester');
  await tab(app, 'roster');
  check('F5 roster: no sideways scroll with six people', await app.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  pub = await open('/calendar.html');
  check('F6 public page: five Secondaries now, no sideways scroll', await pub.locator('.backups li').count() === 5 && await pub.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

  /* ---------- G. Swiping, and reduced motion ---------- */
  const swipe = async (page, from, to) => page.evaluate(([a, z]) => {
    const t = (x, type) => { const touch = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 420 });
      document.body.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [touch], changedTouches: [touch], bubbles: true })); };
    t(a, 'touchstart'); t(z, 'touchend');
  }, [from, to]);
  await swipe(pub, 300, 80);
  const swipeSteady = await pub.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && !document.querySelector('.cal.enter'));
  await settle(pub);
  check('G0 swipe: the page does not move sideways while the tab slides in, and the Forecast has one entrance, not two', swipeSteady);
  const fwd = await pub.locator('[data-tab=calendar]').getAttribute('aria-current');
  await swipe(pub, 80, 300); await settle(pub);
  check('G1 swipe: left goes to Forecast, right comes back', fwd === 'page' && (await pub.locator('[data-tab=today]').getAttribute('aria-current')) === 'page');
  await swipe(app, 300, 80); await settle(app);
  check('G2 swipe: works in the signed-in app too', (await app.locator('[data-tab=leave]').getAttribute('aria-current')) === 'page');
  // With animations on, the Primary's ring glows now and then (and nothing runs along the line); with reduced motion nothing moves.
  const moving = await pub.evaluate(() => getComputedStyle(document.querySelector('.av.big'), '::after').animationName === 'halo' && getComputedStyle(document.querySelector('.relay .rail'), '::after').content === 'none');
  await pub.emulateMedia({ reducedMotion: 'reduce' });
  const still = moving && await pub.evaluate(() => [...document.querySelectorAll('.engineer *, .btn.wa, .hero-card *, .next-duty, .next-duty *')].every(el => [null, '::before', '::after'].every(p => getComputedStyle(el, p).animationName === 'none')));
  check('G3 reduced motion: nothing on the page animates', still);
  await pub.close(); await app.close();

  /* ---------- I. Outside office hours (9am to 6pm) on a working day ---------- */
  pub = await open('/calendar.html');
  const todays = await pub.locator('.hero-name .name').innerText();
  const todaysList = await pub.locator('.backups .nm').allTextContents(), todaysBackups = todaysList.join();
  await tab(pub, 'calendar');
  const tuesdays = await cell(pub, 17).locator('.duty-list li.p .full').innerText();
  const wednesdays = await cell(pub, 18).locator('.duty-list li.p .full').innerText();
  await pub.close();
  pub = await open('/calendar.html', '2026-11-16T00:30:00Z');   // 8:30am in Singapore
  check('I1 before 9am: says no one is on duty now, with no big face', (await pub.locator('.hero-name .eyebrow').textContent()) === 'Outside office hours' && (await pub.locator('.hero-none').innerText()) === 'No one is on duty now.' && await pub.locator('.av.big').count() === 0, await pub.locator('.hero-name').innerText());
  check('I2b before 9am: that day\'s Secondaries are in the same box, in order', todaysBackups.length > 0 && (await pub.locator('.hero-card .next-cover .backups .nm').allTextContents()).join() === todaysBackups);
  check('I2 before 9am: next on duty is today\'s Primary, from 9am today', (await pub.locator('.next-cover .eyebrow').textContent()) === 'Next on duty · 9am today' && (await pub.locator('.next-cover .who-line .nm').innerText()) === todays, await pub.locator('.next-cover').innerText());
  check('I3 before 9am: the room is closed and the button shares rather than asks', (await pub.locator('.engineer').getAttribute('class')).includes('scene-closed') && (await pub.locator('a.btn.wa').innerText()).trim() === 'Tell the team on WhatsApp');
  check('I3b before 9am: the message is about today, and the room opens at 9am', decodeURIComponent(await pub.locator('a.btn.wa').getAttribute('href')).includes('Mon, 16 Nov') && (await pub.locator('.hero-caption').innerText()) === 'Office closed. Opens at 9am.', await pub.locator('.hero-caption').innerText());
  await pub.close();
  pub = await open('/calendar.html', '2026-11-16T10:30:00Z');   // 6:30pm in Singapore
  check('I4 after 6pm: next on duty is tomorrow\'s Primary', (await pub.locator('.next-cover .eyebrow').textContent()) === 'Next on duty · 9am tomorrow' && (await pub.locator('.next-cover .who-line .nm').innerText()) === tuesdays, await pub.locator('.next-cover').innerText());
  check('I4b after 6pm: the next Primary\'s ring glows as in office hours, and no glint runs along the line', await pub.evaluate(() => getComputedStyle(document.querySelector('.next-cover .who-line > .av'), '::after').animationName === 'halo'
    && getComputedStyle(document.querySelector('.next-cover .relay .rail'), '::after').content === 'none'));
  check('I5 after 6pm: Up next shows the day after tomorrow', (await pub.locator('.next-duty').first().getAttribute('title')) === wednesdays && (await pub.locator('.next-duty .when').first().textContent()) === 'Wed 18');
  // The evening's message is still about the day: its date, its Primary and Secondaries, and the usual request to the Primary.
  const evening = decodeURIComponent((await pub.locator('a.btn.wa').getAttribute('href')).replace('https://wa.me/?text=', ''));
  const todayMessage = rosterMessage({ date: '2026-11-16', duties: [todays, ...todaysList].map((name, i) => ({ role: i ? 'Secondary ' + i : 'Primary', name })) }, BASE + '/calendar.html');
  check('I5b after 6pm: the button still says "Tell the team on WhatsApp", and its message is about today', (await pub.locator('a.btn.wa').innerText()).trim() === 'Tell the team on WhatsApp' && evening === todayMessage
    && evening.includes(`Hi ${todays} (Primary), may we have OTP login for ...`), JSON.stringify(evening));
  await pub.close();
  pub = await open('/calendar.html', '2026-11-16T09:59:30Z');   // 5:59:30pm: open, then it switches by itself at 6pm
  const openBefore = await pub.locator('.av.big').count() === 1;
  await pub.clock.runFor(35000); await settle(pub);
  check('I6 at 6pm the card switches over by itself', openBefore && (await pub.locator('.hero-name .eyebrow').textContent()) === 'Outside office hours');
  await pub.close();
  app = await open('/index.html', '2026-11-16T10:30:00Z');
  check('I7 signed-in app after 6pm: shows tomorrow\'s role, the note and the share button', (await app.locator('.role-head .eyebrow').innerText()).toLowerCase().includes('tue, 17 nov') && (await app.locator('.role-card').innerText()).includes('No one is on duty now.') && (await app.locator('#share-wa').innerText()).trim() === 'Tell the team on WhatsApp', await app.locator('.role-card').innerText());
  await app.close();

  /* ---------- K. On a weekend the 2FA Login card offers no OTP ---------- */
  pub = await open('/calendar.html', '2026-11-22T03:00:00Z');   // Sunday 22 Nov, 11am
  check('K1 weekend: the card says there is no duty, with no big face', (await pub.locator('.hero-name .eyebrow').textContent()) === 'No duty today' && (await pub.locator('.hero-none').innerText()) === 'It’s the weekend.' && await pub.locator('.av.big').count() === 0, await pub.locator('.hero-name').innerText());
  check('K2 weekend: next on duty is Monday, and the button shares rather than asks', (await pub.locator('.next-cover .eyebrow').textContent()) === 'Next on duty · 9am tomorrow' && (await pub.locator('a.btn.wa').innerText()).trim() === 'Tell the team on WhatsApp' && !(await pub.locator('.hero-card').innerText()).includes('Click for OTP'));
  await pub.close();
  app = await open('/index.html', '2026-11-22T03:00:00Z');
  check('K3 weekend: the signed-in page offers no OTP either', (await app.locator('.role-head .role').innerText()) === 'No duty' && (await app.locator('#share-wa').innerText()).trim() === 'Tell the team on WhatsApp');
  await app.close();

  /* ---------- J. At the weekend the calendar marks the next weekday ---------- */
  pub = await open('/calendar.html#calendar', '2026-11-21T03:00:00Z');   // Saturday 21 Nov, 11am
  check('J1 weekend: a note says today is the weekend', (await pub.locator('.today-note').innerText()) === 'Today is Saturday, 21 November. No duty at weekends.', await pub.locator('.today-note').innerText().catch(() => 'none'));
  check('J2 weekend: Monday is marked "Next", and nothing claims to be today', (await cell(pub, 23).locator('.next-tag').innerText()).toLowerCase() === 'next' && await pub.locator('.cal .is-next').count() === 1 && await pub.locator('.cal .is-today').count() === 0);
  await pub.close();
  pub = await open('/calendar.html#calendar');
  check('J3 weekday: no weekend note and no "Next" mark', await pub.locator('.today-note, .cal .is-next').count() === 0);
  await pub.close();

  /* ---------- M. The Forecast's motion ---------- */
  const calClass = () => pub.locator('#view .cal').getAttribute('class');
  const noSideways = () => pub.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  pub = await open('/calendar.html#calendar');
  check('M1 forecast link: the days ripple in the first time, and today glows', (await calClass()).includes('enter') && await pub.evaluate(() => getComputedStyle(document.querySelector('.cell.is-today'), '::after').animationName === 'halo'));
  await pub.click('#next'); const wentNext = await calClass(), steadyNext = await noSideways(); await settle(pub);
  await pub.click('#prev'); const wentBack = await calClass(), steadyBack = await noSideways(); await settle(pub);
  check('M2 forecast: a change of month comes in from the side it came from, without the page moving sideways', wentNext.includes('from-next') && wentBack.includes('from-prev') && steadyNext && steadyBack && await noSideways(), wentNext + ' | ' + wentBack);
  await tab(pub, 'today'); await tab(pub, 'calendar');
  check('M3 forecast: coming back to the tab does not replay it', (await calClass()).trim() === 'cal');
  await pub.emulateMedia({ reducedMotion: 'reduce' });
  check('M4 forecast, reduced motion: nothing animates and no day is left hidden', await pub.evaluate(() => [...document.querySelectorAll('#view *')].every(el => [null, '::before', '::after'].every(p => getComputedStyle(el, p).animationName === 'none'))
    && [...document.querySelectorAll('.cal .cell:not(.past)')].every(el => getComputedStyle(el).opacity === '1')));
  await pub.close();
  pub = await open('/calendar.html');
  await tab(pub, 'calendar');
  const rippled = (await calClass()).includes('enter');
  await pub.evaluate(() => { window.calBefore = document.querySelector('#view .cal'); });
  await pub.clock.runFor(5 * 60 * 1000 + 2000); await settle(pub);
  check('M5 forecast opened from the other tab: the ripple plays then, and a refresh that changes nothing leaves the grid alone', rippled && await pub.evaluate(() => window.calBefore === document.querySelector('#view .cal')));
  await pub.close();
  pub = await open('/calendar.html#calendar', '2026-10-31T03:00:00Z');   // Saturday 31 October: the next working day is in November
  check('M6 weekend at the end of a month: the Forecast opens on the month of the next working day, whose outline pulses without a glow', (await pub.locator('.cal-head h2').innerText()) === 'November 2026' && await pub.locator('.cal .is-next').count() === 1
    && await pub.evaluate(() => { const a = getComputedStyle(document.querySelector('.cell.is-next'), '::after'); return a.animationName === 'halo' && a.boxShadow.includes('inset'); }) && await pub.locator('#this').count() === 0);
  await pub.click('#next'); await settle(pub);
  check('M7 from there, the way back is named after the month it leads to', (await pub.locator('.cal-head h2').innerText()) === 'December 2026' && (await pub.locator('#this').innerText()) === 'November');
  await pub.close();
  // The card isn't drawn again when nothing changes, so its entrance must not replay when you come back to its tab.
  pub = await open('/calendar.html');
  await pub.clock.runFor(11 * 60 * 1000); await settle(pub);   // two routine refreshes that change nothing
  const entered = await pub.locator('#today.enter').count();
  await tab(pub, 'calendar'); await tab(pub, 'today');
  const replayed = await pub.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && /^(stop-in|rail-)/.test(a.animationName) && a.effect.target.closest && a.effect.target.closest('#today')).length);
  check('M8 coming back to the 2FA Login tab doesn\'t replay the card\'s entrance', entered === 1 && await pub.locator('#today.enter').count() === 0 && replayed === 0, JSON.stringify({ entered, replayed }));
  await pub.close();

  /* ---------- L. Two Secondaries stand side by side, and the card still looks right after a routine refresh ---------- */
  // The entrance plays on the first draw only; a refresh redraws the card without it. Nothing runs along the line.
  pub = await open('/calendar.html');
  await pub.evaluate(() => { const db = JSON.parse(localStorage.getItem('duty-roster-demo'));
    const keep = [document.querySelector('.hero-name .name').textContent, ...[...document.querySelectorAll('.backups .nm')].slice(0, 2).map(el => el.textContent)];
    db.profiles.filter(person => !keep.includes(person.display_name)).forEach((person, i) => db.leaves.push({ id: 950 + i, user_id: person.id, start_date: '2026-11-16', end_date: '2026-11-16', note: '' }));
    localStorage.setItem('duty-roster-demo', JSON.stringify(db)); });
  await pub.close();
  pub = await open('/calendar.html', NOW, flaky);
  const noGlint = () => pub.evaluate(() => [...document.querySelectorAll('.relay .rail')].every(rail => getComputedStyle(rail, '::after').content === 'none'));
  check('L1 two Secondaries: side by side on the card, with no glint on the line', await pub.locator('.hero-card .relay.pairs li').count() === 2 && await pub.locator('#today.enter').count() === 1 && await noGlint());
  // Tomorrow's Primary goes on leave (in the open page's store only), so Up next changes and the refresh has to draw the card again.
  await pub.evaluate(() => { const db = globalThis.__store.db;
    const tomorrow = db.profiles.find(person => person.display_name === document.querySelector('.next-duty').title);
    db.leaves.push({ id: 980, user_id: tomorrow.id, start_date: '2026-11-17', end_date: '2026-11-17', note: '' }); });
  const upNextBefore = await pub.locator('.next-duty').first().getAttribute('title');
  await pub.clock.runFor(5 * 60 * 1000 + 2000); await settle(pub);
  check('L2 after a routine refresh that changes something: redrawn without the entrance, still with no glint', await pub.locator('.hero-card .relay.pairs li').count() === 2 && await pub.locator('#today.enter').count() === 0 && await noGlint()
    && (await pub.locator('.next-duty').first().getAttribute('title')) !== upNextBefore, JSON.stringify({ pairs: await pub.locator('.hero-card .relay.pairs li').count(), enter: await pub.locator('#today.enter').count(), before: upNextBefore, after: await pub.locator('.next-duty').first().getAttribute('title') }));
  // A refresh that changes nothing leaves the card alone: the same card, keyboard focus still on the button, and the clock moved on.
  await pub.locator('a.btn.wa').focus();
  const handsBefore = await pub.evaluate(() => { window.cardBefore = document.querySelector('.hero-card'); return document.querySelector('.engineer .hands').getAttribute('d'); });
  await pub.clock.runFor(5 * 60 * 1000 + 2000); await settle(pub);
  check('L3 a refresh that changes nothing leaves the card alone: focus stays on the button, and the wall clock keeps time', await pub.evaluate(h => window.cardBefore === document.querySelector('.hero-card')
    && document.activeElement === document.querySelector('a.btn.wa') && document.querySelector('.engineer .hands').getAttribute('d') !== h, handsBefore));
  await pub.evaluate(() => { const db = JSON.parse(localStorage.getItem('duty-roster-demo')); db.leaves = db.leaves.filter(l => !(l.id >= 950 && l.id < 990)); localStorage.setItem('duty-roster-demo', JSON.stringify(db)); });
  await pub.close();

  /* ---------- N. A request that fails: the page says so, with Try again, and keeps refreshing ---------- */
  const heading = p => p.evaluate(() => (document.querySelector('.cal-head h2') || {}).textContent);
  const loadsFail = p => flaky(p).then(() => p.addInitScript(() => { globalThis.__failLoads = true; }));
  const cardShown = p => p.evaluate(() => !!document.querySelector('.hero-card .av.big') && !document.getElementById('retry-today'));
  // Part of the page (the Supabase client) doesn't download. The browser keeps the failed download, so only a reload tries again.
  cdn.down = true; let asked = cdn.asked;
  pub = await open('/calendar.html', NOW, flaky);
  check('N1 part of the page doesn\'t download: the card and the Forecast say so in plain words, with Try again, and nothing is left loading', (await pub.locator('#today .load-fail').innerText()).includes('Can’t load today’s 2FA Login')
    && await pub.locator('#retry-today').count() === 1 && await pub.locator('#view #retry-month').count() === 1 && await pub.locator('.loading').count() === 0, await pub.locator('#today').innerText());
  cdn.down = false;
  await Promise.all([pub.waitForEvent('load'), pub.click('#retry-today')]); await pub.clock.runFor(1200); await settle(pub);
  check('N2 Try again reloads the page, which downloads that part again and draws the card', cdn.asked - asked >= 2 && await cardShown(pub), 'asked ' + (cdn.asked - asked));
  await pub.close();
  cdn.down = true; asked = cdn.asked;
  pub = await open('/calendar.html', NOW, flaky);
  cdn.down = false;
  await pub.clock.runFor(5 * 60 * 1000 + 2000).catch(() => {}); await pub.waitForLoadState('load'); await pub.clock.runFor(1200); await settle(pub);
  check('N3 the routine refresh reloads such a page too, and the card arrives without a tap', cdn.asked - asked >= 2 && await cardShown(pub), 'asked ' + (cdn.asked - asked));
  await pub.close();
  // The requests themselves fail.
  pub = await open('/calendar.html', NOW, loadsFail);
  check('N4 a request that fails: the card says so, and so does the Forecast', (await pub.locator('#today .load-fail').innerText()).includes('Can’t load today’s 2FA Login') && await pub.locator('#view #retry-month').count() === 1);
  await pub.click('#retry-today');
  const busy = await pub.evaluate(() => { const b = document.getElementById('retry-today'); return b.disabled && b.textContent === 'Trying…'; });
  await pub.clock.runFor(700); await settle(pub);
  check('N5 Try again while it still fails: busy for a moment, then "Still can’t connect.", with focus back on Try again', busy && (await pub.locator('#today .load-fail').innerText()).includes('Still can’t connect.')
    && await pub.evaluate(() => document.activeElement.id) === 'retry-today' && (await pub.locator('#announce').textContent()) === 'Still can’t connect.', await pub.locator('#today').innerText());
  await pub.evaluate(() => { globalThis.__failLoads = false; });
  await pub.click('#retry-today'); await pub.clock.runFor(100); await settle(pub);
  check('N6 Try again draws the card, with focus on it, and the Forecast recovers with it', await cardShown(pub) && await pub.evaluate(() => document.activeElement.id) === 'today-h'
    && await pub.locator('#view .cal .cell.is-today').count() === 1 && await pub.locator('#view .cal-fail').count() === 0);
  await tab(pub, 'calendar');
  await pub.evaluate(() => { globalThis.__failLoads = true; });
  await pub.click('#next'); await settle(pub);
  check('N7 a month that fails to load says so under its name, with Try again and the month buttons, and focus on Try again', (await heading(pub)) === 'December 2026' && (await pub.locator('.cal-fail').innerText()).includes('Can’t load this month right now.')
    && await pub.evaluate(() => document.activeElement.id) === 'retry-month' && await pub.locator('#this').count() === 1 && await pub.locator('#today .hero-card').count() === 1, await pub.locator('#view').innerText());
  check('N7b its Try again is as easy to read as the card\'s', await pub.evaluate(() => getComputedStyle(document.getElementById('retry-month')).color === getComputedStyle(document.body).color));
  await pub.clock.runFor(5 * 60 * 1000 + 2000); await settle(pub);
  check('N8 while it still fails, the routine refresh leaves the message and focus alone, and the card stays', (await heading(pub)) === 'December 2026' && await pub.locator('.cal-fail').count() === 1
    && await pub.evaluate(() => document.activeElement.id) === 'retry-month' && await pub.locator('#today .hero-card').count() === 1);
  await pub.evaluate(() => { globalThis.__failLoads = false; });
  await pub.click('#retry-month'); await pub.clock.runFor(100); await settle(pub);
  check('N9 Try again draws that month', (await heading(pub)) === 'December 2026' && await pub.locator('.cal .cell').count() > 0 && await pub.locator('.cal-fail').count() === 0);
  await pub.evaluate(() => { globalThis.__failLoads = true; });
  await pub.click('#next'); await settle(pub);
  await pub.evaluate(() => { globalThis.__failLoads = false; dispatchEvent(new Event('online')); }); await pub.clock.runFor(100); await settle(pub);
  check('N10 back online, a month that failed draws by itself, with focus still in the Forecast', (await heading(pub)) === 'January 2027' && await pub.locator('.cal .cell').count() > 0
    && await pub.evaluate(() => document.getElementById('view').contains(document.activeElement)));
  await pub.close();
  // A request that never answers (a stalled connection) doesn't stop later refreshes.
  pub = await open('/calendar.html', NOW, flaky);
  await pub.evaluate(() => { globalThis.__delay = { '2026-11-16': 1e9 }; });   // the card's next request stalls
  await pub.clock.runFor(5 * 60 * 1000 + 1000);
  const stalledAt = await pub.evaluate(() => { globalThis.__delay = {}; return globalThis.__asked; });
  await pub.clock.runFor(10 * 60 * 1000); await settle(pub);
  check('N11 a request that never answers doesn\'t stop the refreshes after it', (await pub.evaluate(() => globalThis.__asked)) - stalledAt >= 4 && await cardShown(pub));
  await pub.close();

  /* ---------- O. The Forecast: answers that arrive late, where its days start and end, and the month changing ---------- */
  // These need a rotation that started long ago, so the public calendar's window is what limits the months.
  pub = await open('/calendar.html');
  const savedDb = await pub.evaluate(() => localStorage.getItem('duty-roster-demo'));
  const setStart = (page, date, only) => page.evaluate(([date, only]) => { const db = JSON.parse(localStorage.getItem('duty-roster-demo'));
    const cps = db.checkpoints.sort((x, y) => x.effective_date < y.effective_date ? -1 : 1);
    db.checkpoints = only ? [{ ...cps[cps.length - 1], effective_date: date }] : [{ ...cps[0], effective_date: date }, ...cps.slice(1)];
    db.settings.rota_start = date; localStorage.setItem('duty-roster-demo', JSON.stringify(db)); }, [date, only]);
  await setStart(pub, '2026-05-04'); await pub.close();
  pub = await open('/calendar.html#calendar', NOW, flaky);
  await pub.evaluate(() => { globalThis.__delay = { '2026-11-30': 2000 }; });   // December's grid starts on Monday 30 November
  await pub.click('#next'); await pub.clock.runFor(100);
  await pub.click('#prev'); await pub.clock.runFor(100); await settle(pub);
  const octoberFirst = await heading(pub);
  await pub.clock.runFor(2500); await settle(pub);
  check('O1 a month that answers late is not drawn over the month asked for since', octoberFirst === 'October 2026' && (await heading(pub)) === 'October 2026' && await pub.locator('.cal .cell:not(.out)').count() === 22, octoberFirst + ' then ' + await heading(pub));
  await pub.evaluate(() => { globalThis.__delay = {}; });
  await pub.click('#next'); await pub.clock.runFor(100); await settle(pub);
  check('O2 screen readers hear the new month', (await pub.locator('#announce').textContent()) === 'November 2026' && (await pub.locator('#announce').getAttribute('aria-live')) === 'polite');
  for (let i = 0; i < 8 && !(await pub.locator('#next').isDisabled()); i++) { await pub.click('#next'); await settle(pub); }
  check('O3 Next stops at the last month with duties, which says where they end', (await heading(pub)) === 'May 2027' && (await pub.locator('.cal-note').innerText()) === 'Duties are shown up to Fri, 14 May.'
    && await pub.evaluate(() => document.activeElement.id) === 'prev', (await heading(pub)) + ' / ' + await pub.locator('.cal-panel').innerText());
  await pub.click('#this'); await settle(pub);
  check('O4 the months in between have no note', (await heading(pub)) === 'November 2026' && await pub.locator('.cal-note').count() === 0);
  for (let i = 0; i < 8 && !(await pub.locator('#prev').isDisabled()); i++) { await pub.click('#prev'); await settle(pub); }
  check('O5 Prev stops at the first month with duties, which says where they start', (await heading(pub)) === 'August 2026' && (await pub.locator('.cal-note').innerText()) === 'Duties are shown from Tue, 18 Aug.', (await heading(pub)) + ' / ' + await pub.locator('.cal-panel').innerText());
  await pub.close();
  pub = await open('/calendar.html#calendar', '2026-11-30T15:58:00Z');   // Monday 30 November, 11:58pm
  const lateNovember = await heading(pub);
  await pub.clock.runFor(3 * 60 * 1000); await settle(pub);
  check('O6 left open on this month, the Forecast moves on to the new month after midnight, with today marked', lateNovember === 'November 2026' && (await heading(pub)) === 'December 2026'
    && (await pub.locator('.cal .cell.is-today .d').innerText()) === '1', lateNovember + ' then ' + await heading(pub));
  await pub.close();
  // A phone keeps focus on a button you tap: after Next and This month, focus is on Next, and the Forecast must still refresh.
  pub = await open('/calendar.html#calendar', '2026-11-30T15:58:00Z');
  await pub.click('#next'); await settle(pub); await pub.click('#this'); await settle(pub);
  const tapped = await pub.evaluate(() => document.activeElement.id);
  await pub.clock.runFor(3 * 60 * 1000); await settle(pub);
  check('O6b with focus left on a month button, the Forecast still refreshes and follows the month, and focus stays on the button', tapped === 'next' && (await heading(pub)) === 'December 2026'
    && (await pub.locator('.cal .cell.is-today .d').innerText()) === '1' && await pub.evaluate(() => document.activeElement.id) === 'next');
  await pub.close();
  pub = await open('/calendar.html#calendar', '2026-11-30T15:58:00Z');
  await pub.click('#prev'); await settle(pub);
  await pub.clock.runFor(3 * 60 * 1000); await settle(pub);
  check('O7 left open on another month, it stays there', (await heading(pub)) === 'October 2026');
  // A rotation that starts in the middle of a month: Prev stops there, and the month says when it starts.
  await setStart(pub, '2026-11-18', true); await pub.close();
  pub = await open('/calendar.html#calendar');
  check('O8 Prev stops at the month the rotation starts, which says when it starts', (await heading(pub)) === 'November 2026' && (await pub.locator('.cal-note').innerText()) === 'The rotation starts on Wed, 18 Nov.'
    && await pub.locator('#prev').isDisabled(), await pub.locator('.cal-panel').innerText());
  await pub.evaluate(db => localStorage.setItem('duty-roster-demo', db), savedDb);
  await pub.close();

  /* ---------- P. The room says what's true, and keeps time ---------- */
  pub = await open('/calendar.html', '2026-11-16T04:30:00Z');   // 12:30pm
  check('P1 lunchtime: the caption beside the Primary doesn\'t say they are away', (await pub.locator('.hero-caption').innerText()) === 'Lunch at the desk. Still happy to help.' && !/back at|away/i.test(await pub.locator('.engineer').textContent()));
  await pub.close();
  for (const [name, at, want] of [['P2 a weekday evening', '2026-11-17T11:00:00Z', 'Office closed. Opens at 9am tomorrow.'], ['P3 a Friday evening', '2026-11-20T11:00:00Z', 'Office closed. Opens at 9am Monday.'],
    ['P4 the eve of Christmas, a Thursday', '2026-12-24T11:00:00Z', 'Office closed. Opens at 9am Monday.']]) {
    pub = await open('/calendar.html', at);
    const said = await pub.locator('.hero-caption').innerText();
    check(name + ': the caption names the next duty day', said === want && (await pub.locator('.engineer').getAttribute('aria-label')) === want, said);
    await pub.close();
  }
  // With nobody available on the next working day, the room says only that the office is closed.
  pub = await open('/calendar.html', '2026-11-17T11:00:00Z', flaky);   // Tuesday, 7pm
  await pub.evaluate(() => { const db = globalThis.__store.db; db.profiles.forEach((person, i) => db.leaves.push({ id: 990 + i, user_id: person.id, start_date: '2026-11-18', end_date: '2026-11-18', note: '' })); });
  await pub.clock.runFor(5 * 60 * 1000 + 2000); await settle(pub);
  check('P4b nobody available tomorrow: "Office closed." and no time', (await pub.locator('.hero-caption').innerText()) === 'Office closed.', await pub.locator('.hero-caption').innerText());
  await pub.close();
  pub = await open('/calendar.html', '2026-11-16T03:59:30Z');   // 11:59:30am
  await pub.locator('a.btn.wa').focus();
  const morning = await pub.evaluate(() => { window.cardBefore = document.querySelector('.hero-card'); return document.querySelector('.engineer').getAttribute('class'); });
  await pub.clock.runFor(35000); await settle(pub);
  check('P5 at noon the scene turns to lunch by itself, in place: the same card, focus still on the button', morning.includes('scene-morning') && (await pub.locator('.engineer').getAttribute('class')).includes('scene-lunch')
    && await pub.evaluate(() => window.cardBefore === document.querySelector('.hero-card') && document.activeElement === document.querySelector('a.btn.wa')));
  const hands = () => pub.evaluate(() => document.querySelector('.engineer .hands').getAttribute('d'));
  const noon = await hands(); await pub.clock.runFor(60000); await settle(pub);
  check('P6 the wall clock\'s hands move every minute', (await hands()) !== noon);
  await pub.close();

  /* ---------- H. A working day when nobody is available ---------- */
  pub = await open('/calendar.html');
  await pub.evaluate(() => { const db = JSON.parse(localStorage.getItem('duty-roster-demo'));
    db.profiles.forEach((person, i) => db.leaves.push({ id: 900 + i, user_id: person.id, start_date: '2026-11-16', end_date: '2026-11-16', note: '' }));
    localStorage.setItem('duty-roster-demo', JSON.stringify(db)); });
  await pub.close();
  pub = await open('/calendar.html');
  check('H1 nobody today: the card says so, with no face and no Secondaries', (await pub.locator('.hero-name .eyebrow').textContent()) === 'No duty cover today' && (await pub.locator('.hero-none').innerText()) === 'No one is available for duty.' && await pub.locator('.av.big, .backups').count() === 0, await pub.locator('.hero-name').innerText());
  check('H2 nobody today: the room has its lights off', (await pub.locator('.engineer').getAttribute('class')).includes('scene-nobody') && (await pub.locator('.hero-caption').innerText()) === 'No one on duty today. The servers keep watch.');
  const news = decodeURIComponent((await pub.locator('a.btn.wa').getAttribute('href')).replace('https://wa.me/?text=', ''));
  check('H3 nobody today: the button shares the news instead of offering an OTP', (await pub.locator('a.btn.wa').innerText()).trim() === 'Tell the team on WhatsApp' && news.includes('No one is available for duty.'), await pub.locator('a.btn.wa').innerText());
  check('H4 nobody today: the red card lists today, and Up next shows tomorrow\'s duty', (await pub.locator('.gap-list li').first().innerText()).replace(/\s+/g, ' ') === 'Monday, 16 November Today' && (await pub.locator('.next-duty .when').first().textContent()) === 'Tomorrow' && !(await pub.locator('.next-duty').first().getAttribute('class')).includes('none'), await pub.locator('.gap-list').innerText());
  await tab(pub, 'calendar');
  check('H5 nobody today: the calendar says "No one available"', (await cell(pub, 16).locator('.nobody').innerText()) === 'No one available' && await cell(pub, 16).locator('.duty-list').count() === 0);
  await pub.close();
  app = await open('/index.html');
  check('H6 nobody today: the signed-in page says so too', (await app.locator('.role-head .role').innerText()) === 'On leave' && (await app.locator('#share-wa').innerText()).trim() === 'Tell the team on WhatsApp' && await app.locator('.lineup li.away').count() === await app.locator('.lineup li').count() && (await app.locator('.role-card').innerText()).includes('No one is available for duty.'));
  await app.close();

  // (The browser reports the download that N1 to N3 drop on purpose; nothing else may show an error.)
  const unexpected = errors.filter(e => !/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/.test(e));
  check('Z no errors in the browser console during the whole pass', unexpected.length === 0, [...new Set(unexpected)].join(' || '));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
  await b.close(); server.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('The check itself broke:', e); process.exit(1); });
