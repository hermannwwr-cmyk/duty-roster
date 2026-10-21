# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"2FA Login Request" (repo name `duty-roster`): a daily duty rotation for a Singapore team. Each working day everyone available gets a role (Primary, Secondary 1, 2…); the Primary is the person others ask for an OTP login. Plain HTML + ES modules, no build step, served by GitHub Pages from `main` at the repo root. Supabase (Postgres + auth) is the backend.

## Commands

```bash
npm start                     # serve on http://localhost:5173 (http-server, no caching)
npm test                      # node --test: runs every tests/*.test.mjs
node --test --test-name-pattern "midnight" tests/schedule.test.mjs   # one test
npm run stamp                 # REQUIRED before every commit that changes a page, script or styles.css
```

There is no linter, formatter or bundler.

`npm run stamp` (`scripts/stamp.mjs`) rewrites the `<!-- version:start -->…<!-- version:end -->` block in `index.html` and `calendar.html`: an import map that gives every `src/*.js` and `config.js` a `?v=<YYYYMMDDHHMM>` suffix, plus the stylesheet and entry script. It picks up new files in `src/` automatically. Without it, phones mix cached old modules with new ones. `src/live.js` also reads this `?v=` stamp to detect that a newer version has been published.

## Architecture

**Two pages, two entry scripts**
- `index.html` → `src/app.js`: the signed-in app (Roster, Leave, Team & settings tabs). Renders with template strings into `#root`; `refresh()` reloads all data and redraws; `act(fn, message)` wraps every write (disables the triggering control, toasts, refreshes, restores focus via `focusKey`/`restoreFocus`).
- `calendar.html` → `src/calendar.js`: the public page, no login. Two tabs (2FA Login card, and Calendar Forecast month grid; `#calendar` in the URL opens the second). Above the card, `src/engineer.js` draws an animated scene picked by Singapore time (`periodAt`): six weekday scenes, and a lights-off room on weekends and public holidays; `?scene=lunch` etc. forces one for previews. `src/faces.js` draws each person's face from their name: deliberately neutral (a coloured face, no skin tone, hair or clothing). It only ever receives names and roles, never leave, emails or ids.

**Data layer** — `src/connect.js` returns `SupabaseStore` when `config.js` has a URL and anon key, otherwise `DemoStore` (localStorage, five example people). Both live in `src/store.js` and expose the same methods. `DemoStore` deliberately mirrors the database's row-level security and triggers (admin checks, leave rules) so demo mode fails the same way production does; keep them in step. In `SupabaseStore`, updates and deletes end in `.select()` and go through `changed()`, because RLS silently skips forbidden rows and `protect_profile_fields()` silently reverts non-admin field changes — `updateProfile` compares the returned row to the patch to catch that.

**Rotation logic** — `src/schedule.js` is pure (no DOM) and fully unit-tested: `buildSchedule` walks working days from the first **rota checkpoint**, skipping weekends, holidays and people on leave. Checkpoints (`rota_checkpoints` table) freeze history: approving, deactivating or reordering people saves a checkpoint dated today (`recordRotaChange` in app.js), so earlier days keep their duties. The same algorithm is reimplemented in SQL as `public_calendar()` (supabase/004_stable_history.sql) for the public page — a change to the rotation rules must be made in both. `rosterMessage()` builds the WhatsApp text (its exact wording is asserted in tests).

**Time** — everything uses Singapore dates: `todaySG()` in JS, `public.sg_today()` in SQL. Dates are `YYYY-MM-DD` strings; `fromISO` parses at noon to avoid DST/offset slips.

**Staying fresh** — `src/live.js` `keepFresh()` re-fetches when the page becomes visible, every 5 minutes, and just after Singapore midnight; app.js skips it while a form has unsaved input. It also shows a "new version available" bar when the published page's stamp differs.

**Styles** — one `styles.css`, the "Midnight" theme: always dark, tokens on `:root`, Plus Jakarta Sans + JetBrains Mono from Google Fonts. Animations must stop under `prefers-reduced-motion`.

## Database (supabase/)

SQL is not applied automatically: the project owner pastes each file into the Supabase SQL Editor. New installs run `schema.sql`, then `003_private_data.sql`, `004_stable_history.sql`, `006_hardening.sql` (the README lists the order). Numbers 005, 007 and 009 were features that were later removed; `008_remove_calendar_sync.sql` and `010_remove_daily_email.sql` undo them on databases that ran them, which is why those files are absent.

- Never edit a migration the owner may already have run; add the next numbered file, make it safe to run twice (`if exists`, `create or replace`, `drop policy if exists`), and update the README's setup list.
- Front-end code that depends on a new migration should be published only after the owner confirms it ran.
- Access is enforced by RLS plus `security definer` functions with explicit `revoke … from public, anon` / `grant` lines; emails and leave notes are hidden by column grants and exposed only through `member_emails()` / `leave_notes()`.
- `config.js` holds the real project URL and anon key (public by design). To exercise the UI in demo mode, serve the site with an empty `config.js` (e.g. a browser-automation route override) rather than editing the committed file.
