const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {
  selectReleaseAssets,
  assetArchitecture,
  assetType,
  validateReleaseFilter
} = require('../../app/core/release-assets.cjs');
const { validateInstallation, selectProgram } = require('../../app/core/program-installation.cjs');
const { stableReleaseData } = require('../../app/core/release-reuse.cjs');
const { defaults, validateConfig } = require('../../app/core/config.cjs');
const files = names => names.map((name, index) => ({ id: index + 1, name }));
test('architecture and format filters retain universal packages and checksum sidecars', () => {
  const assets = files([
    'program-macos-arm64.dmg',
    'program-macos-x64.dmg',
    'program-macos-universal.dmg',
    'program-macos-arm64.zip',
    'program-macos-arm64.dmg.sha256',
    'SHA256SUMS.txt',
    'program-macos.dmg'
  ]);
  assert.deepEqual(
    selectReleaseAssets(assets, 'system', 'darwin', {
      releaseArchitecture: 'arm64',
      releaseFileTypes: ['dmg']
    }).selected.map(a => a.name),
    [assets[0].name, assets[2].name, assets[4].name, assets[5].name]
  );
  assert.equal(selectReleaseAssets(assets, 'all', 'darwin').selected.length, assets.length);
  assert(
    selectReleaseAssets(assets, 'all', 'darwin', { releaseArchitecture: 'system', arch: 'x64' }).selected.some(
      a => a.name === assets[1].name
    )
  );
});
test('architecture aliases and compound package extensions are recognized without substring guesses', () => {
  assert.deepEqual(assetArchitecture('tool-linux-x86_64.AppImage'), ['x64']);
  assert.deepEqual(assetArchitecture('tool_aarch64.tar.gz'), ['arm64']);
  assert.deepEqual(assetArchitecture('install.zip'), []);
  assert.equal(assetType('tool.pkg.tar.zst'), 'pacman');
  assert.equal(assetType('tool.tar.gz.sig'), 'tar.gz');
  assert.throws(() => validateReleaseFilter({ releaseArchitecture: 'evil' }));
  assert.throws(() => validateReleaseFilter({ releaseFileTypes: ['dmg', 'dmg'] }));
  assert.throws(() => validateReleaseFilter({ releaseFileTypes: ['../exe'] }));
});
test('legacy backup options migrate to unrestricted architecture and file types', () => {
  const value = defaults();
  delete value.backup.releaseArchitecture;
  delete value.backup.releaseFileTypes;
  const result = validateConfig(value);
  assert.equal(result.backup.releaseArchitecture, 'all');
  assert.deepEqual(result.backup.releaseFileTypes, []);
  assert.deepEqual(result.sources, []);
});
test('download counters do not change stable release metadata while content edits do', () => {
  const one = { releases: [{ body: 'notes', assets: [{ download_count: 1, name: 'file', digest: 'old' }] }] },
    two = structuredClone(one);
  two.releases[0].assets[0].download_count = 400;
  assert.deepEqual(stableReleaseData(one), stableReleaseData(two));
  two.releases[0].assets[0].digest = 'new';
  assert.notDeepEqual(stableReleaseData(one), stableReleaseData(two));
});
test('automatic installation is opt-in for one repository and cannot target backup directories', () => {
  const source = { kind: 'repository', destination: path.join(os.tmpdir(), 'backup') },
    backup = { metadata: { releases: true } },
    install = { enabled: true, destination: path.join(os.tmpdir(), 'programs'), pattern: '*.dmg' };
  assert.equal(validateInstallation(null, source, backup), null);
  assert.equal(validateInstallation(install, source, backup).enabled, true);
  assert.throws(() => validateInstallation(install, { ...source, kind: 'owner' }, backup));
  assert.throws(() => validateInstallation({ ...install, destination: source.destination }, source, backup));
  assert.throws(() =>
    validateInstallation({ ...install, destination: path.join(source.destination, 'child') }, source, backup)
  );
  assert.throws(() => validateInstallation(install, source, { metadata: { releases: false } }));
  assert.throws(() => validateInstallation({ ...install, pattern: '../*.dmg' }, source, backup));
});
test('program selection prefers native packages, rejects ambiguity and never chooses system setup installers', () => {
  const assets = files(['program-macos-universal.dmg', 'program-macos-arm64.dmg', 'program-macos-arm64.zip']);
  assert.equal(selectProgram(assets, 'darwin', 'arm64').name, assets[1].name);
  assert.equal(selectProgram(assets, 'darwin', 'x64').name, assets[0].name);
  assert.equal(
    selectProgram([...assets, { id: 99, name: 'program-macos-arm64.dmg.sha256' }], 'darwin', 'arm64').name,
    assets[1].name
  );
  assert.throws(
    () => selectProgram(files(['one-macos-arm64.dmg', 'two-macos-arm64.dmg']), 'darwin', 'arm64'),
    /Mehrere/
  );
  assert.throws(
    () => selectProgram(files(['app-windows-x64-setup.exe', 'app-windows-x64.msi']), 'win32', 'x64'),
    /Kein/
  );
  assert.equal(selectProgram(files(['one-windows-x64-portable.exe']), 'win32', 'x64').id, 1);
  assert.equal(selectProgram(files(['program-linux-arm64.AppImage']), 'linux', 'arm64').id, 1);
});
test('Windows ZIP paths reject device files, alternate data streams and ambiguous trailing names', () => {
  const { safeName } = require('../../app/core/program-archives.cjs');
  for (const name of ['App/file:stream', 'App/CON.txt', 'App/trailing.', 'App/trailing '])
    assert.throws(() => safeName(name, 'win32'));
  assert.equal(safeName('App/regular.exe', 'win32'), 'App/regular.exe');
});
test('unrestricted release settings retain the v3.3 backup fingerprint to reuse large Git mirrors', () => {
  const { backupFingerprint } = require('../../app/core/backup.cjs'),
    backup = defaults().backup;
  backup.metadata.releases = true;
  assert.equal(backupFingerprint(backup), '56cbc0728a83822d4cf552e9b388205b3985603406e13214748ed0cd473e64dc');
  assert.notEqual(
    backupFingerprint({ ...backup, releaseArchitecture: 'arm64' }),
    '56cbc0728a83822d4cf552e9b388205b3985603406e13214748ed0cd473e64dc'
  );
});
test('Apple Silicon falls back to Intel-only Mac programs and installation sources keep only the program file', () => {
  const { narrowToProgram, programRelease } = require('../../app/core/program-select.cjs');
  assert.equal(
    selectProgram(files(['program-macos-x64.dmg', 'program-windows-x64-portable.exe']), 'darwin', 'arm64').name,
    'program-macos-x64.dmg'
  );
  assert.equal(
    selectProgram(files(['program-macos-x64.dmg', 'program-macos-arm64.zip']), 'darwin', 'arm64').name,
    'program-macos-arm64.zip'
  );
  assert.throws(() => selectProgram(files(['program-macos-arm64.dmg']), 'darwin', 'x64'), /Kein/);
  const assets = files([
      'app-macos-arm64.dmg',
      'app-macos-universal.zip',
      'app-windows-x64-portable.exe',
      'SHA256SUMS.txt'
    ]),
    selection = selectReleaseAssets(assets, 'all', 'darwin');
  const narrowed = narrowToProgram(selection, { pattern: '' }, 'darwin', 'arm64');
  assert.deepEqual(
    narrowed.selected.map(a => a.name),
    ['app-macos-arm64.dmg']
  );
  assert.equal(narrowed.excluded.filter(a => a.reason === 'not-program').length, 3);
  assert.equal(
    narrowToProgram(selection, { pattern: '*.zip' }, 'darwin', 'arm64').selected[0].name,
    'app-macos-universal.zip'
  );
  assert.equal(narrowToProgram(selection, { pattern: '*.pkg' }, 'darwin', 'arm64'), selection);
  assert.equal(narrowToProgram(selection, null, 'darwin', 'arm64'), selection);
  assert.deepEqual(programRelease({ installation: { enabled: true, pattern: '*.dmg' } }), { pattern: '*.dmg' });
  assert.equal(programRelease({ installation: { enabled: true, keepAllReleaseFiles: true } }), null);
  assert.equal(programRelease({ installation: { enabled: false } }), null);
  assert.equal(programRelease({}), null);
  const source = { kind: 'repository', destination: path.join(os.tmpdir(), 'backup') },
    install = { enabled: true, destination: path.join(os.tmpdir(), 'programs'), pattern: '' };
  assert.equal(
    validateInstallation({ ...install, keepAllReleaseFiles: true }, source, { metadata: { releases: true } })
      .keepAllReleaseFiles,
    true
  );
  assert.equal('keepAllReleaseFiles' in validateInstallation(install, source, { metadata: { releases: true } }), false);
  assert.throws(() =>
    validateInstallation({ ...install, keepAllReleaseFiles: 'yes' }, source, { metadata: { releases: true } })
  );
});
test('DMG installation uses reported mount points, opens license images without a prompt and keeps Finder mounts attached', async t => {
  const fs = require('node:fs/promises');
  const { ProgramInstaller } = require('../../app/core/program-installation.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-dmg-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const image = path.join(root, 'app-macos-arm64.dmg'),
    finder = path.join(root, 'Volumes', 'Example');
  await fs.writeFile(image, 'image');
  const app = async volume => {
    await fs.mkdir(path.join(volume, 'Example.app', 'Contents', 'MacOS'), { recursive: true });
    await fs.writeFile(path.join(volume, 'Example.app', 'Contents', 'MacOS', 'Example'), 'binary');
    await fs.writeFile(path.join(volume, 'Example.app', 'Contents', 'Info.plist'), '<plist/>');
    await fs.symlink('/Applications', path.join(volume, 'Applications'));
  };
  await app(finder);
  let scenario, calls;
  const run = async (file, args) => {
    calls.push([path.basename(file), args[0]]);
    if (file.endsWith('hdiutil') && args[0] === 'attach') {
      const target = args.at(-1);
      if (scenario === 'license' && target.endsWith('.dmg'))
        throw Object.assign(new Error('Command failed: hdiutil attach'), { stderr: 'hdiutil: attach canceled\n' });
      if (scenario === 'broken')
        throw Object.assign(new Error('Command failed'), { stderr: 'hdiutil: attach failed - image not recognized\n' });
      let point = finder;
      if (scenario !== 'finder') {
        point = path.join(args[args.indexOf('-mountrandom') + 1], 'dmg.A1b2');
        await app(point);
      }
      return {
        stdout: `<?xml version="1.0"?><plist version="1.0"><dict><key>system-entities</key><array><dict><key>dev-entry</key><string>/dev/disk9</string></dict><dict><key>dev-entry</key><string>/dev/disk9s1</string><key>mount-point</key><string>${point.replace(/&/g, '&amp;')}</string></dict></array></dict></plist>`
      };
    }
    if (file.endsWith('hdiutil') && args[0] === 'convert') {
      await fs.writeFile(args[args.indexOf('-o') + 1] + '.cdr', 'converted');
      return { stdout: '' };
    }
    if (file.endsWith('hdiutil')) return { stdout: '' };
    if (file.endsWith('codesign') && scenario === 'unsigned')
      throw Object.assign(new Error('Command failed'), {
        stderr: `${args.at(-1)}: code object is not signed at all\nIn architecture: x86_64\n`
      });
    if (file.endsWith('PlistBuddy')) return { stdout: 'Example\n' };
    if (file.endsWith('lipo')) return { stdout: 'x86_64\n' };
    return { stdout: '' };
  };
  const installer = new ProgramInstaller({ platform: 'darwin', arch: 'arm64', run });
  for (const value of ['plain', 'license', 'finder']) {
    scenario = value;
    calls = [];
    const output = path.join(root, 'out-' + value);
    await fs.mkdir(output);
    assert.equal(await installer.prepare({ name: path.basename(image), file: image }, output), 'Example.app');
    assert(await fs.stat(path.join(output, 'Example.app', 'Contents', 'MacOS', 'Example')));
    assert.equal(calls.filter(call => call[1] === 'convert').length, value === 'license' ? 1 : 0);
    assert.equal(calls.filter(call => call[1] === 'detach').length, value === 'finder' ? 0 : 1);
  }
  assert(await fs.stat(path.join(finder, 'Example.app')));
  scenario = 'unsigned';
  await assert.rejects(
    installer.prepare({ name: path.basename(image), file: image }, await fs.mkdtemp(path.join(root, 'out-'))),
    /Signaturprüfung von Example\.app ist fehlgeschlagen \(code object is not signed at all\)/
  );
  scenario = 'broken';
  await assert.rejects(
    installer.prepare({ name: path.basename(image), file: image }, await fs.mkdtemp(path.join(root, 'out-'))),
    /DMG konnte nicht geöffnet werden: hdiutil: attach failed - image not recognized/
  );
});
test(
  'installer tools receive a closed input instead of waiting for an interactive answer',
  { skip: process.platform === 'win32' },
  async () => {
    const { ProgramInstaller } = require('../../app/core/program-installation.cjs');
    const { stdout } = await new ProgramInstaller().run('cat', [], { timeout: 10000 });
    assert.equal(stdout, '');
  }
);
test('a release file published under a second name counts as one program only with the same SHA-256', () => {
  const { narrowToProgram } = require('../../app/core/program-select.cjs'),
    digest = 'sha256:' + 'dc'.repeat(32);
  const twins = [
    { id: 1, name: 'app-macos-universal.dmg', digest },
    { id: 2, name: 'app-1.2.3-macos-universal.dmg', digest: digest.toUpperCase().replace('SHA256:', 'sha256:') },
    { id: 3, name: 'app-cli-1.2.3-macos-universal.zip', digest: 'sha256:' + '1e'.repeat(32) }
  ];
  assert.equal(selectProgram(twins, 'darwin', 'arm64').name, 'app-1.2.3-macos-universal.dmg');
  assert.equal(selectProgram([...twins].reverse(), 'darwin', 'arm64').id, 2);
  assert.equal(
    selectProgram(
      twins.map(file => ({ ...file, digest: file.digest.slice(7) })),
      'darwin',
      'arm64'
    ).id,
    2
  );
  assert.throws(
    () => selectProgram([twins[0], { ...twins[1], digest: 'sha256:' + 'ab'.repeat(32) }], 'darwin', 'arm64'),
    /Mehrere/
  );
  assert.throws(() => selectProgram([twins[0], { ...twins[1], digest: undefined }], 'darwin', 'arm64'), /Mehrere/);
  assert.throws(
    () =>
      selectProgram(
        twins.map(file => ({ ...file, digest: 'sha256:short' })),
        'darwin',
        'arm64'
      ),
    /Mehrere/
  );
  const narrowed = narrowToProgram(selectReleaseAssets(twins, 'all', 'darwin'), { pattern: '' }, 'darwin', 'arm64');
  assert.deepEqual(
    narrowed.selected.map(file => file.id),
    [2]
  );
  assert.deepEqual(
    narrowed.excluded.map(file => file.id),
    [1, 3]
  );
});
test('a Finder .DS_Store in the program folder does not block updates while other foreign files still do', async t => {
  const fs = require('node:fs/promises'),
    { owned } = require('../../app/core/program-installation.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-owned-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'Example.app'));
  await fs.writeFile(
    path.join(directory, '.git-cloner-program.json'),
    JSON.stringify({ format: 'git-cloner-program', identity: 'github:example', files: ['Example.app'] })
  );
  await fs.writeFile(path.join(directory, '.DS_Store'), 'finder');
  assert.deepEqual((await owned(directory, 'github:example')).files, ['Example.app']);
  await fs.writeFile(path.join(directory, 'notes.txt'), 'mine');
  await assert.rejects(owned(directory, 'github:example'), /Zusätzliche Dateien/);
});
test('release assets come from the latest release response and only very large lists use the assets endpoint', async () => {
  const { metadataPlan } = require('../../app/core/metadata.cjs'),
    asset = id => ({
      id,
      name: `app-${id}-macos-arm64.dmg`,
      size: 1,
      digest: 'sha256:' + String(id).padStart(64, '0')
    });
  for (const count of [3, 99, 100, 130]) {
    const assets = Array.from({ length: count }, (_value, index) => asset(index + 1)),
      requested = [];
    const github = {
      collection: async endpoint => {
        requested.push(endpoint);
        return endpoint.endsWith('/assets') ? assets : [{ id: 7, tag_name: 'v1', assets }];
      },
      request: async endpoint => {
        requested.push(endpoint);
        return { id: 7, tag_name: 'v1', assets };
      }
    };
    const plan = await metadataPlan({ full_name: 'demo/app' }, { releases: true }, github, null, {
      releaseScope: 'all',
      platform: 'darwin',
      arch: 'arm64'
    });
    assert.equal(plan.releaseInfo.fileCount, count);
    assert.equal(requested.includes('/repos/demo/app/releases/7/assets'), count >= 100, `${count} assets`);
  }
});
