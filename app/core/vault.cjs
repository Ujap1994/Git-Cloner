const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { TokenStore } = require('./secrets.cjs');
const { password } = require('./archives.cjs');

class SecretVault {
  constructor(directory, safeStorage) {
    this.directory = directory; this.file = path.join(directory, 'secrets.enc'); this.safeStorage = safeStorage;
    this.tokens = Object.create(null); this.archivePassword = ''; this.rememberPassword = false;
    this.encryptionKeyId = randomUUID();
  }
  available() { return this.safeStorage.isEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text'; }
  async load() {
    let buffer;
    try { buffer = await fs.readFile(this.file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const legacy = await new TokenStore(this.directory, this.safeStorage).load();
      if (legacy) this.tokens.default = legacy;
      return;
    }
    if (!this.available()) throw new Error('Der sichere Schlüsselspeicher ist nicht verfügbar.');
    const data = JSON.parse(this.safeStorage.decryptString(buffer));
    if (data.schemaVersion !== 1 || !data.tokens || typeof data.tokens !== 'object') throw new Error('Unbekannter Zugangsdaten-Speicher.');
    for (const [id, token] of Object.entries(data.tokens)) {
      if (!/^[a-z\d-]{1,64}$/i.test(id) || typeof token !== 'string') throw new Error('Ungültige gespeicherte Zugangsdaten.');
      this.tokens[id] = token;
    }
    this.archivePassword = typeof data.archivePassword === 'string' ? data.archivePassword : '';
    this.rememberPassword = Boolean(this.archivePassword);
    this.encryptionKeyId = data.encryptionKeyId || randomUUID();
  }
  async persist() {
    if (!this.available()) throw new Error('Kein sicherer Schlüsselspeicher verfügbar.');
    await fs.mkdir(this.directory, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const data = { schemaVersion: 1, tokens: this.tokens, archivePassword: this.rememberPassword ? this.archivePassword : '', encryptionKeyId: this.encryptionKeyId };
      await fs.writeFile(temporary, this.safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async setToken(id, value) {
    if (!/^[a-z\d-]{1,64}$/i.test(id) || typeof value !== 'string' || value.length > 500 || /[\r\n\0]/.test(value)) throw new Error('Ungültiges GitHub-Token.');
    const previous = this.tokens[id];
    if (!value.trim() && !previous) return;
    if (value.trim()) this.tokens[id] = value.trim(); else delete this.tokens[id];
    try { await this.persist(); } catch (error) { if (previous) this.tokens[id] = previous; else delete this.tokens[id]; throw error; }
    if (id === 'default') await fs.rm(path.join(this.directory, 'github-token.enc'), { force: true });
  }
  async setPassword(value, remember) {
    password(value);
    const old = [this.archivePassword, this.rememberPassword, this.encryptionKeyId];
    this.archivePassword = value; this.rememberPassword = Boolean(remember); this.encryptionKeyId = randomUUID();
    try { if (remember || old[1]) await this.persist(); }
    catch (error) { [this.archivePassword, this.rememberPassword, this.encryptionKeyId] = old; throw error; }
  }
}
module.exports = { SecretVault };
