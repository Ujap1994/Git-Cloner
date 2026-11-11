const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { GitHubClient } = require('../app/core/github.cjs');
const { Git } = require('../app/core/git.cjs');
const { defaults } = require('../app/core/config.cjs');
const { prepareDestination } = require('../app/core/destinations.cjs');
const { syncRepository } = require('../app/core/backup.cjs');
const { ProgramShortcuts } = require('../app/core/program-shortcuts.cjs');
const { ProgramInstaller } = require('../app/core/program-installation.cjs');
const { hashFile } = require('../app/core/integrity.cjs');
const run = promisify(execFile);
async function main() {
  if (process.platform !== 'darwin') throw new Error('This live installation check requires macOS.');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-release-dmg-install-'));
  try {
    const backup = path.join(root, 'backup'),
      programs = path.join(root, 'programs'),
      desktop = path.join(root, 'Desktop');
    await fs.mkdir(backup);
    await fs.mkdir(programs);
    await fs.mkdir(desktop);
    const client = new GitHubClient({ token: process.env.GITHUB_TOKEN || '' }),
      repository = await client.repository('Ujap1994/Git-Cloner');
    const release = await client.request('/repos/Ujap1994/Git-Cloner/releases/tags/v3.6.1');
    const asset = release.assets.find(item => item.name === 'Git-Cloner-3.6.1-mac-universal.dmg');
    assert(asset);
    const expected = '1921f23ab244aae09355dc3b8764eb9f886fda5234ac3b3f680abe8905b67b82';
    // The project's own published DMG is pinned, so this check never silently trusts a newly replaced binary.
    assert.equal(asset.digest, 'sha256:' + expected);
    const file = path.join(root, asset.name);
    await client.downloadAsset(repository.full_name, asset.id, file, {
      expectedSize: asset.size,
      expectedDigest: asset.digest,
      expectedName: asset.name
    });
    assert.equal(await hashFile(file), expected);
    const git = new Git(),
      source = await prepareDestination({
        id: 'live',
        kind: 'repository',
        value: repository.full_name,
        destination: backup,
        enabled: true
      });
    source.installation = {
      enabled: true,
      destination: programs,
      pattern: '*.dmg',
      shortcut: { enabled: true, destination: desktop }
    };
    const options = {
      ...defaults().backup,
      metadata: { ...defaults().backup.metadata, releases: true },
      releaseScope: 'system',
      releaseArchitecture: 'system',
      releaseFileTypes: ['dmg']
    };
    // Keep the real source clone, storage layout and installer; bind this test to the pinned release.
    const pinned = Object.create(client);
    pinned.collection = async endpoint =>
      endpoint.endsWith('/releases') ? [release] : endpoint.includes('/assets') ? [asset] : client.collection(endpoint);
    pinned.request = async (endpoint, input) =>
      endpoint.endsWith('/releases/latest') ? release : client.request(endpoint, input);
    pinned.downloadAsset = async (_name, _id, target) => fs.copyFile(file, target, fs.constants.COPYFILE_EXCL);
    const record = await syncRepository({ source, repository, github: pinned, git, options });
    const installed = await new ProgramInstaller().install({ source, record, git });
    assert.equal(installed.status, 'installed');
    assert.equal(installed.tag, 'v3.6.1');
    const app = (await fs.readdir(installed.destination)).find(name => name.endsWith('.app'));
    assert(app);
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(installed.destination, app)]);
    const shortcuts = await new ProgramShortcuts().sync({ source, installation: installed });
    assert.equal(shortcuts.count, 1);
    assert.equal(await fs.readlink(path.join(desktop, shortcuts.files[0])), installed.executable);
    assert.equal((await new ProgramInstaller().install({ source, record, git })).status, 'current');
    console.log(
      'Published Git Cloner v3.6.1: pinned macOS DMG downloaded, SHA256 verified, real source cloned, signed app installed into isolated managed folder with Finder shortcut and repeated installation skipped. No app launch.'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
if (require.main === module)
  main().catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
module.exports = { main };
