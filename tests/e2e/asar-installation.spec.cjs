const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createPackage } = require('@electron/asar');
const { launch } = require('./helpers.cjs');
const { defaults } = require('../../app/core/config.cjs');
const run = promisify(execFile);

for (const extension of ['zip', 'dmg'])
  test(`Electron installs signed app.asar bundles byte-for-byte from ${extension}`, async () => {
    test.skip(process.platform !== 'darwin', 'Uses native macOS signing and disk images.');
    test.setTimeout(180000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-asar-install-')),
      image = path.join(root, 'image'),
      bundle = path.join(image, 'Example.app'),
      contents = path.join(bundle, 'Contents');
    let a;
    try {
      await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
      const resources = path.join(contents, 'Resources'),
        source = path.join(root, 'asar-source');
      await fs.mkdir(resources);
      await fs.mkdir(source);
      await fs.writeFile(path.join(source, 'main.js'), 'module.exports = "fixture";');
      const asar = path.join(resources, 'app.asar');
      await createPackage(source, asar);
      await fs.mkdir(asar + '.unpacked');
      await fs.writeFile(path.join(asar + '.unpacked', 'native.node'), 'companion bytes');
      const code = path.join(root, 'fixture.c');
      await fs.writeFile(code, 'int main(void) { return 0; }');
      await run('/usr/bin/clang', [
        '-arch',
        process.arch === 'arm64' ? 'arm64' : 'x86_64',
        code,
        '-o',
        path.join(contents, 'MacOS', 'Example')
      ]);
      await fs.writeFile(
        path.join(contents, 'Info.plist'),
        '<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.example.asar-fixture</string><key>CFBundleExecutable</key><string>Example</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>'
      );
      await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]);
      const file = path.join(root, 'example-macos-universal.' + extension),
        output = path.join(root, 'installed');
      await fs.mkdir(output);
      if (extension === 'zip') await run('/usr/bin/ditto', ['-c', '-k', image, file]);
      else
        await run(
          '/usr/bin/hdiutil',
          ['create', '-quiet', '-fs', 'HFS+', '-srcfolder', image, '-volname', 'ASAR fixture', file],
          { timeout: 60000 }
        );
      const config = defaults();
      config.checkUpdates = false;
      a = await launch({ config });
      const installed = await a.application.evaluate(
        async ({ app }, input) => {
          const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
          const { ProgramInstaller } = load('./app/core/program-installation.cjs');
          return new ProgramInstaller().prepare({ name: input.name, file: input.file }, input.output);
        },
        { name: path.basename(file), file, output }
      );
      expect(installed).toBe('Example.app');
      const copied = path.join(output, installed, 'Contents', 'Resources', 'app.asar');
      expect((await fs.lstat(copied)).isFile()).toBe(true);
      expect(await fs.readFile(copied)).toEqual(await fs.readFile(asar));
      expect(await fs.readFile(path.join(copied + '.unpacked', 'native.node'), 'utf8')).toBe('companion bytes');
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(output, installed)]);
    } finally {
      await a?.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
