const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { readJson, writeJson } = require('./store.cjs');
const { hashFile } = require('./integrity.cjs');
const { safeDirectory } = require('./destinations.cjs');
const { providerKey } = require('./provider-spec.cjs');
const { acquireLease } = require('./lease.cjs');
const { owned } = require('./program-installation.cjs');
const hash = text => createHash('sha256').update(text).digest('hex');
const nameFor = (name, identity, key, extension) =>
  `${
    Array.from(name, char => (char.charCodeAt(0) < 32 ? '-' : char))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/[. ]+$/, '')
      .slice(0, 80) || 'Programm'
  } - ${hash(identity + ':' + key).slice(0, 10)}${extension}`;
const quoteExec = value => {
  if (/[\r\n\0]/.test(value)) throw new Error('Der Verknüpfungspfad enthält nicht unterstützte Steuerzeichen.');
  return (
    '"' +
    value
      .replace(/%/g, '%%')
      .replace(/[\\"`$]/g, '\\$&')
      .replace(/\\/g, '\\\\') +
    '"'
  );
};
async function stamp(file) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink()) return 'link:' + hash(await fs.readlink(file));
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Eine fremde Programmverknüpfung bleibt erhalten.');
  return 'file:' + (await hashFile(file));
}
async function createLink(file, target, name, platform, writeWindowsShortcut) {
  if (platform === 'darwin') return fs.symlink(target, file, 'dir');
  if (platform === 'win32') {
    if (!writeWindowsShortcut) throw new Error('Windows-Verknüpfungen benötigen die native Electron-Anwendung.');
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-link-'));
    try {
      const staged = path.join(temporary, 'program.lnk');
      if (!(await writeWindowsShortcut(staged, { target, workingDirectory: path.dirname(target), description: name })))
        throw new Error('Windows konnte die Programmverknüpfung nicht erstellen.');
      await fs.copyFile(staged, file, fs.constants.COPYFILE_EXCL);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
    return;
  }
  const value = text => text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  await fs.writeFile(
    file,
    `[Desktop Entry]\nVersion=1.0\nType=Application\nName=${value(name)}\nExec=${quoteExec(target)}\nPath=${value(path.dirname(target))}\nTerminal=false\n`,
    { flag: 'wx', mode: 0o755 }
  );
}
async function syncAt(destination, identity, programs, { platform, run, writeWindowsShortcut, forbidden = [] }) {
  const root = await fs.realpath(destination);
  for (const directory of forbidden) {
    const resolved = await fs.realpath(directory).catch(() => path.resolve(directory));
    if (root === resolved || root.startsWith(resolved + path.sep))
      throw new Error('Verknüpfungen bitte außerhalb der Sicherungs- und Programmablage speichern.');
  }
  const metadata = path.join(root, '.git-cloner-shortcuts');
  let created = false;
  try {
    await fs.mkdir(metadata, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await safeDirectory(root, ['.git-cloner-shortcuts']);
  const owner = path.join(metadata, 'owner.json');
  if (created)
    await fs.writeFile(owner, JSON.stringify({ format: 'git-cloner-shortcuts', version: 1 }), {
      flag: 'wx',
      mode: 0o600
    });
  if (created && platform === 'win32') await run('attrib.exe', ['+H', metadata], { timeout: 10000, windowsHide: true });
  const stat = await fs.lstat(owner);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (await readJson(owner)).format !== 'git-cloner-shortcuts'
  )
    throw new Error('Ein fremder Verknüpfungsordner bleibt erhalten.');
  const release = await acquireLease(metadata),
    file = path.join(metadata, hash(identity) + '.json');
  try {
    let record;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw new Error('Unbekannte Verknüpfungszuordnung.');
      record = await readJson(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      record = { format: 'git-cloner-program-shortcuts', identity, entries: [] };
    }
    const safe = entry =>
      entry &&
      typeof entry.file === 'string' &&
      path.basename(entry.file) === entry.file &&
      !/[\\/\0]/.test(entry.file) &&
      !entry.file.startsWith('.') &&
      typeof entry.target === 'string' &&
      path.isAbsolute(entry.target) &&
      /^(file|link):[a-f\d]{64}$/.test(entry.stamp);
    if (
      record.format !== 'git-cloner-program-shortcuts' ||
      record.identity !== identity ||
      !Array.isArray(record.entries) ||
      record.entries.length > 128 ||
      record.entries.some(entry => !safe(entry))
    )
      throw new Error('Unbekannte Verknüpfungszuordnung.');
    const recover = async () => {
      if (!record.pending) return;
      const pending = record.pending;
      if (!safe(pending.entry) || !/^[a-f\d-]{36}\.(app|lnk|desktop)$/.test(pending.stage))
        throw new Error('Ungültige vorbereitete Verknüpfung.');
      const target = path.join(root, pending.entry.file),
        staged = path.join(metadata, pending.stage),
        current = await stamp(target),
        prepared = await stamp(staged);
      if (
        (current !== null && current !== pending.prior && current !== pending.entry.stamp) ||
        (prepared !== null && prepared !== pending.entry.stamp)
      )
        throw new Error('Eine veränderte Verknüpfung bleibt erhalten.');
      if (prepared) {
        if (current === pending.entry.stamp) await fs.unlink(staged);
        else await fs.rename(staged, target);
      }
      if (prepared || current === pending.entry.stamp)
        record.entries = [...record.entries.filter(entry => entry.file !== pending.entry.file), pending.entry];
      delete record.pending;
      await writeJson(file, record);
    };
    await recover();
    for (const entry of record.entries) {
      const actual = await stamp(path.join(root, entry.file));
      if (actual !== null && actual !== entry.stamp)
        throw new Error('Eine vom Benutzer geänderte Verknüpfung bleibt erhalten.');
    }
    const extension = platform === 'darwin' ? '.app' : platform === 'win32' ? '.lnk' : '.desktop',
      desired = [];
    for (const program of programs) {
      const name = nameFor(program.name, identity, program.key, extension),
        target = path.join(root, name),
        previous = record.entries.find(entry => entry.file === name),
        actual = await stamp(target);
      if (actual && !previous) throw new Error('Eine fremde Programmverknüpfung wird nicht ersetzt.');
      desired.push(name);
      if (previous?.target === program.executable && actual === previous.stamp) continue;
      const stage = randomUUID() + extension,
        staged = path.join(metadata, stage);
      try {
        await createLink(staged, program.executable, program.name, platform, writeWindowsShortcut);
        const signature = await stamp(staged);
        if (!signature) throw new Error('Die Programmverknüpfung konnte nicht erstellt werden.');
        record.pending = { stage, prior: actual, entry: { file: name, target: program.executable, stamp: signature } };
        await writeJson(file, record);
        await recover();
      } catch (error) {
        if (!record.pending) await fs.unlink(staged).catch(() => {});
        throw error;
      }
    }
    for (const entry of [...record.entries])
      if (!desired.includes(entry.file)) {
        const actual = await stamp(path.join(root, entry.file));
        if (actual && actual !== entry.stamp) throw new Error('Eine veränderte Verknüpfung bleibt erhalten.');
        if (actual) await fs.unlink(path.join(root, entry.file));
        record.entries = record.entries.filter(item => item.file !== entry.file);
        await writeJson(file, record);
      }
    return { destination: root, count: desired.length, files: desired };
  } finally {
    await release();
  }
}
class ProgramShortcuts {
  constructor({ platform = process.platform, run = promisify(execFile), writeWindowsShortcut } = {}) {
    Object.assign(this, { platform, run, writeWindowsShortcut });
  }
  async sync({ source, installation, previous }) {
    const identity = `${providerKey(source)}:${source.value.toLowerCase()}`,
      settings = source.installation?.shortcut,
      old = previous?.shortcuts?.destination;
    let current = null;
    if (settings?.enabled) {
      const marker = await owned(installation.destination, identity),
        configured = marker.programs || [
          {
            key: marker.executable,
            name: path.basename(marker.executable).replace(/\.(app|exe|AppImage)$/i, ''),
            executable: marker.executable
          }
        ];
      const programs = configured.map(item => {
        const executable = path.resolve(installation.destination, item.executable);
        if (!executable.startsWith(installation.destination + path.sep))
          throw new Error('Ungültiger Programmpfad für die Verknüpfung.');
        return { key: item.key, name: item.name, executable };
      });
      current = await syncAt(settings.destination, identity, programs, {
        ...this,
        forbidden: [
          source.destination,
          ...(source.additionalDestinations || []).map(target => target.destination),
          installation.destination
        ]
      });
    }
    const obsolete = new Set([old, ...(previous?.shortcuts?.staleDestinations || [])].filter(Boolean));
    if (!settings?.enabled && settings?.destination) {
      try {
        await fs.lstat(path.join(settings.destination, '.git-cloner-shortcuts', hash(identity) + '.json'));
        obsolete.add(settings.destination);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (current)
      for (const root of obsolete) if (path.resolve(root) === path.resolve(current.destination)) obsolete.delete(root);
    let failure;
    for (const root of [...obsolete]) {
      try {
        await syncAt(root, identity, [], this);
        obsolete.delete(root);
      } catch (error) {
        failure ||= error;
      }
    }
    if (failure) {
      failure.shortcutState = { ...(current || {}), staleDestinations: [...obsolete] };
      throw failure;
    }
    return current ? { ...current, status: 'ok' } : { status: 'disabled', count: 0 };
  }
}
module.exports = { ProgramShortcuts, syncAt, quoteExec };
