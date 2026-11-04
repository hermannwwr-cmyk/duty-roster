// Leave from Outlook invites: reads the calendar invite emails in this Gmail account and sends the
// leave they describe to the duty roster, every 15 minutes. See supabase/011_leave_invites.sql.
//
// It reads the invite emails rather than the calendar, because Google often copies Outlook invites into
// the calendar as its own events, which hides who sent them. Each invite email carries a calendar file
// (invite.ics) with the organiser, the dates, and whether it's an update or a cancellation.
//
// Set up once, in the shared Google account people invite (for example ourteam.leave@gmail.com):
// 1. In Supabase > SQL Editor run:  select script_secret from public.invite_config;
//    and paste the result into SCRIPT_SECRET below.
// 2. Go to https://script.google.com, New project, paste this whole file, Save.
// 3. Choose setUp in the function menu and click Run. Allow the permissions Google asks for
//    (reading Gmail, and connecting to Supabase). setUp syncs once and then every 15 minutes.
//
// What counts as leave: all-day events, events lasting a day or more, and events marked Out of office
// in Outlook lasting 4 hours or more. Ordinary meetings sent here by mistake take nobody off the roster.

const SCRIPT_SECRET = 'paste-the-script-secret-here';
const SUPABASE_URL = 'https://cvpopqncgchpoyjtwpdt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2cG9wcW5jZ2NocG95anR3cGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0Nzg1MjEsImV4cCI6MjEwODA1NDUyMX0.PbthkMeHtWu3cNJZiX0yTmcC1Ll9ZQnPdR7kVZQ-8k4';
const LOOK_BACK = '400d';   // how far back to read invite emails

/** Sends every current leave invite to Supabase. Invites that were cancelled, or have gone, count as removed. */
function syncLeaveInvites() {
  const latest = {};   // uid -> the newest version of that invite
  for (let start = 0; ; start += 100) {
    const threads = GmailApp.search('newer_than:' + LOOK_BACK + ' filename:ics', start, 100);
    threads.forEach(function (t) {
      t.getMessages().forEach(function (m) {
        m.getAttachments().forEach(function (a) {
          if (!/calendar|\.ics$/i.test(a.getContentType() + ' ' + a.getName())) return;
          parseInvite(a.getDataAsString()).forEach(function (ev) {
            ev.sent = m.getDate().getTime();
            const old = latest[ev.uid];
            if (!old || ev.sequence > old.sequence || (ev.sequence === old.sequence && ev.sent >= old.sent)) latest[ev.uid] = ev;
          });
        });
      });
    });
    if (threads.length < 100) break;
  }
  const today = Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM-dd');
  const leave = Object.keys(latest).map(function (k) { return latest[k]; })
    .filter(function (ev) { return !ev.cancelled && ev.leave && ev.end >= today; })
    .map(function (ev) { return { uid: ev.uid, organizer: ev.organizer, title: ev.title, start: ev.start, end: ev.end }; });

  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/sync_leave_invites', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    payload: JSON.stringify({ p_secret: SCRIPT_SECRET, p_events: leave }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Supabase said: ' + res.getContentText());
  console.log('Synced ' + leave.length + ' leave invite(s): ' + res.getContentText());
}

/** The events in an invite's calendar file, with dates in Singapore time and whether they count as leave. */
function parseInvite(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);   // unfold long lines
  const method = ((lines.find(function (l) { return /^METHOD:/i.test(l); }) || '').split(':')[1] || '').trim().toUpperCase();
  const events = [];
  let ev = null;
  lines.forEach(function (line) {
    if (/^BEGIN:VEVENT/i.test(line)) { ev = {}; return; }
    if (/^END:VEVENT/i.test(line)) { if (ev) events.push(ev); ev = null; return; }
    if (!ev) return;   // skip VTIMEZONE and other blocks, which have their own DTSTART lines
    const name = line.split(/[;:]/)[0].toUpperCase(), value = line.slice(line.indexOf(':') + 1).trim();
    ev[name] = ev[name] || { line: line, value: value };
  });
  return events.map(function (e) {
    const get = function (k) { return e[k] ? e[k].value : ''; };
    const start = when(e.DTSTART), endRaw = when(e.DTEND || e.DTSTART);
    if (!start || !endRaw || !get('UID')) return null;
    const allDay = start.dateOnly || /TRUE/i.test(get('X-MICROSOFT-CDO-ALLDAYEVENT'));
    const hours = (endRaw.time - start.time) / 36e5;
    const outOfOffice = /OOF/i.test(get('X-MICROSOFT-CDO-BUSYSTATUS') + get('X-MICROSOFT-CDO-INTENDEDSTATUS'));
    // The last day of leave: an all-day end is exclusive; a timed end counts the day it ends in.
    const end = allDay ? shift(endRaw.date, endRaw.date > start.date ? -1 : 0) : sgDate(new Date(endRaw.time - 60e3));
    const organizer = ((e.ORGANIZER ? e.ORGANIZER.line : '').match(/mailto:([^\s;:]+)/i) || [])[1] || '';
    return {
      uid: get('UID') + (e['RECURRENCE-ID'] ? '@' + e['RECURRENCE-ID'].value : ''),
      sequence: Number(get('SEQUENCE')) || 0,
      organizer: organizer.toLowerCase(),
      title: get('SUMMARY').replace(/\\([,;\\])/g, '$1'),
      start: start.date, end: end < start.date ? start.date : end,
      leave: allDay || hours >= 20 || (outOfOffice && hours >= 4),
      cancelled: method === 'CANCEL' || /CANCELLED/i.test(get('STATUS'))
    };
  }).filter(function (ev) { return ev && ev.organizer; });
}

/** A DTSTART/DTEND property as { date: 'YYYY-MM-DD' in Singapore, time: ms, dateOnly }. */
function when(prop) {
  if (!prop) return null;
  const m = prop.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const date = m[1] + '-' + m[2] + '-' + m[3];
  if (!m[4]) return { date: date, time: Date.parse(date + 'T00:00:00+08:00'), dateOnly: true };
  // UTC times are converted; times with a time zone are taken as Singapore local time (the team's).
  const time = m[7] ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    : Date.parse(date + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+08:00');
  return { date: sgDate(new Date(time)), time: time, dateOnly: false };
}
function sgDate(d) { return Utilities.formatDate(d, 'Asia/Singapore', 'yyyy-MM-dd'); }
function shift(iso, days) { return sgDate(new Date(Date.parse(iso + 'T12:00:00+08:00') + days * 864e5)); }

/** Run once: syncs now, then every 15 minutes. */
function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncLeaveInvites').timeBased().everyMinutes(15).create();
  syncLeaveInvites();
}
