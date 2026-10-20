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

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function isWeekend(iso) {
  const day = fromISO(iso).getDay();
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
 * order, saves a checkpoint dated today, so days before it keep the order they had.
 * Without checkpoints the rotation uses `members` from `anchor`, as before.
 */
function walk({ members, leaves, holidays, anchor, checkpoints, people }, from, to, onDay) {
  const cps = (checkpoints || []).slice().sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  const byId = people ? Object.fromEntries(people.map(p => [p.id, p])) : {};
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
    if (day >= from) onDay(entry);
    day = addDays(day, 1);
  }
  return { list, pointer };
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

/**
 * The checkpoint to save when the rotation changes on `date` to `newOrder` (profile ids, in order).
 * Works out whose turn it would have been on `date` under the old rotation (ignoring any checkpoint
 * already saved for that date, which this one replaces) and keeps that person next, or the next
 * person after them who is still in the rotation.
 */
export function checkpointFor(p, date, newOrder) {
  const earlier = (p.checkpoints || []).filter(c => c.effective_date < date);
  if (!earlier.length && (p.checkpoints || []).length) {
    // Changing the rotation before it has started: the first checkpoint just takes the new order.
    return { effective_date: p.checkpoints.slice().sort((a, b) => a.effective_date.localeCompare(b.effective_date))[0].effective_date,
      member_order: newOrder, next_primary: newOrder[0] || null };
  }
  const { list, pointer } = walk({ ...p, checkpoints: earlier }, date, addDays(date, -1), () => {});
  let next = null;
  for (let i = 0; i < list.length && !next; i++) {
    const id = list[(pointer + i) % list.length].id;
    if (newOrder.includes(id)) next = id;
  }
  return { effective_date: date, member_order: newOrder, next_primary: next || newOrder[0] || null };
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

/** Today's date in Singapore as 'YYYY-MM-DD', whatever the viewer's timezone. Matches sg_today() in the database. */
export function todaySG() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
