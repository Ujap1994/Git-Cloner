const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { writeJson } = require('./store.cjs');
const { controlDirectory } = require('./integrity.cjs');

async function metadataPlan(repository, options, github, git) {
  const base = `/repos/${repository.full_name}`;
  const data = {};
  if (options.issues) data.issues = (await github.collection(`${base}/issues?state=all&sort=updated&direction=desc`)).filter(issue => !issue.pull_request);
  if (options.pullRequests) data.pullRequests = await github.collection(`${base}/pulls?state=all&sort=updated&direction=desc`);
  if (options.releases) data.releases = await github.collection(`${base}/releases`);
  let wikiRevision = null;
  let wikiWarning = null;
  if (options.wiki && repository.has_wiki !== false) {
    try { wikiRevision = await git.revision(`https://github.com/${repository.full_name}.wiki.git`, true); }
    catch (_error) { wikiWarning = 'Wiki nicht vorhanden oder nicht zugänglich.'; }
  }
  const digest = createHash('sha256').update(JSON.stringify({ data, wikiRevision, wikiWarning })).digest('hex');
  return {
    digest, warning: wikiWarning, wikiRevision,
    async apply(directory, mode) {
      const target = path.join(controlDirectory(directory, mode), 'git-cloner-metadata');
      await fs.rm(target, { recursive: true, force: true });
      if (!Object.values(options).some(Boolean)) return;
      await fs.mkdir(target, { recursive: true });
      await writeJson(path.join(target, 'repository.json'), repository);
      for (const [key, values] of Object.entries(data)) await writeJson(path.join(target, `${key}.json`), values);
      if (options.issues) {
        for (const issue of data.issues) if (issue.comments > 0) await writeJson(path.join(target, `issue-${issue.number}-comments.json`), await github.collection(`${base}/issues/${issue.number}/comments`));
      }
      if (options.pullRequests) {
        for (const pr of data.pullRequests) {
          await writeJson(path.join(target, `pull-${pr.number}.json`), {
            ...pr, reviews: await github.collection(`${base}/pulls/${pr.number}/reviews`),
            comments: await github.collection(`${base}/issues/${pr.number}/comments`),
            files: await github.collection(`${base}/pulls/${pr.number}/files`)
          });
        }
      }
      if (options.releases) for (const release of data.releases) for (const asset of release.assets ?? []) {
        const assets = path.join(target, 'release-assets'); await fs.mkdir(assets, { recursive: true });
        const safeName = `${asset.id}-${asset.name.replace(/[^a-z\d._-]/gi, '_').slice(0, 180)}`;
        await github.downloadAsset(repository.full_name, asset.id, path.join(assets, safeName));
      }
      if (wikiRevision) await git.cloneMirror(`https://github.com/${repository.full_name}.wiki.git`, path.join(target, 'wiki.git'));
      await writeJson(path.join(target, 'export.json'), { exportedAt: new Date().toISOString(), options, warning: wikiWarning, wikiRevision });
    }
  };
}
module.exports = { metadataPlan };
