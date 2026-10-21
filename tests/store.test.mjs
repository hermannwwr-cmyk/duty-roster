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
