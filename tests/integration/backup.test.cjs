const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { Git } = require('../../app/core/git.cjs');
const { syncRepository } = require('../../app/core/backup.cjs');
const { prepareDestination, verifyDestination, VOLUME_MARKER } = require('../../app/core/destinations.cjs');

async function fixture(t, { empty = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'git-cloner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }));
  const remote = path.join(root, 'upstream');
  const destination = path.join(root, 'External Drive');
  await fs.mkdir(remote);
  await fs.mkdir(destination);
  const command = (...args) => exec('git', args, { cwd: remote, windowsHide: true });
  await command('init', '-b', 'main');
  await command('config', 'user.name', 'Backup tests');
  await command('config', 'user.email', 'tests@example.invalid');
  const commit = async text => {
    await fs.writeFile(path.join(remote, 'README.md'), text);
    await command('add', '.');
    await command('commit', '-m', text);
    return (await command('rev-parse', 'HEAD')).stdout.trim();
  };
  if (!empty) await commit('first');
  const url = pathToFileURL(remote).href;
  class LocalGit extends Git {
    remoteHead() {
      return super.remoteHead(url);
    }
    clone(_url, directory) {
      return super.clone(url, directory);
    }
  }
  const source = await prepareDestination({
    id: 'test',
    kind: 'repository',
    value: 'demo/project',
    enabled: true,
    destination
  });
  const repository = { full_name: 'demo/project', default_branch: 'main', size: 1 };
  const git = new LocalGit();
  const target = path.join(destination, 'demo', 'project');
  const sync = () => syncRepository({ source, repository, git });
  return { root, remote, destination, source, repository, git, target, commit, sync, command };
}

test('clones actual git repository and keeps a single shallow commit after updates', async t => {
  const f = await fixture(t);
  assert.equal((await f.sync()).status, 'cloned');
  assert.equal(await fs.readFile(path.join(f.target, 'README.md'), 'utf8'), 'first');
  const head = await f.commit('second');
  await f.commit('third');
  const result = await f.sync();
  assert.equal(result.status, 'updated');
  assert.notEqual(result.commit, head);
  assert.equal(await fs.readFile(path.join(f.target, 'README.md'), 'utf8'), 'third');
  assert.equal(await f.git.run(['-C', f.target, 'rev-list', '--count', 'HEAD']), '1');
  assert.deepEqual(await fs.readdir(path.dirname(f.target)), ['project']);
  assert.equal((await f.sync()).status, 'unchanged');
});
test('deleted upstream files disappear from the current snapshot', async t => {
  const f = await fixture(t);
  await f.sync();
  await fs.unlink(path.join(f.remote, 'README.md'));
  await fs.writeFile(path.join(f.remote, 'new.txt'), 'new');
  await f.command('add', '-A');
  await f.command('commit', '-m', 'replace files');
  await f.sync();
  await assert.rejects(fs.stat(path.join(f.target, 'README.md')));
  assert.equal(await fs.readFile(path.join(f.target, 'new.txt'), 'utf8'), 'new');
});
test('failed clone preserves the previous valid backup and cleans temporary files', async t => {
  const f = await fixture(t);
  await f.sync();
  await f.commit('second');
  f.git.clone = async (_url, stage) => {
    await fs.mkdir(stage);
    await fs.writeFile(path.join(stage, 'incomplete'), 'partial');
    throw new Error('network failed');
  };
  await assert.rejects(f.sync(), /network failed/);
  assert.equal(await fs.readFile(path.join(f.target, 'README.md'), 'utf8'), 'first');
  assert.deepEqual(await fs.readdir(path.dirname(f.target)), ['project']);
});
test('never overwrites a preexisting foreign directory', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.target, { recursive: true });
  await fs.writeFile(path.join(f.target, 'personal.txt'), 'keep me');
  await assert.rejects(f.sync());
  assert.equal(await fs.readFile(path.join(f.target, 'personal.txt'), 'utf8'), 'keep me');
});
test('missing external drive never creates a replacement destination', async t => {
  const f = await fixture(t);
  await fs.rename(f.destination, `${f.destination}-offline`);
  await assert.rejects(f.sync(), /nicht erreichbar/);
  await assert.rejects(fs.stat(f.destination));
});
test('an unmounted path without its volume marker is rejected', async t => {
  const f = await fixture(t);
  await fs.rename(f.destination, `${f.destination}-offline`);
  await fs.mkdir(f.destination);
  await assert.rejects(f.sync(), /Ziellaufwerk/);
  assert.deepEqual(await fs.readdir(f.destination), []);
});
test('another drive at the same path is rejected', async t => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.destination, VOLUME_MARKER),
    JSON.stringify({ schemaVersion: 1, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
  );
  await assert.rejects(verifyDestination(f.source), /ausgetauscht/);
  await assert.rejects(prepareDestination(f.source), /anderes Laufwerk/);
});
test('recovers previous snapshot after interruption between renames', async t => {
  const f = await fixture(t);
  await f.sync();
  await fs.rename(f.target, path.join(path.dirname(f.target), '.project.git-cloner-previous'));
  assert.equal((await f.sync()).status, 'unchanged');
  assert.equal(await fs.readFile(path.join(f.target, 'README.md'), 'utf8'), 'first');
});
test('cleans a marked partial clone left by process interruption', async t => {
  const f = await fixture(t);
  await f.sync();
  const stage = path.join(path.dirname(f.target), '.project.git-cloner-stage');
  await fs.mkdir(stage);
  await fs.writeFile(`${stage}.json`, JSON.stringify({ schemaVersion: 1, fullName: 'demo/project' }));
  assert.equal((await f.sync()).status, 'unchanged');
  assert.deepEqual(await fs.readdir(path.dirname(f.target)), ['project']);
});
test('foreign staging directory remains untouched', async t => {
  const f = await fixture(t);
  await f.sync();
  const stage = path.join(path.dirname(f.target), '.project.git-cloner-stage');
  await fs.mkdir(stage);
  await fs.writeFile(path.join(stage, 'personal'), 'keep');
  await assert.rejects(f.sync(), /fremder/);
  assert.equal(await fs.readFile(path.join(stage, 'personal'), 'utf8'), 'keep');
});
test('foreign orphan staging metadata is never overwritten', async t => {
  const f = await fixture(t);
  await f.sync();
  const marker = path.join(path.dirname(f.target), '.project.git-cloner-stage.json');
  const content = JSON.stringify({ personal: 'keep this file' });
  await fs.writeFile(marker, content);
  await assert.rejects(f.sync(), /fremde/);
  assert.equal(await fs.readFile(marker, 'utf8'), content);
  assert.equal(await fs.readFile(path.join(f.target, 'README.md'), 'utf8'), 'first');
});
test('symlinked owner directory cannot redirect backups outside the drive', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(f.destination, 'demo'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.sync(), /Unsicherer/);
  assert.deepEqual(await fs.readdir(outside), []);
});
test('empty git repositories are reported without destroying existing backups', async t => {
  const f = await fixture(t, { empty: true });
  assert.equal((await f.sync()).status, 'empty');
  await assert.rejects(fs.stat(f.target));
});
test('a changed default branch is included in the next snapshot', async t => {
  const f = await fixture(t);
  await f.sync();
  await f.command('checkout', '-b', 'new-default');
  await f.commit('new branch');
  assert.equal((await f.sync()).status, 'updated');
  assert.equal(await f.git.run(['-C', f.target, 'branch', '--show-current']), 'new-default');
});
