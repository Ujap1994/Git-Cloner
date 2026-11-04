const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { defaults, validateConfig, effectiveBackup, effectiveSchedule } = require('./core/config.cjs');
const { readJson, writeJson } = require('./core/store.cjs');
const { SecretVault } = require('./core/vault.cjs');
const { GitHubClient } = require('./core/github.cjs');
const { Git } = require('./core/git.cjs');
const { BackupService, verifyBackup, backupFingerprint, managed } = require('./core/backup.cjs');
const { restoreBackup } = require('./core/restore.cjs');
const { acquireLease } = require('./core/lease.cjs');
const { prepareDestination, safeDirectory } = require('./core/destinations.cjs');
const { releaseDirectoryName } = require('./core/release-layout.cjs');
const { Scheduler, nextRun, dueSources, nextConfigRun } = require('./core/schedule.cjs');
const { notificationAllowed } = require('./core/notifications.cjs');
const { DriveMonitor } = require('./core/drive-monitor.cjs');
const { UpdateMonitor } = require('./core/updates.cjs');
const { DeviceFlow } = require('./core/device-flow.cjs');
const { previewConfig, spaceAt } = require('./core/preview.cjs');
const { networkName, restriction } = require('./core/network-rules.cjs');
const { dashboard } = require('./core/metrics.cjs');
const { RestoreBrowser } = require('./core/selective-restore.cjs');
const { ChangesPreview } = require('./core/changes.cjs');
const { rememberHints, findRelocations, persistRelocations, recoverRelocations } = require('./core/relocation.cjs');
const {HostedClient}=require('./core/hosted-client.cjs');
const {providerSpec,providerKey,parseHostedSource}=require('./core/provider-spec.cjs');
const {queryHistory,exportHistory,historyDetails}=require('./core/history.cjs');
const {spaceReady}=require('./core/space-wait.cjs');
const {rotationInventory,rotatePasswords,recoverRotations}=require('./core/key-rotation.cjs');
const {inspectRecommendations}=require('./core/recommendations.cjs');
const { organizeConfig, prepareBulk, configSignature, RepositoryBrowser } = require('./core/source-workspace.cjs');

class Runtime extends EventEmitter {
  async releaseDestination(id) {
    const record = this.backup.state.repositories[id];
    if (!record) throw new Error('Sicherung nicht gefunden.');
    const marker = await managed(record.destination, record.fullName);
    if (marker.encrypted) throw new Error('Release-Dateien liegen im verschlüsselten Archiv. Bitte über die Wiederherstellung entsperren.');
    if (!releaseDirectoryName(marker.releaseInfo?.assetDirectory)) throw new Error('Bitte die Quelle erneut prüfen, um Release-Dateien im sichtbaren Ordner abzulegen.');
    return safeDirectory(record.destination, [marker.releaseInfo.assetDirectory]);
  }
  constructor({ directory, safeStorage, version, fetchImpl = fetch, updateFetch, applyOS = async () => {}, notifyUpdate = () => {}, notifyBackup = () => {}, notificationsAvailable = () => true, now = () => new Date(), mountedRoots, environmentState = async () => ({ onBattery: null }), gitFactory = options => new Git(options) }) {
    super(); Object.assign(this, { directory, safeStorage, version, fetchImpl, updateFetch, applyOS, notifyUpdate, notifyBackup, notificationsAvailable, now, mountedRoots, environmentState, gitFactory });
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
  sourceClient(source={}){
    const spec=providerSpec(source),id=source.accountId??'default';
    if(spec.provider==='github'&&(id==='default'||this.config.accounts.some(a=>a.id===id&&providerKey(a)==='github:https://github.com')))return this.client(id);
    const account=this.config.accounts.find(a=>a.id===id),token=account&&providerKey(account)===providerKey(spec)?this.vault.tokens[id]||'':'';
    const key=`${providerKey(spec)}:${id}`;if(!this.clients.has(key))this.clients.set(key,spec.provider==='github'?new GitHubClient({token,fetchImpl:this.fetchImpl}):new HostedClient({...spec,token,username:account?.username||'',fetchImpl:this.fetchImpl}));return this.clients.get(key);
  }
  sourceGit(source={}){
    const spec=providerSpec(source),id=source.accountId??'default';if(spec.provider==='github'&&(id==='default'||this.config.accounts.some(a=>a.id===id&&providerKey(a)==='github:https://github.com')))return this.gitFor(id);
    const account=this.config.accounts.find(a=>a.id===id),token=account&&providerKey(account)===providerKey(spec)?this.vault.tokens[id]||'':'';
    const key=`${providerKey(spec)}:${id}`;if(!this.gitClients.has(key))this.gitClients.set(key,this.gitFactory({token,server:spec.server,username:spec.provider==='gitlab'?'oauth2':account?.username||'token'}));return this.gitClients.get(key);
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    this.config = validateConfig(await readJson(path.join(this.directory, 'settings.json'), defaults()));
    this.vault = new SecretVault(this.directory, this.safeStorage);
    try { await this.vault.load(); } catch (error) { this.notice = error.message; }
    this.git = this.gitFor();
    try { this.gitVersion = await this.git.version(); } catch (error) { this.gitVersion = null; this.notice = error.message; }
    let state = await readJson(path.join(this.directory, 'state.json'), {});
    const recovered = await recoverRelocations(this.directory,this.config,state); this.config = validateConfig(recovered.config); state = recovered.state;
    for(const [old,id]of Object.entries(recovered.idChanges??{}))if(this.vault.archiveBindings[old]){this.vault.archiveBindings[id]=this.vault.archiveBindings[old];await this.vault.persistKeyState();}
    if (await rememberHints(this.config)) await writeJson(path.join(this.directory,'settings.json'),this.config);
    const externalHistory = await readJson(path.join(this.directory, 'history.json'), null);
    if (externalHistory) state.history = externalHistory;
    if (state.queue) {
      state.queue.config = validateConfig(state.queue.config);
      if (!Array.isArray(state.queue.jobs) || state.queue.jobs.length > 100000 || !Array.isArray(state.queue.completed) || !Array.isArray(state.queue.results)) throw new Error('Die gespeicherte Warteschlange ist beschädigt.');
      state.queue.pauseReason ||= 'restart';
      for (const job of state.queue.jobs) { job.source = validateConfig({ ...state.queue.config, sources: [job.source] }).sources[0]; parseHostedSource(job.repository.full_name,'repository',job.source); }
    }
    const records = {};
    for (const record of Object.values(state.repositories ?? {})) {
      const id = record.id || createHash('sha256').update(`${record.fullName.toLowerCase()}\0${path.resolve(record.destination)}`).digest('hex').slice(0, 24);
      records[id] = { ...record, id };
    }
    state.repositories=records;
    if(Object.values(records).some(r=>r.rekeyPending)){const release=await acquireLease(this.directory);try{await recoverRotations(state,this.vault,value=>this.persistState(value));}finally{await release();}}
    this.backup = new BackupService({
      state: { ...state, repositories: records }, git: this.git,
      github: source => this.sourceClient(source), getGit: source => this.sourceGit(source),
      getPassphrase: async () => this.vault.archivePassword, acquireLock: () => acquireLease(this.directory),
      saveState: value => this.persistState(value), gate: execution => this.checkRules(execution)
    });
    this.backup.on('change', () => this.changed());
    this.backup.on('data', () => { this.dataRevision++; this.changed(); });
    this.backup.on('complete', result => { try { if (this.notificationsAvailable() && notificationAllowed(this.config,'backup',result,this.now())) this.notifyBackup(result); } catch (error) { this.notice = error.message; this.changed(); } });
    this.updates = new UpdateMonitor({
      currentVersion: this.version,
      github: this.updateFetch ? new GitHubClient({ fetchImpl: this.updateFetch }) : this.client(),
      state: await readJson(path.join(this.directory, 'updates.json'), {}),
      save: value => writeJson(path.join(this.directory, 'updates.json'), value), notify: result => this.notifyUpdate(result), canNotify: () => this.notificationsAvailable() && notificationAllowed(this.config,'update',{},this.now())
    });
    this.scheduler = new Scheduler({ getConfig: () => this.config, getLastRun: () => this.backup.state, run: (due,scheduledSources) => this.run({ scheduledAt: due, scheduledSources }), onError: error => { this.notice = error.message; this.changed(); } });
    this.drives = new DriveMonitor({ getConfig: () => this.config, run: onlyTargets => this.run({ trigger: 'drive', onlyTargets }), onError: error => { this.notice = error.message; this.changed(); } });
    this.deviceFlow = new DeviceFlow({ fetchImpl: this.fetchImpl });
    this.browser = new RestoreBrowser({ git: this.git });
    this.changes = new ChangesPreview({browser:this.browser});
    this.repositoryBrowser = new RepositoryBrowser({ clientFor: source => this.sourceClient(source), getConfig: () => this.config });
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
      nextRun: nextConfigRun(this.config), sourceRuns: Object.fromEntries(this.config.sources.map(s => [s.id,s.enabled ? nextRun(effectiveSchedule(this.config,s)) : null])),
      update: this.updates.result, gitVersion: this.gitVersion, notice: this.notice,
      tokenConfigured: Boolean(this.vault.tokens.default), secureStorage: this.vault.available(),
      accounts: [{ id: 'default', label: 'Standard', configured: Boolean(this.vault.tokens.default) }, ...this.config.accounts.map(account => ({ ...account, configured: Boolean(this.vault.tokens[account.id]) }))],
      encryptionReady: Boolean(this.vault.archivePassword), encryptionRemembered: this.vault.rememberPassword, device: this.device,
      queue: this.backup.state.queue ? { id: this.backup.state.queue.id, total: this.backup.state.queue.jobs.length, unresolved: Boolean(this.backup.state.queue.unresolved), completed: this.backup.state.queue.completed.length, pauseReason: this.backup.state.queue.pauseReason, message: this.backup.state.queue.message, elapsedMs: this.backup.state.queue.elapsedMs, receivedBytes: this.backup.state.queue.receivedBytes } : null,
      metrics: this.metricsSnapshot, environment: this.environment, driveRecovery: this.driveRecovery ?? null,
      rotation:this.rotation??null,
      dataRevision: this.dataRevision, configRevision: this.configRevision
    };
  }
  async run(options = {}) {
    if (this.operation || this.saving) return { busy: true };
    if(!this.backup.busy&&Object.values(this.backup.state.repositories).some(record=>record.rekeyPending))await this.withOperation('recovering-archives',async()=>{});
    if(options.resume&&this.backup.state.queue?.pauseReason==='space'&&!await spaceReady(this.backup.state.queue))return{paused:true,reason:'space'};
    if (!this.backup.busy && this.config.autoRelocate) await this.locateDrives({automatic:true});
    const config = structuredClone(this.config);
    config.backup.encryptionKeyId = this.vault.encryptionKeyId;
    return this.backup.run(config, options);
  }
  async scheduledRun() {
    if (this.backup.state.queue) return this.backup.state.queue.pauseReason === 'user' || this.backup.state.queue.pauseReason === 'restart' || this.backup.state.queue.pauseReason === 'error' ? { paused: true } : this.resume();
    const plan = dueSources(this.config,this.backup.state);
    if (plan.scheduledAt) return this.run({ scheduledAt: plan.scheduledAt, scheduledSources: plan.sources });
    return { skipped: true };
  }
  start() { this.scheduler.start(); this.drives.start(); this.configureUpdates(); if (this.config.checkUpdates) void this.checkUpdates(); this.policyTimer = setInterval(() => void this.policyTick(),30000); this.policyTimer.unref?.(); }
  async stop() { this.scheduler.stop(); this.drives.stop(); clearInterval(this.updateTimer); clearInterval(this.policyTimer); this.deviceFlow.cancel(); this.repositoryBrowser.close(); await this.closeChanges(); await this.browser.closeAll(); }
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
    try { if (Date.now() - this.lastDisksAt >= 60000) await this.refreshDisks(); if (this.changes.current?.expiresAt <= Date.now()) await this.closeChanges(); if (this.config.autoRelocate && !this.busy() && !this.saving && Date.now() - (this.lastLocationCheck ?? 0) >= 60000) await this.locateDrives({automatic:true}); await this.updates.notifyAvailable(); const q = this.backup.state.queue; if (q && !this.busy() && !['user','restart','error'].includes(q.pauseReason) && !await this.checkRules(this.config.execution)&&(q.pauseReason!=='space'||await spaceReady(q))) await this.resume(); this.changed(); }
    catch (error) { this.notice = error.message; this.changed(); }
  }
  pause() { return this.backup.pause(); }
  resume() { return this.run({ resume: true }); }
  discard() { return this.backup.discard(); }
  preview(input) { return this.withOperation('previewing',() => previewConfig(input,source => this.sourceClient(source).withTransfer(null,input.execution?.retries ?? 2))); }
  historyQuery(options){return queryHistory(this.backup.state.history,options);}
  historyDetails(options){return historyDetails(this.backup.state.history,options);}
  historyExport(options){return exportHistory(this.backup.state.history,options);}
  rotationInventory(options){return this.withOperation('checking-archives',()=>rotationInventory(this.backup.state.repositories,this.vault,options));}
  rotatePasswords(options){if(this.config.systemSchedule&&!options.remember)throw new Error('Für die unabhängige Zeitplanung muss das Archivpasswort im sicheren Schlüsselspeicher hinterlegt sein.');if(this.backup.state.queue)throw new Error('Bitte zuerst den pausierten Durchlauf fortsetzen oder verwerfen.');this.rotationStop=false;return this.withOperation('rotating-password',async()=>{this.rotation={completed:0,total:options.ids?.length??0,status:'rotating'};try{const result=await rotatePasswords({...options,state:this.backup.state,vault:this.vault,git:this.git,save:value=>this.persistState(value),fingerprintFor:(record,marker,oldKey,newKey)=>{const source=this.config.sources.find(s=>s.id===record.sourceId);if(!source)return null;const options=effectiveBackup(this.config,source);return marker.fingerprint===backupFingerprint({...options,encryptionKeyId:oldKey})?backupFingerprint({...options,encryptionKeyId:newKey}):null;},onProgress:progress=>{this.rotation=progress;this.changed();},shouldStop:()=>this.rotationStop});this.dataRevision++;this.rotation={...result,status:'complete'};return result;}catch(error){this.rotation={status:'error',message:error.message};throw error;}finally{this.changed();}});}
  stopRotation(){this.rotationStop=true;return{requested:true};}
  recommendations({sourceId,repository}){if(this.busy()||this.saving)throw new Error('Bitte den laufenden Vorgang abwarten.');const controller=new AbortController();this.recommendationController=controller;return this.withOperation('inspecting-options',async()=>{try{const source=this.config.sources.find(s=>s.id===sourceId);if(!source)throw new Error('Quelle nicht gefunden.');return await inspectRecommendations({source,repository:repository||source.value,client:this.sourceClient(source),git:this.sourceGit(source),signal:controller.signal});}finally{if(this.recommendationController===controller)this.recommendationController=null;}});}
  cancelRecommendations(){this.recommendationController?.abort();return true;}
  async organizeSources(input) {
    if (this.operation || this.saving) throw new Error('Bitte den laufenden Vorgang abwarten.');
    this.saving = true;
    try {
      const next = organizeConfig(this.config, input);
      await writeJson(path.join(this.directory, 'settings.json'), next);
      this.config = next; this.configRevision++; this.changed(); return this.snapshot();
    } finally { this.saving = false; }
  }
  previewSources(input) {
    const result = prepareBulk(this.config, input), token = require('node:crypto').randomUUID();
    this.bulkPreview = { token, input: structuredClone(input), signature: configSignature(this.config), expiresAt: Date.now() + 300000 };
    return { token, changes: result.changes, selected: result.selected, changed: result.changed };
  }
  async applySources({ token } = {}) {
    const preview = this.bulkPreview;
    if (!preview || preview.token !== token || preview.expiresAt < Date.now() || preview.signature !== configSignature(this.config)) throw new Error('Die Quellen wurden inzwischen geändert. Bitte die Vorschau erneut prüfen.');
    const result = prepareBulk(this.config, preview.input);
    await this.saveConfig(result.config); this.bulkPreview = null;
    return { changed: result.changed };
  }
  async addBrowserSources(input) {
    const result = input.asOwner ? this.repositoryBrowser.ownerSelection(input) : this.repositoryBrowser.selection(input);
    if (result.added) await this.saveConfig(result.config);
    this.repositoryBrowser.close(); return { added: result.added, skipped: result.skipped };
  }
  async locateDrives({automatic = false} = {}) {
    if (this.busy() || this.saving) return {busy:true};
    return this.withOperation('locating-drives',async () => {
      this.lastLocationCheck = Date.now();
      const result = await findRelocations(this.config,{...(this.mountedRoots ? {roots:this.mountedRoots} : {}),includeDisabled:!automatic});
      if (result.moves.length) {
        const updated = await persistRelocations(this.directory,this.config,this.backup.state,result.moves);
        for(const [old,id]of Object.entries(updated.idChanges??{}))if(this.vault.archiveBindings[old])this.vault.archiveBindings[id]=this.vault.archiveBindings[old];await this.vault.persistKeyState();
        this.config = validateConfig(updated.config); this.backup.state = updated.state; this.configRevision++; this.dataRevision++; await this.refreshDisks();
      }
      if (result.moves.length || result.issues.length || !automatic) this.driveRecovery = {moved:result.moves.length,ambiguous:result.issues.length,checkedAt:new Date().toISOString()};
      this.changed(); return result;
    });
  }
  async openChanges({id,passphrase}) {
    if (this.busy() || this.saving) throw new Error('Bitte den laufenden Vorgang abwarten.');
    this.operation = 'previewing-changes'; this.changed();
    let release;
    try {
      release = await acquireLease(this.directory);
      this.changesLease = release;
      const record = this.record(id), source = this.config.sources.find(s => s.id === record.sourceId);
      const origin=source??record;
      const result = await this.changes.open({record,git:this.sourceGit(origin),github:this.sourceClient(origin),passphrase:passphrase || this.vault.passwordFor(record)});
      this.changesTimer = setInterval(() => { if (this.changes.current?.expiresAt <= Date.now()) void this.closeChanges().catch(error => {this.notice=error.message;this.changed();}); },15000); this.changesTimer.unref?.();
      return result;
    } catch (error) { const owned = this.changesLease; this.changesLease = null; if (owned) await owned(); else if (release && this.operation === 'previewing-changes') await release(); this.operation = null; this.changed(); throw error; }
  }
  async closeChanges() {
    if (this.closingChanges) return this.closingChanges;
    if (!this.changes?.current && !this.changesLease) return;
    this.closingChanges = (async () => { clearInterval(this.changesTimer); try { await this.changes.close(); } finally { const release = this.changesLease; this.changesLease = null; if (release) await release(); this.operation = null; this.changed(); } })();
    try { return await this.closingChanges; } finally { this.closingChanges = null; }
  }
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
      const candidate = structuredClone(input);
      for (const source of candidate.sources ?? []) {
        const old = this.config.sources.find(s => s.id === source.id);
        if (!old || old.destination !== source.destination) { delete source.volumeId; delete source.volumeHint; }
        else if (old.volumeHint) source.volumeHint = old.volumeHint;
        for (const target of source.additionalDestinations ?? []) { const previous = old?.additionalDestinations.find(t => t.id === target.id); if (!previous || previous.destination !== target.destination) { delete target.volumeId; delete target.volumeHint; } else if (previous.volumeHint) target.volumeHint = previous.volumeHint; }
      }
      const next = validateConfig(candidate);
      for(const account of next.accounts){const old=this.config.accounts.find(a=>a.id===account.id);if(old&&this.vault.tokens[account.id]&&providerKey(old)!==providerKey(account))throw new Error('Vor einem Serverwechsel die gespeicherten Zugangsdaten entfernen.');}
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
    await this.vault.setToken(id, token); this.clients.clear(); this.gitClients.clear(); this.repositoryBrowser?.close();
    if (id === 'default') this.updates.github = this.client();
    this.changed();
    return { configured: Boolean(this.vault.tokens[id]) };
  }
  async setPassword(password, remember) {
    return this.withOperation('unlocking-archives',async()=>{
      if(this.config.systemSchedule&&!remember)throw new Error('Für die unabhängige Zeitplanung muss das Archivpasswort im sicheren Schlüsselspeicher hinterlegt sein.');
      for(const record of Object.values(this.backup.state.repositories)){
        if(!record.encrypted||(record.encryptionKeyId||this.vault.archiveBindings[record.id]||this.vault.legacyKeyId||this.vault.encryptionKeyId)!==this.vault.encryptionKeyId)continue;
        const file=path.join(record.destination,'backup.gcb');let info;try{info=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
        if(!info.isFile()||info.isSymbolicLink())throw new Error('Unsicherer Archivpfad.');
        await require('./core/archives.cjs').authenticateArchive(file,password);break;
      }
      await this.vault.setPassword(password,remember);this.changed();return{ready:true};
    });
  }
  async beginLogin(accountId) {
    if (!this.vault.available()) throw new Error('Die Anmeldung benötigt einen sicheren Schlüsselspeicher.');
    if (!['default', ...this.config.accounts.map(a => a.id)].includes(accountId)) throw new Error('Konto nicht gefunden.');
    if(providerSpec(this.config.accounts.find(a=>a.id===accountId)??{}).provider!=='github')throw new Error('Für GitLab und Forgejo ein passendes Lesetoken speichern.');
    if (!this.config.oauthClientId) throw new Error('Bitte zuerst die Client-ID einer GitHub-OAuth-App mit aktiviertem Device Flow eintragen. Alternativ ein Personal Access Token verwenden.');
    if (this.device?.status === 'pending') throw new Error('Eine Anmeldung läuft bereits.');
    this.device = { status: 'pending', accountId }; this.changed();
    void this.deviceFlow.login(this.config.oauthClientId, code => { this.device = { status: 'pending', accountId, ...code }; this.changed(); })
      .then(async token => { await this.setToken(accountId, token); this.device = { status: 'success', accountId }; this.changed(); })
      .catch(error => { this.device = { status: 'error', message: error.message, accountId }; this.changed(); });
    return { started: true };
  }
  record(id) { const record = this.backup.state.repositories[id]; if (!record) throw new Error('Sicherung nicht gefunden.');if(record.rekeyPending)throw new Error('Der Passwortwechsel ist noch nicht abgeschlossen. Das Sicherungslaufwerk verbinden und den Assistenten erneut öffnen.');return record; }
  async withOperation(name, fn) {
    if (this.busy() || this.saving) throw new Error('Bitte den laufenden Vorgang abwarten.');
    this.operation = name; this.changed(); let release;
    try { release = await acquireLease(this.directory);if(this.backup&&Object.values(this.backup.state.repositories).some(r=>r.rekeyPending))await recoverRotations(this.backup.state,this.vault,value=>this.persistState(value));return await fn(); }
    finally { if (release) await release(); this.operation = null; this.changed(); }
  }
  verify(id, passphrase) {
    return this.withOperation('verifying', async () => {
      const record = this.record(id);
      try {
        const result = await verifyBackup(record, this.git, passphrase || this.vault.passwordFor(record));
        Object.assign(record, result, { verificationStatus: 'ok' });
        await this.persistState(this.backup.state); this.dataRevision++;
        return result;
      } catch (error) { record.verificationStatus = 'error'; this.dataRevision++; await this.persistState(this.backup.state); throw error; }
    });
  }
  restore({ recordId, archive, parent, name, passphrase }) {
    return this.withOperation('restoring', () => restoreBackup({ record: recordId ? this.record(recordId) : null, archive, parent, name, passphrase: passphrase || this.vault.passwordFor(recordId?this.record(recordId):null), git: this.git }));
  }
  browseOpen({ recordId, archive, passphrase, content = 'repository' }) { return this.withOperation('browsing',() => this.browser.open({ record: recordId ? this.record(recordId) : null, archive, content, passphrase: passphrase || this.vault.passwordFor(recordId?this.record(recordId):null) })); }
  browseList(options) { return this.browser.list(options); }
  restoreSelection(options) { return this.withOperation('restoring',() => this.browser.restore(options)); }
}
module.exports = { Runtime };
