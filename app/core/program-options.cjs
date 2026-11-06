const path = require('node:path');
function validateInstallation(input, source, backup) {
  if (input == null) return null;
  if (!input || typeof input.enabled !== 'boolean' || input.keepAllReleaseFiles != null && typeof input.keepAllReleaseFiles !== 'boolean' || typeof (input.pattern ?? '') !== 'string' || input.pattern?.length > 160 || /[\\/\r\n\0]/.test(input.pattern ?? '')) throw new Error('Ungültige Programminstallation.');
  const destination = input.destination ?? '';
  const programs = input.programs ?? [];
  if (!Array.isArray(programs) || programs.length > 64 || new Set(programs).size !== programs.length || programs.some(name => typeof name !== 'string' || !name || name.length > 1024 || /^[a-z]:|^[\\/]|[\\\r\n\0]/i.test(name) || name.split('/').some(part => !part || part === '.' || part === '..'))) throw new Error('Ungültige Programmauswahl.');
  const shortcut = input.shortcut;
  if (shortcut != null && (typeof shortcut.enabled !== 'boolean' || typeof shortcut.destination !== 'string' || /[\r\n\0]/.test(shortcut.destination) || shortcut.enabled && !path.isAbsolute(shortcut.destination))) throw new Error('Bitte einen absoluten Ordner für Programmverknüpfungen wählen.');
  if (typeof destination !== 'string' || destination.includes('\0') || input.enabled && !path.isAbsolute(destination)) throw new Error('Bitte einen absoluten Programm-Zielordner wählen.');
  if (input.enabled) {
    if (source.kind !== 'repository') throw new Error('Automatische Installation ist nur für einzelne Repositories möglich.');
    if (!backup.metadata.releases) throw new Error('Für die Programminstallation müssen Release-Dateien gesichert werden.');
    for (const root of [source.destination, ...(source.additionalDestinations ?? []).map(target => target.destination)]) { const relative = path.relative(root, destination), inverse = path.relative(destination, root); if (!relative || !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) || !inverse.startsWith('..' + path.sep) && !path.isAbsolute(inverse)) throw new Error('Programmziel und Sicherungsordner müssen getrennt liegen.'); }
  }
  return { enabled: input.enabled, destination: destination ? path.resolve(destination) : '', pattern: (input.pattern ?? '').trim(), ...(input.programs != null ? { programs: [...programs].sort() } : {}), ...(input.keepAllReleaseFiles != null ? { keepAllReleaseFiles: input.keepAllReleaseFiles } : {}), ...(shortcut != null ? { shortcut: { enabled: shortcut.enabled, destination: shortcut.destination ? path.resolve(shortcut.destination) : '' } } : {}) };
}
module.exports = { validateInstallation };
