# Round 2: database and invite fixes (handoff plan)

Written 19 Nov 2026 so that any Claude session, with no memory of the conversation that produced it, can carry
Round 2 on. Read CLAUDE.md first (it describes the app and how the owner works); this file covers only Round 2.

## Status

- **Live:** `main` is at 383aa59 (Round 1: today's Primary stays as announced, calm offline handling, iPhone
  forms, Remove access, the public page always loading, new captions). Published 18 Nov 2026 and confirmed by the
  Actions run. The owner was asked to check it on their iPhone.
- **Round 2 is not started and not approved.** The owner had it explained (items 1 to 7 below) and asked how each
  is fixed, then asked for this handoff. Nothing in this folder has been run on the live database.
- **Still to ask the owner:**
  1. Does the team use the Outlook invite feature for leave? If not, items 1 to 4 matter little and the Google
     script (step 4) can wait. Items 5 to 7 matter either way.
  2. Item 5: hide the settings from people awaiting approval (front end plus migration), or simply switch off
     "Allow new users to sign up" in Supabase (Authentication settings) except while someone is joining.
  3. Item 4: cap invite leave at about a year (recommended; Singapore maternity plus shared parental leave can
     run to about 26 weeks, so 180 days is too tight).
- This folder is on the work branch. Like every file in the repo it is served by GitHub Pages once `main` has it;
  it describes fixes, not ways to abuse the gaps, and CLAUDE.md already lists the gaps. Keep it that way: don't
  add step-by-step abuse instructions here. Remove the folder once Round 2 is live (move anything lasting into
  CLAUDE.md, REBUILD.md and the README).

## What's in this folder

- `draft-012.sql.txt`: a starting draft of migration 012 covering items 1 to 7. Tested pieces, assembled; see
  its header. Named `.txt` so nobody pastes it by mistake. Not ready to run.
- `localdb/`: a local stand-in for the Supabase database, to test SQL without touching the live project.
  - `start.sh` / `stop.sh`: Postgres 16 (installed in Claude Code cloud sessions at `/usr/lib/postgresql/16/bin`)
    in a user namespace, because Postgres refuses to run as root. Defaults: port 54330, data in
    `${TMPDIR:-/tmp}/duty-roster-pg`; override with `PGPORT` and `PGDIR` (use the session's scratchpad).
  - `load.sh <db> [extra.sql…]`: a fresh database with Supabase's roles and `auth.uid()` (`supabase-stub.sql`),
    the migrations in the README's order, a test clock (`set test.today = '2026-11-18';`), then any extra files.
  - `as.sh <db> anon|<user uuid> "<sql>"`: runs SQL as that user the way the browser's requests do (role plus
    JWT claims), rolled back afterwards.
  - `sync-cases.sql`: checks items 1 to 4 against a database loaded with the draft. It passes on the draft and
    fails at item 1 on today's database, so it really tests the fix.

  Tested 19 Nov: `load.sh` loads today's migrations cleanly; as a member, reading other people's emails is
  refused; anon can call `public_calendar()`; the draft loads twice; `sync-cases.sql` passes.

## The items

Plain-English versions, as the owner heard them, are given first in each item: reuse that wording when talking
to the owner (they are not a developer and judge on an iPhone).

### Item 1: an Outlook leave moved after it started keeps the person off the roster in between
- *Owner's version:* Ben's leave is Mon to Fri; he's back Wednesday and moves the rest to next week; the app keeps
  him off the roster from Wednesday to next week.
- **Cause:** `sync_leave_invites()` in `supabase/011_leave_invites.sql` (about lines 139 to 144): for leave that
  has begun it keeps the old start, so a protected history isn't rewritten, and moves only the end, so 16-20 moved
  to 25-27 becomes 16-27.
- **Fix (migration):** when leave has begun and the invite now starts after today, or the old leave had already
  ended, end the old row at `least(old_end, today - 1)`, clear its `invite_uid`, and insert a new row for the new
  dates. In the draft. `least(...)` matters: plain "yesterday" would extend an old row that had already ended.

### Item 2: fake invites can put someone on leave
- *Owner's version:* anyone who knows the shared Gmail address can send an invite that names a teammate as its
  organiser; the script believes it; deleting the leave in the app doesn't help (the next sync re-adds it); only
  deleting the email in Gmail stops it. Harm is disruption (wrong Primary, "No duty cover"), not a data leak.
  The owner later asked how to change the organiser line; that was declined. Don't provide that.
- **Cause:** `scripts/leave-invites.gs` takes the organiser only from the attached `.ics` (about line 80) and never
  checks who sent the email (it reads only `getAttachments()` and `getDate()`). The sync skips the leave rules
  because no user is signed in (`006_hardening.sql` about line 79), so there are no length limits (item 4), and
  an existing invite id arriving with another organiser moved the leave to that person.
- **Fix, part A (script, the main fix):** accept an invite only if Gmail authenticated the sender and the sender
  is the invite's organiser:
  - The email's From address (`getFrom()`) must equal the organiser, or the organiser's `SENT-BY` delegate.
  - The first `Authentication-Results: mx.google.com` header in `getRawContent()` must show `dmarc=pass` (or
    `dkim=pass` for the From domain). `getFrom()` alone is just header text.
  - Real Outlook invites, updates and cancellations come from the organiser, so they keep working.
  - Test with a stubbed `GmailApp` message in node (load the `.gs` with `vm`, stub `Utilities`, `GmailApp`,
    `UrlFetchApp`): a matching, authenticated sender is accepted; a mismatched or unauthenticated one is
    ignored and logged. Earlier reviewers built such a harness in their scratchpad (now gone); rebuild it.
- **Fix, part B (migration, backstop, in the draft):** an invite's leave never moves to another person, a null
  or missing secret never passes, and the length limits (item 4) apply.

### Item 3: one broken invite stops all invite syncing
- **Cause:** the sync casts every event's dates in one go, so one bad value ("2026-11-31") or an invite id over
  about 2.7 KB (index row limit) fails the whole call; from then on every 15-minute run fails silently.
- **Fix (migration, in the draft):** a `begin … exception` block per invite; bad ones are skipped and counted
  (`skipped` in the result). Optionally also check dates in the script's `parseInvite` and catch errors per email.

### Item 4: no limits on invite leave
- **Cause:** as in item 2, the sync bypasses `enforce_leave_rules()`.
- **Fix (migration, in the draft):** shorten rather than refuse (a refusal would skip the invite): leave is at most
  365 days from its first day, and an invite starting more than a year ahead is left out until it is within a
  year (it is still in the inbox, so a later sync picks it up). Owner to confirm the one-year cap.

### Item 5: people awaiting approval can read the settings, including the invite address
- **Cause:** `schema.sql:103`, the "read settings" policy is `using (true)` for any signed-in user.
- **Fix:**
  1. **Front end first:** `SupabaseStore.load` (`src/store.js` about line 100) uses `.single()` on settings,
     which errors when no row comes back. Use `.maybeSingle()` with an empty fallback, so a person awaiting
     approval still sees their waiting screen. Mirror it in DemoStore (pending users get no settings) and add a
     test. Publish this (preview, owner's Ok, `npm run stamp`) before the migration runs.
  2. **Migration (in the draft):** settings readable only by members or admins. Holidays are public data and stay
     readable.
- **No-code alternative:** switch off sign-ups in Supabase while nobody is joining.

### Item 6: people whose access was removed can still change their own leave through the API
- **Cause:** "change own leave" and "delete own leave" (`schema.sql` about lines 113 to 116) check only
  `user_id = auth.uid()`, not `is_member()`; the same for "update own profile" (renaming).
- **Fix (migration, in the draft):** require `public.is_member()` (or admin) in those three policies.
- **Check first:** a reviewer believes the "read leaves" policy (which requires `is_member()`) already blocks
  updates and deletes that filter by column, which is everything supabase-js sends. Confirm with `as.sh` as a
  removed user (approved, active and is_admin false); add the policy change only if it's needed, or keep it as a
  belt-and-braces with a comment saying so.

### Item 7: members could get round the app in two ways
- **a. Stretching old leave over past days** (rewrites who was on duty): `enforce_leave_rules()` in
  `006_hardening.sql` (about lines 84 to 93) allows extending leave whose end is already past. **Fix (draft):**
  refuse when `least(new.end_date, old.end_date) < today - 1`. End early and extending leave that ended yesterday
  still work. Mirror in `DemoStore.leaveRule`, with a test, and give the error plain words (see `plainError` in
  `src/store.js`).
- **b. Writing `work_email` directly**, bypassing `set_work_email()`'s checks (so a member could claim a
  colleague's address and receive their invite leave); also `created_at` and `invite_uid`. Supabase's default
  table-wide grants allow it and `protect_profile_fields()` doesn't cover those columns. **Fix (draft):**
  column-level grants, so members can update only `display_name, rota_order, active, is_admin, approved` on
  profiles and insert/update only `user_id, start_date, end_date, note` on leaves; and in the sync, the sign-in
  email wins a tie. **Risk:** a missed column breaks a normal save. Run every app write as admin, member, pending
  and removed users (the list is in `src/store.js`: each `SupabaseStore` method) before shipping.

## Order of work

1. **Grants check (owner, 1 minute).** In the Supabase SQL Editor:
   `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3;`
   Expect broad table privileges (SELECT, INSERT, UPDATE, DELETE…) for both roles; the app can't work otherwise.
   If they are narrower (projects created after Supabase's 2026-05-30 change), item 7b's grant lines need
   rethinking: test with the last three lines of `localdb/supabase-stub.sql` removed.
2. **Item 5 front end** (if the owner chooses that route): build, `npm test`, `node scripts/ui-check.cjs`,
   pictures if anything is visible, owner's Ok, `npm run stamp`, publish.
3. **Finish 012:**
   - Settle item 6 with `as.sh`.
   - Check every app write as each kind of user, and every refusal.
   - Run `sync-cases.sql`; run the file twice; check `public_calendar()` is untouched (the rotation must stay
     identical between `src/schedule.js` and the SQL).
   - Write `supabase/012_round2.sql`, safe to run twice (`create or replace`, `drop policy if exists`).
   - Write an undo file that puts back the 006 trigger, the 011 sync function, the schema.sql policies and the
     table-wide grants. Keep it outside `supabase/` (for example `docs/round2/undo-012.sql`) so it isn't run by
     mistake.
   - Add 012 to the README's setup list.
   - Mirror the new rules in DemoStore with tests (CLAUDE.md: demo mode must fail the way production does).
4. **Owner runs 012:** step-by-step instructions (open SQL Editor, New query, paste the whole file, Run, expect
   "Success. No rows returned"). Publish any front end that depends on it only after they confirm.
5. **Script (only if the team uses invites):** the sender check (item 2A), plus the smaller parser fixes:
   - an `ORGANIZER;SENT-BY="mailto:…"` line currently leaves a stray quote on the address, so the invite goes
     unmatched;
   - a quoted `TZID` containing a colon drops the event;
   - ignore `METHOD:REPLY` and `COUNTER`;
   - support `DURATION`;
   - check dates;
   - catch errors per email.

   The repo copy keeps `SCRIPT_SECRET = 'paste-the-script-secret-here'`; the real secret only goes into the
   Google copy (or Script Properties). Give the owner click-by-click steps for script.google.com in the shared
   Google account. Pushing the file deploys nothing.
6. **Owner's check:** send one real out-of-office Outlook invite to the shared address; within 15 minutes the
   leave appears; cancelling it removes it.
7. **Docs:** in CLAUDE.md, remove fixed items from "Known gaps" and describe the new rules; update REBUILD.md and
   the README; delete this folder (keep the localdb kit elsewhere if useful, for example under `scripts/`).

Follow the owner's way of working throughout:
- a short brief before changing anything;
- independent subagents for the work and separate critics to review it, in rounds, when the owner asks for that;
- before/after phone pictures (`scripts/shots.cjs`) for anything visible;
- nothing to `main` without their "Ok";
- commits end with the attribution lines the session gives you.

## Other open points (not Round 2 unless the owner asks)

- **End early can change today's Primary.** "End early (back today)" can still change today's Primary. Freezing it
  for members needs a migration, because only admins can save checkpoints.
- **Recurring invites (RRULE)** count their first occurrence only; documented in the README. Building it means
  expanding RRULE/EXDATE in the script: medium to high effort.
- **The Supabase client** loads from jsdelivr with no integrity hash or CSP. Optional fix: keep a copy of the
  library in the repo.
- **"Forgot password":** none; the owner said later. It needs `resetPasswordForEmail` and a `PASSWORD_RECOVERY`
  screen, and a live test by the owner.
- **Notifications to phones:** the owner asked. The recommendation was a daily prefilled WhatsApp "today's duty"
  message (small), rather than web push: on iPhone, web push needs the site added to the Home Screen from Safari
  (every iPhone browser, Chrome included, uses Apple's engine) plus a scheduled sender in Supabase, and real-device
  testing. Still to ask: who gets it, when, and what it says.
- **Fonts:** the owner asked. The recommendation was to keep Plus Jakarta Sans and JetBrains Mono; alternatives
  were offered (Inter, Figtree or Onest, Nunito Sans; Space Mono or IBM Plex Mono). No change requested.
- **Small leftovers:**
  - `scripts/shots.cjs --redraw`'s help text is out of date (see CLAUDE.md).
  - The comment in `supabase/003_private_data.sql` says new installs start with the public calendar off; it is
    on. Don't edit that migration (it may have been run); the README already says on.
  - The lunch caption wraps to two lines at 320px; accepted as fine.
