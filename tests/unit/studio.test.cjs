const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  { createHash } = require('node:crypto');
const { defaults, validateConfig } = require('../../app/core/config.cjs');
const { providerSpec, parseHostedSource, repositoryDestination } = require('../../app/core/provider-spec.cjs');
const { HostedClient } = require('../../app/core/hosted-client.cjs');
const { Runtime } = require('../../app/runtime.cjs');
const { Git } = require('../../app/core/git.cjs');
const { queryHistory, historyDetails, exportHistory, historyId } = require('../../app/core/history.cjs');
const { errorCode, errorHelp } = require('../../app/core/error-help.cjs');
const { spaceReady } = require('../../app/core/space-wait.cjs');
const source = (id, value, extra = {}) => ({
  id,
  kind: 'repository',
  value,
  destination: os.tmpdir(),
  enabled: true,
  ...extra
});
test('provider configuration supports GitLab subgroups and separates identical repository names across hosts', () => {
  const config = validateConfig({
    ...defaults(),
    sources: [
      source('one', 'team/project'),
      source('two', 'team/project', { provider: 'gitlab', server: 'https://gitlab.example' }),
      source('three', 'team/sub/project', { provider: 'gitlab', server: 'https://gitlab.example' })
    ]
  });
  assert.equal(config.sources[0].provider, undefined);
  assert.equal(config.sources[2].value, 'team/sub/project');
  assert.notEqual(
    repositoryDestination(config.sources[0], 'team/project'),
    repositoryDestination(config.sources[1], 'team/project')
  );
});
test('a credential account cannot be assigned to a different provider or server', () => {
  const config = {
    ...defaults(),
    accounts: [{ id: 'private', label: 'Private', provider: 'gitlab', server: 'https://one.example' }],
    sources: [
      source('one', 'team/project', { provider: 'gitlab', server: 'https://two.example', accountId: 'private' })
    ]
  };
  assert.throws(() => validateConfig(config), /denselben Anbieter/);
  config.sources[0].server = 'https://one.example';
  assert.equal(validateConfig(config).sources[0].accountId, 'private');
});
test('provider addresses reject credentials, plaintext transports and traversal while preserving server subpaths', () => {
  for (const server of [
    'http://git.example',
    'ssh://git.example',
    'https://token@git.example',
    'https://git.example/?token=x',
    'https://git.example/%2e%2e'
  ])
    assert.throws(() => providerSpec({ provider: 'forgejo', server }));
  assert.equal(
    parseHostedSource('https://git.example/git/team/project.git', 'repository', {
      provider: 'gitlab',
      server: 'https://git.example/git'
    }),
    'team/project'
  );
  assert.throws(() =>
    parseHostedSource('https://git.example.evil/team/project', 'repository', {
      provider: 'gitlab',
      server: 'https://git.example'
    })
  );
  assert.throws(() => parseHostedSource('team/../project', 'repository', { provider: 'gitlab' }));
});
test('default GitHub tokens and rebound preview accounts never reach another provider', () => {
  const runtime = new Runtime({ directory: os.tmpdir(), safeStorage: {}, version: '3.2.0' });
  runtime.config = { accounts: [{ id: 'lab', provider: 'gitlab', server: 'https://lab.example' }] };
  runtime.vault = { tokens: { default: 'github-secret', lab: 'gitlab-secret' } };
  assert.equal(
    runtime.sourceClient({ provider: 'gitlab', server: 'https://lab.example', accountId: 'default' }).token,
    ''
  );
  assert.equal(runtime.sourceClient({ provider: 'github', accountId: 'lab' }).token, '');
  assert.equal(runtime.sourceGit({ provider: 'github', accountId: 'lab' }).token, '');
  assert.equal(
    runtime.sourceClient({ provider: 'gitlab', server: 'https://other.example', accountId: 'lab' }).token,
    ''
  );
  assert.equal(
    runtime.sourceClient({ provider: 'gitlab', server: 'https://lab.example', accountId: 'lab' }).token,
    'gitlab-secret'
  );
  assert.equal(runtime.client().token, 'github-secret');
});
test('HTTP pagination follows server next links even when its maximum page size is smaller than requested', async () => {
  let calls = 0;
  const client = new HostedClient({
    provider: 'forgejo',
    server: 'https://forge.example',
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify(calls === 1 ? [1, 2] : [3]), {
        headers: {
          link:
            calls === 1
              ? '<https://forge.example/api/v1/items?page=2>; rel="next"'
              : '<https://forge.example/api/v1/items?page=1>; rel="prev"'
        }
      });
    }
  });
  assert.deepEqual(await client.collection('/items'), [1, 2, 3]);
  assert.equal(calls, 2);
});
test('Forgejo recursive Git trees follow its truncated-page marker instead of omitting later files', async () => {
  const calls = [],
    client = new HostedClient({
      provider: 'forgejo',
      server: 'https://forge.example',
      fetchImpl: async url => {
        calls.push(url);
        if (url.includes('/commits/'))
          return new Response(JSON.stringify({ commit: { tree: { sha: 'a'.repeat(40) } } }));
        const second = new URL(url).searchParams.get('page') === '2';
        return new Response(
          JSON.stringify({
            total_count: 2,
            truncated: !second,
            tree: [
              {
                path: second ? 'second.txt' : 'first.txt',
                type: 'blob',
                mode: '100644',
                sha: (second ? 'c' : 'b').repeat(40),
                size: 1
              }
            ]
          })
        );
      }
    });
  const tree = await client.tree('owner/project', 'd'.repeat(40));
  assert.deepEqual(
    tree.tree.map(f => f.path),
    ['first.txt', 'second.txt']
  );
  assert.equal(calls.length, 3);
  assert.equal(tree.truncated, false);
});
test('private release redirects drop authentication and validate downloaded bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-hosted-download-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [],
    bytes = Buffer.from('real payload');
  const client = new HostedClient({
    provider: 'gitlab',
    server: 'https://lab.example',
    token: 'private-token',
    resolveHost: async () => [{ address: '203.0.113.8' }],
    fetchImpl: async (url, options) => {
      requests.push({ url, headers: options.headers });
      return requests.length === 1
        ? new Response(null, { status: 302, headers: { location: 'https://cdn.example/file' } })
        : new Response(bytes);
    }
  });
  const file = path.join(root, 'asset');
  await client.downloadURL('https://lab.example/api/v4/projects/1/releases/v1/downloads/file', file, {
    expectedSize: bytes.length,
    expectedDigest: 'sha256:' + createHash('sha256').update(bytes).digest('hex')
  });
  assert.equal(requests[0].headers['PRIVATE-TOKEN'], 'private-token');
  assert.equal(requests[1].headers['PRIVATE-TOKEN'], undefined);
  assert.equal(requests[1].headers.Authorization, undefined);
  assert.deepEqual(await fs.readFile(file), bytes);
});
test('external release links cannot target localhost or private DNS addresses', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-hosted-private-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let calls = 0;
  const client = new HostedClient({
    provider: 'forgejo',
    server: 'https://forge.example',
    resolveHost: async () => [{ address: '192.168.1.5' }],
    fetchImpl: async () => {
      calls++;
      return new Response('no');
    }
  });
  await assert.rejects(client.downloadURL('https://localhost/internal', path.join(root, 'one')), /Lokale/);
  await assert.rejects(client.downloadURL('https://outside.example/file', path.join(root, 'two')), /lokales Netzwerk/);
  assert.equal(calls, 0);
  assert.deepEqual(await fs.readdir(root), []);
});
test('an HTML login page cannot silently become an installer backup', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-hosted-login-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const client = new HostedClient({
    provider: 'gitlab',
    server: 'https://lab.example',
    fetchImpl: async () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })
  });
  await assert.rejects(
    client.downloadURL('https://lab.example/file', path.join(root, 'asset'), { expectedName: 'program.zip' }),
    /Anmeldeseite/
  );
  assert.deepEqual(await fs.readdir(root), []);
});
test('Git credentials remain scoped to the configured host and never enter command arguments', async () => {
  let invocation;
  const git = new Git({
    server: 'https://lab.example/service',
    username: 'oauth2',
    token: 'private-token',
    exec: async (...args) => {
      invocation = args;
      return { stdout: 'ok' };
    }
  });
  await git.version();
  assert.equal(invocation[2].env.GIT_CONFIG_KEY_0, 'http.https://lab.example/service/.extraheader');
  assert(!JSON.stringify(invocation.slice(0, 2)).includes('private-token'));
  assert.equal(
    invocation[2].env.GIT_CONFIG_VALUE_0,
    'Authorization: Basic ' + Buffer.from('oauth2:private-token').toString('base64')
  );
});
function runs() {
  return [
    {
      startedAt: new Date(2026, 10, 4, 9).toISOString(),
      finishedAt: new Date(2026, 10, 4, 10).toISOString(),
      trigger: 'manual',
      resultCount: 500,
      errorCount: 1,
      changedCount: 1,
      results: Array.from({ length: 500 }, (_, i) => ({
        fullName: 'private-team/project-' + i,
        destination: '/Volumes/Private',
        status: i === 129 ? 'error' : 'updated',
        message: i === 129 ? 'secret local path /Volumes/Private' : undefined
      }))
    }
  ];
}
test('history searches every retained result while keeping list previews bounded and detail pages complete', () => {
  const history = runs(),
    result = queryHistory(history, { query: 'project-129', start: '2026-11-04', end: '2026-11-04', status: 'errors' });
  assert.equal(result.total, 1);
  assert.equal(result.runs[0].results.length, 1);
  assert.equal(result.runs[0].results[0].status, 'error');
  assert.equal(result.runs[0].detailCount, 500);
  const details = historyDetails(history, { id: result.runs[0].id, offset: 100 });
  assert.equal(details.results.length, 50);
  assert.equal(details.results[29].status, 'error');
  assert.equal(historyDetails(history, { id: result.runs[0].id, query: 'project-129' }).results[0].status, 'error');
  assert.equal(queryHistory(history, { start: '2026-11-05' }).total, 0);
});
test('selected and filtered history exports preserve all recorded results and remove personal values', () => {
  const history = runs(),
    id = historyId(history[0]);
  const exported = exportHistory(history, { query: 'project-129' });
  assert.equal(exported.runs[0].results.length, 500);
  assert.equal(exportHistory(history, { ids: [id] }).runs.length, 1);
  const text = JSON.stringify(exported);
  assert(!text.includes('private-team'));
  assert(!text.includes('/Volumes/Private'));
  assert(!text.includes('secret local path'));
});
test('history rejects invalid filters and missing run IDs without exporting unrelated records', () => {
  assert.throws(() => queryHistory(runs(), { start: 'tomorrow' }));
  assert.throws(() => queryHistory(runs(), { start: '2026-11-05', end: '2026-11-04' }));
  assert.throws(() => historyDetails(runs(), { id: 'missing' }));
  assert.equal(exportHistory(runs(), { ids: ['missing'] }).runs.length, 0);
});
test('space waiting resumes only when every blocked volume satisfies its stored byte requirement', async () => {
  const queue = { blockedSpaces: { one: { root: os.tmpdir(), requiredBytes: '100' } } };
  assert.equal(await spaceReady(queue, { statfs: async () => ({ bavail: 99n, bsize: 1n }) }), false);
  assert.equal(await spaceReady(queue, { statfs: async () => ({ bavail: 100n, bsize: 1n }) }), true);
  assert.equal(
    await spaceReady(queue, {
      statfs: async () => {
        throw new Error('missing drive');
      }
    }),
    false
  );
  assert.equal(await spaceReady({}), false);
});
test('error help offers relevant steps without echoing credentials, paths or remote messages', () => {
  for (const [error, code] of [
    [{ code: 'ENOSPC' }, 'space'],
    [{ code: 'EACCES' }, 'permissions'],
    [{ message: 'Ziellaufwerk fehlt' }, 'drive'],
    [{ message: 'Git LFS ist nicht installiert' }, 'git'],
    [{ message: 'Falsches Passwort oder beschädigtes Archiv.' }, 'password'],
    [{ message: 'HTTP 429' }, 'rate'],
    [{ helpCode: 'authentication', message: 'raw private-token /Users/private' }, 'authentication']
  ]) {
    assert.equal(errorCode(error), code);
    const help = errorHelp(error);
    assert(help.steps.length > 0);
    assert(!JSON.stringify(help).includes('private-token'));
    assert(!JSON.stringify(help).includes('/Users/private'));
  }
});
