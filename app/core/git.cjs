const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const runFile = promisify(execFile);

class Git {
  constructor({ token = '', exec = runFile, proxy = '', server = 'https://github.com', username = 'x-access-token' } = {}) { Object.assign(this, { token, exec, proxy, server, username }); }
  withTransport(proxy) { const scoped = Object.create(this); scoped.proxy = proxy; return scoped; }
  async run(args, options = {}) {
    const { rawOutput = false, ...executionOptions } = options;
    // The token never appears in argv, the saved remote URL, or a log.
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1', GIT_CONFIG_NOSYSTEM: '1' };
    const config = ['-c', 'core.hooksPath=', '-c', 'credential.interactive=false'];
    if (this.proxy) { config.push('-c', `http.proxy=${this.proxy}`); env.NO_PROXY = ''; env.no_proxy = ''; }
    if (this.token) {
      env.GIT_CONFIG_COUNT = '1';
      env.GIT_CONFIG_KEY_0 = `http.${this.server}/.extraheader`;
      env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`${this.username}:${this.token}`).toString('base64')}`;
      config.push('-c', 'credential.helper=');
    }
    try {
      const result = await this.exec('git', [...config, ...args], { timeout: 15 * 60 * 1000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, ...executionOptions, env });
      return rawOutput ? result.stdout : result.stdout.trim();
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Git ist nicht installiert oder nicht im PATH. Bitte Git installieren und die App neu starten.');
      // Avoid exposing credentials or remote-controlled messages in error output.
      const failure = new Error(error.killed ? 'Git-Vorgang hat das Zeitlimit überschritten.' : 'Git-Vorgang fehlgeschlagen. Netzwerk, freien Speicher und Zugriffsrechte prüfen.');
      if(/No space left|disk full|not enough space|ENOSPC/i.test(error.stderr||'')){failure.code='ENOSPC';failure.helpCode='space';failure.diskPath=args.includes('-C')?args[args.indexOf('-C')+1]:args.includes('clone')?args.at(-1):null;}
      else if(/authentication failed|access denied|HTTP 40[13]|returned error: 40[13]|could not read Username/i.test(error.stderr||''))failure.helpCode='authentication';
      else if(/Permission denied|read.only file system/i.test(error.stderr||''))failure.helpCode='permissions';
      failure.retryable = Boolean(error.killed || /could not resolve|couldn.t connect|failed to connect|connection.*(?:reset|timed out)|operation timed out|recv failure|send failure|remote end hung|HTTP (?:429|5\d\d)|returned error: (?:429|5\d\d)|TLS.*terminated|network is unreachable/i.test(error.stderr || ''));
      throw failure;
    }
  }
  version() { return this.run(['--version'], { timeout: 5000 }); }
  async remoteHead(url, options = {}) {
    const output = await this.run(['ls-remote', '--', url, 'HEAD'],options);
    if (!output) return null;
    const head = output.split(/\s/)[0];
    if (!/^[a-f\d]{40,64}$/.test(head)) throw new Error('Das Repository hat noch keinen Standardbranch.');
    return head;
  }
  clone(url, destination) { return this.run(['clone', '--depth=1', '--single-branch', '--no-tags', '--no-recurse-submodules', '--', url, destination]); }
  head(directory) { return this.run(['-C', directory, 'rev-parse', '--verify', 'HEAD']); }
  async revision(url, mirror = false) {
    if (!mirror) return this.remoteHead(url);
    const refs = await this.run(['ls-remote', '--', url]);
    return refs ? createHash('sha256').update(refs.split('\n').sort().join('\n')).digest('hex') : null;
  }
  cloneMirror(url, directory) { return this.run(['clone', '--mirror', '--', url, directory]); }
  async updateMirror(directory, url, defaultBranch) {
    await this.run(['-C', directory, 'remote', 'set-url', 'origin', url]);
    await this.run(['-C', directory, 'fetch', '--prune', '--force', 'origin', '+refs/*:refs/*']);
    if (defaultBranch) {
      await this.run(['check-ref-format', `refs/heads/${defaultBranch}`]);
      await this.run(['-C', directory, 'symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
    }
  }
  fsck(directory) { return this.run(['-C', directory, 'fsck', '--full', '--no-reflogs']); }
  async lfs(directory, mirror = false) {
    try { await this.run(['lfs', 'version']); } catch (_error) { throw new Error('Git LFS ist nicht installiert. Bitte Git LFS installieren oder die LFS-Option deaktivieren.'); }
    await this.run(['-C', directory, 'lfs', 'install', '--local', '--skip-smudge', '--skip-repo']);
    await this.run(['-C', directory, 'lfs', mirror ? 'fetch' : 'pull', ...(mirror ? ['--all'] : [])]);
    if (!mirror) await this.run(['-C', directory, 'lfs', 'fsck']);
  }
  submodules(directory) {
    const host=new URL(this.server).hostname;
    return this.run(['-c', `url.${this.server}/.insteadOf=git@${host}:`, '-c', `url.${this.server}/.insteadOf=ssh://git@${host}/`, '-c', `url.${this.server}/.insteadOf=git://${host}/`, '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-C', directory, 'submodule', 'update', '--init', '--recursive', '--checkout']);
  }
}

module.exports = { Git };
