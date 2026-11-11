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
const { defaults } = require('../../app/core/config.cjs');
const { prepareDestination } = require('../../app/core/destinations.cjs');
const { syncRepository, verifyBackup, managed } = require('../../app/core/backup.cjs');
const { restoreBackup } = require('../../app/core/restore.cjs');
const { encryptArchive, decryptArchive } = require('../../app/core/archives.cjs');
const { metadataPlan } = require('../../app/core/metadata.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-complete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const remote = path.join(root, 'remote'),
    destination = path.join(root, 'backup'),
    restore = path.join(root, 'restore');
  await Promise.all([fs.mkdir(remote), fs.mkdir(destination), fs.mkdir(restore)]);
  const command = (...args) => exec('git', args, { cwd: remote, windowsHide: true });
  await command('init', '-b', 'main');
  await command('config', 'user.name', 'Tests');
  await command('config', 'user.email', 'tests@example.invalid');
  const commit = async value => {
    await fs.writeFile(path.join(remote, 'file.txt'), value);
    await command('add', '.');
    await command('commit', '-m', value);
    return (await command('rev-parse', 'HEAD')).stdout.trim();
  };
  await commit('initial');
  const url = pathToFileURL(remote).href;
  class LocalGit extends Git {
    run(args, options) {
      return super.run(
        args.map(value => (value === 'https://github.com/demo/project.git' ? url : value)),
        options
      );
    }
  }
  const git = new LocalGit(),
    source = await prepareDestination({
      id: 'source',
      kind: 'repository',
      value: 'demo/project',
      destination,
      enabled: true
    });
  const repository = { full_name: 'demo/project', size: 1, default_branch: 'main', has_wiki: false };
  const options = defaults().backup;
  const sync = extra => syncRepository({ source, repository, git, options, ...extra });
  return {
    root,
    remote,
    destination,
    restore,
    git,
    source,
    repository,
    options,
    sync,
    commit,
    command,
    target: path.join(destination, 'demo', 'project')
  };
}
test('mirror keeps every branch and tag and fetches changes incrementally', async t => {
  const f = await fixture(t);
  f.options.mode = 'mirror';
  await f.command('branch', 'feature');
  await f.command('tag', 'v1');
  assert.equal((await f.sync()).status, 'cloned');
  assert.equal(await f.git.run(['-C', f.target, 'rev-parse', '--is-bare-repository']), 'true');
  assert.ok((await f.git.run(['-C', f.target, 'show-ref'])).includes('refs/heads/feature'));
  f.git.cloneMirror = async () => {
    throw new Error('full clone should not run again');
  };
  await f.command('branch', '-D', 'feature');
  await f.command('tag', '-d', 'v1');
  await f.commit('next');
  await f.command('tag', 'v2');
  assert.equal((await f.sync()).status, 'updated');
  const refs = await f.git.run(['-C', f.target, 'show-ref']);
  assert.ok(!refs.includes('refs/heads/feature'));
  assert.ok(!refs.includes('refs/tags/v1'));
  assert.ok(refs.includes('refs/tags/v2'));
  assert.equal((await f.sync()).status, 'unchanged');
  assert.deepEqual(await fs.readdir(path.dirname(f.target)), ['project']);
});
test('scheduled integrity check repairs modified worktree files without losing a valid backup', async t => {
  const f = await fixture(t);
  f.options.integrity = 'always';
  await f.sync();
  await fs.writeFile(path.join(f.target, 'file.txt'), 'corrupt');
  await assert.rejects(verifyBackup({ fullName: 'demo/project', destination: f.target }, f.git), /Integritätsprüfung/);
  assert.equal((await f.sync()).status, 'repaired');
  assert.equal(await fs.readFile(path.join(f.target, 'file.txt'), 'utf8'), 'initial');
  assert.ok((await verifyBackup({ fullName: 'demo/project', destination: f.target }, f.git)).files > 0);
});
test('encrypted backup contains no plaintext project files and restores with its password', async t => {
  const f = await fixture(t);
  f.options.encryption = true;
  const passphrase = 'a correct long passphrase';
  const result = await f.sync({ passphrase });
  assert.equal(result.encrypted, true);
  assert.deepEqual((await fs.readdir(f.target)).sort(), ['backup.gcb', 'git-cloner.json']);
  assert.equal((await f.sync({ passphrase })).status, 'unchanged');
  const restored = await restoreBackup({
    record: result,
    parent: f.restore,
    name: 'recovered',
    passphrase,
    git: f.git
  });
  assert.equal(await fs.readFile(path.join(restored.destination, 'file.txt'), 'utf8'), 'initial');
  assert.equal((await managed(restored.destination, 'demo/project')).encrypted, false);
});
test('incorrect passwords and corrupted ciphertext cannot leave extracted output', async t => {
  const f = await fixture(t);
  f.options.encryption = true;
  await f.sync({ passphrase: 'a correct long passphrase' });
  const archive = path.join(f.target, 'backup.gcb'),
    output = path.join(f.root, 'output');
  await assert.rejects(decryptArchive(archive, output, 'an incorrect long passphrase'), /Passwort/);
  await assert.rejects(fs.stat(output));
  const bytes = await fs.readFile(archive);
  bytes[bytes.length - 25] ^= 1;
  await fs.writeFile(archive, bytes);
  await assert.rejects(decryptArchive(archive, output, 'a correct long passphrase'), /beschädigtes/);
  await assert.rejects(fs.stat(output));
});
test('archive operations and restore never remove preexisting foreign files', async t => {
  const f = await fixture(t);
  await f.sync();
  const archive = path.join(f.root, 'foreign.gcb');
  await fs.writeFile(archive, 'personal');
  await assert.rejects(encryptArchive(f.target, archive, 'a correct long passphrase'));
  assert.equal(await fs.readFile(archive, 'utf8'), 'personal');
  const folder = path.join(f.restore, 'occupied');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'keep'), 'personal');
  await assert.rejects(decryptArchive(archive, folder, 'a correct long passphrase'));
  assert.equal(await fs.readFile(path.join(folder, 'keep'), 'utf8'), 'personal');
  await assert.rejects(
    restoreBackup({
      record: { destination: f.target, fullName: 'demo/project' },
      parent: f.restore,
      name: 'occupied',
      git: f.git
    }),
    /existiert/
  );
  assert.equal(await fs.readFile(path.join(folder, 'keep'), 'utf8'), 'personal');
});
test('unencrypted restore creates a verified independent working directory', async t => {
  const f = await fixture(t);
  const record = await f.sync();
  const restored = await restoreBackup({ record, parent: f.restore, name: 'new-project', git: f.git });
  assert.ok(restored.files > 0);
  await fs.writeFile(path.join(restored.destination, 'file.txt'), 'user edits');
  assert.equal(await fs.readFile(path.join(f.target, 'file.txt'), 'utf8'), 'initial');
});
test('metadata export saves issues, comments, reviews, releases and assets', async t => {
  const f = await fixture(t),
    calls = [];
  const github = {
    collection: async endpoint => {
      calls.push(endpoint);
      if (endpoint.includes('/issues?'))
        return [
          { number: 1, comments: 1, title: 'Issue' },
          { number: 2, pull_request: { url: 'x' } }
        ];
      if (endpoint.includes('/pulls?')) return [{ number: 2, title: 'PR' }];
      if (endpoint.endsWith('/releases')) return [{ tag_name: 'v1', assets: [{ id: 10, name: 'release.bin' }] }];
      return [{ body: 'metadata' }];
    },
    request: async () => ({ tag_name: 'v1', assets: [{ id: 10, name: 'release.bin' }] }),
    downloadAsset: async (_name, _id, file) => fs.writeFile(file, 'asset bytes')
  };
  f.options.metadata = { issues: true, pullRequests: true, releases: true, wiki: false };
  const record = await f.sync({ github });
  assert.equal(record.status, 'cloned');
  const metadata = path.join(f.target, '.git', 'git-cloner-metadata');
  assert.equal(JSON.parse(await fs.readFile(path.join(metadata, 'issues.json'), 'utf8')).length, 1);
  assert.equal(await fs.readFile(path.join(f.target, 'Git-Cloner-Releases', 'release.bin'), 'utf8'), 'asset bytes');
  assert.ok(calls.some(url => url.endsWith('/pulls/2/reviews')));
  assert.ok(calls.some(url => url.endsWith('/issues/1/comments')));
  assert.equal((await f.sync({ github })).status, 'unchanged');
});
test('metadata changes refresh the backup even when Git HEAD is unchanged', async t => {
  const f = await fixture(t);
  f.options.metadata.issues = true;
  let title = 'first';
  const github = { collection: async () => [{ number: 1, comments: 0, title }] };
  await f.sync({ github });
  title = 'updated';
  assert.equal((await f.sync({ github })).status, 'updated');
  const issues = JSON.parse(
    await fs.readFile(path.join(f.target, '.git', 'git-cloner-metadata', 'issues.json'), 'utf8')
  );
  assert.equal(issues[0].title, 'updated');
});
test('a disabled or unavailable Wiki is explicitly represented without fetching unsafe URLs', async () => {
  const plan = await metadataPlan(
    { full_name: 'demo/project', has_wiki: false },
    { wiki: true },
    {},
    {
      revision: async () => {
        throw new Error('must not run');
      }
    }
  );
  assert.equal(plan.warning, null);
});
test('a later Wiki outage preserves the previous complete backup', async t => {
  const f = await fixture(t);
  f.options.metadata.wiki = true;
  const plan = {
    digest: 'wiki-first',
    wikiRevision: 'abc',
    apply: async directory => {
      await fs.writeFile(path.join(directory, '.git', 'wiki-proof'), 'previous Wiki');
    }
  };
  await f.sync({ plan });
  await f.commit('new remote content');
  await assert.rejects(
    f.sync({ plan: { ...plan, digest: 'wiki-outage', wikiRevision: null, warning: 'Wiki not accessible' } }),
    /vorhandene Sicherung bleibt/
  );
  assert.equal(await fs.readFile(path.join(f.target, 'file.txt'), 'utf8'), 'initial');
  assert.equal(await fs.readFile(path.join(f.target, '.git', 'wiki-proof'), 'utf8'), 'previous Wiki');
});
test('encrypted archives preserve passive external symlinks without touching the linked data', async t => {
  if (process.platform === 'win32') {
    t.skip('Creating symlinks requires extra Windows privileges.');
    return;
  }
  const f = await fixture(t),
    input = path.join(f.root, 'archive-input'),
    output = path.join(f.root, 'archive-output');
  await fs.mkdir(input);
  await fs.writeFile(path.join(input, 'regular.txt'), 'inside');
  const outside = path.join(f.root, 'outside.txt');
  await fs.writeFile(outside, 'untouched');
  await fs.symlink(outside, path.join(input, 'external-link'));
  const archive = path.join(f.root, 'links.gcb');
  await encryptArchive(input, archive, 'a correct long passphrase');
  await decryptArchive(archive, output, 'a correct long passphrase');
  assert.equal(await fs.readlink(path.join(output, 'external-link')), outside);
  assert.equal(await fs.readFile(path.join(output, 'regular.txt'), 'utf8'), 'inside');
  assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
});
test('missing encryption password cannot replace a previous plaintext backup', async t => {
  const f = await fixture(t);
  await f.sync();
  f.options.encryption = true;
  await assert.rejects(f.sync(), /Archivpasswort/);
  assert.equal(await fs.readFile(path.join(f.target, 'file.txt'), 'utf8'), 'initial');
});
test('restoring an encrypted full mirror preserves all refs and commits', async t => {
  const f = await fixture(t);
  f.options.mode = 'mirror';
  f.options.encryption = true;
  await f.command('tag', 'release');
  const record = await f.sync({ passphrase: 'encrypted mirror passphrase' });
  const restored = await restoreBackup({
    record,
    parent: f.restore,
    name: 'restored-mirror',
    passphrase: 'encrypted mirror passphrase',
    git: f.git
  });
  assert.ok((await f.git.run(['-C', restored.destination, 'show-ref'])).includes('refs/tags/release'));
});
test('Git LFS stores and restores actual file contents instead of pointers', async t => {
  try {
    await exec('git', ['lfs', 'version'], { windowsHide: true });
  } catch (_error) {
    t.skip('Git LFS is not installed on this runner.');
    return;
  }
  const f = await fixture(t);
  f.options.lfs = true;
  await f.command('lfs', 'install', '--local', '--skip-smudge', '--skip-repo');
  await f.command('lfs', 'track', '*.bin');
  const bytes = Buffer.alloc(65536, 0x5a);
  await fs.writeFile(path.join(f.remote, 'large.bin'), bytes);
  await f.command('add', '.');
  await f.command('commit', '-m', 'LFS file');
  const pointer = (await f.command('show', 'HEAD:large.bin')).stdout;
  assert.ok(pointer.includes('https://git-lfs.github.com/spec/v1'));
  await f.sync();
  assert.deepEqual(await fs.readFile(path.join(f.target, 'large.bin')), bytes);
  assert.ok((await verifyBackup({ destination: f.target, fullName: 'demo/project' }, f.git)).files > 0);
});
test('unsafe local submodule URLs cannot execute or replace a previous backup', async t => {
  const f = await fixture(t);
  await f.sync();
  await fs.writeFile(
    path.join(f.remote, '.gitmodules'),
    '[submodule "unsafe"]\n path = nested\n url = file:///tmp/unsafe\n'
  );
  await f.command('add', '.gitmodules');
  await f.command('update-index', '--add', '--cacheinfo', `160000,${await f.git.head(f.remote)},nested`);
  await f.command('commit', '-m', 'submodule');
  f.options.submodules = true;
  await assert.rejects(f.sync());
  assert.equal(await fs.readFile(path.join(f.target, 'file.txt'), 'utf8'), 'initial');
});
