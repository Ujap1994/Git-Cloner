const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { defaults, validateConfig } = require('../../app/core/config.cjs');
const { organizeConfig, prepareBulk, RepositoryBrowser } = require('../../app/core/source-workspace.cjs');
const { GitHubClient } = require('../../app/core/github.cjs');
const { HostedClient } = require('../../app/core/hosted-client.cjs');
const { strongModified } = require('../../app/core/release-downloads.cjs');

function config() {
  const value = defaults();
  value.sourceGroups = [{ id: 'work', name: 'Projekte' }];
  value.sources = ['one', 'two', 'three'].map((id, index) => ({
    id,
    kind: 'repository',
    value: `example/${id}`,
    destination: os.tmpdir(),
    enabled: true,
    groupId: index < 2 ? 'work' : null,
    favorite: index === 0
  }));
  return validateConfig(value);
}
test('groups are empty on first launch and old source configurations migrate without preset data', () => {
  assert.deepEqual(defaults().sourceGroups, []);
  assert.deepEqual(defaults().sources, []);
  const value = config();
  delete value.sourceGroups;
  for (const source of value.sources) {
    delete source.groupId;
    delete source.favorite;
  }
  const result = validateConfig(value);
  assert.deepEqual(result.sourceGroups, []);
  assert(result.sources.every(source => source.groupId === null && source.favorite === false));
});
test('HTTP modification dates require a canonical date at least sixty seconds older than the response', () => {
  assert(strongModified('Wed, 04 Nov 2026 10:00:00 GMT', 'Wed, 04 Nov 2026 10:01:00 GMT'));
  assert(!strongModified('Wed, 04 Nov 2026 10:00:00 GMT', 'Wed, 04 Nov 2026 10:00:59 GMT'));
  assert(!strongModified('2026-11-04T10:00:00Z', 'Wed, 04 Nov 2026 10:02:00 GMT'));
  assert(!strongModified('Wed, 04 Nov 2026 10:00:00 GMT\r\nInjected: value', 'Wed, 04 Nov 2026 10:02:00 GMT'));
});
test('group validation rejects ambiguous names, missing references and oversized inputs', () => {
  for (const sourceGroups of [
    [
      { id: 'work', name: 'Test' },
      { id: 'two', name: 'test' }
    ],
    [{ id: 'work', name: ' ' }],
    [{ id: 'work', name: 'name\nother' }],
    [{ id: 'work', name: 'a'.repeat(61) }],
    Array.from({ length: 31 }, (_, i) => ({ id: `id-${i}`, name: `Group ${i}` }))
  ])
    assert.throws(() => validateConfig({ ...config(), sourceGroups }));
  const value = config();
  value.sources[0].groupId = 'missing';
  assert.throws(() => validateConfig(value));
});
test('renaming and removing a group retains every source and every backup setting', () => {
  const value = config(),
    renamed = organizeConfig(value, { group: { id: 'work', name: '  Neue Gruppe  ' } });
  assert.equal(renamed.sourceGroups[0].name, 'Neue Gruppe');
  assert.equal(value.sourceGroups[0].name, 'Projekte');
  const removed = organizeConfig(renamed, { group: { id: 'work', remove: true } });
  assert.equal(removed.sources.length, 3);
  assert(removed.sources.every(source => source.groupId === null));
  assert.equal(removed.sources[0].destination, value.sources[0].destination);
  assert.equal(removed.sources[0].favorite, true);
});
test('organization changes only the explicitly selected source IDs', () => {
  const value = config(),
    next = organizeConfig(value, { ids: ['two', 'three'], favorite: true, groupId: 'work' });
  assert.deepEqual(next.sources[0], value.sources[0]);
  assert(next.sources.every(source => source.favorite));
  assert.equal(next.sources[2].groupId, 'work');
  for (const ids of [[], ['missing'], ['one', 'one']])
    assert.throws(() => organizeConfig(value, { ids, favorite: true }));
});
test('bulk previews preserve per-source differences and all unselected settings', () => {
  const value = config();
  value.sources[0].backup = { ...value.backup, lfs: true, metadata: { ...value.backup.metadata, wiki: true } };
  value.sources[1].filters.exclude = ['local-*'];
  const result = prepareBulk(value, {
    ids: ['one', 'two'],
    patch: { backup: { metadata: { releases: true } }, filters: { includeForks: false } }
  });
  assert.equal(result.changed, 2);
  assert.deepEqual(result.config.sources[2], value.sources[2]);
  assert.equal(result.config.sources[0].backup.lfs, true);
  assert.equal(result.config.sources[0].backup.metadata.wiki, true);
  assert.equal(result.config.sources[1].backup.lfs, false);
  assert.deepEqual(result.config.sources[1].filters.exclude, ['local-*']);
  assert.equal(value.sources[0].backup.metadata.releases, false);
});
test('bulk edits can inherit global options and reject invalid changes atomically', () => {
  const value = config();
  value.sources[0].backup = { ...value.backup, lfs: true };
  assert.equal(prepareBulk(value, { ids: ['one'], patch: { backup: null } }).config.sources[0].backup, null);
  for (const patch of [
    { token: 'never accepted' },
    { backup: 123 },
    { filters: null },
    { destination: 'relative' },
    { schedule: { enabled: true, checksPerDay: 2, times: ['02:00'] } },
    { backup: { mode: 'mirror', submodules: true } },
    { enabled: 'yes' }
  ])
    assert.throws(() => prepareBulk(value, { ids: ['one', 'two'], patch }));
  assert.equal(value.sources[0].backup.lfs, true);
  assert.equal(value.sources[1].enabled, true);
});
test('repository browser preserves private GitHub pagination and performs no clone or destination writes', async () => {
  const requests = [],
    client = new GitHubClient({
      token: 'fixture-secret',
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        const parsed = new URL(url);
        if (parsed.pathname === '/users/example') return Response.json({ type: 'User' });
        if (parsed.pathname === '/user') return Response.json({ login: 'example' });
        return Response.json(
          [
            {
              full_name: parsed.searchParams.get('page') === '2' ? 'example/new-two' : 'example/new-one',
              private: true
            }
          ],
          {
            headers: {
              link:
                parsed.searchParams.get('page') === '2'
                  ? '<https://api.github.com/user/repos?page=1>; rel="prev"'
                  : '<https://api.github.com/user/repos?page=2>; rel="next"'
            }
          }
        );
      }
    });
  const browser = new RepositoryBrowser({ getConfig: config, clientFor: () => client });
  const first = await browser.open({ owner: 'example', accountId: 'default' });
  assert.equal(first.hasMore, true);
  assert.equal(first.repositories[0].private, true);
  assert(requests.at(-1).url.includes('/user/repos?affiliation=owner'));
  const second = await browser.page({ sessionId: first.sessionId, page: 2 });
  assert.equal(second.hasMore, false);
  const before = requests.length;
  await browser.page({ sessionId: first.sessionId, page: 1 });
  assert.equal(requests.length, before);
  const selected = browser.selection({
    sessionId: first.sessionId,
    repositories: ['example/new-one', 'example/new-two'],
    destination: os.tmpdir(),
    groupId: 'work',
    favorite: true
  });
  assert.equal(selected.added, 2);
  assert.equal(selected.config.sources.at(-1).favorite, true);
  assert(!JSON.stringify(first).includes('fixture-secret'));
  assert(requests.every(request => request.options.headers.Authorization === 'Bearer fixture-secret'));
  browser.close();
});
test('repository search is bounded and remains scoped to the chosen GitHub owner', async () => {
  let searchURL;
  const client = new GitHubClient({
    fetchImpl: async url => {
      if (new URL(url).pathname.startsWith('/users/')) return Response.json({ type: 'User' });
      searchURL = url;
      return Response.json({
        total_count: 1500,
        incomplete_results: false,
        items: [{ full_name: 'example/match' }, { full_name: 'foreign/match' }]
      });
    }
  });
  const context = await client.repositoryContext('example'),
    result = await client.repositoryPage(context, { query: 'my-project', page: 20 });
  assert.equal(result.limited, true);
  assert.equal(result.hasMore, false);
  assert.deepEqual(
    result.repositories.map(repo => repo.full_name),
    ['example/match']
  );
  assert(new URL(searchURL).searchParams.get('q').includes('user:example'));
});
test('browser selection rejects unseen repositories, expired sessions and source-limit overflow', async () => {
  let now = 1;
  const value = config(),
    client = {
      repositoryContext: async owner => ({ owner }),
      repositoryPage: async () => ({
        repositories: [{ full_name: 'example/one' }, { full_name: 'example/new' }],
        hasMore: false
      })
    };
  const browser = new RepositoryBrowser({ getConfig: () => value, clientFor: () => client, now: () => now });
  const page = await browser.open({ owner: 'example' });
  assert.equal(page.repositories[0].existing, true);
  assert.equal(
    browser.selection({
      sessionId: page.sessionId,
      repositories: ['example/one', 'example/new'],
      destination: os.tmpdir()
    }).skipped,
    1
  );
  assert.throws(() =>
    browser.selection({ sessionId: page.sessionId, repositories: ['example/unseen'], destination: os.tmpdir() })
  );
  value.sources.push(
    ...Array.from({ length: 97 }, (_, index) => ({
      ...value.sources[0],
      id: `extra-${index}`,
      value: `example/extra-${index}`
    }))
  );
  assert.throws(
    () => browser.selection({ sessionId: page.sessionId, repositories: ['example/new'], destination: os.tmpdir() }),
    /100/
  );
  now += 900001;
  await assert.rejects(browser.page({ sessionId: page.sessionId }), /abgelaufen/);
});
test('repository-browser credentials cannot be rebound to an unrelated server', async () => {
  let calls = 0;
  const value = {
    ...config(),
    accounts: [{ id: 'private', label: 'Private', provider: 'gitlab', server: 'https://one.example' }]
  };
  const browser = new RepositoryBrowser({
    getConfig: () => value,
    clientFor: () => {
      calls++;
    }
  });
  await assert.rejects(
    browser.open({ provider: 'gitlab', server: 'https://two.example', owner: 'group', accountId: 'private' }),
    /passen/
  );
  assert.equal(calls, 0);
});
test('opening another repository owner cancels the previous request without replacing the new selection', async () => {
  const client = {
    repositoryContext: async (owner, { signal }) => {
      if (owner === 'old-owner')
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
        );
      return { owner };
    },
    repositoryPage: async context => ({ repositories: [{ full_name: `${context.owner}/project` }], hasMore: false })
  };
  const browser = new RepositoryBrowser({ getConfig: config, clientFor: () => client });
  const old = assert.rejects(browser.open({ owner: 'old-owner' }), { name: 'AbortError' });
  const current = await browser.open({ owner: 'new-owner' });
  await old;
  assert.equal(current.owner, 'new-owner');
  assert.equal(
    browser.selection({ sessionId: current.sessionId, repositories: ['new-owner/project'], destination: os.tmpdir() })
      .added,
    1
  );
});
test('GitLab browser searches subgroups and respects server page-size caps', async () => {
  const urls = [],
    client = new HostedClient({
      provider: 'gitlab',
      server: 'https://lab.example',
      fetchImpl: async url => {
        urls.push(url);
        if (new URL(url).pathname === '/api/v4/groups/team%2Fsub') return Response.json({ id: 7 });
        return Response.json(
          [{ path_with_namespace: 'team/sub/project', visibility: 'private' }, { path_with_namespace: 'other/shared' }],
          { headers: { 'x-next-page': '2', 'x-total-count': '60' } }
        );
      }
    });
  const context = await client.repositoryContext('team/sub'),
    result = await client.repositoryPage(context, { query: 'project' });
  assert.equal(result.hasMore, true);
  assert.equal(result.repositories.length, 1);
  assert(urls.at(-1).includes('include_subgroups=true'));
  assert(urls.at(-1).includes('search=project'));
});
test('Forgejo browser scopes searches by the actual owner ID and includes private matches', async () => {
  const urls = [],
    client = new HostedClient({
      provider: 'forgejo',
      server: 'https://forge.example',
      token: 'fixture-secret',
      fetchImpl: async url => {
        urls.push(url);
        const pathname = new URL(url).pathname;
        if (pathname === '/api/v1/orgs/team') return Response.json({ id: 9 });
        return Response.json({ total_count: 1, data: [{ full_name: 'team/project', private: true }] });
      }
    });
  const context = await client.repositoryContext('team'),
    result = await client.repositoryPage(context, { query: 'project' });
  assert.equal(result.repositories[0].private, true);
  assert.equal(result.hasMore, false);
  assert.equal(new URL(urls.at(-1)).searchParams.get('uid'), '9');
});
test('resumed GitHub asset redirects forward only Range validators and never credentials', async () => {
  const requests = [],
    client = new GitHubClient({
      token: 'fixture-secret',
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return requests.length === 1
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://release-assets.githubusercontent.com/fixture' }
            })
          : new Response('tail');
      }
    });
  await client.assetResponse('example/project', 1, { offset: 123, etag: '"fixture-v1"' });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer fixture-secret');
  assert.deepEqual(requests[1].options.headers, {
    'Accept-Encoding': 'identity',
    Range: 'bytes=123-',
    'If-Range': '"fixture-v1"'
  });
});

test('GitHub source URLs normalize repository, organization and profile navigation without preset values', () => {
  const { normalizeSourceInput: normalize } = require('../../app/renderer/source-input.js');
  const { parseSource } = require('../../app/core/config.cjs');
  for (const url of [
    'https://github.com/example/project.git/',
    'https://github.com/example/project/releases/latest#assets',
    'https://github.com/example/project/tree/main/docs'
  ])
    assert.equal(normalize(url).value, 'example/project');
  for (const url of [
    'https://github.com/orgs/example/repositories',
    'https://github.com/example?tab=repositories&type=source',
    'https://github.com/example/'
  ]) {
    assert.equal(normalize(url).value, 'example');
    assert.equal(normalize(url).ownerPage, true);
    assert.equal(parseSource(url, 'owner'), 'example');
  }
  assert.equal(normalize('example/project').ownerPage, false);
  for (const url of [
    'http://github.com/example/project',
    'https://github.com.evil.test/example/project',
    'https://secret@github.com/example/project',
    'https://github.com/example/project?token=secret',
    'https://github.com/example/project/unrecognized'
  ])
    assert.throws(() => normalize(url));
});
test('owner imports cover future repositories and repeated owner URLs preserve existing settings', async () => {
  let value = config();
  const client = {
    repositoryContext: async owner => ({ owner }),
    repositoryPage: async () => ({ repositories: [{ full_name: 'example/new' }], hasMore: false })
  };
  const browser = new RepositoryBrowser({ getConfig: () => value, clientFor: () => client });
  let opened = await browser.open({ owner: 'https://github.com/orgs/example/repositories' });
  const template = {
    backup: { ...value.backup, lfs: true },
    schedule: { enabled: true, checksPerDay: 1, times: ['05:00'] },
    filters: { includeForks: false, exclude: ['test-*'] }
  };
  const added = browser.ownerSelection({ sessionId: opened.sessionId, destination: os.tmpdir(), template });
  value = added.config;
  assert.equal(added.added, 1);
  assert.equal(value.sources.at(-1).kind, 'owner');
  assert.equal(value.sources.at(-1).backup.lfs, true);
  assert.deepEqual(value.sources.at(-1).schedule.times, ['05:00']);
  opened = await browser.open({ owner: 'https://github.com/example?tab=repositories' });
  const repeated = browser.ownerSelection({ sessionId: opened.sessionId, destination: '/should-not-overwrite' });
  assert.equal(repeated.added, 0);
  assert.equal(repeated.skipped, 1);
  assert.deepEqual(repeated.config, value);
  assert.equal((await browser.allMissing({ sessionId: opened.sessionId })).coveredByOwner, true);
  browser.close();
});
test('selecting all missing repositories scans every page and never partially imports an overflowing list', async () => {
  let value = config(),
    calls = 0;
  const client = {
    repositoryContext: async owner => ({ owner }),
    repositoryPage: async (_context, { page }) => {
      calls++;
      return {
        repositories:
          page === 1
            ? [{ full_name: 'example/one' }, { full_name: 'example/fresh' }]
            : [{ full_name: 'example/future' }],
        hasMore: page === 1
      };
    }
  };
  const browser = new RepositoryBrowser({ getConfig: () => value, clientFor: () => client });
  const opened = await browser.open({ owner: 'example' });
  const selected = await browser.allMissing({ sessionId: opened.sessionId });
  assert.deepEqual(
    selected.selection.map(item => item.value),
    ['example/fresh', 'example/future']
  );
  assert.equal(calls, 2);
  value.sources.push(
    ...Array.from({ length: 96 }, (_, i) => ({ ...value.sources[0], id: `fill-${i}`, value: `example/fill-${i}` }))
  );
  const overflow = await browser.allMissing({ sessionId: opened.sessionId });
  assert.equal(overflow.overflow, true);
  assert.deepEqual(overflow.selection, []);
  browser.close();
});
