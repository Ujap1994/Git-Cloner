const { parseSource } = require('./config.cjs');
const { retry } = require('./retry.cjs');

class GitHubClient {
  constructor({ token = '', fetchImpl = fetch, retryOptions = {}, cacheLimit = 16 * 1048576 } = {}) { Object.assign(this, { token, fetchImpl, retryOptions, cacheLimit }); this.cache = new Map(); this.cacheStats = {bytes:0}; this.pagination = new Map(); }
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
    const link = response.headers?.get('link');
    this.pagination.set(endpoint, { next: link == null ? null : /rel="?next"?/.test(link) });
    if (this.pagination.size > 2000) this.pagination.delete(this.pagination.keys().next().value);
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
  async repositoryContext(owner, { signal } = {}) {
    owner = parseSource(owner, 'owner');
    const profile = await this.request(`/users/${owner}`, { signal });
    let endpoint = profile.type === 'Organization' ? `/orgs/${owner}/repos?type=all` : `/users/${owner}/repos?type=owner`;
    if (this.token && profile.type !== 'Organization') {
      const user = await this.request('/user', { signal });
      if (user.login?.toLowerCase() === owner.toLowerCase()) endpoint = '/user/repos?affiliation=owner&visibility=all';
    }
    return { owner, endpoint };
  }
  async repositoryPage(context, { page = 1, perPage = 50, query = '', signal } = {}) {
    let endpoint, data, batch, total = null, limited = false;
    if (query) {
      const search = `user:${context.owner} in:name fork:true "${query.replace(/["\\]/g, '\\$&')}"`;
      endpoint = `/search/repositories?q=${encodeURIComponent(search)}&sort=updated&order=desc&per_page=${perPage}&page=${page}`;
      data = await this.request(endpoint, { signal }); batch = data.items; total = data.total_count;
      limited = Boolean(data.incomplete_results) || total > 1000;
    } else {
      endpoint = `${context.endpoint}&sort=full_name&direction=asc&per_page=${perPage}&page=${page}`;
      batch = await this.request(endpoint, { signal });
    }
    if (!Array.isArray(batch)) throw new Error('Ungültige Repository-Seite von GitHub.');
    const hint = this.pagination.get(endpoint);
    const hasMore = query ? page * perPage < Math.min(total ?? 0, 1000) : hint?.next ?? batch.length === perPage;
    return { repositories: batch.filter(repo => repo.full_name?.split('/')[0].toLowerCase() === context.owner.toLowerCase()), hasMore, total, limited };
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
  async assetResponse(fullName, id, { offset = 0, etag = null, timeout = 600000, identity = offset > 0 } = {}) {
    const range = { ...(identity ? { 'Accept-Encoding': 'identity' } : {}), ...(offset ? { Range: `bytes=${offset}-`, ...(etag ? { 'If-Range': etag } : {}) } : {}) };
    let response = await this.fetchImpl(`https://api.github.com/repos/${fullName}/releases/assets/${id}`, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'Git-Cloner', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...range }, redirect: 'manual', signal: AbortSignal.timeout(timeout)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const url = new URL(response.headers.get('location'));
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)) throw new Error('Ungültige Asset-Weiterleitung.');
      await response.body?.cancel?.();
      response = await this.fetchImpl(url.href, { ...(offset || identity ? { headers: range } : {}), redirect: 'error', signal: AbortSignal.timeout(timeout) });
    }
    return response;
  }
  async downloadAssetOnce(fullName, id, file, { expectedSize, expectedDigest, expectedName = '', resume, onMeasure = () => {} } = {}) {
    const fs = require('node:fs');
    const { Readable, Transform } = require('node:stream');
    const { createHash } = require('node:crypto');
    const { pipeline } = require('node:stream/promises');
    parseSource(fullName, 'repository');
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Ungültiges Release-Asset.');
    if (expectedSize != null && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) throw new Error('Ungültige Größe einer Release-Datei.');
    const timeout = Math.min(86400000, Math.max(600000, this.transfer?.budget.bytesPerSecond && expectedSize ? expectedSize / this.transfer.budget.bytesPerSecond * 1500 : 0));
    if (resume) return resume.cache.download({ identity: resume.identity, file, expectedSize, expectedDigest, expectedName, transfer: this.transfer, onProgress: resume.onProgress, onMeasure: resume.onMeasure || onMeasure, request: range => this.assetResponse(fullName, id, { ...range, timeout, identity: true }) });
    const response = await this.assetResponse(fullName, id, { timeout });
    if (!response.ok || !response.body) { const error = new Error('Release-Datei konnte nicht geladen werden.'); error.retryable = [429,500,502,503,504].includes(response.status); throw error; }
    let bytes = 0; const hash = createHash('sha256');
    const meter = new Transform({ transform(chunk,_encoding,done) { bytes += chunk.length; onMeasure({ networkBytes: chunk.length }); hash.update(chunk); if (Number.isSafeInteger(expectedSize) && bytes > expectedSize) done(new Error('Release-Datei ist größer als von GitHub angegeben.')); else done(null,chunk); } });
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
