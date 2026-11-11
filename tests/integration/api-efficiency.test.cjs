const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { GitHubClient } = require('../../app/core/github.cjs');
const { metadataPlan } = require('../../app/core/metadata.cjs');

// Synthetic stand-in for real release histories: ten repositories with many releases and about fifty files each, the
// shape of desktop apps that publish packages for every platform. Sizes match what real backups transfer (MBs of JSON).
function releaseHistory(repository, releases = 24, files = 50) {
  return Array.from({ length: releases }, (_value, index) => {
    const tag = `v1.${releases - index}.0`;
    return {
      id: repository * 1000 + index,
      tag_name: tag,
      name: `Release ${tag}`,
      draft: false,
      prerelease: false,
      created_at: new Date(Date.UTC(2026, 0, releases - index)).toISOString(),
      body: `Changes in ${tag}. `.repeat(40),
      assets: Array.from({ length: files }, (_file, number) => {
        const name = `app-${tag}-${['macos', 'windows', 'linux'][number % 3]}-${['x64', 'arm64'][number % 2]}-${number}.${['dmg', 'zip', 'AppImage'][number % 3]}`;
        return {
          id: repository * 100000 + index * 100 + number,
          name,
          label: '',
          content_type: 'application/octet-stream',
          state: 'uploaded',
          size: 100000000 + number,
          digest: 'sha256:' + createHash('sha256').update(name).digest('hex'),
          download_count: number * 7,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          browser_download_url: `https://example.invalid/demo/app-${repository}/releases/download/${tag}/${name}`,
          url: `https://api.example.invalid/repos/demo/app-${repository}/releases/assets/${index}`,
          uploader: { login: 'release-bot', id: 1, type: 'Bot' }
        };
      })
    };
  });
}
function fixture(repositories = 10) {
  const bodies = new Map();
  for (let repository = 1; repository <= repositories; repository++) {
    const releases = releaseHistory(repository),
      base = `/repos/demo/app-${repository}`;
    bodies.set(`${base}/releases?per_page=100&page=1`, JSON.stringify(releases));
    bodies.set(`${base}/releases/latest`, JSON.stringify(releases[0]));
  }
  const counters = { requests: 0, notModified: 0, bytes: 0, paths: [] };
  const fetchImpl = async (url, { headers }) => {
    const { pathname, search } = new URL(url),
      key = pathname + search,
      text = bodies.get(key);
    counters.requests++;
    counters.paths.push(key);
    if (text === undefined) return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
    const etag = `"${createHash('sha1').update(text).digest('hex')}"`;
    if (headers['If-None-Match'] === etag) {
      counters.notModified++;
      return { ok: false, status: 304, headers: new Headers({ etag }) };
    }
    counters.bytes += text.length;
    return { ok: true, status: 200, headers: new Headers({ etag }), text: async () => text };
  };
  return { repositories, counters, fetchImpl, total: [...bodies.values()].reduce((sum, text) => sum + text.length, 0) };
}
async function run(client, repositories) {
  const plans = [];
  for (let repository = 1; repository <= repositories; repository++)
    plans.push(
      await metadataPlan({ full_name: `demo/app-${repository}` }, { releases: true }, client, null, {
        releaseScope: 'system',
        platform: 'darwin',
        arch: 'arm64',
        releaseFileTypes: ['dmg'],
        releaseProgram: { pattern: '' }
      })
    );
  return plans;
}

test('a run needs two API requests per repository with release backup and reads assets from the release', async () => {
  const f = fixture(),
    client = new GitHubClient({ fetchImpl: f.fetchImpl }),
    plans = await run(client, f.repositories);
  assert.equal(f.counters.requests, 2 * f.repositories);
  assert.equal(
    f.counters.paths.some(key => key.includes('/assets')),
    false
  );
  assert.ok(plans.every(plan => plan.releaseInfo.tag === 'v1.24.0'));
  assert.ok(f.total > 5 * 1048576, `fixture should resemble real release histories, got ${f.total} bytes`);
});

test('unchanged release lists of ten repositories are answered from the cache on the next run', async () => {
  const f = fixture(),
    client = new GitHubClient({ fetchImpl: f.fetchImpl });
  await run(client, f.repositories);
  const firstBytes = f.counters.bytes;
  Object.assign(f.counters, { requests: 0, notModified: 0, bytes: 0 });
  await run(client, f.repositories);
  assert.equal(f.counters.notModified, f.counters.requests);
  assert.equal(f.counters.bytes, 0);
  assert.equal(firstBytes, f.total);
  // The cache keeps compact text only, bounded by its limit; parsed objects would take several times as much memory.
  assert.ok([...client.cache.values()].every(entry => typeof entry.text === 'string' && !('data' in entry)));
  assert.ok(client.cacheStats.bytes <= client.cacheLimit);
  assert.equal(client.cacheStats.bytes, f.total);
});

test('cached answers are independent copies, so changing one result cannot alter the next run', async () => {
  const f = fixture(1),
    client = new GitHubClient({ fetchImpl: f.fetchImpl }),
    first = await client.request('/repos/demo/app-1/releases/latest');
  first.assets.length = 0;
  first.tag_name = 'changed';
  const second = await client.request('/repos/demo/app-1/releases/latest');
  assert.equal(f.counters.notModified, 1);
  assert.deepEqual([second.tag_name, second.assets.length], ['v1.24.0', 50]);
});
