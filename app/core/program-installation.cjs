const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { readJson, writeJson } = require('./store.cjs');
const { safeDirectory, checkSpace } = require('./destinations.cjs');
const { hashFile } = require('./integrity.cjs');
const { repositoryParts, providerKey } = require('./provider-spec.cjs');
const { selectProgram } = require('./program-select.cjs');
const { RestoreBrowser } = require('./selective-restore.cjs');
const { RELEASE_OWNER } = require('./release-layout.cjs');
const { preparePrograms, inspectPrograms } = require('./program-content.cjs');
const { acquireLease } = require('./lease.cjs');
const { validateInstallation } = require('./program-options.cjs');
const runFile = promisify(execFile), MARKER = '.git-cloner-program.json';
// Installer tools never need input; a closed stdin makes interactive prompts fail at once instead of waiting for the timeout.
function execute(file, args, options) { const pending = runFile(file, args, options); pending.child?.stdin?.end(); return pending; }
async function owned(directory, identity) {
  const stat = await fs.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Ein fremder Programmordner bleibt erhalten.');
  const file = path.join(directory, MARKER), info = await fs.lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unbekannte Programmzuordnung.');
  const marker = await readJson(file);
  if (marker.format !== 'git-cloner-program' || marker.identity !== identity || !Array.isArray(marker.files) || marker.files.some(name => typeof name !== 'string' || path.basename(name) !== name || /[\\/\0]/.test(name))) throw new Error('Eine fremde Installation wird nicht ersetzt.');
  if ((await fs.readdir(directory)).some(name => name !== MARKER && !marker.files.includes(name))) throw new Error('Zusätzliche Dateien im Programmordner bleiben erhalten. Bitte getrennt ablegen.');
  for (const name of marker.files) { const entry = await fs.lstat(path.join(directory, name)); if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) throw new Error('Ein fremder Programmpfad bleibt erhalten.'); }
  return marker;
}
async function exists(file) { try { await fs.lstat(file); return true; } catch (error) { if (error.code !== 'ENOENT') throw error; return false; } }
class ProgramInstaller {
  constructor({ platform = process.platform, arch = process.arch, run = execute } = {}) { Object.assign(this, { platform, arch, run }); }
  async ensureNotRunning(target, current) {
    if(this.platform!=='darwin')return;
    const {stdout}=await this.run('/bin/ps',['-U',String(process.getuid()),'-o','pid=,command='],{timeout:10000,maxBuffer:4*1048576});
    const prefixes=(current.programs || [{executable:current.executable}]).map(item=>path.join(target,item.executable,'Contents','MacOS')+path.sep);
    if(stdout.split('\n').some(line=>prefixes.some(prefix=>line.trim().replace(/^\d+\s+/, '').startsWith(prefix)))){const error=new Error('Das Programm läuft noch. Die Installation wird bei einer späteren Prüfung erneut versucht.');error.code='PROGRAM_RUNNING';throw error;}
  }
  async prepare(asset, output) { return (await preparePrograms(asset, output, [], this))[0].executable; }
  async openRelease({ source, record, git, passphrase }) {
    if (!record.releaseInfo?.fileCount) throw new Error('Keine gesicherte Release-Datei für die Programminstallation vorhanden.');
    const browser = new RestoreBrowser({ git });
    try {
      const session = await browser.open({ record, passphrase, content: 'releases' }), opened = browser.session(session.id), ownerFile = path.join(opened.filesRoot, RELEASE_OWNER);
      const manifest = await readJson(path.join(require('./integrity.cjs').controlDirectory(opened.source, opened.marker.mode), 'git-cloner-manifest.json'));
      const ownerPath = path.relative(opened.source, ownerFile).split(path.sep).join('/');
      if (await hashFile(ownerFile) !== manifest.entries.find(entry => entry.path === ownerPath)?.sha256) throw new Error('Die Release-Dateizuordnung ist beschädigt.');
      const info = await readJson(ownerFile), chosen = selectProgram(info.files, this.platform, this.arch, source.installation?.pattern || '');
      if (typeof chosen.storedName !== 'string' || path.basename(chosen.storedName) !== chosen.storedName || /[\\/\0]/.test(chosen.storedName)) throw new Error('Unsichere Release-Datei.');
      const asset = path.join(opened.filesRoot, chosen.storedName), entry = opened.entries.find(item => item.path === chosen.storedName), stat = await fs.lstat(asset);
      if (!stat.isFile() || stat.isSymbolicLink() || !entry?.sha256 || await hashFile(asset) !== entry.sha256) throw new Error('Die Programmdatei hat ihre Integritätsprüfung nicht bestanden.');
      return { browser, chosen, asset, entry, stat };
    } catch (error) { await browser.closeAll(); throw error; }
  }
  async inspect(input) {
    const { browser, chosen, asset, entry } = await this.openRelease(input);
    try { return { asset: chosen.name, tag: input.record.releaseInfo.tag, digest: entry.sha256, candidates: await inspectPrograms({ ...chosen, file: asset }, this) }; }
    finally { await browser.closeAll(); }
  }
  async install({ source, record, git, passphrase, onProgress = () => {} }) {
    if (!source.installation?.enabled) return null;
    if(!record.releaseInfo?.fileCount)throw new Error('Keine gesicherte Release-Datei für die Programminstallation vorhanden.');
    let browser, stage, stageMarker, release, cleanupStage = false, cleanupMarker = false;
    try {
      onProgress({ status: 'installing', fullName: record.fullName });
      const opened = await this.openRelease({ source, record, git, passphrase }); browser = opened.browser;
      const { chosen, asset, entry, stat } = opened, selection = source.installation.programs || [];
      const root = await fs.realpath(source.installation.destination), parts = repositoryParts(source, record.fullName), name = parts.pop();
      const namespace = source.provider && source.provider !== 'github' ? [source.provider, createHash('sha256').update(source.server).digest('hex').slice(0, 12)] : [];
      for (const backup of [source.destination, ...(source.additionalDestinations ?? []).map(target => target.destination)]) {
        const canonical = await fs.realpath(backup).catch(() => path.resolve(backup));
        if (root === canonical || root.startsWith(canonical + path.sep) || canonical.startsWith(root + path.sep)) throw new Error('Programmziel und Sicherungsordner müssen auch nach Auflösen von Links getrennt liegen.');
      }
      const parent = await safeDirectory(root, [...namespace, ...parts], true), identity = `${providerKey(source)}:${record.fullName.toLowerCase()}`, target = path.join(parent, name), previous = path.join(parent, `.${name}.gc-install-previous`);
      stage = path.join(parent, `.${name}.gc-install-stage`); stageMarker = stage + '.json'; release = await acquireLease(parent);
      if (await exists(previous)) { await owned(previous, identity); if (await exists(target)) { await owned(target, identity); await fs.rm(previous, { recursive: true }); } else await fs.rename(previous, target); }
      if (await exists(stageMarker)) { const markerStat = await fs.lstat(stageMarker); if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('Eine fremde temporäre Programmkennung bleibt erhalten.'); const owner = await readJson(stageMarker); if (owner.identity !== identity || !/^[a-f\d-]{36}$/.test(owner.id)) throw new Error('Fremde Installationsdateien bleiben erhalten.'); if (await exists(stage)) { const stat = await fs.lstat(stage); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Ein fremder Installationspfad bleibt erhalten.'); await fs.rm(stage, { recursive: true }); } await fs.rm(stageMarker); }
      else if (await exists(stage)) throw new Error('Ein fremder temporärer Programmordner bleibt erhalten.');
      const current = await exists(target) ? await owned(target, identity) : null;
      if (current?.sha256 === entry.sha256 && current.tag === record.releaseInfo.tag && JSON.stringify(current.selection || []) === JSON.stringify(selection)) {
        const programs = current.programs || [{ key: current.executable, name: path.basename(current.executable).replace(/\.(app|exe|AppImage)$/i, ''), executable: current.executable, executableHash: current.executableHash }];
        let valid = programs.length > 0;
        for (const item of programs) {
          const executable = path.resolve(target, item.executable);
          if (!executable.startsWith(target + path.sep)) throw new Error('Ungültiger gespeicherter Programmpfad.');
          try { if (this.platform === 'darwin') await this.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', executable], { timeout: 120000, maxBuffer: 1048576 }); else if (!item.executableHash || await hashFile(executable) !== item.executableHash) valid = false; }
          catch (_error) { valid = false; }
        }
        if (valid) return { status: 'current', tag: current.tag, destination: target, executable: path.join(target, programs[0].executable), programs: programs.map(item => ({ ...item, executable: path.join(target, item.executable) })) };
      }
      if(current)await this.ensureNotRunning(target,current);
      await checkSpace(root, Math.max(stat.size * 4, 64 * 1048576), 64);
      await writeJson(stageMarker, { identity, id: randomUUID() }); cleanupMarker = true; await fs.mkdir(stage, { mode: 0o700 }); cleanupStage = true;
      const programs = await preparePrograms({ ...chosen, file: asset }, stage, selection, this);
      for (const item of programs) item.executableHash = this.platform === 'darwin' ? null : await hashFile(path.join(stage, item.executable));
      const executable = programs[0].executable, marker = { format: 'git-cloner-program', version: 2, identity, tag: record.releaseInfo.tag, asset: chosen.name, sha256: entry.sha256, selection, programs, executable, files: await fs.readdir(stage), executableHash: programs[0].executableHash, installedAt: new Date().toISOString() };
      await writeJson(path.join(stage, MARKER), marker);
      if (current) { await owned(target, identity); await this.ensureNotRunning(target, current); await fs.rename(target, previous); }
      try { await fs.rename(stage, target); stage = null; } catch (error) { if (current && !await exists(target)) await fs.rename(previous, target); throw error; }
      if (current) await fs.rm(previous, { recursive: true });
      return { status: 'installed', tag: marker.tag, destination: target, executable: path.join(target, executable), programs: programs.map(item => ({ ...item, executable: path.join(target, item.executable) })), installedAt: marker.installedAt };
    } finally { if (stage && cleanupStage) await fs.rm(stage, { recursive: true, force: true }).catch(() => {}); if (stageMarker && cleanupMarker) await fs.rm(stageMarker, { force: true }).catch(() => {}); await release?.(); await browser?.closeAll(); }
  }
}
module.exports = { ProgramInstaller, validateInstallation, selectProgram, owned };
