const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const yaml = require('js-yaml');
const { generateCatalogs } = require('../../scripts/catalogs.cjs');
const exec = promisify(execFile);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-catalogs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'assets'),
    output = path.join(root, 'catalogs');
  await fs.mkdir(assets);
  const version = require('../../package.json').version;
  const files = [
    `Git-Cloner-${version}-mac-arm64.dmg`,
    `Git-Cloner-${version}-mac-x64.dmg`,
    `Git-Cloner-${version}-windows-x64-setup.exe`,
    `Git-Cloner-${version}-windows-arm64-setup.exe`,
    `Git-Cloner-${version}-linux-x64.tar.gz`,
    `Git-Cloner-${version}-linux-arm64.tar.gz`
  ];
  for (const name of files) await fs.writeFile(path.join(assets, name), `fixture:${name}`);
  return { root, assets, output, version, commit: 'a'.repeat(40), files };
}
test('catalog manifests contain actual artifact checksums and desktop integration', async t => {
  const f = await fixture(t);
  await generateCatalogs(f);
  const installer = yaml.load(
    await fs.readFile(
      path.join(f.output, `winget/manifests/u/Ujap1994/GitCloner/${f.version}/Ujap1994.GitCloner.installer.yaml`),
      'utf8'
    )
  );
  assert.equal(installer.InstallerType, 'nullsoft');
  assert.deepEqual(
    installer.Installers.map(i => i.Architecture),
    ['x64', 'arm64']
  );
  const bytes = await fs.readFile(path.join(f.assets, `Git-Cloner-${f.version}-windows-x64-setup.exe`));
  assert.equal(installer.Installers[0].InstallerSha256, createHash('sha256').update(bytes).digest('hex').toUpperCase());
  const cask = await fs.readFile(path.join(f.output, 'homebrew/git-cloner.rb'), 'utf8');
  assert.ok(cask.includes('on_arm'));
  assert.ok(cask.includes('Git Cloner.app'));
  const aur = await fs.readFile(path.join(f.output, 'aur/PKGBUILD'), 'utf8');
  assert.ok(aur.includes('/usr/share/applications/'));
  assert.ok(!aur.includes('|| true'));
  assert.ok(!aur.includes('app.asar.unpacked'));
  const flatpak = yaml.load(await fs.readFile(path.join(f.output, 'flathub/io.github.Ujap1994.GitCloner.yml'), 'utf8'));
  assert.ok(flatpak.modules.some(module => module.name === 'git-lfs'));
  for (const source of flatpak.modules.at(-1).sources.filter(s => s.url)) assert.match(source.sha256, /^[a-f\d]{64}$/);
});
test('catalog generation refuses missing artifacts and prerelease versions', async t => {
  const f = await fixture(t);
  await assert.rejects(generateCatalogs({ ...f, version: '2.0.0-beta.1' }));
  await fs.unlink(path.join(f.assets, f.files[0]));
  await assert.rejects(generateCatalogs(f), { code: 'ENOENT' });
});
test('catalog CLI uses the package version when --version is omitted', async t => {
  const f = await fixture(t);
  const result = await exec(process.execPath, [
    path.resolve(__dirname, '../../scripts/catalogs.cjs'),
    '--assets',
    f.assets,
    '--output',
    f.output,
    '--commit',
    f.commit
  ]);
  assert.equal(JSON.parse(result.stdout).version, f.version);
});
