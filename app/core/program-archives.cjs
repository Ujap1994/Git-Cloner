const { promises: fs, createWriteStream } = require('./physical-fs.cjs');
const path = require('node:path');
const { crc32 } = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { safeDirectory } = require('./destinations.cjs');
function safeName(name, platform = process.platform) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 4096 ||
    /^[\\/]|^[a-z]:/i.test(name) ||
    /[\\\0]/.test(name) ||
    name
      .replace(/\/$/, '')
      .split('/')
      .some(part => !part || part === '.' || part === '..')
  )
    throw new Error('Unsicherer Pfad im Programmarchiv.');
  if (
    platform === 'win32' &&
    name
      .replace(/\/$/, '')
      .split('/')
      .some(
        part =>
          /[<>:"|?*]/.test(part) ||
          Array.from(part).some(char => char.charCodeAt(0) < 32) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )
  )
    throw new Error('Nicht unterstützter Windows-Dateiname.');
  return name.replace(/\/$/, '');
}
async function extractZip(file, directory, { maxBytes = 20 * 1024 ** 3, platform = process.platform } = {}) {
  await fs.mkdir(directory, { mode: 0o700 });
  const archive = await new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (error, zip) =>
      error ? reject(error) : resolve(zip)
    )
  );
  if (archive.entryCount > 200000) {
    archive.close();
    throw new Error('Das Programmarchiv enthält zu viele Dateien.');
  }
  const names = new Set(),
    links = [];
  let total = 0;
  const stream = entry =>
    new Promise((resolve, reject) =>
      archive.openReadStream(entry, (error, value) => (error ? reject(error) : resolve(value)))
    );
  try {
    await new Promise((resolve, reject) => {
      archive.once('error', reject);
      archive.once('end', resolve);
      archive.on('entry', entry => {
        void (async () => {
          const relative = safeName(entry.fileName, platform),
            key = relative.toLowerCase();
          if (names.has(key)) throw new Error('Doppelte Pfade im Programmarchiv.');
          names.add(key);
          total += entry.uncompressedSize;
          if (!Number.isSafeInteger(total) || total > maxBytes || entry.generalPurposeBitFlag & 1)
            throw new Error('Das Programmarchiv ist zu groß oder verschlüsselt.');
          const mode = entry.externalFileAttributes >>> 16,
            type = mode & 0o170000;
          if (type && ![0o100000, 0o040000, 0o120000].includes(type))
            throw new Error('Nicht unterstützter Dateityp im Programmarchiv.');
          const parts = relative.split('/'),
            name = parts.pop(),
            parent = await safeDirectory(directory, parts, true),
            target = path.join(parent, name);
          if (entry.fileName.endsWith('/')) await safeDirectory(parent, [name], true);
          else if (type === 0o120000) {
            if (platform === 'win32')
              throw new Error('Programmarchive mit Links werden unter Windows nicht installiert.');
            if (entry.uncompressedSize > 4096) throw new Error('Ungültiger Programm-Link.');
            const buffers = [];
            let checksum = 0;
            for await (const chunk of await stream(entry)) {
              checksum = crc32(chunk, checksum);
              buffers.push(chunk);
            }
            if (checksum !== entry.crc32) throw new Error('Die ZIP-Prüfsumme stimmt nicht.');
            const link = Buffer.concat(buffers).toString('utf8'),
              resolved = path.resolve(parent, link);
            if (
              !link ||
              path.isAbsolute(link) ||
              /[\\\0]/.test(link) ||
              !resolved.startsWith(path.resolve(directory) + path.sep)
            )
              throw new Error('Ein Programm-Link verlässt das Archiv.');
            links.push({ target, link });
          } else {
            let checksum = 0;
            const meter = new Transform({
              transform(chunk, _encoding, done) {
                checksum = crc32(chunk, checksum);
                done(null, chunk);
              }
            });
            await pipeline(
              await stream(entry),
              meter,
              createWriteStream(target, { flags: 'wx', mode: mode & 0o111 ? 0o755 : 0o644 })
            );
            if (checksum !== entry.crc32) throw new Error('Die ZIP-Prüfsumme stimmt nicht.');
          }
          archive.readEntry();
        })().catch(error => {
          archive.close();
          reject(error);
        });
      });
      archive.readEntry();
    });
    for (const { target, link } of links) await fs.symlink(link, target);
  } catch (error) {
    archive.close();
    throw error;
  }
}
async function validateTree(root) {
  let count = 0;
  async function walk(directory) {
    for (const name of await fs.readdir(directory)) {
      if (++count > 200000) throw new Error('Das Programm enthält zu viele Dateien.');
      const file = path.join(directory, name),
        stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) {
        const link = await fs.readlink(file),
          target = path.resolve(directory, link);
        if (path.isAbsolute(link) || !target.startsWith(path.resolve(root) + path.sep))
          throw new Error('Ein Link verlässt den Programmordner.');
      } else if (stat.isDirectory()) await walk(file);
      else if (!stat.isFile()) throw new Error('Ungültiger Programmdateityp.');
    }
  }
  await walk(root);
}
module.exports = { extractZip, validateTree, safeName };
