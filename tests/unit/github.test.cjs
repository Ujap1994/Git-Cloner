const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GitHubClient } = require('../../app/core/github.cjs');
const { checkForUpdates } = require('../../app/core/updates.cjs');
const response = (data,status=200) => ({ok:status>=200&&status<300,status,json:async()=>data});
test('paginates account repositories and excludes foreign-owned repos', async () => {
  const calls=[];
  const api=new GitHubClient({fetchImpl:async url=>{
    calls.push(url);
    if(url.endsWith('/users/demo'))return response({type:'User'});
    return response(new URL(url).searchParams.get('page')==='1' ? Array.from({length:100},(_,i)=>({full_name:`demo/r${i}`,owner:{login:'demo'}})) : [{full_name:'demo/last',owner:{login:'demo'}},{full_name:'other/repo',owner:{login:'other'}}]);
  }});
  assert.equal((await api.repositories('demo')).length,101);
  assert.equal(calls.length,3);
});
test('uses org endpoint with authentication for organizations', async () => {
  const calls=[];
  const api=new GitHubClient({token:'test-token',fetchImpl:async(url,options)=>{
    calls.push(url); assert.equal(options.headers.Authorization,'Bearer test-token');
    return response(url.endsWith('/users/team') ? {type:'Organization'} : []);
  }});
  await api.repositories('team'); assert.ok(calls[1].includes('/orgs/team/repos?type=all'));
});
test('authenticated owner listing includes private repositories', async () => {
  const calls=[];
  const api=new GitHubClient({token:'test-token',fetchImpl:async url=>{
    calls.push(url);
    if(url.endsWith('/users/me'))return response({type:'User'});
    if(url.endsWith('/user'))return response({login:'Me'});
    return response([{full_name:'me/private',owner:{login:'me'},private:true}]);
  }});
  assert.equal((await api.repositories('me')).length,1);
  assert.ok(calls[2].includes('/user/repos?affiliation=owner&visibility=all'));
});
test('GitHub errors are actionable without exposing response data', async () => {
  for(const status of [401,403,404,429,500]) {
    const api=new GitHubClient({fetchImpl:async()=>response({message:'secret'},status)});
    await assert.rejects(api.repository('a/b'),error=>!error.message.includes('secret'));
  }
});
test('release comparison uses semantic version order', async () => {
  const github={request:async()=>({tag_name:'v10.0.0'})};
  assert.equal((await checkForUpdates('2.0.0',github)).status,'available');
  github.request=async()=>({tag_name:'v1.0.0'});
  assert.equal((await checkForUpdates('1.0.0',github)).status,'current');
  assert.equal((await checkForUpdates('1.1.0',github)).status,'current');
  github.request=async()=>null; assert.equal((await checkForUpdates('1.0.0',github)).status,'unpublished');
  github.request=async()=>({tag_name:'invalid'}); await assert.rejects(checkForUpdates('1.0.0',github));
});
test('API limits report their reset time and only short waits are retried in place', async () => {
  const { rateLimitError, rateReady } = require('../../app/core/rate-limit.cjs');
  const headers = values => ({ get: name => values[name.toLowerCase()] ?? null });
  const now = Date.parse('2026-11-06T12:00:00Z');
  const primary = rateLimitError({ status: 403, headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 1800) }) }, { now });
  assert.equal(primary.rateLimited, true); assert.equal(primary.retryable, false); assert.equal(primary.rateLimitUntil, '2026-11-06T12:30:00.000Z'); assert.equal(primary.helpCode, 'rate');
  const secondary = rateLimitError({ status: 403, headers: headers({ 'retry-after': '20' }) }, { now });
  assert.equal(secondary.retryable, true); assert.equal(secondary.retryAfterMs, 20000);
  assert.equal(rateLimitError({ status: 429, headers: headers({ 'ratelimit-reset': String(now / 1000 + 120) }) }, { now, label: 'GitLab' }).rateLimitUntil, '2026-11-06T12:02:00.000Z');
  assert.equal(rateLimitError({ status: 403, headers: headers({ 'x-ratelimit-remaining': '12' }) }, { now }), null);
  assert.equal(rateReady({ rateLimitUntil: '2026-11-06T12:30:00.000Z' }, now), false); assert.equal(rateReady({ rateLimitUntil: '2026-11-06T12:30:00.000Z' }, now + 1800000), true); assert.equal(rateReady({}, now), true);
  let calls = 0;
  const api = new GitHubClient({ retryOptions: { sleep: async () => {} }, fetchImpl: async () => { calls++; return { ok: false, status: 403, headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) }) }; } });
  await assert.rejects(api.repository('demo/project'), error => error.rateLimited && /API-Limit/.test(error.message)); assert.equal(calls, 1);
});
test('stored API-limit messages from older runs are classified as rate limits in help and redacted exports', () => {
  const { errorCode } = require('../../app/core/error-help.cjs');
  const { redactLogs } = require('../../app/core/transfer.cjs');
  const stored = { fullName: 'private/name', status: 'error', message: 'GitHub antwortet vorübergehend mit HTTP 403.', helpCode: 'authentication' };
  assert.equal(errorCode(stored), 'rate'); assert.equal(errorCode({ message: 'GitHub-Token ist ungültig oder abgelaufen.' }), 'authentication');
  const exported = redactLogs([{ startedAt: 'a', finishedAt: 'b', results: [stored] }]), text = JSON.stringify(exported);
  assert.equal(exported.runs[0].results[0].diagnosis, 'rate'); assert(!text.includes('private/name')); assert(!text.includes('vorübergehend'));
});
test('bare mirrors are addressed with an explicit Git directory', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { explicitBare } = require('../../app/core/git.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-bare-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bare = path.join(root, 'mirror.git'), work = path.join(root, 'work');
  for (const dir of [path.join(bare, 'objects'), path.join(bare, 'refs'), path.join(work, '.git')]) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(bare, 'HEAD'), 'ref: refs/heads/main\n');
  assert.deepEqual(explicitBare(['-C', bare, 'fsck']), ['-C', bare, '--git-dir=.', 'fsck']);
  assert.deepEqual(explicitBare(['-C', work, 'fsck']), ['-C', work, 'fsck']);
  assert.deepEqual(explicitBare(['clone', '--mirror', 'x', bare]), ['clone', '--mirror', 'x', bare]);
});
test('secondary limits without headers and limited release downloads pause instead of failing', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { HostedClient } = require('../../app/core/hosted-client.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-rate-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const body = message => JSON.stringify({ message });
  const secondary = new GitHubClient({ retryOptions: { retries: 0 }, fetchImpl: async () => new Response(body('You have exceeded a secondary rate limit. Please wait a few minutes before you try again.'), { status: 403 }) });
  await assert.rejects(secondary.repository('demo/project'), error => error.rateLimited && error.retryAfterMs === 60000 && error.helpCode === 'rate');
  const denied = new GitHubClient({ retryOptions: { retries: 0 }, fetchImpl: async () => new Response(body('Resource not accessible by integration'), { status: 403 }) });
  await assert.rejects(denied.repository('demo/project'), error => !error.rateLimited && /GitHub-Zugriff begrenzt/.test(error.message));
  const reset = String(Math.floor(Date.now() / 1000) + 1800), file = path.join(root, 'asset.dmg');
  const assets = new GitHubClient({ retryOptions: { retries: 0 }, fetchImpl: async () => new Response(body('API rate limit exceeded'), { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }) });
  await assert.rejects(assets.downloadAsset('demo/project', 7, file), error => error.rateLimited && !error.retryable && Date.parse(error.rateLimitUntil) === Number(reset) * 1000);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  const hosted = new HostedClient({ provider: 'forgejo', server: 'https://git.example.org', retryOptions: { retries: 0 }, fetchImpl: async () => new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '900' } }) });
  await assert.rejects(hosted.downloadAsset('demo/project', 1, file, { url: 'https://git.example.org/demo/project/releases/download/v1/app.dmg' }), error => error.rateLimited && /Forgejo-API-Limit/.test(error.message) && error.retryAfterMs === 900000);
});
