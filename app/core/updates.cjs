const semver = require('semver');
const RELEASES_URL = 'https://github.com/Ujap1994/Git-Cloner/releases';

// github.com answers /releases/latest with a redirect to the newest stable tag. Reading only that redirect costs no
// API request, so the version check never competes with backups for the 60 requests per hour without a token.
async function latestFromWeb(fetchImpl) {
  const response = await fetchImpl(`${RELEASES_URL}/latest`, {
    method: 'HEAD',
    redirect: 'manual',
    headers: { 'User-Agent': 'Git-Cloner' },
    signal: AbortSignal.timeout(30000)
  });
  const location = response.headers?.get('location') ?? '';
  if (![301, 302, 303, 307, 308].includes(response.status)) throw new Error('Unerwartete Antwort von GitHub.');
  if (location.replace(/\/$/, '') === RELEASES_URL) return { tag_name: null };
  const match = /^https:\/\/github\.com\/Ujap1994\/Git-Cloner\/releases\/tag\/([^/?#]+)$/.exec(location);
  if (!match) throw new Error('Unerwartete Weiterleitung von GitHub.');
  return { tag_name: decodeURIComponent(match[1]) };
}
async function latestRelease(github, web) {
  if (web)
    try {
      const release = await latestFromWeb(web);
      return release.tag_name ? release : null;
    } catch (_error) {
      /* The API answers below if github.com changes its redirect. */
    }
  return github.request('/repos/Ujap1994/Git-Cloner/releases/latest', { allow404: true });
}
async function checkForUpdates(currentVersion, github, { ignoredVersion = null, web = null } = {}) {
  const release = await latestRelease(github, web);
  const checkedAt = new Date().toISOString();
  if (!release) return { currentVersion, latestVersion: null, status: 'unpublished', url: RELEASES_URL, checkedAt };
  const latestVersion = semver.valid(release.tag_name);
  if (!latestVersion || !semver.valid(currentVersion)) throw new Error('Die Versionsnummer des Releases ist ungültig.');
  const newer = semver.gt(latestVersion, currentVersion);
  const ignored = newer && semver.valid(ignoredVersion) && semver.lte(latestVersion, ignoredVersion);
  return {
    currentVersion,
    latestVersion,
    ignoredVersion,
    status: ignored ? 'ignored' : newer ? 'available' : 'current',
    url: RELEASES_URL,
    checkedAt
  };
}

class UpdateMonitor {
  constructor({
    currentVersion,
    github,
    web = null,
    state = {},
    save = async () => {},
    notify = () => {},
    canNotify = () => true
  }) {
    Object.assign(this, { currentVersion, github, web, state, save, notify, canNotify });
    this.result = {
      currentVersion,
      status: 'idle',
      latestVersion: null,
      url: RELEASES_URL,
      ignoredVersion: state.ignoredVersion ?? null
    };
  }
  async check() {
    if (this.checking) return this.checking;
    this.result = { ...this.result, status: 'checking' };
    this.checking = (async () => {
      try {
        this.result = await checkForUpdates(this.currentVersion, this.github, { ...this.state, web: this.web });
        await this.notifyAvailable();
      } catch (error) {
        // Without a token, backups can use up GitHub's 60 requests per hour; the check then waits for the release instead of failing for six hours.
        this.result =
          error.rateLimited && error.rateLimitUntil
            ? { ...this.result, status: 'waiting', retryAt: error.rateLimitUntil, message: error.message }
            : { ...this.result, status: 'error', message: error.message };
      }
      return this.result;
    })();
    try {
      return await this.checking;
    } finally {
      this.checking = null;
    }
  }
  retryDue(now = Date.now()) {
    return this.result.status === 'waiting' && !this.checking && Date.parse(this.result.retryAt) <= Number(now);
  }
  persist() {
    this.saving = (this.saving ?? Promise.resolve()).catch(() => {}).then(() => this.save(structuredClone(this.state)));
    return this.saving;
  }
  async notifyAvailable() {
    if (this.notifying) return this.notifying;
    this.notifying = (async () => {
      const result = this.result;
      if (
        result.status !== 'available' ||
        this.state.lastNotifiedVersion === result.latestVersion ||
        !this.canNotify(result)
      )
        return false;
      const previous = this.state.lastNotifiedVersion;
      this.state.lastNotifiedVersion = result.latestVersion;
      try {
        await this.persist();
      } catch (error) {
        this.state.lastNotifiedVersion = previous;
        throw error;
      }
      if (
        this.result.status === 'available' &&
        this.result.latestVersion === result.latestVersion &&
        this.canNotify(result)
      ) {
        this.notify(result);
        return true;
      }
      if (this.result.status === 'available' && this.state.lastNotifiedVersion === result.latestVersion) {
        this.state.lastNotifiedVersion = previous;
        await this.persist();
      }
      return false;
    })();
    try {
      return await this.notifying;
    } finally {
      this.notifying = null;
    }
  }
  async ignore() {
    if (this.result.status !== 'available' || !semver.valid(this.result.latestVersion))
      throw new Error('Keine neuere Version zum Überspringen vorhanden.');
    this.state.ignoredVersion = this.result.latestVersion;
    await this.persist();
    this.result = { ...this.result, status: 'ignored', ignoredVersion: this.state.ignoredVersion };
    return this.result;
  }
  async reset() {
    this.state.ignoredVersion = null;
    this.state.lastNotifiedVersion = null;
    await this.persist();
    return this.check();
  }
}

module.exports = { latestFromWeb, checkForUpdates, UpdateMonitor, RELEASES_URL };
