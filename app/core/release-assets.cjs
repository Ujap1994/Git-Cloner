const PLATFORM_NAMES = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
function assetPlatform(name) {
  const text = String(name ?? '')
    .toLowerCase()
    .replace(/\.(sha(?:256|512)?|sig|asc|checksum)$/g, '');
  const platforms = new Set();
  const token = pattern => new RegExp(`(?:^|[-_.+ ()])(?:${pattern})(?=$|[-_.+ ()])`).test(text);
  if (token('windows?(?:32|64|x64|x86|arm64)?|win(?:32|64|x64|x86|arm64)?|mingw(?:32|64)?|msvc'))
    platforms.add('win32');
  if (token('mac(?:os|osx)?|osx|darwin|apple')) platforms.add('darwin');
  if (token('linux(?:32|64)?|ubuntu|debian|fedora|linuxmint|archlinux|cachyos')) platforms.add('linux');
  let extension;
  if (/\.(exe|msi|msix|msixbundle|appx|appxbundle)$/.test(text)) extension = 'win32';
  else if (/\.(dmg|pkg)$/.test(text) || /\.app\.(zip|tar\.gz)$/.test(text)) extension = 'darwin';
  else if (/\.(appimage|deb|rpm|flatpak|flatpakref|snap)$/.test(text) || /\.pkg\.tar\.(zst|xz|gz)$/.test(text))
    extension = 'linux';
  if (extension && platforms.size && !platforms.has(extension))
    return { platforms: [], shared: false, ambiguous: true };
  if (extension) platforms.add(extension);
  const shared = !platforms.size && token('sha(?:256|512)?sums?|checksums?|license|licence|copying|readme|changelog');
  return { platforms: [...platforms], shared, ambiguous: false };
}
function selectReleaseAssets(assets, scope = 'all', platform = process.platform) {
  if (!['all', 'system'].includes(scope)) throw new Error('Ungültige Auswahl für Release-Dateien.');
  if (!Array.isArray(assets)) throw new Error('Ungültige Release-Dateiliste.');
  const selected = [],
    excluded = [];
  for (const asset of assets) {
    if (!asset || typeof asset.name !== 'string' || !asset.name || !Number.isSafeInteger(asset.id) || asset.id < 1)
      throw new Error('Ungültige Release-Datei.');
    const classification = assetPlatform(asset.name);
    if (scope === 'all' || classification.shared || classification.platforms.includes(platform)) selected.push(asset);
    else
      excluded.push({
        id: asset.id,
        name: asset.name,
        reason: classification.platforms.length ? 'other-platform' : 'unknown-platform',
        platforms: classification.platforms
      });
  }
  return { selected, excluded, platform, platformName: PLATFORM_NAMES[platform] ?? platform, scope };
}
module.exports = { assetPlatform, selectReleaseAssets, PLATFORM_NAMES };

const ARCHITECTURES = ['all', 'system', 'arm64', 'x64', 'ia32', 'armv7l'];
const FILE_TYPES = [
  'dmg',
  'pkg',
  'zip',
  'exe',
  'msi',
  'appimage',
  'deb',
  'rpm',
  'flatpak',
  'tar.gz',
  'tar.xz',
  'tar.zst',
  'pacman',
  'other'
];
function assetArchitecture(name) {
  const text = String(name).toLowerCase(),
    token = pattern => new RegExp(`(?:^|[-_.+ ()])(?:${pattern})(?=$|[-_.+ ()])`).test(text),
    architectures = [];
  if (token('arm64|aarch64')) architectures.push('arm64');
  if (token('x64|x86_64|amd64|x86-64')) architectures.push('x64');
  if (token('ia32|i[3-6]86|x86|win32') && !token('x86_64|x86-64')) architectures.push('ia32');
  if (token('armv7l?|armhf|arm32')) architectures.push('armv7l');
  if (token('universal2?|all|noarch|any')) return ['arm64', 'x64', 'ia32', 'armv7l'];
  return architectures;
}
function assetType(name) {
  const text = String(name)
    .toLowerCase()
    .replace(/\.(sha(?:256|512)?|sig|asc|checksum)$/g, '');
  if (/\.pkg\.tar\.(?:zst|xz|gz)$/.test(text)) return 'pacman';
  for (const type of FILE_TYPES) if (text.endsWith('.' + type)) return type;
  return 'other';
}
function validateReleaseFilter(input = {}) {
  const releaseArchitecture = input.releaseArchitecture ?? 'all',
    releaseFileTypes = input.releaseFileTypes ?? [];
  if (
    !ARCHITECTURES.includes(releaseArchitecture) ||
    !Array.isArray(releaseFileTypes) ||
    releaseFileTypes.length > FILE_TYPES.length ||
    releaseFileTypes.some(type => !FILE_TYPES.includes(type)) ||
    new Set(releaseFileTypes).size !== releaseFileTypes.length
  )
    throw new Error('Ungültiger Architektur- oder Dateitypfilter.');
  return { releaseArchitecture, releaseFileTypes: [...releaseFileTypes].sort() };
}
const selectLegacy = selectReleaseAssets;
function selectFilteredAssets(assets, scope = 'all', platform = process.platform, filters = {}) {
  const filter = validateReleaseFilter(filters),
    architecture =
      filter.releaseArchitecture === 'system' ? (filters.arch ?? process.arch) : filter.releaseArchitecture;
  const result = selectLegacy(assets, scope, platform),
    selected = [],
    excluded = [...result.excluded];
  for (const asset of result.selected) {
    const classification = assetPlatform(asset.name),
      architectures = assetArchitecture(asset.name),
      type = assetType(asset.name);
    let reason;
    if (!classification.shared && architecture !== 'all' && !architectures.includes(architecture))
      reason = architectures.length ? 'other-architecture' : 'unknown-architecture';
    if (!reason && !classification.shared && filter.releaseFileTypes.length && !filter.releaseFileTypes.includes(type))
      reason = 'other-file-type';
    if (reason) excluded.push({ id: asset.id, name: asset.name, reason, architectures, type });
    else selected.push(asset);
  }
  return { ...result, selected, excluded, ...filter, architecture };
}
Object.assign(module.exports, {
  selectReleaseAssets: selectFilteredAssets,
  assetArchitecture,
  assetType,
  ARCHITECTURES,
  FILE_TYPES,
  validateReleaseFilter
});
