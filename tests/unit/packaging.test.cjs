const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const afterPack = require('../../scripts/after-pack.cjs');

test(
  'Unix package permissions are readable, executable where needed, and never world writable',
  { skip: process.platform === 'win32' },
  async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-pack-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const output = path.join(root, 'output');
    await fs.mkdir(output, { mode: 0o700 });
    await fs.writeFile(path.join(root, 'LICENSE'), 'License test');
    const executable = path.join(output, 'git-cloner');
    const outside = path.join(root, 'outside');
    await fs.writeFile(executable, 'executable');
    await fs.chmod(executable, 0o777);
    await fs.writeFile(outside, 'do not change', { mode: 0o600 });
    await fs.symlink(outside, path.join(output, 'external-link'));
    await afterPack({ electronPlatformName: 'linux', appOutDir: output, packager: { projectDir: root } });
    assert.equal((await fs.stat(output)).mode & 0o777, 0o755);
    assert.equal((await fs.stat(executable)).mode & 0o777, 0o755);
    const license = path.join(output, 'resources', 'licenses', 'LICENSE.git-cloner.txt');
    assert.equal((await fs.stat(license)).mode & 0o777, 0o644);
    assert.equal((await fs.stat(outside)).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(license, 'utf8'), 'License test');
  }
);
