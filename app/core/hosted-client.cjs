const fs = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const { lookup } = require('node:dns/promises');
const { isIP } = require('node:net');
const { retry } = require('./retry.cjs');
const { responseRateLimit, observeRate, budgetError } = require('./rate-limit.cjs');
const { readBody, cachedData, remember, CACHE_LIMIT } = require('./response-cache.cjs');
const { providerSpec, parseHostedSource, cloneURL } = require('./provider-spec.cjs');
function privateAddress(value) {
  const ip = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return ip === '::' || ip === '::1' || /^f[cd]|^fe[89ab]|^::ffff:/.test(ip);
}
class HostedClient {
  constructor({
    provider,
    server,
    token = '',
    username = '',
    fetchImpl = fetch,
    resolveHost = lookup,
    cacheLimit = CACHE_LIMIT,
    retryOptions = {}
  }) {
    Object.assign(this, providerSpec({ provider, server }), {
      token,
      username,
      fetchImpl,
      resolveHost,
      cacheLimit,
      retryOptions
    });
    this.apiBase = this.server + (provider === 'gitlab' ? '/api/v4' : '/api/v1');
    this.cache = new Map();
    this.cacheStats = { bytes: 0 };
    this.pagination = new Map();
    this.rateState = {};
  }
  budgetError(reserve) {
    return budgetError(this.rateState, { reserve, label: this.label() });
  }
  headers(url, download = false) {
    const target = new URL(url),
      base = new URL(this.server),
      bound =
        target.origin === base.origin &&
        (target.pathname === base.pathname || target.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/'));
    return {
      'User-Agent': 'Git-Cloner',
      ...(this.token && bound
        ? this.provider === 'gitlab'
          ? { 'PRIVATE-TOKEN': this.token }
          : {
              Authorization:
                download && this.username && !target.pathname.startsWith(new URL(this.apiBase).pathname + '/')
                  ? `Basic ${Buffer.from(`${this.username}:${this.token}`).toString('base64')}`
                  : `token ${this.token}`
            }
        : {})
    };
  }
  label() {
    return this.provider === 'gitlab' ? 'GitLab' : 'Forgejo';
  }
  withTransfer(transfer, retries = 2) {
    const client = Object.create(this);
    client.transfer = transfer;
    client.retryOptions = { ...this.retryOptions, retries };
    return client;
  }
  request(endpoint, options = {}) {
    return retry(() => this.requestOnce(endpoint, options), this.retryOptions);
  }
  async requestOnce(endpoint, { allow404 = false, signal } = {}) {
    if (
      typeof endpoint !== 'string' ||
      !endpoint.startsWith('/') ||
      endpoint.startsWith('//') ||
      endpoint.includes('://') ||
      /[\\\r\n\0]/.test(endpoint)
    )
      throw new Error('Ungültiger API-Endpunkt.');
    signal?.throwIfAborted();
    const url = this.apiBase + endpoint,
      cached = this.cache.get(endpoint);
    const response = await this.fetchImpl(url, {
      headers: {
        ...this.headers(url),
        Accept: 'application/json',
        ...(cached?.etag ? { 'If-None-Match': cached.etag } : {})
      },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
    });
    observeRate(this.rateState, response.headers);
    if (response.status === 304 && cached) return cachedData(this, endpoint, cached);
    if (response.status === 404 && allow404) return null;
    if (!response.ok) {
      const limited = await responseRateLimit(response, { label: this.label() });
      if (limited) throw limited;
      const error = new Error(
        [401, 403].includes(response.status)
          ? 'Zugriff nicht erlaubt. Token und Repository-Berechtigungen prüfen.'
          : response.status === 404
            ? 'Git-Quelle nicht gefunden oder keine Zugriffsberechtigung.'
            : `Der Git-Server antwortet mit HTTP ${response.status}.`
      );
      error.helpCode = [401, 403].includes(response.status)
        ? 'authentication'
        : response.status === 429
          ? 'rate'
          : 'network';
      error.retryable = [429, 500, 502, 503, 504].includes(response.status);
      error.retryAfterMs = Number(response.headers?.get('retry-after') || 0) * 1000;
      throw error;
    }
    const body = await readBody(response),
      etag = response.headers?.get('etag'),
      next = response.headers?.get('x-next-page'),
      link = response.headers?.get('link'),
      total = response.headers?.get('x-total-count');
    this.pagination.set(endpoint, {
      next: next != null ? Boolean(next) : link != null ? /rel="?next"?/.test(link) : null,
      total: total == null ? null : Number(total)
    });
    if (this.pagination.size > 2000) this.pagination.delete(this.pagination.keys().next().value);
    remember(this, endpoint, etag, body);
    return body.data;
  }
  async collection(endpoint, { signal } = {}) {
    const items = [];
    for (let page = 1; page <= 1000; page++) {
      const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}${this.provider === 'gitlab' ? 'per_page' : 'limit'}=100&page=${page}`,
        batch = await this.request(url, { signal });
      if (!Array.isArray(batch)) throw new Error('Ungültige Repository- oder Metadatenliste.');
      items.push(...batch);
      if (items.length > 100000) throw new Error('Die API-Dateiliste ist zu umfangreich.');
      const hint = this.pagination.get(url);
      if (
        !batch.length ||
        hint?.next === false ||
        (hint?.next !== true && (hint?.total == null ? batch.length < 100 : items.length >= hint.total))
      )
        return items;
    }
    throw new Error('Zu viele API-Seiten für einen Durchlauf.');
  }
  normalize(value) {
    const fullName = parseHostedSource(
      this.provider === 'gitlab' ? value.path_with_namespace : value.full_name,
      'repository',
      this
    );
    return {
      ...value,
      full_name: fullName,
      clone_url: cloneURL(this, fullName),
      default_branch: value.default_branch || 'main',
      fork: this.provider === 'gitlab' ? Boolean(value.forked_from_project) : Boolean(value.fork),
      archived: Boolean(value.archived),
      has_wiki: this.provider === 'gitlab' ? Boolean(value.wiki_enabled) : value.has_wiki,
      size:
        this.provider === 'gitlab'
          ? Number.isFinite(value.statistics?.repository_size)
            ? Math.ceil(value.statistics.repository_size / 1024)
            : null
          : Number.isFinite(value.size)
            ? value.size
            : null
    };
  }
  projectPath(fullName) {
    return this.provider === 'gitlab'
      ? `/projects/${encodeURIComponent(parseHostedSource(fullName, 'repository', this))}`
      : `/repos/${parseHostedSource(fullName, 'repository', this)}`;
  }
  async repository(fullName, options) {
    return this.normalize(await this.request(this.projectPath(fullName), options));
  }
  async repositories(owner) {
    owner = parseHostedSource(owner, 'owner', this);
    if (this.provider === 'gitlab') {
      const group = await this.request(`/groups/${encodeURIComponent(owner)}`, { allow404: true });
      if (group)
        return (await this.collection(`/groups/${group.id}/projects?include_subgroups=true&with_shared=false`))
          .map(r => this.normalize(r))
          .filter(r => r.full_name.toLowerCase().startsWith(owner.toLowerCase() + '/'));
      if (owner.includes('/')) throw new Error('GitLab-Gruppe nicht gefunden oder keine Zugriffsberechtigung.');
      const users = await this.request(`/users?username=${encodeURIComponent(owner)}`),
        user = Array.isArray(users) && users.find(u => u.username?.toLowerCase() === owner.toLowerCase());
      if (!user) throw new Error('GitLab-Konto nicht gefunden.');
      return (await this.collection(`/users/${user.id}/projects?owned=true`))
        .map(r => this.normalize(r))
        .filter(r => r.full_name.split('/')[0].toLowerCase() === owner.toLowerCase());
    }
    if (this.token) {
      const user = await this.request('/user');
      if (user.login?.toLowerCase() === owner.toLowerCase())
        return (await this.collection('/user/repos'))
          .map(r => this.normalize(r))
          .filter(r => r.full_name.split('/')[0].toLowerCase() === owner.toLowerCase());
    }
    const organization = await this.request(`/orgs/${owner}`, { allow404: true });
    return (await this.collection(organization ? `/orgs/${owner}/repos` : `/users/${owner}/repos`))
      .map(r => this.normalize(r))
      .filter(r => r.full_name.split('/')[0].toLowerCase() === owner.toLowerCase());
  }
  async repositoryContext(owner, { signal } = {}) {
    owner = parseHostedSource(owner, 'owner', this);
    if (this.provider === 'gitlab') {
      const group = await this.request(`/groups/${encodeURIComponent(owner)}`, { allow404: true, signal });
      if (group)
        return {
          owner,
          endpoint: `/groups/${group.id}/projects?include_subgroups=true&with_shared=false&order_by=path&sort=asc`
        };
      if (owner.includes('/')) throw new Error('GitLab-Gruppe nicht gefunden oder keine Zugriffsberechtigung.');
      const users = await this.request(`/users?username=${encodeURIComponent(owner)}`, { signal }),
        user = Array.isArray(users) && users.find(u => u.username?.toLowerCase() === owner.toLowerCase());
      if (!user) throw new Error('GitLab-Konto nicht gefunden.');
      return { owner, endpoint: `/users/${user.id}/projects?owned=true&order_by=path&sort=asc` };
    }
    const organization = await this.request(`/orgs/${owner}`, { allow404: true, signal });
    const profile = organization ?? (await this.request(`/users/${owner}`, { signal }));
    if (!Number.isSafeInteger(profile.id) || profile.id < 1)
      throw new Error('Der Git-Server liefert keine gültige Konto-ID.');
    return { owner, uid: profile.id };
  }
  async repositoryPage(context, { page = 1, perPage = 50, query = '', signal } = {}) {
    const endpoint =
      this.provider === 'gitlab'
        ? `${context.endpoint}&per_page=${perPage}&page=${page}${query ? `&search=${encodeURIComponent(query)}` : ''}`
        : `/repos/search?uid=${context.uid}&limit=${perPage}&page=${page}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
    const response = await this.request(endpoint, { signal }),
      batch = this.provider === 'gitlab' ? response : response.data;
    if (!Array.isArray(batch)) throw new Error('Ungültige Repository-Seite.');
    const hint = this.pagination.get(endpoint),
      total = this.provider === 'gitlab' ? hint?.total : response.total_count;
    return {
      repositories: batch
        .map(item => this.normalize(item))
        .filter(repo => repo.full_name.toLowerCase().startsWith(context.owner.toLowerCase() + '/')),
      hasMore: hint?.next ?? (Number.isSafeInteger(total) ? page * perPage < total : batch.length === perPage),
      total: Number.isSafeInteger(total) ? total : null
    };
  }
  async tree(fullName, revision, { signal } = {}) {
    const base = this.projectPath(fullName);
    if (this.provider === 'gitlab')
      return {
        truncated: false,
        tree: (
          await this.collection(`${base}/repository/tree?ref=${encodeURIComponent(revision)}&recursive=true`, {
            signal
          })
        ).map(entry => ({ ...entry, sha: entry.id ?? entry.sha }))
      };
    const commit = await this.request(`${base}/git/commits/${revision}`, { signal }),
      sha = commit.commit?.tree?.sha ?? commit.tree?.sha;
    if (!/^[a-f\d]{40,64}$/.test(sha ?? '')) throw new Error('Der Git-Server hat keine gültige Dateiliste geliefert.');
    const entries = [],
      seen = new Set();
    for (let page = 1; page <= 1000; page++) {
      const response = await this.request(`${base}/git/trees/${sha}?recursive=true&per_page=1000&page=${page}`, {
        signal
      });
      if (!Array.isArray(response.tree)) throw new Error('Ungültige Git-Dateiliste.');
      for (const entry of response.tree) {
        if (seen.has(entry.path)) throw new Error('Der Git-Server liefert keine eindeutigen Dateiseiten.');
        seen.add(entry.path);
        entries.push(entry);
      }
      if (entries.length > 100000) throw new Error('Die API-Dateiliste ist zu umfangreich.');
      const more =
        response.truncated || (Number.isSafeInteger(response.total_count) && entries.length < response.total_count);
      if (!more) return { truncated: false, tree: entries };
      if (!response.tree.length) throw new Error('Die Git-Dateiliste ist unvollständig.');
    }
    throw new Error('Zu viele Git-Dateiseiten.');
  }
  blob(fullName, sha, { signal } = {}) {
    return this.request(
      `${this.projectPath(fullName)}/${this.provider === 'gitlab' ? 'repository' : 'git'}/blobs/${sha}`,
      { signal }
    );
  }
  async blobInfo(fullName, file, revision, { signal } = {}) {
    if (this.provider !== 'gitlab') return null;
    const url = `${this.apiBase}${this.projectPath(fullName)}/repository/files/${encodeURIComponent(file)}?ref=${encodeURIComponent(revision)}`,
      response = await this.fetchImpl(url, {
        method: 'HEAD',
        headers: this.headers(url),
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
      });
    if (!response.ok) throw new Error('Die Dateigröße konnte nicht sicher ermittelt werden.');
    const size = Number(response.headers?.get('x-gitlab-size')),
      sha = response.headers?.get('x-gitlab-blob-id');
    if (
      response.headers?.get('x-gitlab-size') == null ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !/^[a-f\d]{40,64}$/.test(sha ?? '')
    )
      throw new Error('Die API liefert keine sichere Dateigröße.');
    return { size, sha };
  }
  async safeDownloadURL(value) {
    let url;
    try {
      url = new URL(value, this.server + '/');
    } catch (_error) {
      throw new Error('Ungültige Release-Adresse.');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Release-Dateien benötigen eine HTTPS-Adresse ohne Zugangsdaten.');
    if (url.origin !== new URL(this.server).origin) {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (
        (url.port && url.port !== '443') ||
        host === 'localhost' ||
        /\.(localhost|local|internal)$/.test(host) ||
        (isIP(host) && privateAddress(host))
      )
        throw new Error('Lokale externe Release-Adressen sind nicht erlaubt.');
      const addresses = await this.resolveHost(host, { all: true });
      if (!addresses.length || addresses.some(a => privateAddress(a.address)))
        throw new Error('Eine externe Release-Adresse verweist auf ein lokales Netzwerk.');
    }
    return url.href;
  }
  downloadAsset(fullName, id, file, expected = {}) {
    if (!expected.url) throw new Error('Release-Download-Adresse fehlt.');
    return retry(() => this.downloadURL(expected.url, file, expected), this.retryOptions);
  }
  async assetResponse(value, { offset = 0, etag = null, timeout = 600000, identity = offset > 0 } = {}) {
    let url = await this.safeDownloadURL(value),
      response;
    const range = {
      ...(identity ? { 'Accept-Encoding': 'identity' } : {}),
      ...(offset ? { Range: `bytes=${offset}-`, ...(etag ? { 'If-Range': etag } : {}) } : {})
    };
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await this.fetchImpl(url, {
        headers: { ...this.headers(url, true), ...range },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout)
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === 5) throw new Error('Zu viele Release-Weiterleitungen.');
      const location = response.headers?.get('location');
      if (!location) throw new Error('Release-Weiterleitung ohne Ziel.');
      await response.body?.cancel?.();
      url = await this.safeDownloadURL(new URL(location, url).href);
    }
    return response;
  }
  async downloadURL(
    value,
    file,
    { expectedSize, expectedDigest, expectedName = '', resume, onMeasure = () => {} } = {}
  ) {
    if (expectedSize != null && (!Number.isSafeInteger(expectedSize) || expectedSize < 0))
      throw new Error('Ungültige Release-Dateigröße.');
    const timeout = Math.min(
      86400000,
      Math.max(
        600000,
        this.transfer?.budget.slowestBytesPerSecond && expectedSize
          ? (expectedSize / this.transfer.budget.slowestBytesPerSecond) * 1500
          : 0
      )
    );
    if (resume)
      return resume.cache.download({
        identity: resume.identity,
        file,
        expectedSize,
        expectedDigest,
        expectedName,
        rateLabel: this.label(),
        transfer: this.transfer,
        onProgress: resume.onProgress,
        onMeasure: resume.onMeasure || onMeasure,
        request: range => this.assetResponse(value, { ...range, timeout, identity: true })
      });
    const response = await this.assetResponse(value, { timeout });
    if (!response.ok || !response.body) {
      const limited = await responseRateLimit(response, { label: this.label() });
      if (limited) throw limited;
      const error = new Error('Release-Datei konnte nicht geladen werden.');
      error.retryable = [429, 500, 502, 503, 504].includes(response.status);
      error.helpCode = [401, 403].includes(response.status) ? 'authentication' : 'network';
      throw error;
    }
    if (/^text\/html/i.test(response.headers?.get('content-type') ?? '') && !/\.html?$/i.test(expectedName)) {
      await response.body.cancel();
      const error = new Error(
        'Der Server liefert eine HTML-Anmeldeseite statt der Release-Datei. Token und Download-Berechtigungen prüfen.'
      );
      error.helpCode = 'authentication';
      throw error;
    }
    const hash = createHash('sha256');
    let bytes = 0,
      owned = false;
    const meter = new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.length;
          onMeasure({ networkBytes: chunk.length });
          hash.update(chunk);
          done(
            expectedSize != null && bytes > expectedSize ? new Error('Release-Datei ist größer als angegeben.') : null,
            chunk
          );
        }
      }),
      output = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
    output.once('open', () => {
      owned = true;
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        ...(this.transfer ? [this.transfer.budget.stream()] : []),
        output
      );
      const digest = hash.digest('hex');
      if (expectedSize != null && bytes !== expectedSize) throw new Error('Release-Datei ist unvollständig.');
      if (/^sha256:[a-f\d]{64}$/i.test(expectedDigest ?? '') && digest !== expectedDigest.slice(7).toLowerCase())
        throw new Error('Die SHA256-Prüfsumme der Release-Datei stimmt nicht.');
      return { bytes, sha256: digest };
    } catch (error) {
      if (owned) await fs.promises.rm(file, { force: true });
      throw error;
    }
  }
}
module.exports = { HostedClient, privateAddress };
