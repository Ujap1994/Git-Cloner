const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { repository } = require('../helpers/repository.cjs');
const { ProgramInstaller } = require('../../app/core/program-installation.cjs');
const run = promisify(execFile);
for (const extension of ['zip', 'dmg']) test(`native macOS updates two selected signed apps and their Finder links together from ${extension}`, { skip: process.platform !== 'darwin', timeout: 180000 }, async t => {
  const f = await repository(t), content = path.join(f.root, 'suite'), programs = path.join(f.root, 'programs'), desktop = path.join(f.root, 'Desktop'); await fs.mkdir(content); await fs.mkdir(programs); await fs.mkdir(desktop);
  const code = path.join(f.root, 'fixture.c'); await fs.writeFile(code, '#include <unistd.h>\nint main(void) { sleep(30); return 0; }\n');
  for (const name of ['Writer', 'Viewer']) {
    const app = path.join(content, name + '.app'), contents = path.join(app, 'Contents'); await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await run('/usr/bin/clang', ['-arch', process.arch === 'x64' ? 'x86_64' : 'arm64', code, '-o', path.join(contents, 'MacOS', name)]);
    await fs.writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.example.${name}</string><key>CFBundleExecutable</key><string>${name}</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>`); await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  }
  const file = path.join(f.root, 'suite-macos-universal.' + extension);
  if (extension === 'zip') await run('/usr/bin/ditto', ['-c', '-k', content, file]); else await run('/usr/bin/hdiutil', ['create', '-quiet', '-fs', 'HFS+', '-srcfolder', content, '-volname', 'Suite', file], { timeout: 60000 });
  f.source.installation = { enabled: true, destination: programs, pattern: '*.' + extension, programs: ['Viewer.app', 'Writer.app'], shortcut: { enabled: true, destination: desktop } }; f.options.metadata.releases = true; f.releases = [{ tag_name: 'v1', assets: [f.asset(1, path.basename(file), await fs.readFile(file))] }];
  const installer = new ProgramInstaller(), record = await f.sync(), preview = await installer.inspect({ source: f.source, record, git: f.git }); assert.equal(preview.candidates.filter(item => item.available).length, 2);
  const installed = await installer.install({ source: f.source, record, git: f.git }); assert.equal(installed.programs.length, 2);
  const { ProgramShortcuts } = require('../../app/core/program-shortcuts.cjs'), links = new ProgramShortcuts(), shortcuts = await links.sync({ source: f.source, installation: installed }); assert.equal(shortcuts.count, 2);
  f.releases[0].tag_name = 'v2'; const next = await f.sync(), updated = await installer.install({ source: f.source, record: next, git: f.git }); assert.equal(updated.status, 'installed'); assert.equal(updated.tag, 'v2');
  await links.sync({ source: f.source, installation: updated, previous: { shortcuts } });
  for (let i = 0; i < updated.programs.length; i++) { await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', updated.programs[i].executable]); assert.equal(await fs.readlink(path.join(desktop, shortcuts.files[i])), updated.programs[i].executable); }
  f.source.installation.programs = ['Missing.app']; await assert.rejects(installer.install({ source: f.source, record: next, git: f.git }), /Programmauswahl/); for (const item of updated.programs) assert(await fs.stat(item.executable));
});
for (const extension of ['zip', 'dmg']) test(`native macOS installs a real ad-hoc signed fixture app from ${extension}`, { skip: process.platform !== 'darwin', timeout: 120000 }, async t => {
  const f = await repository(t), app = path.join(f.root, 'Example.app'), contents = path.join(app, 'Contents'); await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
  // System tools on Apple Silicon can use the private arm64e ABI. Compile the
  // fixture for the public architecture used by downloadable applications.
  const code = path.join(f.root, 'fixture.c'); await fs.writeFile(code, '#include <unistd.h>\nint main(void) { sleep(30); return 0; }\n');
  await run('/usr/bin/clang', ['-arch', process.arch === 'x64' ? 'x86_64' : 'arm64', code, '-o', path.join(contents, 'MacOS', 'Example')]);
  await fs.writeFile(path.join(contents, 'Info.plist'), '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.example.fixture</string><key>CFBundleExecutable</key><string>Example</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>');
  await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]); const file = path.join(f.root, `example-macos-universal.${extension}`);
  if (extension === 'zip') await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, file]);
  else { const image = path.join(f.root, 'image'); await fs.mkdir(image); await fs.cp(app, path.join(image, 'Example.app'), { recursive: true }); await run('/usr/bin/hdiutil', ['create', '-quiet', '-fs', 'HFS+', '-srcfolder', image, '-volname', 'Example', file], { timeout: 60000 }); }
  const output = path.join(f.root, 'installed'); await fs.mkdir(output); const name = await new ProgramInstaller().prepare({ name: path.basename(file), file }, output); assert.equal(name, 'Example.app'); await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(output, name)]); assert(await fs.stat(path.join(output, name, 'Contents', 'MacOS', 'Example')));
  if(extension==='zip'){const child=spawn(path.join(output,name,'Contents','MacOS','Example'),['30']);await once(child,'spawn');try{await assert.rejects(new ProgramInstaller().ensureNotRunning(output,{executable:name}),{code:'PROGRAM_RUNNING'});}finally{const ended=once(child,'exit');child.kill();await ended;}}
});
test('native macOS installs and keeps a signed app from a DMG whose files carry Finder layout data', { skip: process.platform !== 'darwin', timeout: 180000 }, async t => {
  const f = await repository(t), image = path.join(f.root, 'image'), app = path.join(image, 'Layout.app'), contents = path.join(app, 'Contents'), programs = path.join(f.root, 'programs'); await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true }); await fs.mkdir(programs);
  const code = path.join(f.root, 'fixture.c'); await fs.writeFile(code, '#include <unistd.h>\nint main(void) { sleep(30); return 0; }\n');
  await run('/usr/bin/clang', ['-arch', process.arch === 'x64' ? 'x86_64' : 'arm64', code, '-o', path.join(contents, 'MacOS', 'Layout')]);
  await fs.writeFile(path.join(contents, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.example.layout</string><key>CFBundleExecutable</key><string>Layout</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>');
  await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  // The bytes real DMG tools store on every file and folder: a Finder icon position of (-1, -1).
  const finderInfo = '00'.repeat(10) + 'ffffffff' + '00'.repeat(18), finder = target => run('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', finderInfo, target]);
  for (const target of [app, contents, path.join(contents, 'MacOS'), path.join(contents, 'MacOS', 'Layout'), path.join(contents, 'Info.plist')]) await finder(target);
  const file = path.join(f.root, 'layout-macos-universal.dmg'); await run('/usr/bin/hdiutil', ['create', '-quiet', '-fs', 'HFS+', '-srcfolder', image, '-volname', 'Layout', file], { timeout: 60000 });
  const { attachImage } = require('../../app/core/program-content.cjs'), mount = await fs.mkdtemp(path.join(f.root, 'mount-')), mounted = await attachImage(file, mount, run);
  try { await assert.rejects(run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(mounted.roots[0], 'Layout.app')]), /detritus/); }
  finally { for (const root of mounted.owned) await run('/usr/bin/hdiutil', ['detach', '-force', root]); }
  f.source.installation = { enabled: true, destination: programs, pattern: '*.dmg' }; f.options.metadata.releases = true; f.releases = [{ tag_name: 'v1', assets: [f.asset(1, path.basename(file), await fs.readFile(file))] }];
  const installer = new ProgramInstaller(), record = await f.sync(), preview = await installer.inspect({ source: f.source, record, git: f.git }); assert.deepEqual(preview.candidates.map(item => item.available), [true]);
  const installed = await installer.install({ source: f.source, record, git: f.git }); assert.equal(installed.status, 'installed');
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed.executable]); assert.doesNotMatch((await run('/usr/bin/xattr', ['-r', '-s', installed.executable])).stdout, /FinderInfo/);
  // A later Finder label on the installed app or a .DS_Store in its folder keeps the installation current instead of reinstalling it on every check.
  await finder(installed.executable); await fs.writeFile(path.join(installed.destination, '.DS_Store'), 'finder');
  assert.equal((await installer.install({ source: f.source, record, git: f.git })).status, 'current');
});
