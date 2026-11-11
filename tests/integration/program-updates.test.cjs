const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { repository } = require('../helpers/repository.cjs');
const { BackupService } = require('../../app/core/backup.cjs');
const { ProgramInstaller } = require('../../app/core/program-installation.cjs');
const { repositoryDestination } = require('../../app/core/provider-spec.cjs');
const { validateConfig } = require('../../app/core/config.cjs');

// The installer itself is covered with real files in release-programs.test.cjs. Here its platform-specific parts are
// replaced, so the runtime decisions (when to install, when to wait, what to report) are tested on every platform.
function stubInstaller(t, { running }) {
  const proto = ProgramInstaller.prototype,
    original = { install: proto.install, isRunning: proto.isRunning, locate: proto.locate },
    calls = [];
  t.after(() => Object.assign(proto, original));
  Object.assign(proto, {
    async install({ record }) {
      calls.push(record.releaseInfo.tag);
      if (running.value) throw Object.assign(new Error('Das Programm läuft noch.'), { code: 'PROGRAM_RUNNING' });
      return {
        status: 'installed',
        tag: record.releaseInfo.tag,
        destination: running.target,
        executable: path.join(running.target, 'Example.app'),
        programs: [{ key: 'Example.app', name: 'Example', executable: path.join(running.target, 'Example.app') }],
        previousTag: 'v1'
      };
    },
    async isRunning() {
      return running.value;
    },
    async locate() {
      return { target: running.target, identity: 'github:https://github.com:demo/project' };
    }
  });
  return calls;
}
async function setup(t, mode) {
  const f = await repository(t),
    programs = path.join(f.root, 'programs'),
    target = path.join(programs, 'demo', 'project');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, '.git-cloner-program.json'),
    JSON.stringify({ format: 'git-cloner-program', identity: 'github:https://github.com:demo/project', files: [] })
  );
  const config = f.config();
  config.backup.metadata.releases = true;
  config.programUpdates = { mode };
  config.sources[0].installation = { enabled: true, destination: programs, pattern: '' };
  const record = {
    id: 'record',
    fullName: 'demo/project',
    destination: path.join(f.backup, 'demo', 'project'),
    sourceId: f.source.id,
    targetId: `${f.source.id}:primary`,
    status: 'unchanged',
    releaseInfo: { tag: 'v2', fileCount: 1 },
    installation: { status: 'installed', tag: 'v1', destination: target }
  };
  const notices = [];
  const runtime = await f.runtime({
    config: validateConfig(config),
    state: { repositories: { record } },
    notifyProgram: value => notices.push(value)
  });
  return { f, runtime, target, notices };
}

test('manual program updates are only reported until Install now is used', async t => {
  const { runtime, target, notices } = await setup(t, 'manual'),
    calls = stubInstaller(t, { running: { value: false, target } });
  const record = runtime.record('record'),
    source = runtime.programSource(record);
  const pending = await runtime.applyInstallation({ source, record, previousInstallation: record.installation });
  assert.deepEqual([pending.installation.status, pending.installation.latestTag, calls.length], ['available', 'v2', 0]);
  const installed = await runtime.installProgram('record');
  assert.deepEqual([installed.status, installed.tag, calls], ['installed', 'v2', ['v2']]);
  assert.equal(runtime.backup.state.repositories.record.installation.tag, 'v2');
  assert.match(
    require('../../app/core/notification-text.cjs').programNotification(notices[0].results, 'en').body,
    /^Example v2 installed\.$/
  );
});

test('an update for a running program is installed after the program quits', async t => {
  const { runtime, target, notices } = await setup(t, 'after-exit'),
    running = { value: true, target },
    calls = stubInstaller(t, { running });
  await runtime.installStored('record');
  assert.equal(runtime.backup.state.repositories.record.installation.status, 'waiting');
  assert.match(runtime.backup.state.repositories.record.warning, /^Programminstallation: Das Programm läuft noch\./);
  await runtime.installAfterExit();
  assert.deepEqual(calls, ['v2']);
  running.value = false;
  await runtime.installAfterExit();
  const record = runtime.backup.state.repositories.record;
  assert.deepEqual(
    [record.installation.status, record.installation.tag, record.warning],
    ['installed', 'v2', undefined]
  );
  assert.equal(notices.length, 1);
  await runtime.installAfterExit();
  assert.deepEqual(calls, ['v2', 'v2']);
});

test('with installation at the next check, a running program is not watched', async t => {
  const { runtime, target } = await setup(t, 'next-check'),
    running = { value: true, target },
    calls = stubInstaller(t, { running });
  await runtime.installStored('record');
  assert.match(runtime.backup.state.repositories.record.installation.message, /nächsten Prüfung/);
  running.value = false;
  await runtime.installAfterExit();
  assert.deepEqual(calls, ['v2']);
  assert.equal(runtime.backup.state.repositories.record.installation.status, 'waiting');
});

test('a queue paused by the user is announced once or resumed after the configured time', async t => {
  const f = await repository(t);
  f.names = ['demo/project', 'demo/second', 'demo/third'];
  f.source.kind = 'owner';
  f.source.value = 'demo';
  const sync = async job => ({
    fullName: job.repository.full_name,
    destination: repositoryDestination(job.source, job.repository.full_name),
    status: 'cloned'
  });
  let first = true;
  const service = new BackupService({
    git: f.git,
    github: f.github,
    state: {},
    saveState: async () => {},
    sync: async job => {
      if (first) {
        first = false;
        await service.pause();
      }
      return sync(job);
    }
  });
  const config = f.config();
  config.execution.concurrency = 1;
  assert.equal((await service.run(config)).reason, 'user');
  const pausedAt = Date.parse(service.state.queue.pausedAt);
  assert.ok(Number.isFinite(pausedAt));
  let now = new Date(pausedAt + 23 * 3600000);
  const reminders = [],
    runtime = await f.runtime({
      config,
      state: structuredClone(service.state),
      now: () => now,
      notifyReminder: value => reminders.push(value)
    });
  runtime.backup.sync = sync;
  await runtime.followUpPause();
  assert.equal(reminders.length, 0);
  now = new Date(pausedAt + 25 * 3600000);
  await runtime.followUpPause();
  await runtime.followUpPause();
  assert.deepEqual(reminders, [{ pausedAt: new Date(pausedAt).toISOString(), completed: 1, total: 3 }]);
  assert.ok(runtime.backup.state.queue.remindedAt);
  runtime.config = validateConfig({
    ...runtime.config,
    execution: { ...runtime.config.execution, pauseReminder: { action: 'resume', hours: 24 } }
  });
  await runtime.followUpPause();
  assert.equal(runtime.backup.state.queue, null);
  assert.equal(runtime.backup.state.history[0].resultCount, 3);
});

test('a nearly used-up API quota pauses the queue before the next repository starts', async t => {
  const f = await repository(t);
  f.names = ['demo/project', 'demo/second'];
  f.source.kind = 'owner';
  f.source.value = 'demo';
  const until = new Date(Date.now() + 1800000).toISOString(),
    started = [];
  let remaining = 10;
  const github = Object.assign(Object.create(f.github), {
    budgetError: () =>
      remaining < 4 ? Object.assign(new Error('quota'), { rateLimited: true, rateLimitUntil: until }) : null
  });
  const service = new BackupService({
    git: f.git,
    github,
    state: {},
    saveState: async () => {},
    sync: async job => {
      started.push(job.repository.full_name);
      remaining = 2;
      return {
        fullName: job.repository.full_name,
        destination: repositoryDestination(job.source, job.repository.full_name),
        status: 'cloned'
      };
    }
  });
  const config = f.config();
  config.execution.concurrency = 1;
  const result = await service.run(config);
  assert.deepEqual([result.paused, result.reason, started], [true, 'rate', ['demo/project']]);
  assert.equal(service.state.queue.rateLimitUntil, until);
});

test('the window shows the remaining API quota of each used account', async t => {
  const f = await repository(t),
    runtime = await f.runtime();
  assert.deepEqual(runtime.snapshot().apiBudget, []);
  const reset = new Date(Date.now() + 600000).toISOString();
  Object.assign(runtime.client('default').rateState, { limit: 60, remaining: 21, resetAt: reset });
  assert.deepEqual(runtime.snapshot().apiBudget, [
    { id: 'default', label: 'GitHub', limit: 60, remaining: 21, resetAt: reset }
  ]);
  runtime.client('default').rateState.resetAt = new Date(Date.now() - 1000).toISOString();
  assert.deepEqual(runtime.snapshot().apiBudget[0], {
    id: 'default',
    label: 'GitHub',
    limit: 60,
    remaining: 60,
    resetAt: null
  });
});
