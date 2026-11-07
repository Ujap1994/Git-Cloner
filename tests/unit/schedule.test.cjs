const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextRun, dueRun, Scheduler } = require('../../app/core/schedule.cjs');
const local = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute);
const schedule = { enabled: true, checksPerDay: 3, times: ['02:00', '10:00', '18:00'] };
test('next run uses local time and rolls into tomorrow', () => {
  assert.equal(nextRun(schedule, local(3, 3)), local(3, 10).toISOString());
  assert.equal(nextRun(schedule, local(3, 18)), local(4, 2).toISOString());
});
test('catches up only the latest missed slot today', () => {
  assert.equal(dueRun(schedule, null, local(3, 15)), local(3, 10).toISOString());
  assert.equal(dueRun(schedule, local(3, 10).toISOString(), local(3, 15)), null);
  assert.equal(dueRun(schedule, null, local(3, 1)), null);
  assert.equal(dueRun(schedule, local(2, 18).toISOString(), local(3, 19)), local(3, 18).toISOString());
});
test('paused schedule never runs', () => {
  assert.equal(nextRun({ ...schedule, enabled: false }), null);
  assert.equal(dueRun({ ...schedule, enabled: false }, null), null);
});
test('scheduler does not run without enabled sources or overlap ticks', async () => {
  let calls = 0,
    release;
  let config = { sources: [], schedule };
  const scheduler = new Scheduler({
    getConfig: () => config,
    getLastRun: () => null,
    run: () => {
      calls++;
      return new Promise(resolve => {
        release = resolve;
      });
    }
  });
  await scheduler.tick(local(3, 12));
  assert.equal(calls, 0);
  config = { sources: [{ enabled: true }], schedule };
  const running = scheduler.tick(local(3, 12));
  await scheduler.tick(local(3, 12));
  assert.equal(calls, 1);
  release();
  await running;
});
test('daylight saving transitions still produce a future local slot', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Berlin';
    const dstSchedule = { enabled: true, times: ['02:30'] };
    const before = new Date(2026, 2, 29, 1, 30);
    const after = new Date(nextRun(dstSchedule, before));
    assert.equal(after.getDate(), 29);
    assert.equal(after.getHours(), 3);
    assert.ok(after > before);
    const fall = new Date(2026, 9, 25, 1, 0);
    assert.ok(new Date(nextRun(dstSchedule, fall)) > fall);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
