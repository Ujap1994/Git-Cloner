const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { defaults, effectiveBackup } = require('./config.cjs');
const { providerSpec,parseHostedSource,repositoryParts,repositoryDestination,repositoryIdentity,providerKey,cloneURL } = require('./provider-spec.cjs');
const { errorCode } = require('./error-help.cjs');
const { retry } = require('./retry.cjs');
const { createTransport } = require('./transport.cjs');
const { readJson, writeJson } = require('./store.cjs');
const { verifyDestination, safeDirectory, checkSpace } = require('./destinations.cjs');
const { includesRepository } = require('./filters.cjs');
const { hashFile, writeManifest, verifyDirectory, verificationDue, controlDirectory } = require('./integrity.cjs');
const { encryptArchive, decryptArchive } = require('./archives.cjs');
const { metadataPlan } = require('./metadata.cjs');
const { ReleaseReuse } = require('./release-reuse.cjs');
const { ReleaseDownloads } = require('./release-downloads.cjs');
const { releaseDirectoryName } = require('./release-layout.cjs');
const MARKER = 'git-cloner.json';
const copyOptions = { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true };
async function copyRepository(source, destination, mode, releaseInfo, git) {
  const metadata = path.join(controlDirectory(source, mode), 'git-cloner-metadata');
  let releaseFolder = releaseDirectoryName(releaseInfo?.assetDirectory) ? path.join(source, releaseInfo.assetDirectory) : null;
  if (releaseFolder && mode !== 'mirror' && (await git.run(['-C', source, 'ls-tree', '--name-only', 'HEAD', '--', releaseInfo.assetDirectory])).trim()) releaseFolder = null;
  await fs.cp(source, destination, { ...copyOptions, filter: file => file !== metadata && file !== releaseFolder });
}
async function exists(file) { try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function managed(directory, fullName) {
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Ein fremder Ordner oder Link blockiert das Ziel: ${directory}`);
  let control = directory;
  if (await exists(path.join(directory, '.git'))) {
    const gitInfo = await fs.lstat(path.join(directory, '.git'));
    if (!gitInfo.isDirectory() || gitInfo.isSymbolicLink()) throw new Error('Unsicherer Git-Ordner.');
    control = path.join(directory, '.git');
  }
  const file = path.join(control, MARKER), markerInfo = await fs.lstat(file);
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) throw new Error('Unsichere Sicherungskennung.');
  const marker = await readJson(file, null);
  if (marker?.schemaVersion !== 1 || typeof marker.fullName !== 'string' || marker.fullName.toLowerCase() !== fullName.toLowerCase()) throw new Error(`Ein fremder Ordner wird nicht überschrieben: ${directory}`);
  return { ...marker, mode: marker.mode ?? 'snapshot', encrypted: marker.encrypted ?? false };
}
async function recover(parent, name, fullName) {
  const target = path.join(parent, name), staging = path.join(parent, `.${name}.git-cloner-stage`), previous = path.join(parent, `.${name}.git-cloner-previous`), markerFile = `${staging}.json`;
  if (await exists(previous)) {
    await managed(previous, fullName);
    if (await exists(target)) { await managed(target, fullName); await fs.rm(previous, { recursive: true }); }
    else await fs.rename(previous, target);
  }
  let owner = null;
  if (await exists(markerFile)) {
    const info = await fs.lstat(markerFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Eine fremde temporäre Kennung blockiert die Sicherung.');
    owner = await readJson(markerFile, null);
    if (owner?.schemaVersion !== 1 || owner.fullName !== fullName) throw new Error('Eine fremde temporäre Kennung blockiert die Sicherung.');
  }
  if (await exists(staging)) {
    const info = await fs.lstat(staging);
    if (!owner || !info.isDirectory() || info.isSymbolicLink()) throw new Error('Ein fremder temporärer Ordner blockiert die Sicherung.');
    await fs.rm(staging, { recursive: true });
  }
  if (owner) await fs.rm(markerFile);
  return { target, staging, previous, markerFile };
}
async function verifyBackup(record, git, passphrase) {
  const marker = await managed(record.destination, record.fullName);
  if (!marker.encrypted) return verifyDirectory(record.destination, git, marker.mode);
  const archive = path.join(record.destination, 'backup.gcb');
  if (await hashFile(archive) !== marker.archiveHash) throw new Error('Die verschlüsselte Sicherung wurde verändert oder beschädigt.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'git-cloner-verify-'));
  try {
    const payload = path.join(temporary, 'payload');
    await decryptArchive(archive, payload, passphrase);
    return await verifyDirectory(payload, git, marker.mode);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
function backupFingerprint(opts){return createHash('sha256').update(JSON.stringify({mode:opts.mode,lfs:opts.lfs,submodules:opts.submodules,encrypted:opts.encryption,metadata:opts.metadata,...(opts.metadata.releases?{releaseScope:opts.releaseScope,...((opts.releaseArchitecture&&opts.releaseArchitecture!=='all')||opts.releaseFileTypes?.length?{releaseArchitecture:opts.releaseArchitecture??'all',releaseFileTypes:opts.releaseFileTypes??[],releaseArch:opts.releaseArchitecture==='system'?process.arch:null}:{}),releasePlatform:opts.releaseScope==='system'?process.platform:null}:{}),keyId:opts.encryption?opts.encryptionKeyId:null})).digest('hex');}
async function syncRepository({ source, repository, git, github, options = defaults().backup, plan, passphrase, onProgress = () => {}, onDownload = () => {} }) {
  const fullName = parseHostedSource(repository.full_name, 'repository',source), parts=repositoryParts(source,fullName), name=parts.at(-1),parents=parts.slice(0,-1),spec=providerSpec(source);
  const opts = { ...defaults().backup, ...options, metadata: { ...defaults().backup.metadata, ...options.metadata } };
  let root = await verifyDestination(source);
  const parent = await safeDirectory(root, parents, true);
  const { target, staging, previous, markerFile } = await recover(parent, name, fullName);
  const current = await exists(target) ? await managed(target, fullName) : null;
  if(current&&spec.provider!=='github'&&(current.provider!==spec.provider||current.server!==spec.server))throw new Error('Eine fremde Anbieter-Sicherung wird nicht überschrieben.');
  const url = cloneURL(source,fullName);
  onProgress({ fullName, status: 'checking' });
  const revision = await git.revision(url, opts.mode === 'mirror');
  if (!revision) return { fullName, destination: target, status: 'empty', message: 'Leeres Repository ohne Commit.', checkedAt: new Date().toISOString() };
  plan ??= await metadataPlan(repository, opts.metadata, github, git, { releaseScope: opts.releaseScope, releaseArchitecture: opts.releaseArchitecture, releaseFileTypes: opts.releaseFileTypes });
  if (current?.wikiRevision && plan.warning) throw new Error('Das Wiki konnte nicht aktualisiert werden. Die vorhandene Sicherung bleibt erhalten.');
  const fingerprint = backupFingerprint(opts);
  let repair = false;
  if (current && current.fingerprint === fingerprint && current.revision === revision && current.metadataDigest === plan.digest) {
    try {
      if (verificationDue(opts.integrity, current.verifiedAt)) {
        onProgress({ fullName, status: 'verifying' });
        if (current.encrypted) { if (await hashFile(path.join(target, 'backup.gcb')) !== current.archiveHash) throw new Error('Archiv beschädigt.'); }
        else await verifyDirectory(target, git, current.mode);
      }
      if (!current.encrypted && await git.head(target) !== current.commit) throw new Error('Commit verändert.');
      const verifiedAt = verificationDue(opts.integrity, current.verifiedAt) ? new Date().toISOString() : current.verifiedAt;
      if (verifiedAt !== current.verifiedAt) await writeJson(path.join(current.encrypted ? target : controlDirectory(target, current.mode), MARKER), { ...current, verifiedAt });
      return { fullName, destination: target, commit: current.commit, mode: opts.mode, encrypted: opts.encryption, files: current.files, bytes: current.bytes, releaseInfo: current.releaseInfo ?? null, ...(plan.releaseWarning ? {warning:plan.releaseWarning} : {}), verifiedAt, verificationStatus: 'ok', status: 'unchanged', checkedAt: new Date().toISOString() };
    } catch (_error) { repair = true; }
  }
  const estimatedBytes = Math.max((repository.size ?? 0) * 2048 + (plan.estimatedBytes ?? 0) * (plan.downloadCount ? 2.02 : 1),current?.bytes ?? 0);
  await checkSpace(root, estimatedBytes, opts.reserveMB);
  await writeJson(markerFile, { schemaVersion: 1, fullName });
  let temporary, downloads, downloadWarning, reuse;
  try {
    let payload = staging;
    if (opts.encryption) {
      if (!passphrase) throw new Error('Bitte zuerst das Archivpasswort in den Einstellungen entsperren.');
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'git-cloner-encrypt-')); await fs.chmod(temporary, 0o700);
      try{await checkSpace(temporary, estimatedBytes, opts.reserveMB);}catch(error){if(error.space)error.space.root=os.tmpdir();throw error;}
      payload = path.join(temporary, 'payload'); await fs.mkdir(staging, { mode: 0o700 });
    }
    onProgress({ fullName, status: 'cloning' });
    let reusable = current && !current.encrypted && !opts.encryption && !repair && current.fingerprint === fingerprint;
    if (reusable && opts.mode === 'snapshot' && current.revision === revision) {
      try { await verifyDirectory(target, git, current.mode); } catch (_error) { reusable = false; repair = true; }
    }
    if (opts.mode === 'mirror') {
      if (reusable) { await copyRepository(target, payload, opts.mode, current.releaseInfo, git); await git.updateMirror(payload, url, repository.default_branch); }
      else await git.cloneMirror(url, payload);
    } else if (reusable && current.revision === revision) await copyRepository(target, payload, opts.mode, current.releaseInfo, git);
    else await git.clone(url, payload);
    if (opts.submodules) await git.submodules(payload);
    if (opts.lfs) await git.lfs(payload, opts.mode === 'mirror');
    if (plan.downloadCount) downloads = await ReleaseDownloads.open({ root, volumeId: source.volumeId, scope: `${providerKey(source)}:${source.accountId ?? 'default'}:${fullName.toLowerCase()}`, passphrase: opts.encryption ? passphrase : '', encryptionKeyId: opts.encryptionKeyId || '' });
    reuse = await ReleaseReuse.open(current ? { ...current, destination: target } : null, passphrase);
    const applied = await plan.apply(payload, opts.mode, { downloads, onProgress, reuse, onDownload });
    const releaseInfo = structuredClone(applied?.releaseInfo ?? plan.releaseInfo ?? null);
    onProgress({ fullName, status: 'verifying' }); await git.fsck(payload);
    const commit = await git.head(payload);
    if (!/^[a-f\d]{40,64}$/.test(commit)) throw new Error('Der neue Stand enthält keinen gültigen Commit.');
    const verification = await writeManifest(payload, opts.mode);
    const marker = { schemaVersion: 1, fullName, ...(spec.provider!=='github'?spec:{}), commit, revision, mode: opts.mode, encrypted: opts.encryption, ...(opts.encryptionKeyId?{encryptionKeyId:opts.encryptionKeyId}:{}), fingerprint, metadataDigest: plan.digest, wikiRevision: plan.wikiRevision ?? null, releaseInfo, ...verification, updatedAt: new Date().toISOString() };
    await writeJson(path.join(controlDirectory(payload, opts.mode), MARKER), { ...marker, encrypted: false });
    if (opts.encryption) {
      onProgress({ fullName, status: 'encrypting' }); await encryptArchive(payload, path.join(staging, 'backup.gcb'), passphrase);
      marker.archiveHash = await hashFile(path.join(staging, 'backup.gcb')); await writeJson(path.join(staging, MARKER), marker);
    }
    root = await verifyDestination(source); await safeDirectory(root, parents);
    if (current) { await managed(target, fullName); await fs.rename(target, previous); }
    try { await fs.rename(staging, target); }
    catch (error) { if (current && !await exists(target)) await fs.rename(previous, target); throw error; }
    if (current) await fs.rm(previous, { recursive: true });
    try { const freedBytes = await downloads?.clear(); if (freedBytes) onDownload({ status: 'cleaned', freedBytes }); } catch (_error) { downloadWarning = 'Die Sicherung ist geprüft. Der temporäre Download-Cache konnte nicht vollständig bereinigt werden.'; }
    return { fullName, destination: target, commit, mode: opts.mode, encrypted: opts.encryption, releaseInfo, ...verification, verificationStatus: 'ok', status: repair ? 'repaired' : current ? 'updated' : 'cloned', ...(plan.warning || plan.releaseWarning || downloadWarning ? { warning: plan.warning || plan.releaseWarning || downloadWarning } : {}), checkedAt: new Date().toISOString() };
  } finally {
    try { await fs.rm(staging, { recursive: true, force: true }); await fs.rm(markerFile, { force: true }); if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
    finally { await reuse?.close(); await downloads?.close(); }
  }
}
async function resolveJobs(sources, github, { onlyTargets = null, onlySources = null } = {}) {
  const selected = sources.filter(s => s.enabled), overrides = new Set(sources.filter(s => s.kind === 'repository').map(s => repositoryIdentity(s,s.value)));
  const jobs = [], errors = [], excluded = [], paths = new Set(), reserved = new Set();
  for (const source of selected) {
    if (onlySources && !onlySources.includes(source.id)) continue;
    try {
      const client = typeof github === 'function' ? github(source) : github;
      const repos = source.kind === 'owner' ? await client.repositories(source.value) : [await client.repository(source.value)];
      for (const repository of repos) {
        const fullName = parseHostedSource(repository.full_name, 'repository',source);
        if ((source.kind === 'owner' && overrides.has(repositoryIdentity(source,fullName))) || !includesRepository(repository, source.filters)) { excluded.push({ fullName, sourceId: source.id, reason: source.kind === 'owner' && overrides.has(repositoryIdentity(source,fullName)) ? 'override' : 'filter' }); continue; }
        for (const target of [{ id: 'primary', destination: source.destination, volumeId: source.volumeId, volumeHint: source.volumeHint }, ...(source.additionalDestinations ?? [])]) {
          const targetId = `${source.id}:${target.id}`;
          if (onlyTargets && !onlyTargets.includes(targetId)) continue;
          const destination = repositoryDestination({...source,destination:target.destination},fullName).toLowerCase();
          if (paths.has(destination)) throw new Error('Mehrere Repositories verwenden denselben Zielordner.');
          const parent = path.dirname(destination), name = path.basename(destination);
          const internals = [`.${name}.git-cloner-stage`,`.${name}.git-cloner-previous`,`.${name}.git-cloner-stage.json`].map(n => path.join(parent,n));
          if (reserved.has(destination) || internals.some(p => paths.has(p) || reserved.has(p))) throw new Error('Reservierte temporäre Sicherungspfade überschneiden sich.');
          for (const other of paths) if (destination.startsWith(other + path.sep) || other.startsWith(destination + path.sep)) throw new Error('Sicherungsordner dürfen nicht ineinander verschachtelt werden.');
          paths.add(destination);
          internals.forEach(p => reserved.add(p));
          if (jobs.length >= 100000) throw new Error('Zu viele Sicherungsziele. Bitte Quellen mit Filtern auf höchstens 100000 Ziele begrenzen.');
          jobs.push({ source: { ...source, destination: target.destination, volumeId: target.volumeId, volumeHint: target.volumeHint }, repository, sourceId: source.id, targetId, github: client });
        }
      }
    } catch (error) {
      if (/verschachtelt|denselben|Reservierte|Zu viele Sicherungsziele/.test(error.message)) throw error;
      errors.push({ fullName: source.value, sourceId: source.id, status: 'error', message: error.message, helpCode:errorCode(error), ...(error.rateLimited ? { rateLimitUntil: error.rateLimitUntil } : {}) });
    }
  }
  return { jobs, errors, excluded };
}
function jobId(job) { return createHash('sha256').update(`${job.repository.full_name.toLowerCase()}\0${repositoryDestination(job.source,job.repository.full_name)}`).digest('hex').slice(0, 24); }
function serialJob(job) { const serial = { ...job }; delete serial.github; return serial; }
function heavy(job, config) {
  const options = effectiveBackup(config, job.source);
  return job.repository.size == null || job.repository.size > (config.execution?.smallRepoMB ?? 50) * 1024 || options.mode === 'mirror' || options.lfs || options.submodules || options.encryption || Object.values(options.metadata).some(Boolean);
}
function limitQueue(queue, untils) {
  const latest = Math.max(Date.parse(queue.rateLimitUntil ?? '') || 0, ...untils.map(value => Date.parse(value) || 0));
  queue.rateLimitUntil = new Date(latest || Date.now() + 60000).toISOString(); queue.pauseReason = 'rate'; queue.message = 'Warte auf die Freigabe des API-Limits. Erledigte Sicherungen bleiben erhalten.';
}
class BackupService extends EventEmitter {
  constructor({ github, git, saveState, state = {}, getGit, getPassphrase = async () => '', acquireLock = null, gate = async () => null, sync = syncRepository, transportFactory = createTransport, retryOptions = {} }) {
    super(); Object.assign(this, { github, git, saveState, getGit, getPassphrase, acquireLock, gate, sync, transportFactory, retryOptions });
    this.state = { repositories: {}, history: [], lastScheduledAt: null, lastScheduledBySource: {}, queue: null, ...state }; this.busy = false; this.progress = null;
  }
  async pause() {
    if (!this.busy && !this.state.queue) throw new Error('Kein Durchlauf zum Pausieren vorhanden.');
    this.pauseReason = 'user'; if (this.state.queue) this.state.queue.pauseReason = 'user'; this.updateProgress(); if (!this.busy) { await this.saveState(this.state); this.emit('change'); }
    return { requested: true };
  }
  async discard() {
    if (this.busy) throw new Error('Bitte zuerst den Durchlauf pausieren.');
    this.state.queue = null; this.pauseReason = null; this.progress = null; await this.saveState(this.state); this.emit('change');
  }
  updateProgress() {
    const q = this.state.queue; if (!q) return;
    const completed = q.completed.length, runningMs = (q.elapsedMs || 0) + (this.busy ? Date.now() - this.sessionStarted : 0);
    const active = [...(this.activeJobs?.values() || [])];
    const rate = completed ? runningMs / completed : null;
    this.progress = { completed, total: q.jobs.length, active, fullName: active[0]?.fullName || '', status: active[0]?.status || (this.pauseReason ? 'pausing' : 'checking'), elapsedMs: runningMs, etaMs: rate ? Math.max(0, Math.round(rate * (q.jobs.length - completed) / Math.max(1, active.length))) : null, receivedBytes: (q.receivedBytes || 0) + (this.transport?.bytes || 0), pauseRequested: Boolean(this.pauseReason), pauseReason: this.pauseReason || null };
    this.emit('change');
  }
  async run(config, { scheduledAt = null, scheduledSources = null, trigger = 'manual', onlyTargets = null, resume = false } = {}) {
    if (this.busy) return { busy: true };
    if (this.state.queue && !resume) return { paused: true };
    if (resume && !this.state.queue) throw new Error('Kein pausierter Durchlauf vorhanden.');
    this.busy = true; this.sessionStarted = Date.now(); this.activeJobs = new Map(); this.pauseReason = null;
    let release = async () => {}, completedRun = false; const runningTasks = new Set();
    try { if (this.acquireLock) release = await this.acquireLock(); }
    catch (error) { this.busy = false; if (error.code === 'BUSY') return { busy: true }; throw error; }
    this.emit('change');
    try {
      await this.git.version();
      if (!resume) {
        if (scheduledAt && !scheduledSources) this.state.lastScheduledAt = scheduledAt;
        this.state.queue = { id: require('node:crypto').randomUUID(), config: structuredClone(config), jobs: [], unresolved: true, onlyTargets, scheduledSources, completed: [], results: [], startedAt: new Date().toISOString(), trigger: scheduledAt ? 'schedule' : trigger, elapsedMs: 0, receivedBytes: 0, pauseReason: null };
      }
      const q = this.state.queue;
      if (resume && scheduledAt && !q.scheduledSources) this.state.lastScheduledAt = scheduledAt;
      // Execution rules may be relaxed while paused; backup content remains fixed.
      q.config.execution = structuredClone(config.execution || defaults().execution);
      if (config.backup?.encryptionKeyId) q.config.backup.encryptionKeyId = config.backup.encryptionKeyId;
      q.pauseReason = null; delete q.message; delete q.rateLimitUntil;
      if (q.unresolved) {
        const blocked = this.pauseReason || await this.gate(q.config.execution);
        if (blocked) { this.pauseReason = blocked; q.pauseReason = blocked; return { paused: true, reason: blocked }; }
        const resolver = source => { const client = typeof this.github === 'function' ? this.github(source) : this.github; return client.withTransfer ? client.withTransfer(null,q.config.execution.retries) : client; };
        const { jobs, errors } = await resolveJobs(q.config.sources,resolver,{onlyTargets:q.onlyTargets,onlySources:q.scheduledSources ? Object.keys(q.scheduledSources) : null});
        const limited = errors.filter(error => error.rateLimitUntil);
        if (limited.length) { this.pauseReason = 'rate'; limitQueue(q, limited.map(error => error.rateLimitUntil)); return { paused: true, reason: 'rate' }; }
        q.jobs = jobs.map(serialJob); q.results.push(...errors); q.unresolved = false;
      }
      await this.saveState(this.state);
      const completedIds = new Set(q.completed), pending = q.jobs.filter(job => !completedIds.has(jobId(job))), active = runningTasks, volumes = new Map(), plans = new Map();
      const volumeKeys = new Map(await Promise.all([...new Set(pending.map(job => job.source.destination))].map(async destination => { try { return [destination,`device:${(await fs.stat(destination)).dev}`]; } catch (_error) { return [destination,`path:${path.resolve(destination)}`]; } })));
      const failedForSpace=new Set(), rateBlocked=new Set(), rateKey = job => `${providerKey(job.source)}:${job.source.accountId ?? 'default'}`;
      let exclusive = false, lastSaved = Date.now(), lastEmission = 0;
      if (pending.length) this.transport = await this.transportFactory({ bandwidthKBps: q.config.execution.bandwidthKBps, onBytes: () => { if (Date.now() - lastEmission > 500) { lastEmission = Date.now(); this.updateProgress(); } } });
      const perform = async job => {
        const id = jobId(job), started = Date.now();
        const rawGit = this.getGit ? this.getGit(job.source) : this.git;
        const git = rawGit.withTransport ? rawGit.withTransport(this.transport.proxy) : rawGit;
        const rawClient = typeof this.github === 'function' ? this.github(job.source) : this.github;
        const github = rawClient.withTransfer ? rawClient.withTransfer(this.transport, q.config.execution.retries) : rawClient;
        const prior = this.state.repositories[id] || this.state.repositories[job.repository.full_name];
        const options = effectiveBackup(q.config, job.source); if (prior?.verificationStatus === 'error') options.integrity = 'always';
        const update = event => { this.activeJobs.set(id, { ...this.activeJobs.get(id), fullName: job.repository.full_name, ...event }); this.updateProgress(); };
        update({ status: 'checking' });
        let result;
        try {
          if(prior?.rekeyPending)throw new Error('Der Passwortwechsel ist noch nicht abgeschlossen. Das Sicherungslaufwerk verbinden und den Assistenten erneut öffnen.');
          result = await retry(async () => {
            const key = `${providerKey(job.source)}:${job.source.accountId}:${job.repository.full_name}:${JSON.stringify(options.metadata)}:${options.releaseScope}:${options.releaseArchitecture}:${JSON.stringify(options.releaseFileTypes)}`;
            if (!plans.has(key)) plans.set(key, metadataPlan(job.repository, options.metadata, github, git, { releaseScope: options.releaseScope, releaseArchitecture: options.releaseArchitecture, releaseFileTypes: options.releaseFileTypes }).catch(error => { plans.delete(key); throw error; }));
            return this.sync({ ...job, github, git, options, plan: await plans.get(key), passphrase: options.encryption ? await this.getPassphrase() : '', onProgress: update });
          }, { ...this.retryOptions, retries: q.config.execution.retries, onRetry: event => update({ status: 'retrying', attempt: event.attempt, retryAt: new Date(Date.now() + event.delay).toISOString() }) });
        } catch (error) {
          if(error.rateLimited){
            rateBlocked.add(rateKey(job));limitQueue(q,[error.rateLimitUntil]);
            const previous=this.state.repositories[id]??{};this.state.repositories[id]={...previous,id,fullName:job.repository.full_name,destination:repositoryDestination(job.source,job.repository.full_name),sourceId:job.sourceId,targetId:job.targetId,...(providerSpec(job.source).provider!=='github'?providerSpec(job.source):{}),status:'waiting',helpCode:'rate',message:error.message,rateLimitUntil:q.rateLimitUntil};pending.push(job);this.activeJobs.delete(id);this.emit('data');this.updateProgress();return;
          }
          if(error.code==='ENOSPC'){
            const root=error.space?.root||(error.diskPath&&path.resolve(error.diskPath).startsWith(path.resolve(os.tmpdir())+path.sep)&&options.encryption?os.tmpdir():job.source.destination);
            let available=0;try{const stat=await fs.statfs(root,{bigint:true});available=Number(stat.bavail*stat.bsize);}catch(_error){/* Remain paused when a disk disappears. */}
            const required=error.space?.requiredBytes??String(Math.ceil(Math.max((job.repository.size??0)*2048+options.reserveMB*1048576,available+options.reserveMB*1048576)));
            q.blockedSpaces={...q.blockedSpaces,[id]:{root,requiredBytes:required,availableBytes:String(available)}};failedForSpace.add(id);q.pauseReason='space';q.message='Warte auf genügend freien Speicher. Bestehende Sicherungen bleiben erhalten.';
            const previous=this.state.repositories[id]??{};this.state.repositories[id]={...previous,id,fullName:job.repository.full_name,destination:repositoryDestination(job.source,job.repository.full_name),sourceId:job.sourceId,targetId:job.targetId,...(providerSpec(job.source).provider!=='github'?providerSpec(job.source):{}),status:'waiting',helpCode:'space',message:q.message};pending.push(job);this.activeJobs.delete(id);this.emit('data');this.updateProgress();return;
          }
          result={fullName:job.repository.full_name,destination:repositoryDestination(job.source,job.repository.full_name),status:'error',message:error.message,helpCode:errorCode(error),checkedAt:new Date().toISOString()};
        }
        if(q.blockedSpaces)delete q.blockedSpaces[id];
        const spec=providerSpec(job.source);
        result = { ...result, ...(spec.provider!=='github'?spec:{}),...(options.encryptionKeyId&&result.encrypted?{encryptionKeyId:options.encryptionKeyId}:{}), id, sourceId: job.sourceId, targetId: job.targetId, accountId:job.source.accountId, durationMs: Date.now() - started };
        q.results.push(result); q.completed.push(id); completedIds.add(id);
        const legacy = this.state.repositories[result.fullName];
        const previous = this.state.repositories[id] || (legacy?.destination === result.destination ? legacy : {}) || {};
        if (legacy?.destination === result.destination) delete this.state.repositories[result.fullName];
        this.state.repositories[id] = { ...previous, message: undefined, warning: undefined, helpCode:undefined, rateLimitUntil:undefined, ...result };
        this.activeJobs.delete(id); this.emit('data'); this.updateProgress();
      };
      while (pending.length || active.size) {
        if (!this.pauseReason) this.pauseReason = await this.gate(q.config.execution);
        while (!this.pauseReason && !exclusive && active.size < q.config.execution.concurrency && pending.length) {
          const index = pending.findIndex(job => !failedForSpace.has(jobId(job)) && !rateBlocked.has(rateKey(job)) && (volumes.get(volumeKeys.get(job.source.destination)) || 0) < 2 && (!heavy(job, q.config) || active.size === 0));
          if (index < 0) break;
          const job = pending.splice(index,1)[0], volume = volumeKeys.get(job.source.destination), isHeavy = heavy(job,q.config);
          volumes.set(volume,(volumes.get(volume) || 0) + 1); if (isHeavy) exclusive = true;
          let task;
          task = perform(job).finally(() => { active.delete(task); volumes.set(volume,volumes.get(volume)-1); if (isHeavy) exclusive = false; });
          active.add(task);
        }
        if (!active.size) break;
        await Promise.race(active);
        if (q.completed.length % 20 === 0 || Date.now() - lastSaved > 10000) { await this.saveState(this.state); lastSaved = Date.now(); }
      }
      if (pending.length) { q.pauseReason = this.pauseReason || (rateBlocked.size?'rate':failedForSpace.size?'space':'user'); if (q.pauseReason === 'rate') q.message = 'Warte auf die Freigabe des API-Limits. Erledigte Sicherungen bleiben erhalten.'; else delete q.rateLimitUntil; }
      else {
        const failed=result=>result.status==='error'||result.installation?.status==='error'||result.installation?.shortcuts?.status==='error';
        const errors = q.results.filter(failed), details = q.results.length > 500 ? [...errors, ...q.results.filter(r => !failed(r))].slice(0,500) : q.results;
        const elapsedMs = q.elapsedMs + Date.now() - this.sessionStarted;
        this.state.history.unshift({ startedAt: q.startedAt, finishedAt: new Date().toISOString(), trigger: q.trigger, results: details, resultCount: q.results.length, errorCount: errors.length, changedCount: q.results.filter(r => ['cloned','updated','repaired'].includes(r.status)||r.installation?.status==='installed').length, truncatedResults: q.results.length - details.length, durationMs: elapsedMs, receivedBytes: q.receivedBytes + (this.transport?.bytes || 0), backupBytes: q.results.filter(r => ['cloned','updated','repaired'].includes(r.status)).reduce((sum,r) => sum + (r.bytes || 0),0) });
        if (q.scheduledSources) this.state.lastScheduledBySource = { ...this.state.lastScheduledBySource, ...q.scheduledSources };
        this.state.history = this.state.history.slice(0,100); this.state.queue = null; completedRun = true;
      }
    } catch (error) {
      await Promise.allSettled(runningTasks);
      if (this.state.queue) { this.pauseReason = 'error'; this.state.queue.pauseReason = 'error'; this.state.queue.message = error.message; }
      else { this.state.history.unshift({ startedAt: new Date(this.sessionStarted).toISOString(), finishedAt: new Date().toISOString(), trigger, results: [{ fullName: 'Durchlauf', status: 'error', message: error.message }], resultCount: 1, errorCount: 1 }); this.state.history = this.state.history.slice(0,100); }
    } finally {
      if (this.state.queue) { this.state.queue.elapsedMs += Date.now() - this.sessionStarted; this.state.queue.receivedBytes += this.transport?.bytes || 0; }
      try { await this.transport?.close(); } finally { this.transport = null; try { await this.saveState(this.state); } finally { try { await release(); } finally { this.busy = false; this.progress = null; this.emit('change'); } } }
    }
    if (completedRun) this.emit('complete',this.state.history[0]);
    return this.state.queue ? { paused: true, reason: this.state.queue.pauseReason } : this.state.history[0];
  }
}
module.exports = { syncRepository, resolveJobs, BackupService, managed, verifyBackup, MARKER, jobId, heavy, backupFingerprint };
