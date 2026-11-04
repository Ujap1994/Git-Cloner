const { effectiveSchedule } = require('./config.cjs');
function localSlots(schedule, day) {
  return schedule.times.map(time => {
    const [hours, minutes] = time.split(':').map(Number);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
  }).sort((a, b) => a - b);
}

function nextRun(schedule, now = new Date()) {
  if (!schedule.enabled) return null;
  for (let offset = 0; offset <= 1; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const next = localSlots(schedule, day).find(slot => slot > now);
    if (next) return next.toISOString();
  }
  return null;
}

function dueRun(schedule, lastScheduledAt, now = new Date()) {
  if (!schedule.enabled) return null;
  const last = lastScheduledAt ? new Date(lastScheduledAt) : new Date(0);
  // Only the latest missed slot of the current local day is caught up.
  const due = localSlots(schedule, now).filter(slot => slot <= now && slot > last).at(-1);
  return due ? due.toISOString() : null;
}

class Scheduler {
  constructor({ getConfig, getLastRun, run, onError = () => {} }) {
    Object.assign(this, { getConfig, getLastRun, run, onError });
    this.ticking = false;
  }
  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), 15000);
    this.timer.unref?.();
    void this.tick();
  }
  stop() { clearInterval(this.timer); }
  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const config = this.getConfig();
      if (!config.sources.some(source => source.enabled)) return;
      const plan = dueSources(config, this.getLastRun(), now);
      if (plan.scheduledAt) await this.run(plan.scheduledAt,plan.sources);
    } catch (error) { this.onError(error); }
    finally { this.ticking = false; }
  }
}

function dueSources(config, state, now = new Date()) {
  const sources = {};
  for (const source of config.sources.filter(s => s.enabled)) {
    const last = typeof state === 'string' ? state : state?.lastScheduledBySource?.[source.id] ?? state?.lastScheduledAt;
    const due = dueRun(effectiveSchedule(config,source),last,now);
    if (due) sources[source.id] = due;
  }
  return { sources, scheduledAt: Object.values(sources).sort().at(-1) ?? null };
}
function nextConfigRun(config, now = new Date()) { return config.sources.filter(s => s.enabled).map(s => nextRun(effectiveSchedule(config,s),now)).filter(Boolean).sort()[0] ?? null; }
function registrationTimes(config) { return [...new Set(config.sources.filter(s => s.enabled).flatMap(s => { const schedule = effectiveSchedule(config,s); return schedule.enabled ? schedule.times : []; }))].sort(); }
module.exports = { nextRun, dueRun, Scheduler, dueSources, nextConfigRun, registrationTimes };
