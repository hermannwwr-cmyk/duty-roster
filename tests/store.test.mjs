import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todaySG } from '../src/schedule.js';

// DemoStore keeps its data in localStorage; give Node a fresh in-memory one for each test.
beforeEach(() => {
  const m = new Map();
  globalThis.localStorage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
});
const { DemoStore } = await import('../src/store.js');
const order = s => s.db.profiles.slice().sort((a, b) => a.rota_order - b.rota_order).map(p => p.display_name);

test('the rotation order is saved in one step with no shared places', async () => {
  const s = new DemoStore();
  await s.signIn('alice@example.com');
  await s.setRotaOrder(['demo-2', 'demo-0']);
  assert.deepEqual(order(s), ['Chloe Ng', 'Alice Tan', 'Ben Lim', 'Dev Kumar', 'Elena Goh']);
  assert.deepEqual(s.db.profiles.map(p => p.rota_order).sort(), [0, 1, 2, 3, 4]);
});

test('only admins change the order, holidays and settings', async () => {
  const s = new DemoStore();
  await s.signIn('ben@example.com');
  await assert.rejects(s.setRotaOrder(['demo-1']), /Only admins/);
  await assert.rejects(s.addHoliday('2028-01-01', 'New Year'), /Only admins/);
  await assert.rejects(s.deleteHoliday('2026-12-25'), /Only admins/);
  await assert.rejects(s.updateSettings({ public_calendar: false }), /Only admins/);
});

test('people can remove only their own leave unless they are admins', async () => {
  const s = new DemoStore();
  const t = todaySG(), soon = addDays(t, 3);
  await s.signIn('alice@example.com');
  await s.addLeave({ user_id: 'demo-0', start_date: soon, end_date: soon });
  const alices = s.db.leaves.find(l => l.user_id === 'demo-0').id;
  await s.signIn('ben@example.com');
  await assert.rejects(s.deleteLeave(alices), /Only admins/);
  await assert.rejects(s.deleteLeave(9999), /already removed/);
});

test('non-admins can book at most 180 days, up to a year ahead', async () => {
  const s = new DemoStore();
  const t = todaySG();
  await s.signIn('ben@example.com');
  await assert.rejects(s.addLeave({ user_id: 'demo-1', start_date: t, end_date: addDays(t, 180) }), /180 days/);
  await assert.rejects(s.addLeave({ user_id: 'demo-1', start_date: addDays(t, 400), end_date: addDays(t, 401) }), /a year ahead/);
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
  await assert.rejects(s.setWorkEmail('demo-2', 'x@company.com'), /Only admins/);
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
