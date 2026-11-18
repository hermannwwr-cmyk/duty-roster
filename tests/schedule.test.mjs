import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, isWeekend, addDays } from '../src/schedule.js';

const A = { id: 'a', name: 'Alice' }, B = { id: 'b', name: 'Ben' }, C = { id: 'c', name: 'Chloe' };
const names = d => d.duties.map(x => x.member.name);
// 2026-10-19 is a Monday.
const base = { members: [A, B, C], leaves: [], holidays: {}, anchor: '2026-10-19' };

test('weekends are detected', () => {
  assert.equal(isWeekend('2026-10-24'), true);   // Saturday
  assert.equal(isWeekend('2026-10-25'), true);   // Sunday
  assert.equal(isWeekend('2026-10-26'), false);  // Monday
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('everyone takes turns as Primary, Secondary 1, Secondary 2', () => {
  const days = buildSchedule({ ...base, from: '2026-10-19', to: '2026-10-21' });
  assert.deepEqual(names(days[0]), ['Alice', 'Ben', 'Chloe']);
  assert.deepEqual(names(days[1]), ['Ben', 'Chloe', 'Alice']);
  assert.deepEqual(names(days[2]), ['Chloe', 'Alice', 'Ben']);
  assert.deepEqual(days[0].duties.map(x => x.role), ['Primary', 'Secondary 1', 'Secondary 2']);
});

test('weekends and public holidays get no duty and do not advance the rotation', () => {
  const holidays = { '2026-10-26': 'Test Holiday' }; // Monday
  const days = buildSchedule({ ...base, holidays, from: '2026-10-23', to: '2026-10-27' });
  // Mon A, Tue B, Wed C, Thu A, so Friday (5th working day) is Ben.
  assert.deepEqual(names(days[0]), ['Ben', 'Chloe', 'Alice']);
  assert.equal(days[1].kind, 'weekend');
  assert.equal(days[2].kind, 'weekend');
  assert.equal(days[3].kind, 'holiday');
  assert.equal(days[3].holiday, 'Test Holiday');
  assert.deepEqual(names(days[4]), ['Chloe', 'Alice', 'Ben']);  // Tue picks up where Friday left off
});

test('a person on leave is skipped and the roles shrink to fit', () => {
  const leaves = [{ user_id: 'b', start_date: '2026-10-19', end_date: '2026-10-19' }];
  const [d] = buildSchedule({ ...base, leaves, from: '2026-10-19', to: '2026-10-19' });
  assert.deepEqual(names(d), ['Alice', 'Chloe']);
  assert.deepEqual(d.duties.map(x => x.role), ['Primary', 'Secondary 1']);
  assert.deepEqual(d.onLeave.map(m => m.name), ['Ben']);
});

test('missing your Primary turn does not make the next person Primary twice in a row', () => {
  // Alice would be Primary on Monday but is on leave.
  const leaves = [{ user_id: 'a', start_date: '2026-10-19', end_date: '2026-10-19' }];
  const days = buildSchedule({ ...base, leaves, from: '2026-10-19', to: '2026-10-20' });
  assert.equal(days[0].duties[0].member.name, 'Ben');
  assert.equal(days[1].duties[0].member.name, 'Chloe');
});

test('days before the rotation start and an empty team are handled', () => {
  const days = buildSchedule({ ...base, from: '2026-10-16', to: '2026-10-19' });
  assert.equal(days[0].kind, 'before-start');
  assert.deepEqual(names(days[3]), ['Alice', 'Ben', 'Chloe']);
  const empty = buildSchedule({ ...base, members: [], from: '2026-10-19', to: '2026-10-19' });
  assert.deepEqual(empty[0].duties, []);
});

test('everyone on leave leaves the day empty without breaking the next day', () => {
  const leaves = ['a', 'b', 'c'].map(id => ({ user_id: id, start_date: '2026-10-19', end_date: '2026-10-19' }));
  const days = buildSchedule({ ...base, leaves, from: '2026-10-19', to: '2026-10-20' });
  assert.equal(days[0].duties.length, 0);
  assert.deepEqual(names(days[1]), ['Alice', 'Ben', 'Chloe']);
});

test('only active, approved people are on the rota', async () => {
  const { onRota } = await import('../src/schedule.js');
  assert.equal(onRota({ active: true, approved: true }), true);
  assert.equal(onRota({ active: true }), true);                    // from before approval existed
  assert.equal(onRota({ active: true, approved: false }), false);  // waiting for approval
  assert.equal(onRota({ active: false, approved: true }), false);
});

test('the public calendar shares names and roles only, within its date window', async () => {
  const { publicCalendar } = await import('../src/schedule.js');
  const leaves = [{ user_id: 'b', start_date: '2026-10-20', end_date: '2026-10-20', note: 'private' }];
  const out = publicCalendar({ ...base, leaves, from: '2026-10-19', to: '2026-10-25', today: '2026-10-20' });
  const json = JSON.stringify(out);
  assert.ok(!json.includes('"b"') && !json.includes('private') && !json.includes('user_id'), 'no ids, notes or leave rows');
  assert.deepEqual(out.people, ['Alice', 'Ben', 'Chloe']);
  assert.deepEqual(out.days[1].duties, [{ role: 'Primary', name: 'Chloe' }, { role: 'Secondary 1', name: 'Alice' }]);
  assert.equal(out.days[5].kind, 'weekend');
  // Window: at most 90 days back, 180 ahead and 62 days long.
  const far = publicCalendar({ ...base, from: '2027-06-01', to: '2027-06-30', today: '2026-10-20' });
  assert.equal(far.days.length, 0);
  const long = publicCalendar({ ...base, from: '2026-10-19', to: '2027-03-01', today: '2026-10-20' });
  assert.equal(long.to, '2026-12-20');
});

test('issue #7: past duties stay put when people join, leave or are reordered', async () => {
  const { checkpointFor } = await import('../src/schedule.js');
  const P = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'].map(id => ({ id, name: id }));
  const ids = n => P.slice(0, n).map(p => p.id);
  const prim = days => days.filter(d => d.kind === 'work').map(d => d.duties[0].member.id).join(' ');
  const p = { people: P, leaves: [], holidays: {}, anchor: '2026-10-05', checkpoints: [{ effective_date: '2026-10-05', member_order: ids(5), next_primary: 'm0' }] };
  const week1 = { from: '2026-10-05', to: '2026-10-09' };
  const before = prim(buildSchedule({ ...p, ...week1 }));
  assert.equal(before, 'm0 m1 m2 m3 m4');

  // Mon 12 Oct: m5 joins. Last week must not change; this week continues where it left off.
  const cp1 = checkpointFor(p, '2026-10-12', ids(6));
  assert.deepEqual(cp1, { effective_date: '2026-10-12', member_order: ids(6), next_primary: 'm0' });
  const p1 = { ...p, checkpoints: [...p.checkpoints, cp1] };
  assert.equal(prim(buildSchedule({ ...p1, ...week1 })), before);
  assert.equal(prim(buildSchedule({ ...p1, from: '2026-10-12', to: '2026-10-16' })), 'm0 m1 m2 m3 m4');
  assert.equal(prim(buildSchedule({ ...p1, from: '2026-10-19', to: '2026-10-19' })), 'm5');

  // Wed 14 Oct: m2 (due that day) is deactivated. Mon/Tue keep their duties; m3 takes over.
  const p1b = { ...p1 };
  const cp2 = checkpointFor(p1b, '2026-10-14', ids(6).filter(i => i !== 'm2'));
  assert.equal(cp2.next_primary, 'm3');
  const p2 = { ...p1, checkpoints: [...p1.checkpoints, cp2] };
  assert.equal(prim(buildSchedule({ ...p2, from: '2026-10-12', to: '2026-10-16' })), 'm0 m1 m3 m4 m5');
  assert.equal(prim(buildSchedule({ ...p2, ...week1 })), before);
  // The removed person still shows on the days they actually did.
  assert.equal(prim(buildSchedule({ ...p2, from: '2026-10-07', to: '2026-10-07' })), 'm2');

  // A second change on the same day replaces that day's checkpoint, based on the pre-change state.
  const again = checkpointFor(p2, '2026-10-14', ['m5', 'm4', 'm3', 'm1', 'm0']);
  assert.equal(again.next_primary, 'm3');
});

test('changing the rotation before it starts just updates the first checkpoint', async () => {
  const { checkpointFor } = await import('../src/schedule.js');
  const p = { leaves: [], holidays: {}, checkpoints: [{ effective_date: '2026-11-02', member_order: ['a', 'b'], next_primary: 'a' }] };
  assert.deepEqual(checkpointFor(p, '2026-10-20', ['b', 'a', 'c']), { effective_date: '2026-11-02', member_order: ['b', 'a', 'c'], next_primary: 'b' });
});

test('the share message lists roles and names only, and the WhatsApp link carries it', async () => {
  const { rosterMessage, whatsappLink } = await import('../src/schedule.js');
  const day = { date: '2026-10-21', duties: [{ role: 'Primary', name: 'Hermann Woon' }, { role: 'Secondary 1', name: 'Jia An' }] };
  const text = rosterMessage(day, 'https://example.org/calendar.html');
  assert.equal(text, '2FA Login Request · Wed, 21 Oct\nPrimary: Hermann Woon\nSecondary 1: Jia An\n\nHi Hermann Woon (Primary), may we have OTP login for ...\nCalendar: https://example.org/calendar.html');
  // Shared by the Primary themselves: the same list, without asking them for an OTP.
  assert.equal(rosterMessage(day, 'https://example.org/calendar.html', { ask: false }), '2FA Login Request · Wed, 21 Oct\nPrimary: Hermann Woon\nSecondary 1: Jia An\nCalendar: https://example.org/calendar.html');
  assert.equal(whatsappLink('A & B\nC'), 'https://wa.me/?text=A%20%26%20B%0AC');
  assert.match(rosterMessage({ date: '2026-10-21', duties: [] }), /No one is available/);
});

test('short names', async () => {
  const { shortName } = await import('../src/schedule.js');
  const team = ['Alice Tan', 'Ben Lim', 'Ben Koh', 'Chloe Ng'];
  assert.equal(shortName('Alice Tan', team), 'Alice');
  assert.equal(shortName('  Chloe Ng ', team), 'Chloe');
  // Two people called Ben keep their full names, so the calendar can tell them apart.
  assert.equal(shortName('Ben Lim', team), 'Ben Lim');
  assert.equal(shortName('Ben Koh', team), 'Ben Koh');
  assert.equal(shortName('Dev Kumar'), 'Dev');
});

test('faces: the same name always gets the same face, and the name is not written into it', async () => {
  const { faceSvg } = await import('../src/faces.js');
  assert.equal(faceSvg('Alice Tan'), faceSvg('Alice Tan'));
  assert.equal(faceSvg('Alice Tan'), faceSvg('  alice tan '));
  assert.notEqual(faceSvg('Alice Tan'), faceSvg('Ben Lim'));
  assert.match(faceSvg('Chloe Ng'), /^<svg class="face" viewBox="0 0 64 64"/);
  assert.doesNotMatch(faceSvg('Chloe Ng'), /Chloe/);
  // Odd input still draws a face rather than throwing.
  assert.match(faceSvg(''), /^<svg/);
  assert.match(faceSvg(null), /^<svg/);
});

test('time until midnight in Singapore', async () => {
  const { msUntilSgMidnight } = await import('../src/live.js');
  const hour = 60 * 60 * 1000;
  assert.equal(msUntilSgMidnight(Date.parse('2026-10-21T15:00:00Z')), 1 * hour);   // 11pm in Singapore
  assert.equal(msUntilSgMidnight(Date.parse('2026-10-21T16:00:00Z')), 24 * hour);  // exactly midnight
  assert.equal(msUntilSgMidnight(Date.parse('2026-10-21T01:30:00Z')), 14.5 * hour); // 9:30am
});

test('the engineer scene follows the time of day in Singapore', async () => {
  const { periodAt, engineerScene } = await import('../src/engineer.js');
  const at = sgTime => periodAt(new Date('2026-10-21T' + sgTime + ':00+08:00'));   // a Wednesday
  assert.equal(at('05:59'), 'sleeping');
  assert.equal(at('06:00'), 'morning');
  assert.equal(at('12:00'), 'lunch');
  assert.equal(at('14:00'), 'afternoon');
  assert.equal(at('17:30'), 'evening');
  assert.equal(at('19:00'), 'afterwork');
  assert.equal(at('23:00'), 'sleeping');
  // Saturday and Sunday in Singapore are the weekend at any hour, even when it's still Friday in UTC.
  assert.equal(periodAt(new Date('2026-10-24T01:00:00+08:00')), 'weekend');
  assert.equal(periodAt(new Date('2026-10-25T23:30:00+08:00')), 'weekend');
  assert.equal(periodAt(new Date('2026-10-26T06:00:00+08:00')), 'morning');
  assert.equal(periodAt(new Date('2026-10-24T12:30:00+08:00'), { weekdays: false }), 'lunch');
  assert.match(engineerScene('holiday').caption, /Public holiday/);
  for (const p of ['morning', 'lunch', 'afternoon', 'evening', 'afterwork', 'sleeping', 'weekend', 'holiday']) assert.match(engineerScene(p).svg, /^<svg[^>]*aria-label="[^"]+"/);
  // With no part of the day given, it is the one `now` falls in; an unknown one is the morning.
  assert.equal(engineerScene(undefined, new Date('2026-10-21T12:30:00+08:00')).period, 'lunch');
  assert.equal(engineerScene('nonsense').period, 'morning');
});

test('the room says when the office opens again, and its clock keeps Singapore time', async () => {
  const { engineerScene, clockHands } = await import('../src/engineer.js');
  // Lunch is still duty time: nothing says the Primary is away.
  assert.doesNotMatch(engineerScene('lunch').caption + engineerScene('lunch').svg, /back at|away/i);
  assert.equal(engineerScene('lunch').caption, 'Lunch at the desk. Still happy to help.');
  assert.equal(engineerScene('closed', new Date(), { opens: '9am Monday' }).caption, 'Office closed. Opens at 9am Monday.');
  assert.match(engineerScene('closed', new Date(), { opens: '9am on Tue, 24 Nov' }).svg, /aria-label="Office closed\. Opens at 9am on Tue, 24 Nov\."/);
  assert.equal(engineerScene('closed').caption, 'Office closed.');
  // The hands: minute hand straight up and hour hand at 3 for 3pm, whatever the viewer's timezone.
  assert.equal(clockHands(new Date('2026-11-16T15:00:00+08:00')), 'M154 34l0.0 -7.5M154 34l5.3 -0.0');
  assert.notEqual(clockHands(new Date('2026-11-16T15:01:00+08:00')), clockHands(new Date('2026-11-16T15:00:00+08:00')));
  const now = new Date('2026-11-16T09:30:00+08:00');
  assert.ok(engineerScene('morning', now).svg.includes(`class="hands" d="${clockHands(now)}"`));
});

test('office hours are 9am to 6pm in Singapore, whatever the viewer\'s timezone', async () => {
  const { officeHours, minutesSG, msUntilOfficeChange } = await import('../src/schedule.js');
  const sg = hhmm => Date.parse('2026-11-16T' + hhmm + ':00+08:00');
  assert.equal(minutesSG(sg('00:00')), 0);
  assert.equal(minutesSG(sg('23:59')), 23 * 60 + 59);
  assert.equal(officeHours(sg('08:59')), 'before');
  assert.equal(officeHours(sg('09:00')), 'open');
  assert.equal(officeHours(sg('17:59')), 'open');
  assert.equal(officeHours(sg('18:00')), 'after');
  assert.equal(officeHours(sg('23:30')), 'after');
  assert.equal(officeHours(sg('00:30')), 'before');
  const hour = 60 * 60 * 1000;
  assert.equal(msUntilOfficeChange(sg('08:00')), hour);
  assert.equal(msUntilOfficeChange(sg('12:00')), 6 * hour);
  assert.equal(msUntilOfficeChange(sg('18:00')), 15 * hour);
  assert.equal(msUntilOfficeChange(sg('23:00')), 10 * hour);
});
