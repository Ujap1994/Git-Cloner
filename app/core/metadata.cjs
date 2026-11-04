const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { writeJson } = require('./store.cjs');
const { controlDirectory } = require('./integrity.cjs');
const { selectReleaseAssets } = require('./release-assets.cjs');
const { createReleaseDirectory } = require('./release-layout.cjs');

async function metadataPlan(repository, options, github, git, { releaseScope = 'all', platform = process.platform } = {}) {
  if(github?.provider&&github.provider!=='github')return require('./hosted-metadata.cjs').hostedMetadataPlan(repository,options,github,git,{releaseScope,platform});
  const base = `/repos/${repository.full_name}`;
  const data = {};
  if (options.issues) data.issues = (await github.collection(`${base}/issues?state=all&sort=updated&direction=desc`)).filter(issue => !issue.pull_request);
  if (options.pullRequests) data.pullRequests = await github.collection(`${base}/pulls?state=all&sort=updated&direction=desc`);
  if (options.releases) data.releases = await github.collection(`${base}/releases`);
  const release = options.releases && data.releases.length ? await github.request(`${base}/releases/latest`, { allow404: true }) : null;
  const assets = Number.isSafeInteger(release?.id) ? await github.collection(`${base}/releases/${release.id}/assets`) : release?.assets ?? [];
  const releaseSelection = selectReleaseAssets(assets,releaseScope,platform);
  const estimatedBytes = releaseSelection.selected.reduce((sum,a) => sum + (Number.isSafeInteger(a.size) && a.size >= 0 ? a.size : 0),0);
  const releaseInfo = release ? {tag:release.tag_name,scope:releaseScope,platform,fileCount:releaseSelection.selected.length,bytes:estimatedBytes,excludedCount:releaseSelection.excluded.length} : null;
  let wikiRevision = null;
  let wikiWarning = null;
  if (options.wiki && repository.has_wiki !== false) {
    try { wikiRevision = await git.revision(`https://github.com/${repository.full_name}.wiki.git`, true); }
    catch (_error) { wikiWarning = 'Wiki nicht vorhanden oder nicht zugänglich.'; }
  }
  const digest = createHash('sha256').update(JSON.stringify({ data, wikiRevision, wikiWarning, ...(options.releases ? { releaseLayout: 2, release: { tag: release?.tag_name, ids: releaseSelection.selected.map(a => a.id), scope: releaseScope, platform: releaseScope === 'system' ? platform : null } } : {}) })).digest('hex');
  return {
    digest, warning: wikiWarning, wikiRevision, estimatedBytes, releaseInfo, downloadCount: releaseSelection.selected.length,
    releaseWarning: options.releases && assets.length && !releaseSelection.selected.length ? 'Keine eindeutig passenden Release-Dateien für dieses Betriebssystem gefunden. Bei Bedarf alle Betriebssysteme auswählen.' : null,
    async apply(directory, mode, { downloads, onProgress } = {}) {
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
      if (options.releases) await writeJson(path.join(target,'release-selection.json'), { tag: release?.tag_name ?? null, scope: releaseScope, platform, platformName: releaseSelection.platformName, selected: releaseSelection.selected.map(a => ({ id: a.id, name: a.name, size: a.size })), excluded: releaseSelection.excluded });
      const releaseFolder = releaseSelection.selected.length ? await createReleaseDirectory(directory, repository, release, releaseSelection.selected) : null;
      for (const asset of releaseSelection.selected) {
        const safeName = releaseFolder.files.find(file => file.id === asset.id).storedName;
        await github.downloadAsset(repository.full_name, asset.id, path.join(releaseFolder.target, safeName), { expectedSize: asset.size, expectedDigest: asset.digest, expectedName: asset.name, ...(downloads ? { resume: { cache: downloads, identity: { tag: release.tag_name, id: asset.id, name: asset.name, size: asset.size, digest: asset.digest, updatedAt: asset.updated_at }, onProgress } } : {}) });
      }
      if (wikiRevision) await git.cloneMirror(`https://github.com/${repository.full_name}.wiki.git`, path.join(target, 'wiki.git'));
      await writeJson(path.join(target, 'export.json'), { exportedAt: new Date().toISOString(), options, warning: wikiWarning, wikiRevision });
      return { releaseInfo: releaseInfo ? { ...releaseInfo, assetDirectory: releaseFolder?.name ?? null } : null };
    }
  };
}
module.exports = { metadataPlan };
