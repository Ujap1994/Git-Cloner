const { randomUUID, createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { createTwoFilesPatch } = require('diff');
const { managed } = require('./backup.cjs');
const { parseSource } = require('./config.cjs');
const MAX_TEXT = 256 * 1024;
function localTree(output) {
  return output.split('\0').filter(Boolean).map(line => {
    const match = line.match(/^(\d+) (blob|commit) ([a-f\d]{40,64})\s+([\d-]+)\t([\s\S]+)$/);
    if (!match) throw new Error('Die gespeicherte Git-Dateiliste ist ungültig.');
    return { path: match[5], mode: match[1], type: match[2], sha: match[3], size: match[4] === '-' ? null : Number(match[4]) };
  });
}
function compareTrees(before, after) {
  const old = new Map(before.map(e => [e.path,e])), fresh = new Map(after.filter(e => e.type !== 'tree').map(e => [e.path,e]));
  const files = [];
  for (const name of new Set([...old.keys(),...fresh.keys()])) {
    const a = old.get(name), b = fresh.get(name);
    if (a?.sha === b?.sha && a?.mode === b?.mode) continue;
    files.push({ path: name, status: !a ? 'added' : !b ? 'deleted' : a.type !== b.type || (a.mode === '120000') !== (b.mode === '120000') ? 'type-changed' : 'modified', before: a ?? null, after: b ?? null });
  }
  return files.sort((a,b) => a.path.localeCompare(b.path));
}
function checkedBlob(buffer, expected) {
  if (buffer.length > MAX_TEXT || buffer.length !== expected.size) throw new Error('Die Datei ist für diese Vorschau zu groß oder wurde verändert.');
  const hash = createHash(expected.sha.length === 64 ? 'sha256' : 'sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
  if (hash !== expected.sha) throw new Error('Die Git-Prüfsumme der Vorschau stimmt nicht.');
  if (buffer.includes(0)) return null;
  try { return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer); } catch (_error) { return null; }
}
class ChangesPreview {
  constructor({ browser, ttl = 5 * 60000 } = {}) { this.browser = browser; this.ttl = ttl; this.readers = new Set(); }
  async open(options) {
    if (this.current || this.opening) throw new Error('Bitte zuerst die bestehende Änderungsvorschau schließen.');
    const controller = new AbortController(), promise = this.prepare({...options,controller}); this.opening = {controller,promise};
    try { return await promise; } finally { this.opening = null; }
  }
  async prepare({ record, git, github, passphrase, controller }) {
    const signal = controller.signal;
    const fullName = parseSource(record.fullName,'repository');
    let source = record.destination, marker = await managed(source,fullName), browserId;
    try {
      if (marker.encrypted) { const opened = await this.browser.open({record,passphrase}); browserId = opened.id; const session = this.browser.session(browserId); source = session.source; marker = session.marker; session.expiresAt = Infinity; }
      signal.throwIfAborted();
      const oldHead = marker.commit, newHead = await git.remoteHead(`https://github.com/${fullName}.git`,{signal,timeout:30000});
      if (!newHead) throw new Error('Das GitHub-Repository enthält noch keinen Commit.');
      let files = [];
      if (oldHead !== newHead) {
        const before = localTree(await git.run(['-C',source,'ls-tree','-r','-l','-z',oldHead],{signal,timeout:30000,rawOutput:true,maxBuffer:16 * 1048576}));
        const commit = await github.request(`/repos/${fullName}/git/commits/${newHead}`,{signal});
        if (!/^[a-f\d]{40,64}$/.test(commit.tree?.sha ?? '')) throw new Error('GitHub hat keine gültige Dateiliste geliefert.');
        const tree = await github.request(`/repos/${fullName}/git/trees/${commit.tree.sha}?recursive=1`,{signal});
        if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Die GitHub-Dateiliste ist für eine vollständige Vorschau zu groß. Die Sicherung kann weiterhin ausgeführt werden.');
        files = compareTrees(before,tree.tree);
      }
      signal.throwIfAborted();
      this.current = { id: randomUUID(), fullName, oldHead, newHead, files, byPath: new Map(files.map(f => [f.path,f])), source, git, github, browserId, controller, expiresAt: Date.now() + this.ttl, cache: new Map() };
      return { sessionId: this.current.id, fullName, oldHead, newHead, total: files.length, added: files.filter(f => f.status === 'added').length, deleted: files.filter(f => f.status === 'deleted').length, modified: files.filter(f => !['added','deleted'].includes(f.status)).length, checkedAt: new Date().toISOString(), expiresAt: new Date(this.current.expiresAt).toISOString() };
    } catch (error) { if (browserId) await this.browser.close(browserId); throw error; }
  }
  session(id) { const session = this.current; if (!session || session.id !== id || session.closing || session.expiresAt <= Date.now()) throw new Error('Die Änderungsvorschau ist abgelaufen. Bitte erneut öffnen.'); session.expiresAt = Date.now() + this.ttl; return session; }
  list({ sessionId, offset = 0, query = '' }) {
    const session = this.session(sessionId);
    if (!Number.isInteger(offset) || offset < 0 || typeof query !== 'string' || query.length > 200) throw new Error('Ungültige Vorschauseite.');
    const all = session.files.filter(f => f.path.toLowerCase().includes(query.toLowerCase()));
    return { total: all.length, offset, files: all.slice(offset,offset + 100).map(f => ({ path: f.path, status: f.status, size: f.after?.size ?? f.before?.size ?? 0 })) };
  }
  async file({ sessionId, path }) {
    const session = this.session(sessionId), entry = session.byPath.get(path);
    if (!entry) throw new Error('Diese Datei gehört nicht zur Änderungsvorschau.');
    if (session.cache.has(path)) return session.cache.get(path);
    const promise = this.readFile(session,entry); this.readers.add(promise);
    try { const result = await promise; if (session.cache.size < 32) session.cache.set(path,result); return result; }
    finally { this.readers.delete(promise); }
  }
  async readFile(session,entry) {
    if ([entry.before,entry.after].some(e => e && (e.type !== 'blob' || e.size == null || e.size > MAX_TEXT))) return { path: entry.path, kind: 'unavailable', message: 'Für große Dateien und Submodule wird nur die Dateiliste angezeigt.' };
    let old = '', fresh = '';
    if (entry.before) old = checkedBlob(Buffer.from(await session.git.run(['-C',session.source,'cat-file','blob',entry.before.sha],{signal:session.controller.signal,timeout:10000,rawOutput:true,encoding:'buffer',maxBuffer:MAX_TEXT + 1})),entry.before);
    if (entry.after) {
      const blob = await session.github.request(`/repos/${session.fullName}/git/blobs/${entry.after.sha}`,{signal:session.controller.signal});
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string' || blob.content.length > 2 * MAX_TEXT) throw new Error('Die GitHub-Datei kann nicht als Textvorschau geladen werden.');
      fresh = checkedBlob(Buffer.from(blob.content,'base64'),entry.after);
    }
    if (old === null || fresh === null || /^version https:\/\/git-lfs.github.com\/spec\/v1\r?\n/.test(old) || /^version https:\/\/git-lfs.github.com\/spec\/v1\r?\n/.test(fresh)) return { path: entry.path, kind: 'binary', message: 'Für Binär- und LFS-Dateien wird keine Textvorschau angezeigt.' };
    const patch = createTwoFilesPatch(`a/${entry.path}`,`b/${entry.path}`,old,fresh,'','',{context:3,timeout:150,maxEditLength:4000});
    return patch == null ? { path: entry.path, kind: 'unavailable', message: 'Zu viele Textänderungen für eine schnelle Vorschau.' } : { path: entry.path, kind: 'text', patch, modeChanged: Boolean(entry.before && entry.after && entry.before.mode !== entry.after.mode) };
  }
  async close() { if (this.opening) { this.opening.controller.abort(); await Promise.allSettled([this.opening.promise]); } const session = this.current; if (!session) return; session.closing = true; session.controller.abort(); await Promise.allSettled([...this.readers]); this.current = null; if (session.browserId) await this.browser.close(session.browserId); }
}
module.exports = { ChangesPreview, compareTrees, localTree, MAX_TEXT };
