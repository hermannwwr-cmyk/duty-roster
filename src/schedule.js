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

/**
 * The public calendar's view of the roster: names and roles only, no leave and no ids.
 * Mirrors public_calendar() in supabase/003_private_data.sql, including its date window
 * (90 days back to 180 days ahead, at most 62 days per request). Keep the two in step.
 */
export function publicCalendar({ members, leaves, holidays, anchor, from, to, today }) {
  const winFrom = from > addDays(today, -90) ? from : addDays(today, -90);
  let winTo = to < addDays(today, 180) ? to : addDays(today, 180);
  if (winTo > addDays(winFrom, 62)) winTo = addDays(winFrom, 62);
  const days = winTo < winFrom ? [] : buildSchedule({ members, leaves, holidays, anchor, from: winFrom, to: winTo });
  return {
    rota_start: anchor, from: winFrom, to: winTo,
    people: members.map(m => m.name),
    days: days.map(d => d.kind === 'work'
      ? { date: d.date, kind: d.kind, duties: d.duties.map(x => ({ role: x.role, name: x.member.name })) }
      : d.kind === 'holiday' ? { date: d.date, kind: d.kind, holiday: d.holiday } : { date: d.date, kind: d.kind })
  };
}

/** Is `member` on leave on `iso`? Leaves are inclusive date ranges. */
function onLeave(leaves, memberId, iso) {
  return leaves.some(l => l.user_id === memberId && l.start_date <= iso && iso <= l.end_date);
}

/**
 * Build the duty schedule for every calendar day from `from` to `to` (inclusive).
 *
 * @param {object} p
 * @param {{id:string, name:string}[]} p.members  Active members in rota order.
 * @param {{user_id:string, start_date:string, end_date:string}[]} p.leaves
 * @param {Object<string,string>} p.holidays  Map of 'YYYY-MM-DD' to holiday name.
 * @param {string} p.anchor  First day of the rotation; the first working day on or after it starts with members[0].
 * @param {string} p.from
 * @param {string} p.to
 * @returns {{date:string, kind:'work'|'weekend'|'holiday'|'before-start', holiday?:string,
 *            duties:{role:string, member:object}[], onLeave:object[]}[]}
 */
export function buildSchedule({ members, leaves, holidays, anchor, from, to }) {
  const days = [];
  const n = members.length;
  let pointer = 0;
  // Walk from the anchor so the pointer is correct by the time we reach `from`.
  let day = anchor < from ? anchor : from;
  while (day <= to) {
    const show = day >= from;
    const holiday = holidays[day];
    let entry;
    if (day < anchor) entry = { date: day, kind: 'before-start', duties: [], onLeave: [] };
    else if (isWeekend(day)) entry = { date: day, kind: 'weekend', duties: [], onLeave: [] };
    else if (holiday) entry = { date: day, kind: 'holiday', holiday, duties: [], onLeave: [] };
    else {
      const duties = [];
      const away = [];
      let primaryPos = -1;
      for (let i = 0; i < n; i++) {
        const pos = (pointer + i) % n;
        const m = members[pos];
        if (onLeave(leaves, m.id, day)) { away.push(m); continue; }
        if (primaryPos < 0) primaryPos = pos;
        duties.push({ role: roleName(duties.length), member: m });
      }
      if (primaryPos >= 0) pointer = (primaryPos + 1) % n;
      entry = { date: day, kind: 'work', duties, onLeave: away };
    }
    if (show) days.push(entry);
    day = addDays(day, 1);
  }
  return days;
}
