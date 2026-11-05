const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { readJson, writeJson } = require('./store.cjs');
const LIMIT = 2000, statuses = ['downloaded', 'reused', 'resumed', 'cached', 'error', 'cleaned'];
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
function event(input) {
  if (!statuses.includes(input.status)) throw new Error('Ungültiger Download-Verlaufseintrag.');
  const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : null;
  return { id: randomUUID(), at: new Date().toISOString(), status: input.status, fullName: text(input.fullName, 250), name: input.encrypted ? null : text(input.name, 500), tag: text(input.tag, 120), encrypted: Boolean(input.encrypted), networkBytes: integer(input.networkBytes), reusedBytes: integer(input.reusedBytes), resumedBytes: integer(input.resumedBytes), freedBytes: integer(input.freedBytes), durationMs: integer(input.durationMs) };
}
class DownloadHistory {
  constructor(file) { this.file = file; this.pending = Promise.resolve(); this.buffer = []; this.lastFlush = 0; }
  async read() {
    let stat; try { stat = await fs.lstat(this.file); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1048576) throw new Error('Der Download-Verlauf ist beschädigt.');
    const data = await readJson(this.file);
    if (data.format !== 'git-cloner-download-history' || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > LIMIT) throw new Error('Ungültiger Download-Verlauf.');
    return data.entries;
  }
  append(entries) {
    this.buffer.push(...entries.map(event)); if (this.buffer.length > LIMIT) this.buffer.splice(0, this.buffer.length - LIMIT);
    return Date.now() - this.lastFlush >= 10000 ? this.flush() : this.pending;
  }
  flush() {
    if (!this.buffer.length) return this.pending;
    const values = this.buffer.splice(0); this.lastFlush = Date.now();
    const task = this.pending.catch(() => {}).then(async () => { const prior = await this.read(); await writeJson(this.file, { format: 'git-cloner-download-history', version: 1, entries: [...[...values].reverse(), ...prior].slice(0, LIMIT) }); }).catch(error => { this.buffer = [...values, ...this.buffer].slice(-LIMIT); throw error; });
    this.pending = task; return task;
  }
  async query({ search = '', status = 'all', period = 'all', offset = 0 } = {}) {
    if (typeof search !== 'string' || search.length > 200 || !['all', ...statuses].includes(status) || !['all', '7d', '30d'].includes(period) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Ungültiger Download-Verlaufsfilter.');
    await this.pending.catch(() => {}); await this.flush(); const all = await this.read(), cutoff = period === 'all' ? 0 : Date.now() - (period === '7d' ? 7 : 30) * 86400000, query = search.toLowerCase();
    const rows = all.filter(item => Date.parse(item.at) >= cutoff && (status === 'all' || item.status === status) && (!query || [item.fullName, item.name, item.tag].filter(Boolean).join(' ').toLowerCase().includes(query)));
    const totals = rows.reduce((sum, item) => { for (const key of Object.keys(sum)) sum[key] += integer(item[key]); return sum; }, { networkBytes: 0, reusedBytes: 0, resumedBytes: 0, freedBytes: 0, durationMs: 0 });
    return { entries: rows.slice(offset, offset + 50), total: rows.length, retained: all.length, limit: LIMIT, offset, totals };
  }
}
module.exports = { DownloadHistory, LIMIT };
