const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { defaults, validateConfig } = require('../../app/core/config.cjs');
const { includesRepository } = require('../../app/core/filters.cjs');
const { UpdateMonitor } = require('../../app/core/updates.cjs');
const { DeviceFlow } = require('../../app/core/device-flow.cjs');
const { scheduleFiles } = require('../../app/core/native-schedule.cjs');
const { redactLogs, exportSettings, importSettings } = require('../../app/core/transfer.cjs');
const { SecretVault } = require('../../app/core/vault.cjs');
const { acquireLease } = require('../../app/core/lease.cjs');
const { DriveMonitor } = require('../../app/core/drive-monitor.cjs');
const { resolveJobs } = require('../../app/core/backup.cjs');
const { GitHubClient } = require('../../app/core/github.cjs');

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-advanced-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('old settings migrate to fast defaults with no configured sources', () => {
  const config = validateConfig({
    schemaVersion: 1,
    sources: [],
    schedule: { enabled: true, checksPerDay: 1, times: ['02:00'] },
    launchAtLogin: false,
    closeToTray: true,
    notifications: true,
    checkUpdates: true
  });
  assert.deepEqual(config.sources, []);
  assert.equal(config.backup.integrity, 'weekly');
  assert.equal(config.backup.mode, 'snapshot');
  assert.equal(config.appearance.theme, 'system');
});
test('repository filters support names, full names, forks and archived repositories', () => {
  const repo = { full_name: 'team/web-app', fork: false, archived: false };
  assert.equal(includesRepository(repo, { include: ['web-*'], exclude: ['*-test'] }), true);
  assert.equal(includesRepository(repo, { include: ['other/*'] }), false);
  assert.equal(includesRepository(repo, { exclude: ['team/web-?pp'] }), false);
  assert.equal(includesRepository({ ...repo, fork: true }, { includeForks: false }), false);
  assert.equal(includesRepository({ ...repo, archived: true }, { includeArchived: false }), false);
});
test('individual rule can exclude a repository even when its owner is enabled', async () => {
  const github = {
    repositories: async () => [{ full_name: 'team/repo' }],
    repository: async () => ({ full_name: 'team/repo' })
  };
  const { jobs } = await resolveJobs(
    [
      { id: 'a', kind: 'owner', value: 'team', destination: os.tmpdir(), enabled: true },
      {
        id: 'b',
        kind: 'repository',
        value: 'team/repo',
        destination: os.tmpdir(),
        enabled: true,
        filters: { exclude: ['repo'] }
      }
    ],
    github
  );
  assert.equal(jobs.length, 0);
});
test('one source expands into independently addressable backup destinations', async t => {
  const root = await temp(t),
    github = { repository: async () => ({ full_name: 'team/repo' }) };
  const { jobs } = await resolveJobs(
    [
      {
        id: 'source',
        kind: 'repository',
        value: 'team/repo',
        destination: path.join(root, 'one'),
        additionalDestinations: [{ id: 'second', destination: path.join(root, 'two') }],
        enabled: true
      }
    ],
    github
  );
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].source.id, 'source');
  assert.equal(jobs[1].targetId, 'source:second');
});
test('skipping a version persists across restart and only a higher version notifies', async t => {
  const file = path.join(await temp(t), 'updates.json');
  let release = 'v2.1.0',
    notifications = 0;
  const github = { request: async () => ({ tag_name: release }) };
  const save = state => fs.writeFile(file, JSON.stringify(state));
  const first = new UpdateMonitor({ currentVersion: '2.0.0', github, save, notify: () => notifications++ });
  assert.equal((await first.check()).status, 'available');
  await first.ignore();
  assert.equal(notifications, 1);
  const second = new UpdateMonitor({
    currentVersion: '2.0.0',
    github,
    save,
    state: JSON.parse(await fs.readFile(file, 'utf8')),
    notify: () => notifications++
  });
  assert.equal((await second.check()).status, 'ignored');
  assert.equal(notifications, 1);
  release = 'v2.0.5';
  assert.equal((await second.check()).status, 'ignored');
  release = 'v2.2.0';
  assert.equal((await second.check()).status, 'available');
  assert.equal(notifications, 2);
  await second.check();
  assert.equal(notifications, 2);
});
test('running version newer than GitHub never prompts; skip can be reset', async () => {
  const github = { request: async () => ({ tag_name: 'v2.1.0' }) };
  const monitor = new UpdateMonitor({
    currentVersion: '2.0.0',
    github,
    state: { ignoredVersion: '2.1.0', lastNotifiedVersion: '2.1.0' }
  });
  assert.equal((await monitor.check()).status, 'ignored');
  assert.equal((await monitor.reset()).status, 'available');
  const ahead = new UpdateMonitor({ currentVersion: '3.0.0', github });
  assert.equal((await ahead.check()).status, 'current');
  await assert.rejects(ahead.ignore());
});
test('update requests are coalesced rather than issuing duplicate network calls', async () => {
  let resolve,
    calls = 0;
  const monitor = new UpdateMonitor({
    currentVersion: '2.0.0',
    github: {
      request: () => {
        calls++;
        return new Promise(done => {
          resolve = done;
        });
      }
    }
  });
  const a = monitor.check(),
    b = monitor.check();
  resolve({ tag_name: 'v2.1.0' });
  await Promise.all([a, b]);
  assert.equal(calls, 1);
});
test('GitHub ETags reuse payload on HTTP 304', async () => {
  let calls = 0;
  const client = new GitHubClient({
    fetchImpl: async (_url, options) => {
      calls++;
      if (calls === 1)
        return {
          ok: true,
          status: 200,
          headers: { get: () => '"revision-1"' },
          json: async () => ({ full_name: 'team/repo' })
        };
      assert.equal(options.headers['If-None-Match'], '"revision-1"');
      return { ok: false, status: 304 };
    }
  });
  assert.deepEqual(await client.repository('team/repo'), await client.repository('team/repo'));
});
test('settings export strips unknown secret fields and import does not enable OS registrations', () => {
  const config = defaults();
  config.oauthClientId = 'public-id';
  config.systemSchedule = true;
  config.launchAtLogin = true;
  config.password = 'do-not-export';
  config.token = 'never-export';
  const output = exportSettings(config);
  assert.ok(!JSON.stringify(output).includes('do-not-export'));
  assert.ok(!JSON.stringify(output).includes('never-export'));
  const imported = importSettings(output);
  assert.equal(imported.systemSchedule, false);
  assert.equal(imported.launchAtLogin, false);
});
test('redacted diagnostics contain no account names, paths, commits, tokens or raw messages', () => {
  const log = redactLogs([
    {
      startedAt: 'now',
      finishedAt: 'later',
      trigger: 'manual',
      results: [
        {
          fullName: 'private-user/private-repo',
          destination: '/Volumes/Secret/Backup',
          commit: 'a'.repeat(40),
          status: 'error',
          message: 'token ghp_secret /home/private-user/private-repo'
        }
      ]
    }
  ]);
  const json = JSON.stringify(log);
  for (const value of ['private-user', 'private-repo', '/Volumes', '/home', 'ghp_secret', 'a'.repeat(40)])
    assert.ok(!json.includes(value));
});
test('vault isolates account credentials and remembers archive passwords only on request', async t => {
  const root = await temp(t);
  const storage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: value => Buffer.from(value.split('').reverse().join('')),
    decryptString: value => value.toString().split('').reverse().join('')
  };
  const vault = new SecretVault(root, storage);
  await vault.load();
  await vault.setToken('one', 'first-secret');
  await vault.setToken('two', 'second-secret');
  await vault.setPassword('long-passphrase-one', false);
  assert.equal(vault.archivePassword, 'long-passphrase-one');
  const restarted = new SecretVault(root, storage);
  await restarted.load();
  assert.equal(restarted.tokens.one, 'first-secret');
  assert.equal(restarted.tokens.two, 'second-secret');
  assert.equal(restarted.archivePassword, '');
  await restarted.setPassword('long-passphrase-two', true);
  const again = new SecretVault(root, storage);
  await again.load();
  assert.equal(again.archivePassword, 'long-passphrase-two');
  assert.ok(!(await fs.readFile(vault.file, 'utf8')).includes('first-secret'));
});
test('file lease blocks overlapping processes and releases cleanly', async t => {
  const root = await temp(t),
    release = await acquireLease(root);
  await assert.rejects(acquireLease(root), { code: 'BUSY' });
  await release();
  await (
    await acquireLease(root)
  )();
});
test('a foreign malformed lock is not silently removed', async t => {
  const root = await temp(t);
  await fs.writeFile(path.join(root, 'backup.lock'), '{}');
  await assert.rejects(acquireLease(root), /Sperrdatei/);
  assert.equal(await fs.readFile(path.join(root, 'backup.lock'), 'utf8'), '{}');
});
test('drive reconnect enqueues once and retries while another run is busy', async () => {
  let online = false,
    busy = true,
    calls = 0;
  const config = defaults();
  config.onDriveConnect = true;
  config.sources = [{ id: 'a', enabled: true, destination: os.tmpdir(), volumeId: 'one' }];
  const monitor = new DriveMonitor({
    getConfig: () => config,
    verify: async () => {
      if (!online) throw new Error('offline');
    },
    run: async targets => {
      calls++;
      assert.deepEqual(targets, ['a:primary']);
      return { busy };
    }
  });
  await monitor.tick();
  assert.equal(calls, 0);
  online = true;
  await monitor.tick();
  assert.equal(calls, 1);
  busy = false;
  await monitor.tick();
  assert.equal(calls, 2);
  await monitor.tick();
  assert.equal(calls, 2);
  online = false;
  await monitor.tick();
  online = true;
  await monitor.tick();
  assert.equal(calls, 3);
});
test('native schedule templates cover local times without shell interpolation', () => {
  const base = {
    executable: path.resolve(os.tmpdir(), 'My App', 'git-cloner'),
    times: ['02:15', '18:45'],
    profile: os.tmpdir(),
    configDirectory: os.tmpdir(),
    home: os.tmpdir(),
    username: 'USER&Example',
    uid: 123
  };
  const linux = scheduleFiles({ ...base, platform: 'linux' });
  assert.match(linux.files[1].content, /OnCalendar=\*-\*-\* 02:15:00/);
  assert.match(linux.files[1].content, /18:45:00/);
  assert.match(linux.files[0].content, /--scheduled-worker/);
  const mac = scheduleFiles({ ...base, platform: 'darwin' });
  assert.match(mac.files[0].content, /<integer>18<\/integer>/);
  assert.equal(mac.enable[0][1][1], 'gui/123');
  const windows = scheduleFiles({ ...base, platform: 'win32' });
  assert.match(windows.files[0].content, /USER&amp;Example/);
  assert.match(windows.files[0].content, /<LogonType>InteractiveToken/);
  assert.equal(windows.enable[0][0], 'schtasks');
});
test('device login handles pending and slow-down without exposing device secrets', async () => {
  const replies = [
    {
      device_code: 'private-device-secret',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900
    },
    { error: 'authorization_pending' },
    { error: 'slow_down' },
    { access_token: 'oauth-secret' }
  ];
  const sleeps = [],
    codes = [];
  const flow = new DeviceFlow({
    fetchImpl: async () => ({ ok: true, json: async () => replies.shift() }),
    sleep: async ms => {
      sleeps.push(ms);
    }
  });
  assert.equal(await flow.login('public-client', code => codes.push(code)), 'oauth-secret');
  assert.deepEqual(sleeps, [5000, 5000, 10000]);
  assert.ok(!JSON.stringify(codes).includes('private-device-secret'));
});
test('device login rejects provider errors, invalid origins and missing client IDs', async () => {
  const flow = new DeviceFlow({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ device_code: 'secret', user_code: 'CODE', verification_uri: 'https://evil.example/device' })
    }),
    sleep: async () => {}
  });
  await assert.rejects(flow.login('', () => {}));
  await assert.rejects(
    flow.login('client', () => {}),
    /Ungültige/
  );
  let calls = 0;
  flow.fetchImpl = async () => ({
    ok: true,
    json: async () =>
      ++calls === 1
        ? { device_code: 'secret', user_code: 'CODE', verification_uri: 'https://github.com/login/device' }
        : { error: 'access_denied' }
  });
  await assert.rejects(
    flow.login('client', () => {}),
    /abgelehnt/
  );
});
