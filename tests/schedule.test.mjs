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
