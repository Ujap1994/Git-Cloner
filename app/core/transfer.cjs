const { validateConfig } = require('./config.cjs');
function exportSettings(config) { return { format: 'git-cloner-settings', version: 1, config: validateConfig(config) }; }
function importSettings(document) {
  if (document?.format !== 'git-cloner-settings' || document.version !== 1) throw new Error('Ungültige Einstellungsdatei.');
  const config = validateConfig(document.config);
  for (const source of config.sources) { if(source.installation) { source.installation.enabled=false; if(source.installation.shortcut)source.installation.shortcut.enabled=false; } delete source.volumeId; delete source.volumeHint; for (const target of source.additionalDestinations) { delete target.volumeId; delete target.volumeHint; } }
  // OS registrations belong to this machine and are never imported implicitly.
  config.launchAtLogin = false; config.systemSchedule = false;
  return config;
}
function redactLogs(history) {
  const ids = new Map();
  const anonymize = name => { if (!ids.has(name)) ids.set(name, `repository-${String(ids.size + 1).padStart(3, '0')}`); return ids.get(name); };
  return { format: 'git-cloner-redacted-log', version: 1, runs: history.map(run => ({
    startedAt: run.startedAt, finishedAt: run.finishedAt, trigger: run.trigger, resultCount: run.resultCount ?? run.results.length, errorCount: run.errorCount ?? run.results.filter(r => r.status === 'error').length, truncatedResults: run.truncatedResults ?? 0, durationMs: run.durationMs ?? null, receivedBytes: run.receivedBytes ?? null, backupBytes: run.backupBytes ?? null,
    results: run.results.map(result => ({ repository: anonymize(result.fullName), status: result.status, encrypted: Boolean(result.encrypted), mode: result.mode, checkedAt: result.checkedAt, ...(result.installation?{installation:{status:result.installation.status,...(result.installation.shortcuts?{shortcuts:{status:result.installation.shortcuts.status}}:{}),...(result.installation.status==='error'?{message:'Program installation failed; personal paths and raw error text removed.'}:{})}}:{}), ...(result.status === 'error' ? { message: 'Operation failed; personal paths and raw error text removed.' } : {}) }))
  })) };
}
module.exports = { exportSettings, importSettings, redactLogs };
