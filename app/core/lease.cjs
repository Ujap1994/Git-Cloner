const fs = require('node:fs/promises');
const path = require('node:path');
const lockfile = require('proper-lockfile');

async function acquireLease(directory) {
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, 'backup'),
    lock = `${target}.lock`;
  const info = await fs.lstat(lock).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new Error('Unbekannte Sperrdatei im Benutzerprofil.');
  try {
    // Atomic mkdir with a maintained lease avoids check/remove races after crashes.
    return await lockfile.lock(target, { realpath: false, retries: 0, stale: 300000, update: 30000 });
  } catch (error) {
    if (error.code !== 'ELOCKED') throw error;
    const busy = new Error('Eine Sicherung läuft bereits in einem anderen Prozess.');
    busy.code = 'BUSY';
    throw busy;
  }
}
module.exports = { acquireLease };
