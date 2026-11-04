const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJson } = require('./store.cjs');

const VOLUME_MARKER = '.git-cloner-volume.json';

async function existingRoot(destination) {
  const info = await fs.lstat(destination).catch(() => { throw new Error(`Ziellaufwerk nicht erreichbar: ${destination}`); });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Der Zielordner muss ein vorhandener Ordner sein und darf kein symbolischer Link sein.');
  await fs.access(destination, constants.W_OK);
  return fs.realpath(destination);
}

async function prepareDestination(source) {
  const root = await existingRoot(source.destination);
  const file = path.join(root, VOLUME_MARKER);
  let marker = await readJson(file, null);
  if (!marker) {
    if (source.volumeId) throw new Error('Das ausgewählte Laufwerk fehlt oder seine Kennung wurde entfernt. Zielordner bitte erneut auswählen.');
    marker = { schemaVersion: 1, id: randomUUID() };
    try { await fs.writeFile(file, `${JSON.stringify(marker)}\n`, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') marker = await readJson(file, null); else throw error; }
  }
  if (!marker || marker.schemaVersion !== 1 || !/^[a-f\d-]{36}$/.test(marker.id)) throw new Error('Ungültige Laufwerkskennung im Zielordner.');
  if (source.volumeId && source.volumeId !== marker.id) throw new Error('An diesem Pfad ist ein anderes Laufwerk angeschlossen.');
  return { ...source, volumeId: marker.id, volumeHint: await destinationHint(source.destination) };
}
async function destinationHint(destination) {
  const original = path.resolve(destination); let root = original, current = await fs.stat(root);
  for (;;) {
    const parent = path.dirname(root); if (parent === root) break;
    const info = await fs.stat(parent); if (info.dev !== current.dev) break;
    root = parent; current = info;
  }
  return { root, relative: path.relative(root,original).split(path.sep).join('/'), canonical: await fs.realpath(original) };
}

async function verifyDestination(source) {
  const root = await existingRoot(source.destination);
  const marker = await readJson(path.join(root, VOLUME_MARKER), null);
  if (!source.volumeId || marker?.id !== source.volumeId) throw new Error(`Ziellaufwerk fehlt oder wurde ausgetauscht: ${source.destination}`);
  return root;
}

async function safeDirectory(root, segments, create = false) {
  let current = root;
  for (const segment of segments) {
    if (!/^[a-z\d._-]+$/i.test(segment) || ['.', '..'].includes(segment) || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) throw new Error(`Nicht portabler Ordnername: ${segment}`);
    current = path.join(current, segment);
    let info;
    try { info = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      await fs.mkdir(current);
      info = await fs.lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsicherer Zielordner (Link oder Datei): ${current}`);
  }
  return current;
}

async function checkSpace(root, estimatedBytes = 0, reserveMB = 512) {
  const stat = await fs.statfs(root, { bigint: true });
  const available = stat.bavail * stat.bsize;
  const required = BigInt(Math.max(0, Math.ceil(estimatedBytes))) + BigInt(reserveMB) * 1024n * 1024n;
  if (available < required) throw new Error('Nicht genug freier Speicher für den neuen Stand und die eingestellte Reserve.');
  return { availableBytes: available.toString(), requiredBytes: required.toString() };
}
module.exports = { prepareDestination, verifyDestination, safeDirectory, VOLUME_MARKER, existingRoot, checkSpace, destinationHint };
