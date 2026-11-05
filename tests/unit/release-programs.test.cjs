const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { selectReleaseAssets, assetArchitecture, assetType, validateReleaseFilter } = require('../../app/core/release-assets.cjs');
const { validateInstallation, selectProgram } = require('../../app/core/program-installation.cjs');
const { stableReleaseData } = require('../../app/core/release-reuse.cjs');
const { defaults, validateConfig } = require('../../app/core/config.cjs');
const files = names => names.map((name, index) => ({ id: index + 1, name }));
test('architecture and format filters retain universal packages and checksum sidecars', () => {
  const assets = files(['program-macos-arm64.dmg', 'program-macos-x64.dmg', 'program-macos-universal.dmg', 'program-macos-arm64.zip', 'program-macos-arm64.dmg.sha256', 'SHA256SUMS.txt', 'program-macos.dmg']);
  assert.deepEqual(selectReleaseAssets(assets, 'system', 'darwin', { releaseArchitecture: 'arm64', releaseFileTypes: ['dmg'] }).selected.map(a => a.name), [assets[0].name, assets[2].name, assets[4].name, assets[5].name]);
  assert.equal(selectReleaseAssets(assets, 'all', 'darwin').selected.length, assets.length);
  assert(selectReleaseAssets(assets, 'all', 'darwin', { releaseArchitecture: 'system', arch: 'x64' }).selected.some(a => a.name === assets[1].name));
});
test('architecture aliases and compound package extensions are recognized without substring guesses', () => {
  assert.deepEqual(assetArchitecture('tool-linux-x86_64.AppImage'), ['x64']); assert.deepEqual(assetArchitecture('tool_aarch64.tar.gz'), ['arm64']); assert.deepEqual(assetArchitecture('install.zip'), []); assert.equal(assetType('tool.pkg.tar.zst'), 'pacman'); assert.equal(assetType('tool.tar.gz.sig'), 'tar.gz');
  assert.throws(() => validateReleaseFilter({ releaseArchitecture: 'evil' })); assert.throws(() => validateReleaseFilter({ releaseFileTypes: ['dmg', 'dmg'] })); assert.throws(() => validateReleaseFilter({ releaseFileTypes: ['../exe'] }));
});
test('legacy backup options migrate to unrestricted architecture and file types', () => { const value = defaults(); delete value.backup.releaseArchitecture; delete value.backup.releaseFileTypes; const result = validateConfig(value); assert.equal(result.backup.releaseArchitecture, 'all'); assert.deepEqual(result.backup.releaseFileTypes, []); assert.deepEqual(result.sources, []); });
test('download counters do not change stable release metadata while content edits do', () => { const one = { releases: [{ body: 'notes', assets: [{ download_count: 1, name: 'file', digest: 'old' }] }] }, two = structuredClone(one); two.releases[0].assets[0].download_count = 400; assert.deepEqual(stableReleaseData(one), stableReleaseData(two)); two.releases[0].assets[0].digest = 'new'; assert.notDeepEqual(stableReleaseData(one), stableReleaseData(two)); });
test('automatic installation is opt-in for one repository and cannot target backup directories', () => {
  const source = { kind: 'repository', destination: path.join(os.tmpdir(), 'backup') }, backup = { metadata: { releases: true } }, install = { enabled: true, destination: path.join(os.tmpdir(), 'programs'), pattern: '*.dmg' };
  assert.equal(validateInstallation(null, source, backup), null); assert.equal(validateInstallation(install, source, backup).enabled, true);
  assert.throws(() => validateInstallation(install, { ...source, kind: 'owner' }, backup)); assert.throws(() => validateInstallation({ ...install, destination: source.destination }, source, backup)); assert.throws(() => validateInstallation({ ...install, destination: path.join(source.destination, 'child') }, source, backup)); assert.throws(() => validateInstallation(install, source, { metadata: { releases: false } })); assert.throws(() => validateInstallation({ ...install, pattern: '../*.dmg' }, source, backup));
});
test('program selection prefers native packages, rejects ambiguity and never chooses system setup installers', () => {
  const assets = files(['program-macos-universal.dmg', 'program-macos-arm64.dmg', 'program-macos-arm64.zip']); assert.equal(selectProgram(assets, 'darwin', 'arm64').name, assets[1].name); assert.equal(selectProgram(assets, 'darwin', 'x64').name, assets[0].name); assert.equal(selectProgram([...assets,{id:99,name:'program-macos-arm64.dmg.sha256'}],'darwin','arm64').name,assets[1].name);
  assert.throws(() => selectProgram(files(['one-macos-arm64.dmg', 'two-macos-arm64.dmg']), 'darwin', 'arm64'), /Mehrere/); assert.throws(() => selectProgram(files(['app-windows-x64-setup.exe', 'app-windows-x64.msi']), 'win32', 'x64'), /Kein/);
  assert.equal(selectProgram(files(['one-windows-x64-portable.exe']), 'win32', 'x64').id, 1); assert.equal(selectProgram(files(['program-linux-arm64.AppImage']), 'linux', 'arm64').id, 1);
});
test('Windows ZIP paths reject device files, alternate data streams and ambiguous trailing names',()=>{const {safeName}=require('../../app/core/program-archives.cjs');for(const name of ['App/file:stream','App/CON.txt','App/trailing.','App/trailing '])assert.throws(()=>safeName(name,'win32'));assert.equal(safeName('App/regular.exe','win32'),'App/regular.exe');});
test('unrestricted release settings retain the v3.3 backup fingerprint to reuse large Git mirrors',()=>{const {backupFingerprint}=require('../../app/core/backup.cjs'),backup=defaults().backup;backup.metadata.releases=true;assert.equal(backupFingerprint(backup),'56cbc0728a83822d4cf552e9b388205b3985603406e13214748ed0cd473e64dc');assert.notEqual(backupFingerprint({...backup,releaseArchitecture:'arm64'}),'56cbc0728a83822d4cf552e9b388205b3985603406e13214748ed0cd473e64dc');});
