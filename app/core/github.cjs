const { parseSource } = require('./config.cjs');
const { retry } = require('./retry.cjs');

class GitHubClient {
  constructor({ token = '', fetchImpl = fetch, retryOptions = {}, cacheLimit = 16 * 1048576 } = {}) { Object.assign(this, { token, fetchImpl, retryOptions, cacheLimit }); this.cache = new Map(); this.cacheStats = {bytes:0}; }
  withTransfer(transfer, retries = 2) { const client = Object.create(this); client.transfer = transfer; client.retryOptions = { ...this.retryOptions, retries }; return client; }
  async request(endpoint, { allow404 = false, signal } = {}) {
    return retry(() => this.requestOnce(endpoint, { allow404, signal }), this.retryOptions);
  }
  async requestOnce(endpoint, { allow404 = false, signal } = {}) {
    signal?.throwIfAborted();
    if (typeof endpoint !== 'string' || !endpoint.startsWith('/') || endpoint.startsWith('//') || endpoint.includes('://')) throw new Error('Ungültiger GitHub-Endpunkt.');
    const cached = this.cache.get(endpoint);
    const response = await this.fetchImpl(`https://api.github.com${endpoint}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Git-Cloner', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
      signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), redirect: 'error'
    });
    if (response.status === 304 && cached) return structuredClone(cached.data);
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      if ([429,500,502,503,504].includes(response.status) || response.status === 403 && (response.headers?.get('retry-after') || response.headers?.get('x-ratelimit-remaining') === '0')) {
        const error = new Error(`GitHub antwortet vorübergehend mit HTTP ${response.status}.`); error.retryable = true;
        const after = response.headers?.get('retry-after'); error.retryAfterMs = after ? (Number(after) * 1000 || Date.parse(after) - Date.now()) : 0;
        throw error;
      }
      if ([403, 429].includes(response.status)) throw new Error('GitHub-Zugriff begrenzt. Token/Berechtigungen prüfen oder später erneut versuchen.');
      if (response.status === 401) throw new Error('GitHub-Token ist ungültig oder abgelaufen.');
      if (response.status === 404) throw new Error('GitHub-Quelle nicht gefunden oder keine Zugriffsberechtigung.');
      throw new Error(`GitHub antwortet mit HTTP ${response.status}.`);
    }
    const data = await response.json();
    const etag = response.headers?.get('etag');
    if (etag) {
      const size = Buffer.byteLength(JSON.stringify(data));
      if (size <= this.cacheLimit) {
        const old = this.cache.get(endpoint); if (old) { this.cacheStats.bytes -= old.size ?? 0; this.cache.delete(endpoint); }
        while (this.cache.size && (this.cache.size >= 2000 || this.cacheStats.bytes + size > this.cacheLimit)) { const key = this.cache.keys().next().value; this.cacheStats.bytes -= this.cache.get(key).size ?? 0; this.cache.delete(key); }
        this.cache.set(endpoint, { etag, data, size }); this.cacheStats.bytes += size;
      }
    }
    return structuredClone(data);
  }
  async repository(value, options) {
    const name = parseSource(value, 'repository');
    return this.request(`/repos/${name}`,options);
  }
  async repositories(owner) {
    parseSource(owner, 'owner');
    const profile = await this.request(`/users/${owner}`);
    let endpoint = profile.type === 'Organization' ? `/orgs/${owner}/repos?type=all` : `/users/${owner}/repos?type=owner`;
    if (this.token && profile.type !== 'Organization') {
      const user = await this.request('/user');
      if (user.login.toLowerCase() === owner.toLowerCase()) endpoint = '/user/repos?affiliation=owner&visibility=all';
    }
    const repos = [];
    for (let page = 1; page <= 1000; page++) {
      const batch = await this.request(`${endpoint}&per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('Ungültige Repository-Liste von GitHub.');
      repos.push(...batch.filter(repo => repo.owner?.login?.toLowerCase() === owner.toLowerCase()));
      if (batch.length < 100) return repos;
    }
    throw new Error('Zu viele Repositories für einen einzelnen Durchlauf.');
  }
  async collection(endpoint) {
    const items = [];
    for (let page = 1; page <= 10000; page++) {
      const data = await this.request(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(data)) throw new Error('Ungültige GitHub-Liste.');
      items.push(...data);
      if (data.length < 100) return items;
    }
    throw new Error('Zu viele Metadaten für einen Durchlauf.');
  }
  async downloadAsset(fullName, id, file, expected = {}) {
    return retry(() => this.downloadAssetOnce(fullName,id,file,expected),this.retryOptions);
  }
  async downloadAssetOnce(fullName, id, file, { expectedSize, expectedDigest } = {}) {
    const fs = require('node:fs');
    const { Readable, Transform } = require('node:stream');
    const { createHash } = require('node:crypto');
    const { pipeline } = require('node:stream/promises');
    parseSource(fullName, 'repository');
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Ungültiges Release-Asset.');
    if (expectedSize != null && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) throw new Error('Ungültige Größe einer Release-Datei.');
    let response = await this.fetchImpl(`https://api.github.com/repos/${fullName}/releases/assets/${id}`, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'Git-Cloner', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(600000)
    });
    if ([301, 302, 307, 308].includes(response.status)) {
      const url = new URL(response.headers.get('location'));
      if (url.protocol !== 'https:' || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)) throw new Error('Ungültige Asset-Weiterleitung.');
      response = await this.fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(600000) });
    }
    if (!response.ok || !response.body) { const error = new Error('Release-Datei konnte nicht geladen werden.'); error.retryable = [429,500,502,503,504].includes(response.status); throw error; }
    let bytes = 0; const hash = createHash('sha256');
    const meter = new Transform({ transform(chunk,_encoding,done) { bytes += chunk.length; hash.update(chunk); if (Number.isSafeInteger(expectedSize) && bytes > expectedSize) done(new Error('Release-Datei ist größer als von GitHub angegeben.')); else done(null,chunk); } });
    const stages = [Readable.fromWeb(response.body),meter]; if (this.transfer) stages.push(this.transfer.budget.stream());
    const output = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }); let owned = false; output.once('open',() => { owned = true; });
    try {
      await pipeline(...stages,output); const digest = hash.digest('hex');
      if (Number.isSafeInteger(expectedSize) && bytes !== expectedSize) throw new Error('Release-Datei ist unvollständig.');
      if (typeof expectedDigest === 'string' && /^sha256:[a-f\d]{64}$/i.test(expectedDigest) && digest !== expectedDigest.slice(7).toLowerCase()) throw new Error('Die SHA256-Prüfsumme der Release-Datei stimmt nicht.');
      return { bytes, sha256: digest };
    } catch (error) { if (owned) await fs.promises.rm(file,{force:true}); throw error; }
  }
}

module.exports = { GitHubClient };
