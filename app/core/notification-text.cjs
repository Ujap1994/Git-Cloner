// Notification texts are built here so they can be tested without Electron. Program lines name the program and the
// version, because "10 results, 0 errors" does not say what actually changed on the computer.
const MAX_LINES = 4;
function programName(item) {
  return item.installation?.programs?.[0]?.name || item.fullName?.split('/').pop() || 'Git Cloner';
}
function programLines(results, en) {
  const lines = [];
  for (const item of results ?? []) {
    const installation = item.installation,
      name = programName(item);
    if (installation?.status === 'installed')
      lines.push(en ? `${name} ${installation.tag} installed.` : `${name} ${installation.tag} installiert.`);
    else if (installation?.status === 'available')
      lines.push(
        en
          ? `${name} ${installation.latestTag} is ready to install.`
          : `${name} ${installation.latestTag} ist bereit zur Installation.`
      );
    else if (installation?.status === 'waiting')
      lines.push(
        en
          ? `${name} ${installation.latestTag} waits until the program is closed.`
          : `${name} ${installation.latestTag} wartet, bis das Programm beendet ist.`
      );
  }
  return lines;
}
function limited(lines, en) {
  if (lines.length <= MAX_LINES) return lines;
  const rest = lines.length - MAX_LINES + 1;
  return [...lines.slice(0, MAX_LINES - 1), en ? `… and ${rest} more.` : `… und ${rest} weitere.`];
}
function backupNotification(result, language) {
  const en = language === 'en',
    failures = result.errorCount ?? 0,
    changed = result.changedCount ?? 0,
    total = result.resultCount ?? result.results?.length ?? 0;
  const failed = (result.results ?? [])
    .filter(item => item.status === 'error' || item.installation?.status === 'error')
    .map(item => item.fullName)
    .filter(Boolean);
  const lines = [
    en
      ? `${total} checked · ${changed} changed · ${failures} ${failures === 1 ? 'error' : 'errors'}`
      : `${total} geprüft · ${changed} geändert · ${failures} Fehler`,
    ...programLines(result.results, en),
    ...(failed.length
      ? [(en ? 'Review: ' : 'Prüfen: ') + failed.slice(0, 2).join(', ') + (failed.length > 2 ? ' …' : '')]
      : [])
  ];
  return {
    title: failures
      ? en
        ? 'Git Cloner · Review backup'
        : 'Git Cloner · Sicherung prüfen'
      : en
        ? 'Git Cloner · Check complete'
        : 'Git Cloner · Prüfung abgeschlossen',
    body: limited(lines, en).join('\n')
  };
}
function programNotification(results, language) {
  const en = language === 'en',
    lines = programLines(results, en);
  return lines.length
    ? {
        title: en ? 'Git Cloner · Program update' : 'Git Cloner · Programm-Update',
        body: limited(lines, en).join('\n')
      }
    : null;
}
function reminderNotification({ pausedAt, completed, total }, language, now = Date.now()) {
  const en = language === 'en',
    hours = Math.max(1, Math.round((now - Date.parse(pausedAt)) / 3600000));
  return {
    title: en ? 'Git Cloner · Backup still paused' : 'Git Cloner · Sicherung weiterhin pausiert',
    body: en
      ? `Paused for ${hours} ${hours === 1 ? 'hour' : 'hours'}, ${completed} of ${total} done. Scheduled backups wait until you resume.`
      : `Seit ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'} pausiert, ${completed} von ${total} erledigt. Geplante Sicherungen warten, bis du fortsetzt.`
  };
}
module.exports = { backupNotification, programNotification, reminderNotification, programLines };
