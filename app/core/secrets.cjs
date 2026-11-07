const fs = require('node:fs/promises');
const path = require('node:path');

class TokenStore {
  constructor(directory, safeStorage) {
    this.file = path.join(directory, 'github-token.enc');
    this.safeStorage = safeStorage;
  }
  available() {
    return this.safeStorage.isEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  }
  async load() {
    let buffer;
    try {
      buffer = await fs.readFile(this.file);
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
    if (!this.available())
      throw new Error(
        'Der sichere Schlüsselspeicher ist nicht verfügbar. GitHub-Token kann nicht entschlüsselt werden.'
      );
    return this.safeStorage.decryptString(buffer);
  }
  async save(token) {
    if (typeof token !== 'string' || token.length > 500 || /[\r\n\0]/.test(token))
      throw new Error('Ungültiges GitHub-Token.');
    if (!token.trim()) {
      await fs.rm(this.file, { force: true });
      return '';
    }
    if (!this.available())
      throw new Error(
        'Kein sicherer Schlüsselspeicher verfügbar. Unter Linux bitte einen Secret-Service/Keyring aktivieren.'
      );
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, this.safeStorage.encryptString(token.trim()), { mode: 0o600 });
    return token.trim();
  }
}

module.exports = { TokenStore };
