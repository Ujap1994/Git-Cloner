const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { existingRoot, checkSpace } = require('./destinations.cjs');
const { managed, verifyBackup } = require('./backup.cjs');
const { verifyDirectory } = require('./integrity.cjs');
const { decryptArchive } = require('./archives.cjs');
const { readJson } = require('./store.cjs');

async function restoreBackup({ record, archive, parent, name, passphrase, git }) {
  if (
    typeof name !== 'string' ||
    !/^[a-z\d._ -]{1,100}$/i.test(name) ||
    ['.', '..'].includes(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error('Bitte einen gültigen neuen Ordnernamen eingeben.');
  const root = await existingRoot(parent),
    target = path.join(root, name);
  try {
    await fs.lstat(target);
    throw new Error('Der Zielordner existiert bereits. Es werden keine Dateien überschrieben.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const staging = path.join(root, `.git-cloner-restore-${randomUUID()}`);
  let temporary;
  try {
    let source, mode;
    if (record) {
      const marker = await managed(record.destination, record.fullName);
      mode = marker.mode;
      if (marker.encrypted) archive = path.join(record.destination, 'backup.gcb');
      else {
        await verifyBackup(record, git);
        source = record.destination;
      }
    }
    if (archive) {
      const info = await fs.lstat(archive);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Das Archiv muss eine reguläre Datei sein.');
      await checkSpace(root, info.size * 3, 64);
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'git-cloner-restore-'));
      source = path.join(temporary, 'payload');
      await decryptArchive(archive, source, passphrase);
      const gitInfo = await fs.lstat(path.join(source, '.git')).catch(() => null);
      if (gitInfo?.isSymbolicLink()) throw new Error('Unsicherer Git-Ordner im Archiv.');
      const marker = await readJson(
        path.join(gitInfo?.isDirectory() ? path.join(source, '.git') : source, 'git-cloner.json'),
        null
      );
      if (!marker?.fullName) throw new Error('Das Archiv enthält keine Git-Cloner-Sicherung.');
      await managed(source, marker.fullName);
      mode = marker.mode ?? 'snapshot';
      await verifyDirectory(source, git, mode);
    }
    if (!source) throw new Error('Bitte eine Sicherung oder ein Archiv auswählen.');
    await fs.cp(source, staging, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
    const verification = await verifyDirectory(staging, git, mode);
    // No overwrite even if a destination appeared while the restore was running.
    try {
      await fs.lstat(target);
      throw new Error('Der Zielordner wurde inzwischen angelegt.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.rename(staging, target);
    return { destination: target, mode, ...verification };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
}
module.exports = { restoreBackup };
