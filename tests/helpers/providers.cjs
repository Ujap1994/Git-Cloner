const fs = require('node:fs/promises'),
  path = require('node:path');
const { execFile } = require('node:child_process'),
  { promisify } = require('node:util'),
  { pathToFileURL } = require('node:url');
const { repository } = require('./repository.cjs');
const { HostedClient } = require('../../app/core/hosted-client.cjs');
const { cloneURL } = require('../../app/core/provider-spec.cjs');
const { localTree } = require('../../app/core/changes.cjs');
const execute = promisify(execFile);
async function providerFixture(t, provider = 'gitlab') {
  const f = await repository(t),
    spec = { provider, server: `https://${provider}.example.test` },
    name = provider === 'gitlab' ? 'team/subgroup/project' : 'team/project';
  Object.assign(f.source, spec, { value: name });
  f.requests = [];
  f.http = [];
  f.metadata = { issues: [], pullRequests: [], releases: [], notes: [{ body: 'example comment' }], diffs: [] };
  f.raw =
    provider === 'gitlab'
      ? {
          id: 17,
          path_with_namespace: name,
          name: 'Display name',
          default_branch: 'main',
          wiki_enabled: true,
          statistics: { repository_size: 1024 }
        }
      : { id: 17, full_name: name, default_branch: 'main', has_wiki: true, size: 1 };
  f.fetch = async (url, options = {}) => {
    f.http.push({ url, options });
    options.signal?.throwIfAborted();
    const parsed = new URL(url),
      endpoint = parsed.pathname.replace(provider === 'gitlab' ? '/api/v4' : '/api/v1', ''),
      base = provider === 'gitlab' ? `/projects/${encodeURIComponent(name)}` : `/repos/${name}`;
    let data;
    if (f.rawDownloads?.has(parsed.pathname))
      return new Response(f.rawDownloads.get(parsed.pathname), {
        headers: { 'content-type': 'application/octet-stream' }
      });
    if (endpoint === base) data = f.raw;
    else if (provider === 'gitlab' && endpoint.startsWith(base + '/repository/files/')) {
      const file = decodeURIComponent(endpoint.slice((base + '/repository/files/').length)),
        ref = parsed.searchParams.get('ref'),
        sha = (await f.command('rev-parse', ref + ':' + file)).stdout.trim(),
        size = Number((await f.command('cat-file', '-s', sha)).stdout.trim());
      return new Response(null, { headers: { 'x-gitlab-size': String(size), 'x-gitlab-blob-id': sha } });
    } else if (provider === 'gitlab' && endpoint === base + '/repository/tree') {
      const ref = parsed.searchParams.get('ref'),
        tree = localTree((await f.command('ls-tree', '-r', '-l', '-z', ref)).stdout);
      data = tree.map(entry => ({
        id: entry.sha,
        path: entry.path,
        name: path.basename(entry.path),
        type: entry.type,
        mode: entry.mode
      }));
    } else if (endpoint.includes('/git/commits/')) {
      const sha = endpoint.split('/').at(-1);
      data = { commit: { tree: { sha: (await f.command('rev-parse', sha + '^{tree}')).stdout.trim() } } };
    } else if (endpoint.includes('/git/trees/'))
      data = {
        truncated: false,
        tree: localTree((await f.command('ls-tree', '-r', '-l', '-z', endpoint.split('/').at(-1))).stdout)
      };
    else if (/\/(git|repository)\/blobs\//.test(endpoint)) {
      const sha = endpoint.split('/').at(-1),
        { stdout } = await execute('git', ['-C', f.remote, 'cat-file', 'blob', sha], {
          encoding: 'buffer',
          windowsHide: true,
          maxBuffer: 1048576
        });
      data = { sha, size: stdout.length, encoding: 'base64', content: stdout.toString('base64') };
    } else if (endpoint.endsWith('/assets') || endpoint.endsWith('/assets/links'))
      data = f.metadata.releases[0]?.assets?.links ?? f.metadata.releases[0]?.assets ?? [];
    else if (endpoint === base + '/releases') data = f.metadata.releases;
    else if (endpoint === base + '/issues') data = f.metadata.issues;
    else if (endpoint === base + '/pulls' || endpoint === base + '/merge_requests') data = f.metadata.pullRequests;
    else if (endpoint.endsWith('/notes') || endpoint.endsWith('/comments')) data = f.metadata.notes;
    else if (endpoint.endsWith('/diffs') || endpoint.endsWith('/files')) data = f.metadata.diffs;
    else if (endpoint.endsWith('/reviews')) data = [];
    else if (provider === 'gitlab' && endpoint.startsWith('/groups/'))
      data = endpoint.endsWith('/projects') ? [f.raw] : { id: 12 };
    else if (provider === 'forgejo' && endpoint === '/orgs/team') data = { username: 'team' };
    else if (provider === 'forgejo' && endpoint === '/orgs/team/repos') data = [f.raw];
    else if (endpoint === '/user') data = { login: 'reader' };
    else
      return new Response(JSON.stringify({ message: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      });
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  f.github = new HostedClient({ ...spec, token: 'test-provider-token', username: 'reader', fetchImpl: f.fetch });
  f.repository = f.github.normalize(f.raw);
  const make = f.makeGit;
  f.makeGit = options => {
    const git = make(options),
      original = git.run;
    git.run = function (args, opts) {
      return original.call(
        this,
        args.map(value =>
          value === cloneURL(spec, name) || value === cloneURL(spec, name, true) ? pathToFileURL(f.remote).href : value
        ),
        opts
      );
    };
    return git;
  };
  f.git = f.makeGit({ ...spec, username: provider === 'gitlab' ? 'oauth2' : 'reader' });
  const sync = f.sync;
  f.sync = async options => ({ ...(await sync(options)), ...spec });
  f.addFile = async (name, text) => {
    const file = path.join(f.remote, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    await f.command('add', '.');
    await f.command('commit', '-m', 'change ' + name);
  };
  return f;
}
module.exports = { providerFixture };
