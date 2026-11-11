const fs = require('./physical-fs.cjs').promises;
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { assetType } = require('./release-assets.cjs');
const { extractZip, validateTree } = require('./program-archives.cjs');
const shortHash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
const label = file => path.basename(file).replace(/\.(app|exe|AppImage)$/i, '');
const XML = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const plistStrings = (xml, key) =>
  [...String(xml).matchAll(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, 'g'))].map(match =>
    match[1].replace(/&(lt|gt|quot|apos|amp);/g, (_value, name) => XML[name])
  );
function toolMessage(error, file = '') {
  const line =
    String(error?.stderr || error?.message || '')
      .split('\n')
      .map(value => value.trim())
      .find(Boolean) ?? '';
  return (file ? line.split(file + ': ').join('') : line).slice(0, 300);
}
// DMG tools often store Finder layout data (com.apple.FinderInfo) on every file of the image. It is not signed content and
// Gatekeeper accepts it, but codesign's "sideband" rule rejects it. A mounted image is read-only, so apps are checked there
// with every other strict rule; the installed copy is cleaned and then has to pass all strict rules.
const SIDEBAND = ['com.apple.FinderInfo', 'com.apple.ResourceFork'];
async function verifySignature(run, file, { sideband = true } = {}) {
  try {
    await run('/usr/bin/codesign', ['--verify', '--deep', sideband ? '--strict' : '--strict=symlinks', file], {
      timeout: 120000,
      maxBuffer: 1048576
    });
  } catch (error) {
    throw new Error(
      `Die Signaturprüfung von ${path.basename(file)} ist fehlgeschlagen${toolMessage(error, file) ? ` (${toolMessage(error, file)})` : ''}. Unsignierte oder veränderte Programme werden nicht automatisch installiert.`
    );
  }
}
// -s keeps the walk inside the bundle; other attributes such as signatures of non-Mach-O helpers stay untouched.
async function removeSideband(run, file) {
  for (const name of SIDEBAND)
    await run('/usr/bin/xattr', ['-r', '-s', '-d', name, file], { timeout: 120000, maxBuffer: 1048576 });
}
// Mount points come from hdiutil itself: an image that is already open in Finder is read where it is and left mounted.
async function attachImage(file, temporary, run) {
  const mounts = path.join(temporary, 'mount');
  await fs.mkdir(mounts);
  const attach = image =>
    run(
      '/usr/bin/hdiutil',
      ['attach', '-plist', '-readonly', '-nobrowse', '-noautoopen', '-verify', '-mountrandom', mounts, image],
      { timeout: 300000, maxBuffer: 4 * 1048576 }
    );
  let output;
  try {
    output = await attach(file);
  } catch (error) {
    // Images with a license agreement wait for an interactive answer; a converted read-only copy opens without the prompt.
    try {
      const converted = path.join(temporary, 'converted');
      await run('/usr/bin/hdiutil', ['convert', '-quiet', '-format', 'UDTO', '-o', converted, file], {
        timeout: 900000,
        maxBuffer: 1048576
      });
      output = await attach(converted + '.cdr');
    } catch (_converted) {
      throw new Error(`Das DMG konnte nicht geöffnet werden${toolMessage(error) ? `: ${toolMessage(error)}` : ''}.`);
    }
  }
  const roots = [...new Set(plistStrings(output?.stdout, 'mount-point'))],
    prefixes = [path.resolve(mounts) + path.sep, (await fs.realpath(mounts)) + path.sep];
  return { roots, owned: roots.filter(root => prefixes.some(prefix => root.startsWith(prefix))) };
}

async function candidatesIn(root, platform) {
  const candidates = [];
  let visited = 0;
  async function walk(directory, depth) {
    if (depth > 12) return;
    for (const name of (await fs.readdir(directory)).sort()) {
      if (++visited > 200000) throw new Error('Das Programmarchiv enthält zu viele Dateien.');
      if (name.startsWith('.') || name === '__MACOSX') continue;
      const file = path.join(directory, name),
        stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) continue;
      if (
        (platform === 'darwin' && stat.isDirectory() && /\.app$/i.test(name)) ||
        (platform === 'win32' &&
          stat.isFile() &&
          /\.exe$/i.test(name) &&
          !/unins|setup|install|crashpad|helper/i.test(name))
      ) {
        if (candidates.length >= 100)
          throw new Error('Mehr als 100 Programme im Archiv. Bitte eine kleinere Release-Datei auswählen.');
        candidates.push({ key: path.relative(root, file).split(path.sep).join('/'), name: label(name), file });
      } else if (stat.isDirectory()) await walk(file, depth + 1);
    }
  }
  await walk(root, 0);
  return candidates;
}

async function validateBinary(file, platform, arch) {
  const bytes = Buffer.alloc(64),
    handle = await fs.open(file, 'r');
  try {
    await handle.read(bytes);
  } finally {
    await handle.close();
  }
  if (platform === 'linux') {
    if (!bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || bytes.toString('ascii', 8, 10) !== 'AI')
      throw new Error('Die Release-Datei besitzt kein passendes Programmformat.');
    if (bytes.readUInt16LE(18) !== { x64: 62, arm64: 183, ia32: 3, armv7l: 40 }[arch] || ![1, 2].includes(bytes[10]))
      throw new Error('Das AppImage passt nicht zur Prozessorarchitektur.');
  } else {
    const offset = bytes.readUInt32LE(60),
      header = Buffer.alloc(6),
      stat = await fs.stat(file);
    if (bytes.toString('ascii', 0, 2) !== 'MZ' || offset > stat.size - 6)
      throw new Error('Ungültiger Windows-Programmkopf.');
    const input = await fs.open(file, 'r');
    try {
      await input.read(header, 0, 6, offset);
    } finally {
      await input.close();
    }
    if (
      !header.subarray(0, 4).equals(Buffer.from([80, 69, 0, 0])) ||
      header.readUInt16LE(4) !== { x64: 0x8664, arm64: 0xaa64, ia32: 0x14c }[arch]
    )
      throw new Error('Das Windows-Programm passt nicht zur Prozessorarchitektur.');
  }
}
async function validateCandidate(candidate, { platform, arch, run }) {
  if (platform !== 'darwin') return validateBinary(candidate.file, platform, arch);
  await validateTree(candidate.file);
  await verifySignature(run, candidate.file, { sideband: false });
  const { stdout } = await run(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleExecutable', path.join(candidate.file, 'Contents', 'Info.plist')],
    { timeout: 10000 }
  );
  const name = stdout.trim();
  if (!name || path.basename(name) !== name || /[\\/\0]/.test(name))
    throw new Error('Ungültiges macOS-Programmbundle.');
  const binary = path.join(candidate.file, 'Contents', 'MacOS', name),
    stat = await fs.lstat(binary);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Das macOS-Programm enthält keine gültige ausführbare Datei.');
  const { stdout: architectures } = await run('/usr/bin/lipo', ['-archs', binary], { timeout: 10000 }),
    accepted = arch === 'x64' ? ['x86_64'] : arch === 'arm64' ? ['arm64', 'x86_64'] : [arch];
  if (
    !architectures
      .trim()
      .split(/\s+/)
      .some(value => accepted.includes(value))
  )
    throw new Error('Das macOS-Programm passt nicht zur Prozessorarchitektur.');
}
async function withContent(asset, options, callback) {
  const { platform, run } = options,
    type = assetType(asset.name);
  if (platform === 'linux' || (platform === 'win32' && type === 'exe'))
    return callback({
      direct: true,
      candidates: [
        {
          file: asset.file,
          key: platform === 'linux' ? 'application.AppImage' : 'application.exe',
          name: label(asset.name)
        }
      ]
    });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-program-'));
  await fs.chmod(temporary, 0o700);
  let image;
  try {
    if (platform === 'darwin' && type === 'dmg') {
      image = await attachImage(asset.file, temporary, run);
      if (!image.roots.length) throw new Error('Das DMG enthält kein lesbares Laufwerk.');
      const candidates = [];
      for (const [index, root] of image.roots.entries())
        for (const item of await candidatesIn(root, platform))
          candidates.push(image.roots.length > 1 ? { ...item, key: `volume-${index + 1}/${item.key}` } : item);
      return await callback({ root: image.roots[0], candidates, direct: false });
    }
    const root = path.join(temporary, 'extracted'),
      stat = await fs.statfs(temporary);
    await extractZip(asset.file, root, {
      platform,
      maxBytes: Math.min(20 * 1024 ** 3, Math.max(0, Number(stat.bavail) * Number(stat.bsize) - 64 * 1048576))
    });
    return await callback({ root, candidates: await candidatesIn(root, platform), direct: false });
  } finally {
    for (const root of image?.owned ?? [])
      await run('/usr/bin/hdiutil', ['detach', '-force', root], { timeout: 60000 }).catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
async function inspectPrograms(asset, options) {
  return withContent(asset, options, async ({ candidates }) => {
    if (!candidates.length) throw new Error('Kein unterstütztes Programm im Archiv gefunden.');
    const result = [];
    for (const candidate of candidates) {
      try {
        await validateCandidate(candidate, options);
        result.push({ key: candidate.key, name: candidate.name, available: true });
      } catch (error) {
        result.push({ key: candidate.key, name: candidate.name, available: false, message: error.message });
      }
    }
    return result;
  });
}
async function preparePrograms(asset, output, keys, options) {
  return withContent(asset, options, async ({ root, candidates, direct }) => {
    const selected = keys.length
      ? keys.map(key => candidates.find(item => item.key === key))
      : candidates.length === 1
        ? candidates
        : [];
    if (!selected.length || selected.some(item => !item))
      throw new Error(
        'Die Programmauswahl passt nicht zum Release. Bitte die Programme aus der Sicherung erneut auswählen.'
      );
    for (const candidate of selected) await validateCandidate(candidate, options);
    if (direct) {
      const item = selected[0];
      await fs.copyFile(item.file, path.join(output, item.key), fs.constants.COPYFILE_EXCL);
      await fs.chmod(path.join(output, item.key), 0o755);
      return [{ key: item.key, name: item.name, executable: item.key }];
    }
    if (options.platform === 'darwin') {
      const result = [];
      for (const item of selected) {
        const basename = path.basename(item.file),
          duplicate = selected.some(
            other => other !== item && path.basename(other.file).toLowerCase() === basename.toLowerCase()
          );
        const folder = duplicate ? 'app-' + shortHash(item.key) : '',
          parent = path.join(output, folder);
        if (folder) await fs.mkdir(parent);
        const executable = path.join(folder, basename),
          copy = path.join(output, executable);
        await fs.cp(item.file, copy, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
        await removeSideband(options.run, copy);
        await verifySignature(options.run, copy);
        result.push({ key: item.key, name: item.name, executable });
      }
      return result;
    }
    const parents = [...new Set(selected.map(item => path.dirname(item.file)))].filter(
      parent =>
        !selected.some(
          item => path.dirname(item.file) !== parent && parent.startsWith(path.dirname(item.file) + path.sep)
        )
    );
    const folders = new Map();
    for (const parent of parents) {
      await validateTree(parent);
      const name = parents.length === 1 ? 'program' : 'program-' + shortHash(path.relative(root, parent));
      folders.set(parent, name);
      await fs.cp(parent, path.join(output, name), {
        recursive: true,
        verbatimSymlinks: true,
        errorOnExist: true,
        force: false
      });
    }
    return selected.map(item => {
      const parent = parents.find(parent => item.file.startsWith(parent + path.sep));
      return {
        key: item.key,
        name: item.name,
        executable: path.join(folders.get(parent), path.relative(parent, item.file))
      };
    });
  });
}
module.exports = { preparePrograms, inspectPrograms, attachImage, verifySignature };
