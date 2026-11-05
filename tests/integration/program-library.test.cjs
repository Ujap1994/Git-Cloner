const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { repository } = require('../helpers/repository.cjs');
const { writeZip } = require('../helpers/program-zip.cjs');
const { ProgramInstaller } = require('../../app/core/program-installation.cjs');
const { ProgramShortcuts, syncAt, quoteExec } = require('../../app/core/program-shortcuts.cjs');
const { DownloadHistory } = require('../../app/core/download-history.cjs');
const { transferAsset } = require('../../app/core/release-transfer.cjs');
const { ReleaseDownloads } = require('../../app/core/release-downloads.cjs');
const { GitHubClient } = require('../../app/core/github.cjs');
const { readJson, writeJson } = require('../../app/core/store.cjs');
const { validateInstallation } = require('../../app/core/program-options.cjs');
const { defaults } = require('../../app/core/config.cjs');
const { exportSettings, importSettings } = require('../../app/core/transfer.cjs');
const run = promisify(execFile);
const pe = content => { const data = Buffer.alloc(160, content); data.write('MZ'); data.writeUInt32LE(80, 60); data.set([80,69,0,0],80); data.writeUInt16LE(0x8664,84); return data; };
async function suite(t) {
  const f = await repository(t), programs = path.join(f.root, 'programs'), zip = path.join(f.root, 'suite.zip'); await fs.mkdir(programs);
  f.source.installation = { enabled: true, destination: programs, pattern: '*.zip', programs: ['Suite/Writer.exe', 'Suite/Viewer.exe'] };
  f.options.metadata.releases = true;
  f.publish = async value => { await writeZip(zip, [{ name: 'Suite/Writer.exe', data: pe(value) }, { name: 'Suite/Viewer.exe', data: pe(value + 1) }, { name: 'Suite/shared.dll', data: 'shared companion' }]); f.releases = [{ tag_name: 'v' + value, assets: [f.asset(1, 'suite-windows-x64.zip', await fs.readFile(zip))] }]; return f.sync(); };
  f.installer = new ProgramInstaller({ platform: 'win32', arch: 'x64' }); return f;
}
test('multiple programs are inspected from verified backup bytes, installed together and updated atomically', async t => {
  const f = await suite(t), record = await f.publish(1), preview = await f.installer.inspect({ source: f.source, record, git: f.git });
  assert.deepEqual(preview.candidates.map(item => item.key), ['Suite/Viewer.exe', 'Suite/Writer.exe']); assert(preview.candidates.every(item => item.available));
  const first = await f.installer.install({ source: f.source, record, git: f.git }); assert.equal(first.programs.length, 2); assert.deepEqual(await fs.readFile(first.programs[0].executable), pe(1)); assert.deepEqual(await fs.readFile(first.programs[1].executable), pe(2));
  assert.equal(await fs.readFile(path.join(first.destination, 'program', 'shared.dll'), 'utf8'), 'shared companion');
  assert.equal((await f.installer.install({ source: f.source, record, git: f.git })).status, 'current');
  const next = await f.publish(3), updated = await f.installer.install({ source: f.source, record: next, git: f.git }); assert.equal(updated.status, 'installed'); assert.deepEqual(await fs.readFile(updated.programs[0].executable), pe(3));
  f.source.installation.programs = ['Suite/Writer.exe', 'Missing.exe']; await assert.rejects(f.installer.install({ source: f.source, record: next, git: f.git }), /Programmauswahl/); assert.deepEqual(await fs.readFile(updated.programs[0].executable), pe(3)); assert.deepEqual(await fs.readFile(updated.programs[1].executable), pe(4));
  f.source.installation.programs = ['Suite/Viewer.exe']; const reduced = await f.installer.install({ source: f.source, record: next, git: f.git }); assert.equal(reduced.status, 'installed'); assert.equal(reduced.programs.length, 1);
});
test('an explicit program selection is required for ambiguous archives and incompatible members remain unselectable', async t => {
  const f = await suite(t), record = await f.publish(1); f.source.installation.programs = [];
  await assert.rejects(f.installer.install({ source: f.source, record, git: f.git }), /Programmauswahl/);
  const preview = await new ProgramInstaller({ platform: 'win32', arch: 'arm64' }).inspect({ source: f.source, record, git: f.git }).catch(error => error);
  assert(preview instanceof Error); // The entire x64 asset is rejected on an ARM64-only selection.
  const file = path.join(f.root, 'mixed.zip'), output = path.join(f.root, 'mixed'); await fs.mkdir(output); await writeZip(file, [{ name: 'Good.exe', data: pe(1) }, { name: 'Broken.exe', data: 'not a program' }]);
  const { inspectPrograms, preparePrograms } = require('../../app/core/program-content.cjs'), options = { platform: 'win32', arch: 'x64', run };
  const candidates = await inspectPrograms({ name: 'suite-windows-x64.zip', file }, options); assert.equal(candidates.find(item => item.key === 'Good.exe').available, true); assert.equal(candidates.find(item => item.key === 'Broken.exe').available, false);
  await assert.rejects(preparePrograms({ name: 'suite-windows-x64.zip', file }, output, ['Good.exe', 'Broken.exe'], options)); assert.deepEqual(await fs.readdir(output), []);
});
test('program selections and shortcuts are validated and importing settings disables both installation and links', async t => {
  const f = await suite(t), options = { ...defaults().backup, metadata: { ...defaults().backup.metadata, releases: true } };
  for (const programs of [['../Example.app'], ['/Example.app'], ['A\\B.exe'], ['A', 'A'], Array.from({ length: 65 }, (_, i) => i + '.app')]) assert.throws(() => validateInstallation({ ...f.source.installation, programs }, f.source, options), /Programmauswahl/);
  assert.throws(() => validateInstallation({ ...f.source.installation, shortcut: { enabled: true, destination: 'relative' } }, f.source, options), /verknüpfungen/i);
  f.source.backup = options; f.source.installation.shortcut = { enabled: true, destination: path.join(f.root, 'Desktop') }; const imported = importSettings(exportSettings(f.config())); assert.equal(imported.sources[0].installation.enabled, false); assert.equal(imported.sources[0].installation.shortcut.enabled, false); assert.equal(imported.sources[0].installation.programs.length, 2);
});
test('Linux launchers and Mac Finder links follow all selected programs without overwriting user changes', async t => {
  const f = await suite(t), record = await f.publish(1), installed = await f.installer.install({ source: f.source, record, git: f.git });
  for (const platform of process.platform === 'win32' ? ['linux'] : ['linux', 'darwin']) {
    const desktop = path.join(f.root, 'Desktop-' + platform); await fs.mkdir(desktop); f.source.installation.shortcut = { enabled: true, destination: desktop };
    const links = new ProgramShortcuts({ platform }), shortcuts = await links.sync({ source: f.source, installation: installed }); assert.equal(shortcuts.count, 2);
    const first = path.join(desktop, shortcuts.files[0]);
    if (platform === 'darwin') assert.equal(await fs.readlink(first), installed.programs[0].executable);
    else { const text = await fs.readFile(first, 'utf8'); assert(text.includes('Type=Application')); assert(text.includes(quoteExec(installed.programs[0].executable))); }
    const before = await fs.lstat(first); await links.sync({ source: f.source, installation: installed, previous: { shortcuts } }); assert.equal((await fs.lstat(first)).mtimeMs, before.mtimeMs);
    if (platform === 'darwin') { await fs.unlink(first); await fs.symlink(f.root, first); } else await fs.writeFile(first, 'user changed launcher');
    f.source.installation.shortcut.enabled = false; await assert.rejects(links.sync({ source: f.source, installation: installed, previous: { shortcuts } }), /geänderte/); assert(await fs.lstat(first));
  }
});
test('owned shortcuts can move folders, remove deselected links and recover a prepared atomic rename', async t => {
  const f = await suite(t), record = await f.publish(1), installed = await f.installer.install({ source: f.source, record, git: f.git });
  const a = path.join(f.root, 'links-a'), b = path.join(f.root, 'links-b'); await fs.mkdir(a); await fs.mkdir(b);
  f.source.installation.shortcut = { enabled: true, destination: a }; const links = new ProgramShortcuts({ platform: 'linux' }), first = await links.sync({ source: f.source, installation: installed });
  f.source.installation.shortcut.destination = b; const moved = await links.sync({ source: f.source, installation: installed, previous: { shortcuts: first } }); for (const name of first.files) await assert.rejects(fs.lstat(path.join(a, name)), { code: 'ENOENT' }); assert.equal(moved.count, 2);
  const metadata = path.join(b, '.git-cloner-shortcuts'), marker = (await fs.readdir(metadata)).find(name => name !== 'owner.json' && name.endsWith('.json')), file = path.join(metadata, marker), state = await readJson(file), entry = state.entries[0], stage = '00000000-0000-0000-0000-000000000000.desktop';
  await fs.rename(path.join(b, entry.file), path.join(metadata, stage)); state.pending = { stage, prior: null, entry }; state.entries = state.entries.filter(item => item !== entry); await writeJson(file, state);
  await links.sync({ source: f.source, installation: installed, previous: { shortcuts: moved } }); assert(await fs.stat(path.join(b, entry.file))); assert.equal((await readJson(file)).pending, undefined);
  f.source.installation.shortcut.enabled = false; await links.sync({ source: f.source, installation: installed, previous: { shortcuts: moved } }); for (const name of moved.files) await assert.rejects(fs.lstat(path.join(b, name)), { code: 'ENOENT' });
});
test('shortcut file collisions and backup directories remain protected', async t => {
  const f = await suite(t), record = await f.publish(1), installed = await f.installer.install({ source: f.source, record, git: f.git }); f.source.installation.shortcut = { enabled: true, destination: f.backup };
  await assert.rejects(new ProgramShortcuts({ platform: 'linux' }).sync({ source: f.source, installation: installed }), /außerhalb/);
  const root = path.join(f.root, 'links'); await fs.mkdir(root); const program = installed.programs[0], options = { platform: 'linux', run }, first = await syncAt(root, 'identity', [program], options); const metadata = path.join(root, '.git-cloner-shortcuts');
  await fs.rm(metadata, { recursive: true }); await assert.rejects(syncAt(root, 'identity', [program], options), /fremde Programmverknüpfung/); assert(await fs.stat(path.join(root, first.files[0])));
  assert(quoteExec('/test/$value`x"%file').includes('%%file')); assert(quoteExec('/test/$value').includes('\\\\$value')); assert.throws(() => quoteExec('/test/unsafe\npath'));

});
test('native Windows creates a real .lnk using structured path data without launching its target', { skip: process.platform !== 'win32' }, async t => {
  const f = await suite(t), record = await f.publish(1), installed = await f.installer.install({ source: f.source, record, git: f.git }), desktop = path.join(f.root, "Links O'Brien $literal"); await fs.mkdir(desktop); f.source.installation.shortcut = { enabled: true, destination: desktop };
  const shortcuts = await new ProgramShortcuts().sync({ source: f.source, installation: installed }); assert.equal(shortcuts.count, 2);
  const script = '$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:GIT_CLONER_TEST_LINK))); [Console]::Write($s.TargetPath)';
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, GIT_CLONER_TEST_LINK: Buffer.from(path.join(desktop, shortcuts.files[0])).toString('base64') } }); assert.equal(stdout.trim().toLowerCase(), installed.programs[0].executable.toLowerCase());
});
test('download history persists measured values, masks encrypted asset names and bounds queries and retention', async t => {
  const f = await repository(t), history = new DownloadHistory(path.join(f.root, 'download-history.json'));
  await Promise.all([history.append([{ fullName: 'demo/project', name: 'app.zip', status: 'downloaded', networkBytes: 128 }]), history.append([{ fullName: 'demo/project', name: 'secret.zip', encrypted: true, status: 'reused', reusedBytes: 128 }])]);
  await history.flush(); const query = await new DownloadHistory(history.file).query(); assert.equal(query.total, 2); assert.equal(query.totals.networkBytes, 128); assert.equal(query.totals.reusedBytes, 128); assert(!JSON.stringify(query).includes('secret.zip')); assert.equal((await history.query({ search: 'app.zip' })).total, 1);
  await history.append(Array.from({ length: 2050 }, () => ({ status: 'cleaned', freedBytes: 4 }))); const bounded = await history.query(); assert.equal(bounded.retained, 2000); assert.equal(bounded.entries.length, 50); assert.equal(bounded.totals.freedBytes, 8000); assert.equal((await history.query({ offset: 1990 })).entries.length, 10); await assert.rejects(history.query({ status: 'invented' }));
});
test('actual HTTP interruption, resume and completed cache reuse record exact transferred and avoided payload bytes', async t => {
  const f = await repository(t), payload = Buffer.alloc(512, 7), asset = { id: 1, name: 'program.zip', size: payload.length, digest: 'sha256:' + createHash('sha256').update(payload).digest('hex') }; let interrupt = true;
  const server = http.createServer((req, res) => { const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0); res.writeHead(offset ? 206 : 200, { etag: '"stable"', 'content-length': payload.length - offset, ...(offset ? { 'content-range': `bytes ${offset}-${payload.length - 1}/${payload.length}` } : {}) }); if (interrupt) { interrupt = false; res.write(payload.subarray(0, 128)); setTimeout(() => res.destroy(), 80); } else res.end(payload.subarray(offset)); }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const client = new GitHubClient({ retryOptions: { retries: 0 }, fetchImpl: (_url, options) => fetch(`http://127.0.0.1:${server.address().port}`, options) }), events = [], downloads = await ReleaseDownloads.open({ root: f.backup, volumeId: f.source.volumeId, scope: 'history-test', chunkBytes: 64 }); t.after(() => downloads.close());
  const transfer = target => transferAsset({ asset, tag: 'v1', target, downloads, onDownload: value => events.push(value), download: measured => client.downloadAsset('demo/project', 1, target, { expectedName: asset.name, expectedSize: asset.size, expectedDigest: asset.digest, ...measured }) });
  await assert.rejects(transfer(path.join(f.root, 'failed'))); assert.equal(events[0].networkBytes, 128); assert.equal(events[0].status, 'error'); assert.equal(events[0].resumedBytes, 0);
  await transfer(path.join(f.root, 'resumed')); assert.equal(events[1].networkBytes, 384); assert.equal(events[1].resumedBytes, 128); assert.equal(events[1].status, 'resumed');
  await transfer(path.join(f.root, 'cached')); assert.equal(events[2].networkBytes, 0); assert.equal(events[2].resumedBytes, 512); assert.equal(events[2].status, 'cached'); assert.deepEqual(await fs.readFile(path.join(f.root, 'cached')), payload);
  const measured = (await require('../../app/core/download-storage.cjs').inventory([{ destination: f.backup, volumeId: f.source.volumeId }])).entries[0].bytes; assert.equal(await downloads.clear(), measured);
});
test('local asset reuse and cache cleanup are recorded by real backup and runtime operations', async t => {
  const f = await repository(t), asset = f.asset(1, 'app.zip', 'verified bytes'); f.releases = [{ tag_name: 'v1', assets: [asset] }]; f.options.metadata.releases = true; const initial = []; await f.sync({ onDownload: item => initial.push(item) }); assert.equal(initial.find(item => item.status === 'downloaded').networkBytes, asset.size); assert(initial.find(item => item.status === 'cleaned').freedBytes > asset.size);
  f.releases[0].body = 'new notes'; const reused = []; await f.sync({ onDownload: item => reused.push(item) }); assert.equal(reused.find(item => item.status === 'reused').reusedBytes, asset.size); assert.equal(reused.find(item => item.status === 'reused').networkBytes, 0);
  f.source.backup = f.options; f.releases[0].body = 'new runtime notes'; const runtime = await f.runtime({ fetchImpl: async url => { const endpoint = new URL(url).pathname; if (endpoint === '/repos/demo/project') return Response.json(f.repository); if (endpoint.endsWith('/releases/latest')) return Response.json(f.releases[0]); if (endpoint.endsWith('/releases')) return Response.json(f.releases); throw new Error('Unexpected endpoint ' + endpoint); } }); await runtime.run(); const persisted = await runtime.downloadHistoryQuery({ status: 'reused' }); assert.equal(persisted.total, 1); assert.equal(persisted.totals.reusedBytes, asset.size);
});
test('retries within one transfer never count newly received chunks as avoided downloads', async t => {
  const f = await repository(t), payload = Buffer.alloc(512, 9), asset = f.asset(1, 'program.zip', payload); let interrupted = false;
  const downloads = await ReleaseDownloads.open({ root: f.backup, volumeId: f.source.volumeId, scope: 'same-call-retry', chunkBytes: 64 }); t.after(() => downloads.close());
  const client = new GitHubClient({ retryOptions: { retries: 1, baseDelay: 1 }, fetchImpl: async (_url, options) => {
    if (!interrupted) { interrupted = true; return new Response(new ReadableStream({ start(controller) { controller.enqueue(payload.subarray(0, 128)); setTimeout(() => controller.error(Object.assign(new Error('interrupt once'), { retryable: true })), 30); } }), { headers: { etag: '"same"' } }); }
    const offset = Number(options.headers.Range?.match(/bytes=(\d+)-/)?.[1] || 0);
    return new Response(payload.subarray(offset), { status: offset ? 206 : 200, headers: { etag: '"same"', ...(offset ? { 'content-range': `bytes ${offset}-511/512` } : {}) } });
  } });
  const target = path.join(f.root, 'download'), events = [];
  await transferAsset({ asset, tag: 'v1', target, downloads, onDownload: event => events.push(event), download: measured => client.downloadAsset('demo/project', 1, target, { expectedSize: asset.size, expectedDigest: asset.digest, ...measured }) });
  assert.equal(events.length, 1); assert.equal(events[0].networkBytes, payload.length); assert.equal(events[0].resumedBytes, 0); assert.equal(events[0].status, 'downloaded');
});
test('runtime program inspection authenticates encrypted backups and leaves the backup and history unchanged', async t => {
  const f = await repository(t), payload = Buffer.alloc(128); payload.set([127,69,76,70]); payload.write('AI',8); payload[10] = 2; payload.writeUInt16LE({ x64: 62, arm64: 183, ia32: 3 }[process.arch],18);
  const programs = path.join(f.root, 'programs'); await fs.mkdir(programs); f.source.installation = { enabled: false, destination: programs, pattern: '*.AppImage' }; f.options.encryption = true; f.options.metadata.releases = true; f.source.backup = f.options; f.releases = [{ tag_name: 'v1', assets: [f.asset(1, `example-linux-${process.arch}.AppImage`, payload)] }];
  const password = 'a long inspection password', record = await f.sync({ passphrase: password }), before = await fs.readFile(path.join(record.destination, 'backup.gcb')), runtime = await f.runtime({ state: { repositories: { [record.id]: record } } }); runtime.vault.archivePassword = password;
  // This fixture deliberately tests a Linux AppImage even on native Windows/Mac runners.
  const installer = new ProgramInstaller({ platform: 'linux', arch: process.arch }); const inspected = await installer.inspect({ source: f.source, record, git: f.git, passphrase: runtime.vault.passwordFor(record) }); assert.equal(inspected.candidates.length, 1); assert.equal(inspected.candidates[0].available, true);
  if (process.platform === 'linux') { assert.equal((await runtime.programCandidates({ sourceId: f.source.id, pattern: '*.AppImage' })).candidates.length, 1); runtime.vault.archivePassword = 'incorrect archive password'; await assert.rejects(runtime.programCandidates({ sourceId: f.source.id, pattern: '*.AppImage' }), /Passwort|authentifiziert/i); assert.equal(runtime.operation, null); }
  assert.deepEqual(await fs.readFile(path.join(record.destination, 'backup.gcb')), before); assert.equal((await runtime.downloadHistoryQuery()).total, 0);
});
test('runtime installs shortcuts on unchanged backups and reports edited-link failures without losing the app', { skip: process.platform !== 'linux' }, async t => {
  const f = await repository(t), programs = path.join(f.root, 'programs'), desktop = path.join(f.root, 'Desktop'); await fs.mkdir(programs); await fs.mkdir(desktop);
  const payload = Buffer.alloc(128, 1); payload.set([127,69,76,70]); payload.write('AI',8); payload[10] = 2; payload.writeUInt16LE({ x64: 62, arm64: 183, ia32: 3 }[process.arch],18);
  f.options.metadata.releases = true; f.source.backup = f.options; f.source.installation = { enabled: true, destination: programs, pattern: '*.AppImage' }; f.releases = [{ tag_name: 'v1', assets: [f.asset(1, `example-linux-${process.arch}.AppImage`, payload)] }];
  const runtime = await f.runtime({ fetchImpl: async url => { const endpoint = new URL(url).pathname; return endpoint.endsWith('/releases/assets/1') ? new Response(payload) : Response.json(endpoint.endsWith('/releases/latest') ? f.releases[0] : endpoint.endsWith('/releases') ? f.releases : f.repository); } });
  assert.equal((await runtime.run()).errorCount, 0); const source = runtime.config.sources[0]; source.installation.shortcut = { enabled: true, destination: desktop };
  const linked = await runtime.run(); assert.equal(linked.errorCount, 0); assert.equal(linked.results[0].status, 'unchanged'); const installed = Object.values(runtime.backup.state.repositories)[0].installation; assert.equal(installed.shortcuts.count, 1);
  const link = path.join(desktop, installed.shortcuts.files[0]); await fs.writeFile(link, 'my own launcher'); const failed = await runtime.run(); assert.equal(failed.errorCount, 1); assert.equal(runtime.snapshot().metrics.errors, 1); assert.equal(failed.results[0].installation.status, 'current'); assert.equal(failed.results[0].installation.shortcuts.status, 'error'); assert.equal(await fs.readFile(link, 'utf8'), 'my own launcher'); assert.deepEqual(await fs.readFile(installed.executable), payload);
  const exported = JSON.stringify(runtime.historyExport()); assert(!exported.includes(desktop)); assert(!exported.includes(installed.executable));
});
