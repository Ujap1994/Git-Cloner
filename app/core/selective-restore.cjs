const fs = require('node:fs/promises');
const { createReadStream, createWriteStream, constants } = require('node:fs');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { explicitBare } = require('./git.cjs');
const { managed } = require('./backup.cjs');
const { decryptArchive } = require('./archives.cjs');
const { hashFile, verifyDirectory, controlDirectory } = require('./integrity.cjs');
const { existingRoot, checkSpace, safeDirectory } = require('./destinations.cjs');
const { readJson } = require('./store.cjs');
const { releaseDirectoryName, RELEASE_OWNER } = require('./release-layout.cjs');
function relative(value, allowEmpty = false, platform = process.platform) {
  if (
    typeof value !== 'string' ||
    (!value && !allowEmpty) ||
    value.length > 4096 ||
    path.isAbsolute(value) ||
    /^[a-z]:/i.test(value) ||
    /[\\\0]/.test(value) ||
    value.split('/').some(p => p === '..' || p === '.' || p === '.git')
  )
    throw new Error('Ungültiger Auswahlpfad.');
  if (
    platform === 'win32' &&
    value
      .split('/')
      .some(
        p =>
          /[<>:"|?*]/.test(p) ||
          [...p].some(c => c.codePointAt(0) < 32) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)
      )
  )
    throw new Error(
      'Dieser Dateiname wird von Windows nicht unterstützt. Bitte die vollständige Mirror-Sicherung verwenden.'
    );
  return value;
}
function restoreName(name) {
  if (
    typeof name !== 'string' ||
    !/^[a-z\d._ -]{1,100}$/i.test(name) ||
    ['.', '..'].includes(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error('Bitte einen gültigen neuen Ordnernamen eingeben.');
  return name;
}
async function safeFile(root, name) {
  relative(name);
  let current = root;
  for (const part of name.split('/').slice(0, -1)) {
    current = path.join(current, part);
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Ein Link blockiert den Auswahlpfad.');
  }
  return path.join(root, ...name.split('/'));
}
async function gitTree(directory) {
  const child = spawn(
    'git',
    explicitBare(['-c', 'core.hooksPath=', '-C', directory, 'ls-tree', '-r', '-l', '-z', 'HEAD']),
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error('Git-Dateiliste konnte nicht gelesen werden.'))
    );
  });
  ended.catch(() => {});
  const entries = [];
  let rest = '';
  try {
    child.stdout.setEncoding('utf8');
    for await (const chunk of child.stdout) {
      const pieces = (rest + chunk).split('\0');
      rest = pieces.pop();
      for (const piece of pieces) {
        const match = piece.match(/^(\d+) (blob|commit) ([a-f\d]+)\s+([\d-]+)\t([\s\S]+)$/);
        if (!match || match[2] !== 'blob') continue;
        entries.push({
          path: relative(match[5]),
          size: Number(match[4]),
          object: match[3],
          symbolic: match[1] === '120000',
          executable: match[1] === '100755'
        });
        if (entries.length > 200000)
          throw new Error('Zu viele Dateien für die Dateiauswahl. Bitte die vollständige Sicherung wiederherstellen.');
      }
    }
    await ended;
    return entries;
  } catch (error) {
    child.kill();
    await ended.catch(() => {});
    throw error;
  }
}
async function exportBlob(directory, entry, file) {
  const child = spawn(
    'git',
    explicitBare(['-c', 'core.hooksPath=', '-C', directory, 'cat-file', 'blob', entry.object]),
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error('Git-Datei konnte nicht exportiert werden.'))
    );
  });
  ended.catch(() => {});
  try {
    await pipeline(child.stdout, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    await ended;
  } catch (error) {
    child.kill();
    await ended.catch(() => {});
    throw error;
  }
  const hash = createHash(entry.object.length === 64 ? 'sha256' : 'sha1').update(`blob ${entry.size}\0`);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== entry.object) throw new Error('Die exportierte Git-Datei ist beschädigt.');
  await fs.chmod(file, entry.executable ? 0o755 : 0o644);
}
class RestoreBrowser {
  constructor({ git, ttl = 5 * 60000, now = Date.now } = {}) {
    Object.assign(this, { git, ttl, now });
    this.sessions = new Map();
    this.timer = setInterval(() => {
      for (const [id, s] of this.sessions) if (s.expiresAt <= this.now()) void this.close(id);
    }, 30000);
    this.timer.unref?.();
  }
  async open({ record, archive, passphrase, content = 'repository' }) {
    if (this.sessions.size >= 3) throw new Error('Bitte zuerst die bisherige Dateiauswahl schließen.');
    if (!['repository', 'releases'].includes(content)) throw new Error('Ungültiger Wiederherstellungsumfang.');
    let temporary, source, marker;
    try {
      if (record) {
        marker = await managed(record.destination, record.fullName);
        if (marker.encrypted) {
          archive = path.join(record.destination, 'backup.gcb');
          if ((await hashFile(archive)) !== marker.archiveHash) throw new Error('Das Archiv ist beschädigt.');
        } else source = record.destination;
      }
      if (archive) {
        const info = await fs.lstat(archive);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('Das Archiv muss eine reguläre Datei sein.');
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'git-cloner-browse-'));
        source = path.join(temporary, 'payload');
        await decryptArchive(archive, source, passphrase);
        const gitInfo = await fs.lstat(path.join(source, '.git')).catch(() => null);
        if (gitInfo?.isSymbolicLink()) throw new Error('Unsicherer Git-Ordner.');
        const inner = await readJson(
          path.join(gitInfo?.isDirectory() ? path.join(source, '.git') : source, 'git-cloner.json'),
          null
        );
        if (!inner?.fullName) throw new Error('Keine Git-Cloner-Sicherung gefunden.');
        marker = await managed(source, inner.fullName);
      }
      if (!source) throw new Error('Bitte eine Sicherung auswählen.');
      const manifestFile = path.join(controlDirectory(source, marker.mode), 'git-cloner-manifest.json');
      if (marker.manifestHash) {
        if ((await hashFile(manifestFile)) !== marker.manifestHash)
          throw new Error('Das Dateimanifest ist beschädigt.');
      } else await verifyDirectory(source, this.git, marker.mode);
      const manifest = await readJson(manifestFile, null);
      if (!manifest?.entries)
        throw new Error('Diese ältere Sicherung hat kein Dateimanifest. Bitte zunächst vollständig wiederherstellen.');
      let filesRoot = source,
        entries;
      if (content === 'releases') {
        try {
          filesRoot = releaseDirectoryName(marker.releaseInfo?.assetDirectory)
            ? await safeDirectory(source, [marker.releaseInfo.assetDirectory])
            : await safeDirectory(controlDirectory(source, marker.mode), ['git-cloner-metadata', 'release-assets']);
        } catch (error) {
          if (error.code === 'ENOENT') throw new Error('Diese Sicherung enthält keine Release-Dateien.');
          throw error;
        }
        const prefix = path.relative(source, filesRoot).split(path.sep).join('/') + '/';
        entries = manifest.entries
          .filter(
            e => e.path.startsWith(prefix) && e.path !== prefix + RELEASE_OWNER && e.sha256 && e.link === undefined
          )
          .map(e => ({ ...e, path: relative(e.path.slice(prefix.length)) }));
      } else
        entries =
          marker.mode === 'mirror'
            ? await gitTree(source)
            : manifest.entries
                .filter(e => !e.path.split('/').includes('.git'))
                .map(e => ({ ...e, path: relative(e.path) }));
      const id = randomUUID(),
        session = { id, source, filesRoot, content, marker, entries, temporary, expiresAt: this.now() + this.ttl };
      this.sessions.set(id, session);
      return {
        id,
        fullName: marker.fullName,
        mode: marker.mode,
        content,
        fileCount: entries.length,
        expiresAt: new Date(session.expiresAt).toISOString()
      };
    } catch (error) {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  session(id) {
    const s = this.sessions.get(id);
    if (!s || s.expiresAt <= this.now()) throw new Error('Die Dateiauswahl ist abgelaufen. Bitte erneut öffnen.');
    if (s.locked) throw new Error('Die Auswahl wird gerade wiederhergestellt.');
    s.expiresAt = this.now() + this.ttl;
    return s;
  }
  list({ sessionId, folder = '', offset = 0 }) {
    const s = this.session(sessionId);
    relative(folder, true);
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Ungültige Seite.');
    const children = new Map(),
      prefix = folder ? folder + '/' : '';
    for (const entry of s.entries)
      if (entry.path.startsWith(prefix)) {
        const remainder = entry.path.slice(prefix.length),
          [name, ...tail] = remainder.split('/');
        if (!name) continue;
        const existing = children.get(name),
          item = existing || {
            name,
            path: prefix + name,
            type: tail.length ? 'directory' : entry.link !== undefined || entry.symbolic ? 'link' : 'file',
            size: 0
          };
        item.size += entry.size || 0;
        children.set(name, item);
      }
    const all = [...children.values()].sort(
      (a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name)
    );
    return { folder, total: all.length, offset, entries: all.slice(offset, offset + 100) };
  }
  async restore({ sessionId, paths, parent, name }) {
    const s = this.session(sessionId);
    s.expiresAt = Infinity;
    s.locked = true;
    let staging;
    try {
      if (!Array.isArray(paths) || !paths.length || paths.length > 1000)
        throw new Error('Bitte 1 bis 1000 Dateien oder Ordner auswählen.');
      paths.forEach(p => relative(p));
      const selected = s.entries.filter(e => paths.some(p => e.path === p || e.path.startsWith(p + '/')));
      if (!selected.length || paths.some(p => !selected.some(e => e.path === p || e.path.startsWith(p + '/'))))
        throw new Error('Die Auswahl enthält unbekannte Dateien.');
      const root = await existingRoot(parent),
        target = path.join(root, restoreName(name));
      try {
        await fs.lstat(target);
        throw new Error('Der Zielordner existiert bereits. Es werden keine Dateien überschrieben.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await checkSpace(
        root,
        selected.reduce((sum, e) => sum + (e.size || 0), 0),
        64
      );
      const current = await managed(s.source, s.marker.fullName);
      if (s.marker.manifestHash) {
        if (
          current.manifestHash !== s.marker.manifestHash ||
          (await hashFile(path.join(controlDirectory(s.source, s.marker.mode), 'git-cloner-manifest.json'))) !==
            s.marker.manifestHash
        )
          throw new Error('Die Sicherung wurde seit der Dateiauswahl verändert.');
      } else await verifyDirectory(s.source, this.git, s.marker.mode);
      staging = path.join(root, `.git-cloner-selection-${randomUUID()}`);
      await fs.mkdir(staging, { mode: 0o700 });
      const links = [];
      for (const entry of selected) {
        const file = path.join(staging, ...entry.path.split('/'));
        await fs.mkdir(path.dirname(file), { recursive: true });
        if (entry.link !== undefined) {
          links.push({ file, target: entry.link });
          continue;
        }
        if (s.marker.mode === 'mirror' && s.content !== 'releases') {
          await exportBlob(s.source, entry, file);
          if (entry.symbolic) {
            const target = await fs.readFile(file, 'utf8');
            await fs.rm(file);
            links.push({ file, target });
            continue;
          }
          if (entry.size < 1024) {
            const pointer = (await fs.readFile(file, 'utf8')).match(
              /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f\d]{64})\nsize (\d+)/
            );
            if (pointer) {
              const object = path.join(
                s.source,
                'lfs',
                'objects',
                pointer[1].slice(0, 2),
                pointer[1].slice(2, 4),
                pointer[1]
              );
              if ((await hashFile(object)) !== pointer[1]) throw new Error('LFS-Inhalt fehlt oder ist beschädigt.');
              await fs.copyFile(object, file, constants.COPYFILE_FICLONE);
            }
          }
        } else {
          const source = await safeFile(s.filesRoot, entry.path),
            info = await fs.lstat(source);
          if (!info.isFile() || info.isSymbolicLink()) throw new Error('Die Quelldatei wurde verändert.');
          await fs.copyFile(source, file, constants.COPYFILE_FICLONE);
          if ((await hashFile(file)) !== entry.sha256)
            throw new Error('Die Integritätsprüfung hat eine veränderte ausgewählte Datei erkannt.');
        }
      }
      for (const link of links) await fs.symlink(link.target, link.file);
      try {
        await fs.lstat(target);
        throw new Error('Der Zielordner wurde inzwischen angelegt.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fs.rename(staging, target);
      staging = null;
      return { destination: target, files: selected.length, selection: true };
    } finally {
      if (staging) await fs.rm(staging, { recursive: true, force: true });
      s.locked = false;
      s.expiresAt = this.now() + this.ttl;
      if (s.closeRequested) await this.close(sessionId);
    }
  }
  async close(id) {
    const s = this.sessions.get(id);
    if (s?.locked) {
      s.closeRequested = true;
      return;
    }
    this.sessions.delete(id);
    if (s?.temporary) await fs.rm(s.temporary, { recursive: true, force: true });
  }
  async closeAll() {
    clearInterval(this.timer);
    await Promise.all([...this.sessions.keys()].map(id => this.close(id)));
  }
}
module.exports = { RestoreBrowser, relative, restoreName, gitTree };
