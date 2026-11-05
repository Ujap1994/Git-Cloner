const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { assetType } = require('./release-assets.cjs');
const { extractZip, validateTree } = require('./program-archives.cjs');
const shortHash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
const label = file => path.basename(file).replace(/\.(app|exe|AppImage)$/i, '');

async function candidatesIn(root, platform) {
  const candidates = []; let visited = 0;
  async function walk(directory, depth) {
    if (depth > 12) return;
    for (const name of (await fs.readdir(directory)).sort()) {
      if (++visited > 200000) throw new Error('Das Programmarchiv enthält zu viele Dateien.');
      if (name.startsWith('.') || name === '__MACOSX') continue;
      const file = path.join(directory, name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) continue;
      if (platform === 'darwin' && stat.isDirectory() && /\.app$/i.test(name) || platform === 'win32' && stat.isFile() && /\.exe$/i.test(name) && !/unins|setup|install|crashpad|helper/i.test(name)) {
        if (candidates.length >= 100) throw new Error('Mehr als 100 Programme im Archiv. Bitte eine kleinere Release-Datei auswählen.');
        candidates.push({ key: path.relative(root, file).split(path.sep).join('/'), name: label(name), file });
      } else if (stat.isDirectory()) await walk(file, depth + 1);
    }
  }
  await walk(root, 0); return candidates;
}

async function validateBinary(file, platform, arch) {
  const bytes = Buffer.alloc(64), handle = await fs.open(file, 'r'); try { await handle.read(bytes); } finally { await handle.close(); }
  if (platform === 'linux') {
    if (!bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || bytes.toString('ascii', 8, 10) !== 'AI') throw new Error('Die Release-Datei besitzt kein passendes Programmformat.');
    if (bytes.readUInt16LE(18) !== ({ x64: 62, arm64: 183, ia32: 3, armv7l: 40 }[arch]) || ![1, 2].includes(bytes[10])) throw new Error('Das AppImage passt nicht zur Prozessorarchitektur.');
  } else {
    const offset = bytes.readUInt32LE(60), header = Buffer.alloc(6), stat = await fs.stat(file);
    if (bytes.toString('ascii', 0, 2) !== 'MZ' || offset > stat.size - 6) throw new Error('Ungültiger Windows-Programmkopf.');
    const input = await fs.open(file, 'r'); try { await input.read(header, 0, 6, offset); } finally { await input.close(); }
    if (!header.subarray(0, 4).equals(Buffer.from([80, 69, 0, 0])) || header.readUInt16LE(4) !== ({ x64: 0x8664, arm64: 0xaa64, ia32: 0x14c }[arch])) throw new Error('Das Windows-Programm passt nicht zur Prozessorarchitektur.');
  }
}
async function validateCandidate(candidate, { platform, arch, run }) {
  if (platform !== 'darwin') return validateBinary(candidate.file, platform, arch);
  await validateTree(candidate.file);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate.file], { timeout: 120000, maxBuffer: 1048576 });
  const { stdout } = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(candidate.file, 'Contents', 'Info.plist')], { timeout: 10000 });
  const name = stdout.trim(); if (!name || path.basename(name) !== name || /[\\/\0]/.test(name)) throw new Error('Ungültiges macOS-Programmbundle.');
  const binary = path.join(candidate.file, 'Contents', 'MacOS', name), stat = await fs.lstat(binary);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Das macOS-Programm enthält keine gültige ausführbare Datei.');
  const { stdout: architectures } = await run('/usr/bin/lipo', ['-archs', binary], { timeout: 10000 });
  if (!architectures.trim().split(/\s+/).includes(arch === 'x64' ? 'x86_64' : arch)) throw new Error('Das macOS-Programm passt nicht zur Prozessorarchitektur.');
}
async function withContent(asset, options, callback) {
  const { platform, run } = options, type = assetType(asset.name);
  if (platform === 'linux' || platform === 'win32' && type === 'exe') return callback({ direct: true, candidates: [{ file: asset.file, key: platform === 'linux' ? 'application.AppImage' : 'application.exe', name: label(asset.name) }] });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-program-')); await fs.chmod(temporary, 0o700); let mounted;
  try {
    let root;
    if (platform === 'darwin' && type === 'dmg') {
      mounted = path.join(temporary, 'mount'); await fs.mkdir(mounted);
      await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-verify', '-mountpoint', mounted, asset.file], { timeout: 300000, maxBuffer: 1048576 }); root = mounted;
    } else {
      root = path.join(temporary, 'extracted'); const stat = await fs.statfs(temporary);
      await extractZip(asset.file, root, { platform, maxBytes: Math.min(20 * 1024 ** 3, Math.max(0, Number(stat.bavail) * Number(stat.bsize) - 64 * 1048576)) });
    }
    return await callback({ root, candidates: await candidatesIn(root, platform), direct: false });
  } finally { if (mounted) await run('/usr/bin/hdiutil', ['detach', '-force', mounted], { timeout: 60000 }).catch(() => {}); await fs.rm(temporary, { recursive: true, force: true }); }
}
async function inspectPrograms(asset, options) {
  return withContent(asset, options, async ({ candidates }) => {
    if (!candidates.length) throw new Error('Kein unterstütztes Programm im Archiv gefunden.');
    const result = [];
    for (const candidate of candidates) {
      try { await validateCandidate(candidate, options); result.push({ key: candidate.key, name: candidate.name, available: true }); }
      catch (error) { result.push({ key: candidate.key, name: candidate.name, available: false, message: error.message }); }
    }
    return result;
  });
}
async function preparePrograms(asset, output, keys, options) {
  return withContent(asset, options, async ({ root, candidates, direct }) => {
    const selected = keys.length ? keys.map(key => candidates.find(item => item.key === key)) : candidates.length === 1 ? candidates : [];
    if (!selected.length || selected.some(item => !item)) throw new Error('Die Programmauswahl passt nicht zum Release. Bitte die Programme aus der Sicherung erneut auswählen.');
    for (const candidate of selected) await validateCandidate(candidate, options);
    if (direct) { const item = selected[0]; await fs.copyFile(item.file, path.join(output, item.key), fs.constants.COPYFILE_EXCL); await fs.chmod(path.join(output, item.key), 0o755); return [{ key: item.key, name: item.name, executable: item.key }]; }
    if (options.platform === 'darwin') {
      const result = [];
      for (const item of selected) {
        const basename = path.basename(item.file), duplicate = selected.some(other => other !== item && path.basename(other.file).toLowerCase() === basename.toLowerCase());
        const folder = duplicate ? 'app-' + shortHash(item.key) : '', parent = path.join(output, folder); if (folder) await fs.mkdir(parent);
        const executable = path.join(folder, basename); await fs.cp(item.file, path.join(output, executable), { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
        await options.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(output, executable)], { timeout: 120000, maxBuffer: 1048576 }); result.push({ key: item.key, name: item.name, executable });
      }
      return result;
    }
    const parents = [...new Set(selected.map(item => path.dirname(item.file)))].filter(parent => !selected.some(item => path.dirname(item.file) !== parent && parent.startsWith(path.dirname(item.file) + path.sep)));
    const folders = new Map();
    for (const parent of parents) { await validateTree(parent); const name = parents.length === 1 ? 'program' : 'program-' + shortHash(path.relative(root, parent)); folders.set(parent, name); await fs.cp(parent, path.join(output, name), { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false }); }
    return selected.map(item => { const parent = parents.find(parent => item.file.startsWith(parent + path.sep)); return { key: item.key, name: item.name, executable: path.join(folders.get(parent), path.relative(parent, item.file)) }; });
  });
}
module.exports = { preparePrograms, inspectPrograms };
