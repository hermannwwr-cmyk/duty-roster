// Leave from Outlook invites: turns the out-of-office invites in this Google account's calendar into
// leave on the duty roster, every 15 minutes. See supabase/011_leave_invites.sql.
//
// Set up once, in the shared Google account people invite (for example ourteam.leave@gmail.com):
// 1. Google Calendar > Settings > Event settings > "Add invitations to my calendar": From everyone.
// 2. In Supabase > SQL Editor run:  select script_secret from public.invite_config;
//    and paste the result into SCRIPT_SECRET below.
// 3. Go to https://script.google.com, New project, paste this whole file, Save.
// 4. Choose setUp in the function menu and click Run. Allow the permissions Google asks for.
//    setUp syncs once straight away and then every 15 minutes.
//
// Only all-day events, or events lasting a full day or more, count as leave, so an ordinary meeting
// sent to this address by mistake takes nobody off the roster.

const SCRIPT_SECRET = 'paste-the-script-secret-here';
const SUPABASE_URL = 'https://cvpopqncgchpoyjtwpdt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2cG9wcW5jZ2NocG95anR3cGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0Nzg1MjEsImV4cCI6MjEwODA1NDUyMX0.PbthkMeHtWu3cNJZiX0yTmcC1Ll9ZQnPdR7kVZQ-8k4';
const DAYS_AHEAD = 365;

/** Sends every upcoming leave-like invite to Supabase. Anything missing from the list counts as cancelled. */
function syncLeaveInvites() {
  const tz = Session.getScriptTimeZone(), sg = 'Asia/Singapore';
  const day = (date, zone) => Utilities.formatDate(date, zone, 'yyyy-MM-dd');
  const now = new Date(), until = new Date(now.getTime() + DAYS_AHEAD * 864e5);
  const events = CalendarApp.getDefaultCalendar().getEvents(new Date(now.getTime() - 864e5), until);
  const leave = [];
  events.forEach(function (e) {
    if (e.isOwnedByMe()) return;                                          // only invites from other people
    if (e.getMyStatus() === CalendarApp.GuestStatus.NO) return;           // declined here: ignore
    let start, end;
    if (e.isAllDayEvent()) {
      start = day(e.getAllDayStartDate(), tz);
      end = day(new Date(e.getAllDayEndDate().getTime() - 864e5), tz);   // the end date is exclusive
    } else if (e.getEndTime() - e.getStartTime() >= 20 * 3600e3) {       // a timed event lasting a day or more
      start = day(e.getStartTime(), sg);
      end = day(new Date(e.getEndTime().getTime() - 60e3), sg);
    } else return;                                                        // an ordinary meeting
    const organizer = (e.getCreators()[0] || '').toLowerCase();
    if (!organizer) return;
    leave.push({ uid: e.getId() + (e.isRecurringEvent() ? '@' + start : ''), organizer: organizer,
      title: e.getTitle(), start: start, end: end });
  });
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/sync_leave_invites', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    payload: JSON.stringify({ p_secret: SCRIPT_SECRET, p_events: leave }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Supabase said: ' + res.getContentText());
  console.log('Synced ' + leave.length + ' invite(s): ' + res.getContentText());
}

/** Run once: syncs now, then every 15 minutes. */
function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncLeaveInvites').timeBased().everyMinutes(15).create();
  syncLeaveInvites();
}
