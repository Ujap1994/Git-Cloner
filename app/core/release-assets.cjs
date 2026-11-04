const PLATFORM_NAMES = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
function assetPlatform(name) {
  const text = String(name ?? '').toLowerCase().replace(/\.(sha(?:256|512)?|sig|asc|checksum)$/g,'');
  const platforms = new Set();
  const token = pattern => new RegExp(`(?:^|[-_.+ ()])(?:${pattern})(?=$|[-_.+ ()])`).test(text);
  if (token('windows?(?:32|64|x64|x86|arm64)?|win(?:32|64|x64|x86|arm64)?|mingw(?:32|64)?|msvc')) platforms.add('win32');
  if (token('mac(?:os|osx)?|osx|darwin|apple')) platforms.add('darwin');
  if (token('linux(?:32|64)?|ubuntu|debian|fedora|linuxmint|archlinux|cachyos')) platforms.add('linux');
  let extension;
  if (/\.(exe|msi|msix|msixbundle|appx|appxbundle)$/.test(text)) extension = 'win32';
  else if (/\.(dmg|pkg)$/.test(text) || /\.app\.(zip|tar\.gz)$/.test(text)) extension = 'darwin';
  else if (/\.(appimage|deb|rpm|flatpak|flatpakref|snap)$/.test(text) || /\.pkg\.tar\.(zst|xz|gz)$/.test(text)) extension = 'linux';
  if (extension && platforms.size && !platforms.has(extension)) return { platforms: [], shared: false, ambiguous: true };
  if (extension) platforms.add(extension);
  const shared = !platforms.size && token('sha(?:256|512)?sums?|checksums?|license|licence|copying|readme|changelog');
  return { platforms: [...platforms], shared, ambiguous: false };
}
function selectReleaseAssets(assets, scope = 'all', platform = process.platform) {
  if (!['all','system'].includes(scope)) throw new Error('Ungültige Auswahl für Release-Dateien.');
  if (!Array.isArray(assets)) throw new Error('Ungültige Release-Dateiliste.');
  const selected = [], excluded = [];
  for (const asset of assets) {
    if (!asset || typeof asset.name !== 'string' || !asset.name || !Number.isSafeInteger(asset.id) || asset.id < 1) throw new Error('Ungültige Release-Datei.');
    const classification = assetPlatform(asset.name);
    if (scope === 'all' || classification.shared || classification.platforms.includes(platform)) selected.push(asset);
    else excluded.push({ id: asset.id, name: asset.name, reason: classification.platforms.length ? 'other-platform' : 'unknown-platform', platforms: classification.platforms });
  }
  return { selected, excluded, platform, platformName: PLATFORM_NAMES[platform] ?? platform, scope };
}
module.exports = { assetPlatform, selectReleaseAssets, PLATFORM_NAMES };
