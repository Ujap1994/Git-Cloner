const fs = require('node:fs/promises');
async function transferAsset({ asset, tag, target, download, downloads, reuse, onProgress, onDownload = () => {} }) {
  const started = Date.now(); let networkBytes = 0, baseline, resumedBytes = 0, reusedBytes = 0, status = 'error';
  const onMeasure = update => {
    networkBytes += update.networkBytes || 0;
    if (update.cacheChunks && !baseline) baseline = new Set(update.cacheChunks.map(chunk => chunk.id));
    if (update.usedChunks) resumedBytes = update.usedChunks.reduce((sum, chunk) => sum + (baseline?.has(chunk.id) ? chunk.bytes : 0), 0);
  };
  try {
    if (await reuse?.copy(asset, target)) {
      reusedBytes = (await fs.stat(target)).size; status = 'reused'; onProgress?.({ status: 'reusing', asset: asset.name, downloadBytes: reusedBytes }); return;
    }
    await download({ onMeasure, ...(downloads ? { resume: { cache: downloads, identity: { tag, id: asset.id, name: asset.name, size: asset.size, digest: asset.digest, updatedAt: asset.updated_at, url: asset.browser_download_url }, onProgress, onMeasure } } : {}) });
    status = resumedBytes ? networkBytes ? 'resumed' : 'cached' : 'downloaded';
  } finally { onDownload({ name: asset.name, tag, status, networkBytes, reusedBytes, resumedBytes: status === 'error' ? 0 : resumedBytes, durationMs: Date.now() - started }); }
}
module.exports = { transferAsset };
