// Dates are Singapore dates as 'YYYY-MM-DD' strings, and the answers must not depend on the viewer's timezone.
// Node applies a change to process.env.TZ straight away, so these run the same checks in several zones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todaySG, addDays, daysBetween, isWeekend, buildSchedule } from '../src/schedule.js';

const ZONES = ['UTC', 'Asia/Singapore', 'America/New_York', 'Europe/London', 'America/Los_Angeles', 'Australia/Sydney', 'Pacific/Apia', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kathmandu'];
function inEachZone(fn) {
  const was = process.env.TZ;
  try { for (const tz of ZONES) { process.env.TZ = tz; fn(tz); } }
  finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}

test('todaySG() is the date in Singapore (UTC+8), changing at Singapore midnight, in any timezone', () => {
  inEachZone(tz => {
    assert.equal(todaySG(Date.parse('2026-11-17T15:59:59Z')), '2026-11-17', tz);   // 11:59:59pm in Singapore
    assert.equal(todaySG(Date.parse('2026-11-17T16:00:00Z')), '2026-11-18', tz);   // midnight
    assert.equal(todaySG(Date.parse('2026-12-31T16:00:00Z')), '2027-01-01', tz);
    assert.equal(todaySG(new Date('2026-03-08T07:00:00Z')), '2026-03-08', tz);      // a Date works too
    assert.match(todaySG(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

test('adding days, counting days and weekends give the same answers in every timezone, across daylight saving', () => {
  inEachZone(tz => {
    for (let i = 0; i < 800; i++) {
      const expected = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const d = addDays('2026-01-01', i);
      assert.equal(d, expected, tz);
      assert.equal(daysBetween('2026-01-01', d), i, tz);
      assert.equal(isWeekend(d), [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()), tz + ' ' + d);
    }
    assert.equal(addDays('2026-03-08', -1), '2026-03-07', tz);   // US clocks change on 8 March 2026
    assert.equal(daysBetween('2027-01-10', '2027-07-09'), 180, tz);
    assert.equal(daysBetween('2026-11-18', '2026-11-17'), -1, tz);
    // A schedule over a daylight-saving change has every day once.
    const days = buildSchedule({ members: [{ id: 'a', name: 'A' }], leaves: [], holidays: {}, anchor: '2026-03-02', from: '2026-03-02', to: '2026-04-10' });
    assert.equal(days.length, 40, tz);
    assert.equal(days.filter(x => x.kind === 'work').length, 30, tz);
  });
});
