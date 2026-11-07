const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { publishRelease } = require('../../scripts/publish-release.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-publish-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'assets');
  await fs.mkdir(assets);
  await fs.writeFile(path.join(assets, 'program.zip'), 'actual package');
  const hash = createHash('sha256').update('actual package').digest('hex');
  await fs.writeFile(path.join(assets, 'SHA256SUMS.txt'), hash + '  program.zip\n');
  const notes = path.join(root, 'notes.md');
  await fs.writeFile(notes, 'Release notes\n\nLiteral $content and `code` remain unchanged.\n');
  const f = {
    repository: 'example/project',
    version: '3.1.0',
    commit: 'a'.repeat(40),
    assets,
    notes,
    pause: async () => {},
    release: null,
    createCalls: 0,
    uploads: 0,
    publishes: 0,
    failCreation: false,
    corrupt: false,
    hiddenDraft: false,
    lookups: []
  };
  f.run = async args => {
    if (args[0] === 'api') {
      const method = args[2],
        endpoint = args[3];
      if (method === 'GET') {
        f.lookups.push(endpoint);
        if (endpoint.includes('?per_page=')) return { stdout: JSON.stringify(f.release ? [f.release] : []) };
        if (!f.release || (f.hiddenDraft && f.release.draft && endpoint.includes('/tags/')))
          throw new Error('HTTP 404: not found');
        return { stdout: JSON.stringify(f.release) };
      }
      const body = JSON.parse(await fs.readFile(args[args.indexOf('--input') + 1], 'utf8'));
      if (method === 'POST') {
        f.createCalls++;
        f.release = { ...body, id: 1, html_url: 'https://github.com/example/project/releases/tag/v3.1.0', assets: [] };
        if (f.failCreation) {
          f.failCreation = false;
          throw new Error('HTTP 502: server response lost');
        }
        return { stdout: JSON.stringify(f.release) };
      }
      if (method === 'PATCH') {
        f.publishes++;
        Object.assign(f.release, body);
        return { stdout: JSON.stringify(f.release) };
      }
    }
    if (args[0] === 'release' && args[1] === 'upload') {
      f.uploads++;
      const name = path.basename(args[3]),
        data = await fs.readFile(args[3]),
        asset = {
          name,
          size: data.length,
          digest: 'sha256:' + (f.corrupt ? '0'.repeat(64) : createHash('sha256').update(data).digest('hex'))
        };
      f.release.assets = f.release.assets.filter(a => a.name !== name);
      f.release.assets.push(asset);
      return { stdout: '' };
    }
    throw new Error('Unexpected command');
  };
  return f;
}
test('publication recovers an uncertain HTTP 502 creation without duplicating the draft', async t => {
  const f = await fixture(t);
  f.failCreation = true;
  f.hiddenDraft = true;
  const result = await publishRelease(f);
  assert.equal(f.createCalls, 1);
  assert.equal(f.uploads, 2);
  assert.equal(f.publishes, 1);
  assert.equal(f.release.draft, false);
  assert.equal(result.assets, 2);
  assert.equal(f.release.body, await fs.readFile(f.notes, 'utf8'));
});
test('publication retry leaves an already verified official release untouched', async t => {
  const f = await fixture(t);
  await publishRelease(f);
  const before = { uploads: f.uploads, publishes: f.publishes };
  assert.equal((await publishRelease(f)).alreadyPublished, true);
  assert.deepEqual({ uploads: f.uploads, publishes: f.publishes }, before);
});
test('a mismatching uploaded digest keeps the release unpublished', async t => {
  const f = await fixture(t);
  f.corrupt = true;
  await assert.rejects(publishRelease(f), /checksum/);
  assert.equal(f.release.draft, true);
  assert.equal(f.publishes, 0);
});
test('an existing official release for another commit is never overwritten', async t => {
  const f = await fixture(t);
  f.release = { target_commitish: 'b'.repeat(40), draft: false, assets: [] };
  await assert.rejects(publishRelease(f), /different commit/);
  assert.equal(f.uploads, 0);
  assert.equal(f.publishes, 0);
});
test('an existing draft without a published tag is discovered through the authenticated release list', async t => {
  const f = await fixture(t);
  f.hiddenDraft = true;
  f.release = { id: 1, tag_name: 'v3.1.0', target_commitish: f.commit, draft: true, assets: [] };
  await publishRelease(f);
  assert.equal(f.createCalls, 0);
  assert.equal(f.publishes, 1);
  assert(f.lookups.some(url => url.includes('?per_page=')));
  assert(f.lookups.some(url => url.endsWith('/releases/1')));
});
test('a newly created draft is verified by its ID even when tag lookup cannot see it', async t => {
  const f = await fixture(t);
  f.hiddenDraft = true;
  await publishRelease(f);
  assert.equal(f.createCalls, 1);
  assert.equal(f.release.draft, false);
  assert.equal(f.lookups.filter(url => url.includes('/tags/')).length, 1);
  assert(f.lookups.filter(url => url.endsWith('/releases/1')).length >= 2);
});
