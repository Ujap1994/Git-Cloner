function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error('Anmeldung abgebrochen.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
class DeviceFlow {
  constructor({ fetchImpl = fetch, sleep = pause, now = Date.now } = {}) { Object.assign(this, { fetchImpl, sleep, now }); this.controller = null; }
  cancel() { this.controller?.abort(); }
  async login(clientId, onCode) {
    if (!/^[a-z\d._-]{1,100}$/i.test(clientId)) throw new Error('Für die Geräteanmeldung ist die Client-ID einer GitHub-OAuth-App erforderlich.');
    if (this.controller) throw new Error('Eine Anmeldung läuft bereits.');
    const controller = new AbortController(); this.controller = controller;
    const post = async (url, values) => {
      const response = await this.fetchImpl(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values), redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      if (!response.ok) throw new Error(`GitHub-Anmeldung fehlgeschlagen (HTTP ${response.status}).`);
      return response.json();
    };
    try {
      const code = await post('https://github.com/login/device/code', { client_id: clientId, scope: 'repo read:org' });
      if (!code.device_code || !code.user_code || code.verification_uri !== 'https://github.com/login/device') throw new Error('Ungültige Geräteanmeldung von GitHub.');
      let interval = Math.min(60, Math.max(5, code.interval ?? 5));
      const expiresAt = this.now() + Math.min(3600, code.expires_in ?? 900) * 1000;
      onCode({ userCode: code.user_code, verificationUri: code.verification_uri, expiresAt: new Date(expiresAt).toISOString() });
      while (this.now() < expiresAt) {
        await this.sleep(interval * 1000, controller.signal);
        const result = await post('https://github.com/login/oauth/access_token', { client_id: clientId, device_code: code.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
        if (result.access_token) return result.access_token;
        if (result.error === 'authorization_pending') continue;
        if (result.error === 'slow_down') { interval = Math.min(60, interval + 5); continue; }
        if (result.error === 'access_denied') throw new Error('Die Anmeldung wurde auf GitHub abgelehnt.');
        if (result.error === 'expired_token') break;
        throw new Error('Die GitHub-Anmeldung konnte nicht abgeschlossen werden.');
      }
      throw new Error('Der Anmeldecode ist abgelaufen.');
    } finally { this.controller = null; }
  }
}
module.exports = { DeviceFlow };
