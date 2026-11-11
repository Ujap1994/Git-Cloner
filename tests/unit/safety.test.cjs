const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Git } = require('../../app/core/git.cjs');
const { TokenStore } = require('../../app/core/secrets.cjs');
const { writeJson, readJson } = require('../../app/core/store.cjs');
const { setAutostart } = require('../../app/core/autostart.cjs');
const { setNativeSchedule } = require('../../app/core/native-schedule.cjs');
const { resolveJobs, BackupService } = require('../../app/core/backup.cjs');

test('git credentials do not enter command arguments or saved remote URL', async () => {
  let invocation;
  const git = new Git({
    token: 'private-token',
    exec: async (...args) => {
      invocation = args;
      return { stdout: 'ok' };
    }
  });
  await git.clone('https://github.com/demo/repo.git', '/backup/a folder');
  assert.equal(invocation[0], 'git');
  assert.ok(!JSON.stringify(invocation[1]).includes('private-token'));
  assert.equal(invocation[2].env.GIT_TERMINAL_PROMPT, '0');
  assert.ok(invocation[2].env.GIT_CONFIG_VALUE_0.startsWith('Authorization: Basic '));
  assert.ok(invocation[1].includes('--depth=1'));
});
test('git error messages do not expose command or credentials', async () => {
  const git = new Git({
    exec: async () => {
      throw new Error('secret command');
    }
  });
  await assert.rejects(git.version(), error => !error.message.includes('secret'));
});
test('individual repository rules override account paths', async () => {
  const sources = [
    { id: 'a', kind: 'owner', value: 'demo', destination: '/one', enabled: true },
    { id: 'b', kind: 'repository', value: 'demo/repo', destination: '/two', enabled: true }
  ];
  const github = {
    repositories: async () => [{ full_name: 'demo/repo' }, { full_name: 'demo/other' }],
    repository: async () => ({ full_name: 'demo/repo' })
  };
  const { jobs } = await resolveJobs(sources, github);
  assert.equal(jobs.length, 2);
  assert.equal(jobs.find(j => j.repository.full_name === 'demo/repo').source.id, 'b');
});
test('account errors do not prevent other sources resolving', async () => {
  const github = {
    repositories: async () => {
      throw new Error('offline');
    },
    repository: async () => ({ full_name: 'some/repo' })
  };
  const result = await resolveJobs(
    [
      { kind: 'owner', value: 'bad', enabled: true },
      { kind: 'repository', value: 'some/repo', destination: os.tmpdir(), enabled: true }
    ],
    github
  );
  assert.equal(result.jobs.length, 1);
  assert.equal(result.errors.length, 1);
});
test('nested backup destinations are rejected', async () => {
  const github = { repository: async value => ({ full_name: value }) };
  const sources = [
    { kind: 'repository', value: 'a/b', destination: os.tmpdir(), enabled: true },
    { kind: 'repository', value: 'c/d', destination: path.join(os.tmpdir(), 'a', 'b'), enabled: true }
  ];
  await assert.rejects(resolveJobs(sources, github), /verschachtelt/);
});
test('backup service prevents overlapping runs and records bounded history', async () => {
  let release;
  const state = { history: Array.from({ length: 100 }, () => ({ results: [] })) };
  const backup = new BackupService({
    state,
    github: {},
    git: {
      version: () =>
        new Promise(resolve => {
          release = resolve;
        })
    },
    saveState: async () => {}
  });
  const running = backup.run({ sources: [] });
  assert.deepEqual(await backup.run({ sources: [] }), { busy: true });
  release();
  await running;
  assert.equal(backup.state.history.length, 100);
  assert.equal(backup.busy, false);
});
test('settings JSON is atomic and corrupt input never silently resets', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  assert.deepEqual(await readJson(file, { a: 1 }), { a: 1 });
  await writeJson(file, { a: 2 });
  assert.deepEqual(await readJson(file, {}), { a: 2 });
  assert.deepEqual(await fs.readdir(root), ['settings.json']);
  await fs.writeFile(file, 'broken');
  await assert.rejects(readJson(file, {}));
});
test('token store refuses plaintext fallback and roundtrips encrypted storage', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-token-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' };
  const store = new TokenStore(root, storage);
  await assert.rejects(store.save('test-value'), /Schlüsselspeicher/);
  storage.getSelectedStorageBackend = () => 'gnome_libsecret';
  storage.encryptString = value => Buffer.from(value.split('').reverse().join(''));
  storage.decryptString = buffer => buffer.toString().split('').reverse().join('');
  await store.save('test-value');
  assert.equal(await store.load(), 'test-value');
  assert.ok(!(await fs.readFile(store.file, 'utf8')).includes('test-value'));
  await store.save('');
  assert.equal(await store.load(), '');
});
test('Linux autostart quotes executable paths and can be removed', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-start-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = { isPackaged: true, getPath: key => (key === 'appData' ? root : '/opt/My App/git-cloner') };
  const options = { platform: 'linux', appImage: null, flatpakId: null };
  await setAutostart(app, true, options);
  const file = path.join(root, 'autostart', 'git-cloner.desktop');
  assert.match(await fs.readFile(file, 'utf8'), /Exec="\/opt\/My App\/git-cloner" --hidden/);
  await setAutostart(app, false, options);
  await assert.rejects(fs.stat(file));
});
test('strict Snap refuses unavailable host startup integration before accessing host paths', async () => {
  const app = {
    isPackaged: true,
    getPath: () => assert.fail('Host paths must not be accessed')
  };
  await assert.rejects(setAutostart(app, true, { platform: 'linux', snap: '/snap/git-cloner/1' }), /Snap-Paket/);
  await assert.rejects(
    setNativeSchedule(app, { systemSchedule: true }, { platform: 'linux', snap: '/snap/git-cloner/1' }),
    /native App/
  );
});
