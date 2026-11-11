const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { repository } = require('../helpers/repository.cjs');
const { ReleaseDownloads } = require('../../app/core/release-downloads.cjs');
const { readJson } = require('../../app/core/store.cjs');
const { decryptArchive } = require('../../app/core/archives.cjs');
const { GitHubClient } = require('../../app/core/github.cjs');
const { hashFile } = require('../../app/core/integrity.cjs');
const { writeJson } = require('../../app/core/store.cjs');
const { randomUUID, randomBytes } = require('node:crypto');
const { gzipSync } = require('node:zlib');

const checksum = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const PASSWORD = 'example cache password 123';
async function downloadFixture(t, { encrypted = false, validator = true, modified = false } = {}) {
  const f = await repository(t);
  f.bytes = Buffer.from('private-release-contents\n'.repeat(30000));
  f.headers = [];
  f.breakNext = true;
  const modifiedDate = new Date(Date.now() - 120000).toUTCString();
  f.server = http.createServer((request, response) => {
    f.headers.push(request.headers);
    if (f.handleRequest) return f.handleRequest(request, response);
    const offset = Number(request.headers.range?.match(/^bytes=(\d+)-$/)?.[1] || 0);
    response.writeHead(offset ? 206 : 200, {
      ...(validator ? { etag: '"fixture-v1"' } : {}),
      ...(modified ? { 'last-modified': modifiedDate } : {}),
      'content-type': 'application/octet-stream',
      'content-length': f.bytes.length - offset,
      ...(offset ? { 'content-range': `bytes ${offset}-${f.bytes.length - 1}/${f.bytes.length}` } : {})
    });
    if (f.breakNext) {
      f.breakNext = false;
      response.flushHeaders();
      response.write(f.bytes.subarray(offset, offset + 210000));
      setTimeout(() => response.destroy(), 35);
    } else response.end(f.bytes.subarray(offset));
  });
  await new Promise(resolve => f.server.listen(0, '127.0.0.1', resolve));
  f.url = `http://127.0.0.1:${f.server.address().port}/asset`;
  f.open = async (password = encrypted ? PASSWORD : '') => {
    await f.cache?.close();
    f.cache = await ReleaseDownloads.open({
      root: f.backup,
      volumeId: f.source.volumeId,
      scope: 'fixture-account:demo/project',
      passphrase: password,
      chunkBytes: 65536
    });
    return f.cache;
  };
  await f.open();
  f.download = (file = path.join(f.root, 'download.bin'), expectedDigest = checksum(f.bytes)) =>
    f.cache.download({
      identity: { id: 7, tag: 'v1' },
      file,
      expectedSize: f.bytes.length,
      expectedDigest,
      expectedName: 'program.zip',
      request: ({ offset, etag }) =>
        fetch(f.url, {
          headers: {
            ...(offset ? { Range: `bytes=${offset}-` } : {}),
            ...(offset && etag ? { 'If-Range': etag } : {})
          },
          signal: AbortSignal.timeout(10000)
        })
    });
  f.parts = async () => {
    const directories = (await fs.readdir(f.cache.directory)).filter(name => /^[a-f\d]{64}$/.test(name));
    const directory = path.join(f.cache.directory, directories[0]);
    return { directory, meta: await readJson(path.join(directory, 'parts.json')) };
  };
  t.after(async () => {
    await f.cache?.close();
    f.server.closeAllConnections();
    await new Promise(resolve => f.server.close(resolve));
  });
  return f;
}

test('bulk preview writes no destination files and stale previews cannot overwrite later edits', async t => {
  const f = await repository(t),
    runtime = await f.runtime(),
    missing = path.join(f.root, 'not-created');
  const preview = runtime.previewSources({ ids: [f.source.id], patch: { destination: missing } });
  assert.equal(preview.changed, 1);
  assert.equal(
    await fs.stat(missing).then(
      () => true,
      () => false
    ),
    false
  );
  await runtime.organizeSources({ ids: [f.source.id], favorite: true });
  await assert.rejects(runtime.applySources({ token: preview.token }), /inzwischen geändert/);
  assert.equal(runtime.config.sources[0].destination, f.backup);
  assert.equal(runtime.config.sources[0].favorite, true);
});
test('bulk apply is atomic on validation failure and preserves successful backups when changing settings', async t => {
  const f = await repository(t),
    record = await f.sync(),
    runtime = await f.runtime({ state: { repositories: { [record.id]: record } } });
  const before = await fs.readFile(path.join(f.directory, 'settings.json'));
  const invalid = runtime.previewSources({ ids: [f.source.id], patch: { destination: path.join(f.root, 'missing') } });
  await assert.rejects(runtime.applySources({ token: invalid.token }), /erreichbar/);
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'settings.json')), before);
  const preview = runtime.previewSources({
    ids: [f.source.id],
    patch: { backup: { lfs: true }, filters: { includeForks: false } }
  });
  await runtime.applySources({ token: preview.token });
  assert.equal(runtime.config.sources[0].backup.lfs, true);
  assert.equal(runtime.config.sources[0].filters.includeForks, false);
  assert.equal(await f.git.head(record.destination), record.commit);
  await assert.rejects(runtime.applySources({ token: preview.token }), /inzwischen geändert/);
});
test('favorites and groups remain usable with an offline drive and while a backup is busy', async t => {
  const f = await repository(t),
    runtime = await f.runtime(),
    offline = path.join(f.root, 'offline');
  await fs.rename(f.mount, offline);
  runtime.backup.busy = true;
  try {
    await runtime.organizeSources({
      group: { id: 'projects', name: 'Projekte' },
      ids: [f.source.id],
      groupId: 'projects',
      favorite: true
    });
  } finally {
    runtime.backup.busy = false;
  }
  const persisted = await readJson(path.join(f.directory, 'settings.json'));
  assert.equal(persisted.sources[0].favorite, true);
  assert.equal(persisted.sources[0].groupId, 'projects');
  assert.equal(persisted.sources[0].destination, f.backup);
  await fs.rename(offline, f.mount);
});

for (const encrypted of [false, true])
  test(`interrupted ${encrypted ? 'encrypted' : 'plain'} release downloads survive a new cache instance and resume real HTTP ranges`, async t => {
    const f = await downloadFixture(t, { encrypted });
    await assert.rejects(f.download());
    const saved = await f.parts(),
      offset = saved.meta.chunks.reduce((sum, item) => sum + item.bytes, 0);
    assert(offset > 0 && offset < f.bytes.length);
    assert.equal(saved.meta.encrypted, encrypted);
    assert.equal(
      await fs.stat(path.join(f.root, 'download.bin')).then(
        () => true,
        () => false
      ),
      false
    );
    if (encrypted)
      for (const chunk of saved.meta.chunks)
        assert(
          !(await fs.readFile(path.join(saved.directory, `${chunk.id}.chunk`))).includes(
            Buffer.from('private-release-contents')
          )
        );
    await f.open();
    const result = await f.download();
    assert.equal(result.resumedBytes, offset);
    assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
    assert.equal(f.headers.at(-1).range, `bytes=${offset}-`);
    assert.equal(f.headers.at(-1)['if-range'], '"fixture-v1"');
    await f.cache.clear();
    assert.equal((await fs.readdir(f.cache.directory)).filter(name => /^[a-f\d]{64}$/.test(name)).length, 0);
  });
test('a server ignoring Range safely restarts the file instead of appending a second copy', async t => {
  const f = await downloadFixture(t);
  await assert.rejects(f.download());
  await f.open();
  f.handleRequest = (_request, response) => {
    response.writeHead(200, { etag: '"fixture-v2"', 'content-length': f.bytes.length });
    response.end(f.bytes);
  };
  const result = await f.download();
  assert.equal(result.resumedBytes, 0);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('a changed ETag in a partial response triggers a clean full request', async t => {
  const f = await downloadFixture(t);
  await assert.rejects(f.download());
  await f.open();
  f.handleRequest = (request, response) => {
    const offset = Number(request.headers.range?.match(/\d+/)?.[0] || 0);
    response.writeHead(offset ? 206 : 200, {
      etag: '"new-entity"',
      'content-length': f.bytes.length - offset,
      ...(offset ? { 'content-range': `bytes ${offset}-${f.bytes.length - 1}/${f.bytes.length}` } : {})
    });
    response.end(f.bytes.subarray(offset));
  };
  const result = await f.download();
  assert.equal(result.resumedBytes, 0);
  assert(f.headers[1].range);
  assert.equal(f.headers[2].range, undefined);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('compressed full responses can be saved but their interrupted representation is never resumed by decoded offsets', async t => {
  const f = await downloadFixture(t);
  f.bytes = randomBytes(400000);
  const compressed = gzipSync(f.bytes);
  let first = true;
  f.handleRequest = (_request, response) => {
    response.writeHead(200, { etag: '"gzip-v1"', 'content-encoding': 'gzip', 'content-length': compressed.length });
    if (first) {
      first = false;
      response.flushHeaders();
      response.write(compressed.subarray(0, 180000));
      setTimeout(() => response.destroy(), 35);
    } else response.end(compressed);
  };
  await assert.rejects(f.download());
  await f.open();
  const result = await f.download();
  assert.equal(result.resumedBytes, 0);
  assert.equal(f.headers.at(-1).range, undefined);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('an encoded partial response falls back to a verified full download', async t => {
  const f = await downloadFixture(t);
  await assert.rejects(f.download());
  await f.open();
  f.handleRequest = (request, response) => {
    const offset = Number(request.headers.range?.match(/\d+/)?.[0] || 0),
      compressed = gzipSync(f.bytes.subarray(offset));
    response.writeHead(offset ? 206 : 200, {
      etag: '"fixture-v1"',
      'content-encoding': 'gzip',
      'content-length': compressed.length,
      ...(offset ? { 'content-range': `bytes ${offset}-${f.bytes.length - 1}/${f.bytes.length}` } : {})
    });
    response.end(compressed);
  };
  const result = await f.download();
  assert.equal(result.resumedBytes, 0);
  assert.equal(f.headers.at(-1).range, undefined);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('without a digest or strong validator an interrupted download is restarted safely', async t => {
  const f = await downloadFixture(t, { validator: false });
  await assert.rejects(f.download(undefined, undefined));
  // Explicit null disables the optional upstream checksum.
  await f.open();
  await f.download(path.join(f.root, 'safe.bin'), null);
  assert.equal(f.headers.at(-1).range, undefined);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'safe.bin')), f.bytes);
});
test('an old canonical Last-Modified date permits safe HTTP If-Range continuation without a checksum', async t => {
  const f = await downloadFixture(t, { validator: false, modified: true });
  await assert.rejects(f.download(path.join(f.root, 'download.bin'), null));
  const offset = (await f.parts()).meta.chunks.reduce((sum, part) => sum + part.bytes, 0);
  await f.open();
  const result = await f.download(path.join(f.root, 'download.bin'), null);
  assert.equal(result.resumedBytes, offset);
  assert(f.headers.at(-1)['if-range'].endsWith(' GMT'));
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('a complete cached asset is verified and reused without another network request', async t => {
  const f = await downloadFixture(t);
  f.breakNext = false;
  await f.download();
  await fs.rm(path.join(f.root, 'download.bin'));
  await f.open();
  const calls = f.headers.length;
  const result = await f.download();
  assert.equal(f.headers.length, calls);
  assert.equal(result.resumedBytes, f.bytes.length);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('a complete cache without an upstream checksum revalidates its strong server identity', async t => {
  const f = await downloadFixture(t);
  f.breakNext = false;
  await f.download(path.join(f.root, 'download.bin'), null);
  await fs.rm(path.join(f.root, 'download.bin'));
  await f.open();
  f.handleRequest = (_request, response) => {
    response.writeHead(416, { etag: '"fixture-v1"', 'content-range': `bytes */${f.bytes.length}` });
    response.end();
  };
  const calls = f.headers.length,
    result = await f.download(path.join(f.root, 'download.bin'), null);
  assert.equal(f.headers.length, calls + 1);
  assert.equal(result.resumedBytes, f.bytes.length);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('changed completed assets without upstream checksums are downloaded fresh instead of reusing stale content', async t => {
  const f = await downloadFixture(t);
  f.breakNext = false;
  await f.download(path.join(f.root, 'download.bin'), null);
  await fs.rm(path.join(f.root, 'download.bin'));
  await f.open();
  f.bytes = Buffer.alloc(f.bytes.length, 90);
  f.handleRequest = (request, response) => {
    if (request.headers.range) {
      response.writeHead(416, { etag: '"fixture-v2"', 'content-range': `bytes */${f.bytes.length}` });
      response.end();
    } else {
      response.writeHead(200, { etag: '"fixture-v2"', 'content-length': f.bytes.length });
      response.end(f.bytes);
    }
  };
  const result = await f.download(path.join(f.root, 'download.bin'), null);
  assert.equal(result.resumedBytes, 0);
  assert.equal(f.headers.at(-1).range, undefined);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('a damaged cached chunk is discarded and a foreign target is never overwritten', async t => {
  const f = await downloadFixture(t);
  f.breakNext = false;
  await f.download();
  const parts = await f.parts(),
    chunk = path.join(parts.directory, `${parts.meta.chunks[0].id}.chunk`),
    bytes = await fs.readFile(chunk);
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(chunk, bytes);
  await fs.rm(path.join(f.root, 'download.bin'));
  await assert.rejects(f.download(), /beschädigt/);
  assert.equal(
    await fs.stat(path.join(f.root, 'download.bin')).then(
      () => true,
      () => false
    ),
    false
  );
  await f.download();
  await fs.writeFile(path.join(f.root, 'personal.bin'), 'personal data');
  await assert.rejects(f.download(path.join(f.root, 'personal.bin')), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(f.root, 'personal.bin'), 'utf8'), 'personal data');
});
test('wrong cache passwords preserve existing encrypted chunks', async t => {
  const f = await downloadFixture(t, { encrypted: true });
  f.breakNext = false;
  await f.download();
  const parts = await f.parts(),
    original = await fs.readFile(path.join(parts.directory, `${parts.meta.chunks[0].id}.chunk`));
  await fs.rm(path.join(f.root, 'download.bin'));
  await f.open('a different password 456');
  await assert.rejects(f.download(), /Archivpasswort/);
  assert.deepEqual(await fs.readFile(path.join(parts.directory, `${parts.meta.chunks[0].id}.chunk`)), original);
});
test('a crash between writing an encrypted chunk and committing its journal resumes authenticated data', async t => {
  const f = await downloadFixture(t, { encrypted: true });
  await assert.rejects(f.download());
  const parts = await f.parts();
  parts.meta.chunks.at(-1).pending = true;
  await writeJson(path.join(parts.directory, 'parts.json'), parts.meta);
  const offset = parts.meta.chunks.reduce((sum, part) => sum + part.bytes, 0);
  await f.open();
  const result = await f.download();
  assert.equal(result.resumedBytes, offset);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('a journal entry whose chunk was never created is rolled back without losing earlier chunks', async t => {
  const f = await downloadFixture(t);
  await assert.rejects(f.download());
  const parts = await f.parts(),
    offset = parts.meta.chunks.reduce((sum, part) => sum + part.bytes, 0);
  parts.meta.chunks.push({ id: randomUUID(), bytes: 123, sha256: 'a'.repeat(64), pending: true });
  await writeJson(path.join(parts.directory, 'parts.json'), parts.meta);
  await f.open();
  const result = await f.download();
  assert.equal(result.resumedBytes, offset);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('ENOSPC preserves finished chunks and resumes them after storage becomes available', async t => {
  const f = await downloadFixture(t);
  f.breakNext = false;
  const append = f.cache.append.bind(f.cache);
  let count = 0;
  f.cache.append = async (...args) => {
    if (++count > 1) {
      const error = new Error('disk full');
      error.code = 'ENOSPC';
      throw error;
    }
    return append(...args);
  };
  await assert.rejects(f.download(), { code: 'ENOSPC' });
  const offset = (await f.parts()).meta.chunks.reduce((sum, part) => sum + part.bytes, 0);
  assert(offset > 0);
  await f.open();
  const result = await f.download();
  assert.equal(result.resumedBytes, offset);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'download.bin')), f.bytes);
});
test('foreign cache directories and foreign files remain untouched', async t => {
  const f = await downloadFixture(t);
  f.breakNext = false;
  await f.download();
  const parts = await f.parts(),
    foreign = path.join(parts.directory, 'personal.txt');
  await fs.writeFile(foreign, 'personal data');
  await assert.rejects(f.cache.clear(), /Fremde Dateien/);
  assert.equal(await fs.readFile(foreign, 'utf8'), 'personal data');
  const chunk = path.join(parts.directory, `${parts.meta.chunks[0].id}.chunk`);
  await fs.writeFile(chunk, 'a foreign replacement');
  await fs.rm(path.join(f.root, 'download.bin'));
  await assert.rejects(f.download(), /fremde Datei/);
  assert.equal(await fs.readFile(chunk, 'utf8'), 'a foreign replacement');
});
test('an actual encrypted repository backup resumes a release after restart and retains its old successful archive on failure', async t => {
  const f = await downloadFixture(t, { encrypted: true });
  f.options.encryption = true;
  const initial = await f.sync({ passphrase: PASSWORD }),
    old = await hashFile(path.join(initial.destination, 'backup.gcb'));
  f.options.metadata.releases = true;
  f.releases = [
    { id: 4, tag_name: 'v1', assets: [{ id: 7, name: 'program.zip', size: f.bytes.length, digest: checksum(f.bytes) }] }
  ];
  const requests = [],
    client = new GitHubClient({
      retryOptions: { retries: 0 },
      fetchImpl: async (_url, options) => {
        requests.push(options.headers);
        return fetch(f.url, options);
      }
    });
  f.github.downloadAsset = (...args) => client.downloadAsset(...args);
  await assert.rejects(f.sync({ passphrase: PASSWORD }));
  assert.equal(await hashFile(path.join(initial.destination, 'backup.gcb')), old);
  await f.cache.close();
  const result = await f.sync({ passphrase: PASSWORD });
  assert.equal(result.status, 'updated');
  assert(requests.at(-1).Range?.startsWith('bytes='));
  const restored = path.join(f.root, 'restored');
  await decryptArchive(path.join(result.destination, 'backup.gcb'), restored, PASSWORD);
  assert.deepEqual(await fs.readFile(path.join(restored, result.releaseInfo.assetDirectory, 'program.zip')), f.bytes);
});

test('visible release files retain original names, are restored separately and expose their folder safely', async t => {
  const f = await repository(t);
  f.releases = [{ tag_name: 'v1', assets: [f.asset(11, 'program-macos-universal.dmg', 'macOS disk image')] }];
  f.options.metadata.releases = true;
  const record = await f.sync();
  assert.equal(record.releaseInfo.assetDirectory, 'Git-Cloner-Releases');
  assert.equal(
    await fs.readFile(path.join(record.destination, 'Git-Cloner-Releases', 'program-macos-universal.dmg'), 'utf8'),
    'macOS disk image'
  );
  const runtime = await f.runtime({ state: { repositories: { [record.id]: record } } });
  assert.equal(await runtime.releaseDestination(record.id), path.join(record.destination, 'Git-Cloner-Releases'));
  const opened = await runtime.browser.open({ record, content: 'releases' });
  assert.deepEqual(
    runtime.browser.list({ sessionId: opened.id }).entries.map(item => item.path),
    ['program-macos-universal.dmg']
  );
  await runtime.browser.closeAll();
  await fs.rm(path.join(record.destination, 'Git-Cloner-Releases'), { recursive: true });
  await fs.symlink(
    f.root,
    path.join(record.destination, 'Git-Cloner-Releases'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  await assert.rejects(runtime.releaseDestination(record.id), /Link|Ordner/);
});
test('release refresh retains one current folder and an immutable result per destination', async t => {
  const f = await repository(t);
  f.releases = [{ tag_name: 'v1', assets: [f.asset(11, 'program.zip', 'version one')] }];
  f.options.metadata.releases = true;
  const first = await f.sync();
  f.releases = [{ tag_name: 'v2', assets: [f.asset(12, 'program-v2.zip', 'version two')] }];
  const second = await f.sync();
  assert.equal(second.status, 'updated');
  assert.equal(first.releaseInfo.tag, 'v1');
  assert.equal(second.releaseInfo.assetDirectory, first.releaseInfo.assetDirectory);
  assert.deepEqual(
    (await fs.readdir(path.join(second.destination, second.releaseInfo.assetDirectory))).filter(
      name => !name.startsWith('.')
    ),
    ['program-v2.zip']
  );
  assert.equal((await fs.readdir(second.destination)).filter(name => name.startsWith('Git-Cloner-Releases')).length, 1);
});
test('repository-owned release folder and unsafe asset names never overwrite tracked content', async t => {
  const f = await repository(t);
  await fs.mkdir(path.join(f.remote, 'Git-Cloner-Releases'));
  await fs.writeFile(path.join(f.remote, 'Git-Cloner-Releases', 'program.zip'), 'tracked contents');
  await f.command('add', '.');
  await f.command('commit', '-m', 'tracked release directory');
  f.releases = [
    {
      tag_name: 'v1',
      assets: [
        f.asset(1, 'program.zip', 'download one'),
        f.asset(2, 'PROGRAM.zip', 'case collision'),
        f.asset(3, '../../escape.zip', 'safe path'),
        f.asset(4, 'CON', 'reserved name')
      ]
    }
  ];
  f.options.metadata.releases = true;
  const first = await f.sync();
  assert.equal(first.releaseInfo.assetDirectory, 'Git-Cloner-Releases-2');
  assert.equal(
    await fs.readFile(path.join(first.destination, 'Git-Cloner-Releases', 'program.zip'), 'utf8'),
    'tracked contents'
  );
  const names = await fs.readdir(path.join(first.destination, first.releaseInfo.assetDirectory));
  assert(names.includes('program.zip'));
  assert(names.includes('2-PROGRAM.zip'));
  assert(names.includes('4-CON'));
  assert(names.every(name => !name.includes('/') && !name.includes('\\')));
  f.releases[0].tag_name = 'v2';
  const second = await f.sync();
  assert.equal(second.releaseInfo.assetDirectory, 'Git-Cloner-Releases-2');
  assert.equal(
    await fs.readFile(path.join(second.destination, 'Git-Cloner-Releases', 'program.zip'), 'utf8'),
    'tracked contents'
  );
});
test('legacy hidden release files migrate on the next check and remain restorable beforehand', async t => {
  const f = await repository(t);
  f.releases = [{ tag_name: 'v1', assets: [f.asset(7, 'program.zip', 'legacy asset')] }];
  f.options.metadata.releases = true;
  const record = await f.sync(),
    { managed } = require('../../app/core/backup.cjs'),
    { writeManifest } = require('../../app/core/integrity.cjs'),
    { RestoreBrowser } = require('../../app/core/selective-restore.cjs');
  const control = path.join(record.destination, '.git'),
    hidden = path.join(control, 'git-cloner-metadata', 'release-assets'),
    visible = path.join(record.destination, record.releaseInfo.assetDirectory);
  await fs.mkdir(hidden);
  await fs.rename(path.join(visible, 'program.zip'), path.join(hidden, '7-program.zip'));
  await fs.rm(visible, { recursive: true });
  const marker = await managed(record.destination, record.fullName);
  delete marker.releaseInfo.assetDirectory;
  marker.metadataDigest = 'legacy-layout';
  Object.assign(marker, await writeManifest(record.destination, marker.mode));
  await writeJson(path.join(control, 'git-cloner.json'), marker);
  const browser = new RestoreBrowser({ git: f.git });
  t.after(() => browser.closeAll());
  const opened = await browser.open({ record, content: 'releases' });
  assert.deepEqual(
    browser.list({ sessionId: opened.id }).entries.map(item => item.path),
    ['7-program.zip']
  );
  await browser.closeAll();
  const migrated = await f.sync();
  assert.equal(migrated.status, 'updated');
  assert.equal(
    await fs.readFile(path.join(migrated.destination, migrated.releaseInfo.assetDirectory, 'program.zip'), 'utf8'),
    'legacy asset'
  );
  await assert.rejects(fs.stat(hidden), { code: 'ENOENT' });
});
test('owner sources discover new repositories once and respect disabled individual exceptions', async t => {
  const f = await repository(t),
    { resolveJobs } = require('../../app/core/backup.cjs');
  const owner = { ...f.source, id: 'owner', value: 'demo', kind: 'owner' },
    individual = { ...f.source, id: 'exception', enabled: false };
  let resolved = await resolveJobs([owner, individual], f.github);
  assert.equal(resolved.jobs.length, 0);
  assert.equal(resolved.excluded[0].reason, 'override');
  f.names.push('demo/new');
  resolved = await resolveJobs([owner, individual], f.github);
  assert.deepEqual(
    resolved.jobs.map(job => job.repository.full_name),
    ['demo/new']
  );
});
