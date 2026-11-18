// Rotation history: today's Primary stays as announced, corrections to past days change only those days, and an
// admin's page puts right a rotation that doesn't match the team (src/schedule.js: checkpointFor, rotaChange, pastEdit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, checkpointFor, rotaChange, pastEdit, shouldHeal, rotaParams, rotaOrder } from '../src/schedule.js';

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

test('past leave for a Secondary changes only that day, and today\'s Primary stays', () => {
  const p = rota(['A', 'B', 'C']);
  const second = buildSchedule({ ...p, from: '2026-11-16', to: '2026-11-16' })[0].duties[1].member.id;
  const after = { ...p, leaves: [{ user_id: second, start_date: '2026-11-16', end_date: '2026-11-16' }] };
  const e = pastEdit(p, after, '2026-11-16', '2026-11-16', TODAY);
  assert.deepEqual(e.changed, ['2026-11-16']);
  const today = primaryOn(p, TODAY).id;
  assert.deepEqual([e.day, e.was.id, e.now.id], [TODAY, today, today]);
  const fixed = save(after, e.checkpoints);
  assert.deepEqual(diff(days(p), days(fixed)), ['16']);
  assert.equal(primaryOn(fixed, '2026-11-16').id, primaryOn(p, '2026-11-16').id);
});

test('from 6pm on a working day, the next working day\'s announced Primary stays too', () => {
  const p = rota(['A', 'B', 'C']);
  const THU = '2026-11-19', thu = primaryOn(p, THU).id;
  const order = ['A', 'C', 'B'];
  // In office hours the new order applies from today's Primary on, so tomorrow can change.
  assert.notEqual(primaryOn(save(p, rotaChange(p, TODAY, order)), THU).id, thu);
  // From 6pm "Next on duty · 9am tomorrow" has been shown: tomorrow's Primary stays, then the new order follows.
  const cps = rotaChange(p, TODAY, order, { afterHours: true });
  assert.deepEqual(cps.map(c => c.effective_date), [THU, TODAY], 'tomorrow\'s first: if saving stops part way, today\'s is missing and the self-heal finishes it');
  const eve = save(p, cps);
  assert.equal(primaryOn(eve, TODAY).id, primaryOn(p, TODAY).id);
  assert.equal(primaryOn(eve, THU).id, thu);
  assert.deepEqual(diff(days(p, '2026-11-02', '2026-11-17'), days(eve, '2026-11-02', '2026-11-17')), []);
  assert.deepEqual(days(eve, THU, '2026-11-24').map(d => d.slice(3, 4)), [thu, ...['A', 'C', 'B', 'A', 'C', 'B'].slice(order.indexOf(thu) + 1, order.indexOf(thu) + 4)]);
  // On a Friday evening it is Monday's Primary; before a holiday, the next working day after it.
  const fri = save(p, rotaChange(p, '2026-11-20', order, { afterHours: true }));
  assert.equal(primaryOn(fri, '2026-11-23').id, primaryOn(p, '2026-11-23').id);
  const hol = rota(['A', 'B', 'C'], { holidays: { [THU]: 'x' } });
  const h = save(hol, rotaChange(hol, TODAY, order, { afterHours: true }));
  assert.equal(primaryOn(h, '2026-11-20').id, primaryOn(hol, '2026-11-20').id);
  // A weekend is unchanged by the flag: Monday's turn is already kept.
  assert.deepEqual(rotaChange(p, '2026-11-21', order, { afterHours: true }), rotaChange(p, '2026-11-21', order));
  // No checkpoint is added when the new order gives tomorrow the same Primary anyway.
  assert.equal(rotaChange(p, TODAY, ['A', 'B', 'C', 'D'], { afterHours: true }).length, 1);
});

test('evening changes build on each other, and a later day\'s checkpoint takes the next change\'s order', () => {
  const p = rota(['A', 'B', 'C']);
  const THU = '2026-11-19', thu = primaryOn(p, THU).id;
  // Reordered at 7pm, then put back at 8pm: the whole schedule from today on is as it was.
  const e1 = save(p, rotaChange(p, TODAY, ['A', 'C', 'B'], { afterHours: true }));
  const e2 = save(e1, rotaChange(e1, TODAY, ['A', 'B', 'C'], { afterHours: true }));
  assert.deepEqual(days(e2, TODAY, '2026-11-27'), days(p, TODAY, '2026-11-27'));
  // Deactivating tomorrow's announced Primary in the evening: they're out, and today and earlier days keep their duties.
  const out = save(p, rotaChange(p, TODAY, ['A', 'B', 'C'].filter(id => id !== thu), { afterHours: true }));
  assert.notEqual(primaryOn(out, THU).id, thu);
  assert.equal(primaryOn(out, TODAY).id, primaryOn(p, TODAY).id);
  // Friday evening saves a checkpoint for Monday; a reorder on Saturday re-saves it in the new order, keeping Monday's Primary.
  const friday = save(p, rotaChange(p, '2026-11-20', ['A', 'C', 'B'], { afterHours: true }));
  const mon = primaryOn(friday, '2026-11-23').id;
  const sat = rotaChange(friday, '2026-11-21', ['C', 'B', 'A']);
  assert.deepEqual(sat.map(c => [c.effective_date, c.member_order.join('')]), [['2026-11-23', 'CBA'], ['2026-11-21', 'CBA']]);
  const s = save(friday, sat);
  assert.equal(primaryOn(s, '2026-11-23').id, mon);
  assert.deepEqual(days(s, '2026-11-23', '2026-11-25').map(d => d.slice(3, 4)), [mon, ...'CBACBA'.slice('CBA'.indexOf(mon) + 1, 'CBA'.indexOf(mon) + 3)]);
});

test('on a day with no Primary, undoing a change gives the turn back; a correction\'s checkpoint is still built on', () => {
  const p = rota(['A', 'B', 'C', 'D']);
  const SAT = '2026-11-21', MON = '2026-11-23', team = ['A', 'B', 'C', 'D'];
  const x = primaryOn(p, MON).id;
  const q1 = save(p, rotaChange(p, SAT, team.filter(id => id !== x)));
  assert.notEqual(primaryOn(q1, MON).id, x);
  const q2 = save(q1, rotaChange(q1, SAT, team));
  assert.equal(primaryOn(q2, MON).id, x, 'deactivated and reactivated on Saturday: Monday is theirs again');
  assert.deepEqual(days(q2, MON, '2026-11-27'), days(p, MON, '2026-11-27'));
  // Two people out and back: the one whose turn it was gets it back.
  const y = team[(team.indexOf(x) + 1) % 4];
  const r1 = save(p, rotaChange(p, SAT, team.filter(id => id !== x)));
  const r2 = save(r1, rotaChange(r1, SAT, team.filter(id => id !== x && id !== y)));
  const r3 = save(r2, rotaChange(r2, SAT, team.filter(id => id !== y)));
  const r4 = save(r3, rotaChange(r3, SAT, team));
  assert.deepEqual([primaryOn(r3, MON).id, primaryOn(r4, MON).id], [x, x]);
  // Friday's Primary recorded as off sick on Saturday morning saves a checkpoint for Saturday; a reorder later that day keeps it.
  const fri = primaryOn(p, '2026-11-20').id;
  const sick = { ...p, leaves: [{ user_id: fri, start_date: '2026-11-20', end_date: '2026-11-20' }] };
  const e = pastEdit(p, sick, '2026-11-20', '2026-11-20', SAT);
  assert.equal(e.checkpoints[0].effective_date, SAT);
  const c1 = save(sick, e.checkpoints);
  assert.equal(primaryOn(c1, MON).id, x);
  const c2 = save(c1, rotaChange(c1, SAT, ['D', 'C', 'B', 'A']));
  assert.equal(primaryOn(c2, MON).id, x);
  // On a working day, whoever took over today's duty stays (as before): see "two changes on one day".
});

test('shouldHeal: an approved admin, complete data with a saved rotation, and a rotation that doesn\'t match the team', () => {
  const profile = (id, i) => ({ id, display_name: id, rota_order: i, active: true, is_admin: i === 0, approved: true });
  const data = () => ({ profiles: ['A', 'B', 'C'].map(profile), leaves: [], holidays: [], settings: { rota_start: '2026-11-02' },
    checkpoints: [{ effective_date: '2026-11-02', member_order: ['A', 'B', 'C'], next_primary: 'A' }] });
  const as = (d, id) => ({ ...d, me: d.profiles.find(p => p.id === id) });
  assert.equal(shouldHeal(as(data(), 'A'), TODAY), false, 'in step');
  const d = data(); d.profiles.push(profile('D', 3));   // approved, but the checkpoint was never saved
  const admin = d.profiles[0];
  assert.equal(shouldHeal(as(d, 'A'), TODAY), true);
  assert.equal(shouldHeal(as(d, 'B'), TODAY), false, 'not for members');
  assert.equal(shouldHeal({ ...d, me: { ...admin, approved: false } }, TODAY), false, 'not for an admin awaiting approval');
  assert.equal(shouldHeal({ ...d, me: null }, TODAY), false);
  assert.equal(shouldHeal(null, TODAY), false);
  for (const k of ['profiles', 'leaves', 'holidays', 'checkpoints', 'settings']) assert.equal(shouldHeal({ ...d, me: admin, [k]: undefined }, TODAY), false, 'incomplete data: no ' + k);
  assert.equal(shouldHeal({ ...d, me: admin, checkpoints: [] }, TODAY), false, 'no saved rotation: nothing to heal');
  assert.equal(shouldHeal({ ...d, me: admin, profiles: d.profiles.slice(1) }, TODAY), false, 'a team list without the admin is not complete');
  // Once put right, there is nothing more to do; the evening rule is used the same way as for a change.
  const healed = { ...as(d, 'A'), checkpoints: d.checkpoints.concat(rotaChange(rotaParams(d), TODAY, rotaOrder(d), { afterHours: true })) };
  assert.equal(shouldHeal(healed, TODAY, { afterHours: true }), false);
  assert.deepEqual(rotaOrder(d), ['A', 'B', 'C', 'D']);
});

test('a later day\'s checkpoint left in another order is put right, even by a change back to the order in effect', () => {
  // An evening reorder saved Thursday's checkpoint but not today's, the self-heal didn't run, then the order was put back.
  const team = ['A', 'B', 'C', 'D'], p = rota(team), THU = '2026-11-19';
  const cps = rotaChange(p, TODAY, ['A', 'C', 'B', 'D'], { afterHours: true });
  assert.deepEqual(cps.map(c => c.effective_date), [THU, TODAY]);
  const partial = save(p, cps.slice(0, -1));
  const back = rotaChange(partial, TODAY, team, { afterHours: true });
  assert.ok(back.some(c => c.effective_date === THU && c.member_order.join() === team.join()), JSON.stringify(back));
  assert.deepEqual(days(save(partial, back), TODAY, '2026-11-27'), days(p, TODAY, '2026-11-27'));
  // The self-heal sees it too, and once it is put right there is nothing more to do.
  const data = ckps => ({ me: { id: 'A', is_admin: true, approved: true }, leaves: [], holidays: [], settings: { rota_start: '2026-11-02' }, checkpoints: ckps,
    profiles: team.map((id, i) => ({ id, display_name: id, rota_order: i, active: true, is_admin: id === 'A', approved: true })) });
  assert.equal(shouldHeal(data(partial.checkpoints), TODAY, { afterHours: true }), true);
  assert.equal(shouldHeal(data(save(partial, back).checkpoints), TODAY, { afterHours: true }), false);
});

test('a saved rotation also finds its people among the members when no wider list is given', () => {
  const p = rota(['A', 'B', 'C']);
  const { people, ...membersOnly } = p;
  assert.deepEqual(days(membersOnly, '2026-11-02', '2026-11-06'), days(p, '2026-11-02', '2026-11-06'));
});
