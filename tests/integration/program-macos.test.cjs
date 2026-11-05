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
for (const extension of ['zip', 'dmg']) test(`native macOS installs a real ad-hoc signed fixture app from ${extension}`, { skip: process.platform !== 'darwin', timeout: 120000 }, async t => {
  const f = await repository(t), app = path.join(f.root, 'Example.app'), contents = path.join(app, 'Contents'); await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
  await fs.copyFile('/bin/sleep', path.join(contents, 'MacOS', 'Example')); await fs.chmod(path.join(contents, 'MacOS', 'Example'), 0o755); await fs.writeFile(path.join(contents, 'Info.plist'), '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.example.fixture</string><key>CFBundleExecutable</key><string>Example</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>');
  await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]); const file = path.join(f.root, `example-macos-universal.${extension}`);
  if (extension === 'zip') await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, file]);
  else { const image = path.join(f.root, 'image'); await fs.mkdir(image); await fs.cp(app, path.join(image, 'Example.app'), { recursive: true }); await run('/usr/bin/hdiutil', ['create', '-quiet', '-fs', 'HFS+', '-srcfolder', image, '-volname', 'Example', file], { timeout: 60000 }); }
  const output = path.join(f.root, 'installed'); await fs.mkdir(output); const name = await new ProgramInstaller().prepare({ name: path.basename(file), file }, output); assert.equal(name, 'Example.app'); await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(output, name)]); assert(await fs.stat(path.join(output, name, 'Contents', 'MacOS', 'Example')));
  if(extension==='zip'){const child=spawn(path.join(output,name,'Contents','MacOS','Example'),['30']);await once(child,'spawn');try{await assert.rejects(new ProgramInstaller().ensureNotRunning(output,{executable:name}),{code:'PROGRAM_RUNNING'});}finally{const ended=once(child,'exit');child.kill();await ended;}}
});
