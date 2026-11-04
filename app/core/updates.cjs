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
  constructor({ currentVersion, github, state = {}, save = async () => {}, notify = () => {}, canNotify = () => true }) {
    Object.assign(this, { currentVersion, github, state, save, notify, canNotify });
    this.result = { currentVersion, status: 'idle', latestVersion: null, url: RELEASES_URL, ignoredVersion: state.ignoredVersion ?? null };
  }
  async check() {
    if (this.checking) return this.checking;
    this.result = { ...this.result, status: 'checking' };
    this.checking = (async () => {
      try {
        this.result = await checkForUpdates(this.currentVersion, this.github, this.state);
        await this.notifyAvailable();
      } catch (error) { this.result = { ...this.result, status: 'error', message: error.message }; }
      return this.result;
    })();
    try { return await this.checking; } finally { this.checking = null; }
  }
  persist() { this.saving = (this.saving ?? Promise.resolve()).catch(() => {}).then(() => this.save(structuredClone(this.state))); return this.saving; }
  async notifyAvailable() {
    if (this.notifying) return this.notifying;
    this.notifying = (async () => {
      const result = this.result;
      if (result.status !== 'available' || this.state.lastNotifiedVersion === result.latestVersion || !this.canNotify(result)) return false;
      const previous = this.state.lastNotifiedVersion;
      this.state.lastNotifiedVersion = result.latestVersion;
      try { await this.persist(); } catch (error) { this.state.lastNotifiedVersion = previous; throw error; }
      if (this.result.status === 'available' && this.result.latestVersion === result.latestVersion && this.canNotify(result)) { this.notify(result); return true; }
      if (this.result.status === 'available' && this.state.lastNotifiedVersion === result.latestVersion) { this.state.lastNotifiedVersion = previous; await this.persist(); }
      return false;
    })();
    try { return await this.notifying; } finally { this.notifying = null; }
  }
  async ignore() {
    if (this.result.status !== 'available' || !semver.valid(this.result.latestVersion)) throw new Error('Keine neuere Version zum Überspringen vorhanden.');
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

module.exports = { checkForUpdates, UpdateMonitor, RELEASES_URL };
