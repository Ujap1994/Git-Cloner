const fs = require('node:fs/promises');
const path = require('node:path');
const { readJson } = require('./store.cjs');
const { hashFile, controlDirectory } = require('./integrity.cjs');
const { safeDirectory } = require('./destinations.cjs');
const { releaseDirectoryName, RELEASE_OWNER } = require('./release-layout.cjs');

// Check small metadata and file sizes on the unchanged fast path, without rehashing large DMGs.
// Full content verification keeps its configured cadence; installation still hashes the chosen asset.
async function verifyReleasePresence(directory, marker) {
  if (marker.encrypted) {
    // Individual files cannot disappear inside an authenticated archive, but the archive itself can.
    const stat = await fs.lstat(path.join(directory, 'backup.gcb'));
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size)
      throw new Error('Die Archivdatei fehlt oder ist unvollständig.');
    return;
  }
  if (!marker.releaseInfo?.fileCount || !releaseDirectoryName(marker.releaseInfo.assetDirectory)) return;
  const manifestFile = path.join(controlDirectory(directory, marker.mode), 'git-cloner-manifest.json');
  const stat = await fs.lstat(manifestFile);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !marker.manifestHash ||
    (await hashFile(manifestFile)) !== marker.manifestHash
  )
    throw new Error('Das Dateiverzeichnis der Sicherung ist beschädigt.');
  const manifest = await readJson(manifestFile),
    folder = marker.releaseInfo.assetDirectory;
  const root = await safeDirectory(directory, [folder]),
    ownerFile = path.join(root, RELEASE_OWNER);
  const ownerStat = await fs.lstat(ownerFile),
    entries = new Map(manifest.entries.map(entry => [entry.path, entry]));
  if (
    !ownerStat.isFile() ||
    ownerStat.isSymbolicLink() ||
    (await hashFile(ownerFile)) !== entries.get(folder + '/' + RELEASE_OWNER)?.sha256
  )
    throw new Error('Die Release-Dateizuordnung ist beschädigt.');
  const owner = await readJson(ownerFile);
  if (
    owner.format !== 'git-cloner-release-files' ||
    owner.repository !== marker.fullName ||
    !Array.isArray(owner.files) ||
    owner.files.length !== marker.releaseInfo.fileCount
  )
    throw new Error('Die Release-Dateizuordnung ist unvollständig.');
  for (const file of owner.files) {
    if (
      typeof file.storedName !== 'string' ||
      path.basename(file.storedName) !== file.storedName ||
      /[\\/\0]/.test(file.storedName)
    )
      throw new Error('Unsicherer Release-Dateipfad.');
    const entry = entries.get(folder + '/' + file.storedName),
      info = await fs.lstat(path.join(root, file.storedName));
    if (!entry?.sha256 || !info.isFile() || info.isSymbolicLink() || info.size !== entry.size)
      throw new Error('Eine gesicherte Release-Datei fehlt oder ist unvollständig.');
  }
}
module.exports = { verifyReleasePresence };
