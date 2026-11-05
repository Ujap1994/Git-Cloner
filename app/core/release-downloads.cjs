const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID, randomBytes, scrypt, createCipheriv, createDecipheriv } = require('node:crypto');
const { promisify } = require('node:util');
const { readJson, writeJson } = require('./store.cjs');
const { safeDirectory } = require('./destinations.cjs');
const { acquireLease } = require('./lease.cjs');

const deriveKey = promisify(scrypt), CHUNK_BYTES = 4 * 1048576;
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f\d-]{36}$/.test(value);
const strongETag = value => typeof value === 'string' && /^"[^\r\n"]{1,500}"$/.test(value);
const httpDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toUTCString() === value;
const strongModified = (modified, date) => httpDate(modified) && httpDate(date) && Date.parse(date) - Date.parse(modified) >= 60000;
function downloadError(message, retryable = false) { const error = new Error(message); error.retryable = retryable; return error; }
async function regular(file) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Eine fremde Datei oder ein Link blockiert den Teildownload.');
  return info;
}
async function ownedDirectory(parent, name, expected) {
  const directory = path.join(parent, name); let created = false;
  try { await fs.mkdir(directory, { mode: 0o700 }); created = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Ein fremder Ordner oder Link blockiert den Teildownload-Cache.');
  const file = path.join(directory, 'owner.json');
  if (created) await fs.writeFile(file, JSON.stringify(expected), { flag: 'wx', mode: 0o600 });
  await regular(file); const marker = await readJson(file, null);
  if (JSON.stringify(marker) !== JSON.stringify(expected)) throw new Error('Ein fremder Ordner blockiert den Teildownload-Cache.');
  return directory;
}

class ReleaseDownloads {
  static async open({ root, volumeId, scope, passphrase = '', encryptionKeyId = '', chunkBytes = CHUNK_BYTES }) {
    const cache = new ReleaseDownloads();
    cache.root = root; cache.volumeId = volumeId; cache.scope = hash(scope); cache.passphrase = passphrase; cache.encryptionKeyId = encryptionKeyId; cache.chunkBytes = chunkBytes;
    const parent = await ownedDirectory(root, '.git-cloner-downloads', { format: 'git-cloner-download-cache', version: 1, volumeId });
    cache.directory = await ownedDirectory(parent, cache.scope, { format: 'git-cloner-download-scope', version: 1, scope: cache.scope });
    cache.release = await acquireLease(cache.directory);
    try { await cache.sweep(); } catch (error) { await cache.close(); throw error; }
    return cache;
  }
  async checkRoot() {
    const root = await fs.realpath(this.root), marker = await readJson(path.join(root, '.git-cloner-volume.json'), null);
    if (marker?.id !== this.volumeId) throw new Error('Das Sicherungslaufwerk für den Teildownload fehlt oder wurde ausgetauscht.');
    await safeDirectory(root, ['.git-cloner-downloads', this.scope]);
  }
  async entry(identity) {
    await this.checkRoot();
    const key = hash(JSON.stringify({ identity, encrypted: Boolean(this.passphrase), keyId: this.encryptionKeyId }));
    const directory = await ownedDirectory(this.directory, key, { format: 'git-cloner-release-entry', version: 1, key });
    const file = path.join(directory, 'parts.json');
    let meta;
    try { const info = await regular(file); if (info.size > 8 * 1048576) throw new Error('Der Teildownload ist zu umfangreich.'); meta = await readJson(file, null); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!meta) {
      meta = { format: 'git-cloner-release-parts', version: 1, key, owner: randomUUID(), encrypted: Boolean(this.passphrase), label: this.passphrase ? null : { name: typeof identity.name === 'string' ? identity.name.slice(0,500) : '', tag: typeof identity.tag === 'string' ? identity.tag.slice(0,100) : '' }, salt: randomBytes(16).toString('base64'), etag: null, modified: null, total: null, complete: false, chunks: [] };
      await writeJson(file, meta);
    }
    if (meta.format !== 'git-cloner-release-parts' || meta.version !== 1 || meta.key !== key || !uuid(meta.owner) || meta.encrypted !== Boolean(this.passphrase) || typeof meta.salt !== 'string' || Buffer.from(meta.salt, 'base64').length !== 16 || !Array.isArray(meta.chunks) || meta.chunks.length > 100000 || meta.chunks.some(chunk => !uuid(chunk.id) || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > this.chunkBytes || !/^[a-f\d]{64}$/.test(chunk.sha256))) throw new Error('Die Kennung eines Teildownloads ist beschädigt.');
    const keyBytes = meta.encrypted ? await deriveKey(this.passphrase, Buffer.from(meta.salt, 'base64'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1048576 }) : null;
    return { directory, file, meta, keyBytes };
  }
  header(entry, chunk) { return Buffer.from(`GC-PART1:${entry.meta.owner}:${chunk.id}\n`); }
  async readChunk(entry, chunk, index) {
    const file = path.join(entry.directory, `${chunk.id}.chunk`), info = await regular(file), header = this.header(entry, chunk);
    if (info.size > this.chunkBytes + 256) throw new Error('Eine Teildownload-Datei ist zu groß.');
    const encoded = await fs.readFile(file);
    if (!encoded.subarray(0, header.length).equals(header)) throw new Error('Eine fremde Datei blockiert den Teildownload.');
    if (hash(encoded) !== chunk.sha256) { const error = new Error('Ein gespeicherter Teildownload wurde verändert oder beschädigt.'); error.code = 'CACHE_INTEGRITY'; throw error; }
    let value = encoded.subarray(header.length);
    if (entry.keyBytes) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', entry.keyBytes, value.subarray(0, 12));
        decipher.setAAD(Buffer.concat([header, Buffer.from(`${entry.meta.key}:${index}`)])); decipher.setAuthTag(value.subarray(12, 28));
        value = Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]);
      } catch (_error) { const error = new Error('Der verschlüsselte Teildownload kann mit diesem Archivpasswort nicht authentifiziert werden.'); error.code = 'CACHE_PASSWORD'; throw error; }
    }
    if (value.length !== chunk.bytes) throw new Error('Ein gespeicherter Teildownload ist unvollständig.');
    return value;
  }
  async prefix(entry) {
    let bytes = 0;
    for (let index = 0; index < entry.meta.chunks.length; index++) {
      const chunk = entry.meta.chunks[index];
      if (chunk.pending) {
        try { await this.readChunk(entry, chunk, index); delete chunk.pending; await writeJson(entry.file, entry.meta); }
        catch (error) {
          if (error.code === 'CACHE_PASSWORD') throw error;
          if (index !== entry.meta.chunks.length - 1) throw error;
          const file = path.join(entry.directory, `${chunk.id}.chunk`);
          let info; try { info = await regular(file); } catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
          if (info) {
            const handle = await fs.open(file, 'r'); let prefix;
            try { prefix = Buffer.alloc(this.header(entry, chunk).length); const read = await handle.read(prefix); prefix = prefix.subarray(0, read.bytesRead); } finally { await handle.close(); }
            const expected = this.header(entry, chunk);
            if (!prefix.length || !prefix.equals(expected.subarray(0, prefix.length))) throw error;
            await fs.rm(file);
          }
          entry.meta.chunks.pop(); entry.meta.complete = false; await writeJson(entry.file, entry.meta); break;
        }
      }
      const info = await regular(path.join(entry.directory, `${chunk.id}.chunk`));
      if (info.size !== this.header(entry, chunk).length + chunk.bytes + (entry.keyBytes ? 28 : 0)) { const error = new Error('Ein Teildownload ist unvollständig.'); error.code = 'CACHE_INTEGRITY'; throw error; }
      bytes += chunk.bytes;
    }
    return bytes;
  }
  async append(entry, value) {
    const chunk = { id: randomUUID(), bytes: value.length, sha256: '', pending: true }, header = this.header(entry, chunk), index = entry.meta.chunks.length;
    let encoded = value;
    if (entry.keyBytes) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', entry.keyBytes, nonce);
      cipher.setAAD(Buffer.concat([header, Buffer.from(`${entry.meta.key}:${index}`)]));
      const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]); encoded = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    }
    encoded = Buffer.concat([header, encoded]); chunk.sha256 = hash(encoded); entry.meta.chunks.push(chunk);
    await this.checkRoot(); await writeJson(entry.file, entry.meta);
    const file = path.join(entry.directory, `${chunk.id}.chunk`); let handle;
    try { handle = await fs.open(file, 'wx', 0o600); await handle.writeFile(encoded); await handle.sync(); }
    catch (error) { if (handle) await fs.rm(file, { force: true }).catch(() => {}); throw error; }
    finally { await handle?.close(); }
    delete chunk.pending; await writeJson(entry.file, entry.meta);
  }
  async reset(entry) {
    for (const chunk of entry.meta.chunks) {
      const file = path.join(entry.directory, `${chunk.id}.chunk`); await regular(file);
      const handle = await fs.open(file, 'r'), header = this.header(entry, chunk), prefix = Buffer.alloc(header.length);
      try { await handle.read(prefix); } finally { await handle.close(); }
      if (!prefix.equals(header)) throw new Error('Eine fremde Datei im Teildownload-Cache wird nicht gelöscht.');
      await fs.rm(file);
    }
    entry.meta.chunks = []; entry.meta.complete = false; entry.meta.etag = null; entry.meta.modified = null; entry.meta.total = null;
    await writeJson(entry.file, entry.meta);
  }
  async materialize(entry, file, expectedSize, expectedDigest) {
    const digest = createHash('sha256'); let bytes = 0, output, owned = false;
    try {
      output = await fs.open(file, 'wx', 0o600); owned = true;
      for (let index = 0; index < entry.meta.chunks.length; index++) {
        const value = await this.readChunk(entry, entry.meta.chunks[index], index); digest.update(value); bytes += value.length; await output.writeFile(value);
      }
      const sha256 = digest.digest('hex');
      if (expectedSize != null && bytes !== expectedSize || entry.meta.total != null && bytes !== entry.meta.total) throw downloadError('Release-Datei ist unvollständig.', true);
      if (/^sha256:[a-f\d]{64}$/i.test(expectedDigest ?? '') && sha256 !== expectedDigest.slice(7).toLowerCase()) { await this.reset(entry); throw downloadError('Die SHA256-Prüfsumme der Release-Datei stimmt nicht.', true); }
      await output.close(); output = null;
      entry.meta.complete = true; await writeJson(entry.file, entry.meta);
      return { bytes, sha256 };
    } catch (error) { await output?.close(); if (owned) await fs.rm(file, { force: true }); if (error.code === 'CACHE_INTEGRITY') { await this.reset(entry); error.retryable = true; } throw error; }
  }
  async download({ identity, file, expectedSize, expectedDigest, expectedName = '', request, transfer, onProgress = () => {} }) {
    const entry = await this.entry(identity);
    try {
      let offset;
      try { offset = await this.prefix(entry); } catch (error) { if (error.code !== 'CACHE_INTEGRITY') throw error; await this.reset(entry); offset = 0; }
      let resumedBytes = offset;
      const knownDigest = /^sha256:[a-f\d]{64}$/i.test(expectedDigest ?? '');
      if (entry.meta.complete && knownDigest) { const result = await this.materialize(entry, file, expectedSize, expectedDigest); onProgress({ status: 'downloading', asset: expectedName, downloadBytes: result.bytes, downloadTotal: result.bytes, resumedBytes: result.bytes }); return { ...result, resumedBytes: result.bytes }; }
      if (offset && (entry.meta.encoded || !knownDigest && !strongETag(entry.meta.etag) && !httpDate(entry.meta.modified))) { await this.reset(entry); offset = 0; resumedBytes = 0; }
      let restarts = 0;
      for (let part = 0; part < 1000; part++) {
        const response = await request({ offset, etag: strongETag(entry.meta.etag) ? entry.meta.etag : httpDate(entry.meta.modified) ? entry.meta.modified : null });
        if (response.status === 416 && offset) {
          await response.body?.cancel?.();
          const completeRange = response.headers?.get('content-range') === `bytes */${offset}`;
          const sameEntity = strongETag(entry.meta.etag) ? response.headers?.get('etag') === entry.meta.etag : httpDate(entry.meta.modified) && response.headers?.get('last-modified') === entry.meta.modified && strongModified(entry.meta.modified, response.headers?.get('date'));
          if (knownDigest && expectedSize === offset || completeRange && sameEntity && (expectedSize == null || expectedSize === offset)) {
            const result = await this.materialize(entry, file, expectedSize ?? offset, expectedDigest); onProgress({ status: 'downloading', asset: expectedName, downloadBytes: result.bytes, downloadTotal: result.bytes, resumedBytes }); return { ...result, resumedBytes };
          }
          if (++restarts > 1) throw downloadError('Der Server akzeptiert keine sichere Fortsetzung.');
          await this.reset(entry); offset = 0; resumedBytes = 0; continue;
        }
        if (!response.ok || !response.body) { const error = downloadError('Release-Datei konnte nicht geladen werden.', [429,500,502,503,504].includes(response.status)); error.helpCode = [401,403].includes(response.status) ? 'authentication' : 'network'; error.retryAfterMs = Number(response.headers?.get('retry-after') || 0) * 1000; throw error; }
        if (/^text\/html/i.test(response.headers?.get('content-type') ?? '') && !/\.html?$/i.test(expectedName)) { await response.body.cancel(); throw new Error('Der Server liefert eine HTML-Anmeldeseite statt der Release-Datei.'); }
        if (response.status === 200 && offset) { await this.reset(entry); offset = 0; resumedBytes = 0; }
        const encoding = response.headers?.get('content-encoding'), encoded = Boolean(encoding && encoding.toLowerCase() !== 'identity');
        if (encoded && response.status === 206) { await response.body.cancel(); if (offset && ++restarts <= 1) { await this.reset(entry); offset = 0; resumedBytes = 0; continue; } throw new Error('Komprimierte HTTP-Teilantworten können nicht sicher zusammengesetzt werden.'); }
        const etag = response.headers?.get('etag'), modified = response.headers?.get('last-modified'), date = response.headers?.get('date');
        let total = expectedSize ?? null, end = null;
        if (response.status === 206) {
          const range = response.headers?.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
          if (!range || Number(range[1]) !== offset || Number(range[2]) < offset || !Number.isSafeInteger(Number(range[3])) || Number(range[2]) >= Number(range[3]) || total != null && total !== Number(range[3]) || offset && strongETag(entry.meta.etag) && etag !== entry.meta.etag || offset && !strongETag(entry.meta.etag) && httpDate(entry.meta.modified) && (modified !== entry.meta.modified || !strongModified(modified, date))) {
            await response.body.cancel();
            if (offset && ++restarts <= 1) { await this.reset(entry); offset = 0; resumedBytes = 0; continue; }
            throw new Error('Die Fortsetzungsantwort des Servers passt nicht zum Teildownload.');
          }
          total = Number(range[3]); end = Number(range[2]) + 1;
        } else if (response.status !== 200) { await response.body.cancel(); throw new Error('Unerwartete Antwort für den Release-Download.'); }
        const length = encoded ? null : response.headers?.get('content-length');
        if (length != null) {
          if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || end != null && end - offset !== Number(length) || response.status === 200 && total != null && total !== Number(length)) { await response.body.cancel(); throw new Error('Die Dateigröße der Serverantwort stimmt nicht.'); }
          if (total == null) total = offset + Number(length);
        }
        entry.meta.etag = strongETag(etag) ? etag : null; entry.meta.modified = strongModified(modified, date) ? modified : null; entry.meta.encoded = encoded; entry.meta.total = total; await writeJson(entry.file, entry.meta);
        let buffers = [], buffered = 0, received = offset, lastProgress = 0;
        const flush = async () => { if (!buffered) return; const value = Buffer.concat(buffers, buffered); buffers = []; buffered = 0; await this.append(entry, value); offset += value.length; };
        onProgress({ status: 'downloading', asset: expectedName, downloadBytes: offset, downloadTotal: total, resumedBytes });
        try {
          for await (const raw of response.body) {
            const chunk = Buffer.from(raw); await transfer?.budget.consume(chunk.length); received += chunk.length;
            if (total != null && received > total || end != null && received > end) throw new Error('Release-Datei ist größer als angegeben.');
            for (let cursor = 0; cursor < chunk.length;) {
              const take = Math.min(this.chunkBytes - buffered, chunk.length - cursor); buffers.push(chunk.subarray(cursor, cursor + take)); buffered += take; cursor += take;
              if (buffered === this.chunkBytes) await flush();
            }
            if (Date.now() - lastProgress > 500) { lastProgress = Date.now(); onProgress({ status: 'downloading', asset: expectedName, downloadBytes: received, downloadTotal: total, resumedBytes }); }
          }
          await flush();
        } catch (error) {
          if (buffered && error.code !== 'ENOSPC') await flush().catch(() => {});
          throw error;
        }
        if (end != null && offset !== end || total != null && offset < total && end == null) throw downloadError('Release-Datei ist unvollständig.', true);
        if (total != null && offset < total) continue;
        return { ...await this.materialize(entry, file, total ?? offset, expectedDigest), resumedBytes };
      }
      throw new Error('Zu viele Teilantworten für einen Release-Download.');
    } finally { entry.keyBytes?.fill(0); }
  }
  async removeEntry(name) {
      const directory = await safeDirectory(this.directory, [name]);
      await regular(path.join(directory, 'owner.json')); const owner = await readJson(path.join(directory, 'owner.json'), null);
      if (owner?.format !== 'git-cloner-release-entry' || owner.version !== 1 || owner.key !== name) throw new Error('Ein fremder Teildownload-Ordner wird nicht entfernt.');
      const info = await regular(path.join(directory, 'parts.json')); if (info.size > 8 * 1048576) throw new Error('Die Teildownload-Kennung ist zu umfangreich.'); const meta = await readJson(path.join(directory, 'parts.json'), null);
      if (meta?.format !== 'git-cloner-release-parts' || meta.key !== name || !uuid(meta.owner) || !Array.isArray(meta.chunks)) throw new Error('Eine fremde Teildownload-Kennung wird nicht entfernt.');
      const files = new Set(['owner.json', 'parts.json', ...meta.chunks.map(chunk => `${chunk.id}.chunk`)]);
      if ((await fs.readdir(directory)).some(file => !files.has(file))) throw new Error('Fremde Dateien im Teildownload-Cache bleiben erhalten.');
      for (const chunk of meta.chunks) {
        if (!uuid(chunk.id)) throw new Error('Ungültige Teildownload-Kennung.');
        const file = path.join(directory, `${chunk.id}.chunk`); await regular(file);
        const handle = await fs.open(file, 'r'), expected = this.header({ meta }, chunk), prefix = Buffer.alloc(expected.length);
        try { await handle.read(prefix); } finally { await handle.close(); }
        if (!prefix.equals(expected)) throw new Error('Eine fremde Teildownload-Datei wird nicht entfernt.');
      }
      await fs.rm(directory, { recursive: true });
  }
  async sweep() {
    await this.checkRoot();
    for (const name of await fs.readdir(this.directory)) if (/^[a-f\d]{64}$/.test(name)) {
      const directory = await safeDirectory(this.directory, [name]), info = await regular(path.join(directory, 'parts.json'));
      if (Date.now() - info.mtimeMs > 7 * 86400000) await this.removeEntry(name);
    }
  }
  async clear() {
    await this.checkRoot();
    for (const name of await fs.readdir(this.directory)) if (/^[a-f\d]{64}$/.test(name)) await this.removeEntry(name);
  }
  async close() { this.passphrase = ''; await this.release?.(); this.release = null; }
}

module.exports = { ReleaseDownloads, strongETag, strongModified, CHUNK_BYTES };
