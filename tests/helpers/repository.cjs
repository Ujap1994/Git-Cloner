const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { Git } = require('../../app/core/git.cjs');
const { GitHubClient } = require('../../app/core/github.cjs');
const { syncRepository, jobId } = require('../../app/core/backup.cjs');
const { defaults, validateConfig } = require('../../app/core/config.cjs');
const { prepareDestination } = require('../../app/core/destinations.cjs');
const { localTree } = require('../../app/core/changes.cjs');
const { writeJson } = require('../../app/core/store.cjs');
const { Runtime } = require('../../app/runtime.cjs');
const execute = promisify(execFile);
async function repository(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-preferences-'))),
    remote = path.join(root, 'remote'),
    mount = path.join(root, 'drive-a'),
    backup = path.join(mount, 'backups'),
    directory = path.join(root, 'profile');
  await Promise.all([fs.mkdir(remote), fs.mkdir(backup, { recursive: true })]);
  const command = (...args) => execute('git', args, { cwd: remote, windowsHide: true, maxBuffer: 16 * 1048576 });
  await command('init', '-b', 'main');
  await command('config', 'user.name', 'Package tests');
  await command('config', 'user.email', 'tests@example.invalid');
  await command('config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(remote, 'README.md'), '  old text  \n');
  await fs.writeFile(path.join(remote, 'removed.txt'), 'remove me\n');
  await command('add', '.');
  await command('commit', '-m', 'initial');
  const f = {
    root,
    remote,
    mount,
    backup,
    directory,
    command,
    names: ['demo/project'],
    releases: [],
    assets: new Map(),
    requests: [],
    downloads: [],
    runtimes: []
  };
  class LocalGit extends Git {
    run(args, options) {
      return super.run(
        args.map(arg =>
          typeof arg === 'string' && f.names.some(name => arg === `https://github.com/${name}.git`)
            ? pathToFileURL(remote).href
            : arg
        ),
        options
      );
    }
  }
  f.makeGit = options => new LocalGit(options);
  f.git = f.makeGit();
  f.source = await prepareDestination({
    id: 'source',
    kind: 'repository',
    value: 'demo/project',
    enabled: true,
    destination: backup
  });
  f.source.volumeHint = { root: mount, relative: 'backups', canonical: backup };
  f.repository = { full_name: 'demo/project', size: 1, has_wiki: false, default_branch: 'main' };
  f.options = defaults().backup;
  const downloader = new GitHubClient({
    fetchImpl: async url => {
      const id = Number(new URL(url).pathname.split('/').at(-1));
      f.downloads.push(id);
      const bytes = f.assets.get(id);
      return new Response(bytes ?? null, { status: bytes ? 200 : 404 });
    }
  });
  f.github = {
    repository: async name => ({ ...f.repository, full_name: name }),
    repositories: async () => f.names.map(name => ({ ...f.repository, full_name: name })),
    collection: async endpoint => {
      const assets = endpoint.match(/\/releases\/(\d+)\/assets/);
      return assets
        ? (f.releases.find(r => r.id === Number(assets[1]))?.assets ?? [])
        : endpoint.includes('/releases')
          ? f.releases
          : [];
    },
    request: async endpoint => {
      f.requests.push(endpoint);
      if (endpoint.endsWith('/releases/latest')) return f.releases.find(r => !r.draft && !r.prerelease) ?? null;
      const commit = endpoint.match(/\/git\/commits\/([a-f\d]+)$/);
      if (commit) return { tree: { sha: (await command('rev-parse', `${commit[1]}^{tree}`)).stdout.trim() } };
      const tree = endpoint.match(/\/git\/trees\/([a-f\d]+)(?:\?|$)/);
      if (tree)
        return { truncated: false, tree: localTree((await command('ls-tree', '-r', '-l', '-z', tree[1])).stdout) };
      const blob = endpoint.match(/\/git\/blobs\/([a-f\d]+)$/);
      if (blob) {
        const { stdout } = await execute('git', ['-C', remote, 'cat-file', 'blob', blob[1]], {
          encoding: 'buffer',
          windowsHide: true,
          maxBuffer: 1048576
        });
        return { encoding: 'base64', content: stdout.toString('base64'), sha: blob[1], size: stdout.length };
      }
      if (endpoint.startsWith('/users/'))
        return endpoint.includes('/repos')
          ? f.names.map(name => ({ ...f.repository, full_name: name, owner: { login: 'demo' } }))
          : { type: 'User' };
      if (/^\/repos\/demo\/[^/?]+$/.test(endpoint)) return { ...f.repository, full_name: endpoint.slice(7) };
      throw new Error('Unexpected fixture API request: ' + endpoint);
    },
    downloadAsset: (...args) => downloader.downloadAsset(...args)
  };
  f.sync = async (extra = {}) => {
    const value = await syncRepository({
      source: f.source,
      repository: f.repository,
      git: f.git,
      github: f.github,
      options: f.options,
      ...extra
    });
    return {
      ...value,
      id: jobId({ source: extra.source ?? f.source, repository: extra.repository ?? f.repository }),
      sourceId: f.source.id,
      targetId: `${f.source.id}:primary`
    };
  };
  f.asset = (id, name, text) => {
    const buffer = Buffer.from(text);
    f.assets.set(id, buffer);
    return { id, name, size: buffer.length, digest: 'sha256:' + createHash('sha256').update(buffer).digest('hex') };
  };
  f.config = () => validateConfig({ ...defaults(), checkUpdates: false, sources: [f.source] });
  f.runtime = async ({ config = f.config(), state = {}, ...options } = {}) => {
    await writeJson(path.join(directory, 'settings.json'), config);
    await writeJson(path.join(directory, 'state.json'), state);
    const runtime = await new Runtime({
      directory,
      safeStorage: { isEncryptionAvailable: () => false },
      version: require('../../package.json').version,
      gitFactory: f.makeGit,
      fetchImpl: async url => ({
        ok: true,
        status: 200,
        json: () => f.github.request(new URL(url).pathname + new URL(url).search)
      }),
      ...options
    }).init();
    f.runtimes.push(runtime);
    return runtime;
  };
  t.after(async () => {
    for (const runtime of f.runtimes) await runtime.stop();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return f;
}
module.exports = { repository };
