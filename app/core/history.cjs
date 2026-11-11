const { createHash } = require('node:crypto');
const { redactLogs } = require('./transfer.cjs');
const ids = new WeakMap();
function historyId(run) {
  if (run.id) return run.id;
  if (!ids.has(run))
    ids.set(
      run,
      createHash('sha256')
        .update(JSON.stringify([run.startedAt, run.finishedAt, run.trigger, run.resultCount, run.results]))
        .digest('hex')
        .slice(0, 24)
    );
  return ids.get(run);
}
function queryHistory(history, input = {}) {
  const { query = '', start = '', end = '', status = 'all', offset = 0, limit = 25 } = input;
  if (
    typeof query !== 'string' ||
    query.length > 200 ||
    !['all', 'errors', 'changes'].includes(status) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error('Ungültiger Verlaufsfilter.');
  for (const day of [start, end])
    if (
      typeof day !== 'string' ||
      (day &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          !Number.isFinite(Date.parse(day + 'T00:00:00Z')) ||
          new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day))
    )
      throw new Error('Ungültiger Zeitraum.');
  if (start && end && start > end) throw new Error('Der Beginn muss vor dem Ende liegen.');
  const term = query.toLowerCase(),
    matches = history.filter(run => {
      const date = new Date(run.finishedAt);
      const day = Number.isNaN(date.getTime())
        ? ''
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return (
        (!start || day >= start) &&
        (!end || day <= end) &&
        (status !== 'errors' || (run.errorCount ?? run.results?.filter(r => r.status === 'error').length ?? 0) > 0) &&
        (status !== 'changes' ||
          (run.changedCount ??
            run.results?.filter(r => ['cloned', 'updated', 'repaired'].includes(r.status)).length ??
            0) > 0) &&
        (!term ||
          (run.results ?? []).some(result =>
            `${result.fullName ?? ''} ${result.provider ?? ''}`.toLowerCase().includes(term)
          ))
      );
    });
  return {
    total: matches.length,
    offset,
    limit,
    runs: matches.slice(offset, offset + limit).map(run => ({
      ...run,
      id: historyId(run),
      results: (run.results ?? [])
        .filter(result => !term || `${result.fullName ?? ''} ${result.provider ?? ''}`.toLowerCase().includes(term))
        .slice(0, 5),
      detailCount: run.results?.length ?? 0
    })),
    retainedRuns: history.length
  };
}
function exportHistory(history, { ids = [], ...query } = {}) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || id.length > 64))
    throw new Error('Ungültige Verlaufsauswahl.');
  const chosen = ids.length ? ids : queryHistory(history, { ...query, offset: 0, limit: 100 }).runs.map(run => run.id),
    selected = history.filter(run => chosen.includes(historyId(run)));
  return redactLogs(selected);
}
function historyDetails(history, { id, offset = 0, query = '' } = {}) {
  if (
    typeof id !== 'string' ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    typeof query !== 'string' ||
    query.length > 200
  )
    throw new Error('Ungültige Verlaufsseite.');
  const run = history.find(item => historyId(item) === id);
  if (!run) throw new Error('Der Lauf ist nicht mehr im gespeicherten Verlauf.');
  const results = (run.results ?? []).filter(result =>
    `${result.fullName ?? ''} ${result.provider ?? ''}`.toLowerCase().includes(query.toLowerCase())
  );
  return {
    id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    total: results.length,
    truncated: run.truncatedResults ?? 0,
    offset,
    results: results.slice(offset, offset + 50)
  };
}
module.exports = { historyId, queryHistory, exportHistory, historyDetails };
