const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectReleaseAssets, validateReleaseFilter } = require('../../app/core/release-assets.cjs');
const { selectProgram } = require('../../app/core/program-select.cjs');
const { defaults, validateConfig } = require('../../app/core/config.cjs');
const { metadataPlan } = require('../../app/core/metadata.cjs');
const names = [
  'app-mac-arm64.dmg',
  'app-mac-universal.dmg',
  'app-mac-x64.dmg',
  'app-mac-arm64.zip',
  'app-mac-x64.zip',
  'SHA256SUMS.txt',
  'app-mac.dmg'
];
const assets = names.map((name, i) => ({
  id: i + 1,
  name,
  size: 20 + i,
  browser_download_url: 'https://example.invalid/' + name
}));

test('explicit DMG variants exclude other DMGs, override CPU filtering and retain other format rules', () => {
  for (const [variant, expected] of [
    ['arm64', 1],
    ['universal', 2],
    ['x64', 3]
  ]) {
    const selected = selectReleaseAssets(assets, 'system', 'darwin', {
      releaseArchitecture: 'arm64',
      releaseDmgVariant: variant
    });
    assert.deepEqual(
      selected.selected.map(a => a.id),
      [expected, 4, 6]
    );
    assert.equal(selectProgram(selected.selected, 'darwin', 'arm64', '*.dmg').id, expected);
    assert.deepEqual(
      selectReleaseAssets(assets, 'system', 'linux', { releaseDmgVariant: variant }).selected.map(a => a.id),
      [6]
    );
  }
});
test('automatic DMG choice retains legacy compatibility and missing explicit variants do not fall back', () => {
  assert.deepEqual(
    selectReleaseAssets(assets, 'system', 'darwin', { releaseArchitecture: 'arm64' }).selected.map(a => a.id),
    [1, 2, 4, 6]
  );
  assert.deepEqual(
    selectReleaseAssets(
      assets.filter(a => a.id !== 2),
      'all',
      'darwin',
      { releaseDmgVariant: 'universal', releaseFileTypes: ['dmg'] }
    ).selected.map(a => a.id),
    [6]
  );
  assert.throws(() => validateReleaseFilter({ releaseDmgVariant: 'anything' }));
  assert.equal(validateConfig(defaults()).backup.releaseDmgVariant, 'compatible');
});
test('Universal2 and architecture aliases select exactly the named DMG variant', () => {
  const values = ['suite-mac-universal2.dmg', 'suite-mac-aarch64.dmg', 'suite-mac-x86_64.dmg', 'suite-mac-any.dmg'].map(
    (name, i) => ({ id: i + 1, name })
  );
  for (const [variant, id] of [
    ['universal', 1],
    ['arm64', 2],
    ['x64', 3]
  ])
    assert.deepEqual(
      selectReleaseAssets(values, 'all', 'darwin', { releaseDmgVariant: variant }).selected.map(a => a.id),
      [id]
    );
});
for (const provider of ['github', 'gitlab', 'forgejo'])
  test(`${provider} metadata planning applies the explicit DMG variant before program selection`, async () => {
    const release = { id: 20, tag_name: 'v1.0.0', assets },
      options = { ...defaults().backup.metadata, releases: true };
    const client = {
      provider,
      server: 'https://example.invalid',
      projectPath: () => '/projects/demo',
      collection: async endpoint => (endpoint.endsWith('/releases') ? [release] : assets),
      request: async () => release
    };
    const plan = await metadataPlan(
      { full_name: 'demo/app' },
      options,
      client,
      {},
      {
        platform: 'darwin',
        arch: 'arm64',
        releaseArchitecture: 'arm64',
        releaseFileTypes: ['dmg'],
        releaseDmgVariant: 'universal',
        releaseProgram: { pattern: '*.dmg' }
      }
    );
    assert.equal(plan.downloadCount, 1);
    const native = await metadataPlan(
      { full_name: 'demo/app' },
      options,
      client,
      {},
      {
        platform: 'darwin',
        arch: 'arm64',
        releaseArchitecture: 'arm64',
        releaseFileTypes: ['dmg'],
        releaseDmgVariant: 'arm64',
        releaseProgram: { pattern: '*.dmg' }
      }
    );
    assert.notEqual(plan.digest, native.digest);
    assert.equal(plan.releaseInfo.fileCount, 1);
    assert.equal(plan.estimatedBytes, 21);
    assert.equal(native.estimatedBytes, 20);
  });
