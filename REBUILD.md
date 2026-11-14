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
- **Demo mode:** if `config.js` has no URL or key, the app runs entirely in the browser on `localStorage` with five example people. Demo mode must behave like production: the same permission errors and the same leave rules.
- **Tests:** `node --test` (built-in Node test runner), files in `tests/*.test.mjs`.
- **`package.json` scripts:**
  ```json
  { "type": "module",
    "scripts": {
      "test": "node --test",
      "start": "npx --yes http-server@14.1.1 . -p 5173 -c-1",
      "stamp": "node scripts/stamp.mjs" } }
  ```
- **Timezone:** everything uses **Singapore dates**. Dates are `YYYY-MM-DD` strings everywhere. Parse a date string as local noon (`new Date(y, m-1, d, 12)`) so daylight-saving and offset changes can never shift the day.
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
  faces.js                 cartoon face SVG generated from a name (public card avatars)
  holidays-sg.js           Singapore public holidays 2026–2027 for demo mode
  live.js                  keepFresh(): auto-refresh plus a "new version available" bar
  swipe.js                 swipe left or right on phones to change tabs, plus a one-time peek hint
scripts/
  stamp.mjs                cache-busting version stamp (see §10)
  leave-invites.gs         Google Apps Script: Outlook invites become leave (see §8)
supabase/
  schema.sql, 003_private_data.sql, 004_stable_history.sql, 006_hardening.sql, 011_leave_invites.sql
tests/
  schedule.test.mjs, store.test.mjs
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
- Whenever an admin **approves, deactivates or reactivates, or reorders** people, the app saves a checkpoint dated **today** (`recordRotaChange`). Its `next_primary` comes from `checkpointFor(state, date, newOrder)`:
  - Walk the old rotation up to yesterday.
  - Find whose turn it would be today.
  - Keep that person next, or the next person after them who is still in the new order.
  - If the change is before the rotation has started, just use the new order with its first person next.
- **"Restart rotation"** (admin) replaces all checkpoints with a single one: `{ start, order, order[0] }`.

### Functions to export from `schedule.js`
- `toISO(date)`, `fromISO(iso)` (noon), `addDays(iso, n)`, `isWeekend(iso)`
- `roleName(i)`: 0 → `'Primary'`, otherwise `'Secondary ' + i`
- `onRota(profile)`: `active && approved !== false`
- `buildSchedule({ members, leaves, holidays, anchor, checkpoints, people, from, to })` returns one entry per calendar day:
  `{ date, kind: 'work'|'weekend'|'holiday'|'before-start', holiday?, duties: [{ role, member }], onLeave: [member] }`
- `checkpointFor(p, date, newOrder)` (described above)
- `publicCalendar({..., from, to, today})` is the JS mirror of the SQL function. It clips the window to 90 days back and 180 days ahead, at most 62 days per request, and returns `{ rota_start, from, to, people: [names], days: [{date, kind, duties:[{role,name}] | holiday}] }`.
- `todaySG()`: `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' })`
- `rosterMessage(day, calendarUrl)` is the WhatsApp text. Tests assert this wording exactly:
  ```
  2FA Login Request · Mon, 16 Nov
  Primary: Alice Tan
  Secondary 1: Ben Lim
  ...

  Hi Alice Tan (Primary), may we have OTP login for ...
  Calendar: https://.../calendar.html
  ```
  If no one is available, the line reads "No one is available for duty." Leave is never included.
- `whatsappLink(text)`: `'https://wa.me/?text=' + encodeURIComponent(text)` (the user picks the chat).
- `WHATSAPP_ICON`: inline SVG of the WhatsApp logo (Simple Icons, CC0), class `wa-icon`.
- `initials(name)`: up to two initials, uppercase.
- `avatarColor(name)`: a stable pick from `['#be123c','#b45309','#047857','#1d4ed8','#6d28d9','#be185d','#0f766e','#c2410c']` using a `h*31+codepoint` hash.

### Tests to write (`tests/schedule.test.mjs`, about 15)
- Basic rotation order.
- Weekends and holidays are skipped.
- A Primary on leave is skipped; the next person takes Primary and the pointer moves past *them*.
- Everyone on leave gives an empty day.
- A checkpoint keeps earlier days unchanged after reordering, deactivating or approving.
- `checkpointFor` keeps the right person next.
- `publicCalendar` window clipping (90, 180 and 62 days).
- Singapore midnight: `todaySG()` handles the date boundary.
- The exact `rosterMessage` wording.

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
- `enforce_leave_rules()` (before insert, update and delete on leaves) applies to non-admins:
  - No adding leave that starts before today.
  - No deleting leave that has already begun; it can only be shortened to end yesterday at the earliest.
  - At most 180 days per booking, and starting at most 365 days ahead.
  - Admins are exempt from all of these.
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

### Store gotcha
RLS silently skips forbidden rows, and the protect trigger silently reverts fields. So every update and delete in `SupabaseStore` ends with `.select()` and checks that rows actually changed. `updateProfile` compares the returned row to the patch, and throws a friendly error if they differ.

---

## 6. Data layer (`src/store.js`, `src/connect.js`)

Two classes with **identical methods**:

`userId, onAuthChange(cb), signIn(email, pw), signUp(email, pw, name) → {needsConfirmation}, signOut, load() → { me, profiles, leaves, holidays, settings, checkpoints, unmatched }, loadPublic(from, to), addLeave(row), updateLeave(id, patch), deleteLeave(id), updateProfile(id, patch), deleteProfile(id), setRotaOrder(ids), saveCheckpoint(cp), resetRotation(start, order), addHoliday(date, name), deleteHoliday(date), updateSettings(patch), setWorkEmail(userId, email), dismissInvite(uid)`

**DemoStore:**
- Data lives in `localStorage` (wrap every access in try/catch).
- Seeds five people: Alice Tan (admin), Ben Lim, Chloe Ng, Dev Kumar and Elena Goh, with emails `first@example.com`, a rotation starting today, the SG holidays, and one example leave for Ben tomorrow ("Example: medical appointment").
- `signIn(email)` accepts any password.
- Mirrors every database rule with the **same error messages**: admin checks, the leave rules above, and work-email rules.

**Store tests** (`tests/store.test.mjs`) fake `localStorage` and check that DemoStore refuses what the database refuses.

---

## 7. UI and behaviour

### Shared
- **Header** (sticky, blurred background): a single row with no title text.
  - On the left, a **pill-shaped tab bar**; the selected tab is filled with a cyan gradient.
  - On the right: "Sign in" (public page), or a round **initials avatar button** (app). The avatar opens a menu showing "Signed in as \<name\>" (with an "Admin" badge for admins), Calendar and Sign out. The menu closes on Escape or a click outside.
  - Long tab labels have a phone version: `<span class="tab-long">Calendar Forecast</span><span class="tab-short">Forecast</span>`; admins' "Team & settings" becomes "Team".
- **Swiping (phones):** a horizontal swipe clicks the next or previous `[data-tab]`.
  - Thresholds: at least 60px, mostly horizontal, under 700ms.
  - Ignore swipes that start within 24px of the screen edge, swipes on form fields, swipes while text is selected, and (in the app) swipes while there is unsaved input.
  - New content slides in from the side the finger moved from.
  - On the first visit on a phone, play a one-time "peek": the page nudges left and a slim cyan edge card with a › arrow slides in, then everything springs back. Remember it in `localStorage` as `swipePeekSeen`.
  - Skip all animation under `prefers-reduced-motion`.
- **Staying fresh (`live.js`):**
  - Re-fetch data when the tab becomes visible, every 5 minutes, and just after Singapore midnight. The app skips this while a form has unsaved input.
  - Also fetch the page's own HTML and compare the `?v=` stamp. If it differs, show a bar: "A new version of the app is available. [Reload]".
- **Accessibility:**
  - Toasts are announced through an `aria-live` region.
  - After a redraw, keyboard focus returns to the same control (find it by id or data attribute), or to the section heading if the control is gone.
  - Buttons that act are disabled while busy (`aria-busy`).

### Public page (`calendar.html`)
Two tabs: **2FA Login** and **Calendar Forecast** (`#calendar` in the URL opens the second).

**2FA Login tab**, from top to bottom:
1. **The engineer scene** (`engineer.js`): an animated SVG (viewBox 360×172) of an infra engineer, chosen by Singapore time:
   - before 6:00 or from 23:00: sleeping (bed, phone glowing, "zzz")
   - morning (to 12:00): typing at code, with a coffee mug
   - lunch (12–14): eating noodles, screen says "Lunch break, Back at 2pm"
   - afternoon (to 17:30): dashboards with moving bars
   - evening (to 19:00): stretching and yawning, "Shutting down…"
   - after work: on the sofa with a lamp and the on-call phone
   - weekends and public holidays: lights-off room

   The window shows a sky that matches the time of day (sunrise, sun, sunset, moon, stars). A server rack with blinking LEDs and a pulsing padlock sits on the right. Each scene has a one-line caption, for example "Good morning! Coffee first, then the servers." `?scene=lunch` forces a scene for previews. The hoodie colour comes from CSS variables `--hoodie`, `--hoodie-light` and `--hoodie-dark`, set as an inline `style="fill:var(--hoodie)"` because SVG attributes can't hold `var()`. All animation stops under reduced motion.
2. **The "2FA Login" card:**
   - A gradient header band (blue to cyan) reading "2FA Login", with the date in a translucent pill on the right and a slow light-ripple animation.
   - Then a **grouped list**:
     - The **Primary row is large**: a cartoon face (`faces.js`) with a glowing cyan ring, the name in big bold type, and "Primary · ask for OTP" in cyan under it.
     - Secondaries follow on thin-ruled rows: a face, the name, and the role in grey under it.
   - On a weekend or holiday, show "No duty today. It's the weekend." (or "Public holiday: X."), then a label "NEXT DUTY DAY · MON, 16 NOV", then that day's list.
   - Under the list: "**UP NEXT** Tomorrow · **Chloe Ng** is Primary". Use the date instead of "Tomorrow" if the next duty day isn't tomorrow.
   - A big green button, "Click for OTP on WhatsApp", opens `whatsappLink(rosterMessage(day, calendarUrl))`. It has a gentle breathing green glow.
3. **"No one is available on:" card**, shown only if some upcoming working day has an empty duty list. It has a red header band, and each date is a row with a "!" icon, the full date, and how soon it is ("in 9 days").

The page loads `loadPublic(today, today + 60)`. If that returns `null`, show "The public calendar is switched off".

**Calendar Forecast tab:**
- A month grid of **weekdays only** (Mon–Fri columns), with ‹ › month buttons and "This month".
- A legend: "ROLES P Primary, S1–S4 Secondaries, in backup order" and "DAYS Today, Public holiday", showing only what that month contains.
- Each cell shows:
  - the date number
  - for a holiday, its name in green
  - for a working day with nobody available, "No one available" in red
  - otherwise a list of `P Name`, `S1 Name`, … The Primary is bold, with a cyan dot.
- Today's number sits in a cyan circle, the cell is tinted with a cyan top line, and today's weekday column is lightly tinted all month. Days outside the month are faded.
- On phones, names print twice (`.full` and `.first` spans) and CSS shows the first name only.

### Signed-in app (`index.html`)
**Sign-in screen:**
- Title "2FA Login Request", the line "Daily duty rotation. Sign in to see your duties and add your leave.", and a link "View the duty calendar without signing in →".
- A segmented switch between Sign in and Create account (Create account adds a name field), with email and password fields.
- In demo mode, a "Demo mode" card with one-tap "Sign in as \<name\>" buttons.
- People awaiting approval see "Waiting for approval" with "Check again" and "Sign out".

**Roster tab:**
- **"Your role" card:** a gradient band showing "2FA LOGIN · WED, 18 NOV · YOUR ROLE" over a big "Primary", "Secondary 2", "On leave" or "No duty".
  - Below it, the same grouped list as the public card, but with **initials circles** instead of faces. Your own row is tinted and shows "· You".
  - Then the WhatsApp button, and "Share another way" (`navigator.share`) where the device supports it.
- **Roster card:**
  - A heading with month navigation, and the note "Weekdays only. Weekends and public holidays have no duty. P is Primary, S1 is Secondary 1, and so on. People on leave are left out that day."
  - Columns: Date / Your role / Everyone. Each working day is a row: date, your role, then **chips** "P Alice Tan", "S1 Ben Lim", … plus purple "LEAVE Name" chips.
  - Your chip is outlined in cyan. Holiday rows are green. Today's row is highlighted.
  - On phones the chips wrap under the date.

**Leave tab:**
- **Add leave:**
  - Fields: Person (admins only), From, To, Note (optional, max 120), with the hint "Only you and admins can see the note. Please don't include medical details."
  - From defaults to today. Non-admins can't pick past dates.
- **Leave from Outlook invites:** explains the invite address, plus a "Your work email" field.
- **Your upcoming leave** and **Team leave** lists. Each entry shows the date range, name and note, and tags "From invite" or "On leave now". Its action is one of:
  - "Remove" for leave that hasn't started
  - "End early (back today)" for leave that has started
  - "Change or cancel the invite in Outlook" for invite leave, which can't be removed in the app

**Team (& settings) tab** (most of it admin only):
- **Waiting for approval:** Approve, which adds the person to the end of the rotation and saves a checkpoint, or Remove (with a confirm).
- **Rotation order:** numbered rows, each with:
  - an editable name
  - the email
  - a work Outlook email box
  - Active and Admin checkboxes (you can't remove your own admin)
  - ↑ ↓ buttons
  
  Each change saves a checkpoint and toasts "…from today".
- **Rotation start:** a date picker. Saving asks for confirmation, then calls `resetRotation`.
- **Public calendar:** the public link, plus the toggle "Anyone with the link can view the calendar".
- **Leave from calendar invites:**
  - The invite address setting.
  - A list of "Invites from unknown senders", each with an "Assign to…" dropdown (which saves that address as the person's work email) and Dismiss.
- **Public holidays:** an add form (date and name) and a list with Remove.

**Every write** goes through `act(fn, toastMessage)`:
1. Disable the control.
2. Run the change.
3. Toast the message, or the error text.
4. Reload all data, redraw, and restore focus.

Toast messages are friendly, for example "Leave added. The roster has been updated."

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
   
   Keep only the newest version of each UID, by highest SEQUENCE and then latest email date.
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
  --bg: #06141c; --panel: #0c1f2a; --raised: #10283a; --ink: #e6f4f8; --soft: #9bb8c4; --line: #1d3a48;
  --accent: #38bdf8; --accent-ink: #06141c; --accent-soft: #0f2a38;
  --primary: #7dd3fc; --primary-soft: #0f2a38; --leave: #d0aefc; --leave-soft: #2b2148;
  --holiday: #6fd3ad; --holiday-soft: #12302a; --danger: #ff8a80;
  --band: linear-gradient(120deg, #0369a1, #0891b2 55%, #06b6d4);
  --hoodie: #0891b2; --hoodie-light: #22b8cf; --hoodie-dark: #0e7490;
}
body { background: radial-gradient(50rem 30rem at 90% -10%, #0e749066, transparent 60%),
                   radial-gradient(40rem 25rem at -10% 10%, #1e3a8a44, transparent 60%), var(--bg) fixed; }
```

- **Cards:** `.panel`, background `#0c1f2ae6`, radius 16px, a faint 1px light ring and a deep shadow.
- **Selected pill tab:** `linear-gradient(120deg, #0369a1, #0891b2)`.
- **Primary row:** `linear-gradient(120deg, #0c4a6e, #155e75)`. Its avatar is 3.6rem with a ring `0 0 0 3px #0c4a6e, 0 0 0 5px var(--primary), 0 0 24px #38bdf880`.
- **WhatsApp button:** `#16a34a`, with a breathing glow animation (`#22c55e`).
- **"No one available" band:** `linear-gradient(120deg, #e5484d, #be123c)`.
- **Engineer room:** navy and teal shapes, a cyan padlock (`#7dd3fc` on `#082f49`).
- Layout: a single column, max-width 62rem, 16px side gutters (respect safe-area insets), and no horizontal scroll at 320px.
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

- [ ] `npm test` passes: rotation, checkpoints, window clipping, message wording, and DemoStore rules.
- [ ] Demo mode works with an empty `config.js`, and refuses the same actions as production.
- [ ] Reordering or deactivating someone today leaves every earlier day's duties unchanged.
- [ ] The public page shows no emails, leave or ids; it works logged out and respects the on/off switch.
- [ ] Dates are correct for a viewer in another timezone, including just after Singapore midnight.
- [ ] No horizontal scroll at 320px; tabs swipe on phones; reduced motion stops all animation.
- [ ] WhatsApp opens with the exact message text.
- [ ] Cancelling an Outlook invite removes the leave on the next sync.
