import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todaySG } from '../src/schedule.js';

// DemoStore keeps its data in localStorage; give Node a fresh in-memory one for each test.
beforeEach(() => {
  const m = new Map();
  globalThis.localStorage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  warned.length = 0;
});
// Database messages put in plain words are also logged as they were; keep them here rather than in the test output.
const warned = [];
console.warn = (...a) => { warned.push(a.join(' ')); };
const { DemoStore } = await import('../src/store.js');
const order = s => s.db.profiles.slice().sort((a, b) => a.rota_order - b.rota_order).map(p => p.display_name);
// What production shows: the database's own messages, and SupabaseStore's when the database skips or reverts a change quietly.
const NOT_SAVED = /^Error: That change wasn’t saved\. You may not have permission, or it was already removed\. The page has been refreshed\.$/;
const ONLY_ADMINS = /^Error: Only admins can make that change\. The page has been refreshed\.$/;
// Postgres's own refusals reach people in plain words (plainError in store.js): row level security refusing a new row
// reads like a skipped change, and each check constraint has its sentence.
const RLS = () => NOT_SAVED;
const PLAIN = { name_length: 'Please enter a name of up to 60 characters.', holiday_name_length: 'Please enter a holiday name of up to 60 characters.',
  note_length: 'A note can be at most 120 characters.', leave_dates_in_order: 'The end date is before the start date.' };
const CHECK = (table, name) => new RegExp('^Error: ' + PLAIN[name].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');

test('the rotation order is saved in one step with no shared places', async () => {
  const s = new DemoStore();
  await s.signIn('alice@example.com');
  await s.setRotaOrder(['demo-2', 'demo-0']);
  assert.deepEqual(order(s), ['Chloe Ng', 'Alice Tan', 'Ben Lim', 'Dev Kumar', 'Elena Goh']);
  assert.deepEqual(s.db.profiles.map(p => p.rota_order).sort(), [0, 1, 2, 3, 4]);
});

test('only admins change the order, holidays, settings and the rotation, refused as the database refuses', async () => {
  const s = new DemoStore();
  await s.signIn('ben@example.com');
  await assert.rejects(s.setRotaOrder(['demo-1']), /^Error: Only admins can change the rotation order\.$/);
  await assert.rejects(s.addHoliday('2028-01-01', 'New Year'), RLS('holidays'));
  await assert.rejects(s.deleteHoliday('2026-12-25'), NOT_SAVED);
  await assert.rejects(s.updateSettings({ public_calendar: false }), NOT_SAVED);
  await assert.rejects(s.saveCheckpoint({ effective_date: todaySG(), member_order: [], next_primary: null }), RLS('rota_checkpoints'));
  await assert.rejects(s.resetRotation(todaySG(), []), RLS('rota_checkpoints'));
  await assert.rejects(s.deleteProfile('demo-2'), NOT_SAVED);
  await assert.rejects(s.dismissInvite('x'), NOT_SAVED);
  assert.equal(s.db.profiles.length, 5);
});

test('people can remove only their own leave unless they are admins', async () => {
  const s = new DemoStore();
  const t = todaySG(), soon = addDays(t, 3);
  await s.signIn('alice@example.com');
  await s.addLeave({ user_id: 'demo-0', start_date: soon, end_date: soon });
  const alices = s.db.leaves.find(l => l.user_id === 'demo-0').id;
  await s.signIn('ben@example.com');
  await assert.rejects(s.deleteLeave(alices), NOT_SAVED);
  await assert.rejects(s.deleteLeave(9999), NOT_SAVED);
  assert.ok(s.db.leaves.some(l => l.id === alices));
});

test('people can end only their own leave early, by the same rules as the database', async () => {
  const s = new DemoStore();
  const t = todaySG();
  s.db.leaves = [{ id: 1, user_id: 'demo-1', start_date: addDays(t, -3), end_date: addDays(t, 2) }, { id: 2, user_id: 'demo-2', start_date: addDays(t, -2), end_date: addDays(t, 6) },
    { id: 3, user_id: 'demo-1', start_date: addDays(t, -30), end_date: addDays(t, -28) }];
  s.write();
  await s.signIn('ben@example.com');
  await assert.rejects(s.updateLeave(2, { end_date: addDays(t, -1) }), NOT_SAVED);
  await assert.rejects(s.updateLeave(99, { end_date: addDays(t, -1) }), NOT_SAVED);
  assert.equal(s.db.leaves.find(l => l.id === 2).end_date, addDays(t, 6));
  await assert.rejects(s.updateLeave(1, { start_date: t }), /^Error: The start of leave that has begun can't be changed\. Ask an admin\.$/);
  await assert.rejects(s.updateLeave(1, { end_date: addDays(t, -2) }), /^Error: Leave can only be shortened to end yesterday at the earliest\.$/);
  await assert.rejects(s.updateLeave(1, { end_date: addDays(t, 200) }), /at most 180 days/);
  await s.updateLeave(3, { end_date: addDays(t, 1) });   // the database allows this too
  await s.updateLeave(1, { end_date: addDays(t, -1) });  // "End early (back today)"
  assert.equal(s.db.leaves.find(l => l.id === 1).end_date, addDays(t, -1));
  // Leave that has begun can't be deleted, in the database's words (straight apostrophe).
  await assert.rejects(s.deleteLeave(1), /^Error: Leave that has begun can't be deleted\. End it early instead\.$/);
  await s.signIn('alice@example.com');
  await s.updateLeave(2, { end_date: addDays(t, -1) });
  await s.deleteLeave(1);
});

test('a change only admins may make is reported, not quietly ignored, as SupabaseStore reports the database putting it back', async () => {
  const s = new DemoStore();
  await s.signIn('ben@example.com');
  await assert.rejects(s.updateProfile('demo-1', { active: false }), ONLY_ADMINS);
  await assert.rejects(s.updateProfile('demo-1', { rota_order: 0 }), ONLY_ADMINS);
  await assert.rejects(s.updateProfile('demo-1', { is_admin: true }), ONLY_ADMINS);
  const ben = () => s.db.profiles.find(p => p.id === 'demo-1');
  assert.deepEqual([ben().active, ben().rota_order, ben().is_admin], [true, 1, false]);
  // In one change, the name is saved (as in the database) and the rest is reported.
  await assert.rejects(s.updateProfile('demo-1', { display_name: 'Benjamin Lim', active: false }), ONLY_ADMINS);
  assert.deepEqual([ben().display_name, ben().active], ['Benjamin Lim', true]);
  await s.updateProfile('demo-1', { display_name: 'Ben Lim', active: true });   // nothing actually put back
  await assert.rejects(s.updateProfile('demo-2', { display_name: 'X' }), NOT_SAVED);
  await assert.rejects(s.updateProfile('nobody', { display_name: 'X' }), NOT_SAVED);
  await s.signIn('alice@example.com');
  await s.updateProfile('demo-1', { active: false });
  assert.equal(ben().active, false);
});

test('people waiting for approval can\'t add leave or set a work email, and see only themselves', async () => {
  const s = new DemoStore();
  const t = todaySG();
  await s.signUp('zed@example.com', 'x', 'Zed Tester');
  const zed = s.db.session;
  await assert.rejects(s.addLeave({ user_id: zed, start_date: t, end_date: t }), RLS('leaves'));
  await assert.rejects(s.addLeave({ user_id: zed, start_date: addDays(t, -1), end_date: t }), /^Error: Leave can only be added from today onwards\./);
  await assert.rejects(s.setWorkEmail(zed, 'zed@work.com'), /^Error: You can only change your own work email\.$/);
  const d = await s.load();
  assert.deepEqual([d.profiles.map(p => p.id), d.leaves.length, d.checkpoints.length, d.me.email], [[zed], 0, 0, 'zed@example.com']);
  assert.ok(d.holidays.length > 0);
  // A member can't add leave for someone else either: the database's row level security refuses it.
  await s.signIn('ben@example.com');
  await assert.rejects(s.addLeave({ user_id: 'demo-2', start_date: t, end_date: t }), RLS('leaves'));
});

test('length limits and blank names are refused as the database refuses them, in plain words', async () => {
  const s = new DemoStore();
  const t = todaySG();
  await s.signIn('ben@example.com');
  await assert.rejects(s.updateProfile('demo-1', { display_name: '   ' }), CHECK('profiles', 'name_length'));
  await assert.rejects(s.updateProfile('demo-1', { display_name: 'x'.repeat(61) }), CHECK('profiles', 'name_length'));
  await s.updateProfile('demo-1', { display_name: '  ' + 'x'.repeat(60) + '  ' });   // 60 once trimmed: allowed
  await assert.rejects(s.addLeave({ user_id: 'demo-1', start_date: t, end_date: t, note: 'x'.repeat(121) }), CHECK('leaves', 'note_length'));
  await assert.rejects(s.addLeave({ user_id: 'demo-1', start_date: addDays(t, 2), end_date: addDays(t, 1) }), CHECK('leaves', 'leave_dates_in_order'));
  await s.addLeave({ user_id: 'demo-1', start_date: t, end_date: t, note: 'x'.repeat(120) });
  await assert.rejects(s.setWorkEmail('demo-1', 'a'.repeat(249) + '@x.com'), /^Error: Please enter a valid email address\.$/);
  await s.signIn('alice@example.com');
  await assert.rejects(s.addHoliday('2028-01-03', '  '), CHECK('holidays', 'holiday_name_length'));
  await assert.rejects(s.addHoliday('2028-01-03', 'x'.repeat(61)), CHECK('holidays', 'holiday_name_length'));
  // Sign-up names are trimmed and cut to 60 characters, like handle_new_user().
  await s.signUp('long@example.com', 'x', '  ' + 'y'.repeat(70));
  assert.equal(s.db.profiles.find(p => p.email === 'long@example.com').display_name, 'y'.repeat(60));
  await s.signUp('blank@example.com', 'x', '   ');
  assert.equal(s.db.profiles.find(p => p.email === 'blank@example.com').display_name, 'blank');
});

test('members see only their own email, work email and leave notes; admins see everyone\'s', async () => {
  const s = new DemoStore();
  const t = todaySG();
  s.db.profiles.find(p => p.id === 'demo-2').work_email = 'chloe.ng@company.com';
  s.db.leaves = [{ id: 1, user_id: 'demo-1', start_date: t, end_date: t, note: 'Ben’s note' }, { id: 2, user_id: 'demo-2', start_date: t, end_date: t, note: 'Chloe’s note' }];
  s.write();
  await s.signIn('ben@example.com');
  const d = await s.load();
  const by = id => d.profiles.find(p => p.id === id);
  assert.deepEqual([by('demo-1').email, by('demo-2').email, by('demo-2').work_email, by('demo-0').email], ['ben@example.com', null, null, null]);
  assert.deepEqual(d.leaves.map(l => l.note), ['Ben’s note', null]);
  await s.signIn('alice@example.com');
  const a = await s.load();
  assert.deepEqual([a.profiles.find(p => p.id === 'demo-2').email, a.profiles.find(p => p.id === 'demo-2').work_email], ['chloe@example.com', 'chloe.ng@company.com']);
  assert.deepEqual(a.leaves.map(l => l.note), ['Ben’s note', 'Chloe’s note']);
});

test('the example leave is tomorrow in Singapore, whatever the computer\'s timezone', () => {
  const s = new DemoStore();
  assert.deepEqual([s.db.leaves[0].start_date, s.db.leaves[0].end_date], [addDays(todaySG(), 1), addDays(todaySG(), 1)]);
});

test('non-admins can book at most 180 days, up to a year ahead', async () => {
  const s = new DemoStore();
  const t = todaySG();
  await s.signIn('ben@example.com');
  await assert.rejects(s.addLeave({ user_id: 'demo-1', start_date: t, end_date: addDays(t, 180) }), /180 days/);
  await assert.rejects(s.addLeave({ user_id: 'demo-1', start_date: addDays(t, 366), end_date: addDays(t, 366) }), /^Error: Leave can be booked up to a year ahead\.$/);
  await s.addLeave({ user_id: 'demo-1', start_date: addDays(t, 365), end_date: addDays(t, 365) });
  await s.addLeave({ user_id: 'demo-1', start_date: t, end_date: addDays(t, 179) });
  await s.signIn('alice@example.com');
  await s.addLeave({ user_id: 'demo-2', start_date: t, end_date: addDays(t, 300) });
});

test('admins can set anyone\'s work email; others only their own', async () => {
  const s = new DemoStore();
  await s.signIn('alice@example.com');
  await s.setWorkEmail('demo-2', ' Chloe.Ng@Company.com ');
  assert.equal(s.db.profiles.find(p => p.id === 'demo-2').work_email, 'chloe.ng@company.com');
  await assert.rejects(s.setWorkEmail('demo-3', 'chloe.ng@company.com'), /someone else/);
  await s.signIn('ben@example.com');
  await assert.rejects(s.setWorkEmail('demo-2', 'x@company.com'), /^Error: You can only change your own work email\.$/);
  await s.setWorkEmail('demo-1', 'ben.lim@company.com');
  assert.equal(s.db.profiles.find(p => p.id === 'demo-1').work_email, 'ben.lim@company.com');
});

// SupabaseStore against a stand-in for the Supabase client: just the calls resetRotation makes, with a way to drop the
// connection on the nth write.
function fakeSupabase(db, failAt) {
  let writes = 0;
  const reply = (apply) => (++writes === failAt ? { data: null, error: { message: 'Failed to fetch' } } : { data: apply(), error: null });
  const done = res => ({ then: (ok, bad) => Promise.resolve(res).then(ok, bad) });
  return () => ({
    from: table => ({
      upsert: row => done(reply(() => { db[table] = db[table].filter(r => r.effective_date !== row.effective_date).concat(row); return null; })),
      delete: () => ({ neq: (col, v) => done(reply(() => { db[table] = db[table].filter(r => r[col] === v); return null; })) }),
      update: patch => ({ eq: () => ({ select: () => done(reply(() => { Object.assign(db[table][0], patch); return [{ id: 1 }]; })) }) })
    })
  });
}

test('restarting the rotation never loses the history if the connection drops part way, and saving again finishes it', async () => {
  const { SupabaseStore } = await import('../src/store.js');
  const old = [{ effective_date: '2026-01-05', member_order: ['a', 'b'], next_primary: 'a' }, { effective_date: '2026-06-01', member_order: ['b', 'a'], next_primary: 'b' }];
  for (const failAt of [1, 2, 3]) {
    const db = { rota_checkpoints: old.map(c => ({ ...c })), settings: [{ id: 1, rota_start: '2026-01-05' }] };
    await assert.rejects(new SupabaseStore(fakeSupabase(db, failAt), 'u', 'k').resetRotation('2026-11-02', ['c', 'a', 'b']), /Failed to fetch/);
    assert.ok(old.every(o => db.rota_checkpoints.some(c => c.effective_date === o.effective_date)), 'the earlier history is still there after a failure at write ' + failAt);
    await new SupabaseStore(fakeSupabase(db, 0), 'u', 'k').resetRotation('2026-11-02', ['c', 'a', 'b']);
    assert.deepEqual(db.rota_checkpoints, [{ effective_date: '2026-11-02', member_order: ['c', 'a', 'b'], next_primary: 'c' }]);
    assert.equal(db.settings[0].rota_start, '2026-11-02');
  }
});

test('database refusals reach people in plain words, the same in both stores; other messages pass through', async () => {
  const { plainError, SupabaseStore } = await import('../src/store.js');
  const notSaved = 'That change wasn’t saved. You may not have permission, or it was already removed. The page has been refreshed.';
  const cases = [
    ['new row violates row-level security policy for table "leaves"', notSaved],
    ['new row violates row-level security policy (USING expression) for table "holidays"', notSaved],
    ['new row for relation "profiles" violates check constraint "name_length"', PLAIN.name_length],
    ['new row for relation "holidays" violates check constraint "holiday_name_length"', PLAIN.holiday_name_length],
    ['new row for relation "leaves" violates check constraint "note_length"', PLAIN.note_length],
    ['new row for relation "leaves" violates check constraint "leave_dates_in_order"', PLAIN.leave_dates_in_order],
    ['new row for relation "settings" violates check constraint "single_row"', 'That change wasn’t saved. Check what you entered and try again.'],
    ['duplicate key value violates unique constraint "profiles_work_email_key"', 'That email already belongs to someone else on the roster.'],
    ['duplicate key value violates unique constraint "leaves_invite_uid_key"', 'That change wasn’t saved. It’s already there.'],
    ['JWT expired', 'You’ve been signed out. Please sign in again.'],
    ['insert or update on table "leaves" violates foreign key constraint "leaves_user_id_fkey"', notSaved],
    ['null value in column "name" of relation "holidays" violates not-null constraint', 'Please fill in every field.'],
    ['invalid input syntax for type date: ""', 'Please enter a valid date.'],
    // The database's own sentences for people are kept as they are, and anything unknown passes through.
    ["Leave that has begun can't be deleted. End it early instead.", "Leave that has begun can't be deleted. End it early instead."],
    ['You can only change your own work email.', 'You can only change your own work email.'],
    ['Failed to fetch', 'Failed to fetch'],
    ['permission denied for table profiles', 'permission denied for table profiles']
  ];
  for (const [raw, plain] of cases) assert.equal(plainError(raw), plain, raw);
  // The same refusal reads the same from the database (through a stand-in Supabase client) and from demo mode.
  const refuse = message => () => ({ from: () => {
    const res = Promise.resolve({ data: null, error: { message } });
    const chain = { insert: () => res, upsert: () => res, update: () => chain, delete: () => chain, eq: () => chain, select: () => res };
    return chain;
  } });
  const t = todaySG();
  const viaDb = new SupabaseStore(refuse('new row violates row-level security policy for table "leaves"'), 'u', 'k').addLeave({ user_id: 'demo-2', start_date: t, end_date: t });
  const demo = new DemoStore(); await demo.signIn('ben@example.com');
  const viaDemo = demo.addLeave({ user_id: 'demo-2', start_date: t, end_date: t });
  const [a, b] = await Promise.allSettled([viaDb, viaDemo]);
  assert.equal(a.reason.message, b.reason.message);
  // Both logged the database's own words, with the table name: the owner's clue when an update hasn't been run.
  assert.deepEqual(warned, ['The database said: new row violates row-level security policy for table "leaves"', 'The database said: new row violates row-level security policy for table "leaves"']);
  warned.length = 0;
  await assert.rejects(new SupabaseStore(refuse('Leave can be booked up to a year ahead.'), 'u', 'k').addLeave({ user_id: 'demo-1', start_date: t, end_date: t }), /^Error: Leave can be booked up to a year ahead\.$/);
  await assert.rejects(new SupabaseStore(refuse('Failed to fetch'), 'u', 'k').addLeave({ user_id: 'demo-1', start_date: t, end_date: t }), /^Error: Failed to fetch$/);
  assert.deepEqual(warned, [], 'messages passed through as they are are not logged');
  const nameDb = new SupabaseStore(refuse('new row for relation "profiles" violates check constraint "name_length"'), 'u', 'k').updateProfile('demo-1', { display_name: ' ' });
  const [c, d] = await Promise.allSettled([nameDb, demo.updateProfile('demo-1', { display_name: ' ' })]);
  assert.deepEqual([c.reason.message, d.reason.message], [PLAIN.name_length, PLAIN.name_length]);
});
