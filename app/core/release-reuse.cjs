const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { hashFile, controlDirectory } = require('./integrity.cjs');
const { readJson, writeJson } = require('./store.cjs');
const { safeDirectory } = require('./destinations.cjs');
const { decryptArchive } = require('./archives.cjs');
const { releaseDirectoryName, RELEASE_OWNER } = require('./release-layout.cjs');
function assetIdentity(asset) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: asset.id,
        name: asset.name,
        size: asset.size ?? null,
        digest: asset.digest ?? null,
        updated: asset.updated_at ?? null,
        url: asset.browser_download_url ?? asset.direct_asset_url ?? asset.url ?? null
      })
    )
    .digest('hex');
}
function stableReleaseData(value) {
  if (Array.isArray(value)) return value.map(stableReleaseData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['download_count', 'downloads_count'].includes(key))
      .map(([key, item]) => [key, stableReleaseData(item)])
  );
}
class ReleaseReuse {
  static async open(record, passphrase) {
    const reuse = new ReleaseReuse();
    if (!record || !releaseDirectoryName(record.releaseInfo?.assetDirectory)) return reuse;
    try {
      let source = record.destination;
      if (record.encrypted) {
        if ((await hashFile(path.join(source, 'backup.gcb'))) !== record.archiveHash) return reuse;
        reuse.temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-release-reuse-'));
        await fs.chmod(reuse.temporary, 0o700);
        source = path.join(reuse.temporary, 'payload');
        await decryptArchive(path.join(record.destination, 'backup.gcb'), source, passphrase);
      }
      const manifestFile = path.join(controlDirectory(source, record.mode), 'git-cloner-manifest.json');
      if (!record.manifestHash || (await hashFile(manifestFile)) !== record.manifestHash) return reuse;
      const manifest = await readJson(manifestFile, null);
      const directory = await safeDirectory(source, [record.releaseInfo.assetDirectory]),
        ownerFile = path.join(directory, RELEASE_OWNER);
      const entry = manifest.entries.find(e => e.path === record.releaseInfo.assetDirectory + '/' + RELEASE_OWNER);
      if (!entry?.sha256 || (await hashFile(ownerFile)) !== entry.sha256) return reuse;
      const owner = await readJson(ownerFile, null);
      if (
        owner?.format !== 'git-cloner-release-files' ||
        owner.repository !== record.fullName ||
        !Array.isArray(owner.files)
      )
        return reuse;
      reuse.directory = directory;
      reuse.files = owner.files;
      reuse.manifest = manifest.entries;
      reuse.folder = record.releaseInfo.assetDirectory;
    } catch (_error) {
      /* Invalid or locked old files are downloaded again. */
    }
    return reuse;
  }
  async copy(asset, target) {
    if (!this.directory) return false;
    const expected = /^sha256:[a-f\d]{64}$/i.test(asset.digest ?? '') ? asset.digest.slice(7).toLowerCase() : null;
    for (const previous of this.files) {
      if (
        typeof previous.storedName !== 'string' ||
        path.basename(previous.storedName) !== previous.storedName ||
        /[\\/\0]/.test(previous.storedName)
      )
        continue;
      if (!expected && (previous.identity !== assetIdentity(asset) || previous.id !== asset.id)) continue;
      const entry = this.manifest.find(e => e.path === this.folder + '/' + previous.storedName);
      if (
        !entry?.sha256 ||
        (expected && entry.sha256 !== expected) ||
        (asset.size != null && entry.size !== asset.size)
      )
        continue;
      const file = path.join(this.directory, previous.storedName),
        stat = await fs.lstat(file).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) continue;
      await fs.copyFile(file, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      if ((await hashFile(target)) !== entry.sha256) {
        await fs.rm(target);
        continue;
      }
      return true;
    }
    return false;
  }
  async close() {
    if (this.temporary) await fs.rm(this.temporary, { recursive: true, force: true });
  }
}
async function finishReleaseFolder(folder, assets) {
  if (!folder) return;
  const owner = await readJson(path.join(folder.target, RELEASE_OWNER));
  for (const file of owner.files) {
    const asset = assets.find(a => a.id === file.id);
    file.identity = assetIdentity(asset);
  }
  await writeJson(path.join(folder.target, RELEASE_OWNER), owner);
}
module.exports = { ReleaseReuse, stableReleaseData, assetIdentity, finishReleaseFolder };
