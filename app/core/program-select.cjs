const { wildcard } = require('./filters.cjs');
const { assetPlatform, assetArchitecture, assetType } = require('./release-assets.cjs');
// Apple Silicon runs Intel-only Mac programs through Rosetta; they are only chosen when no native package exists.
const rosetta = (platform, arch) => platform === 'darwin' && arch === 'arm64';
function native(name, arch) {
  const architectures = assetArchitecture(name);
  return !architectures.length || architectures.includes(arch);
}
function selectProgram(files, platform = process.platform, arch = process.arch, pattern = '') {
  const allowed =
    platform === 'darwin'
      ? ['dmg', 'zip']
      : platform === 'win32'
        ? ['exe', 'zip']
        : platform === 'linux'
          ? ['appimage']
          : [];
  const candidates = files.filter(
    file =>
      !/\.(sha(?:256|512)?|sig|asc|checksum)$/i.test(file.name) &&
      (!pattern || wildcard(pattern, file.name)) &&
      assetPlatform(file.name).platforms.includes(platform) &&
      (native(file.name, arch) || (rosetta(platform, arch) && assetArchitecture(file.name).includes('x64'))) &&
      allowed.includes(assetType(file.name)) &&
      (platform !== 'win32' || assetType(file.name) === 'zip' || /portable/i.test(file.name))
  );
  const score = file =>
    (native(file.name, arch) ? 0 : 100) +
    allowed.indexOf(assetType(file.name)) * 10 +
    (assetArchitecture(file.name).length === 1 ? 0 : assetArchitecture(file.name).length ? 1 : 2);
  candidates.sort((a, b) => score(a) - score(b));
  if (!candidates.length)
    throw new Error(
      'Kein installierbares Programm für dieses System gefunden. Unterstützt: macOS DMG/App-ZIP, Windows Portable-EXE/ZIP, Linux AppImage.'
    );
  // Releases often publish one file twice, versioned and under a stable "latest" name. Files with the same SHA-256 are one program.
  const best = candidates.filter(file => score(file) === score(candidates[0])),
    digest = sha256(best[0]);
  if (best.length > 1 && (!digest || best.some(file => sha256(file) !== digest)))
    throw new Error('Mehrere Programme passen. Bitte den Release-Dateinamen in der Quelle genauer eingrenzen.');
  return best.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0];
}
function sha256(file) {
  const match = /^(?:sha256:)?([a-f\d]{64})$/i.exec(typeof file.digest === 'string' ? file.digest : '');
  return match ? match[1].toLowerCase() : null;
}
// With automatic installation, only the file that will actually be installed is kept; unclear selections keep the filtered files.
function programRelease(source) {
  return source?.installation?.enabled && !source.installation.keepAllReleaseFiles
    ? { pattern: source.installation.pattern || '' }
    : null;
}
function narrowToProgram(selection, program, platform = process.platform, arch = process.arch) {
  if (!program || selection.selected.length < 2) return selection;
  let chosen;
  try {
    chosen = selectProgram(selection.selected, platform, arch, program.pattern);
  } catch (_error) {
    return selection;
  }
  return {
    ...selection,
    selected: [chosen],
    excluded: [
      ...selection.excluded,
      ...selection.selected
        .filter(asset => asset !== chosen)
        .map(asset => ({ id: asset.id, name: asset.name, reason: 'not-program' }))
    ]
  };
}
module.exports = { selectProgram, programRelease, narrowToProgram };
