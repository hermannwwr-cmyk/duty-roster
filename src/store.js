// Data layer. Two implementations with the same methods:
// - SupabaseStore: real logins and a shared Postgres database.
// - DemoStore: everything in this browser's localStorage, for trying the app without Supabase.
import { SG_HOLIDAYS } from './holidays-sg.js';
import { addDays, daysBetween, todaySG, onRota, publicCalendar } from './schedule.js';

// What people see when the database quietly skips a change (below), in both stores.
const NOT_SAVED = 'That change wasn’t saved. You may not have permission, or it was already removed. The page has been refreshed.';
const ONLY_ADMINS = 'Only admins can make that change. The page has been refreshed.';

// Postgres's own words for a refused write, in plain words. Messages the database writes for people (the leave rules,
// set_work_email, set_rota_order) are plain already and pass through, and so does anything not recognised here.
const CONSTRAINTS = {
  name_length: 'Please enter a name of up to 60 characters.',
  holiday_name_length: 'Please enter a holiday name of up to 60 characters.',
  note_length: 'A note can be at most 120 characters.',
  leave_dates_in_order: 'The end date is before the start date.',
  profiles_work_email_key: 'That email already belongs to someone else on the roster.',
  holidays_pkey: 'That date already has a holiday.'
};
const RAW = [
  [/row-level security policy/, () => NOT_SAVED],
  [/violates check constraint "([^"]+)"/, m => CONSTRAINTS[m[1]] || 'That change wasn’t saved. Check what you entered and try again.'],
  [/violates unique constraint "([^"]+)"/, m => CONSTRAINTS[m[1]] || 'That’s already saved.'],
  [/violates foreign key constraint/, () => NOT_SAVED],
  [/violates not-null constraint/, () => 'Please fill in every field.'],
  [/^invalid input syntax for type date|^date\/time field value out of range/, () => 'Please enter a valid date.'],
  [/^value too long for type/, () => 'That’s too long. Please shorten it.']
];
/** A database error message as people should read it, the same in both stores. */
export function plainError(message) {
  const text = String(message == null ? '' : message);
  for (const [pattern, say] of RAW) { const m = pattern.exec(text); if (m) return say(m); }
  return text;
}

function check({ data, error }) {
  if (error) throw new Error(plainError(error.message));
  return data;
}
/** For writes ending in .select(): the database skips rows you aren't allowed to change without an error, so no rows back means it didn't happen. */
function changed(res) {
  const rows = check(res);
  if (!rows || !rows.length) throw new Error(NOT_SAVED);
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
      this.sb.from('leaves').select('id, user_id, start_date, end_date, from_invite').order('start_date'),
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
    // Leave from calendar invites (supabase/011_leave_invites.sql): work emails are private like emails,
    // and only admins see invites that matched nobody.
    const [work, unmatched] = await Promise.all([
      this.sb.rpc('member_work_emails'),
      me && me.is_admin ? this.sb.from('unmatched_invites').select('uid, organizer, title, start_date, end_date').eq('dismissed', false).order('start_date') : { data: [] }
    ]).then(rs => rs.map(check));
    const workOf = Object.fromEntries(work.map(w => [w.id, w.work_email]));
    profiles.forEach(p => { p.work_email = workOf[p.id] || null; });
    return { me, profiles, leaves, holidays, settings, checkpoints, unmatched };
  }
  /** The address you send leave invites from, when it isn't your sign-in email. Admins can set anyone's. */
  async setWorkEmail(userId, email) { check(await this.sb.rpc('set_work_email', { p_user: userId, p_email: email })); }
  async dismissInvite(uid) { changed(await this.sb.from('unmatched_invites').update({ dismissed: true }).eq('uid', uid).select('uid')); }
  /** The public calendar for a date range: names and roles only. Works without signing in. Null when switched off. */
  async loadPublic(from, to) { return check(await this.sb.rpc('public_calendar', { p_from: from, p_to: to })); }
  async deleteProfile(id) { changed(await this.sb.from('profiles').delete().eq('id', id).select('id')); }
  async addLeave(row) { check(await this.sb.from('leaves').insert(row)); }
  async deleteLeave(id) { changed(await this.sb.from('leaves').delete().eq('id', id).select('id')); }
  async updateProfile(id, patch) {
    const [row] = changed(await this.sb.from('profiles').update(patch).eq('id', id).select(PROFILE_COLUMNS));
    // protect_profile_fields() quietly keeps fields only admins may change, for example when admin access was removed in another tab.
    if (Object.keys(patch).some(k => k in row && row[k] !== patch[k])) throw new Error(ONLY_ADMINS);
  }
  /** Saves the whole rotation order in one step (set_rota_order in supabase/006_hardening.sql). */
  async setRotaOrder(ids) {
    const { error } = await this.sb.rpc('set_rota_order', { ids });
    if (!error) return;
    // Databases without update 6: save one person at a time, as before.
    if (error.code !== 'PGRST202') throw new Error(plainError(error.message));
    for (let k = 0; k < ids.length; k++) await this.updateProfile(ids[k], { rota_order: k });
  }
  async addHoliday(date, name) { check(await this.sb.from('holidays').upsert({ date, name })); }
  async deleteHoliday(date) { changed(await this.sb.from('holidays').delete().eq('date', date).select('date')); }
  async updateSettings(patch) { changed(await this.sb.from('settings').update(patch).eq('id', 1).select('id')); }
  async updateLeave(id, patch) { changed(await this.sb.from('leaves').update(patch).eq('id', id).select('id')); }
  /** Save the rotation from a date onwards (see checkpointFor in schedule.js). Replaces any checkpoint on that date. */
  async saveCheckpoint(cp) { check(await this.sb.from('rota_checkpoints').upsert(cp)); }
  /** Restart the rotation on `start`: clears all history and begins with order[0].
   *  Three separate requests, ordered so that a dropped connection never leaves the rotation without history: the new
   *  starting point goes in first (replacing any on that date), then the start date, and the older checkpoints are cleared
   *  last. If one fails, the error shows and saving again finishes the restart. */
  async resetRotation(start, order) {
    check(await this.sb.from('rota_checkpoints').upsert({ effective_date: start, member_order: order, next_primary: order[0] || null }));
    await this.updateSettings({ rota_start: start });
    check(await this.sb.from('rota_checkpoints').delete().neq('effective_date', start));
  }
}

const DEMO_KEY = 'duty-roster-demo';
const DEMO_PEOPLE = ['Alice Tan', 'Ben Lim', 'Chloe Ng', 'Dev Kumar', 'Elena Goh'];

// DemoStore refuses what the database refuses, with the words people would see in production: the database's own
// (supabase/*.sql; Postgres's for row level security and check constraints, through plainError like SupabaseStore's),
// and SupabaseStore's NOT_SAVED / ONLY_ADMINS where the database skips or reverts a change quietly. The database checks
// in this order: row level security on which rows an update or delete can reach, then triggers, then row level
// security on the new row, then check constraints (in name order).
const rlsRefused = table => new Error(plainError('new row violates row-level security policy for table "' + table + '"'));
const constraintRefused = (table, name) => new Error(plainError('new row for relation "' + table + '" violates check constraint "' + name + '"'));
// SQL's trim() removes spaces only, and char_length() counts characters, not UTF-16 units.
const sqlTrim = s => String(s == null ? '' : s).replace(/^ +| +$/g, '');
const chars = s => [...String(s)].length;
/** Constraints name_length (profiles) and holiday_name_length (holidays) in supabase/006_hardening.sql. */
const nameOk = s => { const n = chars(sqlTrim(s)); return n >= 1 && n <= 60; };

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
      rota_order: i, active: true, is_admin: i === 0, approved: true
    }));
    const db = { profiles, leaves: [], holidays: SG_HOLIDAYS.slice(), settings: { id: 1, rota_start: today }, session: null, nextId: 1,
      checkpoints: [{ effective_date: today, member_order: profiles.map(p => p.id), next_primary: profiles[0].id }] };
    // One example leave so the effect is visible straight away: tomorrow in Singapore.
    db.leaves.push({ id: db.nextId++, user_id: 'demo-1', start_date: addDays(today, 1), end_date: addDays(today, 1), note: 'Example: medical appointment' });
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
    // Like handle_new_user(): the name is trimmed (the email's first part if empty) and cut to 60 characters; the very
    // first person is the approved admin, and everyone else waits for an admin to approve them.
    const first = !this.db.profiles.length;
    this.db.profiles.push({ id, email, display_name: [...(sqlTrim(name) || email.split('@')[0])].slice(0, 60).join(''),
      rota_order: Math.max(-1, ...this.db.profiles.map(p => p.rota_order)) + 1, active: true, is_admin: first, approved: first });
    this.db.session = id; this.write(); this.emit();
    return { needsConfirmation: false };
  }
  async signOut() { this.db.session = null; this.write(); this.emit(); }
  async load() {
    // Pick up changes made in another tab, like the real database would.
    this.db = this.read() || this.db;
    const clone = x => JSON.parse(JSON.stringify(x));
    const self = this.me(), admin = !!(self && self.is_admin), member = this.isMember();
    // Like row level security and supabase/003_private_data.sql: people waiting for approval see only their own profile,
    // and no leave or rotation history. Emails, work emails and leave notes come only to their owner and to admins
    // (member_emails(), member_work_emails(), leave_notes()).
    const profiles = clone(this.db.profiles.filter(p => member || p.id === this.db.session)).sort((a, b) => a.rota_order - b.rota_order);
    profiles.forEach(p => {
      const mine = admin || p.id === this.db.session;
      p.email = mine ? p.email || null : null;
      p.work_email = mine ? p.work_email || null : null;
    });
    const leaves = member ? clone(this.db.leaves).sort((a, b) => a.start_date.localeCompare(b.start_date)) : [];
    leaves.forEach(l => { l.note = admin || l.user_id === this.db.session ? l.note || null : null; });
    return { me: profiles.find(p => p.id === this.db.session) || null, profiles, leaves,
      holidays: clone(this.db.holidays).sort((a, b) => a.date.localeCompare(b.date)), settings: clone(this.db.settings),
      checkpoints: member ? clone(this.checkpoints()) : [], unmatched: admin ? clone(this.db.unmatched || []) : [] };
  }
  // Same rules as set_work_email() in supabase/011_leave_invites.sql. Demo mode has no invite sync.
  async setWorkEmail(userId, email) {
    const me = this.me();
    if (!(me.is_admin || (userId === me.id && this.isMember()))) throw new Error('You can only change your own work email.');
    const e = sqlTrim(email).toLowerCase() || null;
    if (e && (chars(e) > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) throw new Error('Please enter a valid email address.');
    if (e && this.db.profiles.some(p => p.id !== userId && [p.work_email, p.email].some(x => x && x.toLowerCase() === e))) throw new Error('That email already belongs to someone else on the roster.');
    const p = this.db.profiles.find(x => x.id === userId);
    if (p) p.work_email = e;
    if (e) this.db.unmatched = (this.db.unmatched || []).filter(u => u.organizer.toLowerCase() !== e);
    this.write();
  }
  async dismissInvite(uid) {
    if (!this.me().is_admin || !(this.db.unmatched || []).some(u => u.uid === uid)) throw new Error(NOT_SAVED);
    this.db.unmatched = this.db.unmatched.filter(u => u.uid !== uid); this.write();
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
  me() { return this.db.profiles.find(p => p.id === this.db.session); }
  /** is_member(): signed in and approved (profiles from before approval existed count as approved). */
  isMember() { const me = this.me(); return !!(me && me.approved !== false); }
  async deleteProfile(id) {
    if (!this.me().is_admin || !this.db.profiles.some(p => p.id === id)) throw new Error(NOT_SAVED);
    this.db.profiles = this.db.profiles.filter(p => p.id !== id);
    this.db.leaves = this.db.leaves.filter(l => l.user_id !== id);
    this.write();
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
    if (!this.me().is_admin) throw rlsRefused('rota_checkpoints');
    this.db.checkpoints = this.checkpoints().filter(c => c.effective_date !== cp.effective_date).concat(cp); this.write();
  }
  async resetRotation(start, order) {
    if (!this.me().is_admin) throw rlsRefused('rota_checkpoints');
    this.db.checkpoints = [{ effective_date: start, member_order: order, next_primary: order[0] || null }];
    this.db.settings.rota_start = start; this.write();
  }
  // Mirrors enforce_leave_rules() in supabase/006_hardening.sql (which replaced 004's). Admins aren't limited.
  // Days are counted on the dates themselves, as `end_date - start_date` is in SQL.
  leaveRule(op, row, old) {
    if (this.me().is_admin) return;
    const today = todaySG();
    if (op === 'add' && row.start_date < today) throw new Error('Leave can only be added from today onwards. Ask an admin to record past leave.');
    if (op === 'update') {
      if (row.start_date !== old.start_date && (row.start_date < old.start_date ? row.start_date : old.start_date) < today) throw new Error("The start of leave that has begun can't be changed. Ask an admin.");
      if (row.end_date < addDays(today, -1) && row.end_date !== old.end_date) throw new Error('Leave can only be shortened to end yesterday at the earliest.');
    }
    if (op === 'delete' && old.start_date < today) throw new Error("Leave that has begun can't be deleted. End it early instead.");
    // Checked only when leave gets longer or moves, so shortening leave an admin recorded always works.
    if (op === 'add' || (op === 'update' && (row.start_date !== old.start_date || row.end_date !== old.end_date))) {
      const days = daysBetween(row.start_date, row.end_date);
      if (days >= 180 && (op === 'add' || days > daysBetween(old.start_date, old.end_date))) throw new Error('Leave can be at most 180 days at a time. Ask an admin to record longer leave.');
      if (row.start_date > addDays(today, 365) && (op === 'add' || row.start_date !== old.start_date)) throw new Error('Leave can be booked up to a year ahead.');
    }
  }
  /** Constraints on a leave row: leave_dates_in_order (schema.sql) and note_length (006_hardening.sql). */
  leaveRow(row) {
    if (row.end_date < row.start_date) throw constraintRefused('leaves', 'leave_dates_in_order');
    if (row.note != null && chars(row.note) > 120) throw constraintRefused('leaves', 'note_length');
  }
  /** Row level security on leaves: approved members reach their own, admins everyone's (003_private_data.sql). */
  mayChangeLeave(userId) { const me = this.me(); return me.is_admin || (userId === me.id && this.isMember()); }
  async addLeave(row) {
    this.leaveRule('add', row);
    if (!this.mayChangeLeave(row.user_id)) throw rlsRefused('leaves');
    this.leaveRow(row);
    this.db.leaves.push({ ...row, id: this.db.nextId++ }); this.write();
  }
  async deleteLeave(id) {
    const old = this.db.leaves.find(l => l.id === id);
    if (!old || !this.mayChangeLeave(old.user_id)) throw new Error(NOT_SAVED);
    this.leaveRule('delete', null, old);
    this.db.leaves = this.db.leaves.filter(l => l.id !== id); this.write();
  }
  async updateLeave(id, patch) {
    const l = this.db.leaves.find(x => x.id === id);
    if (!l || !this.mayChangeLeave(l.user_id)) throw new Error(NOT_SAVED);
    const row = { ...l, ...patch };
    this.leaveRule('update', row, l);
    if (!this.mayChangeLeave(row.user_id)) throw rlsRefused('leaves');
    this.leaveRow(row);
    Object.assign(l, patch); this.write();
  }
  async updateProfile(id, patch) {
    const me = this.me(), p = this.db.profiles.find(x => x.id === id);
    // Row level security: your own profile, or anyone's for admins. Anything else is skipped quietly.
    if (!p || (id !== me.id && !me.is_admin)) throw new Error(NOT_SAVED);
    const row = { ...p };
    Object.keys(patch).forEach(k => { if (patch[k] !== undefined) row[k] = patch[k]; });
    // protect_profile_fields(): for non-admins the database quietly keeps these as they were.
    if (!me.is_admin) ['is_admin', 'rota_order', 'active', 'email', 'approved'].forEach(k => { if (k in p) row[k] = p[k]; else delete row[k]; });
    if (!nameOk(row.display_name)) throw constraintRefused('profiles', 'name_length');
    this.db.profiles[this.db.profiles.indexOf(p)] = row; this.write();
    // SupabaseStore.updateProfile then compares the saved row with the change, and says when a field was kept.
    if (['display_name', 'rota_order', 'active', 'is_admin', 'approved'].some(k => patch[k] !== undefined && row[k] !== patch[k])) throw new Error(ONLY_ADMINS);
  }
  async setRotaOrder(ids) {
    if (!this.me().is_admin) throw new Error('Only admins can change the rotation order.');
    const rest = this.db.profiles.filter(p => !ids.includes(p.id)).sort((a, b) => a.rota_order - b.rota_order);
    ids.map(id => this.db.profiles.find(p => p.id === id)).filter(Boolean).concat(rest).forEach((p, k) => { p.rota_order = k; });
    this.write();
  }
  async addHoliday(date, name) {
    if (!this.me().is_admin) throw rlsRefused('holidays');
    if (!nameOk(name)) throw constraintRefused('holidays', 'holiday_name_length');
    this.db.holidays = this.db.holidays.filter(h => h.date !== date).concat({ date, name }); this.write();
  }
  async deleteHoliday(date) {
    if (!this.me().is_admin || !this.db.holidays.some(h => h.date === date)) throw new Error(NOT_SAVED);
    this.db.holidays = this.db.holidays.filter(h => h.date !== date); this.write();
  }
  async updateSettings(patch) {
    if (!this.me().is_admin) throw new Error(NOT_SAVED);
    Object.assign(this.db.settings, patch); this.write();
  }
}
