const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { repository } = require('../helpers/repository.cjs');
const { ReleaseDownloads } = require('../../app/core/release-downloads.cjs');
const storage = require('../../app/core/download-storage.cjs');
const { ProgramInstaller } = require('../../app/core/program-installation.cjs');
const { writeJson, readJson } = require('../../app/core/store.cjs');
function program(arch = 'x64', content = 1) {
  const bytes = Buffer.alloc(128, content);
  bytes.set([127, 69, 76, 70], 0);
  bytes.write('AI', 8);
  bytes[10] = 2;
  bytes.writeUInt16LE({ x64: 62, arm64: 183, ia32: 3 }[arch], 18);
  return bytes;
}
async function partial(t, encrypted = false) {
  const f = await repository(t),
    cache = await ReleaseDownloads.open({
      root: f.backup,
      volumeId: f.source.volumeId,
      scope: 'fixture-parts',
      chunkBytes: 64,
      passphrase: encrypted ? 'a long fixture password' : ''
    });
  await assert.rejects(
    cache.download({
      identity: { id: 1, tag: 'v1', name: 'program-linux-x64.AppImage' },
      expectedName: 'program-linux-x64.AppImage',
      expectedSize: 320,
      file: path.join(f.root, 'unused'),
      request: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.alloc(192, 1));
              setTimeout(() => controller.error(new Error('broken transfer')), 100);
            }
          }),
          { headers: { etag: '"fixture"' } }
        )
    })
  );
  await cache.close();
  return f;
}
test('metadata-only and Git changes reuse verified assets without any network asset download', async t => {
  const f = await repository(t),
    asset = f.asset(1, 'program-linux-x64.zip', 'release bytes');
  f.releases = [{ tag_name: 'v1', assets: [asset] }];
  f.options.metadata.releases = true;
  const first = await f.sync();
  f.downloads = [];
  f.releases[0].assets[0].download_count = 1;
  assert.equal((await f.sync()).status, 'unchanged');
  assert.deepEqual(f.downloads, []);
  f.releases[0].body = 'updated release notes';
  const second = await f.sync();
  assert.equal(second.status, 'updated');
  assert.deepEqual(f.downloads, []);
  assert.equal(
    await fs.readFile(path.join(second.destination, second.releaseInfo.assetDirectory, asset.name), 'utf8'),
    'release bytes'
  );
  await fs.writeFile(path.join(f.remote, 'new.txt'), 'new git data');
  await f.command('add', '.');
  await f.command('commit', '-m', 'new data');
  await f.sync();
  assert.deepEqual(f.downloads, []);
  assert.equal(first.releaseInfo.tag, 'v1');
});
test('corrupt local release bytes are fetched again and cannot become a successful reused backup', async t => {
  const f = await repository(t);
  f.releases = [{ tag_name: 'v1', assets: [f.asset(1, 'package.zip', 'correct bytes')] }];
  f.options.metadata.releases = true;
  const first = await f.sync();
  await fs.writeFile(path.join(first.destination, first.releaseInfo.assetDirectory, 'package.zip'), 'wrong content');
  f.releases[0].body = 'updated';
  f.downloads = [];
  const second = await f.sync();
  assert.deepEqual(f.downloads, [1]);
  assert.equal(
    await fs.readFile(path.join(second.destination, second.releaseInfo.assetDirectory, 'package.zip'), 'utf8'),
    'correct bytes'
  );
});
test('assets without upstream digests reuse unchanged identity and refresh on identity changes', async t => {
  const f = await repository(t),
    asset = f.asset(1, 'package.zip', 'old');
  delete asset.digest;
  asset.updated_at = '2026-01-01';
  f.releases = [{ tag_name: 'v1', assets: [asset] }];
  f.options.metadata.releases = true;
  await f.sync();
  f.downloads = [];
  f.releases[0].body = 'notes';
  await f.sync();
  assert.deepEqual(f.downloads, []);
  asset.updated_at = '2026-02-01';
  f.assets.set(1, Buffer.from('new'));
  const result = await f.sync();
  assert.deepEqual(f.downloads, [1]);
  assert.equal(
    await fs.readFile(path.join(result.destination, result.releaseInfo.assetDirectory, 'package.zip'), 'utf8'),
    'new'
  );
});
test('encrypted backup assets are reused with authenticated extraction and no network redownload', async t => {
  const f = await repository(t);
  f.options.metadata.releases = true;
  f.options.encryption = true;
  f.releases = [{ tag_name: 'v1', assets: [f.asset(1, 'package.zip', 'encrypted release')] }];
  const password = 'a long release password';
  await f.sync({ passphrase: password });
  f.downloads = [];
  f.releases[0].body = 'notes';
  const result = await f.sync({ passphrase: password });
  assert.deepEqual(f.downloads, []);
  assert.equal((await fs.readdir(result.destination)).includes(result.releaseInfo.assetDirectory), false);
});
test('download inventory reads real plain and encrypted parts without deleting them', async t => {
  for (const encrypted of [false, true]) {
    const f = await partial(t, encrypted),
      before = await fs.readdir(f.backup),
      result = await storage.inventory([{ destination: f.backup, volumeId: f.source.volumeId }]);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].encrypted, encrypted);
    assert(result.entries[0].bytes > 192);
    assert.equal(result.entries[0].chunks, 3);
    assert.deepEqual(await fs.readdir(f.backup), before);
    if (encrypted) assert.equal(result.entries[0].name, null);
  }
});
test('cache cleanup rejects changed previews, busy leases, foreign files and replaced drive identities', async t => {
  const f = await partial(t),
    roots = [{ destination: f.backup, volumeId: f.source.volumeId }],
    first = (await storage.inventory(roots)).entries;
  const marker = path.join(first[0].directory, 'parts.json'),
    meta = await readJson(marker);
  meta.complete = true;
  await writeJson(marker, meta);
  await assert.rejects(storage.clean(first), /inzwischen/);
  const current = (await storage.inventory(roots)).entries;
  const { acquireLease } = require('../../app/core/lease.cjs');
  const release = await acquireLease(current[0].scopeDirectory);
  await assert.rejects(storage.clean(current), /läuft/);
  await release();
  await fs.writeFile(path.join(current[0].directory, 'foreign.txt'), 'keep');
  assert.equal((await storage.inventory(roots)).entries.length, 0);
  await assert.rejects(storage.clean(current), /Fremde/);
  assert.equal(await fs.readFile(path.join(current[0].directory, 'foreign.txt'), 'utf8'), 'keep');
  await fs.rm(path.join(current[0].directory, 'foreign.txt'));
  const volume = await readJson(path.join(f.backup, '.git-cloner-volume.json'));
  await writeJson(path.join(f.backup, '.git-cloner-volume.json'), {
    ...volume,
    id: '00000000-0000-0000-0000-000000000000'
  });
  await assert.rejects(storage.clean(current), /Kennung/);
  assert(await fs.stat(marker));
});
test('previewed cleanup removes only selected own chunks and retains successful repository backups', async t => {
  const f = await partial(t),
    record = await f.sync(),
    runtime = await f.runtime(),
    result = await runtime.downloadInventory();
  assert.equal(result.entries.length, 1);
  const preview = runtime.previewDownloadCleanup({ ids: [result.entries[0].id] });
  assert(preview.bytes > 0);
  assert.equal((await runtime.cleanDownloads({ token: preview.token })).removed, 1);
  assert.equal((await runtime.downloadInventory()).entries.length, 0);
  assert.equal(await f.git.head(record.destination), record.commit);
});
test('program installation copies a verified AppImage and atomically replaces its previous version', async t => {
  const f = await repository(t),
    destination = path.join(f.root, 'programs');
  await fs.mkdir(destination);
  f.source.installation = { enabled: true, destination, pattern: '*.AppImage' };
  f.options.metadata.releases = true;
  const add = (id, version, content) => {
    const bytes = program('x64', content),
      asset = {
        id,
        name: `program-linux-x64-${version}.AppImage`,
        size: bytes.length,
        digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex')
      };
    f.assets.set(id, bytes);
    f.releases = [{ tag_name: version, assets: [asset] }];
  };
  add(1, 'v1', 1);
  const installer = new ProgramInstaller({ platform: 'linux', arch: 'x64' }),
    record = await f.sync(),
    first = await installer.install({ source: f.source, record, git: f.git });
  assert.equal(first.status, 'installed');
  assert.deepEqual(await fs.readFile(first.executable), program('x64', 1));
  assert.equal((await installer.install({ source: f.source, record, git: f.git })).status, 'current');
  add(2, 'v2', 2);
  const next = await f.sync(),
    second = await installer.install({ source: f.source, record: next, git: f.git });
  assert.equal(second.status, 'installed');
  assert.equal(first.destination, second.destination);
  assert.deepEqual(await fs.readFile(second.executable), program('x64', 2));
  assert.deepEqual(
    (await fs.readdir(path.dirname(second.destination))).filter(name => name.includes('gc-install')),
    []
  );
});
test('failed program installation preserves the old app and foreign staging directories', async t => {
  const f = await repository(t),
    destination = path.join(f.root, 'programs');
  await fs.mkdir(destination);
  f.source.installation = { enabled: true, destination, pattern: '*.AppImage' };
  f.options.metadata.releases = true;
  const bytes = program();
  f.assets.set(1, bytes);
  f.releases = [{ tag_name: 'v1', assets: [{ id: 1, name: 'program-linux-x64.AppImage', size: bytes.length }] }];
  const record = await f.sync(),
    installer = new ProgramInstaller({ platform: 'linux', arch: 'x64' }),
    first = await installer.install({ source: f.source, record, git: f.git });
  const stage = path.join(path.dirname(first.destination), '.project.gc-install-stage');
  await fs.mkdir(stage);
  await fs.writeFile(path.join(stage, 'personal.txt'), 'keep');
  await assert.rejects(installer.install({ source: f.source, record, git: f.git }), /fremder/);
  assert.equal(await fs.readFile(path.join(stage, 'personal.txt'), 'utf8'), 'keep');
  assert.deepEqual(await fs.readFile(first.executable), bytes);
  await fs.rm(stage, { recursive: true });
  f.releases = [{ tag_name: 'v2', assets: [f.asset(2, 'program-linux-x64.AppImage', 'not a program')] }];
  const next = await f.sync();
  await assert.rejects(installer.install({ source: f.source, record: next, git: f.git }), /Programmformat/);
  assert.deepEqual(await fs.readFile(first.executable), bytes);
});
test('installer rejects changed downloaded assets and repairs a modified installed executable', async t => {
  const f = await repository(t),
    destination = path.join(f.root, 'programs');
  await fs.mkdir(destination);
  f.source.installation = { enabled: true, destination, pattern: '*.AppImage' };
  f.options.metadata.releases = true;
  const bytes = program();
  f.assets.set(1, bytes);
  f.releases = [{ tag_name: 'v1', assets: [{ id: 1, name: 'program-linux-x64.AppImage', size: bytes.length }] }];
  const record = await f.sync(),
    installer = new ProgramInstaller({ platform: 'linux', arch: 'x64' }),
    installed = await installer.install({ source: f.source, record, git: f.git });
  await fs.writeFile(installed.executable, 'damaged');
  assert.equal((await installer.install({ source: f.source, record, git: f.git })).status, 'installed');
  assert.deepEqual(await fs.readFile(installed.executable), bytes);
  await fs.writeFile(
    path.join(record.destination, record.releaseInfo.assetDirectory, 'program-linux-x64.AppImage'),
    'damaged'
  );
  await assert.rejects(installer.install({ source: f.source, record, git: f.git }), /Integritätsprüfung/);
});
test('Windows portable executable copying verifies PE headers and CPU without executing installers', async t => {
  const f = await repository(t),
    output = path.join(f.root, 'portable');
  await fs.mkdir(output);
  const bytes = Buffer.alloc(160);
  bytes.write('MZ');
  bytes.writeUInt32LE(80, 60);
  bytes.set([80, 69, 0, 0], 80);
  bytes.writeUInt16LE(0x8664, 84);
  const file = path.join(f.root, 'portable.exe');
  await fs.writeFile(file, bytes);
  const installer = new ProgramInstaller({ platform: 'win32', arch: 'x64' });
  await installer.prepare({ name: 'program-windows-x64-portable.exe', file }, output);
  assert.deepEqual(await fs.readFile(path.join(output, 'application.exe')), bytes);
  await assert.rejects(
    new ProgramInstaller({ platform: 'win32', arch: 'arm64' }).prepare(
      { name: 'program-windows-arm64-portable.exe', file },
      output
    ),
    /Prozessorarchitektur/
  );
});

test('ZIP extraction checks paths, links, duplicate names, expansion limits and actual CRC values', async t => {
  const f = await repository(t),
    { writeZip } = require('../helpers/program-zip.cjs'),
    { extractZip } = require('../../app/core/program-archives.cjs');
  const examples = [
    [{ name: '../escape', data: 'bad' }],
    [
      { name: 'App/file', data: 'one' },
      { name: 'app/FILE', data: 'two' }
    ],
    [{ name: 'App/link', data: '../../escape', mode: 0o120777 }],
    [{ name: 'App/file', data: 'broken', crc: 0 }]
  ];
  for (let i = 0; i < examples.length; i++) {
    const file = path.join(f.root, `bad-${i}.zip`);
    await writeZip(file, examples[i]);
    await assert.rejects(extractZip(file, path.join(f.root, `out-${i}`)));
  }
  const valid = path.join(f.root, 'valid.zip');
  await writeZip(valid, [{ name: 'App/data.txt', data: 'contents' }]);
  await extractZip(valid, path.join(f.root, 'valid'));
  assert.equal(await fs.readFile(path.join(f.root, 'valid', 'App', 'data.txt'), 'utf8'), 'contents');
  await assert.rejects(extractZip(valid, path.join(f.root, 'limited'), { maxBytes: 1 }), /groß/);
  await assert.rejects(fs.stat(path.join(f.root, 'escape')), { code: 'ENOENT' });
});
test('Windows ZIP installation verifies the embedded executable and retains its companion files', async t => {
  const f = await repository(t),
    { writeZip } = require('../helpers/program-zip.cjs'),
    zip = path.join(f.root, 'portable.zip'),
    output = path.join(f.root, 'windows-output');
  await fs.mkdir(output);
  const bytes = Buffer.alloc(160);
  bytes.write('MZ');
  bytes.writeUInt32LE(80, 60);
  bytes.set([80, 69, 0, 0], 80);
  bytes.writeUInt16LE(0x8664, 84);
  await writeZip(zip, [
    { name: 'Example/Example.exe', data: bytes },
    { name: 'Example/library.dll', data: 'companion' }
  ]);
  const installer = new ProgramInstaller({ platform: 'win32', arch: 'x64' });
  const executable = await installer.prepare({ name: 'example-windows-x64.zip', file: zip }, output);
  assert.equal(executable, path.join('program', 'Example.exe'));
  assert.equal(await fs.readFile(path.join(output, 'program', 'library.dll'), 'utf8'), 'companion');
});
test(
  'runtime automatically installs an explicitly enabled repository after a successful backup',
  { skip: process.platform !== 'linux' },
  async t => {
    const f = await repository(t),
      destination = path.join(f.root, 'programs');
    await fs.mkdir(destination);
    f.source.installation = { enabled: true, destination, pattern: '*.AppImage' };
    const bytes = program(process.arch),
      asset = {
        id: 1,
        name: `example-linux-${process.arch}.AppImage`,
        size: bytes.length,
        digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex')
      };
    f.assets.set(1, bytes);
    f.releases = [{ tag_name: 'v1', assets: [asset] }];
    f.source.backup = { ...f.options, metadata: { ...f.options.metadata, releases: true } };
    const config = f.config();
    config.backup.metadata.releases = true;
    const runtime = await f.runtime({
      config,
      fetchImpl: async url => {
        const endpoint = new URL(url).pathname;
        if (endpoint.endsWith('/releases/assets/1')) return new Response(bytes);
        if (endpoint.endsWith('/releases/latest')) return Response.json(f.releases[0]);
        if (endpoint.endsWith('/releases')) return Response.json(f.releases);
        if (endpoint === '/repos/demo/project') return Response.json(f.repository);
        throw new Error('Unexpected request ' + endpoint);
      }
    });
    assert.equal((await runtime.run()).errorCount, 0);
    const installed = Object.values(runtime.backup.state.repositories)[0].installation;
    assert.equal(installed.status, 'installed');
    assert.deepEqual(await fs.readFile(installed.executable), bytes);
    assert.equal((await runtime.run()).errorCount, 0);
    assert.equal(Object.values(runtime.backup.state.repositories)[0].installation.status, 'current');
    await fs.writeFile(path.join(installed.destination, 'personal.txt'), 'keep');
    f.releases[0].tag_name = 'v2';
    assert.equal((await runtime.run()).errorCount, 1);
    assert.equal(runtime.snapshot().metrics.errors, 1);
    const failed = Object.values(runtime.backup.state.repositories)[0];
    assert.equal(failed.installation.status, 'error');
    assert.equal(failed.installation.destination, installed.destination);
    assert.equal(failed.installation.tag, 'v1');
    assert.equal(failed.installation.latestTag, 'v2');
    assert.equal(await fs.readFile(path.join(installed.destination, 'personal.txt'), 'utf8'), 'keep');
    const exported = runtime.historyExport({});
    assert.equal(exported.runs[0].results[0].installation.status, 'error');
    assert(!JSON.stringify(exported).includes(installed.destination));
  }
);
test('imported settings retain installation preferences but require local opt-in again', async t => {
  const f = await repository(t),
    { exportSettings, importSettings } = require('../../app/core/transfer.cjs'),
    config = f.config();
  config.backup.metadata.releases = true;
  config.sources[0].installation = { enabled: true, destination: path.join(f.root, 'programs'), pattern: '*.AppImage' };
  const imported = importSettings(exportSettings(config));
  assert.equal(imported.sources[0].installation.enabled, false);
  assert.equal(imported.sources[0].installation.pattern, '*.AppImage');
});
test('automatic installation keeps only the program file of the newest release unless all files are requested', async t => {
  const { selectProgram } = require('../../app/core/program-select.cjs');
  const f = await repository(t),
    programs = path.join(f.root, 'programs');
  await fs.mkdir(programs);
  f.options = { ...f.options, metadata: { ...f.options.metadata, releases: true } };
  const names = version => [
    `app-${version}-macos-arm64.dmg`,
    `app-${version}-macos-x64.dmg`,
    `app-${version}-macos-universal.zip`,
    `app-${version}-windows-x64-portable.exe`,
    `app-${version}-windows-arm64-portable.exe`,
    `app-${version}-linux-x86_64.AppImage`,
    `app-${version}-linux-arm64.AppImage`,
    'SHA256SUMS.txt'
  ];
  const release = (id, version) => ({
    id,
    tag_name: 'v' + version,
    assets: names(version).map((name, index) => f.asset(id * 100 + index, name, `${version}:${name}`))
  });
  const stored = async record =>
    (await fs.readdir(path.join(record.destination, 'Git-Cloner-Releases')))
      .filter(name => !name.startsWith('.'))
      .sort();
  f.releases = [release(1, '1.0')];
  const all = await f.sync();
  assert.equal((await stored(all)).length, 8);
  f.source.installation = { enabled: true, destination: programs, pattern: '' };
  const expected = version => selectProgram(names(version).map((name, id) => ({ id, name }))).name;
  const single = await f.sync();
  assert.equal(single.status, 'updated');
  assert.deepEqual(await stored(single), [expected('1.0')]);
  assert.equal(single.releaseInfo.fileCount, 1);
  const downloads = f.downloads.length;
  f.releases = [release(2, '2.0'), ...f.releases];
  const newer = await f.sync();
  assert.deepEqual(await stored(newer), [expected('2.0')]);
  assert.equal(newer.releaseInfo.tag, 'v2.0');
  assert.equal(f.downloads.length, downloads + 1);
  f.source.installation.keepAllReleaseFiles = true;
  const kept = await f.sync();
  assert.equal((await stored(kept)).length, 8);
});
