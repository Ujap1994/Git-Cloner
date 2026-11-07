const { transferAsset } = require('./release-transfer.cjs');
const { stableReleaseData, finishReleaseFolder, assetIdentity } = require('./release-reuse.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { writeJson } = require('./store.cjs');
const { controlDirectory } = require('./integrity.cjs');
const { selectReleaseAssets } = require('./release-assets.cjs');
const { createReleaseDirectory } = require('./release-layout.cjs');
const { narrowToProgram } = require('./program-select.cjs');

async function metadataPlan(
  repository,
  options,
  github,
  git,
  {
    releaseScope = 'all',
    platform = process.platform,
    releaseArchitecture = 'all',
    releaseFileTypes = [],
    arch = process.arch,
    releaseProgram = null
  } = {}
) {
  if (github?.provider && github.provider !== 'github')
    return require('./hosted-metadata.cjs').hostedMetadataPlan(repository, options, github, git, {
      releaseScope,
      platform,
      releaseArchitecture,
      releaseFileTypes,
      arch,
      releaseProgram
    });
  const base = `/repos/${repository.full_name}`;
  const data = {};
  if (options.issues)
    data.issues = (await github.collection(`${base}/issues?state=all&sort=updated&direction=desc`)).filter(
      issue => !issue.pull_request
    );
  if (options.pullRequests)
    data.pullRequests = await github.collection(`${base}/pulls?state=all&sort=updated&direction=desc`);
  if (options.releases) data.releases = await github.collection(`${base}/releases`);
  const release =
    options.releases && data.releases.length
      ? await github.request(`${base}/releases/latest`, { allow404: true })
      : null;
  // The release already lists its assets with the same fields as the assets endpoint; only very large lists are paged
  // separately. This saves one API request per repository, which matters with 60 requests per hour without a token.
  const embedded = Array.isArray(release?.assets) && release.assets.length < 100;
  const assets =
    Number.isSafeInteger(release?.id) && !embedded
      ? await github.collection(`${base}/releases/${release.id}/assets`)
      : (release?.assets ?? []);
  const releaseSelection = narrowToProgram(
    selectReleaseAssets(assets, releaseScope, platform, { releaseArchitecture, releaseFileTypes, arch }),
    options.releases ? releaseProgram : null,
    platform,
    arch
  );
  const estimatedBytes = releaseSelection.selected.reduce(
    (sum, a) => sum + (Number.isSafeInteger(a.size) && a.size >= 0 ? a.size : 0),
    0
  );
  const releaseInfo = release
    ? {
        architecture: releaseSelection.architecture,
        fileTypes: releaseFileTypes,
        tag: release.tag_name,
        scope: releaseScope,
        platform,
        fileCount: releaseSelection.selected.length,
        bytes: estimatedBytes,
        excludedCount: releaseSelection.excluded.length
      }
    : null;
  let wikiRevision = null;
  let wikiWarning = null;
  if (options.wiki && repository.has_wiki !== false) {
    try {
      wikiRevision = await git.revision(`https://github.com/${repository.full_name}.wiki.git`, true);
    } catch (_error) {
      wikiWarning = 'Wiki nicht vorhanden oder nicht zugänglich.';
    }
  }
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        data: stableReleaseData(data),
        wikiRevision,
        wikiWarning,
        ...(options.releases
          ? {
              releaseLayout: 3,
              identities: releaseSelection.selected.map(assetIdentity),
              releaseArchitecture,
              releaseFileTypes,
              arch: releaseArchitecture === 'system' ? arch : null,
              release: {
                tag: release?.tag_name,
                ids: releaseSelection.selected.map(a => a.id),
                scope: releaseScope,
                platform: releaseScope === 'system' ? platform : null
              },
              ...(releaseProgram ? { program: releaseProgram.pattern } : {})
            }
          : {})
      })
    )
    .digest('hex');
  return {
    digest,
    warning: wikiWarning,
    wikiRevision,
    estimatedBytes,
    releaseInfo,
    downloadCount: releaseSelection.selected.length,
    releaseWarning:
      options.releases && assets.length && !releaseSelection.selected.length
        ? 'Keine Release-Dateien passen zu den gewählten Filtern. Betriebssystem, Architektur und Dateitypen prüfen.'
        : null,
    async apply(directory, mode, { downloads, onProgress, reuse, onDownload } = {}) {
      const target = path.join(controlDirectory(directory, mode), 'git-cloner-metadata');
      await fs.rm(target, { recursive: true, force: true });
      if (!Object.values(options).some(Boolean)) return;
      await fs.mkdir(target, { recursive: true });
      await writeJson(path.join(target, 'repository.json'), repository);
      for (const [key, values] of Object.entries(data)) await writeJson(path.join(target, `${key}.json`), values);
      if (options.issues) {
        for (const issue of data.issues)
          if (issue.comments > 0)
            await writeJson(
              path.join(target, `issue-${issue.number}-comments.json`),
              await github.collection(`${base}/issues/${issue.number}/comments`)
            );
      }
      if (options.pullRequests) {
        for (const pr of data.pullRequests) {
          await writeJson(path.join(target, `pull-${pr.number}.json`), {
            ...pr,
            reviews: await github.collection(`${base}/pulls/${pr.number}/reviews`),
            comments: await github.collection(`${base}/issues/${pr.number}/comments`),
            files: await github.collection(`${base}/pulls/${pr.number}/files`)
          });
        }
      }
      if (options.releases)
        await writeJson(path.join(target, 'release-selection.json'), {
          tag: release?.tag_name ?? null,
          scope: releaseScope,
          platform,
          platformName: releaseSelection.platformName,
          selected: releaseSelection.selected.map(a => ({ id: a.id, name: a.name, size: a.size })),
          excluded: releaseSelection.excluded
        });
      const releaseFolder = releaseSelection.selected.length
        ? await createReleaseDirectory(directory, repository, release, releaseSelection.selected)
        : null;
      for (const asset of releaseSelection.selected) {
        const safeName = releaseFolder.files.find(file => file.id === asset.id).storedName;
        await transferAsset({
          asset,
          tag: release.tag_name,
          target: path.join(releaseFolder.target, safeName),
          downloads,
          reuse,
          onProgress,
          onDownload,
          download: measured =>
            github.downloadAsset(repository.full_name, asset.id, path.join(releaseFolder.target, safeName), {
              expectedSize: asset.size,
              expectedDigest: asset.digest,
              expectedName: asset.name,
              ...measured
            })
        });
      }
      await finishReleaseFolder(releaseFolder, releaseSelection.selected);
      if (wikiRevision)
        await git.cloneMirror(`https://github.com/${repository.full_name}.wiki.git`, path.join(target, 'wiki.git'));
      await writeJson(path.join(target, 'export.json'), {
        exportedAt: new Date().toISOString(),
        options,
        warning: wikiWarning,
        wikiRevision
      });
      return { releaseInfo: releaseInfo ? { ...releaseInfo, assetDirectory: releaseFolder?.name ?? null } : null };
    }
  };
}
module.exports = { metadataPlan };
