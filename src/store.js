// Data layer. Two implementations with the same methods:
// - SupabaseStore: real logins and a shared Postgres database.
// - DemoStore: everything in this browser's localStorage, for trying the app without Supabase.
import { SG_HOLIDAYS } from './holidays-sg.js';
import { toISO, fromISO, addDays, todaySG, onRota, publicCalendar } from './schedule.js';

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}
/** For writes ending in .select(): the database skips rows you aren't allowed to change without an error, so no rows back means it didn't happen. */
function changed(res) {
  const rows = check(res);
  if (!rows || !rows.length) throw new Error('That change wasn’t saved. You may not have permission, or it was already removed. The page has been refreshed.');
  return rows;
}
const PROFILE_COLUMNS = 'id, display_name, rota_order, active, is_admin, approved';

export class SupabaseStore {
  constructor(createClient, url, key) {
    this.mode = 'supabase';
    this.sb = createClient(url, key);
  }
  async userId() {
    const { data } = await this.sb.auth.getSession();
    return data.session ? data.session.user.id : null;
  }
  onAuthChange(cb) {
    // Supabase runs this callback while holding its auth lock. Calling back into Supabase from
    // inside it (as refresh() does) deadlocks, so defer the work until the lock is released.
    // INITIAL_SESSION and TOKEN_REFRESHED need no re-render: the app loads the session itself.
    this.sb.auth.onAuthStateChange(event => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      setTimeout(cb, 0);
    });
  }
  async signIn(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }
  async signUp(email, password, name) {
    const { data, error } = await this.sb.auth.signUp({
      email, password,
      options: { data: { display_name: name }, emailRedirectTo: location.href.split('#')[0] }
    });
    if (error) throw new Error(error.message);
    return { needsConfirmation: !data.session };
  }
  async signOut() { await this.sb.auth.signOut(); }
  async load() {
    const uid = await this.userId();
    // Emails and leave notes aren't readable from the tables (see 003_private_data.sql). They come from
    // member_emails() and leave_notes(), which return only your own, or everyone's if you're an admin.
    const [profiles, leaves, holidays, settings, checkpoints, emails, notes] = await Promise.all([
      this.sb.from('profiles').select('id, display_name, rota_order, active, is_admin, approved, created_at')
        .order('rota_order').order('created_at').order('id'),
      this.sb.from('leaves').select('id, user_id, start_date, end_date').order('start_date'),
      this.sb.from('holidays').select('*').order('date'),
      this.sb.from('settings').select('*').eq('id', 1).single(),
      this.sb.from('rota_checkpoints').select('effective_date, member_order, next_primary').order('effective_date'),
      this.sb.rpc('member_emails'),
      this.sb.rpc('leave_notes')
    ]).then(rs => rs.map(check));
    const emailOf = Object.fromEntries(emails.map(e => [e.id, e.email]));
    const noteOf = Object.fromEntries(notes.map(n => [n.id, n.note]));
    profiles.forEach(p => { p.email = emailOf[p.id] || null; });
    leaves.forEach(l => { l.note = noteOf[l.id] || null; });
    const me = profiles.find(p => p.id === uid) || null;
    // Email subscriptions are for admins. Null when supabase/009_daily_email.sql hasn't been run.
    let subscriptions = null;
    if (me && me.is_admin) {
      const { data, error } = await this.sb.from('email_subscriptions').select('id, email, approved, created_at').order('created_at');
      if (!error) subscriptions = data;
    }
    return { me, profiles, leaves, holidays, settings, checkpoints, subscriptions };
  }
  /** The public calendar for a date range: names and roles only. Works without signing in. Null when switched off. */
  async loadPublic(from, to) { return check(await this.sb.rpc('public_calendar', { p_from: from, p_to: to })); }
  async deleteProfile(id) { changed(await this.sb.from('profiles').delete().eq('id', id).select('id')); }
  /** Daily 9am email (supabase/009_daily_email.sql): anyone can ask, an admin approves. */
  async requestEmail(email) { check(await this.sb.rpc('request_email_subscription', { p_email: email })); }
  async unsubscribeEmail(token) { return check(await this.sb.rpc('unsubscribe_email', { p_token: token })); }
  async approveEmail(id) { changed(await this.sb.from('email_subscriptions').update({ approved: true }).eq('id', id).select('id')); }
  async deleteEmail(id) { changed(await this.sb.from('email_subscriptions').delete().eq('id', id).select('id')); }
  async addLeave(row) { check(await this.sb.from('leaves').insert(row)); }
  async deleteLeave(id) { changed(await this.sb.from('leaves').delete().eq('id', id).select('id')); }
  async updateProfile(id, patch) {
    const [row] = changed(await this.sb.from('profiles').update(patch).eq('id', id).select(PROFILE_COLUMNS));
    // protect_profile_fields() quietly keeps fields only admins may change, for example when admin access was removed in another tab.
    if (Object.keys(patch).some(k => k in row && row[k] !== patch[k])) throw new Error('Only admins can make that change. The page has been refreshed.');
  }
  /** Saves the whole rotation order in one step (set_rota_order in supabase/006_hardening.sql). */
  async setRotaOrder(ids) {
    const { error } = await this.sb.rpc('set_rota_order', { ids });
    if (!error) return;
    // Databases without update 6: save one person at a time, as before.
    if (error.code !== 'PGRST202') throw new Error(error.message);
    for (let k = 0; k < ids.length; k++) await this.updateProfile(ids[k], { rota_order: k });
  }
  async addHoliday(date, name) { check(await this.sb.from('holidays').upsert({ date, name })); }
  async deleteHoliday(date) { changed(await this.sb.from('holidays').delete().eq('date', date).select('date')); }
  async updateSettings(patch) { changed(await this.sb.from('settings').update(patch).eq('id', 1).select('id')); }
  async updateLeave(id, patch) { changed(await this.sb.from('leaves').update(patch).eq('id', id).select('id')); }
  /** Save the rotation from a date onwards (see checkpointFor in schedule.js). Replaces any checkpoint on that date. */
  async saveCheckpoint(cp) { check(await this.sb.from('rota_checkpoints').upsert(cp)); }
  /** Restart the rotation on `start`: clears all history and begins with order[0]. */
  async resetRotation(start, order) {
    check(await this.sb.from('rota_checkpoints').delete().gte('effective_date', '1900-01-01'));
    check(await this.sb.from('rota_checkpoints').insert({ effective_date: start, member_order: order, next_primary: order[0] || null }));
    await this.updateSettings({ rota_start: start });
  }
}

const DEMO_KEY = 'duty-roster-demo';
const DEMO_PEOPLE = ['Alice Tan', 'Ben Lim', 'Chloe Ng', 'Dev Kumar', 'Elena Goh'];

export class DemoStore {
  constructor() {
    this.mode = 'demo';
    this.listeners = [];
    this.db = this.read() || this.seed();
  }
  read() { try { return JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) { return null; } }
  write() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(this.db)); } catch (e) { /* private mode: keep in memory */ } }
  seed() {
    const today = todaySG();
    const profiles = DEMO_PEOPLE.map((name, i) => ({
      id: 'demo-' + i, email: name.split(' ')[0].toLowerCase() + '@example.com', display_name: name,
      rota_order: i, active: true, is_admin: i === 0
    }));
    const db = { profiles, leaves: [], holidays: SG_HOLIDAYS.slice(), settings: { id: 1, rota_start: today }, session: null, nextId: 1,
      checkpoints: [{ effective_date: today, member_order: profiles.map(p => p.id), next_primary: profiles[0].id }] };
    // One example leave so the effect is visible straight away.
    const d = new Date(); d.setDate(d.getDate() + 1);
    db.leaves.push({ id: db.nextId++, user_id: 'demo-1', start_date: toISO(d), end_date: toISO(d), note: 'Example: medical appointment' });
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) { /* private mode: keep in memory */ }
    return db;
  }
  reset() { try { localStorage.removeItem(DEMO_KEY); } catch (e) {} this.db = this.seed(); this.emit(); }
  emit() { this.listeners.forEach(cb => cb()); }
  async userId() { return this.db.session; }
  onAuthChange(cb) { this.listeners.push(cb); }
  async signIn(email) {
    const p = this.db.profiles.find(x => x.email.toLowerCase() === String(email).trim().toLowerCase());
    if (!p) throw new Error('No demo account with that email. Pick one of the demo people below.');
    this.db.session = p.id; this.write(); this.emit();
  }
  async signUp(email, _password, name) {
    if (this.db.profiles.some(x => x.email.toLowerCase() === email.toLowerCase())) throw new Error('That email already has an account.');
    const id = 'demo-' + Date.now();
    // Like the real database: new sign-ups wait for an admin to approve them.
    this.db.profiles.push({ id, email, display_name: name || email.split('@')[0], rota_order: Math.max(-1, ...this.db.profiles.map(p => p.rota_order)) + 1, active: true, is_admin: false, approved: false });
    this.db.session = id; this.write(); this.emit();
    return { needsConfirmation: false };
  }
  async signOut() { this.db.session = null; this.write(); this.emit(); }
  async load() {
    const clone = x => JSON.parse(JSON.stringify(x));
    const profiles = clone(this.db.profiles).sort((a, b) => a.rota_order - b.rota_order);
    return { me: profiles.find(p => p.id === this.db.session) || null, profiles,
      leaves: clone(this.db.leaves).sort((a, b) => a.start_date.localeCompare(b.start_date)),
      holidays: clone(this.db.holidays).sort((a, b) => a.date.localeCompare(b.date)), settings: clone(this.db.settings),
      checkpoints: clone(this.checkpoints()),
      subscriptions: this.me() && this.me().is_admin ? clone(this.db.subscriptions || []) : null };
  }
  async loadPublic(from, to) {
    const s = this.db.settings;
    if (s.public_calendar === false) return null;
    const members = this.db.profiles.filter(onRota).sort((a, b) => a.rota_order - b.rota_order)
      .map(p => ({ id: p.id, name: p.display_name }));
    const people = this.db.profiles.map(p => ({ id: p.id, name: p.display_name }));
    return publicCalendar({ members, people, checkpoints: this.checkpoints(), leaves: this.db.leaves, anchor: s.rota_start, from, to, today: todaySG(),
      holidays: Object.fromEntries(this.db.holidays.map(h => [h.date, h.name])) });
  }
  /** Same rules as the database's row level security. */
  requireAdmin(what) { if (!this.me().is_admin) throw new Error('Only admins can ' + what + '.'); }
  async deleteProfile(id) {
    this.requireAdmin('remove people');
    this.db.profiles = this.db.profiles.filter(p => p.id !== id);
    this.db.leaves = this.db.leaves.filter(l => l.user_id !== id);
    this.write();
  }
  me() { return this.db.profiles.find(p => p.id === this.db.session); }
  // Demo mode keeps requests but never sends email.
  async requestEmail(email) {
    const e = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Please enter a valid email address.');
    const subs = this.db.subscriptions = this.db.subscriptions || [];
    if (!subs.some(x => x.email === e)) subs.push({ id: this.db.nextId++, email: e, approved: false, created_at: new Date().toISOString(), token: 'demo-' + Date.now() });
    this.write();
  }
  async unsubscribeEmail(token) {
    const before = (this.db.subscriptions || []).length;
    this.db.subscriptions = (this.db.subscriptions || []).filter(x => x.token !== token); this.write();
    return this.db.subscriptions.length < before;
  }
  async approveEmail(id) {
    this.requireAdmin('approve email requests');
    const x = (this.db.subscriptions || []).find(y => y.id === id);
    if (!x) throw new Error('That request was already removed.');
    x.approved = true; this.write();
  }
  async deleteEmail(id) {
    this.requireAdmin('remove email addresses');
    this.db.subscriptions = (this.db.subscriptions || []).filter(y => y.id !== id); this.write();
  }
  /** Demo data saved before checkpoints existed gets one, built from the current rotation. */
  checkpoints() {
    if (!this.db.checkpoints) {
      const order = this.db.profiles.filter(onRota).sort((a, b) => a.rota_order - b.rota_order).map(p => p.id);
      this.db.checkpoints = [{ effective_date: this.db.settings.rota_start, member_order: order, next_primary: order[0] || null }];
      this.write();
    }
    return this.db.checkpoints;
  }
  async saveCheckpoint(cp) {
    this.requireAdmin('change the rotation');
    this.db.checkpoints = this.checkpoints().filter(c => c.effective_date !== cp.effective_date).concat(cp); this.write();
  }
  async resetRotation(start, order) {
    this.requireAdmin('change the rotation');
    this.db.checkpoints = [{ effective_date: start, member_order: order, next_primary: order[0] || null }];
    this.db.settings.rota_start = start; this.write();
  }
  // Mirrors enforce_leave_rules() in supabase/004_stable_history.sql: non-admins can't backdate leave.
  leaveRule(op, row, old) {
    if (this.me().is_admin) return;
    const today = todaySG();
    if (op === 'add' && row.start_date < today) throw new Error('Leave can only be added from today onwards. Ask an admin to record past leave.');
    if (op === 'delete' && old.start_date < today) throw new Error('Leave that has begun can’t be deleted. End it early instead.');
    if (op === 'update' && row.end_date < addDays(today, -1)) throw new Error('Leave can only be shortened to end yesterday at the earliest.');
    // Mirrors supabase/006_hardening.sql.
    if (op === 'add' && fromISO(row.end_date) - fromISO(row.start_date) >= 180 * 864e5) throw new Error('Leave can be at most 180 days at a time. Ask an admin to record longer leave.');
    if (op === 'add' && row.start_date > addDays(today, 365)) throw new Error('Leave can be booked up to a year ahead.');
  }
  async addLeave(row) {
    if (row.end_date < row.start_date) throw new Error('The end date is before the start date.');
    const me = this.me();
    if (row.user_id !== me.id && !me.is_admin) throw new Error('Only admins can add leave for other people.');
    this.leaveRule('add', row);
    this.db.leaves.push({ ...row, id: this.db.nextId++ }); this.write();
  }
  async deleteLeave(id) {
    const old = this.db.leaves.find(l => l.id === id);
    if (!old) throw new Error('That leave was already removed.');
    if (old.user_id !== this.me().id) this.requireAdmin('remove other people’s leave');
    this.leaveRule('delete', null, old);
    this.db.leaves = this.db.leaves.filter(l => l.id !== id); this.write();
  }
  async updateLeave(id, patch) {
    const l = this.db.leaves.find(x => x.id === id);
    this.leaveRule('update', { ...l, ...patch }, l);
    Object.assign(l, patch); this.write();
  }
  async updateProfile(id, patch) {
    const me = this.me(), p = this.db.profiles.find(x => x.id === id);
    if (!me.is_admin) { if (id !== me.id) throw new Error('Only admins can change other people.'); patch = { display_name: patch.display_name }; }
    Object.keys(patch).forEach(k => { if (patch[k] !== undefined) p[k] = patch[k]; });
    this.write();
  }
  async setRotaOrder(ids) {
    this.requireAdmin('change the rotation order');
    const rest = this.db.profiles.filter(p => !ids.includes(p.id)).sort((a, b) => a.rota_order - b.rota_order);
    ids.map(id => this.db.profiles.find(p => p.id === id)).filter(Boolean).concat(rest).forEach((p, k) => { p.rota_order = k; });
    this.write();
  }
  async addHoliday(date, name) { this.requireAdmin('change holidays'); this.db.holidays = this.db.holidays.filter(h => h.date !== date).concat({ date, name }); this.write(); }
  async deleteHoliday(date) { this.requireAdmin('change holidays'); this.db.holidays = this.db.holidays.filter(h => h.date !== date); this.write(); }
  async updateSettings(patch) { this.requireAdmin('change settings'); Object.assign(this.db.settings, patch); this.write(); }
}
