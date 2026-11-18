// Duty rotation logic. Pure functions, no browser or database code, so it can be unit tested.
//
// How the rotation works:
// - Active members stand in a fixed circle, ordered by `rota_order`.
// - Only working days count: Monday to Friday, minus public holidays.
// - Each working day, everyone available gets a role. The first available person from the
//   pointer is Primary, the next is Secondary 1, then Secondary 2, and so on round the circle.
// - Next working day the pointer moves to the person after today's Primary.
// - Anyone on leave is skipped for that day. If it was their turn as Primary they miss it
//   (no one does Primary twice in a row) and get their next turn when the circle comes round.

/** 'YYYY-MM-DD' for a Date, using local calendar fields. */
export function toISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Parse 'YYYY-MM-DD' as a local date at noon (noon avoids daylight-saving edge cases). */
export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

const DAY_MS = 24 * 60 * 60 * 1000, SG_OFFSET_MS = 8 * 60 * 60 * 1000;   // Singapore is UTC+8 all year

// Date arithmetic counts calendar days in UTC, so it gives the same answer in every viewer's timezone
// (daylight saving can't shift a day, and no local day is skipped).
const utc = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };

export function addDays(iso, n) {
  return new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` ('YYYY-MM-DD'), like `b - a` on dates in SQL. */
export function daysBetween(a, b) {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

export function isWeekend(iso) {
  const day = new Date(utc(iso)).getUTCDay();
  return day === 0 || day === 6;
}

/** Role name for position i (0 = Primary). */
export function roleName(i) {
  return i === 0 ? 'Primary' : 'Secondary ' + i;
}

/** People who take part in the rotation: active and approved (profiles from before approval existed count as approved). */
export function onRota(profile) {
  return profile.active && profile.approved !== false;
}

/** Is `member` on leave on `iso`? Leaves are inclusive date ranges. */
function onLeave(leaves, memberId, iso) {
  return leaves.some(l => l.user_id === memberId && l.start_date <= iso && iso <= l.end_date);
}

/*
 * Checkpoints keep history stable (GitHub issue #7).
 * A checkpoint says: from `effective_date`, the rotation is `member_order` (profile ids) and the
 * next working day starts with `next_primary`. Every change to who is in the rotation, or their
 * order, saves a checkpoint dated today, so days before it keep the order they had. A correction to
 * past leave or holidays saves one on the day after the corrected days, so later days keep theirs.
 * Without checkpoints the rotation uses `members` from `anchor`, as before.
 */
const byDate = (a, b) => a.effective_date.localeCompare(b.effective_date);
function walk({ members, leaves, holidays, anchor, checkpoints, people }, from, to, onDay) {
  const cps = (checkpoints || []).slice().sort(byDate);
  const byId = Object.fromEntries([...(members || []), ...(people || [])].map(p => [p.id, p]));
  const start = cps.length ? cps[0].effective_date : anchor;
  let list = cps.length ? [] : members;
  let pointer = 0;
  let ci = 0;
  let day = start < from ? start : from;
  while (day <= to) {
    while (ci < cps.length && cps[ci].effective_date <= day) {
      const cp = cps[ci++];
      list = cp.member_order.map(id => byId[id]).filter(Boolean);
      pointer = Math.max(0, list.findIndex(m => m.id === cp.next_primary));
    }
    // Whose turn it is as the day begins (after any checkpoint dated that day).
    const turn = { list, pointer };
    const holiday = holidays[day];
    let entry;
    if (day < start) entry = { date: day, kind: 'before-start', duties: [], onLeave: [] };
    else if (isWeekend(day)) entry = { date: day, kind: 'weekend', duties: [], onLeave: [] };
    else if (holiday) entry = { date: day, kind: 'holiday', holiday, duties: [], onLeave: [] };
    else {
      const n = list.length, duties = [], away = [];
      let primaryPos = -1;
      for (let i = 0; i < n; i++) {
        const pos = (pointer + i) % n;
        const m = list[pos];
        if (onLeave(leaves, m.id, day)) { away.push(m); continue; }
        if (primaryPos < 0) primaryPos = pos;
        duties.push({ role: roleName(duties.length), member: m });
      }
      if (primaryPos >= 0) pointer = (primaryPos + 1) % n;
      entry = { date: day, kind: 'work', duties, onLeave: away };
    }
    if (day >= from) onDay(entry, turn);
    day = addDays(day, 1);
  }
}

/**
 * Build the duty schedule for every calendar day from `from` to `to` (inclusive).
 *
 * @param {object} p
 * @param {{id:string, name:string}[]} p.members  Rotation in order, used when there are no checkpoints.
 * @param {{user_id:string, start_date:string, end_date:string}[]} p.leaves
 * @param {Object<string,string>} p.holidays  Map of 'YYYY-MM-DD' to holiday name.
 * @param {string} p.anchor  Rotation start when there are no checkpoints.
 * @param {{effective_date:string, member_order:string[], next_primary:string}[]} [p.checkpoints]
 * @param {{id:string, name:string}[]} [p.people]  Everyone a checkpoint may name, including people no longer on the rota.
 * @param {string} p.from
 * @param {string} p.to
 * @returns {{date:string, kind:'work'|'weekend'|'holiday'|'before-start', holiday?:string,
 *            duties:{role:string, member:object}[], onLeave:object[]}[]}
 */
export function buildSchedule(p) {
  const days = [];
  walk(p, p.from, p.to, d => days.push(d));
  return days;
}

/** The saved checkpoints in date order; for data from before checkpoints existed, the one it stands for: today's order from `anchor`. */
function savedOrBase(p) {
  if (p.checkpoints && p.checkpoints.length) return p.checkpoints.slice().sort(byDate);
  const ids = (p.members || []).map(m => m.id);
  return [{ effective_date: p.anchor, member_order: ids, next_primary: ids[0] || null }];
}
const saved = p => !!(p.checkpoints && p.checkpoints.length);

/** One day of the schedule, with whose turn it is as the day begins (`list`, `pointer`). */
function dayOf(p, date) {
  let out;
  walk(p, date, date, (entry, turn) => { out = { ...entry, ...turn }; });
  return out;
}
const primaryOf = d => d && d.kind === 'work' && d.duties.length ? d.duties[0].member : null;

/**
 * The checkpoint to save when the rotation changes on `date` to `newOrder` (profile ids, in order).
 * It builds on the rotation as it stands, including a checkpoint already saved for `date` (which this one
 * replaces), so a second change on the same day keeps what the first one left.
 * - On a working day, that day's Primary stays Primary if they are still in the rotation: the team has been told.
 * - Otherwise whoever's turn it is stays next, or the next person after them who is still in the rotation.
 * - Before anyone has been on duty, the first checkpoint just takes the new order.
 */
export function checkpointFor(p, date, newOrder) {
  const cps = savedOrBase(p);
  const day = dayOf({ ...p, checkpoints: cps }, date);
  const primary = primaryOf(day);
  if (date <= cps[0].effective_date && !primary) {
    return { effective_date: cps[0].effective_date, member_order: newOrder, next_primary: newOrder[0] || null };
  }
  if (primary && newOrder.includes(primary.id)) return { effective_date: date, member_order: newOrder, next_primary: primary.id };
  let next = null;
  for (let i = 0; i < day.list.length && !next; i++) {
    const id = day.list[(day.pointer + i) % day.list.length].id;
    if (newOrder.includes(id)) next = id;
  }
  return { effective_date: date, member_order: newOrder, next_primary: next || newOrder[0] || null };
}

/**
 * What to save on `date` for the team as it now is (`order`: the ids of active, approved people in rotation order).
 * Used after approving, deactivating, reactivating or reordering people, and by an admin's page to put right a
 * rotation that doesn't match the team (a checkpoint that failed to save, or a fresh install's first admin).
 * Nothing when the checkpoint in effect on `date` already has that order; otherwise checkpointFor's checkpoint.
 */
export function rotaChange(p, date, order) {
  const cps = savedOrBase(p);
  const inEffect = cps.filter(c => c.effective_date <= date).pop() || cps[0];
  if (inEffect.member_order.join() === order.join()) return [];
  const cp = checkpointFor({ ...p, checkpoints: cps }, date, order);
  return saved(p) || cp.effective_date === cps[0].effective_date ? [cp] : [cps[0], cp];
}

/**
 * A correction to leave or holidays on `first`..`last` that reaches back before `today` (an admin adding a
 * forgotten holiday, removing one, or recording leave after the fact) would move every later day's duties too,
 * today's Primary included. To change only the corrected days, save a checkpoint first on the day after them
 * (today at the latest), worked out from the rotation as it is before the correction, with the order in effect
 * that day. The trade-off: a Primary recorded as absent after the fact doesn't get the turn back.
 *
 * `before` and `after` are the rotation (as for buildSchedule) without and with the correction. Returns
 * `checkpoints` to save before making it (none if no past working day changes), `changed`: the past working
 * days whose duties change, and the Primary on the next working day from today (`day`): `was` and `now`.
 */
export function pastEdit(before, after, first, last, today) {
  const out = { checkpoints: [], changed: [], day: null, was: null, now: null };
  if (first >= today) return out;
  const keep = addDays(last, 1) < today ? addDays(last, 1) : today;
  const sig = d => d.kind + ':' + d.duties.map(x => x.member.id).join();
  const a = buildSchedule({ ...before, from: first, to: addDays(keep, -1) });
  const b = buildSchedule({ ...after, from: first, to: addDays(keep, -1) });
  out.changed = a.filter((d, i) => sig(d) !== sig(b[i])).map(d => d.date);
  if (!out.changed.length) return out;
  const cps = savedOrBase(before);
  const inEffect = cps.filter(c => c.effective_date < keep).pop();
  if (inEffect && !cps.some(c => c.effective_date === keep)) {
    const cp = checkpointFor({ ...before, checkpoints: cps }, keep, inEffect.member_order);
    out.checkpoints = saved(before) ? [cp] : [cps[0], cp];
  }
  const kept = savedOrBase(after).filter(c => !out.checkpoints.some(k => k.effective_date === c.effective_date)).concat(out.checkpoints);
  const next = buildSchedule({ ...before, from: today, to: addDays(today, 31) }).find(d => d.kind === 'work');
  if (next) {
    out.day = next.date;
    out.was = primaryOf(next);
    out.now = primaryOf(dayOf({ ...after, checkpoints: kept }, next.date));
  }
  return out;
}

/**
 * The public calendar's view of the roster: names and roles only, no leave and no ids.
 * Mirrors public_calendar() in supabase/004_stable_history.sql, including its date window
 * (90 days back to 180 days ahead, at most 62 days per request). Keep the two in step.
 */
export function publicCalendar({ members, leaves, holidays, anchor, checkpoints, people, from, to, today }) {
  const winFrom = from > addDays(today, -90) ? from : addDays(today, -90);
  let winTo = to < addDays(today, 180) ? to : addDays(today, 180);
  if (winTo > addDays(winFrom, 62)) winTo = addDays(winFrom, 62);
  const days = winTo < winFrom ? [] : buildSchedule({ members, leaves, holidays, anchor, checkpoints, people, from: winFrom, to: winTo });
  return {
    rota_start: checkpoints && checkpoints.length ? checkpoints.map(c => c.effective_date).sort()[0] : anchor,
    from: winFrom, to: winTo,
    people: members.map(m => m.name),
    days: days.map(d => d.kind === 'work'
      ? { date: d.date, kind: d.kind, duties: d.duties.map(x => ({ role: x.role, name: x.member.name })) }
      : d.kind === 'holiday' ? { date: d.date, kind: d.kind, holiday: d.holiday } : { date: d.date, kind: d.kind })
  };
}

/** Office hours in Singapore, in minutes after midnight: 9am to 6pm. Outside them no one is on duty. */
export const OFFICE_OPEN = 9 * 60, OFFICE_CLOSE = 18 * 60;

/** Minutes after midnight in Singapore, whatever the viewer's timezone. */
export function minutesSG(now = Date.now()) {
  return Math.floor((((+now + SG_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / 60000);
}

/** 'before' (before 9am), 'open' (9am to 6pm) or 'after' (from 6pm), by the clock in Singapore. Whether today is a working day is up to the caller. */
export function officeHours(now = Date.now()) {
  const m = minutesSG(now);
  return m < OFFICE_OPEN ? 'before' : m < OFFICE_CLOSE ? 'open' : 'after';
}

/** Milliseconds from `now` until the next 9am or 6pm in Singapore, so a page can switch over on time. */
export function msUntilOfficeChange(now = Date.now()) {
  const sinceMidnight = (((+now + SG_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  const next = [OFFICE_OPEN, OFFICE_CLOSE, OFFICE_OPEN + 24 * 60].map(m => m * 60000).find(t => t > sinceMidnight);
  return next - sinceMidnight;
}

/** Today's date in Singapore as 'YYYY-MM-DD', whatever the viewer's timezone (UTC+8, no daylight saving, as in minutesSG). Matches sg_today() in the database. */
export function todaySG(now = Date.now()) {
  return new Date(+now + SG_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The roster message for sharing (WhatsApp and the phone's share menu): names and roles only.
 * `day` is { date, duties: [{ role, name }] }. Leave is deliberately not included.
 */
export function rosterMessage(day, calendarUrl) {
  const when = fromISO(day.date).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
  const lines = ['2FA Login Request · ' + when];
  if (day.duties.length) {
    day.duties.forEach(d => lines.push(d.role + ': ' + d.name));
    // The Primary handles OTP login requests that day.
    lines.push('', 'Hi ' + day.duties[0].name + ' (Primary), may we have OTP login for ...');
  } else lines.push('No one is available for duty.');
  if (calendarUrl) lines.push('Calendar: ' + calendarUrl);
  return lines.join('\n');
}

/** The WhatsApp logo (Simple Icons, CC0) for buttons that open WhatsApp. */
export const WHATSAPP_ICON = '<svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';

/** A link that opens WhatsApp with `text` ready to send; the person picks the chat or group. */
export function whatsappLink(text) {
  return 'https://wa.me/?text=' + encodeURIComponent(text);
}

/**
 * A first name for tight spaces (calendar cells, strips): "Alice Tan" → "Alice". When two people in
 * `names` share that first name, the full name is kept so they can be told apart.
 */
export function shortName(name, names = []) {
  const first = n => String(n).trim().split(/\s+/)[0] || '';
  const mine = first(name);
  return names.filter(n => first(n) === mine).length > 1 ? String(name).trim() : mine;
}
