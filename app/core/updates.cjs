const semver = require('semver');
const RELEASES_URL = 'https://github.com/Ujap1994/Git-Cloner/releases';

async function checkForUpdates(currentVersion, github, { ignoredVersion = null } = {}) {
  const release = await github.request('/repos/Ujap1994/Git-Cloner/releases/latest', { allow404: true });
  const checkedAt = new Date().toISOString();
  if (!release) return { currentVersion, latestVersion: null, status: 'unpublished', url: RELEASES_URL, checkedAt };
  const latestVersion = semver.valid(release.tag_name);
  if (!latestVersion || !semver.valid(currentVersion)) throw new Error('Die Versionsnummer des Releases ist ungültig.');
  const newer = semver.gt(latestVersion, currentVersion);
  const ignored = newer && semver.valid(ignoredVersion) && semver.lte(latestVersion, ignoredVersion);
  return { currentVersion, latestVersion, ignoredVersion, status: ignored ? 'ignored' : newer ? 'available' : 'current', url: RELEASES_URL, checkedAt };
}

class UpdateMonitor {
  constructor({ currentVersion, github, state = {}, save = async () => {}, notify = () => {} }) {
    Object.assign(this, { currentVersion, github, state, save, notify });
    this.result = { currentVersion, status: 'idle', latestVersion: null, url: RELEASES_URL, ignoredVersion: state.ignoredVersion ?? null };
  }
  async check() {
    if (this.checking) return this.checking;
    this.result = { ...this.result, status: 'checking' };
    this.checking = (async () => {
      try {
        this.result = await checkForUpdates(this.currentVersion, this.github, this.state);
        if (this.result.status === 'available' && this.state.lastNotifiedVersion !== this.result.latestVersion) {
          this.state.lastNotifiedVersion = this.result.latestVersion;
          await this.save(this.state);
          this.notify(this.result);
        }
      } catch (error) { this.result = { ...this.result, status: 'error', message: error.message }; }
      return this.result;
    })();
    try { return await this.checking; } finally { this.checking = null; }
  }
  async ignore() {
    if (this.result.status !== 'available' || !semver.valid(this.result.latestVersion)) throw new Error('Keine neuere Version zum Überspringen vorhanden.');
    this.state.ignoredVersion = this.result.latestVersion;
    await this.save(this.state);
    this.result = { ...this.result, status: 'ignored', ignoredVersion: this.state.ignoredVersion };
    return this.result;
  }
  async reset() {
    this.state.ignoredVersion = null;
    this.state.lastNotifiedVersion = null;
    await this.save(this.state);
    return this.check();
  }
}

module.exports = { checkForUpdates, UpdateMonitor, RELEASES_URL };
