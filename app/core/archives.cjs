const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, scrypt, createCipheriv, createDecipheriv } = require('node:crypto');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const {Writable}=require('node:stream');
const tar = require('tar');
const derive = promisify(scrypt);
const MAGIC = Buffer.from('GCLONER2');

function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 1024) throw new Error('Das Archivpasswort muss mindestens 12 Zeichen enthalten.');
}
async function keyFor(passphrase, salt) { return derive(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
async function encryptArchive(directory, file, passphrase) {
  password(passphrase);
  const salt = randomBytes(32), iv = randomBytes(12);
  const header = Buffer.from(JSON.stringify({ version: 1, cipher: 'aes-256-gcm', kdf: 'scrypt-32768-8-1', salt: salt.toString('base64'), iv: iv.toString('base64') }));
  const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
  const prefix = Buffer.concat([MAGIC, length, header]);
  const key = await keyFor(passphrase, salt);
  let owned = false;
  try {
    await fs.writeFile(file, prefix, { flag: 'wx', mode: 0o600 });
    owned = true;
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(prefix);
    await pipeline(tar.c({ gzip: { level: 1 }, cwd: directory, portable: true }, ['.']), cipher, createWriteStream(file, { flags: 'a', mode: 0o600 }));
    await fs.appendFile(file, cipher.getAuthTag());
  } catch (error) { if (owned) await fs.rm(file, { force: true }); throw error; }
  finally { key.fill(0); }
}
async function decryptArchive(file, directory, passphrase) {
  password(passphrase);
  try { await fs.lstat(directory); throw new Error('Der Entschlüsselungsordner existiert bereits.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'git-cloner-decrypt-'));
  await fs.chmod(temp, 0o700);
  let handle, key, owned = false;
  try {
    handle = await fs.open(file, 'r');
    const base = Buffer.alloc(12); await handle.read(base, 0, 12, 0);
    if (!base.subarray(0, 8).equals(MAGIC)) throw new Error('Unbekanntes Archivformat.');
    const length = base.readUInt32BE(8);
    if (length < 50 || length > 1024) throw new Error('Ungültiger Archivkopf.');
    const header = Buffer.alloc(length); await handle.read(header, 0, length, 12);
    const data = JSON.parse(header.toString());
    if (data.version !== 1 || data.cipher !== 'aes-256-gcm' || data.kdf !== 'scrypt-32768-8-1') throw new Error('Nicht unterstützte Archivverschlüsselung.');
    const salt = Buffer.from(data.salt, 'base64'), iv = Buffer.from(data.iv, 'base64');
    if (salt.length !== 32 || iv.length !== 12) throw new Error('Ungültiger Archivkopf.');
    const size = (await handle.stat()).size;
    if (size < 12 + length + 17) throw new Error('Das Archiv ist unvollständig.');
    const tag = Buffer.alloc(16); await handle.read(tag, 0, 16, size - 16);
    key = await keyFor(passphrase, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.concat([base, header])); decipher.setAuthTag(tag);
    const archive = path.join(temp, 'authenticated.tar.gz');
    try { await pipeline(createReadStream(file, { start: 12 + length, end: size - 17 }), decipher, createWriteStream(archive, { flags: 'wx', mode: 0o600 })); }
    catch (_error) { throw new Error('Falsches Passwort oder beschädigtes Archiv.'); }
    // Extract only after the GCM tag has authenticated the entire plaintext.
    await fs.mkdir(directory, { recursive: false, mode: 0o700 });
    owned = true;
    const links = [];
    await tar.x({ file: archive, cwd: directory, strict: true, preservePaths: false, filter: (name, entry) => {
      const parts = name.replaceAll('\\', '/').split('/');
      if (path.isAbsolute(name) || /^[a-z]:/i.test(name) || name.startsWith('\\') || parts.includes('..') || name.includes('\0')) throw new Error('Unsicherer Pfad im Archiv.');
      if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
        if (entry.linkpath.includes('\0')) throw new Error('Unsicherer Link im Archiv.');
        links.push({ name, target: entry.linkpath, symbolic: entry.type === 'SymbolicLink' });
        return false;
      }
      return true;
    } });
    // Materialize links only after every regular write has finished. No archive
    // entry can write through a symlink, including legitimate external Git links.
    for (const link of links.sort((a, b) => Number(a.symbolic) - Number(b.symbolic))) {
      let parent = directory;
      for (const segment of path.dirname(link.name).replaceAll('\\', '/').split('/').filter(p => p && p !== '.')) {
        parent = path.join(parent, segment);
        try { await fs.mkdir(parent); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        const info = await fs.lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsicherer Link im Archiv.');
      }
      const file = path.resolve(directory, link.name);
      if (link.symbolic) await fs.symlink(link.target, file);
      else {
        const source = path.resolve(directory, link.target);
        if (!source.startsWith(directory + path.sep) || /^[a-z]:/i.test(link.target)) throw new Error('Unsicherer Link im Archiv.');
        const info = await fs.lstat(source);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsicherer Link im Archiv.');
        await fs.link(source, file);
      }
    }
  } catch (error) { if (owned) await fs.rm(directory, { recursive: true, force: true }); throw error; }
  finally { key?.fill(0); await handle?.close(); await fs.rm(temp, { recursive: true, force: true }); }
}
async function authenticateArchive(file,passphrase){
  password(passphrase);let handle,key;
  try{
    handle=await fs.open(file,'r');const base=Buffer.alloc(12);await handle.read(base,0,12,0);if(!base.subarray(0,8).equals(MAGIC))throw new Error('Unbekanntes Archivformat.');
    const length=base.readUInt32BE(8);if(length<50||length>1024)throw new Error('Ungültiger Archivkopf.');const header=Buffer.alloc(length);await handle.read(header,0,length,12);const data=JSON.parse(header.toString()),salt=Buffer.from(data.salt??'','base64'),iv=Buffer.from(data.iv??'','base64'),size=(await handle.stat()).size;
    if(data.version!==1||data.cipher!=='aes-256-gcm'||data.kdf!=='scrypt-32768-8-1'||salt.length!==32||iv.length!==12||size<12+length+17)throw new Error('Ungültiger Archivkopf.');
    const tag=Buffer.alloc(16);await handle.read(tag,0,16,size-16);key=await keyFor(passphrase,salt);const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.concat([base,header]));decipher.setAuthTag(tag);
    try{await pipeline(createReadStream(file,{start:12+length,end:size-17}),decipher,new Writable({write(_chunk,_encoding,done){done();}}));}catch(_error){throw new Error('Falsches Passwort oder beschädigtes Archiv.');}
    return true;
  }finally{key?.fill(0);await handle?.close();}
}
module.exports = { encryptArchive, decryptArchive, password, authenticateArchive };
