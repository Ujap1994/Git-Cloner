const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function controlDirectory(directory, mode = 'snapshot') {
  return mode === 'mirror' ? directory : path.join(directory, '.git');
}
async function manifestEntries(directory, mode) {
  const entries = [];
  const control = controlDirectory(directory, mode);
  const excluded = new Set([path.join(control, 'git-cloner.json'), path.join(control, 'git-cloner-manifest.json')]);
  async function walk(parent) {
    const names = (await fs.readdir(parent)).sort();
    for (const name of names) {
      const file = path.join(parent, name);
      if (excluded.has(file)) continue;
      const info = await fs.lstat(file);
      const relative = path.relative(directory, file).split(path.sep).join('/');
      if (info.isSymbolicLink()) entries.push({ path: relative, link: await fs.readlink(file) });
      else if (info.isDirectory()) await walk(file);
      else if (info.isFile()) entries.push({ path: relative, size: info.size, sha256: await hashFile(file) });
      else throw new Error('Nicht unterstützter Dateityp in der Sicherung.');
    }
  }
  await walk(directory);
  return entries;
}
async function writeManifest(directory, mode = 'snapshot') {
  const { writeJson } = require('./store.cjs');
  const entries = await manifestEntries(directory, mode);
  const file = path.join(controlDirectory(directory, mode), 'git-cloner-manifest.json');
  await writeJson(file, { schemaVersion: 1, mode, entries });
  return {
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + (entry.size || 0), 0),
    manifestHash: await hashFile(file),
    verifiedAt: new Date().toISOString()
  };
}
async function verifyDirectory(directory, git, mode = 'snapshot') {
  const { readJson } = require('./store.cjs');
  await git.fsck(directory);
  const manifest = await readJson(path.join(controlDirectory(directory, mode), 'git-cloner-manifest.json'), null);
  if (!manifest) return { legacy: true, files: 0, verifiedAt: new Date().toISOString() };
  const actual = await manifestEntries(directory, mode);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.entries))
    throw new Error('Die Integritätsprüfung hat fehlende oder veränderte Dateien erkannt.');
  return {
    files: actual.length,
    bytes: actual.reduce((sum, entry) => sum + (entry.size || 0), 0),
    verifiedAt: new Date().toISOString()
  };
}
function verificationDue(option, verifiedAt, now = Date.now()) {
  return (
    option === 'always' ||
    (option === 'weekly' && (!verifiedAt || now - new Date(verifiedAt).getTime() >= 7 * 86400000))
  );
}
module.exports = { hashFile, writeManifest, verifyDirectory, verificationDue, controlDirectory };
