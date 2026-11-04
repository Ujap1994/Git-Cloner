const fs = require('node:fs/promises');
const path = require('node:path');

async function normalize(directory) {
  await fs.chmod(directory, 0o755);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const info = await fs.lstat(file);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) await normalize(file);
    else if (info.isFile()) await fs.chmod(file, info.mode & 0o111 ? 0o755 : 0o644);
  }
}

async function afterPack(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  await fs.mkdir(path.join(resources, 'licenses'), { recursive: true });
  await fs.copyFile(path.join(context.packager.projectDir, 'LICENSE'), path.join(resources, 'licenses', 'LICENSE.git-cloner.txt'));
  // Independent of the developer's umask and the Electron archive extractor.
  if (context.electronPlatformName !== 'win32') await normalize(context.appOutDir);
}

module.exports = afterPack;
module.exports.normalize = normalize;
