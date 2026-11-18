# Rebuild spec: "2FA Login Request" duty roster

This document describes the app in enough detail for another AI model (or a developer) to rebuild it from scratch with the same behaviour and look. Give it this whole file as the brief.

---

## 1. What it is

A daily duty rotation for a small team in Singapore. Each working day, every available person gets a role: **Primary**, then **Secondary 1, 2, 3…** The Primary is the person colleagues ask for an **OTP (one-time password) to log in**. Secondaries are the backups, in order.

There are two pages:

| Page | File | Who | Purpose |
|---|---|---|---|
| Signed-in app | `index.html` → `src/app.js` | Team members | Roster, add and manage leave, team and settings (admins) |
| Public page | `calendar.html` → `src/calendar.js` | Anyone with the link, no login | Today's "2FA Login" card and a month "Calendar Forecast" |

The public page only ever receives **names and roles**: never emails, ids, leave dates or notes.

---

## 2. Tech stack and constraints

- **Plain HTML + native ES modules.** No framework, no bundler, no build step, no linter.
- **Hosting:** GitHub Pages, served from the `main` branch at the repo root. Include an empty `.nojekyll` file.
- **Backend:** Supabase (Postgres, auth, row-level security). The Supabase JS client is loaded from a CDN as an ES module.
- **Demo mode:** if `config.js` has no URL or key, the app runs entirely in the browser on `localStorage` with five example people. Demo mode must behave like production: it refuses what the database refuses, in the same words (§6).
- **Tests:** `node --test` (built-in Node test runner), files in `tests/*.test.mjs`.
- **`package.json` scripts:**
  ```json
  { "type": "module",
    "scripts": {
      "test": "node --test",
      "start": "npx --yes http-server@14.1.1 . -p 5173 -c-1",
      "stamp": "node scripts/stamp.mjs" } }
  ```
- **Timezone:** everything uses **Singapore dates**. Dates are `YYYY-MM-DD` strings everywhere, and the answers must not depend on the viewer's timezone:
  - Today in Singapore is the current time plus a fixed 8 hours (Singapore has no daylight saving), read as a UTC date.
  - Date arithmetic (adding days, counting days between two dates, weekday or weekend) works on UTC dates (`Date.UTC(y, m-1, d)`), so daylight saving can never skip or repeat a day.
  - For display, parse a date string as local noon (`new Date(y, m-1, d, 12)`) and format it with `toLocaleDateString('en-SG', …)`.
- **Writing style for all UI text:** plain, friendly, sentence case, short sentences.

---

## 3. File layout

```
index.html                 signed-in app shell
calendar.html              public page shell
config.js                  export const SUPABASE_URL = '...'; export const SUPABASE_ANON_KEY = '...';
styles.css                 the only stylesheet
manifest files / icons     (optional; currently not used)
src/
  app.js                   signed-in app: rendering and actions
  calendar.js              public page
  schedule.js              PURE rotation logic and helpers (no DOM), fully unit-tested
  store.js                 SupabaseStore and DemoStore, same methods
  connect.js               createStore(): Supabase if configured, else Demo
  engineer.js              animated SVG "infra engineer" scene, picked by Singapore time
  faces.js                 drawn face SVG generated from a name (avatars on both pages)
  holidays-sg.js           Singapore public holidays 2026–2027 for demo mode
  live.js                  keepFresh(): auto-refresh plus a "new version available" bar
  swipe.js                 swipe left or right on phones to change tabs, plus a one-time peek hint
scripts/
  stamp.mjs                cache-busting version stamp (see §10)
  leave-invites.gs         Google Apps Script: Outlook invites become leave (see §8)
  ui-check.cjs             Playwright check of both pages in demo mode (see §12)
  shots.cjs                Playwright pictures of every state of the 2FA Login card
supabase/
  schema.sql, 003_private_data.sql, 004_stable_history.sql, 006_hardening.sql, 011_leave_invites.sql
tests/
  schedule.test.mjs        rotation, window clipping, office hours, scenes, message wording
  history.test.mjs         checkpoints: today's Primary stays, past corrections, evening changes, self-heal
  dates.test.mjs           date helpers in several timezones
  store.test.mjs           DemoStore refuses what the database refuses; SupabaseStore against a stand-in client
```

---

## 4. The rotation algorithm (most important part)

Implement it in `src/schedule.js` as pure functions. Implement **the same algorithm again in SQL** as `public_calendar()` for the public page. The two must always agree.

### Rules
1. Active, approved members stand in a fixed **circle**, ordered by `rota_order`.
2. Only **working days** count: Monday to Friday, minus public holidays.
3. On each working day a **pointer** marks whose turn it is. Walk the circle from the pointer:
   - People **on leave** that day are skipped and listed separately as "on leave".
   - The first available person is **Primary**, the next is **Secondary 1**, and so on, so everyone available gets a role.
4. The next working day, the pointer moves to the person **after** today's Primary in the circle (not after the pointer). If the person whose turn it was is on leave, they miss Primary, and no one does Primary twice in a row.
5. Weekends, holidays and days before the start produce entries with no duties.

### Checkpoints (stable history)
Changing the team must never rewrite past days. A **rota checkpoint** is `{ effective_date, member_order: [profile ids], next_primary: id }`, meaning: "from this date, the circle is this order and the next working day starts with this person."

- The walk starts at the earliest checkpoint. When it reaches a checkpoint's date, it replaces the circle with that order and sets the pointer to `next_primary`.
- **Today's Primary stays as announced.** The team is told who is on duty, so no change made today may hand today's duty to someone else, and from 6pm the same goes for the next working day's (the public card already shows "Next on duty · 9am tomorrow").
- Whenever an admin **approves, deactivates or reactivates, reorders, or removes access for** people, the app saves the checkpoints returned by `rotaChange(p, today, order, { afterHours })` (`recordRotaChange`; `afterHours` is true from 6pm on a working day):
  - Nothing, if the checkpoint in effect today and every checkpoint saved for a later day already have this order.
  - A checkpoint dated today from `checkpointFor(p, date, newOrder)`. It builds on the rotation as it stands, including a checkpoint already saved for that date (which it replaces), so a second change on the same day keeps what the first left:
    - On a working day, that day's actual Primary stays next if they are still in the new order.
    - On a day with no Primary (a weekend, say), an earlier change that day may have taken off the person whose turn it was. If they are back in the new order, they are next again, so deactivating and reactivating someone at the weekend undoes itself.
    - Otherwise whoever's turn it is stays next, or the next person after them who is still in the new order.
    - Before anyone has been on duty, the first checkpoint just takes the new order.
  - Every checkpoint already saved for a later day, re-made in the new order with `checkpointFor` (so it keeps its Primary).
  - With `afterHours`, a checkpoint on the next working day that keeps its announced Primary, if they stay in the order and the new order would otherwise change them.
  - Later days' checkpoints are saved before today's, so if saving stops part way, today's is the one missing and the self-heal below finishes the job.
- **Corrections to past days.** An admin adding or removing leave or a holiday on days before today would otherwise move every later day's duties, today's Primary included. `pastEdit(before, after, first, last, today)` compares the rotation without and with the correction:
  - `changed`: the past working days whose duties change. If there are none, no question and no checkpoint.
  - `checkpoints`: one dated the day after the corrected days (today at the latest), worked out from the rotation before the correction with the order in effect that day, so only the corrected days change. None if a checkpoint is already saved on that day. Data saved before checkpoints existed first gets the checkpoint it stood for.
  - `day`, `was`, `now`: the next working day from today and its Primary before and after, for the question.
  
  The app asks first ("Remove Deepavali (Observed)? This changes duties on Mon, 9 Nov only. Today's Primary stays Ben."), then saves the checkpoint, then makes the change. The trade-off: a Primary recorded as away after the fact doesn't get the turn back.
- **Self-heal.** If the rotation and the active, approved team disagree (an approval saved but its checkpoint lost to a dropped connection, or a fresh install's first admin not in the rotation yet), an admin's page saves the missing change itself after a complete load. `shouldHeal(d, today, opts)` decides: an approved admin, complete data (team, leave, holidays, settings and at least one saved checkpoint, with the admin among the team), and `rotaChange` has something to save. The page tries at most five times a Singapore day, remembers a heal only once it worked, and never runs two at once.
- **Rotation writes take turns** (one promise chain), each on freshly loaded data, so an admin's change and the self-heal can't both save from the same stale picture.
- **Known limits:** "End early (back today)" saves no checkpoint, so it can still change today's Primary. After a Friday-evening change has saved Monday's checkpoint, deactivating and reactivating Monday's announced Primary at the weekend doesn't give them Monday back.
- All of this saves ordinary checkpoints, which `public_calendar()` already reads, so the SQL needs no change for it.
- **"Restart rotation"** (admin) replaces all checkpoints with a single one: `{ start, order, order[0] }`. Against the database it is three requests, ordered so a dropped connection never leaves the rotation without history: upsert the new checkpoint, set the start date, and only then delete every other checkpoint. Saving again finishes an interrupted restart. It asks first, with first names:
  - a past start: "Restart the rotation from Mon, 2 Nov? Days before it are cleared, and duties from then on are worked out again. Today's Primary changes from Alice to Chloe." (or "stays Alice")
  - a future start: "Restart the rotation on Mon, 30 Nov? No one will be on duty until then, and earlier days will no longer show who was on duty. Alice will be Primary first."

### Functions to export from `schedule.js`
- `toISO(date)`, `fromISO(iso)` (local noon, for display), and in UTC: `addDays(iso, n)`, `isWeekend(iso)`, `daysBetween(a, b)` (whole days, like `b - a` on SQL dates)
- `roleName(i)`: 0 → `'Primary'`, otherwise `'Secondary ' + i`
- `onRota(profile)`: `active && approved !== false`
- `byRota` (sort by `rota_order`, then sign-up time, then id, as in SQL), `rotaOrder(data)` (ids of the active, approved team in that order), `rotaParams(data)` (the rotation as `buildSchedule` takes it, from loaded data)
- `buildSchedule({ members, leaves, holidays, anchor, checkpoints, people, from, to })` returns one entry per calendar day:
  `{ date, kind: 'work'|'weekend'|'holiday'|'before-start', holiday?, duties: [{ role, member }], onLeave: [member] }`
- `checkpointFor(p, date, newOrder)`, `rotaChange(p, date, order, { afterHours })`, `pastEdit(before, after, first, last, today)` → `{ checkpoints, changed, day, was, now }`, `shouldHeal(d, today, opts)` (all described above)
- `publicCalendar({..., from, to, today})` is the JS mirror of the SQL function. It clips the window to 90 days back and 180 days ahead, at most 62 days per request, and returns `{ rota_start, from, to, people: [names], days: [{date, kind, duties:[{role,name}] | holiday}] }`.
- `todaySG(now = Date.now())`: `new Date(+now + 8 * 3600e3).toISOString().slice(0, 10)`
- `rosterMessage(day, calendarUrl, { ask = true })` is the WhatsApp text. Tests assert this wording exactly:
  ```
  2FA Login Request · Mon, 16 Nov
  Primary: Alice Tan
  Secondary 1: Ben Lim
  ...

  Hi Alice Tan (Primary), may we have OTP login for ...
  Calendar: https://.../calendar.html
  ```
  If no one is available, the line reads "No one is available for duty." Leave is never included. With `ask: false` (the Primary sharing it themselves) the blank line and the "Hi …" line are left out.
- `whatsappLink(text)`: `'https://wa.me/?text=' + encodeURIComponent(text)` (the user picks the chat).
- `WHATSAPP_ICON`: inline SVG of the WhatsApp logo (Simple Icons, CC0), class `wa-icon`.
- `shortName(name, names)`: the first name, for tight spaces; the full name when two people in `names` share that first name.

### Tests to write
`tests/schedule.test.mjs` (about 20):
- Basic rotation order.
- Weekends and holidays are skipped.
- A Primary on leave is skipped; the next person takes Primary and the pointer moves past *them*.
- Everyone on leave gives an empty day.
- A checkpoint keeps earlier days unchanged after reordering, deactivating or approving.
- `publicCalendar` window clipping (90, 180 and 62 days).
- The exact `rosterMessage` wording, with and without the ask.
- Office hours, the scene for the time of day, and the scene captions.

`tests/history.test.mjs` (about 20): a past holiday removed or added, and past leave for a Primary or a Secondary, change only those days and keep today's Primary; approving someone while the person whose turn it is is on leave; two changes on one day; evening changes (Wednesday to Thursday, Friday to Monday, before a holiday, two in one evening, deactivating tomorrow's announced Primary, a weekend change re-saving Monday's checkpoint); weekend undo; `shouldHeal`'s guards; a later checkpoint left in an old order is put right.

`tests/dates.test.mjs`: `todaySG`, `addDays`, `daysBetween` and `isWeekend` give the same answers in about ten timezones (set `process.env.TZ` in-process; Node applies it at once), across Singapore midnight and daylight-saving changes.

---

## 5. Database (Supabase)

The owner pastes each SQL file into the Supabase SQL Editor, in this order: `schema.sql`, `003_private_data.sql`, `004_stable_history.sql`, `006_hardening.sql`, `011_leave_invites.sql`. For a rebuild you may merge them into one file. Every file must be **safe to run twice** (`if not exists`, `create or replace`, `drop policy if exists`).

### Tables
```sql
profiles (id uuid pk -> auth.users on delete cascade, email text, display_name text (1–60 chars),
          rota_order int, active bool default true, is_admin bool default false,
          approved bool default false, work_email text (unique, case-insensitive), created_at)
leaves   (id bigint identity pk, user_id uuid -> profiles cascade, start_date date, end_date date
          (end >= start), note text (≤120), invite_uid text unique,
          from_invite bool generated always as (invite_uid is not null) stored, created_at)
holidays (date date pk, name text (1–60))
settings (id int pk = 1 (single row), rota_start date, public_calendar bool default true, invite_address text)
rota_checkpoints (effective_date date pk, member_order uuid[], next_primary uuid)
unmatched_invites (uid text pk, organizer text, title text, start_date, end_date, seen_at, dismissed bool)
invite_config (id int pk = 1, script_secret uuid default gen_random_uuid(), last_sync timestamptz)
```

### Functions and triggers
- `is_admin()` and `is_member()` (approved): `security definer`, `stable`.
- `sg_today()`: `(now() at time zone 'Asia/Singapore')::date`.
- `handle_new_user()` runs on `auth.users` insert. It creates the profile, taking the display name from signup metadata or the email prefix (max 60 characters), with `rota_order = max+1`. **The first user ever becomes admin and is approved.** Everyone else waits for approval. Use an advisory lock so two simultaneous signups can't both become "first".
- `protect_profile_fields()` (before update): if the caller is signed in and not an admin, silently revert `is_admin`, `rota_order`, `active`, `email` and `approved`. Non-admins can change only their own display name.
- `enforce_leave_rules()` (before insert, update and delete on leaves; the `006_hardening.sql` version) applies to signed-in non-admins:
  - No adding leave that starts before today.
  - No moving the start of leave that has begun (or moving a start into the past).
  - No deleting leave that has already begun; it can only be shortened to end yesterday at the earliest.
  - At most 180 days per booking, and starting at most 365 days ahead, checked on inserts and on updates that make leave longer or move it, so shortening leave an admin recorded always works.
  - Admins, and server-side work with no signed-in user, are exempt from all of these.
- `set_rota_order(ids uuid[])`: admin only; saves the whole order in one transaction.
- `member_emails()` and `leave_notes()`: emails and notes are **hidden by column grants**. These security-definer functions return them only to admins, or to the person themself.
- `member_work_emails()` and `set_work_email(p_user, p_email)`:
  - Approved members can set their own work email; admins can set anyone's.
  - The email is validated, and must not belong to anyone else.
  - Setting it clears matching `unmatched_invites`.
- `public_calendar(p_from, p_to)` returns JSON, is callable by `anon`, and returns `null` when `settings.public_calendar` is false.
  - It clips the window to 90 days back and 180 ahead (based on `sg_today()`), with at most 62 days per call.
  - It reimplements the rotation with checkpoints and returns names and roles only (same shape as the JS `publicCalendar`).
- `sync_leave_invites(p_secret uuid, p_events json)`: see §8.

### Row-level security
- Enable RLS on every table.
- Approved members can read profiles, leaves, holidays, settings and checkpoints. People awaiting approval see only their own profile.
- Leaves: insert, update and delete your own (admins can do anyone's).
- Holidays, settings, checkpoints and deleting profiles: admins only.
- Every function gets explicit `revoke … from public, anon` plus `grant … to authenticated` (and `anon` only for `public_calendar` and `sync_leave_invites`).

### Seed data
Seed Singapore public holidays for 2026–2027 from the Ministry of Manpower dataset (data.gov.sg collection 691), including "(Observed)" days.

### Store gotchas
- RLS silently skips forbidden rows, and the protect trigger silently reverts fields. So every update and delete in `SupabaseStore` ends with `.select()` and checks that rows actually changed ("That change wasn't saved. You may not have permission, or it was already removed. The page has been refreshed."). `updateProfile` compares the returned row to the patch, and if they differ says "Only admins can make that change. The page has been refreshed."
- Postgres's own refusals are not for people. `plainError(message)` turns them into plain words, the same in both stores, and `console.warn` logs the original (its table or constraint name is the owner's clue to an update not run): row-level security and foreign keys → "That change wasn't saved…"; each check constraint its own sentence ("Please enter a name of up to 60 characters.", "A note can be at most 120 characters.", "The end date is before the start date.", and so on), an unknown one "That change wasn't saved. Check what you entered and try again."; a duplicate "That date already has a holiday.", "That email already belongs to someone else on the roster." or "That change wasn't saved. It's already there."; not-null, bad dates, over-long values, and "JWT expired" → "Your sign-in needed renewing. Please try again." Messages the database writes for people (the leave rules, `set_work_email`, `set_rota_order`) and anything unrecognised pass through.

---

## 6. Data layer (`src/store.js`, `src/connect.js`)

Two classes with **identical methods**:

`userId, onAuthChange(cb), signIn(email, pw), signUp(email, pw, name) → {needsConfirmation}, signOut, load() → { me, profiles, leaves, holidays, settings, checkpoints, unmatched }, loadPublic(from, to), addLeave(row), updateLeave(id, patch), deleteLeave(id), updateProfile(id, patch), deleteProfile(id), setRotaOrder(ids), saveCheckpoint(cp), resetRotation(start, order), addHoliday(date, name), deleteHoliday(date), updateSettings(patch), setWorkEmail(userId, email), dismissInvite(uid)`

**DemoStore:**
- Data lives in `localStorage` (wrap every access in try/catch).
- Seeds five approved people: Alice Tan (admin), Ben Lim, Chloe Ng, Dev Kumar and Elena Goh, with emails `first@example.com`, a rotation starting today, the SG holidays, and one example leave for Ben tomorrow in Singapore ("Example: medical appointment").
- `signIn(email)` accepts any password. `signUp` works like `handle_new_user()`: the name is trimmed (the email's first part if empty) and cut to 60 characters, and only the very first account is the approved admin.
- Mirrors the database, checked in the database's order (row-level security on the rows a write can reach, then triggers, then row-level security on the new row, then check constraints by name), and ends with the **words production shows**:
  - Row-level security: everyone reaches their own profile, approved members their own leave, admins everything. People awaiting approval see only their own profile, no leave and no checkpoints, and can't add leave or set a work email. Emails, work emails and leave notes come only to their owner and to admins.
  - Where the database skips a write quietly (a row you can't reach, already gone), "That change wasn't saved…"; where `protect_profile_fields()` quietly keeps a field, "Only admins can make that change…" (a name in the same change is still saved).
  - The leave rules above in full, counting days on the dates themselves; the name, holiday-name and note limits, blank names, end before start, and work emails over 254 characters; Postgres's own messages go through `plainError`.

**SupabaseStore.signOut:** supabase-js returns a network error from `signOut()` before it removes the stored session, so offline nothing happened. When it returns an error, remove `localStorage[sb.auth.storageKey]` yourself, so Sign out always works.

**Store tests** (`tests/store.test.mjs`) fake `localStorage` and check that DemoStore refuses what the database refuses, in the same words as SupabaseStore (driven by a stand-in Supabase client).

---

## 7. UI and behaviour

### Shared
- **Header** (sticky, blurred background): a single compact row with no title text, 48px tall.
  - On the left, a **pill-shaped tab bar**; the selected tab is filled with a calm deep teal (`#1b4459`), not the accent. The tabs look 32px tall (text .9rem) inside a 38px pill, but each takes taps over 44px through an invisible `::before`, running from the top of the bar to 4px above its bottom, so even a phone's tap correction doesn't pull taps meant for the content below onto the bar. The pill has no overflow (so those tap areas and focus rings aren't clipped); at 340px and below (and again below 300px, for zoomed text) the tabs and Sign in get less side padding, and below 280px the pill scrolls sideways only. The phone's own tap flash is off on these controls (it would light up the invisible tap areas); a press lightens the visible tab or Sign in, and the face shrinks a little.
  - On the right: "Sign in" (public page; a bordered pill as tall as the tab pill, 44px to tap), or a round **avatar button** showing your face (app; 32px with its ring, 44px to tap, focus ring 5px out so it clears the cyan ring). The avatar opens a menu showing "Signed in as \<name\>" (with an "Admin" badge for admins), Calendar and Sign out. The menu closes on Escape or a click outside.
  - Long tab labels have a phone version: `<span class="tab-long">Calendar Forecast</span><span class="tab-short">Forecast</span>`; admins' "Team & settings" becomes "Team".
- **Swiping (phones):** a horizontal swipe clicks the next or previous `[data-tab]`.
  - Thresholds: at least 60px, mostly horizontal, under 700ms.
  - Ignore swipes that start within 24px of the screen edge, swipes on form fields, swipes while text is selected, and swipes while someone is typing: focus in a text box, or (in the app) a text field or list whose value differs from what was drawn. A focused tick, button or list doesn't count.
  - New content slides in from the side the finger moved from.
  - On the first visit on a phone, play a one-time "peek": the page nudges left and a slim cyan edge card with a › arrow slides in, then everything springs back. Remember it in `localStorage` as `swipePeekSeen`.
  - Skip all animation under `prefers-reduced-motion`.
- **Staying fresh (`live.js`):**
  - Re-fetch data when the tab becomes visible, every 5 minutes, and just after Singapore midnight. The app refreshes even while someone is typing, but never redraws under them: it keeps the new data and draws it when they stop. One refresh runs at a time, but one that hasn't finished after 25 seconds (a stalled connection) is given up on, so the next can run.
  - Both pages also switch over by themselves at 9am and 6pm, and catch up at once when the browser comes back online.
  - Also fetch the page's own HTML and compare the `?v=` stamp. If it differs, show a bar: "A new version of the app is available. [Reload]".
- **Accessibility:**
  - Each page has a polite `aria-live` region (`#announce`): toasts, a new month in the Forecast and "Still can't connect." are read out through it.
  - After a redraw, keyboard focus returns to the same control (find it by id or data attribute), or to the section heading if the control is gone. Every submit button has an id for this.
  - Buttons that act are disabled while busy (`aria-busy`).
  - Short roles on screen ("P", "S1") are read in full ("Primary", "Secondary 1").
  - Form fields are 16px (`font-size: 1rem`): anything smaller makes an iPhone zoom in when you tap it.

### Public page (`calendar.html`)
Two tabs: **2FA Login** and **Calendar Forecast** (`#calendar` in the URL opens the second).

**2FA Login tab.** One card leads, with the rest beside it on wide screens (880px and up) and under it on phones:
1. **The card** (`.hero-card`), from top to bottom:
   - **The engineer scene** (`engineer.js`): an animated SVG (viewBox 358×196) of one room, chosen by Singapore time:
     - before 6:00 or from 23:00: lights off, the on-call phone glowing on the desk
     - morning (to 12:00): typing at code, with a steaming mug
     - lunch (12–14): eating noodles at the desk, screen says "Lunchtime / Still on duty"
     - afternoon (to 17:30): dashboards with moving bars
     - evening (to 19:00): stretching, "Last stretch" on the screen; caption "Last stretch. On duty till 6pm." (not "wrapping up": the Primary is on duty till 6)
     - after work: the room dim, a desk lamp on, the on-call phone in hand
     - weekends and public holidays: lights off, nobody in

     The window shows a sky that matches the time of day (sunrise, sun, sunset, moon, stars) and its light falls across the floor. The wall clock shows the real Singapore time; its two hands are one path (`clockHands(now)`), which the page moves in place every minute. A server rack with blinking LEDs and a pulsing padlock sits on the right. Each scene has a one-line caption, for example "Good morning! Coffee first, then the servers." Captions must say what's true (the owner's rule): duty runs 9am to 6pm with lunch included, so lunch is "Lunch at the desk. Ask anytime." and nothing on the card suggests the Primary is away. `engineerScene(period, now, { opens })` returns `{ period, caption, svg }`; with no period it picks the one `now` falls in. `?scene=lunch` forces a scene for previews. The hoodie colour comes from CSS variables `--hoodie`, `--hoodie-light` and `--hoodie-dark`, set as an inline `style="fill:var(--hoodie)"` because SVG attributes can't hold `var()`. All animation stops under reduced motion.
   - **Today's date** on a small sign over the scene's wall ("MON 16 NOV"): an HTML label positioned over the SVG.
   - **The Primary**: their drawn face (`faces.js`) in a large circle (5.5rem across; 7rem on wide cards; 5rem on the narrowest phones) with a cyan ring and a padlock badge, standing on the bottom edge of the scene. The scene's caption is written on the scene's floor, beside the face. Under the scene and beside the face: the label "Primary · ask for OTP" and the name in very large bold type (a long name, or one with a long word in it, is set smaller, so it stays on a few lines).
   - **The Secondaries, on the same card, as a rail.** A line drops from the Primary's face, turns, and runs through each Secondary in backup order: the look of the Up next timeline, with faces. Each stop is a face in a steel-blue ring with a number badge (1, 2, 3…), the name, and "Secondary 1" under it. The line leaves the Primary cyan and fades to steel blue (`--steel`); the stops are never cyan.
     - One or two Secondaries: each name and role stand beside the face, and the line runs on between them. If the names don't fit that way (a small phone, long names), they go under the faces instead.
     - Three or more: names under the faces, up to four stops to a row on phones, three on phones under about 370px wide, six on wide cards, and two on cards under 280px (a phone with its text zoomed, where the roles are also a size smaller). On phones the stops are never more than 8rem apart, so a short rail stays near the Primary. If a full name doesn't fit under its stop, the whole rail shows first names (`shortName()`); the full name stays in the markup for screen readers and as a tooltip. Names are never cut short: a first name that still doesn't fit, or a word of the Primary's name too wide beside the face, is set smaller step by step (rail names down to 9px, the Primary's to 14px), measured with words kept whole, and hyphenated only as a last resort. Measure from the layout, not the drawn boxes: on the first draw the entrance still holds each stop scaled down.
     - More stops than fit one row: the line carries on down the side and turns into each further row, so every row leaves the same line.
     - On wide cards (520px and up, measured on the card itself with a container query) the name and the button stand together beside the face, and the rail closes the card across its full width.
     - The first time the card is drawn the line draws itself and the stops arrive in order; after that, every 5 seconds, the Primary's ring glows softly. Nothing travels along the line (no glint). None of it runs under reduced motion.
     - The card is drawn after each load and every minute, but only redrawn when something other than the clock's hands has changed, so keyboard focus and running animations are left alone: the hands move in place, and a new part of the day swaps only the scene. A redraw, and leaving the tab, drop the entrance, so it plays once. A redraw keeps focus on the WhatsApp button if it was there.
     - With no Secondaries there is no rail, and the button follows the name.
   - On a weekend or holiday: the same layout as outside office hours, with no big face: a red label "NO DUTY TODAY", the reason in bold ("It's the weekend." or "Public holiday: X."), a "NEXT ON DUTY · 9AM TOMORROW" (or the date) box with that Primary and that day's Secondaries, and the button "Tell the team on WhatsApp".
   - A big green button, "Click for OTP on WhatsApp", opens `whatsappLink(rosterMessage(day, calendarUrl))`. It is bright green with dark text and a slow glow. On phones it comes after the Secondaries, so the card reads: Primary, Secondaries, button. On cards under 280px its words wrap inside it, and a caption longer than the scene's floor runs on below the scene instead of over the room.
   - Outside office hours (9am to 6pm, Singapore) on a working day: the lights-off room captioned with when the office opens, from the real next duty day: "Office closed. Opens at 9am." (before 9am), "… at 9am tomorrow.", "… at 9am Monday." (within the week) or "… at 9am on Tue, 24 Nov."; just "Office closed." when nobody is available that day (it is the office that opens, not a person who comes back). No big face, a red label "OUTSIDE OFFICE HOURS", "No one is on duty now.", "Office hours are 9am to 6pm on working days.", then a box "NEXT ON DUTY · 9AM TODAY" (or tomorrow, or the date) with that Primary's face and name and, under them, that day's Secondaries on a smaller, quieter rail (still with their numbers, names and roles), and the button "Tell the team on WhatsApp". From 6pm the next cover, Secondaries and Up next use the next working day, and the "No one is available on:" list starts tomorrow; the WhatsApp message stays about today until midnight, with its usual ask (the owner's choice). The page switches over by itself at 9am and 6pm.
   - On a working day when nobody is available: the lights-off room with the caption "No one on duty today. The servers keep watch.", no face, a red label "NO DUTY COVER TODAY", the line "No one is available for duty." in bold, and the button reads "Tell the team on WhatsApp" (the same link; its message says "No one is available for duty.").
2. **Up next**: the Primary on each of the three working days after the one the card shows (outside office hours, when the card shows tomorrow, starting the day after), side by side in three tiles: a dot and the day ("TOMORROW", "WED 18") on top, the first name in bold under it. Every 5 seconds a soft band of white light glints across the tiles from left to right, and as it passes each tile its dot lights up and its edge glows (none of it under reduced motion). A day with nobody says "No one" in red, with a red dot and no glint. At 340px and below the names are a size smaller; the three tiles stack (one per row, full size) only when a day doesn't fit its tile there, or a first name doesn't below 300px (measured), so on real phones a very long first name ends in "…".
3. **"No one is available on:" card**, shown only if some upcoming working day has an empty duty list. It is red, and each date is a row with the full date and how soon it is ("in 9 days").

A working day with nobody available is a red cell (the gaps card's colours) with a warning sign and "No one available"; when it is today it keeps the cyan outline around the red.

Motion on the Forecast (none of it under reduced motion): the first time the tab is on screen the days ripple in from today's cell outwards (each rises 8px and fades in over .34s, 40ms later per cell of distance); a change of month brings the days in from the side it came from (20px, nearest column first); every 5 seconds today's cell swells its glow and a glint passes under today's Primary's name (at weekends the "Next" cell brightens its outline instead, with no glow), and returning to the current month plays the glow at once. Arriving by a swipe plays the swipe's slide only. The Forecast opens on the month that holds the next working day. There the "This month" button, when shown, is named after that month ("November").

The card loads `loadPublic(today, today + 60)`; each Forecast month loads its own grid's days. If that returns `null`, show "The public calendar is switched off".

**Loading and failures.** The card and the month load at the same time, each on its own, so one slow or failed request doesn't hold up the other:
- A card that can't load says "Can't load today's 2FA Login" with "Check your connection, then try again." and a Try again button; a month that can't load keeps its name and month buttons and says "Can't load this month right now. Check your connection, then try again." with Try again. Try again shows "Trying…" while busy; if it fails again it waits at least 600ms, adds "Still can't connect.", announces it and keeps focus on Try again. On success focus moves to the card's or month's heading.
- A routine refresh that fails keeps what is on screen. A month that failed tries again when the card loads and when the browser comes back online.
- The Supabase client comes from a CDN. If that download fails, the browser keeps the failed import for as long as the page is open, so Try again, the month buttons, the routine refresh and the online event reload the page instead, but never while offline (a reload would only show the browser's own error page; it says "Still can't connect." instead).
- If the entry script hasn't run after 12 seconds, the loading text offers "Reload the page" and, on the public page, "If it still doesn't load, check your connection, then try again in a few minutes." (no keyboard shortcuts: most people are on phones).

**Calendar Forecast tab:**
- A month grid of **weekdays only** (Mon–Fri columns), with the month name, ‹ › buttons, and "This month" only when another month is showing. A week with no weekday in the month is left out.
- ‹ and › stop at the months that have duties: the public calendar's window (90 days back, 180 ahead) and the rotation's start, if later. A month at either end says so above the grid: "Duties are shown up to Fri, 14 May.", "Duties are shown from …" or "The rotation starts on Mon, 7 Sep."
- Only the latest load is drawn, so an answer that arrives after another month was chosen is dropped. Someone left on the current month moves on with it when the month changes (at the next refresh); a month someone chose stays. The refresh runs even while a month button has focus (a tapped button keeps it on Android), and focus moves to the new button with the same id. The new month's name is announced.
- A legend showing only what that month contains: a "Primary" pill with "then the backups, in order", and a dashed slot with "someone is away".
- Each cell shows:
  - the date number (days from the months either side say "1 Dec")
  - for a holiday, a star and its name in green
  - for a working day with nobody available, "No one available" in red
  - otherwise **everyone available that day, names only**: the Primary first in a pill, then the backups in order. From today on, a dashed empty slot stands for each person missing from the day (team size minus the people listed), so an absence shows at a glance without naming anyone.
- Today's cell is brighter, with a thick cyan outline and a soft glow; its number sits in a cyan pill with the word "TODAY" beside it, and its Primary pill is solid cyan. At the weekend (when today has no cell) a line above the grid says "Today is Sunday, 15 November. No duty at weekends." and the next weekday is outlined in cyan with "NEXT" beside its date. A public holiday that is today keeps the today outline. Days gone by are outlined and faded to half strength; days outside the month are outlined rather than filled.
- On phones, names print twice (`.full` and `.first` spans) and CSS shows the short one (`shortName`). Up to 440px, a month in which some name is cut at the usual size (measured after each draw, on resize and when the tab is shown) sets its names a little smaller and tighter, so Jonathan, Michelle and Kenneth fit from 375px.
- "TODAY" sits beside the date from 375px (up to 440px the two are 2px closer, with no letter spacing); when they don't fit ("30 Nov", or under 360px) it goes under the date rather than being cut.

### Signed-in app (`index.html`)
**Sign-in screen:**
- Title "2FA Login Request", the line "Daily duty rotation. Sign in to see your duties and add your leave.", and a link "View the duty calendar without signing in →".
- A segmented switch between Sign in and Create account (Create account adds a name field), with email and password fields.
- In demo mode, a "Demo mode" card with one-tap "Sign in as \<name\>" buttons.
- People awaiting approval see "Waiting for approval" with "Check again" and "Sign out". Someone whose access was removed (neither approved nor active) sees "Your access was removed. Ask your admin if this is a mistake."; a login with no profile (a sign-up an admin deleted) sees "Your account was removed" with the same line.
- Signing out always ends on the sign-in screen, offline too (§6), and the next person starts on the Roster at this month.

**Connection trouble:**
- Network errors read as plain words ("Can't connect. Check your internet connection and try again."), never "Failed to fetch".
- A first load that fails shows "Can't load the roster" with Try again and Sign out (and the error's details, unless it was the connection). If part of the app didn't download: "Can't load the app … then [Reload the page]."
- After a good load, a failed refresh keeps the page as it is with a small sticky bar under the header: "Can't connect. Showing what was loaded at 10:42 am." and Try again (which says "Still can't connect." if it still fails). The bar goes when a load works.

**Typing comes first.** Background refreshes (every 5 minutes, at 9am and 6pm, coming back online, switching to a tab whose data is over a minute old) never redraw under someone typing: the new data waits and is drawn once focus leaves the box, but never between the press and release of a tap, which would swallow it. A redraw keeps what was typed, the focused box and its caret.

**Roster tab:**
- **"Your role" card:** the label "YOUR ROLE · MON, 16 NOV" over a big "Primary", "Secondary 2", "On leave" or "No duty".
  - Below it, that day's line-up as a strip: one tile per person with their role (P, S1, S2…), face and first name; purple "LEAVE" tiles for people on leave. The Primary's tile has a soft cyan background and a cyan ring. Your own tile has no outline: your name is white and extra bold (no underline, which would read as a link), never cyan, so your tile never outranks the Primary's.
  - Then the WhatsApp button, and "Share another way" (`navigator.share`) where the device supports it. The button says "Click for OTP on WhatsApp" during office hours on a working day; "Tell the team on WhatsApp" when that day has nobody on duty, outside office hours, and for the Primary of the day it is about, whose message leaves out the line asking them for an OTP (`ask: false`). On a working day the message is about today until midnight, after 6pm too, while the card shows the next working day; at weekends and on holidays it is about the next working day.
- **Roster card:**
  - A heading with month navigation, and the note "Weekdays only. Weekends and public holidays have no duty. Each day shows the Primary, then the backups in order. People on leave are left out that day."
  - This month opens at this week: from this week's Monday (next Monday at the weekend) to at least next week's Friday, running on into the next month under that month's name if need be. The month's earlier days wait behind "Show earlier days" ("Hide earlier days" once shown). Other months show in full.
  - Each working day is a row: the weekday and date; the Primary (a small face and full name); "then Ben → Chloe → Dev" for the backups in order; purple "Ben on leave" tags; and your own role as a badge on the right ("Primary" filled, "S2" outlined, "Leave" purple). Your name is white and extra bold wherever it appears, with no underline (it would read as a link) and no "You" pill; screen readers hear "(you)".
  - Holiday rows are green. Today's row is highlighted and says "Today".
  - Narrow screens: below 360px names wrap rather than being cut; below 300px your badge goes under the names; at 340px and below the month header wraps ("This month" on its own line).

**Leave tab:**
- **Add leave:**
  - Fields: Person (admins only), From, To, Note (optional, max 120), with the hint "Only you and admins can see the note. Please don't include medical details. Teammates see only the dates."
  - From defaults to today. Non-admins can't pick past dates.
  - An admin adding leave that begins before today is asked first when it changes past duties (§4): "Add leave for Ben? This changes duties on Mon, 9 Nov only. Today's Primary stays Elena."
- **Leave from Outlook invites:** explains the invite address, plus a "Your work email" field. Members don't see it until an admin has set the address.
- **Your upcoming leave** and **Team leave** lists. Each entry shows the date range, name and note, and tags "From invite" or "On leave now". Its action is one of:
  - "Remove" for leave that hasn't started
  - "End early (back today)" for leave that has started
  - "Change or cancel the invite in Outlook" for invite leave, which can't be removed in the app
- Changing someone else's leave asks first, by first name: "Remove Ben's leave on Tue, 17 Nov? They'll be back on the roster that day." and "End Ben's leave early? They'll be back on the roster from today." ("Leave ended. Ben is back on the roster from today."). Removing past leave also gets the §4 question.

**Team (& settings) tab** (most of it admin only):
- **Waiting for approval:** Approve, which adds the person to the end of the rotation and saves the rotation change (§4), or Remove, which deletes the sign-up after "Remove Zoe? Their profile is deleted and they won't see the roster."
- **Rotation order:** numbered rows, each with:
  - an editable name
  - the email
  - a work Outlook email box
  - Active and Admin checkboxes (you can't remove your own admin)
  - ↑ ↓ buttons
  - "Remove access" (not for yourself): a quiet underlined text button under the boxes, for someone who has left
  
  Each change to the rotation saves the rotation change (§4) and toasts "…from today". The Admin tick asks first: "Make Ben an admin? They'll be able to change the team, everyone's leave and the settings." or "Remove Ben's admin access? They'll still see the roster and add their own leave." ("No" puts the tick back.)
- **Remove access** asks "Remove Dev's access? They won't see the roster or anyone's leave, and they're left out of the roster from today. Their past duties stay." (adding "Their admin access goes too." for an admin, since the database's admin rules don't look at approval), then sets `approved`, `active` and `is_admin` to false and saves the rotation change. Focus moves to their "Give access again".
- **Removed** (only when someone is): people whose access was removed, with "Give access again", which approves them again at the end of the order but not Active or Admin ("Dev can see the roster again. Tick Active to put them back on it."). No one who was ever on the rotation can be deleted, because deleting a profile drops them from the checkpoints and rewrites past duties; only sign-ups still waiting for approval can.
- **Rotation start:** a date picker. Saving asks the restart question (§4), then calls `resetRotation`.
- **Public calendar:** the public link, plus the toggle "Anyone with the link can view the calendar".
- **Leave from calendar invites:**
  - The invite address setting.
  - A list of "Invites from unknown senders", each with an "Assign to…" dropdown (which saves that address as the person's work email) and Dismiss.
- **Public holidays:** an add form (date and name) and a list with Remove. Adding or removing a holiday before today asks the §4 question first when it changes past duties.

**Every write** goes through `act(fn, toastMessage)`:
1. Disable the control actually used (the submit button, or the tapped button, tick or field) and its form's fields, with `aria-busy`. Find it from the event, with capture listeners for click, change and submit, not from `document.activeElement`: Safari doesn't focus a tapped button. There is no page-wide busy flag; a redraw while a save is on its way keeps that control disabled and its values in place, so it can't be sent twice.
2. Run the change.
3. On success, toast the message. A saved form stays filled (and disabled) until the redraw shows the saved state.
4. Reload all data and redraw. Put focus back only if nothing else has it by then (someone may have moved on).
5. On failure: if the connection is down, first redraw from the last good data, so ticks and lists show what is really saved. Put back what was typed. Give the reason once: under the form, or under a text box saved on its own (`role="alert"`), or as a toast for ticks and buttons. Offline it says "Not saved. Check your internet connection and try again."

Toast messages are friendly and name people by first name (the full name when two share one) with they/them wording, for example "Leave added. The roster has been updated." and "Dev's access was removed."

---

## 8. Leave from Outlook invites

People invite a shared Google account (for example `ourteam.leave@gmail.com`) to their out-of-office event in Outlook. A **Google Apps Script** in that account (`scripts/leave-invites.gs`) runs every 15 minutes:

1. Search Gmail for `newer_than:400d filename:ics`. Read every `invite.ics` attachment.
   - Read the mail, **not** the calendar: Google imports Outlook invites as events owned by the account itself, which hides the organiser.
2. Parse each VEVENT:
   - UID (with RECURRENCE-ID appended if present), ORGANIZER `mailto:`, SUMMARY
   - DTSTART and DTEND (all-day, UTC `Z`, or local time treated as Singapore)
   - SEQUENCE, `METHOD:CANCEL` or `STATUS:CANCELLED`
   - `X-MICROSOFT-CDO-BUSYSTATUS` / `INTENDEDSTATUS` = `OOF`
   
   Keep only the newest version of each UID, by highest SEQUENCE and then latest email date. RRULE is not expanded, so a recurring invite counts its first occurrence only.
3. It **counts as leave** if it is all-day, OR at least 20 hours long, OR (Out of office AND at least 4 hours). The end day is inclusive: an all-day end date is exclusive, so subtract one day; for a timed event, use the day it ends in. Leave is whole days only.
4. POST the **complete** list of current, non-cancelled leave invites ending today or later to the Supabase RPC `sync_leave_invites(p_secret, p_events)`. The headers `apikey` and `Authorization: Bearer <anon key>` carry the anon key.

`sync_leave_invites` (security definer, callable by `anon`, checks `invite_config.script_secret`):
- Matches each organiser to an approved profile by sign-in email or `work_email`, case-insensitively. If there's no match, the invite is upserted into `unmatched_invites`.
- For a match, it inserts or updates the `leaves` row keyed by `invite_uid` (note: "From calendar invite"), starting no earlier than today.
- Leave that has already begun keeps its start date, and its end can only move to yesterday at the earliest.
- **Invites missing from the list count as cancelled.** If not yet started, the leave is deleted; if started, it ends yesterday.
- Returns `{added, moved, removed, unmatched}` and updates `last_sync`.

The committed script keeps `SCRIPT_SECRET = 'paste-the-script-secret-here'`. The real secret is read with `select script_secret from invite_config` and pasted only into the Google copy. `setUp()` installs the 15-minute trigger and syncs once.

---

## 9. Visual design: the "Ocean" theme

Always dark. Fonts: **Plus Jakarta Sans** (UI) and **JetBrains Mono** (role codes and dates), from Google Fonts.

```css
:root {
  --bg: #06141c; --panel: #0b1e29; --raised: #102a39; --ink: #e6f4f8; --soft: #9bb8c4; --line: #1d3a48; --edge: #2a5468;
  --accent: #38bdf8; --accent-ink: #06141c; --accent-soft: #12384a; --steel: #3a7690;
  --primary: #7dd3fc; --primary-soft: #1a4a61; --leave: #d0aefc; --leave-soft: #2b2148;
  --holiday: #6fd3ad; --holiday-soft: #12302a; --danger: #ff8a80; --danger-soft: #2a1620;
  --wa: #25d366; --wa-ink: #04210f;
  --hoodie: #f0846a; --hoodie-light: #f59a80; --hoodie-dark: #d96f57;
}
body { background: radial-gradient(50rem 30rem at 90% -10%, #0e749052, transparent 60%),
                   radial-gradient(40rem 25rem at -10% 10%, #1e3a8a3d, transparent 60%), var(--bg) fixed; }
```

- **One accent.** Cyan means "Primary" or "today" and nothing else (the one exception is the ring on your own face button in the app's header). Leave is purple, holidays green, gaps red. You are marked in white, extra bold, never cyan, with no underline (it would read as a link); steel blue (`--steel`) marks the offline bar's dot. Everything else is flat: no gradient bands.
- **Cards:** `.panel`, background `var(--panel)`, radius 20px, a faint 1px light ring. The two lead cards (the 2FA Login card and "Your role") have radius 24px and a deep shadow.
- **Selected pill tab:** `#1b4459` with white text.
- **People:** a drawn face in a circle (`.av`), generated from the name by `faces.js` so the same name always gets the same face: a light, cool background, one of six hair styles, and a skin tone, hair colour and shirt colour from small palettes, sometimes with glasses. No names leave the browser. The calendar has no faces, only names. The Primary's is large (5.5rem, 7rem on wide screens) with the ring `0 0 0 4px var(--panel), 0 0 0 6.5px var(--accent), 0 0 30px 4px #38bdf85c` and a small padlock badge.
- **WhatsApp button:** `#25d366` with dark text `#04210f` (white text on green fails contrast), radius 16px, a slow glow.
- **"No one available" card:** `#2a1620` with a `#e5484d66` ring; rows `#3a1d2a`.
- **Engineer room:** deep teal walls, a sky per time of day, a warm coral hoodie as the one warm note, a cyan padlock (`#7dd3fc` on `#082f49`).
- Layout: a single column, max-width 62rem, 16px side gutters (respect safe-area insets), and no horizontal scroll at 320px. From 880px the 2FA Login tab is two columns.
- **Every animation stops under `@media (prefers-reduced-motion: reduce)`.**

---

## 10. Cache-busting stamp (`scripts/stamp.mjs`)

Phones cache ES modules aggressively, and mixing old and new modules breaks the app. Before every commit that changes a page, script or `styles.css`, run `npm run stamp`. It rewrites the block between `<!-- version:start -->` and `<!-- version:end -->` in both HTML files with:
- an **import map** that maps every `src/*.js` file and `config.js` to the same path plus `?v=YYYYMMDDHHMM` (it picks up new files automatically)
- the stylesheet link and the entry module script, with the same `?v=`

`live.js` reads this stamp to detect new versions (§7).

---

## 11. Setup for a new install (goes in the README)

1. Create a Supabase project and run the SQL files in order.
2. Put the project URL and anon key in `config.js`. They are public by design; security comes from RLS.
3. Turn on GitHub Pages: deploy from branch `main`, root folder.
4. Sign up first. The first account becomes the admin.
5. Optional: set up the Google account, the invite address and the Apps Script for Outlook invite leave.

---

## 12. Acceptance checklist

- [ ] `npm test` passes: rotation, checkpoints and history, window clipping, dates in several timezones, message and caption wording, and DemoStore rules.
- [ ] `node scripts/ui-check.cjs` passes (203 checks at the time of writing).
- [ ] Demo mode works with an empty `config.js`, and refuses the same actions as production, in the same words.
- [ ] Reordering, approving, deactivating or removing someone today leaves every earlier day's duties and today's Primary unchanged; after 6pm, the next working day's Primary too.
- [ ] An admin's correction to past leave or a holiday asks first and changes only those days.
- [ ] The public page shows no emails, leave or ids; it works logged out and respects the on/off switch.
- [ ] Dates are correct for a viewer in another timezone, including just after Singapore midnight.
- [ ] No horizontal scroll at 320px; nothing is cut off at 260px; tabs swipe on phones; reduced motion stops all animation.
- [ ] WhatsApp opens with the exact message text; after 6pm it is still about today; the Primary's own button doesn't ask them for an OTP.
- [ ] No caption says the Primary is away during office hours; outside them, the caption names when the office opens.
- [ ] With the connection down: the app keeps what it showed with a "Can't connect" bar, a refused or failed save keeps what was typed and says why once, a double tap saves once, Sign out still works; the public card and month each say so with Try again.
- [ ] Refreshes never redraw under someone typing, and a refresh that changes nothing leaves the public card alone.
- [ ] Cancelling an Outlook invite removes the leave on the next sync.
