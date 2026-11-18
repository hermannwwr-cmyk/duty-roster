// Rotation history: today's Primary stays as announced, corrections to past days change only those days, and an
// admin's page puts right a rotation that doesn't match the team (src/schedule.js: checkpointFor, rotaChange, pastEdit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, checkpointFor, rotaChange, pastEdit } from '../src/schedule.js';

const P = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id, name: id }));
const who = id => P.find(p => p.id === id);
// A rotation of `ids` from Monday 2 November 2026 (A first), with the same people as the app passes in.
const rota = (ids, more = {}) => ({ members: ids.map(who), people: P, leaves: [], holidays: {}, anchor: '2026-11-02',
  checkpoints: [{ effective_date: '2026-11-02', member_order: ids, next_primary: ids[0] }], ...more });
const save = (p, cps) => ({ ...p, checkpoints: p.checkpoints.filter(c => !cps.some(k => k.effective_date === c.effective_date)).concat(cps) });
// Each weekday as "date:Primary>Secondaries" ("16:A>BC"), "date:-" with no one available, or "date:holiday".
const days = (p, from = '2026-11-02', to = '2026-11-27') => buildSchedule({ ...p, from, to }).filter(d => d.kind !== 'weekend')
  .map(d => d.date.slice(8) + ':' + (d.kind !== 'work' ? d.kind : d.duties.map(x => x.member.id).join('').replace(/^(.)/, '$1>') || '-'));
const primaryOn = (p, date) => (buildSchedule({ ...p, from: date, to: date })[0].duties[0] || {}).member;
/** The days that differ between two lists from days(). */
const diff = (a, b) => a.filter((x, i) => x !== b[i]).map(x => x.slice(0, 2));
const TODAY = '2026-11-18';   // a Wednesday

test('a past holiday removed: only that day changes, and today\'s Primary stays', () => {
  // Mon 9 Nov was a holiday. A B C from Mon 2 Nov: … Fri 6 B, (Mon 9 holiday), Tue 10 C, … Wed 18 C.
  const before = rota(['A', 'B', 'C'], { holidays: { '2026-11-09': 'Deepavali (Observed)' } });
  const after = { ...before, holidays: {} };
  assert.equal(primaryOn(before, TODAY).id, 'C');
  assert.equal(primaryOn(after, TODAY).id, 'A', 'without a checkpoint, everything from 9 Nov moves on by one');
  const e = pastEdit(before, after, '2026-11-09', '2026-11-09', TODAY);
  assert.deepEqual(e.changed, ['2026-11-09']);
  assert.deepEqual(e.checkpoints, [{ effective_date: '2026-11-10', member_order: ['A', 'B', 'C'], next_primary: 'C' }]);
  assert.deepEqual([e.day, e.was.id, e.now.id], [TODAY, 'C', 'C']);
  const fixed = save(after, e.checkpoints);
  assert.deepEqual(diff(days(before), days(fixed)), ['09']);
  assert.equal(primaryOn(fixed, TODAY).id, 'C');
});

test('a holiday added after the fact: only that day changes; the Primary who lost it doesn\'t get the turn back', () => {
  const before = rota(['A', 'B', 'C']);
  const after = { ...before, holidays: { '2026-11-12': 'Polling Day' } };
  const e = pastEdit(before, after, '2026-11-12', '2026-11-12', TODAY);
  assert.deepEqual(e.changed, ['2026-11-12']);
  const fixed = save(after, e.checkpoints);
  assert.deepEqual(diff(days(before), days(fixed)), ['12']);
  assert.equal(primaryOn(fixed, '2026-11-13').id, primaryOn(before, '2026-11-13').id);
  assert.equal(primaryOn(fixed, TODAY).id, primaryOn(before, TODAY).id);
});

test('past leave recorded for that day\'s Primary changes only that day', () => {
  const before = rota(['A', 'B', 'C']);
  const p13 = primaryOn(before, '2026-11-13').id;
  const after = { ...before, leaves: [{ user_id: p13, start_date: '2026-11-13', end_date: '2026-11-13' }] };
  const e = pastEdit(before, after, '2026-11-13', '2026-11-13', TODAY);
  assert.deepEqual(e.changed, ['2026-11-13']);
  assert.equal(e.checkpoints[0].effective_date, '2026-11-14');   // a Saturday: the next working day starts from it
  const fixed = save(after, e.checkpoints);
  assert.deepEqual(diff(days(before), days(fixed)), ['13']);
  assert.notEqual(primaryOn(fixed, '2026-11-13').id, p13);
});

test('leave recorded from the past into today: past days change, and today is as if the leave were added today', () => {
  const before = rota(['A', 'B', 'C'], { holidays: { '2026-11-09': 'Deepavali (Observed)' } });   // Fri 13 C, Mon 16 A, Tue 17 B, Wed 18 C
  const c = primaryOn(before, TODAY).id;
  const leave = { user_id: c, start_date: '2026-11-13', end_date: '2026-11-19' };
  const after = { ...before, leaves: [leave] };
  const e = pastEdit(before, after, leave.start_date, leave.end_date, TODAY);
  assert.deepEqual(e.changed, ['2026-11-13', '2026-11-16', '2026-11-17']);
  assert.equal(e.checkpoints[0].effective_date, TODAY);
  assert.deepEqual([e.was.id, e.now.id], ['C', 'A']);
  const fixed = save(after, e.checkpoints);
  // From today on it matches leave for C added this morning to the rotation as it stood.
  const sameDay = { ...save(before, [{ effective_date: TODAY, member_order: ['A', 'B', 'C'], next_primary: 'C' }]), leaves: [leave] };
  assert.deepEqual(days(fixed, TODAY), days(sameDay, TODAY));
  // Leave on someone who isn't Primary today keeps today's Primary.
  const other = { ...before, leaves: [{ user_id: 'A', start_date: '2026-11-16', end_date: TODAY }] };
  const e2 = pastEdit(before, other, '2026-11-16', TODAY, TODAY);
  assert.deepEqual([e2.was.id, e2.now.id], ['C', 'C']);
});

test('nothing is saved when the correction changes no past duties, or reaches no further back than today', () => {
  const before = rota(['A', 'B', 'C']);
  // A holiday on a past Saturday.
  assert.deepEqual(pastEdit(before, { ...before, holidays: { '2026-11-14': 'x' } }, '2026-11-14', '2026-11-14', TODAY), { checkpoints: [], changed: [], day: null, was: null, now: null });
  // Leave for someone not on the rotation.
  assert.equal(pastEdit(before, { ...before, leaves: [{ user_id: 'E', start_date: '2026-11-10', end_date: '2026-11-10' }] }, '2026-11-10', '2026-11-10', TODAY).checkpoints.length, 0);
  // Before the rotation started.
  const later = rota(['A', 'B', 'C'], { checkpoints: [{ effective_date: '2026-11-16', member_order: ['A', 'B', 'C'], next_primary: 'A' }] });
  assert.equal(pastEdit(later, { ...later, holidays: { '2026-11-10': 'x' } }, '2026-11-10', '2026-11-10', TODAY).checkpoints.length, 0);
  // From today on, leave works as it always has.
  assert.equal(pastEdit(before, { ...before, leaves: [{ user_id: 'C', start_date: TODAY, end_date: TODAY }] }, TODAY, TODAY, TODAY).changed.length, 0);
});

test('a checkpoint already on the day after is kept, and no other is needed', () => {
  const before = save(rota(['A', 'B', 'C'], { holidays: { '2026-11-09': 'x' } }), [{ effective_date: '2026-11-10', member_order: ['A', 'B', 'C'], next_primary: 'B' }]);
  const after = { ...before, holidays: {} };
  const e = pastEdit(before, after, '2026-11-09', '2026-11-09', TODAY);
  assert.deepEqual([e.changed, e.checkpoints], [['2026-11-09'], []]);
  assert.deepEqual(diff(days(before), days(after)), ['09']);
});

test('at the weekend, the next working day\'s Primary is the one reported', () => {
  const before = rota(['A', 'B', 'C'], { holidays: { '2026-11-09': 'x' } });
  const e = pastEdit(before, { ...before, holidays: {} }, '2026-11-09', '2026-11-09', '2026-11-21');
  assert.deepEqual([e.day, e.was.id, e.now.id], ['2026-11-23', primaryOn(before, '2026-11-23').id, primaryOn(before, '2026-11-23').id]);
});

test('data from before checkpoints existed: the correction saves the rotation it stood for first', () => {
  const before = { members: ['A', 'B', 'C'].map(who), people: P, leaves: [], holidays: { '2026-11-09': 'x' }, anchor: '2026-11-02', checkpoints: [] };
  const after = { ...before, holidays: {} };
  const e = pastEdit(before, after, '2026-11-09', '2026-11-09', TODAY);
  assert.deepEqual(e.checkpoints, [{ effective_date: '2026-11-02', member_order: ['A', 'B', 'C'], next_primary: 'A' },
    { effective_date: '2026-11-10', member_order: ['A', 'B', 'C'], next_primary: 'C' }]);
  assert.deepEqual(diff(days(before), days({ ...after, checkpoints: e.checkpoints })), ['09']);
  assert.deepEqual(rotaChange(before, TODAY, ['A', 'B', 'C']), [], 'nothing to put right');
});

test('approving someone keeps today\'s Primary when the person whose turn it is is on leave', () => {
  // Mon 16 A, Tue 17 B, Wed 18: C's turn, but C is away, so A is Primary.
  const p = rota(['A', 'B', 'C'], { anchor: '2026-11-16', checkpoints: [{ effective_date: '2026-11-16', member_order: ['A', 'B', 'C'], next_primary: 'A' }],
    leaves: [{ user_id: 'C', start_date: TODAY, end_date: TODAY }] });
  assert.equal(primaryOn(p, TODAY).id, 'A');
  const [cp] = rotaChange(p, TODAY, ['A', 'B', 'C', 'D']);
  assert.deepEqual(cp, { effective_date: TODAY, member_order: ['A', 'B', 'C', 'D'], next_primary: 'A' });
  const q = save(p, [cp]);
  assert.deepEqual(days(q, '2026-11-16', '2026-11-20'), ['16:A>BC', '17:B>CA', '18:A>BD', '19:B>CDA', '20:C>DAB']);
  // So does a reorder.
  const [r] = rotaChange(p, TODAY, ['B', 'A', 'C']);
  assert.equal(primaryOn(save(p, [r]), TODAY).id, 'A');
});

test('two changes on one day: the second builds on the first', () => {
  const p = rota(['A', 'B', 'C', 'D']);
  const today = primaryOn(p, TODAY).id;
  // A past correction pins today, then a reorder the same day.
  const fixedHoliday = { ...p, holidays: { '2026-11-10': 'x' } };
  const e = pastEdit(p, fixedHoliday, '2026-11-10', '2026-11-10', TODAY);
  const p1 = save(fixedHoliday, e.checkpoints);
  const p2 = save(p1, rotaChange(p1, TODAY, ['D', 'C', 'B', 'A']));
  assert.equal(primaryOn(p2, TODAY).id, today);
  assert.deepEqual(diff(days(p, '2026-11-02', '2026-11-17'), days(p2, '2026-11-02', '2026-11-17')), ['10']);
  // Today's Primary deactivated, then brought back: whoever took over today stays.
  const q1 = save(p, rotaChange(p, TODAY, ['A', 'B', 'C', 'D'].filter(id => id !== today)));
  const stand = primaryOn(q1, TODAY).id;
  assert.notEqual(stand, today);
  const q2 = save(q1, rotaChange(q1, TODAY, ['A', 'B', 'C', 'D']));
  assert.equal(primaryOn(q2, TODAY).id, stand);
  // Approving, then reordering.
  const r1 = save(p, rotaChange(p, TODAY, ['A', 'B', 'C', 'D', 'E']));
  const r2 = save(r1, rotaChange(r1, TODAY, ['E', 'D', 'C', 'B', 'A']));
  assert.equal(primaryOn(r2, TODAY).id, today);
  assert.equal(r2.checkpoints.filter(c => c.effective_date === TODAY).length, 1);
});

test('on the rotation\'s first day the announced Primary stays; before anyone has been on duty the new order starts', () => {
  const first = rota(['A', 'B', 'C'], { checkpoints: [{ effective_date: TODAY, member_order: ['A', 'B', 'C'], next_primary: 'A' }] });
  assert.deepEqual(checkpointFor(first, TODAY, ['B', 'A', 'C']), { effective_date: TODAY, member_order: ['B', 'A', 'C'], next_primary: 'A' });
  // A rotation that starts on a Saturday, changed that Saturday or before: the first checkpoint takes the new order.
  const sat = rota(['A', 'B', 'C'], { checkpoints: [{ effective_date: '2026-11-21', member_order: ['A', 'B', 'C'], next_primary: 'A' }] });
  assert.deepEqual(checkpointFor(sat, '2026-11-21', ['B', 'A', 'C']), { effective_date: '2026-11-21', member_order: ['B', 'A', 'C'], next_primary: 'B' });
  assert.deepEqual(checkpointFor(sat, '2026-11-19', ['C', 'B']), { effective_date: '2026-11-21', member_order: ['C', 'B'], next_primary: 'C' });
});

test('self-heal: a rotation that doesn\'t match the team is put right once, keeping today\'s Primary', () => {
  const p = rota(['A', 'B', 'C']);
  assert.deepEqual(rotaChange(p, TODAY, ['A', 'B', 'C']), [], 'in step: nothing to save');
  // D was approved, but the checkpoint failed to save: D is missing from the rotation.
  const fix = rotaChange(p, TODAY, ['A', 'B', 'C', 'D']);
  assert.equal(fix.length, 1);
  const healed = save(p, fix);
  assert.equal(primaryOn(healed, TODAY).id, primaryOn(p, TODAY).id);
  assert.deepEqual(diff(days(p, '2026-11-02', '2026-11-17'), days(healed, '2026-11-02', '2026-11-17')), []);
  assert.ok(days(healed, '2026-11-19', '2026-11-19')[0].includes('D'));
  assert.deepEqual(rotaChange(healed, TODAY, ['A', 'B', 'C', 'D']), [], 'once healed, nothing more to do (no loop)');
  // Someone was deactivated but the checkpoint failed: they leave the rotation from today.
  const out = save(p, rotaChange(p, TODAY, ['A', 'C']));
  assert.ok(!days(out, TODAY, '2026-11-27').join().includes('B'));
});

test('self-heal on a fresh install: the first admin joins the empty rotation', () => {
  // The setup SQL saved an empty rotation on the day it ran; the owner signed up as the first admin afterwards.
  const install = { members: [who('A')], people: P, leaves: [], holidays: {}, anchor: '2026-11-16',
    checkpoints: [{ effective_date: '2026-11-16', member_order: [], next_primary: null }] };
  // The same day: nobody has been on duty yet, so the rotation simply starts with them.
  assert.deepEqual(rotaChange(install, '2026-11-16', ['A']), [{ effective_date: '2026-11-16', member_order: ['A'], next_primary: 'A' }]);
  // Two days later: from today; the days before keep no one on duty.
  const fix = rotaChange(install, TODAY, ['A']);
  assert.deepEqual(fix, [{ effective_date: TODAY, member_order: ['A'], next_primary: 'A' }]);
  const healed = save(install, fix);
  assert.deepEqual(days(healed, '2026-11-16', '2026-11-19'), ['16:-', '17:-', '18:A>', '19:A>']);
  assert.deepEqual(rotaChange(healed, TODAY, ['A']), []);
});
