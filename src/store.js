// Data layer. Two implementations with the same methods:
// - SupabaseStore: real logins and a shared Postgres database.
// - DemoStore: everything in this browser's localStorage, for trying the app without Supabase.
import { SG_HOLIDAYS } from './holidays-sg.js';
import { toISO } from './schedule.js';

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

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
    const [profiles, leaves, holidays, settings] = await Promise.all([
      this.sb.from('profiles').select('*').order('rota_order'),
      this.sb.from('leaves').select('*').order('start_date'),
      this.sb.from('holidays').select('*').order('date'),
      this.sb.from('settings').select('*').eq('id', 1).single()
    ]).then(rs => rs.map(check));
    return { me: profiles.find(p => p.id === uid) || null, profiles, leaves, holidays, settings };
  }
  /** Read-only roster data for the public calendar. Works without signing in. Null when switched off. */
  async loadPublic() { return check(await this.sb.rpc('public_roster')); }
  async addLeave(row) { check(await this.sb.from('leaves').insert(row)); }
  async deleteLeave(id) { check(await this.sb.from('leaves').delete().eq('id', id)); }
  async updateProfile(id, patch) { check(await this.sb.from('profiles').update(patch).eq('id', id)); }
  async addHoliday(date, name) { check(await this.sb.from('holidays').upsert({ date, name })); }
  async deleteHoliday(date) { check(await this.sb.from('holidays').delete().eq('date', date)); }
  async updateSettings(patch) { check(await this.sb.from('settings').update(patch).eq('id', 1)); }
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
    const today = toISO(new Date());
    const profiles = DEMO_PEOPLE.map((name, i) => ({
      id: 'demo-' + i, email: name.split(' ')[0].toLowerCase() + '@example.com', display_name: name,
      rota_order: i, active: true, is_admin: i === 0
    }));
    const db = { profiles, leaves: [], holidays: SG_HOLIDAYS.slice(), settings: { id: 1, rota_start: today }, session: null, nextId: 1 };
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
    this.db.profiles.push({ id, email, display_name: name || email.split('@')[0], rota_order: Math.max(-1, ...this.db.profiles.map(p => p.rota_order)) + 1, active: true, is_admin: false });
    this.db.session = id; this.write(); this.emit();
    return { needsConfirmation: false };
  }
  async signOut() { this.db.session = null; this.write(); this.emit(); }
  async load() {
    const clone = x => JSON.parse(JSON.stringify(x));
    const profiles = clone(this.db.profiles).sort((a, b) => a.rota_order - b.rota_order);
    return { me: profiles.find(p => p.id === this.db.session) || null, profiles,
      leaves: clone(this.db.leaves).sort((a, b) => a.start_date.localeCompare(b.start_date)),
      holidays: clone(this.db.holidays).sort((a, b) => a.date.localeCompare(b.date)), settings: clone(this.db.settings) };
  }
  async loadPublic() {
    const s = this.db.settings;
    if (s.public_calendar === false) return null;
    const active = this.db.profiles.filter(p => p.active).sort((a, b) => a.rota_order - b.rota_order);
    return {
      members: active.map(p => ({ id: p.id, display_name: p.display_name, rota_order: p.rota_order })),
      leaves: this.db.leaves.map(l => ({ user_id: l.user_id, start_date: l.start_date, end_date: l.end_date })),
      holidays: this.db.holidays.slice(), rota_start: s.rota_start
    };
  }
  me() { return this.db.profiles.find(p => p.id === this.db.session); }
  async addLeave(row) {
    if (row.end_date < row.start_date) throw new Error('The end date is before the start date.');
    const me = this.me();
    if (row.user_id !== me.id && !me.is_admin) throw new Error('Only admins can add leave for other people.');
    this.db.leaves.push({ ...row, id: this.db.nextId++ }); this.write();
  }
  async deleteLeave(id) { this.db.leaves = this.db.leaves.filter(l => l.id !== id); this.write(); }
  async updateProfile(id, patch) {
    const me = this.me(), p = this.db.profiles.find(x => x.id === id);
    if (!me.is_admin) { if (id !== me.id) throw new Error('Only admins can change other people.'); patch = { display_name: patch.display_name }; }
    Object.keys(patch).forEach(k => { if (patch[k] !== undefined) p[k] = patch[k]; });
    this.write();
  }
  async addHoliday(date, name) { this.db.holidays = this.db.holidays.filter(h => h.date !== date).concat({ date, name }); this.write(); }
  async deleteHoliday(date) { this.db.holidays = this.db.holidays.filter(h => h.date !== date); this.write(); }
  async updateSettings(patch) { Object.assign(this.db.settings, patch); this.write(); }
}
