// 2FA Login daily email, sent from your Gmail every working day at 9am Singapore time.
//
// Set up once (about 5 minutes):
// 1. In Supabase > SQL Editor, run:  select script_secret from public.email_config;
//    and paste the result into SCRIPT_SECRET below.
// 2. Go to https://script.google.com, click New project, delete what's there and paste this whole file.
// 3. Click Save, choose setUp in the function menu at the top, and click Run. Allow the permissions
//    Google asks for (it needs to send email as you and to connect to Supabase).
//    setUp sends today's email once as a test and schedules it for 9am every day.
//
// The email is sent from the Google account you use here. Gmail allows 100 recipients a day.

const SCRIPT_SECRET = 'paste-the-script-secret-here';
const SUPABASE_URL = 'https://cvpopqncgchpoyjtwpdt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2cG9wcW5jZ2NocG95anR3cGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0Nzg1MjEsImV4cCI6MjEwODA1NDUyMX0.PbthkMeHtWu3cNJZiX0yTmcC1Ll9ZQnPdR7kVZQ-8k4';
const SENDER_NAME = '2FA Login';

/** Runs every morning: asks Supabase for today's email and sends it to each approved address. */
function sendDailyEmail(test) {
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/daily_email', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    payload: JSON.stringify({ p_secret: SCRIPT_SECRET, p_test: test === true }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Supabase said: ' + res.getContentText());
  const mail = JSON.parse(res.getContentText());
  if (!mail.send) { console.log('Nothing sent: ' + mail.reason); return; }
  mail.to.forEach(function (person) {
    MailApp.sendEmail({
      to: person.email,
      subject: mail.subject,
      body: mail.text.split('{{UNSUBSCRIBE}}').join(person.unsubscribe),
      htmlBody: mail.html.split('{{UNSUBSCRIBE}}').join(person.unsubscribe),
      name: SENDER_NAME
    });
  });
  console.log('Sent to ' + mail.to.length + ' address(es).');
}

/** Run once: sends a test, then schedules sendDailyEmail for 9am Singapore time every day. */
function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendDailyEmail').timeBased().everyDays(1).atHour(9).nearMinute(0).inTimezone('Asia/Singapore').create();
  sendDailyEmail(true);
}
