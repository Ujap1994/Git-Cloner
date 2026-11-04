const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');

class TransferBudget {
  constructor({ bytesPerSecond = 0, sleep = delay, now = () => performance.now(), onBytes = () => {} } = {}) {
    Object.assign(this, { bytesPerSecond, sleep, now, onBytes }); this.nextAt = 0; this.bytes = 0; this.tail = Promise.resolve(); this.abort = new AbortController();
  }
  async consume(length) {
    const work = this.tail.catch(() => {}).then(async () => {
      this.abort.signal.throwIfAborted();
      if (this.bytesPerSecond) {
        this.nextAt = Math.max(this.now(), this.nextAt) + length * 1000 / this.bytesPerSecond;
        await this.sleep(Math.max(0, this.nextAt - this.now()), undefined, { signal: this.abort.signal });
      }
      this.bytes += length; this.onBytes(this.bytes);
    });
    this.tail = work; return work;
  }
  stream() {
    const budget = this;
    return new Transform({ transform(chunk, _encoding, callback) {
      const stream = this;
      void (async () => {
        const size = budget.bytesPerSecond ? Math.max(1, Math.min(16384, Math.floor(budget.bytesPerSecond / 8))) : chunk.length;
        for (let offset = 0; offset < chunk.length; offset += size) {
          const part = chunk.subarray(offset, offset + size); await budget.consume(part.length); stream.push(part);
        }
      })().then(() => callback(), callback);
    } });
  }
  close() { this.abort.abort(); }
}
function bypassProxy(host, value = '') {
  return value.split(',').some(rule => { rule = rule.trim().split(':')[0].toLowerCase().replace(/^\./,''); return rule === '*' || rule && (host === rule || host.endsWith('.' + rule)); });
}
async function createTransport({ bandwidthKBps = 0, upstream = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.all_proxy || process.env.ALL_PROXY || '', noProxy = process.env.no_proxy || process.env.NO_PROXY || '', onBytes, budget = new TransferBudget({ bytesPerSecond: bandwidthKBps * 1024, onBytes }) } = {}) {
  const sockets = new Set();
  const server = http.createServer((_request, response) => { response.writeHead(405); response.end(); });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  server.on('connect', (request, client, head) => {
    void (async () => {
      const target = new URL(`https://${request.url}`);
      if (target.username || target.password || target.pathname !== '/' || target.search || target.hash || !target.hostname) throw new Error('Invalid tunnel');
      let remote;
      if (upstream && !bypassProxy(target.hostname, noProxy)) {
        const proxy = new URL(upstream);
        if (!['http:','https:'].includes(proxy.protocol)) throw new Error('Unsupported upstream proxy');
        remote = await new Promise((resolve, reject) => {
          const connector = (proxy.protocol === 'https:' ? https : http).request({ hostname: proxy.hostname, port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80), method: 'CONNECT', path: request.url, timeout: 30000, headers: { Host: request.url, ...(proxy.username ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` } : {}) } });
          connector.once('connect', (response, socket, extra) => { if (response.statusCode !== 200) { socket.destroy(); reject(new Error('Proxy refused')); } else { socket.setTimeout(0); if (extra.length) socket.unshift(extra); resolve(socket); } });
          connector.once('error', reject); connector.once('timeout', () => connector.destroy(new Error('Proxy timeout'))); connector.end();
        });
      } else remote = await new Promise((resolve, reject) => {
        const socket = net.connect({ host: target.hostname.replace(/^\[|\]$/g,''), port: Number(target.port || 443) });
        socket.setTimeout(30000, () => socket.destroy(new Error('Tunnel timeout')));
        socket.once('connect', () => { socket.setTimeout(0); resolve(socket); }); socket.once('error', reject);
      });
      sockets.add(remote); remote.on('close', () => sockets.delete(remote)); remote.on('error', () => {});
      if (client.destroyed) { remote.destroy(); return; }
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      void pipeline(client, remote).catch(() => {});
      void pipeline(remote, budget.stream(), client).catch(() => {});
    })().catch(() => { if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0,'127.0.0.1',resolve); });
  return { proxy: `http://127.0.0.1:${server.address().port}`, budget, get bytes() { return budget.bytes; }, close: async () => { budget.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { TransferBudget, createTransport, bypassProxy };
