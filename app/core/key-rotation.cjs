const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { managed, MARKER } = require('./backup.cjs');
const { hashFile, verifyDirectory } = require('./integrity.cjs');
const { encryptArchive, decryptArchive, password } = require('./archives.cjs');
const { writeJson } = require('./store.cjs');
const { checkSpace } = require('./destinations.cjs');
async function fileHash(file) {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsicherer Archivpfad.');
    return await hashFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function rotationFiles(record) {
  const pending = record.rekeyPending;
  if (
    !pending ||
    !/^[a-f\d-]{36}$/.test(pending.id) ||
    [pending.oldMarker, pending.newMarker].some(
      m => m?.fullName !== record.fullName || !m.encrypted || !/^[a-f\d]{64}$/.test(m.archiveHash ?? '')
    )
  )
    throw new Error('Ungültiger Passwortwechsel-Zustand.');
  return {
    pending,
    archive: path.join(record.destination, 'backup.gcb'),
    fresh: path.join(record.destination, `.git-cloner-rekey-${pending.id}.gcb`),
    old: path.join(record.destination, `.git-cloner-old-${pending.id}.gcb`),
    marker: path.join(record.destination, MARKER)
  };
}
async function finishRotation(record, vault) {
  await managed(record.destination, record.fullName);
  const { pending, archive, fresh, old, marker } = rotationFiles(record),
    before = pending.oldMarker.archiveHash,
    after = pending.newMarker.archiveHash;
  let current = await fileHash(archive),
    next = await fileHash(fresh),
    previous = await fileHash(old),
    selected;
  if (current === after) selected = pending.newMarker;
  else if (next === after && (current === before || (current === null && previous === before))) {
    if (current === before) {
      if (previous !== null) throw new Error('Ein fremdes temporäres Archiv blockiert den Passwortwechsel.');
      await fs.rename(archive, old);
      previous = before;
    }
    await fs.rename(fresh, archive);
    current = after;
    next = null;
    selected = pending.newMarker;
  } else if (current === before) selected = pending.oldMarker;
  else if (current === null && previous === before) {
    await fs.rename(old, archive);
    previous = null;
    selected = pending.oldMarker;
  } else throw new Error('Der Passwortwechsel benötigt eine manuelle Prüfung. Es wird kein Archiv überschrieben.');
  await writeJson(marker, selected);
  if (previous !== null) {
    if (previous !== before) throw new Error('Ein fremdes temporäres Archiv bleibt erhalten.');
    await fs.rm(old);
  }
  if (next !== null) {
    if (next !== after) throw new Error('Ein fremdes temporäres Archiv bleibt erhalten.');
    await fs.rm(fresh);
  }
  Object.assign(record, {
    archiveHash: selected.archiveHash,
    encryptionKeyId: selected.encryptionKeyId,
    encrypted: true,
    verificationStatus: 'ok'
  });
  delete record.rekeyPending;
  if (selected.encryptionKeyId) vault.archiveBindings[record.id] = selected.encryptionKeyId;
  return selected === pending.newMarker ? 'rotated' : 'rolled-back';
}
async function recoverRotations(state, vault, save) {
  for (const record of Object.values(state.repositories ?? {}))
    if (record.rekeyPending) {
      try {
        await finishRotation(record, vault);
        await vault.persistKeyState();
        await save(state);
      } catch (error) {
        if (
          ['ENOENT', 'ENODEV', 'ENXIO', 'EIO', 'ENOTCONN', 'ESTALE', 'EACCES', 'EPERM'].includes(error.code) ||
          /Ziellaufwerk|nicht erreichbar/.test(error.message)
        )
          continue;
        throw error;
      }
    }
}
async function rotationInventory(records, vault, { offset = 0, query = '' } = {}) {
  if (!Number.isInteger(offset) || offset < 0 || typeof query !== 'string' || query.length > 200)
    throw new Error('Ungültige Archivseite.');
  const all = Object.values(records)
    .filter(
      record =>
        record.encrypted && `${record.fullName} ${record.destination}`.toLowerCase().includes(query.toLowerCase())
    )
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const items = [];
  for (const record of all.slice(offset, offset + 100)) {
    if (!record.encrypted) continue;
    let available = false,
      message = null,
      keyId = record.encryptionKeyId || vault.archiveBindings[record.id];
    try {
      const marker = await managed(record.destination, record.fullName);
      if (!marker.encrypted) throw new Error('Sicherungsformat wurde verändert.');
      const info = await fs.lstat(path.join(record.destination, 'backup.gcb'));
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsicherer Archivpfad.');
      available = true;
      keyId = marker.encryptionKeyId || keyId;
    } catch (error) {
      message = error.code === 'ENOENT' ? 'Laufwerk oder Archiv nicht erreichbar.' : error.message;
    }
    items.push({
      id: record.id,
      fullName: record.fullName,
      destination: record.destination,
      available,
      pending: Boolean(record.rekeyPending),
      current: Boolean(keyId && keyId === vault.encryptionKeyId),
      keyId: keyId ?? null,
      message
    });
  }
  return {
    items,
    total: all.length,
    offset,
    limit: 100,
    needsChange: all.filter(r => (r.encryptionKeyId || vault.archiveBindings[r.id]) !== vault.encryptionKeyId).length,
    remembered: vault.rememberPassword
  };
}
async function unlockPayload(record, vault, oldPassword, git) {
  const marker = await managed(record.destination, record.fullName),
    archive = path.join(record.destination, 'backup.gcb');
  if ((await hashFile(archive)) !== marker.archiveHash)
    throw new Error('Die verschlüsselte Sicherung wurde verändert oder beschädigt.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'git-cloner-rekey-'));
  await fs.chmod(temporary, 0o700);
  const payload = path.join(temporary, 'payload');
  try {
    await checkSpace(temporary, Math.max(marker.bytes ?? 0, (await fs.stat(archive)).size) * 2, 64);
    const direct = vault.passwordFor({ ...record, encryptionKeyId: marker.encryptionKeyId || record.encryptionKeyId }),
      candidates = [
        ...new Set([oldPassword, direct, vault.archivePassword, ...Object.values(vault.archiveKeys)].filter(Boolean))
      ];
    let used;
    for (const candidate of candidates) {
      try {
        await decryptArchive(archive, payload, candidate);
        used = candidate;
        break;
      } catch (error) {
        if (error.message !== 'Falsches Passwort oder beschädigtes Archiv.') throw error;
      }
    }
    if (!used) throw new Error('Falsches Passwort oder beschädigtes Archiv.');
    await verifyDirectory(payload, git, marker.mode);
    return { marker, temporary, payload, used };
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
async function rotatePasswords({
  state,
  vault,
  git,
  ids,
  oldPassword = '',
  newPassword,
  remember = false,
  save,
  onProgress = () => {},
  shouldStop = () => false,
  fingerprintFor = () => null
}) {
  password(newPassword);
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || new Set(ids).size !== ids.length)
    throw new Error('Bitte 1 bis 1000 Archive auswählen.');
  const records = ids.map(id => {
      const record = state.repositories[id];
      if (!record?.encrypted) throw new Error('Verschlüsselte Sicherung nicht gefunden.');
      return record;
    }),
    results = [];
  await recoverRotations(state, vault, save);
  // Authenticate one selected archive before changing the active key or saving a password.
  const witness = await unlockPayload(records[0], vault, oldPassword, git);
  let oldId =
    witness.marker.encryptionKeyId ||
    vault.archiveBindings[records[0].id] ||
    Object.keys(vault.archiveKeys).find(id => vault.archiveKeys[id] === witness.used) ||
    randomUUID();
  if (vault.archiveKeys[oldId] && vault.archiveKeys[oldId] !== witness.used) oldId = randomUUID();
  vault.archiveKeys[oldId] = witness.used;
  vault.archiveBindings[records[0].id] = oldId;
  vault.legacyKeyId ??= oldId;
  try {
    await vault.setPassword(newPassword, remember, { forceRotate: true });
  } catch (error) {
    await fs.rm(witness.temporary, { recursive: true, force: true });
    throw error;
  }
  let index = 0;
  for (const record of records) {
    if (shouldStop()) {
      if (index === 0) await fs.rm(witness.temporary, { recursive: true, force: true });
      break;
    }
    let opened = index === 0 ? witness : null,
      fresh,
      prepared = false;
    onProgress({ completed: index, total: records.length, fullName: record.fullName, status: 'rotating' });
    try {
      opened ??= await unlockPayload(record, vault, oldPassword, git);
      const { marker, payload } = opened,
        keyId = vault.encryptionKeyId;
      await checkSpace(record.destination, (await fs.stat(path.join(record.destination, 'backup.gcb'))).size, 64);
      const id = randomUUID();
      fresh = path.join(record.destination, `.git-cloner-rekey-${id}.gcb`);
      const previousKey = marker.encryptionKeyId || vault.archiveBindings[record.id] || oldId;
      const next = {
        ...marker,
        encryptionKeyId: keyId,
        fingerprint:
          fingerprintFor(record, marker, previousKey, keyId) ||
          createHash('sha256').update(`${marker.fingerprint}:${keyId}`).digest('hex'),
        rekeyedAt: new Date().toISOString()
      };
      await encryptArchive(payload, fresh, newPassword);
      next.archiveHash = await hashFile(fresh);
      record.rekeyPending = { id, oldMarker: marker, newMarker: next };
      await save(state);
      prepared = true;
      await finishRotation(record, vault);
      fresh = null;
      await vault.persistKeyState();
      await save(state);
      results.push({ id: record.id, fullName: record.fullName, status: 'rotated' });
    } catch (error) {
      results.push({ id: record.id, fullName: record.fullName, status: 'error', message: error.message });
      if (!prepared) delete record.rekeyPending;
      if (!record.rekeyPending && fresh) await fs.rm(fresh, { force: true });
    } finally {
      if (opened) await fs.rm(opened.temporary, { recursive: true, force: true });
    }
    index++;
    onProgress({ completed: index, total: records.length, status: 'rotating' });
    if (record.rekeyPending) break;
  }
  if (vault.rememberPassword) await vault.persist();
  await vault.persistKeyState();
  await save(state);
  return {
    results,
    completed: results.filter(r => r.status === 'rotated').length,
    errors: results.filter(r => r.status === 'error').length,
    remaining: Object.values(state.repositories).filter(
      r => r.encrypted && (r.encryptionKeyId || vault.archiveBindings[r.id]) !== vault.encryptionKeyId
    ).length
  };
}
module.exports = { rotationInventory, rotatePasswords, recoverRotations, finishRotation };
