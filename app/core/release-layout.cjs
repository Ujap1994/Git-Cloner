const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJson } = require('./store.cjs');
const RELEASE_OWNER = '.git-cloner-release.json';
function releaseDirectoryName(value) {
  return typeof value === 'string' && /^Git-Cloner-Releases(?:-[1-9]\d{0,3})?$/.test(value);
}
async function createReleaseDirectory(directory, repository, release, assets) {
  let name;
  for (let attempt = 1; attempt <= 1000; attempt++) {
    name = attempt === 1 ? 'Git-Cloner-Releases' : `Git-Cloner-Releases-${attempt}`;
    try {
      await fs.mkdir(path.join(directory, name), { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt === 1000) throw new Error('Kein freier Ordner für Release-Dateien vorhanden.');
    }
  }
  const used = new Set(),
    files = assets.map(asset => {
      let filename = asset.name.replace(/[^a-z\d._-]/gi, '_').slice(0, 180);
      if (
        !filename ||
        filename.startsWith('.') ||
        /[. ]$/.test(filename) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename) ||
        used.has(filename.toLowerCase())
      )
        filename = `${asset.id}-${filename || 'download'}`;
      used.add(filename.toLowerCase());
      return { id: asset.id, name: asset.name, storedName: filename, size: asset.size ?? null };
    });
  const target = path.join(directory, name);
  await writeJson(path.join(target, RELEASE_OWNER), {
    format: 'git-cloner-release-files',
    version: 2,
    repository: repository.full_name,
    tag: release?.tag_name ?? null,
    files
  });
  return { name, target, files };
}
module.exports = { createReleaseDirectory, releaseDirectoryName, RELEASE_OWNER };
