const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readJson } = require('./store.cjs');
const { safeDirectory } = require('./destinations.cjs');
const { acquireLease } = require('./lease.cjs');
const hex = value => typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f\d-]{36}$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function json(file, max = 8 * 1048576) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > max)
    throw new Error('Eine fremde oder ungültige Download-Kennung bleibt erhalten.');
  return readJson(file);
}
async function rootDirectory(root) {
  const canonical = await fs.realpath(root.destination),
    marker = await json(path.join(canonical, '.git-cloner-volume.json'), 65536);
  if (!root.volumeId || marker.id !== root.volumeId)
    throw new Error('Sicherungslaufwerk nicht erreichbar oder Kennung geändert.');
  const directory = await safeDirectory(canonical, ['.git-cloner-downloads']);
  const owner = await json(path.join(directory, 'owner.json'), 65536);
  if (owner.format !== 'git-cloner-download-cache' || owner.version !== 1 || owner.volumeId !== root.volumeId)
    throw new Error('Unbekannter Download-Ordner bleibt erhalten.');
  return directory;
}
async function inspect(root, scope, key, { headers = true } = {}) {
  if (!hex(scope) || !hex(key)) throw new Error('Ungültiger Download-Eintrag.');
  const parent = await rootDirectory(root),
    scopeDirectory = await safeDirectory(parent, [scope]),
    owner = await json(path.join(scopeDirectory, 'owner.json'), 65536);
  if (owner.format !== 'git-cloner-download-scope' || owner.version !== 1 || owner.scope !== scope)
    throw new Error('Unbekannter Download-Bereich.');
  const directory = await safeDirectory(scopeDirectory, [key]),
    identity = await json(path.join(directory, 'owner.json'), 65536),
    meta = await json(path.join(directory, 'parts.json'));
  if (
    identity.format !== 'git-cloner-release-entry' ||
    identity.version !== 1 ||
    identity.key !== key ||
    meta.format !== 'git-cloner-release-parts' ||
    meta.version !== 1 ||
    meta.key !== key ||
    !uuid(meta.owner) ||
    !Array.isArray(meta.chunks) ||
    meta.chunks.length > 10000 ||
    typeof meta.encrypted !== 'boolean'
  )
    throw new Error('Ungültiger Teildownload bleibt erhalten.');
  const files = new Set(['owner.json', 'parts.json']);
  for (const chunk of meta.chunks) {
    if (
      !uuid(chunk.id) ||
      !Number.isSafeInteger(chunk.bytes) ||
      chunk.bytes < 1 ||
      chunk.bytes > 4 * 1048576 ||
      files.has(chunk.id + '.chunk')
    )
      throw new Error('Ungültige Dateiliste.');
    files.add(chunk.id + '.chunk');
  }
  const names = await fs.readdir(directory);
  if (names.some(name => !files.has(name))) throw new Error('Fremde Dateien im Download-Ordner bleiben erhalten.');
  const stamps = [];
  let bytes = 0,
    updated = 0;
  for (const name of names.sort()) {
    const file = path.join(directory, name),
      stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error('Links oder fremde Dateien bleiben erhalten.');
    bytes += stat.size;
    updated = Math.max(updated, stat.mtimeMs);
    stamps.push([name, stat.size, stat.mtimeMs, stat.ino]);
    if (headers && name.endsWith('.chunk')) {
      const chunk = meta.chunks.find(item => name === item.id + '.chunk'),
        expected = Buffer.from(`GC-PART1:${meta.owner}:${chunk.id}\n`),
        prefix = Buffer.alloc(expected.length),
        handle = await fs.open(file, 'r');
      let read;
      try {
        read = await handle.read(prefix);
      } finally {
        await handle.close();
      }
      if (
        (!chunk.pending && read.bytesRead !== expected.length) ||
        !prefix.subarray(0, read.bytesRead).equals(expected.subarray(0, read.bytesRead))
      )
        throw new Error('Eine fremde Download-Datei bleibt erhalten.');
    }
  }
  for (const chunk of meta.chunks)
    if (!names.includes(chunk.id + '.chunk') && !chunk.pending) throw new Error('Die Dateiliste ist unvollständig.');
  return {
    id: digest([root.destination, root.volumeId, scope, key]),
    root: root.destination,
    volumeId: root.volumeId,
    scope,
    key,
    name: !meta.encrypted && typeof meta.label?.name === 'string' ? meta.label.name.slice(0, 500) : null,
    directory,
    scopeDirectory,
    bytes,
    chunks: names.filter(name => name.endsWith('.chunk')).length,
    encrypted: meta.encrypted,
    complete: Boolean(meta.complete),
    updatedAt: new Date(updated).toISOString(),
    signature: digest([meta, stamps])
  };
}
async function inventory(roots) {
  const entries = [],
    warnings = [],
    seen = new Set();
  let examined = 0;
  for (const root of roots) {
    try {
      const parent = await rootDirectory(root),
        scopes = await fs.readdir(parent);
      if (seen.has(parent)) continue;
      seen.add(parent);
      for (const scope of scopes.filter(hex)) {
        const directory = await safeDirectory(parent, [scope]);
        for (const key of (await fs.readdir(directory)).filter(hex)) {
          if (++examined > 1000) {
            warnings.push('Anzeige auf 1000 Downloads begrenzt.');
            return { entries, warnings };
          }
          try {
            entries.push(await inspect(root, scope, key, { headers: false }));
          } catch (error) {
            warnings.push(`${root.destination}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') warnings.push(`${root.destination}: ${error.message}`);
    }
  }
  return { entries, warnings };
}
async function clean(entries) {
  const releases = [],
    scopes = new Set();
  try {
    for (const entry of entries) {
      const root = { destination: entry.root, volumeId: entry.volumeId },
        current = await inspect(root, entry.scope, entry.key);
      if (!scopes.has(current.scopeDirectory)) {
        releases.push(await acquireLease(current.scopeDirectory));
        scopes.add(current.scopeDirectory);
      }
    }
    const validated = [];
    for (const entry of entries) {
      const current = await inspect({ destination: entry.root, volumeId: entry.volumeId }, entry.scope, entry.key);
      if (current.signature !== entry.signature)
        throw new Error('Die Downloads wurden inzwischen geändert. Bitte die Vorschau erneuern.');
      validated.push(current);
    }
    let bytes = 0;
    for (const entry of validated) {
      await fs.rm(entry.directory, { recursive: true });
      bytes += entry.bytes;
    }
    return { removed: validated.length, bytes };
  } finally {
    for (const release of releases.reverse()) await release();
  }
}
module.exports = { inventory, clean, inspect };
