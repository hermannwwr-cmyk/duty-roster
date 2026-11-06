# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"2FA Login Request" (repo name `duty-roster`): a daily duty rotation for a Singapore team. Each working day everyone available gets a role (Primary, Secondary 1, 2…); the Primary is the person others ask for an OTP login. Plain HTML + ES modules, no build step, served by GitHub Pages from `main` at the repo root. Supabase (Postgres + auth) is the backend.

## Commands

```bash
npm start                     # serve on http://localhost:5173 (http-server, no caching)
npm test                      # node --test: runs every tests/*.test.mjs (store tests fake localStorage to drive DemoStore)
node --test --test-name-pattern "midnight" tests/schedule.test.mjs   # one test
npm run stamp                 # REQUIRED before every commit that changes a page, script or styles.css
```

There is no linter, formatter or bundler.

`npm run stamp` (`scripts/stamp.mjs`) rewrites the `<!-- version:start -->…<!-- version:end -->` block in `index.html` and `calendar.html`: an import map that gives every `src/*.js` and `config.js` a `?v=<YYYYMMDDHHMM>` suffix, plus the stylesheet and entry script. It picks up new files in `src/` automatically. Without it, phones mix cached old modules with new ones. `src/live.js` also reads this `?v=` stamp to detect that a newer version has been published.

## Architecture

**Two pages, two entry scripts**
- `index.html` → `src/app.js`: the signed-in app (Roster, Leave, Team & settings tabs). Renders with template strings into `#root`; `refresh()` reloads all data and redraws; `act(fn, message)` wraps every write (disables the triggering control, toasts, refreshes, restores focus via `focusKey`/`restoreFocus`).
- `calendar.html` → `src/calendar.js`: the public page, no login. Two tabs (2FA Login card, and Calendar Forecast month grid; `#calendar` in the URL opens the second). Above the card, `src/engineer.js` draws an animated scene picked by Singapore time (`periodAt`): six weekday scenes, and a lights-off room on weekends and public holidays; `?scene=lunch` etc. forces one for previews. `src/faces.js` draws each person's cartoon face from their name. Under the card, a "No one is available on:" card lists upcoming working days whose duty list is empty. The page only ever receives names and roles, never leave, emails or ids.
  - It asks `loadPublic(today, today + 60)`. The SQL `public_calendar()` silently clips every request to at most ~62 days and to 90 days back / 180 days ahead, so asking for more just returns fewer days.
  - On phones the Calendar Forecast prints each name twice (`.full` and `.first` spans) and CSS shows the first name only; wording changes touch both.
- Headers have no title: one row with the tab pill, then on the right a "Sign in" link (calendar.html) or, in the app, a round initials button whose menu (`toggleAccount` in app.js) holds who is signed in, Calendar and Sign out. Tab labels too long for phones carry `.tab-long`/`.tab-short` spans (e.g. "Calendar Forecast"/"Forecast", admins' "Team & settings"/"Team").

**Shared UI pieces across the two pages** — the WhatsApp button label is written in both `app.js` and `calendar.js`; its icon (`WHATSAPP_ICON`), link and message text (`rosterMessage`) live in `schedule.js`. Avatars differ by page: the public card uses `faces.js`, the signed-in Roster tab uses initials circles from `initials()`/`avatarColor()` in `schedule.js`.

**Data layer** — `src/connect.js` returns `SupabaseStore` when `config.js` has a URL and anon key, otherwise `DemoStore` (localStorage, five example people). Both live in `src/store.js` and expose the same methods. `DemoStore` deliberately mirrors the database's row-level security and triggers (admin checks, leave rules) so demo mode fails the same way production does; keep them in step. In `SupabaseStore`, updates and deletes end in `.select()` and go through `changed()`, because RLS silently skips forbidden rows and `protect_profile_fields()` silently reverts non-admin field changes — `updateProfile` compares the returned row to the patch to catch that.

**Rotation logic** — `src/schedule.js` is pure (no DOM) and fully unit-tested: `buildSchedule` walks working days from the first **rota checkpoint**, skipping weekends, holidays and people on leave. Checkpoints (`rota_checkpoints` table) freeze history: approving, deactivating or reordering people saves a checkpoint dated today (`recordRotaChange` in app.js), so earlier days keep their duties. The same algorithm is reimplemented in SQL as `public_calendar()` (supabase/004_stable_history.sql) for the public page — a change to the rotation rules must be made in both. `rosterMessage()` builds the WhatsApp text (its exact wording is asserted in tests).

**Public holidays** — `schema.sql` seeds the `holidays` table and `src/holidays-sg.js` seeds demo mode, both with 2026–2027 from the Ministry of Manpower dataset (data.gov.sg collection 691). Later years are added by admins in the Team tab, not in code.

**Time** — everything uses Singapore dates: `todaySG()` in JS, `public.sg_today()` in SQL. Dates are `YYYY-MM-DD` strings; `fromISO` parses at noon to avoid DST/offset slips.

**Staying fresh** — `src/live.js` `keepFresh()` re-fetches when the page becomes visible, every 5 minutes, and just after Singapore midnight; app.js skips it while a form has unsaved input. It also shows a "new version available" bar when the published page's stamp differs.

**Swiping** — `src/swipe.js` (both pages): on phones a sideways swipe clicks the next or previous `[data-tab]` button and slides the new content in; it ignores the screen edges, form fields and (in app.js) unsaved input. The first visit on a phone plays a one-time "peek" at the next tab (remembered in localStorage as `swipePeekSeen`).

**Styles** — one `styles.css`, the "Ocean" theme: always dark, deep sea blue with cyan accents, tokens on `:root`, Plus Jakarta Sans + JetBrains Mono from Google Fonts. Animations must stop under `prefers-reduced-motion`. A theme change is more than the `:root` tokens: `styles.css` also hard-codes theme colours (header, panels, buttons, pill tabs, the Primary row gradient, band label, account menu, Forecast today column), and `engineer.js` hard-codes the room and padlock colours.

## Database (supabase/)

SQL is not applied automatically: the project owner pastes each file into the Supabase SQL Editor. New installs run `schema.sql`, then `003_private_data.sql`, `004_stable_history.sql`, `006_hardening.sql`, `011_leave_invites.sql` (the README lists the order). Numbers 005, 007 and 009 were features that were later removed; `008_remove_calendar_sync.sql` and `010_remove_daily_email.sql` undo them on databases that ran them, which is why those files are absent.

- Never edit a migration the owner may already have run; add the next numbered file, make it safe to run twice (`if exists`, `create or replace`, `drop policy if exists`), and update the README's setup list.
- Front-end code that depends on a new migration should be published only after the owner confirms it ran.
- Access is enforced by RLS plus `security definer` functions with explicit `revoke … from public, anon` / `grant` lines; emails and leave notes are hidden by column grants and exposed only through `member_emails()` / `leave_notes()`.
- **Leave from invites** (`011_leave_invites.sql` + `scripts/leave-invites.gs`): a Google Apps Script in a shared Google account reads the invite *emails* (their `invite.ics` attachments: ORGANIZER, dates, SEQUENCE, METHOD:CANCEL) and posts every current leave-like invite to `sync_leave_invites(secret, events)` every 15 minutes. It reads Gmail, not the calendar, because Google imports Outlook invites as events owned by the account itself, which hides the organiser. The list is complete, so invites missing from it count as cancelled; invite leave is keyed by `leaves.invite_uid` (private; the app sees only `from_invite`). Matching uses `profiles.work_email` (private, via `member_work_emails()` / `set_work_email()`) or the sign-in email; misses go to `unmatched_invites` for admins. Removing invite leave in the app would be undone by the next sync, so the UI points people to Outlook instead.
  - What counts as leave is decided in the script (`parseInvite`): all-day events, events of 20 hours or more, and Out of office events (`X-MICROSOFT-CDO-BUSYSTATUS: OOF`) of 4 hours or more. Ordinary meetings are ignored. Leave is whole days only, so a 4-hour Out of office invite takes the person off the roster for that entire day.
  - `set_work_email()` lets approved members set their own and admins set anyone's; people awaiting approval and the public page are refused (`DemoStore.setWorkEmail` mirrors this).
  - The script runs in Google, not from this repo: pushing a change to `scripts/leave-invites.gs` deploys nothing. The owner must paste the new version into script.google.com in the shared account. The committed file keeps `SCRIPT_SECRET = 'paste-the-script-secret-here'`; the real secret (from `invite_config`) only goes into the Google copy.
- `config.js` holds the real project URL and anon key (public by design). To exercise the UI in demo mode, serve the site with an empty `config.js` (e.g. a browser-automation route override) rather than editing the committed file.
