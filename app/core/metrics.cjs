function dashboard(repositories, history, disks = [], now = Date.now()) {
  const records = Object.values(repositories),
    valid = records.filter(r => r.commit);
  const overdue = valid.filter(r => !r.checkedAt || now - Date.parse(r.checkedAt) > 48 * 3600000).length;
  const errors = records.filter(
    r =>
      r.status === 'error' ||
      r.verificationStatus === 'error' ||
      r.installation?.status === 'error' ||
      r.installation?.shortcuts?.status === 'error'
  ).length;
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() - 6 + i);
    date.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    const runs = history.filter(
      run => Date.parse(run.finishedAt) >= date.getTime() && Date.parse(run.finishedAt) < end.getTime()
    );
    return {
      day: date.toISOString(),
      runs: runs.length,
      receivedBytes: runs.reduce((sum, r) => sum + (r.receivedBytes || 0), 0),
      durationMs: runs.reduce((sum, r) => sum + (r.durationMs || 0), 0),
      errors: runs.reduce((sum, r) => sum + (r.errorCount ?? r.results.filter(r => r.status === 'error').length), 0)
    };
  });
  return {
    updatedAt: new Date(now).toISOString(),
    backupBytes: valid.reduce((sum, r) => sum + (r.bytes || 0), 0),
    copies: valid.length,
    overdue,
    errors,
    days,
    disks
  };
}
module.exports = { dashboard };
