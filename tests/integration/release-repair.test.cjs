const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { repository } = require('../helpers/repository.cjs');

for (const damage of ['missing', 'truncated'])
  test(`unchanged releases repair ${damage} assets before the weekly integrity check`, async t => {
    const f = await repository(t);
    f.options.metadata.releases = true;
    f.releases = [
      {
        tag_name: 'v1',
        assets: [
          f.asset(1, 'example-mac-arm64.dmg', 'native package'),
          f.asset(2, 'example-mac-universal.dmg', 'universal package')
        ]
      }
    ];
    const first = await f.sync();
    const file = path.join(first.destination, first.releaseInfo.assetDirectory, f.releases[0].assets[0].name);
    if (damage === 'missing') await fs.unlink(file);
    else await fs.truncate(file, 2);
    f.downloads = [];
    const next = await f.sync();
    assert.equal(next.status, 'repaired');
    assert.equal(next.commit, first.commit);
    assert.deepEqual(f.downloads, [1], 'the intact universal package must be reused');
    assert.equal(await fs.readFile(file, 'utf8'), 'native package');
    assert.equal((await f.sync()).status, 'unchanged');
  });

test('a failed repair preserves the existing repository and intact release files', async t => {
  const f = await repository(t);
  f.options.metadata.releases = true;
  f.releases = [
    {
      tag_name: 'v1',
      assets: [f.asset(1, 'app-mac-arm64.dmg', 'native'), f.asset(2, 'app-mac-universal.dmg', 'universal')]
    }
  ];
  const first = await f.sync(),
    folder = path.join(first.destination, first.releaseInfo.assetDirectory);
  await fs.unlink(path.join(folder, 'app-mac-arm64.dmg'));
  f.assets.delete(1);
  await assert.rejects(f.sync());
  assert.equal(await f.git.head(first.destination), first.commit);
  assert.equal(await fs.readFile(path.join(folder, 'app-mac-universal.dmg'), 'utf8'), 'universal');
});

test('changing the DMG variant updates an unchanged release and reuses the selected local file', async t => {
  const { metadataPlan } = require('../../app/core/metadata.cjs');
  const f = await repository(t);
  f.options.metadata.releases = true;
  f.options.releaseArchitecture = 'arm64';
  f.options.releaseFileTypes = ['dmg'];
  f.releases = [
    {
      tag_name: 'v1',
      assets: [
        f.asset(1, 'app-mac-arm64.dmg', 'native'),
        f.asset(2, 'app-mac-universal.dmg', 'universal'),
        f.asset(3, 'app-mac-x64.dmg', 'intel')
      ]
    }
  ];
  const sync = async variant => {
    f.options.releaseDmgVariant = variant;
    const plan = await metadataPlan(f.repository, f.options.metadata, f.github, f.git, {
      ...f.options,
      platform: 'darwin',
      arch: 'arm64'
    });
    return f.sync({ plan });
  };
  await sync('compatible');
  f.downloads = [];
  const universal = await sync('universal');
  assert.equal(universal.releaseInfo.fileCount, 1);
  assert.deepEqual(f.downloads, []);
  assert.deepEqual(
    (await fs.readdir(path.join(universal.destination, universal.releaseInfo.assetDirectory))).filter(
      name => !name.startsWith('.')
    ),
    ['app-mac-universal.dmg']
  );
  const intel = await sync('x64');
  assert.equal(intel.releaseInfo.fileCount, 1);
  assert.deepEqual(f.downloads, [3]);
  assert.equal(
    await fs.readFile(path.join(intel.destination, intel.releaseInfo.assetDirectory, 'app-mac-x64.dmg'), 'utf8'),
    'intel'
  );
});

test('a repaired missing program asset can be installed again from verified backup bytes', async t => {
  const { ProgramInstaller } = require('../../app/core/program-installation.cjs');
  const f = await repository(t),
    destination = path.join(f.root, 'programs');
  await fs.mkdir(destination);
  const bytes = Buffer.alloc(128, 1);
  bytes.set([127, 69, 76, 70]);
  bytes.write('AI', 8);
  bytes[10] = 2;
  bytes.writeUInt16LE(62, 18);
  f.options.metadata.releases = true;
  f.source.installation = { enabled: true, destination, pattern: '*.AppImage', keepAllReleaseFiles: true };
  f.releases = [{ tag_name: 'v1', assets: [f.asset(1, 'app-linux-x64.AppImage', bytes)] }];
  const first = await f.sync();
  await fs.unlink(path.join(first.destination, first.releaseInfo.assetDirectory, 'app-linux-x64.AppImage'));
  const repaired = await f.sync();
  assert.equal(repaired.status, 'repaired');
  const installed = await new ProgramInstaller({ platform: 'linux', arch: 'x64' }).install({
    source: f.source,
    record: repaired,
    git: f.git
  });
  assert.equal(installed.status, 'installed');
  assert.deepEqual(await fs.readFile(installed.executable), bytes);
});
