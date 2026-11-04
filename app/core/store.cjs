const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw new Error(`Datei kann nicht gelesen werden: ${file}. ${error.message}`);
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

module.exports = { readJson, writeJson };
