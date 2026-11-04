const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { defaults, parseSource, effectiveBackup } = require('./config.cjs');
const { retry } = require('./retry.cjs');
const { createTransport } = require('./transport.cjs');
const { readJson, writeJson } = require('./store.cjs');
const { verifyDestination, safeDirectory, checkSpace } = require('./destinations.cjs');
const { includesRepository } = require('./filters.cjs');
const { hashFile, writeManifest, verifyDirectory, verificationDue, controlDirectory } = require('./integrity.cjs');
const { encryptArchive, decryptArchive } = require('./archives.cjs');
const { metadataPlan } = require('./metadata.cjs');
const MARKER = 'git-cloner.json';
const copyOptions = { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true };
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
async function syncRepository({ source, repository, git, github, options = defaults().backup, plan, passphrase, onProgress = () => {} }) {
  const fullName = parseSource(repository.full_name, 'repository'), [owner, name] = fullName.split('/');
  const opts = { ...defaults().backup, ...options, metadata: { ...defaults().backup.metadata, ...options.metadata } };
  let root = await verifyDestination(source);
  const parent = await safeDirectory(root, [owner], true);
  const { target, staging, previous, markerFile } = await recover(parent, name, fullName);
  const current = await exists(target) ? await managed(target, fullName) : null;
  const url = `https://github.com/${fullName}.git`;
  onProgress({ fullName, status: 'checking' });
  const revision = await git.revision(url, opts.mode === 'mirror');
  if (!revision) return { fullName, destination: target, status: 'empty', message: 'Leeres Repository ohne Commit.', checkedAt: new Date().toISOString() };
  plan ??= await metadataPlan(repository, opts.metadata, github, git);
  if (current?.wikiRevision && plan.warning) throw new Error('Das Wiki konnte nicht aktualisiert werden. Die vorhandene Sicherung bleibt erhalten.');
  const fingerprint = createHash('sha256').update(JSON.stringify({ mode: opts.mode, lfs: opts.lfs, submodules: opts.submodules, encrypted: opts.encryption, metadata: opts.metadata, keyId: opts.encryption ? opts.encryptionKeyId : null })).digest('hex');
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
      return { fullName, destination: target, commit: current.commit, mode: opts.mode, encrypted: opts.encryption, files: current.files, bytes: current.bytes, verifiedAt, verificationStatus: 'ok', status: 'unchanged', checkedAt: new Date().toISOString() };
    } catch (_error) { repair = true; }
  }
  await checkSpace(root, (repository.size ?? 0) * 2048, opts.reserveMB);
  await writeJson(markerFile, { schemaVersion: 1, fullName });
  let temporary;
  try {
    let payload = staging;
    if (opts.encryption) {
      if (!passphrase) throw new Error('Bitte zuerst das Archivpasswort in den Einstellungen entsperren.');
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'git-cloner-encrypt-')); await fs.chmod(temporary, 0o700);
      await checkSpace(temporary, (repository.size ?? 0) * 2048, opts.reserveMB);
      payload = path.join(temporary, 'payload'); await fs.mkdir(staging, { mode: 0o700 });
    }
    onProgress({ fullName, status: 'cloning' });
    let reusable = current && !current.encrypted && !opts.encryption && !repair && current.fingerprint === fingerprint;
    if (reusable && opts.mode === 'snapshot' && current.revision === revision) {
      try { await verifyDirectory(target, git, current.mode); } catch (_error) { reusable = false; repair = true; }
    }
    if (opts.mode === 'mirror') {
      if (reusable) { await fs.cp(target, payload, copyOptions); await git.updateMirror(payload, url, repository.default_branch); }
      else await git.cloneMirror(url, payload);
    } else if (reusable && current.revision === revision) await fs.cp(target, payload, copyOptions);
    else await git.clone(url, payload);
    if (opts.submodules) await git.submodules(payload);
    if (opts.lfs) await git.lfs(payload, opts.mode === 'mirror');
    await plan.apply(payload, opts.mode);
    onProgress({ fullName, status: 'verifying' }); await git.fsck(payload);
    const commit = await git.head(payload);
    if (!/^[a-f\d]{40,64}$/.test(commit)) throw new Error('Der neue Stand enthält keinen gültigen Commit.');
    const verification = await writeManifest(payload, opts.mode);
    const marker = { schemaVersion: 1, fullName, commit, revision, mode: opts.mode, encrypted: opts.encryption, fingerprint, metadataDigest: plan.digest, wikiRevision: plan.wikiRevision ?? null, ...verification, updatedAt: new Date().toISOString() };
    await writeJson(path.join(controlDirectory(payload, opts.mode), MARKER), { ...marker, encrypted: false });
    if (opts.encryption) {
      onProgress({ fullName, status: 'encrypting' }); await encryptArchive(payload, path.join(staging, 'backup.gcb'), passphrase);
      marker.archiveHash = await hashFile(path.join(staging, 'backup.gcb')); await writeJson(path.join(staging, MARKER), marker);
    }
    root = await verifyDestination(source); await safeDirectory(root, [owner]);
    if (current) { await managed(target, fullName); await fs.rename(target, previous); }
    try { await fs.rename(staging, target); }
    catch (error) { if (current && !await exists(target)) await fs.rename(previous, target); throw error; }
    if (current) await fs.rm(previous, { recursive: true });
    return { fullName, destination: target, commit, mode: opts.mode, encrypted: opts.encryption, ...verification, verificationStatus: 'ok', status: repair ? 'repaired' : current ? 'updated' : 'cloned', ...(plan.warning ? { warning: plan.warning } : {}), checkedAt: new Date().toISOString() };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }); await fs.rm(markerFile, { force: true });
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
}
async function resolveJobs(sources, github, { onlyTargets = null } = {}) {
  const selected = sources.filter(s => s.enabled), overrides = new Set(selected.filter(s => s.kind === 'repository').map(s => s.value.toLowerCase()));
  const jobs = [], errors = [], excluded = [], paths = new Set(), reserved = new Set();
  for (const source of selected) {
    try {
      const client = typeof github === 'function' ? github(source) : github;
      const repos = source.kind === 'owner' ? await client.repositories(source.value) : [await client.repository(source.value)];
      for (const repository of repos) {
        const fullName = parseSource(repository.full_name, 'repository');
        if ((source.kind === 'owner' && overrides.has(fullName.toLowerCase())) || !includesRepository(repository, source.filters)) { excluded.push({ fullName, sourceId: source.id, reason: source.kind === 'owner' && overrides.has(fullName.toLowerCase()) ? 'override' : 'filter' }); continue; }
        for (const target of [{ id: 'primary', destination: source.destination, volumeId: source.volumeId }, ...(source.additionalDestinations ?? [])]) {
          const targetId = `${source.id}:${target.id}`;
          if (onlyTargets && !onlyTargets.includes(targetId)) continue;
          const destination = path.resolve(target.destination, ...fullName.split('/')).toLowerCase();
          if (paths.has(destination)) throw new Error('Mehrere Repositories verwenden denselben Zielordner.');
          const parent = path.dirname(destination), name = path.basename(destination);
          const internals = [`.${name}.git-cloner-stage`,`.${name}.git-cloner-previous`,`.${name}.git-cloner-stage.json`].map(n => path.join(parent,n));
          if (reserved.has(destination) || internals.some(p => paths.has(p) || reserved.has(p))) throw new Error('Reservierte temporäre Sicherungspfade überschneiden sich.');
          for (const other of paths) if (destination.startsWith(other + path.sep) || other.startsWith(destination + path.sep)) throw new Error('Sicherungsordner dürfen nicht ineinander verschachtelt werden.');
          paths.add(destination);
          internals.forEach(p => reserved.add(p));
          if (jobs.length >= 100000) throw new Error('Zu viele Sicherungsziele. Bitte Quellen mit Filtern auf höchstens 100000 Ziele begrenzen.');
          jobs.push({ source: { ...source, destination: target.destination, volumeId: target.volumeId }, repository, sourceId: source.id, targetId, github: client });
        }
      }
    } catch (error) {
      if (/verschachtelt|denselben|Reservierte|Zu viele Sicherungsziele/.test(error.message)) throw error;
      errors.push({ fullName: source.value, sourceId: source.id, status: 'error', message: error.message });
    }
  }
  return { jobs, errors, excluded };
}
function jobId(job) { return createHash('sha256').update(`${job.repository.full_name.toLowerCase()}\0${path.resolve(job.source.destination, ...job.repository.full_name.split('/'))}`).digest('hex').slice(0, 24); }
function serialJob(job) { const serial = { ...job }; delete serial.github; return serial; }
function heavy(job, config) {
  const options = effectiveBackup(config, job.source);
  return job.repository.size == null || job.repository.size > (config.execution?.smallRepoMB ?? 50) * 1024 || options.mode === 'mirror' || options.lfs || options.submodules || options.encryption || Object.values(options.metadata).some(Boolean);
}
class BackupService extends EventEmitter {
  constructor({ github, git, saveState, state = {}, getGit, getPassphrase = async () => '', acquireLock = null, gate = async () => null, sync = syncRepository, transportFactory = createTransport, retryOptions = {} }) {
    super(); Object.assign(this, { github, git, saveState, getGit, getPassphrase, acquireLock, gate, sync, transportFactory, retryOptions });
    this.state = { repositories: {}, history: [], lastScheduledAt: null, queue: null, ...state }; this.busy = false; this.progress = null;
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
  async run(config, { scheduledAt = null, trigger = 'manual', onlyTargets = null, resume = false } = {}) {
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
        if (scheduledAt) this.state.lastScheduledAt = scheduledAt;
        this.state.queue = { id: require('node:crypto').randomUUID(), config: structuredClone(config), jobs: [], unresolved: true, onlyTargets, completed: [], results: [], startedAt: new Date().toISOString(), trigger: scheduledAt ? 'schedule' : trigger, elapsedMs: 0, receivedBytes: 0, pauseReason: null };
      }
      const q = this.state.queue;
      if (resume && scheduledAt) this.state.lastScheduledAt = scheduledAt;
      // Execution rules may be relaxed while paused; backup content remains fixed.
      q.config.execution = structuredClone(config.execution || defaults().execution);
      if (config.backup?.encryptionKeyId) q.config.backup.encryptionKeyId = config.backup.encryptionKeyId;
      q.pauseReason = null;
      if (q.unresolved) {
        const blocked = this.pauseReason || await this.gate(q.config.execution);
        if (blocked) { this.pauseReason = blocked; q.pauseReason = blocked; return { paused: true, reason: blocked }; }
        const resolver = source => { const client = typeof this.github === 'function' ? this.github(source) : this.github; return client.withTransfer ? client.withTransfer(null,q.config.execution.retries) : client; };
        const { jobs, errors } = await resolveJobs(q.config.sources,resolver,{onlyTargets:q.onlyTargets});
        q.jobs = jobs.map(serialJob); q.results.push(...errors); q.unresolved = false;
      }
      await this.saveState(this.state);
      const completedIds = new Set(q.completed), pending = q.jobs.filter(job => !completedIds.has(jobId(job))), active = runningTasks, volumes = new Map(), plans = new Map();
      const volumeKeys = new Map(await Promise.all([...new Set(pending.map(job => job.source.destination))].map(async destination => { try { return [destination,`device:${(await fs.stat(destination)).dev}`]; } catch (_error) { return [destination,`path:${path.resolve(destination)}`]; } })));
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
          result = await retry(async () => {
            const key = `${job.source.accountId}:${job.repository.full_name}:${JSON.stringify(options.metadata)}`;
            if (!plans.has(key)) plans.set(key, metadataPlan(job.repository, options.metadata, github, git).catch(error => { plans.delete(key); throw error; }));
            return this.sync({ ...job, github, git, options, plan: await plans.get(key), passphrase: options.encryption ? await this.getPassphrase() : '', onProgress: update });
          }, { ...this.retryOptions, retries: q.config.execution.retries, onRetry: event => update({ status: 'retrying', attempt: event.attempt, retryAt: new Date(Date.now() + event.delay).toISOString() }) });
        } catch (error) { result = { fullName: job.repository.full_name, destination: path.join(job.source.destination, ...job.repository.full_name.split('/')), status: 'error', message: error.message, checkedAt: new Date().toISOString() }; }
        result = { ...result, id, sourceId: job.sourceId, targetId: job.targetId, durationMs: Date.now() - started };
        q.results.push(result); q.completed.push(id); completedIds.add(id);
        const legacy = this.state.repositories[result.fullName];
        const previous = this.state.repositories[id] || (legacy?.destination === result.destination ? legacy : {}) || {};
        if (legacy?.destination === result.destination) delete this.state.repositories[result.fullName];
        this.state.repositories[id] = { ...previous, message: undefined, warning: undefined, ...result };
        this.activeJobs.delete(id); this.emit('data'); this.updateProgress();
      };
      while (pending.length || active.size) {
        if (!this.pauseReason) this.pauseReason = await this.gate(q.config.execution);
        while (!this.pauseReason && !exclusive && active.size < q.config.execution.concurrency && pending.length) {
          const index = pending.findIndex(job => (volumes.get(volumeKeys.get(job.source.destination)) || 0) < 2 && (!heavy(job, q.config) || active.size === 0));
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
      if (pending.length) q.pauseReason = this.pauseReason || 'user';
      else {
        const errors = q.results.filter(result => result.status === 'error'), details = q.results.length > 500 ? [...errors, ...q.results.filter(r => r.status !== 'error')].slice(0,500) : q.results;
        const elapsedMs = q.elapsedMs + Date.now() - this.sessionStarted;
        this.state.history.unshift({ startedAt: q.startedAt, finishedAt: new Date().toISOString(), trigger: q.trigger, results: details, resultCount: q.results.length, errorCount: errors.length, truncatedResults: q.results.length - details.length, durationMs: elapsedMs, receivedBytes: q.receivedBytes + (this.transport?.bytes || 0), backupBytes: q.results.filter(r => ['cloned','updated','repaired'].includes(r.status)).reduce((sum,r) => sum + (r.bytes || 0),0) });
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
    return this.state.queue ? { paused: true, reason: this.state.queue.pauseReason } : completedRun ? this.state.history[0] : this.state.history[0];
  }
}
module.exports = { syncRepository, resolveJobs, BackupService, managed, verifyBackup, MARKER, jobId, heavy };
