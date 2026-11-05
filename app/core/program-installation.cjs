const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { readJson, writeJson } = require('./store.cjs');
const { safeDirectory, checkSpace } = require('./destinations.cjs');
const { hashFile } = require('./integrity.cjs');
const { repositoryParts, providerKey } = require('./provider-spec.cjs');
const { wildcard } = require('./filters.cjs');
const { assetPlatform, assetArchitecture, assetType } = require('./release-assets.cjs');
const { RestoreBrowser } = require('./selective-restore.cjs');
const { RELEASE_OWNER } = require('./release-layout.cjs');
const { extractZip, validateTree } = require('./program-archives.cjs');
const { acquireLease } = require('./lease.cjs');
const { validateInstallation } = require('./program-options.cjs');
const execute = promisify(execFile), MARKER = '.git-cloner-program.json';
function selectProgram(files, platform = process.platform, arch = process.arch, pattern = '') {
  const allowed = platform === 'darwin' ? ['dmg', 'zip'] : platform === 'win32' ? ['exe', 'zip'] : platform === 'linux' ? ['appimage'] : [];
  const candidates = files.filter(file => !/\.(sha(?:256|512)?|sig|asc|checksum)$/i.test(file.name) && (!pattern || wildcard(pattern, file.name)) && assetPlatform(file.name).platforms.includes(platform) && (!assetArchitecture(file.name).length || assetArchitecture(file.name).includes(arch)) && allowed.includes(assetType(file.name)) && (platform !== 'win32' || assetType(file.name) === 'zip' || /portable/i.test(file.name)));
  const score = file => allowed.indexOf(assetType(file.name)) * 10 + (assetArchitecture(file.name).length === 1 ? 0 : assetArchitecture(file.name).length ? 1 : 2);
  candidates.sort((a, b) => score(a) - score(b));
  if (!candidates.length) throw new Error('Kein installierbares Programm für dieses System gefunden. Unterstützt: macOS DMG/App-ZIP, Windows Portable-EXE/ZIP, Linux AppImage.');
  if (candidates[1] && score(candidates[0]) === score(candidates[1])) throw new Error('Mehrere Programme passen. Bitte den Release-Dateinamen in der Quelle genauer eingrenzen.');
  return candidates[0];
}
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
async function findApplications(root, platform, depth = 0) {
  const result = []; if (depth > 3) return result;
  for (const name of await fs.readdir(root)) { if (name.startsWith('.') || name === '__MACOSX') continue; const file = path.join(root, name), stat = await fs.lstat(file); if (stat.isSymbolicLink()) continue; if (platform === 'darwin' && stat.isDirectory() && name.endsWith('.app') || platform === 'win32' && stat.isFile() && /\.exe$/i.test(name) && !/unins|setup|install|crashpad|helper/i.test(name)) result.push(file); else if (stat.isDirectory()) result.push(...await findApplications(file, platform, depth + 1)); }
  return result;
}
async function validatePortableBinary(file, platform, arch) {
        const bytes = Buffer.alloc(64), handle = await fs.open(file, 'r'); try { await handle.read(bytes); } finally { await handle.close(); }
        if (platform === 'linux' && (!bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || bytes.toString('ascii', 8, 10) !== 'AI') || platform === 'win32' && bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Die Release-Datei besitzt kein passendes Programmformat.');
        if (platform === 'linux') {
          const machine = bytes.readUInt16LE(18), expected = { x64: 62, arm64: 183, ia32: 3, armv7l: 40 }[arch];
          if (machine !== expected || ![1,2].includes(bytes[10])) throw new Error('Das AppImage passt nicht zur Prozessorarchitektur.');
        } else {
          const offset = bytes.readUInt32LE(60), header = Buffer.alloc(6), info = await fs.stat(file);
          if (offset > info.size - 6) throw new Error('Ungültiger Windows-Programmkopf.');
          const handle = await fs.open(file, 'r'); try { await handle.read(header, 0, 6, offset); } finally { await handle.close(); }
          if (!header.subarray(0,4).equals(Buffer.from([80,69,0,0])) || header.readUInt16LE(4) !== ({ x64: 0x8664, arm64: 0xaa64, ia32: 0x14c }[arch])) throw new Error('Das Windows-Programm passt nicht zur Prozessorarchitektur.');
        }
}
class ProgramInstaller {
  constructor({ platform = process.platform, arch = process.arch, run = execute } = {}) { Object.assign(this, { platform, arch, run }); }
  async ensureNotRunning(target, current) {
    if(this.platform!=='darwin')return;
    const {stdout}=await this.run('/bin/ps',['-U',String(process.getuid()),'-o','pid=,command='],{timeout:10000,maxBuffer:4*1048576});
    const prefix=path.join(target,current.executable,'Contents','MacOS')+path.sep;
    if(stdout.split('\n').some(line=>line.trim().replace(/^\d+\s+/, '').startsWith(prefix))){const error=new Error('Das Programm läuft noch. Die Installation wird bei einer späteren Prüfung erneut versucht.');error.code='PROGRAM_RUNNING';throw error;}
  }
  async prepare(asset, output) {
    const type = assetType(asset.name); let mounted, temporary;
    try {
      if (this.platform === 'linux' || this.platform === 'win32' && type === 'exe') {
        await validatePortableBinary(asset.file, this.platform, this.arch);
        const name = this.platform === 'linux' ? 'application.AppImage' : 'application.exe'; await fs.copyFile(asset.file, path.join(output, name), fs.constants.COPYFILE_EXCL); await fs.chmod(path.join(output, name), 0o755); return name;
      }
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-program-')); await fs.chmod(temporary, 0o700);
      let extracted;
      if (this.platform === 'darwin' && type === 'dmg') {
        mounted = path.join(temporary, 'mount'); await fs.mkdir(mounted);
        await this.run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-verify', '-mountpoint', mounted, asset.file], { timeout: 300000, maxBuffer: 1048576 }); extracted = mounted;
      } else { extracted = path.join(temporary, 'extracted'); const stats = await fs.statfs(temporary); await extractZip(asset.file, extracted, { platform: this.platform, maxBytes: Math.min(20 * 1024 ** 3, Math.max(0, Number(stats.bavail) * Number(stats.bsize) - 64 * 1048576)) }); }
      const candidates = await findApplications(extracted, this.platform); if (candidates.length !== 1) throw new Error('Das Release muss genau ein eindeutig erkennbares Programm enthalten.');
      const candidate = candidates[0]; await validateTree(this.platform === 'darwin' ? candidate : path.dirname(candidate));
      if (this.platform === 'darwin') {
        await this.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate], { timeout: 120000, maxBuffer: 1048576 });
        const plist = path.join(candidate, 'Contents', 'Info.plist'), { stdout } = await this.run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist], { timeout: 10000 });
        const executable = stdout.trim(); if (!executable || path.basename(executable) !== executable || /[\\/\0]/.test(executable)) throw new Error('Ungültiges macOS-Programmbundle.');
        const binary = path.join(candidate, 'Contents', 'MacOS', executable), stat = await fs.lstat(binary); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Das macOS-Programm enthält keine gültige ausführbare Datei.');
        const { stdout: architectures } = await this.run('/usr/bin/lipo', ['-archs', binary], { timeout: 10000 }); if (!architectures.trim().split(/\s+/).includes(this.arch === 'x64' ? 'x86_64' : this.arch)) throw new Error('Das macOS-Programm passt nicht zur Prozessorarchitektur.');
        const name = path.basename(candidate); await fs.cp(candidate, path.join(output, name), { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false }); await this.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(output, name)], { timeout: 120000, maxBuffer: 1048576 }); return name;
      }
      await validatePortableBinary(candidate, 'win32', this.arch);
      const name = 'program'; await fs.cp(path.dirname(candidate), path.join(output, name), { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false }); return path.join(name, path.basename(candidate));
    } finally {
      if (mounted) await this.run('/usr/bin/hdiutil', ['detach', '-force', mounted], { timeout: 60000 }).catch(() => {});
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  async install({ source, record, git, passphrase, onProgress = () => {} }) {
    if (!source.installation?.enabled) return null;
    if(!record.releaseInfo?.fileCount)throw new Error('Keine gesicherte Release-Datei für die Programminstallation vorhanden.');
    const browser = new RestoreBrowser({ git }); let stage, stageMarker, release, cleanupStage = false, cleanupMarker = false;
    try {
      onProgress({ status: 'installing', fullName: record.fullName });
      const session = await browser.open({ record, passphrase, content: 'releases' }), opened = browser.session(session.id), ownerFile = path.join(opened.filesRoot, RELEASE_OWNER);
      const manifest = await readJson(path.join(require('./integrity.cjs').controlDirectory(opened.source, opened.marker.mode), 'git-cloner-manifest.json'));
      const ownerPath = path.relative(opened.source, ownerFile).split(path.sep).join('/');
      if (await hashFile(ownerFile) !== manifest.entries.find(entry => entry.path === ownerPath)?.sha256) throw new Error('Die Release-Dateizuordnung ist beschädigt.');
      const info = await readJson(ownerFile), chosen = selectProgram(info.files, this.platform, this.arch, source.installation.pattern);
      if (typeof chosen.storedName !== 'string' || path.basename(chosen.storedName) !== chosen.storedName || /[\\/\0]/.test(chosen.storedName)) throw new Error('Unsichere Release-Datei.');
      const asset = path.join(opened.filesRoot, chosen.storedName), entry = opened.entries.find(item => item.path === chosen.storedName), stat = await fs.lstat(asset);
      if (!stat.isFile() || stat.isSymbolicLink() || !entry?.sha256 || await hashFile(asset) !== entry.sha256) throw new Error('Die Programmdatei hat ihre Integritätsprüfung nicht bestanden.');
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
      if (current?.sha256 === entry.sha256 && current.tag === record.releaseInfo.tag && typeof current.executable === 'string') {
        const executable = path.resolve(target, current.executable);
        if (!executable.startsWith(target + path.sep)) throw new Error('Ungültiger gespeicherter Programmpfad.');
        let valid = false;
        try { if (this.platform === 'darwin') { await this.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', executable], { timeout: 120000, maxBuffer: 1048576 }); valid = true; } else valid = current.executableHash && await hashFile(executable) === current.executableHash; } catch (_error) { /* A fresh verified copy repairs damaged program files. */ }
        if (valid) return { status: 'current', tag: current.tag, destination: target, executable };
      }
      if(current)await this.ensureNotRunning(target,current);
      await checkSpace(root, Math.max(stat.size * 4, 64 * 1048576), 64);
      await writeJson(stageMarker, { identity, id: randomUUID() }); cleanupMarker = true; await fs.mkdir(stage, { mode: 0o700 }); cleanupStage = true;
      const executable = await this.prepare({ ...chosen, file: asset }, stage), marker = { format: 'git-cloner-program', version: 1, identity, tag: record.releaseInfo.tag, asset: chosen.name, sha256: entry.sha256, executable, files: await fs.readdir(stage), executableHash: this.platform === 'darwin' ? null : await hashFile(path.join(stage, executable)), installedAt: new Date().toISOString() };
      await writeJson(path.join(stage, MARKER), marker);
      if (current) { await owned(target, identity); await this.ensureNotRunning(target, current); await fs.rename(target, previous); }
      try { await fs.rename(stage, target); stage = null; } catch (error) { if (current && !await exists(target)) await fs.rename(previous, target); throw error; }
      if (current) await fs.rm(previous, { recursive: true });
      return { status: 'installed', tag: marker.tag, destination: target, executable: path.join(target, executable), installedAt: marker.installedAt };
    } finally { if (stage && cleanupStage) await fs.rm(stage, { recursive: true, force: true }).catch(() => {}); if (stageMarker && cleanupMarker) await fs.rm(stageMarker, { force: true }).catch(() => {}); await release?.(); await browser.closeAll(); }
  }
}
module.exports = { ProgramInstaller, validateInstallation, selectProgram, owned };
