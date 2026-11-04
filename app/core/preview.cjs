const fs = require('node:fs/promises');
const { resolveJobs } = require('./backup.cjs');
const { validateConfig, effectiveBackup } = require('./config.cjs');
const { repositoryDestination,repositoryIdentity } = require('./provider-spec.cjs');
async function spaceAt(destination) {
  try {
    const info = await fs.stat(destination); if (!info.isDirectory()) throw new Error('Kein Ordner.');
    const space = await fs.statfs(destination, { bigint: true });
    return { destination, reachable: true, freeBytes: Number(space.bavail * space.bsize), totalBytes: Number(space.blocks * space.bsize), device: String(info.dev) };
  } catch (_error) { return { destination, reachable: false, freeBytes: null, totalBytes: null }; }
}
async function previewConfig(input, github) {
  const config = validateConfig(input), { jobs, errors, excluded } = await resolveJobs(config.sources, github);
  const disks = await Promise.all([...new Set(jobs.map(job => job.source.destination))].map(spaceAt));
  const targets = jobs.map(job => {
    const options = effectiveBackup(config,job.source), estimatedBytes = Math.max(0,job.repository.size || 0) * 1024;
    return { fullName: job.repository.full_name, sourceId: job.sourceId, targetId: job.targetId, destination: repositoryDestination(job.source,job.repository.full_name), identity:repositoryIdentity(job.source,job.repository.full_name), root: job.source.destination, mode: options.mode, encrypted: options.encryption, estimatedBytes };
  });
  for (const disk of disks) {
    const matching = targets.filter(t => t.root === disk.destination);
    disk.estimatedBytes = matching.reduce((sum,t) => sum + t.estimatedBytes * 2,0);
    disk.reserveBytes = Math.max(0,...jobs.filter(job => job.source.destination === disk.destination).map(job => effectiveBackup(config,job.source).reserveMB)) * 1048576;
    disk.enoughSpace = disk.reachable && disk.freeBytes >= disk.estimatedBytes + disk.reserveBytes;
  }
  for (const disk of disks.filter(d => d.reachable)) {
    const siblings = disks.filter(d => d.device === disk.device);
    const needed = siblings.reduce((sum,d) => sum + d.estimatedBytes,0) + Math.max(...siblings.map(d => d.reserveBytes));
    disk.enoughSpace = disk.freeBytes >= needed;
  }
  return { checkedAt: new Date().toISOString(), readOnly: true, repositoryCount: new Set(targets.map(t => t.identity)).size, targetCount: targets.length, excludedCount: excluded.length, estimatedBytes: targets.reduce((sum,t) => sum + t.estimatedBytes,0), targets, excluded, errors, disks };
}
module.exports = { previewConfig, spaceAt };
