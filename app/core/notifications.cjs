function quietNow(hours, now = new Date()) {
  if (!hours?.enabled) return false;
  const minutes = value => {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  };
  const start = minutes(hours.start),
    end = minutes(hours.end),
    current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}
function notificationAllowed(config, kind, result = {}, now = new Date()) {
  if (!config.notifications || quietNow(config.notificationRules?.quietHours, now)) return false;
  if (kind === 'update') return config.notificationRules?.updates !== false;
  const rule = config.notificationRules?.backup ?? 'all';
  const errors = result.errorCount ?? result.results?.filter(r => r.status === 'error').length ?? 0;
  const changed =
    result.changedCount ??
    result.results?.filter(r => ['cloned', 'updated', 'repaired'].includes(r.status)).length ??
    0;
  const total = result.resultCount ?? result.results?.length ?? 0;
  return (
    total > 0 &&
    (rule === 'all' || (rule === 'errors' && errors > 0) || (rule === 'changes' && (errors > 0 || changed > 0)))
  );
}
module.exports = { quietNow, notificationAllowed };
