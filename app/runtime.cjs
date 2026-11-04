const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { defaults, validateConfig, effectiveBackup } = require('./core/config.cjs');
const { readJson, writeJson } = require('./core/store.cjs');
const { SecretVault } = require('./core/vault.cjs');
const { GitHubClient } = require('./core/github.cjs');
const { Git } = require('./core/git.cjs');
const { BackupService, verifyBackup } = require('./core/backup.cjs');
const { restoreBackup } = require('./core/restore.cjs');
const { acquireLease } = require('./core/lease.cjs');
const { prepareDestination } = require('./core/destinations.cjs');
const { Scheduler, nextRun, dueRun } = require('./core/schedule.cjs');
const { DriveMonitor } = require('./core/drive-monitor.cjs');
const { UpdateMonitor } = require('./core/updates.cjs');
const { DeviceFlow } = require('./core/device-flow.cjs');
const { previewConfig, spaceAt } = require('./core/preview.cjs');
const { networkName, restriction } = require('./core/network-rules.cjs');
const { dashboard } = require('./core/metrics.cjs');
const { RestoreBrowser } = require('./core/selective-restore.cjs');

class Runtime extends EventEmitter {
  constructor({ directory, safeStorage, version, fetchImpl = fetch, updateFetch, applyOS = async () => {}, notifyUpdate = () => {}, environmentState = async () => ({ onBattery: null }), gitFactory = options => new Git(options) }) {
    super(); Object.assign(this, { directory, safeStorage, version, fetchImpl, updateFetch, applyOS, notifyUpdate, environmentState, gitFactory });
    this.clients = new Map(); this.gitClients = new Map(); this.notice = null; this.operation = null; this.device = null;
    this.dataRevision = 0; this.configRevision = 0; this.saving = false; this.disks = []; this.environment = { onBattery: null, network: null }; this.lastEnvironmentAt = 0;
  }
  changed() { this.emit('change'); }
  busy() { return this.backup.busy || Boolean(this.operation); }
  client(id = 'default') {
    if (!this.clients.has(id)) this.clients.set(id, new GitHubClient({ token: this.vault.tokens[id] || '', fetchImpl: this.fetchImpl }));
    return this.clients.get(id);
  }
  gitFor(id = 'default') {
    if (!this.gitClients.has(id)) this.gitClients.set(id, this.gitFactory({ token: this.vault.tokens[id] || '' }));
    return this.gitClients.get(id);
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    this.config = validateConfig(await readJson(path.join(this.directory, 'settings.json'), defaults()));
    this.vault = new SecretVault(this.directory, this.safeStorage);
    try { await this.vault.load(); } catch (error) { this.notice = error.message; }
    this.git = this.gitFor();
    try { this.gitVersion = await this.git.version(); } catch (error) { this.gitVersion = null; this.notice = error.message; }
    const state = await readJson(path.join(this.directory, 'state.json'), {});
    const externalHistory = await readJson(path.join(this.directory, 'history.json'), null);
    if (externalHistory) state.history = externalHistory;
    if (state.queue) {
      state.queue.config = validateConfig(state.queue.config);
      if (!Array.isArray(state.queue.jobs) || state.queue.jobs.length > 100000 || !Array.isArray(state.queue.completed) || !Array.isArray(state.queue.results)) throw new Error('Die gespeicherte Warteschlange ist beschädigt.');
      state.queue.pauseReason ||= 'restart';
      for (const job of state.queue.jobs) { job.source = validateConfig({ ...state.queue.config, sources: [job.source] }).sources[0]; require('./core/config.cjs').parseSource(job.repository.full_name,'repository'); }
    }
    const records = {};
    for (const record of Object.values(state.repositories ?? {})) {
      const id = record.id || createHash('sha256').update(`${record.fullName.toLowerCase()}\0${path.resolve(record.destination)}`).digest('hex').slice(0, 24);
      records[id] = { ...record, id };
    }
    this.backup = new BackupService({
      state: { ...state, repositories: records }, git: this.git,
      github: source => this.client(source.accountId), getGit: source => this.gitFor(source.accountId),
      getPassphrase: async () => this.vault.archivePassword, acquireLock: () => acquireLease(this.directory),
      saveState: value => this.persistState(value), gate: execution => this.checkRules(execution)
    });
    this.backup.on('change', () => this.changed());
    this.backup.on('data', () => { this.dataRevision++; this.changed(); });
    this.updates = new UpdateMonitor({
      currentVersion: this.version,
      github: this.updateFetch ? new GitHubClient({ fetchImpl: this.updateFetch }) : this.client(),
      state: await readJson(path.join(this.directory, 'updates.json'), {}),
      save: value => writeJson(path.join(this.directory, 'updates.json'), value), notify: result => this.notifyUpdate(result)
    });
    this.scheduler = new Scheduler({ getConfig: () => this.config, getLastRun: () => this.backup.state.lastScheduledAt, run: due => this.run({ scheduledAt: due }), onError: error => { this.notice = error.message; this.changed(); } });
    this.drives = new DriveMonitor({ getConfig: () => this.config, run: onlyTargets => this.run({ trigger: 'drive', onlyTargets }), onError: error => { this.notice = error.message; this.changed(); } });
    this.deviceFlow = new DeviceFlow({ fetchImpl: this.fetchImpl });
    this.browser = new RestoreBrowser({ git: this.git });
    await this.refreshDisks();
    return this;
  }
  async persistState(value) {
    const { history = [], ...current } = value;
    await writeJson(path.join(this.directory, 'state.json'), { ...current, history: [] });
    const signature = `${history.length}:${history[0]?.finishedAt}`;
    if (signature !== this.savedHistory) { await writeJson(path.join(this.directory, 'history.json'), history); this.savedHistory = signature; }
  }
  snapshot() {
    if (this.repositoryRevision !== this.dataRevision) { this.repositoryRevision = this.dataRevision; this.repositorySnapshot = Object.values(this.backup.state.repositories); }
    const metricsKey = `${this.dataRevision}:${this.backup.state.history[0]?.finishedAt}:${this.diskRevision}:${Math.floor(Date.now()/60000)}`;
    if (metricsKey !== this.metricsKey) { this.metricsKey = metricsKey; this.metricsSnapshot = dashboard(this.backup.state.repositories,this.backup.state.history,this.disks); }
    return {
      config: this.config, busy: this.busy(), progress: this.backup.progress, operation: this.operation,
      repositories: this.repositorySnapshot, history: this.backup.state.history,
      nextRun: this.config.sources.some(s => s.enabled) ? nextRun(this.config.schedule) : null,
      update: this.updates.result, gitVersion: this.gitVersion, notice: this.notice,
      tokenConfigured: Boolean(this.vault.tokens.default), secureStorage: this.vault.available(),
      accounts: [{ id: 'default', label: 'Standard', configured: Boolean(this.vault.tokens.default) }, ...this.config.accounts.map(account => ({ ...account, configured: Boolean(this.vault.tokens[account.id]) }))],
      encryptionReady: Boolean(this.vault.archivePassword), encryptionRemembered: this.vault.rememberPassword, device: this.device,
      queue: this.backup.state.queue ? { id: this.backup.state.queue.id, total: this.backup.state.queue.jobs.length, unresolved: Boolean(this.backup.state.queue.unresolved), completed: this.backup.state.queue.completed.length, pauseReason: this.backup.state.queue.pauseReason, message: this.backup.state.queue.message, elapsedMs: this.backup.state.queue.elapsedMs, receivedBytes: this.backup.state.queue.receivedBytes } : null,
      metrics: this.metricsSnapshot, environment: this.environment,
      dataRevision: this.dataRevision, configRevision: this.configRevision
    };
  }
  async run(options = {}) {
    if (this.operation || this.saving) return { busy: true };
    const config = structuredClone(this.config);
    config.backup.encryptionKeyId = this.vault.encryptionKeyId;
    return this.backup.run(config, options);
  }
  async scheduledRun() {
    if (this.backup.state.queue) return this.backup.state.queue.pauseReason === 'user' || this.backup.state.queue.pauseReason === 'restart' || this.backup.state.queue.pauseReason === 'error' ? { paused: true } : this.resume();
    const due = dueRun(this.config.schedule, this.backup.state.lastScheduledAt);
    if (due && this.config.sources.some(source => source.enabled)) return this.run({ scheduledAt: due });
    return { skipped: true };
  }
  start() { this.scheduler.start(); this.drives.start(); this.configureUpdates(); if (this.config.checkUpdates) void this.checkUpdates(); this.policyTimer = setInterval(() => void this.policyTick(),30000); this.policyTimer.unref?.(); }
  stop() { this.scheduler.stop(); this.drives.stop(); clearInterval(this.updateTimer); clearInterval(this.policyTimer); this.deviceFlow.cancel(); return this.browser.closeAll(); }
  async refreshDisks() { this.disks = await Promise.all([...new Set(this.config.sources.flatMap(s => [s.destination,...s.additionalDestinations.map(d => d.destination)]))].map(spaceAt)); this.diskRevision = (this.diskRevision || 0) + 1; this.lastDisksAt = Date.now(); }
  async checkRules(execution = this.config.execution) {
    if (!execution.onlyOnAC && !execution.allowedNetworks.length) return null;
    if (Date.now() - this.lastEnvironmentAt > 10000) {
      this.environment = { ...(await this.environmentState()), network: execution.allowedNetworks.length ? await networkName() : null };
      this.lastEnvironmentAt = Date.now(); this.changed();
    }
    return restriction(execution,this.environment);
  }
  async policyTick() {
    try { if (Date.now() - this.lastDisksAt >= 60000) await this.refreshDisks(); const q = this.backup.state.queue; if (q && !this.busy() && !['user','restart','error'].includes(q.pauseReason) && !await this.checkRules(this.config.execution)) await this.resume(); this.changed(); }
    catch (error) { this.notice = error.message; this.changed(); }
  }
  pause() { return this.backup.pause(); }
  resume() { const scheduledAt = this.backup.state.queue?.trigger === 'schedule' ? dueRun(this.config.schedule,this.backup.state.lastScheduledAt) : null; return this.run({ resume: true, scheduledAt }); }
  discard() { return this.backup.discard(); }
  preview(input) { return this.withOperation('previewing',() => previewConfig(input,source => this.client(source.accountId).withTransfer(null,input.execution?.retries ?? 2))); }
  configureUpdates() {
    clearInterval(this.updateTimer);
    if (this.config.checkUpdates) { this.updateTimer = setInterval(() => void this.checkUpdates(), 6 * 3600000); this.updateTimer.unref?.(); }
  }
  async checkUpdates() { const promise = this.updates.check(); this.changed(); const result = await promise; this.changed(); return result; }
  async ignoreUpdate() { const result = await this.updates.ignore(); this.changed(); return result; }
  async resetUpdate() { const result = await this.updates.reset(); this.changed(); return result; }
  async saveConfig(input) {
    if (this.busy() || this.saving) throw new Error('Bitte den laufenden Vorgang abwarten.');
    this.saving = true;
    try {
      const next = validateConfig(input);
      if (this.backup.state.queue) {
        const content = config => JSON.stringify({ sources: config.sources, backup: config.backup });
        if (content(next) !== content(this.config)) throw new Error('Bitte zuerst den pausierten Durchlauf fortsetzen oder verwerfen, bevor Quellen oder Sicherungsumfang geändert werden.');
      }
      const encrypted = next.backup.encryption || next.sources.some(source => effectiveBackup(next,source).encryption);
      if (encrypted && !this.vault.archivePassword) throw new Error('Bitte zuerst das Archivpasswort setzen oder entsperren.');
      if (encrypted && next.systemSchedule && !this.vault.rememberPassword) throw new Error('Für die unabhängige Zeitplanung muss das Archivpasswort im sicheren Schlüsselspeicher hinterlegt sein.');
      for (const source of next.sources) {
        const old = this.config.sources.find(s => s.id === source.id);
        if (old?.destination === source.destination && old.volumeId) source.volumeId = old.volumeId;
        else { delete source.volumeId; Object.assign(source, await prepareDestination(source)); }
        for (const target of source.additionalDestinations) {
          const previous = old?.additionalDestinations.find(t => t.id === target.id);
          if (previous?.destination === target.destination && previous.volumeId) target.volumeId = previous.volumeId;
          else { delete target.volumeId; Object.assign(target, await prepareDestination(target)); }
        }
      }
      await this.applyOS(this.config, next);
      try { await writeJson(path.join(this.directory, 'settings.json'), next); }
      catch (error) { await this.applyOS(next, this.config); throw error; }
      const updateWasEnabled = this.config.checkUpdates;
      this.config = next; this.configRevision++; this.lastEnvironmentAt = 0; await this.refreshDisks();
      this.configureUpdates(); this.changed();
      if (!updateWasEnabled && next.checkUpdates) void this.checkUpdates();
      return this.snapshot();
    } finally { this.saving = false; }
  }
  async setToken(id, token) {
    if (this.busy()) throw new Error('Bitte den laufenden Vorgang abwarten.');
    if (!['default', ...this.config.accounts.map(a => a.id)].includes(id)) throw new Error('Konto nicht gefunden.');
    await this.vault.setToken(id, token); this.clients.delete(id); this.gitClients.delete(id);
    if (id === 'default') this.updates.github = this.client();
    this.changed();
    return { configured: Boolean(this.vault.tokens[id]) };
  }
  async setPassword(password, remember) {
    if (this.busy()) throw new Error('Bitte den laufenden Vorgang abwarten.');
    await this.vault.setPassword(password, remember); this.changed(); return { ready: true };
  }
  async beginLogin(accountId) {
    if (!this.vault.available()) throw new Error('Die Anmeldung benötigt einen sicheren Schlüsselspeicher.');
    if (!['default', ...this.config.accounts.map(a => a.id)].includes(accountId)) throw new Error('Konto nicht gefunden.');
    if (!this.config.oauthClientId) throw new Error('Bitte zuerst die Client-ID einer GitHub-OAuth-App mit aktiviertem Device Flow eintragen. Alternativ ein Personal Access Token verwenden.');
    if (this.device?.status === 'pending') throw new Error('Eine Anmeldung läuft bereits.');
    this.device = { status: 'pending', accountId }; this.changed();
    void this.deviceFlow.login(this.config.oauthClientId, code => { this.device = { status: 'pending', accountId, ...code }; this.changed(); })
      .then(async token => { await this.setToken(accountId, token); this.device = { status: 'success', accountId }; this.changed(); })
      .catch(error => { this.device = { status: 'error', message: error.message, accountId }; this.changed(); });
    return { started: true };
  }
  record(id) { const record = this.backup.state.repositories[id]; if (!record) throw new Error('Sicherung nicht gefunden.'); return record; }
  async withOperation(name, fn) {
    if (this.busy() || this.saving) throw new Error('Bitte den laufenden Vorgang abwarten.');
    this.operation = name; this.changed(); let release;
    try { release = await acquireLease(this.directory); return await fn(); }
    finally { if (release) await release(); this.operation = null; this.changed(); }
  }
  verify(id, passphrase) {
    return this.withOperation('verifying', async () => {
      const record = this.record(id);
      try {
        const result = await verifyBackup(record, this.git, passphrase || this.vault.archivePassword);
        Object.assign(record, result, { verificationStatus: 'ok' });
        await this.persistState(this.backup.state); this.dataRevision++;
        return result;
      } catch (error) { record.verificationStatus = 'error'; this.dataRevision++; await this.persistState(this.backup.state); throw error; }
    });
  }
  restore({ recordId, archive, parent, name, passphrase }) {
    return this.withOperation('restoring', () => restoreBackup({ record: recordId ? this.record(recordId) : null, archive, parent, name, passphrase: passphrase || this.vault.archivePassword, git: this.git }));
  }
  browseOpen({ recordId, archive, passphrase }) { return this.withOperation('browsing',() => this.browser.open({ record: recordId ? this.record(recordId) : null, archive, passphrase: passphrase || this.vault.archivePassword })); }
  browseList(options) { return this.browser.list(options); }
  restoreSelection(options) { return this.withOperation('restoring',() => this.browser.restore(options)); }
}
module.exports = { Runtime };
