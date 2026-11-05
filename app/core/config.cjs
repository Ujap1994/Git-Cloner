const path = require('node:path');
const { providerSpec, parseHostedSource, providerKey } = require('./provider-spec.cjs');
const { normalizeSourceInput } = require('../renderer/source-input.js');

const { validateInstallation } = require('./program-options.cjs');
const { validateReleaseFilter } = require('./release-assets.cjs');

const DEFAULT_CONFIG = {
  schemaVersion: 1,
  sources: [],
  sourceGroups: [],
  schedule: { enabled: true, checksPerDay: 1, times: ['02:00'] },
  launchAtLogin: false,
  closeToTray: true,
  notifications: true,
  notificationRules: { backup: 'all', updates: true, quietHours: { enabled: false, start: '22:00', end: '07:00' } },
  checkUpdates: true,
  backup: { mode: 'snapshot', lfs: false, submodules: false, metadata: { issues: false, pullRequests: false, releases: false, wiki: false }, releaseScope: 'all', releaseArchitecture: 'all', releaseFileTypes: [], encryption: false, integrity: 'weekly', reserveMB: 512 },
  accounts: [],
  appearance: { language: 'de', theme: 'system', fontScale: 1, highContrast: false },
  execution: { concurrency: 2, smallRepoMB: 50, retries: 2, bandwidthKBps: 0, onlyOnAC: false, allowedNetworks: [] },
  setupCompleted: false,
  onDriveConnect: false,
  autoRelocate: true,
  systemSchedule: false,
  oauthClientId: ''
};

function defaults() { return structuredClone(DEFAULT_CONFIG); }

function parseSource(value, kind) {
  if (typeof value !== 'string') throw new Error('Bitte eine GitHub-Quelle angeben.');
  const input = normalizeSourceInput(value).value;
  const parts = input.split('/');
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(parts[0])) throw new Error('Ungültiger GitHub-Name.');
  if (kind === 'owner' && parts.length === 1) return input;
  if (kind === 'repository' && parts.length === 2 && /^[a-z\d._-]{1,100}$/i.test(parts[1]) && !['.', '..'].includes(parts[1])) return input;
  throw new Error(kind === 'owner' ? 'Für ein Konto nur den GitHub-Namen eingeben.' : 'Repository als konto/repository eingeben.');
}

function validateConfig(input) {
  if (!input || typeof input !== 'object' || input.schemaVersion !== 1) throw new Error('Unbekanntes Einstellungsformat.');
  if (!Array.isArray(input.sources) || input.sources.length > 100) throw new Error('Maximal 100 Quellen sind erlaubt.');
  const sourceGroups = validateSourceGroups(input.sourceGroups ?? []);
  const groupIds = new Set(sourceGroups.map(group => group.id));
  const ids = new Set();
  const names = new Set();
  const sources = input.sources.map(source => {
    if (!source || !['owner', 'repository'].includes(source.kind)) throw new Error('Ungültiger Quellentyp.');
    if (typeof source.id !== 'string' || !/^[a-z\d-]{1,64}$/i.test(source.id) || ids.has(source.id)) throw new Error('Ungültige oder doppelte Quellen-ID.');
    ids.add(source.id);
    if (source.favorite !== undefined && typeof source.favorite !== 'boolean') throw new Error('Ungültiger Favoritenstatus.');
    if (source.groupId != null && !groupIds.has(source.groupId)) throw new Error('Die zugewiesene Quellengruppe fehlt.');
    const spec = providerSpec(source), value = parseHostedSource(source.value, source.kind,spec);
    const key = `${providerKey(spec)}:${source.kind}:${value.toLowerCase()}`;
    if (names.has(key)) throw new Error('Diese Quelle ist bereits eingetragen.');
    names.add(key);
    if (typeof source.destination !== 'string' || !path.isAbsolute(source.destination) || source.destination.includes('\0')) throw new Error('Bitte einen absoluten Zielordner auswählen.');
    if (typeof source.enabled !== 'boolean') throw new Error('Ungültiger Quellenstatus.');
    if (source.volumeId !== undefined && (typeof source.volumeId !== 'string' || !/^[a-f\d-]{36}$/.test(source.volumeId))) throw new Error('Ungültige Laufwerkskennung.');
    const filters = validateFilters(source.filters);
    const accountId = source.accountId ?? 'default';
    if (typeof accountId !== 'string' || !/^[a-z\d-]{1,64}$/i.test(accountId)) throw new Error('Ungültiges GitHub-Konto.');
    const additionalDestinations = (source.additionalDestinations ?? []).map(validateTarget);
    if (additionalDestinations.length > 9) throw new Error('Maximal zehn Ziele pro Quelle.');
    const volumeHint = validateVolumeHint(source.volumeHint, source.destination);
    const installation = validateInstallation(source.installation, { ...source, additionalDestinations }, validateBackup(source.backup ?? input.backup ?? DEFAULT_CONFIG.backup));
    return { installation, id: source.id, kind: source.kind, value, ...(spec.provider!=='github'?spec:{}), destination: path.resolve(source.destination), enabled: source.enabled, ...(source.volumeId ? { volumeId: source.volumeId } : {}), ...(volumeHint ? { volumeHint } : {}), accountId, filters, additionalDestinations, backup: source.backup == null ? null : validateBackup(source.backup), schedule: source.schedule == null ? null : validateSchedule(source.schedule), groupId: source.groupId ?? null, favorite: source.favorite ?? false };
  });
  const result = { schemaVersion: 1, sources, sourceGroups, schedule: validateSchedule(input.schedule) };
  for (const key of ['launchAtLogin', 'closeToTray', 'notifications', 'checkUpdates']) {
    if (typeof input[key] !== 'boolean') throw new Error(`Ungültige Einstellung: ${key}`);
    result[key] = input[key];
  }
  const rules = { ...DEFAULT_CONFIG.notificationRules, ...input.notificationRules, quietHours: { ...DEFAULT_CONFIG.notificationRules.quietHours, ...input.notificationRules?.quietHours } };
  if (!['all','errors','changes','none'].includes(rules.backup) || typeof rules.updates !== 'boolean' || typeof rules.quietHours.enabled !== 'boolean' || [rules.quietHours.start,rules.quietHours.end].some(t => typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('Ungültige Benachrichtigungsregel.');
  if (rules.quietHours.enabled && rules.quietHours.start === rules.quietHours.end) throw new Error('Beginn und Ende der Ruhezeit müssen verschieden sein.');
  result.notificationRules = { backup: rules.backup, updates: rules.updates, quietHours: { enabled: rules.quietHours.enabled, start: rules.quietHours.start, end: rules.quietHours.end } };
  result.backup = validateBackup(input.backup);
  const accounts = input.accounts ?? [];
  if (!Array.isArray(accounts) || accounts.length > 20) throw new Error('Maximal 20 GitHub-Konten.');
  const accountIds = new Set(['default']);
  result.accounts = accounts.map(account => {
    if (!account || typeof account.id !== 'string' || !/^[a-z\d-]{1,64}$/i.test(account.id) || accountIds.has(account.id) || typeof account.label !== 'string' || !account.label.trim() || account.label.length > 80) throw new Error('Ungültiges oder doppeltes Konto.');
    accountIds.add(account.id);
    const spec=providerSpec(account);
    if(account.username!==undefined&&(typeof account.username!=='string'||!/^[a-z\d_.@+-]{1,100}$/i.test(account.username)))throw new Error('Ungültiger Git-Benutzername.');
    if(spec.provider==='forgejo'&&!account.username)throw new Error('Für Forgejo-Zugangsdaten den eigenen Benutzernamen angeben.');
    return { id: account.id, label: account.label.trim(), ...(spec.provider!=='github'?spec:{}), ...(account.username?{username:account.username}:{}) };
  });
  if (sources.some(source => !accountIds.has(source.accountId))) throw new Error('Ein zugewiesenes GitHub-Konto fehlt.');
  for(const source of sources)if(source.accountId!=='default'&&providerKey(result.accounts.find(a=>a.id===source.accountId))!==providerKey(source))throw new Error('Zugangsdaten und Quelle müssen denselben Anbieter und Server verwenden.');
  const appearance = { ...DEFAULT_CONFIG.appearance, ...input.appearance };
  if (!['de', 'en'].includes(appearance.language) || !['system', 'light', 'dark'].includes(appearance.theme) || ![1, 1.15, 1.3].includes(appearance.fontScale) || typeof appearance.highContrast !== 'boolean') throw new Error('Ungültige Darstellung.');
  result.appearance = { language: appearance.language, theme: appearance.theme, fontScale: appearance.fontScale, highContrast: appearance.highContrast };
  const execution = { ...DEFAULT_CONFIG.execution, ...input.execution };
  for (const [key, min, max] of [['concurrency',1,4],['smallRepoMB',1,1024],['retries',0,5],['bandwidthKBps',0,1048576]]) if (!Number.isInteger(execution[key]) || execution[key] < min || execution[key] > max) throw new Error('Ungültige Leistungs- oder Netzwerkeinstellung.');
  if (typeof execution.onlyOnAC !== 'boolean' || !Array.isArray(execution.allowedNetworks) || execution.allowedNetworks.length > 32 || execution.allowedNetworks.some(s => typeof s !== 'string' || !s.trim() || s.length > 32 || /[\r\n\0]/.test(s))) throw new Error('Ungültige Netzwerkregel.');
  result.execution = { concurrency: execution.concurrency, smallRepoMB: execution.smallRepoMB, retries: execution.retries, bandwidthKBps: execution.bandwidthKBps, onlyOnAC: execution.onlyOnAC, allowedNetworks: [...new Set(execution.allowedNetworks.map(s => s.trim()))] };
  if (input.setupCompleted !== undefined && typeof input.setupCompleted !== 'boolean') throw new Error('Ungültiger Einrichtungsstatus.');
  result.setupCompleted = input.setupCompleted ?? false;
  for (const key of ['onDriveConnect', 'systemSchedule']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('Ungültige Zeitplanoption.');
    result[key] = input[key] ?? false;
  }
  if (input.autoRelocate !== undefined && typeof input.autoRelocate !== 'boolean') throw new Error('Ungültige Laufwerksoption.');
  result.autoRelocate = input.autoRelocate ?? true;
  if (typeof (input.oauthClientId ?? '') !== 'string' || !/^[a-z\d._-]{0,100}$/i.test(input.oauthClientId ?? '')) throw new Error('Ungültige OAuth-Client-ID.');
  result.oauthClientId = input.oauthClientId ?? '';
  return result;
}
function validateSourceGroups(groups) {
  if (!Array.isArray(groups) || groups.length > 30) throw new Error('Maximal 30 Quellengruppen sind erlaubt.');
  const ids = new Set(), names = new Set();
  return groups.map(group => {
    if (!group || typeof group.id !== 'string' || !/^[a-z\d-]{1,64}$/i.test(group.id) || ids.has(group.id) || typeof group.name !== 'string') throw new Error('Ungültige oder doppelte Quellengruppe.');
    const name = group.name.trim().normalize('NFC');
    if (!name || name.length > 60 || Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || names.has(name.toLocaleLowerCase())) throw new Error('Gruppennamen müssen eindeutig sein und 1 bis 60 Zeichen enthalten.');
    ids.add(group.id); names.add(name.toLocaleLowerCase()); return { id: group.id, name };
  });
}
function validateBackup(input) {
  const backup = { ...DEFAULT_CONFIG.backup, ...input, metadata: { ...DEFAULT_CONFIG.backup.metadata, ...input?.metadata } };
  if (!['snapshot', 'mirror'].includes(backup.mode) || !['always', 'weekly', 'manual'].includes(backup.integrity)) throw new Error('Ungültiger Sicherungsmodus.');
  if (!['all','system'].includes(backup.releaseScope)) throw new Error('Ungültige Auswahl für Release-Dateien.');
  for (const key of ['lfs', 'submodules', 'encryption']) if (typeof backup[key] !== 'boolean') throw new Error('Ungültige Sicherungsoption.');
  if (backup.mode === 'mirror' && backup.submodules) throw new Error('Submodule benötigen den Modus Arbeitskopie.');
  if (!Number.isInteger(backup.reserveMB) || backup.reserveMB < 64 || backup.reserveMB > 1048576) throw new Error('Speicherreserve muss zwischen 64 und 1048576 MB liegen.');
  const metadata = {};
  for (const key of ['issues', 'pullRequests', 'releases', 'wiki']) {
    if (typeof backup.metadata[key] !== 'boolean') throw new Error('Ungültige Metadatenoption.');
    metadata[key] = backup.metadata[key];
  }
  return { ...validateReleaseFilter(backup), mode: backup.mode, lfs: backup.lfs, submodules: backup.submodules, encryption: backup.encryption, integrity: backup.integrity, reserveMB: backup.reserveMB, metadata, releaseScope: backup.releaseScope };
}
function effectiveBackup(config, source) { return { ...(source.backup ?? config.backup ?? DEFAULT_CONFIG.backup), encryptionKeyId: config.backup?.encryptionKeyId }; }

function validateTarget(target) {
  if (!target || typeof target.id !== 'string' || !/^[a-z\d-]{1,64}$/i.test(target.id) || typeof target.destination !== 'string' || !path.isAbsolute(target.destination) || target.destination.includes('\0')) throw new Error('Ungültiges zusätzliches Sicherungsziel.');
  if (target.volumeId !== undefined && !/^[a-f\d-]{36}$/.test(target.volumeId)) throw new Error('Ungültige Laufwerkskennung.');
  const volumeHint = validateVolumeHint(target.volumeHint, target.destination);
  return { id: target.id, destination: path.resolve(target.destination), ...(target.volumeId ? { volumeId: target.volumeId } : {}), ...(volumeHint ? { volumeHint } : {}) };
}
function validateVolumeHint(input, destination) {
  if (input == null) return null;
  if (typeof input.root !== 'string' || !path.isAbsolute(input.root) || input.root.includes('\0') || typeof input.relative !== 'string' || input.relative.length > 4096 || path.isAbsolute(input.relative) || input.relative.split(/[\\/]/).some(p => p === '..' || p === '.') || input.relative.includes('\0')) throw new Error('Ungültiger Laufwerkspfad.');
  const relative = path.relative(input.root,destination).split(path.sep).join('/');
  if (relative !== input.relative || relative.startsWith('../')) throw new Error('Laufwerkskennung und Zielordner passen nicht zusammen.');
  if (input.canonical !== undefined && (typeof input.canonical !== 'string' || !path.isAbsolute(input.canonical) || input.canonical.includes('\0'))) throw new Error('Ungültiger Laufwerkspfad.');
  return { root: path.resolve(input.root), relative, ...(input.canonical ? {canonical:path.resolve(input.canonical)} : {}) };
}
function validateSchedule(schedule) {
  if (!schedule || typeof schedule.enabled !== 'boolean' || !Number.isInteger(schedule.checksPerDay) || schedule.checksPerDay < 1 || schedule.checksPerDay > 24) throw new Error('Bitte 1 bis 24 Prüfungen pro Tag auswählen.');
  if (!Array.isArray(schedule.times) || schedule.times.length !== schedule.checksPerDay || schedule.times.some(t => typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || new Set(schedule.times).size !== schedule.times.length) throw new Error('Für jede Prüfung eine eigene, gültige Uhrzeit eintragen.');
  return { enabled: schedule.enabled, checksPerDay: schedule.checksPerDay, times: [...schedule.times].sort() };
}
function effectiveSchedule(config, source) { const own = source.schedule ?? config.schedule; return { ...own, enabled: config.schedule.enabled && own.enabled }; }
function validateFilters(input = {}) {
  const result = { includeForks: input.includeForks ?? true, includeArchived: input.includeArchived ?? true };
  if (typeof result.includeForks !== 'boolean' || typeof result.includeArchived !== 'boolean') throw new Error('Ungültiger Repository-Filter.');
  for (const key of ['include', 'exclude']) {
    const patterns = input[key] ?? [];
    if (!Array.isArray(patterns) || patterns.length > 100 || patterns.some(p => typeof p !== 'string' || !p.trim() || p.length > 120 || !/^[a-z\d._/*?-]+$/i.test(p))) throw new Error('Filter erlauben Namen und die Platzhalter * und ?.');
    result[key] = [...new Set(patterns.map(p => p.trim()))];
  }
  return result;
}

module.exports = { defaults, validateConfig, parseSource, validateFilters, validateBackup, effectiveBackup, validateSchedule, effectiveSchedule };
